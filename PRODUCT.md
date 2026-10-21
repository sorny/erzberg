# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences carry equal weight:

- **Pen-plotter and generative artists.** They take real terrain and make line
  art for paper. They tune marks, split the drawing into pen layers and export
  SVG.
- **Cartographers and GIS users.** They take a real DEM and want stylised relief
  with correct projections, survey vocabulary and true ground under every layer.

Both work at a desk, on a desktop browser, in long tuning sessions on one
terrain.

## Product Purpose

erzberg turns elevation data (PNG heightmap, GeoTIFF, fetched tiles or audio)
into 3D line art. The user composes draw modes, overlays and a frame, then
exports SVG for a plotter, STL for a printer or 4K PNG for a wall. Success is a
drawing that plots or prints without cleanup and reopens unchanged from its
preset.

## Positioning

- **Breadth of marks.** More than 60 draw modes from survey and engraving
  traditions (hachures, contours, Tanaka, hillshade, stipple, charts) stack in
  one composition, each with its own controls and ink.
- **Plot-ready SVG.** One Inkscape layer per pen and per vector layer, real
  `<text>`, 49 single-line fonts and an occluder that removes hidden lines. The
  file goes to the plotter as exported.

## Operating Context

- The panel is a 312 px shell: a 40 px stage rail plus a 272 px body. The rail
  holds the pipeline stages Terrain, Surface, Marks, Overlay, Frame and Output.
- Presets (65+ bundled, in `public/presets/`) are the entry point. Users pick a
  style, then tune it. A preset JSON, or a PNG or SVG that the app exported,
  restores the look.
- Output goes to other tools: Inkscape, plotter software, slicers. erzberg stops
  at the file.
- A command-line renderer (`npm run cli`) renders presets without the UI.

## Capabilities and Constraints

- **Desktop only.** No phone layout and no media queries.
- **Local first.** Files never leave the browser. No server, no account and no
  third-party request on load. Fetch, Vector Layers and Satellite contact a
  server only when the user presses their button.
- **No plotter code.** No G-code, HPGL or features that plotter tools own.
- **Presets reopen unchanged.** A render change to an existing setting needs a
  legacy switch, a `PRESET_FORMAT` bump and a migration.
- **Terminology.** Labels use GIS and survey terms (occluder, chainage, depth
  bias, azimuth). The plain explanation goes in the help text.
- Licence is MIT. This decision is final.

## Brand Commitments

- Name: **erzberg** (lowercase), after the Styrian ore mountain.
- Colours named iron, paper and ore. Ore is the one accent, and it means "on".
- Logo: `public/logo.svg`.
- Voice: plain, factual, short sentences. Docs state what exists and how to use
  it. Rationale and measurements go in `CHANGELOG.md`.

## Evidence on Hand

- Preset renders from the app's own PNG exporter: `docs/images/preset-*.png`.
- Sample heightmap: `public/Heightmap.png`. Data provenance:
  `public/PROVENANCE.md`.
- User guides in `docs/`. Release history in `CHANGELOG.md`.
- No testimonials, user counts or press exist. Do not invent them.

## Product Principles

1. The output file is the product. Every control serves what lands in the SVG,
   STL or PNG.
2. Respect the survey tradition. Use the field's names and get the geodesy
   right, or decline and say why.
3. Compose, do not configure. Each mark is an independent layer that stacks
   with the others.
4. A saved look is a promise. What a preset drew yesterday, it draws today.
5. Stop where other tools start. Hand off to plotter and print software.

## Accessibility & Inclusion

No fixed standard. Keep the current care: respect reduced motion, offer dark
and light themes, and keep keyboard undo and history.
