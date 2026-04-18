# heightmap-r3f

A React Three Fiber port of [sorny/heightmap_lines](https://github.com/sorny/heightmap_lines).  
Converts a grayscale heightmap into interactive 3D line art with a Leva control panel.

## Tech stack

| Layer | Library |
|---|---|
| 3D renderer | [React Three Fiber](https://github.com/pmndrs/react-three-fiber) v8 + Three.js v0.168 |
| Fat lines | `three/examples/jsm/lines` — `LineSegments2` / `LineMaterial` / `LineSegmentsGeometry` |
| UI controls | [Leva](https://github.com/pmndrs/leva) v0.9 |
| Global state | [Zustand](https://github.com/pmndrs/zustand) v4 (heightmap pixel data only) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) v3 |
| Bundler | [Vite](https://vitejs.dev/) v5 |

## Running

```bash
cd heightmap-r3f
npm install
npm run dev
# open http://localhost:5173
```

## Swapping heightmaps

- **Via UI**: open the **Heightmap** section in the Leva panel → click **Load image**.  
  Any PNG, JPG, or TIFF is accepted. The tool reads it with `FileReader` — no network call.
- **Default**: replace `public/Heightmap.png` with any greyscale PNG before running.  
  [Tangrams Heightmapper](https://tangrams.github.io/heightmapper) exports OSM-based greyscale PNGs.

## Architecture

```
src/
├── App.jsx                  Root — Leva panels + R3F Canvas
├── store/useStore.js        Zustand — heightmap pixel data only
├── hooks/
│   ├── useHeightmap.js      Load image → Float32Array of brightness values
│   └── useTerrainGeometry.js  Two-level useMemo: terrain grid → line geometry
├── utils/
│   ├── terrain.js           Box blur (integral image O(W×H)), grid sampling
│   ├── geometryBuilders.js  CPU geometry for all 6 draw modes
│   ├── colorUtils.js        Gradient sampling, per-vertex RGB color
│   ├── noise.js             Hash-based valueNoise2D (no p5 dependency)
│   └── svgExport.js         Camera-projected SVG line export
└── components/
    ├── Scene.jsx            OrbitControls, auto-rotate, export triggers
    ├── HeightmapLines.jsx   LineSegments2 GPU line rendering
    ├── SurfaceMesh.jsx      Terrain surface (depth occlusion + fill) — GLSL vertex shader
    └── Controls.jsx         Keyboard shortcuts → Leva setters
```

### Data flow

1. `useHeightmap` loads the image → extracts `Float32Array` of brightness (0–1) → Zustand
2. `useTerrainGeometry` runs two `useMemo` passes:
   - **Pass 1** (terrain): box-blur → sample at `scl` intervals → `{ grid, rows, cols, minZ, maxZ, maxSlope }`  
     Invalidated by: resolution, blur, shiftLines/Peaks, blackPoint/whitePoint, elevScale
   - **Pass 2** (geometry): calls the mode-specific builder → `{ positions: Float32Array, colors: Float32Array }`  
     Invalidated by: any visual param change
3. `HeightmapLines` uploads arrays to `LineSegmentsGeometry` on the GPU
4. `SurfaceMesh` uses a GLSL vertex shader where `elevScale` is a **uniform** — changing it costs only one WebGL API call, zero CPU rebuild

### Performance notes

| Technique | Benefit |
|---|---|
| `LineSegments2` (quads) | True linewidth on all platforms; WebGL `lineWidth > 1` is unreliable in most drivers |
| Two-level `useMemo` | Terrain grid recompute (~5 ms) only when sampling params change; geometry recompute only when layout/visual params change |
| `elevScale` as uniform | Instant on the surface mesh — no JS work at all |
| Box blur via integral image | O(W×H) regardless of radius; same algorithm as the original |
| Per-vertex RGB premult | Slope-opacity baked into RGB, single draw call, no blending state changes |

### GPU vs CPU

The line art geometry is inherently CPU-side because each draw mode (ridgelines, hachure, contours) has complex topology that depends on terrain data. The surface mesh vertex shader is the only path where GPU computation saves CPU work.

For maximum GPU usage, a future enhancement would pass the heightmap as a `THREE.DataTexture` to a vertex shader that procedurally generates a full-resolution mesh — but this would sacrifice the per-mode topology control.

## Draw modes

| Mode | Description |
|---|---|
| lines-x | Horizontal scan lines with Y displacement |
| lines-y | Vertical scan lines |
| curves | Catmull-Rom splines (tightness control) |
| crosshatch | Both X and Y simultaneously |
| hachure | Slope-perpendicular ticks, length ∝ gradient magnitude |
| contours | Marching-squares isolines at fixed elevation intervals |

## Keyboard shortcuts

| Key | Action |
|---|---|
| W A S D | Pan camera target |
| Y / X | Tilt up / down |
| Q | Toggle auto-rotate |
| E | Rotate +45° |
| T | Reset camera |
| I / K | Decrease / increase resolution |
| J / L | Decrease / increase line spacing |
| B / N | Increase / decrease stroke weight |
| F | Cycle draw mode |
| ↑ ↓ | Shift lines |
| ← → | Shift peaks |
| P | Toggle fill |
| M | Toggle mesh |

## SVG export

The SVG exporter projects all line segment endpoints through the current Three.js camera, then writes `<line>` elements. **Depth-buffer occlusion is not reproduced** in the SVG (background lines will show through mountains). For a fully occluded image, use the PNG export.

## License

MIT
