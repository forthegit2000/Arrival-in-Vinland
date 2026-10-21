const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const geography = require('../atlantic-geography.js');

test('nautical distances use geographic coordinates, including the date line', () => {
  assert.ok(Math.abs(geography.distanceNm([0, 0], [1, 0]) - 60.04) < 0.1);
  assert.ok(Math.abs(geography.distanceNm([179, 0], [-179, 0]) - 120.08) < 0.1);
  assert.equal(geography.distanceNm([-55, 52], [-55, 52]), 0);
});

test('the Atlantic projection keeps north up and real harbours inside the map', () => {
  const south = geography.project([-35, 50]);
  const north = geography.project([-35, 70]);
  assert.ok(north[1] < south[1]);
  assert.ok(Math.abs(north[0] - south[0]) < 0.001);
  const home = geography.project(geography.PORTS.home.coordinate);
  const greenland = geography.project(geography.PORTS.greenland.coordinate);
  const iceland = geography.project(geography.PORTS.iceland.coordinate);
  assert.ok(home[0] < greenland[0] && greenland[0] < iceland[0]);
  assert.ok(home[1] > greenland[1]);
  for (const point of [home, greenland, iceland]) {
    assert.ok(point[0] > 0 && point[0] < geography.WIDTH);
    assert.ok(point[1] > 0 && point[1] < geography.HEIGHT);
  }
  // Parks Canada's published site coordinate, rather than an invented map pixel.
  assert.ok(Math.abs(geography.PORTS.home.coordinate[0] + 55.5330555) < 0.00001);
  assert.ok(Math.abs(geography.PORTS.home.coordinate[1] - 51.5952777) < 0.00001);
});

test('sea corridors reach their ports and measure plausible North Atlantic distances', () => {
  for (const [id, route] of Object.entries(geography.ROUTES)) {
    assert.deepEqual(geography.pointAlongRoute(route, -1), geography.PORTS.home.coordinate);
    const arrival = geography.pointAlongRoute(route, 2);
    const port = geography.PORTS[id].coordinate;
    assert.ok(geography.distanceNm(arrival, port) < 0.001);
    const direct = geography.distanceNm(geography.PORTS.home.coordinate, port);
    assert.ok(geography.routeDistance(route) >= direct);
    const middle = geography.pointAlongRoute(route, 0.5);
    assert.ok(middle.every(Number.isFinite));
  }
  assert.ok(geography.routeDistance(geography.ROUTES.greenland) > 600);
  assert.ok(geography.routeDistance(geography.ROUTES.greenland) < 800);
  assert.ok(geography.routeDistance(geography.ROUTES.iceland) > 1200);
  assert.ok(geography.routeDistance(geography.ROUTES.iceland) < 1600);
});

test('the offline basemap contains sourced coastlines and matches the projection frame', () => {
  const svg = fs.readFileSync(path.join(__dirname, '../assets/maps/north-atlantic.svg'), 'utf8');
  assert.ok(/Natural Earth 1:50m land/.test(svg));
  assert.ok(/SHA-256:\s+[a-f0-9]{64}/.test(svg));
  assert.ok(new RegExp(`viewBox="0 0 ${geography.WIDTH} ${geography.HEIGHT}"`).test(svg));
  assert.ok((svg.match(/<path/g) || []).length > 150);
  assert.ok(!/NaN|Infinity/.test(svg));
});
