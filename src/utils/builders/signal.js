/**
 * The ground read as a signal: Line Printer, Stems, Hair, Waveform, Wiggle
 * Traces.
 *
 * Four modes after pictures that were not made from terrain at all. A SYMAP
 * line-printer map, a plot of dotted stems, a cloud of hairs and a record
 * sleeve of waveforms each draw a value with a mark of its own, and the
 * heightmap supplies the value.
 */
import { cellElev, boxBlur, sampleBilinear } from '../terrain'
import { computeVertexColor } from '../colorUtils'
import { F32List, U32List, drapeEdge, mulberry32, normElev } from './shared.js'
import { lineFamily } from './lines.js'
import { pointDensity } from './tone.js'

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Ink for one cell, from the mode's line style and hypsometric tint. */
function inkAt(terrain, p, i, elev) {
  const { minElev, maxElev, gridSlopes, maxSlope } = terrain
  return computeVertexColor(normElev(elev, minElev, maxElev), gridSlopes[i] / (maxSlope || 1), 0, p)
}

// ─── Line Printer ─────────────────────────────────────────────────────────

/*
 * The glyphs, in a unit cell with x to the right and −z up the page. A glyph is
 * a list of strokes [x0, z0, x1, z1]. The darkest are overprints: the printer
 * struck the same cell several times, and the marks add up to a black block.
 */
const octagon = (r) => {
  const s = []
  for (let k = 0; k < 8; k++) {
    const a0 = (k + 0.5) / 8 * Math.PI * 2, a1 = (k + 1.5) / 8 * Math.PI * 2
    s.push([r * Math.cos(a0), r * Math.sin(a0), r * Math.cos(a1), r * Math.sin(a1)])
  }
  return s
}
const DOT   = [[-0.07, 0, 0.07, 0], [0, -0.07, 0, 0.07]]
const PLUS  = [[-0.3, 0, 0.3, 0], [0, -0.3, 0, 0.3]]
const CROSS = [[-0.28, -0.28, 0.28, 0.28], [-0.28, 0.28, 0.28, -0.28]]
const RING  = octagon(0.3)
const BAR   = [[-0.3, 0, 0.3, 0]]
const BOX   = [[-0.36, -0.36, 0.36, -0.36], [0.36, -0.36, 0.36, 0.36], [0.36, 0.36, -0.36, 0.36], [-0.36, 0.36, -0.36, -0.36]]
const RULES = [[-0.36, -0.18, 0.36, -0.18], [-0.36, 0.18, 0.36, 0.18]]

/** Light to dark: · + x o Θ, then three overprints. */
export const PRINTER_RAMP = [
  DOT, PLUS, CROSS, RING, [...RING, ...BAR],
  [...CROSS, ...RING], [...CROSS, ...RING, ...PLUS], [...CROSS, ...RING, ...PLUS, ...BOX, ...RULES],
]

/**
 * A line-printer map, after SYMAP: one glyph per character cell, the class of
 * the cell's value picking it from a light-to-dark ramp.
 *
 * The cells are a fixed pitch, taller than wide as a printer's were. The value
 * is elevation or slope, cut into classes of equal width or of equal count
 * (quantiles, which SYMAP offered too and which give every glyph its share of
 * the sheet). The glyph lies flat at the cell's height.
 */
export function buildPrinter(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, gridSlopes, maxSlope, hasNoData } = terrain
  const pitch = Math.max(scl, o.pitch ?? 8)
  const rowPitch = pitch * Math.max(0.5, o.aspect ?? 1.25)
  const classes = Math.max(2, Math.min(8, Math.round(o.classes ?? 6)))
  const sMask = hasNoData ? gridMask : null
  const W = (cols - 1) * scl, H = (rows - 1) * scl
  const nx = Math.max(1, Math.floor(W / pitch)), nz = Math.max(1, Math.floor(H / rowPitch))
  const x0 = -halfW + (W - nx * pitch) / 2 + pitch / 2
  const z0 = -halfH + (H - nz * rowPitch) / 2 + rowPitch / 2

  const cells = []
  for (let j = 0; j < nz; j++) {
    for (let k = 0; k < nx; k++) {
      const x = x0 + k * pitch, z = z0 + j * rowPitch
      const fc = (x + halfW) / scl, fr = (z + halfH) / scl
      const i = Math.round(fr) * cols + Math.round(fc)
      if (!gridMask[i]) continue
      const b = sampleBilinear(grid, sMask, rows, cols, fr, fc)
      if (b !== b) continue
      const elev = (b - 0.5) * 100 * (p.elevScale ?? 1)
      const v = o.field === 'slope' ? gridSlopes[i] / (maxSlope || 1) : b
      cells.push({ x, z, i, elev, v })
    }
  }
  if (!cells.length) return null

  // Class breaks: equal steps of the value's own range, or quantiles.
  let lo = Infinity, hi = -Infinity
  for (const c of cells) { if (c.v < lo) lo = c.v; if (c.v > hi) hi = c.v }
  let classOf
  if (o.quantile) {
    const sorted = cells.map((c) => c.v).sort((a, b) => a - b)
    const breaks = []
    for (let k = 1; k < classes; k++) breaks.push(sorted[Math.min(sorted.length - 1, Math.floor(k / classes * sorted.length))])
    classOf = (v) => { let k = 0; while (k < breaks.length && v >= breaks[k]) k++; return k }
  } else {
    const span = hi - lo || 1
    classOf = (v) => Math.min(classes - 1, Math.floor((v - lo) / span * classes))
  }

  const positions = new F32List(), colors = new F32List()
  for (const c of cells) {
    const k = classOf(c.v)
    if (o.blank && k === 0) continue
    const glyph = PRINTER_RAMP[Math.round(k * (PRINTER_RAMP.length - 1) / (classes - 1))]
    const rgb = inkAt(terrain, p, c.i, c.elev)
    for (const [a, b, d, e] of glyph) {
      positions.push6(c.x + a * pitch, c.elev, c.z + b * pitch, c.x + d * pitch, c.elev, c.z + e * pitch)
      colors.pushRgb2(rgb)
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Stems ────────────────────────────────────────────────────────────────

/** The datum the stems stand on: the mean, the lowest or the middle height. */
function datumOf(terrain, p, step, kind) {
  const { minElev, maxElev, grid, gridMask, rows, cols } = terrain
  if (kind === 'min') return minElev
  if (kind === 'mid') return (minElev + maxElev) / 2
  let sum = 0, n = 0
  for (let r = 0; r < rows; r += step) for (let c = 0; c < cols; c += step) {
    const i = r * cols + c
    if (gridMask[i]) { sum += cellElev(grid, r, c, cols, p.elevScale, 0); n++ }
  }
  return n ? sum / n : minElev
}

/**
 * A stem from a datum to the ground at each sampled cell, and a dot at its tip.
 *
 * Ground above the datum stands up from it and ground below hangs down, so from
 * the side the plate reads as a signal about its mean. The stems are dotted by
 * default, through the line style's own dash. The tips are a second pen: three
 * short strokes along the axes, which read as a dot from any side.
 */
export function buildStems(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH } = terrain
  const step = Math.max(1, Math.round((o.spacing ?? 6) / scl))
  const datum = datumOf(terrain, p, step, o.datum ?? 'mean')
  const t = Math.max(0.1, o.tipSize ?? 1.5) / 2
  const stem = { positions: new F32List(), colors: new F32List() }
  const tips = { positions: new F32List(), colors: new F32List() }
  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const elev = cellElev(grid, r, c, cols, p.elevScale, p.jitterAmt)
      const x = c * scl - halfW, z = r * scl - halfH
      const rgb = inkAt(terrain, p, i, elev)
      if (Math.abs(elev - datum) > 1e-4) { stem.positions.push6(x, datum, z, x, elev, z); stem.colors.pushRgb2(rgb) }
      if (o.tips) {
        tips.positions.push6(x - t, elev, z, x + t, elev, z)
        tips.positions.push6(x, elev - t, z, x, elev + t, z)
        tips.positions.push6(x, elev, z - t, x, elev, z + t)
        for (let k = 0; k < 3; k++) tips.colors.pushRgb2(rgb)
      }
    }
  }
  // The stems run between the datum and the ground, so where the ground is
  // above the datum they are inside it: under the Ground model the terrain must
  // not hide them. The tips sit on the ground and are hidden like any mark.
  const out = { Stems: { positions: stem.positions.toArray(), colors: stem.colors.toArray(), insideGround: true } }
  if (o.tips) out['Stems-Tips'] = { positions: tips.positions.toArray(), colors: tips.colors.toArray() }
  return out
}

// ─── Hair ─────────────────────────────────────────────────────────────────

/**
 * A short wandering stroke at each sampled cell, centred on the ground.
 *
 * Each hair is a random walk that climbs: every step goes up by the same amount
 * and sideways by a seeded random amount, which adds up, so a hair curls rather
 * than shakes. One hair says little. Thousands, seen from the side, overlap
 * where many cells share a height and thin out where few do: the tone is the
 * count, the way a drawing in pencil hair gets its grey. Seen from above, it is
 * a fur on the ground.
 */
export function buildHair(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH } = terrain
  const step = Math.max(1, Math.round((o.spacing ?? 3) / scl))
  const len = Math.max(0.1, o.length ?? 6)
  const segs = Math.max(2, Math.min(16, Math.round(o.segments ?? 6)))
  const dy = len / segs, side = (o.jitter ?? 0.6) * dy
  const rng = mulberry32((o.seed ?? 1) * 2654435761)
  const positions = new F32List(), colors = new F32List()
  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const elev = cellElev(grid, r, c, cols, p.elevScale, p.jitterAmt)
      // Every hair draws from the stream, masked or not, so a mask does not
      // reshuffle the hairs it leaves.
      let x = c * scl - halfW + (rng() - 0.5) * step * scl
      let z = r * scl - halfH + (rng() - 0.5) * step * scl
      let y = elev - len / 2
      const rgb = inkAt(terrain, p, i, elev)
      for (let s = 0; s < segs; s++) {
        const nx = x + (rng() + rng() - 1) * side, nz = z + (rng() + rng() - 1) * side, ny = y + dy
        positions.push6(x, y, z, nx, ny, nz); colors.pushRgb2(rgb)
        x = nx; y = ny; z = nz
      }
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Waveform ─────────────────────────────────────────────────────────────

/**
 * The line Waveform reads, in grid units: the point it passes through
 * (`c0`, `r0`), the reading direction (`dc`, `dr`, c right and r down, 0° is
 * +r), and the run `t0`…`t1` along it that lies on the raster. `from` and `to`
 * keep a part of that run, as fractions of it, so the reading can start and end
 * anywhere along the line. The viewport's guide and the panel's preview read
 * the same line from here, so the three cannot disagree.
 */
export function waveformLine(terrain, o) {
  const { grid, gridMask, rows, cols } = terrain
  let c0 = (cols - 1) / 2, r0 = (rows - 1) / 2
  if (o.line === 'point') {
    c0 = clamp01(o.originX ?? 0.5) * (cols - 1); r0 = clamp01(o.originY ?? 0.5) * (rows - 1)
  } else if (o.line !== 'centre') {
    let best = -Infinity
    for (let i = 0; i < grid.length; i++) if (gridMask[i] && grid[i] > best) { best = grid[i]; c0 = i % cols; r0 = (i - c0) / cols }
  }
  const a = (o.angle ?? 0) * Math.PI / 180
  const dc = Math.sin(a), dr = Math.cos(a)
  // Clip the line through (c0, r0) to the raster.
  let t0 = -Infinity, t1 = Infinity
  for (const [p0, d, max] of [[c0, dc, cols - 1], [r0, dr, rows - 1]]) {
    if (Math.abs(d) < 1e-9) continue
    const ta = (0 - p0) / d, tb = (max - p0) / d
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb))
  }
  if (!(t1 > t0)) return null
  const a0 = Math.max(0, Math.min(1, o.from ?? 0)), a1 = Math.max(0, Math.min(1, o.to ?? 1))
  if (!(a1 > a0)) return null
  return { c0, r0, dc, dr, t0: t0 + (t1 - t0) * a0, t1: t0 + (t1 - t0) * a1 }
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/**
 * Where Waveform's line starts and ends, as compass points on a north-up
 * raster. 0° reads N→S: the reading direction is grid +row, which travels on
 * the bearing 180° − angle.
 */
export function readingEnds(angle) {
  const to = ((180 - angle) % 360 + 360) % 360
  const name = (b) => COMPASS[Math.round(b / 22.5) % 16]
  return [name((to + 180) % 360), name(to)]
}

const KNEE = 0.7

/**
 * A soft limit for widths up to `top`: w below KNEE as it is, 0 below 0, and
 * above KNEE  KNEE + (1 − KNEE) · ln(1 + b·u) / b, with u the distance past the
 * knee over (1 − KNEE). Its slope is 1 at the knee for any b, so it meets the
 * straight part without a kink, and b is the root of ln(1 + b·R) = b, R being
 * `top`'s u, so `top` lands on 1. A logarithm, as a compressor works in
 * decibels, because it never saturates: tanh put everything past three times
 * the knee at 0.9999, and a flat edge again. With nothing past 1, the identity.
 */
function limiter(top) {
  const R = (top - KNEE) / (1 - KNEE)
  if (!(R > 1 + 1e-9)) return (v) => clamp01(v)
  // b = ln(1 + bR) has one root above 0 for R > 1; iterating from above converges to it.
  let b = Math.max(1, Math.log(R) * 2)
  for (let i = 0; i < 80; i++) b = Math.log(1 + b * R)
  return (v) => (v <= 0 ? 0 : v <= KNEE ? v : KNEE + (1 - KNEE) * Math.log(1 + b * (v - KNEE) / (1 - KNEE)) / b)
}

/**
 * What Waveform reads and how wide it draws each sample: a cross-section,
 * drawn the way a sound editor draws a recording.
 *
 *  1. **Read.** Every *Spacing* along the line, the height h. That is the
 *     profile, the same section a surveyor would draw.
 *  2. **Normalise.** e = ((h − lo) / (hi − lo))^γ, so the line's lowest point
 *     is 0 and its highest is 1. *Gamma* above 1 narrows the low ground.
 *  3. **Sharpen.** w = e + Detail · (h − blur(h)) / (hi − lo). The second term
 *     is the profile minus a blur of itself over *Detail scale* samples: the
 *     bumps shorter than that. Adding it back is an unsharp mask, the
 *     sharpening a photo editor does, so a cliff band shows as a burst.
 *  4. **Limit.** Sharpening can push w past 1. Up to KNEE nothing changes;
 *     above it, w bends along a smooth curve that meets the straight part
 *     without a kink and reaches 1 at the widest sample only, as an audio
 *     limiter treats a peak. A smaller w stays smaller, so no run of samples
 *     goes flat. Below 0 there is no stroke. With `clip` (plates before v1.59)
 *     w was cut at 1 instead, and a run of samples past 1 drew a flat edge at
 *     full width. A plain rescale was tried and dropped: one spike then
 *     narrowed the whole column, so Detail made the waveform thinner.
 *
 * Returns the samples, `w` as a fraction of the full width, and `e` for the
 * hypsometric tint, or null where the line has no relief.
 */
export function waveformProfile(terrain, o) {
  const { grid, gridMask, rows, cols, scl, hasNoData } = terrain
  const line = waveformLine(terrain, o)
  if (!line) return null
  const { c0, r0, dc, dr, t0, t1 } = line
  const step = Math.max(scl, o.spacing ?? 1.5) / scl
  const n = Math.max(2, Math.floor((t1 - t0) / step + 1e-9) + 1)
  const sMask = hasNoData ? gridMask : null
  const h = new Float32Array(n), ok = new Uint8Array(n)
  let lo = Infinity, hi = -Infinity
  for (let k = 0; k < n; k++) {
    const t = t0 + k * step
    const v = sampleBilinear(grid, sMask, rows, cols, r0 + t * dr, c0 + t * dc)
    if (v === v) { h[k] = v; ok[k] = 1; if (v < lo) lo = v; if (v > hi) hi = v }
  }
  if (!(hi > lo)) return null
  const fine = boxBlur(h, n, 1, Math.max(1, o.smooth ?? 4))
  const gain = o.detail ?? 1.5
  const gamma = Math.max(0.1, o.gamma ?? 1)
  const e = new Float32Array(n), w = new Float32Array(n)
  let wHi = -Infinity
  for (let k = 0; k < n; k++) {
    if (!ok[k]) continue
    e[k] = ((h[k] - lo) / (hi - lo)) ** gamma
    w[k] = e[k] + gain * (h[k] - fine[k]) / (hi - lo)
    if (w[k] > wHi) wHi = w[k]
  }
  if (o.clip) for (let k = 0; k < n; k++) w[k] = clamp01(w[k])
  else {
    const limit = limiter(wHi)
    for (let k = 0; k < n; k++) w[k] = ok[k] ? limit(w[k]) : 0
  }
  return { line, step, n, ok, h, lo, hi, e, w }
}

/**
 * One column of a waveform plot, read along a line across the ground.
 *
 * The line runs through the highest point of the terrain, through its middle,
 * or through a point picked on it (`originX`, `originY`), at a *Direction*: 0°
 * reads top to bottom (north to south), 90° left to right, 180° bottom to top,
 * 270° right to left, and anything between is a diagonal. It is clipped to the
 * raster. `waveformProfile` says how wide each sample is, and each sample is
 * one stroke across the reading direction: the scanlines of a printed
 * waveform, which a pen fills in one direction.
 *
 * Where the column goes, `place`:
 *  - `column` stands it upright in the middle of the plate, top to bottom, for
 *    a sleeve of one plate per peak;
 *  - `row` lays it left to right through the middle;
 *  - `line` draws it on the line it reads, so it crosses the ground where the
 *    profile was taken.
 * All three lie flat above the ground, so a plan view shows them alone.
 *
 * `sides` mirrors each stroke about the axis (`both`) or draws it from the axis
 * to its left only (`one`), at the same full width.
 */
export function buildWaveform(terrain, p, o) {
  const { scl, halfW, halfH, maxElev } = terrain
  const prof = waveformProfile(terrain, o)
  if (!prof) return null
  const { line: { c0, r0, dc, dr, t0, t1 }, step, n, ok, e, w } = prof
  const width = Math.max(1, o.width ?? 120)
  const one = o.sides === 'one'
  const place = o.place ?? 'column'
  const len = (t1 - t0) * scl
  // Each sample's point on the axis and the unit vector across it, in world x/z,
  // pointing to the left of the reading direction: one side then rises from a
  // row like a profile, and goes right from a column read top to bottom.
  const at = (k) => {
    const u = k * step * scl
    if (place === 'row') return [u - len / 2, 0, 0, -1]
    if (place === 'line') {
      const t = t0 + k * step
      return [(c0 + t * dc) * scl - halfW, (r0 + t * dr) * scl - halfH, dr, -dc]
    }
    return [0, u - len / 2, 1, 0]
  }
  const positions = new F32List(), colors = new F32List()
  const y = maxElev
  for (let k = 0; k < n; k++) {
    if (!ok[k]) continue
    const hw = w[k] * width / 2
    if (hw <= 0) continue
    const [x, z, nx, nz] = at(k)
    const from = one ? 0 : -hw, to = one ? 2 * hw : hw
    const rgb = computeVertexColor(e[k], 0, 0, p)
    positions.push6(x + nx * from, y, z + nz * from, x + nx * to, y, z + nz * to); colors.pushRgb2(rgb)
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Wiggle traces ───────────────────────────────────────────────────────────

/**
 * The plate as a seismic section: one wiggle trace per line, lobes filled.
 *
 * A seismic section plots each geophone's record as a trace that swings to
 * either side of its own baseline, and fills the swings to one side in black,
 * so a reflector reads as a dark band across the traces. Here the baselines
 * are parallel lines `spacing` apart at `angle`, and the record along each is
 * the local relief: the height less its mean within `detrend`, so the trace
 * swings round zero on a slope as it does on a flat. The swing is sideways in
 * the plane of the ground, and the trace is draped like any line.
 *
 * `gain` scales the swing. At 1, the 95th percentile of the relief swings half
 * a spacing, so neighbouring traces touch only on the sharpest ground. `clip`
 * limits a swing, in spacings, as a recorder's pen was limited.
 *
 * `lobes` fills the swings to one side ('positive': ground above its
 * surroundings, 'negative': below) with strokes from the baseline to the
 * trace, `pitch` apart. They are a second pen. A crest then reads as a dark
 * band across the traces and a channel as a light one, or the reverse.
 */
export function buildWiggle(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const F = lineFamily(terrain, o.spacing ?? 10, 0, o.angle ?? 90, false)
  const { dx, dz, nx, nz, t0, t1, theta } = F
  const pitch = F.linePos.length > 1 ? Math.abs(F.linePos[1] - F.linePos[0]) : Math.max(1, (o.spacing ?? 10) / scl)
  const mean = boxBlur(grid, cols, rows, Math.max(2, Math.round((o.detrend ?? 16) / scl)), sMask)
  // Read one cell smooth: a trace is a signal, and raw sensor grain makes it a saw.
  const smooth = boxBlur(grid, cols, rows, 1, sMask)
  // The swing that counts as large: the 95th percentile of the relief.
  const mags = []
  for (let i = 0; i < grid.length; i += 7) if (gridMask[i]) mags.push(Math.abs(smooth[i] - mean[i]))
  if (!mags.length) return null
  mags.sort((a, b) => a - b)
  const ref = mags[Math.floor(mags.length * 0.95)]
  if (!(ref > 1e-9)) return null
  const amp = (o.gain ?? 1) * pitch * 0.5 / ref
  const limit = Math.max(0.1, o.clip ?? 1.5) * pitch
  const lobes = o.lobes ?? 'positive'
  const every = Math.max(1, Math.round((o.pitch ?? 2) / scl))
  const trace = { positions: new F32List(), colors: new F32List() }
  const fill = { positions: new F32List(), colors: new F32List() }
  const inside = (c, r) => c >= 0 && c <= cols - 1 && r >= 0 && r <= rows - 1
  for (const pos of F.linePos) {
    const ox = nx * pos, oz = nz * pos
    let prevOk = false, pc = 0, pr = 0
    for (let t = t0; t <= t1; t++) {
      const fc = ox + dx * t, fr = oz + dz * t
      let ok = inside(fc, fr) && gridMask[Math.round(fr) * cols + Math.round(fc)] === 1
      let wc = 0, wr = 0
      if (ok) {
        const d = sampleBilinear(smooth, sMask, rows, cols, fr, fc) - sampleBilinear(mean, sMask, rows, cols, fr, fc)
        const sw = Math.max(-limit, Math.min(limit, d * amp))
        wc = fc + nx * sw; wr = fr + nz * sw
        // A swing off the data lifts the pen, as a line over a hole does.
        ok = d === d && inside(wc, wr) && gridMask[Math.round(wr) * cols + Math.round(wc)] === 1
        if (ok && lobes !== 'none' && t % every === 0 && Math.abs(sw) > 0.2 && (sw > 0) === (lobes === 'positive')) {
          drapeEdge(fill, terrain, p, sMask, fc, fr, wc, wr, theta + Math.PI / 2)
        }
      }
      if (ok && prevOk) drapeEdge(trace, terrain, p, sMask, pc, pr, wc, wr, theta)
      prevOk = ok; pc = wc; pr = wr
    }
  }
  if (!trace.positions.length) return null
  const out = { Wiggle: { positions: trace.positions.toArray(), colors: trace.colors.toArray() } }
  if (fill.positions.length) out['Wiggle-Lobes'] = { positions: fill.positions.toArray(), colors: fill.colors.toArray() }
  return out
}

// ─── Louvres ──────────────────────────────────────────────────────────────────

/** A segment in grid coordinates cut to the raster, or null when it misses. */
function clipToGrid(rows, cols, c0, r0, c1, r1) {
  let t0 = 0, t1 = 1
  const dc = c1 - c0, dr = r1 - r0
  for (const [q, s] of [[-dc, c0], [dc, cols - 1 - c0], [-dr, r0], [dr, rows - 1 - r0]]) {
    if (Math.abs(q) < 1e-12) { if (s < 0) return null; continue }
    const k = s / q
    if (q < 0) { if (k > t1) return null; if (k > t0) t0 = k }
    else { if (k < t0) return null; if (k < t1) t1 = k }
  }
  if (t1 - t0 < 1e-9) return null
  return [c0 + dc * t0, r0 + dr * t0, c0 + dc * t1, r0 + dr * t1]
}

/** A piecewise-linear depth at `u`, from its nodes `us`, `ds`. */
function depthOn(us, ds, u) {
  let n = 0
  while (n < us.length - 2 && us[n + 1] < u) n++
  const t = (u - us[n]) / ((us[n + 1] - us[n]) || 1)
  return ds[n] + (ds[n + 1] - ds[n]) * Math.max(0, Math.min(1, t))
}

/**
 * The parts of a run where a piecewise-linear depth is at least `q`, as
 * [u0, u1] pairs. `us` and `ds` are the nodes along the run.
 */
export function depthIntervals(us, ds, q) {
  const out = []
  let open = null
  for (let k = 0; k < us.length - 1; k++) {
    const ua = us[k], ub = us[k + 1], da = ds[k], db = ds[k + 1]
    const inA = da >= q, inB = db >= q
    if (inA && open === null) open = ua
    if (inA && !inB) {
      out.push([open, ua + (ub - ua) * ((da - q) / (da - db))]); open = null
    } else if (!inA && inB) {
      open = ua + (ub - ua) * ((q - da) / (db - da))
    }
  }
  if (open !== null) out.push([open, us[us.length - 1]])
  return out.filter(([a, b]) => b - a > 1e-6)
}

/**
 * The ground as louvres: rows of slats, each slat cut into cells, and each cell
 * a bar whose depth is the value under it.
 *
 * Rows run `pitch` apart at `angle` (0° runs east). Each row is cut into cells
 * `cell` long, with `gap` left between them. A cell's bar hangs from the row's
 * upper edge (`hang` 'top'), stands on its lower edge ('bottom') or swells
 * about its middle ('centre'), and is `depth` of the pitch deep where the value
 * is full. The value is one of the density fields (elevation, slope, shade and
 * their inverses), blurred by `blur`, raised to `gamma`, with everything at or
 * below `floor` left empty and, with `steps`, rounded to that many levels.
 *
 * `edge` sets how a bar's free edge follows the value: 'stepped' is one depth
 * per cell, read at its middle; 'sloped' is a straight edge between the depths
 * at its two ends; 'traced' follows the value along the cell. A bar is inked
 * by `fill`: 'solid' as a filled area; 'lines' with strokes along the row
 * `fillPitch` apart, which close up into a solid band at the pen's width;
 * 'comb' with strokes across it; or 'none'. `outline` draws its edge.
 * `stagger` moves every second row half a cell along, as bricks are laid.
 *
 * All lengths are in raster pixels. Strokes and areas are draped on the ground.
 */
export function buildLouvres(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, gridSlopes, maxSlope } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const pitch = Math.max(0.5, (o.pitch ?? 18) / scl)
  const cellW = Math.max(0.5, (o.cell ?? 24) / scl)
  const gap = Math.min(cellW * 0.9, Math.max(0, (o.gap ?? 1) / scl))
  const fp = Math.max(0.25, (o.fillPitch ?? 1.5) / scl)
  const maxDepth = Math.max(0.02, Math.min(1, o.depth ?? 0.75)) * pitch
  const floor = Math.max(0, Math.min(0.99, o.floor ?? 0.15))
  const steps = Math.max(0, Math.round(o.steps ?? 0))
  const hang = o.hang ?? 'top', edge = o.edge ?? 'stepped', fill = o.fill ?? 'solid'
  const outline = o.outline !== false
  if (!grid.length) return null

  let field = pointDensity(terrain, p, o.source ?? 'elevation', o.gamma ?? 1, o.azimuth ?? 315)
  const blur = Math.round((o.blur ?? 2) / scl)
  if (blur > 0) field = boxBlur(field, cols, rows, blur, sMask)

  const theta = ((o.angle ?? 0) * Math.PI) / 180
  const dx = Math.cos(theta), dz = Math.sin(theta), nx = -dz, nz = dx
  const cc = (cols - 1) / 2, rc = (rows - 1) / 2
  const reach = Math.hypot(cc, rc) + Math.max(pitch, cellW)
  const at = (u, v) => [cc + dx * u + nx * v, rc + dz * u + nz * v]

  // The depth at one point of the row band, in grid cells: 0 off the data.
  const depthAt = (u, v) => {
    const [c, r] = at(u, v)
    if (!(c >= 0 && r >= 0 && c <= cols - 1 && r <= rows - 1)) return 0
    const b = sampleBilinear(field, sMask, rows, cols, r, c)
    if (b !== b) return 0
    let x = b <= floor ? 0 : (b - floor) / (1 - floor)
    if (steps > 0) x = Math.round(x * steps) / steps
    return Math.max(0, Math.min(1, x)) * maxDepth
  }

  const out = { positions: new F32List(), colors: new F32List() }
  const stroke = (u0, v0, u1, v1, ang) => {
    const [c0, r0] = at(u0, v0), [c1, r1] = at(u1, v1)
    const s = clipToGrid(rows, cols, c0, r0, c1, r1)
    if (s) drapeEdge(out, terrain, p, sMask, s[0], s[1], s[2], s[3], ang)
  }
  const tiny = 0.02
  let cells = 0

  /*
   * Solid bars are areas, not strokes: a draped mesh for the screen (`lids`)
   * and a closed ring for the SVG (`polys`), which writes it as a filled path
   * or, with Filled areas set to Hatch, as hatch strokes. The mesh is sampled
   * about once a grid cell each way, so it follows the ground. A point off
   * the raster is moved onto its edge, which cuts a bar there.
   */
  const lidP = new F32List(), lidC = new F32List(), lidI = new U32List()
  const ringP = new F32List(), ringStarts = [], ringInks = []
  const elevScale = p.elevScale ?? 1
  let lastE = minElev
  const vertex = (u, w) => {
    let [c, r] = at(u, w)
    c = c < 0 ? 0 : c > cols - 1 ? cols - 1 : c
    r = r < 0 ? 0 : r > rows - 1 ? rows - 1 : r
    const b = sampleBilinear(grid, sMask, rows, cols, r, c)
    if (b === b) lastE = (b - 0.5) * 100 * elevScale
    return [c * scl - halfW, lastE, r * scl - halfH]
  }
  const inkOf = (u, w) => {
    const [x, y, z] = vertex(u, w)
    const i = Math.round((z + halfH) / scl) * cols + Math.round((x + halfW) / scl)
    return computeVertexColor(normElev(y, minElev, maxElev), (gridSlopes?.[i] ?? 0) / (maxSlope || 1), theta, p)
  }
  const solidBar = (su, sd, lo, hi, rgb) => {
    let dm = 0
    for (const d of sd) if (d > dm) dm = d
    const m = Math.max(1, Math.ceil(dm / 1.5))
    const base = lidP.n / 3, nu = su.length
    for (let a = 0; a < nu; a++) {
      const l = lo(sd[a]), h = hi(sd[a])
      for (let t = 0; t <= m; t++) {
        const [x, y, z] = vertex(su[a], l + ((h - l) * t) / m)
        lidP.push3(x, y, z); lidC.push3(rgb[0], rgb[1], rgb[2])
      }
    }
    for (let a = 0; a < nu - 1; a++) {
      for (let t = 0; t < m; t++) {
        const i0 = base + a * (m + 1) + t, i1 = i0 + m + 1
        lidI.push3(i0, i1, i0 + 1); lidI.push3(i0 + 1, i1, i1 + 1)
      }
    }
    // The ring: along the hanging edge, then back along the free one.
    ringStarts.push(ringP.n / 3)
    for (let a = 0; a < nu; a++) { const [x, y, z] = vertex(su[a], lo(sd[a])); ringP.push3(x, y, z) }
    for (let a = nu - 1; a >= 0; a--) { const [x, y, z] = vertex(su[a], hi(sd[a])); ringP.push3(x, y, z) }
    ringInks.push(rgb[0], rgb[1], rgb[2])
  }

  const k0 = Math.floor(-reach / pitch), k1 = Math.ceil(reach / pitch)
  for (let k = k0; k <= k1; k++) {
    const v = k * pitch, mid = v + pitch / 2
    // The edge a bar hangs from, and the side it grows towards, across the row.
    const lo = hang === 'bottom' ? (d) => v + pitch - d : hang === 'centre' ? (d) => mid - d / 2 : () => v
    const hi = hang === 'bottom' ? () => v + pitch : hang === 'centre' ? (d) => mid + d / 2 : (d) => v + d
    const shift = o.stagger && (k & 1) ? cellW / 2 : 0
    const j0 = Math.floor((-reach - shift) / cellW), j1 = Math.ceil((reach - shift) / cellW)
    for (let j = j0; j <= j1; j++) {
      const u0 = j * cellW + shift + gap / 2, u1 = (j + 1) * cellW + shift - gap / 2
      if (u1 - u0 < 0.1) continue
      // The nodes of the free edge along the cell.
      let us, ds
      if (edge === 'stepped') {
        const d = depthAt((u0 + u1) / 2, mid)
        us = [u0, u1]; ds = [d, d]
      } else if (edge === 'traced') {
        const n = Math.max(1, Math.ceil(u1 - u0))
        us = []; ds = []
        for (let i = 0; i <= n; i++) { const u = u0 + ((u1 - u0) * i) / n; us.push(u); ds.push(depthAt(u, mid)) }
      } else {
        us = [u0, u1]; ds = [depthAt(u0, mid), depthAt(u1, mid)]
      }
      let dmax = 0
      for (const d of ds) if (d > dmax) dmax = d
      if (dmax < tiny) continue
      cells++

      if (fill === 'solid') {
        const rgb = inkOf((u0 + u1) / 2, mid)
        for (const [a, b] of depthIntervals(us, ds, tiny)) {
          // The edge's own nodes, with no step longer than a grid cell.
          const knots = [a]
          for (const u of us) if (u > a && u < b) knots.push(u)
          knots.push(b)
          const su = []
          for (let i = 0; i < knots.length - 1; i++) {
            const n = Math.max(1, Math.ceil(knots[i + 1] - knots[i]))
            for (let q = 0; q < n; q++) su.push(knots[i] + ((knots[i + 1] - knots[i]) * q) / n)
          }
          su.push(b)
          solidBar(su, su.map((u) => depthOn(us, ds, u)), lo, hi, rgb)
        }
      } else if (fill === 'lines') {
        // Strokes along the row, each where the bar is deep enough to hold it.
        const qs = []
        if (hang === 'centre') for (let i = 0; 2 * i * fp <= dmax; i++) qs.push([2 * i * fp, i ? [mid - i * fp, mid + i * fp] : [mid]])
        else for (let q = fp / 2; q <= dmax; q += fp) qs.push([q, [hang === 'bottom' ? v + pitch - q : v + q]])
        for (const [q, ws] of qs) {
          for (const [a, b] of depthIntervals(us, ds, Math.max(q, tiny))) for (const w of ws) stroke(a, w, b, w, theta)
        }
      } else if (fill === 'comb') {
        // Strokes across the bar, at fixed steps along the row.
        for (let u = u0 + fp / 2; u <= u1; u += fp) {
          const d = depthOn(us, ds, u)
          if (d >= tiny) stroke(u, lo(d), u, hi(d), theta + Math.PI / 2)
        }
      }

      if (outline) {
        // Round each part of the bar that has depth: both long edges, then the
        // two ends. Where the edge runs out to nothing, so does the outline.
        for (const [a, b] of depthIntervals(us, ds, tiny)) {
          const pu = [a], pd = [depthOn(us, ds, a)]
          for (let i = 0; i < us.length; i++) if (us[i] > a && us[i] < b) { pu.push(us[i]); pd.push(ds[i]) }
          pu.push(b); pd.push(depthOn(us, ds, b))
          for (let i = 0; i < pu.length - 1; i++) {
            stroke(pu[i], lo(pd[i]), pu[i + 1], lo(pd[i + 1]), theta)
            stroke(pu[i], hi(pd[i]), pu[i + 1], hi(pd[i + 1]), theta)
          }
          const dl = pd[0], dr = pd[pd.length - 1]
          if (dl > 2 * tiny) stroke(a, lo(dl), a, hi(dl), theta + Math.PI / 2)
          if (dr > 2 * tiny) stroke(b, lo(dr), b, hi(dr), theta + Math.PI / 2)
        }
      }
    }
  }
  if (!out.positions.length && !lidI.n) return null
  const res = { positions: out.positions.toArray(), colors: out.colors.toArray(), note: { cells } }
  if (lidI.n) {
    res.lids = { positions: lidP.toArray(), colors: lidC.toArray(), indices: lidI.toArray(), hugsSurface: true }
    ringStarts.push(ringP.n / 3)
    res.polys = { positions: ringP.toArray(), starts: Uint32Array.from(ringStarts), inks: Float32Array.from(ringInks) }
  }
  return res
}
