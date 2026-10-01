import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry, layerStyle } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const W = 64
const px = new Float32Array(W * W)
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = 0.3 + 0.4 * Math.sin(x / 9) * Math.cos(y / 11)
const mask = new Uint8Array(W * W).fill(1)
// Two classes: left half red, right half blue.
const labels = new Uint8Array(W * W)
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) labels[y * W + x] = x < W / 2 ? 0 : 1
const cover = { labels, width: W, height: W, classColors: ['#ff0000', '#0000ff'] }

const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1,
  enabledLines: false, enabledPillars: true, spacingPillars: 4, colorPillars: '#000000' }
const terrain = buildTerrain(px, mask, W, W, p0, null, cover)
const pillars = (p) => buildLineGeometry(terrain, { ...p0, ...p }).find((l) => l.id === 'Pillars')

describe('Pillars', () => {
  it('draws the upper half as its own layer, up to the ceiling', () => {
    const below = pillars({})
    const all = buildLineGeometry(terrain, { ...p0, pillarAbove: true, pillarCeiling: 5 })
    const lower = all.find((l) => l.id === 'Pillars'), upper = all.find((l) => l.id === 'Pillars-Above')
    expect(lower.positions.length).toBe(below.positions.length)
    // At least one upper line per lower one. Cells at the very bottom have no
    // lower pillar when Depth is 0, and still get an upper one.
    expect(upper.positions.length).toBeGreaterThanOrEqual(lower.positions.length)
    let top = -Infinity
    for (let k = 1; k < upper.positions.length; k += 3) top = Math.max(top, upper.positions[k])
    expect(top).toBeCloseTo(terrain.maxElev + 5, 4)
  })

  it('opens a seam of twice the gap at the ground', () => {
    const all = buildLineGeometry(terrain, { ...p0, pillarAbove: true, pillarGap: 1 })
    const lower = all.find((l) => l.id === 'Pillars'), upper = all.find((l) => l.id === 'Pillars-Above')
    // The first pillar of each half stands on the same cell.
    expect(upper.positions[1] - lower.positions[4]).toBeCloseTo(2, 5)
  })

  it('inks each half with its own line style', () => {
    const all = buildLineGeometry(terrain, { ...p0, pillarAbove: true,
      colorPillars: '#ff0000', colorPillarsAbove: '#00ff00' })
    expect(Array.from(all.find((l) => l.id === 'Pillars').colors.slice(0, 3))).toEqual([1, 0, 0])
    expect(Array.from(all.find((l) => l.id === 'Pillars-Above').colors.slice(0, 3))).toEqual([0, 1, 0])
  })

  it('keeps lids off the upper half', () => {
    const below = pillars({ pillarStyle: 'cuboid' })
    const all = buildLineGeometry(terrain, { ...p0, pillarStyle: 'cuboid', pillarAbove: true })
    expect(all.find((l) => l.id === 'Pillars').lids.indices.length).toBe(below.lids.indices.length)
    expect(all.find((l) => l.id === 'Pillars-Above').lids).toBeNull()
  })

  it('splits into one layer per land cover class, each in its ink', () => {
    const all = buildLineGeometry(terrain, { ...p0, hypsoPillars: true, hypsoModePillars: 'class' })
    const red = all.find((l) => l.id === 'Pillars-Class0'), blue = all.find((l) => l.id === 'Pillars-Class1')
    expect(all.find((l) => l.id === 'Pillars')).toBeUndefined()
    // Class 0 is the left half of the plate, class 1 the right.
    for (let k = 0; k < red.positions.length; k += 6) expect(red.positions[k]).toBeLessThan(0)
    for (let k = 0; k < blue.positions.length; k += 6) expect(blue.positions[k]).toBeGreaterThan(-1)
    expect(Array.from(red.colors.slice(0, 3))).toEqual([1, 0, 0])
    expect(Array.from(blue.colors.slice(0, 3))).toEqual([0, 0, 1])
    // Together they are every pillar the single layer had.
    expect(red.positions.length + blue.positions.length).toBe(pillars({}).positions.length)
  })

  it('names each class layer for its pen', () => {
    const p = { ...p0, cover: { classes: [{ index: 0, name: 'Forest', color: '#228833' }] } }
    expect(layerStyle('Pillars-Class0', p).name).toBe('Pillars · Forest #228833')
    expect(layerStyle('Pillars-Above-Class0', p).name).toBe('Pillars · Above · Forest #228833')
    expect(layerStyle('Pillars-Class3', p0).name).toBe('Pillars · Class D')
  })

  it('splits each half by its own ink', () => {
    const ids = buildLineGeometry(terrain, { ...p0, pillarAbove: true, hypsoPillars: false, hypsoPillarsAbove: true, hypsoModePillarsAbove: 'class' })
      .map((l) => l.id).filter((id) => id.startsWith('Pillars'))
    expect(ids).toEqual(['Pillars', 'Pillars-Above-Class0', 'Pillars-Above-Class1'])
  })

  it('hides what stands behind it, with occlusion on', () => {
    // A vertical line hangs a curtain of no width, so without its own walls a
    // pillar field hid nothing. Two crossed walls per line pillar, four
    // triangles, go into the curtains.
    const on = pillars({ depthOcclusion: true, pillarSolid: 1 })
    const off = pillars({ depthOcclusion: false, pillarSolid: 1 })
    const pillarsDrawn = on.positions.length / 6
    expect(on.curtains.indices.length).toBe(pillarsDrawn * 4 * 3)
    expect(off.curtains.indices.length).toBe(0)
  })

  it('asks the renderer for depth on both halves', () => {
    // Pillars are emitted row by row, blind to the camera. Without depth, the
    // rows drawn last cover the rest, and from behind those are the far ones.
    const all = buildLineGeometry(terrain, { ...p0, pillarAbove: true, depthOcclusion: false })
    expect(all.find((l) => l.id === 'Pillars').selfOcclude).toBe(true)
    expect(all.find((l) => l.id === 'Pillars-Above').selfOcclude).toBe(true)
  })

  it('hides nothing at occlusion width 0, the default', () => {
    expect(pillars({ depthOcclusion: true }).curtains.indices.length).toBe(0)
  })

  it('makes the walls as wide as the occlusion width', () => {
    const half = pillars({ depthOcclusion: true, pillarSolid: 0.5 }).curtains.positions
    // The first wall runs along x, from −w to +w around its pillar.
    const cell = p0.spacingPillars   // resolution 1 on this plate, so one unit per cell
    expect(Math.abs(half[3] - half[0])).toBeCloseTo(cell * 0.5, 5)
  })

  it('gives the upper half its own walls too', () => {
    const all = buildLineGeometry(terrain, { ...p0, depthOcclusion: true, pillarAbove: true, pillarSolid: 1 })
    const upper = all.find((l) => l.id === 'Pillars-Above')
    expect(upper.curtains.indices.length).toBe((upper.positions.length / 6) * 4 * 3)
  })

  it('falls back to the line style without a cover plate', () => {
    const bare = buildTerrain(px, mask, W, W, p0)
    const l = buildLineGeometry(bare, { ...p0, hypsoPillars: true, hypsoModePillars: 'class' }).find((x) => x.id === 'Pillars')
    expect(Array.from(l.colors.slice(0, 3))).toEqual([0, 0, 0])
  })
})
