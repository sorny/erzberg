/**
 * Closed rings around the areas of a labelled lattice.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Three draw modes block colour rather than draw it — Indexed, Mineral and
 * Watershed. All three go through `fillCells`, which paints one flat quad per
 * lattice cell and emits the cell edges where the area changes. Those edges are
 * enough to see and not enough to plot: they arrive as unordered two-point
 * pieces, so an editor has no closed shape to select and a hatch-fill tool has
 * nothing to work on.
 *
 * A triangle soup has no outline, so the `lids` mesh is the wrong input. The
 * area labels are the right one, and this walks them into rings.
 *
 * ── THE WALK ────────────────────────────────────────────────────────────────
 * Every side of a kept cell whose neighbour is empty, not kept, or a different
 * area is a boundary half-edge. Each is directed so that the cell interior is
 * always on its right, which makes an outer ring clockwise and a hole
 * counter-clockwise in the lattice's own y-down coordinates. Chaining them end
 * corner to start corner then closes each ring.
 *
 * The one real choice is at a corner where two areas pinch diagonally, because
 * two outgoing edges of the same area start there. Turning right first splits
 * the pinch, so an area that touches itself only at a corner comes out as two
 * rings. Turning left first would join them into one. Both are legal readings of
 * the same lattice; right-first is taken because it is the reading where two
 * rings never cross, only touch, and a self-crossing ring is what breaks an
 * even-odd fill.
 */

/** Direction indices, in the order a right turn advances through them. */
const DX = [1, 0, -1, 0]   // 0 = +x, 1 = +y, 2 = -x, 3 = -y
const DY = [0, 1, 0, -1]

/**
 * Trace every area in a lattice into closed rings.
 *
 * @param region  Int32Array of `lw * lh` dense area indices, -1 where empty.
 * @param lw,lh   Lattice dimensions in cells.
 * @param keep    (cellIndex) => boolean. A cell the caller wants excluded reads
 *                as empty, which is how the exporter applies its depth test.
 * @param sameHeight (cellA, cellB) => boolean. Two collinear edges merge into
 *                one only when this agrees they lie at the same height. The
 *                cells are flat at their own elevation, so a step between two
 *                of them is a real feature of the shape and not a spare vertex.
 * @returns [{ area, loops: [{ corners: Int32Array, cells: Int32Array }] }]
 *          A corner id decodes as `x = id % (lw + 1)`, `y = (id / (lw + 1)) | 0`.
 *          `cells[k]` owns the edge that *leaves* `corners[k]`, and is what a
 *          caller reads a height from.
 */
export function traceAreaRings(region, lw, lh, keep = null, sameHeight = null) {
  const cw = lw + 1
  const n = lw * lh
  const inArea = new Uint8Array(n)
  for (let i = 0; i < n; i++) inArea[i] = (region[i] >= 0 && (!keep || keep(i))) ? 1 : 0

  // Pass one counts the boundary half-edges so pass two can write straight into
  // typed arrays. A Map of corner to edge list is the obvious structure and was
  // the first one here; on a 256×256 lattice it allocated a quarter of a million
  // small arrays for a walk that reads each entry once.
  let nHe = 0
  for (let i = 0; i < n; i++) {
    if (!inArea[i]) continue
    const r = (i / lw) | 0, c = i - r * lw
    if (r === 0      || !inArea[i - lw] || region[i - lw] !== region[i]) nHe++
    if (c + 1 >= lw  || !inArea[i + 1]  || region[i + 1]  !== region[i]) nHe++
    if (r + 1 >= lh  || !inArea[i + lw] || region[i + lw] !== region[i]) nHe++
    if (c === 0      || !inArea[i - 1]  || region[i - 1]  !== region[i]) nHe++
  }
  if (nHe === 0) return []

  const heStart = new Int32Array(nHe)   // corner the edge leaves
  const heDir   = new Uint8Array(nHe)
  const heCell  = new Int32Array(nHe)
  let k = 0
  const put = (start, dir, cell) => { heStart[k] = start; heDir[k] = dir; heCell[k] = cell; k++ }

  for (let i = 0; i < n; i++) {
    if (!inArea[i]) continue
    const r = (i / lw) | 0, c = i - r * lw
    const tl = r * cw + c, tr = tl + 1, bl = tl + cw, br = bl + 1
    // Interior on the right of each: top runs left to right and the cell is
    // below it, right runs down, bottom runs right to left, left runs up.
    if (r === 0      || !inArea[i - lw] || region[i - lw] !== region[i]) put(tl, 0, i)
    if (c + 1 >= lw  || !inArea[i + 1]  || region[i + 1]  !== region[i]) put(tr, 1, i)
    if (r + 1 >= lh  || !inArea[i + lw] || region[i + lw] !== region[i]) put(br, 2, i)
    if (c === 0      || !inArea[i - 1]  || region[i - 1]  !== region[i]) put(bl, 3, i)
  }

  // CSR: edges bucketed by the corner they leave, so the walk finds its
  // candidates by index rather than by search.
  const nCorners = cw * (lh + 1)
  const head = new Int32Array(nCorners + 1)
  for (let e = 0; e < nHe; e++) head[heStart[e] + 1]++
  for (let i = 0; i < nCorners; i++) head[i + 1] += head[i]
  const slot = head.slice(0, nCorners)
  const byCorner = new Int32Array(nHe)
  for (let e = 0; e < nHe; e++) byCorner[slot[heStart[e]]++] = e

  const endCorner = (e) => {
    const s = heStart[e], d = heDir[e]
    return (((s / cw) | 0) + DY[d]) * cw + ((s % cw) + DX[d])
  }

  const used = new Uint8Array(nHe)

  /**
   * The next edge of this ring, or -1.
   *
   * Right turn first, then straight, then left, then back the way we came. The
   * seed is allowed through even though it is marked used — arriving at it is
   * how a ring closes.
   */
  const nextOf = (corner, area, dir, seed) => {
    for (const turn of [1, 0, 3, 2]) {
      const want = (dir + turn) & 3
      for (let j = head[corner]; j < head[corner + 1]; j++) {
        const e = byCorner[j]
        if (heDir[e] !== want) continue
        if (region[heCell[e]] !== area) continue
        if (e === seed) return e
        if (!used[e]) return e
      }
    }
    return -1
  }

  const byArea = new Map()

  for (let seed = 0; seed < nHe; seed++) {
    if (used[seed]) continue
    const area = region[heCell[seed]]
    const corners = [], cells = [], dirs = []
    let cur = seed
    for (;;) {
      used[cur] = 1
      corners.push(heStart[cur]); cells.push(heCell[cur]); dirs.push(heDir[cur])
      const nx = nextOf(endCorner(cur), area, heDir[cur], seed)
      // -1 cannot happen on a well-formed lattice: every corner a boundary edge
      // arrives at has one leaving it. It is checked rather than asserted
      // because an open chain here would otherwise be written as a closed path.
      if (nx < 0 || nx === seed) break
      cur = nx
    }
    if (corners.length < 4) continue

    // Collinear merge. Most of a catchment boundary is long straight runs, and
    // keeping a vertex per cell put roughly eight times more points in the file
    // than the shape has corners.
    const outC = [], outCell = []
    for (let a = 0; a < corners.length; a++) {
      const b = (a + corners.length - 1) % corners.length
      const straight = dirs[b] === dirs[a] &&
        (!sameHeight || sameHeight(cells[b], cells[a]))
      if (!straight) { outC.push(corners[a]); outCell.push(cells[a]) }
    }
    if (outC.length < 3) continue

    const loop = { corners: Int32Array.from(outC), cells: Int32Array.from(outCell) }
    const bucket = byArea.get(area)
    if (bucket) bucket.push(loop)
    else byArea.set(area, [loop])
  }

  return [...byArea].map(([area, loops]) => ({ area, loops }))
}

/**
 * Twice the signed area of a ring, in lattice units.
 *
 * Positive is clockwise in the lattice's y-down coordinates, which is an outer
 * ring; a hole comes back negative. Used by the tests, and by anything that
 * needs to tell the two apart without relying on the fill rule.
 */
export function ringSignedArea(loop, cw) {
  const { corners } = loop
  let a = 0
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i], q = corners[(i + 1) % corners.length]
    const px = p % cw, py = (p / cw) | 0
    const qx = q % cw, qy = (q / cw) | 0
    a += px * qy - qx * py
  }
  return a
}
