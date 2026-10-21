# North Atlantic basemap

`north-atlantic.svg` is built from Natural Earth's **1:50m land** polygons. It uses
real coastlines and islands, with no modern national borders. It is bundled so
the game works offline through `file://`.

- [Dataset and description](https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/)
- [Upstream GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_land.geojson)
- [Public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/)

The SVG's description records the SHA-256 of the downloaded source. The projection
is spherical Lambert conformal conic, with standard parallels at 50°N and 70°N,
central meridian 35°W, and origin 60°N. `atlantic-geography.js` supplies the same
projection for the base map, ports, routes, and estimated ship markers.

To rebuild after changing the projection, download the upstream GeoJSON and run:

```sh
node tools/build-atlantic-map.cjs /path/to/ne_50m_land.geojson
npx prettier --parser html --write assets/maps/north-atlantic.svg
```

The game itself does not run this tool or download data.

Port references:

- L'Anse aux Meadows: 51.5952777°N, 55.5330555°W, from
  [Parks Canada](https://parcs.canada.ca/).
- Brattahlíð / Qassiarsuk: approximately 61.15°N, 45.52°W, in the Eastern
  Settlement. This rounded village reference is distinct from the UNESCO property
  centroid. See [Visit Greenland](https://visitgreenland.com/destinations/qassiarsuk/)
  and [UNESCO's Kujataa maps](https://whc.unesco.org/en/list/1536/maps).
- Reykjavík: approximately 64.15°N, 21.94°W, a regional reference for southwest
  Iceland, not a claim about a specific historical trading berth.

The coastline is a **modern geographic reference**, not a reconstructed 1005 AD
shoreline. Small fjords and harbour approaches exceed this dataset's scale.
Sea corridors are indicative offshore waypoints; their distances are measured
segment by segment on a sphere. They are not documented medieval sailing tracks.
Ship positions are estimates from campaign progress, not observed coordinates.
Fictional local survey areas remain in the journey list rather than acquiring
invented geographic pins. Alternate campaign harbours use the Newfoundland
regional anchor and are labelled accordingly in the harbour details.
