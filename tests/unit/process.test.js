/**
 * The process and mesh modes: Sand Ripples, Hoarfrost, Cross-Stitch and TIN
 * Facets, on small synthetic ground whose answer is known.
 */
import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const W = 96
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false, resolution: 1 }
const terrainOf = (f) => {
  const px = new Float32Array(W * W)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = f(x, y)
  return buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0)
}
const layers = (t, p) => buildLineGeometry(t, { ...p0, ...p })
const one = (t, p, id) => layers(t, p).find((l) => l.id === id)
const wellFormed = (l) => {
  expect(l).toBeTruthy()
  expect(l.positions.length).toBeGreaterThan(0)
  expect(l.positions.length % 6).toBe(0)
  expect(l.colors.length).toBe(l.positions.length)
  for (const v of l.positions) expect(Number.isFinite(v)).toBe(true)
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
const cone = terrainOf((x, y) => Math.max(0, 1 - Math.hypot(x - 48, y - 48) / 44))

describe('Sand Ripples', () => {
  it('combs crests over the low ground and contours the rock above', () => {
    const ls = layers(cone, { enabledRipples: true, wavelengthRipples: 4, topRipples: 0.5 })
    const sand = ls.find((l) => l.id === 'Ripples-Sand'), rock = ls.find((l) => l.id === 'Ripples-Rock')
    wellFormed(sand); wellFormed(rock)
    expect(sand.note.sand).toBeGreaterThan(0.3)
    expect(sand.note.sand).toBeLessThan(1)
    // Heights run from −50 to 50: no crest above the dune field's top.
    for (let q = 1; q < sand.positions.length; q += 3) expect(sand.positions[q]).toBeLessThan(2)
  })
})

describe('Hoarfrost', () => {
  it('grows crystals from the summit and keeps them on the cold ground', () => {
    const l = one(cone, { enabledHoarfrost: true, coldHoarfrost: 0.5, countHoarfrost: 400, cellHoarfrost: 1 }, 'Hoarfrost-Ice')
    wellFormed(l)
    expect(l.note.crystals).toBeGreaterThan(50)
    // Heights run from −50 to 50 and the cold line is at 0.
    for (let q = 1; q < l.positions.length; q += 3) expect(l.positions[q]).toBeGreaterThan(-3)
  })
})

describe('Cross-Stitch', () => {
  it('stitches the high ground in the dark thread and outlines the bands', () => {
    const ls = layers(cone, { enabledStitch: true, cellStitch: 4, bandsStitch: 5 })
    for (const id of ['Stitch-Light', 'Stitch-Dark', 'Stitch-Back']) wellFormed(ls.find((l) => l.id === id))
    const heights = (id) => { const l = ls.find((x) => x.id === id), a = []; for (let q = 1; q < l.positions.length; q += 3) a.push(l.positions[q]); return mean(a) }
    expect(heights('Stitch-Dark')).toBeGreaterThan(heights('Stitch-Light'))
    // 24 × 24 cells, and the lowest fifth is bare cloth.
    const n = ls.find((l) => l.id === 'Stitch-Dark').note.stitches
    expect(n).toBeGreaterThan(300)
    expect(n).toBeLessThan(24 * 24)
  })
})

describe('TIN Facets', () => {
  it('triangulates the ground and hatches the facets that face away from the sun', () => {
    const ls = layers(cone, { enabledTin: true, countTin: 300 })
    const hatch = ls.find((l) => l.id === 'Tin-Hatch')
    wellFormed(hatch); wellFormed(ls.find((l) => l.id === 'Tin-Edges'))
    expect(hatch.note.facets).toBeGreaterThan(300)
    // A sun in the north-west: more hatch on the south-east flank of the cone.
    let se = 0, nw = 0
    for (let q = 0; q < hatch.positions.length; q += 3) {
      const x = hatch.positions[q], z = hatch.positions[q + 2]
      if (x > 0 && z > 0) se++
      else if (x < 0 && z < 0) nw++
    }
    expect(se).toBeGreaterThan(nw)
  })
})
