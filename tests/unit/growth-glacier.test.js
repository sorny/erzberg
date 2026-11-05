import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry, layerStyle } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const W = 96
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false }
const terrainOf = (f) => {
  const px = new Float32Array(W * W)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = f(x, y)
  return buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0)
}
const layers = (t, p) => buildLineGeometry(t, { ...p0, ...p })
const one = (t, p, id) => layers(t, p).find((l) => l.id === id)
const wellFormed = (l) => {
  expect(l).toBeTruthy()
  expect(l.positions.length).toBeGreaterThan(60)
  expect(l.colors.length).toBe(l.positions.length)
  for (const v of l.positions) expect(Number.isFinite(v)).toBe(true)
}
// A massif with side valleys, so the drainage and the skeletons have structure.
const massif = terrainOf((x, y) => {
  const r = Math.hypot(x - 48, (y - 48) * 1.6) / 40
  return Math.max(0, 1 - r) * (0.8 + 0.2 * Math.cos(Math.atan2(y - 48, x - 48) * 6)) + 0.05
})
const cone = terrainOf((x, y) => Math.max(0, 1 - Math.hypot(x - 48, y - 48) / 44))

describe('Venation', () => {
  it('grows a network from its roots, the same for the same seed', () => {
    const a = one(massif, { enabledVenation: true, countVenation: 3000 }, 'Venation')
    wellFormed(a)
    expect(a.note.nodes).toBeGreaterThan(100)
    const b = one(massif, { enabledVenation: true, countVenation: 3000 }, 'Venation')
    expect(b.positions).toEqual(a.positions)
  })
})

describe('Geodesic fan', () => {
  it('runs straight on level ground', () => {
    const flat = terrainOf(() => 0.5)
    const l = one(flat, { enabledGeodesic: true, markerGeodesic: false, raysGeodesic: 24 }, 'Geodesic')
    wellFormed(l)
    // Every segment points away from the centre: its cross product with the
    // line from the centre is about zero.
    const ox = (flat.cols - 1) / 2 * flat.scl - flat.halfW, oz = (flat.rows - 1) / 2 * flat.scl - flat.halfH
    let worst = 0
    for (let q = 0; q < l.positions.length; q += 6) {
      const x0 = l.positions[q] - ox, z0 = l.positions[q + 2] - oz
      const dx = l.positions[q + 3] - l.positions[q], dz = l.positions[q + 5] - l.positions[q + 2]
      const r = Math.hypot(x0, z0), d = Math.hypot(dx, dz)
      if (r > 1e-3 && d > 1e-6) worst = Math.max(worst, Math.abs(x0 * dz - z0 * dx) / (r * d))
    }
    expect(worst).toBeLessThan(0.01)
  })

  it('bends round a hill', () => {
    const hill = terrainOf((x, y) => Math.exp(-((x - 60) ** 2 + (y - 48) ** 2) / 120))
    const l = one(hill, { enabledGeodesic: true, markerGeodesic: false, originXGeodesic: 0.1, raysGeodesic: 60, exaggerationGeodesic: 4, reliefGeodesic: 600 }, 'Geodesic')
    wellFormed(l)
    const ox = 0.1 * (hill.cols - 1) * hill.scl - hill.halfW, oz = (hill.rows - 1) / 2 * hill.scl - hill.halfH
    let worst = 0
    for (let q = 0; q < l.positions.length; q += 6) {
      const x0 = l.positions[q] - ox, z0 = l.positions[q + 2] - oz
      const dx = l.positions[q + 3] - l.positions[q], dz = l.positions[q + 5] - l.positions[q + 2]
      const r = Math.hypot(x0, z0), d = Math.hypot(dx, dz)
      if (r > 1e-3 && d > 1e-6) worst = Math.max(worst, Math.abs(x0 * dz - z0 * dx) / (r * d))
    }
    expect(worst).toBeGreaterThan(0.1)
  })
})

describe('Radar', () => {
  // Looking east from the west, a slope that rises to the east faces the sensor.
  const count = (f) => one(terrainOf(f), { enabledRadar: true, azimuthRadar: 90, reliefRadar: 300 }, 'Radar')?.positions.length ?? 0
  it('draws a slope that faces the sensor denser than one that faces away', () => {
    const facing = count((x) => x / (W - 1)), away = count((x) => 1 - x / (W - 1))
    expect(facing).toBeGreaterThan(away * 1.3)
  })
  it('leaves the radar shadow blank', () => {
    // A wall facing away from the sensor at 80° hides the ground behind it.
    const wall = count((x) => (x < 40 ? 1 : 0)), flat = count(() => 0.5)
    expect(wall).toBeLessThan(flat)
  })
})

describe('Spines', () => {
  it('puts the skeleton of a long ridge on its crest', () => {
    const ridge = terrainOf((x, y) => Math.max(0, 1 - Math.abs(y - 48) / 30))
    const l = one(ridge, { enabledSpines: true, radiusSpines: 0 }, 'Spines')
    wellFormed(l)
    const crest = (ridge.rows - 1) / 2 * ridge.scl - ridge.halfH
    let far = 0, n = 0
    for (let q = 2; q < l.positions.length; q += 3) { n++; if (Math.abs(l.positions[q] - crest) > 2 * ridge.scl) far++ }
    // Branches reach into the corners of each level, but most of the spine is the crest.
    expect(far / n).toBeLessThan(0.35)
  })
})

describe('Coral', () => {
  it('grows one closed line that stays above its level', () => {
    const l = one(cone, { enabledCoral: true, spacingCoral: 4, levelCoral: 0.5, nodesCoral: 1500, stepsCoral: 800 }, 'Coral')
    wellFormed(l)
    expect(l.note.nodes).toBeGreaterThan(200)
    // Height 0.5 of the cone, in the scene's elevation units, less a margin
    // for the drape between two nodes.
    const floor = (0.5 - 0.5) * 100 - 3
    for (let q = 1; q < l.positions.length; q += 3) expect(l.positions[q]).toBeGreaterThan(floor)
  })
  it('stops by itself when the folds fill the ground', () => {
    const p = { enabledCoral: true, spacingCoral: 4, levelCoral: 0.3, nodesCoral: 8000, stepsCoral: 4000 }
    const l = one(cone, p, 'Coral')
    wellFormed(l)
    // A couple of thousand points fill the cone, far below the limit.
    expect(l.note.nodes).toBeLessThan(5000)
    // Crowded, the folds jam and the same ground runs into the limit.
    expect(one(cone, { ...p, crowdCoral: true }, 'Coral').note.nodes).toBeGreaterThanOrEqual(8000)
  })
  it('grows a curve on each patch of high ground', () => {
    // Two peaks with a saddle below the level between them.
    const twin = terrainOf((x, y) => Math.max(0, 1 - Math.hypot(x - 26, y - 48) / 22, 0.9 - Math.hypot(x - 72, y - 48) / 22))
    const p = { enabledCoral: true, spacingCoral: 4, levelCoral: 0.3, nodesCoral: 8000, stepsCoral: 4000 }
    const l = one(twin, p, 'Coral')
    wellFormed(l)
    expect(l.note.curves).toBe(2)
    const xs = []
    for (let q = 0; q < l.positions.length; q += 3) xs.push(l.positions[q])
    // Lines on both sides of the saddle, which sits in the middle of the plate.
    expect(xs.some((x) => x < -10)).toBe(true)
    expect(xs.some((x) => x > 10)).toBe(true)
    // The old growth keeps one curve, from the highest point.
    expect(one(twin, { ...p, crowdCoral: true, nodesCoral: 1500 }, 'Coral').note.curves).toBe(1)
  })
  it('grows the same line for the same seed', () => {
    const p = { enabledCoral: true, spacingCoral: 4, levelCoral: 0.5, nodesCoral: 20000, stepsCoral: 2000 }
    expect(one(cone, p, 'Coral').positions).toEqual(one(cone, p, 'Coral').positions)
  })
})

describe('Glacier', () => {
  const g = (p) => layers(cone, { enabledGlacier: true, reliefGlacier: 700, cellMetresGlacier: 10, ...p })
  it('draws ice, crevasses and moraine as three pens', () => {
    const ls = g({ snowlineGlacier: 0.5, crackGlacier: 10, steepGlacier: 70 })
    wellFormed(ls.find((l) => l.id === 'Glacier-Ice'))
    wellFormed(ls.find((l) => l.id === 'Glacier-Crevasses'))
    wellFormed(ls.find((l) => l.id === 'Glacier-Moraine'))
    const ice = ls.find((l) => l.id === 'Glacier-Ice')
    expect(ice.note.share).toBeGreaterThan(0.05)
    expect(ice.note.share).toBeLessThan(0.4)
    expect(layerStyle('Glacier-Moraine', STYLE_DEF).name).toBe('Glacier · Moraine')
  })
  it('keeps ice off ground steeper than the limit', () => {
    // The cone is about 60° at this relief, so a limit of 30° leaves no ice.
    expect(g({ snowlineGlacier: 0.5, steepGlacier: 30 }).some((l) => l.id.startsWith('Glacier'))).toBe(false)
  })
})
