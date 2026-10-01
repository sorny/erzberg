/**
 * Map Grid: a grid at true distances on the ground, and the sheet's scale.
 *
 * Crosshatch is a pattern: stretched to meet the edges, turned to any angle.
 * This is a measurement. The grid starts at the south-west corner, as a map
 * sheet's does, at a round distance — 500 m, 1 km — set in metres, and it
 * follows the raster's own axes. It is drawn as lines, as a cross at each
 * intersection, or both; and round the edge, the scale names the distances.
 *
 * Four pens: `MapGrid` (the lines and the frame), `MapGrid-Marks` (the
 * crosses), `MapGrid-Scale` (ticks and the outer frame line) and
 * `MapGrid-Numbers`, which `useScaleLabels` letters on the main thread.
 */
import { hexToRgb } from '../colorUtils'
import { sampleBilinear } from '../terrain'
import { groundMetres } from './ground.js'
import { intersectionMarks, joinFamilies, lineFamily } from './lines.js'
import { F32List } from './shared.js'

/** More lines than this a side and the interval is raised to the next round one. */
const MAX_LINES = 300

const NEXT = { 1: 2, 2: 5, 5: 10 }

/**
 * The grid, the crosses and the scale.
 *
 * Metres per cell come from the GeoTIFF's bounding box, or from `cellMetres`
 * for a plain heightmap. An interval that would draw more than MAX_LINES lines
 * across the raster is raised through the 1-2-5 steps until it does not, and
 * the note says so: a 1 m grid on a 30 km sheet is a grey plate, not a grid.
 */
export function buildMapGrid(terrain, p, o) {
  const { rows, cols, scl } = terrain
  const { cellX, cellY } = groundMetres(terrain, p, o.cellMetres, 1000)
  const want = roundDistance(o.interval ?? 1000)
  let stepM = want
  const longest = Math.max((cols - 1) * cellX, (rows - 1) * cellY)
  while (longest / stepM > MAX_LINES) {
    const d = 10 ** Math.floor(Math.log10(stepM)), k = Math.round(stepM / d)
    stepM = (NEXT[k] ?? 10) * d
  }
  const note = { stepM, raised: stepM !== want }

  const origin = { c: 0, r: rows - 1 }
  const A = lineFamily(terrain, stepM / cellY * scl, 0, 0, false, origin)
  const B = lineFamily(terrain, stepM / cellX * scl, 0, 90, false, origin)
  const out = {}
  if (o.lines) out.MapGrid = { ...joinFamilies(terrain, p, A, B), note }
  if (o.marks) out['MapGrid-Marks'] = { ...intersectionMarks(terrain, p, A, B, o.markSize, o.markColor), note }
  if (o.scale) out['MapGrid-Scale'] = { ...edgeScale(terrain, p, o, { stepM, cellX, cellY }), note }
  const keys = Object.keys(out)
  if (!keys.length) return null
  return keys.length === 1 && keys[0] === 'MapGrid' ? out.MapGrid : out
}

/** The nearest of 1, 2 and 5 times a power of ten. */
export function roundDistance(m) {
  if (!(m > 0)) return 1
  const d = 10 ** Math.floor(Math.log10(m))
  let best = d
  for (const k of [1, 2, 5, 10]) if (Math.abs(Math.log(k * d / m)) < Math.abs(Math.log(best / m))) best = k * d
  return best
}

/**
 * The scale round the edge of the terrain: a tick at each grid distance on all
 * four sides, an outer frame line at the ticks' ends, and the distances
 * themselves, measured from the south-west corner as a map sheet measures them.
 *
 * The ticks sit where the grid lines meet the edge, so the numbers are the
 * grid's own round distances.
 *
 * Everything sits at the height of the ground at the edge, so it lies flat in
 * a plan view and follows the rim of the terrain in any other. The numbers are
 * placed here and lettered on the main thread, which has the fonts: each
 * anchor carries its text, its size and how it hangs off its point.
 */
function edgeScale(terrain, p, o, { stepM, cellX, cellY }) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const size = Math.max(1, o.scaleSize ?? 12)
  const tick = size * 0.6, gap = size * 0.45
  const rgb = hexToRgb(o.scaleColor ?? '#1a1a1a')
  const elevAt = (c, r) => {
    const b = sampleBilinear(grid, sMask, rows, cols, Math.min(rows - 1, Math.max(0, r)), Math.min(cols - 1, Math.max(0, c)))
    return b === b ? (b - 0.5) * 100 * (p.elevScale ?? 1) : minElev
  }
  const X = (c) => c * scl - halfW, Z = (r) => r * scl - halfH
  const positions = new F32List(), colors = new F32List()
  const seg = (x0, y0, z0, x1, y1, z1) => { positions.push6(x0, y0, z0, x1, y1, z1); colors.pushRgb2(rgb) }

  // Tick positions in cells along each axis, and the distance each one names.
  const across = [], down = []
  for (let k = 0; k * stepM / cellX <= cols - 1 + 1e-6; k++) across.push([k * stepM / cellX, k * stepM])
  for (let k = 0; k * stepM / cellY <= rows - 1 + 1e-6; k++) down.push([rows - 1 - k * stepM / cellY, k * stepM])
  const most = Math.max(across[across.length - 1]?.[1] ?? 0, down[down.length - 1]?.[1] ?? 0)
  const km = most >= 1000
  // As many decimals as the interval needs, and no more: a 5 m grid on a
  // kilometre sheet reads 0.005, 0.01, 0.015, which two fixed decimals rounded
  // to 0.01, 0.01, 0.02.
  const unit = km ? stepM / 1000 : stepM
  const decimals = Math.max(0, -Math.floor(Math.log10(unit) + 1e-9))
  const label = (m) => String(Number((km ? m / 1000 : m).toFixed(decimals)))

  const anchors = []
  const top = Z(0) - tick, bottom = Z(rows - 1) + tick, left = X(0) - tick, right = X(cols - 1) + tick
  for (const [c, m] of across) {
    const x = X(c)
    for (const [r, z, dir, valign] of [[0, Z(0), -1, 'bottom'], [rows - 1, Z(rows - 1), 1, 'top']]) {
      const y = elevAt(c, r)
      seg(x, y, z, x, y, z + dir * tick)
      anchors.push({ x, y, z: z + dir * (tick + gap), text: label(m), size, align: 'middle', valign })
    }
  }
  for (const [r, m] of down) {
    const z = Z(r)
    for (const [c, x, dir, align] of [[0, X(0), -1, 'end'], [cols - 1, X(cols - 1), 1, 'start']]) {
      const y = elevAt(c, r)
      seg(x, y, z, x + dir * tick, y, z)
      anchors.push({ x: x + dir * (tick + gap), y, z, text: label(m), size, align, valign: 'middle' })
    }
  }
  // The outer frame line, one cell at a time so it follows the rim's height.
  for (let c = 0; c < cols - 1; c++) {
    seg(X(c), elevAt(c, 0), top, X(c + 1), elevAt(c + 1, 0), top)
    seg(X(c), elevAt(c, rows - 1), bottom, X(c + 1), elevAt(c + 1, rows - 1), bottom)
  }
  for (let r = 0; r < rows - 1; r++) {
    seg(left, elevAt(0, r), Z(r), left, elevAt(0, r + 1), Z(r + 1))
    seg(right, elevAt(cols - 1, r), Z(r), right, elevAt(cols - 1, r + 1), Z(r + 1))
  }
  // The inner frame, the terrain's own edge, when the grid is not drawing it:
  // with the lines off a sheet still has its neat line.
  if (o.lines === false) {
    for (let c = 0; c < cols - 1; c++) {
      seg(X(c), elevAt(c, 0), Z(0), X(c + 1), elevAt(c + 1, 0), Z(0))
      seg(X(c), elevAt(c, rows - 1), Z(rows - 1), X(c + 1), elevAt(c + 1, rows - 1), Z(rows - 1))
    }
    for (let r = 0; r < rows - 1; r++) {
      seg(X(0), elevAt(0, r), Z(r), X(0), elevAt(0, r + 1), Z(r + 1))
      seg(X(cols - 1), elevAt(cols - 1, r), Z(r), X(cols - 1), elevAt(cols - 1, r + 1), Z(r + 1))
    }
  }
  // Close the band's corners, and name the unit in each, as a sheet does.
  const corners = [[0, 0, -1, -1], [cols - 1, 0, 1, -1], [0, rows - 1, -1, 1], [cols - 1, rows - 1, 1, 1]]
  for (const [c, r, sx, sz] of corners) {
    const y = elevAt(c, r), x = X(c), z = Z(r)
    seg(x, y, z + sz * tick, x + sx * tick, y, z + sz * tick)
    seg(x + sx * tick, y, z, x + sx * tick, y, z + sz * tick)
    anchors.push({ x: x + sx * (tick + gap), y, z: z + sz * (tick + gap), text: km ? 'km' : 'm', size: size * 0.8,
      align: sx < 0 ? 'end' : 'start', valign: sz < 0 ? 'bottom' : 'top' })
  }
  return { positions: positions.toArray(), colors: colors.toArray(), scaleAnchors: anchors }
}
