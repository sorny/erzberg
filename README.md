# heightmap-r3f

A high-performance React Three Fiber topographic visualization suite.  
Transforms grayscale heightmaps and GeoTIFFs into interactive 3D line art and sculpted surfaces with professional-grade terrain analysis tools.

## 📖 Wiki & Documentation

Detailed mathematical backgrounds and algorithm documentation can be found in the [Wiki](docs/wiki/):
- **[Draw Modes Mathematics](docs/wiki/Draw-Modes.md)**
- **[Hydraulic Erosion Implementation](docs/wiki/Hydraulic-Erosion.md)**

## 🚀 Key Features

- **9 Layered Draw Modes**: Fully independent layers with per-mode styling, dash patterns, and hypsometric tinting. Mix and match Ridgelines, Contours, Hachure, Flow Lines, Network streams, Pencil shading, and Pillars.
- **Ghost Occlusion**: True line-based depth culling via invisible 3D "curtains". Supports artistic ghosting where hidden lines can be styled with custom colors and opacities (e.g., faint red for lines behind mountains).
- **Physically Correct Hydraulic Erosion**: Droplet-based simulation using Hans Beyer's research. Carve natural drainage patterns with inertia, gravity, and sediment capacity controls. Includes **Undo** support.
- **Continuous Network Thinning**: Realistic river branching powered by Strahler stream order and continuous water accumulation.
- **3D Symmetry Navigator**: A 6-directional arrow pad for real-time kaleidoscopic mirroring across X, Y, and Z axes.
- **External Preset System**: Easily share and load complete 3D scene states (Terrain, Style, Points, View, Gradients) via JSON files in `public/presets/`.
- **GIS Integration**: Native support for **GeoTIFF** elevation data with real-world unit display (metres).
- **Pro Exporters**: 
  - **SVG**: High-precision projected vector lines with true software Z-buffer ghost occlusion.
  - **PNG**: Auto-trimmed raster exports (including transparency support).
  - **STL**: 3D printable meshes.
  - **Heightmap**: 1:1 greyscale PNG export of the processed grid.
  - **WebM**: Real-time high-quality video recording.

## 🛠 Tech Stack

| Layer | Library |
|---|---|
| **3D Renderer** | [React Three Fiber](https://github.com/pmndrs/react-three-fiber) + [Three.js](https://github.com/mrdoob/three.js) |
| **3D Helpers** | [Drei](https://github.com/pmndrs/drei) |
| **GPU Lines** | `LineSegments2` / `LineMaterial` (Three.js) |
| **State** | [Zustand](https://github.com/pmndrs/zustand) + [React](https://github.com/facebook/react) |
| **UI / Controls** | [Leva](https://github.com/pmndrs/leva) |
| **GIS Parsing** | [GeoTIFF.js](https://github.com/geotiffjs/geotiff.js) |
| **Build / Style** | [Vite](https://github.com/vitejs/vite) + [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) |
| **Testing** | [Playwright](https://github.com/microsoft/playwright) |

## 🏃 Running

```bash
cd heightmap-r3f
npm install
npm run dev
# open http://localhost:5173
```

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| **1 - 5** | Export: SVG (1), PNG (2), PNG Alpha (3), STL (4), WebM (5) |
| **F** | Cycle Draw Modes |
| **Q** | Toggle Auto-rotate |
| **E / R** | Rotate CW / CCW |
| **Y / X** | Tilt Up / Down |
| **G** | Toggle Center Guides |
| **Reset** | Reverts all parameters to defaults |

## 🧪 Testing

This project uses [Playwright](https://playwright.dev/) for end-to-end and rendering validation. 

**Ensure your development server is running (`npm run dev`) before executing tests.**

- **Run all tests**: `npm run test`
- **Open interactive UI**: `npm run test:ui`
- **Run line visibility check**: `npx playwright test tests/lines.spec.js`
- **Headed mode (watch browser)**: `npx playwright test --headed`

## 📄 References & Credits
- Hydraulic erosion implementation is based on [**"Implementation of a Method for Hydraulic Erosion"** by Hans Beyer](https://ardordeosis.github.io/implementation-of-a-method-for-hydraulic-erosion/thesis-beyer.pdf).

## 📄 License

This project is licensed under the [MIT License](LICENSE).
