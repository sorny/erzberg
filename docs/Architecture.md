# Architecture

How a file becomes a picture, and — just as important — which changes are
allowed to cost anything.

---

## The pipeline

```
  file ──> loader ──> STORE (source raster)
    OSM / GeoJSON / GPX ──> STORE (vector sources)
                        │
                        ├── Edit Mode clip ──> derived raster
                        │
                        ▼
                  useTerrainGeometry            ← the only bridge to the worker
                        │  postMessage({ pixels?, vectorData?, p })
                        ▼
  ┌──────────── geometry.worker ─────────────┐
  │  buildTerrain()       grid, slopes, bounds│
  │  buildLineGeometry()  15 draw modes       │
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

Everything above the worker line is React; everything inside it is plain
functions over typed arrays, with no framework and no DOM. That split is
deliberate: the builders are the part worth testing directly, and several specs
import them straight from the dev server rather than inferring their output from
pixels.

---

## State: three homes, on purpose

| Where | What lives there | Why |
|---|---|---|
| **Zustand** (`store/useStore.js`) | The raster: source pixels + mask + dimensions, the Edit Mode clip, the derived (clipped) raster, GeoTIFF metadata, the overlay texture, and the vector sources | Large buffers that many unrelated components read. Selector-per-field, so loading a texture does not re-render the terrain hook. |
| **React state** (`App.jsx`) | Every tweakable parameter — `terrain`, `style`, `points`, `view`, seeded from `src/defaults.js` | They change constantly while dragging and belong to the render tree. Keeping them out of the store keeps store writes rare. The defaults live in their own module so the preset randomiser can build on them without importing the root component. |
| **Refs** | Camera echoes, in-flight worker bookkeeping, the Edit Mode drag | Values that change per frame and must never trigger a render. |

The store's raster is held twice: `src*` as loaded, and the derived raster that
everything downstream consumes. See [Edit Mode](Edit-Mode.md) for why.

---

## What costs what

The central rule is that the *cheapest mechanism that can express a change* is
the one used for it. Three tiers, from most to least expensive:

**1. Geometry rebuild (worker round-trip).** Anything that changes where a
vertex is: resolution, blur, levels, elevation scale and cuts, jitter, mirroring,
every draw mode's spacing/angle/threshold, and the gradient stops (baked into
line vertex colours). The dependency list in `useTerrainGeometry` is the
authoritative statement of this set.

Vector layers sit here only for what moves their geometry — layer visibility,
area fill, and which individual features are hidden — via `layerBuildKey`. Their
colour, weight, opacity and dash are tier 2, which is the whole reason the layer
panel feels live: a list of twenty OSM layers is something you recolour
constantly, and each recolour must not cost a rebuild of all fifteen draw
modes.

**2. Re-render only (GPU uniforms).** Line weight, opacity, dash pattern, a
vector layer's colour and its area fill colour/opacity, the feature highlight,
terrain fill colour, hillshade, slope shading, water, aspect, AO, raw terrain view. These are
resolved per layer at render time by `layerStyle(id, p)` and in the surface
shader, so dragging them never enters the worker. Two exceptions are deliberate
and documented at the dependency list: `needsSurfaceShading` (normals and UVs are
not built when no fill layer would use them) and `depthOcclusion` (occlusion
curtains are geometry).

**3. Nothing at all.** Rendering is `frameloop="demand"` — a frame is drawn only
when something invalidates it. Camera interaction moves the camera directly and
mirrors into React state on a throttled trailing tick, so orbiting does not
re-render the sidebar 60 times a second.

The one thing that deliberately runs per frame is the murmuration
([docs](Murmurations.md)) — a CPU flock stepped in `useFrame`, which then calls
`invalidate()` to keep the demand loop alive. It is gated on `showPoints` for the
same reason the hologram clock is: a hidden-but-animated field that keeps asking
for frames pins the renderer at 60 fps drawing nothing.

---

## The worker contract

- **The raster is cached worker-side.** It is by far the largest thing in the
  payload (an 8k GeoTIFF is a 256 MB `Float32Array`), and it does not change when
  a slider moves. The main thread sends pixels only when the loaded file — or the
  clip — actually changed; every other build carries just the params object.
- **Vector sources are cached the same way**, and for a sharper version of the
  same reason: an OSM fetch over an alpine tile is millions of coordinates.
  Their *output* is cached too, keyed on the params that actually affect draping,
  and on a cache hit the reply omits `vectorGeo` entirely — the main thread keeps
  the arrays it already holds, which it must, because they were transferred out
  of the worker and it no longer owns them. `null` would be indistinguishable
  from "this raster has no vector layers", so the key is absent rather than
  null.
- **Results come back as transferables**, so the main thread never copies a
  rebuild's output, including surface normals.
- **Requests are coalesced, not cancelled.** When builds arrive faster than they
  complete, the newest request is queued and the rest dropped. Cancelling each
  superseded build was catastrophic under a continuous stream — Soundscapes
  streaming at 30/s into 44 ms builds completed 0.2 builds per second, because
  terminating is the only way to interrupt a synchronous worker and it also
  destroys the cached raster. A build is now terminated only when it is an
  outlier against the *measured* recent cadence.
- **Generation counters** (`_gen`) discard results whose request has been
  superseded, so a slow build cannot overwrite a newer one.

---

## Rendering

`HeightmapLines` draws one `Line2`/`LineSegments2` per layer, with per-vertex
colours when hypsometric tinting is on. `SurfaceMesh` carries all the fill and
overlay work in a single shader — hypsometric ramp, hillshade with optional
ray-marched cast shadows, slope, aspect, sky-view-factor AO, water and the raw
terrain view are branches within it, not separate passes.

**Ghost occlusion** is why the line art reads as three-dimensional: each segment
also generates an invisible curtain mesh writing depth, so lines are occluded by
lines and by terrain rather than floating over it. Hidden segments can be drawn
in their own colour for an X-ray effect.

**Viewport aids** — the elevation-profile section and its pins (`ProfileOverlay`)
— are in the scene graph rather than the DOM, because they have to sit on the
terrain in three dimensions. That puts them in front of one exporter: SVG and STL
read worker geometry and cannot see them, but the PNG capture renders the scene
itself. They carry `userData.viewportOnly` and that pass hides them, the same
bargain the DOM-based frame overlay gets for free. `ProfileOverlay` also owns
`uvToWorld`, the inverse of the surface mesh's UV mapping — the one place that
turns a raycast hit back into a grid position and an elevation.

---

## Presets

A preset is a JSON blob of `{ style, points, gradientStops, bgGradientStops }`
in `public/presets/`, listed in `manifest.json` and fetched at startup.
The *session* is those four plus `terrain` and `view`: `utils/session.js`
debounce-writes all six to `localStorage` and seeds React state from them at
mount. The debounce has a ceiling as well as a delay — auto-rotate syncs the
camera into `view` every 150 ms, which a plain trailing debounce reschedules
forever — and a stored set that matches the defaults reads as no session, since
loading the sample plate sets `terrain.resolution` and would otherwise write one
on every untouched visit. The raster is not among them — it can be a 256 MB typed array against a
synchronous ~5 MB string store — and neither are `zoom`, the pans or
`terrain.resolution`, all of which describe the loaded image rather than the look
and would be applied to a raster they were never measured against.

`applyPreset` in `Sidebar.jsx` spreads it over the current state — deliberately
*not* including `terrain` or `view`, because resolution, zoom and pan describe
the loaded raster rather than the look.

A saved preset also carries `vectorStyles` — the vector layers' styling and
nothing else. `hidden` is stripped along with the identity fields: it holds
feature *indices*, which mean nothing against a different fetch of the same area,
and re-applying them would hide five arbitrary peaks rather than the five that
were chosen. A preset is a look, not a data set, so the coordinates stay out of
it, and re-application matches on `bucket` rather than on layer id: last week's
palette lands on today's fresh fetch of the same valley. Presets written before
vector layers existed carry the old flat `*Gpx` params instead, and those are
still honoured for GPX layers.

Two things are generated from that set rather than written by hand:

- **Thumbnails** (`npm run thumbs`) — one WebP per preset in
  `public/presets/thumbs/`, rendered through the app's own PNG exporter so no
  panel or gizmo is in frame. A missing one falls back to a text button, so the
  sidebar never shows a broken image.
- **Rolled looks** (`src/utils/presetGenetics.js`) — `randomPreset(seed)` builds
  the same shape from a seeded RNG. It is a recipe, not a shuffle: surface first,
  then draw modes drawn against the `cost` budget in `drawModes.js`, then a
  palette, then at most one surface overlay, with the ink checked against the
  background's luminance. Being seeded is what makes a roll reproducible, which
  is why the history behind the ↩ button is a list of integers.

---

## Exporters

| Exporter | Reads | Note |
|---|---|---|
| SVG | `lineGeo` + `surfaceGeo` | Projects on the CPU with its own software Z-buffer, so occlusion matches the viewport without a GPU readback |
| PNG / PNG α | The scene | Rendered offscreen into a 4× render target, trimmed to content via the alpha channel |
| STL | `surfaceGeo` | Computes its own facet normals; must skip vertices parked at `NODATA_SENTINEL_Y`. Paced, with progress and cancel |
| Heightmap PNG | `terrain.grid` | The processed raster, after resolution and levels |
| WebM | The live canvas | `MediaRecorder` on the canvas stream |
| Profile SVG | `profileData` | Written from the same `chartGeometry()` the popup draws, at export size and in an ink-on-paper palette |

Because every exporter reads the *derived* terrain, features upstream of it —
Edit Mode clips, erosion, mirroring, soundscapes — need no exporter support.

### The SVG and STL exporters pace themselves

They are the two that run long enough to matter, and both are pure CPU: a
software Z-buffer plus an occlusion walk sampling each segment up to 64 times in
one case, a few hundred thousand triangles written a float at a time in the
other. Run as a single block, either is a tab the browser offers to kill. Both now
hand the main thread back roughly every 24 ms through the shared pacer in
`utils/pacing.js`, reporting how far along they are and checking whether the user
has given up. Measured on the default plate: SVG 242 ms → 39 ms, STL (at the
finest resolution) 122 ms → 47 ms, neither any slower overall.

They share one overlay and one export slot, claimed through a ref rather than
state — a state updater runs on the next render, so two triggers in the same tick
would both find the slot empty and both start.

Two things about that are easy to get wrong, and both were:

- **`scheduler.yield()` is not the right primitive**, though it is the modern one.
  It resumes the caller as a continuation, *ahead of rendering*, so the work
  interleaves but the frame never lands — measured, an export paced entirely
  through it still froze the page for 121 ms at a stretch. A `MessageChannel`
  message is an ordinary task boundary the browser will paint across: 39 ms.
- **A time budget is only kept as finely as it is checked.** Consulting the clock
  every 256th item sounds thrifty until 256 segments at 64 samples each turn out
  to be 100 ms, and a 24 ms budget produces 122 ms stalls. The pacer therefore
  splits in two — a cheap synchronous `due()` that can be asked on nearly every
  iteration, and an `async yield()` that allocates only when it actually yields.

The flock loops are deliberately left unpaced: they read the *live* particle
buffers, so pausing mid-pass would splice two different moments of the animation
into one picture.

---

## Adding things

- **A draw mode**: write a builder in `geometryBuilders.js` returning
  `{ id, positions, colors? }`, register it in `buildLineGeometry`, add its
  params to `STYLE_DEF` in `src/defaults.js`, an entry in
  `src/utils/drawModes.js` (which is what teaches the randomiser it exists), a
  `<Section>` in `Sidebar.jsx`, and its params to the dependency list in
  `useTerrainGeometry`. Forgetting the last step is the classic bug: the
  control moves and nothing happens. Two smaller ones go with the section: a
  mark in `panel/modeMarks.jsx`, drawn at 22×13 as the mode's defining gesture
  rather than a picture of terrain, and a line in `SECTION_TERMS` (below).
- **A button**: use `Btn` from `panel/ui.jsx` — `variant` carries the look
  (`quiet`, `ghost`, `primary`, `toggle`) and `style` carries the geometry, which
  is genuinely per-row. Do not re-specify background, colour and border by hand;
  that is how the panel came to hold four button radii.
- **A label face**: outline faces come from `scripts/build-font.js` and are
  sampled at runtime; single-line faces come from
  `scripts/build-single-line-fonts.js` and are *not* — they arrive pre-flattened,
  because every `M` in a stroke font is the pen lifting and the sampler would
  have to guess at what the data states outright. Both live in one key space,
  stroke faces behind an `sl:` prefix, so "which faces does this scene need"
  stays one set.
- **A colour**: add it to `RAW` in `panel/ui.jsx` and publish it in the `:root`
  block beside the others, then export it as a `var()` reference. Only reach for
  `HEX` if the consumer is a 2D canvas or needs to append an alpha suffix —
  a custom property cannot serve either.
- **A panel section**: add its title and the words it should answer to in
  `SECTION_TERMS` in `Sidebar.jsx`. The filter's index is stated rather than
  scraped from the rendered tree, because a mode's parameters only mount once
  the mode is on — a section that cannot be found while it is switched off is
  unfindable exactly when someone is looking for it.
- **A surface overlay**: it is a branch in the `SurfaceMesh` shader plus a
  uniform. Do not add it to the worker dependency list — that would make a
  colour change rebuild geometry.
- **A CRS**: one entry in the table in `geoCoords.js` reaches the renderer, the
  STL exporter and the sidebar together, because all three ask the same
  classifier. See [Georeferencing](Georeferencing.md).
- **A whole-track projection**: a descriptor in `trackProjections.js` with a
  `build()` returning `{ pixels, width, height }`. The sidebar renders its
  parameter schema automatically. See [Soundscapes](Soundscapes.md).
- **A preset**: save one from the app, drop the JSON in `public/presets/`, add
  the filename to `manifest.json`, and run `npm run thumbs "Your Preset"` so it
  arrives with a picture rather than a fallback label.
- **An OSM category**: add an entry to `OSM_CATEGORIES` in
  `utils/osmCategories.js` — Overpass selectors, a `bucketOf` that claims *only*
  the tag values the category lists, labels and default styles. Nothing else
  changes: the checklist, the layer naming, the draping and every exporter read
  the catalogue. A `bucketOf` that claims too much steals from the categories
  after it, silently and with a plausible-looking layer name, which is why they
  all go through `pick(value, allowed)`.

---

## Testing

Playwright against a live dev server in real Chrome with WebGL — the things
worth asserting (what the worker produced, what the SVG exporter drew, whether
the drawing buffer was silently clamped) only exist in a real renderer. Pure
modules are imported through the dev server with `page.evaluate` and tested
directly, which is how the terrain, projection and clip maths are checked
without inferring numbers from pixels. Several specs also parse `[Benchmark]`
and `[Perf]` console lines — those log statements are load-bearing, not debug
leftovers.
