# Hearths and cooking

In walk view, approach a store and press **G** to take 2 kg of firewood. Carry it
to a hearth and press **F**. Add 0.5 or 2 kg, then light the fire. The same panel
lets you refill it, smother the flames, hang or lift a pot, and serve soup. Time
continues while the panel is open. The usual pause and 1×/3×/8× controls apply.

All four hearths in Hall F work before restoration. Unrepaired rooms lose more
heat. Finished longhouses, turf houses and care huts have their own hearths.
The old visual switches migrate to cold hearths; migration creates no fuel.

## Fuel and local supplies

Fuel comes from Karlsefni's hands or the hearth's own inventory, never directly
from a distant settlement store. A load has mass and wood moisture. Gathered
fresh wood starts at 50% moisture by wet mass; initial provisions are assumed
seasoned at 20%. Covered stocks slowly approach 20%, with faster seasoning in a
woodshed and slower drying below freezing. Exposed caches can rewet in rain.
Drying removes water mass while preserving dry wood.
Those drying times (45/90 days) are tunable gameplay estimates.

Select people in district view, choose **Work → Supply building**, then click
the relevant Hall F room or building to deliver wood, water and cooking
ingredients. Alternatively, keep workers selected and use the hearth panel's
supply button. Workers carry supplies; refuelling and lighting remain explicit
player actions. Loading a hearth moves wood out of inventory; combustion
records its consumption. Wood does not heat anyone just by being in storage.

Small hearths hold 5 kg; the main Hall F hearth and longhouses hold 8 kg. Greater
loads give larger flames up to a ventilation-limited output. They burn longer,
rather than generating unlimited heat. Cold ignition ramps up over two minutes;
very wet loads require dry wood mixed in or live embers. This assumes accessible
tinder/kindling and a successful lighting attempt, rather than simulating each
strike of a fire steel. Smothering stops the wood flames, but leaves embers and
hot stones that gradually cool. The model does not simulate building fires or
carbon monoxide.

## Heat and light

`hearths.js` owns the saved state and physical calculations. The shared clock
integrates combustion and heat in one-second steps; rendering never burns fuel.
Wood produces flame energy and charcoal; retained charcoal energy is released
only when embers burn. Damp wood has less useful energy and a lower burn rate.

Each hearth has room-air, turf-wall and stone thermal stores. Heat flows through
those stores and escapes through ventilation and the envelope. Restoration
reduces these losses. Personal warmth combines local room temperature, distance
from the radiant fire, wind shelter and a small, temporary warm-meal contribution.
Hourly health uses time-weighted comfort during physical play. These are lumped
heat balances, not a computational fluid dynamics or clothing physiology model.
Rooms do not exchange air through individually simulated door openings.

Flames, embers, logs, warm light, smoke and hearth ambience follow the saved fire
state. The room's walk-view light intensity follows output; cooling embers stay
dimly visible. Light-to-kilowatt scaling is an artistic calibration.

## Cooking

Choose fish-and-grain soup, meat-and-grain soup, or grain-and-plant pottage, with
2, 4 or 8 L water. Ingredient amounts scale with water. The ingredients and
water must be in that hearth's inventory and are transferred into the pot.
The recipes and their 10/30/15 minute simmer targets are gameplay interpretations,
not archaeologically established Hall F menus or universal cooking times.

The expedition is assumed to have cooking pots, hooks and portable stands;
these are reusable equipment, rather than iron consumed by each recipe.
The model heats water, food and a 2.5 kg iron pot. Frozen water must thaw first.
Near sea level the liquid boils at approximately 100 °C; excess captured energy
evaporates water instead of making the soup arbitrarily hotter. Cooking progress
slows below a simmer and requires reaching 95 °C. Firewood is required throughout
heating and simmering; it also heats the room. The fuel estimate includes surplus
open-fire power during simmering. Actual use is shown beside the pot and varies
with moisture, load, starting temperature and how long you leave it over the fire.

For example, the native test heats and cooks a 4 L fish soup in about 25 minutes
using roughly 1.8 kg of seasoned wood in the initial main-hall conditions.
This is a model calibration, not a historical measurement.

Lift the pot and cool below 65 °C before serving. A bowl transfers the pot's
actual calories and water to a nearby person, replacing subsequent camp ration
and drinking-water demand. Serving conserves nutrients. Warm meals briefly
contribute sensible heat. A dry pot scorches; soup held in the 5–60 °C band for
two cumulative hours spoils. Emptying the pot discards its remaining food.
This is a simplified food-spoilage mechanic, not a food-safety predictor.

## Constants and sources

Physical constants are grouped in `PHYSICS`; recipe quantities are in `RECIPES`.
Burn-rate limits, transfer fractions, ventilation and thermal masses are clearly
editable model assumptions. Airflow, log dimensions, smoke, lid position and real
cooking vessels can produce large differences that this model cannot resolve.

- [FAO, Unified Bioenergy Terminology](https://www.fao.org/4/j4504e/j4504e08.htm):
  dry wood net calorific value about 18.5 MJ/kg and the effect of fuel moisture.
  The model uses `18.5 × (1 − moisture) − 2.44 × moisture` MJ/kg wet wood.
- [FAO, Measuring cooking fuel economy](https://www.fao.org/4/Q1085e/q1085e0b.htm):
  energy and mass accounting for fuel, cooking vessels and water. Water heat
  capacity is 4.18 kJ/kg/K. Fuel demand includes vessel heating and evaporation.
- [FAO, Sustainable Forest Management Toolbox: Wood Energy](https://www.fao.org/sustainable-forest-management/toolbox/modules/wood-energy/in-more-depth/en/):
  low open-fire cooking efficiencies motivate a 15% transfer assumption.
  This is not a measured efficiency for this particular reconstructed hearth.
- [NIST, Thermodynamic Properties of Water](https://www.nist.gov/srd/nistir-5078):
  boiling and phase-change properties. The model uses approximately 2257 kJ/kg
  vaporisation at atmospheric boiling, and 334 kJ/kg fusion near freezing.

Other estimates: charcoal 32 MJ/kg, 12% char yield from dry wood, 90% effective
combustion efficiency, 35% room capture and 8% stone capture. Pot capture is a
separate 15%; all remaining combustion heat escapes. Food heat capacity is
3.5 kJ/kg/K and iron 0.46 kJ/kg/K. These simplified values are not archaeological
measurements. The room-loss coefficients are in `stepFire`; comfort is in
`comfort`; wood seasoning is in `seasonWood`. UI styling is in `style/hearth.css`.

Run `npm test` for conservation, temperature, fuel, cooking, save and speed
checks; `npm run test:hearths` covers the offline browser controls and geometry.
