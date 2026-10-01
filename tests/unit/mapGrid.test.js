import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry, layerStyle } from '../../src/utils/geometryBuilders'
import { roundDistance } from '../../src/utils/builders/mapGrid'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const W = 96
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false }
const px = new Float32Array(W * W)
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = 0.5 + 0.2 * Math.sin(x / 9) * Math.cos(y / 11)
const t = buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0)
// 96 px at 10 m a pixel: 940 m across the grid's 47 cells of 2 px.
const layers = (p) => buildLineGeometry(t, { ...p0, enabledMapGrid: true, cellMetresMapGrid: 10, ...p })
const ids = (ls) => ls.filter((l) => l.id.startsWith('MapGrid')).map((l) => l.id)

describe('roundDistance', () => {
  it('takes the nearest of 1, 2 and 5 times a power of ten', () => {
    expect(roundDistance(900)).toBe(1000)
    expect(roundDistance(170)).toBe(200)
    expect(roundDistance(3.4)).toBe(5)
  })
})

describe('Map grid', () => {
  it('opens as crosses and an edge scale, each its own pen', () => {
    const ls = layers({ intervalMapGrid: 200 })
    expect(ids(ls)).toEqual(['MapGrid-Marks', 'MapGrid-Scale'])
    expect(layerStyle('MapGrid-Marks', STYLE_DEF).name).toBe('Map grid · Crosses')
    expect(layerStyle('MapGrid-Scale', STYLE_DEF).name).toBe('Map grid · Scale')
  })

  it('names round distances from the south-west corner, in metres on a small sheet', () => {
    const scale = layers({ intervalMapGrid: 200 }).find((l) => l.id === 'MapGrid-Scale')
    const texts = scale.scaleAnchors.map((a) => a.text)
    for (const s of ['0', '200', '400', '600', '800']) expect(texts).toContain(s)
    expect(texts.filter((s) => s === 'm')).toHaveLength(4)
    expect(scale.note.stepM).toBe(200)
  })

  it('names kilometres once the sheet passes one', () => {
    const texts = layers({ intervalMapGrid: 1000, cellMetresMapGrid: 40 })
      .find((l) => l.id === 'MapGrid-Scale').scaleAnchors.map((a) => a.text)
    expect(texts).toContain('km')
    expect(texts).toContain('3')
  })

  it('names a fine grid on a kilometre sheet with the decimals it needs', () => {
    // 47 cells of 2 px at 15 m: a 1 410 m sheet, and a 5 m grid is 282 lines.
    const scale = layers({ intervalMapGrid: 5, cellMetresMapGrid: 15 }).find((l) => l.id === 'MapGrid-Scale')
    expect(scale.note.stepM).toBe(5)
    const texts = scale.scaleAnchors.map((a) => a.text)
    for (const s of ['km', '0.005', '0.015', '1.405']) expect(texts).toContain(s)
    // Each distance is named at most on all four sides, never twice on one:
    // two fixed decimals named 0.005 and 0.01 both "0.01".
    const count = {}
    for (const s of texts) count[s] = (count[s] ?? 0) + 1
    for (const [s, n] of Object.entries(count)) if (s !== 'km') expect(n).toBeLessThanOrEqual(4)
  })

  it('raises an interval that would draw too many lines, and says so', () => {
    const scale = layers({ intervalMapGrid: 1 }).find((l) => l.id === 'MapGrid-Scale')
    expect(scale.note.stepM).toBeGreaterThan(1)
    expect(scale.note.raised).toBe(true)
  })

  it('draws the lines as one pen when asked, with the edge as a frame', () => {
    const l = layers({ intervalMapGrid: 200, linesMapGrid: true, marksMapGrid: false, scaleMapGrid: false })
      .find((x) => x.id === 'MapGrid')
    expect(l.positions.length).toBeGreaterThan(0)
    // The frame: some segment runs along the east edge.
    const east = (t.cols - 1) * t.scl - t.halfW
    let onEast = false
    for (let q = 0; q < l.positions.length; q += 6) if (Math.abs(l.positions[q] - east) < 1e-3 && Math.abs(l.positions[q + 3] - east) < 1e-3) onEast = true
    expect(onEast).toBe(true)
  })
})
