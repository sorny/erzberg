# Murmurations

The second thing the Particles section can draw. The hologram field pins one
particle to each terrain cell. A **Murmuration** flies a flock of boids over the
relief, and the terrain steers it.

- `src/utils/murmuration.js`: the simulation, pure.
- `src/components/ParticleSystem.jsx`: geometry, materials and the per-frame
  step.

---

## The rules

The three rules from Reynolds, *Flocks, Herds, and Schools*, SIGGRAPH '87
([full text](https://www.red3d.com/cwr/papers/1987/boids.html)):

- **Separation.** Steer away from neighbours in the separation radius, weighted
  $1/d$.
- **Alignment.** Steer toward the neighbourhood's mean velocity.
- **Cohesion.** Steer toward the neighbourhood's centre of mass.

Each is a steering force:

$$\mathbf{F} = \hat{\mathbf{d}} \cdot v_{\text{cruise}} - \mathbf{v}$$

Reynolds clamps each force to a maximum. That clamp is not here, because it can
never fire (see [below](#the-arithmetic)). `maxForce` still scales the other
forces: ground avoidance, the envelope, turbulence and the predator.

Speed is clamped to $[0.65, 1.35] \cdot v_{\text{cruise}}$. Birds do not hover,
and a flock that can stop settles into a still cloud.

### Topological, not metric

A bird flies with its **eight nearest neighbours**, not with everything in a
radius. The radius only bounds the search. Real starlings track six or seven
neighbours at any density (Ballerini et al., PNAS 105(4), 2008,
[full text](https://www.pnas.org/doi/10.1073/pnas.0711437105)). This keeps the
flock whole as it spreads, lets a predator strike travel as a wave, and makes
the cost linear.

The eight are approximately nearest: the first eight accepted, scanning outward
from the bird's own cell. A true sort costs more than the rest of the step.

## What the terrain contributes

All four forces read data that `buildTerrain` already returns.

**Ground avoidance.** An upward force below the clearance band, stronger than
every other term, plus a hard floor in the integrator. Heights come from
`sampleBilinear`, the NoData-safe tap. Over a hole it returns `NaN`, and the
bird heads for the roost.

**Roost.** An attractor above the highest ground, found by a strided scan of up
to about 64 000 samples. The pull is zero inside a free radius and ramps up
beyond it, so the flock orbits instead of collapsing onto the peak.

**Ridge lift.** An updraft over steep ground and a sink over flats, from
`gridSlopes`, decaying with height. Steepness is normalised as
$s / (s + \bar{s})$, which is 0.5 at the mean slope. Normalising by `maxSlope`
would let one cell decide the whole field.

**Flight envelope.** A slab of air around the roost height, pushed from both
sides, because ridge lift need not average to zero.

## Shadows

Each bird drops a soft disc on the terrain, solved analytically. The scene has
no lights, so there is no shadow map.

The direction is the **hillshade sun**, the same true bearing as `lightVector`.
The shadow falls along $(-\sin\alpha, \cos\alpha)$ scaled by $h \cot\theta$ for a
bird at height $h$ and sun altitude $\theta$. The Particles section repeats the
two sun sliders, because Hillshade hides them when it is off.

- Two terrain taps per bird: the drop under the bird, and the ground where the
  shadow lands. A third refinement tap moved shadows less than their width and
  cost half the surcharge.
- Altitude is clamped to 5°, and the throw capped at 0.6 of the span.
- `groundAt` returns `NaN` outside the grid and in holes, unlike
  `sampleBilinear`, which clamps. A shadow with no ground gets `aLift < 0`. The
  shader moves it out of clip space, and the exporter skips it.
- The sprite grows and fades with height. `Sh. spread` sets that growth.

Shadows add about a third to the step. 100 000 birds run at 60 fps without
shadows and about 18 fps with them.

## Listening to a track

Load a track in the Particles panel and the flock reacts to it. **The terrain
does not change.** `useSoundscape` turns audio into terrain. The flock has its
own `useFlockAudio`, which touches no store. If a Soundscape is loaded and the
flock has no track, it listens to the Soundscape. The panel says which.

Features are read from a precomputed spectrogram at the playhead, not from an
`AnalyserNode`:

- Scrubbing works.
- The result is deterministic.
- It costs a few hundred array reads per frame.

It reads the file, so volume and mute do not matter. The analysis uses 128 bins,
coarser than Soundscapes' 512.

### What it hears

- Three bands: **bass** (20–160 Hz), **mid** (160 Hz–2 kHz), **high**
  (2–16 kHz). Each is peak-held and passed through a fast-attack, slow-release
  envelope.
- Loudness is auto-gained against a running peak that halves every four seconds.
- Onsets come from **spectral flux**, the summed rise between frames. Flux is
  measured against the last analysis frame read, not the last render, because
  analysis runs at about 86 fps and rendering at 60.

### What it drives

Audio transforms the parameters on the way into `stepFlock`. `murmuration.js`
does not know audio exists.

| Control | Feature | Acts through | Effect |
|---|---|---|---|
| **Size** | bass, level | uniform | Sprites swell, streaks lengthen |
| **Burst** | onsets | velocity | Throws the flock outward from its centre |
| Pace | level | speed clamp | Flight speed, centred on an average passage |
| Pulse | bass | force | Separation opens while cohesion eases |
| Shimmer | high | force | Adds turbulence |
| Startle | onsets | force | Widens the predator's fear radius. Needs the predator |

Size and Burst bypass the integrator, which otherwise delays a beat by a few
hundred milliseconds. Size is a uniform. Burst writes velocity, scaled by frame
time to 60 Hz, so the impulse is the same at any refresh rate. On the test
fixture (one burst per second), the flock footprint shows a 1 Hz component of
358 against a floor of 41.

### Ranges

Each channel has an input **range**: the slice of its 0…1 signal that maps to
the full response. A loud track keeps envelopes near the top, and scaling a
constant does nothing. An envelope between 0.86 and 0.94 swings 0.08 raw and 1.0
windowed. Burst starts at 0.15–0.90. The meter draws each window as a bracket.

### Transport and meter

- Play, restart, ±5 s, a scrub bar and a loop switch. Skips wrap on a loop.
- The scrubber acts on `input`, so the flock reacts while you drag.
- The playhead is written straight to the DOM each frame, not through React
  state.
- The meter shows the spectrum with band envelopes as caps, and one bar per
  channel. It runs the real `applyAudio` and `audioVisuals`, so it cannot drift
  from the flock. It samples on its own, so it works while the flock is paused.
- An `IntersectionObserver` stops the meter when it is not visible.

### Sync and Drive

`Sync` reads 40 ms ahead of the playhead to cancel the integrator lag. Raise it
if the flock is late, lower it if early.

Above Drive 1.5, bursts come faster than the flock re-forms. The 1 Hz
prominence peaks at Drive 1. A pause releases the envelopes on the slow
constant.

## The predator

One optional agent, $O(n)$ to evaluate. It chases a point that circles the
flock centroid. Birds inside the fear radius get a repulsion ten times stronger
than any flocking term, which tears waves and holes through the flock.

## Turbulence

A low wander from `jitterNoise`, the same seeded noise as elevation jitter.

---

## Scaling

Every slider is a unitless multiplier on terrain dimensions, so one setting
works on any raster.

| | Symbol | Scales |
|---|---|---|
| Horizontal | `span`, the larger footprint | Perception, cruise speed, roost radii, fear radius, trail |
| Vertical | `vspan`, the relief, floored at `0.05·span` | Clearance, roost height, envelope, lift decay |

A 1024-cell raster is about ten times wider than its mountains are tall, so a
single yardstick puts the flock far above the ground. The floor protects flat
rasters.

`span` comes from `spanHalfW` and `spanHalfH`, the half-extents of the valid
cells, not from the centring offsets `halfW` and `halfH`. On an off-centre crop
the offsets are far larger than the ground. On a 20×20 crop, birds over data
went from 32% to 96% with this fix. See [Edit Mode](Edit-Mode.md).

---

## Fixed timestep

`stepFlock` runs fixed $1/60\,\mathrm{s}$ substeps from an accumulator, at most
three per call, carrying the remainder. The same seed thus gives the same
flight on any machine, and large steps cannot explode the flock. The caller
clamps delta to 0.05 s. When frames drop, the flock moves in slow motion
instead of spiralling.

---

## Cost

The neighbour search uses a uniform spatial hash with cell size equal to the
perception radius, so all neighbours lie in the 27 cells around a bird. The
bucket count is a power of two, at least twice the population:

$$h = \left(i_x \cdot 73856093 \oplus i_y \cdot 19349663 \oplus i_z \cdot 83492791\right) \wedge \text{mask}$$

A collision only adds candidates, which the radius test rejects.

- **Nearest-first scan**: own cell, then 6 faces, 12 edges, 8 corners. A flock
  keeps its volume as it grows, so birds per cell grow. In naive order, 50 000
  birds walked about 3 500 candidates each. Nearest-first, the neighbour cap
  fires in the own cell.
- **Two budgets**: eight accepted neighbours, and at most 96 examined
  candidates. The second bounds a sparse flock.
- **Counting sort** builds the cells, so each cell is a contiguous slice. Birds
  are processed in cell order from a sorted snapshot, which also makes the update
  simultaneous. Buffers are permanent, so a substep allocates nothing.

### The arithmetic

Two changes gave 2.2× together:

- **`Math.sqrt` instead of `Math.hypot`.** `hypot` guards against overflow that
  cannot happen here and cost 27% of the step.
- **The per-force clamp is removed.** $|\hat{\mathbf{d}} \cdot v_{\text{cruise}}| = v_{\text{cruise}}$
  and $|\mathbf{v}| \le 1.35\,v_{\text{cruise}}$, so a steering force cannot
  exceed $2.35\,v_{\text{cruise}}$, below `maxForce` at $2.5\,v_{\text{cruise}}$.
  Output is bit-for-bit identical. That gave another 12%.

Ground avoidance (6×) and the predator (12×) are applied after steering and are
never clamped. Steering is inlined at its four sites, so the scalars stay in
registers.

### Numbers

Single-threaded in Node, M-series laptop, 1024² terrain, predator on:

| Birds | ms per substep | |
|---|---|---|
| 2 000 | 0.96 | default |
| 6 000 | 1.16 | |
| 12 000 | 1.90 | |
| 25 000 | 3.88 | |
| 50 000 | 7.57 | |
| 100 000 | 14.91 | slider maximum |

Shadows add about a third. Above a few thousand birds the cost is about
0.15 ms per 1 000 birds. In the browser, 100 000 birds hold 60 fps with shadows
off (median 16.6 ms, p95 17.5 ms). With shadows on, both are comfortable to
about 50 000.

---

## Export

The hologram's motion lives in the vertex shader, so its SVG shows the field at
rest. The flock's positions are the render buffer, so `getPositions()` exports
the frame on screen. Turn *Animate* off (or press `Space`) to freeze it, then
export.

- Birds export as `<circle>` elements, depth-tested against the software
  Z-buffer.
- Streaks go in their own layer, `layer-flock`.
- Shadows go in `layer-flock-shadow`, depth-culled with no ghost pass.
- Sprite size is clamped to `ALIASED_POINT_SIZE_RANGE`, as the GPU does, so the
  SVG matches the viewport (the limit is 511 px here, 63 on some hardware).
- PNG and WebM need no special handling. STL has no particles.
