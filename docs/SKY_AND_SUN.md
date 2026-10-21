# Sky, solar position and the campaign clock

The walking camera sees a procedural blue sky, soft clouds, twilight and a small
solar disc. The sun moves continuously with simulation time. District view retains
the existing black space beyond the map edge. No images, network requests or server
are needed. Arrow Up or dragging the camera upward can now reach almost the zenith,
so the high summer sun is visible.

## Position and size

`solar.js` computes solar declination, equation of time, orbital distance, azimuth
and elevation using the Meeus/NOAA century-based equations. The geographic origin
comes directly from the terrain's Hall F reference: approximately **51.59570° N,
55.53280° W**. East is world +X; north is −Z. The sun crosses the southern sky, with
higher summer and lower winter paths. It does not rise due east every day.

The clock is interpreted as **local mean solar time**, not UTC or modern
Newfoundland civil time. Solar noon differs slightly from 12:00 because of the
equation of time. The existing campaign calendar remains proleptic Gregorian,
including AD 1005; it is not silently reinterpreted as the historical Julian
calendar. The browser's time zone and daylight saving do not change the sun.

The calculation includes a standard atmospheric-refraction correction near the
horizon. This is an approximation: actual refraction and the visible terrain
horizon vary. It is not an exact historical astronomical ephemeris or a
reconstruction of weather at a particular minute in AD 1005.

The disc radius is `asin(695700 km / solar_distance_km)`, using the computed
Earth–Sun distance. Its diameter is approximately **0.52–0.54°**, slightly larger
in northern winter. Latitude determines the path, not an artificially larger sun.
The fragment shader measures angular separation for each camera ray. Zoom,
walking, aspect ratio and camera position cannot change the physical angle.
Faint surrounding glare is separate from the disc.

## Lighting and weather

`sky.js` owns sky presentation and editable colors. `world-expansion.js` points the
directional light along the same calculated direction; its shadow volume follows
the view. Water uses that direction for reflections. Direct sunlight stops below
the horizon. Rain, snow and gales mute the sun; clouds can cover its visible disc.
Clouds, sky colors, light intensity and haze are artistic approximations, not a
full atmospheric scattering or weather simulation.

The sky is drawn behind physical geometry, so roofs, walls and trees cover it.
It does not participate in selection, collision, map clipping or storage. Sky
resources are disposed when a world is replaced. The shader works with the existing
local Three.js build and has no downloaded textures.

Seasonal daylight hours in `Simulation.weather` now come from the same solar
geometry. Ambient audio and hay curing use the resulting sunrise/sunset times.
The daily event estimates use noon declination and a standard −0.833° geometric
horizon; they are approximate flat-horizon events, not measured local sunrise.
At 3× and 8× the same campaign clock drives the sun. Pausing stops its motion.
Existing saves need no new serialized fields.

## Sources and verification

- [NOAA solar calculation details](https://gml.noaa.gov/grad/solcalc/calcdetails.html)
  describes the Meeus basis, historical-date conventions and atmospheric refraction.
- [NOAA reference implementation](https://gml.noaa.gov/grad/solcalc/main.js)
  was independently evaluated to obtain the historical fixtures in `tests/solar.cjs`.
- [NASA Sun Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html)
  supplies the solar radius and observed angular-size range.
- [Reda and Andreas, Solar Position Algorithm](https://www.osti.gov/biblio/15003974)
  provides the modern comparison example used by the model tests. The game uses
  the shorter NOAA equations, not the full SPA implementation.

`npm test` includes historical reference positions, seasonal geometry, direction
vectors, angular size, daylight, save/load and polar numerical checks.
`npm run test:sky` measures actual rendered disc width at two camera fields of
view, checks camera-translation invariance, matching light/reflection directions,
geometry occlusion, day/night colors, storm dimming, black district edges and
network-free operation. `npm run test:weather` covers precipitation and fog
integration.
