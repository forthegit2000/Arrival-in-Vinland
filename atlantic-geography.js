/**
 * Geographic reference for the Atlantic screen and its offline map-building tool.
 * Coordinates are [longitude, latitude] in degrees, never screen pixels.
 * Lambert conformal conic projection: standard parallels 50°N and 70°N.
 */
(function (root) {
  'use strict';

  const WIDTH = 1200;
  const HEIGHT = 840;
  const BOUNDS = { west: -85, east: 20, south: 44, north: 84 };
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const tangent = (latitude) => Math.tan(Math.PI / 4 + radians(latitude) / 2);
  const cone =
    Math.log(Math.cos(radians(50)) / Math.cos(radians(70))) / Math.log(tangent(70) / tangent(50));
  const factor = (Math.cos(radians(50)) * Math.pow(tangent(50), cone)) / cone;
  const originRadius = factor / Math.pow(tangent(60), cone);

  function rawProject([longitude, latitude]) {
    const radius = factor / Math.pow(tangent(latitude), cone);
    const angle = cone * radians(longitude + 35);
    return [radius * Math.sin(angle), radius * Math.cos(angle) - originRadius];
  }

  const boundary = [];
  for (let longitude = BOUNDS.west; longitude <= BOUNDS.east; longitude++) {
    boundary.push(rawProject([longitude, BOUNDS.south]), rawProject([longitude, BOUNDS.north]));
  }
  for (let latitude = BOUNDS.south; latitude <= BOUNDS.north; latitude++) {
    boundary.push(rawProject([BOUNDS.west, latitude]), rawProject([BOUNDS.east, latitude]));
  }
  const minX = Math.min(...boundary.map(([x]) => x));
  const maxX = Math.max(...boundary.map(([x]) => x));
  const minY = Math.min(...boundary.map(([, y]) => y));
  const maxY = Math.max(...boundary.map(([, y]) => y));
  const scale = Math.min((WIDTH - 64) / (maxX - minX), (HEIGHT - 64) / (maxY - minY));

  function project(coordinate) {
    const [x, y] = rawProject(coordinate);
    return [
      WIDTH / 2 + (x - (minX + maxX) / 2) * scale,
      HEIGHT / 2 + (y - (minY + maxY) / 2) * scale,
    ];
  }

  const PORTS = {
    home: {
      name: 'L’Anse aux Meadows',
      coordinate: [-55.5330555, 51.5952777],
      description: 'Northern Newfoundland · expedition harbour',
    },
    greenland: {
      name: 'Eastern Settlement',
      coordinate: [-45.52, 61.15],
      description: 'Southwest Greenland · Brattahlíð / Qassiarsuk reference',
    },
    iceland: {
      name: 'Iceland',
      coordinate: [-21.94, 64.15],
      description: 'Southwest Iceland · Reykjavík reference',
    },
  };

  // Indicative sea corridors, not documented tracks or a navigational chart.
  // Offshore waypoints keep crossings south of Greenland's landmass.
  const ROUTES = {
    greenland: [
      PORTS.home.coordinate,
      [-53, 54],
      [-50, 57],
      [-48, 59],
      [-46.8, 60],
      [-46.1, 60.6],
      PORTS.greenland.coordinate,
    ],
    iceland: [
      PORTS.home.coordinate,
      [-51, 55],
      [-46, 58],
      [-42, 59],
      [-36, 60],
      [-29, 62],
      [-23.5, 63.5],
      [-23, 64.1],
      PORTS.iceland.coordinate,
    ],
  };

  function distanceNm(start, end) {
    const latitudeDelta = radians(end[1] - start[1]);
    const longitudeDelta = radians(end[0] - start[0]);
    const haversine =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(radians(start[1])) * Math.cos(radians(end[1])) * Math.sin(longitudeDelta / 2) ** 2;
    return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
  }

  function routeDistance(route) {
    return route.slice(1).reduce((sum, point, index) => sum + distanceNm(route[index], point), 0);
  }

  function pointAlongRoute(route, fraction) {
    let remaining = routeDistance(route) * Math.max(0, Math.min(1, fraction));
    for (let index = 1; index < route.length; index++) {
      const start = route[index - 1];
      const end = route[index];
      const length = distanceNm(start, end);
      if (remaining <= length || index === route.length - 1) {
        const progress = length ? remaining / length : 0;
        return [
          start[0] + (end[0] - start[0]) * progress,
          start[1] + (end[1] - start[1]) * progress,
        ];
      }
      remaining -= length;
    }
    return route[0];
  }

  function path(coordinates, close = false) {
    return (
      coordinates
        .map((coordinate, index) => {
          const [x, y] = project(coordinate);
          return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ') + (close ? ' Z' : '')
    );
  }

  const geography = {
    WIDTH,
    HEIGHT,
    BOUNDS,
    PORTS,
    ROUTES,
    project,
    path,
    distanceNm,
    routeDistance,
    pointAlongRoute,
  };
  if (typeof module !== 'undefined') {
    module.exports = geography;
  } else {
    root.VinlandAtlanticGeography = geography;
  }
})(typeof window !== 'undefined' ? window : globalThis);
