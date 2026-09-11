/**
 * Terrain by name.
 *
 * Every session used to begin with a problem the app did not help with: finding
 * a heightmap. erzberg would fetch roads, rivers, rail and peaks for an extent
 * from OpenStreetMap, and it would not fetch the ground under them. Everything
 * downstream already worked — the CRS handling, the elevation metadata, the
 * vector overlay, the contour heights in metres — and the missing piece was one
 * fetch.
 *
 * ── The promise this has to keep ─────────────────────────────────────────────
 * The README's claim is that the app makes no third-party request *on load* and
 * that your files never leave the machine. Overpass already breaks neither: it
 * runs on demand, and it uploads nothing but a bounding box. This is the same
 * shape, and the same three rules hold it there:
 *
 *  1. **Nothing happens until a button is pressed.** No prefetch, no
 *     autocomplete on keystroke, no warming a cache. `tests/no-third-party.spec.js`
 *     is what keeps that true on load.
 *  2. **No key, no account, no sign-up.** Both services below are open and
 *     anonymous, so there is nothing in the bundle to leak and nothing to expire.
 *  3. **The app works without it.** Load a GeoTIFF, load a PNG, drop in a sound
 *     file: every existing path is untouched, and this is one more door.
 *
 * ── What is asked, and of whom ───────────────────────────────────────────────
 * **Nominatim**, for turning a typed name into a bounding box. OpenStreetMap's
 * own geocoder, ODbL, no key. Its usage policy caps automated use at one request
 * a second and asks that nobody wire it to a keystroke — which is why the search
 * below runs on submit and never as you type.
 *
 * **Terrain Tiles on AWS Open Data**, for the ground itself. The Mapzen terrarium
 * encoding: elevation in metres packed into an ordinary PNG, one byte-triple per
 * pixel. No key, `Access-Control-Allow-Origin: *`, and — unusually and usefully —
 * each tile names the survey it came from in a response header, so the credit
 * this app shows is the actual provenance of the ground on screen rather than a
 * boilerplate list.
 */

/** Where a typed name is resolved. OpenStreetMap's own geocoder. */
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

/** Where the ground comes from. Mapzen's terrarium encoding, hosted by AWS. */
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'

/** Tiles are 256 px square, which fixes every raster size this module returns. */
const TILE = 256

/**
 * The most tiles one press may pull.
 *
 * 36 is a 1 536 px raster, which the app already handles comfortably and which
 * is a couple of megabytes over the wire. The cap is a promise to the tile host
 * as much as to the user: a request for a whole country at full zoom is not a
 * feature, it is an outage somebody else pays for.
 */
export const MAX_TILES = 36

/**
 * The deepest zoom the dataset carries real detail at.
 *
 * Terrarium is published deeper, and deeper is upsampling: the underlying
 * surveys are 30 m at best over most of the world, which zoom 14 already
 * resolves. Asking for 15 doubles the tiles and adds no ground truth.
 */
export const MAX_ZOOM = 14

export const GEOCODER_CREDIT = 'Place search: © OpenStreetMap contributors (Nominatim), ODbL'
export const DEM_CREDIT =
  'Elevation: Terrain Tiles on AWS Open Data — SRTM, GMTED2010, EU-DEM, 3DEP and other national surveys'

// ── Web Mercator ─────────────────────────────────────────────────────────────
// The tiles are EPSG:3857, which the app's CRS table already knows how to
// unproject — so a fetched raster arrives georeferenced exactly like a GeoTIFF
// and needs no special case anywhere downstream.

const EARTH_HALF = 20037508.342789244

const lonToTileX = (lon, z) => ((lon + 180) / 360) * 2 ** z
const latToTileY = (lat, z) => {
  const r = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}

/**
 * The deepest zoom whose tile cover fits inside the budget.
 *
 * Walks down from the finest rather than solving for it, because the tile count
 * is a step function of the zoom — a bbox straddling a tile boundary costs an
 * extra row — and the arithmetic for that is longer than the loop.
 */
export function zoomForExtent(bbox, maxTiles = MAX_TILES) {
  if (!bbox) return null
  for (let z = MAX_ZOOM; z >= 0; z--) {
    if (tileRange(bbox, z).count <= maxTiles) return z
  }
  return 0
}

/** Which tiles cover a WGS84 bbox at one zoom. `[minLon, minLat, maxLon, maxLat]`. */
export function tileRange([minLon, minLat, maxLon, maxLat], z) {
  const n = 2 ** z
  const clamp = (v) => Math.max(0, Math.min(n - 1, v))
  const x0 = clamp(Math.floor(lonToTileX(minLon, z)))
  const x1 = clamp(Math.floor(lonToTileX(maxLon, z)))
  // Tile rows run north to south, so the *maximum* latitude is the first row.
  const y0 = clamp(Math.floor(latToTileY(maxLat, z)))
  const y1 = clamp(Math.floor(latToTileY(minLat, z)))
  return { z, x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) }
}

/**
 * Resolve a typed place to candidates.
 *
 * On submit only. Nominatim's usage policy asks that nobody attach it to a
 * keystroke, and the app has no business sending one request per letter of
 * "Kaisergebirge" whatever the policy said.
 *
 * @returns {Promise<{name:string, detail:string, bbox:number[], lat:number, lon:number}[]>}
 */
export async function geocodePlace(query, { signal, limit = 5 } = {}) {
  const q = String(query ?? '').trim()
  if (!q) return []
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=jsonv2&limit=${limit}`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Place search failed (${res.status}).`)
  const rows = await res.json()
  return (Array.isArray(rows) ? rows : []).map((r) => {
    // Nominatim orders its box [minLat, maxLat, minLon, maxLon], which is not
    // the order anything else here uses.
    const [s, n, w, e] = (r.boundingbox ?? []).map(Number)
    if (![s, n, w, e].every(Number.isFinite)) return null
    const full = String(r.display_name ?? r.name ?? q)
    return {
      name: String(r.name || full.split(',')[0]),
      detail: full,
      kind: String(r.type ?? ''),
      lat: Number(r.lat), lon: Number(r.lon),
      bbox: [w, s, e, n],
    }
  }).filter(Boolean)
}

/**
 * A bbox grown to a minimum size, centred where it was.
 *
 * A summit resolves to a bounding box a few metres across — the node itself —
 * and a DEM of one point is not a terrain. Everything the tool does needs an
 * *area*, so a named point becomes the ground around it. Degrees of longitude
 * shrink with latitude, which is why the two axes are not the same number.
 */
export function padBbox([minLon, minLat, maxLon, maxLat], km = 6) {
  const midLat = (minLat + maxLat) / 2
  const dLat = km / 110.574
  const dLon = km / (111.320 * Math.max(0.05, Math.cos((midLat * Math.PI) / 180)))
  const halfLat = Math.max(dLat, (maxLat - minLat) / 2)
  const halfLon = Math.max(dLon, (maxLon - minLon) / 2)
  const midLon = (minLon + maxLon) / 2
  return [midLon - halfLon, midLat - halfLat, midLon + halfLon, midLat + halfLat]
}

/**
 * One terrarium tile, decoded to metres.
 *
 * `createImageBitmap` rather than an `<img>`: the bytes are already in hand from
 * `fetch`, and an Image would fetch them a second time and then need
 * `crossOrigin` set correctly to avoid tainting the canvas it is drawn to.
 *
 * The encoding is Mapzen's: elevation, in metres, offset by 32 768 and packed
 * big-endian across the three colour channels with the blue byte carrying the
 * fractional part. Ocean is not a hole — it carries real bathymetry.
 */
async function fetchTile(z, x, y, signal) {
  const res = await fetch(`${TERRARIUM}/${z}/${x}/${y}.png`, { signal })
  if (!res.ok) throw new Error(`Tile ${z}/${x}/${y} failed (${res.status}).`)
  // Exposed by the bucket's CORS policy, and it names the actual survey this
  // ground came from — better provenance than any fixed credit line.
  const source = res.headers.get('x-amz-meta-x-imagery-sources')
  const bitmap = await createImageBitmap(await res.blob())
  const canvas = new OffscreenCanvas(TILE, TILE)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  const { data } = ctx.getImageData(0, 0, TILE, TILE)
  const out = new Float32Array(TILE * TILE)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768
  }
  return { pixels: out, source }
}

/**
 * Fetch the ground under a WGS84 bounding box.
 *
 * Tiles are stitched into one raster and then cropped to the box that was asked
 * for, so "Erzberg" gives the Erzberg rather than the four tiles it happens to
 * fall across.
 *
 * Sequential rather than parallel, on purpose. Thirty-six tiles fired at once is
 * a burst a shared open-data bucket has no reason to absorb, the progress bar
 * becomes meaningful, and Cancel can stop it between any two.
 *
 * @returns {Promise<{pixels:Float32Array, width:number, height:number,
 *   bbox:number[], crs:string, elevMin:number, elevMax:number,
 *   sources:string[], zoom:number, groundMetres:number}>}
 *   `bbox` is EPSG:3857, which is what the raster is in.
 */
export async function fetchDem(bboxWgs84, { signal, onProgress, maxTiles = MAX_TILES } = {}) {
  const z = zoomForExtent(bboxWgs84, maxTiles)
  if (z == null) throw new Error('That extent cannot be fetched.')
  const { x0, x1, y0, y1, count } = tileRange(bboxWgs84, z)

  const cols = x1 - x0 + 1, rows = y1 - y0 + 1
  const stitchW = cols * TILE, stitchH = rows * TILE
  const stitched = new Float32Array(stitchW * stitchH)
  const sources = new Set()

  let done = 0
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { pixels, source } = await fetchTile(z, tx, ty, signal)
      if (source) sources.add(source)
      const ox = (tx - x0) * TILE, oy = (ty - y0) * TILE
      for (let r = 0; r < TILE; r++) {
        stitched.set(pixels.subarray(r * TILE, r * TILE + TILE), (oy + r) * stitchW + ox)
      }
      onProgress?.(++done / count)
    }
  }

  // ── Crop to what was asked for ────────────────────────────────────────────
  // Tile coordinates are fractional, so the requested box lands somewhere inside
  // the stitched sheet rather than on its edge.
  const fx0 = (lonToTileX(bboxWgs84[0], z) - x0) * TILE
  const fx1 = (lonToTileX(bboxWgs84[2], z) - x0) * TILE
  const fy0 = (latToTileY(bboxWgs84[3], z) - y0) * TILE
  const fy1 = (latToTileY(bboxWgs84[1], z) - y0) * TILE
  const cx0 = Math.max(0, Math.floor(fx0)), cy0 = Math.max(0, Math.floor(fy0))
  const cx1 = Math.min(stitchW, Math.ceil(fx1)), cy1 = Math.min(stitchH, Math.ceil(fy1))
  const width = Math.max(1, cx1 - cx0), height = Math.max(1, cy1 - cy0)

  const pixels = new Float32Array(width * height)
  let elevMin = Infinity, elevMax = -Infinity
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const v = stitched[(cy0 + r) * stitchW + cx0 + c]
      pixels[r * width + c] = v
      if (v < elevMin) elevMin = v
      if (v > elevMax) elevMax = v
    }
  }

  // The cropped raster's own extent, in the projection it is actually in.
  const world = 2 * EARTH_HALF
  const mercPerPx = world / (2 ** z * TILE)
  const originX = -EARTH_HALF + (x0 * TILE + cx0) * mercPerPx
  const originY = EARTH_HALF - (y0 * TILE + cy0) * mercPerPx
  const bbox = [originX, originY - height * mercPerPx, originX + width * mercPerPx, originY]

  return {
    pixels, width, height, bbox, crs: 'EPSG:3857',
    elevMin, elevMax, zoom: z, tiles: count,
    sources: [...sources].sort(),
    // Web Mercator overstates ground distance by 1/cos(lat), so the honest
    // figure divides it back out. Only used to describe the fetch in the panel;
    // the scale bar asks `groundPixelMetres`, which goes through WGS84.
    groundMetres: mercPerPx * Math.cos((((bboxWgs84[1] + bboxWgs84[3]) / 2) * Math.PI) / 180),
  }
}

/**
 * Normalise a fetched DEM into the 0…1 raster the rest of the app consumes.
 *
 * Exactly what the GeoTIFF loader does with a band it has read, and for the same
 * reason: everything downstream — the mesh, the histogram, the draw modes —
 * works in normalised brightness, and the real metres live in the store's
 * elevation metadata beside it.
 */
export function demToHeightmap({ pixels, width, height, elevMin, elevMax }) {
  const range = Math.max(1e-6, elevMax - elevMin)
  const out = new Float32Array(pixels.length)
  const mask = new Uint8Array(pixels.length).fill(1)
  for (let i = 0; i < pixels.length; i++) out[i] = (pixels[i] - elevMin) / range
  return { pixels: out, nodataMask: mask, width, height }
}
