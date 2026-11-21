/**
 * Form modes: Loxodromes, Breaklines, Surface Network, Flow Time, Prominence,
 * and the evenly spaced streamlines that Loxodromes and Engraving share.
 *
 * Split out like the other builder files: geometryBuilders.js keeps the
 * dispatcher and re-exports the public API.
 */
import { boxBlur, sampleBilinear } from '../terrain'
import { d8Accumulation } from '../drainage'
import { groundMetres } from './ground.js'
import { F32List, drapeEdge, traceLevelSet } from './shared.js'

const RAD = Math.PI / 180

// ─── Evenly spaced streamlines ───────────────────────────────────────────────

/**
 * Streamlines of a direction field, evenly spaced (Jobard and Lefer, 1997).
 *
 * `dirAt(fr, fc, out)` writes a unit step in grid cells into `out` as
 * [dc, dr] and returns it, or returns null where the field has no direction.
 * A line grows both ways from a seed in steps of `step` cells. It stops where
 * it comes within `test` times the gap of another line, of itself more than a
 * gap back along its length, at the edge of the ground, or where `keep` says
 * no. A line that comes back to its seed closes as a ring.
 *
 * The gap is `sepAt(fr, fc)` in cells, or the constant `sep`. Seeds sit one
 * gap to each side of each line drawn, and a scan over the grid fills what that
 * leaves. Returns each line as [r, c, r, c, …].
 */
export function evenStreamlines(terrain, dirAt, o) {
  const { gridMask, rows, cols } = terrain
  const sep0 = Math.max(0.75, o.sep ?? 4)
  const sepAt = o.sepAt ?? (() => sep0)
  const minSep = Math.max(0.5, o.minSep ?? sep0)
  const test = o.test ?? 0.5, step = o.step ?? 0.5
  const maxSteps = Math.max(4, Math.round(o.maxSteps ?? 3 * (rows + cols) / step))
  const minPts = 2 * Math.max(3, Math.round(o.minPts ?? Math.ceil(sep0 / step)))
  const maxLines = o.maxLines ?? 40000
  const keep = o.keep ?? null

  // Points of finished lines and of the line being traced, bucketed by the
  // narrowest gap. Each point carries its line and its index on that line, so
  // a line does not stop on its own last few steps.
  const B = Math.max(1, minSep), bw = Math.ceil(cols / B) + 1, bh = Math.ceil(rows / B) + 1
  const buckets = Array.from({ length: bw * bh }, () => [])
  const reach = Math.ceil(Math.max(sep0, minSep) / B) + 1
  const lag = Math.ceil((1.5 * Math.max(sep0, minSep)) / step) + 2
  const near = (fr, fc, d, id, idx) => {
    const bi = Math.floor(fc / B), bj = Math.floor(fr / B), d2 = d * d
    const rr = Math.min(reach, Math.ceil(d / B))
    for (let y = bj - rr; y <= bj + rr; y++) {
      if (y < 0 || y >= bh) continue
      for (let x = bi - rr; x <= bi + rr; x++) {
        if (x < 0 || x >= bw) continue
        const L = buckets[y * bw + x]
        for (let q = 0; q < L.length; q += 4) {
          if (L[q + 2] === id && Math.abs(L[q + 3] - idx) < lag) continue
          const dr = L[q] - fr, dc = L[q + 1] - fc
          if (dr * dr + dc * dc < d2) return true
        }
      }
    }
    return false
  }
  // Where the line being traced put its points, so a line too short to keep
  // can take them back out. They are the last entries in their buckets.
  const placed = []
  const put = (fr, fc, id, idx) => {
    const k = Math.floor(fr / B) * bw + Math.floor(fc / B)
    buckets[k].push(fr, fc, id, idx)
    placed.push(k)
  }
  const onGround = (fr, fc) => fr >= 0 && fc >= 0 && fr <= rows - 1 && fc <= cols - 1
    && gridMask[Math.round(fr) * cols + Math.round(fc)] === 1 && (!keep || keep(fr, fc))

  const d1 = [0, 0], d2 = [0, 0]
  let nextId = 0
  const trace = (sr, sc, id) => {
    const halves = []
    let closed = false
    for (const sign of [1, -1]) {
      const run = []
      if (closed) { halves.push(run); continue }
      let fr = sr, fc = sc, pr = 0, pc = 0
      for (let s = 1; s <= maxSteps; s++) {
        // Midpoint (RK2): a straight Euler step cuts every bend short.
        const a = dirAt(fr, fc, d1)
        if (!a) break
        const mr = fr + sign * a[1] * step * 0.5, mc = fc + sign * a[0] * step * 0.5
        const b = dirAt(mr, mc, d2)
        if (!b) break
        const vr = sign * b[1], vc = sign * b[0]
        if (s > 1 && vr * pr + vc * pc < 0.2) break
        const nr = fr + vr * step, nc = fc + vc * step
        if (!onGround(nr, nc)) break
        if (sign === 1 && s * step > 3 * sep0 && (nr - sr) ** 2 + (nc - sc) ** 2 < step * step) {
          run.push(sr, sc); closed = true; break
        }
        if (near(nr, nc, test * sepAt(nr, nc), id, sign * s)) break
        run.push(nr, nc); put(nr, nc, id, sign * s)
        fr = nr; fc = nc; pr = vr; pc = vc
      }
      halves.push(run)
    }
    const back = halves[1], line = []
    for (let q = back.length - 2; q >= 0; q -= 2) line.push(back[q], back[q + 1])
    line.push(sr, sc)
    for (const v of halves[0]) line.push(v)
    return line
  }

  const lines = [], queue = []
  const trySeed = (fr, fc) => {
    if (lines.length >= maxLines || !onGround(fr, fc) || !dirAt(fr, fc, d1)) return
    if (near(fr, fc, sepAt(fr, fc), -1, 0)) return
    const id = ++nextId
    placed.length = 0
    put(fr, fc, id, 0)
    const line = trace(fr, fc, id)
    if (line.length < minPts) {
      for (let q = placed.length - 1; q >= 0; q--) buckets[placed[q]].length -= 4
      return
    }
    lines.push(line); queue.push(line)
  }
  const grow = () => {
    while (queue.length) {
      const line = queue.shift()
      const every = 2 * Math.max(2, Math.round(sep0 / step / 2))
      for (let q = 2; q < line.length - 2; q += every) {
        const tr = line[q + 2] - line[q - 2], tc = line[q + 3] - line[q - 1], m = Math.hypot(tr, tc) || 1
        const fr = line[q], fc = line[q + 1], d = sepAt(fr, fc)
        trySeed(fr + (tc / m) * d, fc - (tr / m) * d)
        trySeed(fr - (tc / m) * d, fc + (tr / m) * d)
      }
    }
  }
  if (o.seeds) {
    for (const [r, c] of o.seeds) { trySeed(r, c); grow() }
  } else {
    trySeed((rows - 1) / 2, (cols - 1) / 2)
    grow()
  }
  const pitch = Math.max(1, minSep)
  for (let r = pitch / 2; r < rows - 1; r += pitch) {
    for (let c = pitch / 2; c < cols - 1; c += pitch) { trySeed(r, c); grow() }
  }
  return lines
}

/** Lines as [r, c, …] arrays, draped on the ground a cell at a time. */
export function drapeLines(terrain, p, lines, angleOf = null) {
  const sMask = terrain.hasNoData ? terrain.gridMask : null
  const out = { positions: new F32List(), colors: new F32List() }
  for (const line of lines) {
    for (let q = 2; q < line.length; q += 2) {
      const r0 = line[q - 2], c0 = line[q - 1], r1 = line[q], c1 = line[q + 1]
      drapeEdge(out, terrain, p, sMask, c0, r0, c1, r1, angleOf ? angleOf(r0, c0) : Math.atan2(r1 - r0, c1 - c0))
    }
  }
  return { positions: out.positions.toArray(), colors: out.colors.toArray() }
}

/**
 * Heights in metres, blurred, and their gradient in metres per metre.
 *
 * `gx` runs east along a row and `gy` south down a column. A masked neighbour
 * reads as level, so the edge of the data is not a cliff.
 */
function metricField(terrain, p, o, radiusCells) {
  const { gridMask, rows, cols } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const ground = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const { cellX, cellY } = ground
  const hs = radiusCells > 0 ? boxBlur(ground.heights, cols, rows, radiusCells, sMask) : ground.heights
  const n = rows * cols, gx = new Float32Array(n), gy = new Float32Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const h = hs[i]
      const w = c > 0 && gridMask[i - 1] ? hs[i - 1] : h, e = c < cols - 1 && gridMask[i + 1] ? hs[i + 1] : h
      const nn = r > 0 && gridMask[i - cols] ? hs[i - cols] : h, s = r < rows - 1 && gridMask[i + cols] ? hs[i + cols] : h
      gx[i] = (e - w) / (2 * cellX); gy[i] = (s - nn) / (2 * cellY)
    }
  }
  return { hs, gx, gy, cellX, cellY, sMask }
}

// ─── Loxodromes ──────────────────────────────────────────────────────────────

/**
 * Lines that cross every contour at one angle.
 *
 * The direction is the fall line turned by `angle` toward `turn`, measured on
 * the ground in true metres. At 0° the lines are fall lines, at 90° they are
 * contours, and between they wind round every summit and hollow, as a rhumb
 * line winds round a pole.
 *
 * `hold: 'grade'` keeps the grade of the line instead: where the ground is
 * steeper than `grade` (per cent), the line turns from the fall line by
 * acos(grade / slope), so it falls by exactly that grade, as a surveyor sets a
 * road line between contours with dividers. Where the ground is gentler than
 * the grade, the line runs down the fall line.
 *
 * Ground flatter than `minSlope` degrees has no direction, and the lines stop.
 * They are evenly spaced, `spacing` raster pixels apart.
 */
export function buildLoxodromes(terrain, p, o) {
  const { scl } = terrain
  const radius = Math.max(0, (o.radius ?? 8) / scl)
  const { gx, gy, cellX, cellY, sMask } = metricField(terrain, p, o, radius)
  const { rows, cols } = terrain
  const side = o.turn === 'left' ? -1 : 1
  const holdGrade = o.hold === 'grade'
  const fixed = Math.max(0, Math.min(89.5, o.angle ?? 60)) * RAD
  const grade = Math.max(0.001, (o.grade ?? 10) / 100)
  const minTan = Math.tan(Math.max(0, o.minSlope ?? 2) * RAD)
  const cosF = Math.cos(fixed), sinF = Math.sin(fixed) * side

  const dirAt = (fr, fc, out) => {
    const a = sampleBilinear(gx, sMask, rows, cols, fr, fc), b = sampleBilinear(gy, sMask, rows, cols, fr, fc)
    if (a !== a || b !== b) return null
    const s = Math.hypot(a, b)
    if (!(s > minTan) || !(s > 0)) return null
    // Downhill, in metres, then turned on the ground.
    const ux = -a / s, uy = -b / s
    let cs = cosF, sn = sinF
    if (holdGrade) {
      const t = s > grade ? Math.acos(grade / s) : 0
      cs = Math.cos(t); sn = Math.sin(t) * side
    }
    const mx = ux * cs - uy * sn, my = ux * sn + uy * cs
    // Back to grid cells, which need not be square.
    const vc = mx / cellX, vr = my / cellY, m = Math.hypot(vc, vr)
    out[0] = vc / m; out[1] = vr / m
    return out
  }
  const sep = Math.max(1, (o.spacing ?? 6) / scl)
  const lines = evenStreamlines(terrain, dirAt, { sep, step: 0.5, test: 0.55 })
  return { ...drapeLines(terrain, p, lines), note: { lines: lines.length } }
}

// ─── Breaklines ──────────────────────────────────────────────────────────────

/**
 * Breaks of slope: where the slope changes most, along the fall line.
 *
 * The profile curvature is the second derivative of the ground along its own
 * gradient,
 *
 *     k = (zxx·zx² + 2·zxy·zx·zy + zyy·zy²) / (zx² + zy²)
 *
 * negative where the slope steepens downhill (a convex break, the top edge of a
 * face) and positive where it eases (a concave break, its foot). A breakline is
 * a ridge of |k| along the fall line: the zero of k's own derivative along the
 * gradient, kept where |k| is in the strongest `keep` share of the sloping
 * ground and the slope is at least `minSlope` degrees. Heights are in true
 * metres, blurred by `radius` raster pixels, since a second derivative of a raw
 * DEM is noise. Chains shorter than `minLength` pixels are dropped.
 */
export function buildBreaklines(terrain, p, o) {
  const { gridMask, rows, cols, scl } = terrain
  const n = rows * cols
  const radius = Math.max(0, (o.radius ?? 8) / scl)
  const { gx, gy, cellX, cellY } = metricField(terrain, p, o, radius)
  const at = (f, i, d) => (gridMask[i + d] ? f[i + d] : f[i])
  const k = new Float32Array(n), slope = new Float32Array(n)
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const zx = gx[i], zy = gy[i], g2 = zx * zx + zy * zy
      slope[i] = Math.sqrt(g2)
      if (!(g2 > 0)) continue
      const zxx = (at(gx, i, 1) - at(gx, i, -1)) / (2 * cellX)
      const zyy = (at(gy, i, cols) - at(gy, i, -cols)) / (2 * cellY)
      const zxy = 0.5 * ((at(gx, i, cols) - at(gx, i, -cols)) / (2 * cellY) + (at(gy, i, 1) - at(gy, i, -1)) / (2 * cellX))
      k[i] = (zxx * zx * zx + 2 * zxy * zx * zy + zyy * zy * zy) / g2
    }
  }
  const sMask = terrain.hasNoData ? gridMask : null
  const ks = boxBlur(k, cols, rows, 1, sMask)
  const minTan = Math.tan(Math.max(0, o.minSlope ?? 4) * RAD)
  const strong = []
  for (let i = 0; i < n; i += 3) if (gridMask[i] && slope[i] >= minTan) strong.push(Math.abs(ks[i]))
  if (!strong.length) return null
  strong.sort((a, b) => a - b)
  const keepShare = Math.max(0.02, Math.min(1, o.keep ?? 0.5))
  const thr = strong[Math.min(strong.length - 1, Math.floor((1 - keepShare) * strong.length))]

  // The derivative of k along the gradient, as a field offset far above zero so
  // the level-set tracer, which reads negatives as "no value", can trace it.
  const OFF = 1000
  const convex = new Float32Array(n).fill(-1), concave = new Float32Array(n).fill(-1)
  const dks = []
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c
      if (!gridMask[i] || slope[i] < minTan) continue
      const kx = (at(ks, i, 1) - at(ks, i, -1)) / (2 * cellX), ky = (at(ks, i, cols) - at(ks, i, -cols)) / (2 * cellY)
      const dk = (kx * gx[i] + ky * gy[i]) / slope[i]
      if (ks[i] <= -thr) convex[i] = dk
      else if (ks[i] >= thr) concave[i] = dk
      else continue
      dks.push(Math.abs(dk))
    }
  }
  if (!dks.length) return null
  dks.sort((a, b) => a - b)
  const unit = dks[Math.floor(dks.length * 0.95)] || 1
  for (const f of [convex, concave]) for (let i = 0; i < n; i++) if (f[i] !== -1) f[i] = OFF + f[i] / unit

  const minLen = Math.max(0, (o.minLength ?? 12) / scl)
  const smooth = Math.max(0, Math.round(o.smoothing ?? 2))
  const out = {}
  let pieces = 0
  if (o.convex !== false) {
    out['Breaks-Convex'] = traceLevelSet(terrain, p, convex, [OFF], smooth, { minLen })
    pieces += out['Breaks-Convex'].positions.length
  }
  if (o.concave !== false) {
    out['Breaks-Concave'] = traceLevelSet(terrain, p, concave, [OFF], smooth, { minLen })
    pieces += out['Breaks-Concave'].positions.length
  }
  if (!Object.keys(out).length) return null
  const first = Object.keys(out)[0]
  out[first] = { ...out[first], note: { segments: pieces / 6 } }
  return out
}

// ─── Surface Network ─────────────────────────────────────────────────────────

const RING = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]]

/**
 * The skeleton of the ground: cols, the ridges that join them to summits, and
 * the courses that run from them down to the hollows.
 *
 * On the heights blurred by `radius` raster pixels, a col (a saddle) is a cell
 * whose eight neighbours change between higher and lower at least four times
 * round the ring. From each higher arc a ridge climbs by steepest ascent to a
 * summit, and from each lower arc a course runs down until the ground goes
 * flat, leaves the data, or reaches a pit. This is the surface network of
 * Pfaltz (1976), the Morse–Smale graph of the ground.
 *
 * A col whose two summits are the same, or whose lower summit stands less than
 * `persistence` of the relief above it, is noise and is dropped. Of several
 * cols between the same two summits, only the highest is kept: the key col.
 *
 * Three pens: the ridges, the courses (dashed by default) and the points, a
 * cross at each col and a triangle at each summit, `size` raster pixels across.
 */
export function buildSurfaceNetwork(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const n = rows * cols
  const sMask = terrain.hasNoData ? gridMask : null
  const radius = Math.max(0, (o.radius ?? 16) / scl)
  const blurred = radius > 0 ? boxBlur(grid, cols, rows, radius, sMask) : grid
  // A tiny ramp by index breaks ties, so no two cells are ever level.
  const h = new Float64Array(n)
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < n; i++) {
    h[i] = blurred[i] + i * 1e-13
    if (gridMask[i]) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i] }
  }
  if (!(hi > lo)) return null
  const pers = Math.max(0, o.persistence ?? 0.02) * (hi - lo)

  // Gradient of the blurred heights, for the smooth walks, and the steepness
  // under which the ground counts as flat.
  const gx = new Float32Array(n), gy = new Float32Array(n), mags = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const w = c > 0 && gridMask[i - 1] ? h[i - 1] : h[i], e = c < cols - 1 && gridMask[i + 1] ? h[i + 1] : h[i]
      const u = r > 0 && gridMask[i - cols] ? h[i - cols] : h[i], d = r < rows - 1 && gridMask[i + cols] ? h[i + cols] : h[i]
      gx[i] = (e - w) / 2; gy[i] = (d - u) / 2
      if (i % 7 === 0) mags.push(Math.hypot(gx[i], gy[i]))
    }
  }
  mags.sort((a, b) => a - b)
  const flat = 0.02 * (mags[Math.floor(mags.length * 0.95)] || 0)

  // Steepest ascent from cell to cell, to name the summit a ridge reaches.
  const summitOf = new Int32Array(n).fill(-1)
  const climb = (start) => {
    const path = []
    let i = start
    while (summitOf[i] < 0) {
      path.push(i)
      const r = (i / cols) | 0, c = i % cols
      let best = -1, bs = 0
      for (const [dr, dc] of RING) {
        const rr = r + dr, cc = c + dc
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue
        const j = rr * cols + cc
        if (!gridMask[j]) continue
        const s = (h[j] - h[i]) / Math.hypot(dr, dc)
        if (s > bs) { bs = s; best = j }
      }
      if (best < 0) { summitOf[i] = i; break }
      i = best
    }
    const top = summitOf[i]
    for (const q of path) summitOf[q] = top
    return top
  }

  // A smooth walk along the gradient, up or down, as [r, c, …].
  const maxSteps = 4 * (rows + cols)
  const walk = (r0, c0, up, target) => {
    const line = []
    let fr = r0, fc = c0
    for (let s = 0; s < maxSteps; s++) {
      const a = sampleBilinear(gx, sMask, rows, cols, fr, fc), b = sampleBilinear(gy, sMask, rows, cols, fr, fc)
      const m = Math.hypot(a, b)
      // A course leaves its col where the ground is all but level, so the
      // flat test waits until it is a few steps out.
      if (!(m > (up || s < 6 ? 0 : flat))) break
      const sg = up ? 0.5 : -0.5
      const nr = fr + sg * b / m, nc = fc + sg * a / m
      if (!(nr >= 0 && nc >= 0 && nr <= rows - 1 && nc <= cols - 1)) break
      if (!gridMask[Math.round(nr) * cols + Math.round(nc)]) break
      // Past a summit or a pit the gradient turns back on the step: stop there.
      const a2 = sampleBilinear(gx, sMask, rows, cols, nr, nc), b2 = sampleBilinear(gy, sMask, rows, cols, nr, nc)
      if (s > 2 && a * a2 + b * b2 < 0) break
      fr = nr; fc = nc
      line.push(fr, fc)
      if (target >= 0) {
        const tr = (target / cols) | 0, tc = target % cols
        if ((fr - tr) ** 2 + (fc - tc) ** 2 < 1) break
      }
    }
    if (target >= 0) line.push((target / cols) | 0, target % cols)
    return line
  }

  // Every col, with the two summits it joins.
  const keyCol = new Map()
  const d = new Float64Array(8)
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      let ok = true
      for (let q = 0; q < 8; q++) {
        const j = (r + RING[q][0]) * cols + c + RING[q][1]
        if (!gridMask[j]) { ok = false; break }
        d[q] = h[j] - h[i]
      }
      if (!ok) continue
      let changes = 0
      for (let q = 0; q < 8; q++) if ((d[q] > 0) !== (d[(q + 1) % 8] > 0)) changes++
      if (changes < 4) continue
      // The arcs, each with its most extreme neighbour.
      let start = 0
      while ((d[start] > 0) === (d[(start + 7) % 8] > 0)) start++
      const arcs = []
      let cur = null
      for (let t = 0; t < 8; t++) {
        const q = (start + t) % 8, up = d[q] > 0
        if (!cur || up !== cur.up) { cur = { up, best: q }; arcs.push(cur) }
        if (up ? d[q] > d[cur.best] : d[q] < d[cur.best]) cur.best = q
      }
      const ups = arcs.filter((a) => a.up)
      const tops = ups.map((a) => climb((r + RING[a.best][0]) * cols + c + RING[a.best][1]))
      const uniq = [...new Set(tops)]
      if (uniq.length < 2) continue
      // The two highest summits it reaches.
      uniq.sort((a, b) => h[b] - h[a])
      const [s1, s2] = uniq
      if (h[s2] - h[i] < pers) continue
      const key = s1 < s2 ? `${s1}:${s2}` : `${s2}:${s1}`
      const had = keyCol.get(key)
      if (had && h[had.i] >= h[i]) continue
      keyCol.set(key, { i, r, c, arcs, tops, s1, s2 })
    }
  }

  const ridges = [], courses = [], summits = new Set(), colsAt = []
  for (const k of keyCol.values()) {
    const { r, c, arcs, tops, s1, s2 } = k
    colsAt.push([r, c])
    summits.add(s1); summits.add(s2)
    let u = 0
    for (const a of arcs) {
      // Out of the col along the arc first: on the col itself the gradient is
      // mostly the error in where the col lies, and points along the ridge.
      const k = 1.5 / Math.hypot(RING[a.best][0], RING[a.best][1])
      const sr = r + RING[a.best][0] * k, sc = c + RING[a.best][1] * k
      if (a.up) {
        const top = tops[u++]
        if (top !== s1 && top !== s2) continue
        ridges.push([r, c, ...walk(sr, sc, true, top)])
      } else if (o.courses !== false) {
        courses.push([r, c, ...walk(sr, sc, false, -1)])
      }
    }
  }

  const out = { 'Morse-Ridges': drapeLines(terrain, p, ridges) }
  if (o.courses !== false) out['Morse-Courses'] = drapeLines(terrain, p, courses)
  if (o.points !== false) {
    const half = Math.max(0.75, (o.size ?? 10) / scl / 2)
    const pts = { positions: new F32List(), colors: new F32List() }
    for (const [r, c] of colsAt) {
      drapeEdge(pts, terrain, p, sMask, c - half, r - half, c + half, r + half, Math.PI / 4)
      drapeEdge(pts, terrain, p, sMask, c - half, r + half, c + half, r - half, -Math.PI / 4)
    }
    for (const s of summits) {
      const r = (s / cols) | 0, c = s % cols
      const a = [c, r - half * 1.2], b = [c + half * 1.05, r + half * 0.7], q = [c - half * 1.05, r + half * 0.7]
      drapeEdge(pts, terrain, p, sMask, a[0], a[1], b[0], b[1], 0)
      drapeEdge(pts, terrain, p, sMask, b[0], b[1], q[0], q[1], 0)
      drapeEdge(pts, terrain, p, sMask, q[0], q[1], a[0], a[1], 0)
    }
    out['Morse-Points'] = { positions: pts.positions.toArray(), colors: pts.colors.toArray() }
  }
  out['Morse-Ridges'].note = { cols: colsAt.length, summits: summits.size }
  return out
}

// ─── Flow Time ───────────────────────────────────────────────────────────────

/** The longer side of the grid Flow Time traces on. */
const FLOW_TIME_GRID = 256

/**
 * Isolines of the time water takes to reach the plain or the hollow it ends in.
 *
 * From every cell, a drop walks down the gradient of the ground blurred by
 * `radius` raster pixels, in half-cell steps, and adds up its time. Its speed
 * is √(tan β) · A^e, the slope in true metres and the upslope area A in cells,
 * raised to the `speedup` e: water on an open slope is slow and water in a
 * channel is fast. Slopes gentler than 1.7° count as 1.7°, so a nearly level
 * patch is slow and not endless. A walk ends where the ground falls below the
 * `plain`, a share of the relief above the lowest ground, where the ground goes
 * level (a hollow), or where it leaves the data.
 *
 * Each drop also records where it ended. Neighbouring cells whose drops end in
 * different places lie on a divide, and no line is traced across them, so the
 * lines of two catchments never join. `levels` lines are drawn, evenly spaced
 * up to the 95th percentile of the times.
 *
 * The walks run on a copy of the grid at most 256 cells on its longer side and
 * the field is read back at full size: a walk from every cell of a 1024² grid
 * would take a minute.
 */
export function buildFlowTime(terrain, p, o) {
  const { gridMask, rows, cols, scl } = terrain
  const f = Math.max(1, Math.ceil(Math.max(rows, cols) / FLOW_TIME_GRID))
  const R = Math.ceil(rows / f), C = Math.ceil(cols / f), m = R * C
  const ground = groundMetres(terrain, p, o.cellMetres, o.relief).ground()

  // The coarse grid: the mean of the cells with data under each coarse cell.
  const hC = new Float32Array(m), mC = new Uint8Array(m)
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      let s = 0, k = 0
      for (let y = r * f; y < Math.min(rows, (r + 1) * f); y++) {
        for (let x = c * f; x < Math.min(cols, (c + 1) * f); x++) {
          const i = y * cols + x
          if (gridMask[i]) { s += ground.heights[i]; k++ }
        }
      }
      if (k) { hC[r * C + c] = s / k; mC[r * C + c] = 1 }
    }
  }
  const cellX = ground.cellX * f, cellY = ground.cellY * f
  const radius = Math.max(0, (o.radius ?? 12) / scl / f)
  const cMask = mC.every((v) => v) ? null : mC
  const hs = radius > 0 ? boxBlur(hC, C, R, radius, cMask) : hC
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < m; i++) if (mC[i]) { if (hs[i] < lo) lo = hs[i]; if (hs[i] > hi) hi = hs[i] }
  if (!(hi > lo)) return null
  const plain = lo + Math.max(0, o.plain ?? 0.03) * (hi - lo)

  const gxC = new Float32Array(m), gyC = new Float32Array(m)
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      const i = r * C + c
      if (!mC[i]) continue
      const v = hs[i]
      const w = c > 0 && mC[i - 1] ? hs[i - 1] : v, e = c < C - 1 && mC[i + 1] ? hs[i + 1] : v
      const u = r > 0 && mC[i - C] ? hs[i - C] : v, d = r < R - 1 && mC[i + C] ? hs[i + C] : v
      gxC[i] = (e - w) / (2 * cellX); gyC[i] = (d - u) / (2 * cellY)
    }
  }
  const { acc } = d8Accumulation(hs, mC, R, C, 0)
  const logA = new Float32Array(m)
  for (let i = 0; i < m; i++) logA[i] = Math.log(Math.max(1, acc[i]))
  const lA = boxBlur(logA, C, R, 1, cMask)
  const e = Math.max(0, Math.min(1, o.speedup ?? 0.32))
  const minTan = Math.tan(1.7 * RAD), levelTan = Math.tan(0.25 * RAD)

  /*
   * One walk per coarse cell, lowest first. A walk that passes within a third
   * of a cell of a cell already walked takes that cell's time and end and
   * stops, so most walks are a few steps long.
   */
  const time = new Float32Array(m).fill(-1), endAt = new Int32Array(m).fill(-1)
  const maxSteps = 4 * (R + C)
  const metresStep = 0.5 * Math.hypot(cellX, cellY) / Math.SQRT2
  const byHeight = []
  for (let i = 0; i < m; i++) if (mC[i] && hs[i] >= plain) byHeight.push(i)
  byHeight.sort((a, b) => hs[a] - hs[b])
  for (const i0 of byHeight) {
    {
      const r = (i0 / C) | 0, c = i0 % C
      let fr = r, fc = c, t = 0, done = false, h0 = hs[i0]
      for (let s = 0; s < maxSteps; s++) {
        const a = sampleBilinear(gxC, cMask, R, C, fr, fc), b = sampleBilinear(gyC, cMask, R, C, fr, fc)
        const g = Math.hypot(a, b)
        if (!(g > levelTan)) { done = s > 2; break }
        const vr = -b / g / cellY, vc = -a / g / cellX, vm = Math.hypot(vr, vc)
        const nr = fr + 0.5 * vr / vm, nc = fc + 0.5 * vc / vm
        if (!(nr >= 0 && nc >= 0 && nr <= R - 1 && nc <= C - 1) || !mC[Math.round(nr) * C + Math.round(nc)]) { done = true; break }
        const speed = Math.sqrt(Math.max(minTan, g)) * Math.exp(e * sampleBilinear(lA, cMask, R, C, fr, fc))
        const h1 = sampleBilinear(hs, cMask, R, C, nr, nc)
        // A step that does not go down has reached a hollow.
        if (!(h1 < h0)) { done = s > 2; break }
        t += metresStep / speed
        fr = nr; fc = nc; h0 = h1
        if (h1 < plain) { done = true; break }
        const jr = Math.round(fr), jc = Math.round(fc), j = jr * C + jc
        if (j !== i0 && time[j] >= 0 && (fr - jr) ** 2 + (fc - jc) ** 2 < 0.11) {
          t += time[j]; time[i0] = t; endAt[i0] = endAt[j]; done = false
          break
        }
      }
      if (!done) continue
      time[i0] = t
      endAt[i0] = Math.round(fr / 6) * 100000 + Math.round(fc / 6)
    }
  }

  const sameEnd = (a, b) => a >= 0 && b >= 0 && Math.abs(Math.floor(a / 100000) - Math.floor(b / 100000)) <= 1
    && Math.abs((a % 100000) - (b % 100000)) <= 1
  // Two passes of a 3 × 3 mean over the cells that end in the same place, so a
  // time taken over from a neighbour does not leave a step.
  for (let pass = 0; pass < 2; pass++) {
    const prev = Float32Array.from(time)
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const i = r * C + c
        if (prev[i] < 0) continue
        let s = 0, k = 0
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc
            if (rr < 0 || cc < 0 || rr >= R || cc >= C) continue
            const j = rr * C + cc
            if (prev[j] >= 0 && sameEnd(endAt[i], endAt[j])) { s += prev[j]; k++ }
          }
        }
        time[i] = s / k
      }
    }
  }
  // The downhill direction per coarse cell, to find the divides: where two
  // neighbours run apart, the water parts.
  const ux = new Float32Array(m), uy = new Float32Array(m)
  for (let i = 0; i < m; i++) {
    const g = Math.hypot(gxC[i], gyC[i])
    if (g > 0) { ux[i] = -gxC[i] / g; uy[i] = -gyC[i] / g }
  }

  const ts = []
  for (let i = 0; i < m; i++) if (time[i] > 0) ts.push(time[i])
  if (ts.length < 4) return null
  ts.sort((a, b) => a - b)
  const nLevels = Math.max(1, Math.min(60, Math.round(o.levels ?? 15)))
  const top = ts[Math.floor(ts.length * 0.95)]
  const levels = []
  for (let k = 1; k <= nLevels; k++) levels.push((top * k) / nLevels)

  // Back at full size: the time by bilinear reading, the end by the nearest
  // coarse cell. No value where any coarse corner had none.
  const n = rows * cols, field = new Float32Array(n).fill(-1), end = new Int32Array(n).fill(-1)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const cr = Math.min(R - 1, (r + 0.5) / f - 0.5), cc = Math.min(C - 1, (c + 0.5) / f - 0.5)
      const r0 = Math.max(0, Math.floor(cr)), c0 = Math.max(0, Math.floor(cc))
      const r1 = Math.min(R - 1, r0 + 1), c1 = Math.min(C - 1, c0 + 1)
      const q = [r0 * C + c0, r0 * C + c1, r1 * C + c0, r1 * C + c1]
      if (q.some((j) => time[j] < 0)) continue
      const dr = Math.max(0, cr - r0), dc = Math.max(0, cc - c0)
      field[i] = time[q[0]] * (1 - dr) * (1 - dc) + time[q[1]] * (1 - dr) * dc + time[q[2]] * dr * (1 - dc) + time[q[3]] * dr * dc
      end[i] = endAt[Math.min(R - 1, Math.round(cr)) * C + Math.min(C - 1, Math.round(cc))]
    }
  }
  const apart = (r, c) => {
    const cr = Math.min(R - 1, Math.round((r + 0.5) / f - 0.5)), cc = Math.min(C - 1, Math.round((c + 0.5) / f - 0.5))
    const i = cr * C + cc, e = cc < C - 1 ? i + 1 : i, s = cr < R - 1 ? i + C : i
    return ux[e] - ux[i] > 0.8 || uy[s] - uy[i] > 0.8
  }
  const skip = (r, c) => {
    const i = r * cols + c, a = end[i]
    return !sameEnd(a, end[i + 1]) || !sameEnd(a, end[i + cols]) || !sameEnd(a, end[i + cols + 1]) || apart(r, c)
  }
  const traced = traceLevelSet(terrain, p, field, levels, Math.max(0, Math.round(o.smoothing ?? 2)), { skip, minLen: 3 })
  return { ...traced, note: { levels: levels.length } }
}


// ─── Prominence ──────────────────────────────────────────────────────────────

/**
 * Each summit with the outline of its island: the ground that stays above its
 * key col, the highest col on the way to higher ground.
 *
 * The heights are blurred by `radius` raster pixels. Union–find runs over the
 * cells from high to low. Each set keeps its highest cell. Where a cell joins
 * two sets, the set with the lower summit ends there: that cell is its key
 * col, and its prominence is the summit's height minus the col's. Summits on
 * the edge of the raster are left out, because the raster cuts them.
 *
 * Summits of at least `minProminence` (a share of the height range) are
 * drawn, at most `count`, the most prominent first. The outline of a summit is
 * the level set at its col's height, traced only round the cells above the col
 * that join the summit. The highest summit has no col. Its island is all the
 * ground above the `plain`, a share of the height range above the lowest
 * ground. With `points`, a triangle marks each summit and a cross each key col,
 * in the layer `Prom-Points`.
 */
export function buildProminence(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const n = rows * cols
  const sMask = terrain.hasNoData ? gridMask : null
  const radius = Math.max(0, (o.radius ?? 8) / scl)
  const h = radius > 0 ? boxBlur(grid, cols, rows, radius, sMask) : grid
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < n; i++) if (gridMask[i]) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i] }
  if (!(hi > lo)) return null
  const span = hi - lo

  /*
   * The cells from high to low, by a counting sort on the height in 2^18
   * bins. Cells in one bin go in index order. Two cells that close in height
   * can only make a summit of less than 1/262 144 of the relief, far below
   * any Min prominence. `rank` is each cell's place in that order, so "higher"
   * below means "higher in the order".
   */
  const BINS = 1 << 18
  const bin = new Int32Array(n), start = new Int32Array(BINS + 1)
  let m = 0
  for (let i = 0; i < n; i++) {
    if (!gridMask[i]) { bin[i] = -1; continue }
    const b = BINS - 1 - Math.min(BINS - 1, Math.floor(((h[i] - lo) / span) * BINS))
    bin[i] = b; start[b + 1]++; m++
  }
  for (let b = 0; b < BINS; b++) start[b + 1] += start[b]
  const order = new Int32Array(m), rank = new Int32Array(n)
  for (let i = 0; i < n; i++) if (bin[i] >= 0) order[start[bin[i]]++] = i
  for (let q = 0; q < m; q++) rank[order[q]] = m - q

  const parent = new Int32Array(n).fill(-1), top = new Int32Array(n)
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  const found = []
  const DR = RING.map((d) => d[0]), DC = RING.map((d) => d[1])
  for (let q = 0; q < m; q++) {
    const c = order[q], r = (c / cols) | 0, cc = c % cols
    parent[c] = c; top[c] = c
    for (let k = 0; k < 8; k++) {
      const rr = r + DR[k], c2 = cc + DC[k]
      if (rr < 0 || c2 < 0 || rr >= rows || c2 >= cols) continue
      const j = rr * cols + c2
      if (parent[j] < 0) continue
      const a = find(c), b = find(j)
      if (a === b) continue
      const [up, down] = rank[top[a]] > rank[top[b]] ? [a, b] : [b, a]
      if (top[down] !== c) found.push({ peak: top[down], col: c, prom: (h[top[down]] - h[c]) / span })
      parent[down] = up
      parent[c] = up
    }
  }
  const highest = order[0]

  const edge = (i) => {
    const r = (i / cols) | 0, c = i % cols
    return r === 0 || c === 0 || r === rows - 1 || c === cols - 1
  }
  const minProm = Math.max(0, o.minProminence ?? 0.02)
  const count = Math.max(1, Math.min(500, Math.round(o.count ?? 40)))
  const kept = found.filter((s) => s.prom >= minProm && !edge(s.peak))
    .sort((a, b) => b.prom - a.prom).slice(0, count)
  const plain = lo + Math.max(0, Math.min(0.9, o.plain ?? 0.03)) * span
  const islands = [{ peak: highest, level: plain, col: -1 }, ...kept.map((s) => ({ peak: s.peak, level: h[s.col], col: s.col }))]

  /*
   * One summit at a time: mark the cells above the level that join the
   * summit, then trace the level only inside their bounding box, one cell
   * wider. The field is -1 elsewhere, which `traceLevelSet` skips, and goes
   * back to -1 after each trace. Heights are lifted by one above the lowest
   * ground, so no height is negative.
   */
  const smooth = Math.max(0, Math.min(4, Math.round(o.smoothing ?? 2)))
  const field = new Float32Array(n).fill(-1), mark = new Uint8Array(n), stack = []
  const parts = []
  for (const s of islands) {
    let r0 = rows, r1 = -1, c0 = cols, c1 = -1
    const filled = []
    mark[s.peak] = 1; stack.push(s.peak)
    while (stack.length) {
      const c = stack.pop(), r = (c / cols) | 0, cc = c % cols
      filled.push(c)
      if (r < r0) r0 = r
      if (r > r1) r1 = r
      if (cc < c0) c0 = cc
      if (cc > c1) c1 = cc
      for (let k = 0; k < 8; k++) {
        const rr = r + DR[k], c2 = cc + DC[k]
        if (rr < 0 || c2 < 0 || rr >= rows || c2 >= cols) continue
        const j = rr * cols + c2
        if (!mark[j] && gridMask[j] && h[j] > s.level) { mark[j] = 1; stack.push(j) }
      }
    }
    r0 = Math.max(0, r0 - 1); r1 = Math.min(rows - 1, r1 + 1)
    c0 = Math.max(0, c0 - 1); c1 = Math.min(cols - 1, c1 + 1)
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c
        if (gridMask[i]) field[i] = 1 + (mark[i] ? h[i] : Math.min(h[i], s.level)) - lo
      }
    }
    for (const c of filled) mark[c] = 0
    parts.push(traceLevelSet(terrain, p, field, [1 + s.level - lo + span * 1e-7], smooth, { box: [r0, r1, c0, c1] }))
    for (let r = r0; r <= r1; r++) field.fill(-1, r * cols + c0, r * cols + c1 + 1)
  }
  const join = (key) => {
    const all = new Float32Array(parts.reduce((t, q) => t + q[key].length, 0))
    let at = 0
    for (const q of parts) { all.set(q[key], at); at += q[key].length }
    return all
  }

  const out = { Prom: { positions: join('positions'), colors: join('colors'), note: { summits: islands.length } } }
  if (o.points !== false) {
    const half = Math.max(0.75, (o.size ?? 10) / scl / 2)
    const pts = new F32List(), ptc = new F32List(), ptsOut = { positions: pts, colors: ptc }
    for (const s of islands) {
      const r = (s.peak / cols) | 0, c = s.peak % cols
      const a = [c, r - half * 1.2], b = [c + half * 1.05, r + half * 0.7], q = [c - half * 1.05, r + half * 0.7]
      drapeEdge(ptsOut, terrain, p, sMask, a[0], a[1], b[0], b[1], 0)
      drapeEdge(ptsOut, terrain, p, sMask, b[0], b[1], q[0], q[1], 0)
      drapeEdge(ptsOut, terrain, p, sMask, q[0], q[1], a[0], a[1], 0)
      if (s.col < 0) continue
      const cr = (s.col / cols) | 0, cc = s.col % cols, x = half * 0.8
      drapeEdge(ptsOut, terrain, p, sMask, cc - x, cr - x, cc + x, cr + x, Math.PI / 4)
      drapeEdge(ptsOut, terrain, p, sMask, cc - x, cr + x, cc + x, cr - x, -Math.PI / 4)
    }
    out['Prom-Points'] = { positions: pts.toArray(), colors: ptc.toArray() }
  }
  return out
}
