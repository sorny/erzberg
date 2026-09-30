/**
 * Weather: Wind.
 *
 * Split out like the other builder files: geometryBuilders.js keeps the
 * dispatcher and re-exports the public API.
 */
import { boxBlur, sampleBilinear } from '../terrain'
import { groundMetres } from './ground.js'
import { F32List, drapeEdge } from './shared.js'

const RAD = Math.PI / 180

// ─── Wind ────────────────────────────────────────────────────────────────────

/**
 * Streamlines of one prevailing wind, bent by the ground.
 *
 * Flow Lines follow the gradient, so they run down every slope and never
 * cross a ridge. Wind crosses it. The wind is a vector w of one bearing, and
 * where the ground rises across its path, part of the uphill component is
 * taken away:
 *
 *     d = w · ∇h                       the slope along the wind, as a tangent
 *     v = w − k · d · ∇h / (1 + |∇h|²)
 *
 * On level ground v is w. On a slope met at a slant, the air turns along it,
 * and at `deflect` = 1 on steep ground it runs nearly along the contour. For k
 * up to 1, v · w stays positive, so no line turns back and none closes on
 * itself. The gradient is in true metres, so the turn is the same on a quarry
 * and on an alp.
 *
 * The lines are evenly spaced by the Jobard–Lefer method. A line grows in both
 * directions from a seed and stops when it comes within half a gap of another
 * line. New seeds sit one gap to each side of the lines already drawn, and a
 * scan over the grid fills what that leaves.
 *
 * The speed is relative: fast on ground that stands above the ground round it,
 * slow in hollows. A height above sea level would crowd a whole high plateau.
 * The gap follows the speed as continuity says, so the lines draw together
 * over each crest, by `crest`.
 *
 * In the lee of a steep face the air breaks away from the ground. Where the
 * ground falls along the wind more steeply than `lee` degrees, the pen lifts,
 * and with `eddies` that ground gets curls that turn back on the wind. A bare
 * gap there reads as a fault in the drawing, not as broken air. At 0 the pen
 * never lifts.
 *
 * `stroke` says which way the air goes: 'lines' are plain, 'arrows' put a half
 * arrowhead on each line at intervals, and 'streaks' break each line into
 * dashes, each with its head, and longer where the air is faster, as a weather
 * map does. A line alone has no front and back.
 */
export function buildWind(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const n = rows * cols
  const sMask = terrain.hasNoData ? gridMask : null
  const ground = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const { cellX, cellY } = ground
  // Air does not steer round a single bump in the data.
  const radius = Math.max(0, o.radius ?? 2)
  const hs = radius > 0 ? boxBlur(ground.heights, cols, rows, radius, sMask) : ground.heights

  const gx = new Float32Array(n), gy = new Float32Array(n)
  let lo = Infinity, hi = -Infinity
  const h = (r, c, i) => {
    const k = Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))
    return gridMask[k] ? hs[k] : hs[i]
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      gx[i] = (h(r, c + 1, i) - h(r, c - 1, i)) / (2 * cellX)
      gy[i] = (h(r + 1, c, i) - h(r - 1, c, i)) / (2 * cellY)
      if (grid[i] < lo) lo = grid[i]
      if (grid[i] > hi) hi = grid[i]
    }
  }
  if (!(hi >= lo)) return null

  // `azimuth` is where the wind blows from, as a bearing. It travels the other way.
  // East is +column and south is +row, so a bearing b points (sin b, −cos b).
  const to = ((o.azimuth ?? 250) + 180) * RAD
  const wx = Math.sin(to), wy = -Math.cos(to)
  const k = Math.max(0, Math.min(1, o.deflect ?? 0.9))
  const tanLee = (o.lee ?? 30) > 0 ? Math.tan(Math.min(85, o.lee ?? 30) * RAD) : Infinity
  const crest = Math.max(0, Math.min(1, o.crest ?? 0.5))
  const sep0 = Math.max(1, (o.spacing ?? 8) / scl)

  // Speed, relative to the mean: fast on ground that stands above its
  // surroundings, slow in the hollows. The measure is the height above the
  // mean height within a radius, scaled so the 95th percentile is ±60 %.
  const R = Math.max(3, Math.round(Math.max(rows, cols) / 25))
  const around = boxBlur(hs, cols, rows, R, sMask)
  const tpi = new Float32Array(n), mags = []
  for (let i = 0; i < n; i++) if (gridMask[i]) { tpi[i] = hs[i] - around[i]; mags.push(Math.abs(tpi[i])) }
  mags.sort((a, b) => a - b)
  const p95 = mags[Math.floor(mags.length * 0.95)] || 1
  const speed = new Float32Array(n)
  for (let i = 0; i < n; i++) speed[i] = Math.max(0.35, 1 + 0.6 * Math.max(-1.5, Math.min(1.5, tpi[i] / p95)))
  const speedAt = (fr, fc) => { const v = sampleBilinear(speed, sMask, rows, cols, fr, fc); return v === v ? v : 1 }

  // Where air speeds up the streamlines draw together, as continuity says:
  // at `crest` = 0.5 the gap is inversely proportional to the speed.
  const sepAt = (fr, fc) => Math.max(0.75, sep0 / speedAt(fr, fc) ** (2 * crest))
  // The wind at a point, as a unit step in cells, and the slope along it.
  const dir = new Float64Array(3)
  const wind = (fr, fc) => {
    const a = sampleBilinear(gx, sMask, rows, cols, fr, fc), b = sampleBilinear(gy, sMask, rows, cols, fr, fc)
    if (a !== a || b !== b) return null
    const d = wx * a + wy * b, f = k * d / (1 + a * a + b * b)
    const vc = (wx - f * a) / cellX, vr = (wy - f * b) / cellY, m = Math.hypot(vc, vr)
    if (!(m > 0)) return null
    dir[0] = vc / m; dir[1] = vr / m; dir[2] = d
    return dir
  }

  // Every point drawn so far, bucketed by the widest gap, so a test reads the
  // bucket it is in and the eight round it.
  const B = Math.ceil(sep0), bw = Math.ceil(cols / B) + 1, bh = Math.ceil(rows / B) + 1
  const buckets = Array.from({ length: bw * bh }, () => [])
  const near = (fr, fc, d) => {
    const bi = Math.floor(fc / B), bj = Math.floor(fr / B), d2 = d * d
    for (let y = bj - 1; y <= bj + 1; y++) {
      if (y < 0 || y >= bh) continue
      for (let x = bi - 1; x <= bi + 1; x++) {
        if (x < 0 || x >= bw) continue
        const L = buckets[y * bw + x]
        for (let q = 0; q < L.length; q += 2) {
          const dr = L[q] - fr, dc = L[q + 1] - fc
          if (dr * dr + dc * dc < d2) return true
        }
      }
    }
    return false
  }
  const onGround = (fr, fc) => fr >= 0 && fc >= 0 && fr <= rows - 1 && fc <= cols - 1
    && gridMask[Math.round(fr) * cols + Math.round(fc)] === 1

  const step = 0.5, maxSteps = 3 * (rows + cols)
  // One line through a seed, grown both ways, as [r, c, r, c, …] from upwind.
  const trace = (sr, sc) => {
    const halves = []
    for (const sign of [1, -1]) {
      const run = []
      let fr = sr, fc = sc
      for (let s = 0; s < maxSteps; s++) {
        const v = wind(fr, fc)
        if (!v) break
        const nr = fr + sign * v[1] * step, nc = fc + sign * v[0] * step
        if (!onGround(nr, nc) || near(nr, nc, 0.5 * sepAt(nr, nc))) break
        run.push(nr, nc)
        fr = nr; fc = nc
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
  const minPts = 2 * Math.max(4, Math.ceil(sep0 / step))
  const trySeed = (fr, fc) => {
    if (lines.length >= 20000 || !onGround(fr, fc) || near(fr, fc, sepAt(fr, fc))) return
    const line = trace(fr, fc)
    if (line.length < minPts) return
    // Every other point is enough for the test: they sit half a cell apart.
    for (let q = 0; q < line.length; q += 4) {
      buckets[Math.floor(line[q] / B) * bw + Math.floor(line[q + 1] / B)].push(line[q], line[q + 1])
    }
    lines.push(line); queue.push(line)
  }
  const grow = () => {
    while (queue.length) {
      const line = queue.shift()
      const every = 2 * Math.max(2, Math.round(sep0))
      for (let q = 2; q < line.length - 2; q += every) {
        const tr = line[q + 2] - line[q - 2], tc = line[q + 3] - line[q - 1], m = Math.hypot(tr, tc) || 1
        const fr = line[q], fc = line[q + 1], d = sepAt(fr, fc)
        trySeed(fr + (tc / m) * d, fc - (tr / m) * d)
        trySeed(fr - (tc / m) * d, fc + (tr / m) * d)
      }
    }
  }
  trySeed((rows - 1) / 2, (cols - 1) / 2)
  grow()
  for (let r = sep0 / 2; r < rows - 1; r += sep0) {
    for (let c = sep0 / 2; c < cols - 1; c += sep0) { trySeed(r, c); grow() }
  }

  const out = { positions: new F32List(), colors: new F32List() }
  const edge = (c0, r0, c1, r1) => drapeEdge(out, terrain, p, sMask, c0, r0, c1, r1, Math.atan2(r1 - r0, c1 - c0))
  const streaks = o.stroke === 'streaks', arrows = o.stroke === 'arrows'
  const dash0 = 3.5 * sep0, gap0 = 1.5 * sep0, barb = Math.max(0.8, 0.8 * sep0)
  const arrowGap = 14 * sep0
  // A half arrowhead at the downwind end of a streak, back and to one side.
  const head = (r1, c1, r0, c0) => {
    const dr = r1 - r0, dc = c1 - c0, m = Math.hypot(dr, dc)
    if (!(m > 0)) return
    const ur = dr / m, uc = dc / m, ca = Math.cos(0.45), sa = Math.sin(0.45)
    edge(c1, r1, c1 - (uc * ca - ur * sa) * barb, r1 - (ur * ca + uc * sa) * barb)
  }
  lines.forEach((line, li) => {
    // Each line starts at its own phase, and each dash is a little longer or
    // shorter than the last. With one period for all, the streaks line up
    // across the lines into diagonal bands.
    let seed = (li * 2654435761) >>> 0
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    let on = true, left = rnd() * (dash0 + gap0)
    for (let q = 2; q < line.length; q += 2) {
      const r0 = line[q - 2], c0 = line[q - 1], r1 = line[q], c1 = line[q + 1]
      const v = wind((r0 + r1) / 2, (c0 + c1) / 2)
      const inLee = !v || v[2] < -tanLee
      if (!streaks) {
        if (!inLee) edge(c0, r0, c1, r1)
        if (!arrows) continue
        left -= step
        if (left > 0) continue
        if (!inLee) head(r1, c1, r0, c0)
        left = arrowGap
        continue
      }
      if (on && !inLee) edge(c0, r0, c1, r1)
      left -= step
      if (left > 0) continue
      if (on && !inLee) head(r1, c1, r0, c0)
      on = !on
      left = (on ? dash0 * speedAt(r1, c1) ** 2 : gap0) * (0.7 + 0.6 * rnd())
    }
  })

  // Eddies: in the lee, where the air breaks away, a curl turning back on the
  // wind, on a grid a little wider than the lines.
  if (o.eddies && tanLee < Infinity) {
    const P = Math.max(2, 2 * sep0), rad = 0.4 * P
    const back = Math.atan2(-wy / cellY, -wx / cellX)
    for (let r = P / 2; r < rows - 1; r += P) {
      for (let c = P / 2 + ((Math.round(r / P) % 2) * P) / 2; c < cols - 1; c += P) {
        if (!onGround(r, c)) continue
        const v = wind(r, c)
        if (!v || v[2] >= -tanLee) continue
        let pc = c + Math.cos(back) * rad, pr = r + Math.sin(back) * rad
        for (let s = 1; s <= 12; s++) {
          const a = back + (s / 12) * 1.6 * Math.PI, rr = rad * (1 - 0.35 * s / 12)
          const nc = c + Math.cos(a) * rr, nr = r + Math.sin(a) * rr
          edge(pc, pr, nc, nr)
          pc = nc; pr = nr
        }
      }
    }
  }
  return { positions: out.positions.toArray(), colors: out.colors.toArray(), note: { lines: lines.length } }
}
