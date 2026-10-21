# L'Anse aux Meadows geographic terrain

This folder contains the offline geographic reference for the original settlement.
It replaces the former sine-wave coastline and invented radial hills. The renderer,
walking checks, construction checks, water shader, and minimap use the same reference.
The `bay` and `estuary` campaign sites remain fictional procedural terrain.

The terrain tile is **2,160 × 2,160 metres**, centred on Hall F. The minimap,
overview camera, clipping planes, sea and cut edge share those bounds. The tile
has four-metre ground mesh spacing throughout, with the same source sampling at
the edges as near camp. The extra area uses additional cached NRCan samples.
The tile extends 1,080 m from Hall F in each direction, giving nearby coastal
headlands more clearance from the cut edge. Vegetation and rock counts scale
with tile area to retain the previous detail density.

Woodland patches, birch, ground cover and rocks are distributed over the full
tile. Habitat rules leave shores, wet ground and the occupied camp open; they
are visual approximations, not a surveyed reconstruction of medieval vegetation.
The black space and exposed tile sides are deliberately game-like boundaries.

## Coordinates and accuracy

The origin is the area centroid of the mapped **original Leader's Hall / Hall F**,
OSM way 1449963746, approximately 51.595699°N, 55.532804°W. It is not the modern
reconstructed hall north of the archaeological remains. Local coordinates are
metres: +X east, +Z south, with no horizontal or vertical exaggeration. The hall
orientation follows the mapped west wall, about 23.5° west of south.

The coastline, Black Duck Brook, other mapped stream centrelines, and ponds come
from a local OpenStreetMap extract. Source vertices are retained in
`meadows-reference.geojson`. The 4 m signed-distance grid in `meadows-data.js`
samples these coastlines for consistent GPU water, land checks, and mesh placement.
Connected OSM ways determine land polygons; the distance to the nearest coast
sets the distance magnitude. Open mainland chains close outside the tile, so
their endpoints must be beyond its bounds. This avoids artificial triangular
land/sea seams at bends and disconnected way endpoints.
That grid spacing **does not imply a 4 m source survey or 4 m elevation accuracy**.
OSM geometry is mapped reference data, not a certified archaeological survey.

Ground elevations come from NRCan's **MRDEM-30 DTM**, with 30 m source pixels in
EPSG:3979 and heights referenced to CGVD2013. The Canadian STAC catalogue returned
no covering HRDEM LiDAR or 1 m / 2 m mosaic item for the site when checked. The
ground grid is resampled to 20 m for interpolation; it adds no new source detail.
The sampled elevation at Hall F is about 4.47 m. Coastal mixed pixels taper over
the last 6 m to the separately mapped sea edge; hills are not exaggerated or
replaced with procedural noise.

These are **modern geographic references**, not a reconstructed AD 1005 shoreline,
tidal model, or archaeological excavation surface. No measured bathymetry is
included: the underwater apron is modeled. Stream widths use a 2.4 m visual
estimate around mapped centrelines. Vegetation, landing supplies, tent placements,
camp paths, and grazing remain gameplay representations. Anchorage positions are
derived from the local shoreline and checked to be offshore, not claimed as
recovered historical moorings.

## Sources and licensing

- Geometry: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  The OSM-derived reference geometry and shore-distance grid are distributed under
  ODbL 1.0. The expanded API query is
  `https://api.openstreetmap.org/api/0.6/map?bbox=-55.553,51.584,-55.512,51.608`.
- Elevation: [NRCan MRDEM-30 collection](https://datacube.services.geo.ca/stac/api/collections/mrdem-30),
  [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
  The collection describes its source datasets and terrain model derivation.
  The source COG is
  `https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif`.
- Orientation/context checks:
  [Parks Canada site map](https://parks.canada.ca/lhn-nhs/nl/meadows/visit/cartes-maps)
  and [Parks Canada archaeological survey map archive](https://canadianmysteries.ca/sites/vinland/archives/map/indexen.html).
  These maps were consulted, not copied into the game.

The game provides map attribution and source/licence links under
**Help → Sources & licences**, accessible from the cogwheel game menu.
Geometry-input and elevation-window hashes are embedded in the generated data.
`meadows-elevation-window.json` preserves the small sampled COG
window with its original projection and pixel resolution for reproducibility.

## Rebuilding with JavaScript

The game needs no tools or network access to use these files. To regenerate the
data using the checked-in reference and elevation window:

```sh
npm ci
node tools/build-meadows-terrain.cjs assets/terrain/meadows-reference.geojson assets/terrain/meadows-elevation-window.json
npx prettier --write assets/terrain/meadows-data.js
```

The optional developer dependencies `geotiff` and `proj4` are used only by this
builder. To read a newer elevation window, supply a new cache filename instead;
the builder uses HTTP range reads, never downloads the entire Canada-wide COG,
and fails if the projection or elevation coverage does not match expectations.
Runtime sampling lives in `meadows-geography.js`; keep render, walking, building,
and water-mask changes consistent there.
