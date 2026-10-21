const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { selectAmbience, TRACKS } = require('../audio.js');

const fairDay = {
  hour: 12,
  daylightHours: 14,
  season: 'summer',
  rain: false,
  snow: false,
  gale: false,
  wind: 10,
  shoreDistance: 0,
  freshwaterDistance: 0,
  distanceFromHall: 0,
  hallActive: true,
  screen: 'settlement',
};
const mix = (changes = {}) => selectAmbience({ ...fairDay, ...changes });

test('day, night and dawn blend without abrupt bird or night switches', () => {
  assert.ok(mix().daylight > 0);
  assert.equal(mix().night, 0);
  assert.equal(mix({ hour: 0 }).daylight, 0);
  assert.ok(mix({ hour: 0 }).night > 0);
  const dawn = mix({ hour: 5 });
  assert.ok(dawn.daylight > 0 && dawn.night > 0);
  assert.ok(Math.abs(mix({ hour: 5.001 }).daylight - dawn.daylight) < 0.001);
});

test('snow uses winter air instead of liquid rain or summer birds', () => {
  const winter = mix({ season: 'winter' });
  assert.equal(winter.daylight, 0);
  assert.ok(winter['winter-daylight'] > 0);
  const snowfall = mix({ rain: true, snow: true });
  assert.equal(snowfall.rain, 0);
  assert.equal(snowfall.daylight, 0);
  assert.ok(snowfall['winter-snow'] > 0);
  assert.ok(mix({ rain: true }).rain > 0);
  assert.ok(mix({ rain: true }).daylight < mix().daylight);
});

test('water and the restored hearth follow location; Atlantic gets a sea bed', () => {
  const distant = mix({ shoreDistance: 400, freshwaterDistance: 200, distanceFromHall: 200 });
  for (const key of ['coast', 'brook', 'hearth']) {
    assert.ok(distant[key] < mix()[key] / 10);
  }
  assert.equal(mix({ hallActive: false }).hearth, 0);
  const atlantic = mix({ screen: 'atlantic', rain: true });
  assert.ok(atlantic.coast > 0 && atlantic.wind > 0);
  for (const key of TRACKS.filter((key) => !['coast', 'wind'].includes(key))) {
    assert.equal(atlantic[key], 0);
  }
});

test('seasonal and storm mixes stay finite and within comfortable gain limits', () => {
  for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    for (let hour = 0; hour < 24; hour += 0.25) {
      for (const weather of [
        {},
        { rain: true },
        { rain: true, snow: true, gale: true, wind: 65 },
      ]) {
        for (const gain of Object.values(mix({ season, hour, ...weather }))) {
          assert.ok(Number.isFinite(gain) && gain >= 0 && gain <= 0.7);
        }
      }
    }
  }
});

test('every bundled track has a CC0 source, processing record and matching file hash', () => {
  const directory = path.join(__dirname, '../media');
  const sources = JSON.parse(fs.readFileSync(path.join(directory, 'sources.json'), 'utf8'));
  assert.deepEqual(
    sources.map((source) => source.key),
    TRACKS,
  );
  for (const source of sources) {
    assert.equal(source.license, 'CC0-1.0');
    assert.equal(source.licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/');
    assert.match(source.sourcePage, /^https:\/\/freesound.org\/people\//);
    assert.match(source.previewUrl, /^https:\/\/cdn.freesound.org\/previews\//);
    assert.equal(source.file, source.key + '.mp3');
    const bytes = fs.readFileSync(path.join(directory, source.file));
    assert.ok(bytes.length > 50000);
    assert.equal(bytes.length, source.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), source.sha256);
    assert.equal(source.loopSeconds, source.duration - source.processing.crossfadeSeconds);
    assert.ok(Number(source.processing.normalizationMeasurements.input_i) < 0);
  }
  assert.match(fs.readFileSync(path.join(directory, 'CC0-1.0.txt'), 'utf8'), /CC0 1.0 Universal/);
});
