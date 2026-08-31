# Murmurations

This is the second thing that the Particles section can draw. The hologram field
pins one particle to every terrain cell and shimmers it in place. A
**Murmuration** instead flies a flock of boids over the relief. The terrain
steers the flock. It does not merely place the flock above the ground.

Two files hold the work. `src/utils/murmuration.js` holds the simulation, which
is pure. The murmuration branch of `src/components/ParticleSystem.jsx` holds the
geometry, the materials and the per-frame step.

---

## The rules

These are the three classic rules, from Reynolds:

> Reynolds, C. W., *Flocks, Herds, and Schools: A Distributed Behavioral Model*,
> SIGGRAPH '87. [Full text](https://www.red3d.com/cwr/papers/1987/boids.html)

**Separation.** A bird steers away from the neighbours inside the separation
radius. The weight is $1/d$, so a collision that is about to happen outranks
mere nearness. This rule keeps the spacing inside the flock even, and not
clumped.

**Alignment.** A bird steers its heading toward the mean velocity of its
neighbourhood.

**Cohesion.** A bird steers toward the centre of mass of its neighbourhood.

Each rule gives a *steering force* in the sense of Reynolds. That force is the
difference between the velocity that the bird wants and the velocity that it
has:

$$\mathbf{F} = \hat{\mathbf{d}} \cdot v_{\text{cruise}} - \mathbf{v}$$

Reynolds also clamps each such force to a maximum, as a turn-rate limit. That
clamp is not here, because we can prove that it never fires. See
[the dead clamp](#the-arithmetic-and-one-dead-clamp), further down.

`maxForce` still exists and still matters. Every force that is *not* a steering
term is a multiple of it. Ground avoidance, the flight envelope, the turbulence
and the predator are those forces.

The app then clamps the speed to
$[0.65, 1.35] \cdot v_{\text{cruise}}$. The floor is not decoration. Birds do
not hover. A flock that can slow to a stop settles into a stationary cloud,
which is the failure mode that looks least like a bug.

### Topological, not metric

A bird flies with its **eight nearest neighbours**. It does not fly with
everything inside the perception radius. The radius is only a search bound. The
count is the rule.

Real starlings do this:

> Ballerini, M. et al., *Interaction ruling animal collective behavior depends on
> topological rather than metric distance*, PNAS 105(4), 2008.
> [Full text](https://www.pnas.org/doi/10.1073/pnas.0711437105)

They found that each bird tracks six or seven neighbours at every density of
the flock. This is what keeps a murmuration whole as it compresses
and expands. It is also what lets the strike of a predator travel as a wave
through the flock, instead of making a local dent. A metric rule loses the edges
of the flock the moment that the flock spreads out.

One honest caveat: the eight are *approximately* the nearest and not exactly the
nearest. The search takes the first eight that it accepts, and it scans outward
from the hash cell of the bird itself. That gives a near-neighbour set and not a
sorted k-nearest set. A sort of the candidates by distance costs more than the
whole rest of the step, and it changes nothing that anyone can see.

This is also what makes the cost linear in the population. See
[Cost](#cost), further down.

## What the terrain contributes

Four more forces. These four are the reason this feature belongs in a
topographic tool. Without them it is a boids demo with a mountain behind it. All
four read data that `buildTerrain` already returns.

**Ground avoidance.** The height under the bird comes from `sampleBilinear` in
`src/utils/terrain.js`, which is the NoData-safe tap. Below the clearance band
an upward force ramps in. That force dominates every other term, so the flock
drapes over a ridge and does not shear through it.

The integrator also holds a hard floor. A bird can outrun the steering force
alone on a cliff face. A bird drawn underground is the one artefact that a
viewer notices at once.

A plain bilinear tap cannot do this. The grid stores `0` for NoData, and `0` is
not "absent". It is the darkest possible ground, and
$(b - 0.5) \cdot 100 \cdot \text{elevScale}$ puts it at the very bottom of the
scene. Thus a tap across a lasso crop reports a floor that is not there, and the
flock dives into it all along the cut. Where the footprint holds no data at all
the sampler returns `NaN`. The bird then heads for the roost and does not treat
the void as ground.

**Roost.** An attractor above the highest ground. A strided scan finds it, with
a cap of about 64 000 samples. A roost a few cells off the true summit is still
a roost on the summit.

The pull is zero inside a free radius and ramps to full beyond it. A constant
pull collapses the flock onto the peak. The ramp makes the flock *orbit*, and
that is the shape that people mean by "murmuration".

**Ridge lift.** An updraft over steep ground and a sink over the flats, read
from `gridSlopes`. It decays with height above the terrain. The flock finds the
ridgelines on its own and traces them.

The app normalises the steepness as $s / (s + \bar{s})$, which is exactly $0.5$
at the mean slope of the terrain. It does not normalise against `maxSlope`.
Against the maximum, one outlier cell decides the reading. On a uniform cone
every sample then reads near 1 and the lift is a constant updraft. On a
landscape with a single cliff in it every sample reads near 0 and the lift is a
constant downdraft. Either way the flock drifts to one end of its envelope and
parks there.

**Flight envelope.** A slab of air around the roost height. The app pushes the
flock back into that slab from *both* sides. A bare ceiling is not enough, for
the same reason: ridge lift has no obligation to average to zero over a given
landscape.

## Shadows

Each bird drops a soft dark disc onto the terrain. This is not a shadow map.
The scene has no lights at all, and the surface shader fakes the shading of the
terrain. Thus the app fakes the shadow the same way. It solves the shadow
analytically. It walks from the bird along the sun ray until the ray meets the
ground.

The direction is the **hillshade sun**. It is the same vector
$(\cos\alpha\cos h,\ \sin h,\ \sin\alpha\cos h)$ that `SurfaceMesh` lights the
terrain with. A flock lit from a different angle than the ground under it looks
wrong at once. A shared parameter also means the two cannot drift apart. Move
the azimuth and the shadows swing with the hillshading.

The Hillshade section hides those two sliders when hillshading is off, and the
shadows of the flock do not need hillshading. Thus the Particles section
surfaces the same two values again. One parameter, two places to reach it.

Take a bird at height $h$ above the ground and a sun altitude $\theta$. The
shadow lands $h \cot\theta$ away, opposite the azimuth. To find the true
intersection the app must march the ray. Instead it takes exactly **two**
terrain taps: one for the drop under the bird, one for the ground that the
shadow lands on. A third pass to refine the position moved a shadow by well
under its own width. It also cost half of the whole surcharge of the feature.
The app clamps the altitude to 5° and caps the throw at 0.6 of the span, because
a sun on the horizon casts to infinity.

The app draws a shadow only where there is ground to receive it. That needs a
*stricter* sampler than the flock itself uses. `sampleBilinear` clamps its row
and column into range. That is right for a bird: one that strays past the edge
must still see ground beneath it and not fall off the world. For a shadow it is
wrong. It hands back the height of the nearest edge cell. Thus a shadow thrown
past the boundary hung in mid-air beside the terrain. A shadow that landed in a
lasso hole lay on ground that is not there.

`groundAt` returns `NaN` outside the grid and inside its holes. The app marks a
shadow with no ground under it as `aLift < 0` and skips it. The vertex shader
throws it outside clip space, and the exporter passes over it. With a sun at 10°
over a raster with holes, that culls about a quarter of the shadows.

"Ground" here means what it means everywhere else in the app since 0.9.7: a 2×2
footprint with at least one valid corner. Thus the app keeps a shadow on the
*rim* of a cut, because that ground genuinely is there.

The sprite grows and fades with the height of the bird above the ground. That is
the whole depth cue. Without it the flock reads as pasted onto the terrain and
not as flying over it. `Sh. spread` sets that growth. At 0, every shadow is the
same size at every altitude.

Shadows cost about **a third on top of the simulation**, because they add one
terrain tap per bird. At the default of 2 000 birds that is free. It is also the
reason the ceiling of 100 000 is a 60 fps flock without shadows and an 18 fps
flock with them.

## Listening to a track

Load a track in the Particles panel and the flock flies to it. **The app does
not touch the terrain.** That distinction is the whole design.

`useSoundscape` exists to *become* the landscape. It pushes every frame that it
analyses into the heightmap store. A wish for birds that react to music is not a
wish for a spectrogram in place of your raster. Thus the flock has its own audio
in `useFlockAudio`. That module decodes, analyses and plays, and it touches no
store at all.

If a Soundscape *is* loaded, the flock uses it as a fallback. Thus you never
have to upload the same file twice. The own track comes first and the Soundscape
comes second. The panel says which one the flock listens to.

Either way, the features come from a *precomputed spectrogram, read at the
playhead*. They do not come from an `AnalyserNode` on the output. Three things
follow from that:

- **Scrubbing works.** The features are a function of time and not of a running
  stream. Thus a drag of the playhead makes the flock react to where it lands.
- **The result is deterministic.** The same track at the same second gives the
  same reading.
- **It is cheap.** It costs a few hundred array reads per frame and not an FFT.

The trade is that this is what the *file contains*. It is not what the speakers
emit. The volume, the mute switch and the output chain of the browser are all
invisible to it.

The analysis of the flock is coarser than the Soundscapes analysis, on purpose:
128 bins and not 512. Nothing here becomes a heightmap. Three bands and one flux
figure cannot use the resolution that a terrain needs.

### What it hears

Three bands. A kick, a voice and a cymbal pull the flock in directions that you
can see. Five bands mostly give sliders that nobody can hear. The three are
**bass** (20–160 Hz), **mid** (160 Hz–2 kHz) and **high** (2–16 kHz).

The app peak-holds each band over its bins. It then runs the band through an
envelope with a fast attack and a slow release. Percussion arrives at once and
then decays. Equal rates give a flock that lags the beat and twitches after it.

The app **auto-gains** the loudness against a running peak that halves every
four seconds. The stored values are absolute dB, and music is not. Without the
auto-gain a quiet track never moves the flock, and a loud one pins every slider.

Onsets come from **spectral flux**. This is the summed *rise* between
consecutive analysis frames, with the falls ignored. A rise finds attacks. An
amplitude does not.

The app measures the flux against the last frame that it actually read, and not
against the last render. The analysis runs at about 86 frames a second and the
renderer at 60. Thus on some frames the playhead has not reached a new column. A
measurement against the same row reports zero and chops every onset into a
flicker.

### What it drives

Audio is a **parameter transform on the way into the simulation**. It is not a
new set of forces. `stepFlock` resolves its scales from params on every call.
Thus the whole feature lives outside the physics, and `murmuration.js` never
learns that audio exists. It also means that you can dial every mapping by hand,
which keeps the result legible and not magic.

| Control | Feature | Acts through | Effect |
|---|---|---|---|
| **Size** | bass, level | uniform | Sprites swell on the kick. Streaks lengthen with the energy |
| **Burst** | onsets | velocity | Throws the flock outward from its own centre |
| Pace | overall level | speed clamp | Flight speed, centred so an average passage flies at the dialled speed and a quiet one slows down |
| Pulse | bass | force | Separation opens while cohesion eases, so the flock *breathes*. Both the same way only makes it vibrate |
| Shimmer | high | force | Turbulence, on top of whatever is dialled in |
| Startle | onsets | force | Widens the fear radius of the predator, so an accented beat tears the same hole a strike does. Needs the predator on. **Burst** does not |

### Why the top two exist

The first version drove only the force channels. The result was faint and late.
That is not a tuning problem. It is the integrator. A steering force changes the
velocity at `acc·dt`, bounded by the turn-rate limit, and only then changes the
position. Thus a beat arrives on screen as a vague swell a few hundred
milliseconds afterwards. A modulation of parameters is low-pass by its nature.

Thus the two most percussive channels bypass the integrator. **Size** is a
shader uniform. It changes on the frame that sets it, with no lag at all.
**Burst** writes the velocity directly and applies no force. Thus an onset lands
at once. The speed clamp renormalises on the next substep, which turns the
impulse into the flock that snaps *outward*. The flock re-forms on its own,
because nothing touched a flocking rule.

Startle is the most percussive control in the panel. It routed through the fear
radius of the predator, and the predator is off by default. Thus the punchiest mapping did nothing at all out of the box.

Measured against the test fixture, which bursts once a second: the on-screen
footprint of the flock carries a 1 Hz component of amplitude 358, against a
floor of 41 at the neighbouring frequencies. A silent flock manages 61 against
34. The beat is a line in the motion of the flock and not a wobble.

### Ranges

Each channel has an input **range** under its amount. The range is the slice of
that signal's 0…1 which the app stretches across the whole response.

A dense track needs this control, and an amount slider cannot take its place.
The app auto-gains the band envelopes against the recent peak of the track
itself. Thus on something loud from end to end the envelopes sit near the top
and barely move. Drum and bass does this. So does the back half of most
choruses. A scale applied to a signal that does not vary only scales a constant.

Measured on a synthetic envelope that oscillates between 0.86 and 0.94: without
a window it swings 0.08 of its available range. Windowed to exactly that slice,
it swings the full 1.0. Same input, same amount, and a reaction that you can
see.

Each channel windows on its own, because each one looks for something different
in the same track. Burst wants only the sharpest attacks, so it starts windowed
at 0.15–0.90. Raw onset values sit low, and dense music gives a wall of small
ones that disperses the flock. Pace wants the broad shape of the whole track.
Pulse and Size both read the bass, and you usually want them at different
thresholds: a swell that you see before the flock has moved at all, against a
kick that you feel.

The meter draws each window as a bracket behind the envelope cap of its band.
Thus you set a window by watching where the track actually sits and putting the
window around it. You do not guess.

### Transport

The transport has play, restart, ±5 s, a scrub bar and a loop switch. A skip
*wraps* and does not clamp. Thus a step back from the first second of a looping
track lands near the end of the track and does not pin at zero.

A seek needs no resynchronisation of anything downstream. That property is what
makes this design work at all. Everything the flock reads is a function of
*time*, taken from the precomputed spectrogram at `currentTime` and not from a
running stream. Drop the playhead anywhere, and the next frame reads a different
column.

The scrubber is wired to `input` and not to release, for that reason. The flock
reacts while you drag, and that is how you find the bar that you want.

The app reads the playhead in an animation frame and writes it straight to the
DOM. It writes the value of the range input and one text node. A scrubber backed
by React state re-renders the whole sidebar several times a second. For a panel
this size that is the most expensive thing on the page. It is also exactly what
the rest of the audio path avoids.

### The meter

Above the sliders is a live readout of what the flock hears and of what that
does to it. The question "is the reaction visible enough" is one that nobody can
answer by eye.

The top row is the spectrum at the playhead. The three bands are tinted behind
it, and the *envelope* of each band is drawn as a cap. That distinction is the
useful part. The envelope is smoothed and auto-gained, so it sits nowhere near
the height of the raw spectrum. To see both is how you tell a kick that lands
squarely in the bass band from one that smears into the mid.

The bottom row is one bar per channel. Each bar shows the contribution of that
channel right now. This is what makes the sliders tunable by eye. Raise Pulse
and watch its bar grow on every kick. You need not raise it and then squint at
the flock.

The app derives those bars by a run of the real `applyAudio` and `audioVisuals`
over neutral parameters, and it reads back what comes out. It does not restate
their formulas in the drawing code. A meter that drifts from the thing it
measures is worse than no meter.

The meter samples the spectrogram on its own. It does not read the state of the
simulation. Both are deterministic functions of the same playhead with the same
constants, so they agree. A separate sample also keeps the meter working while
the flock is paused, which is exactly when you set it up.

An `IntersectionObserver` stops the loop when the panel is collapsed or scrolled
away. A collapsed `Section` still renders its children. Without the observer the
meter samples and repaints sixty times a second for something that nobody can
see.

### Sync

`Sync` reads the spectrogram a little *ahead* of the playhead, 40 ms by default.
The force channels still carry the lag of the integrator, and a little lookahead
cancels it. A read of the future is possible only because the app analyses the
whole track before it plays. An `AnalyserNode` on the output cannot do this at
any price. If the flock still feels behind the music, raise the value. If the
flock anticipates the music, lower it.

Above a Drive of about 1.5 the bursts arrive faster than the flock can re-form,
and the flock disperses into fragments. This is measurable. The 1 Hz prominence
peaks at Drive 1 and *falls* by Drive 2, because a saturated envelope has less
room left to modulate.

A pause releases the envelopes toward silence on the slow constant. It does not
cut them. Thus the flock returns to its own behaviour and is not yanked.

## The predator

The predator is optional. It is one agent and costs `O(n)` to evaluate. It
pursues a point that circles the centroid of the flock. A pursuer that converges
exactly sits in the middle of the flock, and the wave never re-forms. Every bird
inside the fear radius gets a repulsion an order of magnitude stronger than any
flocking term.

That imbalance is deliberate. The waves and holes that tear through a real
murmuration are birds that abandon every other rule at once. Without a predator
a boids flock is a smooth blob that never surprises anyone.

## Turbulence

A low-amplitude wander, sampled from `jitterNoise`. That is the same
deterministic value noise that the elevation jitter uses. The app reuses it and
does not add a second one. Thus the codebase has one noise function, and a
seeded flock stays reproducible.

---

## Scaling: two yardsticks

Every slider is a unitless multiplier. What they scale are fractions of the
dimensions of the terrain itself. Thus a setting that reads well on one
heightmap reads well on the next. It needs no re-tuning per raster.

There are **two** yardsticks and not one:

| | Symbol | Scales |
|---|---|---|
| Horizontal | `span` = the larger footprint | Perception radius, cruise speed, roost radii, fear radius, trail length |
| Vertical | `vspan` = the relief, floored at `0.05·span` | Ground clearance, roost height, envelope half-height, lift decay |

A key of the altitude off the footprint looked right on a test cone and absurd
on a real heightmap. A raster of 1024 cells is ten times wider than its
mountains are tall. The flock then cruised so far above the terrain that ground
avoidance and ridge lift never engaged at all.

The floor under `vspan` protects a heightmap that is flat. An `elevScale` of 0
gives such a heightmap, and so does a blank raster. Without the floor the flock
collapses onto the plane.

`span` comes from `spanHalfW` and `spanHalfH` in `buildTerrain`. Those are the
half-extents of the valid-cell box. `span` does *not* come from `halfW` and
`halfH`, which are the centring offsets that put the midpoint of that box at the
origin.

The two are the same number on a full grid. They diverge the moment that a crop
is off-centre, and that is how this was wrong at first. On a lasso of columns
800–1000 of 1024, the offset is 900·scl against a terrain 200·scl wide. Thus
every horizontal radius above, and the `BOUND_SOFT` containment wall, were an
order of magnitude larger than the ground under them. The flock left.
Measured on a crop of 20×20 cells: 32% of the birds were over data before the
fix, and 96% after it. See
[Edit-Mode.md § The centring comes for free](Edit-Mode.md).

---

## Fixed timestep

`stepFlock` consumes time in fixed substeps of $1/60\,\mathrm{s}$, out of an
accumulator. It takes at most three substeps per call and carries the remainder
forward. There are two reasons:

1. **Reproducibility.** A variable timestep makes the flock a function of the
   frame rate. The same seed then diverges between a fast machine and a slow
   one, and between a test run and the viewport. The seed is a control that the
   user sees, and it has to mean something.
2. **Stability.** Boids under a large step overshoot into each other and
   explode.

The caller clamps with `Math.min(delta, 0.05)`. That clamp and the cap of three
substeps together prevent the spiral of death after a tab switch.

---

## Cost

The neighbour search uses a uniform spatial hash. The cell size equals the
perception radius. Thus every neighbour lies in one of the 27 cells around a
bird. The bucket count is a power of two, and at least twice the population. The
address is:

$$h = \left(i_x \cdot 73856093 \oplus i_y \cdot 19349663 \oplus i_z \cdot 83492791\right) \wedge \text{mask}$$

A hash collision only adds candidates, and the radius test then rejects them.
Thus the correctness never depends on the size of the table.

Three details earn their keep.

**The app scans the cells nearest-first.** It takes the own cell, then the 6
faces, then the 12 edges, then the 8 corners. This is the difference between
linear and quadratic scaling, and the reason is not obvious.

A flock occupies about the same *volume* whatever the number of birds in it.
Thus a doubled population doubles the birds per cell. In a naive order of
$-1 \ldots +1$, a bird walked twenty low-yield corner and edge cells before it
reached its own. Almost nothing in those cells falls inside the perception
sphere. At 50 000 birds that was some 2 000 rejected candidates before the
neighbour cap fired:

| Birds | Occupied cells | Birds per cell | Candidates walked, naive order |
|---|---|---|---|
| 2 000 | 283 | 7 | 144 |
| 12 000 | 394 | 31 | 867 |
| 50 000 | 468 | 107 | 3 552 |

Nearest-first, the cap fires inside the own cell of the bird. The walk is then
bounded by construction.

**There are two budgets and not one.** The app accepts eight neighbours, which
is the topological rule above. It also examines 96 candidates at most. The
second budget is the hard guarantee. A *sparse* flock can walk a long way and
accept nothing at all, so the neighbour cap alone does not bound the search.

**The app builds the cells by counting sort.** It does not use the usual
head-and-next linked list. The list is shorter to write, but it scatters its
reads across the whole position buffer. At this scale the search is entirely
memory-bound, and a sort lets the app walk a cell as one contiguous slice.

The app then processes the birds in cell order. It reads from the sorted
snapshot and writes back to the real buffers. As a side effect the update is
*simultaneous*: no bird sees a neighbour that already moved in this substep.
Every buffer is permanent, so a substep allocates nothing.

### The arithmetic, and one dead clamp

The step from 50 000 birds to 100 000 was not an algorithmic change. The search
was already linear. It was two things in the inner arithmetic, worth 2.2×
together.

**`Math.hypot` is not `Math.sqrt`.** It guards against an intermediate overflow
and underflow that cannot arise for three coordinates of a bird, and it costs
several times as much. There were about ten calls per bird per substep. They
were in the steering helper, in its clamp, in the speed limit and in the streak
buffer. Between them they were **27% of the entire step**. All are now
`Math.sqrt` of the dot product.

**The per-force clamp of Reynolds never fired.** The app limits each steering
force to `maxForce`, which sounds necessary. Here we can prove that it is dead.
$|\hat{\mathbf{d}} \cdot v_{\text{cruise}}|$ is exactly $v_{\text{cruise}}$, and
$|\mathbf{v}|$ never exceeds $1.35\,v_{\text{cruise}}$. Thus their difference
cannot exceed $2.35\,v_{\text{cruise}}$, and `maxForce` is
$2.5\,v_{\text{cruise}}$.

Removal of the clamp gives bit-for-bit identical output. The minimum and maximum
altitudes in the flock invariant test did not move by one float. That was
another 12%.

The forces that *do* need to overpower everything are applied afterwards, and
nothing ever clamped them. Ground avoidance at 6× is one. The predator at 12× is
the other.

The steering itself is now inlined at each of its four sites. It is no longer
called through a shared scratch array. That is deliberate duplication, in the
one loop in this codebase that runs a hundred thousand times per frame. The
scalars stay in registers.

### Numbers

Measured single-threaded in Node, on an M-series laptop, over a terrain of
1024², with the predator on:

| Birds | ms per substep | |
|---|---|---|
| 2 000 | 0.96 | the default |
| 6 000 | 1.16 | |
| 12 000 | 1.90 | |
| 25 000 | 3.88 | |
| 50 000 | 7.57 | |
| 100 000 | 14.91 | the ceiling of the slider |

With shadows on, add about a third: 10.2 ms at 50 000, and 20.3 ms at 100 000.

Above a few thousand birds the cost is linear, at **0.15 ms per 1000 birds**.
That is what the topological cap promises.

In the browser the rendering and the panel share the thread. The full 100 000
holds 60 fps with shadows off. The median frame is 16.6 ms and the p95 is
17.5 ms. That is the whole budget, so a slower machine drops frames at the top
of the range. Shadows on at that population give about 18 fps. Both at once are
comfortable to about 50 000.

When the machine does drop frames, the flock does not spiral. The accumulator
releases fewer substeps than real time asks for, and the flock moves in slow
motion.

For comparison, the *hologram* field in its default configuration builds one
particle per terrain cell. On a raster of 1024² that is about a million
particles. Thus even a flock of 100 000 birds is the lighter of the two, and it
skips the home-buffer scan of the hologram.

---

## Export

The trade against the hologram field runs the other way here, in the useful
direction.

The motion of the hologram lives entirely in the vertex shader. The CPU never
learns where a particle went. Thus an SVG export of the hologram is a snapshot
of the field *at rest*.

The positions of the flock **are** the buffer that the renderer draws from.
`getPositions()` returns the live flock, so the exported SVG is the frame on
screen. To freeze the flock, turn *Animate* off. Then export.

Shadows export too, in their own `layer-flock-shadow` layer. They are also the
one part of the field that the depth test genuinely culls in the exporter. The
ridge in front of a shadow hides it, with no ghost pass. A shadow that shows
faintly through a mountain reads as a smudge on the rock.

**The app clamps a sprite to what the GPU will draw.** WebGL limits
`gl_PointSize` to `ALIASED_POINT_SIZE_RANGE` and reports nothing. That limit is
511 on one machine here, and as little as 63 on others.

The exporter computes the same `size · 300 / −z` that the vertex shader
computes. Thus the two agree until that product passes the ceiling. Past the
ceiling they diverge by the amount that the maths went over it.

At a close zoom with a large Size, the viewport showed a sprite pinned at the
ceiling while the SVG drew one many times bigger. Measured here: 579 px against
a ceiling of 511 px, and far worse in proportion on hardware that stops at 63.
The export now inherits the limit, because the export must be what the viewport
shows.

Birds land in the SVG as `<circle>` elements, beside the ones from the hologram.
The exporter projects them and depth-tests them against the same software
Z-buffer that the line layers use.

Streaks get their own Inkscape layer, `layer-flock`. A plotter run is sorted by
layer, and the streaks are the pen-drawn half of the flock.

PNG and WebM need no special handling. PNG re-renders the scene offscreen. A
WebM recording already forces the on-demand render loop to run.

STL does not include the flock. It includes no particles of any kind.
