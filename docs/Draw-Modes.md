# Draw Modes

erzberg treats the heightmap as a discrete scalar field $H(x, y)$. Thirty-seven
independent builders extract features from it. Each mode produces its own
`LineSegmentsGeometry`, with its own style, dash and hypsometric tint.

Thirty-six modes read $H$ only. [Land cover](#land-cover) reads a second
field. Any mode can be stencilled by a land-cover class, a drawn mask, or both.
See [Land cover](Land-Cover.md#how-masking-works) and
[Masks](Masks.md#how-it-reaches-the-draw-modes).

---

## 1. Lines

Parallel draped ridgelines at a bearing $\theta$. Lines sit at
$p_k = k \cdot \text{spacing} + \text{shift}$ along the normal
$(-\sin\theta, \cos\theta)$. The builder samples each line in unit-cell steps
along $(\cos\theta, \sin\theta)$ with bilinear elevation. At 0° and 90° the
samples land on grid rows and columns.

## 2. Crosshatch

Lines at $\theta$ and at $\theta + 90°$, merged into one layer.

## 3. Pillars

A vertical segment per sampled cell, from a set base depth up to $H(x, y)$
minus a gap.

## 4. Contours

Marching Squares with linear edge interpolation. A level $e$ is major if
$\lfloor e / \text{majorInterval} \rfloor \neq \lfloor (e - \text{interval}) / \text{majorInterval} \rfloor$.
Major and minor lines are separate layers.

**Interval in metres.** With a GeoTIFF, the slider shows metres. The app stores
the interval in world units and converts both ways through
`metresPerWorldUnit`. Contour labels use its companion `gridValueToMetres`, so
the slider and the labels cannot disagree. The exaggeration slider is part of
the conversion. The slider range follows the raster, from about a thousand
contours down to two.

**Levels sit at $\min + k \cdot \text{interval}$.** The ladder is anchored to
the floor, so the bottom band is always one interval thick and the same lines
draw at any exaggeration. Level 0 draws nothing on solid ground, and draws the
shoreline where the raster has NoData.

**Smoothing (form lines).** The builder chains each level into polylines, then
applies Chaikin corner-cutting: each vertex becomes two points at the ¼ and ¾
positions of its edges. Closed rings smooth as loops. Open chains keep their
endpoints. Smoothing is horizontal only, and *Close contours* is applied after
it.

**Labels.** The contour breaks, and its height sits in the gap at the angle of
the line.

- Placement runs in arclength on the chained polyline. Each candidate moves to
  the straightest spot nearby. A stretch that is still bent stays unlabelled.
- Text runs in $+x$, because the scene orbits.
- The worker decides *where* (`buildContours`). The main thread decides *what*
  and draws it (`useContourLabels`), because only it has the elevation range
  and the font.
- The gap width comes from the character count, plus a set clearance.
- Erasure is by box, over all segments of the level. Arclength erasure misses
  hairpins and other chains at the same level.
- Labels have their own flat ink, which defaults to the contour colour.
- With a GeoTIFF, labels are metres, read through the histogram. With a PNG,
  labels are height above the lowest ground.

## 5. Hachure

The gradient $\nabla H$ from central differences. A stroke from each cell
centre along $-\nabla H$, with length proportional to $|\nabla H|$. Cells below
a slope threshold are skipped.

**Lehmann.** The second style draws downslope hachures confined to contour
bands. Each stroke is traced from its seed uphill to the top of its band and
downhill to the bottom, and stops 8% short of both. The gap marks the contour.
Seeds run steepest first. A seed is refused inside a clearance of
$p\,(1 + 3(1 - s^{1/\gamma}))$ around another stroke, where $p$ is the spacing
and $s$ is the slope against its 95th percentile. Steep ground is dense and
gentle ground opens out. A stroke also ends where the fall line turns by more
than 45°.

## 6. Flow Lines

Forward Euler through the gradient field:

$$\mathbf{p}_{n+1} = \mathbf{p}_n - \alpha \, \nabla H(\mathbf{p}_n)$$

**Seeding.** Seeds sit on a grid with pitch `spacing / scl` cells, sorted by
descending elevation. Ridges seed first. A path claims cells in an occupancy
mask, and a seed on a claimed cell is skipped.

**Termination.** A path stops at the grid edge, on flat ground
($|\nabla H| < \varepsilon$), or at an occupied cell. The segment count is thus
bounded by $\text{rows} \times \text{cols}$.

## 7. Stream Network

Each cell drains to its lowest neighbour. A topological sort accumulates the
upstream counts. Cells above `threshold` draw as stream segments, which
approximates a Strahler network.

**Weight by flow.** The same sweep sums the flow accumulation $A$, the number of
cells that drain through each one. A line layer has one weight, so a heavier
channel is drawn as $k$ parallel passes, `gap` cells apart:

$$k = 1 + \operatorname{round}\left((k_{\max} - 1)\,\frac{\ln(A / A_{\min})}{\ln(A_{\max} / A_{\min})}\right)$$

The log is necessary because $A$ grows by orders of magnitude towards the outlet.

## 8. Pencil Shading

The 4-neighbour Laplacian:

$$\nabla^2 H(x, y) \approx H(x+1,y) + H(x-1,y) + H(x,y+1) + H(x,y-1) - 4\,H(x,y)$$

Where $|\nabla^2 H|$ exceeds the threshold, a small mark is drawn across the
gradient.

## 9. Ridge Detection

The Hessian from second differences:

$$\mathcal{H} = \begin{pmatrix} H_{xx} & H_{xy} \\ H_{xy} & H_{yy} \end{pmatrix}$$

With eigenvalues $\lambda_1 \leq \lambda_2$, a cell is a ridge when
$\lambda_1 < -\text{threshold}$ and $|\lambda_1|$ is a local maximum along its
eigenvector. `radius` pre-smooths the field (small finds cliff edges, large
finds range crests).

## 10. Valley Detection

The Topographic Position Index:

$$\mathrm{TPI}(x, y) = H(x, y) - \bar{H}_r(x, y)$$

Cells with $\mathrm{TPI} < -\text{threshold}$ draw as valley segments. A
summed-area table gives $\bar{H}_r$ in $O(N)$, so radius does not change cost.

## 11. Stipple

Candidates on a grid of pitch `spacing`, jittered by up to
`jitter × spacing`. Each samples $d \in [0,1]$:

| Density mode | $d$ |
|---|---|
| Slope | $\|\nabla H\| / \|\nabla H\|_{\max}$ |
| Inv Slope | $1 - d_{\text{slope}}$ |
| Elevation | $(H - H_{\min}) / (H_{\max} - H_{\min})$ |
| Inv Elevation | $1 - d_{\text{elev}}$ |

A dot is kept with probability $d^\gamma$. Each dot is a degenerate segment that
the GPU draws round at the layer `weight`. The SVG writes `<circle>`. A
mulberry32 PRNG seeded by `seed` makes the pattern reproducible.

## 12. Engraving

Copperplate cross-hatch: stroke density encodes shadow.

**Tone.** With the normal $\mathbf{n} \propto (-H_x, 1, -H_y)$ and a light
$\mathbf{l}$ at the set azimuth and 45° altitude:

$$D = \big(1 - \max(0, \mathbf{n} \cdot \mathbf{l})\big)^{\gamma}$$

`contrast` is $\gamma$.

**Layers.** Up to four directions at $\theta + \{0°, 90°, 45°, 135°\}$. Layer
$k$ of $L$ draws only where

$$D \geq \frac{k + 1}{L + 1}$$

**Strokes.** Parallel lines of pitch `spacing` march in unit-cell steps and
drape bilinearly. A stroke breaks when the surface becomes too bright, leaves
the mask or leaves the elevation cut.

## 13. Rock & Scree

Swisstopo-style rock in two sub-layers. With $s = |\nabla H| / |\nabla H|_{\max}$:

- **`Swiss-Rock`.** Cells with $s \geq$ `cliff` get a downslope stroke of length
  $\propto (0.6 + 1.2\,s)$ times `stroke len`, with a seeded sideways wobble.
  The far end is re-draped.
- **`Swiss-Scree`.** Cells in $s \in [0.45\,T,\, T)$ below the cliff threshold
  $T$ keep a jittered dot with probability
  $p = \text{density} \cdot \frac{s - 0.45\,T}{T - 0.45\,T}$, so dots thicken
  toward the rock.

Both share the mode seed.

## 14. Curvature

Streamlines through the principal-curvature field, so strokes wrap the form.

**Field.** Pre-smooth by `radius`, then take the Hessian as in §9:

$$\lambda_{\pm} = \tfrac{1}{2}\Big(\mathrm{tr}\,\mathcal{H} \pm \sqrt{(\mathrm{tr}\,\mathcal{H})^2 - 4\det\mathcal{H}}\Big)$$

| `dirMode` | Eigenvalue | Reads as |
|---|---|---|
| Across form | larger $\|\lambda\|$ | Lines hoop around a ridge |
| Along form | smaller $\|\lambda\|$ | Strokes comb along ridges and valleys |

Selection is by magnitude, so a mode means the same on a crest and in a basin.
The eigenvector comes from the better-conditioned Hessian row.

**Strength** is always $\max(|\lambda_-|, |\lambda_+|)$. On a ridge the minimum
curvature is zero, so a threshold on the selected eigenvalue would erase Along
form. `threshold` is a fraction of the maximum strength.

**Spacing.** Jobard–Lefebvre: seeds on a grid, sorted by strength. Each line
integrates both ways in `step` steps, up to `length`, and stops at owned ground.
The direction is sign-aligned with the previous step. A line claims a disc of
half the seed pitch. A full pitch chops every stroke into a stub.

## 15. Isophotes

Lines of constant illumination: marching squares over
$D = (1 - \max(0, \mathbf{n}\cdot\mathbf{l}))^{\gamma}$, the same Lambert field
as Engraving (`lambertDarkness`), at 45° altitude.

**Azimuths are true bearings.** 0° is north, 90° east. `lightVector` in
`geometryBuilders.js` builds $(\sin az, \sin alt, -\cos az)$. Every sun opens at
315°. Flashbulb and Halation open at 45°, because their azimuth was tuned
together with distance, height and exposure. Before v1.14.0 the scale was a
quarter turn off. Presets and sessions are migrated on load.

- **Pre-smoothing** (`radius`, default 6) is required, because a normal is a
  derivative. On the reference terrain, radius 0 gives 1 386 994 segments and
  radius 6 gives 87 372.
- **Levels** are a count: $L$ levels at $k/(L+1)$, strictly inside $(0,1)$.
- **Chaining.** Segments chain into polylines with `chainLevelSegments`, then
  optional Chaikin smoothing.
- **Draping.** An isophote is not level, so every vertex drapes, in unit-cell
  steps even where a simplified chord is longer.
- **NoData is a hole.** Cells with a masked corner are skipped.

## 16. Bitplane

The terrain as a tilemap. Normalised elevation is cut into $N$ tiers:

$$t(r,c) = \left\lfloor \hat{H}(r,c) \cdot N \right\rfloor, \qquad y = \min + t \cdot \frac{\max - \min}{N}$$

$\hat{H}$ is `normElev`, so the steps follow the terrain at any exaggeration,
including a negative one.

**Staircase.** Where neighbours sit on different tiers, the whole shared cell
edge is emitted at the higher tier. That is marching squares without
interpolation. Only east and south neighbours are tested, so each edge is
visited once. **Risers** add the verticals down to the lower plateau.

**Screen.** A 4×4 Bayer matrix over the residual $f = \hat{H} \cdot N - t$:

$$\text{ink}(r,c) \iff f \cdot \text{dither} > \frac{B[r \bmod 4][c \bmod 4] + \tfrac12}{16}$$

`Bitplane-Step` and `Bitplane-Screen` are separate layers. Hypsometric tint
reads the tier.

## 17. Flashbulb

A bare bulb in the scene. The near flank blows out, the far side goes solid,
and grain carries the tone between.

A point light at world position $L$, with falloff:

$$E = \frac{\max(0,\; \hat{n} \cdot \hat{d})}{1 + (r/r_0)^2}, \qquad d = L - P,\; r = |d|$$

- The bulb is set as **azimuth, distance and height**. Distance and height are
  fractions of the terrain half-diagonal and elevation range, so one setting
  frames any terrain.
- Exposure is referenced to the **68th percentile** (a 512-bin histogram), not
  the brightest cell. The defaults give about 40% ink on a reference massif.
- **Shadows are marched** in grid coordinates, with the same step count as the
  shader's `hillshadeCastShadows`. Cells that face away or are already solid
  skip the march.
- **Grain is blue noise**: a 64×64 toroidal void-and-cluster tile (Ulichney
  1993), indexed per sample, not per cell. Dot size cannot vary, because
  `weight` is per layer.
- **Solarise** folds the tone: $T \rightarrow |2T - 1|$.

## 18. Halation

Flashbulb, plus the glow a blown highlight throws into the shadow beside it.
Only overexposure scatters:

$$\text{over} = \max\!\left(0,\; \frac{E}{E_\text{ref}} \cdot \text{exposure} - 1\right), \qquad \text{bloom} = \text{boxBlur}(\text{over},\, \text{radius})$$

A blur of the exposure gradient would bloom every ridge. The blur is the
mask-aware `boxBlur`, in sample pitches.

- **`Halation-Grain`**: $\max(0,\, T - \text{bloom} \cdot \text{bleed})$. The
  subtraction is the halation.
- **`Halation-Bloom`**: $\text{bloom} \cdot \text{glow} \cdot T$, so the halo
  shows only on dark ground.

The two read the noise tile at a half-tile offset, so halo dots do not land on
grain dots. The optics (`flashExposure`, `flashShadowed`, `flashTone`) are
shared with Flashbulb. With glow off, the two modes agree cell for cell.

## 19–22. Descent with mass: Fall Line, Berms, Air, Race Line

Flow (§6) is massless. This family integrates a velocity:

$$\mathbf{a} = \frac{-g\,\nabla H}{1 + k|\nabla H|^2} - (\mu + \kappa|\mathbf{v}|)\,\mathbf{v}, \qquad \mathbf{v} \leftarrow \mathbf{v} + \Delta t\,\mathbf{a}, \quad \mathbf{p} \leftarrow \mathbf{p} + \Delta t\,\mathbf{v}$$

Integration is semi-implicit, because explicit Euler gains energy in bowls.

**Carve.** The heading turns at most $\omega_\text{max}\Delta t$:

$$\omega_\text{max} = \frac{a_\text{lat}}{|\mathbf{v}|} \quad\Longrightarrow\quad r = \frac{|\mathbf{v}|^2}{a_\text{lat}}$$

$a_\text{lat}$ maps to $0.12 \cdot a_\text{peak} \cdot 0.03^{\,\text{carve}}$,
the band where the clamp binds across the whole slider.

- **Gravity** is normalised by the mean slope, not `maxSlope`. One cliff cell
  otherwise makes all other ground read as flat.
- **The surface is pre-smoothed**, because a rider has length.
- A run shorter than its seed spacing is dropped.

**Fall Line.** The track. The hypsometric slot carries $|\mathbf{v}|/v_\text{max}$,
so the gradient becomes a speed ramp.

**Berms.** A tick on the outside of each turn, of length
$|\mathbf{v}|\,|\Delta\theta| / a_\text{lat}$: 1 where the clamp binds. An even
plane draws nothing.

**Air.** A flight starts where the ballistic path clears the surface, and is
drawn on its true parabola, with a run-in sub-layer. The descent is tracked per
cell, not per step, or an accelerating rider on a plane reads as airborne.
`airGravity` 0.3 and `lip` 0.12 are the lowest pair where a plane yields zero
flights and a real break still fires. Flights shorter than `minAir` are dropped.

**Race Line.** One seed, headings fanned across ±θ, no occupancy mask. The run
that reaches the lowest ground soonest goes to its own heavier sub-layer.

## 23. Section

A cutting plane drawn as a drawing: a heavy **face** at the plane, 45° hatch on
the solid **below**, and the ground **beyond** in outline. The hatch uses the
Engraving marcher, thresholded on height. Face and hatch lie exactly in the
plane. On a cone, the hatched area grows as the plane rises.

## 24. Crossings

Sign changes of each scanline after its running mean is removed. Mark density
is the local pitch of the terrain: dense on scree, empty on a glacier, whatever
the slope. Without the detrend, a mountain gives two dots.

## 25. Sprite Blocks

The plateaus of Bitplane, one cuboid per cell. The top sits at the tier height.
A side drops only to a lower neighbour's tier, so each step has one riser. Tops
ship as a `lids` mesh, so the stack self-occludes.

## 26. Reticulation

Crazed emulsion: the walls between Worley cells.

$$F_1, F_2 = \text{the two smallest distances to jittered feature points}, \qquad \text{wall} \iff F_2 - F_1 < w$$

One feature point per coarse cell, jittered by `mulberry32`. Nine bucket lookups
per sample, with no Voronoi structure. Wall width scales with cell size, so
coverage stays constant. A tone gate (the Stipple density modes) keeps walls in
the shadows.

---

## 27–32. Colour modes: Indexed, Outrun, Riso, Mineral, Watershed, Land cover

All other modes colour through one function, `computeVertexColor`: one scalar
into one gradient. These six break that. Four draw area through the `lids` mesh.
Outrun and Riso change the blend.

### Indexed

Two quantities index one palette:

$$e = \left\lfloor \hat{H} \cdot N_e \right\rfloor, \qquad
  s = \left\lfloor \hat{S}^{0.6} \cdot N_s \right\rfloor$$

The slope axis separates a snowfield from the cliff beside it. A 4×4 Bayer
screen dithers between adjacent entries. The palette is the shared gradient,
quantised, because `gradientStops` is already in `GEOMETRY_NON_SCALAR`. This
is the dual of Bitplane, and the two stack.

### Outrun

An additive wide halo under a thin near-white filament. Where contours crowd,
halos sum and the ground glows. Halo and filament are two layers, because
`weight` is per layer. Only the halo is additive, so the mode still shows on a
white ground.

### Riso

Three spot inks, each a different terrain reading, screened at 15°, 45° and 75°
and multiplied. The screens are frequency-modulated (fixed dot, varying
density), because dot size is per layer. Each separation is stretched to its own
percentile range.

- **Registration** above zero offsets the plates slightly.
- **Coverage cap** limits the total ink of the three, pulling back the ink that
  contributes least. At 3.0 it does not bind. It cannot see other layers.

### Mineral

Slope and curvature pick one of five materials, each with a flat colour and its
own grain. Both cuts are **percentiles**, not fractions of the maximum. Curvature
uses a blurred grid.

### Land cover

The only mode that reads something other than $H$:

$$
C(i) = \begin{cases}
  \text{plate}(i) \cdot g(i) & \text{source} = \text{plate} \\
  \text{palette}[k(i)] \cdot g(i) & \text{source} = \text{class}
\end{cases}
$$

$k(i)$ is the class and $g(i)$ is the Mineral grain hash, seeded by class.
Regions are keyed by class, not colour, so the SVG traces six regions and not
one per cell. The mode has `needsData` in `drawModes.js`, so the randomiser skips
it.

### Watershed

Every cell walks steepest descent (D8) to a sink and takes its label. One flat
ink per catchment. The divides are ridgelines.

- The walk runs on a blurred grid. A raw DEM gives thousands of one-cell basins.
- Small basins fold into their largest neighbour, with path compression. A fold
  is accepted only if it grows the target, which keeps the graph a forest.

### Filled areas in the SVG

`fillCells` ships the lattice it painted. `traceAreaRings` in
`src/utils/areaRings.js` walks it into closed rings. The exporter writes one
`<path>` per ink, in a pen layer named like `Watershed · ink 03 #e04f2a`, and
drops that mode's lines.

- **Keyed by ink, not region.** Two neighbouring basins with the same ink merge.
  Keyed by region, the reference plate gave 31 189 shapes instead of 10.
- **Winding.** Outer rings are clockwise, holes counter-clockwise, in one
  `<path>` under `fill-rule="evenodd"`.
- **Occlusion.** With Occlusion on, a cell whose centre fails the depth test is
  dropped. With it off, every area is whole.
- **The cut edge steps at the lattice pitch**, so it can differ from the line
  silhouette by half a cell.

On the sample plate, Indexed, Mineral and Watershed export 6, 5 and 10 pen
layers. A mirrored scene has no lattice and falls back to boundary lines.

---

## 33. Shadow Line

Where sunlight stops, at one date and time. `litField` runs one pass of the Sun
Hours sweep (§34): 1 if the ground is lit (not blocked, and facing the sun), 0
if not, −1 with no ground. The line is the 0.5 level, so it includes both cast
shadow and self-shading.

On the benchmark raster at midwinter:

| local time | sun | segments |
|---|---|---|
| 07:30 | 122°, 3° up | 5 804 |
| 09:00 | 138°, 16° up | 2 147 |
| 12:00 | 180°, 29° up | **293** |
| 15:00 | 223°, 15° up | 2 811 |
| 16:30 | 238°, 2° up | 4 618 |
| 18:00 | below the horizon | 0 |

A sun below the horizon draws nothing, and the panel says so. Unlike Sun Hours,
this mode needs the longitude and time zone. See
[Georeferencing](Georeferencing.md).

## 34. Sun Hours

Isolines of hours in direct sun, over a year or one date. For each sun position,
a cell gains its hours if the terrain does not block the sun and
$\mathbf{n}\cdot\mathbf{l} > 0$.

**The sweep.** The grid is walked in the sun's direction, carrying the shadow
height:

$$S_i = \max\bigl(e_i,\, S_{i-1} - d\tan\alpha\bigr)$$

A cell is dark when $S_{i-1} - d\tan\alpha$ is above it. One $O(\text{cells})$
pass per sun position. The walk follows the sun's dominant axis and interpolates
the other. 96 positions over 512² take 150 ms, 1024² about 1 s. `cost: 7` is the
highest in `drawModes.js`.

- **No clock.** The day is walked in hour angle from $-H_0$ to $+H_0$, with
  $\cos H_0 = -\tan\varphi\tan\delta$. Only latitude and date matter.
- **Levels** use a 1-2-5 hour step fitted to the field's range. One extra level
  at 0.5 h traces the ground that never sees the sun.
- **NoData is a hole.**

## 35. Single Line

A weighted stipple, joined by one travelling-salesman tour.

1. **Points.** Rejection sampling against a density field (slope, shade,
   elevation or its inverse, raised to $\gamma$). One point per cell at most.
2. **Tour.** Nearest neighbour through a bucket grid, then 2-opt. The first
   2-opt phase tries only the 8 nearest neighbours of each point. The second
   phase tries every pair. In the plane, two crossing edges can always be
   uncrossed by a shorter 2-opt move. Thus a tour that no pair can improve has
   no crossings.
3. **Open.** Unless *Closed loop* is on, the tour is cut at its longest edge.

Each edge is draped one cell at a time. Both phases stop after 2 s, so a very
large point count can keep a few crossings.

## 36. Shadow Hatch

Parallel strokes at `angle`, and at `angle + 90°` for cross-hatch, drawn only
through cells where `litField` is below 0.5. The mask is the Sun Hours sweep at
one sun position, so it holds cast shadow as well as ground that faces away.
*Outline* adds the Shadow Line terminator at the same sun. Engraving hatches by
$1 - \mathbf{n}\cdot\mathbf{l}$ and cannot see what stands between the ground and
the sun.

## 37. Roughness Mesh

The Terrain Ruggedness Index is the mean absolute height difference to the
eight neighbours:

$$\text{TRI}_i = \frac{1}{8}\sum_{j \in N_8(i)} |H_j - H_i|$$

Point density is $f + (1 - f)\,\min(1, \text{TRI}/\text{TRI}_{98})^{\gamma}$,
where $f$ is the floor. The points are triangulated with Delaunator. *Delaunay*
draws each triangle edge once. *Voronoi* joins the circumcentres of adjacent
triangles. Hull cells stay open, and an edge with an end off the raster is
dropped.

---

## NoData and clipped edges

NoData cells, transparent PNG pixels and everything outside an Edit Mode
selection are recorded in `gridMask` with $H = 0$. Zero is the lowest ground,
not "absent", so every mode guards against it in three ways.

**Sampling: normalised bilinear.** Modes that drape on fractional coordinates
(oblique Lines, Engraving, Flow, Swiss rock, the vector drape) use
`sampleBilinear`:

$$H(\mathbf{p}) = \frac{\sum_k w_k\,m_k\,H_k}{\sum_k w_k\,m_k}$$

$m_k$ is the corner mask. A tap with no data returns NaN, which ends the
stroke.

**Blur: normalised convolution.** `boxBlur` with a mask computes
$\sum w\,m\,v \,/\, \sum w\,m$. It is used only when `terrain.hasNoData`.

**Stencils: NoData reads as flat.** Ridge, Curvature and Pencil Shading use the
centre value for a masked neighbour. Otherwise the selection edge becomes the
strongest crest.

Contours are the exception. A NoData corner is below every level, so isolines
close along the data edge as shorelines.

---

## Ghost Occlusion

Every line segment gets a thin curtain mesh below it, down to the scene base.
The curtains write depth only. In the colour pass, a segment behind a curtain is
hidden, or drawn in the ghost colour and opacity. Lines thus occlude lines,
without the terrain surface clipping them.
