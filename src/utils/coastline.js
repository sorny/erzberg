/**
 * The sea, from OpenStreetMap's coastline.
 *
 * OpenStreetMap has no sea polygons. It draws the coastline as ways with the
 * land on their left and the water on their right, and leaves the sea to be
 * worked out. Inside one extent that is a clip and a walk:
 *
 *  1. Join the ways end to start into chains.
 *  2. A chain that closes inside the extent is an island, a hole in the sea.
 *  3. A chain that crosses the extent is cut into pieces that enter and leave
 *     through its edge. From where one piece leaves, walk the edge clockwise to
 *     where the next one enters, and so on until the ring closes. With the water
 *     on the right of every piece, a clockwise ring encloses the water.
 *
 * An extent that the coastline never crosses but that holds islands is taken
 * as open sea round them. One with no coastline at all is left alone: nothing
 * says whether it is land or water.
 *
 * Everything here is in longitude and latitude, y up.
 */

const EPS = 1e-12

/** Joins open chains whose ends meet. Returns `{ closed, open }`. */
export function joinChains(ways) {
  const open = ways.filter((w) => w.length >= 4).map((w) => Array.from(w))
  const closed = []
  const same = (a, ai, b, bi) => Math.abs(a[ai] - b[bi]) < 1e-9 && Math.abs(a[ai + 1] - b[bi + 1]) < 1e-9
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < open.length && !merged; i++) {
      const a = open[i]
      for (let j = 0; j < open.length; j++) {
        if (i === j) continue
        const b = open[j]
        if (same(a, a.length - 2, b, 0)) {
          open[i] = a.concat(b.slice(2))
          open.splice(j, 1)
          merged = true
          break
        }
      }
    }
  }
  const rest = []
  for (const c of open) {
    if (c.length >= 8 && same(c, 0, c, c.length - 2)) closed.push(c)
    else rest.push(c)
  }
  return { closed, open: rest }
}

/** Position along the extent's edge, clockwise from the north-west corner. */
function edgeT([w, s, e, n], x, y) {
  const W = e - w, H = n - s
  const d = [Math.abs(y - n), Math.abs(x - e), Math.abs(y - s), Math.abs(x - w)]
  const k = d.indexOf(Math.min(...d))
  if (k === 0) return x - w
  if (k === 1) return W + (n - y)
  if (k === 2) return W + H + (e - x)
  return 2 * W + H + (y - s)
}

/** The point at edge position t. */
function edgePoint([w, s, e, n], t) {
  const W = e - w, H = n - s, P = 2 * (W + H)
  t = ((t % P) + P) % P
  if (t <= W) return [w + t, n]
  if (t <= W + H) return [e, n - (t - W)]
  if (t <= 2 * W + H) return [e - (t - W - H), s]
  return [w, s + (t - 2 * W - H)]
}

const inside = ([w, s, e, n], x, y) => x >= w - EPS && x <= e + EPS && y >= s - EPS && y <= n + EPS

/** Clips one segment to the box; returns [t0, t1] along it, or null. */
function clipSegment(box, x0, y0, x1, y1) {
  const [w, s, e, n] = box
  let t0 = 0, t1 = 1
  const dx = x1 - x0, dy = y1 - y0
  for (const [p, q] of [[-dx, x0 - w], [dx, e - x0], [-dy, y0 - s], [dy, n - y0]]) {
    if (Math.abs(p) < EPS) { if (q < 0) return null; continue }
    const r = q / p
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r }
    else { if (r < t0) return null; if (r < t1) t1 = r }
  }
  return [t0, t1]
}

/**
 * The pieces of an open chain inside the box, each `{ pts, t0, t1 }` with the
 * edge positions where it enters and leaves. A piece that starts or ends inside
 * the box (a coastline cut short by the data) is carried straight to the
 * nearest edge.
 */
function piecesOf(chain, box) {
  const out = []
  let cur = null
  const n = chain.length / 2
  for (let i = 0; i < n - 1; i++) {
    const x0 = chain[i * 2], y0 = chain[i * 2 + 1], x1 = chain[i * 2 + 2], y1 = chain[i * 2 + 3]
    const c = clipSegment(box, x0, y0, x1, y1)
    if (!c) continue
    const ax = x0 + (x1 - x0) * c[0], ay = y0 + (y1 - y0) * c[0]
    const bx = x0 + (x1 - x0) * c[1], by = y0 + (y1 - y0) * c[1]
    if (!cur) cur = { pts: [ax, ay] }
    cur.pts.push(bx, by)
    if (c[1] < 1 - 1e-9) { out.push(cur); cur = null }
  }
  if (cur) out.push(cur)
  for (const p of out) {
    p.t0 = edgeT(box, p.pts[0], p.pts[1])
    p.t1 = edgeT(box, p.pts[p.pts.length - 2], p.pts[p.pts.length - 1])
    // Carried to the edge, when the piece stops short of it.
    const a = edgePoint(box, p.t0), b = edgePoint(box, p.t1)
    if (Math.hypot(a[0] - p.pts[0], a[1] - p.pts[1]) > EPS) p.pts.unshift(a[0], a[1])
    const L = p.pts.length
    if (Math.hypot(b[0] - p.pts[L - 2], b[1] - p.pts[L - 1]) > EPS) p.pts.push(b[0], b[1])
  }
  return out
}

/**
 * Sea rings over `box` ([west, south, east, north]) from coastline ways (flat
 * [lon, lat, …] arrays). Returns flat rings: the water outlines first, then the
 * islands inside the box, for an even-odd fill.
 */
export function seaRings(ways, box) {
  const { closed, open } = joinChains(ways)
  const islands = closed.filter((c) => {
    for (let i = 0; i < c.length; i += 2) if (inside(box, c[i], c[i + 1])) return true
    return false
  })
  const pieces = open.flatMap((c) => piecesOf(c, box)).filter((p) => p.pts.length >= 4)
  const rings = []
  const [w, s, e, n] = box
  const P = 2 * ((e - w) + (n - s))
  if (!pieces.length) {
    if (!islands.length) return []
    rings.push([w, n, e, n, e, s, w, s, w, n])
    return rings.concat(islands)
  }
  const used = new Set()
  for (const start of pieces) {
    if (used.has(start)) continue
    const ring = []
    let p = start
    for (let guard = 0; guard <= pieces.length; guard++) {
      used.add(p)
      ring.push(...p.pts)
      // The next entry clockwise from where this piece leaves.
      let best = null, gap = Infinity
      for (const q of pieces) {
        if (used.has(q) && q !== start) continue
        const d = (((q.t0 - p.t1) % P) + P) % P
        if (d < gap - EPS || (q === start && d <= gap + EPS)) { gap = d; best = q }
      }
      if (!best) break
      // The corners passed on the way.
      const corners = [[e - w, [e, n]], [(e - w) + (n - s), [e, s]], [2 * (e - w) + (n - s), [w, s]], [P, [w, n]]]
      const cornerList = []
      for (const [ct, pt] of corners) {
        const d = (((ct - p.t1) % P) + P) % P
        if (d > EPS && d < gap - EPS) cornerList.push([d, pt])
      }
      cornerList.sort((a, b) => a[0] - b[0])
      for (const [, pt] of cornerList) ring.push(pt[0], pt[1])
      if (best === start) break
      p = best
    }
    ring.push(ring[0], ring[1])
    rings.push(ring)
  }
  return rings.concat(islands)
}
