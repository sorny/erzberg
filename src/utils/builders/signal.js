/**
 * The ground read as a signal: Line Printer, Stems, Hair, Waveform.
 *
 * Four modes after pictures that were not made from terrain at all. A SYMAP
 * line-printer map, a plot of dotted stems, a cloud of hairs and a record
 * sleeve of waveforms each draw a value with a mark of its own, and the
 * heightmap supplies the value.
 */
import { cellElev, boxBlur, sampleBilinear } from '../terrain'
import { computeVertexColor } from '../colorUtils'
import { F32List, mulberry32, normElev } from './shared.js'

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
  const out = { Stems: { positions: stem.positions.toArray(), colors: stem.colors.toArray() } }
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
 * One column of a waveform plot, read along a line across the ground.
 *
 * The line runs through the highest point of the terrain, or through its
 * middle, at a *Direction*: 0° reads top to bottom (north to south), 90° left to
 * right, 180° bottom to top, 270° right to left, and anything between is a
 * diagonal. It is clipped to the raster. At each sample the height above the
 * line's own lowest point sets the column's half-width, and the column is drawn
 * as one stroke per sample, across the reading direction: the scanlines of a
 * printed waveform, which a pen fills in one direction. *Detail* adds back the
 * short waves of the profile, the profile minus a blur of itself, so a cliff
 * band shows as a burst.
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
  const { grid, gridMask, rows, cols, scl, halfW, halfH, maxElev, hasNoData } = terrain
  let c0 = (cols - 1) / 2, r0 = (rows - 1) / 2
  if (o.line !== 'centre') {
    let best = -Infinity
    for (let i = 0; i < grid.length; i++) if (gridMask[i] && grid[i] > best) { best = grid[i]; c0 = i % cols; r0 = (i - c0) / cols }
  }
  // The reading direction in grid units (c right, r down): 0° is +r.
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
  const width = Math.max(1, o.width ?? 120)
  const gamma = Math.max(0.1, o.gamma ?? 1)
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
    const base = ((h[k] - lo) / (hi - lo)) ** gamma
    const hw = clamp01(base + gain * (h[k] - fine[k]) / (hi - lo)) * width / 2
    if (hw <= 0) continue
    const [x, z, nx, nz] = at(k)
    const from = one ? 0 : -hw, to = one ? 2 * hw : hw
    const rgb = computeVertexColor(base, 0, 0, p)
    positions.push6(x + nx * from, y, z + nz * from, x + nx * to, y, z + nz * to); colors.pushRgb2(rgb)
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}
