/**
 * Light Shafts, Wiggle Traces and Summit Envelope, on
 * small synthetic ground whose answer is known. Also the options that joined
 * Flow Lines, Pencil, Hachure and Truchet with them.
 */
import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { summitEnvelope } from '../../src/utils/builders/survey.js'
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
const segs = (l) => (l ? l.positions.length / 6 : 0)
const meanY = (l) => { let s = 0, n = 0; for (let q = 1; q < l.positions.length; q += 3) { s += l.positions[q]; n++ } return s / n }

const cone = terrainOf((x, y) => Math.max(0, 1 - Math.hypot(x - 48, y - 48) / 44))
// A wall from north to south: low ground, then a ridge at x = 40.
const ridge = terrainOf((x) => 0.2 + 0.7 * Math.exp(-((x - 40) ** 2) / 18))
// Two summits with a valley between them.
const twin = terrainOf((x, y) => 0.1 + 0.8 * Math.max(Math.exp(-((x - 28) ** 2 + (y - 48) ** 2) / 120), Math.exp(-((x - 68) ** 2 + (y - 48) ** 2) / 120)))
const flat = terrainOf(() => 0.5)

describe('Light Shafts', () => {
  const on = { enabledShafts: true, azimuthShafts: 270, altitudeShafts: 60, spacingShafts: 4, minLenShafts: 2 }
  it('runs each shaft away from the sun, at the sun\'s own slope', () => {
    const l = one(ridge, on, 'Shafts')
    wellFormed(l)
    const P = l.positions, tan = Math.tan(60 * Math.PI / 180)
    for (let i = 0; i < P.length; i += 6) {
      // The sun stands in the west, so the light travels east.
      expect(P[i + 3]).toBeGreaterThan(P[i])
      expect(Math.abs(P[i + 2] - P[i + 5])).toBeLessThan(1e-3)
      expect((P[i + 1] - P[i + 4]) / (P[i + 3] - P[i])).toBeCloseTo(tan, 3)
    }
    expect(l.note.shafts).toBe(segs(l))
  })
  it('casts a longer shaft under a lower sun, and none on a flat', () => {
    const len = (alt) => { const P = one(ridge, { ...on, altitudeShafts: alt }, 'Shafts').positions; return P[3] - P[0] }
    expect(len(60)).toBeGreaterThan(len(75))
    expect(layers(flat, on).length).toBe(0)
  })
  it('draws a landing tick across each shaft, and drops them when asked', () => {
    wellFormed(one(ridge, on, 'Shafts-Feet'))
    expect(one(ridge, { ...on, feetShafts: false }, 'Shafts-Feet')).toBeUndefined()
  })
})

describe('Wiggle Traces', () => {
  const on = { enabledWiggle: true, spacingWiggle: 6, detrendWiggle: 10 }
  it('fills the swings on the ground that stands above its surroundings', () => {
    const ls = layers(cone, on)
    wellFormed(ls.find((l) => l.id === 'Wiggle')); wellFormed(ls.find((l) => l.id === 'Wiggle-Lobes'))
    const up = meanY(ls.find((l) => l.id === 'Wiggle-Lobes'))
    const down = meanY(one(cone, { ...on, lobesWiggle: 'negative' }, 'Wiggle-Lobes'))
    // The summit is convex and the foot of the cone concave.
    expect(up).toBeGreaterThan(down)
  })
  it('draws the traces alone with no lobes, and nothing on a flat', () => {
    expect(one(cone, { ...on, lobesWiggle: 'none' }, 'Wiggle-Lobes')).toBeUndefined()
    expect(layers(flat, on).length).toBe(0)
  })
})

describe('Summit Envelope', () => {
  it('rests on the summits and stands clear of the valley between them', () => {
    const { grid, gridMask, rows, cols } = twin
    const env = summitEnvelope(grid, gridMask, rows, cols, 0.0002)
    for (let i = 0; i < grid.length; i++) expect(env[i]).toBeGreaterThanOrEqual(grid[i])
    const at = (x, y) => y * cols + x
    expect(env[at(28, 48)]).toBeCloseTo(grid[at(28, 48)], 5)
    expect(env[at(68, 48)]).toBeCloseTo(grid[at(68, 48)], 5)
    expect(env[at(48, 48)] - grid[at(48, 48)]).toBeGreaterThan(0.3)
  })
  it('lies on a dome that bends less than the paraboloid', () => {
    const dome = terrainOf((x, y) => 0.9 - 0.00005 * ((x - 48) ** 2 + (y - 48) ** 2))
    const env = summitEnvelope(dome.grid, dome.gridMask, dome.rows, dome.cols, 0.001)
    // Away from the edge: there the surface has no ground beyond to rest on.
    for (let y = 8; y < dome.rows - 8; y++) for (let x = 8; x < dome.cols - 8; x++) {
      expect(env[y * dome.cols + x]).toBeCloseTo(dome.grid[y * dome.cols + x], 5)
    }
  })
  it('nets the valley, and the whole surface when asked', () => {
    const on = { enabledEnvelope: true, spanEnvelope: 60, spacingEnvelope: 4 }
    const net = one(twin, on, 'Envelope'), whole = one(twin, { ...on, wholeEnvelope: true }, 'Envelope')
    wellFormed(net)
    expect(segs(whole)).toBeGreaterThan(segs(net))
    expect(net.note.spanned).toBeGreaterThan(0)
    expect(net.note.spanned).toBeLessThan(1)
    const drops = one(twin, { ...on, dropsEnvelope: true }, 'Envelope-Drops')
    wellFormed(drops)
    for (let i = 0; i < drops.positions.length; i += 6) {
      expect(drops.positions[i]).toBe(drops.positions[i + 3])
      expect(drops.positions[i + 2]).toBe(drops.positions[i + 5])
      expect(drops.positions[i + 1]).toBeGreaterThan(drops.positions[i + 4])
    }
  })
})

describe('options on older modes', () => {
  it('Flow Lines draws at a step shorter than a cell', () => {
    const l = one(cone, { enabledFlow: true, stepFlow: 0.2, maxLenFlow: 250 }, 'Flow')
    wellFormed(l)
    expect(segs(l)).toBeGreaterThan(200)
  })
  it('Flow Lines drops short lines and keeps the rest in place', () => {
    const all = one(cone, { enabledFlow: true }, 'Flow'), long = one(cone, { enabledFlow: true, minLenFlow: 12 }, 'Flow')
    expect(segs(long)).toBeLessThan(segs(all))
    const key = (P, i) => Array.from(P.subarray(i, i + 6)).join(',')
    const kept = new Set()
    for (let i = 0; i < all.positions.length; i += 6) kept.add(key(all.positions, i))
    for (let i = 0; i < long.positions.length; i += 6) expect(kept.has(key(long.positions, i))).toBe(true)
  })
  it('Flow Lines climbs when told to', () => {
    const P = one(cone, { enabledFlow: true, directionFlow: 'up' }, 'Flow').positions
    for (let i = 0; i < P.length; i += 6) expect(P[i + 4]).toBeGreaterThanOrEqual(P[i + 1] - 1e-4)
  })
  it('Pencil draws one stroke of its mark, and turns it', () => {
    const on = { enabledPencil: true, thresholdPencil: 0.1 }
    const x = one(cone, on, 'Pencil'), single = one(cone, { ...on, singlePencil: true }, 'Pencil')
    expect(segs(single)).toBe(segs(x) / 2)
    const P = one(cone, { ...on, anglePencil: 0, singlePencil: true }, 'Pencil').positions
    for (let i = 0; i < P.length; i += 6) expect(Math.abs(P[i + 2] - P[i + 5])).toBeLessThan(1e-4)
  })
  it('Hachure turns its ticks down the fall line', () => {
    const on = { enabledHachure: true, spacingHachure: 6, lengthHachure: 2 }
    const across = one(cone, on, 'Hachure').positions, down = one(cone, { ...on, alongHachure: 'fall' }, 'Hachure').positions
    expect(down.length).toBe(across.length)
    let level = 0, sloped = 0
    for (let i = 0; i < across.length; i += 6) {
      // The same tick, a quarter turn round: the two are at right angles.
      const ax = across[i + 3] - across[i], az = across[i + 5] - across[i + 2]
      const dx = down[i + 3] - down[i], dz = down[i + 5] - down[i + 2]
      expect(Math.abs(ax * dx + az * dz)).toBeLessThan(1e-3 * (Math.hypot(ax, az) * Math.hypot(dx, dz) + 1e-9) + 1e-6)
      if (across[i + 1] === across[i + 4]) level++
      if (down[i + 1] !== down[i + 4]) sloped++
    }
    expect(level).toBe(across.length / 6)
    expect(sloped).toBeGreaterThan(across.length / 12)
  })
  it('Truchet draws straight diagonals', () => {
    const on = { enabledTruchet: true, spacingTruchet: 8, thresholdTruchet: 0 }
    const P = one(cone, { ...on, tileTruchet: 'diagonal' }, 'Truchet').positions
    expect(P.length).toBeGreaterThan(0)
    expect(P.length).toBeLessThan(one(cone, on, 'Truchet').positions.length)
    for (let i = 0; i < P.length; i += 6) expect(Math.abs(Math.abs(P[i + 3] - P[i]) - Math.abs(P[i + 5] - P[i + 2]))).toBeLessThan(1e-3)
  })
})
