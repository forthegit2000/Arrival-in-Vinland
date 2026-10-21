# Work timing audit

The simulation separates **person-hours of work**, **elapsed process time**, and
**travel/handling time**. More workers can help prepare a batch; they cannot make
fish dry instantly or make a charcoal charge cool ten times faster.

## Changes

| Previous behavior                                                          | Current behavior                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Tree-felling effort came from total recoverable wood volume                | Diameter/species determine cutting; clearing, limbing and cross-cutting are separate stages |
| Long identical chopping animation, including time when labor was suspended | Named activity stages; tool visible only during active axe work                             |
| Fishing/foraging waited for 10 kg before returning                         | Deliver 1 kg loads; unchanged catch/picking productivity                                    |
| Turf cutting and mowing had unusually slow single-stage estimates          | Explicit revised hand-tool estimates, with transport accounted separately                   |
| Hay could cure through rain and darkness                                   | Daylight drying, wet-weather setbacks and rewetting                                         |
| Charcoal appeared through an hourly conversion                             | Local wood charge, preparation, multi-day burn, cooling and unloading                       |
| Fish could become stockfish through an hourly conversion                   | Local fish, preparation, weeks of cold-air drying, weather risk and unloading               |
| A remote completed factory enabled unrelated workers                       | Workers must be assigned to the actual operational workplace                                |

## Editable estimates

Tree/field formulas and load sizes are in `work-timing.js`; weather, shifts and
handling are in `gathering.js`. [Gathering simulation](GATHERING_SIMULATION.md)
gives nominal cutting and carrying examples. These are estimates for hand tools,
not exact recovered Viking productivity.

`production-processes.js` owns batch rules. Charcoal uses 100–200 kg of local
firewood. Preparation takes `0.5 + input_kg / 50` person-hours; unloading takes
`input_kg / 100`. A 200 kg charge at 20% wet-basis moisture burns for an estimated
48 hours and cools for another 48. Output is 25% of the dry wood mass: **40 kg**.
Smaller charges scale elapsed time by the square root of their mass ratio; wetter
wood extends burning. These small-camp batch timings are modeling choices.
There is no detailed kiln airflow, tending or combustion chemistry simulation.

Stockfish uses 1–20 kg of local fresh fish. Preparation takes `input_kg / 10`
person-hours; taking down the fish takes `input_kg / 20`. Drying needs **28 equivalent
fair-weather days** at moderate wind. Rain or temperatures above 10°C stop drying;
freezing nearly stops it. Wind changes progress between half and one-and-a-half
nominal speed. Twenty-four cumulative warm hours spoil a drying batch. Unprepared
fish also spoils if abandoned. These are conservative game thresholds, not a food
safety model. The retained yield is 24% of fresh mass. Light smoking is not treated
as complete stockfish preservation.

Passive processes continue overnight. Stocks appear only after ordered workers
unload the finished batch. Building details show remaining labor or elapsed time.
No one is automatically recruited. Active batches and partial work survive saves.

## Evidence and its limits

- [Mathieu and Meyer, Comparing Axe Heads of Stone, Bronze, and Steel (1997)](https://experimentalarchaeology.wordpress.com/wp-content/uploads/2011/06/axe-head-vs-steele-experiments.pdf)
  supports treating tree diameter, wood type and cutting conditions separately.
  These experiments did not establish productivity for the game's crew or every
  Viking axe. The game's numerical formula is a calibration, not a fit presented
  as a measured archaeological law.
- [FAO logging unit-cost methodology](https://www.fao.org/4/T0579E/t0579e07.htm)
  separates felling, processing, extraction and transport. Its modern power-saw
  coefficients are not used as hand-axe cutting measurements.
- [FAO haymaking guidance](https://www.fao.org/4/x7660e/x7660e06.htm)
  distinguishes mowing, field curing and handling, with productivity varying by
  tool and ground. The rough-meadow rate and sixteen daylight hours are game
  estimates, not an attested Norse scythe rate or guaranteed drying duration.
- [FAO earth-mound charcoal methods](https://www.fao.org/4/x5328e/x5328e07.htm)
  discusses wood moisture, conversion yield and cooling over days. Large-kiln
  schedules are not directly transplanted onto a small camp charge.
- [Stockfish Journey, Iceland](https://stockfishjourney.is/iceland/)
  describes drying over four to eight weeks. The model uses the lower end as
  equivalent fair-weather exposure, with poor weather extending calendar time.
- [Icelandic living heritage: hardfish and stockfish](https://lifandihefdir.is/lifandi-hefdir/hardfish-and-stockfish-cultural-and-culinary-traditions-of-hardfish-and-stockfish/)
  describes the traditional cold-air preservation process and its cultural context.

Building labor remains an explicit planning estimate with crew caps. Water care,
animal yields and ironworking remain partly aggregate. This audit does not claim
that all human work has been recreated exactly or that every building was present
at L'Anse aux Meadows.

## Verification

`tests/work-timing.cjs` covers diameter/species scaling, sequential tree stages,
shared material, tool pauses, shifts, storms, earlier food deliveries, migration,
local batch inputs, passive delays, spoilage and saved state. Existing gathering
tests cover hauling, interruption, field drying and equal simulation timelines
at 1×/3×/8×. `npm run test:timing` exercises actual workplace buttons, batch
progress, tool visibility and offline local-file operation in Chromium.
