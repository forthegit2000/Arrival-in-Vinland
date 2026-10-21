const { test } = require('node:test');
const assert = require('node:assert/strict');
const Solar = require('../solar.js');
const { Simulation } = require('../simulation.js');

function at(month, day, hour) {
  return Solar.position(Solar.localTimestamp(new Date(Date.UTC(1005, month - 1, day)), hour));
}
function close(actual, expected, tolerance = 0.00001) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}

test('historical dates match independently evaluated NOAA calculator reference values', () => {
  // NOAA main.js, calcAzEl at the mapped Hall F coordinates. Local mean solar time.
  for (const [month, day, hour, azimuth, elevation] of [
    [8, 1, 8, 101.15098503000249, 32.12883078142244],
    [12, 21, 12, 179.90760638620435, 14.896489853759022],
    [6, 21, 18, 285.2939220462755, 18.19888790638032],
  ]) {
    const sun = at(month, day, hour);
    close(sun.azimuthDegrees, azimuth);
    close(sun.apparentElevationDegrees, elevation);
  }
});

test('published NREL SPA example agrees within 0.02 degrees', () => {
  // Reda/Andreas, Solar Position Algorithm, example at 12:30:30 MST, 17 October 2003.
  const sun = Solar.position(Date.parse('2003-10-17T19:30:30Z'), {
    latitude: 39.742476,
    longitude: -105.1786,
  });
  close(sun.azimuthDegrees, 194.340241, 0.02);
  close(sun.apparentElevationDegrees, 90 - 50.111622, 0.02);
});

test('sun crosses the southern sky east to west with seasonal altitude changes', () => {
  assert.ok(at(8, 1, 8).direction.x > 0);
  assert.ok(at(8, 1, 18).direction.x < 0);
  assert.ok(at(8, 1, 12).direction.z > 0);
  assert.ok(at(6, 21, 12).elevationDegrees > 60);
  assert.ok(at(12, 21, 12).elevationDegrees < 16);
  assert.ok(at(8, 1, 0).direction.y < 0);
  for (let hour = 0; hour < 24; hour++) {
    const { x, y, z } = at(8, 1, hour).direction;
    close(Math.hypot(x, y, z), 1);
  }
});

test('solar disc has a real angular diameter, slightly larger in northern winter', () => {
  const summer = at(6, 21, 12),
    winter = at(12, 21, 12);
  assert.ok(summer.angularDiameterDegrees > 0.52 && summer.angularDiameterDegrees < 0.53);
  assert.ok(winter.angularDiameterDegrees > 0.54 && winter.angularDiameterDegrees < 0.55);
  assert.ok(winter.angularRadius > summer.angularRadius);
});

test('seasonal daylight and the game clock use the same historical date and location', () => {
  const sim = new Simulation();
  const initial = Solar.forSimulation(sim);
  close(initial.azimuthDegrees, at(8, 1, sim.hour).azimuthDegrees);
  assert.ok(sim.weather.daylight > 15 && sim.weather.daylight < 16);
  assert.ok(sim.weather.sunriseHour < 5);
  assert.ok(sim.weather.sunsetHour > 19);
  const winter = Solar.daylight(new Date(Date.UTC(1005, 11, 21)));
  assert.ok(winter.hours > 7 && winter.hours < 8);
  assert.equal(winter.hours, winter.sunsetHour - winter.sunriseHour);
  const loaded = Simulation.load(sim.serialize());
  assert.deepEqual(Solar.forSimulation(loaded), initial);
  sim.state.time += 1 / 3600;
  assert.notEqual(Solar.forSimulation(sim).azimuthDegrees, initial.azimuthDegrees);
});

test('refraction remains finite at the horizon and polar daylight does not produce NaN', () => {
  for (const elevation of [-90, -2, -0.575, 0, 5, 85, 90])
    assert.ok(Number.isFinite(Solar.refractionDegrees(elevation)));
  for (const latitude of [-89, 89]) {
    const day = Solar.daylight(new Date(Date.UTC(1005, 5, 21)), { latitude, longitude: 0 });
    assert.ok(day.hours === 0 || day.hours === 24);
  }
});
