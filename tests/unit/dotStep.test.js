/**
 * The step between the round dots of a dotted line: a per-mode style value
 * that the viewport and the SVG both read through `layerStyle`.
 */
import { describe, it, expect } from 'vitest'
import { layerStyle } from '../../src/utils/builders/shared.js'
import { DOT_STEP, dotSpacing } from '../../src/utils/stylePresets'
import { GEOMETRY_KEYS } from '../../src/params'
import { STYLE_DEF } from '../../src/defaults'

describe('dot step', () => {
  it('keeps the spacing every dotted line had at the default step', () => {
    expect(STYLE_DEF.dotStepLines).toBe(DOT_STEP)
    expect(dotSpacing(4)).toBeCloseTo(8.8, 10)
    expect(dotSpacing(1)).toBe(3)
    expect(dotSpacing(4, undefined)).toBeCloseTo(8.8, 10)
  })

  it('scales the spacing with the step', () => {
    expect(dotSpacing(4, 4.4)).toBeCloseTo(17.6, 10)
    expect(dotSpacing(4, 1)).toBeCloseTo(4, 10)
  })

  it('reaches a dotted layer through its style, and no other layer', () => {
    const p = { ...STYLE_DEF, dashLines: 'dots', dotStepLines: 5 }
    expect(layerStyle('Lines', p).dotStep).toBe(5)
    expect(layerStyle('Contours-Minor', { ...STYLE_DEF, dashContours: 'dots', dotStepContours: 3 }).dotStep).toBe(3)
    expect(layerStyle('Lines', STYLE_DEF).dotStep).toBeUndefined()
  })

  it('reads the step of a mode copy from the copy', () => {
    const p = { ...STYLE_DEF, modeCopies: [{ uid: 'c1', mode: 'Lines', name: 'Lines 2', values: { dashLines: 'dots', dotStepLines: 7 } }] }
    expect(layerStyle('Lines@c1', p).dotStep).toBe(7)
  })

  it('does not rebuild geometry', () => {
    expect(GEOMETRY_KEYS).not.toContain('dotStepLines')
    expect(GEOMETRY_KEYS).toContain('evenStipple')
    expect(GEOMETRY_KEYS).toContain('travelSediment')
  })
})
