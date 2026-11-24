/**
 * Line decorations for vector layers, in raster pixel space.
 *
 * A survey sheet draws more than one stroke along a line. A cased road is two
 * edges. A boundary carries a band on its inside. A railway carries cross ties,
 * a cliff carries teeth on its drop side, and a one-way stream carries arrows.
 * Everything here makes those strokes as plain polylines in the raster's pixel
 * grid, before the drape. The worker then drapes them like any other line, so
 * occlusion, the pen layers and the plot clean-up treat them as ordinary ink.
 *
 * ── Sides ────────────────────────────────────────────────────────────────────
 * Pixel rows grow downward, so the left of a direction (dx, dy) is (dy, −dx).
 * OpenStreetMap draws a cliff with the drop on the right of the way, which is
 * what `right` means here. An area is turned clockwise on screen first, with its
 * holes the other way, so `right` is always the inside of the area.
 */

/** Drops repeated points, which have no direction. Returns the point count. */
function dedupe(pts, n, out) {
  let w = 0
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1]
    if (w && Math.abs(x - out[(w - 1) * 2]) < 1e-9 && Math.abs(y - out[(w - 1) * 2 + 1]) < 1e-9) continue
    out[w * 2] = x; out[w * 2 + 1] = y
    w++
  }
  return w
}

/**
 * Twice the signed area of a ring, in pixel space. Positive is clockwise on
 * screen, because rows grow downward.
 */
export function ringArea2(pts, n) {
  let s = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1]
  }
  return s
}

/** Is (x, y) inside the ring, by the even-odd rule? */
export function pointInRing(x, y, pts, n) {
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1], xj = pts[j * 2], yj = pts[j * 2 + 1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A copy of a ring, reversed. */
export function reversed(pts, n) {
  const out = new Float64Array(n * 2)
  for (let i = 0; i < n; i++) {
    out[i * 2] = pts[(n - 1 - i) * 2]
    out[i * 2 + 1] = pts[(n - 1 - i) * 2 + 1]
  }
  return out
}

/**
 * The rings of one area, each turned so that its right side is the area.
 *
 * A ring is a hole when an odd number of the other rings contain it. Outer
 * rings run clockwise on screen and holes run the other way.
 *
 * @param {Float64Array[]} rings flat [x, y, …] rings
 * @returns {Float64Array[]}
 */
export function orientRings(rings) {
  return rings.map((r, i) => {
    const n = r.length / 2
    if (n < 3) return r
    let depth = 0
    for (let j = 0; j < rings.length; j++) {
      if (j !== i && rings[j].length >= 6 && pointInRing(r[0], r[1], rings[j], rings[j].length / 2)) depth++
    }
    const wantCw = depth % 2 === 0
    const cw = ringArea2(r, n) > 0
    return cw === wantCw ? r : reversed(r, n)
  })
}

/**
 * A polyline moved sideways by `d` pixels, to the left for d > 0.
 *
 * Joins are mitred. A mitre longer than `miterLimit` times the offset is cut
 * to a bevel, which is what keeps a sharp turn from shooting a spike out.
 *
 * @returns {Float64Array} flat [x, y, …]; for a closed line, the first point is
 *   repeated at the end.
 */
export function offsetPolyline(pts, n, closed, d, miterLimit = 2) {
  const p = new Float64Array(n * 2)
  let m = dedupe(pts, n, p)
  if (closed && m > 2 && Math.abs(p[0] - p[(m - 1) * 2]) < 1e-9 && Math.abs(p[1] - p[(m - 1) * 2 + 1]) < 1e-9) m--
  if (m < 2) return new Float64Array(0)

  const segs = closed ? m : m - 1
  // Unit left normal of each segment.
  const nx = new Float64Array(segs), ny = new Float64Array(segs)
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % m
    const dx = p[j * 2] - p[i * 2], dy = p[j * 2 + 1] - p[i * 2 + 1]
    const len = Math.hypot(dx, dy) || 1
    nx[i] = dy / len; ny[i] = -dx / len
  }

  const out = []
  const limit = Math.abs(d) * miterLimit
  for (let i = 0; i < m; i++) {
    const x = p[i * 2], y = p[i * 2 + 1]
    const hasIn = closed || i > 0
    const hasOut = closed || i < m - 1
    const a = hasIn ? (i - 1 + segs) % segs : i
    const b = hasOut ? i % segs : a
    if (!hasIn || !hasOut || a === b) {
      const k = hasOut ? b : a
      out.push(x + nx[k] * d, y + ny[k] * d)
      continue
    }
    let mx = nx[a] + nx[b], my = ny[a] + ny[b]
    const ml = Math.hypot(mx, my)
    if (ml < 1e-9) {
      // A full turn back: no mitre exists, so bevel.
      out.push(x + nx[a] * d, y + ny[a] * d, x + nx[b] * d, y + ny[b] * d)
      continue
    }
    mx /= ml; my /= ml
    const cos = mx * nx[a] + my * ny[a]
    const len = d / Math.max(cos, 1e-9)
    if (Math.abs(len) > limit) {
      out.push(x + nx[a] * d, y + ny[a] * d, x + nx[b] * d, y + ny[b] * d)
    } else {
      out.push(x + mx * len, y + my * len)
    }
  }
  if (closed) out.push(out[0], out[1])
  return Float64Array.from(out)
}

/**
 * Stations along a polyline every `spacing` pixels, with the direction there.
 *
 * The first station sits half a spacing from the start, so a short line still
 * gets one in its middle, and a long one is not marked at its very ends.
 *
 * @returns {{x: number, y: number, tx: number, ty: number}[]}
 */
export function stationsAlong(pts, n, closed, spacing) {
  const out = []
  if (!(spacing > 0) || n < 2) return out
  const edges = closed ? n : n - 1
  let total = 0
  for (let i = 0; i < edges; i++) {
    const j = (i + 1) % n
    total += Math.hypot(pts[j * 2] - pts[i * 2], pts[j * 2 + 1] - pts[i * 2 + 1])
  }
  if (!(total > 0)) return out
  // Never more stations than the line can hold at one per pixel.
  const step = Math.max(spacing, total / 100_000)
  let next = Math.min(step / 2, total / 2)
  let run = 0
  for (let i = 0; i < edges; i++) {
    const j = (i + 1) % n
    const x0 = pts[i * 2], y0 = pts[i * 2 + 1]
    const dx = pts[j * 2] - x0, dy = pts[j * 2 + 1] - y0
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    while (next <= run + len) {
      const t = (next - run) / len
      out.push({ x: x0 + dx * t, y: y0 + dy * t, tx: dx / len, ty: dy / len })
      next += step
    }
    run += len
  }
  return out
}

/**
 * Short strokes across a line, every `spacing` pixels.
 *
 * `side` is 'left', 'right' or 'both'. A one-sided tick starts on the line and
 * runs `length` pixels out. A two-sided tick is centred on the line.
 *
 * @returns {number[]} flat [x0, y0, x1, y1, …]
 */
export function ticksAlong(pts, n, closed, spacing, length, side = 'both') {
  const out = []
  for (const s of stationsAlong(pts, n, closed, spacing)) {
    // Left normal.
    const lx = s.ty, ly = -s.tx
    if (side === 'left') out.push(s.x, s.y, s.x + lx * length, s.y + ly * length)
    else if (side === 'right') out.push(s.x, s.y, s.x - lx * length, s.y - ly * length)
    else {
      const h = length / 2
      out.push(s.x - lx * h, s.y - ly * h, s.x + lx * h, s.y + ly * h)
    }
  }
  return out
}

/**
 * The outline of one mark in its own frame: u along the line, v to its left,
 * one unit across.
 */
const MARK_SHAPES = {
  // An arrowhead pointing along the line.
  chevron: [[-0.35, 0.5, 0.35, 0, -0.35, -0.5]],
  // A tooth standing on the line, pointing to the side; `side` flips it.
  triangle: [[-0.5, 0, 0, 1, 0.5, 0]],
  circle: [Array.from({ length: 13 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2
    return [Math.cos(a) * 0.5, Math.sin(a) * 0.5]
  }).flat()],
  cross: [[-0.5, -0.5, 0.5, 0.5], [-0.5, 0.5, 0.5, -0.5]],
  // A stroke across the line, as a railway's tie.
  bar: [[0, -0.5, 0, 0.5]],
}

export const MARK_KINDS = Object.keys(MARK_SHAPES)

/**
 * A mark repeated along a line, every `spacing` pixels, `size` pixels across.
 *
 * With `fixed`, every mark keeps the sheet's own orientation instead of
 * turning with the line. `side` puts a one-sided mark, the tooth, on the left
 * or the right.
 *
 * @returns {Float64Array[]} polylines, flat [x, y, …]
 */
export function marksAlong(pts, n, closed, spacing, size, kind, { fixed = false, side = 'right' } = {}) {
  const shape = MARK_SHAPES[kind]
  if (!shape) return []
  const flip = side === 'left' ? 1 : -1
  const out = []
  for (const s of stationsAlong(pts, n, closed, spacing)) {
    const tx = fixed ? 1 : s.tx, ty = fixed ? 0 : s.ty
    const lx = ty, ly = -tx
    for (const poly of shape) {
      const line = new Float64Array(poly.length)
      for (let i = 0; i < poly.length; i += 2) {
        const u = poly[i] * size
        const v = poly[i + 1] * size * (kind === 'triangle' ? flip : 1)
        line[i] = s.x + tx * u + lx * v
        line[i + 1] = s.y + ty * u + ly * v
      }
      out.push(line)
    }
  }
  return out
}
