# Draw Modes: Mathematical Background

The `heightmap-r3f` rendering engine transforms a 2D scalar field (the heightmap grid) into expressive 3D line art. It provides 11 independent draw modes, each extracting different topographic features using specific mathematical techniques.

This document outlines the theoretical background for each mode, all of which operate natively in $O(N)$ or $O(N \log N)$ complexity on the CPU-side Web Worker.

---

### 1 & 2. X Lines / Y Lines (Ridgelines)
These modes sample the terrain grid at fixed intervals along the X or Y axis.
- **Math**: The terrain is treated as a 2D array $H(x, y)$. Lines are drawn by stepping through rows (or columns) at a defined `spacing` interval. Vertices are connected between $H(x, y)$ and $H(x+1, y)$ (for X-lines) or $H(x, y+1)$ (for Y-lines).

### 3. Crosshatch
A combination of X Lines and Y Lines.
- **Math**: Simply invokes both the X and Y ridgeline builders at the identical `spacing` to create a grid-like wireframe matching the topography.

### 4. Pillars
Visualizes the terrain as discrete vertical bars (extrusion).
- **Math**: For a sampled cell at $(x, y)$, a line segment is drawn from a base (controlled by `pillarDepth`) up to the surface elevation (minus `pillarGap`).

### 5. Contours (Isolines)
Draws continuous lines connecting points of equal elevation.
- **Math**: Implemented using **Fast Marching Squares**.
  1. The elevation range is quantized based on the `interval`.
  2. Every $2 \times 2$ cell forms a 4-bit index determining the line topology.
  3. Supports **Major Contours**: Every $N$-th line is identified and drawn into a separate bold layer using a phase-offset logic.
  4. **GIS-Aware**: If a GeoTIFF is loaded, intervals are calculated in real-world **meters**.

### 6. Hachure
Draws short strokes pointing down the slope (classic cartographic shading).
- **Math**: Calculates the terrain gradient $\nabla H$. A stroke is drawn in the direction of $-\nabla H$ with a length proportional to the slope magnitude.

### 7. Flow Lines
Generates continuous trails that follow the drainage vector field.
- **Math**: Uses **Euler integration** through the continuous gradient field.
  - **Occupancy Mask**: Prevents visual clumping by blocking new lines from entering cells already occupied by existing flow paths.

### 8. Stream Network (DAG Thinning)
Visualizes river systems based on flow accumulation.
- **Math**: Based on **Strahler Stream Order**.
  1. Forms a Directed Acyclic Graph (DAG) pointing to the steepest descent neighbor.
  2. Performs a topological sort to accumulate upstream area (flow) at every cell.
  3. Thins the network by only drawing edges where the accumulation exceeds a discrete threshold.

### 9. Pencil Shading
Creates a hand-drawn look by detecting sharp ridges and valleys.
- **Math**: Calculates the discrete **Laplacian** $\nabla^2 H$ (mean curvature). If the magnitude exceeds a threshold, an oriented "X" cross-hatch is drawn.

### 10 & 11. Ridge & Valley (TPI)
Extracts structural landforms based on relative topographic position.
- **Math**: Uses the **Topographic Position Index (TPI)**:
  $$ TPI = Z_{center} - \bar{Z}_{radius} $$
  Where $\bar{Z}$ is the mean elevation in a neighborhood of size `radius`.
- **Ridge**: $TPI > Threshold$. Extracts crests that are higher than their surroundings.
* **Valley**: $TPI < -Threshold$. Extracts troughs and basins that are lower than their surroundings.
* **Scale-Aware**: The `radius` allows you to target micro-features (small values) or macro-landforms (large values).
* **Efficiency**: Calculated in **$O(N)$ constant time** using an Integral Image (Summed Area Table), making it responsive even at huge scales.

---

### Layered Rendering & Ghost Occlusion

All modes run independently and push their geometry into an array of `LineLayers`. 
1. **Curtains**: Every line segment generates an invisible "Curtain" mesh dropping down to the floor.
2. **True Line Occlusion**: Curtains act as depth-buffers, ensuring lines are only hidden when truly behind another line (solving the terrain-occlusion bug).
3. **Ghosting**: Supports a multi-pass strategy where hidden segments are rendered with custom "Ghost" color and opacity.
