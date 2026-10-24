/**
 * Builds public/Heightmap.png, the plate the app opens with.
 *
 * Generated rather than sampled, so it owes attribution to nobody: a seeded
 * massif, carved by simulated rain and settled by slope, written as a 16-bit
 * greyscale PNG. The same seed always gives the same file.
 *
 * Usage:
 *   node scripts/build-heightmap.js                     # writes public/Heightmap.png
 *   node scripts/build-heightmap.js --seed 7 --out x.png
 *
 * The stages, in order:
 *   1. Shape    — a main crest and its spurs, as soft ridges on a low plain.
 *   2. Detail   — ridged multifractal noise, domain-warped so no two flanks
 *                 repeat, and weighted by the shape so the plain stays quiet.
 *   3. Erosion  — water droplets that pick up and drop sediment, which is
 *                 what cuts branching valleys and leaves fans at their mouths.
 *   4. Settling — thermal creep down slopes steeper than the angle of repose.
 *   5. Levels   — normalised to the full 16-bit range.
 */
import { writeFileSync } from 'fs'
import { deflateSync, crc32 } from 'zlib'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const SEED = Number(arg('seed', 1913))
const OUT = resolve(arg('out', resolve(__dirname, '../public/Heightmap.png')))
const N = Number(arg('size', 1024))
const DROPS = Number(arg('drops', 1600000))

// ── Seeded randomness ─────────────────────────────────────────────────────────
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(SEED)

// ── Gradient noise ────────────────────────────────────────────────────────────
const PERM = new Uint8Array(512)
{
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]
}
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const X = xi & 255, Y = yi & 255
  const g = (ix, iy, dx, dy) => { const v = GRAD[PERM[PERM[ix] + iy] & 7]; return v[0] * dx + v[1] * dy }
  const u = fade(xf), v = fade(yf)
  const a = g(X, Y, xf, yf), b = g(X + 1, Y, xf - 1, yf)
  const c = g(X, Y + 1, xf, yf - 1), d = g(X + 1, Y + 1, xf - 1, yf - 1)
  return (a + u * (b - a)) + v * ((c + u * (d - c)) - (a + u * (b - a)))
}
function fbm(x, y, oct) {
  let s = 0, amp = 0.5, f = 1
  for (let o = 0; o < oct; o++) { s += amp * noise(x * f, y * f); f *= 2.03; amp *= 0.5 }
  return s
}
/** Ridged multifractal: sharp crests where the noise crosses zero. */
function ridged(x, y, oct) {
  let s = 0, amp = 0.5, f = 1, w = 1
  for (let o = 0; o < oct; o++) {
    let n = 1 - Math.abs(noise(x * f, y * f))
    n *= n
    n *= w
    w = Math.min(1, Math.max(0, n * 2))
    s += n * amp
    f *= 2.1; amp *= 0.52
  }
  return s
}

// ── 1. Shape ──────────────────────────────────────────────────────────────────
/** Distance from p to the segment ab, in plate units. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
// The massif's footprint, as polylines in 0..1 plate coordinates:
// [points, height, reach]. It only says where the mountains stand; the ridges
// themselves come from the noise in the next stage.
const CRESTS = [
  [[[0.10, 0.60], [0.30, 0.50], [0.50, 0.46], [0.70, 0.50], [0.90, 0.42]], 1.00, 0.30],
  [[[0.50, 0.46], [0.52, 0.28]], 0.62, 0.18],
  [[[0.30, 0.50], [0.22, 0.82]], 0.66, 0.22],
  [[[0.70, 0.50], [0.78, 0.84]], 0.74, 0.24],
]
function envelopeAt(x, y) {
  let h = 0
  for (const [pts, height, reach] of CRESTS) {
    let d = Infinity
    for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, y, ...pts[i - 1], ...pts[i]))
    const t = Math.max(0, 1 - d / reach)
    const r = height * t * t * (3 - 2 * t)
    h = h + r - h * r
  }
  const edge = Math.min(x, y, 1 - x, 1 - y)
  const keep = Math.min(1, Math.max(0, (edge - 0.01) / 0.1))
  return h * keep * keep * (3 - 2 * keep)
}

// ── 2. Detail ─────────────────────────────────────────────────────────────────
const H = new Float32Array(N * N)
// Where the massif stands, kept for the rivers: they cut the mountains, not the plain.
const ENV = new Float32Array(N * N)
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = i / N, y = j / N
    // Warp the lookup, so ridges wander rather than run straight.
    const wx = x + 0.11 * fbm(x * 2.2 + 11.3, y * 2.2 + 4.1, 5)
    const wy = y + 0.11 * fbm(x * 2.2 - 7.7, y * 2.2 + 19.2, 5)
    const env = envelopeAt(wx, wy)
    ENV[j * N + i] = env
    // Ridged noise at mountain scale makes the crests and their spurs; the
    // envelope lifts it where the massif stands and lets it die on the plain.
    const rug = ridged(wx * 3.4, wy * 3.4, 8)
    const peaks = env * (0.08 + 1.5 * Math.pow(rug, 1.4))
    // The plain is not flat: a long, low swell, so the lines across it move
    // like water rather than ruling a floor.
    const swell = 0.022 * fbm(x * 2.5 + 3.3, y * 5 - 1.7, 4) * (1 - env)
    // Fine ridged rock on the massif: aretes and gullies a few pixels wide.
    // Without them the surface is smooth at the scale the ridge and valley
    // marks read curvature at, and those marks find almost nothing.
    const crag = 0.16 * env * ridged(wx * 16 + 5.1, wy * 16 - 2.3, 4)
    H[j * N + i] = peaks + crag + 0.06 * env + 0.006 * fbm(x * 6, y * 6, 5) + 0.012 * fbm(x * 1.5, y * 1.5, 3) + swell
  }
}

// ── 3. Erosion ────────────────────────────────────────────────────────────────
// Droplet erosion after Hans Theobald Beyer's 2015 thesis. His constants were
// tuned on 256-px maps, so the heights are scaled until a slope per pixel is
// what it was there.
const SCALE = 4
for (let k = 0; k < H.length; k++) H[k] *= SCALE

function gradAt(px, py) {
  const x = Math.floor(px), y = Math.floor(py)
  const u = px - x, v = py - y
  const i = y * N + x
  const a = H[i], b = H[i + 1], c = H[i + N], d = H[i + N + 1]
  return {
    h: a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v,
    gx: (b - a) * (1 - v) + (d - c) * v,
    gy: (c - a) * (1 - u) + (d - b) * u,
  }
}

const RADIUS = 2
const brush = []
for (let dy = -RADIUS; dy <= RADIUS; dy++) {
  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    const w = RADIUS - Math.hypot(dx, dy)
    if (w > 0) brush.push([dx, dy, w])
  }
}
const brushSum = brush.reduce((s, b) => s + b[2], 0)
for (const b of brush) b[2] /= brushSum

const INERTIA = 0.05, CAPACITY = 4, MIN_CAP = 0.002, DEPOSIT = 0.3, ERODE = 0.3
const EVAPORATE = 0.015, GRAVITY = 4, LIFETIME = 64
for (let n = 0; n < DROPS; n++) {
  let px = RADIUS + rand() * (N - 2 * RADIUS - 2), py = RADIUS + rand() * (N - 2 * RADIUS - 2)
  let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0
  for (let life = 0; life < LIFETIME; life++) {
    const xi = Math.floor(px), yi = Math.floor(py)
    const u = px - xi, v = py - yi
    const g = gradAt(px, py)
    dx = dx * INERTIA - g.gx * (1 - INERTIA)
    dy = dy * INERTIA - g.gy * (1 - INERTIA)
    const len = Math.hypot(dx, dy)
    if (len === 0) break
    dx /= len; dy /= len
    px += dx; py += dy
    if (px < RADIUS || py < RADIUS || px >= N - RADIUS - 1 || py >= N - RADIUS - 1) break
    const dh = gradAt(px, py).h - g.h
    const cap = Math.max(-dh * speed * water * CAPACITY, MIN_CAP)
    const i0 = yi * N + xi
    if (sediment > cap || dh > 0) {
      // Fill a pit up to its rim, or drop the excess the water can no longer carry.
      const drop = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * DEPOSIT
      sediment -= drop
      H[i0] += drop * (1 - u) * (1 - v)
      H[i0 + 1] += drop * u * (1 - v)
      H[i0 + N] += drop * (1 - u) * v
      H[i0 + N + 1] += drop * u * v
    } else {
      const take = Math.min((cap - sediment) * ERODE, -dh)
      for (const [bx, by, w] of brush) {
        const k = (yi + by) * N + (xi + bx)
        const t = Math.min(H[k], take * w)
        H[k] -= t
        sediment += t
      }
    }
    speed = Math.sqrt(Math.max(0, speed * speed + dh * GRAVITY))
    water *= 1 - EVAPORATE
  }
}

// ── 3b. Rivers ────────────────────────────────────────────────────────────────
// Droplets roughen slopes but leave pits and never join into a network. Stream
// power does: every cell drains to its lowest neighbour, and a channel cuts in
// proportion to the square root of the area it drains (Braun & Willett's
// implicit scheme). The priority flood that orders the cells routes water out
// of every pit over a filled copy of the terrain, so a basin still sends its
// water on, but the terrain itself keeps its hollows rather than turning
// every one into a flat lake.
const NB = [1, -1, N, -N, N + 1, N - 1, -N + 1, -N - 1]
const NB_DIST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2]

/** A binary min-heap of cell indices keyed by height. */
function makeHeap(cap) {
  const idx = new Int32Array(cap), key = new Float32Array(cap)
  let n = 0
  return {
    get size() { return n },
    push(i, k) {
      let c = n++
      while (c > 0) {
        const p = (c - 1) >> 1
        if (key[p] <= k) break
        idx[c] = idx[p]; key[c] = key[p]; c = p
      }
      idx[c] = i; key[c] = k
    },
    pop() {
      const top = idx[0], li = idx[--n], lk = key[n]
      let c = 0
      for (;;) {
        let m = 2 * c + 1
        if (m >= n) break
        if (m + 1 < n && key[m + 1] < key[m]) m++
        if (key[m] >= lk) break
        idx[c] = idx[m]; key[c] = key[m]; c = m
      }
      idx[c] = li; key[c] = lk
      return top
    },
  }
}

const receiver = new Int32Array(N * N)
const rdist = new Float32Array(N * N)
const stack = new Int32Array(N * N)
const area = new Float32Array(N * N)
const seen = new Uint8Array(N * N)
const filled = new Float32Array(N * N)

/**
 * Orders every cell downstream-first and gives each its receiver. In the
 * filled copy, pits are raised by a hair over their outlet, so nothing is
 * left without a way out.
 */
function route() {
  filled.set(H)
  seen.fill(0)
  const heap = makeHeap(N * N)
  let s = 0
  for (let k = 0; k < N; k++) {
    for (const c of [k, (N - 1) * N + k, k * N, k * N + N - 1]) {
      if (!seen[c]) { seen[c] = 1; receiver[c] = c; rdist[c] = 1; heap.push(c, filled[c]) }
    }
  }
  while (heap.size) {
    const c = heap.pop()
    stack[s++] = c
    const x = c % N
    for (let d = 0; d < 8; d++) {
      const nb = c + NB[d]
      const nx = x + (d === 0 || d === 4 || d === 6 ? 1 : d === 1 || d === 5 || d === 7 ? -1 : 0)
      if (nx < 0 || nx >= N || nb < 0 || nb >= N * N || seen[nb]) continue
      seen[nb] = 1
      receiver[nb] = c
      rdist[nb] = NB_DIST[d]
      if (filled[nb] <= filled[c]) filled[nb] = filled[c] + 1e-5
      heap.push(nb, filled[nb])
    }
  }
}

const RIVER_STEPS = Number(arg('rivers', 40))
const RIVER_K = 0.003
for (let step = 0; step < RIVER_STEPS; step++) {
  route()
  area.fill(1)
  for (let s = N * N - 1; s > 0; s--) {
    const c = stack[s], r = receiver[c]
    if (r !== c) area[r] += area[c]
  }
  // Downstream first, so each receiver already holds its new height.
  for (let s = 0; s < N * N; s++) {
    const c = stack[s], r = receiver[c]
    // A cell below its receiver is in a hollow: water passes, nothing cuts.
    if (r === c || H[r] >= H[c]) continue
    const f = RIVER_K * Math.min(1, ENV[c] * 4) * Math.sqrt(area[c]) / rdist[c]
    H[c] = (H[c] + f * H[r]) / (1 + f)
  }
}

// ── 4. Settling ───────────────────────────────────────────────────────────────
// Talus creep: any step steeper than the angle of repose sheds part of its
// difference downhill. Short, so it rounds the erosion's pixel noise without
// melting the crests.
const REPOSE = 0.3
for (let pass = 0; pass < 3; pass++) {
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const k = j * N + i
      for (const o of [1, -1, N, -N]) {
        const d = H[k] - H[k + o]
        if (d > REPOSE) { const m = (d - REPOSE) * 0.25; H[k] -= m; H[k + o] += m }
      }
    }
  }
}

// ── 5. Levels ─────────────────────────────────────────────────────────────────
let lo = Infinity, hi = -Infinity
for (const h of H) { if (h < lo) lo = h; if (h > hi) hi = h }
const px16 = Buffer.alloc(N * (N * 2 + 1))
for (let j = 0; j < N; j++) {
  const row = j * (N * 2 + 1)
  px16[row] = 0 // filter: none
  for (let i = 0; i < N; i++) {
    const v = Math.round(((H[j * N + i] - lo) / (hi - lo)) * 65535)
    px16.writeUInt16BE(v, row + 1 + i * 2)
  }
}

// ── PNG ───────────────────────────────────────────────────────────────────────
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4)
ihdr[8] = 16; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
writeFileSync(OUT, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(px16, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]))
console.log(`Wrote ${OUT} — ${N}×${N}, seed ${SEED}, ${DROPS} drops`)
