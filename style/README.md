# Editing the game styles

`index.html` loads the stylesheets directly in this order. No build step or server
is required.

| File                | Edit it for                                                          |
| ------------------- | -------------------------------------------------------------------- |
| `color-palette.css` | All CSS color values, grouped by purpose.                            |
| `base.css`          | Shared text sizes, layout variables, buttons, forms, and meters.     |
| `hud.css`           | Resource bar, bottom console, minimap, calendar, and work queue.     |
| `construction.css`  | Build tabs, illustrated buttons, and construction cost details.      |
| `workers.css`       | Worker actions and selection marquee.                                |
| `viewport.css`      | World canvas, labels, camera buttons, inspector, and notifications.  |
| `windows.css`       | Management window frame, title bar, tabs, and scrolling.             |
| `management.css`    | Page contents: forms, tables, charts, households, and campaign menu. |
| `menus.css`         | Start screen and centered game menus.                                |
| `walking.css`       | Walking console, hints, touch controls, and walking mode overrides.  |
| `hearth.css`        | Fire tending and cooking controls.                                   |
| `cheats.css`        | Testing panel and cheat indicator.                                   |
| `atlantic.css`      | Dedicated geographic screen, chart controls, harbours, and voyages.  |

Keep a component's responsive rules at the bottom of its own file. Walking mode
overrides follow the settlement components because they change the console and viewport together.
Shared controls load first so component rules can refine their appearance. The
Atlantic screen loads after these settlement styles and has its own layout.

All literal CSS colors belong in `color-palette.css`, which loads first. To change
a color manually, edit its named variable there. Component styles must use
`var(--name)` for every color, including gradients, shadows and fallbacks. Reuse a
variable when its purpose matches; add a descriptive palette entry for a new role.
`transparent` is also centralized; `currentColor` may follow inherited text color.

Run `npm run check:colors` to catch hardcoded colors, undefined variables or an
incorrect stylesheet loading order. This also runs as part of `npm run check`.
SVG artwork and Three.js material colors remain in their own asset/rendering files.

The `:root` section in `base.css` defines shared layout and text sizes. The
`--font-small`, `--font-label`, `--font-body`, `--font-heading`, `--font-stat`, and
`--font-title` sizes follow the game's text scale setting automatically.

To resize the build-button illustrations, edit these values in `.build-panel`
near the top of `construction.css`:

```css
--build-icon-width: 94px;
--build-icon-height: 76px;
--build-icon-gap: 4px;
```

The width and height are limits; illustrations shrink to fit shorter buttons.
The gap is shared by the title and person-hours label so their spacing stays equal.

Prefer a short, explicit component rule over a collection of utility classes.
Share a variable or selector group when the values have the same purpose. Similar
colors or dimensions alone do not mean two components must share every rule.

The top bar height is `--top-height` in `base.css` (44 px on desktop). Its mobile
override is in `hud.css`. Set `--resource-bar-width` in `.topbar` to adjust the
desktop resource section (currently 36vw). Resource icons are local SVG files in
`assets/resources/`; counters and the pointer tooltip are handled by `hud.js`.
