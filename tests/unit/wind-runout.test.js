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
const wellFormed = (l) => {
  expect(l.positions.length).toBeGreaterThan(60)
  expect(l.colors.length).toBe(l.positions.length)
  for (const v of l.positions) expect(Number.isFinite(v)).toBe(true)
}
// The largest share of a segment's plan length that runs north–south.
const maxNorthing = (l) => {
  let worst = 0
  for (let q = 0; q < l.positions.length; q += 6) {
    const dx = l.positions[q + 3] - l.positions[q], dz = l.positions[q + 5] - l.positions[q + 2]
    const len = Math.hypot(dx, dz)
    if (len > 1e-6) worst = Math.max(worst, Math.abs(dz) / len)
  }
  return worst
}

describe('Wind', () => {
  const hill = terrainOf((x, y) => 0.2 + 0.6 * Math.exp(-((x - 48) ** 2 + (y - 48) ** 2) / 300))
  const wind = (p) => layers(hill, { enabledWind: true, reliefWind: 800, cellMetresWind: 10, ...p }).find((l) => l.id === 'Wind')

  it('runs straight along the wind on level ground', () => {
    const l = layers(terrainOf(() => 0.5), { enabledWind: true, azimuthWind: 270 }).find((x) => x.id === 'Wind')
    wellFormed(l)
    expect(maxNorthing(l)).toBeLessThan(1e-3)
  })

  it('turns along the slope of a hill, and not at all with no turn', () => {
    expect(maxNorthing(wind({ azimuthWind: 270, deflectWind: 0, leeWind: 0 }))).toBeLessThan(1e-3)
    const bent = wind({ azimuthWind: 270, deflectWind: 1, leeWind: 0 })
    wellFormed(bent)
    expect(maxNorthing(bent)).toBeGreaterThan(0.2)
  })

  it('lifts the pen in the lee of a steep face', () => {
    const all = wind({ azimuthWind: 270, leeWind: 0, eddiesWind: false }).positions.length
    const lee = wind({ azimuthWind: 270, leeWind: 20, eddiesWind: false }).positions.length
    expect(lee).toBeLessThan(all)
  })

  it('reports how many lines it drew', () => {
    expect(wind({}).note.lines).toBeGreaterThan(3)
  })
})

describe('Runout', () => {
  // A 45° face 200 m high, 10 m cells, and flat ground to the east of it.
  const cliff = terrainOf((x) => (x < 20 ? (20 - x) / 20 : 0))
  const runout = (p) => layers(cliff, { enabledRunout: true, reliefRunout: 200, cellMetresRunout: 10, radiusRunout: 0, ...p })

  it('stops a block where its reach angle says, on flat ground past the foot', () => {
    const ls = runout({ zoneRunout: false })
    const l = ls.find((x) => x.id === 'Runout')
    wellFormed(l)
    // From the top, 200 m down at 32°: 200 / tan 32° = 320 m from the start.
    expect(l.note.longest).toBeGreaterThan(280)
    expect(l.note.longest).toBeLessThan(345)
    // A lower reach angle runs farther.
    const far = runout({ zoneRunout: false, reachRunout: 25 }).find((x) => x.id === 'Runout')
    expect(far.note.longest).toBeGreaterThan(l.note.longest + 60)
  })

  it('draws nothing where no ground is steep enough to release', () => {
    const ls = runout({ zoneRunout: false, releaseRunout: 50 })
    const l = ls.find((x) => x.id === 'Runout')
    expect(l?.note.paths ?? 0).toBe(0)
  })

  it('draws the release zones as their own pen', () => {
    const ls = runout({})
    wellFormed(ls.find((l) => l.id === 'Runout-Paths'))
    wellFormed(ls.find((l) => l.id === 'Runout-Release'))
    expect(layerStyle('Runout-Release', STYLE_DEF).name).toBe('Runout · Release zones')
  })
})

describe('Wind strokes and eddies', () => {
  const ridge = terrainOf((x) => 0.2 + 0.6 * Math.max(0, 1 - Math.abs(x - 40) / 12))
  const wind = (p) => layers(ridge, { enabledWind: true, azimuthWind: 270, reliefWind: 800, cellMetresWind: 10, deflectWind: 0, ...p })
    .find((l) => l.id === 'Wind')

  it('puts eddies in the lee, and nothing there without them', () => {
    // The ground east of the crest falls along a west wind at over 30°.
    const bare = wind({ eddiesWind: false }), curled = wind({ eddiesWind: true })
    expect(curled.positions.length).toBeGreaterThan(bare.positions.length)
  })

  it('draws arrowheads that point downwind', () => {
    // A west wind: every head runs back from its tip, west and to one side.
    const plain = wind({ strokeWind: 'lines', eddiesWind: false, leeWind: 0 })
    const arrows = wind({ strokeWind: 'arrows', eddiesWind: false, leeWind: 0 })
    expect(arrows.positions.length).toBeGreaterThan(plain.positions.length)
    expect(maxNorthing(arrows)).toBeGreaterThan(0.3)
  })

  it('breaks the lines into streaks', () => {
    const plain = wind({ strokeWind: 'lines', eddiesWind: false, leeWind: 0 })
    const streaks = wind({ strokeWind: 'streaks', eddiesWind: false, leeWind: 0 })
    wellFormed(streaks)
    expect(streaks.positions.length).toBeLessThan(plain.positions.length)
  })
})
