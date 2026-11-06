/**
 * The ground as a structure: Cross-Stitch and TIN Facets.
 *
 * Each lays a discrete structure over the ground and draws it: a stitch grid
 * and a triangulated irregular network. Heights are shares of
 * the plate's height range. Where a plane needs a vertical scale, the full
 * range stands 0.375 of the plate's longer side, as in the sketches.
 */
import Delaunator from 'delaunator'
import { boxBlur, sampleBilinear } from '../terrain'
import { drapeEdge, mulberry32 } from './shared.js'
import { done, heightRange, stroke, writer } from './symbols.js'
import { sampleByDensity } from './tone.js'

const RAD = Math.PI / 180
const next = (e) => (e % 3 === 2 ? e - 2 : e + 1)

/** The plane through three [c, r, z] points, as its normal and z(c, r). */
function plane(A, B, C) {
  const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2]
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  return { n: [nx, ny, nz], z: (c, r) => A[2] - (nx * (c - A[0]) + ny * (r - A[1])) / (nz || 1e-12) }
}

// ─── Cross-Stitch ────────────────────────────────────────────────────────────

/**
 * The plate stitched on Aida cloth.
 *
 * A grid of `cell` raster pixels takes the height at each cell centre and
 * splits the ground into `bands` classes with equal shares of it. The lowest
 * class is bare cloth, the next takes a half stitch and the rest full crosses.
 * The lower half of the stitched classes is the light thread (`lightColor`),
 * the upper half the mode's ink. With `back`, a backstitch runs along every
 * cell edge where the class changes, once either side is a full cross.
 */
export function buildStitch(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  if (!heightRange(grid, gridMask)) return null
  const C = Math.max(2, (o.cell ?? 8) / scl)
  const nc = Math.floor((cols - 1) / C), nr = Math.floor((rows - 1) / C)
  if (nc < 1 || nr < 1) return null
  const nB = Math.max(3, Math.min(9, Math.round(o.bands ?? 5)))
  const vals = []
  for (let i = 0; i < grid.length; i += 7) if (gridMask[i]) vals.push(grid[i])
  vals.sort((a, b) => a - b)
  const cut = []
  for (let k = 1; k < nB; k++) cut.push(vals[Math.floor(k / nB * (vals.length - 1))])
  const band = new Int8Array(nc * nr)
  for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
    const c = (i + 0.5) * C, r = (j + 0.5) * C
    if (!gridMask[Math.round(r) * cols + Math.round(c)]) { band[j * nc + i] = -1; continue }
    const v = sampleBilinear(grid, sMask, rows, cols, r, c)
    let b = 0
    while (b < cut.length && v >= cut[b]) b++
    band[j * nc + i] = b
  }
  const lightTop = Math.floor((nB - 1) / 2)
  const light = writer(), dark = writer(), lightInk = { ...p, lineColor: o.lightColor ?? p.lineColor }
  const g = C * 0.15, w = C - 2 * g
  let stitches = 0
  for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
    const b = band[j * nc + i]
    if (b <= 0) continue
    const x = i * C + g, y = j * C + g, out = b <= lightTop ? light : dark, ink = b <= lightTop ? lightInk : p
    stroke(out, terrain, ink, sMask, [[x, y + w], [x + w, y]])
    if (b > 1) stroke(out, terrain, ink, sMask, [[x, y], [x + w, y + w]])
    stitches++
  }
  if (!stitches) return null
  const note = { stitches }
  const res = {}
  if (light.positions.length) res['Stitch-Light'] = done(light, note)
  if (dark.positions.length) res['Stitch-Dark'] = done(dark, note)
  if (o.back ?? true) {
    const back = writer()
    for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
      const b = band[j * nc + i]
      if (b < 0) continue
      if (i + 1 < nc) { const e = band[j * nc + i + 1]; if (e >= 0 && e !== b && Math.max(e, b) >= 2) stroke(back, terrain, p, sMask, [[(i + 1) * C, j * C], [(i + 1) * C, (j + 1) * C]]) }
      if (j + 1 < nr) { const e = band[(j + 1) * nc + i]; if (e >= 0 && e !== b && Math.max(e, b) >= 2) stroke(back, terrain, p, sMask, [[i * C, (j + 1) * C], [(i + 1) * C, (j + 1) * C]]) }
    }
    if (back.positions.length) res['Stitch-Back'] = done(back, note)
  }
  return res
}

// ─── TIN Facets ──────────────────────────────────────────────────────────────

/**
 * A triangulated irregular network, each facet hatched by its own light.
 *
 * Points are picked with a chance of `floor` plus the rest times the
 * curvature, as a share of its 95th percentile, the way VIP selection keeps
 * the points that matter. `count` points and the plate's corners and edges are
 * triangulated (Delaunator). Each facet's plane gives its shade under a sun at
 * `azimuth` and 45°. A facet is hatched along its fall line, `pitch` raster
 * pixels apart where it faces away from the sun and sparser as it turns to
 * it, and a facet almost square to the sun is left bare. With `edges`, the
 * facets' edges are a second pen.
 */
export function buildTin(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const range = heightRange(grid, gridMask)
  if (!range) return null
  const [lo, hi] = range
  const M = Math.max(rows, cols), Z = 0.375 * M / (hi - lo)
  const B = boxBlur(grid, cols, rows, 1, sMask)
  const d = Math.max(1, Math.round(0.01 * M))
  const imp = new Float32Array(grid.length)
  for (let r = d; r < rows - d; r++) for (let c = d; c < cols - d; c++) {
    const i = r * cols + c
    imp[i] = Math.abs(B[i - d] + B[i + d] + B[i - d * cols] + B[i + d * cols] - 4 * B[i])
  }
  const smp = []
  for (let i = 0; i < imp.length; i += 5) if (gridMask[i]) smp.push(imp[i])
  smp.sort((a, b) => a - b)
  const q95 = smp[Math.floor(smp.length * 0.95)] || 1e-9
  const floor = Math.max(0, Math.min(1, o.floor ?? 0.03))
  const density = new Float32Array(grid.length)
  for (let i = 0; i < grid.length; i++) density[i] = floor + (1 - floor) * Math.min(1, imp[i] / q95)
  const rng = mulberry32(Math.round(o.seed ?? 1))
  const { xs, ys } = sampleByDensity(terrain, density, Math.max(10, Math.min(20000, Math.round(o.count ?? 1500))), rng)
  for (let k = 0; k <= 8; k++) {
    const fc = k / 8 * (cols - 1), fr = k / 8 * (rows - 1)
    xs.push(fc, fc, 0, cols - 1); ys.push(0, rows - 1, fr, fr)
  }
  const n = xs.length, coords = new Float64Array(n * 2), zs = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    coords[2 * k] = xs[k]; coords[2 * k + 1] = ys[k]
    zs[k] = (sampleBilinear(B, sMask, rows, cols, ys[k], xs[k]) - lo) * Z
  }
  const { triangles, halfedges } = new Delaunator(coords)
  const az = (o.azimuth ?? 315) * RAD, alt = 45 * RAD
  const L = [Math.sin(az) * Math.cos(alt), -Math.cos(az) * Math.cos(alt), Math.sin(alt)]
  const pitch = Math.max(0.5, (o.pitch ?? 2) / scl)
  const hatch = writer()
  let facets = 0
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2]
    const P = [[xs[a], ys[a]], [xs[b], ys[b]], [xs[c], ys[c]]]
    const cen = [(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3]
    if (!gridMask[Math.round(cen[1]) * cols + Math.round(cen[0])]) continue
    facets++
    let [nx, ny, nz] = plane([...P[0], zs[a]], [...P[1], zs[b]], [...P[2], zs[c]]).n
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz }
    const len = Math.hypot(nx, ny, nz) || 1, sh = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / len)
    if (sh > 0.93) continue
    // The normal leans the way the facet falls.
    const hl = Math.hypot(nx, ny), dx = hl > 1e-9 ? nx / hl : 1, dy = hl > 1e-9 ? ny / hl : 0, qx = -dy, qy = dx
    const sp = pitch * (1 + 4.7 * sh)
    let ext = 0
    for (const [x, y] of P) ext = Math.max(ext, Math.hypot(x - cen[0], y - cen[1]))
    for (let off = -ext + ((ext % sp) || 0) / 2; off <= ext; off += sp) {
      const ox = cen[0] + qx * off, oy = cen[1] + qy * off
      let t0 = Infinity, t1 = -Infinity
      for (let e = 0; e < 3; e++) {
        const U = P[e], V = P[(e + 1) % 3], ex = V[0] - U[0], ey = V[1] - U[1]
        const den = dx * ey - dy * ex
        if (Math.abs(den) < 1e-12) continue
        const wx = U[0] - ox, wy = U[1] - oy
        const s = (wx * dy - wy * dx) / den
        if (s < 0 || s > 1) continue
        const tt = (wx * ey - wy * ex) / den
        t0 = Math.min(t0, tt); t1 = Math.max(t1, tt)
      }
      if (t1 - t0 > 1e-6) drapeEdge(hatch, terrain, p, sMask, ox + dx * t0, oy + dy * t0, ox + dx * t1, oy + dy * t1, Math.atan2(dy, dx))
    }
  }
  if (!facets) return null
  const note = { facets }
  const out = { 'Tin-Hatch': done(hatch, note) }
  if (o.edges ?? true) {
    const edges = writer()
    for (let e = 0; e < triangles.length; e++) {
      if (halfedges[e] > e) continue
      const a = triangles[e], b = triangles[next(e)]
      drapeEdge(edges, terrain, p, sMask, xs[a], ys[a], xs[b], ys[b], Math.atan2(ys[b] - ys[a], xs[b] - xs[a]))
    }
    out['Tin-Edges'] = done(edges, note)
  }
  return out
}
