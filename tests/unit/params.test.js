/**
 * The parameter registry — the guard on the rebuild contract.
 *
 * `geometryKey` decides when the geometry worker runs, so a mistake in
 * RENDER_SIDE is expensive in one of two ways and silent in both: too broad and
 * a knob moves without redrawing anything, too narrow and dragging a colour
 * slider rebuilds fifteen draw modes. Neither shows up as a failure anywhere
 * else — the first looks like a bug in the draw mode, the second like the app
 * being slow.
 *
 * These are the assertions that used to be a 180-line array nobody could audit.
 */
import { describe, expect, it } from 'vitest'
import { GEOMETRY_KEYS, GEOMETRY_NON_SCALAR, GROUP_OF, geometryKey } from '../../src/params'
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from '../../src/defaults'

/** The merged param bus, as App builds it. */
const allParams = () => ({ ...TERRAIN_DEF, ...STYLE_DEF, ...POINTS_DEF, ...VIEW_DEF })

describe('GROUP_OF', () => {
  it('names an owner for every default', () => {
    for (const k of Object.keys(allParams())) expect(GROUP_OF.get(k)).toBeTruthy()
  })

  it('routes each key to the object it actually came from', () => {
    expect(GROUP_OF.get('resolution')).toBe('terrain')
    expect(GROUP_OF.get('spacingLines')).toBe('style')
    expect(GROUP_OF.get('flockCount')).toBe('points')
    expect(GROUP_OF.get('tilt')).toBe('view')
  })

  it('covers the keys the old prefix router silently dropped', () => {
    // 73 style keys matched none of setParams' sixteen prefixes and none of its
    // explicit branches. These are the families that were undeliverable.
    for (const k of ['angleLines', 'angleCross', 'hillshadeAzimuth', 'labelSizeContours',
                     'seedStipple', 'showAO', 'showWaterFill', 'tanakaContours']) {
      expect(GROUP_OF.get(k)).toBe('style')
    }
  })

  it('has no key claimed by two groups', () => {
    // The construction of GROUP_OF throws on a collision, so importing it at all
    // is most of this assertion. This pins the count so a silently-dropped
    // duplicate would show as a shrinking total.
    const counted = Object.keys(TERRAIN_DEF).length + Object.keys(STYLE_DEF).length
                  + Object.keys(POINTS_DEF).length + Object.keys(VIEW_DEF).length
    expect(GROUP_OF.size).toBe(counted)
  })
})

describe('GEOMETRY_KEYS', () => {
  it('includes the params that move a vertex', () => {
    for (const k of ['resolution', 'blurRadius', 'elevScale', 'elevMinCut', 'jitterAmt',
                     'spacingLines', 'angleLines', 'colorLines', 'enabledLines',
                     'intervalContours', 'smoothingContours', 'labelContours',
                     'seedStipple', 'thresholdSwiss', 'depthOcclusion',
                     'showMirrorPlusX', 'hypsoLines', 'hypsoIntervalLines']) {
      expect(GEOMETRY_KEYS).toContain(k)
    }
  })

  it('excludes everything resolved at render time', () => {
    for (const k of ['weightLines', 'opacityLines', 'dashLines',
                     'occlusionColor', 'occlusionOpacity', 'occlusionBias',
                     'fillColor', 'fillHypsometric', 'showFill', 'bgColor',
                     'hillshadeAzimuth', 'showHillshade', 'showAO', 'waterLevel',
                     'tanakaWeightBright', 'labelColorContours', 'screeWeightSwiss',
                     'textureScale', 'tilt', 'rotation', 'zoom', 'renderScale',
                     'showFrame', 'flockCount', 'showPoints']) {
      expect(GEOMETRY_KEYS).not.toContain(k)
    }
  })

  it('keeps depthOcclusion in, because curtains are geometry', () => {
    // The occlusion *look* is render-side; the curtain meshes are not. Building
    // them for a scene that will not draw them costs ~18 MB a rebuild, which is
    // why the switch is worth one rebuild of its own.
    expect(GEOMETRY_KEYS).toContain('depthOcclusion')
    expect(GEOMETRY_KEYS).not.toContain('occlusionOpacity')
  })

  it('leaves the non-scalars out — they are depended on by identity', () => {
    for (const k of GEOMETRY_NON_SCALAR) expect(GEOMETRY_KEYS).not.toContain(k)
  })
})

describe('geometryKey', () => {
  it('changes when a geometry param changes', () => {
    const p = allParams()
    const before = geometryKey(p)
    expect(geometryKey({ ...p, spacingLines: p.spacingLines + 1 })).not.toBe(before)
    expect(geometryKey({ ...p, resolution: 4 })).not.toBe(before)
    expect(geometryKey({ ...p, enabledContours: true })).not.toBe(before)
  })

  it('does not change when a render-side param changes', () => {
    const p = allParams()
    const before = geometryKey(p)
    for (const patch of [{ weightLines: 9 }, { opacityLines: 0.3 }, { dashLines: 'dotted' },
                         { hillshadeAzimuth: 120 }, { showFill: true }, { tilt: 12 },
                         { flockCount: 50000 }, { occlusionOpacity: 0.5 }]) {
      expect(geometryKey({ ...p, ...patch })).toBe(before)
    }
  })

  it('cannot be fooled by two values running together', () => {
    // The key is built by concatenation, so the separator has to make
    // ("ab", "c") and ("a", "bc") distinguishable.
    const p = allParams()
    const a = geometryKey({ ...p, colorLines: '#111111', colorCross: '#222222' })
    const b = geometryKey({ ...p, colorLines: '#111111#222222', colorCross: '' })
    expect(a).not.toBe(b)
  })

  it('is stable for equal input', () => {
    const p = allParams()
    expect(geometryKey(p)).toBe(geometryKey({ ...p }))
  })

  it('reads the effective elevScale App puts on the bus, not the stored offset', () => {
    // App writes `elevScale: baseElevScale + terrain.elevScale` onto `p`, so a
    // GeoTIFF's intrinsic scale changing has to rebuild even when the user's
    // offset slider has not moved.
    const p = allParams()
    expect(geometryKey({ ...p, elevScale: 1 })).not.toBe(geometryKey({ ...p, elevScale: 2 }))
  })
})
