/**
 * The ODbL credit, and which exports owe one.
 *
 * OpenStreetMap data is ODbL, and §4.3 attaches the notice to the *Produced
 * Work* — the plate, the print, the model — rather than to the application. So
 * the question each exporter has to answer is not "is OSM loaded?" but "is OSM
 * data in this file?", and for one of them the answer is genuinely different.
 *
 * These are the two pure pieces of that: who owes a credit, and what the STL
 * header can carry. The PNG chunk writer has its own file; the WebM container
 * needs a real MediaRecorder and is covered in `export-attribution.spec.js`.
 */
import { describe, expect, it } from 'vitest'
import { OSM_ATTRIBUTION, osmAttribution } from '../../src/utils/osmFetch'
import { stlHeader } from '../../src/utils/stlExport'

const layer = (over) => ({ visible: true, sourceKind: 'osm', ...over })

describe('osmAttribution', () => {
  it('credits a visible OpenStreetMap layer', () => {
    expect(osmAttribution([layer()])).toBe(OSM_ATTRIBUTION)
  })

  it('says nothing when there is nothing to credit', () => {
    expect(osmAttribution(undefined)).toBe(null)
    expect(osmAttribution([])).toBe(null)
  })

  it('ignores a hidden OSM layer', () => {
    // ODbL attaches to the Produced Work. A layer that is switched off is not
    // in the picture, so the picture owes nothing for it.
    expect(osmAttribution([layer({ visible: false })])).toBe(null)
  })

  it('ignores layers that were never OpenStreetMap', () => {
    expect(osmAttribution([layer({ sourceKind: 'gpx' })])).toBe(null)
    expect(osmAttribution([layer({ sourceKind: 'geojson' })])).toBe(null)
  })

  it('credits once when any visible layer qualifies', () => {
    expect(osmAttribution([
      layer({ sourceKind: 'gpx' }),
      layer({ visible: false }),
      layer(),
    ])).toBe(OSM_ATTRIBUTION)
  })
})

describe('stlHeader', () => {
  it('fits the 80 bytes a binary STL gives it', () => {
    expect(stlHeader(null).length).toBeLessThanOrEqual(80)
    expect(stlHeader(OSM_ATTRIBUTION).length).toBeLessThanOrEqual(80)
  })

  it('carries the credit only when one is owed', () => {
    expect(stlHeader(OSM_ATTRIBUTION)).toContain('OpenStreetMap contributors')
    expect(stlHeader(null)).not.toContain('OpenStreetMap')
  })

  it('stays ASCII', () => {
    // The field has no declared encoding and readers decode it as they please.
    // `©` is a legal Latin-1 byte and would survive; `(c)` survives everywhere,
    // and a credit that renders as a replacement character is not a credit.
    for (const h of [stlHeader(null), stlHeader(OSM_ATTRIBUTION), stlHeader('© Something ünicode')]) {
      expect(/^[\x20-\x7E]*$/.test(h)).toBe(true)
    }
  })

  it('never opens with the word that means "this is an ASCII STL"', () => {
    expect(stlHeader(OSM_ATTRIBUTION).startsWith('solid')).toBe(false)
    expect(stlHeader(null).startsWith('solid')).toBe(false)
  })
})
