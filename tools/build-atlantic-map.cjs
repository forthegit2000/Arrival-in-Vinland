/**
 * Optional developer tool; the game uses the checked-in SVG directly.
 * node tools/build-atlantic-map.cjs /path/to/ne_50m_land.geojson
 * Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_land.geojson
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const geography = require('../atlantic-geography.js');

const source = fs.readFileSync(process.argv[2]);
const data = JSON.parse(source);
// Retain land beyond the visible extent. The SVG frame clips it to a rectangle,
// avoiding artificial straight edges where a continent meets a longitude cutoff.
const west = -180;
const east = 180;
const south = 20;
const north = 89;

// Clip each geographic polygon before projection. Intersections remain in degrees.
function clipRing(ring) {
  const edges = [
    { axis: 0, value: west, inside: (point) => point[0] >= west },
    { axis: 0, value: east, inside: (point) => point[0] <= east },
    { axis: 1, value: south, inside: (point) => point[1] >= south },
    { axis: 1, value: north, inside: (point) => point[1] <= north },
  ];
  let points = ring.slice(0, -1);
  for (const edge of edges) {
    const output = [];
    for (let index = 0; index < points.length; index++) {
      const current = points[index];
      const previous = points[(index + points.length - 1) % points.length];
      if (edge.inside(current) !== edge.inside(previous)) {
        const fraction =
          (edge.value - previous[edge.axis]) / (current[edge.axis] - previous[edge.axis]);
        output.push(previous.map((value, axis) => value + fraction * (current[axis] - value)));
      }
      if (edge.inside(current)) {
        output.push(current);
      }
    }
    points = output;
  }
  // Clipped edges can be long; sample them so parallels/meridians curve correctly.
  const sampled = [];
  for (let index = 0; index < points.length; index++) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]))),
    );
    for (let step = 0; step < steps; step++) {
      sampled.push(start.map((value, axis) => value + ((end[axis] - value) * step) / steps));
    }
  }
  return sampled;
}

function contains(ring, [x, y]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [ax, ay] = ring[index];
    const [bx, by] = ring[previous];
    const crossesLatitude = ay > y !== by > y;
    if (crossesLatitude && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
      inside = !inside;
    }
  }
  return inside;
}

const land = [];
for (const feature of data.features) {
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  for (const polygon of polygons) {
    const rings = polygon.map(clipRing).filter((ring) => ring.length >= 3);
    if (!rings.length) {
      continue;
    }
    const greenland = contains(polygon[0], [-42, 72]);
    land.push(
      `<path d="${rings.map((ring) => geography.path(ring, true)).join(' ')}"${greenland ? ' fill="#b4c0b4"' : ''} />`,
    );
  }
}

const grid = [];
for (let latitude = 50; latitude <= 80; latitude += 10) {
  const line = [];
  for (let longitude = west; longitude <= east; longitude++) {
    line.push([longitude, latitude]);
  }
  grid.push(`<path d="${geography.path(line)}" />`);
}
for (let longitude = -80; longitude <= 20; longitude += 10) {
  const line = [];
  for (let latitude = south; latitude <= north; latitude++) {
    line.push([longitude, latitude]);
  }
  grid.push(`<path d="${geography.path(line)}" />`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${geography.WIDTH} ${geography.HEIGHT}">
  <title>North Atlantic geographic reference</title>
  <desc>Natural Earth 1:50m land. Lambert conformal conic, 50N/70N. Modern coastline reference; no political borders. Source SHA-256: ${crypto.createHash('sha256').update(source).digest('hex')}</desc>
  <rect width="1200" height="840" fill="#213f52" />
  <g fill="none" stroke="#9cb8c3" stroke-opacity=".18" stroke-width="1">${grid.join('\n')}</g>
  <g fill="#70846b" stroke="#c8c7a6" stroke-width=".8" fill-rule="evenodd" stroke-linejoin="round">${land.join('\n')}</g>
</svg>\n`;
fs.mkdirSync(path.join(__dirname, '../assets/maps'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '../assets/maps/north-atlantic.svg'), svg);
console.log(`Wrote ${land.length} land polygons; ${Math.round(svg.length / 1024)} KiB.`);
