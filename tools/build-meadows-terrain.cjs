/**
 * Build the offline L'Anse aux Meadows terrain reference using JavaScript only.
 * node tools/build-meadows-terrain.cjs /path/to/osm-extract.xml [cached-dem-window.json]
 * The checked-in meadows-reference.geojson can replace the XML for offline rebuilds.
 * The optional cache avoids repeating the small HTTP range read from NRCan's COG.
 * geotiff and proj4 are development dependencies; the game never loads them.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const proj4 = require('proj4');

const DEM_URL = 'https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif';
const CANADA_LAMBERT =
  '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs';
// Keep the nearby headlands inside the tile, rather than cutting their tips off.
const EXTENT = 1080;
const HEIGHT_STEP = 20;
const SHORE_STEP = 4;

function attributes(text) {
  return Object.fromEntries(
    [...text.matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  );
}

function tags(text) {
  return Object.fromEntries(
    [...text.matchAll(/<tag k="([^"]*)" v="([^"]*)"\/>/g)].map((match) => [
      match[1],
      match[2].replaceAll('&amp;', '&'),
    ]),
  );
}

function readGeometry(xml) {
  const nodes = new Map();
  for (const match of xml.matchAll(/<node\b([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)) {
    const node = attributes(match[1]);
    nodes.set(node.id, [Number(node.lon), Number(node.lat)]);
  }
  const features = [];
  for (const match of xml.matchAll(/<way\b([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const properties = tags(match[2]);
    if (
      properties.natural !== 'coastline' &&
      properties.natural !== 'water' &&
      properties.waterway !== 'stream' &&
      properties.historic !== 'archaeological_site'
    ) {
      continue;
    }
    const way = attributes(match[1]);
    const coordinates = [...match[2].matchAll(/<nd ref="(\d+)"\/>/g)].map((point) =>
      nodes.get(point[1]),
    );
    if (coordinates.some((point) => !point)) {
      throw new Error(`Incomplete OSM way ${way.id}`);
    }
    const polygon = properties.natural === 'water' || properties.historic === 'archaeological_site';
    features.push({
      type: 'Feature',
      properties: { osmId: Number(way.id), ...properties },
      geometry: {
        type: polygon ? 'Polygon' : 'LineString',
        coordinates: polygon ? [coordinates] : coordinates,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

function polygonCentroid(ring) {
  // Work relative to the first vertex to avoid cancellation with degree coordinates.
  const base = ring[0];
  let area = 0;
  let longitude = 0;
  let latitude = 0;
  for (let index = 1; index < ring.length; index++) {
    const a = ring[index - 1].map((value, axis) => value - base[axis]);
    const b = ring[index].map((value, axis) => value - base[axis]);
    const cross = a[0] * b[1] - b[0] * a[1];
    area += cross;
    longitude += (a[0] + b[0]) * cross;
    latitude += (a[1] + b[1]) * cross;
  }
  return [base[0] + longitude / (3 * area), base[1] + latitude / (3 * area)];
}

function localFrame(origin) {
  const latitude = (origin[1] * Math.PI) / 180;
  const eastScale =
    111412.84 * Math.cos(latitude) - 93.5 * Math.cos(3 * latitude) + 0.118 * Math.cos(5 * latitude);
  const northScale =
    111132.92 -
    559.82 * Math.cos(2 * latitude) +
    1.175 * Math.cos(4 * latitude) -
    0.0023 * Math.cos(6 * latitude);
  return {
    origin,
    eastScale,
    northScale,
    toLocal: ([longitude, latitude]) => [
      (longitude - origin[0]) * eastScale,
      (origin[1] - latitude) * northScale,
    ],
    toGeographic: (x, z) => [origin[0] + x / eastScale, origin[1] - z / northScale],
  };
}

async function readElevationWindow(frame, cachePath) {
  if (cachePath && fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }
  const { fromUrl } = await import('geotiff');
  const image = await (await fromUrl(DEM_URL, { allowFullFile: false })).getImage();
  if (image.getGeoKeys().ProjectedCSTypeGeoKey !== 3979) {
    throw new Error('Unexpected DEM projection');
  }
  const origin = image.getOrigin();
  const resolution = image.getResolution();
  const corners = [-EXTENT, EXTENT].flatMap((x) =>
    [-EXTENT, EXTENT].map((z) => proj4('EPSG:4326', CANADA_LAMBERT, frame.toGeographic(x, z))),
  );
  const pixels = corners.map(([x, y]) => [
    (x - origin[0]) / resolution[0],
    (y - origin[1]) / resolution[1],
  ]);
  const window = [
    Math.floor(Math.min(...pixels.map((p) => p[0]))) - 2,
    Math.floor(Math.min(...pixels.map((p) => p[1]))) - 2,
    Math.ceil(Math.max(...pixels.map((p) => p[0]))) + 2,
    Math.ceil(Math.max(...pixels.map((p) => p[1]))) + 2,
  ];
  const raster = await image.readRasters({ window, samples: [0], interleave: true });
  const result = {
    url: DEM_URL,
    epsg: 3979,
    origin,
    resolution,
    window,
    width: window[2] - window[0],
    height: window[3] - window[1],
    values: Array.from(raster),
  };
  if (cachePath) {
    fs.writeFileSync(cachePath, JSON.stringify(result));
  }
  return result;
}

function sampleElevation(dem, coordinate) {
  const [x, y] = proj4('EPSG:4326', CANADA_LAMBERT, coordinate);
  // Raster values refer to pixel centres, not the upper-left pixel corner.
  const column = (x - dem.origin[0]) / dem.resolution[0] - dem.window[0] - 0.5;
  const row = (y - dem.origin[1]) / dem.resolution[1] - dem.window[1] - 0.5;
  const left = Math.floor(column);
  const top = Math.floor(row);
  const fx = column - left;
  const fy = row - top;
  const value = (dx, dy) => dem.values[(top + dy) * dem.width + left + dx];
  const height =
    (value(0, 0) * (1 - fx) + value(1, 0) * fx) * (1 - fy) +
    (value(0, 1) * (1 - fx) + value(1, 1) * fx) * fy;
  if (!Number.isFinite(height) || height < -100) {
    throw new Error('Missing elevation coverage');
  }
  return Math.round(height * 100) / 100;
}

function coastalLandRings(lines) {
  const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
  const chains = lines.map((line) => line.slice());
  // OSM splits coastlines into ways. Join their shared endpoints first.
  for (let index = 0; index < chains.length; index++) {
    let next;
    while (
      (next = chains.findIndex(
        (chain, other) => other !== index && samePoint(chains[index].at(-1), chain[0]),
      )) !== -1
    ) {
      chains[index].push(...chains[next].slice(1));
      chains.splice(next, 1);
      if (next < index) index--;
    }
  }

  const rim = EXTENT + 8;
  const rings = [];
  for (const chain of chains) {
    if (samePoint(chain[0], chain.at(-1))) {
      rings.push(chain);
      continue;
    }
    if (
      [0, 1].some(
        (axis) =>
          chain.every((point) => point[axis] < -rim) || chain.every((point) => point[axis] > rim),
      )
    ) {
      continue; // An incomplete offshore feature entirely beyond the tile.
    }
    const projectToRim = ([x, z]) => {
      const distance = Math.max(Math.abs(x), Math.abs(z));
      if (distance <= EXTENT) {
        throw new Error('Coastline ends inside the tile; download a larger OSM extract.');
      }
      return [(x * rim) / distance, (z * rim) / distance];
    };
    const start = projectToRim(chain[0]);
    const end = projectToRim(chain.at(-1));
    // In +Z-south coordinates OSM keeps land on the right. Close open mainland
    // chains clockwise along an invisible rim outside the playable tile.
    const rimDistance = ([x, z]) => {
      if (Math.abs(x + rim) < 0.001) return z + rim;
      if (Math.abs(z - rim) < 0.001) return 3 * rim + x;
      if (Math.abs(x - rim) < 0.001) return 5 * rim - z;
      return 7 * rim - x;
    };
    const from = rimDistance(end);
    let to = rimDistance(start);
    if (to < from) to += 8 * rim;
    const corners = [
      [-rim, -rim],
      [-rim, rim],
      [rim, rim],
      [rim, -rim],
    ];
    const ring = [...chain, end];
    for (let corner = Math.floor(from / (2 * rim)) + 1; corner * 2 * rim < to; corner++) {
      ring.push(corners[corner % 4]);
    }
    ring.push(start, chain[0]);
    rings.push(ring);
  }
  return rings;
}

function insideRing(x, z, ring) {
  let inside = false;
  for (let index = 1; index < ring.length; index++) {
    const [ax, az] = ring[index - 1];
    const [bx, bz] = ring[index];
    const crossesRow = az > z !== bz > z;
    if (crossesRow && x < ax + ((z - az) * (bx - ax)) / (bz - az)) {
      inside = !inside;
    }
  }
  return inside;
}

function nearestCoast(x, z, lines, landRings) {
  let distanceSquared = Infinity;
  for (const line of lines) {
    for (let index = 1; index < line.length; index++) {
      const [ax, az] = line[index - 1];
      const [bx, bz] = line[index];
      const dx = bx - ax;
      const dz = bz - az;
      const fraction = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
      );
      const squared = (x - ax - dx * fraction) ** 2 + (z - az - dz * fraction) ** 2;
      if (squared < distanceSquared) {
        distanceSquared = squared;
      }
    }
  }
  const onLand = landRings.some((ring) => insideRing(x, z, ring));
  return (Math.round(Math.sqrt(distanceSquared) * 10) / 10) * (onLand ? 1 : -1);
}

function makeGrid(step, sample) {
  const rows = [];
  for (let z = -EXTENT; z <= EXTENT; z += step) {
    const row = [];
    for (let x = -EXTENT; x <= EXTENT; x += step) {
      row.push(sample(x, z));
    }
    rows.push(row);
  }
  return { minX: -EXTENT, minZ: -EXTENT, step, rows };
}

async function build() {
  const source = fs.readFileSync(process.argv[2], 'utf8');
  const geometry = source.trimStart().startsWith('{') ? JSON.parse(source) : readGeometry(source);
  const hall = geometry.features.find((feature) => feature.properties.name === "Leader's Hall");
  if (!hall) {
    throw new Error('Original Hall F footprint is missing from the extract');
  }
  const frame = localFrame(polygonCentroid(hall.geometry.coordinates[0]));
  const coast = geometry.features
    .filter((feature) => feature.properties.natural === 'coastline')
    .map((feature) => feature.geometry.coordinates.map(frame.toLocal));
  const landRings = coastalLandRings(coast);
  const streams = geometry.features
    .filter((feature) => feature.properties.waterway === 'stream')
    .map((feature) => ({
      name: feature.properties.name || 'Mapped stream',
      points: feature.geometry.coordinates.map(frame.toLocal),
    }));
  const ponds = geometry.features
    .filter((feature) => feature.properties.natural === 'water')
    .map((feature) => feature.geometry.coordinates[0].map(frame.toLocal));
  const dem = await readElevationWindow(frame, process.argv[3]);
  const hallPoints = hall.geometry.coordinates[0].map(frame.toLocal);
  const westWallStart = hallPoints[3];
  const westWallEnd = hallPoints[4];
  const output = {
    source: {
      coastline: 'OpenStreetMap contributors / ODbL 1.0',
      elevation: 'NRCan MRDEM-30 DTM / Open Government Licence – Canada',
      elevationUrl: DEM_URL,
      elevationResolutionMetres: 30,
      resampledHeightStepMetres: HEIGHT_STEP,
      geometryInputSha256: crypto.createHash('sha256').update(source).digest('hex'),
      elevationSampleSha256: crypto
        .createHash('sha256')
        .update(JSON.stringify(dem.values))
        .digest('hex'),
      verticalDatum: 'CGVD2013',
      demWindow: dem.window,
    },
    frame: { origin: frame.origin, eastScale: frame.eastScale, northScale: frame.northScale },
    hallRotation: Math.atan2(westWallEnd[0] - westWallStart[0], westWallEnd[1] - westWallStart[1]),
    coast,
    streams,
    ponds,
    hallFootprint: hallPoints,
    heights: makeGrid(HEIGHT_STEP, (x, z) => sampleElevation(dem, frame.toGeographic(x, z))),
    shore: makeGrid(SHORE_STEP, (x, z) => nearestCoast(x, z, coast, landRings)),
  };
  const directory = path.join(__dirname, '../assets/terrain');
  fs.mkdirSync(directory, { recursive: true });
  const referencePath = path.join(directory, 'meadows-reference.geojson');
  if (path.resolve(process.argv[2]) !== referencePath) {
    fs.writeFileSync(referencePath, JSON.stringify(geometry, null, 2) + '\n');
  }
  const header =
    '/** Generated source data. Metres, +X east, +Z south; origin is the mapped Hall F centroid.\n * See README.md beside this file for accuracy, licensing, and rebuilding. */\n';
  fs.writeFileSync(
    path.join(directory, 'meadows-data.js'),
    header +
      '(function (root) {\n  const data = ' +
      JSON.stringify(output, null, 2) +
      ';\n' +
      '  if (typeof module !== "undefined") { module.exports = data; } else { root.VinlandMeadowsData = data; }\n' +
      '})(typeof window !== "undefined" ? window : globalThis);\n',
  );
  console.log(
    JSON.stringify({
      origin: frame.origin,
      hallRotation: output.hallRotation,
      elevationAtHall: sampleElevation(dem, frame.origin),
      coastlines: coast.length,
      streams: streams.length,
      heightGrid: output.heights.rows.length,
      shoreGrid: output.shore.rows.length,
    }),
  );
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
