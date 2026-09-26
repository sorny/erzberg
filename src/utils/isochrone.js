/**
 * Walking time from one point, over the ground.
 *
 * ── The speed ────────────────────────────────────────────────────────────────
 * Tobler's hiking function (1993):
 *
 *     v = 6 · exp(−3.5 · |S + 0.05|)   km/h,   S = rise / run
 *
 * It peaks at 6 km/h on a gentle descent (S = −0.05) and falls off both ways,
 * so uphill and downhill are not the same walk. The field is therefore built
 * over *directed* steps: `out` is the time to walk from the origin, and `back`
 * is the time to walk to it, which is the one a hut needs.
 *
 * ── The search ───────────────────────────────────────────────────────────────
 * Dijkstra over the grid, with sixteen neighbours: the eight adjacent cells and
 * the eight knight's moves. With eight, every path turns in 45° steps and the
 * rings on flat ground come out as octagons, up to 8% long on the diagonals.
 * The knight's moves bring that under 3%.
 *
 * Ground steeper than `maxSlopeDeg` cannot be walked. A cliff is then a wall,
 * and the rings wrap around it instead of climbing it at a crawl.
 */

const RAD = Math.PI / 180
const STEPS = [
  [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1],
]

/** Tobler's walking speed in metres per second, for a slope rise/run. */
export function toblerSpeed(slope) {
  return (6 * Math.exp(-3.5 * Math.abs(slope + 0.05))) / 3.6
}

/**
 * @param {object} g
 * @param {Float32Array} g.heights  metres per cell
 * @param {Uint8Array} g.mask       1 where there is ground
 * @param {number} g.rows
 * @param {number} g.cols
 * @param {number} g.cellX  metres per cell across
 * @param {number} g.cellY  metres per cell down
 * @param {object} o
 * @param {number} o.row
 * @param {number} o.col
 * @param {'out'|'back'} [o.direction]
 * @param {number} [o.maxSlopeDeg]
 * @returns {Float32Array} seconds per cell, −1 where unreachable or no ground
 */
export function travelTimeField(g, o) {
  const { heights, mask, rows, cols, cellX, cellY } = g
  const n = rows * cols
  const time = new Float64Array(n).fill(Infinity)
  const out = new Float32Array(n).fill(-1)
  const r0 = Math.max(0, Math.min(rows - 1, Math.round(o.row)))
  const c0 = Math.max(0, Math.min(cols - 1, Math.round(o.col)))
  const start = r0 * cols + c0
  if (!mask[start]) return out

  const back = o.direction === 'back'
  const maxS = Math.tan(Math.max(1, Math.min(89, o.maxSlopeDeg ?? 40)) * RAD)
  const dist = STEPS.map(([dr, dc]) => Math.hypot(dr * cellY, dc * cellX))

  // A binary min-heap with lazy deletion: a cell may sit in it more than once,
  // and a stale entry is skipped when it comes out.
  let keys = new Float64Array(1024), vals = new Int32Array(1024), size = 0
  const push = (k, v) => {
    if (size === keys.length) {
      const nk = new Float64Array(size * 2); nk.set(keys); keys = nk
      const nv = new Int32Array(size * 2); nv.set(vals); vals = nv
    }
    let i = size++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= k) break
      keys[i] = keys[p]; vals[i] = vals[p]; i = p
    }
    keys[i] = k; vals[i] = v
  }
  const pop = () => {
    const v = vals[0], k = keys[--size], x = vals[size]
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= size) break
      if (c + 1 < size && keys[c + 1] < keys[c]) c++
      if (keys[c] >= k) break
      keys[i] = keys[c]; vals[i] = vals[c]; i = c
    }
    keys[i] = k; vals[i] = x
    return v
  }

  time[start] = 0
  push(0, start)
  while (size > 0) {
    const t0 = keys[0], i = pop()
    if (t0 > time[i]) continue
    const r = (i / cols) | 0, c = i - r * cols, h = heights[i]
    for (let s = 0; s < STEPS.length; s++) {
      const rr = r + STEPS[s][0], cc = c + STEPS[s][1]
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue
      const j = rr * cols + cc
      if (!mask[j]) continue
      // Walking out, the step goes i → j. Walking back, the walker comes j → i.
      const slope = back ? (h - heights[j]) / dist[s] : (heights[j] - h) / dist[s]
      if (Math.abs(slope) > maxS) continue
      const t = t0 + dist[s] / toblerSpeed(slope)
      if (t < time[j]) { time[j] = t; push(t, j) }
    }
  }
  for (let i = 0; i < n; i++) if (time[i] !== Infinity) out[i] = time[i]
  return out
}
