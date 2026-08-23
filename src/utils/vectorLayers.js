/**
 * The vector layer model — what every geo source (OpenStreetMap, GeoJSON, GPX)
 * normalises to, and the layer records the panel edits.
 *
 * Two shapes, deliberately split, mirroring the store's own rule that only data
 * which cannot live in React state belongs in zustand:
 *
 *   • A **source** holds coordinates. Heavy, immutable once imported, posted to
 *     the geometry worker, kept in the store.
 *   • A **layer** holds style. Light, mutable on every slider tick, kept in
 *     React state and merged onto the `p` param bus.
 *
 * They meet on `bucket`: one source produces several buckets (`roads:motorway`,
 * `water:stream`), and each bucket becomes exactly one layer. That is what makes
 * "Roads · Motorway" a thing the user can recolour without the coordinates ever
 * being touched, and what lets a preset re-apply a look to a *different* fetch of
 * the same area — buckets match by name, layer ids do not.
 *
 * ── The stack ────────────────────────────────────────────────────────────────
 * The layer array is a stack, and **index 0 is the top of it** — the layer drawn
 * last and therefore in front, the row at the top of the panel. That is the
 * convention every layer list the user has met already uses (QGIS, Photoshop,
 * Figma), and it is what makes "drag it to the top" mean what it looks like.
 *
 * It is the *opposite* of paint order, so the one place that turns a stack into
 * geometry — `merged` in hooks/useTerrainGeometry.js — reverses it. Nothing else
 * in the pipeline may assume array order is paint order.
 *
 * ── Why coordinates are packed rather than nested ────────────────────────────
 * An alpine extent with buildings is a few hundred thousand ways. As
 * `[{ rings: [[{lon, lat}, …] ] }]` that is millions of boxed objects: slow to
 * build, brutal to structured-clone into the worker, and it holds ~10× the
 * memory of the numbers it carries. Each bucket is therefore packed into three
 * flat typed arrays — see `packBucket` — which clone in one memcpy and are what
 * the draping and fill loops want to read anyway.
 */

import { classifyCRS } from './geoCoords'

// ── Layer defaults ────────────────────────────────────────────────────────────

/**
 * Style seed for a new layer. Field names match what `ModeStyleOverride` in the
 * sidebar writes for the 14 draw modes, minus their `<prefix>` suffix — the
 * panel reuses that control block through an accessor, with the hypsometric
 * half switched off.
 *
 * No hypsometric tint: it would have to read the terrain under the feature
 * rather than the feature itself, which is a different thing from what the draw
 * modes mean by it and not what anyone wanted a road coloured by.
 */
export const VECTOR_LAYER_DEF = {
  visible: true,
  // Feature indices hidden inside this layer, sorted. Empty in the
  // overwhelmingly common case, which is why it is a plain array rather than a
  // Set — it has to serialise into a preset and into the worker's build key.
  hidden: [],
  color: '#a80000', weight: 2, opacity: 1, dash: 'solid',
  fill: false, fillColor: '#1a78c2', fillOpacity: 0.45,

  // Point layers only: an SVG icon drawn in place of the dot. All of these are
  // render-side — the worker never sees an icon — so none of them belong in
  // `layerBuildKey` and changing one is a frame rather than a rebuild.
  icon: null,             // manifest id, 'custom', or null for a plain dot
  iconSize: 18,           // world units, longest side
  iconLift: 0,            // world units above the point; > 0 draws a leader line
  iconFaceCamera: true,
  iconTilt: 50, iconSpin: 0,
  // Fills the closed shapes of a glyph, holes cut out. On by default, because
  // the icons are a map set drawn as silhouettes: a solid mountain is the
  // drawing, and the hollow outline of one is a wireframe of it. Viewport and
  // raster exports only — the SVG export is a line-art format and these are
  // triangles.
  iconFill: true,
  // ── The icon's own ink ────────────────────────────────────────────────────
  // A mark drawn from a layer is not the layer: a summit triangle wants a
  // heavier stroke than the road that shares its colour, and a glyph filled at
  // the weight of a 5-unit dot is a blob. So the icon carries a full set of its
  // own — stroke colour, width and opacity, then the same three for the fill.
  //
  // `null` means "the layer's", and the fill falls back through the icon's own
  // stroke before reaching it: colouring an icon colours the whole mark, and
  // parting its fill from its outline stays possible and stays deliberate.
  // Width is the exception, a real number: inheriting a point layer's weight
  // means inheriting its *dot diameter*, which is 5 for a peak.
  iconColor: null, iconWeight: 1.5, iconOpacity: null,
  iconFillColor: null, iconFillOpacity: null,
  // Where the stroke sits relative to the shape's edge — see `strokeOutside` in
  // `HeightmapLines`. Outside by default: a filled mark should keep the exact
  // silhouette it was drawn with, and a centred stroke eats half its width out
  // of it, which is what closes up a glyph's counters.
  iconStrokeOutside: true,
  iconCustom: null,       // { name, geo } from an uploaded SVG
  // ── Labels ────────────────────────────────────────────────────────────────
  // A point feature's own name and height, drawn on the terrain as geometry.
  // Both off by default: a fetch that silently wrote twenty-nine names across a
  // plot would be a surprise, and which of the two you want depends entirely on
  // what the plot is for. `labelHeight` draws the feature's note, which for a
  // point is what its `ele` tag said.
  labelName: false, labelHeight: false,
  labelSize: 9,           // world units per em — roughly the cap height
  labelDx: 0,             // world units across the label's plane, from the point
  labelDy: 22,            // …and up it, which is what clears an icon
  labelAlign: 'center',   // 'left' | 'center' | 'right', about the point
  labelFill: true,        // solid, like the icons; off leaves the outline
  // ── The label's own ink ───────────────────────────────────────────────────
  // The same six as the icon's, resolved the same way, and separate from them:
  // a plot that letters in grey over red summits is an ordinary thing to want,
  // and the weight that draws a triangle well closes up the counters of
  // nine-point type. Width is a real number here too, for the same reason.
  labelColor: null, labelWeight: 1, labelOpacity: null,
  labelFillColor: null, labelFillOpacity: null,
  labelStrokeOutside: true,
  // Four real faces, not a slant or a smear applied to one of them.
  labelBold: false, labelItalic: false,
  // A single-line face draws the skeleton of a letter rather than its outline,
  // so a plotter follows one stroke per stem instead of going round each glyph
  // twice. Off by default: the outline faces are what the app has always
  // lettered in, and this changes how every existing label plots.
  labelSingleLine: false,
  labelFont: 'HersheySans1',
  // Only 'gpx' sources default this on: the STL plate has always been shipped
  // with a track ribbon beside it, and OSM layers have no business there.
  stlRibbon: false,
}

/**
 * Colours handed to sources that bring no palette of their own (GeoJSON, GPX).
 * Kept dark and saturated, because the surface underneath is usually pale and
 * these are meant to read as ink.
 */
const FALLBACK_PALETTE = [
  '#a80000', '#0b6e4f', '#1d4ed8', '#b45309', '#6d28d9', '#be185d', '#0e7490', '#4d7c0f',
]

let paletteCursor = 0
export function nextFallbackColor() {
  return FALLBACK_PALETTE[paletteCursor++ % FALLBACK_PALETTE.length]
}

// ── Ids ───────────────────────────────────────────────────────────────────────
//
// A counter rather than a UUID: ids are created on the main thread only, they
// never leave the session, and `vec:7` is far easier to read in a `renderOrder`
// trace or a failing test than 36 hex digits.

let idSeq = 0
export const LAYER_ID_PREFIX = 'vec:'
export const isVectorLayerId = (id) => typeof id === 'string' && id.startsWith(LAYER_ID_PREFIX)
const nextLayerId = () => `${LAYER_ID_PREFIX}${++idSeq}`
const nextSourceId = () => `vsrc:${++idSeq}`

// ── Packing ───────────────────────────────────────────────────────────────────

/**
 * One bucket's geometry, flattened, plus what identifies each feature in it.
 *
 * `coords` holds every ring back to back as lon, lat pairs. `rings` indexes into
 * it in *pair* units with a terminator, so ring i spans `rings[i] … rings[i+1]`.
 * `polys` indexes into `rings`, likewise terminated, so polygon j owns rings
 * `polys[j] … polys[j+1]`. **A polygon index is a feature index** — it is what
 * the panel lists, what `hidden` names and what the picker resolves a click to.
 *
 * The second level of indirection exists only for areas, and it is not optional
 * there: a lake with an island is one polygon of two rings, and the fill has to
 * know that the second ring subtracts from the first rather than being its own
 * shape. Lines and points get one ring per polygon and the level costs nothing.
 *
 * `names` and `notes` are Maps rather than arrays because sparse is the normal
 * case, by a wide margin: a real alpine fetch had names on 52 of 621 tracks and
 * on none of 245 scrub polygons. `ids` is Float64Array rather than Int32Array
 * because OSM ids have outgrown 32 bits — that same fetch contained
 * 13,127,836,350, and an Int32Array would have silently wrapped it.
 */
function packBucket(key, label, geom, style, features) {
  let nCoords = 0, nRings = 0
  for (const f of features) {
    for (const r of f.rings) nCoords += r.length
    nRings += f.rings.length
  }

  const coords = new Float64Array(nCoords)
  const rings = new Int32Array(nRings + 1)
  const polys = new Int32Array(features.length + 1)
  const ids = new Float64Array(features.length)
  const names = new Map()
  const notes = new Map()

  let ci = 0, ri = 0, pi = 0
  for (const f of features) {
    if (f.name) names.set(pi, f.name)
    if (f.note) notes.set(pi, f.note)
    ids[pi] = f.id ?? 0
    polys[pi++] = ri
    for (const r of f.rings) {
      rings[ri++] = ci >> 1
      coords.set(r, ci)
      ci += r.length
    }
  }
  rings[ri] = ci >> 1
  polys[pi] = ri

  return {
    key, label, geom, style: style ?? {}, count: features.length,
    coords, rings, polys, ids, names, notes,
  }
}

/**
 * Group normalised features into packed buckets, in the order `bucketOrder`
 * gives — ground cover first, the things that sit on top of it last, so an OSM
 * catalogue can put roads over landuse without the panel knowing why. That is
 * paint order; `layersFromSource` flips it into stack order.
 *
 * Features are `{ bucket, geom, rings, name?, note?, id? }`, where each ring is
 * a flat [lon, lat, …] array. Buckets with no features simply do not appear; that is
 * what keeps a tile with no railways from growing an empty "Rail" row.
 */
export function packFeatures(features, bucketMeta, bucketOrder = null) {
  const groups = new Map()
  for (const f of features) {
    if (!f.rings?.length) continue
    let g = groups.get(f.bucket)
    if (!g) groups.set(f.bucket, (g = []))
    g.push(f)
  }

  const keys = bucketOrder
    ? bucketOrder.filter((k) => groups.has(k))
    : [...groups.keys()]

  return keys.map((k) => {
    const meta = bucketMeta?.[k] ?? {}
    const list = groups.get(k)
    return packBucket(k, meta.label ?? k, meta.geom ?? list[0].geom ?? 'line', meta.style, list)
  })
}

// ── Sources ───────────────────────────────────────────────────────────────────

/**
 * A vector source — one upload or one OSM fetch.
 *
 * `bboxWgs84` is the extent the data was requested for, not the extent it
 * covers; it is null for uploads, which arrive without being asked.
 */
export function makeSource({ kind, label, buckets, bboxWgs84 = null, note = null }) {
  return {
    id: nextSourceId(),
    kind, label, buckets, bboxWgs84, note,
    fetchedAt: Date.now(),
  }
}

/** Every ring in a source, as the flat form `featureCoverage` reads. */
export function sourceRings(source) {
  const out = []
  for (const b of source.buckets) {
    for (let i = 0; i < b.rings.length - 1; i++) {
      out.push(b.coords.subarray(b.rings[i] * 2, b.rings[i + 1] * 2))
    }
  }
  return out
}

/** Total vertex count across a source — the figure the panel reports. */
export function sourceVertexCount(source) {
  let n = 0
  for (const b of source.buckets) n += b.coords.length >> 1
  return n
}

// ── Layers ────────────────────────────────────────────────────────────────────

/**
 * One layer record per bucket in a source.
 *
 * Style precedence is defaults → the bucket's own suggestion (an OSM category
 * knows a motorway should be thicker than a footpath) → nothing else. The user's
 * later edits live on the record and are never recomputed from the bucket.
 */
export function layersFromSource(source) {
  // Reversed: buckets arrive in paint order (ground cover first) and a stack is
  // read the other way round, top first. Colours are still drawn from the
  // fallback palette in bucket order, so which layer gets which colour does not
  // depend on which end of the list it ends up at.
  return source.buckets.map((b) => ({
    ...VECTOR_LAYER_DEF,
    color: b.style?.color ?? nextFallbackColor(),
    ...b.style,
    id: nextLayerId(),
    sourceId: source.id,
    sourceKind: source.kind,
    bucket: b.key,
    name: b.label,
    geom: b.geom,
    count: b.count,
    stlRibbon: source.kind === 'gpx',
  })).reverse()
}

/**
 * Moves one layer to a new position in the stack, returning a new array.
 *
 * Out-of-range targets are clamped rather than rejected: this is driven by a
 * pointer, and a drag that runs off the end of the list means "as far as it
 * goes", not "do nothing".
 */
export function moveLayer(layers, id, toIndex) {
  const from = layers.findIndex((l) => l.id === id)
  if (from < 0) return layers
  const to = Math.max(0, Math.min(layers.length - 1, toIndex))
  if (to === from) return layers
  const next = layers.slice()
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

/**
 * What the worker needs to drape a layer, and nothing else.
 *
 * Split out because it is the cache key on the worker side: a rebuild that
 * leaves every one of these unchanged can reuse the geometry it already sent,
 * and colour, weight, opacity and dash are all deliberately absent — those are
 * resolved at render time by `layerStyle`, so dragging them must not cost a
 * rebuild. That is the whole reason the panel feels live.
 */
export function layerBuildKey(l) {
  return `${l.id}|${l.sourceId}|${l.bucket}|${l.visible ? 1 : 0}|${l.fill ? 1 : 0}|` +
         `${l.hidden?.length ? l.hidden.join(',') : ''}`
}

/**
 * The whole stack's build key — **sorted**, so it does not change when the stack
 * is reordered.
 *
 * That sort is the entire reason dragging a layer is a frame rather than a
 * rebuild. Draw order is decided on the main thread (`merged` in
 * useTerrainGeometry, then `renderOrder` in HeightmapLines); the worker drapes
 * the same coordinates onto the same terrain whichever end of the list a layer
 * sits at, so telling it the order would only invalidate a cache that is still
 * perfectly good. On a dense fetch that is the difference between a drag that
 * follows the cursor and one that re-drapes a valley of roads per step.
 */
export function vectorBuildSignature(layers) {
  return (layers ?? []).map(layerBuildKey).sort().join(';')
}

/** The layers whose geometry the worker has to build at all. */
export function visibleVectorLayers(layers) {
  return (layers ?? []).filter((l) => l.visible)
}

/**
 * How one feature of a bucket should read in the panel.
 *
 * Unnamed is the norm, so it gets a stable fallback rather than a blank row:
 * `Track #118` is at least something to point at, to filter for and to see
 * light up when it is picked on the terrain.
 */
export function featureLabel(bucket, i) {
  const named = bucket.names.get(i)
  if (named) return named
  // The bucket's own label minus its category prefix — "Roads · Track" reads
  // better per feature as "Track #118" than as "Roads · Track #118".
  const leaf = bucket.label.includes(' · ') ? bucket.label.split(' · ').pop() : bucket.label
  return `${leaf} #${i + 1}`
}

/** Whether feature `i` of a layer is drawn. */
export function isFeatureHidden(layer, i) {
  return !!layer.hidden?.includes(i)
}

/**
 * Toggle one feature's visibility, keeping `hidden` sorted so `layerBuildKey`
 * is stable — an unsorted list would spell the same state two ways and cost a
 * spurious rebuild.
 */
export function toggleHidden(hidden, i) {
  const set = new Set(hidden ?? [])
  if (set.has(i)) set.delete(i)
  else set.add(i)
  return [...set].sort((a, b) => a - b)
}

/**
 * Whether vector layers can be placed on this raster, phrased for the panel.
 *
 * Returns { ok, reason } where `reason` is one of 'none' | 'unsupported' | null.
 * Deliberately not merged into `featureCoverage`: this answers "can anything be
 * drawn here at all", which the panel needs *before* a source exists.
 */
export function rasterAcceptsVectors(crs, bbox) {
  const c = classifyCRS(crs)
  if (c.kind === 'none') return { ok: false, reason: 'none' }
  if (!c.supported) return { ok: false, reason: 'unsupported' }
  if (!bbox || bbox.length !== 4) return { ok: false, reason: 'none' }
  return { ok: true, reason: null }
}
