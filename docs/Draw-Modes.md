# Draw Modes: Mathematical Background

The `erzberg` rendering engine transforms a 2D scalar field (the heightmap grid) into expressive 3D line art. It provides 11 independent draw modes, each extracting different topographic features using specific mathematical techniques.

---

### 1 & 2. X Lines / Y Lines (Ridgelines)
These modes sample the terrain grid at fixed intervals along the X or Y axis.
- **Math**: The terrain is treated as a 2D array $H(x, y)$. Lines are drawn by stepping through rows (or columns) at a defined `spacing` interval. Vertices are connected between $H(x, y)$ and $H(x+1, y)$ (for X-lines) or $H(x, y+1)$ (for Y-lines).

### 3. Crosshatch
A combination of X Lines and Y Lines, creating a textured structural grid.

### 4. Pillars
Visualizes the terrain as discrete vertical bars (extrusion).
- **Math**: For a sampled cell at $(x, y)$, a line segment is drawn from a base (controlled by `pillarDepth`) up to the surface elevation (minus `pillarGap`).

### 5. Contours (Isolines)
Draws continuous lines connecting points of equal elevation.
- **Math**: Implemented using **Fast Marching Squares**.
  - Supports **Major Contours**: Every $N$-th line is identified and drawn into a separate bold layer using a phase-offset logic.
  - **GIS-Aware**: If a GeoTIFF is loaded, intervals are calculated in real-world **meters**.

### 6. Hachure
Draws short strokes pointing down the slope (classic cartographic shading).
- **Math**: Calculates the terrain gradient $\nabla H$. A stroke is drawn in the direction of $-\nabla H$ with a length proportional to the slope magnitude.

### 7. Flow Lines
Generates continuous trails that follow the drainage vector field.
- **Math**: Uses **Euler integration** through the continuous gradient field.
  - **Occupancy Mask**: Prevents visual clumping by blocking new lines from entering cells already occupied by existing flow paths.

### 8. Stream Network (DAG Thinning)
Visualizes river systems based on flow accumulation.
- **Math**: Based on **Strahler Stream Order**. Performs a topological sort to accumulate upstream area (flow) at every cell.

### 9. Pencil Shading
Creates a hand-drawn look by detecting sharp ridges and valleys.
- **Math**: Calculates the discrete **Laplacian** $\nabla^2 H$ (mean curvature). If the magnitude exceeds a threshold, an oriented "X" cross-hatch is drawn.

### 10. Ridge Detection (Differential Geometry)
Extracts mathematically precise crest lines, cliffs, and mountain top ranges.
- **Math**: Based on the **Hessian Matrix** $J = \begin{pmatrix} H_{xx} & H_{xy} \\ H_{xy} & H_{yy} \end{pmatrix}$.
  1. **Eigenvalue Analysis**: Calculates the eigenvalues $\lambda_1, \lambda_2$ of the Hessian. $\lambda_1$ represents the maximum principal curvature.
  2. **Crest Extraction**: Points are identified where $\lambda_1 \ll 0$ (concave-down) and $|\lambda_1|$ is a local maximum in the direction of the principal curvature.
  3. **Connectivity**: Neighboring ridge points are connected to form continuous, "thin" topographic paths.
- **Parameters**: 
  - **Radius**: Controls the pre-smoothing scale (small = micro-cliffs, large = mountain ranges).
  - **Threshold**: Controls the minimum sharpness required to be drawn.

### 11. Valley Detection (TPI)
Extracts basins, troughs, and valley floors.
- **Math**: Uses the **Topographic Position Index (TPI)**:
  $$ TPI = Z_{center} - \bar{Z}_{radius} $$
  Where $\bar{Z}$ is the mean elevation in a neighborhood of size `radius`.
- **Logic**: $TPI < -Threshold$. Extracts areas that are significantly lower than their surroundings.
- **Efficiency**: Calculated in **$O(N)$ constant time** using an Integral Image (Summed Area Table).

---

### Layered Rendering & Ghost Occlusion (Signature Feature)

All modes run independently and push their geometry into an array of `LineLayers`. 
1. **Curtains**: Every line segment generates an invisible **3D geometric "Curtain"** mesh extending vertically.
2. **Omnidirectional Occlusion**: Curtains act as high-precision depth buffers, ensuring lines only occlude other lines (solving the "terrain-swallows-lines" bug).
3. **Ghosting**: Supports a multi-pass strategy where hidden segments are rendered with custom "Ghost" color and opacity, providing professional X-ray topographic views.
