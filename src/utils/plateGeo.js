/**
 * The plate as a georeferenced picture: a GeoTIFF, a PNG with a world file,
 * or a KMZ for Google Earth.
 *
 * The plate is drawn once from straight above, in the raster's own grid (the
 * capture the web tiles and the 3D models use). That picture is axis-aligned in
 * the raster's coordinate system, so its georeference is one affine: an origin
 * and a pixel size. The GeoTIFF and the world file write that affine. A KMZ
 * needs the picture in longitude and latitude, so each of its pixels is traced
 * back into the picture, as a web tile's are.
 */
import { geoKeysFor } from './heightmapExport'
import { projectWgs84 } from './geoCoords'

/**
 * The affine of a capture: the coordinates of the picture's upper-left corner
 * and the size of one picture pixel, in the raster's units. `Y` falls down the
 * picture.
 *
 * `cap` is what `planCaptureRef` returns: the canvas and its bounds in STL axes
 * (x, and y = −world z). One world unit is one raster pixel, offset by the
 * half extent and the grid's own offsets.
 */
export function plateAffine(cap, raster) {
  const { canvas, bounds: b, halfW, halfH } = cap
  const { bbox, width: W, height: H, peakOff = 0, lineOff = 0 } = raster
  const kx = (bbox[2] - bbox[0]) / W, ky = (bbox[3] - bbox[1]) / H
  return {
    x0: bbox[0] + (b.minX + peakOff + halfW) * kx,
    y0: bbox[3] - (-b.maxY + lineOff + halfH) * ky,
    px: ((b.maxX - b.minX) / canvas.width) * kx,
    py: ((b.maxY - b.minY) / canvas.height) * ky,
    width: canvas.width, height: canvas.height,
  }
}

/** The picture pixel [col, row] under a point in the raster's coordinates. */
export const pictureAt = (a, X, Y) => [(X - a.x0) / a.px, (a.y0 - Y) / a.py]

/**
 * An ESRI world file: pixel width, two rotations, minus the pixel height, then
 * the centre of the upper-left pixel.
 */
export function worldFile(a) {
  return [a.px, 0, 0, -a.py, a.x0 + a.px / 2, a.y0 - a.py / 2].map((v) => v.toFixed(10)).join('\n') + '\n'
}

/**
 * A GDAL side file naming the projection, so a GIS opens the PNG in place
 * without being told. GDAL reads an EPSG code here as well as a WKT.
 */
export function auxXml(crs) {
  const m = /^EPSG:(\d+)$/.exec(crs ?? '')
  if (!m) return null
  return `<PAMDataset>\n  <SRS>EPSG:${m[1]}</SRS>\n</PAMDataset>\n`
}

/** The picture as an RGBA GeoTIFF in the raster's projection. */
export async function plateGeoTiff(rgba, a, crs) {
  const keys = geoKeysFor(crs)
  const metadata = {
    width: a.width, height: a.height,
    PhotometricInterpretation: 2,   // RGB
    ExtraSamples: [2],              // the fourth band is unassociated alpha
    ModelPixelScale: [a.px, a.py, 0],
    ModelTiepoint: [0, 0, 0, a.x0, a.y0, 0],
    GTRasterTypeGeoKey: 1,
    ...keys.keys,
  }
  const { writeArrayBuffer } = await import('geotiff')
  return { buffer: writeArrayBuffer(rgba, metadata), codeless: keys.codeless }
}

/**
 * The picture resampled onto a longitude–latitude grid over `box`
 * ([west, south, east, north]), `outW` pixels wide, for a KML ground overlay.
 */
export function toLonLatPicture(rgba, a, crs, box, outW = 2048) {
  const [w, s, e, n] = box
  const midLat = ((s + n) / 2) * (Math.PI / 180)
  // Square ground pixels at the middle latitude.
  const outH = Math.max(1, Math.round((outW * (n - s)) / ((e - w) * Math.cos(midLat))))
  const out = new Uint8ClampedArray(outW * outH * 4)
  for (let r = 0; r < outH; r++) {
    const lat = n - ((r + 0.5) / outH) * (n - s)
    for (let c = 0; c < outW; c++) {
      const lon = w + ((c + 0.5) / outW) * (e - w)
      const g = projectWgs84(lat, lon, crs)
      if (!g) continue
      const [pc, pr] = pictureAt(a, g[0], g[1])
      const ci = Math.floor(pc), ri = Math.floor(pr)
      if (ci < 0 || ri < 0 || ci >= a.width || ri >= a.height) continue
      const i = (ri * a.width + ci) * 4, o = (r * outW + c) * 4
      out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]; out[o + 3] = rgba[i + 3]
    }
  }
  return { rgba: out, width: outW, height: outH }
}

/** A KML document with one ground overlay over `box`. */
export function groundOverlayKml(name, href, [w, s, e, n]) {
  const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(name)}</name>
    <GroundOverlay>
      <name>${esc(name)}</name>
      <Icon><href>${esc(href)}</href></Icon>
      <LatLonBox><north>${n}</north><south>${s}</south><east>${e}</east><west>${w}</west></LatLonBox>
    </GroundOverlay>
  </Document>
</kml>
`
}
