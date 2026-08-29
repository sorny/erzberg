# Draw Modes

`erzberg` treats the loaded heightmap as a discrete scalar field $H(x, y)$ and extracts topographic features from it using thirty independent algorithms. Each mode produces its own `LineSegmentsGeometry` and can be styled, dashed, and hypsometrically tinted separately.

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

## 16. Bitplane

The terrain as a tilemap: flat plateaus, hard lattice staircases between them, and an ordered dither screening one band into the next.

**The quantiser.** Normalised elevation is cut into $N$ tiers and every vertex is snapped to its tier's floor,

$$t(r,c) = \left\lfloor \hat{H}(r,c) \cdot N \right\rfloor, \qquad y = \min + t \cdot \frac{\max - \min}{N}$$

where $\hat{H}$ is `normElev` against the terrain's own bounds rather than raw brightness. That anchoring is the same argument the contour ladder makes: the steps are terrain-relative, so the exaggeration slider scales them without reshuffling which cell sits on which plateau. Reading brightness directly would also invert incorrectly at negative `elevScale`, where `minElev`/`maxElev` are deliberately ordered and brightness is not.

**The staircase is marching squares with the interpolation removed.** Where two neighbouring cells land on different tiers, the shared cell *edge* is emitted whole — axis-aligned, at the higher tier's height. Contours interpolate that crossing to get a smooth isoline; refusing to is the entire difference between the two modes, and it is what turns a curve into a pixel staircase. Only the east and south neighbours are tested, since every interior edge is shared by exactly two cells and two directions visit each edge once. No chaining is needed: the segments already meet exactly at lattice corners, which is what keeps the steps crisp rather than stitched.

With **Risers** on, each step is closed by the two verticals down to the lower plateau, so the mode reads as a stack of blocks under an orthographic camera — the isometric reading. Off, it is a flat staircase seen from above.

**The screen** is a $4 \times 4$ Bayer matrix $B$ over the residual $f = \hat{H} \cdot N - t$, which is how far up its own band a cell sits:

$$\text{ink}(r,c) \iff f \cdot \text{dither} > \frac{B[r \bmod 4][c \bmod 4] + \tfrac12}{16}$$

Ordered dither is the wrong screen for a photograph and the right one here — it lays down a visible, regular pattern, which is exactly what a 16-colour ramp looks like when it shades a sky. (Flashbulb wants blue noise for the opposite reason.)

The two ship as separate layers, `Bitplane-Step` and `Bitplane-Screen`, because they want two pens and because one of them is `isPoints` and the other is not — the same split Rock & Scree makes between its cliff hachures and its debris. Hypsometric tinting reads the *tier* rather than the vertex elevation, so the ramp bands with the plateaus instead of cutting across them.

## 17. Flashbulb

One bare bulb inside the scene, and the terrain as a police flash photograph: the near flank blown to bare paper, the far side crushed to solid, and a narrow band of tone between them carried entirely by grain.

**Why nothing else in the tool can light it this way.** Engraving, Isophotes and the hillshade shader share one convention — azimuth around, altitude pinned at 45°, *parallel* rays. Parallel rays have no falloff, and falloff is the entire subject. The light goes at a world position inside the scene instead:

$$E = \frac{\max(0,\; \hat{n} \cdot \hat{d})}{1 + (r/r_0)^2}, \qquad d = L - P,\; r = |d|$$

The $1+$ keeps the light finite as the bulb approaches the ground. $r_0$ decides which band of terrain survives at all; everything after it is a tone curve.

The bulb is exposed as **azimuth, distance and height** rather than as a raw XYZ triple — three unlabelled world coordinates are not something anyone can aim, and azimuth is already the vocabulary the Hillshade section teaches. Distance and height are *fractions*, of the terrain's half-diagonal and of its elevation range, so one setting frames a 40 m quarry and a 3 000 m mountain alike.

**Referenced to a percentile, not to the brightest cell.** One sample a few units from the bulb otherwise sets the scale for the whole plate and everything else crushes to solid — measured, that put 84% of the terrain at full ink. The reference is the 68th percentile of exposure over the sampled cells, taken from a 512-bin histogram rather than a sort, so it costs one pass. The defaults were then measured against ~40% ink coverage on a reference massif; the first guess covered 59% and came out a black slab.

**Shadows are marched, not inferred.** This is the CPU twin of `hillshadeCastShadows` in the surface shader and takes the same step count, so the two agree when both are on. The march runs in *grid* coordinates, so its inner loop is an array index and a compare. It is the expensive part of the mode, so it is skipped wherever it cannot change the answer: a cell facing away from the bulb is already dark, and a cell whose unshadowed tone is already solid cannot get darker.

**The grain is blue noise.** Ordered dither lays down a visible screen — which is exactly right at Bitplane and the one thing that would kill a photograph. Blue noise carries a tone without printing a pattern, because its energy sits at high spatial frequencies. The tile is 64×64, built once by void-and-cluster (Ulichney 1993) and held at module scope; it is toroidal, so it wraps across the grid without a seam. Measured against a random threshold at the same density, it holds its points about 1.6× further apart at sparse tones.

Two constraints are worth stating because they shaped the mode:

- **The tile is walked per *sample*, not per cell.** Indexing it by grid position while sampling at a coarser pitch would decimate the pattern and take the blue out of it.
- **Dot size cannot vary.** `weight` is resolved per layer by `layerStyle`, so every dot in the layer has the same radius — the variation has to come from density and position jitter alone. That is a property of the line contract, not a choice.

**Solarise** folds the tone curve, $T \rightarrow |2T - 1|$, so highlights reverse and a bright rim appears exactly at mid-tone — the Sabattier effect. It is one line on top of everything above, which is why it is a switch here rather than a mode of its own.

## 18. Halation

Flashbulb's optics, plus the glow a blown highlight throws into the shadow beside it. The lit crest of a ridge bleeds outward; the grain next to it is eaten away; a warm halo pools in what is left.

**What actually scatters.** Halation in a real emulsion is light that got *through* the silver, bounced off the film base and came back — so the thing that spreads is the light the highlight could not hold, and the field to blur is the **overexposure**:

$$\text{over} = \max\!\left(0,\; \frac{E}{E_\text{ref}} \cdot \text{exposure} - 1\right), \qquad \text{bloom} = \text{boxBlur}(\text{over},\, \text{radius})$$

Blurring the exposure *gradient* instead is the obvious first idea, and it is wrong in a way that only shows on real terrain: every ridge and gully is an edge, so a busy massif blooms uniformly and the halo covers the picture rather than pooling beside the bright parts of it. Only genuinely blown highlights scatter, and `over` is exactly them — which is also what makes the mode do nothing at all on an under-exposed plate, as it should.

The blur is the same `boxBlur` the Blur slider runs, taken over the *exposure lattice* rather than the raster — so its radius is in sample pitches, and it inherits the mask-aware path, which stops a clipped edge from ringing the selection with a halo of its own.

**Two populations, two inks.**

- **`Halation-Grain`** is Flashbulb's grain with the bloom subtracted from the darkness, $\text{inked} = \max(0,\, T - \text{bloom} \cdot \text{bleed})$. That subtraction *is* the halation; with `bleed` at 0 the glow would sit on top of the picture instead of consuming it, and the mode would just be Flashbulb with confetti.
- **`Halation-Bloom`** is the halo, drawn where the bloom is strong *and* the ground is dark, $\text{halo} = \text{bloom} \cdot \text{glow} \cdot T$. A glow over an already-blown highlight is invisible, and drawing it there only wastes ink.

The two read the blue-noise tile at a half-tile offset from one another. Sharing an index would correlate them exactly — every halo dot would land on a cell the grain had already claimed, and the halo would vanish into it instead of reading as a second pass.

The optics themselves (`flashExposure`, `flashShadowed`, `flashTone`) are shared with Flashbulb rather than reimplemented; with the glow turned off the two modes agree cell for cell, which is what the spec pins.

## 19–22. Descent with mass — Fall Line, Berms, Air, Race Line

Four readings of one tracer. Flow (mode 6) steps $\mathbf{p} \leftarrow \mathbf{p} - \alpha \nabla H$: a *massless* particle that points exactly downhill at every step. It cannot overshoot, cannot bank, and stops the instant the gradient does — correct for drainage, and why Flow reads as a river network. This family integrates a **state** instead:

$$\mathbf{a} = \frac{-g\,\nabla H}{1 + k|\nabla H|^2} - (\mu + \kappa|\mathbf{v}|)\,\mathbf{v}, \qquad \mathbf{v} \leftarrow \mathbf{v} + \Delta t\,\mathbf{a}, \quad \mathbf{p} \leftarrow \mathbf{p} + \Delta t\,\mathbf{v}$$

Semi-implicit, because explicit Euler gains energy on every bowl traverse. `src/utils/erosion.js` integrates droplets with inertia over the same grid and is the nearest existing relative.

**The carve constraint.** The heading may not turn faster than a maximum yaw rate, so a fast rider physically cannot take a tight line and gets carried up the outside of a gully:

$$\Delta\theta \le \omega_\text{max}\Delta t, \qquad \omega_\text{max} = \frac{a_\text{lat}}{|\mathbf{v}|} \quad\Longrightarrow\quad r = \frac{|\mathbf{v}|^2}{a_\text{lat}}$$

The clamp binds when the *perpendicular* acceleration exceeds $a_\text{lat}$ — a comparison with no speed in it — so $a_\text{lat}$ only means something stated against the other acceleration in the system. Two scalings got this wrong before it worked: against $g_\text{acc}$ (which differs from the peak pull by a factor of $1/\bar{s}$, several hundred on ordinary ground) and then linearly across a range sitting entirely above the binding threshold. Both left the slider inert. The mapping is now geometric, $0.12 \cdot a_\text{peak} \cdot 0.03^{\,\text{carve}}$, which is the band that actually bites end to end.

**Gravity is normalised by the terrain's *typical* slope, not its steepest.** `maxSlope` is a maximum over the whole grid, so one cliff cell sets it and every ordinary slope then reads as almost flat; measured on the sample plate that left drag stopping every run within a few dozen steps, and the mode drew a field of short dashes. The mean over valid cells is stable against that and still scales with the terrain, which is what lets one Gravity setting behave the same on a quarry and an alp.

**The surface is pre-smoothed**, and not cosmetically: a rider has length, and does not launch off — or steer around — a one-cell bump. Same argument Ridge and Curvature make one derivative further down. A run must also *travel*: anything that has not covered its own seed spacing is dropped, or a plate comes out speckled with marks a few pixels long.

### Fall Line

The track itself. `computeVertexColor` takes a 0–1 value in its second slot that every other mode fills with normalised slope; filling it with $|\mathbf{v}|/v_\text{max}$ turns the hypsometric ramp into a **speed** ramp for nothing, and the gradient picker becomes a telemetry palette. The one thing the mode wants and cannot have is stroke weight following speed — `weight` is resolved per layer by `layerStyle`, so a layer has one width.

### Berms

Only the lateral load: a tick on the outside of every turn, nothing on the straights. Length follows $|\mathbf{v}|\,|\Delta\theta| / a_\text{lat}$ — the fraction of the rider's grip in use, reading 1 exactly where the yaw clamp binds. Normalising against a *speed* instead is dimensionally wrong and put every tick below the visibility floor. A perfectly even plane draws nothing at all, which is the spec's assertion.

### Air

The jumps, found rather than drawn. The rider leaves the ground when the ballistic path clears the surface — a convex break taken faster than gravity can pull it back down — and each flight is drawn on its true parabola, lifted off the ground because it *is* off the ground. Two sub-layers: the flight, and the run-in leading into it.

Two things had to be right for this to mean anything:

- **The descent is carried as a rate per cell, not per step.** Per step is the natural thing to write and it is wrong: a rider accelerating down an even ramp covers more ground each step, so each drop exceeds the last and a prediction carried forward sits above the ground every time. On a constant-gradient plane that flagged 1 664 segments airborne — launching off nothing but its own acceleration.
- **The thresholds were swept, not derived.** Over a plane, a single 4× break, and a rough field read raw and smoothed, `airGravity` 0.3 with `lip` 0.12 is the lowest pair at which a plane yields exactly zero flights while a real break still fires. Below it float noise on nominally flat ground starts launching riders; above it a single change of gradient stops registering. Flights shorter than `minAir` steps are discarded — a scattering of one-step hops reads as broken line work rather than as air.

### Race Line

Every line a single drop-in could have taken: one seed, the initial heading fanned across ±θ, and no occupancy mask, because the overlap *is* the picture. The run reaching the lowest ground soonest is promoted to its own sub-layer and inked heavier, which turns a braid into an argument about which way down is best.

## 23–26. Space frame — Truss, Exploded Frame, Section, Weldment

One lattice, four drawings of it. Nodes sit on a regular grid of pitch `spacing`, each snapped to the highest cell inside its own square — so the frame hangs off real summits instead of sampling between them, which is what stops a coarse frame from missing every peak it is meant to describe.

**The bracing rule is the idea.** A rectangular panel with pin joints is a mechanism: it needs one diagonal, and *which* diagonal depends on which way it is being racked. The terrain's rack is its **twist**, the mixed second derivative — the off-diagonal of the Hessian that Ridge and Curvature already assemble from this same stencil, measured here at the panel's scale rather than the cell's:

$$h_{xy} = \tfrac14\big(H_{r+p,\,c+p} - H_{r+p,\,c-p} - H_{r-p,\,c+p} + H_{r-p,\,c-p}\big)$$

$$|h_{xy}| < \text{threshold} \;\Rightarrow\; \text{brace nothing}, \qquad h_{xy} > 0 \;\Rightarrow\; \text{NW–SE}, \qquad h_{xy} < 0 \;\Rightarrow\; \text{NE–SW}$$

The diagonal drawn lies along the compression direction of the warp, so the pattern *reads* the saddle rather than decorating it. The spec proves this rather than assuming it: over the field $H \propto (c-c_0)(r-r_0)$ — the saddle whose $h_{xy}$ is a nonzero constant of known sign everywhere — every brace in the frame commits to one diagonal, and flipping the field's sign flips all of them. (The obvious saddle, $x^2 - y^2$, has $h_{xy} = 0$ and would brace nothing at all.)

The grid is pre-smoothed first, for the reason those two modes give: second derivatives amplify noise, and on a raw DEM every pixel of sensor grain asks for its own brace.

**The threshold is a percentile, not an absolute.** A frame is a drawing before it is an analysis. An absolute cutoff braces everything or nothing depending on how rough the raster happens to be, while *"the busiest 45% of the panels"* is a composition that survives changing the terrain under it.

**Three pens.** `Truss-Chord` heavy, `Truss-Brace` hairline, `Truss-Post` dashed to a datum — the mode that most wants the SVG exporter, and it gets it for nothing: three named layers arrive in Inkscape as three pens. Gussets ship as a `lids` mesh on the chord layer so joints read as filled plates rather than rings, and a braced joint gets more sides than a free one, which is free because the twist is already on the node.

### Exploded Frame

The member classes pulled apart along Y, with one hairline per node joining the displaced chord back to the ground it came off. Nothing new is computed — the sub-layer split already exists and this only moves it, which is the whole argument for having split them.

### Section

The tool already *culls* by elevation; `elevMinCut`/`elevMaxCut` are the terrain-level version of this idea. This is the same cut rendered as a drawing: the cut **face** as a heavy line at the plane, the solid **below** it hatched at 45° in the drafting convention, and the ground **beyond** it in outline so the section reads as standing in a landscape rather than floating. The hatch is a set of parallel rays marched across the grid and broken wherever the surface rises above the plane — the same run-based marcher Engraving uses, thresholded on height instead of on light. Face and hatch both lie exactly *in* the plane, at one elevation and no other.

### Weldment

The frame as a parts drawing: every joint a gusset plate, every *braced* joint called out with a leader running to clear ground and a shelf for the number to sit on. Which joints get called out is a real reading rather than a decoration — they are the ones the bracing rule picked, so the annotation points at the panels doing work. Leaders run at a fixed bearing in $+x$, the same convention the contour labels use, since the scene orbits and a camera-relative one would swing.

The number itself is deliberately not drawn in the worker: lettering needs a font and a font is on the main thread. The mode emits `labelAnchors` in world coordinates instead — the same division `buildContours` and `useContourLabels` already make, where the worker decides *where* and the main thread decides *what it says* — rather than inventing a second lettering path.

## 27–30. The scanline as a signal — Bandsplit, Envelope, Lissajous, Zero Crossings

### Bandsplit

The terrain as a spectrum analyser: one scanline, drawn once per octave band. **This is not Unknown Pleasures** — Lines stacks whole scanlines and every trace in it is a different *place*; here every trace is the same place at a different *scale*.

Splitting a signal into frequency bands is an FFT's job, and `src/utils/fft.js` is already in the tree. It is the wrong tool here for three reasons: it needs power-of-two padding per scanline, it rings either side of every cliff, and it costs a transform per row per rebuild. A **Laplacian pyramid** is the same decomposition, O(W·H) per level, with none of that:

$$G_b = \text{boxBlur}(H, r_b),\quad r_b = r_0 \sigma^b \qquad L_b = G_b - G_{b+1} \qquad L_B = G_B$$

with σ = 2, which is what makes the bands octaves. `boxBlur` is the same pass the Blur slider runs and inherits its mask-aware path.

$\sum_b L_b = H$ **exactly**, so a gain vector reconstructs a filtered terrain and the mode becomes a graphic equaliser for landform. That identity is the mode's only real claim, and the spec tests it directly: draped at unit gain, every drawn vertex lands on the ground it came from to within 0.1% of the elevation range — compared against the *bilinear* sample at its own fractional position, since a nearest-cell comparison folds half a cell of relief into the error and measures the sampler instead.

Two presentations off one switch. **Stacked** puts each band at a fixed height above the floor and is a diagram; **draped** adds them back onto the surface at their own gains and is a filter — cut the lows and the range collapses to a rough plain, cut the highs and it stays a smooth swell with the same skyline.

The bands differ by orders of magnitude — the residual is the whole massif, the top band is scree — so each is normalised by its own peak before drawing. At a shared scale the detail bands are invisible. The residual is a brightness and the detail bands are signed differences about zero, so only the residual is re-centred.

The gains are flat-named `gain0…gain6` rather than an array, and that is not cosmetic: `geometryKey` builds a *string*, so an array stringifies to `[object Object]` however it is edited and the rebuild would never fire. See `GEOMETRY_NON_SCALAR`. Colour comes from the band index rather than the elevation, which makes the gradient picker the band palette for nothing.

### Envelope

The DAW clip. An attack/decay follower over the detrended scanline, drawn as ±e about the ground:

$$e \leftarrow \max\big(|x|,\; e \cdot \text{decay}\big) \quad\text{forward, then again backward}$$

The second pass is not an optimisation. A one-directional follower is lopsided by construction — it rises instantly at a transient and decays only afterwards, so every peak gets a tail on one side and a cliff on the other. Running it back over its own output symmetrises the envelope, which is what makes the shape read as a waveform block rather than a row of sawteeth; the spec asserts that symmetry about the baseline.

Detrending first matters for the same kind of reason: the envelope is of the *roughness*, not of the elevation, so the massif has to come out or the envelope is just the massif. **Rungs** tie the two curves together every N cells — what turns a pair of lines into a filled block on a plotter, which has no fill.

### Lissajous

Two orthogonal scanlines plotted against each other as an XY oscilloscope figure. It reads as pure signal and barely as terrain, which is the point: the one mode here that describes the raster without describing its shape. Drawn flat at a chosen elevation rather than draped — draping would put the trace at the elevation of a *third* place, unrelated to either axis, which is exactly the accidental meaning a diagram should not acquire.

### Zero Crossings

Every sign change of the scanline after its own running mean is taken out. The density of the marks is the terrain's local **pitch** — how often the ground crosses its own average — which is a different measurement from either slope or curvature: dense on scree and broken rock, empty on a glacier, regardless of how steep either is. Detrending is what makes it a pitch rather than a horizon; without it a scanline crosses its mean twice on a whole mountain and the mode draws two dots.

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
