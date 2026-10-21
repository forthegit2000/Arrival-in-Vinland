# Knarr fixed structure

`knarr.glb` is a standard glTF 2.0 binary model in metres: Y up, bow at negative Z.
It contains the fixed clinker hull, keel, stems, frames, floorboards, mast, yard
and steering oar. Two batched meshes use vertex colours rather than external
textures. Sails, ropes, cargo and livestock fittings remain game-controlled.

`knarr-data.js` contains the **identical GLB bytes** as base64. It permits classic
script loading when `index.html` is opened directly through `file://`. There are
no runtime network requests, decoder downloads or server requirements.
`knarr-model.js` reads only the small, uncompressed subset emitted by this tool;
it is intentionally not a general-purpose glTF importer. All four ships share
geometry and materials, while their obstacle arrays and movable parts are separate.

## Editing and regeneration

The readable authoring source is `tools/build-knarr.cjs`. Run:

```sh
node tools/build-knarr.cjs
```

This rebuilds both assets together. Edit `keelHeight`, `hullPoint`, strake count,
stations, colours and fittings there. No model construction runs during gameplay.
The GLB can also be inspected in a glTF viewer or imported into a modelling tool.
External edits to the GLB alone do not update its offline companion or the
authoring source; arbitrary third-party GLBs are not supported by this reader.

## Historical reference and limits

Original game artwork, using the Viking Ship Museum's descriptions of
[Skuldelev 1](https://www.vikingeskibsmuseet.dk/en/visit-the-museum/exhibitions/the-five-viking-ships/skuldelev-1)
and [its reconstruction Ottar](https://www.vikingeskibsmuseet.dk/en/professions/the-boat-collection/ottar/)
as references for a full-bodied clinker-built cargo vessel. No third-party model
or museum image is included.

This is a plausible game interpretation, not a measured archaeological replica
or a reconstruction of Karlsefni's undocumented ships. Skuldelev 1 dates to
around 1030, later than the game's opening. Ottar is 15.8 m by 4.8 m; the game
retains its existing 17.5 m by 5.2 m envelope so passenger seats, cargo, livestock
and boarding continue to work. Likewise, the usable cargo floor remains at
1.16 m in game coordinates. The archaeological vessel's fore/aft decks and open
central holds are not fully recreated; changing walking levels and cargo-space
simulation is outside this visual asset change.

The closed bottom and keel share one longitudinal curve. The narrow keel projects
only about 0.15 m below the planking and rises into the stems. Scantlings, hull
curves, colours and fittings are modelling choices, not surveyed dimensions.

## Validation

Run `node tests/knarr-browser.cjs`, `npm run test:walking` and
`npm run test:arrival` with the installed Chromium executable if needed. The
knarr test checks the matching GLB bytes, finite geometry, the closed bottom,
keel projection, shared resources, boarding dimensions and isolated rendering.
It writes side, underside and three-quarter previews to `/tmp`.
