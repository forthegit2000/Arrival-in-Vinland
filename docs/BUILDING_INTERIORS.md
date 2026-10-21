# Usable buildings

## Doors

Hall F and completed enclosed buildings start with closed doors. In walk mode,
approach a doorway and press **E** (or tap the walking action) to open it. Press
**E** again nearby to close it. A person in the doorway prevents closing. Closed
doors block walking; open leaves occupy physical space too. The camera respects
the leaves. A shut entrance stops its modeled daylight beam; hearth and
smoke-opening light continue independently.

Ordered workers open doors on their route and close them after passing. Doors
opened by the player stay open until closed. Open/closed states survive saves;
older saves start closed. Hall F's shared passages have one leaf each. Its open
boat shed stays open; sail and tent búðir use fabric leaves. Placement and joinery
are reconstruction choices, not claims of excavated door leaves at every opening.

`doors.js` owns saved targets and geometry. `door-controls.js` owns meshes,
collision indexes, interaction and worker passage. `npm run test:doors` checks
offline E controls, collision, saving, closing safety and entrance light.

## Rooms

Completed enclosed buildings have walls, a door opening and a level floor. The
same plan supplies the visible shell, collision shapes, furniture and indoor
stations. Buildings keep their saved rotation: doorways and destinations rotate
with them. Construction sites remain closed; a completed building becomes usable
on the next world sync. Gardens, charcoal clamps, wells and fenced enclosures
keep their outdoor roles rather than gaining imaginary rooms.

## Using them

- Select people and use **Move**, or right-click reachable interior ground with
  roofs cut away. Routes pass through the entrance instead of stopping at the
  outer footprint. Karlsefni can walk through the same doors.
- **Work → Crafting** uses indoor stations in a smithy or carpenter's hut when
  available. **Camp care** uses a care hut, byre or the restored Hall F kitchen.
  Outdoor camp/pit jobs remain available when no corresponding indoor workplace
  exists. Full indoor workplaces make additional workers wait; waiting earns no
  work output. The existing charcoal prerequisite for crafting still applies.
- Storage deliveries to a woodshed, storehouse or hay barn now unload **inside**.
  The original camp supply drop-off remains an outdoor alternative. Each store
  has a separate inventory and capacity; the top bar sums unreserved stock.
  Builders collect reserved materials and carry them to their construction site.
  See [physical storage](STORAGE.md) for hauling and consumption rules.
- **Shelter** sends selected people to reserved, reachable indoor places. It
  replaces their current order. Stop releases the place and leaves them idle.
  Workers with ongoing jobs return to shelter off duty and resume the same job
  at their next shift. People without orders do not start work or wander home.
- **H / Cutaway** exposes completed interiors in the district view. Walk mode
  keeps roofs, walls and tent fabric intact. The camera moves closer indoors,
  stays below sloping roofs and pulls forward to avoid walls and furniture.
- **F / Hearth** opens local fire tending and soup cooking. **G** takes wood
  from a nearby store. Fuel burns into embers, heats the room and stones, and
  changes the flame and light output. Hall F hearths work before restoration,
  with greater heat loss. See [hearth mechanics](HEARTHS.md) for the controls,
  fuel and cooking model.

Shelter reservations are limited by the building's existing berth allowance and
by physically clear places. A person must actually get inside to receive indoor
warmth. Tents provide modest protection, while insulated housing provides the
stronger winter benefit. Being assigned an unreachable shelter does not grant
warmth. Warmth is weighted by the seconds actually spent inside during each
hour. Fuel, food and water requirements still apply. Shelter reservations,
indoor jobs and positions survive saves; missing/ruined places are resolved again.

## Layout and navigation

`building-spaces.js` is the editable plan source for new buildings. Measurements
are metres in the building's local coordinates: +Z is the entrance end. Ordinary
entrances are 1.8 m wide, with thick turf wall segments and an overhead lintel.
Sleeping platforms, stores, stalls, benches and the boatyard hull have collision
shapes. A central route and doorway clearance remain usable. These are gameplay
interpretations, not archaeological floor plans for every building type.

Hall F retains its existing seven-part room model, including the three living
rooms, kitchen, two storerooms and open boat-repair shed. Its existing narrower
openings use fine navigation near the door, with connected routes through living
rooms to the western rooms. Sleeping platforms leave the side entrances clear;
stores are kept out of the doorway. Hearths, kitchen fixtures, barrels and the
repair hull remain obstacles. Props, berth placement and door details remain
interpretations of the existing scenario geometry.

`world-interiors.js` connects outdoor paths to entrances and then to finer indoor
paths. It handles work destinations, storage access, shelter reservations, floor
heights and cutaways. Fine navigation is used only where the coarse outdoor grid
cannot resolve a doorway. Hall F's narrow aisles also have room-local waypoints
so rotation cannot make a walkable gap disappear between grid cells. Long outdoor
approaches can join a short, finer route beside the boat shed. A short earthen
threshold blends an enclosed building's level floor into sloping terrain. Shelter
retries are limited to avoid repeatedly searching unavailable places every
simulation step.

The visible, smoothed walking pose remains separate from physical positions.
Wall cutaways never remove collisions. Work and shelter travel consume the same
real-time clock as harvesting; daytime is not advanced to make entry happen.

## Indoor camera and lighting

`interior-presentation.js` owns the close third-person camera, roof clearance,
camera-volume sweeps, room sky occlusion and a fixed pool of three local lights.
The camera uses the existing interpolated walking pose. Its desired position and
eased result are both constrained so the transition cannot pass through a roof.
Camera distance, shoulder offset and clearance are editable in that file.
Hall F's five internal doorway passages join its room camera regions and keep a
continuous floor height. Crossing or pausing in a passage retains indoor camera
distance; exterior entrances still switch back to the outdoor rig.

Closed turf rooms block the outdoor sun and most ambient sky light. Daylight
enters from the existing open doorway and an actual ridge aperture above a
hearth; its strength follows daylight and cloud/rain conditions. These portal
lights approximate bounced daylight rather than tracing light through every
opening. A shadowed, gently varying hearth light operates only while that fire
is burning. Interiors become dark at night with the hearth out. Exterior sunlight
remains separate. Roofs have timber linings and closed gable ends.

The current doors are open passages; there is no close-door interaction yet.
Oil lamps are not added without a lamp/fuel system. The renderer does not simulate
smoke transport, indoor air quality or lamp oil. Room temperatures are calculated
by the hearth model.

## Checks

`npm test` includes rotated wall/door geometry, berth clearances, save validation,
off-duty travel and person-specific warmth. `npm run test:interiors` checks actual
rotated entrances, walking routes, indoor delivery/work targets, Hall F rooms,
shelter and save/load through the offline Three.js world. The existing walking,
collision, selection and worker browser regressions cover the surrounding flows.
`npm run test:indoor-camera` covers camera rotation in Hall F and a rotated turf
dwelling, intact walk-view shells, daylight/night transitions, hearth switching,
fuel exhaustion, save/load and repeated weather/material refreshes.
