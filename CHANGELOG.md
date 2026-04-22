# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-04-22

### Fixed
- Contour interval anchoring: precisely identifies and renders 0.0m elevation levels.
- Shoreline Tracing: Contours now accurately trace the boundary of terrain (NoData handling).

## [0.2.1] - 2026-04-22

### Fixed
- Line weights and particle sizes in 4K PNG exports; they now perfectly match the visual thickness of the viewport.

## [0.2.0] - 2026-04-22

### Added
- Dedicated Camera section with Orthographic projection, Focal Length (FOV) control, and precise X/Y target Panning.
- Content-based centering and auto-zoom for GeoTIFFs and PNGs (ignoring NoData/transparent areas).
- Omnidirectional Occlusion via refactored bi-directional curtain geometry (360° tilt support).
- Dynamic browser tab titles based on current project filename.
- Refined visual defaults (Terrain fill OFF by default).

## [0.1.0] - 2026-04-21

### Added
- 11 Algorithmic Draw Modes for high-fidelity topographic feature extraction.
- Curtain-Based Ghost Occlusion for true line-to-line depth culling.
- Physically correct, droplet-based Hydraulic Erosion simulation.
- Professional Exporter suite (4K PNG, SVG, STL, Heightmap).
