# erzberg

[![Deploy to GitHub Pages](https://github.com/sorny/erzberg/actions/workflows/deploy.yml/badge.svg)](https://github.com/sorny/erzberg/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**A high-performance, multi-layered topographic visualization suite powered by React Three Fiber.**

Transform grayscale heightmaps and GeoTIFFs into professional 3D line art, structural reliefs, and architectural sketches. `erzberg` leverages advanced differential geometry and physically-based simulation to extract the "bones" of your terrain.

### 🌐 Live Version
**[sorny.github.io/erzberg](https://sorny.github.io/erzberg/)**

---

## 🚀 Key Innovations

### 🛡️ Layered Ghost Occlusion (Signature)
Unlike standard terrain-based culling, `erzberg` generates invisible **3D geometric curtains** for every individual line segment. This enables true line-to-line depth awareness and allows for **Artistic Ghosting**—hidden lines can be styled with custom colors and opacities (e.g., a faint red "x-ray" look for lines behind mountain massifs).

### 📐 11 Algorithmic Draw Modes
Fully independent rendering layers with granular per-mode styling, dash patterns, and hypsometric tinting:
- **Crest Extraction**: High-fidelity ridge detection using Hessian matrix eigenvalue analysis.
- **Topographic Troughs**: Scale-aware valley extraction via Topographic Position Index (TPI).
- **Pro Contours**: Unit-aware isolines (meters for GeoTIFF) with major/minor hierarchical bolding.
- **And More**: Ridgelines (X/Y), Crosshatch, Hachure, Flow Lines (Euler-integrated), Network (Strahler thinning), Pencil Shading (Laplacian), and Pillars.

### 🌊 Hydraulic Erosion
A physically-correct, droplet-based simulation implementing **Hans Beyer's research**. Carve natural drainage patterns, riverbeds, and basins directly into your heightmap with real-time controls for inertia, gravity, and sediment capacity.

---

## 🛠 Tech Stack

| Layer | Library |
|---|---|
| **3D Engine** | [React Three Fiber](https://github.com/pmndrs/react-three-fiber) + [Three.js](https://github.com/mrdoob/three.js) |
| **Helpers** | [Drei](https://github.com/pmndrs/drei) |
| **State** | [Zustand](https://github.com/pmndrs/zustand) + [React](https://github.com/facebook/react) |
| **GIS Parsing** | [GeoTIFF.js](https://github.com/geotiffjs/geotiff.js) |
| **Industrial UI** | [Leva](https://github.com/pmndrs/leva) + Tailwind CSS |
| **Concurrency** | Multi-threaded Web Workers for geometry and erosion |

---

## 📖 Documentation & Wiki

Deep-dives into the mathematical foundations and implementation details:
- **[Mathematical Background of Draw Modes](docs/Draw-Modes.md)**
- **[Hydraulic Erosion Algorithm](docs/Hydraulic-Erosion.md)**

---

## 📦 Exporters

- **Projected SVG**: High-precision vector lines with true software Z-buffer ghost occlusion.
- **4K PNG**: Professional raster exports with native WebGL alpha capture (no halos).
- **3D STL**: Ready for 3D printing.
- **Heightmap**: 1:1 greyscale PNG of the processed topographic grid.

---

## 🧪 Development & Testing

### 🏃 Running Locally
```bash
git clone https://github.com/sorny/erzberg.git
cd erzberg
npm install
npm run dev
```

### 🧪 Automated QA
This project uses [Playwright](https://playwright.dev/) for rendering validation.
- **Full Suite**: `npm run test`
- **UI Mode**: `npm run test:ui`
- **Visibility Smoke Test**: `npx playwright test tests/lines.spec.js`

---

## 📜 Changelog

### v0.2.1 (2026-04-22)
*High-Res Fidelity Update*
- **Export Scaling**: Fixed line weights and particle sizes in 4K PNG exports; they now perfectly match the visual thickness of the viewport.

### v0.2.0 (2026-04-22)
*Cinematic Camera & Precision Update*
- **Cinematic Camera Suite**: Dedicated Camera section with Orthographic projection, Focal Length (FOV) control, and precise X/Y target Panning.
- **Improved Framing**: Content-based centering and auto-zoom for GeoTIFFs and PNGs (ignoring NoData/transparent areas).
- **Omnidirectional Occlusion**: Refactored curtain geometry for perfect occlusion from all angles (360° tilt).
- **Smart UI**: Dynamic browser tab titles and refined visual defaults.

### v0.1.0 (2026-04-21)
*Initial Alpha Release*
- **11 Algorithmic Draw Modes**: Implementation of high-fidelity topographic feature extraction.
- **Curtain-Based Ghost Occlusion**: Unique 3D geometric culling system.
- **Droplet-Based Hydraulic Erosion**: Physically correct simulation.
- **Pro Exporters**: 4K PNG, SVG, and STL suite.

---

## 📄 License & Credits
- **MIT License**: Copyright (c) 2026 sorny.
- **Research**: Hydraulic erosion is based on [**"Implementation of a Method for Hydraulic Erosion"** by Hans Beyer](https://ardordeosis.github.io/implementation-of-a-method-for-hydraulic-erosion/thesis-beyer.pdf).
