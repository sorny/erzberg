import { describe, it, expect } from 'vitest'
import { linkCrests, panoramaCrests } from '../../src/utils/panorama'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { layerStyle } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const N = 101
const grid = (f) => {
  const h = new Float32Array(N * N)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) h[r * N + c] = f(r, c)
  return { heights: h, mask: new Uint8Array(N * N).fill(1), rows: N, cols: N, cellX: 10, cellY: 10 }
}

describe('panoramaCrests', () => {
  it('finds no crest on a flat plain', () => {
    const p = panoramaCrests(grid(() => 0), { row: 50, col: 50, eye: 2 })
    expect(p.crests.every((c) => c.length === 0)).toBe(true)
  })

  it('finds a wall as a crest, due east, and joins it into a line', () => {
    const p = panoramaCrests(grid((r, c) => (c === 70 ? 40 : 0)), { row: 50, col: 50, eye: 2 })
    // Bearing 90° is a quarter of the way round.
    const east = p.crests[Math.round(p.rays / 4)]
    expect(east.length).toBe(3)
    expect(east[2]).toBeGreaterThan(69)
    expect(east[2]).toBeLessThan(71)
    // Due west there is nothing in the way.
    expect(p.crests[Math.round((p.rays * 3) / 4)].length).toBe(0)
    expect(linkCrests(p).length).toBeGreaterThan(40)
  })

  it('drops a crest that shelters less than the minimum depth', () => {
    // The wall hides 30 cells, 300 m, before the edge of the data.
    const g = grid((r, c) => (c === 70 ? 40 : 0))
    const east = (d) => { const p = panoramaCrests(g, { row: 50, col: 50, eye: 2, minDepth: d }); return p.crests[Math.round(p.rays / 4)].length }
    expect(east(200)).toBe(3)
    expect(east(400)).toBe(0)
  })
})

describe('Panorama, Bedding and Slope classes modes', () => {
  const W = 96
  const px = new Float32Array(W * W)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = 0.5 + 0.25 * Math.sin(x / 11) * Math.cos(y / 13)
  const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false }
  const terrain = buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0)
  const layers = (p) => buildLineGeometry(terrain, { ...p0, ...p })
  const wellFormed = (l) => {
    expect(l.positions.length).toBeGreaterThan(60)
    expect(l.colors.length).toBe(l.positions.length)
    for (const v of l.positions) expect(Number.isFinite(v)).toBe(true)
  }

  it('Panorama draws crests and a skyline as two pens', () => {
    const ls = layers({ enabledPanorama: true, reliefPanorama: 3000, depthPanorama: 50, originXPanorama: 0.2, originYPanorama: 0.2 })
    wellFormed(ls.find((l) => l.id === 'Panorama-Crests'))
    expect(ls.some((l) => l.id === 'Panorama-Skyline')).toBe(true)
  })

  it('Bedding draws beds, and a marker bed as its own pen', () => {
    const one = layers({ enabledBedding: true, markerBedding: 0 })
    wellFormed(one.find((l) => l.id === 'Bedding'))
    const two = layers({ enabledBedding: true, markerBedding: 5 })
    wellFormed(two.find((l) => l.id === 'Bedding-Beds'))
    expect(two.find((l) => l.id === 'Bedding-Marker').positions.length).toBeGreaterThan(0)
  })

  it('Bedding at a dip of 0 is the contours of the ground', () => {
    // A level plane cuts the ground in contours, so every vertex of a bed sits
    // at one of the bed heights: few distinct elevations, not a spread.
    const l = layers({ enabledBedding: true, markerBedding: 0, dipBedding: 0, bedsBedding: 8, smoothingBedding: 0 })
      .find((x) => x.id === 'Bedding')
    const ys = []
    for (let i = 1; i < l.positions.length; i += 3) ys.push(l.positions[i])
    ys.sort((a, b) => a - b)
    // Heights fall into tight clusters, one per bed, with clear gaps between.
    let clusters = 1
    for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > 0.5) clusters++
    expect(clusters).toBeLessThanOrEqual(8)
  })

  it('Slope classes put a 37° ramp in the middle band', () => {
    const ramp = new Float32Array(W * W)
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) ramp[y * W + x] = x / (W - 1)
    const t = buildTerrain(ramp, new Uint8Array(W * W).fill(1), W, W, p0)
    // Black to white over 95 cells of 10 m at 37°.
    const relief = Math.tan(37 * Math.PI / 180) * 10 * (W - 1)
    const ls = buildLineGeometry(t, { ...p0, enabledSlopeClass: true, reliefSlopeClass: relief, cellMetresSlopeClass: 10 })
    const mid = ls.find((l) => l.id === 'SlopeClass-Mid')
    wellFormed(mid)
    expect(mid.note.mid).toBeGreaterThan(0.9)
    expect(ls.some((l) => l.id === 'SlopeClass-High')).toBe(false)
  })

  it('names each slope band by its degrees', () => {
    expect(layerStyle('SlopeClass-Low', STYLE_DEF).name).toBe('Slope classes · 30–35°')
    expect(layerStyle('SlopeClass-High', STYLE_DEF).name).toBe('Slope classes · over 40°')
  })
})
