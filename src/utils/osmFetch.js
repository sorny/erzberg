/**
 * Asking OpenStreetMap what is inside the raster.
 *
 * One Overpass QL query per fetch, built from the ticked categories, with
 * `out geom` so ways and relation members arrive with their coordinates already
 * inlined — the alternative is a second pass resolving node references, which
 * for a few hundred thousand nodes is both slower and more code.
 *
 * Three things this has to get right, none of them about the query itself:
 *
 *  • **Not freezing the tab.** A dense extent is tens of megabytes of JSON and
 *    a few hundred thousand elements to bucket. `JSON.parse` is one atomic
 *    block and cannot be paced, but the walk over the elements can be, so it
 *    runs on the same cooperative pacer the exports use.
 *
 *  • **Being interruptible.** A query the user regrets has to stop, both the
 *    request (AbortController) and the bucketing (the pacer's cancel).
 *
 *  • **Not hammering the endpoint.** Overpass is a volunteer service. Identical
 *    queries are answered from a module-level cache, the request carries a
 *    generous server-side timeout rather than being retried impatiently, and a
 *    rate-limited or overloaded response falls back to one mirror and no more.
 *
 * The data is ODbL: anything that displays or exports it has to say
 * `© OpenStreetMap contributors`. See OSM_ATTRIBUTION.
 */

import { makePacer, makeReporter, CANCELLED, STRIDE } from './pacing'
import { bucketLabel, bucketStyle, osmCategory } from './osmCategories'
import { makeSource, packFeatures } from './vectorLayers'

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'

// Tried in order. Three rather than two because two is not redundancy: both of
// the first pair were serving 504 "server is probably too busy" on the day this
// was written, on a query a third instance answered in seconds, and a feature
// that looks broken whenever one operator has a bad afternoon is not finished.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

// Server-side budget. Generous because the alternative to waiting is retrying,
// and a retry costs the endpoint the whole query again.
const QUERY_TIMEOUT_S = 180

// Rough guard on how much a single fetch may be asked to hold. Not a limit on
// what Overpass will send — it is a limit on what this app will try to keep in
// memory and drape, and it is reported rather than silently applied.
export const MAX_ELEMENTS = 400_000

// Identical queries are answered from memory. Ticking one more category and
// re-fetching is a normal thing to do, and it should not cost the endpoint a
// second full download of what was already sent.
const responseCache = new Map()

/**
 * Overpass QL for a set of category ids over a WGS84 envelope.
 *
 * The bbox is stated once in the settings line, so every selector inherits it
 * and the query text stays short enough to read in a bug report.
 */
export function buildOverpassQuery(bboxWgs84, categoryIds) {
  const [minLon, minLat, maxLon, maxLat] = bboxWgs84
  const bbox = [minLat, minLon, maxLat, maxLon].map((v) => v.toFixed(6)).join(',')

  const parts = []
  for (const id of categoryIds) {
    const cat = osmCategory(id)
    if (!cat) continue
    for (const sel of cat.selectors) parts.push(`  ${sel};`)
  }
  if (!parts.length) return null

  return `[out:json][timeout:${QUERY_TIMEOUT_S}][bbox:${bbox}];\n(\n${parts.join('\n')}\n);\nout geom;`
}

/**
 * Which category claims an element, and which bucket inside it.
 *
 * Categories are tried in catalogue order and the first match wins, which
 * matters because OSM tags overlap: a reservoir is tagged `landuse` *and*
 * belongs in Water, and a riverbank polygon answers to both waterways and water
 * bodies. Catalogue order encodes that precedence once instead of every call
 * site guessing.
 */
function classify(tags, cats) {
  for (const cat of cats) {
    const value = cat.bucketOf(tags)
    if (value) return { cat, value }
  }
  return null
}

/**
 * The secondary line the panel shows under a feature's name.
 *
 * Whatever the tags happen to offer that is worth reading at a glance: a peak's
 * height is the obvious one, a road's route number the other. Not a general tag
 * viewer — a row has space for one short fact.
 */
function noteFor(tags) {
  if (tags.ele) {
    const m = parseFloat(tags.ele)
    if (Number.isFinite(m)) return `${Math.round(m)} m`
  }
  // `ref` only where it is a route number anyone would recognise. Austrian
  // streams carry one too — a watercourse register index — and "2728" under a
  // river's name is noise dressed as information.
  if (tags.ref && (tags.highway || tags.railway || tags.aerialway)) return tags.ref
  return null
}

/**
 * Coordinates of one Overpass element as flat [lon, lat, …] rings.
 *
 * A node is a single position. A way arrives as `geometry`. A relation arrives
 * as members, and only its outer/inner ways are geometry — a multipolygon's
 * label node is a member too and must not become a ring.
 */
function ringsOf(el) {
  if (el.type === 'node') {
    return Number.isFinite(el.lat) && Number.isFinite(el.lon)
      ? [Float64Array.from([el.lon, el.lat])]
      : []
  }
  if (el.type === 'way') {
    const g = el.geometry
    if (!g?.length) return []
    const ring = new Float64Array(g.length * 2)
    let n = 0
    for (const pt of g) {
      // Overpass writes `null` into `geometry` for a node clipped away by the
      // bbox. Skipping the gap rather than the whole way keeps a road that
      // leaves the extent and returns.
      if (!pt || !Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue
      ring[n++] = pt.lon
      ring[n++] = pt.lat
    }
    return n >= 4 ? [ring.subarray(0, n)] : []
  }
  if (el.type === 'relation') {
    const out = []
    for (const m of el.members ?? []) {
      if (m.type !== 'way' || !m.geometry?.length) continue
      const sub = ringsOf({ type: 'way', geometry: m.geometry })
      // Outer rings first: `packFeatures` treats a feature's first ring as the
      // outline and the rest as holes, and a relation lists its members in
      // whatever order the mapper added them.
      if (m.role === 'inner') out.push(...sub)
      else out.unshift(...sub)
    }
    return out
  }
  return []
}

/**
 * An Overpass response → a vector source.
 *
 * Paced, because this is the part that scales with the size of the download and
 * a quarter of a million elements is enough to lock the tab for seconds.
 */
export async function bucketOsmElements(elements, categoryIds, bboxWgs84, pacer, report) {
  const cats = categoryIds.map(osmCategory).filter(Boolean)
  const features = []
  const seen = new Map()          // category id → Set of bucket values present
  let dropped = 0

  for (let i = 0; i < elements.length; i++) {
    if ((i & STRIDE) === 0 && pacer.due()) {
      await pacer.yield()
      report(i / Math.max(1, elements.length), 'Sorting features…')
    }
    const el = elements[i]
    const tags = el.tags
    if (!tags) continue
    const hit = classify(tags, cats)
    if (!hit) continue

    const rings = ringsOf(el)
    if (!rings.length) { dropped++; continue }

    const key = `${hit.cat.id}:${hit.value}`
    let bucketSet = seen.get(hit.cat.id)
    if (!bucketSet) seen.set(hit.cat.id, (bucketSet = new Set()))
    bucketSet.add(hit.value)

    // A relation's outer and inner rings belong to one feature so the fill can
    // subtract the holes; a multipolygon of separate islands is a compromise
    // here — Overpass does not say which outer each inner belongs to without
    // geometry work this does not do, and rings that do not overlap are
    // unaffected by even-odd anyway.
    //
    // The tags were being read only to choose a bucket and then dropped, which
    // is what made a feature impossible to name or point at afterwards.
    features.push({
      bucket: key, geom: hit.cat.geom, rings,
      name: tags.name || null,
      note: noteFor(tags),
      id: el.id,
    })
  }

  // Bucket metadata is resolved after the walk, because whether a category
  // "splits" — and so whether its layers need the "Roads · " prefix — is only
  // known once every element has been seen.
  const bucketMeta = {}
  const order = []
  for (const cat of cats) {
    const values = [...(seen.get(cat.id) ?? [])].sort()
    for (const v of values) {
      const key = `${cat.id}:${v}`
      order.push(key)
      bucketMeta[key] = {
        label: bucketLabel(cat, v),
        geom: cat.geom,
        style: bucketStyle(cat, v),
      }
    }
  }

  report(1, 'Sorting features…')
  return makeSource({
    kind: 'osm',
    label: 'OpenStreetMap',
    bboxWgs84,
    buckets: packFeatures(features, bucketMeta, order),
    note: dropped ? `${dropped} features arrived without usable geometry.` : null,
  })
}

/** POST the query, falling back to one mirror when the first endpoint declines. */
async function requestOverpass(query, signal) {
  let lastError = null
  for (const url of ENDPOINTS) {
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal,
      })
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      lastError = err
      continue
    }
    if (res.ok) return res
    // 429 is rate limiting and 504 is the query outrunning the server's own
    // budget; both are worth asking a different mirror. Anything else is about
    // the query itself and asking again would only waste someone's bandwidth.
    if (res.status !== 429 && res.status !== 504) {
      throw new Error(`OpenStreetMap returned ${res.status} ${res.statusText}.`)
    }
    lastError = new Error(
      `Every OpenStreetMap endpoint is busy right now (${res.status}). ` +
      `Overpass is a volunteer service — try again in a few minutes.`)
  }
  throw lastError ?? new Error('Could not reach OpenStreetMap.')
}

/**
 * Fetch and bucket everything in `categoryIds` over `bboxWgs84`.
 *
 * @returns { source, cached } — or throws. A cancelled fetch throws CANCELLED
 *          (from the pacer) or a DOMException named 'AbortError' (from fetch);
 *          the caller treats both as "nothing happened".
 */
export async function fetchOsm(bboxWgs84, categoryIds, { signal, onProgress, shouldCancel } = {}) {
  const query = buildOverpassQuery(bboxWgs84, categoryIds)
  if (!query) throw new Error('Nothing selected to fetch.')

  const pacer = makePacer(shouldCancel ?? (() => false))
  const report = makeReporter(onProgress)

  const key = `${bboxWgs84.map((v) => v.toFixed(5)).join(',')}|${[...categoryIds].sort().join(',')}`
  const hit = responseCache.get(key)

  let elements
  if (hit) {
    elements = hit
  } else {
    report(0, 'Querying OpenStreetMap…')
    const res = await requestOverpass(query, signal)
    // Read as text first: the download is the long part and `res.json()` would
    // hide it behind one unmeasurable await.
    const text = await res.text()
    report(0.5, 'Reading response…')
    await pacer.yield()

    let doc
    try {
      doc = JSON.parse(text)
    } catch (err) {
      throw new Error('OpenStreetMap sent a response this could not read.', { cause: err })
    }
    if (doc.remark) throw new Error(`OpenStreetMap: ${doc.remark}`)
    elements = doc.elements ?? []
    responseCache.set(key, elements)
  }

  if (elements.length > MAX_ELEMENTS) {
    throw new Error(
      `That extent holds ${elements.length.toLocaleString()} features, past the ` +
      `${MAX_ELEMENTS.toLocaleString()} this can drape. Untick a category — Buildings ` +
      `is usually the one — or crop the raster in Edit Mode first.`
    )
  }

  const source = await bucketOsmElements(elements, categoryIds, bboxWgs84, pacer,
    (f, label) => report(0.5 + 0.5 * f, label))
  return { source, cached: !!hit }
}

export function clearOsmCache() { responseCache.clear() }
export { CANCELLED }
