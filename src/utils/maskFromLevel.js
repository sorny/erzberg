/**
 * A mask from elevation: the ground between two heights.
 *
 * The third way to make a mask, after drawing one and making one from
 * features. It needs nothing loaded but the terrain. Like the others, it is an
 * ordinary mask afterwards: any layer can select it, the Studio can edit it,
 * and it is saved and exported with the rest.
 *
 * ── Levels ───────────────────────────────────────────────────────────────────
 * `lo` and `hi` are fractions of the source raster's own range, 0 to 1, the
 * same scale the source pixels are stored in. The panel shows them in metres
 * when a GeoTIFF gives the range, because the file's range maps linearly onto
 * that scale.
 *
 * ── Smoothing ────────────────────────────────────────────────────────────────
 * A threshold on raw data follows every sensor notch, and the mask comes out
 * ragged. `smooth` blurs the heights, NoData-aware, before the threshold, so
 * the edge follows the landform rather than the noise. It moves the edge by
 * less than the radius, because the blur averages both sides of it.
 */
import { boxBlur } from './terrain'

/**
 * The heights the threshold reads: the source itself, or blurred.
 *
 * Split from the threshold because the Studio previews a drag of From and To
 * live, and the blur is the slow half. It is computed once per Smooth value and
 * every slider move afterwards is one pass over the raster.
 */
export function levelSource(pixels, valid, width, height, smooth = 0) {
  return smooth > 0 ? boxBlur(pixels, width, height, smooth, valid) : pixels
}

/**
 * 1 where `src` lies between `lo` and `hi`, into `out` when one is given.
 * @returns {{data: Uint8Array, on: number}}
 */
export function thresholdLevel(src, valid, lo, hi, out = null) {
  const a = Math.min(lo, hi), b = Math.max(lo, hi)
  const data = out && out.length === src.length ? out : new Uint8Array(src.length)
  let on = 0
  for (let i = 0; i < data.length; i++) {
    const v = src[i]
    const inside = (!valid || valid[i]) && v >= a && v <= b
    data[i] = inside ? 1 : 0
    if (inside) on++
  }
  return { data, on }
}

/**
 * @param {Float32Array} pixels  source heights, 0–1
 * @param {Uint8Array|null} valid  1 where there is data, 0 for NoData
 * @param {number} width
 * @param {number} height
 * @param {object} o
 * @param {number} o.lo  lowest level, 0–1
 * @param {number} o.hi  highest level, 0–1
 * @param {number} [o.smooth]  blur radius in pixels
 * @returns {{data: Uint8Array, on: number}} 1 inside; `on` counts them
 */
export function maskFromLevel(pixels, valid, width, height, o) {
  return thresholdLevel(levelSource(pixels, valid, width, height, o.smooth ?? 0), valid, o.lo, o.hi)
}
