# Architecture

How a file becomes a picture, and which changes are allowed to cost anything.

---

## The pipeline

```
  file ──> loader ──> STORE (source raster)
    OSM / GeoJSON / GPX ──> STORE (vector sources)
    .landcover.json     ──> STORE (cover plate, in its own grid)
    Mask Studio / import──> STORE (mask planes, on the SOURCE raster)
    Satellite fetch     ──> STORE (imagery, on the raster's grid)
                        │
                        ├── Edit Mode clip ──> derived raster + cropped masks
                        ├── alignCover()   ──> plate on the raster's grid
                        │
                        ▼
                  useTerrainGeometry            ← the only bridge to the worker
                        │  postMessage({ pixels?, vectorData?, coverData?, maskData?, p })
                        ▼
  ┌──────────── geometry.worker ─────────────┐
  │  buildTerrain()       grid, slopes, bounds│
  │  buildLineGeometry()  every draw mode     │
  │  buildVectorGeometry() draped features    │
  │  buildSurfaceGeometry() fill / depth mesh │
  └───────────────────────────────────────────┘
                        │  transferables (zero-copy)
        ┌───────────────┼────────────────┬─────────────────┐
        ▼               ▼                ▼                 ▼
  HeightmapLines   SurfaceMesh    ParticleSystem      exporters
   (Line2 layers)   (shader)     (GPU holo / CPU    SVG · PNG · STL
                                   boids flock)
```

Everything above the worker is React. Everything inside the worker is plain
functions over typed arrays, with no framework and no DOM.

### Lettering, on the main thread

Four passes add geometry that the worker cannot make:

```
  worker output ──> useVectorIcons   ──> useVectorLabels ──>
                    useContourLabels ──> useTextLayers    ──> lineGeo
```

They run on the main thread because fonts are fetched and the worker has none.
`useVectorIcons` also flattens SVG through the browser's geometry API. As a
result, size, lift and orientation cost a frame, not a rebuild.

The four passes differ only in where the string and the anchor come from:

- An icon replaces the dot it is drawn from.
- A vector label reads its string from the feature.
- A contour label reads its value from the elevation, and its place from gaps
  that the worker left.
- A text layer is given both. It is appended last, so it draws in front.

---

## Undo

`hooks/useHistory.js` stores snapshots, not commands. A command history needs
every one of several hundred controls to describe itself, and a forgotten one is
silently un-undoable. A snapshot is taken from state, so no control can opt out.
It is cheap because all tracked state is immutable: a snapshot is a list of
references.

Tracked: the four parameter objects, both gradients, the text layers, the
vector layers and the vector sources.

- **A drag is one step.** Changes within `coalesceMs` of the last one belong to
  the same gesture and do not push again.
- **A restore is recognised by identity, not by a flag.** The effect compares
  incoming values with the snapshot the last undo applied. A flag has timing
  problems in both ways of clearing it.

## State: three homes

| Where | What | Why |
|---|---|---|
| **Zustand** (`store/useStore.js`) | The source raster, the Edit Mode clip, the derived raster, GeoTIFF metadata, the overlay texture, vector sources, painted masks, the cover plate and satellite imagery | Large buffers read by many components. One selector per field, so one load does not re-render unrelated hooks |
| **React state** (`App.jsx`) | Every tunable parameter: `terrain`, `style`, `points`, `view`, seeded from `src/defaults.js` | They change constantly during a drag and belong to the render tree |
| **Refs** | Camera echoes, worker bookkeeping, Edit Mode drags | They change per frame and must never render |

The store holds the raster twice: `src*` as loaded, and the derived raster that
everything downstream reads. See [Edit Mode](Edit-Mode.md).

---

## What costs what

Use the cheapest mechanism that can express a change. There are three tiers.

**Tier 1. Geometry rebuild, with a worker round-trip.** Anything that moves a
vertex: resolution, blur, levels, elevation scale and cuts, jitter, mirroring,
the spacing, angle or threshold of every mode, and the gradient stops (baked
into vertex colours).

`GEOMETRY_KEYS` in `src/params.js` is the authority for this set. It is derived
from `defaults.js`, so it cannot fall behind. Vector layers enter this tier only
through `layerBuildKey`: visibility, area fill and hidden features.

**Tier 2. Re-render only, through uniforms.** Line weight, opacity and dash,
vector layer colours and fills, the feature highlight, the terrain fill colour,
and all surface shading (hillshade, slope, water, aspect, AO, raw view).
`layerStyle(id, p)` resolves these per layer at render time.

Two exceptions are argued at `RENDER_SIDE` in `src/params.js`:
`needsSurfaceShading` (no normals or UVs without a fill layer) and
`depthOcclusion` (the curtains are geometry).

**Tier 3. Nothing.** The canvas uses `frameloop="demand"`. A camera drag moves
the camera directly and mirrors into React state on a throttled trailing tick.

The murmuration is the one thing that runs per frame on purpose. It steps in
`useFrame` and calls `invalidate()`. `showPoints` gates it, so a hidden flock
does not keep the renderer at 60 fps.

---

## The worker contract

- **The worker caches the raster.** An 8k GeoTIFF is 256 MB. The main thread
  sends pixels only when the file or the clip changes.
- **It caches vector sources**, and their draped output, keyed on the params
  that affect the drape. On a cache hit the reply omits `vectorGeo`. The key is
  absent, not `null`, because `null` means "no vector layers".
- **It caches the cover plate.** Here `null` means "unloaded", so `undefined`
  means "unchanged". A new raster drops the plate. The alignment runs on the main
  thread, derived on each change, so an Edit Mode crop cannot leave a stale plate.
- **It caches the mask planes.** They are cropped in `derive()` with the pixels,
  because they are drawn against the source raster.
- **Results come back as transferables**, including normals and a bounding
  sphere per mesh (`sphereOf`). Without the sphere, three.js walks every vertex
  on the main thread for the first frustum test after each rebuild.
- **Requests coalesce. They are not cancelled.** When builds arrive faster than
  they finish, the newest request waits and the rest are dropped. Cancelling
  each one meant nothing finished under a continuous stream, and terminating the
  worker loses its caches. A build is terminated only if it is an outlier
  against the measured cadence.
- **Generation counters** (`_gen`) discard stale results.

---

## Rendering

`HeightmapLines` draws one `Line2` or `LineSegments2` per layer, with
per-vertex colours when hypsometric tinting is on.

`SurfaceMesh` does all fill and overlay work in one shader. Hypsometric ramp,
hillshade (with optional ray-marched shadows), slope, aspect, AO, water and the
raw view are branches, not passes.

**Ghost occlusion.** Each segment also makes an invisible curtain that writes
depth, so lines hide other lines. Hidden segments can draw in their own colour.

**Viewport aids** (the profile line and pins in `ProfileOverlay`) live in the
scene graph. SVG and STL cannot see them. The PNG capture hides them through
`userData.viewportOnly`. `ProfileOverlay` also owns `uvToWorld`, which turns a
raycast hit into a grid position and elevation.

---

## Presets

A preset is `{ style, points, gradientStops, bgGradientStops }`. Presets live in
`public/presets/`, listed in `manifest.json`.

The **session** (`utils/session.js`) is those fields plus `terrain`, `view` and
`textLayers`. It is written to `localStorage` on a debounce with a ceiling, and
read once at mount. A stored set equal to the defaults reads as no session. The
raster, `zoom`, the pans and `terrain.resolution` are not stored, because they
describe the loaded image, not the look.

`applyPreset` in `Sidebar.jsx` leaves out `terrain` and `view` for the same
reason. A preset also carries `vectorStyles`, matched on `bucket`, so last
week's palette lands on a new fetch of the same valley. `hidden` is stripped,
because feature indices mean nothing against a different fetch.

### A preset in every plate

`utils/presetFile.js` owns the shape.

- **PNG**: a `tEXt` chunk `erzberg:preset` after `IHDR`.
- **SVG**: a comment above the first mark.

The payload is escaped to printable ASCII, because `tEXt` is Latin-1. Each `-`
followed by another becomes `-`, because `-->` ends an XML comment. The
payload has no field for the raster or its file name. `format: 1` marks the
shape. `parsePreset` tests for a parameter group, so older files still load.

Two things come from the preset set and are not written by hand:

- **Thumbnails** from `npm run thumbs`, one WebP per preset, rendered by the PNG
  exporter. A missing one falls back to a text button.
- **Rolled looks** from `randomPreset(seed)` in `presetGenetics.js`: surface
  first, then modes against the `cost` budget in `drawModes.js`, then a palette
  and at most one overlay, with an ink contrast check.

---

## Exporters

| Exporter | Reads | Note |
|---|---|---|
| SVG | `lineGeo`, `surfaceGeo` | CPU projection with a software Z-buffer, so occlusion matches the viewport without a GPU readback. Area modes export filled polygons |
| PNG / PNG α | The scene | Offscreen 4× render target, trimmed by alpha |
| STL | `surfaceGeo` | Own facet normals. Skips vertices at `NODATA_SENTINEL_Y`. Paced, with progress and cancel |
| Heightmap PNG | `terrain.grid` | After resolution and levels |
| WebM | The live canvas | `MediaRecorder`, with the ODbL credit spliced into the Matroska header |
| Profile SVG | `profileData` | The same `chartGeometry()` as the popup |

Every exporter reads the derived terrain, so upstream features (clip, erosion,
mirror, soundscapes) need no exporter support.

### Preflight

*Preflight* runs `exportSVG` with `measureOnly: true`. It builds the whole file
after occlusion, frame clip and `joinRuns`, and writes nothing. Anything cheaper
measures a different drawing. The figures clear when `lineGeo` or `view`
changes.

### Pen order

`utils/penRoute.js` orders strokes inside a pen layer by greedy nearest
neighbour on a uniform grid. A stroke whose far end is nearer is drawn
backwards. The ring search stops one ring after the first candidate, which
makes it near-linear: 40 000 strokes in 37 ms. On the sample plate, pen-up
travel falls from 52.4 m to 1.4 m.

- Filled areas are never re-ordered. Their paint order decides what covers what.
- The switch is off by default. Where two inks cross, order decides which is on
  top.

### Area modes export filled polygons

Indexed, Mineral, Land cover and Watershed paint blocks of colour. `fillCells`
ships the lattice it painted (ink and height per cell), and
`utils/areaRings.js` walks it into closed rings. The exporter writes one
`<path>` per ink in its own pen layer, and drops the mode's line layer.

- The lattice is built in the worker, next to the fills.
- The ring walk is in the exporter, because the depth test needs the camera.
- The clip is a polygon clip. A segment clip leaves shapes open.

Vector layer area fills are not exported. They are triangles with no ring
topology.

### Screen ink

The R3F canvas applies ACES filmic tone mapping and an sRGB encode. `screenInk`
in `utils/svgExport.js` applies the same two steps, so SVG colours match the
screen: Jet's `#800000` renders as `#ca0006`. Two facts were measured:

- Per-vertex and material colours come out the same.
- The background is not tone mapped (`setClearColor`), so `bgColor` and the
  gradient stops are written raw.

`tests/unit/screen-ink.test.js` pins four pairs read from the running app.

### Credits

`workAttribution()` in `attribution.js` decides which credits a file owes, for
every exporter. OSM counts when a layer with OSM features is visible. A cover
plate counts when the Land cover mode inks it or a layer carries a class mask.

| Format | Where the credit goes |
|---|---|
| SVG | XML comment |
| PNG | `tEXt` chunk after `IHDR` |
| STL | 80-byte header, ribbons file only, when an OSM layer made a ribbon |
| WebM | Matroska `Tags` before the first Cluster, plus a spoken notice |

Nothing is drawn into the picture. The WebM tag must precede the first Cluster:
Chrome writes the Segment with unknown size, so demuxers stop parsing headers
there, and a tag at the end is never read.

### Pacing

The SVG and STL exporters are long CPU jobs. Both yield about every 24 ms
through `utils/pacing.js`, report progress and check for cancel. On the default
plate the longest stall fell from 242 ms to 39 ms (SVG) and from 122 ms to
47 ms (STL).

- `scheduler.yield()` resumes before rendering, so the frame never lands. A
  `MessageChannel` task boundary lets the browser paint.
- `due()` is cheap and synchronous, so check it nearly every iteration. A clock
  check every 256 items gave 122 ms stalls.

The two exporters share one slot, claimed through a ref, so two triggers in one
tick cannot both start. The flock export is not paced, because it reads live
buffers.

---

## Adding things

### A stencil

`maskedTerrain` in `geometryBuilders.js` folds the cover class selection and the
layer's painted masks into its `gridMask`. Every builder already gates on that
mask. A third source is one more `continue` in the same loop.

### A surface overlay

An overlay is a shader branch plus a uniform in `SurfaceMesh`. Name its keys in
`RENDER_SIDE` in `src/params.js`, or its colour will rebuild all geometry.

If the shader paints it, it must appear in both `hasFillLayer` (is the mesh
drawn) and `needsSurfaceShading` (is it built with normals and UVs).

### A draw mode that reads land cover

Nothing to do for a stencil: `maskedTerrain` hands the builder a thinned mask.
To ink from the plate, read `terrain.gridClass` and `terrain.classColors`. See
[Land cover](Land-Cover.md#how-masking-works).

### A draw mode

1. Write a builder in `geometryBuilders.js` that returns `{ positions, colors }`,
   or an object of sub-layers for separate pens.
2. Register it in `MODES_CONFIG` in `buildLineGeometry`.
3. Add a `layerStyle` case for each sub-layer.
4. Add its params to `STYLE_DEF` in `src/defaults.js`.
5. Add an entry in `src/utils/drawModes.js`, so the randomiser knows it.
6. Add a `<Section>` in `Sidebar.jsx` in the Marks stage.
7. Add a 22×13 mark in `panel/modeMarks.jsx` that shows the mode's gesture.
8. Add a line in `SECTION_TERMS`.
9. Add a line in `PANEL_MODES` in `panel/sectionSummary.js`, and a family in
   `panel/markFamilies.js`.

Two optional parts:

- A builder can return `note`, a small object that rides on the layer to the
  panel. Viewshed returns the share in view, and Route returns its time.
- A mode that needs a point on the terrain adds its keys to `PICK_KEYS` in
  `App.jsx` and calls `onPick`. The click goes through the profile's raycast.

The rebuild key is derived, so it is not a step. Two traps fail at module load:

- Render-side params are excluded by regex, and some patterns are prefixes
  (`fill`, `point`, `pan`, `rotation`, `frame`, `texture`). `params.js`
  cross-checks mode-suffixed keys against `drawModes.js` and throws on a clash.
- `geometryKey` is a string, so a non-scalar default would read as
  `[object Object]`. Declare it in `GEOMETRY_NON_SCALAR` or use flat names such
  as `gain0Bandsplit`. An undeclared one throws.

### A panel section

Add it to these indexes:

| File | Answers |
|---|---|
| `panel/sectionTerms.js` | what the filter matches |
| `panel/sectionSummary.js` | what it says while shut |
| `panel/sectionParams.js` | what a reset puts back |
| `panel/stages.js` | which pane holds it (`STATED`) |
| `panel/markFamilies.js` | which family a mark is in |

All five are leaf modules with no React, so specs can check them against each
other. `panel.spec.js` counts rendered sections against `SECTION_TERMS`. A
section missing from `stages.js` renders in no pane. A draw mode needs no
`stages.js` entry, because `PANEL_MODES` puts it in Marks.

Keep parameter names out of comments above a `<Section>` tag.
`sectionParams.test.js` scopes a section from its tag to the next one, so such a
comment is credited to the section before it.

### A spec that reaches a control

The panel shows one pane at a time. Use `openStage`, `openMark` and `setMark`
from `tests/helpers.js`. A spec that finds a control by its own test id (for
example `export-svg`) must still open its stage.

### A button

Use `Btn` from `panel/ui.jsx`. `variant` sets the look (`quiet`, `ghost`,
`primary`, `toggle`). `style` sets only geometry.

### A colour

Add it to `RAW` in `panel/ui.jsx`, publish it in `:root`, and export it as a
`var()` reference. Use `HEX` only where a custom property cannot work, for
example a 2D canvas.

### A label face

Outline faces come from `scripts/build-font.js` and are sampled at runtime.
Single-line faces come from `scripts/build-single-line-fonts.js`, already
flattened. Both share one key space. Stroke faces use an `sl:` prefix.

### A CRS

Add one entry to the table in `geoCoords.js`. See
[Georeferencing](Georeferencing.md).

### A whole-track projection

Add a descriptor in `trackProjections.js` with a `build()` that returns
`{ pixels, width, height }`. See [Soundscapes](Soundscapes.md).

### A preset

1. Save a preset from the app.
2. Put the JSON in `public/presets/` and add it to `manifest.json`.
3. Run `npm run thumbs "Your Preset"`.

### An OSM category

Add an entry to `OSM_CATEGORIES` in `utils/osmCategories.js`: Overpass
selectors, a `bucketOf`, labels and default styles. The `bucketOf` must claim
only the listed tag values, through `pick(value, allowed)`. A greedy one steals
from later categories without an error.

---

## Testing

Playwright runs against a live dev server in headless Chrome with WebGL,
because the worker output, the SVG and the drawing buffer exist only in a real
renderer. Specs import pure modules through the dev server with
`page.evaluate`. Several specs parse `[Benchmark]` and `[Perf]` console lines,
so those logs are load-bearing.
