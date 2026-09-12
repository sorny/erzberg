/**
 * The one brightness threshold three overlays share.
 *
 * The paper frame, the centre guides and the anaglyph all have to answer the
 * same question — is this ground dark enough that ink has to switch sides — and
 * all three carried their own copy of the constants. A threshold that drifts
 * between two overlays on one canvas is a threshold nobody can reason about.
 */
import { describe, expect, it } from 'vitest'
import { isDarkBackground } from '../../src/utils/colorUtils'

describe('isDarkBackground', () => {
  it('is the eye’s weighting, not a plain average', () => {
    // BT.601: green carries most of the brightness and blue almost none. A mean
    // of the channels calls both of these mid-grey and gets both wrong.
    expect(isDarkBackground('#0000ff')).toBe(true)
    expect(isDarkBackground('#00ff00')).toBe(false)
  })

  it('answers the obvious cases obviously', () => {
    expect(isDarkBackground('#ffffff')).toBe(false)
    expect(isDarkBackground('#000000')).toBe(true)
    expect(isDarkBackground('#1a1a1a')).toBe(true)
    expect(isDarkBackground('#f5f0e6')).toBe(false)
  })

  it('treats a missing colour as paper', () => {
    // The app opens on white, and an overlay that guessed dark would paint white
    // ink onto white before the first raster had even loaded.
    expect(isDarkBackground(null)).toBe(false)
    expect(isDarkBackground(undefined)).toBe(false)
    expect(isDarkBackground('')).toBe(false)
    expect(isDarkBackground('not a colour')).toBe(false)
  })
})
