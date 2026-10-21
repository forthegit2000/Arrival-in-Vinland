/**
 * Developer-only audio preparation, using Node and ffmpeg (never needed to play).
 * node tools/build-ambience.cjs /path/to/verified-source-cache
 * The cache holds verified-sources.json and the public HQ MP3 previews it names.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const cacheDirectory = process.argv[2];
if (!cacheDirectory) {
  throw new Error('Supply the verified audio source cache directory.');
}
const mediaDirectory = path.resolve(__dirname, '../media');
const sources = JSON.parse(
  fs.readFileSync(path.join(cacheDirectory, 'verified-sources.json'), 'utf8'),
);
fs.mkdirSync(mediaDirectory, { recursive: true });
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const results = [];

for (const source of sources) {
  if (source.license !== 'CC0-1.0') {
    throw new Error(`Refusing non-CC0 audio: ${source.key}`);
  }
  const original = path.join(cacheDirectory, source.key + '-source.mp3');
  if (hash(fs.readFileSync(original)) !== source.previewSha256) {
    throw new Error(`The downloaded preview hash changed: ${source.key}`);
  }
  const duration = Number(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', original],
      { encoding: 'utf8' },
    ).trim(),
  );
  if (duration < source.start + source.duration) {
    throw new Error(`Excerpt exceeds ${source.key}`);
  }
  const crossfade = 3;
  const bodyEnd = source.duration - crossfade;
  // End with a tail/head crossfade, then wrap into the continuation of that
  // head. This makes the loop cyclic rather than fading to silence every lap.
  const loop = [
    '[0:a]highpass=f=55,lowpass=f=10000,acompressor=threshold=0.18:ratio=2.5:attack=20:release=250,asplit=3[body][tail][head]',
    `[body]atrim=start=${crossfade}:end=${bodyEnd},asetpts=PTS-STARTPTS[main]`,
    `[tail]atrim=start=${bodyEnd}:end=${source.duration},asetpts=PTS-STARTPTS[end]`,
    `[head]atrim=start=0:end=${crossfade},asetpts=PTS-STARTPTS[start]`,
    `[end][start]acrossfade=d=${crossfade}:c1=tri:c2=tri[seam]`,
    '[main][seam]concat=n=2:v=0:a=1[loop]',
  ].join(';');
  const input = [
    '-hide_banner',
    '-nostdin',
    '-ss',
    String(source.start),
    '-t',
    String(source.duration),
    '-i',
    original,
  ];
  const measurement = spawnSync(
    'ffmpeg',
    [
      ...input,
      '-filter_complex',
      loop + ';[loop]loudnorm=I=-25:TP=-6:LRA=6:print_format=json[out]',
      '-map',
      '[out]',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120000 },
  );
  if (measurement.status !== 0) {
    throw new Error(measurement.stderr);
  }
  const loudness = JSON.parse(measurement.stderr.match(/\{[\s\S]*?\}/)[0]);
  if (!Number.isFinite(Number(loudness.input_i))) {
    throw new Error('Silent audio: ' + source.key);
  }
  const normalize =
    'loudnorm=I=-25:TP=-6:LRA=6:linear=true' +
    ':measured_I=' +
    loudness.input_i +
    ':measured_TP=' +
    loudness.input_tp +
    ':measured_LRA=' +
    loudness.input_lra +
    ':measured_thresh=' +
    loudness.input_thresh +
    ':offset=' +
    loudness.target_offset;
  const destination = path.join(mediaDirectory, source.key + '.mp3');
  const encode = spawnSync(
    'ffmpeg',
    [
      ...input,
      '-y',
      '-filter_complex',
      loop + ';[loop]' + normalize + '[out]',
      '-map',
      '[out]',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-c:a',
      'libmp3lame',
      '-q:a',
      '4',
      '-map_metadata',
      '-1',
      '-metadata',
      'title=Vinland ' + source.key + ' ambience',
      '-metadata',
      'artist=' + source.author,
      '-metadata',
      'license=CC0-1.0',
      destination,
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120000 },
  );
  if (encode.status !== 0) {
    throw new Error(encode.stderr);
  }
  results.push({
    ...source,
    file: source.key + '.mp3',
    loopSeconds: source.duration - crossfade,
    processing: {
      crossfadeSeconds: crossfade,
      highpassHz: 55,
      lowpassHz: 10000,
      integratedLoudnessTarget: -25,
      truePeakCeilingDb: -6,
      normalizationMeasurements: loudness,
    },
    bytes: fs.statSync(destination).size,
    sha256: hash(fs.readFileSync(destination)),
  });
  console.log(source.key + ': prepared ' + (source.duration - crossfade) + ' second loop');
}

fs.writeFileSync(
  path.join(mediaDirectory, 'sources.json'),
  JSON.stringify(results, null, 2) + '\n',
);
const lines = [
  '# Vinland ambience sources',
  '',
  'All nine bundled audio recordings are **CC0 1.0 Universal**. Each current Freesound',
  'recording page was checked for its own CC0 license on **' +
    [...new Set(results.map((source) => source.verifiedOn))].join(', ') +
    '**.',
  'A permissive site-wide label or a search result was not treated as sufficient.',
  '',
  '[CC0 deed](https://creativecommons.org/publicdomain/zero/1.0/) ·',
  '[CC0 legal code](https://creativecommons.org/publicdomain/zero/1.0/legalcode.en) ·',
  '[Bundled license text](CC0-1.0.txt)',
  '',
  'Credit is retained as a courtesy. These are modern recordings from other locations,',
  'used as a restrained game soundscape; they are not a reconstruction or field survey',
  'of AD 1005 L’Anse aux Meadows. No specific bird species is asserted by the game.',
  '',
];
for (const source of results) {
  lines.push(
    '## ' + source.key,
    '',
    '- **Local file:** [' +
      source.file +
      '](' +
      source.file +
      '), ' +
      source.loopSeconds +
      ' seconds.',
    '- **Recording:** [' + source.title + '](' + source.sourcePage + ').',
    '- **Creator / credit:** ' + source.author + '.',
    '- **License:** [CC0-1.0](' + source.licenseUrl + ').',
    '- **Downloaded audio:** [Public high-quality MP3 preview](' + source.previewUrl + ').',
    '- **Use:** ' + source.role,
    '- **Source excerpt:** ' + source.start + '–' + (source.start + source.duration) + ' seconds.',
    '',
  );
}
lines.push(
  '## Editing and playback',
  '',
  'The bundled files are edited excerpts of the public HQ MP3 previews, not the',
  'full-resolution original WAV/FLAC downloads. Edits apply a gentle high/low-pass',
  'filter, restrained peak compression, a three-second tail/head crossfade, and',
  'two-pass loudness normalization targeting -25 LUFS with a -6 dBTP ceiling.',
  'MP3 copies are 44.1 kHz stereo. The loop period is the excerpt length minus',
  'three seconds; the endpoint joins the continuation of the opening crossfade.',
  'These edits are also made available under CC0-1.0.',
  '',
  'The player fades between day, night, seasonal and weather layers. Snowfall is',
  'a quiet air/stillness texture; it does not add rain patter or endless footsteps.',
  'The night bed uses quiet wind rather than a dense insect or frog chorus.',
  'Surf, brook and hearth layers follow the viewed location. Storm wind remains',
  'restrained and contains no added thunder jump scares.',
  '',
  'Enable **Cogwheel → Settings → Ambient sound** and adjust **Volume**.',
  'All playback uses local files, with no account, network connection or server.',
  '',
  '[sources.json](sources.json) records exact preview URLs, source and output hashes,',
  'excerpt timings and processing measurements. The optional developer-only tools',
  '[fetch-ambience.cjs](../tools/fetch-ambience.cjs) and',
  '[build-ambience.cjs](../tools/build-ambience.cjs) recheck the licenses, acquire the',
  'verified previews, and rebuild the loops using ffmpeg. Rebuilding needs Node,',
  'curl and ffmpeg; none is required to play.',
  '',
  '```sh',
  'node tools/fetch-ambience.cjs /tmp/vinland-audio-sources',
  'node tools/build-ambience.cjs /tmp/vinland-audio-sources',
  '```',
  '',
);
fs.writeFileSync(path.join(mediaDirectory, 'SOURCES.md'), lines.join('\n'));
