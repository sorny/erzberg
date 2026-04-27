# Draw Modes

`erzberg` treats the loaded heightmap as a discrete scalar field $H(x, y)$ and extracts topographic features from it using twelve independent algorithms. Each mode produces its own `LineSegmentsGeometry` and can be styled, dashed, and hypsometrically tinted separately.

---

## 1 & 2. X Lines / Y Lines

The terrain grid is traversed row-by-row (X) or column-by-column (Y) at a configurable `spacing` interval. Within each row, adjacent grid samples $H(x, y)$ and $H(x+1, y)$ are connected as a line segment, lifted to their respective elevations in 3D. The `shift` parameter offsets the starting phase of the traversal.

## 3. Crosshatch

Runs the X and Y ridgeline builders simultaneously and merges their output into a single layer.

## 4. Pillars

For each sampled grid cell $(x, y)$, a vertical line segment is drawn from a configurable base depth up to $H(x, y)$ minus a gap. The result is an extruded bar chart of the terrain.

## 5. Contours

Isolines are computed with Marching Squares. The terrain is thresholded at each contour level, and edge intersections are interpolated linearly to produce smooth isoline vertices.

Major contours are identified by a phase-offset rule: a contour at elevation $e$ is major if $\lfloor e / \text{majorInterval} \rfloor \neq \lfloor (e - \text{interval}) / \text{majorInterval} \rfloor$. Major and minor contours are written into separate layers so they can be styled independently.

When a GeoTIFF is loaded, contour intervals are expressed in the file's native elevation unit (metres).

## 6. Hachure

The terrain gradient $\nabla H = (H_x, H_y)$ is estimated at each sampled cell using central differences. A short stroke is drawn from the cell centre in the direction of $-\nabla H$, with length proportional to $|\nabla H|$. Cells below a slope threshold are skipped.

## 7. Flow Lines

Flow paths are integrated through the gradient field using the forward Euler method:

$$\mathbf{p}_{n+1} = \mathbf{p}_n - \alpha \, \nabla H(\mathbf{p}_n)$$

where $\alpha$ is the step size. An occupancy mask prevents new paths from entering cells already traversed, which controls visual density. Each path terminates when it exits the grid boundary or reaches a flat region.

## 8. Stream Network

Flow accumulation is computed by a topological sort of the grid directed acyclic graph: each cell drains to its lowest neighbour, and upstream cell counts accumulate downward. Cells whose accumulated count exceeds the `threshold` parameter are drawn as stream segments. The result approximates Strahler-order river networks.

## 9. Pencil Shading

The discrete Laplacian $\nabla^2 H$ is approximated at each cell using the standard 4-neighbour finite difference:

$$\nabla^2 H(x, y) \approx H(x+1,y) + H(x-1,y) + H(x,y+1) + H(x,y-1) - 4\,H(x,y)$$

Where $|\nabla^2 H|$ exceeds the threshold, a small cross-hatch mark is drawn oriented perpendicular to the local gradient, simulating a pencil shading stroke.

## 10. Ridge Detection

Ridge crest lines are extracted using second-order differential geometry of the height field.

**Hessian.** The symmetric Hessian matrix of $H$ is estimated at each cell using second-order finite differences:

$$\mathcal{H} = \begin{pmatrix} H_{xx} & H_{xy} \\ H_{xy} & H_{yy} \end{pmatrix}$$

**Eigenvalue analysis.** The eigenvalues $\lambda_1 \leq \lambda_2$ of $\mathcal{H}$ give the principal curvatures. A cell is a ridge candidate when $\lambda_1 < -\text{threshold}$ (strongly concave across the ridge) and $|\lambda_1|$ is a local maximum in the direction of the corresponding eigenvector.

**Parameters.** `radius` controls the pre-smoothing scale before differentiation — small values detect micro-features such as cliff edges; large values detect mountain-range crests. `threshold` sets the minimum curvature magnitude required for a cell to qualify.

## 11. Valley Detection

Valley floors and basins are identified using the Topographic Position Index:

$$\mathrm{TPI}(x, y) = H(x, y) - \bar{H}_r(x, y)$$

where $\bar{H}_r$ is the mean elevation within a neighbourhood of radius $r$. Cells where $\mathrm{TPI} < -\text{threshold}$ are significantly lower than their surroundings and are drawn as valley segments.

The neighbourhood mean is computed in $O(N)$ time (where $N$ is the number of grid cells) using a summed-area table, making large radii no more expensive than small ones.

## 12. Stipple

A stochastic dot-density map. Candidate positions are generated on a regular grid with pitch `spacing`, then each is displaced by a random jitter (up to `jitter × spacing` in each axis) to break mechanical regularity. For each candidate, a terrain attribute $d \in [0,1]$ is sampled:

| Density mode | $d$ |
|---|---|
| Slope | $\|\nabla H\| / \|\nabla H\|_{\max}$ |
| Inv Slope | $1 - d_{\text{slope}}$ |
| Elevation | $(H - H_{\min}) / (H_{\max} - H_{\min})$ |
| Inv Elevation | $1 - d_{\text{elev}}$ |

The dot is placed with probability $d^\gamma$, where `gamma` sharpens ($\gamma > 1$) or flattens ($\gamma < 1$) the density contrast. Each accepted dot is emitted as a degenerate line segment of length $\epsilon \ll \text{scl}$, which the GPU renders as a square mark whose diameter equals the layer's `weight` in screen pixels.

---

## Ghost Occlusion

All twelve modes share the same depth-ordering system.

For each line segment, a thin triangulated curtain mesh is generated immediately beneath it, extending vertically to the base of the scene. Curtains are rendered to the depth buffer only (invisible, no colour output). In the subsequent colour pass, line segments that fall behind an existing curtain are occluded — they either disappear or are rendered with a separate ghost colour and opacity, depending on the configured occlusion settings.

This approach gives true line-to-line depth awareness without relying on terrain surface depth, which would cause lines to be clipped by the mesh they are drawn on.
