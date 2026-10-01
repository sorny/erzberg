/**
 * One Colour row for every mode, and Pillars' old ink rows moved onto it.
 *
 * The migration is the part where a mistake changes somebody's picture: a
 * plate saved with `pillarInk: 'class'` must still split by class after the
 * keys are gone, and one saved with `line` must not grow a gradient.
 */
import { describe, expect, it } from 'vitest'
import { migratePillarInk, parsePreset, PRESET_FORMAT } from '../../src/utils/presetFile'
import { colourOptions } from '../../src/components/panel/colourSource'

describe('migratePillarInk', () => {
  it('moves a class or plate ink onto that half\'s colour source', () => {
    const out = migratePillarInk({ style: { pillarInk: 'class', pillarAboveInk: 'plate', hypsoPillars: true, hypsoModePillars: 'elevation' } })
    expect(out.style).toEqual({
      hypsoPillars: true, hypsoModePillars: 'class',
      hypsoPillarsAbove: true, hypsoModePillarsAbove: 'plate',
    })
  })

  it('drops a line ink without touching the source', () => {
    const out = migratePillarInk({ style: { pillarInk: 'line', hypsoPillars: false, hypsoModePillars: 'slope' } })
    expect(out.style).toEqual({ hypsoPillars: false, hypsoModePillars: 'slope' })
  })

  it('moves the keys inside mode copies too', () => {
    const out = migratePillarInk({ style: { modeCopies: [{ uid: 'c1', mode: 'Pillars', values: { pillarInk: 'class' } }] } })
    expect(out.style.modeCopies[0].values).toEqual({ hypsoPillars: true, hypsoModePillars: 'class' })
  })

  it('runs for a payload before format 4, and not after', () => {
    expect(PRESET_FORMAT).toBe(4)
    const old = parsePreset(JSON.stringify({ format: 3, style: { pillarInk: 'plate' } }))
    expect(old.style.hypsoModePillars).toBe('plate')
    const now = parsePreset(JSON.stringify({ format: 4, style: { hypsoPillars: false } }))
    expect(now.style).toEqual({ hypsoPillars: false })
  })
})

describe('colourOptions', () => {
  const values = (o) => o.map(([, v]) => v)

  it('is the same row for an ordinary mode', () => {
    expect(values(colourOptions({ prefix: 'Lines', current: 'line', classSource: true, hasPlate: true })))
      .toEqual(['line', 'elevation', 'slope', 'aspect', 'class', 'plate'])
  })

  it('offers Speed to the descent modes only, unless a mode already has it', () => {
    expect(values(colourOptions({ prefix: 'Berm', current: 'line', classSource: true, hasPlate: true }))).toContain('speed')
    expect(values(colourOptions({ prefix: 'Lines', current: 'line', classSource: true, hasPlate: true }))).not.toContain('speed')
    expect(values(colourOptions({ prefix: 'Lines', current: 'speed', classSource: true, hasPlate: true }))).toContain('speed')
  })

  it('shows Class and Plate disabled without a plate, with the reason', () => {
    const o = colourOptions({ prefix: 'Lines', current: 'line', classSource: true, hasPlate: false })
    const cls = o.find(([, v]) => v === 'class')
    expect(cls[2].disabled).toBe(true)
    expect(cls[2].title).toMatch(/Needs a land cover plate/)
  })

  it('has no land cover choice where the mode inks by class itself', () => {
    expect(values(colourOptions({ prefix: 'Cover', current: 'line', classSource: false, hasPlate: true })))
      .not.toContain('class')
  })
})
