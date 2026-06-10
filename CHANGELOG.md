# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.7] - 2026-06-10

### Added
- **Aurora Borealis preset** — a midnight terrain under a northern-lights sky: drainage flow lines coloured by an aurora gradient (deep teal valleys → spring green → mint → violet → pale magenta-white peaks) over a near-black fill with faint multi-directional hillshade, dim-violet ghost lines glowing behind ridges, a navy horizon-glow background gradient, and a sparse field of animated cyan hologram motes drifting above the surface. The first preset to use the hologram particles, ghost occlusion, and multi-directional hillshade.
- **Particle spacing control** — new "Spacing" slider in the Hologram section sets the grid-cell stride between particles (1 = one per terrain cell, as before). Previously the field always spawned one particle per cell, which on a typical grid meant a ~260 000-point carpet that read as static noise and was the only possible density; sparse fields (and far lighter GPU loads) are now a slider away.

### Changed
- **Preset buttons now apply particle settings** — `applyPreset` only merged the `style` block and gradient stops, so no preset could enable or configure the hologram field. The `points` block is now applied too; since every preset carries `showPoints`, switching presets also correctly turns the particles off again.

## [0.5.6] - 2026-06-10

### Fixed
- **SVG export broken when zoomed in** — exporting while zoomed in produced an effectively blank SVG. The exporter projected *every* line segment through the camera and sized the document around all of them: geometry outside the canvas inflated the bounding box, and geometry **behind the near plane** projected to mirrored garbage coordinates millions of pixels out (a perspective-divide artefact), exploding the viewBox to absurd dimensions (observed: 3 490 267 × 1 174 252 px) in which the actual content was a sub-pixel sliver. The same behind-camera projections were rasterised into the software z-buffer, stamping wrong depths that could cull even on-screen lines. The exporter now clips segments against the camera's near plane, drops segments/dots/particles entirely outside the canvas (which also skips their 64-sample occlusion tests — zoomed-in exports are much faster and roughly halve in file size), rejects behind-camera and off-canvas triangles from the z-buffer, and clamps the final viewBox to the canvas rect. The export now always mirrors exactly what the viewport shows; zoomed-out exports keep their tight content crop unchanged.

## [0.5.5] - 2026-06-10

### Changed
- **Locked 60 fps camera interaction** — zooming in and panning around on the default terrain previously dropped to ~23 fps (and ~34 fps for rotation) at Retina resolution; all three interactions now hold a solid 60 fps with no frame over 18 ms. Three independent causes were fixed:
  - **Occlusion curtains anchored to the terrain** — every line segment hangs an invisible depth-curtain for hidden-line occlusion, and each one extended a fixed 500 world-units down regardless of terrain size. A curtain only ever needs to reach the lowest rendered content (`minZ`, minus `pillarDepth` when pillars are enabled), so it now stops there — cutting depth-only GPU overdraw roughly 10× for a typical ±50-unit terrain. Rendered output is pixel-identical.
  - **Throttled camera ⇄ state sync** — OrbitControls moves the camera directly, but every change event also pushed camera values into React state, re-rendering the entire app (sidebar included) up to 60×/s during a drag. The orbit → state sync is now a trailing 150 ms tick plus a final sync on gesture end, and state updates that are pure echoes of an orbit sync no longer snap the camera back mid-gesture. Auto-rotate drives the camera through a ref each frame instead of `setParams`.
  - **No-op surface pass skipped** — with fill disabled (the default) the surface mesh still rasterised the full triangle mesh through the heavyweight hillshade/AO fragment shader every frame while writing neither colour nor depth. The mesh is now skipped entirely unless a fill layer is active (or profile mode needs it as a raycast target).
- **Geometry builders rewritten on growable typed-array writers** — all 12 draw modes (plus GPX and the surface mesh) previously accumulated geometry in plain JS arrays via `push(...spread)` and converted to `Float32Array` at the end: megabytes of boxed doubles, GC churn, and a final copy on every rebuild. They now append straight into doubling `Float32Array`/`Uint32Array` writers and return subarray views with no final copy. Differential-tested bit-identical against the previous output across all modes, masks, mirroring, and colour settings.
- **Single-pass marching-squares contours** — `buildContours` and `buildContoursTanaka` re-scanned the entire grid once per contour level (O(levels × cells)). They now visit each cell once and only test the levels that can cross its value range (O(cells + segments)): **18× faster** standard contours and **16× faster** Tanaka contours at a 1-unit interval on a ~1 Mcell grid (759 ms → 41 ms / 766 ms → 47 ms).
- **Faster surface + mirror geometry** — `buildSurfaceGeometry` pre-counts valid quads and fills exact-size buffers instead of growing JS index arrays and re-concatenating per mirror octant (6–7× faster; 645 ms → 89 ms for 8 octants), and both the line and surface paths skip the octant copy loop entirely when no mirroring is active (the default).
- **Render-side params no longer rebuild geometry** — `showLines` and all fill/surface styling params (`showFill`, `fillColor`, `fillBanded`, `fillHypso*`) were in the worker-rebuild dependency list although the worker never reads them; dragging the fill colour spawned a full terrain + 12-mode + surface recompute on every tick. They are excluded now: fill edits react in ~25 ms, and a Reset that only touches render-side params completes in ~45 ms with no recompute at all.
- **Per-vertex colour sampling without allocation** — interpolated gradient samples inside the worker now come from a small rotating scratch pool instead of allocating a fresh `[r,g,b]` per vertex.
- **Dashed-line distances computed lazily** — `computeLineDistances()` (O(segments) on the CPU plus a fresh GPU buffer) ran on every weight/opacity/dash slider tick, twice per layer on the same shared geometry. It now runs at most once per geometry and only when a dashed style actually needs it. Forced material recompiles (`needsUpdate`) on plain uniform/render-state changes were removed alongside.
- **Particle home positions** are written into a pre-sized `Float32Array` instead of a growing JS array (runs on the main thread on every terrain change).

### Fixed
- **Pan position now persists** — `setParams` silently dropped the `panX`/`panY` keys the orbit sync sends after a pan. State could never catch up to the camera, which both re-fired the sync (and a full app re-render) on every subsequent orbit event forever, and snapped the pan back to centre on the next tilt/rotation/zoom change.
- **`benchmark.spec.js` Phase 4** updated for the new reset behaviour: a Reset that only touches render-side params legitimately triggers no worker rebuild, so the test now measures reset completion via the UI instead of requiring a rebuild log.

## [0.5.4] - 2026-06-06

### Changed
- **On-demand rendering** — the canvas now uses `frameloop="demand"` instead of redrawing 60 times a second whether or not anything changed. Frames are only drawn in response to actual state changes; the continuous animations that still need a live loop (auto-rotate, the hologram particle field, and WebM capture) keep it alive by calling `invalidate()` each frame. The particle loop additionally gates on `showPoints`, so a hidden-but-"animated" field no longer pins the renderer at 60 fps doing nothing. The result is a near-idle GPU (and far less battery/fan) whenever the scene is static.
- **Faster geometry rebuilds** — the mirror/octant expansion in `buildLineGeometry()` was rewritten to write straight into pre-sized typed arrays instead of growing JS arrays with repeated `push()`/`concat()`. Curtain quads are now built once into sized `Float32Array`/`Uint32Array` buffers and the per-octant copy is a single sized allocation filled by offset — eliminating the O(octants²) reallocation churn and the millions of `push()` calls a dense layer previously made on every rebuild.
- **Zero-copy worker transfers** — the geometry worker now transfers the curtain, lid, and terrain-grid buffers (the largest arrays in the payload) as Transferables instead of structure-cloning them on every rebuild. A `Set` guards against transferring the same `ArrayBuffer` twice.

### Fixed
- **Depth-occluder render order** — clarified and preserved the curtain occluder's place in the transparent render queue (it writes depth but no colour). Keeping it transparent ensures it renders after the transparent fill surface; promoting it to opaque would punch depth holes through the fill where curtains hang in front of farther terrain.

## [0.5.3] - 2026-06-01

### Changed
- **Hologram particle system** — the particle layer has been reworked from a CPU spring/gravity simulation into a GPU-driven holographic point cloud, adapting the technique from [cortiz2894/hologram-particles](https://github.com/cortiz2894/hologram-particles) (a WebGPU/TSL project) to erzberg's WebGL/R3F renderer. The old per-frame loop mutated and re-uploaded a `Float32Array` every frame; all motion now lives in the vertex shader, driven by a single `uTime` uniform, so the position buffer is uploaded once and never touched again. An inline 3D simplex-noise helper drives per-particle float plus two-octave fractal-noise displacement gated by a moving "scan" mask; the soft-glow look (bright core, glow-tinted halo, travelling scanline shimmer) is faked entirely in the fragment shader, so no post-processing pass is added and the SVG/PNG/STL export paths are unaffected. New params: glow colour, shimmer, float, noise amount/scale, flow speed, and reveal contrast.

### Removed
- Classic particle controls that no longer apply to the hologram field: spring noise/damping, gravity (+ strength), the mouse-interaction push/glow, additive-blend toggle, and peaks-&-valleys-only sampling.

## [0.5.2] - 2026-05-29

### Changed
- **Line style changes no longer rebuild geometry** — `weight`, `opacity`, and `dash` are purely render-side, so they are now applied directly to the `LineMaterial` (and read from live params by the SVG exporter) instead of being baked into the worker geometry. Dragging these sliders previously terminated the worker and rebuilt the terrain grid + all 12 draw modes + surface mesh on every tick; they now update instantly with no recompute. Resolved via a single `layerStyle(id, p)` source of truth in `geometryBuilders.js`.
- **Faster per-vertex colouring** — the gradient sampler used once per vertex inside the geometry worker no longer re-sorts the gradient-stop array and re-parses `#rrggbb` strings on every call. Stops are sorted/parsed once per build and hex colours are cached, cutting redundant work across the hundreds of thousands of per-vertex colour computations a rebuild performs.

### Removed
- Dead code: the unused `noise.js` value-noise module, an unused `sampleGradient` import, the unused `DASH_SVG` export, two unused Zustand store actions (`clearTextureImage`, `clearHeightmap`), and leftover Leva panel CSS.

### Fixed
- Renamed the leftover Leva-era parameter bridge (`levaGet`/`levaSet` → `getParams`/`setParams`) and corrected stale documentation (`CLAUDE.md`, `README.md`, `GEMINI.md`, store CRS comment).
- **`grid.spec.js`** updated to the current 1024×1024 default heightmap (it had assumed an obsolete 500×500 image and asserted the wrong grid dimensions).

## [0.5.1] - 2026-05-27

### Fixed
- **Blur slider resolution** — the Blur slider now responds to every 0.1-step increment. Previously, fractional radii were rounded to the nearest integer via `Math.round`, so values like 0.6 were indistinguishable from 0.5. Fractional blur is now computed by linearly interpolating between the two adjacent integer-radius box-blur passes.
- **Stipple dots missing from SVG export** — stipple dots are modelled as near-zero-length segments in 3D; the SVG exporter's sub-0.1 px segment filter silently dropped all of them. The exporter now detects the stipple layer (`isPoints` flag) and emits each dot as an SVG `<circle>` element instead, with radius proportional to the layer's weight. Depth occlusion and ghost opacity are respected.

## [0.5.0] - 2026-05-27

### Added
- **Multi-directional hillshade** — new "Multi-direction" toggle in the Hillshade section averages lambert from 8 evenly-spaced azimuth directions (Swiss-style). Eliminates directional bias; azimuth slider and cast-shadow controls are hidden while active.
- **Sky View Factor** — ray-marches the sky hemisphere from each surface point to darken valleys, gullies, and other concavities where surrounding terrain blocks the sky. Controlled by Strength and Rays sliders, nested inside the Hillshade section alongside Cast Shadows.
- **Tanaka contours** — "Tanaka illumination" toggle inside the Contours mode. Splits contour lines into thick bright segments (sun-facing slopes) and thin dark segments (shadow slopes) based on a configurable sun azimuth. Separate Bright Weight and Dark Weight sliders.
- **Aspect map overlay** — circular HSL hue-wheel coloring by terrain facing direction. N-facing slopes one hue, E another, etc. Opacity slider; runs as a fragment shader pass after hillshade.
- **Water fill** — flood all terrain below a configurable level threshold with translucent, depth-darkened water. Separate Level, Opacity, and Color controls.
- **Elevation profile** — Analysis section at the bottom of the sidebar. Click "Elevation Profile", then click two points on the terrain canvas to sample a 200-point bilinear cross-section. Displays an SVG chart panel with real metre labels when a GeoTIFF is loaded.
- **Hypsometric Integral** — stat row in the Terrain section showing HI = (mean − min) / (max − min). Inline help panel explains the geomorphological interpretation (> 0.6 young/rugged, ≈ 0.5 equilibrium, < 0.4 mature/eroded). Updates live when hydraulic erosion is applied.

### Changed
- All 16 presets updated to include new param keys with defaults.

## [0.4.6] - 2026-05-27

### Added
- **Scarlet Relief preset** — slope-driven red shading on a neutral warm-gray base. Flat areas remain gray (`#c8c2ba`); steep slopes grade to vivid red (`#d61900`) via full-opacity slope shading. No line work, no hillshade.
- **Magma preset** — thermal-glow hypsometric with near-black valleys (`#030201`) graduating through deep crimson → burnt orange → amber → near-white peaks (`#fffbe8`). Paired with a dramatic low-angle hillshade (22 °, exaggeration ×9, full cast shadows) and thin golden ridge lines (`#f8c840`, Hessian detection) tracing the crests against the dark terrain.

### Changed
- **Default view on startup** — opening tilt changed from 40 ° to 50 °; default zoom set to 75 % (user-loaded heightmaps continue to auto-fit to the viewport).
- **Default heightmap** — replaced with a higher-resolution sample terrain.
- Updated Dark Survey preset (flow lines: wider spacing, longer paths, dotted dash, aspect-based hypsometric colouring).
- Updated Swiss Topo preset (banded fill enabled, hypsometric weight set to 0).

## [0.4.5] - 2026-05-27

### Added
- **16-bit PNG heightmap support** — PNG files with 16-bit depth are now decoded natively, bypassing the browser canvas (which silently downgrades all images to 8-bit). The raw PNG bytes are parsed directly: IDAT chunks are decompressed with the browser-native `DecompressionStream` API (no new dependency), all five PNG filter types are reconstructed, and 16-bit samples are extracted at full precision. Supports grayscale, RGB, gray+alpha, and RGBA colour types; transparent pixels become NoData. Raises elevation precision from 256 to 65 536 distinct levels. 8-bit PNGs, JPEGs, and other image formats continue to use the existing canvas path unchanged.

## [0.4.4] - 2026-05-27

### Added
- **Elev min/max cut in 0.1 % steps** — the elevation cut sliders now move in 0.1 % increments (previously 1 %), allowing precise isolation of narrow elevation bands.

### Fixed
- **Depth occlusion disabled in several presets** — Alpine Survey, Coral Relief, Dark Survey, Ink Atlas, Stone Relief, and Teal Matrix all had `depthOcclusion: false`; corrected to `true`.

## [0.4.3] - 2026-05-26

### Added
- **Coral Relief preset** — hypsometric relief shading inspired by Aerialod-style renders. Teal valleys (`#00b8a8`) transition through cream to coral and deep terracotta at peaks, with strong directional hillshading, cast shadows, and a white background. No line work.

### Fixed
- **Gradient stop colour pickers opening in top-left corner** — the single globally-positioned hidden `<input type="color">` was placed at `top: 0; left: 0`, causing the OS picker to anchor there on every click. Each gradient stop now has its own `<input type="color">` rendered in-place inside its bar handle and swatch, so the browser opens the picker at the correct element position on the first and every subsequent click.
- **Preset export missing trailing newline** — exported `.json` preset files now always end with a newline character.

### Changed
- Removed USGS Classic preset.
- Updated Alpine Survey, Burnt Paper, Dark Survey, Ink Atlas, Swiss Topo, and Teal Matrix presets.

## [0.4.2] - 2026-05-26

### Fixed
- **Flow Lines: incomplete coverage at small spacings** — seeds were processed in row-major order, so early rows' flow paths masked downstream cells before they could be seeded. At spacing ≤ 1 this produced large empty regions in the lower half of the terrain. Seeds are now sorted by descending elevation before tracing begins: ridges and peaks seed first, their paths fill the terrain naturally from high to low, and only genuinely uncovered cells become secondary seeds.
- **Flow Lines: spacing slider 0.5 increments had no effect** — `lineStep` was computed with `Math.round(spacing / scl)`, collapsing pairs of consecutive 0.5-step values (e.g. 1.5 and 2.0) to the same integer. Replaced with a floating-point seed accumulator so every 0.5-step increment produces a distinct seed grid.
- **Flow Lines: hard segment cap** — a fixed `MAX_TOTAL_SEGMENTS = 3 000 000` constant caused the outer seed loop to abort early on dense settings, cutting off large parts of the terrain. The cap is removed; the occupancy mask mathematically guarantees `totalSegments ≤ rows × cols`, so the buffer is sized exactly to that tight bound.

## [0.4.1] - 2026-05-26

### Added
- **Sun ray indicators** — 14 line segments radiate from the sun orb sphere in all spatial directions (6 axis-aligned + 8 cube-corner diagonals), creating a starburst effect. Rays start just outside the core sphere and extend to ~4.5× the core radius. Same amber colour as the core (`#ffcc00`), 70% opacity, `depthTest: false` so they are always visible regardless of terrain geometry.

## [0.4.0] - 2026-05-26

### Added
- **Hillshade: ray-march cast shadows** — ridgelines now physically occlude sunlight. From each surface fragment a ray is marched across the heightmap toward the sun using progressive step sizes (linear stride growth) that give far-field reach within a fixed step budget. The shadow test compares the maximum horizon angle along the ray against the sun altitude, expressed in degrees so that the penumbra width is camera-independent. Controls: Darkness (shadow floor), Softness (penumbra width in degrees), Quality (step count 16–128×). Requires a loaded heightmap image.
- **Sun indicator** — an amber sphere and orange glow halo placed in the scene at the configured hillshade azimuth/altitude, toggled independently via **Show Sun**. Visible regardless of terrain depth (depthTest: false) and correctly sized relative to the terrain's geographic extent. Renders consistently on both light and dark backgrounds (saturated `#ffcc00` core with additive halo).
- **Elevation scale slider range widened** — upper and lower bounds extended from ±5 to ±10, allowing more dramatic vertical exaggeration on low-relief terrain.

### Fixed
- **Hillshade lighting direction wrong for non-90° azimuths** — the vertex shader was transforming terrain normals to view space (`normalMatrix × normal`), while the fragment shader computed `lightDir` in world space from the azimuth angle. The X axis happens to be preserved between the two spaces when camera rotation is 0°, which is why azimuth 90° appeared correct while 0°/180°/270° were wrong. Since the terrain group never rotates (only the camera orbits), model space equals world space; changing the vertex shader to `vNormal = normal` aligns both vectors and makes all azimuths correct.
- **Cast shadow V-axis flipped in heightmap texture** — `DataTexture` defaults to `flipY = false`, placing image row 0 (North) at UV V = 0 in GPU texture space, while the surface mesh UV convention has North at V = 1. This caused the shadow ray to sample terrain from the geographically reversed North/South side. Setting `flipY = true` on the DataTexture corrects the alignment. The bug was masked on symmetric test terrain (cylinders) but would have produced incorrect shadow lengths on north/south-facing ridges.
- **Sun orb not visible** — three independent bugs caused it to be invisible: (1) placement distance `halfExtent × 2.5 + 60` put the orb ~42° off the camera's centre, outside the 30° half-FOV; corrected to `halfExtent × 1.1`. (2) Core material lacked `depthTest: false`, allowing terrain to occlude it from behind. (3) Near-white core colour `#fffbe8` plus additive blending on a white background rendered as white-on-white; changed to saturated amber `#ffcc00` with normal blending.

## [0.3.7] - 2026-05-14

### Fixed
- **SVG export: fill enabled causes bloated files and missing occlusion** — when the terrain fill was enabled, the SVG exporter was projecting the entire surface mesh as individual `<polygon>` elements (one per triangle), making exported files enormous on complex terrain. Fill is now used purely as a depth occluder: the surface geometry is rasterised into the software Z-buffer so that lines behind the terrain are culled, but no fill polygons are written to the SVG output. The Z-buffer is also now built unconditionally when fill is enabled, regardless of the separate *Depth Occlusion* toggle.

## [0.3.6] - 2026-05-14

### Changed
- **Export filenames derived from uploaded file** — all exporters now use the uploaded heightmap's filename as the base name (extension stripped). For example, uploading `graz.tif` produces `graz.svg`, `graz.png`, `graz-alpha.png`, `graz.stl`, `graz-gpx.stl`, `graz.webm`, and `graz-heightmap.png`. Previously every exporter used the hardcoded prefix `heightmap`.

## [0.3.5] - 2026-05-12

### Added
- **SVG export loading indicator** — a spinner overlay ("Exporting SVG…") is now shown while the SVG is being computed. The export runs synchronously on the main thread; without a visual cue the UI appeared frozen for complex scenes. A `setTimeout` in the export effect yields to the browser so the overlay renders before computation begins.

### Changed
- **SVG export: dashed / dotted / long-dash rendered as real segments** — instead of relying on `stroke-dasharray` / `stroke-dashoffset`, each SVG line segment is now split into actual sub-segments covering only the "on" portions of the dash cycle. The existing cumulative-length `dashOffset` tracking keeps the pattern phase continuous across connected terrain lines. The exported file now faithfully matches the LineMaterial dash rendering in the viewport and is fully editable in Inkscape / Illustrator without any special SVG dash knowledge.

## [0.3.4] - 2026-05-11

### Fixed
- **Viewport not updating after contour param change on large files** — the geometry worker queued every intermediate slider value and processed them all sequentially. On a large GeoTIFF with 1 m contours each rebuild could take several seconds, so the correct final result sat deep in a backlog and the viewport appeared frozen. The worker is now terminated and restarted on every param change, ensuring only the latest value is ever computed. A generation counter (`_gen`) echoed through the worker message discards any stale result that arrives after a restart.
- **Major Weight slider visible when major contours are disabled** — the slider is now hidden when *Major Every* is set to 0 (None), consistent with how *Major Offset* is already hidden in that state.

## [0.3.3] - 2026-05-11

### Fixed
- **SVG export: dash / dotted / long-dash modes rendered as solid lines** — SVG resets the `stroke-dasharray` phase at the start of each `<line>` element. Because terrain lines are stored as many short connected segments, every segment started within the first "on" portion of the dash cycle and appeared solid. The exporter now tracks cumulative screen-space length along each connected chain of segments and writes `stroke-dashoffset` on every `<line>`, making the dash pattern flow continuously across the full terrain line — matching the `LineMaterial` behaviour in the live viewport.

## [0.3.2] - 2026-05-04

### Added
- **Open Graph & Twitter meta tags** (`index.html`) — `og:type`, `og:title`, `og:description`, `og:image`, and the matching `twitter:card` / `twitter:title` / `twitter:description` / `twitter:image` tags. Also adds a standard `<meta name="description">` for search engines. All descriptions open with the tagline "Digital terrain artistry."

## [0.3.1] - 2026-05-04

### Fixed
- **PNG / SVG exports re-triggered after settings change** — `activeCamera` was listed as a dependency of the SVG, PNG, and PNG-α `useEffect` hooks in `Scene.jsx`. Because `activeCamera` is a plain local variable (`p.orthographic ? orthoRef.current : persRef.current`) it gets a new object reference on every render; any settings change that caused a re-render after a trigger counter had been incremented re-fired the export effect and downloaded an unexpected file. Removed `activeCamera` from all three dependency arrays — the closure already captures the correct camera from the render that incremented the trigger, so there is no staleness risk.

## [0.3.0] - 2026-05-04

### Added
- **GPX Track overlay** — load a `.gpx` file when a GeoTIFF is active to render the GPS track as a coloured line on the terrain. The "GPX Track" sidebar section appears only when a GeoTIFF is loaded (geographic extent is required). Controls follow the same style stack as every draw mode: colour, line weight, opacity, dash pattern, and full hypsometric colouring by elevation.
- **Geographic coordinate projection** (`src/utils/geoCoords.js`) — converts WGS84 lat/lon to terrain world-space for any of the common GeoTIFF coordinate systems: EPSG:4326 (geographic, pass-through), EPSG:3857 (Web Mercator), EPSG:326xx / EPSG:327xx (all 120 standard UTM zones, WGS84 Transverse Mercator formulas), and an `EPSG:projected-unknown` fallback that infers the UTM zone from the point's longitude. Includes bilinear terrain-elevation sampling for surface-snapping.
- **GPX parser** (`src/utils/gpxParser.js`) — browser-native `DOMParser`-based parser with no added dependencies. Collects `<trkpt>` elements from all `<trk>/<trkseg>` chains; falls back to `<rtept>` if the file contains only a route.
- **GPX in SVG export** — the track appears automatically as a named Inkscape layer in exported SVGs (it is a standard `lineGeo` layer and participates in the existing depth-occlusion pipeline).
- **GPX ribbon in STL export** — when a GPX track is present, a second file `heightmap_gpx.stl` is downloaded alongside `heightmap.stl` for multicolour 3D printing (Bambu Studio / PrusaSlicer: import both, assign different filaments). The ribbon is 2 world-units tall and 6 world-units wide. Each segment is an independent closed rectangular prism (12 triangles, all 6 faces) so the mesh is unconditionally manifold.

### Fixed
- **GeoTIFF CRS detection** — `ProjectedCSTypeGeoKey` is now read directly from `image.geoKeys` regardless of `GTModelTypeGeoKey`, which is absent or unreliable on many real-world files. A bbox-value heuristic (coordinates outside ±360° / ±90°) provides a further fallback for files that lack geokey metadata entirely. Previously, projected GeoTIFFs (e.g. Austrian/Alpine UTM files) were silently mis-classified as EPSG:4326, causing GPX coordinates to map to the wrong location.

## [0.2.14] - 2026-04-29

### Fixed
- **PNG export colours darker than viewport** — three.js r152+ no longer applies `outputColorSpace` (sRGB conversion) when rendering to a `WebGLRenderTarget`, so exported pixels were in linear colour space. Image viewers interpret PNG bytes as sRGB, making the result appear darker than the live view. Adding `colorSpace: THREE.SRGBColorSpace` to the render target opts back into the sRGB output conversion, matching the main canvas.

## [0.2.13] - 2026-04-29

### Fixed
- **Pan X / Pan Y sliders not updating viewport** — `p.panX` and `p.panY` were missing from the `updateCameraFromSliders` `useEffect` dependency array in `Scene.jsx`.
- **Camera reset incomplete** — Reset button now restores `zoom`, `fov`, `panX`, and `panY` in addition to `tilt` and `rotation`. `orthographic` mode is intentionally preserved.

### Changed
- **Keyboard shortcuts trimmed** — removed `W/A/S/D` (pan), `Y/X` (tilt), `E/R` (rotate), `T` (camera reset), `G` (guides). Remaining hotkeys: `Q` (toggle auto-rotate), `1` SVG, `2` PNG 4×, `3` PNG α, `4` STL, `5` WebM.

## [0.2.12] - 2026-04-29

### Fixed
- **PNG export: scene cropped at top** — replaced the `gl.setSize` / `gl.setPixelRatio` resize approach with a `WebGLRenderTarget`. The old approach created an intermediate framebuffer at `targetSize × devicePixelRatio` before resetting the DPR to 1, which on retina displays produced a buffer up to 2× the intended size that could be silently clamped by the GPU, cutting off the top of the scene.
- **PNG export: lines too bold** — `linewidth` is no longer scaled during capture. The LineMaterial shader formula `pixels_wide = linewidth × targetH / resolution.y` reproduces the same on-screen pixel width as the live viewport when only `resolution` is updated to match the render target dimensions. Previously scaling by `captureScale = 4` made lines 4× bolder at 100% zoom.
- **PNG export: particles blurry in live viewport after export** — removed `uSize` mutation during capture. The point-size shader already handles depth-based scaling; mutating the shared material reference caused visible size bleed into the next live frame.
- **PNG export: lines pixelated / no antialiasing** — added `samples: 4` MSAA to the `WebGLRenderTarget`. Three.js resolves the multisampled buffer to the target texture automatically at the end of `gl.render()`, so `readRenderTargetPixels` receives the antialiased result without an extra blit pass.
- **Default heightmap loads at resolution 2 instead of 1** — the mount-time load now calls `autoResolution` in its `.then()` callback, matching the behaviour of user-initiated loads.

## [0.2.11] - 2026-04-29

### Fixed
- **No UI feedback on broken / oversized GeoTIFF** — loading failures previously swallowed the error silently (console only). A dismissible red banner now appears at the bottom of the screen with a friendly message. Out-of-memory (`RangeError: Array buffer allocation failed`) shows "File is too large to load in the browser. Try a smaller or lower-resolution GeoTIFF."; invalid elevation data shows "GeoTIFF contains no valid elevation data."; all other errors surface the raw message as a fallback.

## [0.2.10] - 2026-04-29

### Added
- **Contours: Close contours** — new toggle in the Contours mode that closes open contour lines at the heightmap boundary. When enabled, the marching-squares segments for each elevation level are first chained into polylines, then any open endpoints on the grid border are paired by clockwise position and connected via a border-walking path (inserting grid corners where needed). Pairing is per-level and uses the planar winding argument — consecutive clockwise border endpoints at the same elevation always bound the same region, so the algorithm never connects endpoints from different elevation levels.

## [0.2.9] - 2026-04-29

### Added
- **Texture blend modes** — six GPU blend modes for the texture overlay: Normal (previous behaviour), Multiply, Screen, Overlay, Soft Light, and Add. Implemented as a `uniform int` branch in the surface fragment shader with no CPU overhead.
- **Texture opacity** — 0–100% opacity slider for the texture overlay. Multiplies the texture's own alpha channel so both controls compose correctly.
- **Texture scale extended** — minimum scale lowered from `0.1` to `0.01` (step `0.01`), allowing 10× more texture repetitions for high-res tiling.

## [0.2.8] - 2026-04-29

### Fixed
- **Rotation slider unresponsive after selecting Top view preset** — spherical coordinate singularity at `tilt = 0°` caused `setFromSphericalCoords` to collapse the azimuth term, placing the camera at `(0, dist, 0)` regardless of rotation. Clamping `phi` to `≥ 0.001°` keeps the `lookAt` cross product non-degenerate so rotation works correctly at top-down.
- **Main thread blocked during geometry rebuild** — geometry state updates from the Web Worker were applied as urgent React renders, blocking user input (e.g. rotation slider) for up to 8 s on heavy recomputes. Wrapping the worker `onmessage` state updates in `startTransition` marks them as low-priority background work, so React can interrupt and process user input immediately.
- **Auto-resolution grid target updated** from 1000 × 1000 to 1024 × 1024 cells, aligning with power-of-two texture sizes.

### Changed
- Upgraded `three-mesh-bvh` from `0.7.8` (deprecated) to `0.9.9` — the latest version compatible with three.js `0.184.0`.
- Added `data-testid="sidebar-toggle"` to the sidebar toggle button; performance test now uses attribute-based selectors instead of fragile text matchers.

## [0.2.7] - 2026-04-28

### Added
- **Brand identity** — new ErzbergMark: a terraced-mountain logo inspired by the real Erzberg open-pit mine profile, rendered as 12 horizontal line segments grouped into 4 terrace bands. Amber `#E8823A` on dark `#131210`.
- **Logo** (`public/logo.svg`) — horizontal lockup: ErzbergMark + "erzberg" wordmark in Space Mono 700 with tagline. Transparent background.
- **Favicon** (`public/favicon.svg`) — redesigned using the same ErzbergMark viewBox and strokeWidth as the logo so line proportions are identical at all sizes. Transparent background.

### Changed
- Sidebar "erzberg" wordmark updated to **Space Mono 700**, `-0.02em` letter-spacing, warm off-white `#F0EBE3` — matching the Dark/Iron logo variant.
- Texture section button renamed from "↑ Upload Image" to "↑ Load Image" to accurately reflect that files are opened locally, not sent to a server.
- README: added privacy statement (*everything runs locally in your browser — no server, no upload, no account*) and logo image.

## [0.2.6] - 2026-04-28

### Added
- **Slope Shading** — new surface overlay that tints the terrain by steepness. Blends a configurable two-colour gradient (flat → steep) over the existing fill with an opacity slider. Works standalone or combined with hillshade and fill.
- **SVG layer export** — exported SVGs now wrap each draw mode in a named `<g>` group with `inkscape:groupmode="layer"` metadata. Opening the file in Inkscape or Illustrator shows each mode as a separate, independently editable layer.

### Changed
- "Creative" section in the sidebar renamed to "Mirror".

### Fixed
- Suppressed spurious Vite chunk-size warning caused by Three.js and GeoTIFF libs exceeding the default 500 kB threshold. Raised `chunkSizeWarningLimit` to 1500 kB to reflect the expected bundle weight.
- Texture overlay now shows an amber warning in the sidebar when Fill is disabled, since the texture is not rendered without an active fill pass.

## [0.2.5] - 2026-04-28

### Added
- **Pillars: Cuboid and Cylinder shapes** — the Pillars draw mode now supports three shapes selectable per-mode: Line (original), Cuboid (rectangular prism with 12 wireframe edges), and Cylinder (N-gon prism, configurable polygon segments). Both 3D shapes include a closed solid lid on the top face rendered as a filled mesh. Size controls the cross-section as a fraction of spacing; Segments controls polygon resolution for cylinders.
- **Pillars: Lid Color** — independent colour picker for the solid top-face lid on Cuboid and Cylinder pillars, defaulting to white.

### Changed
- Stipple draw mode renamed to "Stipple Dots" in the sidebar.

### Fixed
- Resolution slider could not be set below the auto-safe minimum after loading a file wider than 1000 px. The safety clamp now applies only on the render where new pixels arrive (the race window), not on subsequent user-driven slider changes.

## [0.2.4] - 2026-04-27

### Added
- **Stipple draw mode** (mode #12): stochastic dot-density map driven by slope, elevation, or their inverses. Each dot is placed on a jittered grid and accepted with probability proportional to the chosen terrain attribute raised to a configurable gamma exponent. Exposed controls: Spacing, Gamma, Jitter, Density mode, plus the full per-mode colour / weight / opacity / dash / hypsometric stack.
- **Hillshade**: GPU surface shader that computes Lambertian illumination from a configurable sun direction (azimuth + altitude). Blends over the existing fill colour with adjustable intensity, opacity, and normal exaggeration. Separate colour pickers for highlights and shadows allow full tonal control (e.g. warm orange highlights + cool blue shadows for painted-relief aesthetics).

### Fixed
- Stipple mode parameters (`spacingStipple`, `stippleDensityMode`, `stippleGamma`, `stippleJitter`, and all hypsometric sub-params) were missing from the `useTerrainGeometry` dependency array, so the viewport did not update reactively when they changed.

## [0.2.3] - 2026-04-25

### Added
- Auto-resolution on file load: the geometry grid is capped at 1000×1000 cells automatically. Resolution is preserved across Reset.
- Benchmark test suite (`tests/benchmark.spec.js`): measures GeoTIFF parse time, display time, rotation responsiveness, colour reactivity, and full-reset recompute time, with per-phase screenshots.
- Timing instrumentation: `[Benchmark]` and `[Perf]` console logs in `useHeightmap`, `useTerrainGeometry`, and `SurfaceMesh` for test-driven performance measurement.

### Changed
- Elevation scale on GeoTIFF load: the GeoTIFF-derived scale is now applied internally. The UI slider shows an additive offset (default `+0.0`) rather than the raw multiplier, keeping the control range human-scale regardless of the file's intrinsic elevation ratio.
- Zoom on file load: the fit-to-screen zoom is stored as a baseline; the UI always shows 100% after loading any file. The zoom slider and OrbitControls both adjust relative to that baseline without interfering with each other.

### Fixed
- Race condition on large GeoTIFF load: the geometry worker could fire with the previous (uncapped) resolution before the terrain state update committed, causing an `Invalid array length` crash for images whose pixel dimensions exceed the default grid limit. The worker now derives a safe resolution directly from the pixel dimensions in the Zustand store before dispatching.

## [0.2.2] - 2026-04-22

### Fixed
- Contour interval anchoring: precisely identifies and renders 0.0 m elevation levels.
- Shoreline tracing: contours now accurately trace the boundary of terrain (NoData handling).

## [0.2.1] - 2026-04-22

### Fixed
- Line weights and particle sizes in 4K PNG exports now match the visual thickness seen in the viewport.

## [0.2.0] - 2026-04-22

### Added
- Dedicated camera section with orthographic projection, focal length (FOV) control, and precise X/Y target panning.
- Content-based centering and auto-zoom for GeoTIFFs and PNGs (ignoring NoData and transparent areas).
- Omnidirectional occlusion via refactored bi-directional curtain geometry (360° tilt support).
- Dynamic browser tab titles based on current filename.
- Terrain fill disabled by default.

## [0.1.0] - 2026-04-21

### Added
- Eleven algorithmic draw modes for topographic feature extraction.
- Curtain-based ghost occlusion for line-to-line depth ordering.
- Droplet-based hydraulic erosion simulation.
- Export suite: 4K PNG, SVG, STL, heightmap PNG.
