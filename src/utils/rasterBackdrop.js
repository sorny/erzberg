/**
 * The flat picture that Edit Mode and the Mask Studio are drawn over.
 *
 * One builder for both, so the two full-window views show the same ground in
 * the same way, and offer the same choice of it:
 *
 *   height   the raster as grey, stretched to its own range
 *   relief   the same grey with a north-west shading, so form reads
 *   imagery  the fetched Sentinel-2 scene, under the drape's own exposure
 *
 * `auto` takes the imagery when there is some and the relief when not.
 *
 * Raster backdrops are capped at MAX_BACKDROP on the long side. An 8k DEM as
 * full-resolution RGBA is 256 MB for a picture no screen resolves.
 */
import { applyTone } from './imageryTone'

export const MAX_BACKDROP = 2048

export const BACKDROP_OPTIONS = [['Auto', 'auto'], ['Sat', 'imagery'], ['Relief', 'relief'], ['Height', 'height']]

/** The backdrop actually shown for a choice, given whether a photo exists. */
export function resolveBackdrop(choice, hasPhoto) {
  if (choice === 'imagery' || choice === 'height' || choice === 'relief') return choice
  return hasPhoto ? 'imagery' : 'relief'
}

/** A capped canvas of the raster, as `height` or `relief`. */
export function buildRasterBackdrop(pixels, mask, w, h, mode = 'relief') {
  if (!pixels || !w || !h) return null
  const step = Math.max(1, Math.ceil(Math.max(w, h) / MAX_BACKDROP))
  const pw = Math.max(1, Math.floor(w / step))
  const ph = Math.max(1, Math.floor(h / step))

  let min = Infinity, max = -Infinity
  for (let i = 0; i < pixels.length; i++) {
    if (mask && !mask[i]) continue
    const v = pixels[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!isFinite(min) || max <= min) { min = 0; max = 1 }
  const inv = 1 / (max - min)

  // Sampled heights, normalised to 0…1. NaN marks a NoData sample.
  const t = new Float32Array(pw * ph)
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(h - 1, y * step)
    for (let x = 0; x < pw; x++) {
      const si = sy * w + Math.min(w - 1, x * step)
      t[y * pw + x] = mask && !mask[si] ? NaN : (pixels[si] - min) * inv
    }
  }

  const cv = document.createElement('canvas')
  cv.width = pw; cv.height = ph
  const ctx = cv.getContext('2d')
  const img = ctx.createImageData(pw, ph)
  const d = img.data
  // Per source pixel, so a capped relief shades like a full-resolution one.
  const k = 6 / step
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = y * pw + x
      const v = t[i]
      const o = i * 4
      if (Number.isNaN(v)) { d[o + 3] = 0; continue }
      let g
      if (mode === 'height') {
        g = Math.round(v * 255)
      } else {
        const l = x > 0 && !Number.isNaN(t[i - 1]) ? t[i - 1] : v
        const u = y > 0 && !Number.isNaN(t[i - pw]) ? t[i - pw] : v
        const shade = Math.max(0, Math.min(1, 0.5 + (v - l) * k + (v - u) * k))
        g = Math.min(255, Math.round(40 + 82.5 * v + 60 * shade))
      }
      d[o] = d[o + 1] = d[o + 2] = g
      d[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

/** The fetched scene as a canvas, under the same exposure as the terrain drape. */
export function buildImageryBackdrop(imagery, tone) {
  if (!imagery?.rgba) return null
  const toned = applyTone(imagery.rgba, imagery.width, imagery.height, tone)
  const cv = document.createElement('canvas')
  cv.width = imagery.width; cv.height = imagery.height
  cv.getContext('2d').putImageData(new ImageData(toned, imagery.width, imagery.height), 0, 0)
  return cv
}
