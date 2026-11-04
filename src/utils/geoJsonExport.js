/**
 * The marks as map data: line layers as GeoJSON in the raster's own projection.
 *
 * The SVG writes lines in sheet millimetres, where their place on the ground is
 * lost. This writes the same lines where they lie: each world point goes back
 * to its raster cell, and the cell to the raster's coordinates. Each line
 * carries its layer, its pen name and its height in metres, read from the
 * raster, so QGIS can label, style and clip it beside other layers.
 *
 * Only marks that lie on the ground are written. A chart, a pillar or a
 * panorama is a drawing in the view, not a place, and is left out.
 */
import { DRAW_MODES } from './drawModes'

/** Modes whose marks stand off the ground or are charts, not places. */
export const OFF_GROUND = new Set([
  'Pillars', 'Stems', 'Hair', 'Sprite', 'Air', 'Panorama',
  'Waveform', 'ProfileSheet', 'SwathProfile', 'Hypsometry', 'AspectRose', 'Stereonet',
])

const MODE_IDS = new Set(DRAW_MODES.map((m) => m.id))

/** The draw mode a layer id belongs to, or null for a vector or text layer. */
export function modeOfLayer(id) {
  if (typeof id !== 'string') return null
  const mode = id.replace(/@\w+$/, '').split('-')[0]
  return MODE_IDS.has(mode) ? mode : null
}

/**
 * Segment pairs (six floats per segment) joined into runs wherever one
 * segment starts where the last one ended.
 */
export function joinSegments(positions, eps = 1e-4) {
  const runs = []
  let run = null
  for (let i = 0; i + 5 < positions.length; i += 6) {
    const a = [positions[i], positions[i + 1], positions[i + 2]]
    const b = [positions[i + 3], positions[i + 4], positions[i + 5]]
    const last = run?.[run.length - 1]
    if (last && Math.abs(last[0] - a[0]) < eps && Math.abs(last[2] - a[2]) < eps) run.push(b)
    else { run = [a, b]; runs.push(run) }
  }
  return runs
}

/**
 * The line layers as a GeoJSON FeatureCollection.
 *
 * @param {Array}  lineGeo  the worker's line layers ({ id, positions, isPoints })
 * @param {object} place    { halfW, halfH, peakOff, lineOff, width, height, bbox, crs,
 *                            metresAt(col, row) → metres | null, nameOf(id) → string }
 * @returns {{ geojson: object, lines: number, layers: number }}
 */
export function linesToGeoJson(lineGeo, place) {
  const { halfW, halfH, peakOff = 0, lineOff = 0, width, height, bbox, crs, metresAt, nameOf } = place
  const [minX, minY, maxX, maxY] = bbox
  const kx = (maxX - minX) / width, ky = (maxY - minY) / height
  const features = []
  const layers = new Set()
  for (const layer of lineGeo ?? []) {
    const mode = modeOfLayer(layer?.id)
    if (!mode || OFF_GROUND.has(mode) || layer.isPoints || !(layer.positions?.length >= 6)) continue
    for (const run of joinSegments(layer.positions)) {
      const coords = []
      let sum = 0, n = 0
      for (const [x, , z] of run) {
        const col = x + halfW + peakOff, row = z + halfH + lineOff
        const m = metresAt?.(col, row)
        const pt = [round(minX + col * kx), round(maxY - row * ky)]
        if (Number.isFinite(m)) { pt.push(Math.round(m * 100) / 100); sum += m; n++ }
        coords.push(pt)
      }
      if (coords.length < 2) continue
      layers.add(layer.id)
      features.push({
        type: 'Feature',
        properties: {
          layer: layer.id, mode, name: nameOf?.(layer.id) ?? layer.id,
          elevation: n ? Math.round((sum / n) * 10) / 10 : null,
        },
        geometry: { type: 'LineString', coordinates: coords },
      })
    }
  }
  const geojson = { type: 'FeatureCollection', features }
  // The pre-2016 `crs` member: RFC 7946 dropped it for WGS84 only, but QGIS and
  // GDAL still read it, and it is what keeps these lines in the raster's grid.
  const code = /^EPSG:(\d+)$/.exec(crs ?? '')?.[1]
  if (code) geojson.crs = { type: 'name', properties: { name: `urn:ogc:def:crs:EPSG::${code}` } }
  return { geojson, lines: features.length, layers: layers.size }
}

// A millimetre in metres, and well below a pixel in degrees.
const round = (v) => Math.round(v * 1e6) / 1e6
