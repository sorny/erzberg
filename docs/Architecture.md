# Architecture

How a file becomes a picture. Also, which changes are allowed to cost anything,
which matters as much.

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

Everything above the worker line is React. Everything inside the worker is plain
functions over typed arrays, with no framework and no DOM.

### Lettering, on the main thread

Four passes sit between the worker and the renderer. Every one of them adds
geometry that the worker cannot make:

```
  worker output ──> useVectorIcons   ──> useVectorLabels ──>
                    useContourLabels ──> useTextLayers    ──> lineGeo
```

They run here for one reason. A face is *fetched*, not computed, and the worker
has no fonts. `useVectorIcons` has a second reason: it flattens an SVG through
the geometry API of the browser, which needs a rendered document.

That placement is also what makes size, lift and orientation cost a frame rather
than a worker rebuild. It is what lets a mark follow the camera at all.

The four differ only in where the string and the anchor come from. An icon
*substitutes* for the dot it is drawn from. A vector label is appended beside the
mark, and reads its string from the feature. A contour label reads its string
from the elevation range, and its place from gaps that the worker left. A text
layer is told both. Free text is appended last, so it draws in front of the plate
that it annotates.

That split is deliberate. The builders are the part worth a direct test. Several
specs import them straight from the dev server. Those specs do not infer the
output of a builder from pixels.

---

## Undo

`hooks/useHistory.js` snapshots rather than records commands.

A command history wants every mutation site to describe itself, and there are
several hundred of them here: every slider, every colour well, every toggle in a
three-thousand-line panel. Nothing keeps that honest, and the first control that
somebody forgets to annotate is silently un-undoable.

A snapshot comes from the state itself, so a control cannot opt out of it by
being written carelessly. It is affordable because everything tracked is already
immutable. The panel replaces `style` rather than mutating it, so a snapshot is a
list of references and not a copy. The tracked list is the four parameter
objects, both gradients, the text layers, the vector layers and the vector
sources.

Two details carry the design:

- **A drag is one step.** Changes that arrive within `coalesceMs` of the last one
  belong to the same gesture and do not push again. The entry already on the
  stack is the state from before the gesture began, which is the one to go back
  to.
- **A restore is recognised by identity, not by a flag.** The effect compares the
  incoming values against the snapshot that the last undo applied. A flag has
  timing in it, and both ways of clearing one are wrong: cleared on a microtask
  it is gone before React runs the effect, so the restore records as a fresh edit
  and clears the redo stack. Cleared by the effect, it never clears at all when a
  restore happens to change nothing.

## State: three homes, on purpose

| Where | What lives there | Why |
|---|---|---|
| **Zustand** (`store/useStore.js`) | The raster: source pixels, mask and dimensions. The Edit Mode clip. The derived raster, after the clip. GeoTIFF metadata, the overlay texture, the vector sources, the painted masks, the land cover plate and any fetched satellite imagery | These are large buffers that many unrelated components read. One selector per field. Thus a load of a texture does not re-render the terrain hook |
| **React state** (`App.jsx`) | Every parameter you can tune: `terrain`, `style`, `points` and `view`, seeded from `src/defaults.js` | They change constantly during a drag, and they belong to the render tree. Outside the store, they keep the store writes rare. The defaults live in their own module, so the preset randomiser can use them without an import of the root component |
| **Refs** | Camera echoes, in-flight worker bookkeeping, the Edit Mode drag | These values change per frame. They must never trigger a render |

The store holds the raster twice. `src*` holds it as loaded. The derived raster
is what everything downstream reads. See [Edit Mode](Edit-Mode.md) for the
reason.

---

## What costs what

One rule governs this: use the *cheapest mechanism that can express a change*.
There are three tiers, from the most expensive to the least.

**Tier 1. Geometry rebuild, with a worker round-trip.** This covers anything
that moves a vertex. Resolution, blur and levels do this. So do the elevation
scale, the elevation cuts, the jitter and the mirroring. So does the spacing,
angle or threshold of every draw mode. The gradient stops also do, because the
app bakes them into the vertex colours of a line.

`GEOMETRY_KEYS` in `src/params.js` states this set. It is the authority. It
comes from `defaults.js` and nobody writes it out. Thus it cannot fall behind
the parameter space that it describes.

Vector layers sit in this tier only for what moves their geometry, through
`layerBuildKey`. That covers the visibility of a layer, the area fill, and which
features are hidden. Their colour, weight, opacity and dash sit in tier 2. This
is the whole reason the layer panel feels live. You recolour a list of twenty
OSM layers constantly, and each recolour must not rebuild every draw mode.

**Tier 2. Re-render only, through GPU uniforms.** This tier covers:

- The weight, opacity and dash pattern of a line.
- The colour of a vector layer, and the colour and opacity of its area fill.
- The feature highlight and the terrain fill colour.
- Hillshade, slope shading, water, aspect, AO and the raw terrain view.

`layerStyle(id, p)` resolves these per layer at render time, and the surface
shader resolves the rest. Thus a drag of any of them never enters the worker.

There are two deliberate exceptions, argued at `RENDER_SIDE` in `src/params.js`.
`needsSurfaceShading` is one: the app builds no normals and no UVs when no fill
layer will use them. `depthOcclusion` is the other, because the occlusion
curtains are geometry.

**Tier 3. Nothing at all.** The renderer uses `frameloop="demand"`. It draws a
frame only when something invalidates it. A camera interaction moves the camera
directly and mirrors into React state on a throttled trailing tick. Thus an
orbit does not re-render the sidebar 60 times a second.

One thing runs per frame on purpose: the murmuration
([docs](Murmurations.md)). It is a CPU flock, stepped in `useFrame`, which then
calls `invalidate()` to keep the demand loop alive. `showPoints` gates it, for
the same reason that it gates the hologram clock. A field that is hidden and
still animated keeps asking for frames. It pins the renderer at 60 fps to draw
nothing.

---

## The worker contract

- **The worker caches the raster.** The raster is by far the largest thing in
  the payload. An 8k GeoTIFF is a `Float32Array` of 256 MB. It also does not
  change when a slider moves. Thus the main thread sends the pixels only when
  the loaded file changes, or when the clip changes. Every other build carries
  the params object alone.
- **The worker caches the vector sources the same way.** The reason is sharper
  here: an OSM fetch over an alpine tile is millions of coordinates. The worker
  caches their *output* as well, keyed on the params that affect the drape. On a
  cache hit the reply omits `vectorGeo` completely. The main thread then keeps
  the arrays that it already holds. It must keep them, because the worker
  transferred them out and no longer owns them. A `null` value cannot be told
  apart from "this raster has no vector layers", so the key is absent instead.
- **The worker caches the cover plate too**, for the raster's reason rather than
  the vectors': it is a byte per source pixel, and a style slider does not change
  what the ground is. `null` is a meaningful value on this key — it is how the
  main thread says the plate was unloaded — so the message carries the key
  explicitly and `undefined` is what means "unchanged". A new raster orphans the
  plate, and the worker drops it without being told.

  The *alignment* happens on the main thread, not here, because it depends on
  the extent and the dimensions rather than on any parameter. It is derived
  rather than stored: an Edit Mode crop changes the raster under the plate, and
  a plate flattened onto the old dimensions at load time would go quietly inert
  the moment that happened — the picture stays plausible and is simply no longer
  stencilled, which is the worst way for it to fail.
- **And the mask planes**, on the same terms again: a byte per source pixel
  each, replaced only when one is painted, imported or removed. They are cropped
  in `derive()` alongside the pixels rather than re-authored when the clip moves,
  because they are drawn against the *source* raster — a clip can be cleared at
  any time and a mask authored against one would be the wrong size the moment it
  was.
- **Results come back as transferables.** Thus the main thread never copies the
  output of a rebuild. This includes the surface normals.
- **The app coalesces requests. It does not cancel them.** When builds arrive
  faster than they complete, the app queues the newest request and drops the
  rest.

  A cancel of each superseded build was catastrophic under a continuous stream.
  Soundscapes streamed at 30/s into builds of 44 ms and completed 0.2 builds per
  second. A terminate is the only way to interrupt a synchronous worker, and it
  also destroys the cached raster. The app now terminates a build only when that
  build is an outlier against the *measured* recent cadence.
- **Generation counters** (`_gen`) discard a result whose request is superseded.
  Thus a slow build cannot overwrite a newer one.

---

## Rendering

`HeightmapLines` draws one `Line2` or `LineSegments2` per layer. With
hypsometric tinting on, it uses per-vertex colours.

`SurfaceMesh` carries all the fill and overlay work in one shader. The
hypsometric ramp, hillshade, slope, aspect, sky-view-factor AO, water and the
raw terrain view are branches inside that shader. They are not separate passes.
Hillshade can also ray-march its cast shadows.

**Ghost occlusion** is why the line art reads as three-dimensional. Each segment
also generates an invisible curtain mesh that writes depth. Thus a line is
occluded by other lines and by the terrain. It does not float over them. The app
can draw the hidden segments in their own colour, which gives an X-ray effect.

**Viewport aids** are the elevation-profile section and its pins, in
`ProfileOverlay`. They live in the scene graph and not in the DOM, because they
must sit on the terrain in three dimensions.

That puts them in front of one exporter. SVG and STL read worker geometry and
cannot see them. The PNG capture renders the scene itself and can. The aids
carry `userData.viewportOnly`, and that pass hides them. The DOM-based frame
overlay gets the same bargain for free.

`ProfileOverlay` also owns `uvToWorld`, the inverse of the UV mapping of the
surface mesh. It is the one place that turns a raycast hit back into a grid
position and an elevation.

---

## Presets

A preset is a JSON blob of `{ style, points, gradientStops, bgGradientStops }`.
Presets live in `public/presets/` and `manifest.json` lists them. The app
fetches them at startup.

The *session* is those four fields plus `terrain` and `view`.
`utils/session.js` writes all six to `localStorage` on a debounce. It seeds
React state from them at mount.

The debounce has a ceiling as well as a delay. Auto-rotate syncs the camera into
`view` every 150 ms, and a plain trailing debounce reschedules for ever against
that. A stored set that matches the defaults reads as no session. A load of the
sample plate sets `terrain.resolution`, and without that rule the app writes a
session on every untouched visit.

The raster is not in the session. It can be a typed array of 256 MB against a
synchronous string store of about 5 MB. `zoom`, the pans and
`terrain.resolution` are not in it either. All of those describe the loaded
image and not the look. The app applies them to a raster that they were never
measured against, which is wrong.

`applyPreset` in `Sidebar.jsx` spreads a preset over the current state. It
leaves out `terrain` and `view` on purpose. Resolution, zoom and pan describe
the loaded raster and not the look.

A saved preset also carries `vectorStyles`. That field holds the styling of the
vector layers and nothing else.

The app strips `hidden` along with the identity fields. `hidden` holds feature
*indices*, and those mean nothing against a different fetch of the same area. To
re-apply them hides five arbitrary peaks and not the five that somebody chose. A
preset is a look and not a data set, so the coordinates stay out of it.

Re-application matches on `bucket` and not on a layer id. Thus the palette of
last week lands on a fresh fetch of the same valley today. A preset written
before vector layers existed carries the old flat `*Gpx` params. The app still
honours those for GPX layers.

### A preset in every plate

Every PNG and every SVG the app exports carries the whole parameter set inside
it. `utils/presetFile.js` owns the shape, so the JSON file and the two containers
cannot drift into carrying different things.

- **PNG** — a `tEXt` chunk under the keyword `erzberg:preset`, spliced in after
  `IHDR` beside the OpenStreetMap credit that was already there.
- **SVG** — a comment above the first mark. An editor shows it, and a plotter
  never draws it.

The payload is escaped to printable ASCII first. `tEXt` is Latin-1 and drops
anything it cannot represent, so a layer named in Greek would cost the whole
preset without a word. An XML comment ends at the first `-->`, so every `-` that
is followed by another becomes `\u002d` — in valid JSON two minus signs in a row
can only occur inside a string, where that escape is legal and the parser undoes
it.

The raster is not in it, and neither is the *name* of the raster. The promise at
the top of the README is that your files stay on your machine, and a plate posted
to a forum is that file leaving by another route. The payload has no field for a
filename, which is a stronger guarantee than remembering to strip one.

`format: 1` says what shape it is. A preset written before this existed has no
such field and is still a preset, so `parsePreset` tests for a parameter group
rather than for the announcement.

The app generates two things from that set. Nobody writes them by hand:

- **Thumbnails**, from `npm run thumbs`. There is one WebP per preset in
  `public/presets/thumbs/`. The app's own PNG exporter renders them, so no panel
  and no gizmo is in frame. A missing thumbnail falls back to a text button.
  Thus the sidebar never shows a broken image.
- **Rolled looks**, from `src/utils/presetGenetics.js`. `randomPreset(seed)`
  builds the same shape from a seeded RNG. It is a recipe and not a shuffle. It
  picks the surface first. It then draws modes against the `cost` budget in
  `drawModes.js`, then a palette, then one surface overlay at most. It checks
  the ink against the luminance of the background. The seed is what makes a roll
  reproducible, and that is why the history behind the ↩ button is a list of
  integers.

---

## Exporters

| Exporter | Reads | Note |
|---|---|---|
| SVG | `lineGeo` and `surfaceGeo` | Projects on the CPU with its own software Z-buffer. Thus the occlusion matches the viewport without a GPU readback. An area mode also ships `areas`, and exports as filled polygons |
| PNG / PNG α | The scene | Rendered offscreen into a 4× render target, then trimmed to the content through the alpha channel |
| STL | `surfaceGeo` | Computes its own facet normals. It must skip vertices parked at `NODATA_SENTINEL_Y`. Paced, with progress and cancel |
| Heightmap PNG | `terrain.grid` | The processed raster, after resolution and levels |
| WebM | The live canvas | `MediaRecorder` on the canvas stream, with the ODbL credit spliced into the Matroska container |
| Profile SVG | `profileData` | Written from the same `chartGeometry()` that the popup draws, at export size and in an ink-on-paper palette |

Every exporter reads the *derived* terrain. Thus the features upstream of it
need no support in any exporter. Edit Mode clips, erosion, the mirror and
soundscapes are all upstream of it.

### Preflight is the export

The stated audience of this tool is a pen plotter, and until v1.13 nothing said
what a plot would cost. Two numbers decide whether a plot takes twenty minutes
or ninety: the ink laid down, which the drawing fixes, and the distance the
carriage covers between strokes with the pen in the air.

*Preflight* runs `exportSVG` with `measureOnly: true`. It builds the whole file
and writes none of it.

That is deliberate and it is not wasteful. The only way to know what a plot costs
is to measure the file the plotter will be given — after the occlusion walk has
cut the strokes and the paper frame has clipped them, and after `joinRuns` has
folded the two-point pieces back into whole pen strokes. Anything cheaper is a
guess about a different drawing.

The numbers are cleared whenever `lineGeo` or `view` changes identity. A figure
that describes a plate you are no longer looking at is worse than no figure,
because it looks exactly like one that does.

### Pen order

`utils/penRoute.js` re-orders the strokes inside a pen layer by greedy nearest
neighbour over their endpoints, against a uniform grid sized for about one
endpoint per cell. Each step takes the nearest unvisited endpoint and draws that
stroke from it, so a stroke whose tail is nearer is drawn backwards.

The ring search stops one ring after it has a candidate: a ring at Chebyshev
distance $k$ cannot hold anything closer than $(k-1)\cdot\text{cell}$. That is
what makes it near-linear. Measured on 40 000 synthetic strokes, the travel falls
from 26.6 M px to 67 k px in 37 ms. On the sample plate the pen-up travel falls
from 52.4 m to 1.4 m.

Two limits are structural rather than cautious:

- **Filled areas are never re-ordered.** An area layer's paint order decides what
  covers what, and re-ordering it puts a lake on top of the contours that should
  cross it.
- **The switch is off by default.** Where two strokes of *different* colours
  cross, the order decides which ink is on top — on screen and on paper alike. It
  is the user's decision, and the preflight prints what it would save so the
  decision is informed.

### The area modes export filled polygons

Indexed, Mineral and Watershed paint blocks of colour, and a fill is not a
stroke. They used to leave as unordered boundary edges: enough to look at, and
nothing to plot, because an editor had no closed shape to select.

The `lids` mesh is the wrong input, because a triangle soup has no outline. So
`fillCells` also ships the lattice it painted. That is one entry per cell, with
the ink and the height. `utils/areaRings.js` then walks it into closed rings by
boundary following. The exporter writes one `<path>` per ink, each in its own
Inkscape pen layer, and drops that mode's line layer: a traced ring is the same
boundary edges in order, so writing both puts the geometry in the file twice.

Three parts of this live where they do for a reason:

- **The lattice is built in the worker**, beside the fills it describes, and its
  arrays ride the same transfer list.
- **The ring walk is in the exporter**, not in the worker, because the depth test
  that decides which cells to hand it needs the camera.
- **The clip is a polygon clip**, not the segment clip the lines use. Cutting a
  filled area edge by edge leaves the shape open and the paint runs out of it.

The vector layers' own area fills are still not exported. Those arrive as
triangles with no ring topology, which is the problem this solves for the draw
modes and does not solve for them.

### An ink is not the number it was written as

The `<Canvas>` comes from React Three Fiber, which gives it ACES filmic tone
mapping and an sRGB output encode. `App.jsx` overrides neither, so every fragment
the renderer draws passes through both on its way to a pixel.

The SVG exporter wrote the raw number, so the file and the viewport disagreed.
They disagreed most where a colour was bright and saturated, because that is
where the tone curve does the most work. Jet's top stop is `#800000`, and the
screen shows it as `#ca0006` — a deep red on screen, a brown in the file. Black
line art was never affected, because the curve maps 0 to 0, which is why this
stood for so long.

`screenInk` in `utils/svgExport.js` applies the same two steps. Two things were
measured rather than assumed, and both changed the answer:

- **A per-vertex colour and a flat material colour come out the same.** Under
  colour management a material colour arrives converted from sRGB, and the
  exporter then needs two transforms. That is not what happens here.
- **The background is not tone mapped.** It arrives through `setClearColor`
  rather than through a fragment shader. White paper stays `#ffffff` while white
  *geometry* renders `#e2e2e2`, so `bgColor` and the gradient stops are written
  raw.

`tests/unit/screen-ink.test.js` pins four pairs read off the running app, not
off the shader source.

### Every credit goes wherever its data does

OpenStreetMap data is ODbL. Section 4.3 attaches the notice to the *Produced
Work* and not to the application. A cover plate is CC-BY, which binds the same
way. Thus the question is never "is this loaded". The question is "is this in
the file".

`workAttribution()` in `attribution.js` answers that for every exporter, and it
is one module rather than a line at each export site because `osmFetch.js`
records how it went the other way: four exporters asked in four ways, and three
of them came to answer differently — the SVG credited while PNG, STL and WebM
silently did not.

It asks two things. OpenStreetMap features count when a layer carrying them is
*visible*. A cover plate counts when the Land cover mode inks it, or when any
other layer carries a class mask — a masked layer is shaped by the plate, its
marks stop where a class stops, and that is derivation just as surely. A loaded
plate that nothing draws from earns no credit, for the same reason a hidden
layer does not.

Each format takes the credit where the format provides for one:

- The SVG takes an XML comment.
- The PNG takes a `tEXt` chunk after `IHDR`.
- The binary STL takes its 80-byte header.
- The WebM takes a Matroska `Tags` element.

The app draws nothing into the picture. A credit burned into the pixels is a
change to the artwork. A licence obligation does not get to make that change for
the user.

Two of the four are narrower than the rest, on purpose.

The STL **plate** is the terrain surface and never contains OSM data. Thus only
the ribbons file gets the credit. It gets the credit only when a layer that
contributed a ribbon came from OpenStreetMap. That is not the same as an OSM
layer being visible. Ribbons default to GPX, and they reach an OSM layer only
when somebody switches one on.

The WebM carries a spoken notice as well as a written one. `ffprobe` reads a
Matroska tag. Very little that a viewer opens reads one.

The WebM credit needed measurement. Chrome writes the Segment with an unknown
size, as live recording requires. Thus nothing records a length that an
insertion invalidates.

That also means a demuxer has no length to seek against and no SeekHead to
consult. It parses header elements only until the first Cluster. A `Tags`
element appended to the end of the file is well-formed Matroska that **nothing
reads**. ffprobe reported no tag at all until the element moved ahead of the
first Cluster. A notice that nothing reads is worse than no notice, because it
looks like somebody met the obligation.

### The SVG and STL exporters pace themselves

These two run long enough to matter, and both are pure CPU. The SVG exporter
runs a software Z-buffer plus an occlusion walk that samples each segment up to
64 times. The STL exporter writes a few hundred thousand triangles, one float at
a time. As a single block, either one gives the browser a tab to offer to kill.

Both now hand the main thread back about every 24 ms, through the shared pacer
in `utils/pacing.js`. They report how far along they are. They also ask whether
the user has given up.

These are the measured times on the default plate. Neither exporter is slower
overall:

| Exporter | Before | After |
|---|---|---|
| SVG | 242 ms | 39 ms |
| STL, at the finest resolution | 122 ms | 47 ms |

They share one overlay and one export slot. They claim the slot through a ref
and not through state. A state updater runs on the next render. Thus two
triggers in the same tick both find the slot empty and both start.

Two things about the pacing are easy to get wrong, and both were wrong first:

- **`scheduler.yield()` is not the right primitive**, although it is the modern
  one. It resumes the caller as a continuation, *ahead of rendering*. Thus the
  work interleaves but the frame never lands. Measured: an export paced only
  through it still froze the page for 121 ms at a stretch. A `MessageChannel`
  message is an ordinary task boundary, and the browser paints across it. That
  gives 39 ms.
- **A time budget is kept only as finely as you check it.** A check of the clock
  on every 256th item sounds thrifty. Then 256 segments at 64 samples each turn
  out to be 100 ms, and a budget of 24 ms produces stalls of 122 ms. Thus the
  pacer splits in two. `due()` is cheap and synchronous, and you can ask it on
  nearly every iteration. `yield()` is async and allocates only when it yields.

The flock loops stay unpaced, on purpose. They read the *live* particle buffers.
A pause mid-pass splices two different moments of the animation into one
picture.

---

## Adding things

### A stencil

Both of them are already wired. `maskedTerrain` in `geometryBuilders.js` folds
two sources of thinning into a layer's `gridMask` — the cover class selection
and the union of its painted masks — and every builder already gates on that
mask, because a GeoTIFF with a void in it has always been possible.

A third source would be a third `continue` in the same loop and nothing else.

### A surface overlay that is not a fill

`hasFillLayer` decides whether the surface mesh is *drawn* and
`needsSurfaceShading` whether it is built with normals and UVs. Anything painted
by the surface shader has to appear in both, and the satellite drape is the case
that proves why: with neither flag set it put a texture on a mesh nobody could
see, and with only the first it would have sampled `vUv` on a mesh that had
none — one flat colour over the whole terrain.

### A draw mode that reads land cover

Nothing. Every builder already gates on `gridMask`, because a GeoTIFF with a
void in it has always been possible, so a class filter is the same question
asked of a mask with more zeros in it. `maskedTerrain` in `geometryBuilders.js`
shallow-clones the terrain with a thinned mask and hands that to the builder;
the builder never learns land cover exists. See
[docs/Land-Cover.md](Land-Cover.md#how-masking-works) for why only `gridMask` is
rebuilt and the frame — `halfW`, `minElev`, `maxSlope` — is not.

A mode that wants to *ink* from the plate rather than be stencilled by it reads
`terrain.gridClass` and `terrain.classColors`, both of which `buildTerrain`
carries onto the grid with the same subsample the elevation took.

### A draw mode

1. Write a builder in `geometryBuilders.js`. It returns `{ positions, colors }`.
   For separate pens, return an object of *sub-layers* instead. Contours ship
   their major and minor lines this way.
2. Register the builder in `MODES_CONFIG`, inside `buildLineGeometry`.
3. Add a `layerStyle` case for each sub-layer.
4. Add the params of the mode to `STYLE_DEF` in `src/defaults.js`.
5. Add an entry in `src/utils/drawModes.js`. This entry is what teaches the
   randomiser that the mode exists.
6. Add a `<Section>` in `Sidebar.jsx`.
7. Add a mark in `panel/modeMarks.jsx`. Draw it at 22×13. Draw the defining
   gesture of the mode and not a picture of terrain.
8. Add a line in `SECTION_TERMS`. See "A panel section" below.

**The rebuild dependency list is no longer a step.** It was a step once, and to
forget it was the classic bug: the control moved and nothing happened.
`src/params.js` now derives the rebuild key from `defaults.js`. Thus the params
of a new mode are covered the moment that they exist.

Two quieter traps replaced that one step. Both now fail at module load, so
nobody has to discover them:

- The app builds the key by *excluding* the render-side params by regex. Several
  of those patterns are unanchored prefixes: `fill`, `point`, `pan`, `rotation`,
  `frame` and `texture`. A geometry param named `fillTruss` or `rotationBitplane`
  matches one, gets classified as render-side, and never enters the key.
  `params.js` now cross-checks every mode-suffixed key against the registry in
  `drawModes.js`. It throws at import and names the offender.
- `geometryKey` builds a *string*. Thus a non-scalar default stringifies to
  `[object Object]`, and the key goes blind to every edit inside it. An array of
  band gains does this. So does a list of light positions. This is why
  `gradientStops` sits in `GEOMETRY_NON_SCALAR`, where the app depends on it by
  identity. A non-scalar default that is not declared there now throws at import
  too. Give the array flat names, such as `gain0Bandsplit` to `gain5Bandsplit`,
  or declare it.

### A button

Use `Btn` from `panel/ui.jsx`. `variant` carries the look: `quiet`, `ghost`,
`primary` or `toggle`. `style` carries the geometry, which is genuinely per row.

Do not re-specify the background, the colour and the border by hand. That is how
the panel came to hold four button radii.

### A label face

An outline face comes from `scripts/build-font.js`. The app samples it at
runtime.

A single-line face comes from `scripts/build-single-line-fonts.js`. The app does
*not* sample it. These faces arrive pre-flattened. Every `M` in a stroke font is
the pen that lifts, and a sampler must guess at what the data states outright.

Both kinds live in one key space. A stroke face sits behind an `sl:` prefix.
Thus "which faces does this scene need" stays one set.

### A colour

1. Add the colour to `RAW` in `panel/ui.jsx`.
2. Publish it in the `:root` block beside the others.
3. Export it as a `var()` reference.

Use `HEX` only for a consumer that a custom property cannot serve. A 2D canvas
is one such consumer. A value that needs an alpha suffix appended is another.

### A panel section

Add the title of the section, and the words that it must answer to, in
`SECTION_TERMS` in `panel/sectionTerms.js`. `panel.spec.js` counts the rendered
sections against that index. Thus an entry with no section fails there, and so
does a section with no entry. Neither goes unnoticed.

The index is stated and not scraped from the rendered tree. The parameters of a
mode mount only once that mode is on. A section that you cannot find while it is
switched off is unfindable exactly when you look for it.

### A surface overlay

An overlay is a branch in the `SurfaceMesh` shader plus a uniform. Name it in
`RENDER_SIDE` in `src/params.js`. The app builds the rebuild key by exclusion
now. Thus an overlay left out of that list rebuilds all the geometry every time
its colour moves.

### A CRS

Add one entry to the table in `geoCoords.js`. That entry reaches the renderer,
the STL exporter and the sidebar together, because all three ask the same
classifier. See [Georeferencing](Georeferencing.md).

### A whole-track projection

Add a descriptor in `trackProjections.js` with a `build()` that returns
`{ pixels, width, height }`. The sidebar renders its parameter schema by itself.
See [Soundscapes](Soundscapes.md).

### A preset

1. Save a preset from the app.
2. Put the JSON in `public/presets/`.
3. Add the filename to `manifest.json`.
4. Run `npm run thumbs "Your Preset"`. The preset then arrives with a picture
   and not with a fallback label.

### An OSM category

Add an entry to `OSM_CATEGORIES` in `utils/osmCategories.js`. The entry holds
the Overpass selectors, a `bucketOf`, the labels and the default styles. The
`bucketOf` must claim *only* the tag values that the category lists.

Nothing else changes. The checklist, the layer naming, the drape and every
exporter read the catalogue.

A `bucketOf` that claims too much steals from the categories after it. It does
this in silence, and it gives the layer a name that looks correct. This is why
they all go through `pick(value, allowed)`.

---

## Testing

The suite runs Playwright against a live dev server, in headless Chrome with
WebGL. The things worth an assertion exist only in a real renderer. These are
those things: what the worker produced, what the SVG exporter drew, and whether
the drawing buffer was clamped in silence. `HEADED=1` puts the window back when
you want to watch a spec drive the app.

The specs import the pure modules through the dev server with `page.evaluate`
and test them directly. This is how the terrain, projection and clip maths get
checked without an inference from pixels.

Several specs also parse the `[Benchmark]` and `[Perf]` console lines. Those log
statements are load-bearing. They are not debug leftovers.
