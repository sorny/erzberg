/**
 * Surface fields: rasters the surface shader reads but cannot make itself.
 *
 * Hillshade, sky view and openness are a few texture reads per pixel, so the
 * shader does them live. These five are not. Local relief and curvature need a
 * wide blur, texture shading a Fourier transform of the whole raster, wetness a
 * drainage walk, and sun hours a few hundred shadow sweeps. Each is computed
 * once, here, on the main thread, from the grid the worker already built, and
 * handed to the shader as a float texture.
 *
 * The grid is the surface's own brightness buffer, so a field sits exactly on
 * the ground it describes, after Levels and Blur. It is box-filtered down to at
 * most FIELD_MAX cells a side first: a field is a smooth tint, and a 4k field
 * would cost sixteen times the work to look the same.
 *
 * Every field comes back normalised for the shader: local relief, curvature and
 * texture shading to −1…1 by their 98th percentile of magnitude, wetness and sun
 * hours to 0…1. Cells with no ground are 0.
 */
import { boxBlur } from './terrain'
import { NODATA_SENTINEL_Y } from './terrain'
import { FFT } from './fft'
import { d8Accumulation } from './drainage'
import { samplingFor, sunHoursField } from './sunHours'

export const FIELD_MAX = 1024

/**
 * The base grid of a surface build, as heights and a mask, downsampled.
 *
 * Row 0 is the north edge, as in the worker. `step` is how many grid cells one
 * field cell spans, and `scl` the world units per field cell, which the sun
 * sweep needs to put its shadows at the right length.
 */
export function fieldGrid(surfaceGeo, scl = 1) {
  const md = surfaceGeo?.metadata
  if (!md?.rows || !md?.cols || !surfaceGeo.brightnessBuf?.length) return null
  const { rows, cols } = md
  const pos = surfaceGeo.positions, bright = surfaceGeo.brightnessBuf
  const step = Math.max(1, Math.ceil(Math.max(rows, cols) / FIELD_MAX))
  const fr = Math.max(2, Math.floor(rows / step)), fc = Math.max(2, Math.floor(cols / step))
  const grid = new Float32Array(fr * fc), mask = new Uint8Array(fr * fc)
  for (let r = 0; r < fr; r++) {
    for (let c = 0; c < fc; c++) {
      let sum = 0, n = 0
      for (let y = r * step; y < Math.min(rows, (r + 1) * step); y++) {
        for (let x = c * step; x < Math.min(cols, (c + 1) * step); x++) {
          const i = y * cols + x
          if (pos[i * 3 + 1] <= NODATA_SENTINEL_Y + 1) continue
          sum += bright[i]; n++
        }
      }
      if (n) { grid[r * fc + c] = sum / n; mask[r * fc + c] = 1 }
    }
  }
  return { grid, mask, rows: fr, cols: fc, step, scl: scl * step }
}

/** A key that changes when the grid does, without hashing a million cells. */
export function gridKey(g) {
  if (!g) return 'none'
  let s = 0
  const stride = Math.max(1, Math.floor(g.grid.length / 4096))
  for (let i = 0; i < g.grid.length; i += stride) s = (s * 31 + Math.round(g.grid[i] * 1e6)) % 2147483647
  return `${g.rows}x${g.cols}:${s}`
}

/** The grid at half size, 2 × 2 cells into one, when it is over `limit` a side. */
function halveIfOver(g, limit) {
  if (Math.max(g.rows, g.cols) <= limit) return g
  const rows = Math.floor(g.rows / 2), cols = Math.floor(g.cols / 2)
  const grid = new Float32Array(rows * cols), mask = new Uint8Array(rows * cols)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let s = 0, n = 0
      for (const [dy, dx] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        const k = (2 * y + dy) * g.cols + 2 * x + dx
        if (g.mask[k]) { s += g.grid[k]; n++ }
      }
      if (n) { grid[y * cols + x] = s / n; mask[y * cols + x] = 1 }
    }
  }
  return { grid, mask, rows, cols, scl: g.scl * 2 }
}

/** A field on a halved grid, read back onto the full one. */
function expand(field, src, g) {
  if (src === g) return field
  const out = new Float32Array(g.rows * g.cols)
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) {
      const k = Math.min(src.rows - 1, y >> 1) * src.cols + Math.min(src.cols - 1, x >> 1)
      out[y * g.cols + x] = g.mask[y * g.cols + x] ? field[k] : 0
    }
  }
  return out
}

/** Scales a signed field to −1…1 by its 98th percentile of magnitude. */
function signedUnit(f, mask) {
  const mags = []
  const stride = Math.max(1, Math.floor(f.length / 50000))
  for (let i = 0; i < f.length; i += stride) if (mask[i]) mags.push(Math.abs(f[i]))
  mags.sort((a, b) => a - b)
  const ref = mags[Math.floor(mags.length * 0.98)] || 1
  const out = new Float32Array(f.length)
  for (let i = 0; i < f.length; i++) out[i] = mask[i] ? Math.max(-1, Math.min(1, f[i] / ref)) : 0
  return out
}

/**
 * Local relief: the ground minus a blurred copy of itself.
 *
 * A high-pass filter. It takes away the shape of the mountain and leaves what
 * sits on it: terraces, paths, benches, walls, the lip of a gully. The standard
 * first look at a LiDAR survey. `radius` is in field cells, and it is the size
 * of the largest feature kept.
 */
export function localReliefField(g, radius) {
  const r = Math.max(1, radius)
  const smooth = boxBlur(g.grid, g.cols, g.rows, r, g.mask)
  const f = new Float32Array(g.grid.length)
  for (let i = 0; i < f.length; i++) f[i] = g.mask[i] ? g.grid[i] - smooth[i] : 0
  return signedUnit(f, g.mask)
}

/**
 * Curvature: positive on convex ground, negative in hollows.
 *
 * The Laplacian of the ground, blurred to `radius` first and taken over the
 * same distance, so it reads the form at that scale and not the grain of the
 * data. The sign is flipped from the Laplacian's, so a ridge is positive.
 */
export function curvatureField(g, radius) {
  const r = Math.max(1, Math.round(radius))
  const { rows, cols, mask } = g
  const s = boxBlur(g.grid, cols, rows, r, mask)
  const at = (y, x, i) => {
    const k = Math.max(0, Math.min(rows - 1, y)) * cols + Math.max(0, Math.min(cols - 1, x))
    return mask[k] ? s[k] : s[i]
  }
  const f = new Float32Array(s.length)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (!mask[i]) continue
      f[i] = s[i] - (at(y, x - r, i) + at(y, x + r, i) + at(y - r, x, i) + at(y + r, x, i)) / 4
    }
  }
  return signedUnit(f, mask)
}

/**
 * Texture shading (Leland Brown, 2010): the fractional Laplacian of the ground.
 *
 * In the frequency domain each wave is multiplied by |k|^α. At α = 0 that is
 * the ground itself, and at α = 2 the ordinary Laplacian, which keeps only the
 * finest grain. In between, the ridges and the canyons at every scale come
 * through at once, which no light direction and no single blur radius gives.
 * Brown's own maps use about α = 0.5.
 *
 * The grid is mirrored into a power-of-two square before the transform, so the
 * wrap-around of the FFT meets a copy of the same edge and not the far side of
 * the map. Past 640 cells a side it runs at half size: the square would
 * otherwise be 2048² and 64 MB of complex numbers.
 */
export function textureShadeField(full, alpha) {
  const g = halveIfOver(full, 640)
  const { rows, cols, mask } = g
  let size = 2
  while (size < Math.max(rows, cols) * 1.25) size *= 2
  size = Math.min(size, 1024)
  const n = size * size
  const re = new Float64Array(n), im = new Float64Array(n)
  // Mean of the ground, so the empty cells and the mirror carry no step.
  let mean = 0, cnt = 0
  for (let i = 0; i < g.grid.length; i++) if (mask[i]) { mean += g.grid[i]; cnt++ }
  mean = cnt ? mean / cnt : 0
  const mirror = (v, m) => { const p = 2 * m; v = ((v % p) + p) % p; return v < m ? v : p - 1 - v }
  for (let y = 0; y < size; y++) {
    const sy = mirror(y, rows)
    for (let x = 0; x < size; x++) {
      const k = sy * cols + mirror(x, cols)
      re[y * size + x] = mask[k] ? g.grid[k] - mean : 0
    }
  }
  const fft = new FFT(size), rr = new Float64Array(size), ri = new Float64Array(size)
  const pass2d = (inverse) => {
    // Rows, then columns. The inverse is the forward transform of the conjugate.
    for (let y = 0; y < size; y++) {
      const o = y * size
      for (let x = 0; x < size; x++) { rr[x] = re[o + x]; ri[x] = inverse ? -im[o + x] : im[o + x] }
      fft.transform(rr, ri)
      for (let x = 0; x < size; x++) { re[o + x] = rr[x]; im[o + x] = inverse ? -ri[x] : ri[x] }
    }
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) { rr[y] = re[y * size + x]; ri[y] = inverse ? -im[y * size + x] : im[y * size + x] }
      fft.transform(rr, ri)
      for (let y = 0; y < size; y++) { re[y * size + x] = rr[y]; im[y * size + x] = inverse ? -ri[y] : ri[y] }
    }
  }
  pass2d(false)
  const a = Math.max(0, Math.min(2, alpha ?? 0.5))
  for (let y = 0; y < size; y++) {
    const ky = (y <= size / 2 ? y : y - size) / size
    for (let x = 0; x < size; x++) {
      const kx = (x <= size / 2 ? x : x - size) / size
      const k2 = kx * kx + ky * ky
      const w = k2 > 0 ? Math.pow(k2, a / 2) : 0
      re[y * size + x] *= w; im[y * size + x] *= w
    }
  }
  pass2d(true)
  const f = new Float32Array(rows * cols)
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) f[y * cols + x] = re[y * size + x]
  return expand(signedUnit(f, mask), g, full)
}

/**
 * Wetness: the topographic wetness index ln(a / tan β), scaled to 0…1.
 *
 * `a` is the area that drains through a cell, from D8 on the lightly blurred
 * grid, and β the slope. High where a big catchment meets flat ground: valley
 * floors, the heads of fans, the edges of lakes. Scaled between its 5th and
 * 99th percentiles, so one outlet that drains the whole sheet does not flatten
 * everything else to zero. The index is blurred by a cell before that: on flat
 * ground D8 runs the flow in straight lines, and unblurred they drew as rules.
 */
export function wetnessField(g) {
  const { rows, cols, mask, grid } = g
  const { acc } = d8Accumulation(grid, mask, rows, cols, 2)
  const f = new Float32Array(grid.length), vals = []
  let smax = 0
  const slope = new Float32Array(grid.length)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (!mask[i]) continue
      const gx = (grid[y * cols + Math.min(cols - 1, x + 1)] - grid[y * cols + Math.max(0, x - 1)]) / 2
      const gy = (grid[Math.min(rows - 1, y + 1) * cols + x] - grid[Math.max(0, y - 1) * cols + x]) / 2
      slope[i] = Math.hypot(gx, gy)
      if (slope[i] > smax) smax = slope[i]
    }
  }
  const floor = (smax || 1) * 0.01
  for (let i = 0; i < f.length; i++) {
    if (!mask[i]) continue
    f[i] = Math.log(acc[i] / Math.max(floor, slope[i]))
    if ((i & 3) === 0) vals.push(f[i])
  }
  vals.sort((a, b) => a - b)
  const lo = vals[Math.floor(vals.length * 0.05)] ?? 0, hi = vals[Math.floor(vals.length * 0.99)] ?? 1
  const b = boxBlur(f, cols, rows, 1, mask)
  for (let i = 0; i < f.length; i++) f[i] = mask[i] ? Math.max(0, Math.min(1, (b[i] - lo) / ((hi - lo) || 1))) : 0
  return f
}

/**
 * Sun hours over a year or one day, scaled to 0…1 of the sunniest cell.
 *
 * The same sweep as the Sun Hours draw mode, run on the field grid rather than
 * the worker's. The sweep is the costliest thing in this file, so the grid is
 * cut to half the usual size for it: a year of shadows is a soft field.
 */
export function sunHoursTint(g, { elevScale, lat, period, date }) {
  const src = halveIfOver(g, FIELD_MAX / 2)
  const terrain = { grid: src.grid, gridMask: src.mask, rows: src.rows, cols: src.cols, scl: src.scl, hasNoData: src.mask.some((m) => !m) }
  const field = sunHoursField(terrain, { elevScale, lat, perDay: 12, ...samplingFor(period, 12, date) })
  const max = field.max || 1
  const f = new Float32Array(src.rows * src.cols)
  for (let i = 0; i < f.length; i++) f[i] = src.mask[i] && field.hours[i] >= 0 ? field.hours[i] / max : 0
  return expand(f, src, g)
}

/**
 * Packs up to four fields into an RGBA float array for a DataTexture.
 *
 * Row 0 of a texture is the bottom of the image in UV space, and the surface's
 * UVs put grid row 0 at v = 1, so the rows are written bottom-up here and the
 * texture needs no flip.
 */
export function packFields(g, channels) {
  const { rows, cols } = g
  const out = new Float32Array(rows * cols * 4)
  for (let y = 0; y < rows; y++) {
    const ty = rows - 1 - y
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, o = (ty * cols + x) * 4
      for (let c = 0; c < 4; c++) out[o + c] = channels[c] ? channels[c][i] : 0
    }
  }
  return out
}
