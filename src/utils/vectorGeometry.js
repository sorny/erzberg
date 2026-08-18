/**
 * Draping vector features onto the terrain — the worker-side half of the vector
 * layer feature.
 *
 * Every layer comes out shaped exactly like the fourteen draw modes
 * (`{ id, positions, colors, curtains, lids, isPoints }`), which is what buys it
 * the live renderer, depth occlusion, hidden-line removal and SVG export without
 * any of those knowing that OpenStreetMap exists. This generalises the single
 * GPX track builder that used to live in geometryBuilders.js; the coordinate
 * path is the same one, and the comments there about NaN and clipping still
 * apply here.
 *
 * Three things are genuinely new relative to the GPX case:
 *
 *  • **Densification.** A GPX track is recorded every few seconds, so its points
 *    already sit closer together than the grid. An OSM way is *drawn*, and a
 *    straight motorway can run 400 m between nodes. Joining those two nodes with
 *    one 3D segment puts the road through the ridge between them, so every
 *    segment is subdivided down to the grid step before it is sampled.
 *
 *  • **Simplification.** The opposite problem at the other end: a digitised
 *    riverbank carries far more detail than a 30 m DEM can express. Douglas–
 *    Peucker at half a pixel throws away what the terrain cannot show anyway,
 *    and it runs *before* densification so the two do not fight.
 *
 *  • **Fills.** Areas are stroked as closed rings, and optionally filled by
 *    scanning them into a lattice in pixel space. Emitting one quad per lattice
 *    cell rather than triangulating the ring is what makes the fill conform to
 *    the ground: every corner takes its own elevation sample, so the surface
 *    follows the slope instead of being a flat lid hanging over it. It also
 *    means holes and multi-part polygons come free from the even-odd rule
 *    rather than needing a triangulator.
 *
 * Budgets are enforced per layer and reported, never silently applied. A layer
 * that quietly drew half of itself would look exactly like a layer whose data is
 * half missing.
 */

import { F32List, U32List, simplifyFlat } from './geometryBuilders'
import { classifyCRS, isProjectable, projectWgs84, sampleTerrainElev } from './geoCoords'

// Small Y lift so strokes never clip into the terrain surface, and a smaller one
// for fills so they sit under their own outline rather than z-fighting it.
const VEC_Y_OFFSET = 0.5
const FILL_Y_OFFSET = 0.2

// Douglas–Peucker tolerance, in source pixels. Half a pixel is below what the
// raster can represent, so nothing visible is lost.
const SIMPLIFY_EPS_PX = 0.5

// Ceilings per layer. Both are generous for a sane extent and exist to keep a
// mis-aimed "everything in 400 km²" fetch from wedging the tab.
const MAX_SEGMENTS = 400_000
const MAX_FILL_CELLS = 300_000

// Sub-segments a single edge may be split into. A feature whose nodes are
// further apart than this many grid steps is broken terrain data, not a road.
const MAX_SUBDIV = 4096

/**
 * Growable Int32Array that back-fills a run at a time.
 *
 * The emit loop does not know how many segments a feature produced until it has
 * finished producing them — densification and NoData breaks both change the
 * count — so this is written as "everything up to here belongs to feature k"
 * rather than one push per segment.
 */
class I32SegList {
  constructor(cap = 4096) { this.a = new Int32Array(cap); this.n = 0 }
  fillTo(end, value) {
    if (end <= this.n) return
    if (end > this.a.length) {
      let cap = this.a.length * 2
      while (cap < end) cap *= 2
      const next = new Int32Array(cap)
      next.set(this.a.subarray(0, this.n))
      this.a = next
    }
    this.a.fill(value, this.n, end)
    this.n = end
  }
  toArray() { return this.n === this.a.length ? this.a : this.a.subarray(0, this.n) }
}

// ── Projection ────────────────────────────────────────────────────────────────

/**
 * One WGS84 coordinate → fractional pixel column and row, written into `out`.
 *
 * Unclamped on purpose: a way that leaves the raster and comes back must keep
 * its true shape so densification puts real vertices on the edge crossing.
 * Bounds are tested per densified vertex further down instead.
 *
 * The geographic fast path skips `projectWgs84` entirely — it is the identity
 * there, and this is the inner loop over every coordinate in the fetch.
 */
function projectPoint(lon, lat, ctx, out) {
  let x, y
  if (ctx.geographic) {
    x = lon; y = lat
  } else {
    const xy = projectWgs84(lat, lon, ctx.crs)
    if (!xy) return false
    x = xy[0]; y = xy[1]
  }
  out[0] = (x - ctx.minX) * ctx.sx
  out[1] = (ctx.maxY - y) * ctx.sy
  return true
}

/** A [lon, lat, …] ring → fractional [col, row, …] pixel coordinates. */
function projectRing(coords, from, to, ctx, out) {
  const { minX, maxY, sx, sy, geographic, crs } = ctx
  let w = 0
  for (let i = from * 2; i < to * 2; i += 2) {
    let x, y
    if (geographic) {
      x = coords[i]; y = coords[i + 1]
    } else {
      const xy = projectWgs84(coords[i + 1], coords[i], crs)
      if (!xy) return 0
      x = xy[0]; y = xy[1]
    }
    out[w++] = (x - minX) * sx
    out[w++] = (maxY - y) * sy
  }
  return w
}

// ── Strokes ───────────────────────────────────────────────────────────────────

/**
 * Walk one polyline, densified onto the grid and draped, calling `onVertex` for
 * every point that has ground under it and `onBreak` where the line leaves it.
 *
 * The break — rather than an end — is the important part: a road crossing a
 * clipped corner reappears on the far side instead of stopping at the hole, and
 * neither case drags a segment down to the base of the scene.
 *
 * `closed` adds the edge back from the last vertex to the first. An OSM closed
 * way and a GeoJSON polygon ring both repeat their first node at the end, so
 * this is normally a zero-length no-op — but "normally" is not "always", and a
 * lake outline with one edge missing is a conspicuous thing to leave to chance.
 *
 * Returning `false` from `onVertex` stops the walk; that is how the per-layer
 * segment budget is enforced without this function knowing about budgets.
 */
function walkDraped(px, n, closed, ctx, onVertex, onBreak) {
  const { terrain, scl, peakOff, lineOff, halfW, halfH,
          imageWidth, imageHeight, step } = ctx
  const edges = closed ? n : n - 1

  for (let i = 0; i < edges; i++) {
    const j = (i + 1) % n
    const c0 = px[i * 2], r0 = px[i * 2 + 1]
    const c1 = px[j * 2], r1 = px[j * 2 + 1]
    const dist = Math.hypot(c1 - c0, r1 - r0)
    const k = Math.min(MAX_SUBDIV, Math.max(1, Math.ceil(dist / step)))

    // The first vertex is visited only on the first edge; afterwards it is the
    // previous edge's last vertex and re-testing it would double the work.
    for (let s = i === 0 ? 0 : 1; s <= k; s++) {
      const t = s / k
      const col = c0 + (c1 - c0) * t
      const row = r0 + (r1 - r0) * t

      let ok = col >= 0 && col < imageWidth && row >= 0 && row < imageHeight
      let y = 0
      if (ok) {
        y = sampleTerrainElev(col, row, terrain, scl, peakOff, lineOff)
        ok = y === y   // NaN means NoData under the point
      }
      if (!ok) { onBreak(); continue }

      if (onVertex((col - peakOff) - halfW, y, (row - lineOff) - halfH) === false) return
    }
  }
}

/**
 * One polyline as GPU line segments.
 *
 * No per-vertex colour buffer: a vector layer is drawn in one colour, resolved
 * at render time by `layerStyle`. That is what keeps recolouring one a frame
 * rather than a worker rebuild.
 */
function emitPolyline(px, n, closed, ctx, positions) {
  let hasPrev = false, pX = 0, pY = 0, pZ = 0

  walkDraped(px, n, closed, ctx,
    (x, y, z) => {
      const wy = y + VEC_Y_OFFSET
      if (hasPrev) {
        positions.push6(pX, pY, pZ, x, wy, z)
        if (positions.length / 6 >= MAX_SEGMENTS) return false
      }
      pX = x; pY = wy; pZ = z
      hasPrev = true
      return true
    },
    () => { hasPrev = false })
}

/** Emit one dot per coordinate — peaks, saddles, GeoJSON points. */
function emitPoints(px, n, ctx, positions) {
  const { terrain, scl, peakOff, lineOff, halfW, halfH, imageWidth, imageHeight } = ctx
  // A LineSegments2 dot is a segment shorter than its own width; the same
  // trick the stipple layer uses.
  const eps = 0.01

  for (let i = 0; i < n; i++) {
    const col = px[i * 2], row = px[i * 2 + 1]
    if (!(col >= 0 && col < imageWidth && row >= 0 && row < imageHeight)) continue
    const y = sampleTerrainElev(col, row, terrain, scl, peakOff, lineOff)
    if (y !== y) continue

    const x = (col - peakOff) - halfW
    const z = (row - lineOff) - halfH
    positions.push6(x - eps, y + VEC_Y_OFFSET, z, x + eps, y + VEC_Y_OFFSET, z)
  }
}

// ── Fills ─────────────────────────────────────────────────────────────────────

/**
 * X coordinates where a polygon's rings cross the horizontal line y = `yc`.
 *
 * All rings of the polygon are scanned together and the crossings sorted, so
 * consuming them in pairs is the even-odd rule: the second ring of a lake with an
 * island subtracts from the first without anything here knowing which is which.
 * The half-open `(y0 <= yc) !== (y1 <= yc)` test is what stops a vertex lying
 * exactly on the scan line from being counted twice.
 */
function ringCrossings(px, ringStarts, nRings, yc, out) {
  let n = 0
  for (let r = 0; r < nRings; r++) {
    const from = ringStarts[r], to = ringStarts[r + 1]
    if (to - from < 3) continue
    let x0 = px[(to - 1) * 2], y0 = px[(to - 1) * 2 + 1]
    for (let i = from; i < to; i++) {
      const x1 = px[i * 2], y1 = px[i * 2 + 1]
      if ((y0 <= yc) !== (y1 <= yc)) out[n++] = x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0)
      x0 = x1; y0 = y1
    }
  }
  // TypedArray#sort is numeric, unlike Array#sort — no comparator needed, and
  // the subarray sorts in place inside the shared scratch.
  out.subarray(0, n).sort()
  return n
}

/**
 * Rasterise one polygon into terrain-conforming quads.
 *
 * `fs` is the lattice step in source pixels, chosen by the caller from the
 * layer's remaining budget: coarse enough that a valley full of forest does not
 * blow it, fine enough that a single building survives on a 30 m DEM. Cells
 * whose corners sit over NoData are dropped, so a fill stops at the edge of a
 * clipped raster instead of hanging in the air over it.
 */
function emitFill(px, ringStarts, nRings, fs, ctx, fillPos, fillIdx, budget) {
  const { terrain, scl, peakOff, lineOff, halfW, halfH, imageWidth, imageHeight } = ctx

  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity
  const total = ringStarts[nRings]
  for (let i = 0; i < total; i++) {
    const c = px[i * 2], r = px[i * 2 + 1]
    if (c < minC) minC = c
    if (c > maxC) maxC = c
    if (r < minR) minR = r
    if (r > maxR) maxR = r
  }
  if (!(maxC > minC && maxR > minR)) return 0

  const gx0 = Math.max(0, Math.floor(minC / fs))
  const gx1 = Math.min(Math.ceil(imageWidth / fs), Math.ceil(maxC / fs))
  const gy0 = Math.max(0, Math.floor(minR / fs))
  const gy1 = Math.min(Math.ceil(imageHeight / fs), Math.ceil(maxR / fs))
  if (gx1 <= gx0 || gy1 <= gy0) return 0

  // At most one crossing per edge, so the polygon's own vertex count is the
  // ceiling. Sizing it any smaller would drop crossings, and a dropped crossing
  // does not thin the fill — it inverts everything to its right.
  const xs = new Float64Array(Math.max(8, total))
  let cells = 0

  for (let gy = gy0; gy < gy1; gy++) {
    const yc = (gy + 0.5) * fs
    const n = ringCrossings(px, ringStarts, nRings, yc, xs)

    for (let s = 0; s + 1 < n; s += 2) {
      const a = xs[s], b = xs[s + 1]
      const i0 = Math.max(gx0, Math.ceil(a / fs - 0.5))
      const i1 = Math.min(gx1 - 1, Math.floor(b / fs - 0.5))

      for (let gx = i0; gx <= i1; gx++) {
        if (cells >= budget) return cells

        const c0 = gx * fs, c1 = (gx + 1) * fs
        const r0 = gy * fs, r1 = (gy + 1) * fs
        const e00 = sampleTerrainElev(c0, r0, terrain, scl, peakOff, lineOff)
        const e10 = sampleTerrainElev(c1, r0, terrain, scl, peakOff, lineOff)
        const e11 = sampleTerrainElev(c1, r1, terrain, scl, peakOff, lineOff)
        const e01 = sampleTerrainElev(c0, r1, terrain, scl, peakOff, lineOff)
        if (e00 !== e00 || e10 !== e10 || e11 !== e11 || e01 !== e01) continue

        const x0 = (c0 - peakOff) - halfW, x1 = (c1 - peakOff) - halfW
        const z0 = (r0 - lineOff) - halfH, z1 = (r1 - lineOff) - halfH
        const base = fillPos.length / 3

        fillPos.push3(x0, e00 + FILL_Y_OFFSET, z0)
        fillPos.push3(x1, e10 + FILL_Y_OFFSET, z0)
        fillPos.push3(x1, e11 + FILL_Y_OFFSET, z1)
        fillPos.push3(x0, e01 + FILL_Y_OFFSET, z1)
        fillIdx.push3(base, base + 1, base + 2)
        fillIdx.push3(base, base + 2, base + 3)
        cells++
      }
    }
  }
  return cells
}

/**
 * Lattice step for a layer's fills.
 *
 * Half a grid cell is the target — fine enough to keep small buildings, and
 * still coarser than the elevation data underneath. When the layer's polygons
 * cover more area than the budget allows, the step is coarsened rather than the
 * geometry truncated: a lake drawn a little blockier is a better failure than
 * three quarters of a lake.
 */
function fillStep(areaPx, scl) {
  const ideal = Math.max(0.5, scl / 2)
  const cells = areaPx / (ideal * ideal)
  if (cells <= MAX_FILL_CELLS) return ideal
  return ideal * Math.sqrt(cells / MAX_FILL_CELLS)
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * The invariants every draping pass shares: where the raster is, how its extent
 * maps to pixels, and how finely a line has to be cut to follow the ground.
 */
function drapeContext(terrain, p, imageWidth, imageHeight) {
  const { geoTiffBbox: bbox, geoTiffCRS: crs } = p
  if (!isProjectable(crs, bbox)) return null
  const { scl, halfW, halfH } = terrain
  const [minX, minY, maxX, maxY] = bbox
  return {
    terrain, scl, halfW, halfH,
    peakOff: Math.floor(p.gridOffsetX ?? 0),
    lineOff: Math.floor(p.gridOffsetY ?? 0),
    imageWidth, imageHeight,
    crs,
    // Extent → pixel mapping, hoisted out of the per-coordinate loop.
    minX, maxY,
    sx: imageWidth / (maxX - minX),
    sy: imageHeight / (maxY - minY),
    geographic: classifyCRS(crs).kind === 'geographic',
    // Densify to the grid: one sub-segment per cell is exactly the resolution
    // the elevation is known at, so a finer step would interpolate rather than
    // reveal anything.
    step: Math.max(1, scl),
  }
}

// Scratch for the projected rings of one polygon, and for the simplifier's
// output. Module-level and grown on demand, in the same spirit as the chain and
// smoothing scratch in geometryBuilders.js: a bucket is tens of thousands of
// polygons, and a fresh pair of arrays per polygon is pure GC pressure.
let _pxBuf = new Float64Array(4096)
let _simpBuf = new Float64Array(4096)
let _ringStarts = new Int32Array(64)

/**
 * Project one bucket's polygons, handing each to `onPolygon` as a projected
 * pixel buffer plus its ring boundaries.
 *
 * Rings of a polygon are kept together because the fill needs them that way —
 * even-odd across a ring and its holes is what makes an island an island.
 * Returning `false` from `onPolygon` stops the walk.
 */
function forEachProjectedPolygon(bucket, ctx, onPolygon, skip = null) {
  const { coords, rings, polys } = bucket

  for (let poly = 0; poly < polys.length - 1; poly++) {
    // Hidden features are skipped here, but every index handed onward is still
    // the feature's original one — hiding a peak must not renumber the rest,
    // or the panel's checkboxes would shuffle under the cursor.
    if (skip?.has(poly)) continue
    const rFrom = polys[poly], rTo = polys[poly + 1]
    if (rTo <= rFrom) continue

    let need = 0
    for (let r = rFrom; r < rTo; r++) need += (rings[r + 1] - rings[r]) * 2
    if (_pxBuf.length < need) _pxBuf = new Float64Array(need * 2)
    if (_simpBuf.length < need) _simpBuf = new Float64Array(need * 2)

    const nRings = rTo - rFrom
    if (_ringStarts.length < nRings + 1) _ringStarts = new Int32Array(nRings + 1)
    const starts = _ringStarts

    let w = 0, bad = false
    for (let r = rFrom; r < rTo; r++) {
      starts[r - rFrom] = w >> 1
      const written = projectRing(coords, rings[r], rings[r + 1], ctx, _pxBuf.subarray(w))
      if (written === 0) { bad = true; break }
      w += written
    }
    if (bad) continue
    starts[nRings] = w >> 1

    if (onPolygon(_pxBuf, starts, nRings, poly) === false) return
  }
}

/**
 * Build every visible vector layer as a `lineGeo`-shaped entry.
 *
 * `sources` is the packed form from utils/vectorLayers.js; `p.vectorLayers` is
 * the style/visibility side. Layers whose source has gone away are skipped
 * rather than throwing — removal is two state updates and they can be observed
 * out of order.
 */
export function buildVectorGeometry(terrain, p, sources, imageWidth, imageHeight) {
  const layers = p.vectorLayers
  if (!layers?.length || !sources?.length) return []
  const ctx = drapeContext(terrain, p, imageWidth, imageHeight)
  if (!ctx) return []

  const byId = new Map(sources.map((s) => [s.id, s]))
  const out = []

  for (const layer of layers) {
    if (!layer.visible) continue
    const bucket = byId.get(layer.sourceId)?.buckets.find((b) => b.key === layer.bucket)
    if (!bucket?.count) continue

    const isArea = bucket.geom === 'area'
    const isPoint = bucket.geom === 'point'

    const positions = new F32List()
    // One entry per emitted segment, naming the feature it came from. This is
    // the whole link between a pixel on screen and a row in the panel:
    // LineSegments2.raycast reports the segment index it hit, and this turns
    // that into something with a name. It is also how the highlight extracts
    // one feature's segments without a worker round trip.
    const featureOfSegment = new I32SegList()
    const wantFill = isArea && layer.fill
    const fillPos = wantFill ? new F32List() : null
    const fillIdx = wantFill ? new U32List() : null
    const fs = wantFill ? fillStep(bucketAreaPx(bucket, ctx), ctx.scl) : 0

    let fillCells = 0
    let truncated = false

    const hidden = layer.hidden?.length ? new Set(layer.hidden) : null

    forEachProjectedPolygon(bucket, ctx, (px, starts, nRings, poly) => {
      if (wantFill) {
        fillCells += emitFill(px, starts, nRings, fs, ctx, fillPos, fillIdx,
                              MAX_FILL_CELLS - fillCells)
        if (fillCells >= MAX_FILL_CELLS) truncated = true
      }

      // Strokes are per ring: a polygon's holes are drawn as their own outlines,
      // which is what an island in a lake should look like.
      if (!truncated) {
        for (let r = 0; r < nRings; r++) {
          const from = starts[r], to = starts[r + 1]
          const n = to - from
          if (n < 1) continue
          const ring = px.subarray(from * 2, to * 2)

          if (isPoint) { emitPoints(ring, n, ctx, positions); continue }
          if (n < 2) continue

          const simplified = simplifyFlat(ring, SIMPLIFY_EPS_PX, _simpBuf)
          emitPolyline(simplified, simplified.length / 2, isArea, ctx, positions)
          if (positions.length / 6 >= MAX_SEGMENTS) { truncated = true; break }
        }
      }
      // Always, and on the single exit path: `featureOfSegment` has to stay
      // exactly as long as the segment list, or every lookup after the first
      // gap names the wrong feature.
      featureOfSegment.fillTo(positions.length / 6, poly)
      return !truncated
    }, hidden)

    if (positions.length === 0 && !fillPos?.length) continue

    out.push({
      id: layer.id,
      positions: positions.toArray(),
      // Never per-vertex: a vector layer is one colour, resolved at render time.
      colors: null,
      curtains: null,
      lids: null,
      isPoints: isPoint,
      featureOfSegment: featureOfSegment.toArray(),
      fills: fillPos?.length ? { positions: fillPos.toArray(), indices: fillIdx.toArray() } : null,
      truncated,
    })
  }

  return out
}

/**
 * Total pixel area the bucket's polygons cover, from their bounding boxes.
 *
 * Two projections per polygon rather than one per vertex: this only has to pick
 * a lattice step, and overlapping boxes erring on the generous side is the safe
 * direction to be wrong in.
 */
function bucketAreaPx(bucket, ctx) {
  const { coords, rings, polys } = bucket
  const lo = [0, 0], hi = [0, 0]
  let area = 0
  for (let poly = 0; poly < polys.length - 1; poly++) {
    const r0 = polys[poly]
    if (polys[poly + 1] <= r0) continue
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (let i = rings[r0]; i < rings[r0 + 1]; i++) {
      const lon = coords[i * 2], lat = coords[i * 2 + 1]
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
    if (!projectPoint(minLon, minLat, ctx, lo)) continue
    if (!projectPoint(maxLon, maxLat, ctx, hi)) continue
    area += Math.abs(hi[0] - lo[0]) * Math.abs(hi[1] - lo[1])
  }
  return area
}

/**
 * One layer's features as continuous draped runs of `{ worldX, worldZ, e }` —
 * the shape the STL ribbon builder wants.
 *
 * Shares the whole coordinate path with the viewport build, densification
 * included, so a ribbon follows exactly the line the screen shows rather than
 * cutting a chord through the ridge between two OSM nodes. Points are excluded:
 * a ribbon needs a direction, and a summit marker has none.
 */
export function drapedRuns(terrain, p, sources, layer, imageWidth, imageHeight) {
  const ctx = drapeContext(terrain, p, imageWidth, imageHeight)
  if (!ctx) return []
  const bucket = sources?.find((s) => s.id === layer.sourceId)
    ?.buckets.find((b) => b.key === layer.bucket)
  if (!bucket?.count || bucket.geom === 'point') return []

  const closed = bucket.geom === 'area'
  const runs = []
  let cur = []
  const flush = () => { if (cur.length >= 2) runs.push(cur); cur = [] }

  forEachProjectedPolygon(bucket, ctx, (px, starts, nRings) => {
    for (let r = 0; r < nRings; r++) {
      const from = starts[r], to = starts[r + 1]
      if (to - from < 2) continue
      const simplified = simplifyFlat(px.subarray(from * 2, to * 2), SIMPLIFY_EPS_PX, _simpBuf)
      walkDraped(simplified, simplified.length / 2, closed, ctx,
        (x, y, z) => { cur.push({ worldX: x, worldZ: z, e: y }); return true },
        flush)
      flush()
    }
    return true
  })

  return runs
}
