/**
 * Growth: Venation, Coral.
 *
 * Both grow a line on the ground instead of tracing a field: veins toward the
 * wet ground, and one closed curve that folds until it fills a region. Split
 * out like the other builder files: geometryBuilders.js keeps the dispatcher
 * and re-exports the public API.
 */
import { boxBlur, sampleBilinear } from '../terrain'
import { F32List, drapeEdge, mulberry32 } from './shared.js'

// ─── Venation ────────────────────────────────────────────────────────────────

/**
 * A leaf-vein network that grows up the valleys from their outlets.
 *
 * Space colonization (Runions et al., 2005). Attractor points are scattered
 * over the ground, denser where it is wet. Every attractor pulls on the vein
 * node nearest to it, within `reach`. Each node with a pull grows one step
 * toward the mean direction of its attractors, and an attractor dies when a
 * vein comes within a step of it. The veins stop when no attractor is left in
 * reach of any of them.
 *
 * Wetness is the topographic wetness index ln(a / tan β): a is the area that
 * drains through a cell, by D8 on a blurred grid as Watershed does, and β is
 * the slope. The veins therefore climb the valley floors first and reach the
 * slopes last, and the roots sit at the outlets that drain the most ground.
 *
 * The nearest node of each attractor is kept, and a new node updates only the
 * attractors round it. A search over every node for every attractor at every
 * step costs thousands of times more on a full raster. A new node closer than
 * half a step to an old one is dropped, so a vein cannot grow in place.
 */
export function buildVenation(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, gridSlopes, maxSlope } = terrain
  const n = rows * cols
  const sMask = terrain.hasNoData ? gridMask : null
  const rng = mulberry32(Math.round(o.seed ?? 1))

  // D8 to the lowest neighbour, then accumulation from the tops down.
  const g = boxBlur(grid, cols, rows, 2, sMask)
  const next = new Int32Array(n).fill(-1), inDeg = new Int32Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      let lo = g[i], t = -1
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc
          if ((!dr && !dc) || nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue
          const q = nr * cols + nc
          if (gridMask[q] && g[q] < lo) { lo = g[q]; t = q }
        }
      }
      if (t >= 0) { next[i] = t; inDeg[t]++ }
    }
  }
  const acc = new Float32Array(n).fill(1), queue = new Int32Array(n)
  let qn = 0
  for (let i = 0; i < n; i++) if (gridMask[i] && !inDeg[i]) queue[qn++] = i
  for (let h = 0; h < qn; h++) {
    const i = queue[h], d = next[i]
    if (d < 0) continue
    acc[d] += acc[i]
    if (--inDeg[d] === 0) queue[qn++] = d
  }

  const wet = new Float32Array(n)
  const vals = []
  const tanRef = (maxSlope || 1) * 0.01
  for (let i = 0; i < n; i++) {
    if (!gridMask[i]) continue
    wet[i] = Math.log(acc[i] / Math.max(tanRef, gridSlopes[i]))
    if ((i & 7) === 0) vals.push(wet[i])
  }
  if (!vals.length) return null
  vals.sort((a, b) => a - b)
  const wLo = vals[Math.floor(vals.length * 0.3)], wHi = vals[Math.floor(vals.length * 0.99)]
  const gamma = Math.max(0.2, o.gamma ?? 1.2)

  // Attractors, by rejection against the wetness.
  const count = Math.max(100, Math.min(40000, Math.round(o.count ?? 6000)))
  const ax = new Float32Array(count), ay = new Float32Array(count)
  let na = 0
  for (let t = 0; t < count * 40 && na < count; t++) {
    const x = rng() * (cols - 1), y = rng() * (rows - 1), i = Math.round(y) * cols + Math.round(x)
    if (!gridMask[i]) continue
    const w = Math.min(1, Math.max(0.12, (wet[i] - wLo) / ((wHi - wLo) || 1))) ** gamma
    if (rng() < w) { ax[na] = x; ay[na] = y; na++ }
  }

  const D = Math.max(0.75, (o.spacing ?? 3) / scl)
  const reach = Math.max(6 * D, 2.5 * Math.sqrt((rows * cols) / Math.max(1, na)))
  const kill = 1.5 * D

  // Roots: the sinks that drain the most ground, a reach apart.
  const sinks = []
  for (let i = 0; i < n; i++) if (gridMask[i] && next[i] < 0 && acc[i] > 1) sinks.push(i)
  sinks.sort((a, b) => acc[b] - acc[a])
  const nx = [], ny = [], par = []
  const roots = Math.max(1, Math.min(40, Math.round(o.roots ?? 6)))
  for (const i of sinks) {
    const x = i % cols, y = (i / cols) | 0
    if (nx.every((v, q) => Math.hypot(v - x, ny[q] - y) > reach)) { nx.push(x); ny.push(y); par.push(-1) }
    if (nx.length >= roots) break
  }
  if (!nx.length) return null

  // Attractors bucketed by the reach, for the node-to-attractor updates.
  const B = reach, bw = Math.ceil(cols / B) + 1, bh = Math.ceil(rows / B) + 1
  const abuck = Array.from({ length: bw * bh }, () => [])
  for (let a = 0; a < na; a++) abuck[Math.floor(ay[a] / B) * bw + Math.floor(ax[a] / B)].push(a)
  const near = new Int32Array(na).fill(-1), nearD = new Float32Array(na).fill(Infinity)
  const alive = new Uint8Array(na).fill(1)
  const seeNode = (q) => {
    const bi = Math.floor(nx[q] / B), bj = Math.floor(ny[q] / B)
    for (let y = bj - 1; y <= bj + 1; y++) {
      if (y < 0 || y >= bh) continue
      for (let x = bi - 1; x <= bi + 1; x++) {
        if (x < 0 || x >= bw) continue
        for (const a of abuck[y * bw + x]) {
          if (!alive[a]) continue
          const d = Math.hypot(ax[a] - nx[q], ay[a] - ny[q])
          if (d < kill) { alive[a] = 0; continue }
          if (d < reach && d < nearD[a]) { nearD[a] = d; near[a] = q }
        }
      }
    }
  }
  for (let q = 0; q < nx.length; q++) seeNode(q)

  // Every node, bucketed by the step. A node pulled the same way at each step
  // would grow a new child on top of the last one, again and again, and on a
  // full raster that ran to hundreds of thousands of nodes on a few veins.
  const nbw = Math.ceil(cols / D) + 1, nodeAt = new Map()
  const addNode = (q) => {
    const k = Math.floor(ny[q] / D) * nbw + Math.floor(nx[q] / D)
    const l = nodeAt.get(k)
    l ? l.push(q) : nodeAt.set(k, [q])
  }
  const crowded = (x, y) => {
    const bi = Math.floor(x / D), bj = Math.floor(y / D)
    for (let v = bj - 1; v <= bj + 1; v++) {
      for (let u = bi - 1; u <= bi + 1; u++) {
        for (const q of nodeAt.get(v * nbw + u) || []) if (Math.hypot(nx[q] - x, ny[q] - y) < 0.5 * D) return true
      }
    }
    return false
  }
  for (let q = 0; q < nx.length; q++) addNode(q)

  const maxNodes = 80000, maxIter = Math.ceil(6 * (rows + cols) / D)
  for (let it = 0; it < maxIter && nx.length < maxNodes; it++) {
    const pull = new Map()
    for (let a = 0; a < na; a++) {
      if (!alive[a] || near[a] < 0) continue
      const q = near[a], d = nearD[a] || 1
      const v = pull.get(q)
      if (v) { v[0] += (ax[a] - nx[q]) / d; v[1] += (ay[a] - ny[q]) / d }
      else pull.set(q, [(ax[a] - nx[q]) / d, (ay[a] - ny[q]) / d])
    }
    if (!pull.size) break
    const first = nx.length
    for (const [q, [dx, dy]] of pull) {
      let m = Math.hypot(dx, dy)
      // Pulled equally from opposite sides: a small kick, or the node sits still.
      const jx = m < 1e-6 ? rng() - 0.5 : dx, jy = m < 1e-6 ? rng() - 0.5 : dy
      m = Math.hypot(jx, jy) || 1
      const x = nx[q] + jx / m * D, y = ny[q] + jy / m * D
      const i = Math.round(y) * cols + Math.round(x)
      if (x < 0 || y < 0 || x > cols - 1 || y > rows - 1 || !gridMask[i] || crowded(x, y)) continue
      nx.push(x); ny.push(y); par.push(q)
      addNode(nx.length - 1)
    }
    if (nx.length === first) break
    for (let q = first; q < nx.length; q++) seeNode(q)
  }

  const out = { positions: new F32List(), colors: new F32List() }
  for (let q = 0; q < nx.length; q++) {
    const a = par[q]
    if (a < 0) continue
    drapeEdge(out, terrain, p, sMask, nx[a], ny[a], nx[q], ny[q], Math.atan2(ny[q] - ny[a], nx[q] - nx[a]))
  }
  return { positions: out.positions.toArray(), colors: out.colors.toArray(), note: { nodes: nx.length } }
}

// ─── Coral ───────────────────────────────────────────────────────────────────

/**
 * One closed line that grows until it fills the ground above a level.
 *
 * Differential growth. Each node pulls toward the midpoint of its two
 * neighbours on the curve, and pushes away every other node within a radius.
 * An edge longer than about half the local radius splits in two, so the
 * curve lengthens and has to fold to keep its gap, which gives the brain-coral
 * maze. The radius is `spacing`, and it shrinks by up to half on the steepest
 * ground, so the folds pack tight on steep slopes and loosen on the flats. The
 * split length shrinks with it: with a fixed one, the nodes on steep ground sit
 * farther apart than the radius, stop pushing, and the curve stops growing.
 *
 * The region is a hard wall: a node that would step out of it stays where it
 * is. The curve starts as a small ring at the highest point and grows until it
 * has `nodes` nodes or runs out of steps. It never crosses itself, because two
 * strands closer than the radius always push apart.
 */
export function buildCoral(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, gridSlopes, maxSlope } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const rng = mulberry32(Math.round(o.seed ?? 1))
  const r0 = Math.max(1, (o.spacing ?? 4) / scl)

  let lo = Infinity, hi = -Infinity, top = -1
  for (let i = 0; i < grid.length; i++) {
    if (!gridMask[i]) continue
    if (grid[i] < lo) lo = grid[i]
    if (grid[i] > hi) { hi = grid[i]; top = i }
  }
  if (top < 0 || !(hi > lo)) return null
  const level = lo + Math.max(0, Math.min(0.99, o.level ?? 0.3)) * (hi - lo)
  const inside = (x, y) => {
    if (x < 0 || y < 0 || x > cols - 1 || y > rows - 1) return false
    if (!gridMask[Math.round(y) * cols + Math.round(x)]) return false
    return sampleBilinear(grid, sMask, rows, cols, y, x) >= level
  }
  const slopeAt = (x, y) => gridSlopes[Math.round(y) * cols + Math.round(x)] / (maxSlope || 1)

  // The seed ring: small, inside the region, round the top.
  let xs = [], ys = []
  const cx = top % cols, cy = (top / cols) | 0
  for (let ring = 3 * r0; ring >= 0.5 && !xs.length; ring *= 0.5) {
    const m = Math.max(8, Math.round(2 * Math.PI * ring / (0.2 * r0)))
    const px = [], py = []
    for (let q = 0; q < m; q++) { px.push(cx + Math.cos(q / m * 2 * Math.PI) * ring); py.push(cy + Math.sin(q / m * 2 * Math.PI) * ring) }
    if (px.every((x, q) => inside(x, py[q]))) { xs = px; ys = py }
  }
  if (!xs.length) return null

  const maxNodes = Math.max(200, Math.min(60000, Math.round(o.nodes ?? 12000)))
  const steps = Math.max(10, Math.min(20000, Math.round(o.steps ?? 3000)))
  const cap = 0.2 * r0
  const radiusAt = (x, y) => r0 * (1 - 0.5 * slopeAt(x, y))
  const B = r0, bw = Math.ceil(cols / B) + 1, bh = Math.ceil(rows / B) + 1
  for (let it = 0; it < steps && xs.length < maxNodes; it++) {
    const m = xs.length
    // Counting sort of the nodes into buckets, rebuilt every step.
    const head = new Int32Array(bw * bh + 1), order = new Int32Array(m), cell = new Int32Array(m)
    for (let q = 0; q < m; q++) { cell[q] = Math.floor(ys[q] / B) * bw + Math.floor(xs[q] / B); head[cell[q] + 1]++ }
    for (let b = 0; b < bw * bh; b++) head[b + 1] += head[b]
    const fill = head.slice()
    for (let q = 0; q < m; q++) order[fill[cell[q]]++] = q
    const fx = new Float64Array(m), fy = new Float64Array(m)
    for (let q = 0; q < m; q++) {
      const a = q ? q - 1 : m - 1, b = q < m - 1 ? q + 1 : 0, x = xs[q], y = ys[q]
      fx[q] += ((xs[a] + xs[b]) / 2 - x) * 0.3
      fy[q] += ((ys[a] + ys[b]) / 2 - y) * 0.3
      const rr = radiusAt(x, y)
      const bi = Math.floor(x / B), bj = Math.floor(y / B)
      for (let v = bj - 1; v <= bj + 1; v++) {
        if (v < 0 || v >= bh) continue
        for (let u = bi - 1; u <= bi + 1; u++) {
          if (u < 0 || u >= bw) continue
          const c = v * bw + u
          for (let s = head[c]; s < head[c + 1]; s++) {
            const w = order[s]
            if (w === q || w === a || w === b) continue
            const dx = x - xs[w], dy = y - ys[w], d = Math.hypot(dx, dy)
            if (d > 0 && d < rr) { const f = (1 - d / rr) * 0.5 * rr; fx[q] += dx / d * f; fy[q] += dy / d * f }
          }
        }
      }
    }
    for (let q = 0; q < m; q++) {
      const f = Math.hypot(fx[q], fy[q]), k = f > cap ? cap / f : 1
      const x = xs[q] + fx[q] * k, y = ys[q] + fy[q] * k
      if (inside(x, y)) { xs[q] = x; ys[q] = y }
    }
    const nx = [], ny = []
    for (let q = 0; q < m; q++) {
      nx.push(xs[q]); ny.push(ys[q])
      const b = q < m - 1 ? q + 1 : 0
      if (Math.hypot(xs[b] - xs[q], ys[b] - ys[q]) > 0.42 * radiusAt((xs[q] + xs[b]) / 2, (ys[q] + ys[b]) / 2)) {
        const x = (xs[q] + xs[b]) / 2 + (rng() - 0.5) * 0.02 * r0, y = (ys[q] + ys[b]) / 2 + (rng() - 0.5) * 0.02 * r0
        if (inside(x, y)) { nx.push(x); ny.push(y) }
      }
    }
    xs = nx; ys = ny
  }

  const out = { positions: new F32List(), colors: new F32List() }
  for (let q = 0; q < xs.length; q++) {
    const b = q < xs.length - 1 ? q + 1 : 0
    drapeEdge(out, terrain, p, sMask, xs[q], ys[q], xs[b], ys[b], Math.atan2(ys[b] - ys[q], xs[b] - xs[q]))
  }
  return { positions: out.positions.toArray(), colors: out.colors.toArray(), note: { nodes: xs.length } }
}
