# Draw Modes: Mathematical Background

The `heightmap-r3f` rendering engine transforms a 2D scalar field (the heightmap grid) into expressive 3D line art. It provides 9 independent draw modes, each extracting different topographic features using specific mathematical techniques.

This document outlines the theoretical background for each mode, all of which operate natively in $O(N)$ or $O(N \log N)$ complexity on the CPU-side Web Worker.

---

### 1 & 2. X Lines / Y Lines (Ridgelines)
These modes sample the terrain grid at fixed intervals along the X or Y axis.
- **Math**: The terrain is treated as a 2D array $H(x, y)$. Lines are drawn by stepping through rows (or columns) at a defined `spacing` interval. Vertices are connected between $H(x, y)$ and $H(x+1, y)$ (for X-lines) or $H(x, y+1)$ (for Y-lines).
- **Styling**: `shift` offsets the starting grid index, allowing the lines to animate or offset across the terrain.

### 3. Crosshatch
A combination of X Lines and Y Lines.
- **Math**: Simply invokes both the X and Y ridgeline builders at the identical `spacing` to create a grid-like wireframe structure matching the topography.

### 4. Pillars
Visualizes the terrain as discrete vertical bars (like a voxel or point-cloud extrusion).
- **Math**: For a sampled cell at $(x, y)$, a line segment is drawn from the absolute floor $Z_{min}$ up to the surface elevation $H(x, y)$.

### 5. Contours (Isolines)
Draws continuous lines connecting points of equal elevation.
- **Math**: Implemented using the **Fast Marching Squares** algorithm.
  1. The elevation range is quantized into steps based on the `interval` parameter.
  2. For each quantized elevation level $L$, every $2 \times 2$ cell neighborhood is evaluated to form a 4-bit index ($0$-$15$).
  3. A lookup table dictates the topology of the line segment crossing the cell. The exact entry/exit points on the cell edges are calculated using linear interpolation: $t = \frac{L - H_a}{H_b - H_a}$.

### 6. Hachure
Draws short, disconnected strokes pointing directly down the slope, a classic cartographic technique for shading terrain.
- **Math**: 
  1. The terrain gradient vector $\nabla H = \left( \frac{\partial H}{\partial x}, \frac{\partial H}{\partial y} \right)$ is calculated using finite differences.
  2. The slope magnitude $|\nabla H|$ determines the steepness.
  3. A stroke of length proportional to $|\nabla H|$ is drawn in the direction of $-\nabla H$. 
  4. If the gradient magnitude is below a threshold ($< 0.005$), no line is drawn (flat areas remain unshaded).

### 7. Flow Lines
Generates continuous trails that flow downhill, visualizing the drainage vector field.
- **Math**: 
  1. Uses **Euler integration** through the continuous gradient field.
  2. Starting at a seed point, the continuous gradient $\nabla H$ is sampled using **Bilinear Interpolation** of the 4 nearest grid cells.
  3. The particle steps forward in the direction of $-\nabla H$ by `step` size.
  4. **Occupancy Mask**: To prevent the resulting lines from clustering into visually messy clumps at the bottom of valleys, the grid maintains a boolean mask. Once a grid cell has a flow line pass through it, no new flow lines are allowed to start there or enter it.

### 8. Stream Network (DAG Thinning)
Visualizes hierarchical drainage basins and river networks.
- **Math**: Based on a simplified **Strahler Stream Order** and Flow Accumulation model.
  1. **Steepest Descent**: Every cell $(x, y)$ evaluates its 8 Moore-neighborhood neighbors to find the one with the lowest elevation. This forms a Directed Acyclic Graph (DAG) pointing downhill.
  2. **Accumulation**: A topological sort is performed (by sorting all cells by elevation descending). A "water drop" is placed at every cell, and this water is passed down the DAG. The accumulator $A(x,y)$ counts how much upstream area drains into that cell.
  3. **Thinning Threshold**: Only edges in the DAG where the target node's accumulation $A > Threshold$ are drawn. This filters out tiny upstream tributaries and leaves only the major "rivers".

### 9. Pencil Shading
Creates a hand-drawn, cross-hatched look by detecting sharp ridges and valleys.
- **Math**:
  1. Calculates the discrete **Laplacian** $\nabla^2 H$ (the divergence of the gradient, representing mean curvature):
     $$ \nabla^2 H \approx H(x-1, y) + H(x+1, y) + H(x, y-1) + H(x, y+1) - 4H(x, y) $$
  2. The absolute value of the curvature is compared to the user's `threshold`.
  3. If the threshold is exceeded, a diagonal "X" mark is drawn at the vertex, with its size proportional to the curvature magnitude.

---

### Layered Rendering & Ghost Occlusion

All 9 modes run independently and push their geometry into an array of `LineLayers`. 
To ensure deep, structural clarity:
1. Every line segment automatically generates an invisible "Curtain" mesh dropping down to the floor.
2. The WebGL renderer uses a multi-pass depth strategy (`LessEqual` for visible, `Greater` for hidden).
3. The SVG Exporter implements a rigorous software Z-buffer, rasterizing these curtains to cull or "ghost" vector lines that fall behind foreground topography.
