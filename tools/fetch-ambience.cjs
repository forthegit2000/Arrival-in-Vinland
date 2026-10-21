/**
 * Developer-only source acquisition; not used by the offline game.
 * node tools/fetch-ambience.cjs /path/to/source-cache
 * Rechecks each recording's CC0 license before downloading its public preview.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const directory = process.argv[2];
if (!directory) {
  throw new Error('Supply an audio source cache directory.');
}
fs.mkdirSync(directory, { recursive: true });
const sources = JSON.parse(fs.readFileSync(path.join(__dirname, '../media/sources.json'), 'utf8'));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const verified = [];

for (const source of sources) {
  // curl writes directly to disk and can resume large previews after a timeout.
  const html = execFileSync('curl', ['-fLsS', '--max-time', '60', source.sourcePage], {
    encoding: 'utf8',
  });
  const license = html.match(/<a\b[^>]*title="Go to the full license text"[^>]*href="([^"]+)"/);
  if (
    !license ||
    !/^https?:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/?$/.test(license[1])
  ) {
    throw new Error(`The current recording page does not confirm CC0: ${source.sourcePage}`);
  }
  if (!html.includes(`data-static-file-url="${source.previewUrl}"`)) {
    throw new Error(`The preview URL changed; review the source before continuing: ${source.key}`);
  }
  const original = path.join(directory, source.key + '-source.mp3');
  const cached =
    fs.existsSync(original) && hash(fs.readFileSync(original)) === source.previewSha256;
  if (!cached) {
    execFileSync(
      'curl',
      ['-fLsS', '--continue-at', '-', '--max-time', '600', source.previewUrl, '-o', original],
      { stdio: 'inherit' },
    );
  }
  if (hash(fs.readFileSync(original)) !== source.previewSha256) {
    throw new Error(
      `Preview bytes changed; review before replacing the verified source: ${source.key}`,
    );
  }
  fs.writeFileSync(path.join(directory, source.key + '.html'), html);
  const { file, loopSeconds, processing, bytes, sha256, ...recording } = source;
  verified.push({
    ...recording,
    verifiedOn: new Date().toISOString().slice(0, 10),
    sourcePageSha256: hash(html),
  });
  console.log(source.key + ': CC0 and preview hash verified');
}
fs.writeFileSync(
  path.join(directory, 'verified-sources.json'),
  JSON.stringify(verified, null, 2) + '\n',
);
