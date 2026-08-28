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
 *  • **Being interruptible, and not waiting for ever.** A query the user regrets
 *    has to stop — the request (AbortController) and the bucketing (the pacer's
 *    cancel) both. Separately, an endpoint that accepts the connection and then
 *    goes quiet must not park the UI: each attempt carries its own deadline, and
 *    exhausting it moves on to the next mirror.
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
import { bucketLabel, bucketStyle, osmCategory, selectorsFor } from './osmCategories'
import { wgs84ExtentKm } from './geoCoords'
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

/**
 * Client-side deadline for one endpoint, covering headers *and* body.
 *
 * One budget rather than a short connect timeout and a long transfer one, and
 * the reason is specific to Overpass: it withholds response headers until the
 * query has finished running, so "time to first byte" and "time the server spent
 * thinking" are the same number. A tight header deadline would not catch a dead
 * socket any faster — it would kill the legitimate slow queries this tool exists
 * to make.
 *
 * Set above the server's own `[timeout:180]` so an endpoint honouring its
 * contract always answers first, with data or with an error. Only a genuinely
 * stalled connection reaches this, and reaching it moves on to the next mirror
 * rather than failing the fetch.
 */
const ATTEMPT_TIMEOUT_MS = (QUERY_TIMEOUT_S + 45) * 1000

// Rough guard on how much a single fetch may be asked to hold. Not a limit on
// what Overpass will send — it is a limit on what this app will try to keep in
// memory and drape, and it is reported rather than silently applied.
export const MAX_ELEMENTS = 400_000

/**
 * Above this, ask what the extent holds before downloading it.
 *
 * Overpass answers `out count;` by running the same search and sending back a
 * number instead of a gigabyte, which turns "four minutes, then an error" into
 * "two seconds, then a sentence naming what to untick". It is not free — the
 * server does the search twice — so it is spent only where the answer could
 * plausibly be no. Below 2 500 km² a fetch has never been too large to drape,
 * and the extra round trip would be a tax on every ordinary fetch of a valley.
 */
const COUNT_ABOVE_KM2 = 2_500

/** Square kilometres of a WGS84 envelope, or 0 when there is nothing to measure. */
function extentKm2(bboxWgs84) {
  const km = wgs84ExtentKm(bboxWgs84)
  return km ? Math.max(0, km.w) * Math.max(0, km.h) : 0
}

// Identical queries are answered from memory. Ticking one more category and
// re-fetching is a normal thing to do, and it should not cost the endpoint a
// second full download of what was already sent.
//
// Bounded, because an entry here is the largest thing this app caches: up to
// MAX_ELEMENTS Overpass elements, which is the raw JSON of a whole valley. An
// unbounded Map kept every distinct query of a session resident for as long as
// the tab lived. Three is sized to the workflow it exists for — tick a category,
// re-fetch, untick it, go back — and not to a browsing history.
const RESPONSE_CACHE_MAX = 3
const responseCache = new Map()

// Counts are a handful of integers each, so this one is capped for tidiness
// rather than for memory.
const COUNT_CACHE_MAX = 32

/**
 * Least-recently-used reads and writes over a plain Map.
 *
 * A Map iterates in insertion order, so "delete then set" moves an entry to the
 * end and the oldest key is always `keys().next()`. That is the whole mechanism
 * — no second structure, and nothing to keep in step with the Map itself.
 */
function lruGet(map, key) {
  if (!map.has(key)) return undefined
  const value = map.get(key)
  map.delete(key); map.set(key, value)
  return value
}

function lruSet(map, key, value, cap) {
  map.delete(key); map.set(key, value)
  while (map.size > cap) map.delete(map.keys().next().value)
}

/**
 * Overpass QL for a set of category ids over a WGS84 envelope.
 *
 * The bbox is stated once in the settings line, so every selector inherits it
 * and the query text stays short enough to read in a bug report.
 */
export function buildOverpassQuery(bboxWgs84, categoryIds, detail = 'full') {
  const parts = []
  for (const id of categoryIds) {
    const cat = osmCategory(id)
    if (!cat) continue
    for (const sel of selectorsFor(cat, detail)) parts.push(`  ${sel};`)
  }
  if (!parts.length) return null

  return `${settings(bboxWgs84)};\n(\n${parts.join('\n')}\n);\nout geom;`
}

/** The settings line every query shares — output, budget, and the envelope. */
function settings(bboxWgs84) {
  const [minLon, minLat, maxLon, maxLat] = bboxWgs84
  const bbox = [minLat, minLon, maxLat, maxLon].map((v) => v.toFixed(6)).join(',')
  return `[out:json][timeout:${QUERY_TIMEOUT_S}][bbox:${bbox}]`
}

/**
 * The same search, answered with a number instead of the data.
 *
 * `perCategory` puts each category in its own statement with its own `out
 * count;`, so the reply is a list in catalogue order and the panel can say
 * *which* tick box is the expensive one. That costs the server one search per
 * category, so it is asked only when the combined count has already said no and
 * the fetch is being refused anyway.
 */
export function buildCountQuery(bboxWgs84, categoryIds, detail = 'full', perCategory = false) {
  const cats = categoryIds.map(osmCategory).filter(Boolean)
  if (!cats.length) return null
  const head = settings(bboxWgs84)

  if (!perCategory) {
    const parts = cats.flatMap((c) => selectorsFor(c, detail).map((sel) => `  ${sel};`))
    return `${head};\n(\n${parts.join('\n')}\n);\nout count;`
  }
  const blocks = cats.map((c) =>
    `(${selectorsFor(c, detail).map((sel) => `${sel};`).join('')});out count;`)
  return `${head};\n${blocks.join('\n')}`
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
    // No space before the unit: this string is drawn on the terrain as a label
    // as well as listed in the panel, and "1910 m" wraps its own width in a gap
    // at the sizes a plot uses. One string, so the two never disagree.
    if (Number.isFinite(m)) return `${Math.round(m)}m`
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

/**
 * POST the query, falling through to the next mirror when one declines or stalls.
 *
 * Returns the response *body*, not the response, so the deadline covers the
 * download too — an endpoint that sends headers and then dribbles the body is
 * the same hang as one that never answers, and it has to fall through the same
 * way.
 *
 * The distinction that matters in the catch is who did the aborting. A user
 * pressing Cancel means stop; a deadline expiring means this endpoint is not
 * answering, so try the next one. Before this, neither existed: a socket that
 * accepted the connection and went quiet never rejected and never returned a
 * status, so the loop never advanced and the panel waited for ever. The mirrors
 * were unreachable precisely when they were most needed.
 */
async function fetchOverpassText(query, signal) {
  let lastError = null
  for (const url of ENDPOINTS) {
    const deadline = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)
    const attempt = signal ? AbortSignal.any([signal, deadline]) : deadline
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: attempt,
      })
      if (res.ok) return await res.text()

      // 429 is rate limiting and 504 is the query outrunning the server's own
      // budget; both are worth asking a different mirror. Anything else is about
      // the query itself and asking again would only waste someone's bandwidth.
      //
      // Marked rather than thrown bare: this `throw` lands in this function's
      // own `catch`, which files anything that is not an abort as "that mirror
      // failed" and moves on — so a 400 was being re-POSTed to every endpoint in
      // the list, which is precisely what the paragraph above says not to do.
      if (res.status !== 429 && res.status !== 504) {
        throw Object.assign(
          new Error(`OpenStreetMap returned ${res.status} ${res.statusText}.`),
          { overpassFinal: true })
      }
      lastError = new Error(
        `Every OpenStreetMap endpoint is busy right now (${res.status}). ` +
        `Overpass is a volunteer service — try again in a few minutes.`)
    } catch (err) {
      // The user pressed Cancel: stop, do not try anywhere else.
      if (signal?.aborted) throw err
      // Nor for an answer that says the query is wrong; see above.
      if (err?.overpassFinal) throw err
      if (err?.name === 'TimeoutError') {
        lastError = new Error(
          `No OpenStreetMap endpoint answered within ${Math.round(ATTEMPT_TIMEOUT_MS / 1000)} s. ` +
          `Try a smaller extent, or fewer categories.`)
      } else if (err instanceof Error && !(err.name === 'AbortError')) {
        lastError = err
      }
    }
  }
  throw lastError ?? new Error('Could not reach OpenStreetMap.')
}

// Counts are cached like responses: ticking a category on and off while
// deciding what to fetch must not cost the endpoint a search each time.
const countCache = new Map()

/** POST a count query and return its totals, in statement order. */
async function runCount(query, signal, cacheKey) {
  const cached = lruGet(countCache, cacheKey)
  if (cached) return cached
  const text = await fetchOverpassText(query, signal)
  let doc
  try {
    doc = JSON.parse(text)
  } catch (err) {
    throw new Error('OpenStreetMap sent a count this could not read.', { cause: err })
  }
  if (doc.remark) throw new Error(`OpenStreetMap: ${doc.remark}`)
  const totals = (doc.elements ?? []).map((el) => Number(el?.tags?.total ?? 0))
  lruSet(countCache, cacheKey, totals, COUNT_CACHE_MAX)
  return totals
}

/**
 * How many elements this extent would return, without returning them.
 *
 * Exported because it is worth having on its own: the panel can say what a
 * fetch is about to cost before anyone waits for it.
 */
export async function countOsm(bboxWgs84, categoryIds, { detail = 'full', signal, perCategory = false } = {}) {
  const query = buildCountQuery(bboxWgs84, categoryIds, detail, perCategory)
  if (!query) throw new Error('Nothing selected to count.')
  const key = `${cacheKey(bboxWgs84, categoryIds, detail)}|${perCategory ? 'each' : 'all'}`
  const totals = await runCount(query, signal, key)
  if (!perCategory) return { total: totals[0] ?? 0, byCategory: null }

  const cats = categoryIds.map(osmCategory).filter(Boolean)
  const byCategory = cats.map((c, i) => ({ id: c.id, label: c.label, count: totals[i] ?? 0 }))
  return { total: byCategory.reduce((n, c) => n + c.count, 0), byCategory }
}

/** One key for the bbox + tick boxes + detail tier, shared by both caches. */
function cacheKey(bboxWgs84, categoryIds, detail) {
  return `${bboxWgs84.map((v) => v.toFixed(5)).join(',')}|${[...categoryIds].sort().join(',')}|${detail}`
}

/**
 * What to say when the extent holds more than this can draw.
 *
 * Naming the two heaviest categories with their own numbers, because "untick a
 * category" is not advice without saying which one — and on a province it is
 * rarely the one a user would guess. Buildings is the obvious suspect and is
 * already off by default; the actual answer over Styria is Landuse & natural.
 */
function tooBigMessage(total, byCategory, detail) {
  const worst = [...(byCategory ?? [])].sort((a, b) => b.count - a.count)
    .filter((c) => c.count > 0).slice(0, 2)
  const named = worst.length
    ? ` — ${worst.map((c) => `${c.label} is ${c.count.toLocaleString()} of them`).join(', and ')}`
    : ''
  const lever = detail === 'full'
    ? 'Untick a category, turn Full detail off, or crop the raster in Edit Mode.'
    : 'Untick a category, or crop the raster in Edit Mode.'
  return `That extent holds ${total.toLocaleString()} features, past the ` +
         `${MAX_ELEMENTS.toLocaleString()} this can drape${named}. ${lever}`
}

/**
 * Fetch and bucket everything in `categoryIds` over `bboxWgs84`.
 *
 * @returns { source, cached } — or throws. A cancelled fetch throws CANCELLED
 *          (from the pacer) or a DOMException named 'AbortError' (from fetch);
 *          the caller treats both as "nothing happened".
 */
export async function fetchOsm(bboxWgs84, categoryIds, { signal, onProgress, shouldCancel, detail = 'full' } = {}) {
  const query = buildOverpassQuery(bboxWgs84, categoryIds, detail)
  if (!query) throw new Error('Nothing selected to fetch.')

  const pacer = makePacer(shouldCancel ?? (() => false))
  const report = makeReporter(onProgress)

  const key = cacheKey(bboxWgs84, categoryIds, detail)
  const hit = lruGet(responseCache, key)

  let elements
  if (hit) {
    elements = hit
  } else {
    /*
     * On a large extent, ask what it holds before asking for it.
     *
     * The alternative is what this replaces: four minutes of downloading a
     * province, and then the element cap below rejecting it — the whole cost
     * paid, and the user told nothing except that it did not work. A count
     * costs one search and answers in seconds.
     */
    if (extentKm2(bboxWgs84) > COUNT_ABOVE_KM2) {
      report(0, 'Measuring the extent…')
      const { total } = await countOsm(bboxWgs84, categoryIds, { detail, signal })
      if (total > MAX_ELEMENTS) {
        // Only now is the per-category breakdown worth a search of its own: the
        // fetch is being refused either way, and this is what makes the refusal
        // actionable.
        const { byCategory } = await countOsm(bboxWgs84, categoryIds,
          { detail, signal, perCategory: true }).catch(() => ({ byCategory: null }))
        throw new Error(tooBigMessage(total, byCategory, detail))
      }
      report(0, `${total.toLocaleString()} features — querying OpenStreetMap…`)
    } else {
      report(0, 'Querying OpenStreetMap…')
    }
    // Text rather than `res.json()`: the download is the long part, and parsing
    // it separately is what lets the progress bar move between the two.
    const text = await fetchOverpassText(query, signal)
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
    lruSet(responseCache, key, elements, RESPONSE_CACHE_MAX)
  }

  // The backstop, for the extents small enough that no count was run — and for a
  // count that was right about the search but not about what came back.
  if (elements.length > MAX_ELEMENTS) throw new Error(tooBigMessage(elements.length, null, detail))

  const source = await bucketOsmElements(elements, categoryIds, bboxWgs84, pacer,
    (f, label) => report(0.5 + 0.5 * f, label))
  return { source, cached: !!hit }
}

export function clearOsmCache() { responseCache.clear(); countCache.clear() }
export { CANCELLED }
