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

/**
 * How long a plot takes, given the one fact only the operator has.
 *
 * The exporter writes pixels, not millimetres — deliberately, and it is the same
 * omission that stops the sheet printing a 1:25 000 ratio. So the sheet's
 * physical width is asked for rather than guessed, and everything here is
 * arithmetic on top of it.
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
