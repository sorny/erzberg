/**
 * What a shut panel section says about itself.
 *
 * Two things are worth pinning, and neither of them needs a browser.
 *
 * The first is the index. A summary map keyed by section title is a second list
 * of the same fifty names that `SECTION_TERMS` already holds, and two hand-kept
 * lists of the same thing drift — the search index says so in its own header,
 * having drifted once already. So they are checked against each other in both
 * directions: a section with no line goes quiet without anyone noticing, and a
 * line with no section is a string nothing will ever render.
 *
 * The second is that the readouts are read off the live params rather than
 * written down twice. The cheapest way to be sure of that is to move a
 * parameter and watch the string follow, which is what most of the cases below
 * do. A summary that survives changing the thing it claims to report is a
 * summary that was hard-coded.
 */
import { describe, expect, it } from 'vitest'
import { buildPlateLine, buildSectionSummaries, SECTIONS_WITHOUT_SUMMARY } from '../../src/components/panel/sectionSummary'
import { SECTION_TERMS } from '../../src/components/panel/sectionTerms'
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from '../../src/defaults'

/** The panel as it opens: defaults everywhere, nothing loaded. */
const atDefaults = (over = {}) => buildSectionSummaries({
  terrain: TERRAIN_DEF, style: STYLE_DEF, view: VIEW_DEF, points: POINTS_DEF,
  zoomPercent: 75, ...over,
})

describe('the summary index', () => {
  it('covers every section the panel has, or names it as silent', () => {
    const covered = new Set([...Object.keys(atDefaults()), ...SECTIONS_WITHOUT_SUMMARY])
    const missing = Object.keys(SECTION_TERMS).filter((t) => !covered.has(t))
    expect(missing).toEqual([])
  })

  it('has no line for a section that does not exist', () => {
    const known = new Set(Object.keys(SECTION_TERMS))
    const orphans = [...Object.keys(atDefaults()), ...SECTIONS_WITHOUT_SUMMARY]
      .filter((t) => !known.has(t))
    expect(orphans).toEqual([])
  })

  it('says nothing at all for the four sections that hold no state', () => {
    const s = atDefaults()
    for (const title of SECTIONS_WITHOUT_SUMMARY) expect(s[title]).toBeUndefined()
  })
})

describe('off', () => {
  it('is a dash, for every switch that is down', () => {
    const s = atDefaults()
    // The em dash, not the word: the whole point is that the eye skips it.
    expect(s['Hillshade']).toBe('—')
    expect(s['Water Fill']).toBe('—')
    expect(s['Mode: Contours']).toBe('—')
    expect(s['Mode: Reticulation']).toBe('—')
    expect(s['Vector Layers']).toBe('—')
    expect(s['Soundscapes']).toBe('—')
  })

  it('is not a dash for Lines, which is the one mode that opens switched on', () => {
    expect(atDefaults()['Mode: Lines']).not.toBe('—')
  })
})

describe('the readouts follow the params', () => {
  it('reports the sun and the strength of the hillshade', () => {
    const style = { ...STYLE_DEF, showHillshade: true, hillshadeAzimuth: 315, hillshadeOpacity: 0.6 }
    expect(atDefaults({ style })['Hillshade']).toBe('315° · 60%')
    // Multi-direction has no azimuth to report, so it says so rather than
    // printing the one the panel is no longer using.
    expect(atDefaults({ style: { ...style, hillshadeMultiDir: true } })['Hillshade'])
      .toBe('multi · 60%')
  })

  it('lists what the surface is drawing rather than counting it', () => {
    expect(atDefaults({ style: { ...STYLE_DEF, showFill: true } })['Terrain Style']).toBe('fill')
    expect(atDefaults({ style: { ...STYLE_DEF, showFill: true, fillHypsometric: true } })['Terrain Style'])
      .toBe('hypso')
    expect(atDefaults({ style: { ...STYLE_DEF, showFill: true, showMesh: true } })['Terrain Style'])
      .toBe('fill · mesh')
  })

  it('gives a mode its own dial, and the label for it on hover', () => {
    const style = { ...STYLE_DEF, enabledContours: true, intervalContours: 20 }
    expect(atDefaults({ style })['Mode: Contours']).toEqual({ text: '20', hint: 'Interval 20' })
    // Bare, because `MODE: CROSSHATCH` and `every 10` do not fit in 244 px
    // together and the section's own name is what gets cut.
    const cross = { ...STYLE_DEF, enabledCross: true, spacingCross: 10 }
    expect(atDefaults({ style: cross })['Mode: Crosshatch']).toEqual({ text: '10', hint: 'Spacing 10' })
  })

  it('counts the inks for the modes that are separations, not one mark', () => {
    expect(atDefaults({ style: { ...STYLE_DEF, enabledRiso: true } })['Mode: Riso'].text).toBe('3 inks')
    expect(atDefaults({ style: { ...STYLE_DEF, enabledShed: true, inksShed: 12 } })['Mode: Watershed'].text)
      .toBe('12 inks')
  })

  it('writes a fractional dial as it is, never as 0.50', () => {
    const style = { ...STYLE_DEF, enabledStipple: true, spacingStipple: 0.5 }
    expect(atDefaults({ style })['Mode: Stipple Dots'].text).toBe('0.5')
  })

  it('reports the view as the panel itself displays it', () => {
    expect(atDefaults()['View']).toBe('50° · 75%')
    expect(atDefaults({ view: { ...VIEW_DEF, showFrame: true } })['View']).toBe('50° · 75% · frame')
  })

  it('drops the resolution when raw terrain replaces every draw mode', () => {
    expect(atDefaults()['Terrain']).toBe('res 2')
    expect(atDefaults({ view: { ...VIEW_DEF, showRawTerrain: true } })['Terrain']).toBe('raw')
    expect(atDefaults({ terrain: { ...TERRAIN_DEF, elevScale: 1.5 } })['Terrain']).toBe('res 2 · +1.5')
  })

  it('names the mirrored sides rather than counting them', () => {
    // The three plus axes are the terrain as loaded, so they are not a mirror.
    expect(atDefaults()['Mirror']).toBe('—')
    expect(atDefaults({ style: { ...STYLE_DEF, showMirrorMinusX: true, showMirrorMinusZ: true } })['Mirror'])
      .toBe('−X −Z')
  })

  it('reports how many vector layers are drawing, out of how many exist', () => {
    const vectorLayers = [{ visible: true }, { visible: false }, { visible: true }]
    expect(atDefaults({ vectorLayers })['Vector Layers']).toBe('2 of 3')
  })

  it('separates a soundscape that is loaded from one that is running', () => {
    expect(atDefaults({ soundscape: { fileName: 'a.mp3', active: false } })['Soundscapes']).toBe('loaded')
    expect(atDefaults({ soundscape: { fileName: 'a.mp3', active: true } })['Soundscapes']).toBe('playing')
  })

  it('says which particle field is running, because the two share one switch', () => {
    const on = { ...POINTS_DEF, showPoints: true }
    expect(atDefaults({ points: on })['Particles']).toBe('every 1')
    expect(atDefaults({ points: { ...on, particleMode: 'murmuration', flockCount: 2000 } })['Particles'])
      .toBe('2000 birds')
  })
})

describe('what it costs the header', () => {
  it('keeps every readout short enough to sit beside a section title', () => {
    // Measured against the widest case the panel has: `MODE: ZERO CROSSINGS`
    // leaves room for about three characters at 9.5 px mono. Everything here is
    // read in a 244 px header, so a long line does not wrap — it eats the name
    // of the section it belongs to.
    const everythingOn = Object.fromEntries(
      Object.keys(STYLE_DEF).map((k) => [k, k.startsWith('enabled') || k.startsWith('show') ? true : STYLE_DEF[k]]),
    )
    const s = buildSectionSummaries({
      terrain: TERRAIN_DEF, style: everythingOn, view: VIEW_DEF, points: { ...POINTS_DEF, showPoints: true },
      zoomPercent: 100,
    })
    for (const [title, value] of Object.entries(s)) {
      const text = typeof value === 'string' ? value : value.text
      expect(text.length, `${title} → "${text}"`).toBeLessThanOrEqual(17)
    }
  })
})

/**
 * The standing line — the same reading one level up.
 *
 * The ink count is the one that has to be exact, because it is the number of
 * pens a plot needs. Two modes in the same black are one pen, a separation is
 * three or five, and Watershed's are generated per basin and can only be
 * counted, never named.
 */
describe('the standing line', () => {
  const line = (style = {}, rest = {}) => buildPlateLine({ style: { ...STYLE_DEF, ...style }, ...rest })

  it('counts the draw modes that are drawing', () => {
    expect(line().marks).toBe(1)                                  // Lines, and only Lines
    expect(line({ enabledContours: true, enabledHachure: true }).marks).toBe(3)
    expect(line({ enabledLines: false }).marks).toBe(0)
  })

  it('counts two modes in the same ink as one pen', () => {
    // Both default to #000000, so a plot needs one pen for the pair.
    expect(line({ enabledContours: true }).inks).toBe(1)
    expect(line({ enabledContours: true, colorContours: '#c81e1e' }).inks).toBe(2)
    // Case is not a different ink.
    expect(line({ enabledContours: true, colorContours: '#000000' }).inks).toBe(1)
  })

  it('counts a separation as the inks it separates into', () => {
    // Riso is three named spot inks and carries no base colour of its own.
    expect(line({ enabledLines: false, enabledRiso: true }).inks).toBe(3)
    // Mineral names five materials. It also carries a `colorMineral` that the
    // geometry is never handed, and counting that would be a sixth pen nothing
    // draws with.
    expect(line({ enabledLines: false, enabledMineral: true }).inks).toBe(5)
    // Watershed generates one per basin while the geometry is built, so there
    // is nothing to name and the setting is the count.
    expect(line({ enabledLines: false, enabledShed: true, inksShed: 10 }).inks).toBe(10)
  })

  it('counts the vector layers that are visible, and the text blocks', () => {
    const l = line({}, {
      vectorLayers: [{ visible: true }, { visible: false }, {}],
      textLayers: [{}, {}],
    })
    expect(l.layers).toBe(2)
    expect(l.text).toBe(2)
  })
})
