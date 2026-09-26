/**
 * What can be seen from one point.
 *
 * ── The rays ─────────────────────────────────────────────────────────────────
 * One ray from the eye to every cell on the raster's border, stepped one cell
 * at a time along its longer axis. Walking out, the ray keeps the steepest
 * elevation angle it has met. A cell is visible when its own angle reaches
 * that maximum: nothing nearer stands higher in the line of sight.
 *
 * Testing every cell along its own line of sight is exact and costs a march per
 * cell, which is a billion steps on a 1024² grid. The border rays cost one
 * march per border cell instead, about four million steps, and every cell is
 * crossed by at least one ray. A cell that a ray reports as visible stays
 * visible, so the edges of a view can be a cell generous.
 *
 * ── The earth ────────────────────────────────────────────────────────────────
 * The ground falls away from a level sight line by d² / 2R, and air bends the
 * line back down by about 13% of that. Over 10 km that is 6.8 m. It is there
 * because the heights are real metres, and on a large DEM it decides whether a
 * far summit shows.
 */

const EARTH_R = 6371000
const REFRACTION = 0.13

/**
 * @param {object} g  heights (metres), mask, rows, cols, cellX, cellY
 * @param {object} o
 * @param {number} o.row
 * @param {number} o.col
 * @param {number} [o.eye] metres above the ground
 * @returns {Uint8Array} 1 where visible from the eye
 */
export function viewshedField(g, o) {
  const { heights, mask, rows, cols, cellX, cellY } = g
  const vis = new Uint8Array(rows * cols)
  const r0 = Math.max(0, Math.min(rows - 1, Math.round(o.row)))
  const c0 = Math.max(0, Math.min(cols - 1, Math.round(o.col)))
  const start = r0 * cols + c0
  if (!mask[start]) return vis
  vis[start] = 1
  const eyeZ = heights[start] + (o.eye ?? 2)
  const bend = (1 - REFRACTION) / (2 * EARTH_R)

  const ray = (tr, tc) => {
    const dr = tr - r0, dc = tc - c0
    const steps = Math.max(Math.abs(dr), Math.abs(dc))
    let maxTan = -Infinity
    for (let s = 1; s <= steps; s++) {
      const fr = r0 + (dr * s) / steps, fc = c0 + (dc * s) / steps
      const idx = Math.round(fr) * cols + Math.round(fc)
      if (!mask[idx]) continue
      const d = Math.hypot((fr - r0) * cellY, (fc - c0) * cellX)
      const tan = (heights[idx] - d * d * bend - eyeZ) / d
      if (tan >= maxTan) { vis[idx] = 1; maxTan = tan }
    }
  }
  for (let c = 0; c < cols; c++) { ray(0, c); ray(rows - 1, c) }
  for (let r = 1; r < rows - 1; r++) { ray(r, 0); ray(r, cols - 1) }
  return vis
}
