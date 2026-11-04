/**
 * A GeoTIFF band as something other than the ground.
 *
 * A multiband file often holds an image or a classification beside the
 * heights. The band picker makes one band the elevation; this sends another to
 * the imagery drape, stretched from its lowest to its highest value, or to a
 * mask, on where the value is at or above the middle of its range. The mask
 * opens in Mask Studio like any other, so the cut can be refined there.
 */

/**
 * A band read and scaled to `width × height` (nearest), as 0–1 values with
 * NaN where the band has no data. Reads only that band.
 */
export async function readBand(file, band, width, height) {
  const { fromArrayBuffer } = await import('geotiff')
  const image = await (await fromArrayBuffer(await file.arrayBuffer())).getImage()
  const [data] = await image.readRasters({ samples: [band] })
  const w = image.getWidth(), h = image.getHeight()
  // geotiff 3 keeps tags behind getValue, as useHeightmap's tiffTag reads them.
  const fd = image.fileDirectory
  const nd = typeof fd?.hasTag === 'function' ? (fd.hasTag('GDAL_NODATA') ? fd.getValue('GDAL_NODATA') : null) : fd?.GDAL_NODATA
  const nodata = nd != null ? parseFloat(String(nd).replace(/\0/g, '')) : NaN
  return scaleBand(data, w, h, width, height, nodata)
}

/** Pure half of `readBand`: stretch to 0–1 and resample. */
export function scaleBand(data, w, h, width, height, nodata = NaN) {
  const isVoid = (v) => !Number.isFinite(v) || v === nodata || Math.abs(v) >= 1e30
  let min = Infinity, max = -Infinity
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (isVoid(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max > min ? max - min : 1
  const out = new Float32Array(width * height)
  for (let r = 0; r < height; r++) {
    const sr = Math.min(h - 1, Math.floor(((r + 0.5) * h) / height))
    for (let c = 0; c < width; c++) {
      const v = data[sr * w + Math.min(w - 1, Math.floor(((c + 0.5) * w) / width))]
      out[r * width + c] = isVoid(v) ? NaN : (v - min) / span
    }
  }
  return { values: out, min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null }
}

/** The values as a grey RGBA image, transparent where there is no data. */
export function bandRgba(values) {
  const rgba = new Uint8ClampedArray(values.length * 4)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    const g = Number.isFinite(v) ? Math.round(v * 255) : 0
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g
    rgba[i * 4 + 3] = Number.isFinite(v) ? 255 : 0
  }
  return rgba
}

/** A mask plane: on where the value is at or above `threshold` (0–1). */
export function bandMask(values, threshold = 0.5) {
  const out = new Uint8Array(values.length)
  for (let i = 0; i < values.length; i++) out[i] = values[i] >= threshold ? 1 : 0
  return out
}
