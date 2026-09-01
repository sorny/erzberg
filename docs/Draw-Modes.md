# Draw Modes

`erzberg` treats the loaded heightmap as a discrete scalar field $H(x, y)$. Thirty-two independent algorithms extract topographic features from it. Each mode produces its own `LineSegmentsGeometry`. You can style, dash and hypsometrically tint each mode separately.

---

## 1. Lines

Parallel terrain-draped ridgelines at an arbitrary bearing angle $\theta$. The lines sit at perpendicular positions $p_k = k \cdot \text{spacing} + \text{shift}$ along the unit normal $(-\sin\theta, \cos\theta)$. The builder samples them in unit-cell steps along the direction $(\cos\theta, \sin\theta)$, interpolates the elevations bilinearly, and lifts them into 3D. At $\theta = 0°$ and $90°$ the samples land exactly on grid rows and columns, which reproduces the classic axis-aligned ridgeline look. An oblique angle resamples the terrain along rotated rays for a diagonal composition.

## 2. Crosshatch

The builder runs the Lines builder twice, at the angle that you set and at that angle plus 90°. It merges both outputs into a single layer.

## 3. Pillars

For each sampled grid cell $(x, y)$, the builder draws a vertical line segment. The segment runs from a base depth that you set up to $H(x, y)$ minus a gap. The result is an extruded bar chart of the terrain.

## 4. Contours

Marching Squares computes the isolines. The builder thresholds the terrain at each contour level and interpolates the edge intersections linearly, which produces smooth isoline vertices.

A phase-offset rule identifies the major contours. A contour at elevation $e$ is major if $\lfloor e / \text{majorInterval} \rfloor \neq \lfloor (e - \text{interval}) / \text{majorInterval} \rfloor$. The builder writes major and minor contours into separate layers, so you can style them independently.

**The interval, in metres.** With a GeoTIFF loaded, the interval slider is in the
metres of the file. The app converts them and does not assume them. A world
elevation unit is worth a metre only by coincidence. It is the elevation range of
the file, clipped by the Shadows and Highlights handles, spread over
$100 \times \text{elevScale}$ world units. `metresPerWorldUnit` is the one place
where that arithmetic lives, and the contour labels read the raster through its
companion `gridValueToMetres`. The number on the slider and the numbers printed
into the lines thus cannot drift apart.

The app *stores* the interval in world units. That is what the marching squares
thresholds against, and what a preset written on a PNG means. The app derives the
metres both ways: it shows them from the stored value, and divides them back out
of what you set. Nothing about presets, sessions or the worker changes. As a
result, the exaggeration slider is part of the conversion. When you move it, it
changes what the interval is worth on the ground. The readout follows the lines
instead of a pin on them. The range of the slider follows the raster too,
from about a thousand contours down to two. A 40 m quarry and a 3 000 m mountain
thus both get a usable slider.

**Where the levels sit.** The app anchors the ladder to the floor of the terrain.
The levels sit at $\min + k \cdot \text{interval}$. The bottom band is thus always
exactly one interval thick. The app draws the same terrain-relative set of lines
at any vertical exaggeration. The labels are the multiples of the interval, with
0 at the lowest ground. Level 0 sits on the floor itself. On solid ground it
draws nothing, because every corner is at or above it. Where the raster has
NoData, it draws the shoreline, which is the ground where it meets the hole at
its lowest point.

The app anchored the ladder to the multiples of the interval that fall in *world*
elevation before. That left the lowest line an arbitrary fraction of an interval
above the ground. At exaggeration 1, a 30-unit interval put it two thirds of an
interval up, with the whole valley floor below it unlined. It also reshuffled
every level whenever the exaggeration slider moved.

**Smoothing (form lines).** With smoothing on, the builder first chains the raw marching-squares segments of each level into polylines. Chaikin corner-cutting then refines them. Every pass replaces each vertex with two points, at the $\tfrac14$ and $\tfrac34$ positions of its adjacent edges. The result converges toward a quadratic B-spline. The builder smooths closed rings as loops. It pins the endpoints of open chains, so border-anchored lines stay put. The result is the soft, hand-drawn "form line" look. The smoothing works purely in the horizontal plane, and each line stays at its constant contour elevation. It composes with the *Close contours* option, because the builder adds the border-bridging segments after the smoothing.

**Labels.** With labels on, the app prints the height of each contour *into* the
line. The contour stops, the number sits in the gap at the angle of the line, and
the contour resumes. A number set beside the line instead is what makes a page of
nested curves unreadable. That is why a printed sheet does it this way.

Placement runs on the chained polyline in arclength, not per vertex. Labels thus
do not bunch where marching squares happened to emit points close together. The
app nudges each candidate to the straightest spot in a window around it. It
measures straightness as the greatest deviation of the curve from the chord
across the span of the label. A stretch that is still bent at its best stays
unlabelled rather than mislabelled. The number sits on one baseline, and on a
hairpin it floats off the line that it names. The text runs left to right in
$+x$. That is a fixed convention rather than a camera-relative one, because the
scene orbits.

The work is split across the worker boundary, and the split is forced. A label
needs the contour as one chained *stroke*, and the break in the line for it moves
geometry. Both are worker work. But the name of the level needs the real
elevation range of the raster, and the drawing of it needs a font. Neither exists
in the worker. Thus `buildContours` decides *where* and emits placements in world
coordinates, and `useContourLabels` on the main thread decides *what it says* and
letters it. That is the same division that `useVectorLabels` already makes for
point features.

The app sizes the gap from the character count at a nominal advance. The true
width is a property of a font that the worker cannot see. A clearance that
you set is added on each side.

Erasure is by *box*, not by arclength along the chain of the label. Arclength
leaves two ways for a line to cross the digits. A contour that hairpins returns
within a few units of the number while it is far away along the curve. A
different chain at the same level is not considered at all. That includes the far
side of a narrow ridge and the next ring in a tight nest. The app thus collects the
placements for the whole level first. Then it tests every segment at that level
against every label box. This is what a printed sheet does: the number masks
whatever lies under it, wherever it came from.

The numbers carry their own ink: colour, weight and opacity, resolved at draw
time like every other layer. The colour defaults to the colour of the contours,
so the labels match their lines until you change them. A red index elevation over
grey contours is a normal thing for a sheet to do. This is the one draw-mode
layer with a *flat* colour. The app colours every other layer per vertex from the
hypsometric buffer. A number is not at an elevation the way the line under it is.

With a GeoTIFF loaded, the label is metres. The app reads it back through the
histogram rather than around it. Brightness 0 is wherever the Shadows handle
sits, not the lowest elevation in the file. With a PNG, the app has no
idea what the brightness means, and the world elevation is the wrong answer
there. World elevation is centred on zero, so half an ordinary hill comes out
negative. The label is then the height above the lowest ground. That value is
non-negative, and it is still spaced by exactly the interval that the slider is
set to.

## 5. Hachure

The builder estimates the terrain gradient $\nabla H = (H_x, H_y)$ at each sampled cell with central differences. It draws a short stroke from the cell centre in the direction of $-\nabla H$, with a length proportional to $|\nabla H|$. The builder skips cells below a slope threshold.

## 6. Flow Lines

The builder integrates the flow paths through the gradient field with the forward Euler method:

$$\mathbf{p}_{n+1} = \mathbf{p}_n - \alpha \, \nabla H(\mathbf{p}_n)$$

where $\alpha$ is the step size.

**Seeding order.** The builder lays candidate seed positions on a regular grid with pitch `spacing / scl` cells. The pitch is float-valued, so every 0.5-step increment produces a distinct grid. The builder sorts the candidates by descending elevation before it traces anything. Ridges and peaks are seeded first. Their paths trace the natural downhill flow and claim cells through an occupancy mask. The builder skips a lower-elevation candidate whose starting cell another path already claimed. This gives complete coverage of the terrain at any spacing. A small spacing produces a dense tributary network, and a large spacing produces sparse primary channels.

**Termination.** Each path stops when it exits the grid boundary, when it reaches a flat region ($|\nabla H| < \varepsilon$), or when its next step enters an occupied cell. The occupancy mask guarantees that all paths together visit every grid cell at most once. The total segment count is thus bounded by $\text{rows} \times \text{cols}$, with no hard cap.

## 7. Stream Network

A topological sort of the directed acyclic graph of the grid computes the flow accumulation. Each cell drains to its lowest neighbour, and the upstream cell counts accumulate downward. The builder draws the cells whose accumulated count exceeds the `threshold` parameter as stream segments. The result approximates Strahler-order river networks.

## 8. Pencil Shading

The builder approximates the discrete Laplacian $\nabla^2 H$ at each cell with the standard 4-neighbour finite difference:

$$\nabla^2 H(x, y) \approx H(x+1,y) + H(x-1,y) + H(x,y+1) + H(x,y-1) - 4\,H(x,y)$$

Where $|\nabla^2 H|$ exceeds the threshold, the builder draws a small cross-hatch mark perpendicular to the local gradient. The mark simulates a pencil shading stroke.

## 9. Ridge Detection

The builder extracts the ridge crest lines with second-order differential geometry of the height field.

**Hessian.** Second-order finite differences estimate the symmetric Hessian matrix of $H$ at each cell:

$$\mathcal{H} = \begin{pmatrix} H_{xx} & H_{xy} \\ H_{xy} & H_{yy} \end{pmatrix}$$

**Eigenvalue analysis.** The eigenvalues $\lambda_1 \leq \lambda_2$ of $\mathcal{H}$ give the principal curvatures. A cell is a ridge candidate when $\lambda_1 < -\text{threshold}$, which means strongly concave across the ridge. $|\lambda_1|$ must also be a local maximum in the direction of the matching eigenvector.

**Parameters.** `radius` sets the pre-smoothing scale before differentiation. A small value finds micro-features such as cliff edges, and a large value finds mountain-range crests. `threshold` sets the minimum curvature magnitude for a cell to qualify.

## 10. Valley Detection

The Topographic Position Index identifies valley floors and basins:

$$\mathrm{TPI}(x, y) = H(x, y) - \bar{H}_r(x, y)$$

where $\bar{H}_r$ is the mean elevation within a neighbourhood of radius $r$. Cells where $\mathrm{TPI} < -\text{threshold}$ are much lower than their surroundings, and the builder draws them as valley segments.

A summed-area table computes the neighbourhood mean in $O(N)$ time, where $N$ is the number of grid cells. A large radius thus costs no more than a small one.

## 11. Stipple

A stochastic dot-density map. The builder generates candidate positions on a regular grid with pitch `spacing`. It then displaces each one by a random jitter of up to `jitter × spacing` in each axis, which breaks the mechanical regularity. For each candidate it samples a terrain attribute $d \in [0,1]$:

| Density mode | $d$ |
|---|---|
| Slope | $\|\nabla H\| / \|\nabla H\|_{\max}$ |
| Inv Slope | $1 - d_{\text{slope}}$ |
| Elevation | $(H - H_{\min}) / (H_{\max} - H_{\min})$ |
| Inv Elevation | $1 - d_{\text{elev}}$ |

The builder places the dot with probability $d^\gamma$. `gamma` sharpens the density contrast ($\gamma > 1$) or flattens it ($\gamma < 1$). Each accepted dot is a degenerate line segment of length $\epsilon \ll \text{scl}$. The GPU renders it as a round mark whose diameter equals the `weight` of the layer in screen pixels. In SVG export, each dot is a `<circle>` element.

A mulberry32 PRNG draws all the randomness, both the jitter and the acceptance. The `seed` parameter of the mode initialises it, so one seed always reproduces the identical dot pattern.

## 12. Engraving

Copperplate-style illumination cross-hatch, after the classic pen-and-ink principle: stroke density encodes shadow.

**Tone.** Central differences estimate the unit surface normal $\mathbf{n} \propto (-H_x, 1, -H_y)$ per cell. The builder evaluates Lambert illumination against a light direction $\mathbf{l}$. That direction comes from the sun azimuth that you set, with the altitude fixed at 45°. Darkness is the tone-curved complement

$$D = \big(1 - \max(0, \mathbf{n} \cdot \mathbf{l})\big)^{\gamma}$$

where `contrast` is the exponent $\gamma$. A value above 1 confines the hatch to deep shadow. A value below 1 spreads it onto lit slopes.

**Hatch layers.** The builder stacks up to four stroke directions at the base angle $\theta$ plus the offsets $\{0°, 90°, 45°, 135°\}$. Layer $k$ of $L$ enabled levels draws only where

$$D \geq \frac{k + 1}{L + 1}$$

Lightly shaded slopes thus carry sparse single-direction strokes, and shadows accumulate a dense cross-hatch.

**Strokes.** For each layer, the builder marches parallel lines with pitch `spacing` across the grid at the angle of the layer, in unit-cell steps. Bilinear elevation interpolation drapes each sample onto the terrain. A stroke continues while consecutive samples stay above the threshold of the layer, inside the data mask and inside the elevation cut. It breaks the moment the surface becomes too bright. The result is continuous polylines that hug the shadowed terrain and vanish into the light.

## 13. Rock & Scree

Swisstopo-style alpine rock depiction, emitted as two sub-layers that render independently.

**Cliff hachures (`Swiss-Rock`).** The normalised slope is $s = |\nabla H| / |\nabla H|_{\max}$. Every sampled cell with $s \geq$ `cliff` gets a stroke from the cell centre along the downslope direction $-\nabla H / |\nabla H|$. That is perpendicular to the contours, the way an engraver draws a rock face. Stroke length grows with steepness, $\ell \propto (0.6 + 1.2\,s)$, scaled by the `stroke len` parameter. Each stroke gets a small seeded perpendicular wobble for a hand-drawn feel. The builder re-drapes the far endpoint onto the terrain, so strokes follow the surface.

**Scree dots (`Swiss-Scree`).** The cells in the slope band $s \in [0.45\,T,\, T)$ below the cliff threshold $T$ form the debris apron. The builder accepts each one with probability

$$p = \text{density} \cdot \frac{s - 0.45\,T}{T - 0.45\,T}$$

The dots thus thicken toward the rock faces, like real talus. Accepted dots are jittered within their cell and drawn like stipple marks: round GPU points, and `<circle>` elements in SVG. They have their own size control.

Both sub-layers share the seeded PRNG of the mode. The same seed reproduces the identical wobble and scree placement.

## 14. Curvature

Form-following engraving: the strokes trace the *shape* of the surface rather than its illumination. Engraving (§12) hatches by light, and Hachure (§5) follows the gradient. This mode integrates streamlines through the principal-curvature direction field. The strokes thus wrap the terrain the way a burin follows a form.

**Direction field.** The builder pre-smooths the height field by `radius`, because second derivatives amplify noise. Finite differences then estimate the symmetric Hessian per cell, as in §9. Its eigen-decomposition

$$\lambda_{\pm} = \tfrac{1}{2}\Big(\mathrm{tr}\,\mathcal{H} \pm \sqrt{(\mathrm{tr}\,\mathcal{H})^2 - 4\det\mathcal{H}}\Big)$$

gives the two principal curvatures. The eigenvector for the selected $\lambda$ gives the direction that the stroke follows. `dirMode` picks which one:

| Mode | Eigenvalue | Reads as |
|---|---|---|
| Across form | larger $\|\lambda\|$ | Lines hoop *around* a ridge, across the direction of strongest bending |
| Along form | smaller $\|\lambda\|$ | Strokes comb *along* ridges and valleys, down the flattest direction |

Both selections go by **magnitude**, not by sign. A mode thus keeps its meaning between a crest, where both curvatures are negative, and a basin. The builder takes the eigenvector from whichever Hessian row is better conditioned. Near-diagonal matrices thus stay stable, and the builder uses the coordinate axes exactly when $H_{xy} \to 0$.

**Stroke strength** is always the dominant curvature $\max(|\lambda_-|, |\lambda_+|)$, never the eigenvalue that the direction came from. This matters. On a ridge the *minimum* principal curvature is identically zero. A threshold keyed to the selected eigenvalue thus suppressed Along form everywhere that it is most meaningful. `threshold` is a fraction of the maximum strength on the terrain, so it is independent of resolution and relief.

**Even spacing.** The Jobard–Lefebvre criterion places the streamlines. The builder lays seeds on a grid at the separation pitch and sorts them by descending strength. Structurally significant strokes thus claim their territory before filler. Each line integrates outward in both directions in `step` steps and drapes onto the terrain bilinearly. It stops when it leaves the mask, when it exceeds `length` steps, or when it enters ground that another line already owns. The builder sign-aligns the direction against the previous step each time. An eigenvector is defined only up to sign, and otherwise it flips the stroke back on itself.

A line claims a disc of **half** the seed pitch, not the full separation. A claim on the full pitch makes adjacent seeds collide on their first step and chops every stroke into a stub.

## 15. Isophotes

Lines of constant *illumination*. A contour joins points of equal height. An
isophote joins points of equal light, which is the same construction over a
different field. It reads nothing like a contour on the page: the lines wrap the
terrain the way a reflection wraps a polished object. They bunch where the
surface turns away from the sun, and open out where it faces the sun.

**The field.** Per-cell darkness is $D = (1 - \max(0, \mathbf{n}\cdot\mathbf{l}))^{\gamma}$.
That is the same Lambert quantity that Engraving (§12) hatches by. The shared
`lambertDarkness` helper computes it against the same light convention as the
hillshade shader: azimuth 315° is NW, and the altitude is fixed at 45°. Engraving
*thresholds* this field to decide stroke density. Isophotes *traces its level
set*.

**Pre-smoothing is not optional.** Illumination comes from a surface normal, and
a normal is a derivative of elevation. The field thus inherits every cell-scale
bump that the terrain has, and amplifies it. That is the same reason that Ridge
(§9) and Curvature (§14) blur before they differentiate. The `radius` parameter
box-blurs the height field, mask-aware, before the builder takes the normals. On
the reference terrain the level set runs to **1 386 994** segments at radius 0.
At radius 6 it runs to **87 372**. That is the difference between a solid black
mass and a drawing. The default is 6.

**Levels** are a count, not an interval. Darkness is a fraction rather than a
measurement, so there is no natural unit to step by the way contours step by
metres. $L$ levels sit at $k/(L+1)$ for $k = 1 \ldots L$, strictly inside
$(0,1)$. At 0 or 1 the whole field lies on one side and the builder draws
nothing.

**Chaining and draping.** Marching squares emits in scan order. The builder thus
chains the segments into polylines with `chainLevelSegments` from §4 before
anything else. That is what makes a stroke a stroke, and what lets the SVG
exporter write each one as a single `<polyline>`. Optional Chaikin smoothing then
rounds the staircase that a trace of a level set across grid cells leaves behind.

Unlike a contour, an isophote is **not level**. It crosses elevations freely. The
builder thus drapes every vertex onto the surface with a masked bilinear tap. The
walk takes unit-cell steps even where the smoothed path skips further. That
last part matters. Smoothing ends in a Douglas–Peucker pass that can replace a
curve with a chord up to nineteen cells long. Such a chord is horizontally
faithful, but it says nothing about the ground beneath it. Contours can decimate
safely, because a chord stays on the line. An isophote cuts through the relief
instead.

**NoData is a hole, not a shoreline.** Contours (§4) deliberately treat a masked
corner as below every level, so isolines close along the edge of the data. That
is right for a coastline and wrong here. There is no illumination where there is
no ground. An isophote drawn around the edge of a selection describes the
selection rather than the terrain. The builder thus skips every cell with a
masked corner.

## 16. Bitplane

The terrain as a tilemap: flat plateaus, hard lattice staircases between them, and an ordered dither that screens one band into the next.

**The quantiser.** The builder cuts normalised elevation into $N$ tiers and snaps every vertex to the floor of its tier,

$$t(r,c) = \left\lfloor \hat{H}(r,c) \cdot N \right\rfloor, \qquad y = \min + t \cdot \frac{\max - \min}{N}$$

where $\hat{H}$ is `normElev` against the bounds of the terrain rather than raw brightness. That anchoring is the same argument that the contour ladder makes. The steps are terrain-relative, so the exaggeration slider scales them and does not reshuffle which cell sits on which plateau. A direct read of brightness also inverts incorrectly at a negative `elevScale`, where `minElev` and `maxElev` are deliberately ordered and brightness is not.

**The staircase is marching squares with the interpolation removed.** Where two neighbouring cells land on different tiers, the builder emits the shared cell *edge* whole: axis-aligned, at the height of the higher tier. Contours interpolate that crossing to get a smooth isoline. The refusal to interpolate is the entire difference between the two modes, and it is what turns a curve into a pixel staircase. The builder tests only the east and south neighbours. Every interior edge is shared by exactly two cells, and two directions visit each edge once. It needs no chaining: the segments already meet exactly at lattice corners, which is what keeps the steps crisp rather than stitched.

With **Risers** on, the builder closes each step with the two verticals down to the lower plateau. The mode then reads as a stack of blocks under an orthographic camera, which is the isometric reading. With Risers off, it is a flat staircase seen from above.

**The screen** is a $4 \times 4$ Bayer matrix $B$ over the residual $f = \hat{H} \cdot N - t$. The residual is how far up its own band a cell sits:

$$\text{ink}(r,c) \iff f \cdot \text{dither} > \frac{B[r \bmod 4][c \bmod 4] + \tfrac12}{16}$$

Ordered dither is the wrong screen for a photograph and the right one here. It lays down a visible, regular pattern, which is exactly what a 16-colour ramp looks like when it shades a sky. (Flashbulb wants blue noise for the opposite reason.)

The two ship as separate layers, `Bitplane-Step` and `Bitplane-Screen`. They want two pens, and one of them is `isPoints` and the other is not. That is the same split that Rock & Scree makes between its cliff hachures and its debris. Hypsometric tinting reads the *tier* rather than the vertex elevation, so the ramp bands with the plateaus instead of a cut across them.

## 17. Flashbulb

One bare bulb inside the scene, and the terrain as a police flash photograph. The near flank is blown to bare paper. The far side is crushed to solid. A narrow band of tone between them is carried entirely by grain.

**Why nothing else in the tool can light it this way.** Engraving, Isophotes and the hillshade shader share one convention: azimuth around, altitude pinned at 45°, and *parallel* rays. Parallel rays have no falloff, and falloff is the entire subject. The light goes at a world position inside the scene instead:

$$E = \frac{\max(0,\; \hat{n} \cdot \hat{d})}{1 + (r/r_0)^2}, \qquad d = L - P,\; r = |d|$$

The $1+$ keeps the light finite as the bulb approaches the ground. $r_0$ decides which band of terrain survives at all, and everything after it is a tone curve.

The bulb is exposed as **azimuth, distance and height** rather than as a raw XYZ triple. Nobody can aim three unlabelled world coordinates, and azimuth is already the vocabulary that the Hillshade section teaches. Distance and height are *fractions*, of the half-diagonal of the terrain and of its elevation range. One setting thus frames a 40 m quarry and a 3 000 m mountain alike.

**Referenced to a percentile, not to the brightest cell.** One sample a few units from the bulb otherwise sets the scale for the whole plate, and everything else crushes to solid. Measured, that put 84% of the terrain at full ink. The reference is the 68th percentile of exposure over the sampled cells. A 512-bin histogram gives it rather than a sort, so it costs one pass. The defaults were then measured against about 40% ink coverage on a reference massif. The first guess covered 59% and came out a black slab.

**Shadows are marched, not inferred.** This is the CPU twin of `hillshadeCastShadows` in the surface shader, and it takes the same step count. The two thus agree when both are on. The march runs in *grid* coordinates, so its inner loop is an array index and a compare. It is the expensive part of the mode, so the builder skips it wherever it cannot change the answer. A cell that faces away from the bulb is already dark. A cell whose unshadowed tone is already solid cannot get darker.

**The grain is blue noise.** Ordered dither lays down a visible screen, which is exactly right at Bitplane and the one thing that kills a photograph. Blue noise carries a tone without a printed pattern, because its energy sits at high spatial frequencies. The tile is 64×64. Void-and-cluster (Ulichney 1993) builds it once, and the module holds it at module scope. It is toroidal, so it wraps across the grid without a seam. Measured against a random threshold at the same density, it holds its points about 1.6 times further apart at sparse tones.

Two constraints are worth a statement, because they shaped the mode:

- **The builder walks the tile per *sample*, not per cell.** An index by grid position, while the builder samples at a coarser pitch, decimates the pattern and takes the blue out of it.
- **Dot size cannot vary.** `layerStyle` resolves `weight` per layer, so every dot in the layer has the same radius. The variation has to come from density and position jitter alone. That is a property of the line contract, not a choice.

**Solarise** folds the tone curve, $T \rightarrow |2T - 1|$. Highlights thus reverse, and a bright rim appears exactly at mid-tone, which is the Sabattier effect. It is one line on top of everything above, which is why it is a switch here rather than a mode of its own.

## 18. Halation

The optics of Flashbulb, plus the glow that a blown highlight throws into the shadow beside it. The lit crest of a ridge bleeds outward. The grain next to it is eaten away. A warm halo pools in what is left.

**What actually scatters.** Halation in a real emulsion is light that got *through* the silver, bounced off the film base and came back. The thing that spreads is thus the light that the highlight cannot hold, and the field to blur is the **overexposure**:

$$\text{over} = \max\!\left(0,\; \frac{E}{E_\text{ref}} \cdot \text{exposure} - 1\right), \qquad \text{bloom} = \text{boxBlur}(\text{over},\, \text{radius})$$

A blur of the exposure *gradient* instead is the obvious first idea, and it is wrong in a way that shows only on real terrain. Every ridge and gully is an edge, so a busy massif blooms uniformly. The halo then covers the picture instead of a pool beside the bright parts of it. Only genuinely blown highlights scatter, and `over` is exactly them. That is also what makes the mode do nothing at all on an under-exposed plate, which is correct.

The blur is the same `boxBlur` that the Blur slider runs, taken over the *exposure lattice* rather than the raster. Its radius is thus in sample pitches. It inherits the mask-aware path, which stops a clipped edge from a ring of halo around the selection.

**Two populations, two inks.**

- **`Halation-Grain`** is the grain of Flashbulb with the bloom subtracted from the darkness, $\text{inked} = \max(0,\, T - \text{bloom} \cdot \text{bleed})$. That subtraction *is* the halation. With `bleed` at 0 the glow sits on top of the picture instead of a consumption of it. The mode is then Flashbulb with confetti.
- **`Halation-Bloom`** is the halo. The builder draws it where the bloom is strong *and* the ground is dark, $\text{halo} = \text{bloom} \cdot \text{glow} \cdot T$. A glow over an already-blown highlight is invisible, and a draw there only wastes ink.

The two read the blue-noise tile at a half-tile offset from one another. A shared index correlates them exactly. Every halo dot then lands on a cell that the grain already claimed. The halo vanishes into it instead of a read as a second pass.

The optics themselves (`flashExposure`, `flashShadowed`, `flashTone`) are shared with Flashbulb rather than written twice. With the glow off, the two modes agree cell for cell, which is what the spec pins.

## 19–22. Descent with mass — Fall Line, Berms, Air, Race Line

Four readings of one tracer. Flow (mode 6) steps $\mathbf{p} \leftarrow \mathbf{p} - \alpha \nabla H$. That is a *massless* particle that points exactly downhill at every step. It cannot overshoot, it cannot bank, and it stops the instant the gradient does. That is correct for drainage, and it is why Flow reads as a river network. This family integrates a **state** instead:

$$\mathbf{a} = \frac{-g\,\nabla H}{1 + k|\nabla H|^2} - (\mu + \kappa|\mathbf{v}|)\,\mathbf{v}, \qquad \mathbf{v} \leftarrow \mathbf{v} + \Delta t\,\mathbf{a}, \quad \mathbf{p} \leftarrow \mathbf{p} + \Delta t\,\mathbf{v}$$

The integration is semi-implicit, because explicit Euler gains energy on every bowl traverse. `src/utils/erosion.js` integrates droplets with inertia over the same grid and is the nearest existing relative.

**The carve constraint.** The heading cannot turn faster than a maximum yaw rate. A fast rider thus physically cannot take a tight line, and gets carried up the outside of a gully:

$$\Delta\theta \le \omega_\text{max}\Delta t, \qquad \omega_\text{max} = \frac{a_\text{lat}}{|\mathbf{v}|} \quad\Longrightarrow\quad r = \frac{|\mathbf{v}|^2}{a_\text{lat}}$$

The clamp binds when the *perpendicular* acceleration exceeds $a_\text{lat}$, which is a comparison with no speed in it. $a_\text{lat}$ thus means something only against the other acceleration in the system. Two scalings got this wrong before it worked. The first was against $g_\text{acc}$, which differs from the peak pull by a factor of $1/\bar{s}$, several hundred on ordinary ground. The second was linear across a range that sat entirely above the binding threshold. Both left the slider inert. The mapping is now geometric, $0.12 \cdot a_\text{peak} \cdot 0.03^{\,\text{carve}}$, which is the band that bites end to end.

**Gravity is normalised by the *typical* slope of the terrain, not by its steepest.** `maxSlope` is a maximum over the whole grid, so one cliff cell sets it and every ordinary slope then reads as almost flat. Measured on the sample plate, drag then stopped every run within a few dozen steps. The mode drew a field of short dashes. The mean over valid cells is stable against that and still scales with the terrain. That is what lets one Gravity setting behave the same on a quarry and an alp.

**The surface is pre-smoothed**, and not cosmetically. A rider has length, and does not launch off a one-cell bump or steer around one. That is the same argument that Ridge and Curvature make one derivative further down. A run must also *travel*. The builder drops any run that covers less than its own seed spacing, or a plate comes out speckled with marks a few pixels long.

### Fall Line

The track itself. `computeVertexColor` takes a 0–1 value in its second slot, and every other mode fills that slot with normalised slope. A fill with $|\mathbf{v}|/v_\text{max}$ turns the hypsometric ramp into a **speed** ramp for nothing, and the gradient picker becomes a telemetry palette. The one thing that the mode wants and cannot have is a stroke weight that follows speed. `layerStyle` resolves `weight` per layer, so a layer has one width.

### Berms

Only the lateral load: a tick on the outside of every turn, nothing on the straights. Length follows $|\mathbf{v}|\,|\Delta\theta| / a_\text{lat}$, which is the fraction of the grip of the rider in use. It reads 1 exactly where the yaw clamp binds. A normalisation against a *speed* instead is dimensionally wrong, and it put every tick below the visibility floor. A perfectly even plane draws nothing at all, which is the assertion of the spec.

### Air

The jumps, found rather than drawn. The rider leaves the ground when the ballistic path clears the surface. That is a convex break taken faster than gravity can pull the rider back down. The builder draws each flight on its true parabola, lifted off the ground because it *is* off the ground. There are two sub-layers: the flight, and the run-in into it.

Two things had to be right for this to mean anything:

- **The builder carries the descent as a rate per cell, not per step.** Per step is the natural thing to write, and it is wrong. A rider who accelerates down an even ramp covers more ground each step, so each drop exceeds the last. A prediction carried forward thus sits above the ground every time. On a constant-gradient plane that flagged 1 664 segments airborne, off nothing but its own acceleration.
- **The thresholds were swept, not derived.** The sweep ran over a plane, a single 4× break, and a rough field, each one read raw and smoothed. `airGravity` 0.3 with `lip` 0.12 is the lowest pair at which a plane yields exactly zero flights while a real break still fires. Below that pair, float noise on nominally flat ground starts to launch riders. Above it, a single change of gradient no longer registers. The builder discards flights shorter than `minAir` steps, because a scatter of one-step hops reads as broken line work rather than as air.

### Race Line

Every line that one drop-in can take: one seed, the initial heading fanned across ±θ, and no occupancy mask, because the overlap *is* the picture. The builder promotes the run that reaches the lowest ground soonest to its own sub-layer and inks it heavier. That turns a braid into an argument about which way down is best.

## 23–24. Space frame — Exploded Frame, Section

One lattice, two drawings of it. Truss and Weldment were cut, and the lattice survives as the machinery behind these two. Nodes sit on a regular grid of pitch `spacing`. The builder snaps each node to the highest cell inside its own square, so the frame hangs off real summits instead of samples between them. That is what stops a coarse frame from a miss of every peak that it is meant to describe.

**The bracing rule is the idea.** A rectangular panel with pin joints is a mechanism. It needs one diagonal, and *which* diagonal depends on which way the load racks it. The rack of the terrain is its **twist**, the mixed second derivative. Ridge and Curvature already assemble that off-diagonal of the Hessian from this same stencil. Here the builder measures it at the scale of the panel rather than of the cell:

$$h_{xy} = \tfrac14\big(H_{r+p,\,c+p} - H_{r+p,\,c-p} - H_{r-p,\,c+p} + H_{r-p,\,c-p}\big)$$

$$|h_{xy}| < \text{threshold} \;\Rightarrow\; \text{brace nothing}, \qquad h_{xy} > 0 \;\Rightarrow\; \text{NW–SE}, \qquad h_{xy} < 0 \;\Rightarrow\; \text{NE–SW}$$

The diagonal that the builder draws lies along the compression direction of the warp. The pattern thus *reads* the saddle rather than a decoration of it. The spec proves this rather than an assumption of it. Consider the field $H \propto (c-c_0)(r-r_0)$. That is the saddle whose $h_{xy}$ is a nonzero constant of known sign everywhere. Over it, every brace in the frame commits to one diagonal, and a flip of the sign of the field flips all of them. (The obvious saddle, $x^2 - y^2$, has $h_{xy} = 0$ and braces nothing at all.)

The builder pre-smooths the grid first, for the reason that those two modes give. Second derivatives amplify noise, and on a raw DEM every pixel of sensor grain asks for its own brace.

**The threshold is a percentile, not an absolute.** A frame is a drawing before it is an analysis. An absolute cutoff braces everything or nothing. The result depends on how rough the raster happens to be. *"The busiest 45% of the panels"* is a composition that survives a change of the terrain under it.

**Three pens.** `Exploded-Chord` is heavy, `Exploded-Brace` is a hairline, and `Exploded-Post` is dashed to a datum. This is what most wants the SVG exporter, and it gets it for nothing: three named layers arrive in Inkscape as three pens. Gussets ship as a `lids` mesh on the chord layer, so joints read as filled plates rather than rings. A braced joint gets more sides than a free one, which is free because the twist already sits on the node.

### Exploded Frame

The member classes pulled apart along Y, with one hairline per node that joins the displaced chord back to the ground that it came off. The builder computes nothing new. The sub-layer split already exists and this only moves it, which is the whole argument for the split.

### Section

The tool already *culls* by elevation, and `elevMinCut` and `elevMaxCut` are the terrain-level version of this idea. This is the same cut rendered as a drawing. The cut **face** is a heavy line at the plane. The solid **below** it is hatched at 45° in the drafting convention. The ground **beyond** it is in outline, so the section reads as a stand in a landscape rather than a float. The hatch is a set of parallel rays marched across the grid and broken wherever the surface rises above the plane. That is the same run-based marcher that Engraving uses, thresholded on height instead of on light. Face and hatch both lie exactly *in* the plane, at one elevation and no other.

## 25. Zero Crossings

Every sign change of the scanline after the app takes out its own running mean. The density of the marks is the local **pitch** of the terrain: how often the ground crosses its own average. That is a different measurement from either slope or curvature. It is dense on scree and broken rock, and empty on a glacier, regardless of how steep either one is. The detrend is what makes it a pitch rather than a horizon. Without the detrend, a scanline crosses its mean twice on a whole mountain and the mode draws two dots.

## 26–27. Sprite Blocks, Reticulation

### Sprite Blocks

Bitplane draws the *boundaries* between plateaus. This mode draws the plateaus themselves, one cuboid per lattice cell. Each cuboid has a top face at the snapped tier height, and side faces dropped only where the neighbour sits lower. Under an orthographic camera at 30° it is an arcade tile map.

The risers go to the tier of the **neighbour** rather than to a common floor. A drop of every block to the base plate buries the stack in one solid mass of vertical lines. What makes a voxel landscape legible is exactly one riser per step, with its height *being* the step. Top faces ship as a `lids` mesh, so a block reads as a solid plate and the stack self-occludes. That is the mechanism that Pillars already uses for its cuboid caps.

### Reticulation

Crazed emulsion. Reticulation in a real film is gelatin that cracks into a network of islands. The mark is thus the **boundary** between the cells, not the cells. That boundary is where the two nearest feature points are equidistant, which is the Voronoi diagram of the feature set. The builder gets it without a build of one:

$$F_1, F_2 = \text{the two smallest distances to jittered feature points}, \qquad \text{wall} \iff F_2 - F_1 < w$$

A Fortune sweep gives exact edges and costs a real data structure. This costs nine bucket lookups per sample and gives an edge with *thickness*, which is what a crack has. Feature points sit one per cell of a coarse grid, jittered from `mulberry32`, so a seed reproduces the pattern exactly.

Crack width is proportional to cell size. Total coverage thus stays roughly constant as the cells open up: fewer boundaries, each one wider. The crazing looks like crazing at any scale instead of a fade. Coverage is thus the job of `width`, not of the cell. The **tone gate** is what stops the whole thing from being wallpaper. The builder draws walls only where the plate is dark enough for a crack, on the same density modes that Stipple offers. The crazing thus pools in the shadows and leaves the highlights clean.


## 28–32. Colour modes — Indexed, Outrun, Riso, Mineral, Watershed

Every mode above takes its colour the same way. One scalar goes into one shared
gradient, and `computeVertexColor` samples it once per vertex. That single
function is where all colour in the tool comes from, and it is also the ceiling:
one input, one dimension, one ramp. These five break it in five different places.

Three of them draw **area** rather than line, through the `lids` mesh that
Pillars and Sprite Blocks already use for their caps. Two of them are about the
**blend** rather than the colour. They are the first line layers in the tool that
do not composite normally.

### Indexed

Colour as a lookup rather than a sample. Two terrain quantities index one small
palette:

$$e = \left\lfloor \hat{H} \cdot N_e \right\rfloor, \qquad
  s = \left\lfloor \hat{S}^{0.6} \cdot N_s \right\rfloor$$

The second axis is the point. A one-dimensional ramp cannot say *high and flat*
against *high and steep*, so a snowfield and the cliff beside it get the same
ink. A two-dimensional table separates them, and that separation is what makes
the picture read as terrain rather than as a heat map.

Between two adjacent entries there is no blend but a 4×4 Bayer screen, on how far
up its own band a cell sits. The checkerboard of two inks reads as a third that
the palette does not contain. That artefact is the aesthetic. It is what a
sixteen-colour machine did when it was asked for a sky.

The palette is the shared gradient, quantised. A per-mode array of stops is not
possible: `geometryKey` stringifies, so the rebuild cannot see an edit inside
one. `gradientStops` already solved that by living in
`GEOMETRY_NON_SCALAR`, so the colour modes borrow it rather than adding a second
exception.

This is the dual of Bitplane (§16), deliberately. That mode quantises *geometry*
and leaves colour continuous. This quantises *colour* and leaves geometry
continuous. They stack.

### Outrun

The first thing in the tool that adds light instead of ink. A wide dim halo
composites additively under a thin near-white filament. Where contours crowd, the
halos sum and the ground between them lifts to a glowing plane. Out on an open
face a single line hangs alone in the dark. Density becomes luminance for free,
because that is what the addition of light does.

The two halves must be two layers, and not for tidiness. `layerStyle` resolves
one `weight` for a whole layer, so a fat halo under a thin core is structurally
impossible in one. That constraint is the design.

Only the halo is additive. Additive light cannot darken anything. An all-additive
mode thus draws nothing at all on a white ground, and reads as broken the moment
it is switched on. The filament is ink and composites normally, which is
also the honest description of what the two pens are.

### Riso

Three spot inks, each carrying a different reading of the terrain, each screened
at its own angle and multiplied together. They are not composed, they are
*overprinted*. Every colour past the first three is one that the machine never
held: pink over aqua is a bruised violet, aqua over yellow a sharp green.

A traditional halftone is *amplitude*-modulated, with one grid and bigger dots
for more ink. This engine cannot do that, because `layerStyle` resolves one
`weight` for a whole layer and every dot in a pen is the same size. The screens
are *frequency*-modulated instead: a fixed dot at a varying density, which is
what modern presses use anyway. The rotated angles of 15°, 45° and 75° are still
what keeps three of them from moiré against each other.

Each separation is stretched to its own percentile range first. Raw, the three
fields occupy narrow and *different* bands on real terrain, so one ink covers the
sheet while the other two barely print.

Two controls decide which machine you are printing on, and they are the whole
range of the mode:

- **Registration.** Above zero the plates sit a hair apart, which is the tell of
  a real duplicator. At zero they are in perfect register, like a press.
- **Coverage cap.** A real press has a total-area-coverage ceiling. Past it the
  sheet cannot dry, so the shadows are pulled back. They go flat and slightly
  wrong-coloured, because the ink removed is whichever was contributing least. At the top of its range three inks cannot exceed 3.0, so the cap cannot
  bind and the mode prints everything.

The cap limits the three inks that this mode lays down. A limit across every enabled layer in the scene has no home in
the architecture. Nothing between the builders and the renderer sees all the
layers at once while their coverage is still known.

### Mineral

Colour that means a rock type rather than a height. Slope and curvature pick one
of five materials. Each material carries a flat colour and its own noise tooth,
so the surfaces differ in texture as well as in hue. That is how a geological
survey sheet distinguishes them.

Both cuts are **percentiles** of the distribution of this terrain, not fractions
of its maximum. Against `maxSlope` a single cliff cell sets the scale and every
other cell falls into one class. Measured on the sample plate, five materials
came out as one. That is the same failure that the Fall Line gravity had (§19).

Curvature is taken on a blurred grid, for the reason that Ridge (§9) and
Curvature (§14) give. A second difference on a raw DEM turns every pixel of
sensor grain into its own rock type.

### Watershed

Big flat areas of unmixed colour, with hard edges along the divides. The picture
is a map of where water goes rather than of how high anything is. The
boundaries are ridgelines, which is why they look drawn rather than imposed.

The machinery already existed. Stream Network (§7) walks this graph to accumulate
flow. Here every cell walks steepest descent to a sink and inherits the label of that
sink. It is the same D8 traversal, read for identity instead of for volume.

Two things were needed to make it a map rather than confetti:

- **The walk runs on a blurred grid.** D8 on a raw DEM finds a pit at every
  dimple. Measured on the sample plate that gave thousands of one-cell basins.
  A divide is a ridge, and a ridge is a second derivative in disguise.
- **Small basins fold into their largest neighbour, with path compression.** A
  small basin can fold into a neighbour that is itself small, so the chain has to
  be followed. A naive walk is O(basins²) and hung the worker outright. A
  fold-in is accepted only when it strictly increases the size of the target,
  which makes the graph a forest and makes the compression terminate.

### What the area modes plot

Indexed, Mineral and Watershed draw fills, and a fill is not a stroke. The SVG
exporter reads the per-vertex colour buffer and never looks at `lids`, so these
three exported an empty plate.

Each cell edge where the ink changes is now a real stroke. The plot is the
outline of each *region* rather than of each square: on Watershed those edges are
the divides, on Mineral the material boundaries, on Indexed the band steps. Every
cell edge is a wall of grid lines, and a plotter has no use for that.

What counts as the same area is the **region**, not the pixel colour. Mineral
grains every cell and Indexed dithers between two entries on purpose, so a
comparison of colours made every single cell edge a boundary. Each stroke also
carries the *base* ink of its region, without the grain or the relief shading
that the fill carries. Those modulate every cell separately, and using the fill
colour put 703 near-identical greens into a Mineral plot. Measured on the sample
plate, the modes now plot 6, 5 and 10 inks.

---

## NoData and clipped edges

A raster can have holes. They are the NoData cells of a GeoTIFF, the transparent
pixels of a PNG, and — most often — everything outside a selection in Edit Mode.
An Edit Mode selection is an ellipse, a lasso or a polygon. `buildTerrain`
records the holes in `gridMask` and stores
$H = 0$ there.

That zero is a trap, because 0 is not "absent". It is the darkest possible
ground, and $(H - 0.5)\cdot 100 \cdot \text{elevScale}$ puts it at the very
bottom of the scene. A read of it as terrain produces the artifact in three
different shapes, and every mode now guards against it.

**Sampling — normalised bilinear.** Some modes drape themselves on *fractional*
grid coordinates: Lines and Crosshatch at an oblique bearing, Engraving at every
angle, Flow, Swiss rock, and the vector drape. They take a 2×2 bilinear tap. A
tap whose footprint straddles a clipped edge blends real ground against those
zeros and returns a height near the floor. That drew a segment from the terrain
straight down to the base, all along the border of the selection.
`sampleBilinear` weights only the corners that carry data and renormalises
against them:

$$H(\mathbf{p}) = \frac{\sum_k w_k\,m_k\,H_k}{\sum_k w_k\,m_k}$$

where $m_k \in \{0,1\}$ is the mask of the corner. A tap with no data under it at
all returns NaN, which ends the stroke rather than a dive. At 0° and 90° the
Lines samples land exactly on grid cells, so those two angles never showed the
artifact. That is why it read as an Engraving problem.

**Blur — normalised convolution.** The same reasoning applies to every box blur:
the terrain pre-blur, and the pre-smoothing inside Ridge, Curvature and Valley.
An average across a hole drags the mean toward zero for the width of a radius
inside the valid region. `boxBlur` takes an optional mask and then computes
$\sum w\,m\,v \,/\, \sum w\,m$, which is the mean over the valid samples alone.
The app engages it only when the mask actually has holes (`terrain.hasNoData`). A
solid raster keeps the cheaper path, and its output is unchanged.

**Stencils — NoData reads as flat.** Ridge, Curvature and Pencil Shading
differentiate the field, and a second difference taken against a zero is the
largest curvature anywhere on the terrain. The border of a selection was thus
found first and drawn as a crest. Each stencil tap now substitutes the centre
value for a masked neighbour, which says "flat that way" instead of "a cliff that
way". This matters most for Curvature, whose threshold is a fraction of the
maximum strength on the terrain: the phantom rim *set* that maximum, and the mode
collapsed to a few strokes on the edge.

Contours are the deliberate exception. Marching squares treats a NoData corner as
below every level. Isolines thus close against the edge of the data as shorelines
rather than a stop short of it.

---

## Ghost Occlusion

Every mode shares the same depth-ordering system.

For each line segment, the app generates a thin triangulated curtain mesh immediately beneath it. The mesh extends vertically to the base of the scene. The app renders the curtains to the depth buffer only, so they are invisible and write no colour. In the colour pass that follows, a line segment that falls behind an existing curtain is occluded. It either disappears, or the app renders it with a separate ghost colour and opacity. The occlusion parameters decide which.

This approach gives true line-to-line depth awareness without a reliance on terrain surface depth. Terrain surface depth clips the lines by the mesh that they are drawn on.
