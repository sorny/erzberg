# Pens: brief (shape, not built)

Status: plan only, 2026-10-21. Nothing in this brief changes how a plate renders.
Assumptions that were not confirmed with the user are marked *(assumed)*.

## Job and audience

- **Who:** the pen-plotter artist from PRODUCT.md. They prepare a multi-pen SVG
  and must know, before they export, which pen draws which mark.
- **Mode:** Operate. The panel is a tool. Precision outranks expression.
- **Problem:** today the pens are a result, not a control.
  - A line mode writes one Inkscape layer (`svgExport.js` `penLayer(modeId, …)`).
  - An area mode writes one layer per ink (`…-ink-NN`).
  - Form, Class and Plate sources write one layer per class.
  - The standing line counts inks from the `color*` keys only
    (`buildPlateLine`). It does not count gradient sources.
  - Preflight is the only exact pen count (`plot.pens`).

## Outcome

- In any open mode, the artist can read the mode's pens in one line.
- From the standing line, the artist can open one list of every ink and the
  marks that use it.
- The count in that list is the count that the SVG will have.

## Direction

- **Pen row:** the first row of the Line style fold, and its shut readout.
  - It shows one swatch per pen, the layer name as the SVG writes it
    (`Contours`, `Land cover · ink 03`), and a count.
  - For a gradient source on a line mode, it states the truth: one layer, many
    colours. It names the fix (*Banded*, or Line colour), and does not hide the
    problem.
- **Ink list:** a disclosure under the standing line, opened by "N inks".
  - One row per ink: the swatch, the hex, and the marks that use it.
  - It is read-only in v1 *(assumed)*. Recolouring stays in each mode.
- **One source of truth:** a pure function `pensOf(style, cover, vectorLayers)` in
  `src/utils/`. It returns the layers that `svgExport` would write, without
  geometry. `buildPlateLine`, the Pen row and the ink list all read it.
  A unit test holds it against `plot.pens` for every bundled preset.

## Scope and boundaries

- No change to render output, to SVG layer grouping or to presets. So the
  feature needs no `PRESET_FORMAT` bump. If a later step changes how a gradient
  is grouped into layers, that step needs a legacy switch, a migration, and a
  before/after render of the bundled presets.
- No plotter features: no pen-tool mapping, no pen order, no G-code.
- The ink list does not merge pens. Two marks in the same hex stay two layers
  when the SVG writes two layers.

## States and ranges

- 0 marks: the list says so.
- 1 to 3 inks is typical. Landforms adds 10, Watershed adds one per basin, and
  land cover adds one per class. The list must stay usable at 30 or more rows:
  it must scroll, and it must group rows by mark *(assumed)*.
- Pen counts that only Preflight can know (for example the Watershed basins) show
  as "counted at Preflight", not as a guess.

## Open decisions (do not invent)

1. Is the ink list read-only, or can a swatch recolour every mark that shares it?
2. Does a gradient source on a line mode stay one layer? Splitting it per band is
   a render change, so it needs the preset rule above.
3. Do vector layers and text join the same list, or does the list show marks only?
