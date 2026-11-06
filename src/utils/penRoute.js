/**
 * The order a plotter draws in, which is not the order the exporter thought in.
 *
 * The SVG writer sorts by *depth*, which is correct for occlusion and has
 * nothing whatever to do with how far the carriage travels between strokes with
 * the pen in the air. Two numbers decide whether a plot takes twenty minutes or
 * ninety: the ink laid down, and the distance covered getting from the end of
 * one stroke to the start of the next. The first is fixed by the drawing. The
 * second is an ordering problem, and until now nobody had looked at it.
 *
 * ── What may be reordered, and what may not ──────────────────────────────────
 * Within one pen layer of *open strokes* the order is invisible on paper: the
 * strokes share a colour, a width and an opacity, and moving one to the front
 * changes nothing an eye can see. That is the whole licence this module
 * operates under, and it is narrow on purpose. Filled areas are excluded, and
 * not as a precaution — an area layer's paint order decides what covers what,
 * and reordering it puts a lake on top of the contours that should cross it.
 *
 * ── Greedy, not optimal ──────────────────────────────────────────────────────
 * This is the travelling salesman problem and nobody is going to solve it
 * exactly for forty thousand strokes. A greedy nearest-neighbour pass with each
 * stroke free to be drawn in either direction typically removes most of the
 * travel, runs in near-linear time against a spatial hash, and is deterministic
 * — which matters, because a plot has to be repeatable.
 */

/**
 * Ink laid down and distance travelled with the pen up, for a list of strokes.
 *
 * Units are whatever the strokes are in — the exporter's pixels. Converting to
 * millimetres needs the physical size of the sheet, which is a fact only the
 * person at the plotter has.
 *
 * @param {{pts: number[]}[]} runs strokes, each a flat [x0,y0,x1,y1,…]
 * @returns {{ink: number, travel: number, strokes: number}}
 */
export function routeStats(runs) {
  let ink = 0, travel = 0
  let px = null, py = null
  for (const { pts } of runs) {
    if (!pts || pts.length < 4) continue
    for (let i = 2; i < pts.length; i += 2) {
      ink += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])
    }
    if (px !== null) travel += Math.hypot(pts[0] - px, pts[1] - py)
    px = pts[pts.length - 2]
    py = pts[pts.length - 1]
  }
  return { ink, travel, strokes: runs.length }
}

/** A stroke drawn backwards. Same ink, opposite ends. */
function reversed(pts) {
  const out = new Array(pts.length)
  for (let i = 0, j = pts.length - 2; i < pts.length; i += 2, j -= 2) {
    out[i] = pts[j]
    out[i + 1] = pts[j + 1]
  }
  return out
}

/**
 * Re-order open strokes so the pen travels less between them.
 *
 * Greedy nearest neighbour over stroke *endpoints* — 2n of them for n strokes —
 * against a uniform grid sized for about one endpoint per cell. Each step takes
 * the nearest unvisited endpoint and draws that stroke from it, so a stroke
 * whose tail is closer than its head is simply drawn backwards.
 *
 * The search expands in square rings around the pen's cell and stops one ring
 * after it has a candidate, which is what makes it near-linear rather than
 * quadratic: a ring at Chebyshev distance k cannot hold anything closer than
 * (k−1)·cell, so once the best found beats that, no further ring can improve it.
 *
 * Starts at the top-left of the drawing's own bounds, which is where a plotter
 * homes, so the first pen-up is short as well as every one after it.
 *
 * @param {{pts: number[]}[]} runs
 * @returns {{pts: number[]}[]} the same strokes, re-ordered and some reversed
 */
export function orderRuns(runs) {
  const n = runs?.length ?? 0
  if (n < 3) return runs

  // Endpoint table: run r has head at 4r and tail at 4r+2.
  const ends = new Float64Array(4 * n)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let r = 0; r < n; r++) {
    const pts = runs[r].pts
    const ax = pts[0], ay = pts[1]
    const bx = pts[pts.length - 2], by = pts[pts.length - 1]
    ends[4 * r] = ax; ends[4 * r + 1] = ay
    ends[4 * r + 2] = bx; ends[4 * r + 3] = by
    if (ax < minX) minX = ax; if (ax > maxX) maxX = ax
    if (bx < minX) minX = bx; if (bx > maxX) maxX = bx
    if (ay < minY) minY = ay; if (ay > maxY) maxY = ay
    if (by < minY) minY = by; if (by > maxY) maxY = by
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return runs

  const w = Math.max(1e-9, maxX - minX), h = Math.max(1e-9, maxY - minY)
  // One endpoint per cell on average. Fewer cells means longer scans per ring;
  // many more means many empty rings before the first candidate.
  const cell = Math.max(1e-9, Math.sqrt((w * h) / n))
  const cols = Math.max(1, Math.min(4096, Math.ceil(w / cell) + 1))
  const rows = Math.max(1, Math.min(4096, Math.ceil(h / cell) + 1))
  const cw = w / cols, ch = h / rows
  const colOf = (x) => Math.max(0, Math.min(cols - 1, Math.floor((x - minX) / cw)))
  const rowOf = (y) => Math.max(0, Math.min(rows - 1, Math.floor((y - minY) / ch)))

  // Buckets as one flat array of endpoint ids (id = 2r + end), CSR-style: count,
  // prefix-sum, fill. Avoids n Map lookups and n small arrays.
  const counts = new Int32Array(cols * rows + 1)
  const cellOfEnd = new Int32Array(2 * n)
  for (let e = 0; e < 2 * n; e++) {
    const c = colOf(ends[2 * e]) + cols * rowOf(ends[2 * e + 1])
    cellOfEnd[e] = c
    counts[c + 1]++
  }
  for (let i = 0; i < cols * rows; i++) counts[i + 1] += counts[i]
  const starts = counts.slice()
  const items = new Int32Array(2 * n)
  const cursor = counts.slice(0, cols * rows)
  for (let e = 0; e < 2 * n; e++) items[cursor[cellOfEnd[e]]++] = e

  const used = new Uint8Array(n)
  const out = new Array(n)
  // Home position: the corner of the drawing, where the carriage starts.
  let px = minX, py = minY
  const maxRing = Math.max(cols, rows)

  for (let k = 0; k < n; k++) {
    const pc = colOf(px), pr = rowOf(py)
    let bestId = -1, bestD = Infinity
    for (let ring = 0; ring <= maxRing; ring++) {
      // Nothing in this ring or beyond can beat a candidate already closer than
      // the ring's own inner edge.
      if (bestId >= 0 && (ring - 1) * Math.min(cw, ch) > bestD) break
      const c0 = pc - ring, c1 = pc + ring, r0 = pr - ring, r1 = pr + ring
      for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
        // Only the ring's own boundary — the interior was scanned already.
        const onEdgeRow = (r === r0 || r === r1)
        for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
          if (!onEdgeRow && c !== c0 && c !== c1) continue
          const cellIdx = c + cols * r
          for (let i = starts[cellIdx]; i < starts[cellIdx + 1]; i++) {
            const id = items[i]
            const run = id >> 1
            if (used[run]) continue
            const d = Math.hypot(ends[2 * id] - px, ends[2 * id + 1] - py)
            if (d < bestD) { bestD = d; bestId = id }
          }
        }
      }
    }
    // A drawing whose endpoints all landed outside the grid cannot happen, but
    // a defensive linear sweep costs nothing against never finishing the loop.
    if (bestId < 0) {
      for (let r = 0; r < n; r++) if (!used[r]) { bestId = 2 * r; break }
      if (bestId < 0) break
    }

    const run = bestId >> 1
    const backwards = (bestId & 1) === 1
    used[run] = 1
    out[k] = backwards ? { ...runs[run], pts: reversed(runs[run].pts) } : runs[run]
    px = ends[4 * run + (backwards ? 0 : 2)]
    py = ends[4 * run + (backwards ? 1 : 3)]
  }
  return out
}

// ── Clean-up before the plot ─────────────────────────────────────────────────
//
// Three passes a plotter tool such as vpype also offers (`linesimplify`,
// `filter --min-length`, `linemerge`), done here on the strokes the exporter
// already holds. Each is off at 0, and each works inside one pen layer only, so
// no ink changes. Units are export pixels, like everything in this file.

/** Length of one stroke. */
function runLength(pts) {
  let len = 0
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])
  return len
}

/**
 * Ramer–Douglas–Peucker on each stroke: removes points that sit closer than
 * `tol` to the line through their neighbours, which a pen cannot show. The
 * ends always stay, so joins and closed loops are kept.
 */
export function simplifyRuns(runs, tol) {
  if (!(tol > 0)) return runs
  const t2 = tol * tol
  return runs.map((run) => {
    const pts = run.pts, n = pts.length >> 1
    if (n < 3) return run
    const keep = new Uint8Array(n)
    keep[0] = keep[n - 1] = 1
    const stack = [0, n - 1]
    while (stack.length) {
      const b = stack.pop(), a = stack.pop()
      const ax = pts[2 * a], ay = pts[2 * a + 1], dx = pts[2 * b] - ax, dy = pts[2 * b + 1] - ay
      const l2 = dx * dx + dy * dy
      let worst = -1, at = -1
      for (let i = a + 1; i < b; i++) {
        const px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay
        // Distance to the chord, or to its start when the chord is a point (a closed loop).
        const d2 = l2 > 0 ? (px * dy - py * dx) ** 2 / l2 : px * px + py * py
        if (d2 > worst) { worst = d2; at = i }
      }
      if (worst > t2) { keep[at] = 1; stack.push(a, at, at, b) }
    }
    const out = []
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1])
    return out.length === pts.length ? run : { ...run, pts: out }
  })
}

/** Drops strokes shorter than `minLen`. Returns { runs, dropped }. */
export function dropShortRuns(runs, minLen) {
  if (!(minLen > 0)) return { runs, dropped: 0 }
  const kept = runs.filter((r) => runLength(r.pts) >= minLen)
  return { runs: kept, dropped: runs.length - kept.length }
}

/**
 * Joins each stroke to the next when the next starts within `gap` of where it
 * ends and both carry the same ink, so the pen stays down across the gap. Run
 * it after `orderRuns`, which puts near ends next to each other. Returns
 * { runs, joined }.
 */
export function bridgeRuns(runs, gap) {
  if (!(gap > 0) || runs.length < 2) return { runs, joined: 0 }
  const out = []
  let cur = null, joined = 0
  for (const run of runs) {
    const pts = run.pts
    if (cur && cur.stroke === run.stroke &&
        Math.hypot(pts[0] - cur.pts[cur.pts.length - 2], pts[1] - cur.pts[cur.pts.length - 1]) <= gap) {
      for (let i = 0; i < pts.length; i++) cur.pts.push(pts[i])
      joined++
    } else {
      if (cur) out.push(cur)
      cur = { ...run, pts: Array.from(pts) }
    }
  }
  if (cur) out.push(cur)
  return { runs: out, joined }
}

/**
 * Enters each closed stroke at its vertex nearest the pen, after `orderRuns`.
 *
 * A closed contour has no ends, but it is written from wherever the builder
 * started it, so the router can only reach it at that one seam. Rotated to
 * start where the pen already is, the loop costs no travel to enter, and the
 * pen leaves it from the same point. The ink is the same loop. A stroke is
 * closed when its ends lie within `eps`. Run before `bridgeRuns`.
 */
export function reloopRuns(runs, eps) {
  if (!runs?.length) return runs
  let px = null, py = null
  return runs.map((run) => {
    let pts = run.pts
    const n = pts.length >> 1
    if (px !== null && n >= 4 &&
        Math.hypot(pts[0] - pts[2 * n - 2], pts[1] - pts[2 * n - 1]) <= eps) {
      let best = 0, bestD = Infinity
      for (let i = 0; i < n - 1; i++) {
        const d = Math.hypot(pts[2 * i] - px, pts[2 * i + 1] - py)
        if (d < bestD) { bestD = d; best = i }
      }
      if (best > 0) {
        const out = []
        for (let k = 0; k < n - 1; k++) {
          const i = (best + k) % (n - 1)
          out.push(pts[2 * i], pts[2 * i + 1])
        }
        out.push(pts[2 * best], pts[2 * best + 1])
        pts = out
        run = { ...run, pts }
      }
    }
    px = pts[pts.length - 2]
    py = pts[pts.length - 1]
    return run
  })
}

/**
 * Removes ink that an earlier stroke of the same layer already laid down.
 *
 * Adjacent areas trace their shared border twice, and a pen drawing it twice
 * wets the paper and wastes the time. Each stroke is sampled every `tol / 2`.
 * A sample is covered when a kept sample of an earlier stroke lies within `tol`
 * and runs within about 25° of the same direction, so a line that crosses
 * another is not cut where it crosses. A stroke is never tested against
 * itself, so a loop keeps its close.
 *
 * Samples within `tol` of a stroke's ends never count, so pieces that meet end
 * to end are not cut at the joint. A covered stretch inside a stroke is cut
 * only when it is at least `minCut` long, because each cut costs a pen lift;
 * one at either end always goes. Pieces left shorter than `tol` are dropped.
 * Returns { runs, removed }, the ink removed.
 */
export function dedupeRuns(runs, tol, minCut = tol) {
  if (!(tol > 0) || !runs?.length) return { runs, removed: 0 }
  const spacing = tol / 2, t2 = tol * tol
  const PARALLEL = 0.9
  // Kept samples as x, y and a unit direction, in cells of `tol`.
  const grid = new Map()
  const cellKey = (cx, cy) => cx * 73856093 ^ cy * 19349663
  const covered = (x, y, ux, uy) => {
    const cx = Math.floor(x / tol), cy = Math.floor(y / tol)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const cell = grid.get(cellKey(cx + dx, cy + dy))
      if (!cell) continue
      for (let i = 0; i < cell.length; i += 4) {
        const ex = cell[i] - x, ey = cell[i + 1] - y
        if (ex * ex + ey * ey < t2 && Math.abs(cell[i + 2] * ux + cell[i + 3] * uy) > PARALLEL) return true
      }
    }
    return false
  }
  const out = []
  for (const run of runs) {
    const pts = run.pts
    const total = runLength(pts)
    // Samples as x, y, arc, vertex (1) or between vertices (0), direction.
    const sm = []
    let arc = 0
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1]
      const len = Math.hypot(bx - ax, by - ay)
      const ux = len > 0 ? (bx - ax) / len : 0, uy = len > 0 ? (by - ay) / len : 0
      if (i === 2) sm.push(ax, ay, 0, 1, ux, uy)
      const k = Math.max(1, Math.ceil(len / spacing))
      for (let j = 1; j <= k; j++) {
        const u = j / k
        sm.push(ax + (bx - ax) * u, ay + (by - ay) * u, arc + len * u, j === k ? 1 : 0, ux, uy)
      }
      arc += len
    }
    const n = sm.length / 6
    if (n < 2) { out.push(run); continue }
    const inner = new Uint8Array(n), hit = new Uint8Array(n)
    for (let s = 0; s < n; s++) {
      const at = sm[6 * s + 2]
      inner[s] = at >= tol && total - at >= tol ? 1 : 0
      if (inner[s]) hit[s] = covered(sm[6 * s], sm[6 * s + 1], sm[6 * s + 4], sm[6 * s + 5]) ? 1 : 0
    }
    // A short covered stretch inside the stroke is drawn after all.
    for (let s = 0; s < n;) {
      if (!hit[s]) { s++; continue }
      let e = s
      while (e + 1 < n && hit[e + 1]) e++
      let atStart = true, atEnd = true
      for (let q = 0; q < s; q++) if (inner[q]) { atStart = false; break }
      for (let q = e + 1; q < n; q++) if (inner[q]) { atEnd = false; break }
      if (!atStart && !atEnd && sm[6 * e + 2] - sm[6 * s + 2] < minCut) for (let q = s; q <= e; q++) hit[q] = 0
      s = e + 1
    }
    const kept = []
    let first = -1, piece = null
    const close = (last) => {
      if (sm[6 * last + 2] - sm[6 * first + 2] >= tol) {
        const m = piece.length
        if (piece[m - 2] !== sm[6 * last] || piece[m - 1] !== sm[6 * last + 1]) piece.push(sm[6 * last], sm[6 * last + 1])
        out.push({ ...run, pts: piece })
      }
      first = -1; piece = null
    }
    for (let s = 0; s < n; s++) {
      const o = 6 * s
      if (hit[s]) { if (piece) close(s - 1); continue }
      if (inner[s]) kept.push(sm[o], sm[o + 1], sm[o + 4], sm[o + 5])
      if (!piece) { first = s; piece = [sm[o], sm[o + 1]] } else if (sm[o + 3]) piece.push(sm[o], sm[o + 1])
    }
    if (piece) close(n - 1)
    for (let i = 0; i < kept.length; i += 4) {
      const k = cellKey(Math.floor(kept[i] / tol), Math.floor(kept[i + 1] / tol))
      const cell = grid.get(k)
      if (cell) cell.push(kept[i], kept[i + 1], kept[i + 2], kept[i + 3])
      else grid.set(k, [kept[i], kept[i + 1], kept[i + 2], kept[i + 3]])
    }
  }
  const before = runs.reduce((a, r) => a + runLength(r.pts), 0)
  const after = out.reduce((a, r) => a + runLength(r.pts), 0)
  return { runs: out, removed: Math.max(0, before - after) }
}

/**
 * Each stroke drawn `passes` times, back and forth with the pen down, for an
 * ink too light to cover in one pass. The pen turns at each end, so the extra
 * passes cost no lifts.
 */
export function multipassRuns(runs, passes) {
  const n = Math.max(1, Math.round(passes ?? 1))
  if (n === 1) return runs
  return runs.map((run) => {
    const back = reversed(run.pts)
    const out = run.pts.slice()
    for (let p = 1; p < n; p++) {
      const next = p % 2 ? back : run.pts
      for (let i = 2; i < next.length; i++) out.push(next[i])
    }
    return { ...run, pts: out }
  })
}

/** The share of the ink above which short strokes are the drawing, not strays. */
const SHORT_INK = 0.02

const step = (v, s, lo, hi) => Math.min(hi, Math.max(lo, Number((Math.round(v / s) * s).toFixed(2))))

/**
 * Clean-up values for a pen of `penMm` tip width, from what a pen can show.
 *
 * Simplify: a sixth of the tip, well inside the line the pen draws. Join gap:
 * half the tip. Round caps on both ends already close most of such a gap, so
 * the bridge adds almost no ink. Min length: the tip itself, since a stroke
 * shorter than the nib draws as a dot. That holds only where such strokes are
 * strays: when they carry more than SHORT_INK of the ink (`lengthsMm`, the
 * whole strokes before clean-up), they are the drawing (hachures, ticks), and
 * min length stays off. Hatch pitch: the tip, so hatch lines touch at full
 * contrast. Dedupe: half the tip, where two strokes draw as one line. Plotter
 * order goes on, because it cuts the most time. Passes are left as they are:
 * they depend on the ink, which no measurement here can see.
 */
export function recommendPlot({ penMm = 0.3, lengthsMm = [] } = {}) {
  const pen = Math.min(3, Math.max(0.05, penMm))
  const ink = lengthsMm.reduce((a, l) => a + l, 0)
  const short = ink > 0 ? lengthsMm.reduce((a, l) => a + (l < pen ? l : 0), 0) / ink : 0
  return {
    plotPenOrder: true,
    plotSimplifyMm: step(pen / 6, 0.01, 0.01, 0.5),
    plotJoinGapMm: step(pen / 2, 0.05, 0.05, 2),
    plotMinLengthMm: short > SHORT_INK ? 0 : step(pen, 0.05, 0.05, 5),
    plotDedupeMm: step(pen / 2, 0.05, 0.05, 1),
    plotHatchPitch: step(pen, 0.05, 0.2, 5),
  }
}

/**
 * The plot with no clean-up: the strokes in the order and shape the plate
 * draws them, each drawn once. Filled areas and the hatch are left as they
 * are, because they are a choice of fill, not a clean-up.
 */
export const AS_DRAWN = Object.freeze({
  plotPenOrder: false,
  plotSimplifyMm: 0,
  plotJoinGapMm: 0,
  plotMinLengthMm: 0,
  plotDedupeMm: 0,
  plotPasses: 1,
})

/**
 * How long a plot takes, given the one fact only the operator has.
 *
 * The drawing is in export pixels, and the Sheet width says what they are on
 * paper: the SVG page is that wide in millimetres. So the sheet's physical
 * width is asked for rather than guessed, and everything here is arithmetic
 * on top of it.
 *
 * The speeds are an AxiDraw at its ordinary settings and are stated in the panel
 * beside the answer, because a pen that moves at half of this takes twice as
 * long and the number would otherwise look like a measurement.
 *
 * @param {object} o
 * @param {number} o.ink        pen-down distance, in export pixels
 * @param {number} o.travel     pen-up distance, in export pixels
 * @param {number} o.widthPx    the drawing's width in those pixels
 * @param {number} o.widthMm    what that width is on paper
 * @param {number} o.strokes    how many separate strokes, for the lift cost
 * @param {number} o.penChanges how many times the pen has to be swapped
 * @returns {{inkMm:number, travelMm:number, minutes:number}|null}
 */
export function plotEstimate({ ink, travel, widthPx, widthMm, strokes = 0, penChanges = 0,
  downSpeed = 120, upSpeed = 250, liftSeconds = 0.3, changeSeconds = 30 }) {
  if (!(widthPx > 0) || !(widthMm > 0)) return null
  const mmPerPx = widthMm / widthPx
  const inkMm = ink * mmPerPx
  const travelMm = travel * mmPerPx
  // A lift and a drop per stroke is the fixed cost the two distances miss, and
  // on a stipple field of forty thousand dots it is most of the plot: forty
  // thousand pen movements at a third of a second each is three and a half
  // hours in which the carriage has travelled almost nowhere.
  const seconds = inkMm / downSpeed + travelMm / upSpeed
    + strokes * liftSeconds + penChanges * changeSeconds
  return { inkMm, travelMm, minutes: seconds / 60 }
}
