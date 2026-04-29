# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
