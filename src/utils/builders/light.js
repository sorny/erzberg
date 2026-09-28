/**
 * Light modes: Engraving, Isophotes, Sun Hours, Shadow Line, Shadow Hatch, Flashbulb, Halation.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { boxBlur, sampleBilinear } from '../terrain'
import { hexToRgb, computeVertexColor } from '../colorUtils'
import { latitudeFor, litField, samplingFor, smoothField, sunHourLevels, sunHoursField } from '../sunHours'
import { EMPTY_F32, F32List, F64List, I32List, MARCHING_TABLE, SMOOTH_SIMPLIFY_EPS, _edgeId, _edgeX, _edgeY, chaikinSmoothFlat, chainLevelSegments, edgeLerp01, getChainScratch, hatchWhere, inElevCut, joinLayers, lambertDarkness, lightVector, mulberry32, normElev, simplifyFlat, traceLevelSet } from './shared.js'

// ─── Engraving (illumination cross-hatch) ────────────────────────────────────

/**
 * Copperplate-style hatching: per-cell darkness = 1 − Lambert illumination from
 * a configurable sun. Up to 4 hatch layers at angles θ, θ+90°, θ+45°, θ+135°;
 * layer k only draws where darkness exceeds (k+1)/(levels+1), so lit slopes get
 * sparse single-direction strokes and shadows build up stacked cross-hatching.
 * Strokes are continuous polylines marched across the grid, draped on the
 * terrain, breaking wherever the surface is too bright.
 */
export function buildEngraving(terrain, p, spacing, angleDeg, levels, sunAzimuth, gamma) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const positions = new F32List(), colors = new F32List()
  // Solid raster ⇒ plain bilinear; see buildAngleLines.
  const sMask = terrain.hasNoData ? gridMask : null

  const darkness = lambertDarkness(terrain, sunAzimuth, gamma, elevScale)

  const nLevels = Math.max(1, Math.min(4, Math.round(levels ?? 3)))
  const HATCH_OFFSETS = [0, 90, 45, 135]
  const lineStep = Math.max(1, (spacing ?? 3) / scl)   // pitch between hatch lines, in cells
  const cc = (cols - 1) / 2, rc = (rows - 1) / 2       // grid centre
  // Half-diagonal: lines offset/marched this far in both directions cover the grid
  const halfDiag = Math.sqrt(cc * cc + rc * rc) + 1

  for (let lvl = 0; lvl < nLevels; lvl++) {
    const thresh = (lvl + 1) / (nLevels + 1)
    const theta = (((angleDeg ?? 45) + HATCH_OFFSETS[lvl]) * Math.PI) / 180
    const dx = Math.cos(theta), dz = Math.sin(theta)      // march direction (grid units)
    const nx = -dz, nz = dx                                // line-pitch normal

    for (let o = -halfDiag; o <= halfDiag; o += lineStep) {
      const ox = cc + nx * o, oz = rc + nz * o
      let prevC = 0, prevR = 0, prevE = 0, inRun = false
      for (let t = -halfDiag; t <= halfDiag; t += 1) {
        const fc = ox + dx * t, fr = oz + dz * t
        let ok = fc >= 0 && fc <= cols - 1 && fr >= 0 && fr <= rows - 1
        let elev = 0
        if (ok) {
          const ci = Math.round(fc), ri = Math.round(fr), idx = ri * cols + ci
          ok = gridMask[idx] === 1 && darkness[idx] >= thresh
          if (ok) {
            // Masked bilinear — a hatch stroke reaching a clipped edge must end
            // at the ground, not drop a wall to the base of the scene.
            const b = sampleBilinear(grid, sMask, rows, cols, fr, fc)
            elev = (b - 0.5) * 100 * elevScale
            ok = b === b && inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)
          }
        }
        if (ok && inRun) {
          positions.push6(prevC * scl - halfW, prevE, prevR * scl - halfH,
                          fc * scl - halfW, elev, fr * scl - halfH)
          const ci = Math.round(fc), ri = Math.round(fr), idx = ri * cols + ci
          const col = computeVertexColor(normElev(elev, minElev, maxElev),
                                         gridSlopes[idx] / (maxSlope || 1), theta, p)
          colors.pushRgb2(col)
        }
        inRun = ok
        prevC = fc; prevR = fr; prevE = elev
      }
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Isophotes (illumination contours) ───────────────────────────────────────

/**
 * Lines of constant illumination.
 *
 * A contour joins points of equal *height*; an isophote joins points of equal
 * *light*. They are the same construction over a different field, and they read
 * completely differently on the page: a contour describes the ground as a
 * surveyor does, in level steps, while an isophote wraps the terrain the way a
 * reflection wraps a polished object — bunching where the surface turns away
 * from the sun and opening out where it faces it. Neither Engraving nor Hachure
 * gets there: both hatch *by* the light, and this draws the light itself.
 *
 * Three differences from Contours, all of them consequences of the field:
 *
 * - **The lines are not level.** A contour sits at one elevation and can be
 *   emitted at a constant y. An isophote crosses elevations freely, so every
 *   crossing is draped onto the surface with a masked bilinear tap.
 * - **Levels are fractions of the light, not of the terrain.** Darkness runs
 *   [0,1], so the levels are evenly spaced strictly inside it — at 0 or 1 the
 *   whole field is on one side and nothing is drawn.
 * - **NoData is a hole, not a shoreline.** Contours deliberately treat a masked
 *   corner as lying below every level so isolines close along the edge of the
 *   data. That is right for a coastline and wrong here: there is no illumination
 *   where there is no ground, and an isophote drawn round the edge of a
 *   selection would be describing the selection rather than the terrain. Cells
 *   with any masked corner are skipped.
 *
 * Always chained. Marching squares emits in scan order, so consecutive segments
 * in the buffer are unrelated — chaining is what makes a stroke a stroke, and it
 * is also what lets the SVG exporter write each one as a single polyline.
 */
export function buildIsophotes(terrain, p, levels, sunAzimuth, gamma, smoothing, radius) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const sMask = terrain.hasNoData ? gridMask : null
  /*
   * Up to 25 passes, though the curve stops moving long before that. Chaikin
   * converges on a quadratic B-spline and each pass halves the distance to it,
   * so on the reference terrain the total drawn length falls 16.4% from 0 to 2
   * passes and then by less than half a percent all the way to 25, while the
   * cost keeps climbing linearly — 32 ms at 4, 343 ms at 25. The range is here
   * because it was asked for; `radiusIso` is the control that actually makes a
   * line broader, because it smooths the field rather than the trace.
   */
  const smooth = Math.max(0, Math.min(25, Math.round(smoothing ?? 0)))

  const darkness = lambertDarkness(terrain, sunAzimuth, gamma, elevScale, Math.max(0, radius ?? 6))
  const nLevels = Math.max(1, Math.min(24, Math.round(levels ?? 8)))

  const positions = new F32List(), colors = new F32List()
  const ex = _edgeX, ey = _edgeY, eid = _edgeId
  const scratch = getChainScratch(rows * cols * 2)

  for (let k = 0; k < nLevels; k++) {
    const level = (k + 1) / (nLevels + 1)
    const segE = new I32List(), segXY = new F64List()

    for (let r = 0; r < rows - 1; r++) {
      const row0 = r * cols, row1 = row0 + cols
      for (let c = 0; c < cols - 1; c++) {
        const d00 = darkness[row0 + c],     d10 = darkness[row0 + c + 1]
        const d01 = darkness[row1 + c],     d11 = darkness[row1 + c + 1]
        // Any corner without ground and the cell is not part of the field.
        if (d00 < 0 || d10 < 0 || d01 < 0 || d11 < 0) continue

        const idx = (d00 >= level ? 8 : 0) | (d10 >= level ? 4 : 0) |
                    (d11 >= level ? 2 : 0) | (d01 >= level ? 1 : 0)
        if (idx === 0 || idx === 15) continue

        ex[0] = c + edgeLerp01(d00, d10, level); ey[0] = r
        ex[1] = c + 1;                           ey[1] = r + edgeLerp01(d10, d11, level)
        ex[2] = c + edgeLerp01(d01, d11, level); ey[2] = r + 1
        ex[3] = c;                               ey[3] = r + edgeLerp01(d00, d01, level)

        const base = (row0 + c) * 2
        eid[0] = base                    // top    → H(r,   c)
        eid[1] = (row0 + c + 1) * 2 + 1  // right  → V(r,   c+1)
        eid[2] = (row1 + c) * 2          // bottom → H(r+1, c)
        eid[3] = base + 1                // left   → V(r,   c)

        const pairs = MARCHING_TABLE[idx]
        for (let pi = 0; pi < pairs.length; pi += 2) {
          const e0 = pairs[pi], e1 = pairs[pi + 1]
          segE.push2(eid[e0], eid[e1])
          segXY.push4(ex[e0], ey[e0], ex[e1], ey[e1])
        }
      }
    }

    if (segE.length === 0) continue
    const chains = chainLevelSegments(segE.a, segXY.a, segE.length / 2, scratch)

    for (const chain of chains) {
      const pts = smooth > 0
        ? simplifyFlat(
            chaikinSmoothFlat(chain.pts, chain.closed, smooth, SMOOTH_SIMPLIFY_EPS / smooth),
            SMOOTH_SIMPLIFY_EPS,
          )
        : chain.pts

      /*
       * Drape as we walk, carrying the previous point so a break in the surface
       * — NoData under the tap, or a vertex outside the elevation cut — ends the
       * stroke instead of drawing a chord across the hole.
       *
       * Every step is taken in unit cells even when the path skips further.
       * Smoothing ends in a Douglas–Peucker pass, which is free to replace a
       * curve with a chord up to nineteen cells long, and that chord is
       * *horizontally* faithful but says nothing about the ground under it: the
       * two ends drape onto the surface and the segment between them cuts
       * through whatever lies in the way. Contours can decimate safely because
       * they are level and a chord stays on the line; an isophote crosses the
       * relief, so it has to be re-walked at the resolution the terrain is
       * stored at. Measured on a clipped dome: max span 18.79 cells before,
       * 1.41 — one diagonal grid edge — after.
       */
      let prevC = 0, prevR = 0, prevE = 0, inRun = false
      let lastC = 0, lastR = 0
      const step = (fc, fr) => {
        const b = sampleBilinear(grid, sMask, rows, cols, fr, fc)
        const elev = (b - 0.5) * 100 * elevScale
        const ok = b === b && inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)
        if (ok && inRun) {
          positions.push6(prevC * scl - halfW, prevE, prevR * scl - halfH,
                          fc * scl - halfW, elev, fr * scl - halfH)
          const ci = Math.min(cols - 1, Math.max(0, Math.round(fc)))
          const ri = Math.min(rows - 1, Math.max(0, Math.round(fr)))
          const col = computeVertexColor(normElev(elev, minElev, maxElev),
                                         gridSlopes[ri * cols + ci] / (maxSlope || 1), 0, p)
          colors.pushRgb2(col)
        }
        inRun = ok
        prevC = fc; prevR = fr; prevE = elev
      }

      for (let i = 0; i < pts.length; i += 2) {
        const fc = pts[i], fr = pts[i + 1]
        if (i === 0) { step(fc, fr) }
        else {
          const n = Math.max(1, Math.ceil(Math.hypot(fc - lastC, fr - lastR)))
          for (let k = 1; k <= n; k++) step(lastC + (fc - lastC) * k / n,
                                            lastR + (fr - lastR) * k / n)
        }
        lastC = fc; lastR = fr
      }
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
}

export function buildSunHours(terrain, p, o) {
  const { gridMask, rows, cols } = terrain
  const { elevScale } = p
  const sMask = terrain.hasNoData ? gridMask : null
  const smooth = Math.max(0, Math.min(25, Math.round(o.smoothing ?? 1)))

  const { lat } = latitudeFor(p)
  const sampling = samplingFor(o.period, o.days, o.date)
  const field = sunHoursField(terrain, {
    elevScale, lat, perDay: Math.max(2, Math.min(96, Math.round(o.perDay ?? 12))), ...sampling,
  })

  // A blur on the *field*, not on the trace — and one that puts the no-ground
  // sentinel back afterwards. See `smoothField`.
  const hours = smoothField(field.hours, cols, rows, o.radius ?? 0, sMask)

  const levels = sunHourLevels(field.min, field.max, o.levels)
  return traceLevelSet(terrain, p, hours, levels, smooth)
}

// ─── Shadow line ─────────────────────────────────────────────────────────────

/**
 * The edge of the shadow, at one instant, as a line.
 *
 * Sun Hours (above) sums the lit moments over a year and contours the total.
 * This asks the same question once and traces the single boundary: where the
 * sunlight stops. It is the terminator the terrain casts on itself, and with a
 * date and a clock on it, it is a shadow that was really there.
 *
 * The whole mode is `litField` plus the tracer the other two level-set modes
 * already share. That is not a coincidence — it is why this was worth building
 * the week the sweep arrived. Before the sweep existed it would have needed a
 * ray march per cell; after it, the single term was already inside the sum.
 *
 * **One level, not a set.** Lit is 1 and unlit is 0, so a half is the only
 * meaningful contour and there is nothing for a levels control to do. The line
 * is the answer; its *position* is what the date and the clock move.
 *
 * A sun below the horizon draws nothing, which is the honest picture of night.
 * The panel says so rather than leaving an empty plate unexplained.
 */
export function buildShadowLine(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const sMask = terrain.hasNoData ? gridMask : null
  const smooth = Math.max(0, Math.min(25, Math.round(o.smoothing ?? 2)))

  if (!(o.altitude > 0)) return { positions: new Float32Array(0), colors: new Float32Array(0) }

  // Blurred, then the sentinel put back — `smoothField` owns that rule. A shadow
  // edge is hard by nature, so without this the line follows every notch in the
  // skyline and reads as noise rather than as a boundary.
  const lit = smoothField(
    litField(terrain, { elevScale, azimuth: o.azimuth, altitude: o.altitude }),
    cols, rows, o.radius ?? 0, sMask)

  const LEVEL = 0.5
  const positions = new F32List(), colors = new F32List()
  const ex = _edgeX, ey = _edgeY, eid = _edgeId
  const scratch = getChainScratch(rows * cols * 2)
  const segE = new I32List(), segXY = new F64List()

  for (let r = 0; r < rows - 1; r++) {
    const row0 = r * cols, row1 = row0 + cols
    for (let c = 0; c < cols - 1; c++) {
      const d00 = lit[row0 + c],     d10 = lit[row0 + c + 1]
      const d01 = lit[row1 + c],     d11 = lit[row1 + c + 1]
      if (d00 < 0 || d10 < 0 || d01 < 0 || d11 < 0) continue

      const idx = (d00 >= LEVEL ? 8 : 0) | (d10 >= LEVEL ? 4 : 0) |
                  (d11 >= LEVEL ? 2 : 0) | (d01 >= LEVEL ? 1 : 0)
      if (idx === 0 || idx === 15) continue

      ex[0] = c + edgeLerp01(d00, d10, LEVEL); ey[0] = r
      ex[1] = c + 1;                           ey[1] = r + edgeLerp01(d10, d11, LEVEL)
      ex[2] = c + edgeLerp01(d01, d11, LEVEL); ey[2] = r + 1
      ex[3] = c;                               ey[3] = r + edgeLerp01(d00, d01, LEVEL)

      const base = (row0 + c) * 2
      eid[0] = base
      eid[1] = (row0 + c + 1) * 2 + 1
      eid[2] = (row1 + c) * 2
      eid[3] = base + 1

      const pairs = MARCHING_TABLE[idx]
      for (let pi = 0; pi < pairs.length; pi += 2) {
        const e0 = pairs[pi], e1 = pairs[pi + 1]
        segE.push2(eid[e0], eid[e1])
        segXY.push4(ex[e0], ey[e0], ex[e1], ey[e1])
      }
    }
  }
  if (segE.length === 0) return { positions: positions.toArray(), colors: colors.toArray() }

  for (const chain of chainLevelSegments(segE.a, segXY.a, segE.length / 2, scratch)) {
    const pts = smooth > 0
      ? simplifyFlat(
          chaikinSmoothFlat(chain.pts, chain.closed, smooth, SMOOTH_SIMPLIFY_EPS / smooth),
          SMOOTH_SIMPLIFY_EPS,
        )
      : chain.pts

    // Draped a cell at a time, for the reason the isophotes set out at length: a
    // terminator crosses elevations freely, so a decimated chord is horizontally
    // faithful and says nothing about the ground under it.
    let prevC = 0, prevR = 0, prevE = 0, inRun = false
    let lastC = 0, lastR = 0
    const step = (fc, fr) => {
      const b = sampleBilinear(grid, sMask, rows, cols, fr, fc)
      const elev = (b - 0.5) * 100 * elevScale
      const ok = b === b && inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)
      if (ok && inRun) {
        positions.push6(prevC * scl - halfW, prevE, prevR * scl - halfH,
                        fc * scl - halfW, elev, fr * scl - halfH)
        const ci = Math.min(cols - 1, Math.max(0, Math.round(fc)))
        const ri = Math.min(rows - 1, Math.max(0, Math.round(fr)))
        colors.pushRgb2(computeVertexColor(normElev(elev, minElev, maxElev),
                                           gridSlopes[ri * cols + ci] / (maxSlope || 1), 0, p))
      }
      inRun = ok
      prevC = fc; prevR = fr; prevE = elev
    }

    for (let i = 0; i < pts.length; i += 2) {
      const fc = pts[i], fr = pts[i + 1]
      if (i === 0) { step(fc, fr) }
      else {
        const n = Math.max(1, Math.ceil(Math.hypot(fc - lastC, fr - lastR)))
        for (let k = 1; k <= n; k++) step(lastC + (fc - lastC) * k / n,
                                          lastR + (fr - lastR) * k / n)
      }
      lastC = fc; lastR = fr
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Shadow hatch ────────────────────────────────────────────────────────────

/**
 * Cross-hatching only where the sun cannot reach.
 *
 * The mask is `litField` — the same sweep Shadow Line contours — so it holds
 * cast shadow as well as ground that faces away: a valley floor under a ridge
 * is hatched even though it faces the sun. Engraving hatches by Lambert
 * darkness instead, which knows nothing about what stands between the ground
 * and the light.
 *
 * Parallel strokes are marched across the whole raster and drawn only through
 * shadowed cells, so each stroke starts and stops at the shadow's edge and the
 * boundary appears on its own. `outline` also traces that boundary as a line,
 * which closes the shape the way an engraver would.
 */
export function buildShadowHatch(terrain, p, o) {
  const { gridMask, rows, cols, scl } = terrain
  const { elevScale } = p
  const sMask = terrain.hasNoData ? gridMask : null
  if (!(o.altitude > 0)) return { positions: new Float32Array(0), colors: new Float32Array(0) }

  const lit = smoothField(
    litField(terrain, { elevScale, azimuth: o.azimuth, altitude: o.altitude }),
    cols, rows, o.radius ?? 0, sMask)
  const angles = o.cross ? [o.angle ?? 45, (o.angle ?? 45) + 90] : [o.angle ?? 45]
  const hatch = hatchWhere(terrain, p, (idx) => lit[idx] >= 0 && lit[idx] < 0.5,
    angles, Math.max(0.5, (o.spacing ?? 3) / scl))
  if (!o.outline) return hatch
  return joinLayers(hatch,
    buildShadowLine(terrain, p, { azimuth: o.azimuth, altitude: o.altitude, smoothing: 2, radius: o.radius ?? 0 }))
}

// ─── Flashbulb (point light, cast shadow, blue-noise grain) ──────────────────

/**
 * A 64×64 void-and-cluster blue-noise tile, values in (0,1), built lazily once.
 *
 * Ordered dither lays down a visible screen — which is the whole point at
 * Bitplane and the one thing that would kill a photograph. Blue noise carries a
 * tone without printing a pattern: its energy sits at high spatial frequencies,
 * so the eye reads it as grain rather than as a grid.
 *
 * Void-and-cluster (Ulichney 1993) is the standard construction and it is worth
 * the ~60 ms it costs, once, the first time the mode is switched on. A plain
 * `Math.random()` threshold is the cheap substitute and it reads as sand: white
 * noise clumps *and* leaves holes at every scale, so a smooth mid-tone comes out
 * blotchy. The pattern is toroidal — every neighbourhood lookup wraps — which is
 * what lets it tile across the grid without a seam.
 *
 * Held at module scope beside `_chainScratch` and for the same reason: it depends
 * on nothing, and rebuilding it per rebuild would dominate the mode.
 */
let _blueNoise = null
export function blueNoiseTile() {
  if (_blueNoise) return _blueNoise
  const S = 64, n = S * S
  const energy = new Float32Array(n)
  const bin = new Uint8Array(n)

  // Wrapped Gaussian, σ = 1.5 — Ulichney's value. Radius 6 is where the weight
  // has fallen below 1/2000 and the tail stops being worth 169 more multiplies.
  const SIG = 1.5, RAD = 6
  const kdx = [], kdy = [], kw = []
  for (let dy = -RAD; dy <= RAD; dy++) {
    for (let dx = -RAD; dx <= RAD; dx++) {
      kdx.push(dx); kdy.push(dy)
      kw.push(Math.exp(-(dx * dx + dy * dy) / (2 * SIG * SIG)))
    }
  }
  const splat = (i, sign) => {
    const y = (i / S) | 0, x = i % S
    for (let k = 0; k < kw.length; k++) {
      const yy = (y + kdy[k] + S) % S, xx = (x + kdx[k] + S) % S
      energy[yy * S + xx] += sign * kw[k]
    }
  }
  const tightestCluster = () => {
    let bi = -1, bv = -Infinity
    for (let i = 0; i < n; i++) if (bin[i] && energy[i] > bv) { bv = energy[i]; bi = i }
    return bi
  }
  const largestVoid = () => {
    let bi = -1, bv = Infinity
    for (let i = 0; i < n; i++) if (!bin[i] && energy[i] < bv) { bv = energy[i]; bi = i }
    return bi
  }

  // Seed with a tenth of the cells, then relax: repeatedly move the point from
  // the tightest cluster into the largest void until doing so is a no-op. That
  // fixed point is the "initial binary pattern" the ranking phases start from.
  const rng = mulberry32(0x5eed)
  const order = new Int32Array(n)
  for (let i = 0; i < n; i++) order[i] = i
  const seeded = Math.max(1, Math.round(n / 10))
  for (let k = 0; k < seeded; k++) {
    const j = k + Math.floor(rng() * (n - k))
    const t = order[k]; order[k] = order[j]; order[j] = t
    bin[order[k]] = 1; splat(order[k], 1)
  }
  for (let guard = 0; guard < n * 4; guard++) {
    const c = tightestCluster()
    bin[c] = 0; splat(c, -1)
    const v = largestVoid()
    if (v === c) { bin[c] = 1; splat(c, 1); break }
    bin[v] = 1; splat(v, 1)
  }

  const rank = new Int32Array(n).fill(-1)
  const binKeep = bin.slice(), energyKeep = energy.slice()

  // Phase 1 — strip the relaxed pattern back to nothing, ranking downward. The
  // last point standing is the one the sparsest tone keeps.
  for (let r = seeded - 1; r >= 0; r--) {
    const c = tightestCluster()
    bin[c] = 0; splat(c, -1); rank[c] = r
  }
  // Phase 2 — refill from the relaxed pattern, ranking upward.
  bin.set(binKeep); energy.set(energyKeep)
  for (let r = seeded; r < n; r++) {
    const v = largestVoid()
    if (v < 0) break
    bin[v] = 1; splat(v, 1); rank[v] = r
  }

  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = (rank[i] + 0.5) / n
  _blueNoise = { S, tile: out }
  return _blueNoise
}

/**
 * Where the bulb is, in world coordinates.
 *
 * Exposed as azimuth / distance / height rather than as a raw XYZ triple: three
 * unlabelled world coordinates are not a thing anyone can aim, and azimuth is
 * already the vocabulary the Hillshade section teaches. Distance and height are
 * *fractions* — of the terrain's half-diagonal and of its elevation range — so a
 * setting that frames a 40 m quarry also frames a 3 000 m mountain, which a
 * world-unit control could not do.
 */
function flashLightPos(terrain, azimuthDeg, distFrac, heightFrac) {
  const { spanHalfW, spanHalfH, minElev, maxElev } = terrain
  const reach = Math.hypot(spanHalfW, spanHalfH) || 1
  // A true bearing, like every other light here. The altitude is not free for a
  // bulb — its height is a fraction of the terrain's own relief — so only the
  // ground plane comes from `lightVector`.
  const [ux, , uz] = lightVector(azimuthDeg ?? 45, 0)
  const d = reach * (distFrac ?? 0.9)
  return [
    ux * d,
    minElev + (maxElev - minElev) * (heightFrac ?? 1.2),
    uz * d,
  ]
}

/**
 * Silver on paper, under one bare bulb.
 *
 * Every lit mode in the tool — Engraving, Isophotes, the hillshade shader —
 * shares one convention: azimuth around, altitude pinned at 45°, *parallel* rays.
 * Parallel rays have no falloff, and falloff is the entire subject here. The
 * light goes inside the scene instead:
 *
 *     E = max(0, n̂·d̂) / (1 + (r/r₀)²)
 *
 * The `1 +` keeps the light finite as the bulb approaches the ground; r₀ decides
 * which band of terrain survives at all, and everything after it is a tone curve.
 *
 * **Referenced to a percentile, not to the brightest cell.** One sample a few
 * units from the bulb otherwise sets the scale for the whole plate and everything
 * else crushes to solid — measured, that put 84% of the terrain at full ink. The
 * reference is the 68th percentile of the exposure over the sampled cells, taken
 * from a histogram rather than a sort so it costs one pass.
 *
 * **Shadows are marched, not inferred.** This is the CPU twin of
 * `hillshadeCastShadows` in the surface shader, and takes the same step count so
 * the two agree when both are on. It is also the expensive part, so it is skipped
 * wherever it cannot change the answer: a cell facing away from the bulb is
 * already dark, and a cell whose unshadowed tone is already solid cannot get
 * darker.
 *
 * **The grain cannot vary its dot size.** `weight` is resolved per layer by
 * `layerStyle`, so every dot in the layer is the same radius — the variation has
 * to come from density and from position jitter alone. That is a real constraint
 * of the line contract rather than a choice, and it is why the jitter is worth
 * having rather than being a nicety.
 */
/**
 * The exposure field, sampled on the emission lattice.
 *
 * Shared by Flashbulb and Halation, which want the same optics and differ only
 * in what they do with the answer. It is computed at the *dot pitch* rather than
 * per cell for two reasons: nothing below that pitch is ever drawn, and the
 * shadow march downstream is the mode's whole cost, so sampling it at full
 * resolution would be paying four times over for a field nothing reads.
 *
 * `ref` is the 68th percentile, from a histogram rather than a sort. Referencing
 * to the *brightest* cell instead lets one sample a few units from the bulb set
 * the scale for the whole plate — measured, that put 84% of the terrain at full
 * ink. -1 marks a cell with no data.
 */
function flashExposure(terrain, p, opt) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH } = terrain
  const { elevScale } = p
  const step  = Math.max(1, Math.round((opt.spacing ?? 1.5) / scl))
  const reach = Math.hypot(terrain.spanHalfW, terrain.spanHalfH) || 1
  const r0    = Math.max(1e-3, reach * (opt.falloff ?? 1))
  const light = flashLightPos(terrain, opt.azimuth, opt.distance, opt.height)
  const [lx, ly, lz] = light
  const dScale = (100 * elevScale) / (2 * scl)   // brightness diff → world slope

  const nR = Math.ceil(rows / step), nC = Math.ceil(cols / step)
  const expos = new Float32Array(nR * nC)
  const BINS = 512, hist = new Uint32Array(BINS)
  let maxE = 0, nValid = 0

  for (let ri = 0, r = 0; r < rows; r += step, ri++) {
    for (let ci = 0, c = 0; c < cols; c += step, ci++) {
      const i = r * cols + c
      if (!gridMask[i]) { expos[ri * nC + ci] = -1; continue }
      const b = grid[i]
      const elev = (b - 0.5) * 100 * elevScale
      const bL = (c > 0        && gridMask[i - 1])    ? grid[i - 1]    : b
      const bR = (c < cols - 1 && gridMask[i + 1])    ? grid[i + 1]    : b
      const bU = (r > 0        && gridMask[i - cols]) ? grid[i - cols] : b
      const bD = (r < rows - 1 && gridMask[i + cols]) ? grid[i + cols] : b
      const gx = (bR - bL) * dScale, gz = (bD - bU) * dScale
      const nl = Math.sqrt(gx * gx + gz * gz + 1)

      const dx = lx - (c * scl - halfW), dy = ly - elev, dz = lz - (r * scl - halfH)
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6
      const lam = Math.max(0, (-gx * dx + dy - gz * dz) / (dist * nl))
      const rr = dist / r0
      const e = lam / (1 + rr * rr)
      expos[ri * nC + ci] = e
      if (e > maxE) maxE = e
      nValid++
    }
  }
  if (!nValid) return null

  for (let k = 0; k < expos.length; k++) {
    const e = expos[k]
    if (e < 0) continue
    hist[Math.min(BINS - 1, (e / (maxE || 1)) * (BINS - 1) | 0)]++
  }
  const target = nValid * 0.68
  let acc = 0, refBin = BINS - 1
  for (let k = 0; k < BINS; k++) { acc += hist[k]; if (acc >= target) { refBin = k; break } }

  return { expos, nR, nC, step, light,
           ref: Math.max(1e-6, ((refBin + 0.5) / BINS) * (maxE || 1)) }
}

/**
 * Is the bulb hidden from this cell?
 *
 * The CPU twin of `hillshadeCastShadows` in the surface shader, taking the same
 * step count so the two agree when both are on. The march runs in *grid*
 * coordinates, so the inner loop is a bilinear tap and a compare rather than a
 * world-space transform per step.
 *
 * Callers skip it wherever it cannot change the answer — a cell facing away from
 * the bulb is already dark, and a cell already at full ink cannot get darker.
 * That guard is what makes the mode's cost bearable at fine pitches.
 */
function flashShadowed(terrain, p, r, c, elev, light, K, eps) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const [lx, ly, lz] = light
  const gcL = (lx + halfW) / scl, grL = (lz + halfH) / scl
  for (let k = 1; k <= K; k++) {
    const t = k / K
    const qc = c + (gcL - c) * t, qr = r + (grL - r) * t
    if (qc < 0 || qc > cols - 1 || qr < 0 || qr > rows - 1) return false
    const b = sampleBilinear(grid, sMask, rows, cols, qr, qc)
    if (b !== b) return false
    if ((b - 0.5) * 100 * p.elevScale > elev + (ly - elev) * t + eps) return true
  }
  return false
}

/** Does the exposure lattice actually exclude anything? Same guard as
 *  `maskHasHoles`, over the sample grid rather than the raster — the masked blur
 *  path costs two extra passes and buys nothing on a solid plate. */
function maskHasHolesU8(m) {
  for (let i = 0; i < m.length; i++) if (!m[i]) return true
  return false
}

/** Exposure → ink, through the hard S-curve that makes the mode clip. */
function flashTone(e, ref, opt) {
  const gamma = Math.max(0.05, opt.gamma ?? 1)
  const expo  = Math.max(0.01, opt.exposure ?? 1.15)
  let d = 1 - Math.min(1, Math.pow(Math.min(1, e / ref) * expo, gamma))
  return d
}
function flashCurve(d, opt) {
  const contrast = Math.max(0, opt.contrast ?? 1.35)
  let v = Math.max(0, Math.min(1, (d - 0.5) * contrast + 0.5))
  if (opt.fold) v = Math.abs(2 * v - 1)
  return v
}

/**
 * Silver on paper, under one bare bulb.
 *
 * Every lit mode in the tool — Engraving, Isophotes, the hillshade shader —
 * shares one convention: azimuth around, altitude pinned at 45°, *parallel* rays.
 * Parallel rays have no falloff, and falloff is the entire subject here. The
 * light goes inside the scene instead:
 *
 *     E = max(0, n̂·d̂) / (1 + (r/r₀)²)
 *
 * The `1 +` keeps the light finite as the bulb approaches the ground; r₀ decides
 * which band of terrain survives at all, and everything after it is a tone curve.
 *
 * **The grain cannot vary its dot size.** `weight` is resolved per layer by
 * `layerStyle`, so every dot in the layer is the same radius — the variation has
 * to come from density and from position jitter alone. That is a real constraint
 * of the line contract rather than a choice, and it is why the jitter is worth
 * having rather than being a nicety.
 */
export function buildFlashbulb(terrain, p, opt) {
  const { grid, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p

  const field = flashExposure(terrain, p, opt)
  if (!field) return { positions: EMPTY_F32, colors: EMPTY_F32, isPoints: true }
  const { expos, nC, step, ref, light } = field

  const grain = Math.max(0, Math.min(1, opt.grain ?? 1))
  const K = Math.max(0, Math.round(opt.shadowSteps ?? 24))
  const doShadow = !!opt.shadow && K > 0
  const { S, tile } = blueNoiseTile()

  const positions = new F32List(), colors = new F32List()
  const eps = Math.max(0.001, scl * 0.003)
  const rng = mulberry32(((opt.seed ?? 42) * 2654435761) >>> 0)

  for (let ri = 0, r = 0; r < rows; r += step, ri++) {
    for (let ci = 0, c = 0; c < cols; c += step, ci++) {
      const e = expos[ri * nC + ci]
      if (e < 0) continue
      const i = r * cols + c
      const elev = (grid[i] - 0.5) * 100 * elevScale
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue

      let dark = flashTone(e, ref, opt)
      if (doShadow && e > 0 && dark < 1 &&
          flashShadowed(terrain, p, r, c, elev, light, K, eps)) dark = 1
      dark = flashCurve(dark, opt) * grain
      if (dark <= 0) continue

      // The tile is walked per *sample*, not per cell — indexing it by grid
      // position while sampling at a coarser pitch would decimate the pattern
      // and take the blue out of it.
      if (dark <= tile[(ri % S) * S + (ci % S)]) continue

      const jr = (rng() - 0.5) * step, jc = (rng() - 0.5) * step
      const wx = (c + jc) * scl - halfW, wz = (r + jr) * scl - halfH
      positions.push6(wx - eps, elev, wz, wx + eps, elev, wz)
      colors.pushRgb2(computeVertexColor(normElev(elev, minElev, maxElev),
                                         gridSlopes[i] / (maxSlope || 1), 0, p))
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray(), isPoints: true }
}

/**
 * Blown highlights bleeding into the shadow beside them.
 *
 * Halation in a real emulsion is light that got *through* the silver, bounced off
 * the film base and came back — so the thing that scatters is the light the
 * highlight could not hold, and the field to spread is the **overexposure**:
 *
 *     over  = max(0, E/ref · exposure − 1)     the part above full white
 *     bloom = boxBlur(over, radius)            normalised convolution, mask-aware
 *
 * Blurring the exposure *gradient* instead is the obvious first idea and it is
 * wrong in a way that only shows on real terrain: every ridge and gully is an
 * edge, so a busy massif blooms uniformly and the halo covers the picture
 * rather than pooling beside the bright parts of it. Only genuinely blown
 * highlights scatter, and `over` is exactly them.
 *
 * `boxBlur` is the same O(W·H) pass the Blur slider runs, taken over the
 * exposure lattice rather than the raster. It is given the validity mask, so a
 * clipped edge does not average real exposure against the zeros in NoData and
 * ring the selection with a halo of its own — the same argument
 * `boxBlurMasked` already makes for the terrain.
 *
 * Two populations come out, and they ship as two sub-layers because they are two
 * inks on a printed plate:
 *
 * - **Grain** is Flashbulb's, with the bloom *subtracted* from the darkness, so
 *   the highlight eats into the shadow next to it. That subtraction is the
 *   halation; without it the glow would sit on top of the picture instead of
 *   consuming it.
 * - **Bloom** is the halo itself, drawn only where the bloom is strong *and* the
 *   ground is dark — a glow over an already-blown highlight is invisible, and
 *   drawing it there just wastes ink.
 *
 * The two populations read the blue-noise tile at a half-tile offset from one
 * another. Sharing an index would correlate them exactly: every halo dot would
 * land on a cell the grain had already claimed, and the halo would disappear
 * into it rather than reading as a second pass.
 */
export function buildHalation(terrain, p, opt) {
  const { grid, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p

  const field = flashExposure(terrain, p, opt)
  if (!field) return null
  const { expos, nR, nC, step, ref, light } = field

  // The overexposure — the light the highlight could not hold — on the sample
  // lattice. Zero everywhere the plate is merely lit; positive only where it is
  // blown.
  const over = new Float32Array(nR * nC)
  const emask = new Uint8Array(nR * nC)
  const expoGain = Math.max(0.01, opt.exposure ?? 1.15)
  for (let k = 0; k < over.length; k++) {
    const e = expos[k]
    if (e < 0) continue
    emask[k] = 1
    over[k] = Math.max(0, (e / ref) * expoGain - 1)
  }
  const rad = Math.max(1, Math.round((opt.bloom ?? 6) / (scl * step)))
  const holes = maskHasHolesU8(emask)
  const bloom = boxBlur(over, nC, nR, rad, holes ? emask : null)
  let bMax = 0
  for (let k = 0; k < bloom.length; k++) if (emask[k] && bloom[k] > bMax) bMax = bloom[k]
  const bInv = 1 / (bMax || 1)

  const bleed = Math.max(0, Math.min(2, opt.bleed ?? 1))
  const glow  = Math.max(0, Math.min(2, opt.glow ?? 0.8))
  const grain = Math.max(0, Math.min(1, opt.grain ?? 1))
  const K = Math.max(0, Math.round(opt.shadowSteps ?? 24))
  const doShadow = !!opt.shadow && K > 0
  const { S, tile } = blueNoiseTile()
  const HALF = S >> 1

  const gP = new F32List(), gC = new F32List()
  const bP = new F32List(), bC = new F32List()
  const glowRgb = hexToRgb(opt.glowColor || '#c8481e')
  const eps = Math.max(0.001, scl * 0.003)
  const rng = mulberry32(((opt.seed ?? 42) * 2654435761) >>> 0)

  for (let ri = 0, r = 0; r < rows; r += step, ri++) {
    for (let ci = 0, c = 0; c < cols; c += step, ci++) {
      const k = ri * nC + ci
      const e = expos[k]
      if (e < 0) continue
      const i = r * cols + c
      const elev = (grid[i] - 0.5) * 100 * elevScale
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue

      let dark = flashTone(e, ref, opt)
      if (doShadow && e > 0 && dark < 1 &&
          flashShadowed(terrain, p, r, c, elev, light, K, eps)) dark = 1
      dark = flashCurve(dark, opt)

      const b = Math.min(1, bloom[k] * bInv)
      const inked = Math.max(0, Math.min(1, dark - b * bleed)) * grain
      const halo  = Math.max(0, Math.min(1, b * glow * dark))

      const jr = (rng() - 0.5) * step, jc = (rng() - 0.5) * step
      const wx = (c + jc) * scl - halfW, wz = (r + jr) * scl - halfH

      if (inked > tile[(ri % S) * S + (ci % S)]) {
        gP.push6(wx - eps, elev, wz, wx + eps, elev, wz)
        gC.pushRgb2(computeVertexColor(normElev(elev, minElev, maxElev),
                                       gridSlopes[i] / (maxSlope || 1), 0, p))
      }
      if (halo > tile[((ri + HALF) % S) * S + ((ci + HALF) % S)]) {
        bP.push6(wx - eps, elev, wz, wx + eps, elev, wz)
        bC.pushRgb2(glowRgb)
      }
    }
  }

  return {
    'Halation-Grain': { positions: gP.toArray(), colors: gC.toArray(), isPoints: true },
    'Halation-Bloom': { positions: bP.toArray(), colors: bC.toArray(), isPoints: true },
  }
}
