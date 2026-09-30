/**
 * Map conventions: Bedding, Slope Classes, Runout.
 *
 * All three read the ground in real metres, through the same `groundMetres` the
 * walking and looking modes use, because each answers in a unit a map reader
 * already knows: a dip in degrees, a slope in degrees, a reach angle in degrees.
 */
import { boxBlur, sampleBilinear } from '../terrain'
import { smoothField } from '../sunHours'
import { groundMetres } from './ground.js'
import { F32List, drapeEdge, hatchWhere, joinLayers, traceLevelSet } from './shared.js'

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
 * Slope in degrees per cell, from central differences in true metres, and −1
 * off the ground. A neighbour in NoData reads as the cell itself, so the edge
 * of a clipped selection is not a cliff.
 */
function slopeDegrees(terrain, ground) {
  const { gridMask, rows, cols } = terrain
  const { heights, cellX, cellY } = ground
  const h = (r, c, i) => {
    const k = Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))
    return gridMask[k] ? heights[k] : heights[i]
  }
  const deg = new Float32Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { deg[i] = -1; continue }
      const gx = (h(r, c + 1, i) - h(r, c - 1, i)) / (2 * cellX)
      const gy = (h(r + 1, c, i) - h(r - 1, c, i)) / (2 * cellY)
      deg[i] = Math.atan(Math.hypot(gx, gy)) / RAD
    }
  }
  return deg
}

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
  const deg = slopeDegrees(terrain, groundMetres(terrain, p, o.cellMetres, o.relief).ground())
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

// ─── Runout ──────────────────────────────────────────────────────────────────

/**
 * Where falling rock stops.
 *
 * Release zones are the ground steeper than `release` degrees. From seeds on a
 * grid inside them, a block walks down the fall line of the ground in true
 * metres. It stops where the line from its release point to where it is now
 * is flatter than `reach` degrees: the reach angle, or Fahrböschung, that
 * Alpine hazard maps use for rockfall. A higher release point therefore runs
 * farther over the same ground than a lower one.
 *
 * Paths from neighbouring seeds meet in the same gully and would plot the same
 * line many times. The first path through a cell owns it, and a later one goes
 * on walking there without drawing, so that it still stops where its own
 * release height says. It draws again where it runs past the end of the path
 * it joined. Seeds run highest first, so the longest paths claim the gullies.
 *
 * On flat ground the block keeps the heading it had, because the reach angle
 * and not the slope decides where it stops. Each stop is a short tick across
 * the fall line, and the ticks make a front along the foot of each wall. A walk
 * that leaves the data does not stop, and gets no tick.
 *
 * Two pens: the paths with their stops, and the release zones, outlined and
 * hatched. The number of paths and the longest run ride back as `note`.
 */
export function buildRunout(terrain, p, o) {
  const { gridMask, rows, cols, scl } = terrain
  const n = rows * cols
  const sMask = terrain.hasNoData ? gridMask : null
  const ground = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const { cellX, cellY } = ground
  const release = Math.max(5, Math.min(85, o.release ?? 40))
  const reach = Math.max(1, Math.min(release - 1, o.reach ?? 32))
  const radius = Math.max(0, o.radius ?? 1)
  const field = smoothField(slopeDegrees(terrain, ground), cols, rows, radius, gridMask)
  // The walk reads the same blurred ground, or it steps round every bump in the
  // data that the release zones were blurred to ignore.
  const hs = radius > 0 ? boxBlur(ground.heights, cols, rows, radius, sMask) : ground.heights
  const at = (fr, fc) => sampleBilinear(hs, sMask, rows, cols, fr, fc)

  const pitch = Math.max(1, (o.spacing ?? 6) / scl)
  const seeds = []
  for (let rf = 0.5, row = 0; rf < rows - 1; rf += pitch, row++) {
    for (let cf = 0.5 + (row % 2) * pitch / 2; cf < cols - 1; cf += pitch) {
      const i = Math.round(rf) * cols + Math.round(cf)
      if (gridMask[i] && field[i] >= release) seeds.push(i)
    }
  }
  seeds.sort((a, b) => hs[b] - hs[a])

  const tanReach = Math.tan(reach * RAD)
  const stepM = 0.5 * Math.min(cellX, cellY)
  const maxSteps = 4 * (rows + cols)
  const owner = new Int32Array(n), ticked = new Uint8Array(n)
  const out = { positions: new F32List(), colors: new F32List() }
  const tick = Math.max(1.5, pitch * 0.5)
  let id = 0, longest = 0
  for (const seed of seeds) {
    if (owner[seed]) continue
    id++
    let fr = Math.floor(seed / cols), fc = seed % cols, dist = 0, stopped = false, ux = 0, uy = 0
    const z0 = at(fr, fc)
    if (z0 !== z0) continue
    for (let s = 0; s < maxSteps; s++) {
      const gx = (at(fr, fc + 0.5) - at(fr, fc - 0.5)) / cellX
      const gy = (at(fr + 0.5, fc) - at(fr - 0.5, fc)) / cellY
      const mag = Math.hypot(gx, gy)
      // NaN is a tap in NoData, and the walk ends. On flat ground the block
      // keeps its heading, because the reach angle, not the slope, stops it.
      if (mag !== mag) break
      if (mag > 1e-6) { ux = -gx / mag; uy = -gy / mag }
      else if (!ux && !uy) { stopped = true; break }
      const nfc = fc + ux * stepM / cellX, nfr = fr + uy * stepM / cellY
      if (nfr < 0 || nfc < 0 || nfr > rows - 1 || nfc > cols - 1) break
      const k = Math.round(nfr) * cols + Math.round(nfc)
      if (!gridMask[k]) break
      const z = at(nfr, nfc)
      if (z !== z) break
      if (owner[k] === 0 || owner[k] === id) {
        owner[k] = id
        drapeEdge(out, terrain, p, sMask, fc, fr, nfc, nfr, Math.atan2(uy, ux))
      }
      fr = nfr; fc = nfc; dist += stepM
      if (dist > 2 * stepM && (z0 - z) / dist < tanReach) { stopped = true; break }
    }
    if (dist > longest) longest = dist
    const k = Math.round(fr) * cols + Math.round(fc)
    if (!stopped || ticked[k]) continue
    ticked[k] = 1
    // Across the fall line, in cells.
    let tc = -uy / cellX, tr = ux / cellY
    const tm = Math.hypot(tc, tr) || 1
    tc = tc / tm * tick; tr = tr / tm * tick
    drapeEdge(out, terrain, p, sMask, fc - tc, fr - tr, fc + tc, fr + tr, Math.atan2(tr, tc))
  }
  const note = { paths: id, longest }
  const paths = { positions: out.positions.toArray(), colors: out.colors.toArray(), note }
  if (!o.zone) return paths

  const zoneInk = { ...p, lineColor: o.zoneColor ?? p.lineColor }
  let zone = traceLevelSet(terrain, zoneInk, field, [release], 2)
  if (o.hatch) zone = joinLayers(zone, hatchWhere(terrain, zoneInk, (i) => field[i] >= release, [o.angle ?? 45], Math.max(0.5, pitch / 2)))
  return { 'Runout-Paths': paths, 'Runout-Release': { ...zone, note } }
}
