/**
 * Map conventions: Bedding, Slope Classes.
 *
 * Both read the ground in real metres, through the same `groundMetres` the
 * walking and looking modes use, because each answers in a unit a map reader
 * already knows: a dip in degrees, a slope in degrees.
 */
import { smoothField } from '../sunHours'
import { groundMetres } from './ground.js'
import { hatchWhere, joinLayers, traceLevelSet } from './shared.js'

const RAD = Math.PI / 180

// ─── Bedding ─────────────────────────────────────────────────────────────────

/**
 * Where tilted layers of rock would crop out.
 *
 * Contours cut the ground with level planes. A bed is a plane that dips at
 * `dip` degrees towards the bearing `azimuth`, so its height falls by
 * s · tan(dip) with the distance s along that bearing. The bed meets the
 * ground where h + s · tan(dip) is constant, and the traces are the level set
 * of that field. Where a trace crosses a valley it bends into a V, pointing
 * down the dip when the bed dips downstream more steeply than the valley
 * falls: the rule of V's, read off a geological map.
 *
 * Heights and distances are true metres and never the exaggerated relief, so a
 * dip of 30° is 30° on the ground whatever the height slider says.
 *
 * `marker` > 0 draws every Nth bed as a second pen, the way a map picks out a
 * seam or a marker horizon.
 */
export function buildBedding(terrain, p, o) {
  const { gridMask, rows, cols } = terrain
  const n = rows * cols
  const { heights, cellX, cellY } = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const tn = Math.tan(Math.max(0, Math.min(85, o.dip ?? 25)) * RAD)
  // The dip direction as a bearing: north is row 0.
  const az = (o.azimuth ?? 135) * RAD
  const dc = Math.sin(az) * cellX, dr = -Math.cos(az) * cellY

  const f = new Float32Array(n)
  let lo = Infinity, hi = -Infinity
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const v = heights[i] + (c * dc + r * dr) * tn
      f[i] = v
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!(hi > lo)) return null
  // traceLevelSet reads a negative value as no ground, so the field starts at 0.
  for (let i = 0; i < n; i++) f[i] = gridMask[i] ? f[i] - lo : -1

  const beds = Math.max(2, Math.min(300, Math.round(o.beds ?? 40)))
  const step = (hi - lo) / beds
  const shift = (((o.offset ?? 0) % 1) + 1) % 1 * step
  const every = Math.max(0, Math.round(o.marker ?? 0))
  const plain = [], marked = []
  for (let k = 0; k <= beds; k++) {
    const level = shift + k * step
    if (level <= 0 || level >= hi - lo) continue
    ;(every > 0 && k % every === 0 ? marked : plain).push(level)
  }
  const smooth = Math.max(0, Math.min(25, Math.round(o.smoothing ?? 2)))
  const main = traceLevelSet(terrain, p, f, plain, smooth)
  if (!marked.length) return main
  const seamInk = { ...p, lineColor: o.markerColor ?? p.lineColor }
  return { 'Bedding-Beds': main, 'Bedding-Marker': traceLevelSet(terrain, seamInk, f, marked, smooth) }
}

// ─── Slope Classes ───────────────────────────────────────────────────────────

/**
 * Steep ground in three bands, each hatched and each its own pen.
 *
 * The bands are the ones Alpine avalanche maps use: 30–35°, 35–40° and over
 * 40°, below which slab avalanches are rare. The slope is measured in true
 * metres, from central differences over the raster, and blurred by `radius`
 * so a band's edge follows the landform and not the noise in the data.
 *
 * The lightest band takes a hatch at twice the spacing, the middle one at the
 * spacing, and the steepest a cross-hatch at the spacing, so the three read
 * apart with one pen as well as with three.
 *
 * The share of the ground in each band rides back to the panel as `note`.
 */
export function buildSlopeClass(terrain, p, o) {
  const { gridMask, rows, cols, scl } = terrain
  const n = rows * cols
  const { heights, cellX, cellY } = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const h = (r, c, i) => {
    const k = Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))
    return gridMask[k] ? heights[k] : heights[i]
  }
  const deg = new Float32Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { deg[i] = -1; continue }
      const gx = (h(r, c + 1, i) - h(r, c - 1, i)) / (2 * cellX)
      const gy = (h(r + 1, c, i) - h(r - 1, c, i)) / (2 * cellY)
      deg[i] = Math.atan(Math.hypot(gx, gy)) / RAD
    }
  }
  const field = smoothField(deg, cols, rows, o.radius ?? 1, gridMask)

  const [a, b, c] = [o.low ?? 30, o.mid ?? 35, o.high ?? 40].sort((x, y) => x - y)
  let ground = 0, inA = 0, inB = 0, inC = 0
  for (let i = 0; i < n; i++) {
    const v = field[i]
    if (v < 0) continue
    ground++
    if (v >= c) inC++; else if (v >= b) inB++; else if (v >= a) inA++
  }
  const note = ground ? { low: inA / ground, mid: inB / ground, high: inC / ground } : null

  const pitch = Math.max(0.5, (o.spacing ?? 4) / scl)
  const angle = o.angle ?? 45
  const out = {
    'SlopeClass-Low':  { ...hatchWhere(terrain, p, (i) => field[i] >= a && field[i] < b, [angle], pitch * 2), note },
    'SlopeClass-Mid':  { ...hatchWhere(terrain, p, (i) => field[i] >= b && field[i] < c, [angle], pitch), note },
    'SlopeClass-High': { ...hatchWhere(terrain, p, (i) => field[i] >= c, [angle, angle + 90], pitch), note },
  }
  // The outline goes with the lightest band, where it is the edge of the ink.
  if (o.outline) out['SlopeClass-Low'] = { ...joinLayers(out['SlopeClass-Low'], traceLevelSet(terrain, p, field, [a], 2)), note }
  return out
}
