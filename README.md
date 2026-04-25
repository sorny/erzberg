# erzberg

[![Deploy to GitHub Pages](https://github.com/sorny/erzberg/actions/workflows/deploy.yml/badge.svg)](https://github.com/sorny/erzberg/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A topographic visualisation tool built on React Three Fiber. Load a greyscale heightmap or GeoTIFF and render it as 3D line art, structural relief, or architectural sketch using one or more of the eleven independent draw modes.

**Live version:** [sorny.github.io/erzberg](https://sorny.github.io/erzberg/)

---

## Features

**Layered ghost occlusion.** Each line segment generates an invisible 3D curtain mesh that acts as a depth buffer. Lines occlude other lines rather than being swallowed by the terrain surface, and hidden segments can be rendered with a custom colour and opacity for an X-ray effect.

**Eleven draw modes.** Every mode runs independently with its own colour, weight, dash pattern, and hypsometric tinting:

| Mode | Technique |
|---|---|
| X Lines / Y Lines | Grid sampling along fixed axes |
| Crosshatch | Combined X/Y ridgelines |
| Pillars | Vertical extrusion per cell |
| Contours | Marching Squares isolines, GIS-unit-aware |
| Hachure | Slope-directed short strokes |
| Flow Lines | Euler-integrated drainage paths |
| Stream Network | Strahler-order flow accumulation |
| Pencil Shading | Laplacian curvature detection |
| Ridge Detection | Hessian eigenvalue crest extraction |
| Valley Detection | Topographic Position Index troughs |

**Hydraulic erosion.** A droplet-based simulation following [Hans Beyer's method](https://ardordeosis.github.io/implementation-of-a-method-for-hydraulic-erosion/thesis-beyer.pdf). Runs off the main thread in a Web Worker.

**Exporters.** SVG (software Z-buffer projection), 4K PNG, STL (watertight mesh), and greyscale heightmap PNG.

---

## Tech stack

| Layer | Library |
|---|---|
| 3D engine | React Three Fiber + Three.js |
| State | Zustand (heightmap data) + React state (all UI params) |
| GIS parsing | GeoTIFF.js |
| UI controls | Custom panel + Tailwind CSS |
| Geometry | Web Workers (geometry and erosion) |

---

## Documentation

- [Draw mode mathematics](docs/Draw-Modes.md)
- [Hydraulic erosion algorithm](docs/Hydraulic-Erosion.md)

---

## Development

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build
npm run test      # Playwright end-to-end suite
npm run test:ui   # Playwright interactive UI
npx playwright test tests/lines.spec.js   # single spec
```

Tests run against a live dev server in non-headless Chrome with WebGL enabled.

---

## License

MIT — Copyright (c) 2026 sorny.
