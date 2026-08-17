# Murmurations

The second thing the Particles section can draw. Where the hologram field pins a
particle to every terrain cell and shimmers it in place, **Murmuration** flies a
flock of boids over the relief — steered by the terrain, not merely placed above
it.

Implementation: `src/utils/murmuration.js` (the simulation, pure) and the
murmuration branch of `src/components/ParticleSystem.jsx` (the geometry, the
materials and the per-frame step).

---

## The rules

The three classic ones, from Reynolds' *Flocks, Herds, and Schools* (1987):

> Reynolds, C. W., *Flocks, Herds, and Schools: A Distributed Behavioral Model*,
> SIGGRAPH '87. [Full text](https://www.red3d.com/cwr/papers/1987/boids.html)

**Separation** — steer away from neighbours inside the separation radius,
weighted by $1/d$ so an imminent collision outranks mere proximity. This is what
keeps the flock's internal spacing even rather than clumped.

**Alignment** — steer the heading toward the mean velocity of the neighbourhood.

**Cohesion** — steer toward the neighbourhood's centre of mass.

Each is a *steering force* in Reynolds' sense: the difference between the
velocity the bird wants and the one it has.

$$\mathbf{F} = \hat{\mathbf{d}} \cdot v_{\text{cruise}} - \mathbf{v}$$

Reynolds also clamps each such force to a maximum, as a turn-rate limit. That
clamp is not here, because it provably never fires — see
[the dead clamp](#the-arithmetic-and-one-dead-clamp) below. `maxForce` still
exists and still matters: every force that is *not* a steering term — ground
avoidance, the flight envelope, turbulence, the predator — is expressed as a
multiple of it.

Speed is then clamped to $[0.65, 1.35] \cdot v_{\text{cruise}}$. The floor is not
decoration: birds do not hover, and a flock allowed to slow to a stop settles
into a stationary cloud — the failure mode that looks least like a bug.

### Topological, not metric

A bird flies with its **eight nearest neighbours**, not with everything inside
the perception radius. The radius is only a search bound; the count is the rule.

That is what real starlings do:

> Ballerini, M. et al., *Interaction ruling animal collective behavior depends on
> topological rather than metric distance*, PNAS 105(4), 2008.
> [Full text](https://www.pnas.org/doi/10.1073/pnas.0711437105)

They found each bird tracks six or seven neighbours regardless of how tightly
the flock is packed — and that this is precisely what keeps a murmuration
cohesive as it compresses and expands, and what lets a predator's strike
propagate as a travelling wave rather than a local dent. A metric rule loses the
flock's edges the moment it spreads out.

One honest caveat: the eight are *approximately* the nearest, not exactly. The
search takes the first eight it accepts while scanning outward from the bird's
own hash cell, which is a near-neighbour set rather than a sorted k-nearest one.
Sorting candidates by distance would cost more than the whole rest of the step
and change nothing anyone can see.

This is also, conveniently, what makes the cost linear in population: see below.

## What the terrain contributes

Four more forces, and these are the reason this feature belongs in a topographic
tool rather than being a boids demo with a mountain behind it. All four read data
`buildTerrain` already returns.

**Ground avoidance.** Height under the bird comes from `sampleBilinear`
(`src/utils/terrain.js`) — the NoData-safe tap. Below the clearance band, an
upward force ramps in that dominates every other term, so the flock drapes over a
ridge instead of shearing through it. The integrator also holds a hard floor: the
steering force alone can be outrun on a cliff face, and a bird drawn underground
is the one artefact a viewer notices immediately.

A plain bilinear tap would not do. The grid stores `0` for NoData, and `0` is not
"absent" but the darkest possible ground, which
$(b - 0.5) \cdot 100 \cdot \text{elevScale}$ puts at the very bottom of the
scene — so a tap straddling a lasso crop reports a floor that is not there, and
the flock would dive into it all along the cut. Where the footprint holds no data
at all the sampler returns `NaN`, and the bird heads for the roost rather than
treating the void as ground.

**Roost.** An attractor above the highest ground, found by a strided scan capped
at ~64k samples (a roost a couple of cells off the true summit is a roost on the
summit). The pull is zero inside a free radius and ramps to full beyond it — a
constant pull collapses the flock onto the peak, while the ramp makes it *orbit*,
which is the shape people mean by "murmuration".

**Ridge lift.** Updraft over steep ground and sink over the flats, read from
`gridSlopes`, decaying with height above the terrain. The flock finds the
ridgelines on its own and traces them.

Steepness is normalised as $s / (s + \bar{s})$ — exactly $0.5$ at the terrain's
own mean slope — rather than against `maxSlope`. Normalising against the maximum
makes the reading a function of one outlier cell: on a uniform cone every sample
reads near 1 and the lift is a constant updraft; on a landscape with a single
cliff in it every sample reads near 0 and the lift is a constant downdraft.
Either way the flock drifts to one end of its envelope and parks there.

**Flight envelope.** A slab of air around the roost height, pushed back into from
*both* sides. A bare ceiling is not enough for the same reason: ridge lift has no
obligation to average to zero over a given landscape.

## Shadows

Each bird drops a soft dark disc onto the terrain. Not a shadow map — this scene
has no lights at all, and the terrain's own shading is faked in the surface
shader — so the shadow is faked the same way: solved analytically by walking from
the bird along the sun ray until it meets the ground.

The direction is the **hillshade sun**, the same
$(\cos\alpha\cos h,\ \sin h,\ \sin\alpha\cos h)$ vector `SurfaceMesh` lights the
terrain with. A flock lit from a different angle than the ground it flies over
looks wrong instantly, and sharing the parameter means the two cannot drift
apart: move the azimuth and the shadows swing with the hillshading. Because the
Hillshade section hides those sliders when hillshading is switched off — and the
flock's shadows do not require it — the same two values are surfaced again in the
Particles section. One parameter, two places to reach it.

Given a bird at height $h$ above the ground and a sun altitude $\theta$, the
shadow lands $h \cot\theta$ away, opposite the azimuth. Finding the true
intersection would mean marching the ray; instead there are exactly **two**
terrain taps — one for the drop under the bird, one for the ground the shadow
lands on. A third pass refining the position again moved shadows by well under
their own width and cost half the feature's whole surcharge. The altitude is
clamped to 5° and the throw capped at 0.6·span, because a sun on the horizon
casts to infinity.

A shadow is only drawn where there is ground to receive it. That needs a
*stricter* sampler than the flock's own: `sampleBilinear` clamps its row and
column into range, which is right for a bird — one that strays past the edge
should still see ground beneath it rather than fall off the world — but for a
shadow it hands back the height of the nearest edge cell, so a shadow thrown past
the boundary hung in mid-air beside the terrain, and one landing in a lasso'd-out
hole lay on ground that is not there. `groundAt` returns `NaN` outside the grid
as well as inside its holes, and a shadow with no ground under it is marked
`aLift < 0` and skipped — thrown outside clip space by the vertex shader, and
passed over by the exporter. With a 10° sun over a holed raster that culls about
a quarter of them. Note "ground" here means what it means everywhere else in the
app since 0.9.7 — a 2×2 footprint with at least one valid corner — so a shadow on
the *rim* of a cut is kept, because that ground genuinely is there.

The sprite grows and fades with the bird's height above ground, which is the
entire depth cue — without it the flock reads as pasted onto the terrain rather
than flying over it. `Sh. spread` is that growth; at 0 every shadow is the same
size whatever the altitude.

Shadows cost roughly **a third on top of the simulation**, since they add a
terrain tap per bird. Free at the default 2 000; the reason the 100 000 ceiling
is a 60 fps flock without them and an 18 fps one with.

## Listening to a track

Load a track in the Particles panel and the flock flies to it. **The terrain is
not touched.** That distinction is the whole design: `useSoundscape` exists to
*become* the landscape — every frame it analyses is pushed into the heightmap
store — and wanting birds that react to music is not wanting your raster
replaced by a spectrogram. So the flock has its own audio (`useFlockAudio`),
which decodes, analyses and plays while touching no store at all.

If a Soundscape *is* loaded, it is used as a fallback, so the same file never has
to be uploaded twice. Own track first, Soundscape second, and the panel says
which one it is listening to.

Either way the features come from a *precomputed spectrogram read at the
playhead*, not from an `AnalyserNode` on the output. Three things follow:

- **scrubbing works** — the features are a function of time, not of a running
  stream, so dragging the playhead makes the flock react to where it lands;
- it is deterministic: the same track at the same second gives the same reading;
- it costs a few hundred array reads per frame instead of an FFT.

The trade is that this is what the *file contains*, not what the speakers emit:
volume, muting and the browser's output chain are invisible to it.

The flock's own analysis is deliberately coarser than the Soundscapes one — 128
bins rather than 512. Nothing here becomes a heightmap, and three bands plus a
flux figure cannot use the resolution a terrain needs.

### What it hears

Three bands, because a kick, a voice and a cymbal pull the flock in visibly
different directions while five bands mostly yield sliders nobody can hear:
**bass** (20–160 Hz), **mid** (160 Hz–2 kHz), **high** (2–16 kHz). Each is
peak-held over its bins, then run through an envelope with a fast attack and a
slow release — percussion arrives instantly and decays, and equal rates give a
flock that lags the beat and twitches after it.

Loudness is **auto-gained** against a running peak that halves every four
seconds. The stored values are absolute dB and music is not, so without it a
quiet track never moves the flock and a loud one pins every slider.

Onsets come from **spectral flux** — the summed *rise* between consecutive
analysis frames, falls ignored, which is what finds attacks rather than
amplitude. It is measured against the last frame actually read, not the last
render: the analysis runs at ~86 frames a second and the renderer at 60, so on
some frames the playhead has not reached a new column, and re-measuring against
the same row would report zero and chop every onset into a flicker.

### What it drives

Audio is a **parameter transform on the way into the simulation**, not a new set
of forces. `stepFlock` resolves its scales from params on every call, so the
whole feature lives outside the physics and `murmuration.js` never learns audio
exists. It also means every mapping is something you could have dialled by hand,
which keeps the result legible rather than magic.

| Control | Feature | Acts through | Effect |
|---|---|---|---|
| **Size** | bass, level | uniform | Sprites swell on the kick and streaks lengthen with energy |
| **Burst** | onsets | velocity | Throws the flock outward from its own centre |
| Pace | overall level | speed clamp | Flight speed, centred so an average passage flies at the dialled speed and quiet ones genuinely slow down |
| Pulse | bass | force | Separation opens while cohesion eases — the flock *breathes*. Pulling both the same way only makes it vibrate |
| Shimmer | high | force | Turbulence, on top of whatever is dialled in |
| Startle | onsets | force | Widens the predator's fear radius, so an accented beat tears the same hole a strike does. Needs the predator on; **Burst** does not |

### Why the top two exist

The first version of this drove only the force channels, and the result was both
faint and late. That is not a tuning problem, it is the integrator: a steering
force changes velocity at `acc·dt` bounded by the turn-rate limit, and only then
changes position, so a beat arrives on screen as a vague swell a few hundred
milliseconds afterwards. Modulating parameters is inherently low-pass.

So the two most percussive channels bypass it. **Size** is a shader uniform —
it changes on the frame it is set, with no lag at all. **Burst** writes velocity
directly rather than applying a force, so an onset lands immediately; the speed
clamp renormalises on the next substep, which turns the impulse into the flock
snapping *outward*, and it re-forms on its own because no flocking rule was
touched.

It was also worth noticing that Startle — the most percussive control in the
panel — routed through the predator's fear radius, and the predator is off by
default. The punchiest mapping did nothing at all out of the box.

Measured against the test fixture, which bursts once a second: the flock's
on-screen footprint carries a 1 Hz component of amplitude 358 against a
neighbouring-frequency floor of 41, where a silent flock manages 61 against 34.
The beat is a line in the flock's motion, not a wobble.

### Ranges

Each channel has an input **range** under its amount: the slice of that signal's
0…1 which gets stretched across the whole response.

This is the control a dense track needs, and an amount slider cannot substitute
for it. The band envelopes are auto-gained against the track's own recent peak,
so on something loud from end to end — drum and bass, the back half of most
choruses — they sit near the top and barely move. Scaling a signal that is not
varying only scales a constant. Measured on a synthetic envelope oscillating
between 0.86 and 0.94: **unwindowed it swings 0.08 of its available range;
windowed to exactly that slice it swings the full 1.0.** Same input, same
amount, a reaction you can see.

Each channel windows separately because each is looking for something different
in the same track. Burst wants only the sharpest attacks and starts windowed at
0.15–0.90, since raw onset values sit low and dense music produces a wall of
small ones that would disperse the flock. Pace wants the broad shape of the
whole thing. Pulse and Size both read bass but are usually wanted at different
thresholds — a swell you can see before the flock has moved at all, against a
kick you can feel.

The meter draws each window as a bracket behind its band's envelope cap, so
setting one is a matter of watching where the track actually sits and putting the
window around it rather than guessing.

### Transport

Play, restart, ±5 s, a scrub bar and a loop toggle. Skipping *wraps* rather than
clamping, so stepping back from the first second of a looping track lands near
its end instead of pinning at zero.

Seeking needs no resynchronisation of anything downstream, which is the same
property that makes this design work at all: everything the flock reads is a
function of *time*, taken from the precomputed spectrogram at `currentTime`
rather than from a running stream. Drop the playhead anywhere and the next frame
simply reads a different column. Scrubbing is wired to `input` rather than to
release for that reason — the flock reacts as you drag, which is how you find
the bar you were looking for.

The playhead is read in an animation frame and written straight to the DOM: the
range input's value and one text node. A scrubber backed by React state would
re-render the entire sidebar several times a second, which for a panel this size
is the most expensive thing on the page and exactly what the rest of the audio
path is built to avoid.

### The meter

Above the sliders is a live readout of what the flock is hearing and what that
is doing to it — because "is the reaction visible enough" turned out to be a
question I could not answer by eye, and neither can anyone else.

The top row is the spectrum at the playhead, with the three bands tinted behind
it and each band's *envelope* drawn as a cap. That distinction is the useful
part: the envelope is smoothed and auto-gained, so it sits nowhere near the raw
spectrum's height, and seeing both is how you tell a kick landing squarely in the
bass band from one smearing into the mid.

The bottom row is one bar per channel, showing its contribution right now. That
is what makes the sliders tunable by eye: raise Pulse and watch its bar grow on
every kick, instead of raising it and squinting at the flock.

Those bars are derived by running the real `applyAudio` and `audioVisuals` over
neutral parameters and reading what comes back, rather than by restating their
formulas in the drawing code — a meter that drifts from the thing it is metering
is worse than no meter.

It samples the spectrogram independently rather than reading the simulation's
state. Both are deterministic functions of the same playhead with the same
constants, so they agree, and sampling independently means the meter keeps
working while the flock is paused — which is exactly when you are setting it up.
An `IntersectionObserver` stops the loop when the panel is collapsed or scrolled
away: a collapsed `Section` still renders its children, so without it the meter
would sample and repaint sixty times a second for something nobody can see.

### Sync

`Sync` reads the spectrogram slightly *ahead* of the playhead, 40 ms by default.
The force channels still carry the integrator's lag, and a little lookahead
cancels it. Reading the future is possible only because the whole track is
analysed before it plays — an `AnalyserNode` on the output could not do this at
any price. Raise it if the flock still feels behind the music, lower it if it
anticipates.

Past a Drive of about 1.5 the bursts arrive faster than the flock can re-form
and it disperses into fragments. Measurably so: the 1 Hz prominence peaks at
Drive 1 and *falls* by Drive 2, because saturated envelopes have less room left
to modulate.

Pausing releases the envelopes toward silence on the slow constant rather than
cutting them, so the flock returns to its own behaviour instead of being yanked.

## The predator

Optional, one agent, `O(n)` to evaluate. It pursues a point circling the flock's
centroid — a pursuer that converges exactly sits in the middle of the flock and
the wave never re-forms — and every bird inside the fear radius gets a repulsion
an order of magnitude stronger than any flocking term.

That imbalance is deliberate. The waves and holes that tear through real
murmurations are birds abandoning every other rule at once, and without a
predator a boids flock is a smooth blob that never surprises anyone.

## Turbulence

Low-amplitude wander sampled from `jitterNoise` — the same deterministic value
noise the elevation jitter is built on. Reused rather than added to, so the
codebase has one noise function and a seeded flock stays reproducible.

---

## Scaling: two yardsticks

Every slider is a unitless multiplier. What they scale are fractions of the
terrain's own dimensions, so a setting that reads well on one heightmap reads
well on the next instead of needing re-tuning per raster.

There are **two** yardsticks, not one:

| | Symbol | Scales |
|---|---|---|
| Horizontal | `span` = larger footprint | perception radius, cruise speed, roost radii, fear radius, trail length |
| Vertical | `vspan` = relief, floored at `0.05·span` | ground clearance, roost height, envelope half-height, lift decay |

Keying altitude off the footprint looked right on a test cone and absurd on a
real heightmap, where a 1024-cell raster is ten times wider than its mountains
are tall: the flock cruised so far above the terrain that ground avoidance and
ridge lift never engaged at all. The floor under `vspan` keeps a heightmap
flattened to nothing (`elevScale` 0, or a blank raster) from collapsing the flock
onto the plane.

`span` comes from `buildTerrain`'s `spanHalfW`/`spanHalfH`, the half-extents of
the valid-cell box — *not* from `halfW`/`halfH`, which are the centring offsets
that place that box's midpoint at the origin. The two are the same number on a
full grid and diverge the moment a crop is off-centre, which is how this was
originally wrong: on a lasso of columns 800–1000 of 1024, the offset is 900·scl
against a terrain 200·scl wide, so every horizontal radius above and the
`BOUND_SOFT` containment wall were an order of magnitude larger than the ground
underneath them, and the flock simply left. Measured on a 20×20-cell crop: 32% of
birds over data before the fix, 96% after. See
[Edit-Mode.md § Centring is free](Edit-Mode.md).

---

## Fixed timestep

`stepFlock` consumes time in fixed $1/60\,\mathrm{s}$ substeps out of an
accumulator, at most three per call, carrying the remainder forward. Two reasons:

1. **Reproducibility.** A variable timestep makes the flock a function of the
   frame rate — the same seed diverges between a fast machine and a slow one, and
   between a test run and the viewport. The seed is a user-facing control and
   has to mean something.
2. **Stability.** Boids under a large step overshoot into each other and explode.

The caller's `Math.min(delta, 0.05)` clamp and the three-substep cap together
prevent the spiral of death after a tab switch.

---

## Cost

Neighbour search is a uniform spatial hash: cell size equals the perception
radius, so every neighbour lies in one of the 27 cells around a bird. Buckets are
a power of two at least twice the population, addressed by

$$h = \left(i_x \cdot 73856093 \oplus i_y \cdot 19349663 \oplus i_z \cdot 83492791\right) \wedge \text{mask}$$

Hash collisions only add candidates that the radius test then rejects, so
correctness never depends on the table size. Three details earn their keep:

**Cells are scanned nearest-first** — own cell, then the 6 faces, the 12 edges,
the 8 corners. This is the difference between linear and quadratic scaling, and
it is not obvious why. A flock occupies roughly the same *volume* however many
birds are in it, so doubling the population doubles the birds per cell. Scanning
in naive $-1 \ldots +1$ order meant a bird walked twenty low-yield corner and
edge cells — where almost nothing falls inside the perception sphere — before
reaching its own. At 50 000 birds that was some 2 000 rejected candidates before
the neighbour cap could fire:

| Birds | occupied cells | birds/cell | candidates walked, naive order |
|---|---|---|---|
| 2 000 | 283 | 7 | 144 |
| 12 000 | 394 | 31 | 867 |
| 50 000 | 468 | 107 | 3 552 |

Nearest-first, the cap fires inside the bird's own cell and the walk is bounded
by construction.

**Two budgets, not one.** Eight neighbours accepted (the topological rule above),
and 96 candidates examined. The second is the hard guarantee: a *sparse* flock
can walk a long way without accepting anything at all, so the neighbour cap alone
does not bound the search.

**Cells are built by counting sort**, not the usual head/next linked list. The
list is shorter to write but scatters its reads across the whole position buffer,
and at this scale the search is entirely memory-bound; sorting lets a cell be
walked as a contiguous slice. Birds are then processed in cell order, reading
from the sorted snapshot and writing back to the real buffers — which as a
side-effect makes the update *simultaneous*, so no bird sees some of its
neighbours already moved this substep. Every buffer is permanent: a substep
allocates nothing.

### The arithmetic, and one dead clamp

Getting from 50 000 birds to 100 000 was not an algorithmic change — the search
was already linear. It was two things in the inner arithmetic, worth 2.2×
together:

**`Math.hypot` is not `Math.sqrt`.** It guards against intermediate overflow and
underflow that cannot arise for three coordinates of a bird, and it costs several
times as much. There were about ten per bird per substep — in the steering
helper, its clamp, the speed limit, the streak buffer — and between them they
were **27% of the entire step**. All are now `Math.sqrt` of the dot product.

**Reynolds' per-force clamp never fired.** Each steering force is limited to
`maxForce`, which sounds necessary and is provably dead here:
$|\hat{\mathbf{d}} \cdot v_{\text{cruise}}|$ is exactly $v_{\text{cruise}}$ and
$|\mathbf{v}|$ never exceeds $1.35\,v_{\text{cruise}}$, so their difference
cannot exceed $2.35\,v_{\text{cruise}}$ — and `maxForce` is
$2.5\,v_{\text{cruise}}$. Removing it is bit-for-bit identical output (the flock
invariant test's min and max altitudes did not move by a float) for another 12%.
The forces that *do* need to overpower everything — ground avoidance at 6×,
the predator at 12× — are applied afterwards and were never clamped anyway.

The steering itself is now inlined at each of its four sites rather than called
through a shared scratch array. That is deliberate duplication in the one loop in
this codebase that runs a hundred thousand times per frame; scalars stay in
registers.

### Numbers

Measured single-threaded in Node on an M-series laptop, 1024² terrain,
predator on:

| Birds | ms/substep | |
|---|---|---|
| 2 000 | 0.96 | the default |
| 6 000 | 1.16 | |
| 12 000 | 1.90 | |
| 25 000 | 3.88 | |
| 50 000 | 7.57 | |
| 100 000 | 14.91 | the slider's ceiling |

With shadows on, add about a third: 10.2 ms at 50 000, 20.3 ms at 100 000.

Linear above a few thousand at **0.15 ms per 1000 birds**, as the topological cap
promises. In the browser, with rendering and the panel on the same thread, the
full 100 000 holds 60 fps with shadows off (median frame 16.6 ms, p95 17.5 ms) —
but that is the whole budget, so a slower machine will drop frames at the top of
the range, and turning shadows on there takes it to about 18 fps. Both at once
are comfortable to around 50 000. When
it does the flock does not spiral: the accumulator simply releases fewer substeps
than real time asks for and it moves in slow motion.

For comparison, the *hologram* field in its default configuration builds one
particle per terrain cell — about a million on a 1024² raster — so even a
100 000-bird flock is the lighter of the two, and it explicitly skips the
hologram's home-buffer scan.

---

## Export

The trade against the hologram field runs the other way here, and in the useful
direction.

The hologram's motion lives entirely in the vertex shader; the CPU never learns
where a particle went, so an SVG export of it is a snapshot of the field *at
rest*. The flock's positions **are** the buffer the renderer draws from, so
`getPositions()` returns the live flock and the exported SVG is the frame on
screen. Turn *Animate* off to freeze it, then export.

Shadows export too, as their own `layer-flock-shadow` layer, and they are the
one part of the field the depth test genuinely culls in the exporter: a shadow on
the far slope is hidden by the ridge in front of it, with no ghost pass, since a
shadow showing faintly through a mountain reads as a smudge on the rock.

**Sprites are clamped to what the GPU will draw.** `gl_PointSize` is silently
limited to `ALIASED_POINT_SIZE_RANGE` — 511 on one machine here, as little as 63
on others. The exporter computes the same `size · 300 / −z` as the vertex
shader, so the two agree right up until that product passes the ceiling, and
then they diverge by however far past it the maths went. At a close zoom with a
large Size the viewport showed a sprite pinned at the ceiling while the SVG drew
one many times bigger: measured at 579 px against a 511 px ceiling here, and
proportionally far worse on hardware that stops at 63. The export inherits the
limit, because the export is meant to be what the viewport shows.

Birds land in the SVG as `<circle>` elements alongside the hologram's, projected
and depth-tested against the same software Z-buffer the line layers use. Streaks
get their own Inkscape layer, `layer-flock`, because a plotter run is sorted by
layer and the streaks are the pen-drawn half of the flock. PNG and WebM need no
special handling: PNG re-renders the scene offscreen, and WebM recording already
forces the on-demand render loop to run.

STL does not include the flock — it does not include particles of any kind.
