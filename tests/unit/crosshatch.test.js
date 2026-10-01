import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry, layerStyle } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const W = 96
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false }
const px = new Float32Array(W * W)
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = 0.5 + 0.2 * Math.sin(x / 9) * Math.cos(y / 11)
const t = buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0)
const layers = (p) => buildLineGeometry(t, { ...p0, enabledCross: true, ...p })
const span = (t.cols - 1) * t.scl

describe('Crosshatch', () => {
  it('is one pen, as before, with the marks off', () => {
    const ls = layers({})
    expect(ls.filter((l) => l.id.startsWith('Cross')).map((l) => l.id)).toEqual(['Cross'])
  })

  it('draws only the frame at a spacing as wide as the terrain', () => {
    const l = layers({ spacingCross: span }).find((x) => x.id === 'Cross')
    const xs = [t.halfW * -1, (t.cols - 1) * t.scl - t.halfW], zs = [-t.halfH, (t.rows - 1) * t.scl - t.halfH]
    const onEdge = (x, z) => xs.some((e) => Math.abs(x - e) < 1e-3) || zs.some((e) => Math.abs(z - e) < 1e-3)
    expect(l.positions.length).toBeGreaterThan(0)
    for (let q = 0; q < l.positions.length; q += 3) expect(onEdge(l.positions[q], l.positions[q + 2])).toBe(true)
  })

  it('puts a cross at every intersection, as its own pen', () => {
    const ls = layers({ spacingCross: span / 6, marksCross: true })
    const marks = ls.find((l) => l.id === 'Cross-Marks')
    expect(ls.some((l) => l.id === 'Cross')).toBe(true)
    expect(marks.positions.length).toBeGreaterThan(0)
    expect(layerStyle('Cross-Marks', STYLE_DEF).name).toBe('Crosshatch · Intersections')
  })

  it('leaves only the crosses with the lines off, in their own colour', () => {
    const ls = layers({ spacingCross: span / 6, marksCross: true, linesCross: false, markColorCross: '#ff0000' })
    expect(ls.filter((l) => l.id.startsWith('Cross')).map((l) => l.id)).toEqual(['Cross-Marks'])
    const c = ls[0].colors
    expect(c[0]).toBeCloseTo(1, 2); expect(c[1]).toBeCloseTo(0, 2); expect(c[2]).toBeCloseTo(0, 2)
  })

  it('makes a cross the given size', () => {
    const small = layers({ spacingCross: span / 3, marksCross: true, linesCross: false, markSizeCross: 4 })[0]
    const big = layers({ spacingCross: span / 3, marksCross: true, linesCross: false, markSizeCross: 16 })[0]
    const extent = (l) => { let s = 0; for (let q = 0; q < l.positions.length; q += 6) s += Math.hypot(l.positions[q + 3] - l.positions[q], l.positions[q + 5] - l.positions[q + 2]); return s }
    expect(extent(big) / extent(small)).toBeGreaterThan(2.5)
  })
})
