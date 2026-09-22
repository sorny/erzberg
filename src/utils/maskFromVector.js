/**
 * Turning loaded features into regions on the raster.
 *
 * Two consumers. Masks rasterise a feature into a stencil plane
 * (`maskFromFeatures`); Edit Mode turns one into a clip outline in source pixel
 * coordinates (`featureRings`). Both need the same two awkward steps first —
 * stitching a relation's member ways into the loop they describe, and deciding
 * whether a thing drawn as a line is really an area — so those live here once.
 *
 * A mask is a region you mean. Sometimes you mean something you have to draw by
 * hand, and the Studio is for that. Often you mean something a map already
 * knows the shape of — this forest, that lake, everything within fifty metres
 * of the river — and drawing it by hand is tracing an outline the app is
 * already holding.
 *
 * ── Why every geometry kind is accepted ──────────────────────────────────────
 * "Suitable for a mask" looks at first like it means areas only, and it does
 * not. A line and a point become regions the moment they are given a width,
 * and those are the two most useful masks over a valley: a corridor along the
 * watercourse, and a disc around each summit. So all three are offered and the
 * width control simply means different things:
 *
 *   • `area`  — filled, holes cut out. Width grows or shrinks the result.
 *   • `line`  — stroked to a corridor. Width is the corridor's half-width.
 *   • `point` — one disc per feature. Width is its radius.
 *
 * ── Why even-odd and not winding ─────────────────────────────────────────────
 * A feature's rings arrive outer-first with holes after it, and neither
 * OpenStreetMap nor GeoJSON guarantees the winding direction of either. Nonzero
 * winding would therefore fill some holes and cut others depending on which way
 * the surveyor happened to trace them. Even-odd does not care, and a hole is
 * unambiguously inside-an-odd-number-of-rings whichever way round it goes.
 *
 * ── Which grid ───────────────────────────────────────────────────────────────
 * The source raster, exactly as `maskLayers.js` requires — never the cropped
 * one. An Edit Mode clip can be moved or cleared at any time and the store
 * crops masks on the way through.
 */
import { geoToPixel } from './geoCoords'
import { stamp, stroke } from './maskLayers'

/** Metres per degree of latitude. Good to a fraction of a per cent anywhere. */
const M_PER_DEG_LAT = 110574

/**
 * Whether a bucket can become a mask at all.
 *
 * Only two things disqualify one: no coordinates, and a raster with no extent
 * to project them against. Geometry kind never does — see the header.
 */
export function canMakeMask(bucket, raster) {
  return !!(bucket?.coords?.length && raster?.bbox && raster?.crs
            && raster.width > 0 && raster.height > 0)
}

/**
 * How many raster pixels a distance in metres is.
 *
 * Read off the raster's own extent rather than assumed, because the two CRS
 * families measure their bounding boxes in different units: a projected raster
 * states metres and a geographic one states degrees. Getting this wrong does
 * not throw — it silently produces a corridor a hundred thousand times too
 * wide, which is a filled rectangle and looks like a broken fill.
 */
export function pixelsPerMetre(raster) {
  const [x0, y0, x1, y1] = raster.bbox
  const spanY = Math.abs(y1 - y0)
  if (!spanY) return 0
  const geographic = Math.abs(x1 - x0) <= 360 && Math.abs(y1) <= 90 && Math.abs(y0) <= 90
  const groundY = geographic ? spanY * M_PER_DEG_LAT : spanY
  return raster.height / Math.max(1e-9, groundY)
}

/**
 * A mask plane from one packed bucket.
 *
 * Two ways to narrow what goes in, and they answer different questions.
 *
 * `hidden` is the *layer's* own list — the features switched off in the panel,
 * which are not drawn and so must not be stencilled either. Someone who
 * switched three lakes off and then asked for a mask of the lakes did not mean
 * those three.
 *
 * `only` is the *mask's* list — an explicit pick, made for this stencil alone.
 * A person who wants a mask of one district out of seventeen should not have to
 * hide the other sixteen from the drawing to get it. When `only` is given it is
 * the whole answer and `hidden` is not consulted, because the pick was made
 * against a list that already showed which were hidden.
 */
export function maskFromFeatures(bucket, raster, {
  geom = bucket?.geom ?? 'area', widthM = 0, hidden = null, only = null, grow = 0,
  fill = null,
} = {}) {
  const { width: w, height: h } = raster
  const data = new Uint8Array(w * h)
  if (!canMakeMask(bucket, raster)) return data

  const { coords, rings, polys } = bucket
  const keep = only ? (only instanceof Set ? only : new Set(only)) : null
  const skip = !keep && hidden?.length ? new Set(hidden) : null
  const perM = pixelsPerMetre(raster)
  const widthPx = Math.max(0, widthM * perM)

  // Projected lazily per ring and thrown away after: an alpine extent with
  // buildings is a few hundred thousand ways, and holding every one of them in
  // pixel space at once costs more than re-projecting the few that overlap.
  const project = (from, to, out) => {
    let n = 0
    for (let k = from; k < to; k++) {
      const px = geoToPixel(coords[k * 2 + 1], coords[k * 2], raster.bbox, raster.crs, w, h)
      if (!px) return 0
      out[n++] = px.col; out[n++] = px.row
    }
    return n >> 1
  }

  let buf = new Float64Array(1024)
  const need = (pairs) => { if (buf.length < pairs * 2) buf = new Float64Array(pairs * 2) }

  for (let p = 0; p + 1 < polys.length; p++) {
    if (keep ? !keep.has(p) : skip?.has(p)) continue
    const r0 = polys[p], r1 = polys[p + 1]

    if (geom === 'point') {
      // Every coordinate is its own feature here, so the radius applies to each
      // rather than to the feature as a whole.
      for (let r = r0; r < r1; r++) {
        for (let k = rings[r]; k < rings[r + 1]; k++) {
          const px = geoToPixel(coords[k * 2 + 1], coords[k * 2], raster.bbox, raster.crs, w, h)
          if (px) stamp(data, w, h, px.col, px.row, Math.max(1, widthPx))
        }
      }
      continue
    }

    if (geom === 'line') {
      // A line layer that closes is an area wearing a line's clothes — an
      // administrative boundary is the standard case. `fill` left null means
      // "fill it if it encloses anything", which is what somebody asking for a
      // mask of a municipality meant; false forces the corridor, which is how
      // you say "within fifty metres of the border".
      const loops = stitchRings(ringsOfFeature(coords, rings, r0, r1))
      const wanted = fill ?? loops.some((l) => l.closed)
      if (wanted && loops.some((l) => l.closed)) {
        fillLoops(data, w, h, loops.filter((l) => l.closed).map((l) => l.pts), raster)
        continue
      }
      for (let r = r0; r < r1; r++) {
        const n = rings[r + 1] - rings[r]
        need(n)
        const got = project(rings[r], rings[r + 1], buf)
        const rad = Math.max(0.5, widthPx)
        for (let i = 0; i + 1 < got; i++) {
          stroke(data, w, h, buf[i * 2], buf[i * 2 + 1], buf[i * 2 + 2], buf[i * 2 + 3], rad)
        }
      }
      continue
    }

    // Areas are stitched too. A `landuse=forest` multipolygon arrives as its
    // member ways exactly as a boundary does, and one whose outline is split
    // across several of them would otherwise fill as slivers.
    const loops = stitchRings(ringsOfFeature(coords, rings, r0, r1))
    fillLoops(data, w, h, loops.map((l) => l.pts), raster)
  }

  if (grow) growMask(data, w, h, grow * perM)
  else if (geom === 'area' && widthM) growMask(data, w, h, widthM * perM)
  return data
}

/**
 * Join a feature's rings end to end into the loops they actually describe.
 *
 * Overpass returns a relation as its member ways, and `ringsOf` keeps one ring
 * per member. For a multipolygon that is usually harmless; for an
 * administrative boundary it is the whole problem. Jakomini, one of Graz's
 * seventeen districts, arrives as **seven open segments, none of them closed** —
 * filling each separately paints seven slivers, and treating the layer as lines
 * paints its outline and nothing inside.
 *
 * So segments that share an endpoint are walked into one loop first. OSM member
 * ways meet at a *shared node*, so their coordinates are bit-identical and an
 * exact key is correct — a tolerance here would join two districts that merely
 * pass close to one another.
 *
 * Returns `{ pts, closed }` per loop, in lon/lat. Stitching happens before
 * projection on purpose: after it, float error would have to be tolerated, and
 * that is the ambiguity this avoids.
 */
export function stitchRings(loops) {
  if (loops.length < 2) {
    return loops.map((pts) => ({ pts, closed: isClosed(pts) }))
  }
  const key = (x, y) => `${x},${y}`
  const ends = new Map()          // endpoint key → ring indices touching it
  const used = new Array(loops.length).fill(false)

  loops.forEach((pts, i) => {
    if (isClosed(pts)) return     // already a loop; nothing to join it to
    for (const k of [key(pts[0], pts[1]), key(pts[pts.length - 2], pts[pts.length - 1])]) {
      if (!ends.has(k)) ends.set(k, [])
      ends.get(k).push(i)
    }
  })

  const out = []
  for (let i = 0; i < loops.length; i++) {
    if (used[i]) continue
    const pts = loops[i]
    if (isClosed(pts)) { used[i] = true; out.push({ pts, closed: true }); continue }

    used[i] = true
    const acc = Array.from(pts)
    // Walk forward from the tail, flipping any segment that meets it backwards.
    for (;;) {
      const tail = key(acc[acc.length - 2], acc[acc.length - 1])
      const next = (ends.get(tail) ?? []).find((j) => !used[j])
      if (next === undefined) break
      used[next] = true
      const seg = loops[next]
      const headFirst = key(seg[0], seg[1]) === tail
      if (headFirst) for (let k = 2; k < seg.length; k += 2) acc.push(seg[k], seg[k + 1])
      else for (let k = seg.length - 4; k >= 0; k -= 2) acc.push(seg[k], seg[k + 1])
      if (key(acc[acc.length - 2], acc[acc.length - 1]) === key(acc[0], acc[1])) break
    }
    const joined = Float64Array.from(acc)
    out.push({ pts: joined, closed: isClosed(joined) })
  }
  return out
}

/** Whether a polyline ends where it began. */
function isClosed(pts) {
  return pts.length >= 6
    && pts[0] === pts[pts.length - 2]
    && pts[1] === pts[pts.length - 1]
}

/**
 * Whether a feature encloses a region — and so whether filling it means
 * anything at all.
 *
 * Read off the geometry rather than off the layer's `geom`, because `geom` says
 * how a layer is *drawn* and not what it is. Admin boundaries are drawn as
 * lines, and a municipality is unambiguously an area.
 */
export function enclosesRegion(bucket, only = null, limit = ENCLOSE_SCAN) {
  if (!bucket?.polys) return false
  const { coords, rings, polys } = bucket
  const keep = only ? (only instanceof Set ? only : new Set(only)) : null
  let scanned = 0
  for (let p = 0; p + 1 < polys.length; p++) {
    if (keep && !keep.has(p)) continue
    if (scanned++ >= limit) break
    const loops = ringsOfFeature(coords, rings, polys[p], polys[p + 1])
    if (stitchRings(loops).some((l) => l.closed)) return true
  }
  return false
}

/**
 * How many features to look at before concluding a layer encloses nothing.
 *
 * This runs to decide whether to *offer* a Fill switch, and the answer is the
 * same after two features as after two hundred thousand. A roads layer over a
 * province is a million points, and stitching all of them to confirm that roads
 * are not rings would stall the panel on every change of selection. Anything
 * that genuinely closes does so in its first few features.
 */
const ENCLOSE_SCAN = 64

/**
 * A feature's rings as plain lon/lat arrays.
 *
 * Two points is enough to keep. A ring needs three to enclose anything, but a
 * *segment* of a boundary is routinely a straight line between two nodes, and
 * dropping those here would leave the stitcher a chain with holes in it —
 * which then fails to close, which then silently falls back to tracing the
 * outline. `fillLoops` applies the three-point rule where it belongs.
 */
function ringsOfFeature(coords, rings, r0, r1) {
  const out = []
  for (let r = r0; r < r1; r++) {
    const n = (rings[r + 1] - rings[r]) * 2
    if (n < 4) continue
    out.push(coords.subarray(rings[r] * 2, rings[r] * 2 + n))
  }
  return out
}

/**
 * Even-odd scanline fill of one feature's loops, taken together.
 *
 * Together and not one at a time: that is what cuts the holes. Filling each
 * loop separately and unioning the results would paint the holes solid, which
 * is the classic version of this bug and looks correct until the first lake
 * with an island in it.
 *
 * Loops arrive in lon/lat and are projected here, once each.
 */
function fillLoops(data, w, h, lonLatLoops, raster) {
  const loops = []
  let minRow = Infinity, maxRow = -Infinity
  for (const src of lonLatLoops) {
    const n = src.length >> 1
    if (n < 3) continue
    const loop = new Float64Array(n * 2)
    let ok = true
    for (let k = 0; k < n; k++) {
      const px = geoToPixel(src[k * 2 + 1], src[k * 2], raster.bbox, raster.crs, w, h)
      if (!px) { ok = false; break }
      loop[k * 2] = px.col; loop[k * 2 + 1] = px.row
      if (px.row < minRow) minRow = px.row
      if (px.row > maxRow) maxRow = px.row
    }
    if (ok) loops.push(loop)
  }
  if (!loops.length) return

  const from = Math.max(0, Math.ceil(minRow - 0.5))
  const to = Math.min(h - 1, Math.floor(maxRow - 0.5))
  const xs = []
  for (let row = from; row <= to; row++) {
    const y = row + 0.5
    xs.length = 0
    for (const loop of loops) {
      const n = loop.length >> 1
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        const y0 = loop[i * 2 + 1], y1 = loop[j * 2 + 1]
        // Half-open in y, so a vertex exactly on the scanline is counted once
        // rather than twice — double-counting there leaves a one-pixel notch.
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          const t = (y - y0) / (y1 - y0)
          xs.push(loop[i * 2] + t * (loop[j * 2] - loop[i * 2]))
        }
      }
    }
    if (xs.length < 2) continue
    xs.sort((a, b) => a - b)
    const base = row * w
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.max(0, Math.ceil(xs[i] - 0.5))
      const b = Math.min(w - 1, Math.floor(xs[i + 1] - 0.5))
      for (let c = a; c <= b; c++) data[base + c] = 1
    }
  }
}

/**
 * A feature's closed loops, in source pixel coordinates.
 *
 * What Edit Mode needs to clip the heightmap to a municipality: the same
 * stitched, closed rings the mask fill uses, but handed over as an outline
 * rather than painted.
 *
 * **Simplified on the way out.** A district boundary is a few thousand nodes,
 * and at raster resolution almost all of them lie on a straight line between
 * their neighbours. Keeping them costs a vertex the editor has to draw sixty
 * times a second and a shape that is large in every preset and history entry,
 * and buys nothing a pixel can show. Douglas–Peucker at a third of a pixel is
 * invisible and typically removes nine tenths of them.
 */
export function featureRings(bucket, raster, { only = null, hidden = null, tolerance = 0.34 } = {}) {
  if (!canMakeMask(bucket, raster)) return []
  const { coords, rings, polys } = bucket
  const { width: w, height: h } = raster
  const keep = only ? (only instanceof Set ? only : new Set(only)) : null
  const skip = !keep && hidden?.length ? new Set(hidden) : null

  const out = []
  for (let p = 0; p + 1 < polys.length; p++) {
    if (keep ? !keep.has(p) : skip?.has(p)) continue
    for (const loop of stitchRings(ringsOfFeature(coords, rings, polys[p], polys[p + 1]))) {
      if (!loop.closed) continue
      const n = loop.pts.length >> 1
      const px = new Float64Array(n * 2)
      let ok = true
      for (let k = 0; k < n; k++) {
        const q = geoToPixel(loop.pts[k * 2 + 1], loop.pts[k * 2], raster.bbox, raster.crs, w, h)
        if (!q) { ok = false; break }
        px[k * 2] = q.col; px[k * 2 + 1] = q.row
      }
      if (!ok) continue
      const thin = tolerance > 0 ? simplifyRing(px, tolerance) : px
      if (thin.length >= 6) out.push(thin)
    }
  }
  return out
}

/**
 * Douglas–Peucker on a closed ring, iteratively rather than recursively.
 *
 * Recursion is the textbook form and it overflows the stack on the input this
 * actually gets: a coastline or a river-following boundary is tens of thousands
 * of nearly-collinear points, which is the degenerate case that recurses once
 * per point.
 */
export function simplifyRing(pts, tolerance) {
  const n = pts.length >> 1
  if (n < 4) return pts
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const tol2 = tolerance * tolerance
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    if (b <= a + 1) continue
    const ax = pts[a * 2], ay = pts[a * 2 + 1]
    const bx = pts[b * 2], by = pts[b * 2 + 1]
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    let worst = -1, worstD = 0
    for (let i = a + 1; i < b; i++) {
      const x = pts[i * 2], y = pts[i * 2 + 1]
      let d2
      if (len2 === 0) {
        d2 = (x - ax) * (x - ax) + (y - ay) * (y - ay)
      } else {
        let t = ((x - ax) * dx + (y - ay) * dy) / len2
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const px = ax + t * dx, py = ay + t * dy
        d2 = (x - px) * (x - px) + (y - py) * (y - py)
      }
      if (d2 > worstD) { worstD = d2; worst = i }
    }
    if (worstD > tol2 && worst > 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  const out = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
  return Float64Array.from(out)
}

/**
 * Grow (or shrink, for a negative radius) a mask by a distance in pixels.
 *
 * An exact Euclidean distance transform rather than repeated neighbour passes.
 * Iterated dilation grows a square or an octagon depending on the connectivity
 * chosen, and at the twenty-pixel radii a buffer around a river actually wants,
 * the difference between an octagon and a circle is plainly visible along every
 * straight bank.
 *
 * Felzenszwalb & Huttenlocher's two-pass parabola envelope: one pass down the
 * columns, one across the rows, linear in the number of pixels.
 */
export function growMask(data, w, h, radiusPx) {
  const r = Math.abs(radiusPx)
  if (r < 0.5) return data
  // Shrinking is growing the complement, so there is one implementation.
  const invert = radiusPx < 0
  const seed = new Float64Array(w * h)
  const INF = 1e20
  for (let i = 0; i < data.length; i++) {
    const on = invert ? !data[i] : !!data[i]
    seed[i] = on ? 0 : INF
  }
  edt(seed, w, h)
  const r2 = r * r
  for (let i = 0; i < data.length; i++) {
    const inside = seed[i] <= r2
    data[i] = (invert ? !inside : inside) ? 1 : 0
  }
  return data
}

/** Squared Euclidean distance transform, in place, over a w × h field. */
function edt(f, w, h) {
  const n = Math.max(w, h)
  const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1)
  const col = new Float64Array(h)

  for (let c = 0; c < w; c++) {
    for (let r = 0; r < h; r++) col[r] = f[r * w + c]
    edt1d(col, d, v, z, h)
    for (let r = 0; r < h; r++) f[r * w + c] = d[r]
  }
  const row = new Float64Array(w)
  for (let r = 0; r < h; r++) {
    const base = r * w
    for (let c = 0; c < w; c++) row[c] = f[base + c]
    edt1d(row, d, v, z, w)
    for (let c = 0; c < w; c++) f[base + c] = d[c]
  }
}

/** The 1-D transform: the lower envelope of parabolas rooted at each sample. */
function edt1d(f, d, v, z, n) {
  let k = 0
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q; z[k] = s; z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dq = q - v[k]
    d[q] = dq * dq + f[v[k]]
  }
}
