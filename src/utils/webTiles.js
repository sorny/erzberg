/**
 * A plate as web map tiles: the XYZ pyramid that Leaflet, MapLibre and QGIS
 * read, in Web Mercator, 256 pixels a side.
 *
 * The plate is drawn once from straight above (the same capture the 3D models
 * use) in the raster's own grid. Each tile pixel is then traced back: tile
 * pixel → longitude and latitude → the raster's grid → the plate picture. So a
 * plate in UTM lands on the map where it belongs, with no second render.
 */

/** Longitude and latitude of a point on tile (x, y) at zoom z; fx, fy are 0–1 across it. */
export function tileLonLat(z, x, y, fx, fy) {
  const n = 2 ** z
  const lon = ((x + fx) / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + fy)) / n))) * 180) / Math.PI
  return [lon, lat]
}

/** The tile holding a point at zoom z. */
export function tileOf(lon, lat, z) {
  const n = 2 ** z
  const r = (lat * Math.PI) / 180
  return [
    Math.floor(((lon + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  ]
}

/** Every tile at zoom z that touches a WGS84 box [west, south, east, north]. */
export function tilesFor([w, s, e, n], z) {
  const [x0, y0] = tileOf(w, n, z), [x1, y1] = tileOf(e, s, z)
  const out = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y])
  return out
}

/** Ground metres per pixel of a tile at zoom z, at a latitude. */
export const tileMetres = (z, lat) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z

/**
 * One tile's RGBA pixels, traced back into the plate picture.
 *
 * @param {object} o
 * @param {number[]} o.tile        [z, x, y]
 * @param {(lat, lon) => number[]|null} o.toCrs  WGS84 → the raster's grid
 * @param {(X, Y) => number[]|null} o.toImage   the raster's grid → picture pixel [col, row]
 * @param {Uint8ClampedArray} o.image  the plate picture's RGBA
 * @param {number} o.width
 * @param {number} o.height
 * @returns {{ rgba: Uint8ClampedArray, empty: boolean }}
 */
export function renderTile({ tile: [z, x, y], toCrs, toImage, image, width, height, size = 256 }) {
  const rgba = new Uint8ClampedArray(size * size * 4)
  let empty = true
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const [lon, lat] = tileLonLat(z, x, y, (px + 0.5) / size, (py + 0.5) / size)
      const g = toCrs(lat, lon)
      const at = g && toImage(g[0], g[1])
      if (!at) continue
      const c = Math.floor(at[0]), r = Math.floor(at[1])
      if (c < 0 || r < 0 || c >= width || r >= height) continue
      const i = (r * width + c) * 4, o = (py * size + px) * 4
      rgba[o] = image[i]; rgba[o + 1] = image[i + 1]; rgba[o + 2] = image[i + 2]; rgba[o + 3] = image[i + 3]
      if (image[i + 3]) empty = false
    }
  }
  return { rgba, empty }
}

/**
 * A page that shows the tiles, for a first look.
 *
 * On a plain ground, with no base map: OpenStreetMap's servers refuse a page
 * opened from disk (`file://` sends no Referer, which their tile policy asks
 * for), so a base layer there came back as a wall of "Access blocked". The
 * tiles are the point; a GIS puts them over any base it likes.
 */
export function tilesIndex(title, [w, s, e, n], minZoom, maxZoom) {
  const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#map{height:100%;margin:0}#map{background:#e8e8e4}
.note{position:absolute;z-index:1000;left:10px;bottom:10px;max-width:420px;padding:6px 9px;
font:12px/1.45 system-ui,sans-serif;color:#333;background:rgba(255,255,255,.9);border-radius:4px}</style></head>
<body><div id="map"></div>
<div class="note">${esc(title)}, zoom ${minZoom} to ${maxZoom}. To see it over a base map, add this folder as an XYZ layer in QGIS (<code>file:///…/{z}/{x}/{y}.png</code>) or in your own Leaflet or MapLibre page.</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const map = L.map('map', { minZoom: ${Math.max(0, minZoom - 2)}, maxZoom: ${maxZoom + 3} }).fitBounds([[${s}, ${w}], [${n}, ${e}]])
L.tileLayer('{z}/{x}/{y}.png', { minZoom: ${minZoom}, maxZoom: 19, maxNativeZoom: ${maxZoom}, minNativeZoom: ${minZoom},
  bounds: [[${s}, ${w}], [${n}, ${e}]], attribution: 'erzberg' }).addTo(map)
</script></body></html>
`
}
