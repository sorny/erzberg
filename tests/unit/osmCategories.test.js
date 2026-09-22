/**
 * What the OpenStreetMap categories actually ask for.
 *
 * The admin boundaries case is the one that cost a user real confusion, and it
 * is the reason this file exists. Loading "Admin boundaries" over Graz returned
 * the city, the surrounding municipalities and the province — and none of the
 * seventeen districts anybody in Graz would name first. The query stopped at
 * `admin_level=8`, and Austria puts city districts at 9.
 *
 * The levels are a national convention rather than a standard, so the bucket
 * for each is tested rather than the label: what must not regress is that the
 * levels people mean are *asked for*, and that the selector and the classifier
 * agree about which those are.
 */
import { describe, it, expect } from 'vitest'
import { OSM_CATEGORIES, osmCategory, selectorsFor } from '../../src/utils/osmCategories'

const boundaries = osmCategory('boundaries')

/** What the Overpass regex in a selector will actually match. */
function levelsMatchedBy(selector) {
  const m = selector.match(/"admin_level"~"([^"]+)"/)
  if (!m) return null
  const re = new RegExp(m[1])
  return Array.from({ length: 12 }, (_, i) => String(i)).filter((v) => re.test(v))
}

describe('admin boundaries', () => {
  it('asks for the levels a city’s own districts live at', () => {
    // Around Graz: 6 is the city (a Statutarstadt is its own Bezirk), 8 the
    // surrounding municipalities, 9 the seventeen districts — Innere Stadt,
    // Jakomini, Lend, Gries — and 10 the Katastralgemeinden.
    const levels = levelsMatchedBy(boundaries.selectors[0])
    expect(levels).toEqual(['2', '4', '6', '8', '9', '10'])
  })

  it('matches 10 as ten rather than as a one followed by a zero', () => {
    // An unanchored or badly grouped alternation is the classic way to write
    // this regex so that "10" silently becomes "1".
    const re = new RegExp(boundaries.selectors[0].match(/"admin_level"~"([^"]+)"/)[1])
    expect(re.test('10')).toBe(true)
    expect(re.test('1')).toBe(false)
    expect(re.test('7')).toBe(false)
    expect(re.test('11')).toBe(false)
  })

  it('buckets every level it asked for, and nothing else', () => {
    const asked = levelsMatchedBy(boundaries.selectors[0])
    for (const level of asked) {
      expect(boundaries.bucketOf({ boundary: 'administrative', admin_level: level }))
        .toBe(`level${level}`)
    }
    // A level the query never asks for must not produce a bucket either, or a
    // relation picked up incidentally would open a row nothing else fills.
    expect(boundaries.bucketOf({ boundary: 'administrative', admin_level: '7' })).toBeNull()
    expect(boundaries.bucketOf({ boundary: 'maritime', admin_level: '4' })).toBeNull()
  })

  it('names every bucket it can produce', () => {
    // An unlabelled bucket falls back to its key, so the panel would show
    // "Boundary · level9" — which is the tag, not a name.
    for (const level of levelsMatchedBy(boundaries.selectors[0])) {
      expect(boundaries.labels[`level${level}`], `level${level} needs a label`).toBeTruthy()
    }
  })

  it('stays one selector list at every extent', () => {
    // Measured over the whole of Styria: 642 relations for 2/4/6/8 and 676 more
    // for 9/10. Far inside any tier, so there is nothing to coarsen.
    for (const tier of ['full', 'mid', 'broad']) {
      expect(selectorsFor(boundaries, tier)).toEqual(boundaries.selectors)
    }
  })
})

describe('every category', () => {
  it('labels each bucket its own classifier can return', () => {
    for (const cat of OSM_CATEGORIES) {
      if (!cat.labels) continue
      for (const key of Object.keys(cat.labels)) {
        expect(typeof cat.labels[key], `${cat.id}.${key}`).toBe('string')
        expect(cat.labels[key].length, `${cat.id}.${key} is empty`).toBeGreaterThan(0)
      }
    }
  })
})
