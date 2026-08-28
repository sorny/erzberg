/**
 * Polyline simplification and the layer-style cascade.
 *
 * `simplifyFlat` runs between Chaikin passes and keeps ~40× the geometry off the
 * GPU for a deviation well under a pixel — a claim that was only ever checked by
 * looking at the result. `layerStyle` is the render-side half of the rebuild
 * contract: every key it reads is deliberately absent from `geometryKey`, so
 * these two files are two halves of the same statement.
 */
import { describe, expect, it } from 'vitest'
import { simplifyFlat, layerStyle, hasFillLayer, needsSurfaceShading } from '../../src/utils/geometryBuilders'
import { STYLE_DEF } from '../../src/defaults'

/** Flat [x,y,…] from pairs. */
const flat = (pairs) => Float64Array.from(pairs.flat())
/** Back to pairs, for readable expectations. */
const pairs = (a) => { const o = []; for (let i = 0; i < a.length; i += 2) o.push([a[i], a[i + 1]]); return o }

describe('simplifyFlat', () => {
  it('passes through anything shorter than three points', () => {
    const two = flat([[0, 0], [1, 1]])
    expect(simplifyFlat(two, 1)).toBe(two)
  })

  it('collapses collinear interior points to the two endpoints', () => {
    const line = flat([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])
    expect(pairs(simplifyFlat(line, 0.1))).toEqual([[0, 0], [4, 0]])
  })

  it('keeps a deviation larger than epsilon and drops one smaller', () => {
    const kinked = (h) => flat([[0, 0], [2, h], [4, 0]])
    expect(pairs(simplifyFlat(kinked(1), 0.5))).toEqual([[0, 0], [2, 1], [4, 0]])
    expect(pairs(simplifyFlat(kinked(0.1), 0.5))).toEqual([[0, 0], [4, 0]])
  })

  it('always keeps both endpoints', () => {
    const zig = flat([[0, 0], [1, 5], [2, -5], [3, 5], [4, 0]])
    const out = pairs(simplifyFlat(zig, 0.01))
    expect(out[0]).toEqual([0, 0])
    expect(out[out.length - 1]).toEqual([4, 0])
  })

  it('never returns more points than it was given', () => {
    const noisy = []
    for (let i = 0; i < 500; i++) noisy.push([i, Math.sin(i * 0.3) * 0.4])
    const src = flat(noisy)
    for (const eps of [0, 0.01, 0.1, 1, 10]) {
      expect(simplifyFlat(src, eps).length).toBeLessThanOrEqual(src.length)
    }
  })

  it('drops nearly everything from a smooth curve at a loose epsilon', () => {
    // The 40×-off-the-GPU claim, in miniature.
    const arc = []
    for (let i = 0; i <= 400; i++) arc.push([i * 0.25, Math.sin(i * 0.004) * 10])
    const src = flat(arc)
    const out = simplifyFlat(src, 0.5)
    expect(out.length / src.length).toBeLessThan(0.1)
  })

  it('handles a degenerate span where both ends coincide', () => {
    // len2 < 1e-20 takes the point-distance branch rather than dividing by zero.
    const loop = flat([[0, 0], [1, 1], [0, 0]])
    const out = simplifyFlat(loop, 0.1)
    expect(Number.isFinite(out[0])).toBe(true)
    expect(pairs(out)).toContainEqual([1, 1])
  })

  it('writes into a supplied buffer when one is big enough', () => {
    const line = flat([[0, 0], [1, 0], [2, 0]])
    const buf = new Float64Array(line.length)
    const out = simplifyFlat(line, 0.1, buf)
    expect(out.buffer).toBe(buf.buffer)
  })
})

describe('layerStyle', () => {
  const p = { ...STYLE_DEF }

  it('reads a mode\'s own weight, opacity and dash', () => {
    const s = layerStyle('Lines', { ...p, weightLines: 3, opacityLines: 0.4, dashLines: 'dotted' })
    expect(s).toMatchObject({ weight: 3, opacity: 0.4, dash: 'dotted' })
  })

  it('gives the major contour layer its own weight but the layer\'s opacity', () => {
    const s = layerStyle('Contours-Major', { ...p, majorWeightContours: 5, opacityContours: 0.6 })
    expect(s).toMatchObject({ weight: 5, opacity: 0.6 })
  })

  it('gives each Tanaka half its own weight and a shared opacity', () => {
    const q = { ...p, tanakaWeightBright: 4, tanakaWeightDark: 0.25, opacityContours: 0.9 }
    expect(layerStyle('Contours-Tanaka-Bright', q)).toMatchObject({ weight: 4, opacity: 0.9 })
    expect(layerStyle('Contours-Tanaka-Dark', q)).toMatchObject({ weight: 0.25, opacity: 0.9 })
  })

  it('falls the contour label\'s colour back to the contour colour', () => {
    // `null` means "follow the contours" — the same cascade the vector layers'
    // ink uses. It is the one draw-mode layer carrying a flat colour, because
    // lettering has no per-vertex colour buffer to read.
    expect(layerStyle('Contours-Labels', { ...p, colorContours: '#abcdef', labelColorContours: null }).color)
      .toBe('#abcdef')
    expect(layerStyle('Contours-Labels', { ...p, colorContours: '#abcdef', labelColorContours: '#123456' }).color)
      .toBe('#123456')
  })

  it('gives the scree dots their own weight, apart from the rock hachures', () => {
    const q = { ...p, weightSwiss: 1, screeWeightSwiss: 3, opacitySwiss: 0.5 }
    expect(layerStyle('Swiss-Rock', q)).toMatchObject({ weight: 1, opacity: 0.5 })
    expect(layerStyle('Swiss-Scree', q)).toMatchObject({ weight: 3, opacity: 0.5 })
  })
})

describe('needsSurfaceShading', () => {
  it('is false when nothing would draw a shaded surface', () => {
    expect(needsSurfaceShading({ ...STYLE_DEF })).toBe(false)
  })

  it('turns on for any of the fill or overlay switches, and for profile mode', () => {
    for (const k of ['showFill', 'showHillshade', 'showSlopeShade', 'showAspectMap',
                     'showAO', 'showWaterFill', 'profileMode']) {
      expect(needsSurfaceShading({ ...STYLE_DEF, [k]: true })).toBe(true)
    }
  })

  it('is deliberately narrower than hasFillLayer: raw terrain view is not in it', () => {
    // Raw terrain view is a flat greyscale readout that consults neither normals
    // nor UVs, so listing it would cost a full geometry rebuild on every toggle
    // to produce buffers nothing reads.
    const raw = { ...STYLE_DEF, showRawTerrain: true }
    expect(hasFillLayer(raw)).toBe(true)
    expect(needsSurfaceShading(raw)).toBe(false)
  })

  it('agrees with hasFillLayer about a plain fill', () => {
    expect(hasFillLayer({ ...STYLE_DEF, showFill: true })).toBe(true)
    expect(hasFillLayer({ ...STYLE_DEF })).toBe(false)
  })
})
