# heightmap-r3f

A high-performance React Three Fiber topographic visualization suite.  
Transforms grayscale heightmaps and GeoTIFFs into interactive 3D line art and sculpted surfaces with professional-grade terrain analysis tools.

## 🚀 Key Features

- **Physically Correct Hydraulic Erosion**: Droplet-based simulation using Hans Beyer's research. Carve natural drainage patterns with inertia, gravity, and sediment capacity controls. Includes **Undo** support.
- **Advanced Draw Modes**: 
  - **Pillar (Z)**: Vertical extrusion visualization.
  - **Stream Network (DAG)**: Drainage basin analysis.
  - **Pencil Shading**: Curvature-based topographic sketching.
  - **Contours**: High-precision marching squares.
  - **Flow Lines**: Slope-following vector fields.
- **3D Symmetry Navigator**: A 6-directional arrow pad for real-time kaleidoscopic mirroring across X, Y, and Z axes.
- **Texture Overlay**: Drape custom images over the terrain with scale and shift controls.
- **GIS Integration**: Native support for **GeoTIFF** elevation data with real-world unit display (metres).
- **Pro Exporters**: 
  - **SVG**: High-precision projected vector lines with software Z-buffer occlusion.
  - **PNG**: Auto-trimmed raster exports (including transparency support).
  - **STL**: 3D printable meshes.
  - **Heightmap**: 1:1 greyscale PNG export of the processed grid.
  - **WebM**: Real-time high-quality video recording.

## 🛠 Tech Stack

| Layer | Library |
|---|---|
| **3D Renderer** | [React Three Fiber](https://github.com/pmndrs/react-three-fiber) v8 + Three.js v0.168 |
| **GPU Lines** | `LineSegments2` / `LineMaterial` for consistent thick-line rendering |
| **State** | [Zustand](https://github.com/pmndrs/zustand) (Heavy pixel data) + React State (UI) |
| **Concurrency** | Web Workers for heavy geometry & erosion CPU tasks |
| **Styling** | Tailwind CSS |
| **Testing** | Playwright (E2E & Runtime verification) |

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

## 📖 Architecture

- **`src/utils/geometry.worker.js`**: Offloads heavy CPU builds (Terrain, Lines, Surface) using Transferable objects to keep the UI at 60fps.
- **`src/utils/erosion.js`**: Stable physics-based droplet simulation with bilinear sampling and weighted brushes.
- **`src/components/Sidebar.jsx`**: Custom professional dashboard with clickable **(?)** help icons for every complex parameter.
- **`src/components/SurfaceMesh.jsx`**: GLSL-powered terrain rendering with support for hypsometric tinting, banding, and custom textures.

## 🏗 Drawing Modes

- **Ridgelines (X/Y/Cross)**: Classical topographic scanlines.
- **Hachure**: Slope-perpendicular artistic strokes.
- **Network**: Stream-network thinning based on Strahler threshold.
- **Pencil**: Laplacian-driven curvature shading for a hand-drawn look.
- **Pillar (Z)**: Vertical pillars visualizing elevation spikes.

## 📄 License

MIT
