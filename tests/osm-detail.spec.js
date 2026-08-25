import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * How much of OpenStreetMap a large extent asks for.
 *
 * "Everything OSM has for this extent" stops being answerable long before a user
 * stops asking for it. Measured against the live API while this was written: a
 * 1 250 km² box around Graz holds 97 092 road ways, of which 6 152 are
 * motorway…tertiary, and 13 828 waterways, of which 162 are rivers or canals.
 * Over the whole of Styria the default tick boxes come to roughly 1.2 million
 * elements and a gigabyte of inlined geometry — past Overpass's own 180 s
 * budget, past MAX_ELEMENTS, and past what a tab can hold. The same extent at
 * the coarse tier is 56 000 elements and 72 MB, in under a minute.
 *
 * So there are two things to pin, and neither is about the transport: that the
 * extent picks a tier and the query narrows accordingly, and that an extent too
 * big even for its tier is refused *before* the download rather than after it.
 *
 * Overpass is never called — the route answers both the count and the geometry.
 */
const PAGE = 'http://localhost:5173'

// Envelopes in [minLon, minLat, maxLon, maxLat]. Styria's own bbox is the
// motivating case; the other two sit either side of the tier thresholds.
const STYRIA = [13.55, 46.62, 16.18, 47.84]      // ~199 × 135 km → broad
const REGION = [14.60, 47.00, 15.60, 47.60]      // ~76 × 66 km  → mid
const VALLEY = [15.00, 47.20, 15.10, 47.26]      // ~7.6 × 6.6 km → full

/**
 * Answers every Overpass call and records what was asked.
 *
 * A count query is answered with one total per `out count;` statement — the
 * per-category form asks for several — and a geometry query with a single way,
 * which is enough to reach the end of the fetch.
 */
async function routeOverpass(page, { count }) {
  const asked = []
  await page.route('**/api/interpreter', async (route) => {
    const body = decodeURIComponent((route.request().postData() ?? '').replace(/^data=/, '').replace(/\+/g, ' '))
    asked.push(body)
    const counts = (body.match(/out count;/g) ?? []).length
    const json = counts
      ? { version: 0.6, elements: Array.from({ length: counts }, (_, i) => ({
          type: 'count', id: 0,
          // The per-category form is answered unevenly on purpose, so the
          // "which category is the heavy one" claim has something to find.
          tags: { total: String(counts === 1 ? count : Math.round(count / (i + 1))) },
        })) }
      : { version: 0.6, elements: [{
          type: 'way', id: 1, tags: { highway: 'motorway' },
          geometry: [{ lat: 47.2, lon: 15.0 }, { lat: 47.3, lon: 15.1 }],
        }] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
  })
  return asked
}

/** Runs `fetchOsm` in the page and reports what came back, or what was thrown. */
function runFetch(page, bbox, cats, detail) {
  return page.evaluate(async ([bbox, cats, detail]) => {
    const { fetchOsm } = await import('/src/utils/osmFetch.js')
    try {
      const { source } = await fetchOsm(bbox, cats, { detail })
      return { ok: true, buckets: source.buckets.length }
    } catch (err) {
      return { ok: false, message: String(err.message ?? err) }
    }
  }, [bbox, cats, detail])
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
})

test('an extent picks its own detail, and the query narrows with it', async ({ page }) => {
  const tiers = await page.evaluate(async () => {
    const { detailTierFor, OSM_CATEGORIES, selectorsFor } = await import('/src/utils/osmCategories.js')
    const { buildOverpassQuery } = await import('/src/utils/osmFetch.js')
    const q = (bbox, tier) => buildOverpassQuery(bbox, ['roads', 'waterways', 'landuse'], tier)
    return {
      valley: detailTierFor(7.6 * 6.6),
      region: detailTierFor(76 * 66),
      styria: detailTierFor(199 * 135),
      full:  q([15, 47.2, 15.1, 47.26], 'full'),
      mid:   q([14.6, 47, 15.6, 47.6], 'mid'),
      broad: q([13.55, 46.62, 16.18, 47.84], 'broad'),
      // The road selector on its own: `landuse=residential` is a built-up area
      // polygon and would answer to a search for the road class of that name.
      roads: Object.fromEntries(['full', 'mid', 'broad'].map((t) =>
        [t, selectorsFor(OSM_CATEGORIES.find((c) => c.id === 'roads'), t).join(' ')])),
      // A category with nothing to say at a tier keeps what it had.
      peaksSame: JSON.stringify(selectorsFor(OSM_CATEGORIES.find((c) => c.id === 'peaks'), 'broad')) ===
                 JSON.stringify(OSM_CATEGORIES.find((c) => c.id === 'peaks').selectors),
    }
  })

  expect(tiers.valley).toBe('full')
  expect(tiers.region).toBe('mid')
  expect(tiers.styria).toBe('broad')

  // Full detail is every class, down to the footpaths and the field drains.
  expect(tiers.roads.full).toContain('footway')
  expect(tiers.roads.full).toContain('track')
  expect(tiers.full).toContain('ditch')
  expect(tiers.full).not.toContain('if:length()')

  // Mid drops the footpaths and the drains but keeps the lanes and the streams.
  expect(tiers.roads.mid).not.toContain('footway')
  expect(tiers.roads.mid).not.toContain('track')
  expect(tiers.roads.mid).toContain('residential')
  expect(tiers.mid).toContain('stream')
  // …and only the woods worth drawing at that size.
  expect(tiers.mid).toContain('if:length()>1000')

  // Broad is the trunk network, the rivers, and the large woods.
  expect(tiers.roads.broad).not.toContain('residential')
  expect(tiers.roads.broad).not.toContain('unclassified')
  expect(tiers.roads.broad).toContain('motorway')
  expect(tiers.broad).not.toContain('stream')
  expect(tiers.broad).toContain('if:length()>3000')
  // A ramp with no motorway to belong to is a stub hanging in a field, so the
  // link classes travel with their parents at every tier.
  expect(tiers.roads.broad).toContain('motorway_link')

  expect(tiers.peaksSame, 'peaks are the same at every size').toBe(true)
})

test('a province is measured before it is downloaded, and refused by name', async ({ page }) => {
  const asked = await routeOverpass(page, { count: 1_200_000 })

  const r = await runFetch(page, STYRIA, ['landuse', 'roads', 'peaks'], 'broad')

  expect(r.ok, 'a fetch this size must not be attempted').toBe(false)
  expect(r.message).toContain('1,200,000 features')
  expect(r.message).toContain('past the 400,000')
  // Named, because "untick a category" is not advice without saying which one.
  expect(r.message).toContain('Landuse & natural')
  expect(r.message).toMatch(/Untick a category/)

  // Two counts — the combined answer, then the breakdown that names the
  // offender — and no geometry was ever asked for.
  expect(asked.filter((q) => q.includes('out count;')).length).toBe(2)
  expect(asked.some((q) => q.includes('out geom;')), 'nothing may be downloaded').toBe(false)
})

test('a province that fits is fetched at its tier, count first', async ({ page }) => {
  const asked = await routeOverpass(page, { count: 56_000 })

  const r = await runFetch(page, STYRIA, ['roads', 'waterways'], 'broad')
  expect(r.ok, r.message).toBe(true)

  const counts = asked.filter((q) => q.includes('out count;'))
  const geom = asked.filter((q) => q.includes('out geom;'))
  expect(counts.length, 'one count, and no breakdown when the answer is yes').toBe(1)
  expect(geom.length).toBe(1)
  // The count is asked at the same detail as the fetch, or it would be
  // measuring a different query from the one it authorises.
  expect(counts[0]).not.toContain('footway')
  expect(geom[0]).not.toContain('footway')
})

test('an ordinary valley is not charged an extra round trip', async ({ page }) => {
  const asked = await routeOverpass(page, { count: 10 })

  const r = await runFetch(page, VALLEY, ['roads', 'waterways'], 'full')
  expect(r.ok, r.message).toBe(true)

  // Below the threshold a fetch has never been too large to drape, and Overpass
  // is a volunteer service: the count would be a tax on every ordinary fetch.
  expect(asked.some((q) => q.includes('out count;')), 'no count on a small extent').toBe(false)
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('footway')
})

test('a mid-sized region is measured too, and keeps its lanes', async ({ page }) => {
  const asked = await routeOverpass(page, { count: 40_000 })

  const r = await runFetch(page, REGION, ['roads', 'landuse'], 'mid')
  expect(r.ok, r.message).toBe(true)
  expect(asked.filter((q) => q.includes('out count;')).length).toBe(1)
  expect(asked.find((q) => q.includes('out geom;'))).toContain('residential')
})
