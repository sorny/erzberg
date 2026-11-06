/**
 * The map-symbol modes: Tree Line, Constellation, Weather Fronts, Tally and
 * Orographic Rain, on small synthetic ground whose answer is known.
 */
import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry, layerStyle } from '../../src/utils/geometryBuilders'
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
const cone = terrainOf((x, y) => Math.max(0, 1 - Math.hypot(x - 48, y - 48) / 44))
// Two summits of different heights with a saddle between them.
const twin = terrainOf((x, y) => Math.max(0.05, 1 - Math.hypot(x - 28, y - 48) / 22, 0.8 - Math.hypot(x - 70, y - 48) / 20))
// A ridge running north to south down the middle of the plate.
const ridge = terrainOf((x) => Math.max(0, 1 - Math.abs(x - 48) / 30))

describe('Tree Line', () => {
  it('stands trees below the tree line only, and traces the line', () => {
    const ls = layers(cone, { enabledTreeLine: true, treelineTreeLine: 0.6, spacingTreeLine: 3, steepTreeLine: 89, reliefTreeLine: 200 })
    const trees = ls.find((l) => l.id === 'TreeLine-Trees'), line = ls.find((l) => l.id === 'TreeLine-Line')
    wellFormed(trees); wellFormed(line)
    expect(trees.note.trees).toBeGreaterThan(50)
    // The cone's height in scene units runs from −50 to 50: no tree above 0.6.
    const top = (0.6 - 0.5) * 100 + 3
    for (let q = 1; q < trees.positions.length; q += 3) expect(trees.positions[q]).toBeLessThan(top)
    expect(layerStyle('TreeLine-Line', STYLE_DEF).dash).toBe('dotted')
  })
  it('stands the trees upright, facing the bearing or the slope', () => {
    const p = { enabledTreeLine: true, treelineTreeLine: 0.6, spacingTreeLine: 3, steepTreeLine: 89, reliefTreeLine: 200 }
    const flat = one(cone, p, 'TreeLine-Trees')
    const up = one(cone, { ...p, stanceTreeLine: 'upright' }, 'TreeLine-Trees')
    wellFormed(up)
    expect(up.note.trees).toBe(flat.note.trees)
    // Upright, every trunk is a vertical segment: one x and z, two heights.
    const trunks = (l) => {
      let n = 0
      for (let q = 0; q < l.positions.length; q += 6) {
        const a = l.positions
        if (a[q] === a[q + 3] && a[q + 2] === a[q + 5] && a[q + 4] > a[q + 1]) n++
      }
      return n
    }
    expect(trunks(up)).toBeGreaterThanOrEqual(up.note.trees)
    expect(trunks(flat)).toBe(0)
    const north = one(cone, { ...p, facingTreeLine: 0 }, 'TreeLine-Trees')
    expect(Array.from(north.positions)).not.toEqual(Array.from(flat.positions))
    for (const follow of ['downhill', 'uphill']) wellFormed(one(cone, { ...p, followTreeLine: follow, turnTreeLine: 30 }, 'TreeLine-Trees'))
  })
  it('draws each tree style at the same sites', () => {
    const p = { enabledTreeLine: true, treelineTreeLine: 0.6, spacingTreeLine: 3, steepTreeLine: 89, reliefTreeLine: 200 }
    const seen = new Set()
    let trees = null
    for (const st of ['drawn', 'classic', 'map', 'scribble']) {
      const l = one(cone, { ...p, styleTreeLine: st }, 'TreeLine-Trees')
      wellFormed(l)
      trees ??= l.note.trees
      expect(l.note.trees).toBe(trees)
      seen.add(l.positions.length)
    }
    expect(seen.size).toBe(4)
  })
  it('keeps no tree on ground steeper than the limit', () => {
    // A ramp of 2 000 m over 960 m: about 64° everywhere, and 46.5° on the
    // edge columns, where the slope is read from one side only.
    const ramp = terrainOf((x) => x / (W - 1))
    const p = { enabledTreeLine: true, treelineTreeLine: 1, spacingTreeLine: 3, reliefTreeLine: 2000, cellMetresTreeLine: 10 }
    expect(one(ramp, { ...p, steepTreeLine: 45 }, 'TreeLine-Trees')).toBeUndefined()
    wellFormed(one(ramp, { ...p, steepTreeLine: 70 }, 'TreeLine-Trees'))
  })
})

describe('Constellation', () => {
  it('puts a star on each summit and links them once', () => {
    const ls = layers(twin, { enabledConstellation: true, spacingConstellation: 12, countConstellation: 10 })
    const stars = ls.find((l) => l.id === 'Constellation-Stars'), links = ls.find((l) => l.id === 'Constellation-Links')
    wellFormed(stars); wellFormed(links)
    expect(stars.note.stars).toBe(2)
  })
  it('draws no links when they are off', () => {
    const ls = layers(twin, { enabledConstellation: true, spacingConstellation: 12, linksConstellation: false })
    expect(ls.some((l) => l.id === 'Constellation-Links')).toBe(false)
  })
  it('draws dots in place of stars, and only the links with no symbol', () => {
    const p = { enabledConstellation: true, spacingConstellation: 12, countConstellation: 10 }
    const star = layers(twin, p).find((l) => l.id === 'Constellation-Stars')
    const dot = layers(twin, { ...p, markConstellation: 'dot' }).find((l) => l.id === 'Constellation-Stars')
    wellFormed(dot)
    expect(dot.note.stars).toBe(2)
    expect(Array.from(dot.positions)).not.toEqual(Array.from(star.positions))
    const none = layers(twin, { ...p, markConstellation: 'none' })
    expect(none.some((l) => l.id === 'Constellation-Stars')).toBe(false)
    const links = none.find((l) => l.id === 'Constellation-Links')
    wellFormed(links)
    expect(links.note.stars).toBe(2)
    expect(layers(twin, { ...p, markConstellation: 'none', linksConstellation: false }).some((l) => l.id.startsWith('Constellation'))).toBe(false)
  })
})

describe('Weather Fronts', () => {
  it('letters warm fronts low and cold fronts high, in their own pens', () => {
    const ls = layers(cone, { enabledFronts: true, levelsFronts: 5, spacingFronts: 8 })
    for (const id of ['Fronts-Lines', 'Fronts-Warm', 'Fronts-Cold']) wellFormed(ls.find((l) => l.id === id))
    const warm = ls.find((l) => l.id === 'Fronts-Warm'), cold = ls.find((l) => l.id === 'Fronts-Cold')
    const mean = (l) => { let s = 0, n = 0; for (let q = 1; q < l.positions.length; q += 3) { s += l.positions[q]; n++ } return s / n }
    expect(mean(cold)).toBeGreaterThan(mean(warm))
    expect(warm.note.fronts).toBe(5)
  })
})

describe('Tally', () => {
  it('counts more marks on higher ground', () => {
    const l = one(cone, { enabledTally: true, cellTally: 12, maxTally: 10, jitterTally: 0 }, 'Tally')
    wellFormed(l)
    // 64 cells of up to ten marks each.
    expect(l.note.marks).toBeGreaterThan(40)
    expect(l.note.marks).toBeLessThanOrEqual(64 * 10)
    let hi = 0, lo = 0
    for (let q = 1; q < l.positions.length; q += 3) l.positions[q] > 0 ? hi++ : lo++
    expect(hi).toBeGreaterThan(lo)
  })
})

describe('Orographic Rain', () => {
  const streaks = (l, west) => { let n = 0; for (let q = 0; q < l.positions.length; q += 6) if (west ? l.positions[q] < 0 : l.positions[q] > 0) n++; return n }
  it('rains on the windward side of a ridge and leaves a shadow behind it', () => {
    const l = one(ridge, { enabledRain: true, azimuthRain: 270, spacingRain: 1.5 }, 'Rain')
    wellFormed(l)
    // A west wind: the western slope gets far more rain than the eastern.
    expect(streaks(l, true)).toBeGreaterThan(2 * streaks(l, false))
  })
  it('follows the wind round', () => {
    const l = one(ridge, { enabledRain: true, azimuthRain: 90, spacingRain: 1.5 }, 'Rain')
    expect(streaks(l, false)).toBeGreaterThan(2 * streaks(l, true))
  })
})
