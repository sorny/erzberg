/**
 * Pictures of the ground from elsewhere, laid on the raster's grid for the
 * imagery drape: a georeferenced image with its world file, or a mosaic of web
 * map tiles.
 *
 * Both end as RGBA pixels over the raster's extent, the shape the Sentinel-2
 * fetch already gives, so the drape, its tone controls and the Mask Studio
 * backdrop take them unchanged. Each picture pixel is traced back: raster pixel
 * → the raster's coordinates → longitude and latitude → the source's own
 * coordinates → the source pixel.
 */
import { converterFromWkt, groundPixelMetres, projectWgs84, unprojectWgs84 } from './geoCoords'
import { tileMetres, tileOf } from './webTiles'

/** The longest side of a drape this builds, in pixels. */
const MAX_SIDE = 2048

/** The six numbers of a world file: A, D, B, E, C, F. */
export function parseWorldFile(text) {
  const n = String(text ?? '').trim().split(/\s+/).map(Number)
  if (n.length < 6 || n.slice(0, 6).some((v) => !Number.isFinite(v))) return null
  const [A, D, B, E, C, F] = n
  if (A * E - B * D === 0) return null
  return { A, D, B, E, C, F }
}

/** The source pixel [col, row] at a point, from the world file's affine. */
export function worldToPixel(w, X, Y) {
  // X = A·i + B·j + C and Y = D·i + E·j + F, at pixel centres.
  const det = w.A * w.E - w.B * w.D
  const dx = X - w.C, dy = Y - w.F
  return [(w.E * dx - w.B * dy) / det + 0.5, (-w.D * dx + w.A * dy) / det + 0.5]
}

/** The projection a GDAL side file names, as WKT or an EPSG code. */
export function auxSrs(text) {
  const m = /<SRS[^>]*>([\s\S]*?)<\/SRS>/i.exec(String(text ?? ''))
  return m ? m[1].trim().replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null
}

/**
 * WGS84 → the source's coordinates, from a .prj WKT or an SRS string. Null
 * means the source is in the raster's own projection.
 */
export function sourceProjection(srs) {
  if (!srs) return null
  if (/^EPSG:\d+$/i.test(srs.trim())) {
    const code = srs.trim().toUpperCase()
    return (lat, lon) => projectWgs84(lat, lon, code)
  }
  const conv = converterFromWkt(srs)
  if (!conv) throw new Error('The projection file could not be read.')
  return (lat, lon) => conv.fromWgs84([lon, lat])
}

/** The size of the drape over a raster: its aspect, at most MAX_SIDE a side. */
function drapeSize(raster) {
  const k = Math.min(1, MAX_SIDE / Math.max(raster.width, raster.height))
  return { w: Math.max(1, Math.round(raster.width * k)), h: Math.max(1, Math.round(raster.height * k)) }
}

/** Calls `fn(o, X, Y)` for the centre of each drape pixel, in the raster's coordinates. */
function eachDrapePixel(raster, w, h, fn) {
  const [minX, minY, maxX, maxY] = raster.bbox
  for (let r = 0; r < h; r++) {
    const Y = maxY - ((r + 0.5) / h) * (maxY - minY)
    for (let c = 0; c < w; c++) fn((r * w + c) * 4, minX + ((c + 0.5) / w) * (maxX - minX), Y)
  }
}

/**
 * A georeferenced image → a drape over the raster.
 *
 * @param {{data, width, height}} image  the source pixels, RGBA
 * @param {object} world   from `parseWorldFile`
 * @param {string|null} srs  the source's projection, or null for the raster's
 * @param {{bbox, crs, width, height}} raster
 */
export function worldImageDrape(image, world, srs, raster) {
  const toSource = sourceProjection(srs)
  const { w, h } = drapeSize(raster)
  const rgba = new Uint8ClampedArray(w * h * 4)
  let covered = 0
  eachDrapePixel(raster, w, h, (o, X, Y) => {
    let sx = X, sy = Y
    if (toSource) {
      const ll = unprojectWgs84(X, Y, raster.crs)
      const g = ll && toSource(ll[0], ll[1])
      if (!g) return
      sx = g[0]; sy = g[1]
    }
    const [pc, pr] = worldToPixel(world, sx, sy)
    const c = Math.floor(pc), r = Math.floor(pr)
    if (c < 0 || r < 0 || c >= image.width || r >= image.height) return
    const i = (r * image.width + c) * 4
    rgba[o] = image.data[i]; rgba[o + 1] = image.data[i + 1]; rgba[o + 2] = image.data[i + 2]; rgba[o + 3] = image.data[i + 3]
    if (image.data[i + 3]) covered++
  })
  return { rgba, width: w, height: h, coverage: covered / (w * h) }
}

// ── Web map tiles ─────────────────────────────────────────────────────────────

/**
 * Tile hosts a plate may ask, each on a press of Fetch and never otherwise.
 * Each allows this use under its terms, with the credit given. The public
 * OpenStreetMap tile server is not here: its policy forbids downloading tiles
 * for use elsewhere.
 */
export const TILE_SOURCES = [
  { id: 'opentopomap', label: 'OpenTopoMap', maxZoom: 17,
    url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
    credit: 'Map: © OpenTopoMap (CC-BY-SA), data © OpenStreetMap contributors, SRTM' },
  { id: 'basemapat', label: 'basemap.at (Austria)', maxZoom: 19,
    url: 'https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png',
    credit: 'Map: basemap.at (CC-BY 4.0)' },
  { id: 'basemapat-ortho', label: 'basemap.at orthophoto', maxZoom: 19,
    url: 'https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
    credit: 'Orthophoto: basemap.at (CC-BY 4.0)' },
  { id: 'swisstopo', label: 'swisstopo national map', maxZoom: 18,
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
    credit: 'Map: © swisstopo' },
]

/** The most tiles one fetch asks for. */
export const MAX_TILES = 64

/**
 * The zoom whose tiles match the raster's pixel size, coarsened until the
 * extent needs at most `MAX_TILES`.
 */
export function tileZoomFor(boxWgs84, metresPerPixel, maxZoom = 19) {
  const [w, s, e, n] = boxWgs84
  const lat = (s + n) / 2
  let z = Math.min(maxZoom, Math.max(1, Math.round(Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.max(metresPerPixel, 0.1)))))
  const count = (zz) => {
    const [x0, y0] = tileOf(w, n, zz), [x1, y1] = tileOf(e, s, zz)
    return (x1 - x0 + 1) * (y1 - y0 + 1)
  }
  while (z > 1 && count(z) > MAX_TILES) z--
  return z
}

/** The URL of one tile from a template with {z}, {x} and {y}. */
export const tileUrl = (template, z, x, y) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y)

/**
 * Web map tiles → a drape over the raster. Fetches the tiles, stitches them
 * and traces each drape pixel into the mosaic.
 */
export async function tileDrape(source, raster, boxWgs84, { onProgress, signal } = {}) {
  const g = groundPixelMetres(raster.bbox, raster.crs, raster.width, raster.height)
  const metres = g ? Math.max(g.x, g.y) * Math.max(1, Math.max(raster.width, raster.height) / MAX_SIDE) : 30
  const z = tileZoomFor(boxWgs84, metres, source.maxZoom ?? 19)
  const [w, s, e, n] = boxWgs84
  const [x0, y0] = tileOf(w, n, z), [x1, y1] = tileOf(e, s, z)
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1
  const mosaic = document.createElement('canvas')
  mosaic.width = nx * 256; mosaic.height = ny * 256
  const ctx = mosaic.getContext('2d')
  let done = 0, failed = 0
  const jobs = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y])
  // Four at a time: polite to the host, and quick enough for 64 tiles.
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const [x, y] = jobs[next++]
      try {
        const res = await fetch(tileUrl(source.url, z, x, y), { signal, mode: 'cors' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const bmp = await createImageBitmap(await res.blob())
        ctx.drawImage(bmp, (x - x0) * 256, (y - y0) * 256, 256, 256)
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        failed++
      }
      onProgress?.(++done / jobs.length)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  if (failed === jobs.length) throw new Error(`${source.label} sent none of its ${jobs.length} tiles.`)
  const tiles = ctx.getImageData(0, 0, mosaic.width, mosaic.height).data

  const { w: dw, h: dh } = drapeSize(raster)
  const rgba = new Uint8ClampedArray(dw * dh * 4)
  const N = 2 ** z * 256
  eachDrapePixel(raster, dw, dh, (o, X, Y) => {
    const ll = unprojectWgs84(X, Y, raster.crs)
    if (!ll) return
    const [lat, lon] = ll
    const r = (lat * Math.PI) / 180
    const gx = ((lon + 180) / 360) * N - x0 * 256
    const gy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N - y0 * 256
    const c = Math.floor(gx), rr = Math.floor(gy)
    if (c < 0 || rr < 0 || c >= mosaic.width || rr >= mosaic.height) return
    const i = (rr * mosaic.width + c) * 4
    rgba[o] = tiles[i]; rgba[o + 1] = tiles[i + 1]; rgba[o + 2] = tiles[i + 2]; rgba[o + 3] = tiles[i + 3]
  })
  return { rgba, width: dw, height: dh, zoom: z, tiles: jobs.length, failed, metres: tileMetres(z, (s + n) / 2) }
}
