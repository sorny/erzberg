/**
 * Processes: Sand Ripples and Hoarfrost.
 *
 * Each draws the trace a process leaves on the ground: wind combing sand, and
 * frost growing from the cold summits. The sketches on the
 * Forty New Marks page ran on a 160-cell plate, and the constants here are
 * those of the sketches, scaled to the plate's longer side `M`.
 */
import { boxBlur } from '../terrain'
import { drapeEdge, mulberry32, traceLevelSet } from './shared.js'
import { done, heightRange, writer } from './symbols.js'

const RAD = Math.PI / 180
const clamp01 = (v, d) => Math.max(0, Math.min(1, v ?? d))

/** A field for `traceLevelSet`: `src` on the ground, −1 off it. */
function groundField(src, gridMask) {
  const field = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) field[i] = gridMask[i] ? src[i] : -1
  return field
}

/**
 * Up to `count` summits of `B`, highest first, as [col, row].
 *
 * Constellation's test: a cell that is the highest within `win` cells and
 * stands `prominence` above the lowest point there, kept clear of the plate
 * edge, where a raster clipped flat tops out along the whole edge.
 */
export function summits(B, gridMask, rows, cols, win, count, prominence) {
  const edge = Math.max(2, Math.round(win / 3)), cand = []
  for (let r = edge; r < rows - edge; r++) {
    for (let c = edge; c < cols - edge; c++) {
      const i = r * cols + c, v = B[i]
      if (!gridMask[i]) continue
      let top = true
      for (let j = -1; j <= 1 && top; j++) for (let k = -1; k <= 1; k++) if ((j || k) && B[i + j * cols + k] > v) { top = false; break }
      if (top) cand.push(i)
    }
  }
  cand.sort((a, b) => B[b] - B[a])
  const out = []
  for (const i of cand) {
    if (out.length >= count) break
    const r = (i / cols) | 0, c = i % cols
    let top = true, low = B[i]
    for (let j = Math.max(0, r - win); j <= Math.min(rows - 1, r + win) && top; j++) {
      for (let k = Math.max(0, c - win); k <= Math.min(cols - 1, c + win); k++) {
        const v = B[j * cols + k]
        if (v > B[i]) { top = false; break }
        if (v < low) low = v
      }
    }
    if (top && B[i] - low > prominence && out.every(([sc, sr]) => Math.hypot(sc - c, sr - r) > win)) out.push([c, r])
  }
  return out
}

// ─── Sand Ripples ────────────────────────────────────────────────────────────

/**
 * Wind ripples combed across the low ground.
 *
 * A phase runs along the wind from `azimuth` and is shifted by the blurred
 * height, `warp` times 9% of the plate for the whole range, plus a slow
 * meander. The crests are the zero lines of its sine, `wavelength` raster
 * pixels apart, so they bend round the hills and split and join where the
 * ground crowds them. The dune field ends at `top`, a share of the height
 * range. With `rock`, `levels` contours of the ground above it are a second
 * pen in `rockColor`, starting with the dune field's edge.
 */
export function buildRipples(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const range = heightRange(grid, gridMask)
  if (!range) return null
  const [lo, hi] = range
  const B = boxBlur(grid, cols, rows, 3, sMask)
  const M = Math.max(rows, cols)
  const to = ((o.azimuth ?? 300) + 180) * RAD, wx = Math.sin(to), wy = -Math.cos(to)
  // Three cells a wave at least, or the crests alias into a moiré.
  const lam = Math.max(3, (o.wavelength ?? 6) / scl)
  const warp = (o.warp ?? 1) * 0.09 * M
  const top = lo + clamp01(o.top, 0.6) * (hi - lo)
  const field = new Float32Array(grid.length)
  let sand = 0, ground = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { field[i] = -1; continue }
      ground++
      if (B[i] >= top) { field[i] = -1; continue }
      sand++
      const d = c * wx + r * wy + warp * (B[i] - lo) / (hi - lo) + 0.014 * M * Math.sin((r * 0.05 + c * 0.02) * 160 / M)
      // Lifted by one: traceLevelSet reads a negative value as no ground.
      field[i] = 1 + Math.sin(2 * Math.PI * d / lam)
    }
  }
  if (!sand) return null
  const note = { sand: sand / ground }
  const crests = traceLevelSet(terrain, p, field, [1], 1)
  if (!crests.positions.length) return null
  const out = { 'Ripples-Sand': { ...crests, note } }
  if (o.rock && top < hi) {
    const n = Math.max(1, Math.min(40, Math.round(o.levels ?? 8))), levels = []
    for (let k = 0; k < n; k++) levels.push(top + k / n * (hi - top))
    const rock = traceLevelSet(terrain, { ...p, lineColor: o.rockColor ?? p.lineColor }, groundField(B, gridMask), levels, 2)
    if (rock.positions.length) out['Ripples-Rock'] = { ...rock, note }
  }
  return out
}

// ─── Hoarfrost ───────────────────────────────────────────────────────────────

/**
 * Ice crystals grown from the summits by diffusion-limited aggregation.
 *
 * The crystal lives on a lattice of `cell` raster pixels. It starts on the
 * `seeds` highest summits above `cold`, a share of the height range. A walker
 * is launched ten cells from a random part of the crystal and steps at random
 * until it touches the crystal, where it sticks, or leaves the cold ground,
 * where it dies. Each stuck walker is joined to the one it touched, so the
 * pen draws the branches. `count` walkers stick at most. With `line`, the
 * cold line is a dotted second pen.
 */
export function buildHoarfrost(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const range = heightRange(grid, gridMask)
  if (!range) return null
  const [lo, hi] = range
  const B = boxBlur(grid, cols, rows, 2, sMask)
  const cold = lo + clamp01(o.cold, 0.5) * (hi - lo)
  const k = Math.max(1, (o.cell ?? 3) / scl)
  const W = Math.floor((cols - 1) / k) + 1, Hh = Math.floor((rows - 1) / k) + 1
  const ok = new Uint8Array(W * Hh)
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const c = i * k, r = j * k
    ok[j * W + i] = gridMask[Math.round(r) * cols + Math.round(c)] && B[Math.round(r) * cols + Math.round(c)] > cold ? 1 : 0
  }
  const M = Math.max(rows, cols)
  const tops = summits(B, gridMask, rows, cols, Math.max(3, Math.round(M / 12)), Math.max(1, Math.round(o.seeds ?? 7)), 0.02 * (hi - lo))
  const G = new Int32Array(W * Hh).fill(-1), pi = [], pj = [], par = []
  for (const [c, r] of tops) {
    const i = Math.round(c / k), j = Math.round(r / k)
    if (i < 0 || j < 0 || i >= W || j >= Hh || !ok[j * W + i] || G[j * W + i] >= 0) continue
    G[j * W + i] = pi.length; pi.push(i); pj.push(j); par.push(-1)
  }
  if (!pi.length) return null
  const target = Math.max(10, Math.min(40000, Math.round(o.count ?? 6000)))
  const rng = mulberry32(Math.round(o.seed ?? 1))
  for (let tries = 0; pi.length < target && tries < target * 4; tries++) {
    const b = Math.floor(rng() * pi.length), a = rng() * 2 * Math.PI
    let i = Math.round(pi[b] + Math.cos(a) * 10), j = Math.round(pj[b] + Math.sin(a) * 10)
    if (i < 1 || j < 1 || i >= W - 1 || j >= Hh - 1 || G[j * W + i] >= 0) continue
    for (let st = 0; st < 1000; st++) {
      if (i < 1 || j < 1 || i >= W - 1 || j >= Hh - 1 || !ok[j * W + i]) break
      let hit = -1
      for (let dj = -1; dj <= 1 && hit < 0; dj++) for (let di = -1; di <= 1; di++) { const g = G[(j + dj) * W + i + di]; if (g >= 0) { hit = g; break } }
      if (hit >= 0) { G[j * W + i] = pi.length; pi.push(i); pj.push(j); par.push(hit); break }
      const q = rng()
      if (q < 0.25) i++; else if (q < 0.5) i--; else if (q < 0.75) j++; else j--
    }
  }
  const ice = writer()
  for (let n = 0; n < pi.length; n++) {
    const m = par[n]
    if (m < 0) continue
    drapeEdge(ice, terrain, p, sMask, pi[n] * k, pj[n] * k, pi[m] * k, pj[m] * k, Math.atan2(pj[m] - pj[n], pi[m] - pi[n]))
  }
  if (!ice.positions.length) return null
  const note = { crystals: pi.length }
  const out = { 'Hoarfrost-Ice': done(ice, note) }
  if (o.line) {
    const line = traceLevelSet(terrain, p, groundField(B, gridMask), [cold], 2)
    if (line.positions.length) out['Hoarfrost-Line'] = { ...line, note }
  }
  return out
}
