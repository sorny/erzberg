/**
 * Walking and looking: Isochrones, Viewshed, Route, Panorama, Geodesic Fan.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { leastCostPath, travelTimeField } from '../isochrone'
import { viewshedField } from '../viewshed'
import { linkCrests, panoramaCrests } from '../panorama'
import { groundPixelMetres, gridValueToMetres } from '../geoCoords'
import { smoothField } from '../sunHours'
import { chainSegments } from '../chainSegments'
import { boxBlur, sampleBilinear } from '../terrain'
import { F32List, SMOOTH_SIMPLIFY_EPS, chaikinSmoothFlat, drapeEdge, hatchWhere, joinLayers, traceLevelSet } from './shared.js'

// ─── Isochrones ──────────────────────────────────────────────────────────────

/**
 * The last travel-time field, and what it was built from.
 *
 * Levels, limit, smoothing and detail only decide how a finished field is
 * drawn, and each is a geometry parameter that rebuilds. Without this, every
 * tick of those sliders repeats a Dijkstra over the whole grid. One entry, keyed
 * like Sun Hours' field cache: the terrain by identity, the rest by value.
 */
let isoCache = { terrain: null, key: null, value: null }

/**
 * Lines of equal walking time from one point.
 *
 * The time field is `travelTimeField` (Tobler's hiking function over the grid,
 * see isochrone.js), in real metres. On a georeferenced raster the cell size
 * comes from the bounding box and the heights from the file's own elevation
 * range, so the rings are minutes a walker would really take. A plain PNG
 * knows neither, so it takes a cell size and a relief from the panel instead.
 *
 * The field is −1 where the walk cannot reach — no ground, or behind ground
 * too steep to walk. The blur that softens the rings is masked to the reached
 * cells, so an unreachable pocket does not bleed into its neighbours as a time
 * of nearly zero.
 */
export function buildIsochrone(terrain, p, o) {
  const { rows, cols } = terrain
  const n = rows * cols
  const row = (o.originY ?? 0.5) * (rows - 1), col = (o.originX ?? 0.5) * (cols - 1)
  const m = groundMetres(terrain, p, o.cellMetres, o.relief)

  const key = [row, col, o.direction, o.maxSlope, m.key].join('|')
  let seconds
  if (isoCache.terrain === terrain && isoCache.key === key) seconds = isoCache.value
  else {
    seconds = travelTimeField(m.ground(), { row, col, direction: o.direction, maxSlopeDeg: o.maxSlope })
    isoCache = { terrain, key, value: seconds }
  }

  const reached = new Uint8Array(n)
  const minutes = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (seconds[i] >= 0) { reached[i] = 1; minutes[i] = seconds[i] / 60 } else minutes[i] = -1
  }
  const field = smoothField(minutes, cols, rows, o.radius ?? 0, reached)

  const interval = Math.max(1, o.interval ?? 15)
  const limit = Math.max(interval, (o.limit ?? 4) * 60)
  const levels = []
  for (let t = interval; t <= limit + 1e-9 && levels.length < 200; t += interval) levels.push(t)

  const smooth = Math.max(0, Math.min(25, Math.round(o.smoothing ?? 2)))
  const traced = traceLevelSet(terrain, p, field, levels, smooth)
  // The origin, as a small cross: the rings mean nothing without their centre.
  return o.marker ? joinLayers(traced, originCross(terrain, p, row, col)) : traced
}

/**
 * The ground in metres, for the modes that walk or look across it.
 *
 * A georeferenced raster gives the cell size from its bounding box, and a
 * GeoTIFF gives heights from its own elevation range through the histogram
 * handles (`gridValueToMetres`). What the file cannot say comes from the panel:
 * `cellMetres` per image pixel and `relief` from black to white. `key` names
 * everything the metres depend on, for a mode's field cache. `ground()` builds
 * the heights only when a field actually has to be computed.
 */
export function groundMetres(terrain, p, cellMetres, relief) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const px = p.geoTiffBbox && p.geoTiffCRS
    ? groundPixelMetres(p.geoTiffBbox, p.geoTiffCRS, p.imageWidth, p.imageHeight) : null
  const hasElev = p.geoTiffElevMin != null && p.geoTiffElevMax != null
  const cellX = (px ? px.x : (cellMetres ?? 10)) * scl
  const cellY = (px ? px.y : (cellMetres ?? 10)) * scl
  const key = [cellX, cellY, hasElev, p.geoTiffElevMin, p.geoTiffElevMax,
    p.blackPoint, p.whitePoint, hasElev ? '' : (relief ?? 1000)].join('|')
  const ground = () => {
    const n = rows * cols, heights = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      heights[i] = hasElev
        ? gridValueToMetres(grid[i], p.geoTiffElevMin, p.geoTiffElevMax, p.blackPoint ?? 0, p.whitePoint ?? 255)
        : grid[i] * (relief ?? 1000)
    }
    return { heights, mask: gridMask, rows, cols, cellX, cellY }
  }
  return { cellX, cellY, key, ground }
}

/**
 * A small cross at a grid point, draped on the ground.
 *
 * Draped, not flat: a flat cross at the summit's height sinks into the slope
 * on its uphill side and vanishes under the surface. Nothing off the data.
 */
function originCross(terrain, p, row, col) {
  const { gridMask, rows, cols } = terrain
  const ri = Math.max(0, Math.min(rows - 1, Math.round(row))), ci = Math.max(0, Math.min(cols - 1, Math.round(col)))
  if (!gridMask[ri * cols + ci]) return { positions: new Float32Array(0), colors: new Float32Array(0) }
  const sMask = terrain.hasNoData ? gridMask : null
  const arm = Math.max(3, Math.min(rows, cols) * 0.012)
  const out = { positions: new F32List(), colors: new F32List() }
  drapeEdge(out, terrain, p, sMask, col - arm, row - arm, col + arm, row + arm, Math.PI / 4)
  drapeEdge(out, terrain, p, sMask, col - arm, row + arm, col + arm, row - arm, -Math.PI / 4)
  return { positions: out.positions.toArray(), colors: out.colors.toArray() }
}

// ─── Viewshed ────────────────────────────────────────────────────────────────

let viewCache = { terrain: null, key: null, value: null }

/**
 * The ground visible from one point, hatched, with its edge traced.
 *
 * `viewshedField` casts the sight lines in real metres (see viewshed.js). The
 * 0/1 field is blurred by `radius` before it is used, so the hatch and the
 * outline follow a smooth edge instead of the cell staircase. `side` picks
 * which half is hatched: what you see, or what is hidden from you, which is
 * where a hut or a road can stand unseen.
 *
 * The share of the ground in view rides back to the panel as `note`.
 */
export function buildViewshed(terrain, p, o) {
  const { gridMask, rows, cols, scl } = terrain
  const n = rows * cols
  const sMask = terrain.hasNoData ? gridMask : null
  const row = (o.originY ?? 0.5) * (rows - 1), col = (o.originX ?? 0.5) * (cols - 1)
  const m = groundMetres(terrain, p, o.cellMetres, o.relief)

  const key = [row, col, o.eye, m.key].join('|')
  let vis
  if (viewCache.terrain === terrain && viewCache.key === key) vis = viewCache.value
  else {
    vis = viewshedField(m.ground(), { row, col, eye: o.eye })
    viewCache = { terrain, key, value: vis }
  }

  const f = new Float32Array(n)
  let seen = 0, ground = 0
  for (let i = 0; i < n; i++) {
    if (!gridMask[i]) { f[i] = -1; continue }
    f[i] = vis[i]; ground++; seen += vis[i]
  }
  const field = smoothField(f, cols, rows, o.radius ?? 0, sMask)
  const hidden = o.side === 'hidden'
  const angles = o.cross ? [o.angle ?? 45, (o.angle ?? 45) + 90] : [o.angle ?? 45]
  let out = hatchWhere(terrain, p,
    (idx) => field[idx] >= 0 && (hidden ? field[idx] < 0.5 : field[idx] >= 0.5),
    angles, Math.max(0.5, (o.spacing ?? 4) / scl))
  if (o.outline) out = joinLayers(out, traceLevelSet(terrain, p, field, [0.5], 2))
  if (o.marker) out = joinLayers(out, originCross(terrain, p, row, col))
  return { ...out, note: { visible: ground ? seen / ground : 0 } }
}

// ─── Least-cost route ────────────────────────────────────────────────────────

let routeCache = { terrain: null, key: null, value: null }

/**
 * The fastest walk between two points, as one line on the ground.
 *
 * `leastCostPath` runs the Isochrones search from A and stops at B. The grid
 * path moves in the sixteen fixed directions, so Chaikin smoothing rounds its
 * corners before it is draped a cell at a time. The walking time, distance and
 * climb ride back to the panel as `note`.
 */
export function buildRoute(terrain, p, o) {
  const { rows, cols } = terrain
  const a = [(o.startY ?? 0.75) * (rows - 1), (o.startX ?? 0.25) * (cols - 1)]
  const b = [(o.endY ?? 0.25) * (rows - 1), (o.endX ?? 0.75) * (cols - 1)]
  const m = groundMetres(terrain, p, o.cellMetres, o.relief)
  const key = [...a, ...b, o.maxSlope, m.key].join('|')
  let path
  if (routeCache.terrain === terrain && routeCache.key === key) path = routeCache.value
  else {
    path = leastCostPath(m.ground(), a, b, { maxSlopeDeg: o.maxSlope })
    routeCache = { terrain, key, value: path }
  }
  const empty = { positions: new Float32Array(0), colors: new Float32Array(0) }
  if (!path) return { ...empty, note: { blocked: true } }

  let pts = new Float64Array(path.cells.length * 2)
  path.cells.forEach((k, q) => { pts[2 * q] = k % cols; pts[2 * q + 1] = (k / cols) | 0 })
  const smooth = Math.max(0, Math.min(8, Math.round(o.smoothing ?? 3)))
  if (smooth > 0 && pts.length >= 6) pts = chaikinSmoothFlat(pts, false, smooth, SMOOTH_SIMPLIFY_EPS / smooth)

  const sMask = terrain.hasNoData ? terrain.gridMask : null
  const line = { positions: new F32List(), colors: new F32List() }
  for (let q = 2; q < pts.length; q += 2) {
    drapeEdge(line, terrain, p, sMask, pts[q - 2], pts[q - 1], pts[q], pts[q + 1],
      Math.atan2(pts[q + 1] - pts[q - 1], pts[q] - pts[q - 2]))
  }
  let out = { positions: line.positions.toArray(), colors: line.colors.toArray() }
  if (o.marker) out = joinLayers(joinLayers(out, originCross(terrain, p, a[0], a[1])), originCross(terrain, p, b[0], b[1]))
  return { ...out, note: { seconds: path.seconds, metres: path.metres, climb: path.climb } }
}

// ─── Panorama ────────────────────────────────────────────────────────────────

let panoCache = { terrain: null, key: null, value: null }

/**
 * The ridges a summit board would show from one point, drawn where they lie.
 *
 * `panoramaCrests` finds, on rays out from the eye, each edge where the ground
 * drops out of sight behind a ridge (see panorama.js). Crests at about the same
 * range on neighbouring rays are joined into lines. Seen from above they are
 * the ridges that stand in front of one another. With the camera low behind the
 * eye, they stack as they do on the board at the summit.
 *
 * Two pens: the crests, and the skyline, the farthest ground seen on each ray.
 */
export function buildPanorama(terrain, p, o) {
  const { rows, cols } = terrain
  const row = (o.originY ?? 0.5) * (rows - 1), col = (o.originX ?? 0.5) * (cols - 1)
  const m = groundMetres(terrain, p, o.cellMetres, o.relief)
  const key = [row, col, o.eye, o.minDepth, m.key].join('|')
  let pano
  if (panoCache.terrain === terrain && panoCache.key === key) pano = panoCache.value
  else {
    pano = panoramaCrests(m.ground(), { row, col, eye: o.eye, minDepth: o.minDepth })
    panoCache = { terrain, key, value: pano }
  }

  const sMask = terrain.hasNoData ? terrain.gridMask : null
  // The links are joined end to end into strokes, and each stroke is rounded
  // by Chaikin before it is draped. Crests sit on half-cell steps of the march,
  // and a ridge drawn through them as found zig-zags by that half cell.
  const draw = (segs) => {
    const out = { positions: new F32List(), colors: new F32List() }
    const flat = new Float32Array(segs.length)
    for (let q = 0; q < segs.length; q += 2) { flat[q] = segs[q + 1]; flat[q + 1] = segs[q] }
    const { order, flip, start } = chainSegments(flat, 2, 1000)
    const flush = (pts) => {
      if (pts.length < 4) return
      const line = pts.length >= 6 ? chaikinSmoothFlat(Float64Array.from(pts), false, 2, SMOOTH_SIMPLIFY_EPS / 2) : pts
      for (let q = 2; q < line.length; q += 2) {
        drapeEdge(out, terrain, p, sMask, line[q - 2], line[q - 1], line[q], line[q + 1],
          Math.atan2(line[q + 1] - line[q - 1], line[q] - line[q - 2]))
      }
    }
    let pts = []
    for (let k = 0; k < order.length; k++) {
      const o = order[k] * 4, f = flip[k]
      if (start[k]) { flush(pts); pts = [flat[o + (f ? 2 : 0)], flat[o + (f ? 3 : 1)]] }
      pts.push(flat[o + (f ? 0 : 2)], flat[o + (f ? 1 : 3)])
    }
    flush(pts)
    return { positions: out.positions.toArray(), colors: out.colors.toArray() }
  }

  let crests = draw(linkCrests(pano, !!o.skyline))
  if (o.marker) crests = joinLayers(crests, originCross(terrain, p, row, col))
  const ridges = { ...crests, note: { rays: pano.rays } }
  if (!o.skyline) return ridges

  // Neighbouring skyline points join unless the horizon jumps from one ridge
  // to another, farther one, where the line has to lift. The test is the one
  // `linkCrests` uses: a join may run no closer than about 20° to the line of
  // sight.
  const { rays, sky } = pano, skySegs = [], step = (2 * Math.PI) / rays
  for (let a = 0; a < rays; a++) {
    const b = (a + 1) % rays
    const r0 = sky[2 * a], c0 = sky[2 * a + 1], r1 = sky[2 * b], c1 = sky[2 * b + 1]
    if (r0 !== r0 || r1 !== r1) continue
    const d0 = Math.hypot(r0 - row, c0 - col), d1 = Math.hypot(r1 - row, c1 - col)
    if (Math.abs(d1 - d0) > 2.75 * Math.max(d0, d1) * step + 1) continue
    skySegs.push(r0, c0, r1, c1)
  }
  return { 'Panorama-Crests': ridges, 'Panorama-Skyline': draw(skySegs) }
}

// ─── Geodesic Fan ────────────────────────────────────────────────────────────

/**
 * Straight lines on the ground, fanned out from one point.
 *
 * A geodesic of the surface z = h(x, y) is the path a taut string or a car
 * with its wheel held straight would take: straight on the ground, curved
 * seen from above. With the heights in true metres and the plan position in
 * metres too, it follows
 *
 *     x'' = −h_x · Q / (1 + h_x² + h_y²)
 *     y'' = −h_y · Q / (1 + h_x² + h_y²),   Q = h_xx x'² + 2 h_xy x'y' + h_yy y'²
 *
 * integrated in half-cell steps and held at unit speed on the surface. `rays`
 * start at even bearings from the eye. They bend round the mountains like
 * light round a star, and where neighbours cross they bunch into caustics.
 *
 * Real ground bends a geodesic only a little. `exaggeration` multiplies the
 * heights before the derivatives are taken, as the scene's height slider does
 * for the picture. `radius` blurs the heights first, because the second
 * derivatives of a raw DEM are noise.
 */
export function buildGeodesic(terrain, p, o) {
  const { gridMask, rows, cols } = terrain
  const n = rows * cols
  const sMask = terrain.hasNoData ? gridMask : null
  const row0 = (o.originY ?? 0.5) * (rows - 1), col0 = (o.originX ?? 0.5) * (cols - 1)
  if (!gridMask[Math.round(row0) * cols + Math.round(col0)]) return null
  const g = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const { cellX, cellY } = g
  const radius = Math.max(0, o.radius ?? 2)
  const k = Math.max(0.1, o.exaggeration ?? 1)
  const hs = radius > 0 ? boxBlur(g.heights, cols, rows, radius, sMask) : g.heights
  const z = (r, c, i) => {
    const q = Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))
    return (gridMask[q] ? hs[q] : hs[i]) * k
  }
  const hx = new Float32Array(n), hy = new Float32Array(n), hxx = new Float32Array(n), hyy = new Float32Array(n), hxy = new Float32Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const zc = z(r, c, i)
      hx[i] = (z(r, c + 1, i) - z(r, c - 1, i)) / (2 * cellX)
      hy[i] = (z(r + 1, c, i) - z(r - 1, c, i)) / (2 * cellY)
      hxx[i] = (z(r, c + 1, i) - 2 * zc + z(r, c - 1, i)) / (cellX * cellX)
      hyy[i] = (z(r + 1, c, i) - 2 * zc + z(r - 1, c, i)) / (cellY * cellY)
      hxy[i] = (z(r + 1, c + 1, i) - z(r - 1, c + 1, i) - z(r + 1, c - 1, i) + z(r - 1, c - 1, i)) / (4 * cellX * cellY)
    }
  }
  const at = (F, r, c) => sampleBilinear(F, sMask, rows, cols, r, c)

  const rays = Math.max(8, Math.min(2000, Math.round(o.rays ?? 180)))
  const ds = 0.5 * Math.min(cellX, cellY)
  const maxSteps = 6 * (rows + cols)
  const out = { positions: new F32List(), colors: new F32List() }
  for (let a = 0; a < rays; a++) {
    // A bearing: 0 is north, which is row 0, and 90 is east.
    const th = (a / rays) * 2 * Math.PI
    let X = col0 * cellX, Y = row0 * cellY, vx = Math.sin(th), vy = -Math.cos(th)
    let pc = col0, pr = row0
    for (let s = 0; s < maxSteps; s++) {
      const r = Y / cellY, c = X / cellX
      const px = at(hx, r, c), py = at(hy, r, c)
      if (px !== px || py !== py) break
      const Q = at(hxx, r, c) * vx * vx + 2 * at(hxy, r, c) * vx * vy + at(hyy, r, c) * vy * vy
      const d = 1 + px * px + py * py
      vx -= px * Q / d * ds; vy -= py * Q / d * ds
      const sp = Math.sqrt(vx * vx + vy * vy + (px * vx + py * vy) ** 2) || 1
      vx /= sp; vy /= sp
      X += vx * ds; Y += vy * ds
      const nc = X / cellX, nr = Y / cellY
      if (nr < 0 || nc < 0 || nr > rows - 1 || nc > cols - 1 || !gridMask[Math.round(nr) * cols + Math.round(nc)]) break
      // One draped edge per cell walked, not per half step.
      if (Math.hypot(nc - pc, nr - pr) >= 1) {
        drapeEdge(out, terrain, p, sMask, pc, pr, nc, nr, Math.atan2(nr - pr, nc - pc))
        pc = nc; pr = nr
      }
    }
  }
  const fan = { positions: out.positions.toArray(), colors: out.colors.toArray() }
  return o.marker ? joinLayers(fan, originCross(terrain, p, row0, col0)) : fan
}
