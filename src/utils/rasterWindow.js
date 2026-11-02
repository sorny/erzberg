/**
 * The part of a raster that covers a box in longitude and latitude.
 *
 * The atlas cuts one sheet per feature out of a large GeoTIFF. The box is in
 * WGS84 and the raster is in its own grid, so the box edges are projected into
 * the grid and the window is the pixel range that holds all of them. The edges
 * are sampled, not only the corners, because a box's side is curved in most
 * grids.
 */
import { projectWgs84 } from './geoCoords'

const STEPS = 8

/**
 * `[col0, row0, col1, row1]` (end exclusive) for a WGS84 box, clamped to the
 * raster. Null when the CRS cannot be placed or the box misses the raster.
 *
 * @param {number[]} area        [minLon, minLat, maxLon, maxLat]
 * @param {string}   crs         the raster's CRS string
 * @param {object}   grid        { origin: [x, y], resolution: [dx, dy], width, height }
 */
export function windowForArea([minLon, minLat, maxLon, maxLat], crs, { origin, resolution, width, height }) {
  let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity
  for (let i = 0; i <= STEPS; i++) {
    for (let j = 0; j <= STEPS; j++) {
      // The outline only: the inside of the box adds nothing to its extent.
      if (i > 0 && i < STEPS && j > 0 && j < STEPS) continue
      const lon = minLon + ((maxLon - minLon) * i) / STEPS
      const lat = minLat + ((maxLat - minLat) * j) / STEPS
      const p = projectWgs84(lat, lon, crs)
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null
      const col = (p[0] - origin[0]) / resolution[0]
      const row = (p[1] - origin[1]) / resolution[1]
      c0 = Math.min(c0, col); c1 = Math.max(c1, col)
      r0 = Math.min(r0, row); r1 = Math.max(r1, row)
    }
  }
  const win = [
    Math.max(0, Math.floor(c0)), Math.max(0, Math.floor(r0)),
    Math.min(width, Math.ceil(c1)), Math.min(height, Math.ceil(r1)),
  ]
  // Fewer than two cells a side is no terrain, and means the box missed.
  if (win[2] - win[0] < 2 || win[3] - win[1] < 2) return null
  return win
}

/** The extent `[minX, minY, maxX, maxY]` of a pixel window, in the raster's units. */
export function windowBbox([c0, r0, c1, r1], { origin, resolution }) {
  const xa = origin[0] + c0 * resolution[0], xb = origin[0] + c1 * resolution[0]
  const ya = origin[1] + r0 * resolution[1], yb = origin[1] + r1 * resolution[1]
  return [Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb)]
}
