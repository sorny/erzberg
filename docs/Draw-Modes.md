# Draw Modes

`erzberg` treats the loaded heightmap as a discrete scalar field $H(x, y)$ and extracts topographic features from it using fifteen independent algorithms. Each mode produces its own `LineSegmentsGeometry` and can be styled, dashed, and hypsometrically tinted separately.

---

## 1. Lines

Parallel terrain-draped ridgelines at an arbitrary bearing angle $\theta$. Lines sit at perpendicular positions $p_k = k \cdot \text{spacing} + \text{shift}$ along the unit normal $(-\sin\theta, \cos\theta)$ and are sampled in unit-cell steps along the direction $(\cos\theta, \sin\theta)$, with elevations interpolated bilinearly and lifted into 3D. At $\theta = 0°$ and $90°$ the samples land exactly on grid rows/columns, reproducing the classic axis-aligned ridgeline look; oblique angles resample the terrain along rotated rays for diagonal compositions.

## 2. Crosshatch

Runs the Lines builder twice — at the configured angle and at the angle + 90° — and merges both outputs into a single layer.

## 3. Pillars

For each sampled grid cell $(x, y)$, a vertical line segment is drawn from a configurable base depth up to $H(x, y)$ minus a gap. The result is an extruded bar chart of the terrain.

## 4. Contours

Isolines are computed with Marching Squares. The terrain is thresholded at each contour level, and edge intersections are interpolated linearly to produce smooth isoline vertices.

Major contours are identified by a phase-offset rule: a contour at elevation $e$ is major if $\lfloor e / \text{majorInterval} \rfloor \neq \lfloor (e - \text{interval}) / \text{majorInterval} \rfloor$. Major and minor contours are written into separate layers so they can be styled independently.

**The interval, in metres.** With a GeoTIFF loaded the interval slider is in the
file's own metres — converted, not assumed. A world elevation unit is worth a
metre only by coincidence: it is the file's elevation range, clipped by the
Shadows/Highlights handles, spread over $100 \times \text{elevScale}$ world
units. `metresPerWorldUnit` is the one place that arithmetic lives, and the
contour labels read the raster through its companion `gridValueToMetres`, so the
number on the slider and the numbers printed into the lines cannot drift apart.

The interval is *stored* in world units, which is what the marching squares
threshold against and what a preset written on a PNG means. The metres are
derived both ways — displayed from the stored value, divided back out of what
the user sets — so nothing about presets, sessions or the worker changes. The
consequence is that the exaggeration slider is part of the conversion: moving it
changes what the interval is worth on the ground, and the readout follows the
lines rather than pinning them. The slider's range follows the raster too, from
about a thousand contours down to two, so a 40 m quarry and a 3 000 m mountain
both get a usable slider.

**Where the levels sit.** The ladder is anchored to the terrain's own floor:
levels are at $\min + k \cdot \text{interval}$, so the bottom band is always
exactly one interval thick, the same terrain-relative set of lines is drawn at
any vertical exaggeration, and the labels are the multiples of the interval,
reading 0 at the lowest ground. Level 0 sits on the floor itself: on solid ground
it draws nothing — every corner is at or above it — and where the raster has
NoData it draws the shoreline, the ground meeting the hole at its lowest.
Anchoring instead to the multiples of the interval that fall in *world*
elevation, which is what the app did before, left the lowest line an arbitrary
fraction of an interval above the ground — at exaggeration 1 a 30-unit interval
put it two thirds of an interval up, with the whole valley floor below it unlined
— and reshuffled every level whenever the exaggeration slider moved.

**Smoothing (form lines).** With smoothing enabled, each level's raw marching-squares segments are first chained into polylines, then refined by Chaikin corner-cutting: every pass replaces each vertex with two points at the $\tfrac14$ and $\tfrac34$ positions of its adjacent edges, converging toward a quadratic B-spline. Closed rings are smoothed as loops; open chains keep their endpoints pinned so border-anchored lines stay put. The result is the soft, hand-drawn "form line" look. Smoothing operates purely in the horizontal plane — each line stays at its constant contour elevation — and composes with the *Close contours* option (border-bridging segments are added after smoothing).

**Labels.** With labelling on, each contour's height is printed *into* the line:
the contour stops, the number sits in the gap at the line's own angle, and the
contour resumes. Setting the number beside the line instead is what makes a page
of nested curves unreadable, which is why a printed sheet does it this way.

Placement runs on the chained polyline in arclength, not per vertex, so labels do
not bunch where marching squares happened to emit points closely. Each candidate
is nudged to the straightest spot in a window around it, measured as the greatest
deviation of the curve from the chord across the label's own span; a stretch that
is still bent at its best is left unlabelled rather than mislabelled, because the
number is set on one baseline and on a hairpin it would float off the line it
names. The text runs left-to-right in $+x$ — a fixed convention rather than a
camera-relative one, since the scene orbits.

The work is split across the worker boundary, and the split is forced. Placing a
label needs the contour as one chained *stroke*, and breaking the line for it
moves geometry — both worker work. But naming the level needs the raster's real
elevation range and drawing it needs a font, and neither exists in the worker. So
`buildContours` decides *where* and emits placements in world coordinates, and
`useContourLabels` on the main thread decides *what it says* and letters it —
the same division `useVectorLabels` already makes for point features.

The gap is sized from the character count at a nominal advance, since the true
width is a property of a font the worker cannot see, plus a configurable
clearance either side.

Erasure is by *box*, not by arclength along the label's own chain. Arclength
leaves two ways for a line to cross the digits: a contour that hairpins returns
within a few units of the number while being far away along the curve, and a
different chain at the same level — the far side of a narrow ridge, the next ring
in a tight nest — is not considered at all. So placements are collected for the
whole level first, and then every segment at that level is tested against every
label box. This is what a printed sheet does: the number masks whatever lies
under it, wherever it came from.

The numbers carry their own ink — colour, weight and opacity — resolved at draw
time like every other layer's. The colour defaults to the contours' so the labels
match their lines until told otherwise; a red index elevation over grey contours
is a normal thing for a sheet to do. This is the one draw-mode layer with a
*flat* colour: every other is coloured per vertex from the hypsometric buffer,
and a number is not at an elevation the way the line it sits on is.

With a GeoTIFF loaded the label is metres — read back through the histogram, not
around it, since brightness 0 is wherever the Shadows handle sits rather than the
file's lowest elevation. With a PNG the app has no idea what
the brightness means, and the world elevation is the wrong answer there — it is
centred on zero, so half an ordinary hill comes out negative. The label is then
height above the lowest ground, which is non-negative and still spaced by exactly
the interval the slider is set to.

## 5. Hachure

The terrain gradient $\nabla H = (H_x, H_y)$ is estimated at each sampled cell using central differences. A short stroke is drawn from the cell centre in the direction of $-\nabla H$, with length proportional to $|\nabla H|$. Cells below a slope threshold are skipped.

## 6. Flow Lines

Flow paths are integrated through the gradient field using the forward Euler method:

$$\mathbf{p}_{n+1} = \mathbf{p}_n - \alpha \, \nabla H(\mathbf{p}_n)$$

where $\alpha$ is the step size.

**Seeding order.** Candidate seed positions are laid on a regular grid with pitch `spacing / scl` cells (float-valued, so every 0.5-step increment produces a distinct grid). Candidates are sorted by descending elevation before any tracing begins. Ridges and peaks are seeded first; their paths trace the natural downhill flow and claim cells via an occupancy mask. Lower-elevation candidates whose starting cell has already been claimed are skipped. This ensures complete coverage of the terrain at any spacing — small spacings produce a dense tributary network, large spacings produce sparse primary channels.

**Termination.** Each path stops when it exits the grid boundary, reaches a flat region ($|\nabla H| < \varepsilon$), or its next step would enter an already-occupied cell. The occupancy mask guarantees every grid cell is visited at most once across all paths, so the total segment count is bounded by $\text{rows} \times \text{cols}$ with no hard cap.

## 7. Stream Network

Flow accumulation is computed by a topological sort of the grid directed acyclic graph: each cell drains to its lowest neighbour, and upstream cell counts accumulate downward. Cells whose accumulated count exceeds the `threshold` parameter are drawn as stream segments. The result approximates Strahler-order river networks.

## 8. Pencil Shading

The discrete Laplacian $\nabla^2 H$ is approximated at each cell using the standard 4-neighbour finite difference:

$$\nabla^2 H(x, y) \approx H(x+1,y) + H(x-1,y) + H(x,y+1) + H(x,y-1) - 4\,H(x,y)$$

Where $|\nabla^2 H|$ exceeds the threshold, a small cross-hatch mark is drawn oriented perpendicular to the local gradient, simulating a pencil shading stroke.

## 9. Ridge Detection

Ridge crest lines are extracted using second-order differential geometry of the height field.

**Hessian.** The symmetric Hessian matrix of $H$ is estimated at each cell using second-order finite differences:

$$\mathcal{H} = \begin{pmatrix} H_{xx} & H_{xy} \\ H_{xy} & H_{yy} \end{pmatrix}$$

**Eigenvalue analysis.** The eigenvalues $\lambda_1 \leq \lambda_2$ of $\mathcal{H}$ give the principal curvatures. A cell is a ridge candidate when $\lambda_1 < -\text{threshold}$ (strongly concave across the ridge) and $|\lambda_1|$ is a local maximum in the direction of the corresponding eigenvector.

**Parameters.** `radius` controls the pre-smoothing scale before differentiation — small values detect micro-features such as cliff edges; large values detect mountain-range crests. `threshold` sets the minimum curvature magnitude required for a cell to qualify.

## 10. Valley Detection

Valley floors and basins are identified using the Topographic Position Index:

$$\mathrm{TPI}(x, y) = H(x, y) - \bar{H}_r(x, y)$$

where $\bar{H}_r$ is the mean elevation within a neighbourhood of radius $r$. Cells where $\mathrm{TPI} < -\text{threshold}$ are significantly lower than their surroundings and are drawn as valley segments.

The neighbourhood mean is computed in $O(N)$ time (where $N$ is the number of grid cells) using a summed-area table, making large radii no more expensive than small ones.

## 11. Stipple

A stochastic dot-density map. Candidate positions are generated on a regular grid with pitch `spacing`, then each is displaced by a random jitter (up to `jitter × spacing` in each axis) to break mechanical regularity. For each candidate, a terrain attribute $d \in [0,1]$ is sampled:

| Density mode | $d$ |
|---|---|
| Slope | $\|\nabla H\| / \|\nabla H\|_{\max}$ |
| Inv Slope | $1 - d_{\text{slope}}$ |
| Elevation | $(H - H_{\min}) / (H_{\max} - H_{\min})$ |
| Inv Elevation | $1 - d_{\text{elev}}$ |

The dot is placed with probability $d^\gamma$, where `gamma` sharpens ($\gamma > 1$) or flattens ($\gamma < 1$) the density contrast. Each accepted dot is emitted as a degenerate line segment of length $\epsilon \ll \text{scl}$, which the GPU renders as a round mark whose diameter equals the layer's `weight` in screen pixels. In SVG export, each dot is written as a `<circle>` element.

All randomness (jitter and acceptance) is drawn from a mulberry32 PRNG initialised from the mode's `seed` parameter, so a given seed always reproduces the identical dot pattern.

## 12. Engraving

Copperplate-style illumination cross-hatch, after the classic pen-and-ink rendering principle: stroke density encodes shadow.

**Tone.** The unit surface normal $\mathbf{n} \propto (-H_x, 1, -H_y)$ is estimated per cell from central differences, and Lambert illumination is evaluated against a light direction $\mathbf{l}$ built from the configurable sun azimuth (altitude fixed at 45°). Darkness is the tone-curved complement

$$D = \big(1 - \max(0, \mathbf{n} \cdot \mathbf{l})\big)^{\gamma}$$

where `contrast` is the exponent $\gamma$: values above 1 confine hatching to deep shadow, values below 1 spread it onto lit slopes.

**Hatch layers.** Up to four stroke directions are stacked at the base angle $\theta$ plus offsets $\{0°, 90°, 45°, 135°\}$. Layer $k$ (of $L$ enabled levels) draws only where

$$D \geq \frac{k + 1}{L + 1}$$

so lightly shaded slopes carry sparse single-direction strokes while shadows accumulate dense cross-hatching.

**Strokes.** For each layer, parallel lines with pitch `spacing` are marched across the grid at the layer's angle in unit-cell steps. Each sample is draped onto the terrain via bilinear elevation interpolation; a stroke continues while consecutive samples stay above the layer threshold (and inside the data mask and elevation cut) and breaks the moment the surface becomes too bright — producing continuous polylines that hug the shadowed terrain and vanish into the light.

## 13. Rock & Scree

Swisstopo-style alpine rock depiction, emitted as two independently rendered sub-layers.

**Cliff hachures (`Swiss-Rock`).** With normalised slope $s = |\nabla H| / |\nabla H|_{\max}$, every sampled cell with $s \geq$ `cliff` receives a stroke from the cell centre along the downslope direction $-\nabla H / |\nabla H|$ — perpendicular to the contours, as an engraver would render a rock face. Stroke length grows with steepness, $\ell \propto (0.6 + 1.2\,s)$, scaled by the `stroke len` parameter, and each stroke gets a small seeded perpendicular wobble for a hand-drawn feel. The far endpoint is re-draped onto the terrain so strokes follow the surface.

**Scree dots (`Swiss-Scree`).** Cells in the slope band $s \in [0.45\,T,\, T)$ below the cliff threshold $T$ form the debris apron. Each is accepted with probability

$$p = \text{density} \cdot \frac{s - 0.45\,T}{T - 0.45\,T}$$

so dots thicken toward the rock faces, mimicking talus accumulation. Accepted dots are jittered within their cell and rendered like stipple marks (round GPU points; `<circle>` elements in SVG) with their own size control.

Both sub-layers share the mode's seeded PRNG: the same seed reproduces the identical wobble and scree placement.

## 14. Curvature

Form-following engraving: strokes trace the *shape* of the surface rather than its illumination. Where Engraving (§12) hatches by light and Hachure (§5) follows the gradient, this mode integrates streamlines through the principal-curvature direction field, so the strokes wrap the terrain the way a burin follows a form.

**Direction field.** The height field is pre-smoothed by `radius` (second derivatives amplify noise), then the symmetric Hessian is estimated per cell by finite differences, as in §9. Its eigen-decomposition

$$\lambda_{\pm} = \tfrac{1}{2}\Big(\mathrm{tr}\,\mathcal{H} \pm \sqrt{(\mathrm{tr}\,\mathcal{H})^2 - 4\det\mathcal{H}}\Big)$$

gives the two principal curvatures, and the eigenvector for the selected $\lambda$ gives the direction the stroke follows. `dirMode` picks which:

| Mode | Eigenvalue | Reads as |
|---|---|---|
| Across form | larger $\|\lambda\|$ | Lines hoop *around* a ridge, across the direction of strongest bending |
| Along form | smaller $\|\lambda\|$ | Strokes comb *along* ridges and valleys, down the flattest direction |

Both selections are by **magnitude**, not sign, so a mode does not change meaning between a crest (both curvatures negative) and a basin. The eigenvector is taken from whichever Hessian row is better conditioned, so near-diagonal matrices stay stable, with the coordinate axes used exactly when $H_{xy} \to 0$.

**Stroke strength** is always the dominant curvature $\max(|\lambda_-|, |\lambda_+|)$, never the eigenvalue the direction was taken from. This matters: on a ridge the *minimum* principal curvature is identically zero, so keying the threshold to the selected eigenvalue suppressed Along form everywhere it is most meaningful. `threshold` is a fraction of the maximum strength on the terrain, so it is resolution- and relief-independent.

**Even spacing.** Streamlines are placed by the Jobard–Lefebvre criterion. Seeds are laid on a grid at the separation pitch and sorted by descending strength, so structurally significant strokes claim their territory before filler. Each line integrates outward in both directions in `step` steps, draping onto the terrain bilinearly, and stops when it leaves the mask, exceeds `length` steps, or enters ground already owned by another line. The direction is sign-aligned against the previous step each time, since an eigenvector is defined only up to sign and would otherwise flip the stroke back on itself.

A line claims a disc of **half** the seed pitch, not the full separation — claiming the full pitch makes adjacent seeds collide on their first step and chops every stroke into a stub.

## 15. Isophotes

Lines of constant *illumination*. A contour joins points of equal height; an
isophote joins points of equal light, which is the same construction over a
different field and reads nothing like it on the page: the lines wrap the terrain
the way a reflection wraps a polished object, bunching where the surface turns
away from the sun and opening out where it faces it.

**The field.** Per-cell darkness is $D = (1 - \max(0, \mathbf{n}\cdot\mathbf{l}))^{\gamma}$
— the same Lambert quantity Engraving (§12) hatches by, computed by the shared
`lambertDarkness` helper against the same light convention as the hillshade
shader (azimuth 315° = NW, altitude fixed at 45°). Where Engraving *thresholds*
this field to decide stroke density, Isophotes *traces its level set*.

**Pre-smoothing is not optional.** Illumination is a surface normal, and a normal
is a derivative of elevation, so the field inherits every cell-scale bump the
terrain has and amplifies it — the same reason Ridge (§9) and Curvature (§14)
blur before differentiating. The `radius` parameter box-blurs the height field
(mask-aware) before the normals are taken. On the reference terrain the level set
runs to **1 386 994** segments at radius 0 and **87 372** at radius 6, which is
the difference between a solid black mass and a drawing. The default is 6.

**Levels** are a count, not an interval: darkness is a fraction rather than a
measurement, so there is no natural unit to step by the way contours step by
metres. $L$ levels sit at $k/(L+1)$ for $k = 1 \ldots L$ — strictly inside
$(0,1)$, because at 0 or 1 the whole field lies on one side and nothing is drawn.

**Chaining and draping.** Marching squares emits in scan order, so segments are
chained into polylines (§4's `chainLevelSegments`) before anything else — that is
what makes a stroke a stroke, and what lets the SVG exporter write each one as a
single `<polyline>`. Optional Chaikin smoothing then rounds the staircase left by
tracing a level set across grid cells.

Unlike a contour, an isophote is **not level**: it crosses elevations freely, so
every vertex is draped onto the surface with a masked bilinear tap, and the walk
takes unit-cell steps even where the smoothed path skips further. That last part
matters — smoothing ends in a Douglas–Peucker pass which may replace a curve with
a chord up to nineteen cells long, and while such a chord is horizontally
faithful it says nothing about the ground beneath it. Contours may decimate
safely because a chord stays on the line; an isophote would cut through the
relief.

**NoData is a hole, not a shoreline.** Contours (§4) deliberately treat a masked
corner as lying below every level so isolines close along the edge of the data.
That is right for a coastline and wrong here: there is no illumination where
there is no ground, and an isophote drawn around the edge of a selection would be
describing the selection rather than the terrain. Cells with any masked corner
are skipped.

---

## NoData and clipped edges

A raster can have holes: a GeoTIFF's NoData cells, a PNG's transparent pixels,
and — most often — everything outside an ellipse, lasso or polygon selection in
Edit Mode. `buildTerrain` records them in `gridMask` and stores $H = 0$ there.

That zero is a trap, because 0 is not "absent": it is the darkest possible
ground, and $(H - 0.5)\cdot 100 \cdot \text{elevScale}$ puts it at the very
bottom of the scene. Reading it as terrain produces the artifact in three
different shapes, and all fifteen modes now guard against it.

**Sampling — normalized bilinear.** Modes that drape themselves on *fractional*
grid coordinates (Lines and Crosshatch at an oblique bearing, Engraving at every
angle, Flow, Swiss rock, vector draping) take a 2×2 bilinear tap. A tap whose
footprint straddles a clipped edge blends real ground against those zeros and
returns a height near the floor — which drew a segment plunging from the terrain
down to the base, all along the border of the selection. `sampleBilinear`
weights only the corners that carry data and renormalises against them:

$$H(\mathbf{p}) = \frac{\sum_k w_k\,m_k\,H_k}{\sum_k w_k\,m_k}$$

where $m_k \in \{0,1\}$ is the corner's mask. A tap with no data under it at all
returns NaN, which ends the stroke rather than diving. At 0° and 90° the Lines
samples land exactly on grid cells, so those two angles never showed the
artifact — which is why it read as an Engraving problem.

**Blur — normalized convolution.** The same reasoning applies to every box blur:
the terrain pre-blur, and the pre-smoothing inside Ridge, Curvature and Valley.
Averaging across a hole drags the mean toward zero for a radius' width inside
the valid region. `boxBlur` takes an optional mask and then computes
$\sum w\,m\,v \,/\, \sum w\,m$ — the mean over the valid samples alone. It is
only engaged when the mask actually has holes (`terrain.hasNoData`); a solid
raster keeps the cheaper path, and its output is unchanged.

**Stencils — NoData reads as flat.** Ridge, Curvature and Pencil Shading
differentiate the field, and a second difference taken against a zero is the
largest curvature anywhere on the terrain — so the border of a selection was
found first and drawn as a crest. Each stencil tap now substitutes the centre
value for a masked neighbour, which says "flat that way" instead of "a cliff
that way". This matters most for Curvature, whose threshold is a fraction of the
maximum strength on the terrain: the phantom rim *set* that maximum, and the
mode collapsed to a few strokes clinging to the edge.

Contours are the deliberate exception: marching squares treats a NoData corner
as sitting just below every level, so isolines close against the edge of the
data as shorelines rather than stopping short of it.

---

## Ghost Occlusion

All fifteen modes share the same depth-ordering system.

For each line segment, a thin triangulated curtain mesh is generated immediately beneath it, extending vertically to the base of the scene. Curtains are rendered to the depth buffer only (invisible, no colour output). In the subsequent colour pass, line segments that fall behind an existing curtain are occluded — they either disappear or are rendered with a separate ghost colour and opacity, depending on the configured occlusion settings.

This approach gives true line-to-line depth awareness without relying on terrain surface depth, which would cause lines to be clipped by the mesh they are drawn on.
