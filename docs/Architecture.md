# Architecture

How a file becomes a picture, and — just as important — which changes are
allowed to cost anything.

---

## The pipeline

```
  file ──> loader ──> STORE (source raster)
                        │
                        ├── Edit Mode clip ──> derived raster
                        │
                        ▼
                  useTerrainGeometry            ← the only bridge to the worker
                        │  postMessage({ pixels?, p })
                        ▼
  ┌──────────── geometry.worker ────────────┐
  │  buildTerrain()      grid, slopes, bounds│
  │  buildLineGeometry() 14 draw modes       │
  │  buildGpxGeometry()  optional track      │
  │  buildSurfaceGeometry() fill / depth mesh│
  └──────────────────────────────────────────┘
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
| **Zustand** (`store/useStore.js`) | The raster: source pixels + mask + dimensions, the Edit Mode clip, the derived (clipped) raster, GeoTIFF metadata, the overlay texture | Large buffers that many unrelated components read. Selector-per-field, so loading a texture does not re-render the terrain hook. |
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
every draw mode's spacing/angle/threshold, the gradient stops (baked into line
vertex colours), and the GPX track. The dependency list in
`useTerrainGeometry` is the authoritative statement of this set.

**2. Re-render only (GPU uniforms).** Line weight, opacity, dash pattern, fill
colour, hillshade, slope shading, water, aspect, AO, raw terrain view. These are
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

---

## Presets

A preset is a JSON blob of `{ style, points, gradientStops, bgGradientStops }`
in `public/presets/`, listed in `manifest.json` and fetched at startup.
`applyPreset` in `Sidebar.jsx` spreads it over the current state — deliberately
*not* including `terrain` or `view`, because resolution, zoom and pan describe
the loaded raster rather than the look.

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
| STL | `surfaceGeo` | Computes its own facet normals; must skip vertices parked at `NODATA_SENTINEL_Y` |
| Heightmap PNG | `terrain.grid` | The processed raster, after resolution and levels |
| WebM | The live canvas | `MediaRecorder` on the canvas stream |

Because every exporter reads the *derived* terrain, features upstream of it —
Edit Mode clips, erosion, mirroring, soundscapes — need no exporter support.

---

## Adding things

- **A draw mode**: write a builder in `geometryBuilders.js` returning
  `{ id, positions, colors? }`, register it in `buildLineGeometry`, add its
  params to `STYLE_DEF` in `src/defaults.js`, an entry in
  `src/utils/drawModes.js` (which is what teaches the randomiser it exists), a
  `<Section>` in `Sidebar.jsx`, and its params to the dependency list in
  `useTerrainGeometry`. Forgetting the last step is the classic bug: the
  control moves and nothing happens.
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
