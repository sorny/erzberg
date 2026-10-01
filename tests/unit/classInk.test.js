/**
 * Land cover as a colour source for any mode: the pass after the build.
 *
 * What a plotter depends on is which pen layer a stroke lands in, so that is
 * what most of this pins: the midpoint decides, a no-data cell keeps the
 * builder's colour under the layer's own id, and the parts that belong to the
 * whole layer are drawn once rather than once per class.
 */
import { describe, expect, it } from 'vitest'
import { inkByClass } from '../../src/utils/builders/classInk.js'
import { layerStyle } from '../../src/utils/builders/shared.js'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { buildTerrain } from '../../src/utils/terrain'
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from '../../src/defaults'

// A 4 × 1 strip, one unit per cell, centred: cell c is at world x = c − 1.5.
// Classes 0, 0, 1, 2; the last cell is no-data.
function strip({ plate = true } = {}) {
  return {
    rows: 1, cols: 4, scl: 1, halfW: 1.5, halfH: 0,
    gridMask: new Uint8Array([1, 1, 1, 0]),
    gridClass: new Uint8Array([0, 0, 1, 2]),
    gridPlate: plate ? new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]) : null,
    classColors: ['#ff0000', '#00ff00', '#0000ff'],
  }
}
const x = (c) => c - 1.5
const seg = (c0, c1) => [x(c0), 0, 0, x(c1), 0, 0]
const layer = (...segs) => ({
  positions: new Float32Array(segs.flat()),
  colors: new Float32Array(segs.length * 6).fill(0.5),
})

describe('inkByClass', () => {
  it('puts each segment in the layer of its midpoint class', () => {
    // 0→0 is class 0. 1→2 has its midpoint at 1.5, which rounds to cell 2: class 1.
    const out = inkByClass(layer(seg(0, 0), seg(1, 2), seg(2, 2)), strip(), 'class')
    expect(Object.keys(out)).toEqual(['Class0', 'Class1'])
    expect(out.Class0.positions.length).toBe(6)
    expect(out.Class1.positions.length).toBe(12)
  })

  it('keeps a stroke on a no-data cell under the layer id, in its own colour', () => {
    const out = inkByClass(layer(seg(3, 3), seg(0, 0)), strip(), 'class')
    expect(Object.keys(out)).toEqual(['', 'Class0'])
    expect([...out[''].colors]).toEqual(new Array(6).fill(0.5))
  })

  it('writes the class ink on both ends', () => {
    const out = inkByClass(layer(seg(2, 2)), strip(), 'class')
    expect([...out.Class1.colors]).toEqual([0, 1, 0, 0, 1, 0])
  })

  it('writes the plate colour at each end, and still splits by class', () => {
    // Midpoint 0.5 rounds to cell 1: class 0. Ends at cells 0 and 1.
    const out = inkByClass(layer(seg(0, 1)), strip(), 'plate')
    expect(Object.keys(out)).toEqual(['Class0'])
    expect([...out.Class0.colors]).toEqual([1, 0, 0, 0, 1, 0])
  })

  it('draws the whole-layer parts once, and keeps the drawing flags on every part', () => {
    const res = { ...layer(seg(0, 0), seg(2, 2)), isPoints: true, note: 'n', labelAnchors: [1] }
    const out = inkByClass(res, strip(), 'class')
    expect(out.Class0.note).toBe('n')
    expect(out.Class0.labelAnchors).toEqual([1])
    expect(out.Class1.note).toBeUndefined()
    expect(out.Class1.isPoints).toBe(true)
  })

  it('does nothing without a plate, or for another source', () => {
    expect(inkByClass(layer(seg(0, 0)), { ...strip(), gridClass: null }, 'class')).toBeNull()
    expect(inkByClass(layer(seg(0, 0)), strip(), 'elevation')).toBeNull()
  })
})

describe('class layers', () => {
  it('are styled as their part and named for their class', () => {
    const p = {
      weightContours: 1, majorWeightContours: 3, opacityContours: 0.8, dashContours: 'solid',
      cover: { classes: [{ index: 1, name: 'Forest', color: '#16b865' }] },
    }
    const s = layerStyle('Contours-Major-Class1', p)
    expect(s.weight).toBe(3)
    expect(s.opacity).toBe(0.8)
    expect(s.name).toBe('Contours · Major · Forest #16b865')
    expect(layerStyle('Hachure-Class4', { weightHachure: 2 }).name).toBe('Hachure · Class E')
  })
})

describe('the dispatcher', () => {
  // A real grid: a gentle bump, left half class 0, right half class 1.
  const W = 64
  const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false }
  const px = new Float32Array(W * W)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = 0.5 + 0.2 * Math.sin(x / 7) * Math.cos(y / 9)
  const labels = new Uint8Array(W * W)
  for (let y = 0; y < W; y++) for (let x = W / 2; x < W; x++) labels[y * W + x] = 1
  const cover = { labels, width: W, height: W, classColors: ['#ff0000', '#0000ff'] }
  const t = buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0, null, cover)
  const ids = (p) => buildLineGeometry(t, { ...p0, ...p }).map((l) => l.id)

  it('splits an ordinary mode into one layer per class, and only on that source', () => {
    const on = { enabledContours: true, hypsoContours: true }
    expect(ids({ ...on, hypsoModeContours: 'elevation' })).toEqual(['Contours-Minor', 'Contours-Major'])
    expect(ids({ ...on, hypsoModeContours: 'class' })).toEqual(
      ['Contours-Minor-Class0', 'Contours-Minor-Class1', 'Contours-Major-Class0', 'Contours-Major-Class1'])
  })

  it('leaves Pillars to its own class ink', () => {
    // Stated as a guard: the generic pass on Pillars would split it twice.
    const got = ids({ enabledPillars: true, hypsoPillars: true, hypsoModePillars: 'class' })
    expect(got).toEqual(['Pillars'])
  })
})
