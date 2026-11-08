/**
 * Z offset and plumb lines: a mode's marks raised above the ground, with
 * dashed verticals that tie them back to it.
 *
 * This is the exploded view of a thesis plate: each masked region (a glacier
 * stand, a lava flow) floats at its own height above the whole terrain, and a
 * few plumb lines show where on the ground it belongs.
 *
 * `zOffset<Id>` is in multiples of the terrain's relief, so a plate keeps its
 * spacing when the vertical exaggeration changes. `plumb<Id>` adds the lines.
 * A copy of a mode carries both, so each copy can float at its own height.
 */

/** Regions smaller than this many grid cells get no plumb lines. */
const MIN_REGION_CELLS = 20
/** A region also needs this share of the largest region's cells. */
const MIN_REGION_SHARE = 0.02
/** The most regions that get plumb lines, largest first. */
const MAX_REGIONS = 6

/**
 * The lift of mode `id` in scene units, or 0. `explode` (View) scales every
 * mode's and copy's Z offset at once, so one slider opens the whole view.
 */
export function liftOf(p, id, terrain) {
  const k = Number(p[`zOffset${id}`])
  if (!Number.isFinite(k) || k <= 0) return 0
  const e = Number.isFinite(Number(p.explode)) ? Math.max(0, Number(p.explode)) : 1
  const relief = Math.max(1e-3, (terrain.maxElev ?? 0) - (terrain.minElev ?? 0))
  return k * e * relief
}

/**
 * Stack by landform: the tier of each landform, low ground to high. A tier
 * floats at (tier + 1) times the Z offset. Indexed like `LANDFORMS`.
 */
const TIER_OF_FORM = [3, 6, 5, 4, 4, 3, 2, 2, 1, 0]
/** The landforms of each tier, for its pen layer's name. */
export const TIER_FORMS = [['Pit'], ['Valley'], ['Footslope', 'Hollow'], ['Flat', 'Slope'],
  ['Spur', 'Shoulder'], ['Ridge'], ['Peak']]
/** The id suffix of tier `t`: `Tier3`. */
export const tierId = (t) => `Tier${t}`

/**
 * One layer's strokes split by the tier of the landform under each segment's
 * midpoint, the builder's colours kept. Segments on no landform are dropped.
 * What travels with the layer as a whole (fills, its occluder, labels) stays
 * with the lowest tier that has strokes.
 *
 * @returns {Map<number, object>} tier → layer, or null when there is no grid
 */
export function splitByTier(res, terrain) {
  const { gridForm, rows, cols, scl, halfW, halfH } = terrain
  const P = res?.positions
  if (!gridForm || !(P instanceof Float32Array) || res.isPoints) return null
  const C = res.colors?.length === P.length ? res.colors : null
  const parts = new Map()
  for (let s = 0; s + 5 < P.length; s += 6) {
    const c = Math.min(cols - 1, Math.max(0, Math.round(((P[s] + P[s + 3]) / 2 + halfW) / scl)))
    const r = Math.min(rows - 1, Math.max(0, Math.round(((P[s + 2] + P[s + 5]) / 2 + halfH) / scl)))
    const t = TIER_OF_FORM[gridForm[r * cols + c]]
    if (t === undefined) continue
    let part = parts.get(t)
    if (!part) { part = { pos: [], col: [] }; parts.set(t, part) }
    for (let k = 0; k < 6; k++) part.pos.push(P[s + k])
    if (C) for (let k = 0; k < 6; k++) part.col.push(C[s + k])
  }
  const out = new Map()
  const tiers = [...parts.keys()].sort((a, b) => a - b)
  tiers.forEach((t, n) => {
    const { pos, col } = parts.get(t)
    const layer = { ...(n === 0 ? res : { selfOcclude: res.selfOcclude, insideGround: res.insideGround }),
      positions: new Float32Array(pos) }
    if (C) layer.colors = new Float32Array(col)
    else delete layer.colors
    if (n !== 0) { delete layer.curtains }
    out.set(t, layer)
  })
  return out
}

/** The terrain of one tier: the layer's stencil, keeping that tier's cells. */
export function tierTerrain(terrain, t) {
  const { gridForm, gridMask, rows, cols } = terrain
  const mask = new Uint8Array(rows * cols)
  for (let i = 0; i < mask.length; i++) mask[i] = (!gridMask || gridMask[i]) && TIER_OF_FORM[gridForm[i]] === t ? 1 : 0
  return { ...terrain, gridMask: mask }
}

const shiftY = (src, dy) => {
  const out = new Float32Array(src)
  for (let i = 1; i < out.length; i += 3) out[i] += dy
  return out
}

/**
 * A layer without the strokes that lie below the ground, for a run about to be
 * raised.
 *
 * A masked line mode closes its lines at the mask's edge by stacking every
 * lower level there, under the ground. On the ground the terrain hides that
 * skirt. Raised, nothing hides it, so it is dropped here. A segment goes when
 * either end is more than `tol` below the ground, or both ends are off the
 * data. Points and fills are kept.
 */
export function dropBelowGround(res, groundAt, tol) {
  const P = res?.positions
  if (!(P instanceof Float32Array) || !P.length || res.isPoints) return res
  const C = res.colors?.length === P.length ? res.colors : null
  const keep = new Float32Array(P.length)
  const keepC = C ? new Float32Array(C.length) : null
  let n = 0
  for (let i = 0; i + 5 < P.length; i += 6) {
    const g0 = groundAt(P[i], P[i + 2]), g1 = groundAt(P[i + 3], P[i + 5])
    // Both ends off the data: the skirt a NoData edge stacks, with no ground to
    // measure it against.
    if (g0 !== g0 && g1 !== g1) continue
    if (P[i + 1] < g0 - tol || P[i + 4] < g1 - tol) continue
    keep.set(P.subarray(i, i + 6), n)
    if (keepC) keepC.set(C.subarray(i, i + 6), n)
    n += 6
  }
  if (n === P.length) return res
  return { ...res, positions: keep.slice(0, n), ...(keepC ? { colors: keepC.slice(0, n) } : null) }
}

/**
 * One built layer, raised by `dy`: its strokes, its fills, its own occluder,
 * the lattice the SVG traces fills from, and its label anchors.
 */
export function liftLayer(res, dy) {
  if (!res || !dy) return res
  // Marks the layer as raised: its depth-only surfaces are its raised ground,
  // which hides only while the layer is opaque (see `raisedOccludes`).
  const out = { ...res, lifted: true }
  if (res.positions instanceof Float32Array) out.positions = shiftY(res.positions, dy)
  if (res.lids?.positions) {
    // A raised fill no longer lies on the surface, so it takes the cap's bias.
    out.lids = { ...res.lids, positions: shiftY(res.lids.positions, dy), hugsSurface: false }
  }
  if (res.occluder?.positions) out.occluder = { ...res.occluder, positions: shiftY(res.occluder.positions, dy) }
  if (res.areas?.elev) {
    const elev = Float32Array.from(res.areas.elev, (v) => v + dy)
    out.areas = { ...res.areas, elev }
  }
  const lift = (list) => list?.map((a) => (Number.isFinite(a.y) ? { ...a, y: a.y + dy } : a)) ?? list
  if (res.labelAnchors) out.labelAnchors = lift(res.labelAnchors)
  if (res.scaleAnchors) out.scaleAnchors = lift(res.scaleAnchors)
  return out
}

/**
 * The ground under a raised run, raised with it, as depth-only triangles.
 *
 * On the ground, the terrain hides the far side of every slope. A raised run
 * has no terrain under it, so without this its far-side lines show through and
 * a steep region turns solid. Only the cells the stencil keeps are built, and
 * the sheet sits a hair below the strokes so it never hides the lines on it.
 *
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function liftedSurface(terrain, dy, groundAt) {
  const { rows, cols, scl, halfW, halfH, gridMask: mask } = terrain
  const sink = Math.max(1e-3, (terrain.maxElev - terrain.minElev) * 0.004)
  const vert = new Int32Array(rows * cols).fill(-1)
  const pos = []
  const idx = []
  const at = (r, c) => {
    const i = r * cols + c
    if (vert[i] < 0) {
      const x = c * scl - halfW, z = r * scl - halfH
      vert[i] = pos.length / 3
      pos.push(x, groundAt(x, z) + dy - sink, z)
    }
    return vert[i]
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c
      if (mask && !(mask[a] && mask[a + 1] && mask[a + cols] && mask[a + cols + 1])) continue
      const v00 = at(r, c), v01 = at(r, c + 1), v10 = at(r + 1, c), v11 = at(r + 1, c + 1)
      if ([v00, v01, v10, v11].some((v) => pos[v * 3 + 1] !== pos[v * 3 + 1])) continue
      idx.push(v00, v10, v01, v01, v10, v11)
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}

/**
 * Whether a layer's depth-only surfaces hide what is behind them. A raised
 * layer's are its own raised ground, so at an opacity below 1 they hide
 * nothing, and the ground and the far side of the layer show through it, as a
 * fill below full opacity does. Every other layer's always hide.
 */
export function raisedOccludes(layer, opacity) {
  return !layer?.lifted || !(opacity < 0.999)
}

/** Two depth-only meshes as one. */
export function mergeOccluders(a, b) {
  if (!a?.indices?.length) return b
  if (!b?.indices?.length) return a
  const positions = new Float32Array(a.positions.length + b.positions.length)
  positions.set(a.positions); positions.set(b.positions, a.positions.length)
  const off = a.positions.length / 3
  const indices = new Uint32Array(a.indices.length + b.indices.length)
  indices.set(a.indices)
  for (let k = 0; k < b.indices.length; k++) indices[a.indices.length + k] = b.indices[k] + off
  return { positions, indices }
}

/**
 * The points worth a plumb line, as grid cells: in each region the stencil
 * keeps, its highest cell and its four outermost cells (west, east, north,
 * south), or with `which` = 'summit' the highest cell alone. A region is a
 * 4-connected run of kept cells.
 *
 * @returns {{ r: number, c: number }[]}
 */
export function plumbPoints(terrain, which = 'all') {
  const { rows, cols, gridMask: mask, grid } = terrain
  const n = rows * cols
  const seen = new Uint8Array(n)
  const stack = new Int32Array(n)
  const regions = []

  for (let start = 0; start < n; start++) {
    if (seen[start] || (mask && !mask[start])) continue
    seen[start] = 1
    let top = 0
    stack[top++] = start
    let cells = 0
    let hi = start, w = start, e = start, nn = start, s = start
    while (top) {
      const i = stack[--top]
      cells++
      const r = (i / cols) | 0, c = i - r * cols
      if (grid[i] > grid[hi]) hi = i
      if (c < w % cols) w = i
      if (c > e % cols) e = i
      if (r < ((nn / cols) | 0)) nn = i
      if (r > ((s / cols) | 0)) s = i
      const push = (j) => { if (!seen[j] && (!mask || mask[j])) { seen[j] = 1; stack[top++] = j } }
      if (c > 0) push(i - 1)
      if (c < cols - 1) push(i + 1)
      if (r > 0) push(i - cols)
      if (r < rows - 1) push(i + cols)
    }
    regions.push({ cells, picks: which === 'summit' ? [hi] : [hi, w, e, nn, s] })
  }

  regions.sort((a, b) => b.cells - a.cells)
  const floor = Math.max(MIN_REGION_CELLS, (regions[0]?.cells ?? 0) * MIN_REGION_SHARE)
  const out = []
  for (const reg of regions.slice(0, MAX_REGIONS)) {
    if (reg.cells < floor) break
    for (const i of new Set(reg.picks)) out.push({ r: (i / cols) | 0, c: i % cols })
  }
  return out
}

/** The plumb style of a run as it stands today, for any value left unset. */
export const PLUMB_STYLE = { dash: 4, gap: 4, mark: 'ring', size: 0.6, ends: 'both' }

/** The geometry half of mode `id`'s plumb style, from its params. */
export function plumbStyleOf(p, id) {
  const num = (k, d) => (Number.isFinite(Number(p[k])) ? Number(p[k]) : d)
  return {
    dash: num(`plumbDash${id}`, PLUMB_STYLE.dash),
    gap: num(`plumbGap${id}`, PLUMB_STYLE.gap),
    mark: p[`plumbMark${id}`] ?? PLUMB_STYLE.mark,
    size: num(`plumbSize${id}`, PLUMB_STYLE.size),
    ends: p[`plumbEnds${id}`] ?? PLUMB_STYLE.ends,
  }
}

/**
 * Plumb lines from the raised marks down to the ground, as plain segments the
 * viewport and the plot both draw: a dashed vertical per point, and a ring or
 * an X at its ends. The dashes are geometry, not a stroke style, so a plotter
 * that ignores dash patterns still draws them dashed.
 *
 * The style (`PLUMB_STYLE`): `dash` and `gap` in percent of relief, stretched a
 * little so the line starts and ends on a dash, and a gap of 0 draws it solid.
 * `mark` is 'ring' or 'cross', `size` its radius in percent of the plate's
 * larger half width, 0 for none. `ends` is 'both', 'ground' or 'top'.
 *
 * @param {{ r: number, c: number }[] | { x: number, z: number }[]} points
 *   grid cells from `plumbPoints`, or scene points from `fencePoints`
 * @param {number} dy        the lift, in scene units
 * @param {Function} groundAt  (x, z) → the ground's height, NaN off the data
 * @param {number[]} rgb     the line colour, 0–1
 */
export function buildPlumb(points, dy, terrain, groundAt, rgb, style = PLUMB_STYLE) {
  const { scl, halfW, halfH } = terrain
  const st = { ...PLUMB_STYLE, ...style }
  const relief = Math.max(1e-3, terrain.maxElev - terrain.minElev)
  const dash = Math.max(0, st.dash) / 100 * relief
  const gap = Math.max(0, st.gap) / 100 * relief
  const radius = Math.max(0, st.size) / 100 * Math.max(halfW, halfH)
  const RING = 12
  const pos = []

  const ring = (x, y, z) => {
    for (let k = 0; k < RING; k++) {
      const a0 = (k / RING) * Math.PI * 2, a1 = ((k + 1) / RING) * Math.PI * 2
      pos.push(x + Math.cos(a0) * radius, y, z + Math.sin(a0) * radius,
               x + Math.cos(a1) * radius, y, z + Math.sin(a1) * radius)
    }
  }
  // An X lying flat, its arms reaching the ring's radius.
  const cross = (x, y, z) => {
    const a = radius * Math.SQRT1_2
    pos.push(x - a, y, z - a, x + a, y, z + a, x - a, y, z + a, x + a, y, z - a)
  }
  const mark = st.mark === 'cross' ? cross : ring

  for (const pt of points) {
    const x = pt.x ?? pt.c * scl - halfW, z = pt.z ?? pt.r * scl - halfH
    const g = groundAt(x, z)
    if (g !== g) continue
    if (gap > 0 && dash > 0) {
      // Whole dashes from end to end: the count that fits, then both lengths
      // scaled by the same factor to take up the rest.
      const steps = Math.max(1, Math.round((dy + gap) / (dash + gap)))
      const k = dy / (steps * dash + (steps - 1) * gap)
      for (let i = 0; i < steps; i++) {
        const y0 = g + i * (dash + gap) * k
        pos.push(x, y0, z, x, Math.min(g + dy, y0 + dash * k), z)
      }
    } else {
      pos.push(x, g, z, x, g + dy, z)
    }
    if (radius > 0) {
      if (st.ends !== 'top') mark(x, g, z)
      if (st.ends !== 'ground') mark(x, g + dy, z)
    }
  }

  const positions = new Float32Array(pos)
  const colors = new Float32Array(positions.length)
  for (let i = 0; i < colors.length; i += 3) { colors[i] = rgb[0]; colors[i + 1] = rgb[1]; colors[i + 2] = rgb[2] }
  return { positions, colors }
}

/**
 * The outline of a stencil, as chained polylines in scene x and z: marching
 * squares at 0.5 over the kept cells, with everything off the grid read as
 * not kept, so every outline closes.
 *
 * @returns {Float64Array[]} each a flat [x, z, x, z, …] run
 */
export function maskOutline(terrain) {
  const { rows, cols, scl, halfW, halfH, gridMask: mask } = terrain
  const on = (r, c) => (r >= 0 && c >= 0 && r < rows && c < cols && (!mask || mask[r * cols + c]) ? 1 : 0)
  const X = (c) => c * scl - halfW, Z = (r) => r * scl - halfH
  // Edge midpoints of the square with corners (r, c) … (r + 1, c + 1), keyed
  // so two squares sharing an edge give the same point.
  const key = (a, b) => `${a},${b}`
  const segs = []
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const tl = on(r, c), tr = on(r, c + 1), br = on(r + 1, c + 1), bl = on(r + 1, c)
      const code = tl * 8 + tr * 4 + br * 2 + bl
      if (code === 0 || code === 15) continue
      // Edges as doubled grid coordinates: top (2r, 2c+1), right (2r+1, 2c+2),
      // bottom (2r+2, 2c+1), left (2r+1, 2c).
      const T = [2 * r, 2 * c + 1], R = [2 * r + 1, 2 * c + 2], B = [2 * r + 2, 2 * c + 1], L = [2 * r + 1, 2 * c]
      const pairs = {
        1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[L, T], [B, R]], 6: [[T, B]], 7: [[L, T]],
        8: [[L, T]], 9: [[T, B]], 10: [[T, R], [L, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]],
      }[code]
      for (const [a, b] of pairs) segs.push([a, b])
    }
  }
  // Chain: each midpoint touches at most two segments.
  const at = new Map()
  segs.forEach(([a, b], i) => {
    for (const q of [a, b]) {
      const k = key(q[0], q[1])
      const list = at.get(k)
      if (list) list.push(i); else at.set(k, [i])
    }
  })
  const used = new Uint8Array(segs.length)
  const runs = []
  const pt = (q) => [X(q[1] / 2), Z(q[0] / 2)]
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const chain = [segs[i][0], segs[i][1]]
    for (const dir of [1, 0]) {
      for (;;) {
        const end = dir ? chain[chain.length - 1] : chain[0]
        const next = (at.get(key(end[0], end[1])) ?? []).find((j) => !used[j])
        if (next === undefined) break
        used[next] = 1
        const [a, b] = segs[next]
        const far = a[0] === end[0] && a[1] === end[1] ? b : a
        if (dir) chain.push(far); else chain.unshift(far)
      }
    }
    const flat = new Float64Array(chain.length * 2)
    chain.forEach((q, n) => { const [x, z] = pt(q); flat[2 * n] = x; flat[2 * n + 1] = z })
    runs.push(flat)
  }
  return runs
}

const runLength = (run) => {
  let len = 0
  for (let i = 2; i < run.length; i += 2) len += Math.hypot(run[i] - run[i - 2], run[i + 1] - run[i - 1])
  return len
}

/** The most fence posts one run may set, so a busy stencil stays plottable. */
const MAX_FENCE_POINTS = 400

/**
 * Plumb fence: points every `spacing` cells along each outline run. Runs
 * shorter than two spacings are specks and get none.
 *
 * @returns {{ x: number, z: number }[]}
 */
export function fencePoints(runs, terrain, spacing) {
  const step = Math.max(1, spacing) * terrain.scl
  const out = []
  const sorted = [...runs].sort((a, b) => runLength(b) - runLength(a))
  for (const run of sorted) {
    if (runLength(run) < 2 * step) continue
    let carry = step / 2
    for (let i = 2; i < run.length; i += 2) {
      const x0 = run[i - 2], z0 = run[i - 1], x1 = run[i], z1 = run[i + 1]
      const seg = Math.hypot(x1 - x0, z1 - z0)
      while (carry <= seg) {
        const f = carry / seg
        out.push({ x: x0 + (x1 - x0) * f, z: z0 + (z1 - z0) * f })
        if (out.length >= MAX_FENCE_POINTS) return out
        carry += step
      }
      carry -= seg
    }
  }
  return out
}

/**
 * Footprint: the outline runs draped on the ground, solid or dashed. Dashes
 * are geometry, as the plumb lines' are, at 1.5% of the plate's half width.
 */
export function buildFootprint(runs, terrain, groundAt, rgb, dashed) {
  const lift = Math.max(1e-3, (terrain.maxElev - terrain.minElev) * 0.002)
  const clampX = (x) => Math.min(terrain.halfW, Math.max(-terrain.halfW, x))
  const clampZ = (z) => Math.min(terrain.halfH, Math.max(-terrain.halfH, z))
  const y = (x, z) => groundAt(clampX(x), clampZ(z)) + lift
  const period = Math.max(terrain.halfW, terrain.halfH) * 0.015
  const pos = []
  for (const run of runs) {
    let s = 0
    for (let i = 2; i < run.length; i += 2) {
      const x0 = run[i - 2], z0 = run[i - 1], x1 = run[i], z1 = run[i + 1]
      const len = Math.hypot(x1 - x0, z1 - z0)
      const mid = s + len / 2
      s += len
      if (dashed && Math.floor(mid / period) % 2) continue
      const y0 = y(x0, z0), y1 = y(x1, z1)
      if (y0 !== y0 || y1 !== y1) continue
      pos.push(x0, y0, z0, x1, y1, z1)
    }
  }
  const positions = new Float32Array(pos)
  const colors = new Float32Array(positions.length)
  for (let i = 0; i < colors.length; i += 3) { colors[i] = rgb[0]; colors[i + 1] = rgb[1]; colors[i + 2] = rgb[2] }
  return { positions, colors }
}
