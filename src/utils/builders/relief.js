/**
 * Relief modes: Bitplane.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { cellElev } from '../terrain'
import { computeVertexColor } from '../colorUtils'
import { BAYER4, F32List, inElevCut, normElev } from './shared.js'

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
