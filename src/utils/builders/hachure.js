/**
 * Hachure: slope ticks and Lehmann hachures.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { cellElev, hasData, sampleBilinear } from '../terrain'
import { computeVertexColor } from '../colorUtils'
import { F32List, inElevCut, mulberry32, normElev } from './shared.js'

// ─── Hachure ──────────────────────────────────────────────────────────────────

/**
 * Slope ticks — one stroke per sampled cell, length proportional to steepness.
 *
 * The stroke runs *across* the gradient (perpendicular to `∇H`, so tangent to
 * the contour through that cell) and is centred on it, which makes the field
 * read as stacked contour fragments thickening where the ground steepens —
 * rather than as the downslope hachures the name suggests.
 *
 * Cells flatter than a small fixed epsilon emit nothing, so flats stay blank
 * instead of filling with sub-pixel ticks of arbitrary direction.
 */
export function buildHachure(terrain, p, spacing, length) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const lineStep = Math.max(1, Math.round((spacing ?? 4) / scl))
  const positions = new F32List(), colors = new F32List()

  for (let r = 0; r < rows; r += lineStep) {
    for (let c = 0; c < cols; c += lineStep) {
      if (!hasData(gridMask, r, c, cols)) continue
      const bC = grid[r * cols + c], elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      const bL = (c > 0 && gridMask[r * cols + c - 1]) ? grid[r * cols + c - 1] : bC
      const bR = (c < cols - 1 && gridMask[r * cols + c + 1]) ? grid[r * cols + c + 1] : bC
      const bU = (r > 0 && gridMask[(r - 1) * cols + c]) ? grid[(r - 1) * cols + c] : bC
      const bD = (r < rows - 1 && gridMask[(r + 1) * cols + c]) ? grid[(r + 1) * cols + c] : bC
      const gx = (bR - bL) * 50 * elevScale, gz = (bD - bU) * 50 * elevScale, mag = Math.sqrt(gx * gx + gz * gz)
      if (mag < 0.005) continue
      const tickLen = mag * (length ?? 1) * scl, nx = -gz / mag, nz = gx / mag, wx = c * scl - halfW, wz = r * scl - halfH
      positions.push6(wx - nx * tickLen * 0.5, elev, wz - nz * tickLen * 0.5, wx + nx * tickLen * 0.5, elev, wz + nz * tickLen * 0.5)
      const col = computeVertexColor(normElev(elev, minElev, maxElev), gridSlopes[r * cols + c] / (maxSlope || 1), Math.atan2(gz, gx), p)
      colors.pushRgb2(col)
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

/**
 * Lehmann hachures: downslope strokes, each confined to one contour band.
 *
 * Lehmann's 1799 rule was that a hachure runs the way water runs and stops at
 * the next contour, so the plate reads as rows of strokes between invisible
 * level lines. Each stroke here is traced through its seed both ways — uphill
 * to the top of its band, downhill to the bottom — and stops a little short of
 * both, which leaves the thin white seam between rows that marks the contour.
 *
 * Lehmann darkened steep ground with heavier strokes. A line layer has one
 * weight, so steepness sets the *spacing* instead: a seed is refused if another
 * stroke lies within a clearance that grows from `spacing` on the steepest
 * ground to four times that on the gentlest. `gamma` bends that ramp. Seeds run
 * steepest first, so the dense ground is settled before the open ground claims
 * any of it.
 */
export function buildLehmannHachure(terrain, p, spacing, bands, gamma) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const sMask = terrain.hasNoData ? gridMask : null
  const positions = new F32List(), colors = new F32List()
  const n = rows * cols
  let gMin = Infinity, gMax = -Infinity
  for (let i = 0; i < n; i++) if (gridMask[i]) { if (grid[i] < gMin) gMin = grid[i]; if (grid[i] > gMax) gMax = grid[i] }
  const nB = Math.max(2, Math.min(60, Math.round(bands ?? 14)))
  const bandH = (gMax - gMin) / nB
  if (!(bandH > 0)) return { positions: positions.toArray(), colors: colors.toArray() }

  const pitch = Math.max(1, (spacing ?? 4) / scl)
  const gam = gamma ?? 1
  // Slope against its 95th percentile, not the maximum: one cliff cell would
  // otherwise make every other slope read as gentle and spread the whole plate.
  const BINS = 256, hist = new Uint32Array(BINS), top = maxSlope || 1
  let valid = 0
  for (let i = 0; i < n; i++) if (gridMask[i]) { hist[Math.min(BINS - 1, Math.floor((gridSlopes[i] / top) * BINS))]++; valid++ }
  let acc = 0, bin = BINS - 1
  for (let b = 0; b < BINS; b++) { acc += hist[b]; if (acc >= valid * 0.95) { bin = b; break } }
  const ms = ((bin + 1) / BINS) * top
  const owner = new Int32Array(n)
  const rng = mulberry32(0x1e4a)
  const seeds = []
  const cand = Math.max(1, pitch * 0.5)
  for (let rf = 0; rf < rows; rf += cand) {
    for (let cf = 0; cf < cols; cf += cand) {
      const r = Math.min(rows - 1, Math.round(rf + (rng() - 0.5) * cand))
      const c = Math.min(cols - 1, Math.max(0, Math.round(cf + (rng() - 0.5) * cand)))
      const i = Math.max(0, r) * cols + c
      if (gridMask[i] && gridSlopes[i] / ms > 0.02) seeds.push(i)
    }
  }
  seeds.sort((a, b) => gridSlopes[b] - gridSlopes[a])

  const GAP = 0.08, STEP = 0.5
  const grad = (fr, fc) => {
    const e = 1
    const gx = sampleBilinear(grid, sMask, rows, cols, fr, fc + e) - sampleBilinear(grid, sMask, rows, cols, fr, fc - e)
    const gz = sampleBilinear(grid, sMask, rows, cols, fr + e, fc) - sampleBilinear(grid, sMask, rows, cols, fr - e, fc)
    return [gx, gz]
  }
  // Walks from (fr, fc) up (dir 1) or down (dir −1) until `stop` crosses, and
  // returns the points after the start, ending on the interpolated crossing.
  // A hachure is a straight-ish stroke. Where the fall line turns hard — on a
  // terrace edge or a quantised flat — the stroke ends rather than hooking.
  const walk = (fr, fc, g, dir, stop) => {
    const pts = []
    let pr = 0, pc = 0
    for (let s = 0; s < 400; s++) {
      const [gx, gz] = grad(fr, fc), mag = Math.sqrt(gx * gx + gz * gz)
      if (!(mag > 1e-6)) break
      const ur = gz / mag, uc = gx / mag
      if (s > 0 && ur * pr + uc * pc < 0.7) break
      pr = ur; pc = uc
      const nr = fr + dir * ur * STEP, nc = fc + dir * uc * STEP
      if (nr < 0 || nr > rows - 1 || nc < 0 || nc > cols - 1) break
      const ni = Math.round(nr) * cols + Math.round(nc)
      if (!gridMask[ni]) break
      const ng = sampleBilinear(grid, sMask, rows, cols, nr, nc)
      if (ng !== ng) break
      if (dir > 0 ? ng >= stop : ng <= stop) {
        const t = (stop - g) / (ng - g || 1)
        pts.push(fr + (nr - fr) * t, fc + (nc - fc) * t, stop)
        break
      }
      pts.push(nr, nc, ng)
      fr = nr; fc = nc; g = ng
    }
    return pts
  }

  let id = 0
  for (const i of seeds) {
    if (owner[i]) continue
    const s = gridSlopes[i] / ms
    const clear = Math.min(24, pitch * (1 + 3 * (1 - Math.pow(Math.min(1, s), 1 / gam))))
    const r0 = Math.floor(i / cols), c0 = i % cols, R = Math.ceil(clear)
    let blocked = false
    for (let dr = -R; dr <= R && !blocked; dr++) {
      const rr = r0 + dr
      if (rr < 0 || rr >= rows) continue
      for (let dc = -R; dc <= R; dc++) {
        const cc = c0 + dc
        if (cc < 0 || cc >= cols || dr * dr + dc * dc > clear * clear) continue
        if (owner[rr * cols + cc]) { blocked = true; break }
      }
    }
    if (blocked) continue

    const g0 = grid[i]
    const k = Math.min(nB - 1, Math.floor((g0 - gMin) / bandH))
    const top = gMin + (k + 1 - GAP) * bandH, bot = gMin + (k + GAP) * bandH
    if (g0 >= top || g0 <= bot) continue
    id++
    const up = walk(r0, c0, g0, 1, top), down = walk(r0, c0, g0, -1, bot)
    const line = []
    for (let q = up.length - 3; q >= 0; q -= 3) line.push(up[q], up[q + 1], up[q + 2])
    line.push(r0, c0, g0)
    for (let q = 0; q < down.length; q += 3) line.push(down[q], down[q + 1], down[q + 2])
    if (line.length < 6) continue
    for (let q = 0; q < line.length; q += 3) owner[Math.round(line[q]) * cols + Math.round(line[q + 1])] = id

    for (let q = 3; q < line.length; q += 3) {
      const e0 = (line[q - 1] - 0.5) * 100 * elevScale, e1 = (line[q + 2] - 0.5) * 100 * elevScale
      if (!inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      positions.push6(line[q - 2] * scl - halfW, e0, line[q - 3] * scl - halfH,
                      line[q + 1] * scl - halfW, e1, line[q] * scl - halfH)
      colors.pushRgb2(computeVertexColor(normElev(e0, minElev, maxElev), Math.min(1, s),
        Math.atan2(line[q] - line[q - 3], line[q + 1] - line[q - 2]), p))
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}
