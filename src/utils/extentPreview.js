/**
 * The picture you draw the box on.
 *
 * ── Why this is not a basemap ────────────────────────────────────────────────
 * The obvious move is an OpenStreetMap raster basemap, and it is the wrong one
 * here for three reasons that all point the same way.
 *
 * It would be a fourth network service, and the first one that fetches while you
 * *pan* rather than when you press something — which is the promise
 * `tests/no-third-party.spec.js` exists to keep. It would put this app inside
 * OpenStreetMap's tile usage policy, which asks that heavy or automated use go
 * elsewhere. And it would show you roads and labels when the question on screen
 * is *where is the ground interesting*.
 *
 * So the preview is drawn from the same terrarium tiles the fetch itself uses.
 * No new host, no new CORS question, no new policy, and the map is literally the
 * dataset you are about to download — a preview that cannot lie about coverage,
 * because it is the coverage.
 *
 * What it costs is labels. You arrive at the right place through the geocoder,
 * which is unchanged, and then adjust the box against visible relief. For a tool
 * whose whole subject is relief, that trade is the right way round.
 *
 * ── The budget ───────────────────────────────────────────────────────────────
 * A preview is capped at nine tiles — a 768 px sheet, and a quarter of the
 * 36-tile budget the fetch itself may spend.
 *
 * Four was the first guess and it was visibly wrong. Tile cover is a step
 * function of the zoom, and a window that straddles two boundaries costs an
 * extra row and column: a 31 km window around the Erzberg needed 3 × 3 at
 * zoom 11 and so fell all the way to zoom 9, which drew half the Eastern Alps
 * with the selection a thumbnail in the middle of it. Nine tiles absorbs the
 * straddle and holds the window within one zoom of the one asked for.
 */
import { fetchTerrariumTile, tileRange, TILE } from './demFetch'

/** The most tiles one preview may pull. A quarter of the fetch budget. */
export const PREVIEW_TILES = 9

/** How far out the window sits from the box, before the user zooms it. */
export const DEFAULT_SPAN = 2.6

/**
 * A window around a box, widened by `span` and shaped to the canvas.
 *
 * The aspect correction is in *degrees*, not metres, because that is what the
 * tile maths downstream takes — and a degree of longitude is shorter than a
 * degree of latitude everywhere but the equator, so the correction carries a
 * cosine or the window comes out visibly squashed in the Alps.
 */
export function windowFor([minLon, minLat, maxLon, maxLat], span, aspect) {
  const midLon = (minLon + maxLon) / 2, midLat = (minLat + maxLat) / 2
  const cos = Math.max(0.05, Math.cos((midLat * Math.PI) / 180))
  // Half-extents in a common unit (degrees of latitude), so the wider axis
  // decides and the other is padded up to the canvas shape.
  let halfLat = ((maxLat - minLat) / 2) * span
  let halfLon = ((maxLon - minLon) / 2) * span
  const wantLon = halfLat * aspect / cos
  if (wantLon > halfLon) halfLon = wantLon
  else halfLat = (halfLon * cos) / aspect
  return [midLon - halfLon, midLat - halfLat, midLon + halfLon, midLat + halfLat]
}

/**
 * Shaded relief, as RGBA bytes.
 *
 * The same two readings the app already draws with — a hypsometric tint under a
 * hillshade — at the one setting that matters for a thumbnail: light from the
 * north-west, because upper-left light is what stops a viewer reading ridges as
 * valleys. The ramp is deliberately desaturated. This is a locator, and it must
 * not compete with the plate it sits beside.
 *
 * NoData does not arise here: terrarium carries real bathymetry, so the ocean is
 * ground at a negative height rather than a hole.
 */
function shadeRelief(pixels, width, height, metresPerPx) {
  const out = new Uint8ClampedArray(width * height * 4)
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i]
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const range = Math.max(1, hi - lo)

  // 315° azimuth, 45° altitude, as a unit vector towards the light.
  const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180
  const lx = Math.cos(alt) * Math.sin(az), ly = Math.cos(alt) * Math.cos(az), lz = Math.sin(alt)
  // Exaggerate, because at 300 m per pixel real slopes are almost flat.
  const zScale = 4 / Math.max(1, metresPerPx)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const xm = x > 0 ? i - 1 : i, xp = x < width - 1 ? i + 1 : i
      const ym = y > 0 ? i - width : i, yp = y < height - 1 ? i + width : i
      const dzdx = (pixels[xp] - pixels[xm]) * zScale
      const dzdy = (pixels[yp] - pixels[ym]) * zScale
      const inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1)
      const shade = Math.max(0.12, (-dzdx * lx - dzdy * ly + lz) * inv)

      const t = (pixels[i] - lo) / range
      // Low ground cool and dark, high ground warm and pale — four stops, kept
      // muted so the selection rectangle stays the brightest thing in the frame.
      let r, g, b
      if (t < 0.5) { const u = t / 0.5; r = 44 + u * 46; g = 62 + u * 46; b = 74 + u * 28 }
      else { const u = (t - 0.5) / 0.5; r = 90 + u * 86; g = 108 + u * 68; b = 102 + u * 44 }
      out[i * 4]     = r * shade * 1.7
      out[i * 4 + 1] = g * shade * 1.7
      out[i * 4 + 2] = b * shade * 1.7
      out[i * 4 + 3] = 255
    }
  }
  return out
}

/**
 * Fetch and shade the ground over a window.
 *
 * Returns the *tile-aligned* extent it actually drew rather than the window it
 * was asked for, because the caller has to place the selection rectangle on it
 * and a few hundred metres of drift would put the box somewhere else.
 *
 * @returns {Promise<{rgba:Uint8ClampedArray, width:number, height:number,
 *   bbox:number[], zoom:number}>} `bbox` is WGS84, matching the argument.
 */
export async function fetchPreview(windowBbox, { signal, maxTiles = PREVIEW_TILES } = {}) {
  let z = null, range = null
  for (let t = 14; t >= 0; t--) {
    const r = tileRange(windowBbox, t)
    if (r.count <= maxTiles) { z = t; range = r; break }
  }
  if (z == null) throw new Error('That window cannot be previewed.')

  const cols = range.x1 - range.x0 + 1, rows = range.y1 - range.y0 + 1
  const width = cols * TILE, height = rows * TILE
  const pixels = new Float32Array(width * height)

  for (let ty = range.y0; ty <= range.y1; ty++) {
    for (let tx = range.x0; tx <= range.x1; tx++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { pixels: tile } = await fetchTerrariumTile(z, tx, ty, signal)
      const ox = (tx - range.x0) * TILE, oy = (ty - range.y0) * TILE
      for (let r = 0; r < TILE; r++) {
        pixels.set(tile.subarray(r * TILE, r * TILE + TILE), (oy + r) * width + ox)
      }
    }
  }

  // The extent of the tiles as drawn, which is what the box is positioned in.
  const n = 2 ** z
  const lon = (x) => (x / n) * 360 - 180
  const lat = (y) => {
    const m = Math.PI * (1 - (2 * y) / n)
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(m) - Math.exp(-m)))
  }
  const bbox = [lon(range.x0), lat(range.y1 + 1), lon(range.x1 + 1), lat(range.y0)]

  const midLat = (bbox[1] + bbox[3]) / 2
  const metresPerPx = (40075016.686 * Math.cos((midLat * Math.PI) / 180)) / (n * TILE)
  return { rgba: shadeRelief(pixels, width, height, metresPerPx), width, height, bbox, zoom: z }
}
