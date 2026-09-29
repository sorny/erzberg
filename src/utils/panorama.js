/**
 * The ridges a summit board would show, found where they lie on the ground.
 *
 * ── The rays ─────────────────────────────────────────────────────────────────
 * Rays fan out from the eye at even bearings, enough of them that neighbours
 * are about one cell apart at the far edge of the raster. Each ray walks out in
 * half-cell steps and keeps the steepest elevation angle it has met, as the
 * viewshed does. A sample is visible when its angle reaches that maximum.
 *
 * ── The crests ───────────────────────────────────────────────────────────────
 * A crest is the last visible sample before the ray drops out of sight: the
 * edge of a ridge seen against what lies behind it. On a summit board that edge
 * is one of the stacked lines. A crest counts only when the ground it hides runs
 * on for `minDepth` metres, so a boulder-sized bump in the data does not draw.
 *
 * The skyline is the farthest visible sample on each ray, the one with the
 * steepest angle of all. Where that sample sits on the raster's edge, the
 * horizon is the end of the data rather than a ridge, and the ray has none.
 *
 * ── The earth ────────────────────────────────────────────────────────────────
 * The same curvature and refraction as viewshed.js, because the heights are
 * real metres and a far ridge can sink below a near one on a large DEM.
 */
import { sampleBilinear } from './terrain'

const EARTH_R = 6371000
const REFRACTION = 0.13
const MAX_RAYS = 8192

/**
 * @param {object} g  heights (metres), mask, rows, cols, cellX, cellY
 * @param {object} o
 * @param {number} o.row
 * @param {number} o.col
 * @param {number} [o.eye]       metres above the ground
 * @param {number} [o.minDepth]  metres of hidden ground a crest must shelter
 * @returns {{ rays: number, crests: Float32Array[], sky: Float32Array }}
 *   `crests[a]` holds [distance in cells, row, col] per crest on ray `a`, near
 *   to far. `sky` holds [row, col] per ray, NaN where the ray has no skyline.
 */
export function panoramaCrests(g, o) {
  const { heights, mask, rows, cols, cellX, cellY } = g
  const r0 = Math.max(0, Math.min(rows - 1, Math.round(o.row)))
  const c0 = Math.max(0, Math.min(cols - 1, Math.round(o.col)))
  if (!mask[r0 * cols + c0]) return { rays: 0, crests: [], sky: new Float32Array(0) }
  const eyeZ = heights[r0 * cols + c0] + (o.eye ?? 2)
  const bend = (1 - REFRACTION) / (2 * EARTH_R)
  const minDepth = Math.max(0, o.minDepth ?? 150)

  const reach = Math.max(Math.hypot(r0, c0), Math.hypot(r0, cols - 1 - c0),
    Math.hypot(rows - 1 - r0, c0), Math.hypot(rows - 1 - r0, cols - 1 - c0))
  const rays = Math.max(360, Math.min(MAX_RAYS, Math.ceil(2 * Math.PI * reach)))
  const crests = new Array(rays)
  const sky = new Float32Array(rays * 2).fill(NaN)

  for (let a = 0; a < rays; a++) {
    // A bearing: 0 is north, which is row 0, and 90 is east.
    const th = (a / rays) * 2 * Math.PI
    const dr = -Math.cos(th), dc = Math.sin(th)
    const metresPerStep = Math.hypot(dr * cellY, dc * cellX) * 0.5
    const found = []
    let maxTan = -Infinity, wasVis = true
    let lastS = 0, lastR = r0, lastC = c0, lastD = 0
    let candS = -1, candR = 0, candC = 0, candD = 0
    let s = 1
    for (;; s++) {
      const fr = r0 + dr * s * 0.5, fc = c0 + dc * s * 0.5
      if (fr < 0 || fc < 0 || fr > rows - 1 || fc > cols - 1) break
      const h = sampleBilinear(heights, mask, rows, cols, fr, fc)
      if (h !== h) { wasVis = false; continue }
      const d = s * metresPerStep
      const tan = (h - d * d * bend - eyeZ) / d
      const vis = tan >= maxTan
      if (vis) {
        if (candS >= 0 && d - candD >= minDepth) found.push(candS * 0.5, candR, candC)
        candS = -1
        maxTan = tan
        lastS = s; lastR = fr; lastC = fc; lastD = d
      } else if (wasVis) {
        candS = lastS; candR = lastR; candC = lastC; candD = lastD
      }
      wasVis = vis
    }
    // Hidden to the end of the data: the crest shelters everything behind it.
    if (candS >= 0 && (s - 1) * metresPerStep - candD >= minDepth) found.push(candS * 0.5, candR, candC)
    crests[a] = Float32Array.from(found)
    const onEdge = lastR < 1.5 || lastC < 1.5 || lastR > rows - 2.5 || lastC > cols - 2.5
    if (lastS > 0 && !onEdge) { sky[2 * a] = lastR; sky[2 * a + 1] = lastC }
  }
  return { rays, crests, sky }
}

/**
 * Joins crests on neighbouring rays into ridge lines.
 *
 * Each crest takes the crest on the next ray whose distance is nearest to its
 * own, within a tolerance. The tolerance lets the link run no closer than
 * about 20° to the line of sight: a ridge at a slant changes range from ray to
 * ray by its lateral step over tan 20°, and the lateral step is the distance
 * times the angle between the rays. The extra cell absorbs the half-cell steps
 * of the march. A looser rule joins a near ridge to a far one behind it, and
 * the join runs straight at the eye.
 *
 * A crest that finds no partner on the next ray looks one ray further. A ridge
 * whose hidden ground dips under `minDepth` on a single ray would otherwise
 * break there, and a line broken every few rays reads as noise.
 *
 * With `skipSky`, the crest that is also the skyline is left out. Hidden to
 * the end of the data, the last crest on a ray *is* the farthest ground seen,
 * and drawing it with both pens would plot the same line twice.
 *
 * @returns {number[]} [r0, c0, r1, c1] per segment, in grid cells
 */
export function linkCrests(pano, skipSky = false) {
  const { rays, crests, sky } = pano
  const isSky = (L, i, a) => skipSky && L[i + 1] === sky[2 * a] && L[i + 2] === sky[2 * a + 1]
  const step = (2 * Math.PI) / rays
  // The crest on ray `a`, `k` rays on, nearest in range to `d`, or -1.
  const nearest = (a, d, k) => {
    const L = crests[a]
    let best = -1, gap = 2.75 * d * step * k + 1
    for (let j = 0; j < L.length; j += 3) {
      const e = Math.abs(L[j] - d)
      if (e <= gap && !isSky(L, j, a)) { gap = e; best = j }
    }
    return best
  }
  const segs = []
  for (let a = 0; a < rays; a++) {
    const A = crests[a]
    for (let i = 0; i < A.length; i += 3) {
      if (isSky(A, i, a)) continue
      const b1 = (a + 1) % rays
      let j = nearest(b1, A[i], 1), B = crests[b1]
      if (j < 0) {
        const b2 = (a + 2) % rays
        j = nearest(b2, A[i], 2); B = crests[b2]
      }
      if (j >= 0) segs.push(A[i + 1], A[i + 2], B[j + 1], B[j + 2])
    }
  }
  return segs
}
