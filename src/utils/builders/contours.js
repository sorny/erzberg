/**
 * Contours: marching squares, chaining, smoothing, Tanaka, labels.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { computeVertexColor } from '../colorUtils'
import { EMPTY_F32, EMPTY_F64, EMPTY_U8, F32List, F64List, I32List, MARCHING_TABLE, SMOOTH_SIMPLIFY_EPS, _edgeId, _edgeX, _edgeY, chaikinSmoothFlat, chainLevelSegments, edgeLerp01, getChainScratch, inElevCut, normElev, simplifyFlat } from './shared.js'

// Given one contour level's chains (grid coords), returns flat world-space segments
// [x0,y,z0, x1,y,z1, ...] that bridge open chain endpoints sitting on the grid
// border — walking the border between them and inserting any corners — so the level
// closes into rings. Only the bridges are returned; the chains themselves are
// emitted (and optionally smoothed) by the caller, so smoothing and ring-closing
// compose cleanly.
function borderCloseSegments(chains, rows, cols, scl, halfW, halfH, elev) {
  const toWorld = (c, r) => [c * scl - halfW, r * scl - halfH]
  const result = []

  // Collect open border endpoints
  // Clockwise border position in [0, 4): top=0..1, right=1..2, bottom=2..3, left=3..4
  const EPS = 1e-9
  const onBorder = (c, r) => c <= EPS || r <= EPS || c >= cols - 1 - EPS || r >= rows - 1 - EPS
  const borderPos = (c, r) => {
    if (r <= EPS)            return c / (cols - 1)
    if (c >= cols - 1 - EPS) return 1 + r / (rows - 1)
    if (r >= rows - 1 - EPS) return 2 + (1 - c / (cols - 1))
    return                          3 + (1 - r / (rows - 1))
  }

  const bpts = []
  for (const chain of chains) {
    if (chain.closed) continue // already a ring
    const pts = chain.pts, last = pts.length - 2
    const hc = pts[0], hr = pts[1], tc = pts[last], tr = pts[last + 1]
    if (onBorder(hc, hr)) bpts.push({ c: hc, r: hr, pos: borderPos(hc, hr) })
    if (onBorder(tc, tr)) bpts.push({ c: tc, r: tr, pos: borderPos(tc, tr) })
  }

  if (bpts.length < 2 || bpts.length % 2 !== 0) return result
  bpts.sort((a, b) => a.pos - b.pos)

  // Grid corners in clockwise order
  const corners = [
    { c: 0,        r: 0,        pos: 0 },
    { c: cols - 1, r: 0,        pos: 1 },
    { c: cols - 1, r: rows - 1, pos: 2 },
    { c: 0,        r: rows - 1, pos: 3 },
  ]

  // Walk border clockwise from p0 to p1, inserting any corners in between
  const traceBorder = (p0, p1) => {
    const pts = [{ c: p0.c, r: p0.r }]
    const inRange = pos => p0.pos < p1.pos
      ? pos > p0.pos + EPS && pos < p1.pos - EPS
      : pos > p0.pos + EPS || pos  < p1.pos - EPS
    const dist = pos => (pos - p0.pos + 4) % 4
    corners
      .filter(corner => inRange(corner.pos))
      .sort((a, b) => dist(a.pos) - dist(b.pos))
      .forEach(corner => pts.push({ c: corner.c, r: corner.r }))
    pts.push({ c: p1.c, r: p1.r })
    return pts
  }

  // Pair consecutive border endpoints and emit border segments
  for (let i = 0; i < bpts.length; i += 2) {
    const pts = traceBorder(bpts[i], bpts[i + 1])
    for (let j = 0; j < pts.length - 1; j++) {
      const [x0, z0] = toWorld(pts[j].c,   pts[j].r)
      const [x1, z1] = toWorld(pts[j+1].c, pts[j+1].r)
      result.push(x0, elev, z0, x1, elev, z1)
    }
  }

  return result
}

// Per-level metadata shared by buildContours / buildContoursTanaka. levelVal is
// the marching-squares threshold in brightness (grid) space; it increases
// linearly with the level index, which is what lets the cell-major pass map a
// cell's value range straight to a level-index range.
function prepareContourLevels(terrain, p, interval) {
  const { minElev, maxElev } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const step = (interval ?? 4)

  // elevScale reaches exactly 0 in one drag (it is baseElevScale plus a signed
  // offset whose slider steps by 0.1), and the terrain is then a flat plane with
  // no contours to draw. Return that answer deliberately: falling through would
  // divide by zero into levelVal = 0/0 = NaN and lvlStep = Infinity, which makes
  // the caller's `for (k = kLo; k <= kHi; k++)` bound NaN and skip silently — the
  // same empty output, arrived at by accident and impossible to debug.
  // A non-positive interval is the same kind of answer: the ladder below would
  // be an infinite number of levels, which is an allocation, not a drawing.
  if (!elevScale || !(step > 0)) {
    return { step, numSteps: 0, levelElev: EMPTY_F64, levelVal: EMPTY_F64,
             levelActive: EMPTY_U8, levelRgb: EMPTY_F32, lvlStep: 0 }
  }

  /*
   * THE LADDER IS ANCHORED TO THE TERRAIN'S FLOOR, not to the multiples of
   * `step` that happen to land in world elevation.
   *
   * World elevation is centred on zero and stretched by the exaggeration slider
   * — `minElev` is `(minBrightness − 0.5) · 100 · elevScale` — so a ladder of
   * multiples of `step` meets the ground at an offset that has nothing to do
   * with the terrain. With the usual full-range raster at exaggeration 1 the
   * ground runs −50…50, and a 30-unit interval puts its lowest line 20 units up:
   * two thirds of an interval of valley floor with no contour in it at all.
   * Change the interval, or nudge the exaggeration, and that offset jumps to
   * some other fraction of a step — so the set of lines reshuffles instead of
   * simply subdividing, and the numbers `useContourLabels` prints come out as
   * 1, 5, 9 rather than the multiples of the interval it promises.
   *
   * Anchored at `minElev`: the bottom band is always exactly one interval thick,
   * the levels are the same terrain-relative set at any exaggeration, and the
   * labels read 0 at the floor and climb by the slider's own number.
   *
   * Level 0 sits *on* the floor. On solid ground it draws nothing — every corner
   * is at or above it — because it is the datum the rest are counted from rather
   * than a line; where the raster has NoData it draws the shoreline, the ground
   * meeting the hole at its lowest.
   */
  const startElev = minElev
  // The +1e-9 is for the top: a range that is an exact whole number of steps
  // must not lose its last level to a division landing at 24.999999997.
  const numSteps = Math.floor((maxElev - minElev) / step + 1e-9) + 1

  const levelElev = new Float64Array(numSteps)
  const levelVal = new Float64Array(numSteps)
  const levelActive = new Uint8Array(numSteps)
  const levelRgb = new Float32Array(numSteps * 3)
  for (let i = 0; i < numSteps; i++) {
    const elev = startElev + i * step
    // The floor level is *tested* a hair below the ground it names (a millionth
    // of an interval — invisible, and far above rounding). Exactly on the floor,
    // a rounding error either way decides between "nothing to draw" and a
    // hairline traced around every cell sitting at the minimum, which is the one
    // place a large flat area — a lake bed, a quarry floor — is likely to be.
    const testElev = i === 0 ? elev - step * 1e-6 : elev
    levelElev[i] = elev
    levelVal[i] = testElev / (100 * elevScale) + 0.5
    levelActive[i] = inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut) ? 1 : 0
    const col = computeVertexColor(normElev(elev, minElev, maxElev), 0, 0, p)
    levelRgb[i * 3] = col[0]; levelRgb[i * 3 + 1] = col[1]; levelRgb[i * 3 + 2] = col[2]
  }
  return { step, numSteps, levelElev, levelVal, levelActive, levelRgb, lvlStep: step / (100 * elevScale) }
}

/**
 * Where to letter a contour, and where to break it so the lettering fits.
 *
 * A topographic map does not print the elevation *beside* the line, it prints it
 * *in* the line: the contour stops, the number sits in the gap at the line's own
 * angle, and the contour resumes. That is what makes a sheet of nested curves
 * readable, and it is the one thing this app's contours have never done.
 *
 * Runs on the chained polyline, in grid units, and returns placements only.
 * What gets erased for them is the caller's job, and is decided against every
 * chain at the level rather than only this one — see the two passes there.
 *
 * Placement is by arclength rather than by vertex, so it does not bunch where
 * marching squares happened to emit points close together, and each candidate is
 * nudged to the straightest spot in a window around it. Straightness matters
 * because the label is set on a single baseline: on a hairpin the text would
 * float off the line it belongs to, and a reader would have to guess which curve
 * it names.
 *
 * `gap` is the room to reserve. It is an estimate — the true width is a property
 * of the font, which lives on the main thread — so it is deliberately generous:
 * a gap slightly too wide reads as air, one slightly too narrow has the contour
 * touching the digits.
 */
function placeContourLabels(pts, closed, spacing, gap) {
  const np = pts.length / 2
  if (np < 3) return null

  // Arclength at each vertex.
  const cum = new Float64Array(np)
  for (let i = 1; i < np; i++) {
    const dx = pts[i * 2] - pts[i * 2 - 2], dy = pts[i * 2 + 1] - pts[i * 2 - 1]
    cum[i] = cum[i - 1] + Math.hypot(dx, dy)
  }
  const total = cum[np - 1]
  // No room for even one label with a margin of its own width either side.
  if (total < gap * 3) return null

  /** The point and tangent at arclength `s`, by walking the cumulative table. */
  const at = (s) => {
    let lo = 0, hi = np - 1
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid }
    const seg = cum[hi] - cum[lo]
    const t = seg > 1e-9 ? (s - cum[lo]) / seg : 0
    return [pts[lo * 2] + (pts[hi * 2] - pts[lo * 2]) * t,
            pts[lo * 2 + 1] + (pts[hi * 2 + 1] - pts[lo * 2 + 1]) * t]
  }

  // How far the curve strays from the chord across the label's own span. Zero on
  // a straight stretch; large on a hairpin, where the baseline would leave the line.
  const bend = (s) => {
    const a = at(s - gap / 2), b = at(s + gap / 2)
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return Infinity
    let worst = 0
    for (let k = 1; k < 6; k++) {
      const m = at(s - gap / 2 + (gap * k) / 6)
      // Perpendicular distance from the chord.
      const d = Math.abs((m[0] - a[0]) * dy - (m[1] - a[1]) * dx) / len
      if (d > worst) worst = d
    }
    // Penalise a chord shorter than the text as well: that is a curve doubling
    // back, where the label would overhang both ends.
    return worst + Math.max(0, gap - len)
  }

  const anchors = []
  const first = closed ? gap : Math.max(gap, (total % spacing) / 2 + gap / 2)
  for (let s = first; s <= total - gap; s += spacing) {
    // Nudge to the straightest spot within a third of the spacing.
    let best = s, bestBend = bend(s)
    const win = Math.min(spacing / 3, total / 4)
    for (let d = -win; d <= win; d += win / 4) {
      const cand = s + d
      if (cand - gap / 2 < 0 || cand + gap / 2 > total) continue
      const b = bend(cand)
      if (b < bestBend) { bestBend = b; best = cand }
    }
    // Still bent past half the text height at its best: this stretch cannot hold
    // a straight baseline, so leave the contour unbroken rather than mislabel it.
    if (bestBend > gap * 0.25) continue

    const a = at(best - gap / 2), b = at(best + gap / 2), m = at(best)
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    // Upright rule: keep the text running left-to-right in +x. The scene orbits,
    // so no camera-relative rule would hold; this is the same convention a
    // north-up sheet uses.
    if (b[0] < a[0]) ang += Math.PI

    anchors.push({ c: m[0], r: m[1], angle: ang })
  }
  return anchors.length ? anchors : null
}

/**
 * Contour lines by marching squares, in one pass over the grid.
 *
 * The scan is cell-major, not level-major: each cell is visited once and emits
 * segments for whichever levels cross it, so the cost is O(cells + segments)
 * rather than O(levels × cells). At a 1-unit interval over a 1024² grid the
 * difference is two orders of magnitude.
 *
 * What happens after the scan depends on the options, and only the extra work is
 * paid for:
 *  - Plain contours ship the loose segments straight out.
 *  - **Close rings** and **smoothing** both need the segments chained into
 *    polylines first, so they share `chainLevelSegments` — which joins them by
 *    integer grid-edge identity rather than by coordinate, the rewrite that took
 *    close-contours from 312 ms to 37 ms.
 *  - Smoothing is Chaikin corner-cutting with Douglas–Peucker decimation between
 *    passes, because each pass doubles the point count and almost all of the new
 *    points sit under a pixel from the chord through their neighbours.
 *  - Closing runs *after* smoothing, so border-bridging segments stay straight
 *    against the frame instead of being rounded away from it.
 *
 * Minor and major levels are separated into two layers here rather than being
 * restyled downstream, because they differ in geometry weight, not just colour.
 *
 * Tanaka (illuminated) contours are a different enough construction that they
 * live in their own builder; this is the only place that fork is expressed.
 */
export function buildContours(terrain, p, interval, majorInterval, majorOffset, closeRings, smoothing) {
  if (p.tanakaContours) return buildContoursTanaka(terrain, p, interval)
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev } = terrain
  const smooth = Math.max(0, Math.min(4, Math.round(smoothing ?? 0)))
  // Smoothing and ring-closing both need the per-level segments chained into
  // polylines first, so they share the post-scan path.
  // Labels are placed along a *stroke*, so the raw scan-order segments have to be
  // chained first — the same reason smoothing and ring-closing need it.
  const wantLabels = !!p.labelContours
  const needsChains = closeRings || smooth > 0 || wantLabels

  const minorPos = new F32List(), minorCol = new F32List()
  const majorPos = new F32List(), majorCol = new F32List()

  const { numSteps, levelElev, levelVal, levelActive, levelRgb, lvlStep } =
    prepareContourLevels(terrain, p, interval)

  // Room to reserve for the digits, in grid units. The true width belongs to the
  // font and the font lives on the main thread, so this is an estimate from the
  // character count at a generous advance — see `placeContourLabels`.
  const labelEm = (p.labelSizeContours ?? 9) / scl
  const labelSpacingGrid = Math.max(labelEm * 4, (p.labelSpacingContours ?? 140) / scl)
  const labelAnchors = wantLabels ? [] : null
  /*
   * What the label says, and how much room it needs.
   *
   * The digits are decided here only to size the gap; the main thread formats
   * the text it actually letters, because turning a level into metres needs the
   * raster's real elevation range and that never reaches the worker. Both use
   * the same rounding, so the gap matches the number that lands in it.
   */
  const levelText = (k) => String(Math.round(levelElev[k] - minElev))
  // Clearance either side of the digits, in world units like Size and Spacing.
  // Explicit rather than the fudge factor it replaces: how much air a label
  // wants is a matter of taste and of pen width, not something to hard-code.
  const labelPadGrid = Math.max(0, p.labelPadContours ?? 4) / scl
  const labelGapFor = (text) => text.length * 0.62 * labelEm + 2 * labelPadGrid
  /*
   * Half the height of the digits, plus the same clearance the sides get.
   *
   * Nominal, like the width: cap height is a property of the font, and the font
   * is on the main thread. 0.36 em is a little over half the cap height of every
   * face here, which is the right way to be wrong — the box is used to reject
   * placements, so erring tall only moves a label along the contour.
   */
  const labelHalfHeightGrid = 0.36 * labelEm + labelPadGrid

  const majorMod = majorInterval ?? 0
  const offset = majorOffset ?? 1
  // Major/minor routing per bottom-up level index + phase offset
  const levelMajor = new Uint8Array(numSteps)
  for (let i = 0; i < numSteps; i++) {
    levelMajor[i] = (majorMod > 1)
      ? (((i + (majorMod - offset)) % majorMod === 0) ? 1 : 0)
      : (majorMod === 1 ? 1 : 0)
  }

  // When chaining is needed, raw grid-space segments are collected per level and
  // chained/smoothed/closed after the scan; otherwise they emit directly (fast path).
  //
  // EDGE IDS — every marching-squares crossing lies on one grid edge, and two
  // adjacent cells compute a shared edge's crossing from the same corner pair,
  // so an integer id identifies a junction exactly:
  //   horizontal edge, row r between cols c and c+1 → 2·(r·cols + c)
  //   vertical   edge, col c between rows r and r+1 → 2·(r·cols + c) + 1
  // Cell (r,c)'s bottom is (r+1,c)'s top, and its right is (r,c+1)'s left, so
  // neighbours agree on the id without any coordinate comparison.
  const levelSegE  = needsChains ? new Array(numSteps).fill(null) : null
  const levelSegXY = needsChains ? new Array(numSteps).fill(null) : null
  const lvl0 = numSteps > 0 ? levelVal[0] : 0
  const ex = _edgeX, ey = _edgeY, eid = _edgeId

  // Single cell-major pass: instead of re-scanning the whole grid once per level
  // (O(levels × cells)), visit each cell once and only test the levels that can
  // cross its value range (O(cells + emitted segments)).
  if (numSteps > 0) for (let r = 0; r < rows - 1; r++) {
    const row0 = r * cols, row1 = row0 + cols
    for (let c = 0; c < cols - 1; c++) {
      // If all 4 are NoData, skip cell
      const m00 = gridMask[row0 + c], m10 = gridMask[row0 + c + 1]
      const m01 = gridMask[row1 + c], m11 = gridMask[row1 + c + 1]
      if (!m00 && !m10 && !m01 && !m11) continue

      // Value range over valid corners. NoData corners count as "just below the
      // level" at every level (so shorelines draw) — they never bound the range.
      let vmin = Infinity, vmax = -Infinity, v
      if (m00) { v = grid[row0 + c];     if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m10) { v = grid[row0 + c + 1]; if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m01) { v = grid[row1 + c];     if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m11) { v = grid[row1 + c + 1]; if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      const anyMasked = !(m00 && m10 && m01 && m11)

      // Conservative level-index range (±1 slack for float safety); the exact
      // idx === 0 / 15 test below filters identically to the per-level scan.
      // Ordered by *index*, not by value: elevScale is signed, and a negative
      // one runs the levels down the brightness range, so vmin maps to the high
      // index and vmax to the low one. Reading them the other way round gave
      // kLo > kHi for any cell spanning more than a level — an inverted terrain
      // drew contours on its gentle ground and nothing at all on its cliffs.
      const kA = (vmin - lvl0) / lvlStep, kB = (vmax - lvl0) / lvlStep
      const kLo = anyMasked ? 0 : Math.max(0, Math.floor(Math.min(kA, kB)))
      const kHi = Math.min(numSteps - 1, Math.floor(Math.max(kA, kB)) + 1)

      for (let k = kLo; k <= kHi; k++) {
        if (!levelActive[k]) continue
        const level = levelVal[k]
        // Treat NoData as being slightly below the level so shorelines draw
        const v00 = m00 ? grid[row0 + c] : level - 1e-7
        const v10 = m10 ? grid[row0 + c + 1] : level - 1e-7
        const v11 = m11 ? grid[row1 + c + 1] : level - 1e-7
        const v01 = m01 ? grid[row1 + c] : level - 1e-7

        const idx = (v00 >= level ? 8 : 0) | (v10 >= level ? 4 : 0) | (v11 >= level ? 2 : 0) | (v01 >= level ? 1 : 0)
        if (idx === 0 || idx === 15) continue

        ex[0] = c + edgeLerp01(v00, v10, level); ey[0] = r
        ex[1] = c + 1;                           ey[1] = r + edgeLerp01(v10, v11, level)
        ex[2] = c + edgeLerp01(v01, v11, level); ey[2] = r + 1
        ex[3] = c;                               ey[3] = r + edgeLerp01(v00, v01, level)

        if (needsChains) {
          const base = (row0 + c) * 2
          eid[0] = base                    // top    → H(r,   c)
          eid[1] = (row0 + c + 1) * 2 + 1  // right  → V(r,   c+1)
          eid[2] = (row1 + c) * 2          // bottom → H(r+1, c)
          eid[3] = base + 1                // left   → V(r,   c)
        }

        const pairs = MARCHING_TABLE[idx]
        for (let pi = 0; pi < pairs.length; pi += 2) {
          const e0 = pairs[pi], e1 = pairs[pi + 1]
          if (needsChains) {
            (levelSegE[k]  ??= new I32List()).push2(eid[e0], eid[e1])
            ;(levelSegXY[k] ??= new F64List()).push4(ex[e0], ey[e0], ex[e1], ey[e1])
          } else {
            const isMajor = levelMajor[k] === 1
            const tp = isMajor ? majorPos : minorPos
            const tc = isMajor ? majorCol : minorCol
            tp.push6(ex[e0] * scl - halfW, levelElev[k], ey[e0] * scl - halfH,
                     ex[e1] * scl - halfW, levelElev[k], ey[e1] * scl - halfH)
            tc.push6(levelRgb[k * 3], levelRgb[k * 3 + 1], levelRgb[k * 3 + 2],
                     levelRgb[k * 3], levelRgb[k * 3 + 1], levelRgb[k * 3 + 2])
          }
        }
      }
    }
  }

  // Post-scan: chain each level into polylines, optionally Chaikin-smooth them into
  // soft "form lines", and optionally add border-bridging segments to close rings.
  if (needsChains) {
    // Ids run to 2·rows·cols; one shared scratch serves every level.
    const scratch = getChainScratch(rows * cols * 2)
    for (let k = 0; k < numSteps; k++) {
      const segE = levelSegE[k]
      if (!segE || segE.length === 0) continue
      const chains = chainLevelSegments(segE.a, levelSegXY[k].a, segE.length / 2, scratch)
      const isMajor = levelMajor[k] === 1
      const tp = isMajor ? majorPos : minorPos
      const tc = isMajor ? majorCol : minorCol
      const y = levelElev[k]
      const cr = levelRgb[k * 3], cg = levelRgb[k * 3 + 1], cb = levelRgb[k * 3 + 2]

      /*
       * Two passes, because a label has to mask every line at its level — not
       * just the one it sits on.
       *
       * Cutting by arclength along the label's own chain is what the first
       * version did, and it leaves two gaps. A contour that hairpins comes back
       * within a few units of the digits while being a long way off along the
       * curve, so nothing removed it; and a *different* chain at the same level
       * — the far side of a narrow ridge, the next ring in a tight nest — was
       * never considered at all. Measured on the reference terrain, 14 of 182
       * labels had a contour drawn straight through them.
       *
       * So placements are collected first, and then every segment at this level
       * is tested against every label box. That subsumes the arclength cut (the
       * box *is* the gap), and it is what a printed sheet does: the number masks
       * whatever lies under it, wherever it came from.
       */
      const prepared = []
      for (const chain of chains) {
        // Decimation only pays after smoothing: raw marching-squares points are
        // already minimal (one per grid-edge crossing), so there is nothing
        // collinear to drop and the sweep would be pure overhead.
        //
        // Two-level decimation: cheap O(n) thinning between passes, bounded by a
        // fraction of the tolerance so the shifts cannot compound past it, then
        // one Douglas–Peucker pass at full tolerance to reach the point count the
        // curve actually needs.
        const pts = smooth > 0
          ? simplifyFlat(
              chaikinSmoothFlat(chain.pts, chain.closed, smooth, SMOOTH_SIMPLIFY_EPS / smooth),
              SMOOTH_SIMPLIFY_EPS,
            )
          : chain.pts
        prepared.push({ pts, closed: chain.closed })
      }

      // Which levels get lettered. Labelling every minor contour is a page of
      // numbers with a drawing behind it, so the default is the index contours
      // only — which is what a printed sheet does.
      const boxes = []
      if (wantLabels && (isMajor || !(p.labelMajorOnlyContours ?? true))) {
        const gap = labelGapFor(levelText(k))
        for (const c of prepared) {
          const placed = placeContourLabels(c.pts, c.closed, labelSpacingGrid, gap)
          if (!placed) continue
          for (const a of placed) {
            boxes.push({ c: a.c, r: a.r, ca: Math.cos(a.angle), sa: Math.sin(a.angle),
                         halfW: gap / 2, halfH: labelHalfHeightGrid })
            labelAnchors.push({ x: a.c * scl - halfW, z: a.r * scl - halfH,
                                y, angle: a.angle, v: levelVal[k],
                                // Height above the lowest ground, for a raster
                                // with no elevation of its own to report.
                                rel: levelElev[k] - minElev })
          }
        }
      }

      /**
       * Is any of this segment under a label?
       *
       * Endpoints and midpoint, not a full clip. Segments here are about one
       * grid edge long against a box several ems wide, so a segment crossing
       * without any of the three landing inside would have to be longer than the
       * box — and erring toward cutting is the safe direction anyway.
       */
      const masked = (x0, y0, x1, y1) => {
        for (const b of boxes) {
          for (let t = 0; t <= 2; t++) {
            const px = x0 + (x1 - x0) * t / 2, py = y0 + (y1 - y0) * t / 2
            const dx = px - b.c, dy = py - b.r
            if (Math.abs(dx * b.ca + dy * b.sa) <= b.halfW &&
                Math.abs(-dx * b.sa + dy * b.ca) <= b.halfH) return true
          }
        }
        return false
      }

      for (const { pts } of prepared) {
        const np = pts.length / 2
        for (let i = 0; i < np - 1; i++) {
          const j = i * 2
          if (boxes.length && masked(pts[j], pts[j + 1], pts[j + 2], pts[j + 3])) continue
          tp.push6(pts[j]     * scl - halfW, y, pts[j + 1] * scl - halfH,
                   pts[j + 2] * scl - halfW, y, pts[j + 3] * scl - halfH)
          tc.push6(cr, cg, cb, cr, cg, cb)
        }
      }

      if (closeRings) {
        const bridges = borderCloseSegments(chains, rows, cols, scl, halfW, halfH, y)
        for (let j = 0; j < bridges.length; j += 6) {
          tp.push6(bridges[j], bridges[j+1], bridges[j+2], bridges[j+3], bridges[j+4], bridges[j+5])
          tc.push6(cr, cg, cb, cr, cg, cb)
        }
      }
    }
  }

  return {
    'Contours-Minor': { positions: minorPos.toArray(), colors: minorCol.toArray() },
    // The anchors ride with the major layer because that is what they label by
    // default. They are placements, not geometry: the main thread letters them,
    // since neither the fonts nor the raster's metre range exist in here.
    'Contours-Major': { positions: majorPos.toArray(), colors: majorCol.toArray(),
                        labelAnchors: labelAnchors?.length ? labelAnchors : null },
  }
}

/**
 * Illuminated ("Tanaka") contours — the same level set, lit rather than uniform.
 *
 * Every segment is sorted into a bright or dark half by the sign of the sun
 * direction dotted with the surface gradient at its midpoint: a contour crossing
 * ground that tilts toward the light goes bright, one on ground tilting away
 * goes dark. Relief then reads from the contour lines alone, with no surface
 * shading underneath — which is the point of the technique on a line plot.
 *
 * The two halves are emitted as separate sub-layers rather than one layer with
 * per-vertex colour because what distinguishes them is stroke *weight*
 * (`tanakaWeightBright` / `tanakaWeightDark`), and weight is resolved per layer
 * at render time, not baked into geometry. Both halves carry the same
 * hypsometric colour for their level; the contrast comes from weight and from
 * whatever per-layer colours are set.
 */
function buildContoursTanaka(terrain, p, interval) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH } = terrain

  const brightPos = new F32List(), brightCol = new F32List()
  const darkPos = new F32List(), darkCol = new F32List()

  const { numSteps, levelElev, levelVal, levelActive, levelRgb, lvlStep } =
    prepareContourLevels(terrain, p, interval)

  const sunAzRad = ((p.tanakaSunAzimuth ?? 315) * Math.PI) / 180
  const sunDirX =  Math.sin(sunAzRad)
  const sunDirZ = -Math.cos(sunAzRad)

  const lvl0 = numSteps > 0 ? levelVal[0] : 0
  const ex = _edgeX, ey = _edgeY

  // Same single cell-major pass as buildContours (see comment there).
  if (numSteps > 0) for (let r = 0; r < rows - 1; r++) {
    const row0 = r * cols, row1 = row0 + cols
    for (let c = 0; c < cols - 1; c++) {
      const m00 = gridMask[row0 + c], m10 = gridMask[row0 + c + 1]
      const m01 = gridMask[row1 + c], m11 = gridMask[row1 + c + 1]
      if (!m00 && !m10 && !m01 && !m11) continue

      let vmin = Infinity, vmax = -Infinity, v
      if (m00) { v = grid[row0 + c];     if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m10) { v = grid[row0 + c + 1]; if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m01) { v = grid[row1 + c];     if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m11) { v = grid[row1 + c + 1]; if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      const anyMasked = !(m00 && m10 && m01 && m11)

      // Ordered by index rather than by value — a negative elevScale runs the
      // levels down the brightness range (see buildContours).
      const kA = (vmin - lvl0) / lvlStep, kB = (vmax - lvl0) / lvlStep
      const kLo = anyMasked ? 0 : Math.max(0, Math.floor(Math.min(kA, kB)))
      const kHi = Math.min(numSteps - 1, Math.floor(Math.max(kA, kB)) + 1)

      for (let k = kLo; k <= kHi; k++) {
        if (!levelActive[k]) continue
        const level = levelVal[k]
        const v00 = m00 ? grid[row0 + c] : level - 1e-7
        const v10 = m10 ? grid[row0 + c + 1] : level - 1e-7
        const v11 = m11 ? grid[row1 + c + 1] : level - 1e-7
        const v01 = m01 ? grid[row1 + c] : level - 1e-7

        const idx = (v00 >= level ? 8 : 0) | (v10 >= level ? 4 : 0) | (v11 >= level ? 2 : 0) | (v01 >= level ? 1 : 0)
        if (idx === 0 || idx === 15) continue

        ex[0] = c + edgeLerp01(v00, v10, level); ey[0] = r
        ex[1] = c + 1;                           ey[1] = r + edgeLerp01(v10, v11, level)
        ex[2] = c + edgeLerp01(v01, v11, level); ey[2] = r + 1
        ex[3] = c;                               ey[3] = r + edgeLerp01(v00, v01, level)

        const pairs = MARCHING_TABLE[idx]
        for (let pi = 0; pi < pairs.length; pi += 2) {
          const e0 = pairs[pi], e1 = pairs[pi + 1]
          const mc = Math.max(0, Math.min(cols - 1, Math.round((ex[e0] + ex[e1]) / 2)))
          const mr = Math.max(0, Math.min(rows - 1, Math.round((ey[e0] + ey[e1]) / 2)))
          const gx = (grid[mr*cols + Math.min(mc+1,cols-1)] - grid[mr*cols + Math.max(mc-1,0)]) / (2 * scl)
          const gz = (grid[Math.min(mr+1,rows-1)*cols + mc] - grid[Math.max(mr-1,0)*cols + mc]) / (2 * scl)
          const lit = sunDirX * gx + sunDirZ * gz >= 0

          const tp = lit ? brightPos : darkPos
          const tc = lit ? brightCol : darkCol
          tp.push6(ex[e0] * scl - halfW, levelElev[k], ey[e0] * scl - halfH,
                   ex[e1] * scl - halfW, levelElev[k], ey[e1] * scl - halfH)
          tc.push6(levelRgb[k * 3], levelRgb[k * 3 + 1], levelRgb[k * 3 + 2],
                   levelRgb[k * 3], levelRgb[k * 3 + 1], levelRgb[k * 3 + 2])
        }
      }
    }
  }

  return {
    'Contours-Tanaka-Bright': { positions: brightPos.toArray(), colors: brightCol.toArray() },
    'Contours-Tanaka-Dark':   { positions: darkPos.toArray(),   colors: darkCol.toArray() },
  }
}
