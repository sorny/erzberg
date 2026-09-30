/**
 * D8 drainage: where each cell drains, and how much ground drains through it.
 *
 * Shared by Venation (a draw mode, in the worker) and the Wetness layer (a
 * surface field, on the main thread). Stream Network and Watershed keep their
 * own walks, because each needs something this does not return: Strahler order,
 * and a basin label.
 */
import { boxBlur } from './terrain'

/**
 * @param {Float32Array} grid  heights, row-major
 * @param {Uint8Array} mask    1 where there is ground
 * @param {number} rows
 * @param {number} cols
 * @param {number} [radius=2]  blur before the walk. On a raw DEM, D8 finds a pit
 *   at every dimple and the flow breaks up into thousands of one-cell basins.
 * @returns {{ next: Int32Array, acc: Float32Array }} `next` is the cell each
 *   cell drains to, or −1 at a sink or the edge; `acc` counts the cells that
 *   drain through each cell, itself included.
 */
export function d8Accumulation(grid, mask, rows, cols, radius = 2) {
  const n = rows * cols
  const g = radius > 0 ? boxBlur(grid, cols, rows, radius, mask) : grid
  const next = new Int32Array(n).fill(-1), inDeg = new Int32Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!mask[i]) continue
      let lo = g[i], t = -1
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc
          if ((!dr && !dc) || nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue
          const q = nr * cols + nc
          if (mask[q] && g[q] < lo) { lo = g[q]; t = q }
        }
      }
      if (t >= 0) { next[i] = t; inDeg[t]++ }
    }
  }
  // Accumulate from the tops down: a cell is passed on once everything above
  // it has arrived.
  const acc = new Float32Array(n).fill(1), queue = new Int32Array(n)
  let qn = 0
  for (let i = 0; i < n; i++) if (mask[i] && !inDeg[i]) queue[qn++] = i
  for (let h = 0; h < qn; h++) {
    const i = queue[h], d = next[i]
    if (d < 0) continue
    acc[d] += acc[i]
    if (--inDeg[d] === 0) queue[qn++] = d
  }
  return { next, acc }
}
