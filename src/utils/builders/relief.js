/**
 * Relief modes: Section and Bitplane.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { cellElev, sampleBilinear } from '../terrain'
import { computeVertexColor } from '../colorUtils'
import { BAYER4, F32List, inElevCut, normElev } from './shared.js'

// ─── Section ─────────────────────────────────────────────────────────────────

/**
 * A cutting plane, drawn the way a drawing draws one.
 *
 * The tool already *culls* by elevation — `elevMinCut`/`elevMaxCut` are the
 * terrain-level version of this idea. This is the same cut rendered as a
 * section: the cut **face** as a heavy line at the plane, the solid **below** it
 * hatched at 45° in the drafting convention, and the ground **beyond** it drawn
 * in outline so the section reads as sitting in a landscape rather than floating.
 *
 * The hatch is a set of parallel rays marched across the grid at 45°, broken
 * wherever the surface rises above the plane — the same run-based marcher
 * `buildEngraving` uses, thresholded on height instead of on light.
 */
export function buildSection(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const sMask = terrain.hasNoData ? gridMask : null
  const cutN = Math.max(0, Math.min(1, o.cut ?? 0.45))
  const cutE = minElev + (maxElev - minElev) * cutN
  const cutB = 0.5 + cutE / (100 * (elevScale || 1))    // the level, in brightness

  const hP = new F32List(), hC = new F32List()
  const fP = new F32List(), fC = new F32List()
  const bP = new F32List(), bC = new F32List()

  // ── the hatch: 45° rays clipped to the material below the plane ──
  const pitch = Math.max(1, (o.hatch ?? 4) / scl)
  const cc = (cols - 1) / 2, rc = (rows - 1) / 2
  const halfDiag = Math.sqrt(cc * cc + rc * rc) + 1
  const theta = ((o.hatchAngle ?? 45) * Math.PI) / 180
  const dx = Math.cos(theta), dz = Math.sin(theta)
  const nx = -dz, nz = dx
  const hatchCol = computeVertexColor(cutN, 0, theta, p)
  for (let off = -halfDiag; off <= halfDiag; off += pitch) {
    const ox = cc + nx * off, oz = rc + nz * off
    let pc = 0, pr = 0, run = false
    for (let t = -halfDiag; t <= halfDiag; t += 1) {
      const fc = ox + dx * t, fr = oz + dz * t
      let inside = fc >= 0 && fc <= cols - 1 && fr >= 0 && fr <= rows - 1
      if (inside) {
        const ri = Math.round(fr), ci = Math.round(fc)
        const b = sampleBilinear(grid, sMask, rows, cols, fr, fc)
        inside = gridMask[ri * cols + ci] === 1 && b === b && b < cutB
      }
      if (inside && run) {
        hP.push6(pc * scl - halfW, cutE, pr * scl - halfH, fc * scl - halfW, cutE, fr * scl - halfH)
        hC.pushRgb2(hatchCol)
      }
      run = inside; pc = fc; pr = fr
    }
  }

  // ── the cut face: marching squares at the plane, as a heavy outline ──
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c
      if (!gridMask[i] || !gridMask[i + 1] || !gridMask[i + cols]) continue
      const a = grid[i], bR = grid[i + 1], bD = grid[i + cols]
      if ((a > cutB) !== (bR > cutB)) {
        const t = (cutB - a) / (bR - a)
        fP.push6((c + t) * scl - halfW, cutE, (r - 0.5) * scl - halfH,
                 (c + t) * scl - halfW, cutE, (r + 0.5) * scl - halfH)
        fC.pushRgb2(hatchCol)
      }
      if ((a > cutB) !== (bD > cutB)) {
        const t = (cutB - a) / (bD - a)
        fP.push6((c - 0.5) * scl - halfW, cutE, (r + t) * scl - halfH,
                 (c + 0.5) * scl - halfW, cutE, (r + t) * scl - halfH)
        fC.pushRgb2(hatchCol)
      }
    }
  }

  // ── beyond the plane: the landscape the section stands in, in outline ──
  const bStep = Math.max(1, Math.round((o.beyond ?? 8) / scl))
  for (let r = 0; r < rows; r += bStep) {
    let run = null
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const on = gridMask[i] === 1 && grid[i] >= cutB
      if (on) {
        const e = cellElev(grid, r, c, cols, elevScale, p.jitterAmt)
        if (!inElevCut(e, minElev, maxElev, elevMinCut, elevMaxCut)) { run = null; continue }
        const x = c * scl - halfW, z = r * scl - halfH
        if (run) {
          bP.push6(run[0], run[1], run[2], x, e, z)
          bC.pushRgb2(computeVertexColor(normElev(e, minElev, maxElev), 0, 0, p))
        }
        run = [x, e, z]
      } else run = null
    }
  }

  return {
    'Section-Hatch':  { positions: hP.toArray(), colors: hC.toArray() },
    'Section-Face':   { positions: fP.toArray(), colors: fC.toArray() },
    'Section-Beyond': { positions: bP.toArray(), colors: bC.toArray() },
  }
}

/**
 * The terrain as a tilemap: flat plateaus, hard lattice staircases between them.
 *
 * Two fields off one quantiser. Normalised elevation is cut into `tiers` bands
 * and every vertex is snapped to its band's floor, so the ground stops being a
 * surface and becomes a stack of steps. Then:
 *
 * - **The staircase** is marching squares with the interpolation taken out.
 *   Where two neighbouring cells land on different tiers the shared cell *edge*
 *   is emitted whole and axis-aligned at the higher tier's height. Contours
 *   interpolate that crossing to get a smooth isoline; refusing to is the entire
 *   difference, and it is what turns a curve into a pixel staircase. Chaining is
 *   not needed either — the segments already meet exactly at lattice corners.
 *
 * - **The screen** is the 4×4 ordered dither over the residual: how far up its
 *   own band a cell sits decides whether it takes a dot, so each plateau shades
 *   into the next instead of banding flat.
 *
 * They ship as two sub-layers because they want two pens, and because one of
 * them is `isPoints` and the other is not — the same split `buildSwissRockScree`
 * makes between its cliff hachures and its scree.
 *
 * **Why the tier comes from `normElev` and not from brightness.** Anchoring to
 * the terrain's own bounds is what keeps the plateaus still when the exaggeration
 * slider moves: the same terrain-relative set of steps at any vertical scale,
 * which is the argument the contour ladder already makes for anchoring to the
 * floor rather than to world elevation. Reading brightness directly would work
 * only while `elevScale` was positive and would slide every step the moment it
 * was not.
 *
 * `risers` closes each step with the two verticals down to the lower plateau.
 * Off, the mode is a flat staircase seen from above — the plan-view reading.
 * On, it is a stack of blocks, which is what it wants to be under an orthographic
 * camera at 30°.
 */
export function buildBitplane(terrain, p, tiers, dither, spacing, risers) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p

  const nT    = Math.max(2, Math.min(64, Math.round(tiers ?? 10)))
  const dAmt  = Math.max(0, Math.min(1, dither ?? 1))
  const dStep = Math.max(1, Math.round((spacing ?? 2) / scl))
  const bandH = (maxElev - minElev) / nT
  const half  = scl * 0.5

  const stepP = new F32List(), stepC = new F32List()
  const dotP  = new F32List(), dotC  = new F32List()
  const dotEps = Math.max(0.001, scl * 0.003)

  // Tier and residual per cell, computed once. The staircase reads each cell's
  // tier four times over as it tests its neighbours, and normElev per test is
  // the whole inner loop. -1 marks NoData, which is neither above nor below any
  // tier and must not manufacture a step along the edge of a clipped selection.
  const n = rows * cols
  const tier = new Int16Array(n)
  const frac = new Float32Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { tier[i] = -1; continue }
      const ne = normElev(cellElev(grid, r, c, cols, elevScale, jitterAmt), minElev, maxElev) * nT
      const t = Math.min(nT - 1, Math.max(0, Math.floor(ne)))
      tier[i] = t
      frac[i] = ne - t
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const t = tier[i]
      if (t < 0) continue

      const y = minElev + t * bandH
      if (!inElevCut(y, minElev, maxElev, elevMinCut, elevMaxCut)) continue

      const wx = c * scl - halfW, wz = r * scl - halfH
      // The tier's own position in the ramp, so hypsometric tinting bands with
      // the plateaus rather than cutting across them — which is the whole reason
      // this mode and a gradient go together.
      const col = computeVertexColor(t / Math.max(1, nT - 1),
                                     gridSlopes[i] / (maxSlope || 1), 0, p)

      if (dAmt > 0 && r % dStep === 0 && c % dStep === 0
          && frac[i] * dAmt > (BAYER4[(r & 3) * 4 + (c & 3)] + 0.5) / 16) {
        dotP.push6(wx - dotEps, y, wz, wx + dotEps, y, wz)
        dotC.pushRgb2(col)
      }

      // East and south only: every interior edge is shared by exactly two cells,
      // so two of the four directions visit each edge exactly once.
      for (let dir = 0; dir < 2; dir++) {
        const j = dir === 0 ? (c < cols - 1 ? i + 1 : -1)
                            : (r < rows - 1 ? i + cols : -1)
        if (j < 0) continue
        const tn = tier[j]
        if (tn < 0 || tn === t) continue

        const hi = Math.max(t, tn), lo = Math.min(t, tn)
        const yHi = minElev + hi * bandH, yLo = minElev + lo * bandH
        if (!inElevCut(yHi, minElev, maxElev, elevMinCut, elevMaxCut)) continue

        // The edge runs along the cell boundary, perpendicular to the step.
        const ax = dir === 0 ? wx + half : wx - half
        const az = dir === 0 ? wz - half : wz + half
        const bx = dir === 0 ? wx + half : wx + half
        const bz = dir === 0 ? wz + half : wz + half

        stepP.push6(ax, yHi, az, bx, yHi, bz)
        stepC.pushRgb2(col)
        if (risers) {
          stepP.push6(ax, yHi, az, ax, yLo, az)
          stepP.push6(bx, yHi, bz, bx, yLo, bz)
          stepC.pushRgb2(col); stepC.pushRgb2(col)
        }
      }
    }
  }

  return {
    'Bitplane-Step':   { positions: stepP.toArray(), colors: stepC.toArray() },
    'Bitplane-Screen': { positions: dotP.toArray(),  colors: dotC.toArray(), isPoints: true },
  }
}
