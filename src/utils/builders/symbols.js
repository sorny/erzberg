/**
 * Map symbols: Tree Line, Constellation, Weather Fronts, Tally and Orographic
 * Rain.
 *
 * Each stamps a small symbol where the ground calls for it, the way a map sheet
 * letters a forest, a summit or a front: a conifer or a broadleaf round, a
 * star, a front's teeth and bumps, a gate of tally marks, a streak of rain.
 * Every stroke is draped a cell at a time, so a symbol lies on the slope it
 * stands for.
 */
import { boxBlur, sampleBilinear } from '../terrain'
import { groundMetres } from './ground.js'
import { slopeDegrees } from './survey.js'
import {
  F32List, F64List, I32List, MARCHING_TABLE, _edgeId, _edgeX, _edgeY,
  chaikinSmoothFlat, chainLevelSegments, drapeEdge, edgeLerp01, getChainScratch,
  inElevCut, mulberry32, normElev, traceLevelSet,
} from './shared.js'
import { computeVertexColor } from '../colorUtils'

const RAD = Math.PI / 180

/** The lowest and highest height on the ground, or null on a flat plate. */
export function heightRange(grid, gridMask) {
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < grid.length; i++) {
    if (!gridMask[i]) continue
    if (grid[i] < lo) lo = grid[i]
    if (grid[i] > hi) hi = grid[i]
  }
  return hi > lo ? [lo, hi] : null
}

/** A polyline of [col, row] points, draped. */
export function stroke(out, terrain, p, sMask, pts, closed = false) {
  const n = pts.length
  for (let i = 1; i < n + (closed ? 1 : 0); i++) {
    const a = pts[i - 1], b = pts[i % n]
    drapeEdge(out, terrain, p, sMask, a[0], a[1], b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]))
  }
}

export const writer = () => ({ positions: new F32List(), colors: new F32List() })
export const done = (w, note) => ({ positions: w.positions.toArray(), colors: w.colors.toArray(), note })

// ─── Tree Line ───────────────────────────────────────────────────────────────

/** A conifer in symbol space: tiers of drooping boughs on a trunk, base at 0, up is +v. */
function conifer(tiers, shade) {
  const strokes = [[[0, 0], [0, 0.24]]]
  const rise = 1.3 / (tiers + 0.6)
  for (let k = 0; k < tiers; k++) {
    const vb = 0.18 + k * rise, va = vb + rise * 1.6, w = 0.56 * (1 - k / (tiers + 0.4))
    // A bough droops at its tip and turns up a little at the very end.
    strokes.push([[-w, vb - 0.02], [-w * 0.92, vb - 0.07], [-w * 0.5, vb + (va - vb) * 0.28], [0, va], [w * 0.5, vb + (va - vb) * 0.28], [w * 0.92, vb - 0.07], [w, vb - 0.02]])
    // One stroke down the shaded half of each tier.
    if (shade) strokes.push([[w * 0.42, va - (va - vb) * 0.5], [w * 0.42, vb + 0.03]])
  }
  return strokes
}

/** A broadleaf in symbol space: a lobed crown on a forked trunk. */
function broadleaf(rng, shade) {
  const R = 0.46, cy = 0.78, ph = rng() * 6.283, ph2 = rng() * 6.283, crown = []
  for (let k = 0; k < 36; k++) {
    const t = k / 36 * 2 * Math.PI, rr = R * (1 + 0.09 * Math.sin(6 * t + ph) + 0.04 * Math.sin(11 * t + ph2))
    crown.push([Math.cos(t) * rr, cy + Math.sin(t) * rr])
  }
  crown.push(crown[0])
  const strokes = [crown, [[0, 0], [0, cy - 0.22]], [[0, cy - 0.3], [-0.14, cy - 0.1]], [[0, cy - 0.26], [0.12, cy - 0.06]]]
  if (shade) {
    // Crescents on the lower right, the side away from a light in the upper left.
    for (const [f, t0, t1] of [[0.8, -100, 15], [0.58, -80, -10]]) {
      const arc = []
      for (let d = t0; d <= t1; d += 10) arc.push([Math.cos(d * RAD) * R * f, cy + Math.sin(d * RAD) * R * f])
      strokes.push(arc)
    }
  }
  return strokes
}

/** The other tree styles, in the same symbol space: [broadleaf, conifer]. */
const TREE_STYLES = {
  // The plain symbols: a round crown on a short trunk, two flanks to a point.
  classic: () => {
    const crown = []
    for (let k = 0; k <= 8; k++) crown.push([Math.cos(k / 8 * 2 * Math.PI) * 0.45, 0.95 + Math.sin(k / 8 * 2 * Math.PI) * 0.45])
    return [[crown, [[0, 0], [0, 0.5]]], [[[-0.5, 0.35], [0, 1.45], [0.5, 0.35]], [[0, 0.35], [0, 0]]]]
  },
  // A topographic sheet's marks: a small ring and a small closed triangle.
  map: () => {
    const ring = []
    for (let k = 0; k <= 10; k++) ring.push([Math.cos(k / 10 * 2 * Math.PI) * 0.3, 0.45 + Math.sin(k / 10 * 2 * Math.PI) * 0.3])
    return [[ring], [[[-0.3, 0.1], [0, 0.85], [0.3, 0.1], [-0.3, 0.1]]]]
  },
  // One pen line each: loops round the crown, and a zigzag that narrows upward.
  scribble: (rng) => {
    const loops = [], ph = rng() * 6.283
    for (let k = 0; k <= 84; k++) {
      const t = k / 84 * 2 * Math.PI
      loops.push([0.27 * Math.cos(t + ph) + 0.17 * Math.cos(7 * t), 0.8 + 0.27 * Math.sin(t + ph) + 0.17 * Math.sin(7 * t)])
    }
    const zig = [[0, 0], [0, 0.3]]
    for (let j = 0; j < 8; j++) {
      const w = 0.5 * (1 - j / 8.5)
      zig.push([j % 2 ? w : -w, 0.3 + j * 0.15])
    }
    zig.push([0, 1.5])
    return [[loops, [[0, 0], [0, 0.55]]], [zig]]
  },
}

/**
 * Forest symbols as an alpine map draws them, up to a tree line.
 *
 * Sites sit on a jittered grid, `spacing` raster pixels apart. Below
 * `broadleaf` (a share of the height range) a site takes a broadleaf, a lobed
 * crown on a forked trunk, and above it a conifer of tiered boughs. The two mix
 * over a band a tenth of the range wide. Above `treeline` there are none, and
 * the line is ragged. The forest thins with the slope in true degrees, a site
 * keeping its tree with a chance of 1 − (slope / steep)², and none stands on
 * ground steeper than `steep`. `clumping` gathers the trees into groves with
 * clearings between, from a value noise six sites across. Trees vary in size,
 * and `krummholz` shrinks them over the last 12% of the range below the line.
 * With `shade`, each tree takes a short ground line, and a Drawn tree a few
 * strokes on its lower right. `style` picks the symbols: 'drawn' (a lobed crown
 * on a forked trunk, tiered boughs), 'classic' (a round crown, two flanks to a
 * point), 'map' (a small ring, a small triangle) or 'scribble' (looped and
 * zigzag pen lines).
 *
 * `facing` is the bearing a tree's front looks toward: the side it is drawn to
 * be seen from. `follow` 'downhill' or 'uphill' turns each tree to the slope
 * instead, and `turn` spreads the facings at random by up to that many degrees.
 * With `stance` 'flat' the symbol lies on the ground, its top pointing away
 * from the side it faces. With 'upright' it stands in a vertical plane, as a
 * cut-out seen from that side.
 *
 * With `line`, the tree line itself is a second pen, `TreeLine-Line`, traced
 * as a contour in `lineColor` and dotted by its style.
 */
export function buildTreeLine(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const range = heightRange(grid, gridMask)
  if (!range) return null
  const [lo, hi] = range
  const clamp01 = (v, d) => Math.max(0, Math.min(1, v ?? d))
  const line = lo + clamp01(o.treeline, 0.7) * (hi - lo)
  const broad = lo + clamp01(o.broadleaf, 0.4) * (hi - lo)
  const steep = Math.max(5, Math.min(89, o.steep ?? 40))
  const slope = slopeDegrees(terrain, groundMetres(terrain, p, o.cellMetres, o.relief).ground())
  const P = Math.max(1, (o.spacing ?? 6) / scl)
  const S = P * 0.42 * Math.max(0.2, o.size ?? 1)
  const clump = clamp01(o.clumping, 0.35), krumm = clamp01(o.krummholz, 0.6), shade = o.shade ?? true
  const upright = o.stance === 'upright', follow = o.follow ?? 'bearing'
  const style = o.style ?? 'drawn'
  const spread = Math.max(0, Math.min(180, o.turn ?? 0)) * RAD
  const facing = (o.facing ?? 180) * RAD
  const rng = mulberry32(Math.round(o.seed ?? 1))
  const B = follow === 'bearing' ? null : boxBlur(grid, cols, rows, 2, sMask)
  const { elevScale, elevMinCut, elevMaxCut } = p

  // The grove noise: random values on a lattice six sites across, smoothed.
  const nrng = mulberry32(Math.round(o.seed ?? 1) * 7919 + 13), G = 6 * P
  const gc = Math.ceil(cols / G) + 2, gr = Math.ceil(rows / G) + 2, lat = new Float32Array(gc * gr).map(() => nrng())
  const grove = (c, r) => {
    const x = c / G, y = r / G, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), at = (a, b) => lat[b * gc + a]
    return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy
  }

  const trees = writer()
  // A symbol-space stroke laid flat on the ground: `top` is the way up the symbol.
  const lay = (pts, c, r, k, rc, rr, tc, tr) => stroke(trees, terrain, p, sMask,
    pts.map(([u, v]) => [c + (u * rc + v * tc) * k, r + (u * rr + v * tr) * k]))
  // The same stroke stood up in a vertical plane through the base.
  const stand = (pts, c, r, e0, k, rc, rr, col) => {
    for (let q = 1; q < pts.length; q++) {
      const [u0, v0] = pts[q - 1], [u1, v1] = pts[q]
      trees.positions.push6((c + u0 * rc * k) * scl - halfW, e0 + v0 * k * scl, (r + u0 * rr * k) * scl - halfH,
        (c + u1 * rc * k) * scl - halfW, e0 + v1 * k * scl, (r + u1 * rr * k) * scl - halfH)
      trees.colors.pushRgb2(col)
    }
  }

  let count = 0
  for (let rf = P / 2; rf < rows - 1; rf += P) {
    for (let cf = P / 2; cf < cols - 1; cf += P) {
      const c = cf + (rng() - 0.5) * 0.7 * P, r = rf + (rng() - 0.5) * 0.7 * P
      const ragged = rng(), thin = rng(), mix = rng(), grow = rng(), turn = rng(), sow = rng(), shape = rng()
      if (c < 0 || r < 0 || c > cols - 1 || r > rows - 1) continue
      const i = Math.round(r) * cols + Math.round(c)
      if (!gridMask[i]) continue
      const h = sampleBilinear(grid, sMask, rows, cols, r, c)
      if (!(h < line - ragged * 0.04 * (hi - lo))) continue
      const s = slope[i]
      if (s < 0 || s >= steep || thin < (s / steep) ** 2) continue
      if (sow > 1 - clump * 1.4 * (1 - grove(c, r))) continue

      // The way the tree faces, as a unit vector in (col, row).
      let fa = facing
      if (B) {
        const gx = sampleBilinear(B, sMask, rows, cols, r, c + 1) - sampleBilinear(B, sMask, rows, cols, r, c - 1)
        const gy = sampleBilinear(B, sMask, rows, cols, r + 1, c) - sampleBilinear(B, sMask, rows, cols, r - 1, c)
        // Bearing of the downhill direction: north is −row.
        if (Math.hypot(gx, gy) > 1e-9) fa = Math.atan2(-gx, gy) + (follow === 'uphill' ? Math.PI : 0)
      }
      fa += (turn - 0.5) * 2 * spread
      const fc = Math.sin(fa), fr = -Math.cos(fa)
      // Right of the symbol, as seen from the side it faces.
      const rc = fr, rr = -fc

      const near = Math.max(0, Math.min(1, (line - h) / (0.12 * (hi - lo))))
      const k = S * (0.85 + 0.3 * grow) * (1 - krumm * 0.6 * (1 - near))
      const isBroad = h < broad + (mix - 0.5) * 0.1 * (hi - lo)
      // Its own stream for the shape, so every style keeps the same sites.
      const own = mulberry32((shape * 4294967296) >>> 0)
      const pts = TREE_STYLES[style] ? TREE_STYLES[style](own)[isBroad ? 0 : 1].slice()
        : isBroad ? broadleaf(own, shade) : conifer(k < S * 0.7 ? 2 : 3, shade)
      // Centred under the trunk: a foot to one side reads as a second, fallen stem.
      if (shade) pts.push([[-0.26, 0], [0.26, 0]])

      if (upright) {
        const e0 = (h - 0.5) * 100 * elevScale
        if (!inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut)) continue
        const col = computeVertexColor(normElev(e0, minElev, maxElev), gridSlopes[i] / (maxSlope || 1), Math.PI / 2, p)
        for (const q of pts) stand(q, c, r, e0, k, rc, rr, col)
      } else {
        // Flat, the top points away from the viewer; the base sits below the site.
        const tc = -fc, tr = -fr, bc = c - tc * 0.75 * k, br = r - tr * 0.75 * k
        for (const q of pts) lay(q, bc, br, k, rc, rr, tc, tr)
      }
      count++
    }
  }
  const note = { trees: count, treeline: o.treeline ?? 0.7 }
  if (!count) return null
  const out = { 'TreeLine-Trees': done(trees, note) }
  if (o.line) {
    const field = new Float32Array(grid.length)
    for (let i = 0; i < grid.length; i++) field[i] = gridMask[i] ? grid[i] : -1
    out['TreeLine-Line'] = { ...traceLevelSet(terrain, { ...p, lineColor: o.lineColor ?? p.lineColor }, field, [line], 2), note }
  }
  return out
}

// ─── Constellation ───────────────────────────────────────────────────────────

/**
 * The summits as a star chart.
 *
 * A summit is a cell of the blurred ground that is the highest within
 * `spacing` raster pixels and stands at least 2% of the height range above
 * the lowest point there, so a flat plain is no field of summits. The `count` highest stand as stars, each a cross of
 * four long and four short rays round a small ring, larger the higher it
 * stands. `mark` 'dot' draws a dot instead, as rings packed to the centre, and
 * 'none' draws no symbol, only the links. With `links`, a minimum spanning tree joins them as the second pen,
 * `Constellation-Links`: the shortest set of lines that links every star,
 * which never closes a loop, so it reads as the lines of a constellation.
 */
export function buildConstellation(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const range = heightRange(grid, gridMask)
  if (!range) return null
  const [lo, hi] = range
  const B = boxBlur(grid, cols, rows, 2, sMask)
  const win = Math.max(2, Math.round((o.spacing ?? 30) / scl))
  const count = Math.max(1, Math.min(300, Math.round(o.count ?? 30)))

  // Local highs of the 3 × 3 first, then each against its whole window.
  // Not at the edge of the plate: a raster clipped flat there tops out along
  // the whole edge, and every cell of it would read as a summit.
  const edge = Math.max(2, Math.round(win / 3))
  const cand = []
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
  const stars = []
  for (const i of cand) {
    if (stars.length >= count) break
    const r = (i / cols) | 0, c = i % cols
    let top = true, low = B[i]
    for (let j = Math.max(0, r - win); j <= Math.min(rows - 1, r + win) && top; j++) {
      for (let k = Math.max(0, c - win); k <= Math.min(cols - 1, c + win); k++) {
        const v = B[j * cols + k]
        if (v > B[i]) { top = false; break }
        if (v < low) low = v
      }
    }
    // A flat ties with itself everywhere: a summit stands above its window.
    if (top && B[i] - low > 0.02 * (hi - lo) && stars.every(([sc, sr]) => Math.hypot(sc - c, sr - r) > win)) stars.push([c, r, (B[i] - lo) / (hi - lo)])
  }
  if (!stars.length) return null
  const note = { stars: stars.length }

  const ink = writer()
  const size = Math.max(0.2, o.size ?? 1), mark = o.mark ?? 'star'
  const reach = (v) => win * 0.3 * size * (0.6 + 0.8 * v)
  const circle = (c, r, rad) => {
    const pts = [], n = Math.max(10, Math.ceil(rad * 4))
    for (let k = 0; k < n; k++) pts.push([c + Math.cos(k / n * 2 * Math.PI) * rad, r + Math.sin(k / n * 2 * Math.PI) * rad])
    stroke(ink, terrain, p, sMask, pts, true)
  }
  for (const [c, r, v] of stars) {
    const a = reach(v)
    if (mark === 'dot') {
      // Rings a third of a cell apart, so the pen fills the dot.
      const rad = a * 0.4
      for (let k = rad; k > 0.15; k -= 0.35) circle(c, r, k)
      continue
    }
    if (mark !== 'star') continue
    const d = a * 0.45 * Math.SQRT1_2, ring = a * 0.28
    stroke(ink, terrain, p, sMask, [[c - a, r], [c - ring, r]]); stroke(ink, terrain, p, sMask, [[c + ring, r], [c + a, r]])
    stroke(ink, terrain, p, sMask, [[c, r - a], [c, r - ring]]); stroke(ink, terrain, p, sMask, [[c, r + ring], [c, r + a]])
    stroke(ink, terrain, p, sMask, [[c - d * 2, r - d * 2], [c - ring * 0.7, r - ring * 0.7]])
    stroke(ink, terrain, p, sMask, [[c + ring * 0.7, r + ring * 0.7], [c + d * 2, r + d * 2]])
    stroke(ink, terrain, p, sMask, [[c - d * 2, r + d * 2], [c - ring * 0.7, r + ring * 0.7]])
    stroke(ink, terrain, p, sMask, [[c + ring * 0.7, r - ring * 0.7], [c + d * 2, r - d * 2]])
    circle(c, r, ring)
  }
  const out = {}
  if (mark === 'star' || mark === 'dot') out['Constellation-Stars'] = done(ink, note)
  if (o.links && stars.length > 1) {
    // Prim: a few hundred stars at most, so the plain square loop is enough.
    const n = stars.length, inTree = new Uint8Array(n), best = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1)
    const links = writer()
    best[0] = 0
    for (let step = 0; step < n; step++) {
      let u = -1
      for (let v = 0; v < n; v++) if (!inTree[v] && (u < 0 || best[v] < best[u])) u = v
      inTree[u] = 1
      if (from[u] >= 0) {
        const [c0, r0, , ] = stars[from[u]], [c1, r1] = stars[u]
        const len = Math.hypot(c1 - c0, r1 - r0)
        // Stop short of each star's rays or the dot's edge, and run to the
        // summit itself when there is no symbol.
        const gap = (v) => (mark === 'star' ? win * 0.5 : mark === 'dot' ? reach(v) * 0.4 + 1 : 0)
        const cut0 = Math.min(0.45, gap(stars[from[u]][2]) / (len || 1)), cut1 = Math.min(0.45, gap(stars[u][2]) / (len || 1))
        drapeEdge(links, terrain, p, sMask, c0 + (c1 - c0) * cut0, r0 + (r1 - r0) * cut0, c1 - (c1 - c0) * cut1, r1 - (r1 - r0) * cut1, Math.atan2(r1 - r0, c1 - c0))
      }
      for (let v = 0; v < n; v++) {
        if (inTree[v]) continue
        const d = Math.hypot(stars[v][0] - stars[u][0], stars[v][1] - stars[u][1])
        if (d < best[v]) { best[v] = d; from[v] = u }
      }
    }
    out['Constellation-Links'] = done(links, note)
  }
  return Object.keys(out).length ? out : null
}

// ─── Weather Fronts ──────────────────────────────────────────────────────────

/**
 * One level of a field as polylines in grid units: flat [c, r, …] and whether
 * each closes. A negative value is no ground, as in `traceLevelSet`.
 */
function levelChains(field, rows, cols, level) {
  const segE = new I32List(), segXY = new F64List()
  const ex = _edgeX, ey = _edgeY, eid = _edgeId
  for (let r = 0; r < rows - 1; r++) {
    const row0 = r * cols, row1 = row0 + cols
    for (let c = 0; c < cols - 1; c++) {
      const d00 = field[row0 + c], d10 = field[row0 + c + 1], d01 = field[row1 + c], d11 = field[row1 + c + 1]
      if (d00 < 0 || d10 < 0 || d01 < 0 || d11 < 0) continue
      const idx = (d00 >= level ? 8 : 0) | (d10 >= level ? 4 : 0) | (d11 >= level ? 2 : 0) | (d01 >= level ? 1 : 0)
      if (idx === 0 || idx === 15) continue
      ex[0] = c + edgeLerp01(d00, d10, level); ey[0] = r
      ex[1] = c + 1; ey[1] = r + edgeLerp01(d10, d11, level)
      ex[2] = c + edgeLerp01(d01, d11, level); ey[2] = r + 1
      ex[3] = c; ey[3] = r + edgeLerp01(d00, d01, level)
      const base = (row0 + c) * 2
      eid[0] = base; eid[1] = (row0 + c + 1) * 2 + 1; eid[2] = (row1 + c) * 2; eid[3] = base + 1
      const pairs = MARCHING_TABLE[idx]
      for (let k = 0; k < pairs.length; k += 2) {
        segE.push2(eid[pairs[k]], eid[pairs[k + 1]])
        segXY.push4(ex[pairs[k]], ey[pairs[k]], ex[pairs[k + 1]], ey[pairs[k + 1]])
      }
    }
  }
  if (!segE.length) return []
  return chainLevelSegments(segE.a, segXY.a, segE.length / 2, getChainScratch(rows * cols * 2))
}

/**
 * Contours lettered as a synoptic chart.
 *
 * `levels` contours split the height range evenly. The lower two fifths are
 * warm fronts, with semicircles, the upper two fifths cold fronts, with
 * triangles, and a level in the middle fifth a stationary front, its triangles
 * and semicircles taking turns on opposite sides of the line, as a weather map
 * draws one. A symbol stands every `spacing` raster pixels along its line and
 * points uphill, so the teeth all lean the way the ground rises.
 *
 * Three pens: the lines in the mode's ink (`Fronts-Lines`), the warm symbols in
 * `warmColor` and the cold ones in `coldColor`. With `solid`, each symbol gets
 * a smaller copy inside it, which reads as a solid mark from a little way off.
 */
export function buildFronts(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const range = heightRange(grid, gridMask)
  if (!range) return null
  const [lo, hi] = range
  const radius = Math.max(0, o.radius ?? 2)
  const B = radius > 0 ? boxBlur(grid, cols, rows, radius, sMask) : grid
  const field = new Float32Array(grid.length)
  for (let i = 0; i < grid.length; i++) field[i] = gridMask[i] ? B[i] : -1
  const nL = Math.max(1, Math.min(30, Math.round(o.levels ?? 5)))
  const P = Math.max(2, (o.spacing ?? 24) / scl)
  const S = P * 0.22 * Math.max(0.2, o.size ?? 1)
  const at = (c, r) => sampleBilinear(B, sMask, rows, cols, Math.max(0, Math.min(rows - 1, r)), Math.max(0, Math.min(cols - 1, c)))

  const lines = writer(), warm = writer(), cold = writer()
  const warmInk = { ...p, lineColor: o.warmColor ?? '#c0392b' }, coldInk = { ...p, lineColor: o.coldColor ?? '#1f5fa8' }
  let fronts = 0
  for (let k = 0; k < nL; k++) {
    const level = lo + (k + 1) / (nL + 1) * (hi - lo)
    const share = (k + 0.5) / nL
    const kind = share < 0.4 ? 'warm' : share >= 0.6 ? 'cold' : 'stationary'
    for (const chain of levelChains(field, rows, cols, level)) {
      const flat = chaikinSmoothFlat(chain.pts, chain.closed, 2, 0)
      const pts = []
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]])
      if (chain.closed && pts.length > 1) pts.push(pts[0])
      let total = 0
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      if (total < 2 * P) continue
      fronts++
      stroke(lines, terrain, p, sMask, pts)
      let acc = 0, need = P / 2, n = 0
      for (let i = 1; i < pts.length; i++) {
        const [c0, r0] = pts[i - 1], [c1, r1] = pts[i], d = Math.hypot(c1 - c0, r1 - r0)
        while (d > 0 && acc + d >= need) {
          const t = (need - acc) / d, c = c0 + (c1 - c0) * t, r = r0 + (r1 - r0) * t
          const tc = (c1 - c0) / d, tr = (r1 - r0) / d
          let nc = -tr, nr = tc
          // Uphill is the side the ground rises to.
          if (at(c + nc, r + nr) < at(c - nc, r - nr)) { nc = -nc; nr = -nr }
          const isWarm = kind === 'warm' || (kind === 'stationary' && n % 2 === 1)
          // On a stationary front the semicircles face the other way.
          const side = kind === 'stationary' && isWarm ? -1 : 1
          const ux = nc * side, uy = nr * side
          const shape = (s) => {
            if (isWarm) {
              const arc = []
              for (let q = 0; q <= 10; q++) { const f = q / 10 * Math.PI; arc.push([c - Math.cos(f) * s * tc + Math.sin(f) * s * ux, r - Math.cos(f) * s * tr + Math.sin(f) * s * uy]) }
              return arc
            }
            return [[c - s * tc, r - s * tr], [c + 1.5 * s * ux, r + 1.5 * s * uy], [c + s * tc, r + s * tr]]
          }
          const w = isWarm ? warm : cold, ink = isWarm ? warmInk : coldInk
          stroke(w, terrain, ink, sMask, shape(S))
          if (o.solid) stroke(w, terrain, ink, sMask, shape(S * 0.5))
          need += P; n++
        }
        acc += d
      }
    }
  }
  if (!fronts) return null
  const note = { fronts }
  return { 'Fronts-Lines': done(lines, note), 'Fronts-Warm': done(warm, note), 'Fronts-Cold': done(cold, note) }
}

// ─── Tally ───────────────────────────────────────────────────────────────────

/**
 * The height counted in tally marks, one cell of `cell` raster pixels each.
 *
 * A cell counts its height as a share of the range, times `max`: four upright
 * strokes and a slash make each gate of five, two gates to a row. `jitter`
 * moves each stroke a little, so the count looks kept by hand.
 */
export function buildTally(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const range = heightRange(grid, gridMask)
  if (!range) return null
  const [lo, hi] = range
  const C = Math.max(3, (o.cell ?? 24) / scl)
  const maxN = Math.max(1, Math.min(40, Math.round(o.max ?? 10)))
  const jitter = Math.max(0, o.jitter ?? 0.3)
  const gates = Math.ceil(maxN / 5), gRows = Math.ceil(gates / 2)
  const rowH = (C * 0.8) / gRows, markH = rowH * 0.72, gateW = C * 0.37, gap = gateW / 4.4
  const rng = mulberry32(Math.round(o.seed ?? 1))
  const ink = writer()
  let marks = 0
  for (let r0 = 0; r0 + C <= rows - 1 + 1e-6; r0 += C) {
    for (let c0 = 0; c0 + C <= cols - 1 + 1e-6; c0 += C) {
      const cr = r0 + C / 2, cc = c0 + C / 2
      if (!gridMask[Math.round(cr) * cols + Math.round(cc)]) continue
      const v = (sampleBilinear(grid, sMask, rows, cols, cr, cc) - lo) / (hi - lo)
      const n = Math.round(Math.max(0, Math.min(1, v)) * maxN)
      for (let k = 0; k < n; k++) {
        const g = Math.floor(k / 5), m = k % 5, gr = Math.floor(g / 2), gc = g % 2
        const x0 = c0 + C * 0.1 + gc * (gateW + C * 0.06), top = r0 + C * 0.1 + gr * rowH, bot = top + markH
        const j = () => (rng() - 0.5) * jitter * gap
        if (m < 4) {
          const x = x0 + m * gap + gap * 0.5 + j()
          stroke(ink, terrain, p, sMask, [[x + gap * 0.12, top + j()], [x - gap * 0.12, bot + j()]])
        } else {
          stroke(ink, terrain, p, sMask, [[x0 - gap * 0.2, bot - markH * 0.15 + j()], [x0 + 4 * gap + gap * 0.3, top + markH * 0.2 + j()]])
        }
        marks++
      }
    }
  }
  if (!marks) return null
  return done(ink, { marks })
}

// ─── Orographic Rain ─────────────────────────────────────────────────────────

/**
 * Rain on a wind from `azimuth`, heaviest where the wind is forced uphill.
 *
 * The lift at a point is the rise of the blurred ground along the wind,
 * scaled so the 95th percentile of the rises reads as 1. Rain is a small
 * base, plus a little for height, plus `lift` times that. Behind a ridge the
 * air has already dropped its water: the rain falls by `shadow` times how far
 * the highest ground upwind stands above the point, as a share of the height
 * range. Streak sites sit on a jittered grid `spacing` raster pixels apart and
 * each keeps its streak with a chance equal to the rain. A streak is `length`
 * raster pixels long and runs downwind, the way rain falls in a wind.
 */
export function buildRain(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const range = heightRange(grid, gridMask)
  if (!range) return null
  const [lo, hi] = range
  const B = boxBlur(grid, cols, rows, 2, sMask)
  const at = (c, r) => sampleBilinear(B, sMask, rows, cols, Math.max(0, Math.min(rows - 1, r)), Math.max(0, Math.min(cols - 1, c)))
  // From the azimuth, toward the other way. East is +column, south is +row.
  const to = ((o.azimuth ?? 270) + 180) * RAD
  const wx = Math.sin(to), wy = -Math.cos(to)
  const rises = []
  for (let r = 1; r < rows - 1; r += 2) for (let c = 1; c < cols - 1; c += 2) {
    if (!gridMask[r * cols + c]) continue
    const d = at(c + wx, r + wy) - at(c - wx, r - wy)
    if (d > 0) rises.push(d)
  }
  rises.sort((a, b) => a - b)
  const p95 = rises[Math.floor(rises.length * 0.95)] || 1e-6
  const lift = Math.max(0, o.lift ?? 1), shadow = Math.max(0, o.shadow ?? 0.6)
  const reach = Math.max(rows, cols) * 0.15
  const P = Math.max(0.5, (o.spacing ?? 3) / scl), L = Math.max(0.5, (o.length ?? 6) / scl)
  const rng = mulberry32(Math.round(o.seed ?? 1))
  const ink = writer()
  let streaks = 0
  for (let rf = P / 2; rf < rows - 1; rf += P) {
    for (let cf = P / 2; cf < cols - 1; cf += P) {
      const c = cf + (rng() - 0.5) * P, r = rf + (rng() - 0.5) * P, keep = rng()
      if (c < 0 || r < 0 || c > cols - 1 || r > rows - 1 || !gridMask[Math.round(r) * cols + Math.round(c)]) continue
      const here = at(c, r)
      let up = 0
      for (let s = 2; s <= reach; s += 2) {
        const uc = c - wx * s, ur = r - wy * s
        if (uc < 0 || ur < 0 || uc > cols - 1 || ur > rows - 1) break
        up = Math.max(up, at(uc, ur) - here)
      }
      const rise = (at(c + wx, r + wy) - at(c - wx, r - wy)) / p95
      const rain = 0.06 + 0.2 * (here - lo) / (hi - lo) + 0.9 * lift * Math.max(0, rise) - shadow * 4 * up / (hi - lo)
      if (keep >= rain) continue
      drapeEdge(ink, terrain, p, sMask, c, r, c + wx * L, r + wy * L, Math.atan2(wy, wx))
      streaks++
    }
  }
  if (!streaks) return null
  return done(ink, { streaks })
}
