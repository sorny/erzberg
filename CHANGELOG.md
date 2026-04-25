# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
