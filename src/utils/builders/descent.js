/**
 * Descent with mass: Fall Line, Berms, Air, Race Line.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { boxBlur, sampleBilinear } from '../terrain'
import { computeVertexColor } from '../colorUtils'
import { F32List, inElevCut, normElev } from './shared.js'

// ─── Descent with mass (Fall Line, Berm, Air, Race Line) ─────────────────────

/**
 * A rider, not a raindrop.
 *
 * `buildFlowLines` steps p ← p − α∇H: a *massless* particle that is always
 * pointing exactly downhill. It cannot overshoot, cannot bank, and stops the
 * instant the gradient does. That is correct for drainage and it is why Flow
 * reads as a river network. Everything in this family is the same walk made
 * second-order — a state (position, velocity) integrated instead of a position
 * stepped — and that one change is the whole difference between a stream and a
 * snowboard track.
 *
 *     a = −g·∇H / (1 + k|∇H|²)          gravity in the tangent plane
 *     a −= (μ + κ|v|)·v                  edge friction, then air
 *     v ← v + Δt·a ,   p ← p + Δt·v      semi-implicit — explicit Euler gains
 *                                        energy on every bowl traverse
 *
 * **The carve constraint is the mode.** The heading may not turn faster than a
 * maximum yaw rate, so a fast rider physically cannot take a tight line and gets
 * carried up the outside of a gully:
 *
 *     Δθ ≤ ω_max·Δt ,  ω_max = a_lat / |v|   ⟹   turn radius r = |v|² / a_lat
 *
 * `carve` runs that backwards for the panel: 0 is a trials bike welded to the
 * fall line, which converges on Flow mode, and 1 is a big-mountain arc.
 *
 * **Gravity is normalised by the terrain's own steepness** (`maxSlope`), so one
 * setting behaves the same on a 40 m quarry and a 3 000 m alp. Without it the
 * slider would mean a different thing for every raster loaded.
 *
 * **The surface is pre-smoothed, and that is not cosmetic.** A rider has length:
 * it does not launch off every one-cell bump, and it does not steer around one
 * either. Traced on the raw DEM the airborne test fires on sensor grain and the
 * mode returns a dotted field rather than a set of jumps — the same reason Ridge
 * and Curvature smooth before differentiating, one derivative further down.
 *
 * Returns flat runs of [fc, fr, elev, speed, signed curvature], plus the
 * airborne flag the Air mode reads. `src/utils/erosion.js` integrates droplets
 * with inertia over this same grid and is the nearest existing relative.
 */
function traceDescent(terrain, p, sr, sc, o) {
  const { gridMask, rows, cols } = terrain
  const grid = o.grid ?? terrain.grid
  const { elevScale } = p
  const sMask = terrain.hasNoData ? gridMask : null
  const eps = 0.5

  const gAcc  = (o.gravity ?? 1) * 0.25 / Math.max(1e-5, o.slopeRef ?? 0.01)
  const mu    = Math.max(0, o.drag ?? 0.1)
  const kappa = Math.max(0, o.dragQuad ?? 0.015)
  /*
   * Maximum lateral acceleration, as a multiple of the peak pull rather than an
   * absolute. Shared with Berm through `latLimit`, which is where `carve` is
   * read.
   *
   * The clamp binds when the *perpendicular* acceleration exceeds a_lat, and
   * that comparison is speed-independent — so a_lat has to be stated against the
   * only other acceleration in the system or it means nothing. Fixed values were
   * the first attempt and the slider did literally nothing: the terrain's own
   * acceleration peaks around 0.25 cells/step² after normalisation, and the
   * range 0.15…3.15 sat entirely above it, so the yaw limit never once bound at
   * any setting.
   *
   * The useful range is far below the peak, and that is the second thing this
   * got wrong. On a steady slope the velocity aligns with the gradient and the
   * *perpendicular* acceleration goes to zero — the clamp only has anything to
   * do where the track is already turning, entering a bowl or crossing a spur.
   * Typical a_perp there is a few percent of the peak, so a ceiling set at half
   * the peak never binds and the slider reads as broken over its whole lower
   * half. Measured on a reference massif, carve below 0.5 left the traced paths
   * byte-identical. Two rescalings later the mapping is geometric across the
   * band that actually bites: 0.12·aPeak at carve 0, where the limit binds only
   * on the sharpest direction changes and the track sits close to the gradient
   * line, down to 0.0036·aPeak at carve 1, where the rider can barely turn and
   * schusses straight off the mountain. A linear or polynomial mapping spends
   * most of its travel above the binding threshold and reads as a dead slider.
   *
   * The multiplier is the *peak* acceleration, not `gAcc`. Those differ by a
   * factor of `maxSlope`: gAcc is 0.25·gravity/maxSlope precisely so that
   * gAcc·maxSlope — the strongest pull on the terrain — comes out at
   * 0.25·gravity. Scaling the ceiling by gAcc instead leaves it larger than the
   * force it is meant to cap by exactly 1/maxSlope, which on ordinary ground is
   * a factor of several hundred, and the slider does nothing again.
   */
  const aLat  = latLimit(o)
  const maxLen = Math.max(2, Math.round(o.maxLen ?? 300))
  const stopAt = Math.max(1e-4, o.stop ?? 0.06)

  const out = []
  let fr = sr, fc = sc, vr = 0, vc = 0
  if (o.speed0) { vc = Math.cos(o.dir ?? 0) * o.speed0; vr = Math.sin(o.dir ?? 0) * o.speed0 }

  // Rider height and vertical rate, for the airborne test. On the ground these
  // just echo the surface; off it they are the only thing describing the arc.
  // `vyRate` is the descent expressed *per cell travelled*, not per step.
  //
  // Per step is the natural thing to write and it is wrong: a rider accelerating
  // down a perfectly even ramp covers more ground each step, so each step's drop
  // exceeds the last, and a prediction carried forward from the previous step
  // sits above the ground every time. Measured on a constant-gradient plane that
  // flagged 1 664 segments airborne — the rider launching off nothing but its
  // own acceleration. A rate per cell is invariant to that, and a plane then
  // produces exactly zero flights, which is the assertion in the spec.
  let y = null, vyRate = 0, vyStep = 0, airborne = false
  /*
   * Vertical scales for the flight, derived from how fast this terrain actually
   * descends rather than from its total relief.
   *
   * `vRef` is the drop across one cell at a typical slope. Both the downward
   * acceleration and the lip clearance are stated against it, because that is
   * the quantity the ballistic test is comparing itself to. Scaling them to the
   * elevation *range* instead — which was the first attempt — makes the
   * clearance vanishingly small next to an ordinary step, so every pebble of
   * micro-relief reads as a launch and the mode returns a dotted field rather
   * than a set of jumps.
   */
  const vRef = Math.max(1e-9, (o.slopeRef ?? 0.01) * 100 * Math.abs(elevScale))
  const airG = (o.airGravity ?? 1.5) * (o.gravity ?? 1)
  const lipK = o.lip ?? 0.6

  for (let step = 0; step < maxLen; step++) {
    if (fr < 1 || fr > rows - 2 || fc < 1 || fc > cols - 2) break
    const ri = Math.round(fr), ci = Math.round(fc)
    if (!gridMask[ri * cols + ci]) break

    const bL = sampleBilinear(grid, sMask, rows, cols, fr, fc - eps)
    const bR = sampleBilinear(grid, sMask, rows, cols, fr, fc + eps)
    const bU = sampleBilinear(grid, sMask, rows, cols, fr - eps, fc)
    const bD = sampleBilinear(grid, sMask, rows, cols, fr + eps, fc)
    const bC = sampleBilinear(grid, sMask, rows, cols, fr, fc)
    if (bC !== bC || bL !== bL || bR !== bR || bU !== bU || bD !== bD) break

    const ground = (bC - 0.5) * 100 * elevScale
    if (y === null) { y = ground; vyRate = 0 }

    const gx = (bR - bL) * 0.5, gz = (bD - bU) * 0.5
    const m2 = gx * gx + gz * gz
    const damp = 1 / (1 + m2 * 400)
    let ax = -gAcc * gx * damp, az = -gAcc * gz * damp
    const sp = Math.hypot(vc, vr)
    const drag = mu + kappa * sp
    ax -= drag * vc; az -= drag * vr

    let nvc = vc + ax, nvr = vr + az
    let curv = 0
    if (sp > 1e-3) {
      const oldA = Math.atan2(vr, vc), nsp = Math.hypot(nvc, nvr)
      let da = Math.atan2(nvr, nvc) - oldA
      while (da >  Math.PI) da -= 2 * Math.PI
      while (da < -Math.PI) da += 2 * Math.PI
      const wmax = aLat / Math.max(0.12, sp)
      if (Math.abs(da) > wmax) da = Math.sign(da) * wmax
      curv = da
      const a = oldA + da
      nvc = Math.cos(a) * nsp; nvr = Math.sin(a) * nsp
    }
    vc = nvc; vr = nvr
    const speed = Math.hypot(vc, vr)
    if (step > 6 && speed < stopAt && !airborne) break

    // Airborne test: the rider leaves the ground when the ballistic path clears
    // the surface — a convex break taken faster than gravity can pull the rider
    // back onto it. That is the *definition* of catching air, so the jumps are
    // found in the terrain rather than drawn onto it.
    const nfr = fr + vr, nfc = fc + vc
    if (nfr < 1 || nfr > rows - 2 || nfc < 1 || nfc > cols - 2) break
    const bN = sampleBilinear(grid, sMask, rows, cols, nfr, nfc)
    if (bN !== bN) break
    const nextGround = (bN - 0.5) * 100 * elevScale

    /*
     * `vy` is the vertical rate carried *into* this step, not the drop across it.
     *
     * Getting that wrong is the whole difference between the test firing and
     * never firing: setting vy from this step's own drop makes the ballistic
     * prediction `ground + (nextGround − ground) − gAir`, which is nextGround
     * minus a positive number and therefore below the surface at every step on
     * every terrain. The rider could never leave the ground.
     */
    /*
     * The pull and the clearance are *per step*, and a step is `speed` cells
     * long — so both have to scale with speed or the test means something
     * different at every point on the track.
     *
     * `vy` is a drop across one step, which on a constant slope is
     * speed × (drop per cell). Comparing it against a fixed per-cell quantity
     * makes a fast rider look like it is outrunning gravity on perfectly even
     * ground, and the mode flags almost every step airborne — the dotted field
     * again, from the other direction.
     *
     * Scaled this way the condition reads, near enough, as: the rider leaves the
     * ground where the descent rate steepens by more than
     * `(airGravity + lip)` times the terrain's typical per-cell drop, within one
     * step. Both are stated against `vRef` for that reason.
     *
     * The *usable* values are smaller than that description suggests and were
     * measured rather than derived. Swept over four fields — a constant-gradient
     * plane, a single 4× break, and a rough field read raw and smoothed — the
     * defaults 0.3 + 0.12 are the lowest pair at which a plane produces exactly
     * zero flights while a real break still fires. Below them float noise on
     * nominally flat ground starts launching riders (0.15 + 0.05 puts 192
     * segments in the air on a plane); above them a single change of gradient
     * stops registering at all. Treat the numbers as empirical and the ordering
     * — more of either means less air — as the part that is guaranteed.
     */
    const stepLen = Math.max(1e-6, Math.hypot(nfc - fc, nfr - fr))
    const gStep = vRef * airG * stepLen
    const lipClear = vRef * lipK * stepLen
    if (airborne) {
      vyStep -= gStep
      y += vyStep
      if (y <= nextGround) { y = nextGround; airborne = false; vyRate = vyStep / stepLen }
    } else {
      // Carry the *rate* forward over this step's own length, so a change of
      // speed on even ground predicts a proportionally larger drop rather than
      // a shortfall the test would read as a launch.
      const ballistic = y + vyRate * stepLen - gStep
      if (ballistic > nextGround + lipClear) {
        airborne = true
        vyStep = vyRate * stepLen - gStep
        y = ballistic
      } else {
        vyRate = (nextGround - y) / stepLen
        y = nextGround
      }
    }

    out.push(nfc, nfr, y, speed, curv, airborne ? 1 : 0)
    fr = nfr; fc = nfc
  }
  return out
}

/**
 * The lateral-acceleration ceiling the yaw clamp enforces.
 *
 * Shared, because Berm has to normalise against exactly this: the load it draws
 * is the lateral acceleration the rider is holding, and "how hard is it
 * cornering" only means something as a fraction of *how hard it could*. Scaling
 * against a speed instead is dimensionally wrong and reads as nothing — measured
 * on a rough field it put every tick below the visibility floor and the mode
 * drew an empty plate.
 */
function latLimit(o) {
  const carve = Math.max(0, Math.min(1, o.carve ?? 0.5))
  const aPeak = 0.25 * (o.gravity ?? 1)
  return aPeak * 0.12 * Math.pow(0.03, carve)
}

/**
 * The surface the rider actually reads: the grid, pre-smoothed by `smoothing`
 * cells. Mask-aware, so a clipped edge is not averaged against the zeros in
 * NoData and turned into a cliff the tracer would launch off.
 */
function descentGrid(terrain, o) {
  const rad = Math.max(0, o.smoothing ?? 2)
  if (rad <= 0) return terrain.grid
  return boxBlur(terrain.grid, terrain.cols, terrain.rows, rad,
                 terrain.hasNoData ? terrain.gridMask : null)
}

/**
 * The slope this terrain is *usually* at, for normalising gravity.
 *
 * `maxSlope` is the obvious quantity and it is the wrong one: it is a maximum
 * over the whole grid, so a single cliff cell sets it and every ordinary slope
 * then reads as almost flat. Measured on the sample plate that left the tracer
 * accelerating so weakly that drag stopped every run within a few dozen steps —
 * the mode drew a field of short dashes instead of tracks.
 *
 * The mean over valid cells is stable against that and still scales with the
 * terrain, which is the property the normalisation needs: one Gravity setting
 * has to behave the same on a 40 m quarry and a 3 000 m alp.
 */
function typicalSlope(terrain, grid) {
  const { gridSlopes, gridMask, rows, cols } = terrain
  let sum = 0, n = 0
  // Measured on the *smoothed* surface when one is supplied. Gravity is
  // normalised by this and the tracer runs on that surface, so reading the raw
  // grid would scale the physics against a steepness the rider never sees.
  if (grid && grid !== terrain.grid) {
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const i = r * cols + c
        if (!gridMask[i] || !gridMask[i + 1] || !gridMask[i + cols]) continue
        const b = grid[i]
        sum += Math.hypot(grid[i + 1] - b, grid[i + cols] - b); n++
      }
    }
    return n ? sum / n : 0.01
  }
  for (let i = 0; i < gridSlopes.length; i++) {
    if (!gridMask[i]) continue
    sum += gridSlopes[i]; n++
  }
  return n ? sum / n : 0.01
}

/** Peaks first, one track per neighbourhood. Flow's seeding, and for the same
 *  reason: ridges claim their lines before anything below them can. */
function descentSeeds(terrain, spacing, occ) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const pitch = Math.max(1, (spacing ?? 12) / scl)
  const cand = []
  for (let rf = 1; rf < rows - 1; rf += pitch) {
    const r = Math.min(rows - 2, Math.round(rf))
    for (let cf = 1; cf < cols - 1; cf += pitch) {
      const c = Math.min(cols - 2, Math.round(cf))
      if (gridMask[r * cols + c]) cand.push(r * cols + c)
    }
  }
  cand.sort((a, b) => grid[b] - grid[a])
  const out = []
  for (const idx of cand) {
    if (occ && occ[idx]) continue
    out.push([Math.floor(idx / cols), idx % cols])
  }
  return out
}

/** Marks a traced run's cells as taken, so the next seed does not retrace it. */
function claimRun(run, occ, cols, rows, radius) {
  for (let i = 0; i < run.length; i += 6) {
    const c = Math.round(run[i]), r = Math.round(run[i + 1])
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const rr = r + dr, cc = c + dc
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue
        occ[rr * cols + cc] = 1
      }
    }
  }
}

/**
 * Runs every seed once, sharing one occupancy mask. Every mode in this family
 * wants the same set of tracks and differs only in what it draws along them.
 */
function descentRuns(terrain, p, o) {
  const { rows, cols, scl } = terrain
  const occ = new Uint8Array(rows * cols)
  const radius = Math.max(1, Math.round(((o.spacing ?? 12) / scl) * 0.45))
  const dGrid = descentGrid(terrain, o)
  const opts = { ...o, slopeRef: typicalSlope(terrain, dGrid), grid: dGrid }
  // A run has to go somewhere. Counting samples is not enough: a seed on flat
  // ground still emits a handful before drag stops it, and a plate seeded every
  // few cells then comes out speckled with marks a few pixels long that read as
  // noise over the whole raster rather than as tracks. The test is *travelled
  // distance*, against the seed pitch — anything that has not covered its own
  // spacing was never a descent.
  const pitch = Math.max(1, (o.spacing ?? 12) / scl)
  const minTravel = pitch * 1.5
  const runs = []
  for (const [r, c] of descentSeeds(terrain, o.spacing, occ)) {
    if (occ[r * cols + c]) continue
    const run = traceDescent(terrain, p, r, c, opts)
    if (run.length < 6 * 4) { occ[r * cols + c] = 1; continue }
    let travel = 0
    for (let i = 6; i < run.length; i += 6) {
      travel += Math.hypot(run[i] - run[i - 6], run[i + 1] - run[i - 5])
    }
    if (travel < minTravel) { occ[r * cols + c] = 1; continue }
    claimRun(run, occ, cols, rows, radius)
    runs.push(run)
  }
  return runs
}

/** Fastest speed anywhere in a set of runs, for normalising the ink. */
function runsMaxSpeed(runs) {
  let v = 0
  for (const run of runs) for (let i = 3; i < run.length; i += 6) if (run[i] > v) v = run[i]
  return v || 1
}

/**
 * The track itself: speed in the ink, the carve in the line.
 *
 * `computeVertexColor` takes a 0–1 value in its second slot that every other
 * mode fills with normalised slope. Filling it with |v|/v_max instead turns the
 * hypsometric ramp into a *speed* ramp for nothing — the gradient picker becomes
 * a telemetry palette, and the track goes hot in the steeps.
 *
 * The one thing this mode wants and cannot have is stroke weight following
 * speed: `weight` is resolved per layer by `layerStyle`, so a layer has one
 * width. That is the line contract, not an oversight.
 */
/**
 * Terrain slope under a point on a traced run.
 *
 * The descent family used to fill `computeVertexColor`'s second slot with
 * speed, which meant the panel's "Slope" button drew a speed ramp on these four
 * modes and only these four. Speed now has its own slot and its own name, and
 * this puts a real slope back in the one it borrowed.
 */
function slopeAtRun(terrain, run, i) {
  const { rows, cols, gridSlopes, maxSlope } = terrain
  const c = Math.min(cols - 1, Math.max(0, Math.round(run[i])))
  const r = Math.min(rows - 1, Math.max(0, Math.round(run[i + 1])))
  return Math.min(1, gridSlopes[r * cols + c] / (maxSlope || 1))
}

export function buildFallLine(terrain, p, o) {
  const { scl, halfW, halfH, minElev, maxElev } = terrain
  const { elevMinCut, elevMaxCut } = p
  const runs = descentRuns(terrain, p, o)
  const vMax = runsMaxSpeed(runs)
  const positions = new F32List(), colors = new F32List()

  for (const run of runs) {
    for (let i = 6; i < run.length; i += 6) {
      const e0 = run[i - 4], e1 = run[i + 2]
      if (!inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      if (!inElevCut(e1, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      positions.push6(run[i - 6] * scl - halfW, e0, run[i - 5] * scl - halfH,
                      run[i]     * scl - halfW, e1, run[i + 1] * scl - halfH)
      const v = Math.min(1, run[i + 3] / vMax)
      colors.pushRgb2(computeVertexColor(normElev(e1, minElev, maxElev),
                                         slopeAtRun(terrain, run, i),
                                         Math.atan2(run[i + 1] - run[i - 5], run[i] - run[i - 6]), p, v))
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

/**
 * Only the lateral load — a tick on the outside of every turn, and nothing on
 * the straights.
 *
 * Length follows |v|²/r, which is the centripetal acceleration the rider is
 * actually holding, and r = |v|²/a_lat means that reduces to the yaw the tracer
 * already computed. So the mark is literally how hard the track is cornering:
 * a banked traverse combs out into a dense fringe and a fall-line schuss draws
 * nothing at all.
 */
export function buildBerm(terrain, p, o) {
  const { scl, halfW, halfH, minElev, maxElev } = terrain
  const { elevMinCut, elevMaxCut } = p
  const runs = descentRuns(terrain, p, o)
  const len = (o.length ?? 1.5) * scl
  const aLat = latLimit(o)
  const vMaxBerm = runsMaxSpeed(runs)
  const positions = new F32List(), colors = new F32List()

  for (const run of runs) {
    for (let i = 6; i < run.length; i += 6) {
      const curv = run[i + 4]
      if (Math.abs(curv) < 1e-4) continue
      const e = run[i + 2]
      if (!inElevCut(e, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      const dx = run[i] - run[i - 6], dz = run[i + 1] - run[i - 5]
      const m = Math.hypot(dx, dz)
      if (m < 1e-6) continue
      const v = run[i + 3]
      // |v|·|Δθ| is the lateral acceleration held over this step, and the yaw
      // ceiling is what it is held *against* — so the load is the fraction of
      // the rider's grip in use, and reads 1 exactly where the clamp binds.
      const load = Math.min(1, (v * Math.abs(curv)) / aLat)
      if (load < 0.03) continue
      const sgn = Math.sign(curv)
      const nx = (-dz / m) * sgn, nz = (dx / m) * sgn
      const wx = run[i] * scl - halfW, wz = run[i + 1] * scl - halfH
      positions.push6(wx, e, wz, wx + nx * len * load, e, wz + nz * len * load)
      colors.pushRgb2(computeVertexColor(normElev(e, minElev, maxElev), load,
                                         Math.atan2(nz, nx), p,
                                         Math.min(1, v / (vMaxBerm || 1))))
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

/**
 * The jumps, and only the jumps.
 *
 * The tracer already knows: it flags a step airborne when the ballistic path
 * clears the surface, which is a convex break taken faster than gravity can pull
 * the rider back down. Every span so flagged is drawn on its true parabola —
 * lifted off the ground, because it *is* off the ground — and everything else is
 * left out. The result is a map of where a mountain throws you, found rather
 * than invented.
 *
 * Two sub-layers: the flight, and the run-in leading to it, so a launch can be
 * read back to where it started.
 */
export function buildAir(terrain, p, o) {
  const { scl, halfW, halfH, minElev, maxElev } = terrain
  const { elevMinCut, elevMaxCut } = p
  const runs = descentRuns(terrain, p, o)
  const vMax = runsMaxSpeed(runs)
  const lead = Math.max(0, Math.round(o.runIn ?? 8))
  const minAir = Math.max(1, Math.round(o.minAir ?? 4))

  const aP = new F32List(), aC = new F32List()
  const rP = new F32List(), rC = new F32List()

  for (const run of runs) {
    const n = run.length / 6
    // Flights shorter than `minAir` are not jumps. Even with the lip clearance
    // in place a rough surface throws off single-step hops, and a scattering of
    // one-step dashes reads as broken line work rather than as air.
    const air = new Uint8Array(n)
    for (let k = 0; k < n; k++) air[k] = run[k * 6 + 5] >= 1 ? 1 : 0
    for (let k = 0; k < n;) {
      if (!air[k]) { k++; continue }
      let j = k
      while (j < n && air[j]) j++
      if (j - k < minAir) for (let q = k; q < j; q++) air[q] = 0
      k = j
    }
    // Which samples lead into a flight, so the approach can be drawn separately.
    const isRun = new Uint8Array(n)
    for (let k = 0; k < n; k++) {
      if (!air[k]) continue
      for (let j = Math.max(0, k - lead); j < k; j++) if (!air[j]) isRun[j] = 1
    }
    for (let k = 1; k < n; k++) {
      const i = k * 6, e0 = run[i - 4], e1 = run[i + 2]
      if (!inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      if (!inElevCut(e1, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      const flying = air[k] === 1
      if (!flying && !isRun[k]) continue
      const P = flying ? aP : rP, C = flying ? aC : rC
      P.push6(run[i - 6] * scl - halfW, e0, run[i - 5] * scl - halfH,
              run[i]     * scl - halfW, e1, run[i + 1] * scl - halfH)
      C.pushRgb2(computeVertexColor(normElev(e1, minElev, maxElev),
                                    slopeAtRun(terrain, run, i), 0, p,
                                    Math.min(1, run[i + 3] / vMax)))
    }
  }
  return {
    'Air-Flight': { positions: aP.toArray(), colors: aC.toArray() },
    'Air-RunIn':  { positions: rP.toArray(), colors: rC.toArray() },
  }
}

/**
 * Every line a single drop-in could have taken.
 *
 * One seed, the initial heading fanned across ±θ, and no occupancy mask — the
 * overlap *is* the picture. The run that reaches the lowest ground is promoted
 * to its own sub-layer and inked heavier, which turns a braid into an argument
 * about which way down is best.
 */
export function buildRaceLine(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev } = terrain
  const { elevMinCut, elevMaxCut } = p
  const fan = Math.max(2, Math.round(o.fan ?? 11))
  const spread = ((o.spreadDeg ?? 120) * Math.PI) / 180

  // Drop-ins: the highest cells, spaced out, so the braids do not all start on
  // one summit.
  const occ = new Uint8Array(rows * cols)
  const drops = []
  for (const [r, c] of descentSeeds(terrain, o.spacing, null)) {
    if (occ[r * cols + c]) continue
    drops.push([r, c])
    const rad = Math.max(2, Math.round((o.spacing ?? 40) / scl))
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const rr = r + dr, cc = c + dc
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) occ[rr * cols + cc] = 1
    }
    if (drops.length >= Math.max(1, Math.round(o.drops ?? 4))) break
  }

  const bP = new F32List(), bC = new F32List()
  const wP = new F32List(), wC = new F32List()
  const sGrid = descentGrid(terrain, o)
  const slopeRef = typicalSlope(terrain, sGrid)

  for (const [sr, sc] of drops) {
    const runs = []
    for (let k = 0; k < fan; k++) {
      const dir = (k / (fan - 1) - 0.5) * spread
      const run = traceDescent(terrain, p, sr, sc,
        { ...o, slopeRef, grid: sGrid, speed0: o.dropSpeed ?? 0.9, dir })
      if (run.length >= 6 * 4) runs.push(run)
    }
    if (!runs.length) continue
    // "Best" is the run that gets lowest; ties break on the shorter one, since
    // reaching the same ground in fewer steps is the faster line.
    let best = runs[0], bestScore = Infinity
    for (const run of runs) {
      const endE = run[run.length - 4]
      const score = normElev(endE, minElev, maxElev) * 1000 + run.length / 6
      if (score < bestScore) { bestScore = score; best = run }
    }
    const vMax = runsMaxSpeed(runs)
    for (const run of runs) {
      const P = run === best ? wP : bP, C = run === best ? wC : bC
      for (let i = 6; i < run.length; i += 6) {
        const e0 = run[i - 4], e1 = run[i + 2]
        if (!inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut)) continue
        if (!inElevCut(e1, minElev, maxElev, elevMinCut, elevMaxCut)) continue
        P.push6(run[i - 6] * scl - halfW, e0, run[i - 5] * scl - halfH,
                run[i]     * scl - halfW, e1, run[i + 1] * scl - halfH)
        C.pushRgb2(computeVertexColor(normElev(e1, minElev, maxElev),
                                      slopeAtRun(terrain, run, i), 0, p,
                                      Math.min(1, run[i + 3] / vMax)))
      }
    }
  }
  void grid; void gridMask
  return {
    'RaceLine-Field': { positions: bP.toArray(), colors: bC.toArray() },
    'RaceLine-Best':  { positions: wP.toArray(), colors: wC.toArray() },
  }
}
