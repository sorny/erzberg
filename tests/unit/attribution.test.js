/**
 * Who gets credited, and when.
 *
 * Both licences in play attach to the *produced work* rather than to the tool —
 * ODbL 4.3 to a Produced Work, CC-BY to anything derived from the material — so
 * the question is never "is this data wired up" but "is it in this file".
 *
 * That distinction is the whole reason this lives in one module. `osmFetch.js`
 * records how it went the other time: four exporters asked the same question
 * four ways, and the SVG credited while PNG, STL and WebM silently did not.
 */
import { describe, it, expect } from 'vitest'
import { coverInUse, workAttribution } from '../../src/utils/attribution'
import { ALL_CLASSES, classBit } from '../../src/utils/coverPlate'

const osmLayer = { visible: true, sourceKind: 'osm' }
const cover = { attribution: 'Produced by Google and Google DeepMind.' }

describe('coverInUse', () => {
  it('is false for a plate nothing draws from', () => {
    // Loaded is not the same as used, exactly as a hidden OSM layer is not.
    expect(coverInUse({ enabledLines: true }, cover)).toBe(false)
    expect(coverInUse({}, null)).toBe(false)
  })

  it('is true when the Land cover mode inks it', () => {
    expect(coverInUse({ enabledCover: true }, cover)).toBe(true)
  })

  it('is true when any other layer is shaped by it', () => {
    // A masked layer is derived from the plate just as surely as one that inks
    // it — its marks stop where a class stops — and this is the common case.
    expect(coverInUse({ enabledStipple: true, coverMaskStipple: classBit(2) }, cover)).toBe(true)
  })

  it('ignores a mask on a layer that is switched off', () => {
    expect(coverInUse({ enabledStipple: false, coverMaskStipple: classBit(2) }, cover)).toBe(false)
  })

  it('ignores an unfiltered mask', () => {
    expect(coverInUse({ enabledStipple: true, coverMaskStipple: ALL_CLASSES }, cover)).toBe(false)
  })
})

describe('workAttribution', () => {
  it('owes nothing for a plate and a picture that never met', () => {
    expect(workAttribution({ vectorLayers: [], style: {}, cover })).toBeNull()
  })

  it('credits OpenStreetMap when its features are visible', () => {
    expect(workAttribution({ vectorLayers: [osmLayer], style: {}, cover: null }))
      .toContain('OpenStreetMap')
  })

  it('carries both credits, one per line', () => {
    const out = workAttribution({
      vectorLayers: [osmLayer], style: { enabledCover: true }, cover,
    })
    expect(out.split('\n')).toHaveLength(2)
    expect(out).toContain('OpenStreetMap')
    expect(out).toContain('Google DeepMind')
  })

  it('credits imagery only while it is draped', () => {
    const imagery = { credit: 'Contains modified Copernicus Sentinel data' }
    expect(workAttribution({ vectorLayers: [], style: { showImagery: false }, imagery })).toBeNull()
    expect(workAttribution({ vectorLayers: [], style: { showImagery: true }, imagery }))
      .toContain('Copernicus')
  })

  it('reads the merged parameter bus as well as separate blocks', () => {
    // Scene passes `p`, where the style keys sit at the top level; App passes
    // the state objects. Both call sites hand over what they already hold.
    const flat = { vectorLayers: [], enabledCover: true, cover }
    expect(workAttribution(flat)).toContain('Google DeepMind')
  })
})
