/** Offline solar geometry. Degrees externally; local world axes: east +X, south +Z. */
(function (root) {
  'use strict';

  const RAD = Math.PI / 180;
  const DAY_MS = 86400000;
  const AU_KM = 149597870.7;
  const SUN_RADIUS_KM = 695700;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const wrap = (degrees) => ((degrees % 360) + 360) % 360;
  const dayCache = new Map();
  const Meadows =
    typeof module !== 'undefined' ? require('./meadows-geography.js') : root.VinlandMeadows;
  const [longitude, latitude] = Meadows.toGeographic(0, 0);
  const LOCATION = Object.freeze({ latitude, longitude });

  // Meeus/NOAA century-based expressions, including changing obliquity and orbit.
  // Julian day comes from the full timestamp, with no 1901–2099 spreadsheet shortcut.
  function orbit(utcMilliseconds) {
    const julianDay = utcMilliseconds / DAY_MS + 2440587.5;
    const century = (julianDay - 2451545) / 36525;
    const meanLongitude = wrap(280.46646 + century * (36000.76983 + century * 0.0003032));
    const meanAnomaly = (357.52911 + century * (35999.05029 - century * 0.0001537)) * RAD;
    const eccentricity = 0.016708634 - century * (0.000042037 + century * 0.0000001267);
    const equationOfCenter =
      Math.sin(meanAnomaly) * (1.914602 - century * (0.004817 + century * 0.000014)) +
      Math.sin(2 * meanAnomaly) * (0.019993 - century * 0.000101) +
      Math.sin(3 * meanAnomaly) * 0.000289;
    const node = (125.04 - 1934.136 * century) * RAD;
    const apparentLongitude =
      (meanLongitude + equationOfCenter - 0.00569 - 0.00478 * Math.sin(node)) * RAD;
    const obliquitySeconds = 21.448 - century * (46.815 + century * (0.00059 - century * 0.001813));
    const obliquity = (23 + (26 + obliquitySeconds / 60) / 60 + 0.00256 * Math.cos(node)) * RAD;
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude));
    const tangentSquared = Math.tan(obliquity / 2) ** 2;
    const meanLongitudeRadians = meanLongitude * RAD;
    const equationOfTimeMinutes =
      (4 / RAD) *
      (tangentSquared * Math.sin(2 * meanLongitudeRadians) -
        2 * eccentricity * Math.sin(meanAnomaly) +
        4 *
          eccentricity *
          tangentSquared *
          Math.sin(meanAnomaly) *
          Math.cos(2 * meanLongitudeRadians) -
        0.5 * tangentSquared ** 2 * Math.sin(4 * meanLongitudeRadians) -
        1.25 * eccentricity ** 2 * Math.sin(2 * meanAnomaly));
    const distanceAU =
      (1.000001018 * (1 - eccentricity ** 2)) /
      (1 + eccentricity * Math.cos(meanAnomaly + equationOfCenter * RAD));
    return { declination, equationOfTimeMinutes, distanceAU };
  }

  // Standard-atmosphere correction, not a claim to reconstruct AD 1005 air pressure.
  function refractionDegrees(elevation) {
    if (elevation > 85 || elevation < -2) return 0;
    const tangent = Math.tan(elevation * RAD);
    if (elevation > 5)
      return (58.1 / tangent - 0.07 / tangent ** 3 + 0.000086 / tangent ** 5) / 3600;
    if (elevation > -0.575)
      return (
        (1735 +
          elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)))) /
        3600
      );
    return -20.774 / tangent / 3600;
  }

  function position(utcMilliseconds, location = LOCATION) {
    const solarOrbit = orbit(utcMilliseconds);
    const utcMinutes = (((utcMilliseconds % DAY_MS) + DAY_MS) % DAY_MS) / 60000;
    const hourAngle =
      (wrap((utcMinutes + solarOrbit.equationOfTimeMinutes + 4 * location.longitude) / 4) - 180) *
      RAD;
    const latitudeRadians = location.latitude * RAD;
    const { declination } = solarOrbit;
    const east = -Math.cos(declination) * Math.sin(hourAngle);
    const north =
      Math.cos(latitudeRadians) * Math.sin(declination) -
      Math.sin(latitudeRadians) * Math.cos(declination) * Math.cos(hourAngle);
    const up =
      Math.sin(latitudeRadians) * Math.sin(declination) +
      Math.cos(latitudeRadians) * Math.cos(declination) * Math.cos(hourAngle);
    const elevationDegrees = Math.asin(clamp(up, -1, 1)) / RAD;
    const apparentElevationDegrees = elevationDegrees + refractionDegrees(elevationDegrees);
    const azimuthDegrees = wrap(Math.atan2(east, north) / RAD);
    const altitude = apparentElevationDegrees * RAD;
    const azimuth = azimuthDegrees * RAD;
    const angularRadius = Math.asin(SUN_RADIUS_KM / (solarOrbit.distanceAU * AU_KM));
    return {
      ...solarOrbit,
      elevationDegrees,
      apparentElevationDegrees,
      azimuthDegrees,
      angularRadius,
      angularDiameterDegrees: (2 * angularRadius) / RAD,
      direction: {
        x: Math.cos(altitude) * Math.sin(azimuth),
        y: Math.sin(altitude),
        z: -Math.cos(altitude) * Math.cos(azimuth),
      },
    };
  }

  // The displayed campaign clock is LOCAL MEAN solar time, without modern DST.
  // Dates retain the existing game's proleptic Gregorian calendar.
  function localTimestamp(date, hour, location = LOCATION) {
    return date.getTime() + (hour - location.longitude / 15) * 3600000;
  }
  function forSimulation(simulation) {
    return position(localTimestamp(simulation.date, simulation.hour));
  }

  function daylight(date, location = LOCATION) {
    const key = date.getTime() + ':' + location.latitude + ':' + location.longitude;
    if (dayCache.has(key)) return dayCache.get(key);
    const noon = orbit(localTimestamp(date, 12, location));
    const latitudeRadians = location.latitude * RAD;
    const horizonCosine =
      (Math.sin(-0.833 * RAD) - Math.sin(latitudeRadians) * Math.sin(noon.declination)) /
      (Math.cos(latitudeRadians) * Math.cos(noon.declination));
    const halfDayHours = Math.acos(clamp(horizonCosine, -1, 1)) / RAD / 15;
    const noonHour = 12 - noon.equationOfTimeMinutes / 60;
    const result = {
      hours: halfDayHours * 2,
      sunriseHour: noonHour - halfDayHours,
      sunsetHour: noonHour + halfDayHours,
    };
    if (dayCache.size >= 400) dayCache.clear();
    dayCache.set(key, result);
    return result;
  }

  const api = { LOCATION, position, forSimulation, localTimestamp, daylight, refractionDegrees };
  if (typeof module !== 'undefined') module.exports = api;
  else root.VinlandSolar = api;
})(typeof window === 'undefined' ? globalThis : window);
