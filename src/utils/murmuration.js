/**
 * Bird murmuration — a boids flock that flies over the terrain.
 *
 * Three rules make a flock (separation, alignment, cohesion); four more make it
 * a *murmuration over this landscape*: a roost on the summit to orbit, a floor
 * that follows the relief, updraft on the steep ground, and a predator to tear
 * holes in it. All of them read data `buildTerrain` already returns.
 *
 * Pure functions over typed arrays — no React, no three.js. The hologram field
 * next door animates entirely in the vertex shader and the CPU never learns
 * where a particle went, which is why SVG export of it is a snapshot at rest.
 * Here the positions *are* the JS buffer the renderer draws from, so the
 * exporter gets the live flock for nothing.
 *
 * Everything is scaled by the terrain's own dimensions, so a setting that looks
 * right on one heightmap looks right on the next. The sliders are therefore
 * unitless multipliers, and the constants below are the units.
 */
import { sampleBilinear, jitterNoise } from './terrain'

// ── Scene-relative constants ──────────────────────────────────────────────────
//
// Two scales, not one. Horizontal distances are fractions of `span` (the
// terrain's larger footprint); vertical ones are fractions of `vspan` (its
// relief). Keying altitude off the footprint looked right on the test cone and
// absurd on a real heightmap, where a 1024-cell raster is ten times wider than
// its mountains are tall — the flock cruised so far above the terrain that the
// ground avoidance and the ridge lift never engaged at all.
const PERCEPTION  = 0.035  // ×span  — neighbourhood radius at perception 1
const SEP_FRAC    = 0.40   //        — separation radius, as a fraction of that
const CRUISE      = 0.09   // ×span  — cruise speed per second at speed 1
const ROOST_FREE  = 0.180  // ×span  — no roost pull inside this radius
const ROOST_FULL  = 0.500  // ×span  — full roost pull beyond it
const FEAR        = 0.060  // ×span  — predator fear radius at predatorFear 1
const TRAIL       = 0.020  // ×span  — streak length at trail 1
const BOUND_SOFT  = 1.15   //        — XZ bounds, ×the terrain half-extent

const SHADOW_LIFT = 0.012  // ×vspan — how far a shadow floats above the ground
const SHADOW_REACH= 0.60   // ×span  — furthest a low sun may throw one
const CLEARANCE   = 0.15   // ×vspan — minimum height above ground at clearance 1
const ROOST_LIFT  = 0.35   // ×vspan — roost height above the summit at roostHeight 1
const BAND        = 0.45   // ×vspan — half-height of the flight envelope
const LIFT_DECAY  = 0.50   // ×vspan — ridge lift halves this far above ground

const FIXED_DT    = 1 / 60 // the simulation only ever advances in these
const MAX_SUBSTEP = 3      // …and never more than this many per call
/**
 * How many neighbours a bird actually flies with, and how many candidates it
 * may walk to find them.
 *
 * Eight is not a performance compromise — it is the model. Ballerini et al.
 * (PNAS 2008) tracked real starling flocks and found each bird interacts with a
 * fixed *number* of nearest neighbours, six or seven, rather than with everyone
 * inside some metric radius. That topological rule is exactly why a murmuration
 * stays cohesive as it compresses and expands, and why a predator's strike tears
 * a travelling wave through it instead of a local dent.
 *
 * > Ballerini, M. et al., *Interaction ruling animal collective behavior depends
 * > on topological rather than metric distance*, PNAS 105(4), 2008.
 *
 * The visit budget is the hard bound. A *sparse* flock can walk a long way
 * without accepting anything at all, so the neighbour cap alone does not
 * guarantee a bounded search.
 */
const MAX_NEIGH   = 8
const MAX_VISIT   = 96

/**
 * The 27 neighbouring hash cells, **ordered by distance from the centre**: own
 * cell, then the 6 faces, the 12 edges, and the 8 corners last.
 *
 * The order is the difference between linear and quadratic. A flock occupies
 * roughly the same volume however many birds are in it, so doubling the
 * population doubles the birds per cell; scanning in naive −1…+1 order meant a
 * bird walked twenty low-yield corner and edge cells — where almost nothing
 * falls inside the perception sphere — before reaching its own. At 50 000 birds
 * that was ~2 000 rejected candidates before the neighbour cap could fire, and
 * the cost per substep went from 12 ms at 12 000 to 114 ms. Nearest-first, the
 * cap fires inside the bird's own cell and the walk is bounded.
 */
const CELL_OFF = (() => {
  const offs = []
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    offs.push([dx * dx + dy * dy + dz * dz, dx, dy, dz])
  }
  offs.sort((a, b) => a[0] - b[0])
  return Int8Array.from(offs.flatMap(([, dx, dy, dz]) => [dx, dy, dz]))
})()

/** Small, fast, seedable PRNG. Same one the stipple and Swiss modes use. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * World-space samplers over a terrain grid, plus the constants derived from it.
 *
 * The world position of grid cell (r, c) is `(c·scl − halfW, elev, r·scl − halfH)`,
 * exactly as the particle field lays out its home buffer; these are the inverse.
 */
export function makeTerrainField(terrain, elevScale, jitterAmt = 0) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, gridSlopes } = terrain
  const span = Math.max(1e-3, 2 * Math.max(halfW, halfH))

  const heightAt = (x, z) => {
    const fc = (x + halfW) / scl
    const fr = (z + halfH) / scl
    // sampleBilinear, not a plain tap: the grid stores 0 for NoData and 0 is not
    // "absent" but the darkest possible ground, which maps to the very bottom of
    // the scene. A naive tap straddling a clipped edge therefore reports a floor
    // that is not there, and the flock would dive into it all along the cut.
    // NaN means the footprint held no data at all — the caller steers home.
    const b = sampleBilinear(grid, gridMask, rows, cols, fr, fc)
    if (Number.isNaN(b)) return NaN
    let y = (b - 0.5) * 100 * elevScale
    if (jitterAmt > 0) y += jitterNoise(fc, fr) * jitterAmt
    return y
  }

  /**
   * `heightAt`, but NaN *outside* the grid as well as inside its holes.
   *
   * `sampleBilinear` clamps its row and column into range, which is what the
   * flock wants — a bird that strays past the edge should still see ground under
   * it rather than fall off the world. It is not what a shadow wants: clamping
   * hands back the height of the nearest edge cell, so a shadow thrown past the
   * boundary was drawn hanging in mid-air off the side of the terrain, and one
   * landing in a lasso'd-out hole was drawn on ground that is not there. A
   * shadow with nothing to fall on should not be drawn at all.
   */
  const groundAt = (x, z) => {
    const fc = (x + halfW) / scl
    const fr = (z + halfH) / scl
    if (fc < 0 || fr < 0 || fc > cols - 1 || fr > rows - 1) return NaN
    const b = sampleBilinear(grid, gridMask, rows, cols, fr, fc)
    if (Number.isNaN(b)) return NaN
    let y = (b - 0.5) * 100 * elevScale
    if (jitterAmt > 0) y += jitterNoise(fc, fr) * jitterAmt
    return y
  }

  // The roost sits over the highest ground, and ridge lift needs to know what
  // counts as steep *here*. Both come out of one strided scan: this runs on
  // every terrain rebuild, the default session is a 1024² grid, and a roost a
  // couple of cells off the true summit is a roost on the summit. The stride
  // caps the scan at ~64k samples whatever the grid size.
  const stride = Math.max(1, Math.floor(Math.sqrt((rows * cols) / 65536)))
  let bestY = -Infinity, worstY = Infinity, bestR = rows >> 1, bestC = cols >> 1, found = false
  let slopeSum = 0, slopeN = 0
  for (let r = 0; r < rows; r += stride) {
    for (let c = 0; c < cols; c += stride) {
      const i = r * cols + c
      if (gridMask && !gridMask[i]) continue
      // Signed: a negative elevScale inverts the terrain, and the summit is then
      // the darkest cell. Compare elevations, not brightness.
      const y = (grid[i] - 0.5) * 100 * elevScale
      if (y > bestY) { bestY = y; bestR = r; bestC = c; found = true }
      if (y < worstY) worstY = y
      if (gridSlopes) { slopeSum += gridSlopes[i]; slopeN++ }
    }
  }
  if (!found) { bestY = 0; worstY = 0 }
  const meanSlope = slopeN > 0 ? slopeSum / slopeN : 0

  /**
   * Steepness in [0, 1), self-centred: `s / (s + mean)` is exactly 0.5 at the
   * terrain's own mean slope. Normalising against `maxSlope` instead — the
   * obvious choice — makes the reading a function of a single outlier cell, so
   * ridge lift came out as a constant updraft on a uniform cone and as a
   * constant downdraft on a landscape with one cliff in it. Either way the
   * flock drifted to one end of its flight envelope and stayed there.
   */
  const slopeAt = (x, z) => {
    if (!gridSlopes || meanSlope <= 1e-9) return 0.5
    const c = Math.max(0, Math.min(cols - 1, Math.round((x + halfW) / scl)))
    const r = Math.max(0, Math.min(rows - 1, Math.round((z + halfH) / scl)))
    const i = r * cols + c
    if (gridMask && !gridMask[i]) return 0.5
    const sl = gridSlopes[i]
    return sl / (sl + meanSlope)
  }

  return {
    heightAt, groundAt, slopeAt, span, halfW, halfH,
    roostX: bestC * scl - halfW,
    roostZ: bestR * scl - halfH,
    peakY: bestY,
    // The vertical yardstick. Floored against the footprint so a heightmap
    // flattened to nothing (elevScale 0, or a blank raster) still gives the
    // flock somewhere to fly instead of collapsing it onto the plane.
    vspan: Math.max(bestY - worstY, 0.05 * span),
  }
}

/**
 * Resolve the unitless sliders against a field. Split out from `stepFlock` so
 * the spawn and the step agree on what "cruise speed" means, and so a test can
 * assert the bounds it is about to check.
 */
export function flockScales(field, params = {}) {
  const span = field.span, vspan = field.vspan
  const cruise = Math.max(1e-4, (params.speed ?? 1) * CRUISE * span)
  const perception = Math.max(1e-3, (params.perception ?? 1) * PERCEPTION * span)
  return {
    span, vspan, cruise, perception,
    sepRadius: perception * SEP_FRAC,
    // Birds do not hover. A floor under the speed is the single detail that
    // separates a murmuration from a cloud of drifting dust.
    minSpeed: cruise * 0.65,
    maxSpeed: cruise * 1.35,
    maxForce: cruise * 2.5,
    clearance: Math.max(1e-4, (params.clearance ?? 1) * CLEARANCE * vspan),
    roostY: field.peakY + (params.roostHeight ?? 1) * ROOST_LIFT * vspan,
    band: BAND * vspan,
    liftDecay: 1 / (LIFT_DECAY * vspan),
    fear: Math.max(1e-4, (params.predatorFear ?? 1) * FEAR * span),
    trail: (params.trail ?? 0) * TRAIL * span,
    shadowLift: SHADOW_LIFT * vspan,
    shadowReach: SHADOW_REACH * span,
  }
}

/** Allocate a flock and scatter it around the roost. Same seed, same flock. */
export function createFlock(count, seed, field, params = {}) {
  const n = Math.max(1, Math.floor(count))
  const s = flockScales(field, params)
  const rng = mulberry32((seed | 0) || 1)

  const pos = new Float32Array(n * 3)
  const vel = new Float32Array(n * 3)
  const phase = new Float32Array(n)
  const seg = new Float32Array(n * 6)
  // Ground shadows: one point each, plus how high its bird is flying (0 at the
  // ground, 1 at the top of the flight envelope) so the sprite can grow and
  // fade with altitude the way a real shadow does.
  const shadow = new Float32Array(n * 3)
  const shadowLift = new Float32Array(n)

  const spread = 0.18 * s.span
  for (let i = 0; i < n; i++) {
    const j = i * 3
    const x = field.roostX + (rng() * 2 - 1) * spread
    const z = field.roostZ + (rng() * 2 - 1) * spread
    const ground = field.heightAt(x, z)
    const base = Number.isNaN(ground) ? field.peakY : ground
    pos[j]     = x
    pos[j + 1] = Math.max(base + s.clearance, s.roostY + (rng() * 2 - 1) * s.band * 0.5)
    pos[j + 2] = z
    // Random heading on the sphere, at cruise speed.
    const theta = rng() * Math.PI * 2
    const ct = rng() * 0.6 - 0.3                     // shallow climb angles only
    const cf = Math.sqrt(Math.max(0, 1 - ct * ct))
    vel[j]     = Math.cos(theta) * cf * s.cruise
    vel[j + 1] = ct * s.cruise
    vel[j + 2] = Math.sin(theta) * cf * s.cruise
    phase[i]   = rng()
  }


  // Hash buckets: a power of two at least twice the population, so the mask is
  // an AND and the table stays sparse enough that collision chains stay short.
  let buckets = 1
  while (buckets < n * 2) buckets <<= 1

  const flock = {
    n, pos, vel, phase, seg, shadow, shadowLift,
    // Counting-sort scratch for the neighbour search. `order` lists the birds
    // grouped by hash cell, `cellStart` bounds each group, and `spos`/`svel`
    // hold their state in that same order — so walking a cell reads a
    // contiguous run of memory instead of chasing a linked list all over a
    // 600 KB buffer. See `substep`.
    cellOf: new Int32Array(n),
    order:  new Int32Array(n),
    count:  new Int32Array(buckets),
    cellStart: new Int32Array(buckets + 1),
    spos: new Float32Array(n * 3),
    svel: new Float32Array(n * 3),
    mask: buckets - 1,
    buckets,
    time: 0,
    accum: 0,
    // The predator starts off to one side, outside the flock it is about to hit.
    pred: new Float32Array([
      field.roostX + 0.5 * s.span, s.roostY, field.roostZ,
      s.cruise, 0, 0,
    ]),
  }
  // A flock created with animation off never reaches `stepFlock`, and a streak
  // buffer of zeros is n segments collapsed at the world origin.
  writeTrails(flock, s.trail)
  writeShadows(flock, field, s, params)
  return flock
}

/**
 * Advance the flock by `dt` seconds.
 *
 * Time is consumed in fixed 1/60 s substeps out of an accumulator, capped at
 * three per call. A variable timestep would make the flock a function of the
 * frame rate — the same seed would diverge between a fast machine and a slow
 * one, and between a test run and the viewport — and boids under a large step
 * overshoot into each other and explode. Leftover time carries to the next call.
 */
export function stepFlock(flock, dt, field, params = {}) {
  const s = flockScales(field, params)
  flock.accum = Math.min(flock.accum + dt, FIXED_DT * MAX_SUBSTEP)
  let steps = 0
  while (flock.accum >= FIXED_DT && steps < MAX_SUBSTEP) {
    substep(flock, FIXED_DT, field, s, params)
    flock.accum -= FIXED_DT
    steps++
  }
  if (steps > 0) {
    writeTrails(flock, s.trail)
    if (params.shadow) writeShadows(flock, field, s, params)
  }
  return steps
}

/**
 * Rewrite the streaks without advancing the flock — for a frozen field, and for
 * the moment the trail-length slider moves while it is frozen.
 */
export function updateTrails(flock, field, params = {}) {
  writeTrails(flock, flockScales(field, params).trail)
}

/** Recompute the shadows without advancing the flock — frozen field, or a
 *  sun/shadow control moving while it is frozen. */
export function updateShadows(flock, field, params = {}) {
  writeShadows(flock, field, flockScales(field, params), params)
}

function substep(flock, dt, field, s, params) {
  const { n, pos, vel, cellOf, order, count, cellStart, spos, svel, mask, buckets } = flock
  const wCoh = params.cohesion ?? 1
  const wAli = params.alignment ?? 1
  const wSep = params.separation ?? 1
  const wRoost = params.roost ?? 1
  const wLift = params.lift ?? 1
  const wTurb = params.turbulence ?? 1

  flock.time += dt

  // ── Spatial hash ───────────────────────────────────────────────────────────
  //
  // Cell size is the perception radius, so every neighbour is in one of the 27
  // cells around a bird. Built by counting sort rather than the usual head/next
  // linked list: the list is two lines shorter but scatters its reads across the
  // whole position buffer, and at tens of thousands of birds the search is
  // entirely memory-bound. Sorting lets a cell be walked as a contiguous slice.
  //
  // Every buffer is permanent, so a substep allocates nothing. Hash collisions
  // only add candidates that the radius test below rejects — correctness never
  // depends on the table size.
  const cellInv = 1 / s.perception
  count.fill(0)
  for (let i = 0; i < n; i++) {
    const j = i * 3
    const h = hash3(Math.floor(pos[j] * cellInv), Math.floor(pos[j + 1] * cellInv),
                    Math.floor(pos[j + 2] * cellInv), mask)
    cellOf[i] = h
    count[h]++
  }
  // Prefix sum and write-cursor init in one pass. Two passes over the bucket
  // table is two passes over a quarter of a million entries at 100 000 birds —
  // more iterations than there are birds — for something the same loop can do.
  let run = 0
  for (let b = 0; b < buckets; b++) { cellStart[b] = run; run += count[b]; count[b] = cellStart[b] }
  cellStart[buckets] = run
  for (let i = 0; i < n; i++) order[count[cellOf[i]]++] = i
  // Gather state into cell order. One extra pass, and it is what makes the
  // inner loop sequential.
  for (let m = 0; m < n; m++) {
    const j = order[m] * 3, k = m * 3
    spos[k] = pos[j]; spos[k + 1] = pos[j + 1]; spos[k + 2] = pos[j + 2]
    svel[k] = vel[j]; svel[k + 1] = vel[j + 1]; svel[k + 2] = vel[j + 2]
  }

  const R2 = s.perception * s.perception
  const rSep2 = s.sepRadius * s.sepRadius

  // ── Predator ───────────────────────────────────────────────────────────────
  const hunting = !!params.predator
  const pred = flock.pred
  if (hunting) stepPredator(flock, dt, field, s)
  const fear2 = s.fear * s.fear

  const turbK = 20 / s.span   // ~3 noise features across the terrain
  const boundX = field.halfW * BOUND_SOFT
  const boundZ = field.halfH * BOUND_SOFT
  const boundSoft = 1 / (0.10 * s.span)
  const bandSoft = 1 / (0.50 * s.band)

  // Walked in cell order, not index order: a bird's own cell is the first thing
  // its neighbour search touches, so processing neighbours back to back keeps it
  // in cache. Reads come from the sorted snapshot, writes go back to the real
  // buffers — which also makes the update simultaneous rather than in-place, so
  // no bird sees some of its neighbours already moved this substep.
  for (let m = 0; m < n; m++) {
    const i = order[m]
    const j = i * 3, sj = m * 3
    const x = spos[sj], y = spos[sj + 1], z = spos[sj + 2]
    const vx = svel[sj], vy = svel[sj + 1], vz = svel[sj + 2]

    let sepX = 0, sepY = 0, sepZ = 0
    let aliX = 0, aliY = 0, aliZ = 0
    let cohX = 0, cohY = 0, cohZ = 0
    let nNb = 0, nSep = 0

    const ix = Math.floor(x * cellInv), iy = Math.floor(y * cellInv), iz = Math.floor(z * cellInv)
    let visits = 0
    // Nearest cell first — see CELL_OFF — and bounded by both budgets above.
    outer:
    for (let o = 0; o < 81; o += 3) {
      const b = hash3(ix + CELL_OFF[o], iy + CELL_OFF[o + 1], iz + CELL_OFF[o + 2], mask)
      const end = cellStart[b + 1]
      for (let q2 = cellStart[b]; q2 < end; q2++) {
        if (++visits > MAX_VISIT) break outer
        if (q2 === m) continue
        const q = q2 * 3
        const ddx = spos[q] - x, ddy = spos[q + 1] - y, ddz = spos[q + 2] - z
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz
        if (d2 < R2) {
          nNb++
          aliX += svel[q]; aliY += svel[q + 1]; aliZ += svel[q + 2]
          cohX += spos[q]; cohY += spos[q + 1]; cohZ += spos[q + 2]
          if (d2 < rSep2) {
            // Weighted by 1/d: a bird about to collide pushes far harder
            // than one merely close, which is what keeps the flock's
            // internal spacing even instead of clumped.
            const inv = 1 / (Math.sqrt(d2) + 1e-6)
            sepX -= ddx * inv; sepY -= ddy * inv; sepZ -= ddz * inv
            nSep++
          }
          if (nNb >= MAX_NEIGH) break outer
        }
      }
    }

    // ── Steering ─────────────────────────────────────────────────────────────
    //
    // Reynolds steering, inlined at each of its four sites rather than called:
    // `w · (normalise(d)·cruise − v)`, the force that turns the current velocity
    // toward a desired direction. This is the hottest arithmetic in the app —
    // four of these per bird per substep, times a hundred thousand birds, times
    // sixty — and a helper writing through a shared scratch array cost a
    // quarter of the whole step in call overhead and typed-array indexing.
    // Scalars stay in registers.
    //
    // Reynolds clamps each such force to a maximum. That clamp is *provably
    // dead* here and has been dropped: |normalise(d)·cruise| is exactly `cruise`
    // and |v| never exceeds 1.35·cruise, so the difference never exceeds
    // 2.35·cruise, while maxForce is 2.5·cruise. It never fired once, and it was
    // costing a `Math.hypot` per term. The forces below that genuinely need to
    // overpower everything — ground avoidance, the predator — are applied after
    // this and were never clamped anyway.
    let accX = 0, accY = 0, accZ = 0

    if (nNb > 0) {
      const inv = 1 / nNb
      // Alignment: match the neighbourhood's mean heading.
      let dx = aliX * inv, dy = aliY * inv, dz = aliZ * inv
      let m2 = dx * dx + dy * dy + dz * dz
      if (m2 > 1e-18) {
        const k = s.cruise / Math.sqrt(m2)
        accX += (dx * k - vx) * wAli; accY += (dy * k - vy) * wAli; accZ += (dz * k - vz) * wAli
      }
      // Cohesion: toward the neighbourhood's centre of mass.
      dx = cohX * inv - x; dy = cohY * inv - y; dz = cohZ * inv - z
      m2 = dx * dx + dy * dy + dz * dz
      if (m2 > 1e-18) {
        const k = s.cruise / Math.sqrt(m2)
        accX += (dx * k - vx) * wCoh; accY += (dy * k - vy) * wCoh; accZ += (dz * k - vz) * wCoh
      }
    }
    if (nSep > 0) {
      const m2 = sepX * sepX + sepY * sepY + sepZ * sepZ
      if (m2 > 1e-18) {
        const k = s.cruise / Math.sqrt(m2)
        accX += (sepX * k - vx) * wSep; accY += (sepY * k - vy) * wSep; accZ += (sepZ * k - vz) * wSep
      }
    }

    // ── Roost ────────────────────────────────────────────────────────────────
    // Nothing inside the free radius, ramping to full pull at the far one. A
    // constant pull collapses the flock onto the summit; a ramp makes it orbit,
    // which is the shape people mean by "murmuration".
    if (wRoost > 0) {
      const rx = field.roostX - x, ry = (s.roostY - y) * 0.5, rz = field.roostZ - z
      const d = Math.sqrt(rx * rx + rz * rz)
      const free = ROOST_FREE * s.span, full = ROOST_FULL * s.span
      const ramp = Math.min(1, Math.max(0, (d - free) / Math.max(1e-6, full - free)))
      const m2 = rx * rx + ry * ry + rz * rz
      if (m2 > 1e-18) {
        const k = s.cruise / Math.sqrt(m2)
        const w = wRoost * Math.max(ramp, 0.15)
        accX += (rx * k - vx) * w; accY += (ry * k - vy) * w; accZ += (rz * k - vz) * w
      }
    }

    // ── Terrain ──────────────────────────────────────────────────────────────
    const ground = field.heightAt(x, z)
    if (Number.isNaN(ground)) {
      // Off the data entirely (a lasso crop, a GeoTIFF hole). Head for the roost
      // rather than treating the void as ground at elevation zero.
      const rx = field.roostX - x, ry = s.roostY - y, rz = field.roostZ - z
      const m2 = rx * rx + ry * ry + rz * rz
      if (m2 > 1e-18) {
        const k = s.cruise / Math.sqrt(m2)
        accX += (rx * k - vx) * 2; accY += (ry * k - vy) * 2; accZ += (rz * k - vz) * 2
      }
    } else {
      const above = y - ground
      if (above < s.clearance) {
        // Ramps in over the clearance band and dominates everything else at the
        // bottom of it, so the flock drapes over a ridge instead of shearing
        // through it.
        accY += (1 - above / s.clearance) * s.maxForce * 6
      }
      if (wLift !== 0) {
        // Updraft on the steep ground, sink over the flats — the flock finds the
        // ridgelines on its own and traces them.
        const decay = 1 / (1 + Math.max(0, above) * s.liftDecay)
        accY += (field.slopeAt(x, z) - 0.5) * wLift * s.maxForce * 2 * decay
      }
    }

    // ── Flight envelope ──────────────────────────────────────────────────────
    // A slab of air around the roost height, pushed back into from both sides.
    // A bare ceiling is not enough: ridge lift has no reason to average to zero
    // over a given landscape, so a flock with only an upper bound drifts up to
    // it and stays there, far above the relief it is supposed to be reacting to.
    const dAlt = y - s.roostY
    if (dAlt >  s.band) accY -= (dAlt - s.band) * bandSoft * s.maxForce * 2
    if (dAlt < -s.band) accY += (-s.band - dAlt) * bandSoft * s.maxForce * 2

    // ── Soft XZ bounds ───────────────────────────────────────────────────────
    if (x >  boundX) accX -= (x - boundX) * boundSoft * s.maxForce * 2
    if (x < -boundX) accX += (-boundX - x) * boundSoft * s.maxForce * 2
    if (z >  boundZ) accZ -= (z - boundZ) * boundSoft * s.maxForce * 2
    if (z < -boundZ) accZ += (-boundZ - z) * boundSoft * s.maxForce * 2

    // ── Turbulence ───────────────────────────────────────────────────────────
    // Reuses the deterministic value noise the elevation jitter is built on, so
    // there is one noise function in the codebase rather than two, and a seeded
    // flock stays reproducible.
    if (wTurb > 0) {
      const t = flock.time * 3
      const cx = x * turbK, cz = z * turbK
      accX += jitterNoise(cx + t, cz) * wTurb * s.maxForce
      accY += jitterNoise(cx + 137, cz + t) * wTurb * s.maxForce * 0.5
      accZ += jitterNoise(cx - t, cz + 71) * wTurb * s.maxForce
    }

    // ── Predator ─────────────────────────────────────────────────────────────
    if (hunting) {
      const px = x - pred[0], py = y - pred[1], pz = z - pred[2]
      const d2 = px * px + py * py + pz * pz
      if (d2 < fear2) {
        // The flash expansion. Deliberately far stronger than any flocking term:
        // the wave that tears through a real murmuration is birds abandoning
        // every other rule at once.
        const d = Math.sqrt(d2) + 1e-6
        const w = (1 - d / s.fear) * s.maxForce * 12 / d
        accX += px * w; accY += py * w; accZ += pz * w
      }
    }

    // ── Integrate ────────────────────────────────────────────────────────────
    let nvx = vx + accX * dt, nvy = vy + accY * dt, nvz = vz + accZ * dt
    const sp = Math.sqrt(nvx * nvx + nvy * nvy + nvz * nvz)
    if (sp > 1e-9) {
      const k = Math.min(s.maxSpeed, Math.max(s.minSpeed, sp)) / sp
      nvx *= k; nvy *= k; nvz *= k
    } else {
      nvx = s.minSpeed
    }
    vel[j] = nvx; vel[j + 1] = nvy; vel[j + 2] = nvz

    let px2 = x + nvx * dt, py2 = y + nvy * dt, pz2 = z + nvz * dt

    // Hard floor. The avoidance force above is a steering term and can be
    // outrun on a cliff face; this is the guarantee that no bird is ever drawn
    // underground, which is the one artefact a viewer notices immediately.
    if (!Number.isNaN(ground)) {
      const floor = ground + s.clearance * 0.25
      if (py2 < floor) { py2 = floor; if (vel[j + 1] < 0) vel[j + 1] = 0 }
    }
    pos[j] = px2; pos[j + 1] = py2; pos[j + 2] = pz2
  }
}

/** Interleaved hash of an integer cell coordinate into the bucket table. */
function hash3(ix, iy, iz, mask) {
  return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask
}

/**
 * The predator runs the flock down. One agent, O(n) to evaluate against the
 * flock, and it is the mechanism behind every wave and hole in real footage —
 * without it a boids flock is a smooth blob that never surprises anyone.
 */
function stepPredator(flock, dt, field, s) {
  const { n, pos, pred } = flock
  let cx = 0, cy = 0, cz = 0
  for (let i = 0; i < n; i++) { const j = i * 3; cx += pos[j]; cy += pos[j + 1]; cz += pos[j + 2] }
  const inv = 1 / n
  cx *= inv; cy *= inv; cz *= inv

  // Aim past the centroid, not at it: a pursuer that converges exactly sits in
  // the middle of the flock and the wave never re-forms. The offset makes it
  // overshoot and come back round.
  const lead = 0.12 * s.span
  const t = flock.time * 0.35
  const tx = cx + Math.cos(t) * lead, tz = cz + Math.sin(t) * lead

  const speed = s.maxSpeed * 1.25
  const dx = tx - pred[0], dy = (cy - pred[1]) * 0.5, dz = tz - pred[2]
  const m = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (m > 1e-6) {
    const k = speed / m
    // First-order lag toward the desired velocity — a hard set makes the
    // predator teleport-turn and the flock's reaction reads as a glitch.
    const a = Math.min(1, dt * 2)
    pred[3] += (dx * k - pred[3]) * a
    pred[4] += (dy * k - pred[4]) * a
    pred[5] += (dz * k - pred[5]) * a
  }
  pred[0] += pred[3] * dt; pred[1] += pred[4] * dt; pred[2] += pred[5] * dt

  const ground = field.heightAt(pred[0], pred[2])
  if (!Number.isNaN(ground)) {
    const floor = ground + s.clearance
    if (pred[1] < floor) { pred[1] = floor; if (pred[4] < 0) pred[4] = 0 }
  }
}

/**
 * Drop each bird's shadow onto the terrain.
 *
 * Not a shadow map — this scene has no lights at all; the terrain's shading is
 * faked in the surface shader. So the shadow is placed the same way everything
 * else here is faked: analytically, by walking from the bird along the sun ray
 * until it meets the ground, and drawing a soft dark sprite there.
 *
 * The direction is the *hillshade* sun (`vec3(cos·cos, sin, sin·cos)`, the same
 * vector `SurfaceMesh` lights the terrain with), so the flock's shadows fall the
 * way the landscape's own shading says they should, and they swing when the
 * azimuth slider moves. Nothing new to configure, and nothing that can disagree.
 *
 * Finding the exact intersection would mean marching the ray; instead the drop
 * is solved once against the ground under the bird and then corrected once
 * against the ground under that first guess. Exact over flat ground, and within
 * a sprite's width of exact on anything a flock actually flies over — two
 * bilinear taps rather than a march of twenty.
 */
function writeShadows(flock, field, s, params) {
  const { n, pos, shadow, shadowLift } = flock
  const az  = ((params.sunAzimuth  ?? 315) * Math.PI) / 180
  // A sun on the horizon throws a shadow to infinity. Clamped, and the offset
  // is capped again below, so a low sun stretches the flock's shadow across the
  // valley instead of flinging it off the map.
  const alt = Math.max(5, Math.min(89, params.sunAltitude ?? 45)) * Math.PI / 180
  const run = Math.cos(alt) / Math.sin(alt)          // horizontal travel per unit of drop
  const ux  = -Math.cos(az) * run, uz = -Math.sin(az) * run
  const invBand = 1 / Math.max(1e-6, s.band * 2)

  for (let i = 0; i < n; i++) {
    const j = i * 3
    const x = pos[j], y = pos[j + 1], z = pos[j + 2]

    const g = field.heightAt(x, z)
    const h = Math.max(0, y - (Number.isNaN(g) ? field.peakY : g))

    // Two taps, not three: one for the drop under the bird, one for the ground
    // the shadow actually lands on. A third pass refining the *position* again
    // moved shadows by well under their own width and cost half the surcharge
    // this whole feature adds at 100 000 birds.
    let sx = x + ux * h, sz = z + uz * h
    // Cap the throw so a near-horizon sun cannot slide shadows off the terrain.
    const dx = sx - x, dz = sz - z
    const d2 = dx * dx + dz * dz
    if (d2 > s.shadowReach * s.shadowReach) {
      const k = s.shadowReach / Math.sqrt(d2)
      sx = x + dx * k; sz = z + dz * k
    }
    // Strict: no ground here, no shadow. `aLift < 0` is the renderer's and the
    // exporter's signal to skip this one entirely — a shadow floating off the
    // edge of the terrain, or lying across a hole cut out of it, breaks the
    // illusion faster than a missing shadow does.
    const g2 = field.groundAt(sx, sz)
    if (Number.isNaN(g2)) { shadowLift[i] = -1; continue }

    shadow[j]     = sx
    shadow[j + 1] = g2 + s.shadowLift
    shadow[j + 2] = sz
    shadowLift[i] = Math.min(1, h * invBand)
  }
}

/**
 * Rewrite the streak buffer: one segment per bird, from its nose back along its
 * own velocity. Two vertices each, laid out for a `LineSegments`.
 */
function writeTrails(flock, len) {
  const { n, pos, vel, seg } = flock
  // Trail 0 hides the LineSegments and makes getSegments() return null, so every
  // one of these would be a zero-length segment nobody draws — at 100 000 birds
  // that is a sqrt and six writes each, per substep, for nothing.
  if (!(len > 0)) return
  for (let i = 0; i < n; i++) {
    const j = i * 3, k = i * 6
    const vx = vel[j], vy = vel[j + 1], vz = vel[j + 2]
    // Math.sqrt of the dot product, not Math.hypot: hypot guards against
    // intermediate overflow that cannot arise here, and costs several times as
    // much. Across the whole step that guard was a quarter of the runtime.
    const m = Math.sqrt(vx * vx + vy * vy + vz * vz)
    const s = m > 1e-9 ? len / m : 0
    seg[k]     = pos[j];     seg[k + 1] = pos[j + 1]; seg[k + 2] = pos[j + 2]
    seg[k + 3] = pos[j] - vx * s
    seg[k + 4] = pos[j + 1] - vy * s
    seg[k + 5] = pos[j + 2] - vz * s
  }
}
