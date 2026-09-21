/**
 * Satellite imagery for the extent on screen.
 *
 * Two jobs, and the second is the one that matters. It drapes over the terrain,
 * which is worth having on its own. And it backs the Mask Studio, where you are
 * drawing a stencil by hand and need to see the ground you are drawing it
 * around — a mask painted over a grey hillshade is a guess.
 *
 * ── Why this one *can* be a button ───────────────────────────────────────────
 * The land cover plates cannot be fetched from the page: AlphaEarth's bucket
 * serves anonymous ranged reads to anyone and sends no `access-control-*`
 * header, so a browser is refused where a terminal is not. Sentinel-2 on AWS
 * Open Data answers `Access-Control-Allow-Origin: *` on a ranged GET, which is
 * the whole difference. No key, no account, no proxy — the same terms as the
 * terrain tiles and the Overpass query, and it keeps every promise the README
 * makes: nothing happens until the button is pressed.
 *
 * ── Why Sentinel-2 and not the prettier options ──────────────────────────────
 * Licence, not resolution.
 *
 * **EOX s2cloudless** is a beautiful cloudless mosaic at the same 10 m, and it
 * is CC BY-NC-SA. Non-commercial and ShareAlike would attach to every plate
 * exported through it, which is not a condition this tool may impose on its
 * users' artwork.
 *
 * **Esri World Imagery** is sharper again and serves anyone, and it is
 * commercial imagery whose redistribution terms do not clearly cover a plate
 * printed from it.
 *
 * **NASA GIBS** is unambiguously open and 250 m, which over a 4 km window is
 * sixteen pixels across.
 *
 * Copernicus Sentinel data is free, full and open, commercial use included,
 * against one line of attribution. That is the same shape as the CC-BY on the
 * embeddings and the ODbL on OpenStreetMap, and `utils/attribution.js` already
 * knows what to do with it.
 *
 * ── What is actually read ────────────────────────────────────────────────────
 * The `visual` asset of a Sentinel-2 L2A scene — `TCI.tif`, a three-band 8-bit
 * true-colour COG at 10 m, north-up, with a full overview pyramid. One file
 * rather than three bands to combine and rescale, and the tiling means a window
 * costs a few hundred kilobytes of an otherwise 300 MB scene.
 */
import { bboxToWgs84, classifyCRS, projectWgs84, unprojectWgs84 } from './geoCoords.js'

/** Scene discovery. Open, no key, and it answers CORS. */
const STAC = 'https://earth-search.aws.element84.com/v1/search'
const COLLECTION = 'sentinel-2-l2a'

/** The one line the Copernicus licence asks for. */
export const IMAGERY_CREDIT = 'Imagery: Contains modified Copernicus Sentinel data, processed by ESA'

/**
 * The most imagery pixels worth fetching for one drape.
 *
 * This is a backdrop and a texture, not a measurement. Past a couple of
 * thousand across, the extra detail is smaller than a screen pixel at any
 * camera the app offers, and every output pixel costs a coordinate transform —
 * an 8k raster would be sixty-seven million of them.
 */
const MAX_SIDE = 2048

/**
 * Scenes over an extent, least cloudy first.
 *
 * Sorted by cloud rather than filtered by it: a hard cut returns nothing at all
 * over places that are simply cloudy, and the honest answer there is the best
 * available scene plus the number, which the panel prints so the reader can
 * decide for themselves.
 */
/**
 * Months a backdrop wants to come from.
 *
 * Cloud cover alone is the wrong sort, and the Erzberg is the case that shows
 * why: the clearest scene over it in the whole archive is the first of March at
 * 0% cloud, and it is under snow. A white mountain is a beautiful photograph
 * and useless as something to draw a mask around — the boundary between worked
 * rock and forest, which is the distinction you are almost always after, simply
 * is not in it.
 *
 * So the default search asks for the growing season of recent years and sorts
 * *that* by cloud. May to September in the north, November to March in the
 * south, chosen by the latitude of the extent rather than assumed.
 */
function seasonalRange(bboxWgs84, years = 3) {
  const midLat = (bboxWgs84[1] + bboxWgs84[3]) / 2
  const now = new Date()
  const endYear = now.getUTCFullYear()
  const northern = midLat >= 0
  return {
    from: `${endYear - years}-01-01`,
    to: `${endYear}-12-31`,
    months: northern ? [5, 6, 7, 8, 9] : [11, 12, 1, 2, 3],
  }
}

export async function findScenes(bboxWgs84, { from, to, limit = 50, signal, seasonal = true } = {}) {
  const season = seasonal ? seasonalRange(bboxWgs84) : null
  const start = from ?? season?.from
  const end = to ?? season?.to

  const body = {
    collections: [COLLECTION],
    bbox: bboxWgs84,
    limit,
    sortby: [{ field: 'properties.eo:cloud_cover', direction: 'asc' }],
  }
  if (start && end) body.datetime = `${start}T00:00:00Z/${end}T23:59:59Z`

  const res = await fetch(STAC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`Scene search answered ${res.status}.`)
  const json = await res.json()

  const all = (json.features ?? [])
    .filter((f) => f.assets?.visual?.href)
    .map((f) => ({
      id: f.id,
      href: f.assets.visual.href,
      date: (f.properties?.datetime ?? '').slice(0, 10),
      cloud: Number(f.properties?.['eo:cloud_cover'] ?? 0),
      epsg: f.properties?.['proj:epsg'] ?? null,
    }))

  if (!season) return all
  // The month filter is applied here rather than in the query because STAC has
  // no way to ask for "every August". Falling back to the unfiltered list keeps
  // a somewhere-always-cloudy extent working rather than returning nothing.
  const inSeason = all.filter((s) => season.months.includes(Number(s.date.slice(5, 7))))
  return inSeason.length ? inSeason : all
}

/** The affine a north-up GeoTIFF states about itself. */
function affineOf(image) {
  const fd = image.fileDirectory
  const get = (k) => fd[k] ?? fd.getValue?.(k)
  const scale = get('ModelPixelScale')
  const tie = get('ModelTiepoint')
  if (scale && tie) return { ox: tie[3], oy: tie[4], px: scale[0], py: scale[1] }
  const m = get('ModelTransformation')
  if (m) return { ox: m[3], oy: m[7], px: m[0], py: -m[5] }
  throw new Error('That scene carries no affine transformation.')
}

/**
 * Two grids, and the cheapest correct way between them.
 *
 * When the raster and the scene are in the same projection — which is the
 * common case, because both tend to be the UTM zone the ground is in — the map
 * between them is linear and needs no trigonometry at all. Otherwise every
 * output pixel goes out to WGS84 and back, which is correct everywhere and
 * about forty times the cost.
 */
function mapperFor(rasterCrs, sceneCrs) {
  const a = classifyCRS(rasterCrs), b = classifyCRS(sceneCrs)
  const same = a.supported && b.supported && a.kind === b.kind &&
               a.zone === b.zone && a.isSouth === b.isSouth
  if (same) return (x, y) => [x, y]
  return (x, y) => {
    const ll = unprojectWgs84(x, y, rasterCrs)
    return ll ? projectWgs84(ll[0], ll[1], sceneCrs) : null
  }
}

/**
 * One scene, resampled onto the raster's own grid.
 *
 * Backwards per output pixel, like every resampler here and for the same
 * reason: pushing source pixels forward leaves holes wherever the two grids
 * diverge. Bilinear would be defensible on continuous colour, and nearest is
 * what this uses — the result is about to be a backdrop under a stencil being
 * drawn by hand, and a sharp boundary is worth more than a smooth one.
 */
export async function fetchImagery(scene, raster, { onProgress, signal } = {}) {
  const { bbox, crs, width: rw, height: rh } = raster
  if (!bbox || !crs) throw new Error('Satellite imagery needs a georeferenced raster.')

  // Capped on the long side. The shape is kept so the drape lands square on the
  // terrain rather than stretched.
  const step = Math.max(1, Math.ceil(Math.max(rw, rh) / MAX_SIDE))
  const outW = Math.max(1, Math.floor(rw / step))
  const outH = Math.max(1, Math.floor(rh / step))

  onProgress?.(0.05)
  const { fromUrl } = await import('geotiff')
  const image = await (await fromUrl(scene.href)).getImage()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const af = affineOf(image)
  const sceneCrs = scene.epsg ? `EPSG:${scene.epsg}` : crs
  const toScene = mapperFor(crs, sceneCrs)
  const sw = image.getWidth(), sh = image.getHeight()

  // The scene window the output actually needs, found from the output's own
  // corners and edges — a projected extent bows, so the corners alone can miss
  // what sags outside them.
  const [x0, y0, x1, y1] = bbox
  let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    for (const [wx, wy] of [[x0 + t * (x1 - x0), y0], [x0 + t * (x1 - x0), y1],
                            [x0, y0 + t * (y1 - y0)], [x1, y0 + t * (y1 - y0)]]) {
      const s = toScene(wx, wy)
      if (!s) throw new Error(`${crs} cannot be matched to the scene's ${sceneCrs}.`)
      const c = (s[0] - af.ox) / af.px, r = (af.oy - s[1]) / af.py
      if (c < minC) minC = c; if (c > maxC) maxC = c
      if (r < minR) minR = r; if (r > maxR) maxR = r
    }
  }
  const left = Math.max(0, Math.floor(minC) - 1), top = Math.max(0, Math.floor(minR) - 1)
  const right = Math.min(sw, Math.ceil(maxC) + 1), bottom = Math.min(sh, Math.ceil(maxR) + 1)
  if (right <= left || bottom <= top) {
    throw new Error('That scene does not cover this ground.')
  }

  onProgress?.(0.2)
  const bands = await image.readRasters({ window: [left, top, right, bottom], samples: [0, 1, 2] })
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const winW = right - left
  onProgress?.(0.7)

  const rgba = new Uint8ClampedArray(outW * outH * 4)
  for (let r = 0; r < outH; r++) {
    // Output row to world northing, north-up on the raster's side.
    const wy = y1 - ((r + 0.5) / outH) * (y1 - y0)
    for (let c = 0; c < outW; c++) {
      const wx = x0 + ((c + 0.5) / outW) * (x1 - x0)
      const s = toScene(wx, wy)
      const o = (r * outW + c) * 4
      if (!s) continue
      const sc = Math.floor((s[0] - af.ox) / af.px) - left
      const sr = Math.floor((af.oy - s[1]) / af.py) - top
      if (sc < 0 || sr < 0 || sc >= winW || sr >= bottom - top) continue
      const i = sr * winW + sc
      rgba[o] = bands[0][i]; rgba[o + 1] = bands[1][i]; rgba[o + 2] = bands[2][i]
      // A Sentinel-2 scene is a rotated square inside its own grid, so the
      // corners of a window near its edge are genuinely empty. Transparent
      // rather than black: the terrain shows through instead of a false shadow.
      rgba[o + 3] = 255
    }
  }
  onProgress?.(1)

  return {
    rgba, width: outW, height: outH,
    sceneId: scene.id, date: scene.date, cloud: scene.cloud,
    credit: IMAGERY_CREDIT,
  }
}

/** The extent to search over, in the lon/lat the STAC API wants. */
export function searchBboxFor(bbox, crs) {
  return bboxToWgs84(bbox, crs)
}
