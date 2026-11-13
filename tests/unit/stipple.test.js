/**
 * Stipple's spacing, which rounded to whole grid cells before format 9 and left
 * most of its slider drawing one picture. Then even spacing and the three
 * density sources that are fields: hillshade, cast shadow and openness.
 */
import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildStipple } from '../../src/utils/builders/tone'
import { STYLE_DEF, TERRAIN_DEF } from '../../src/defaults'

const W = 64, H = 64
function terrainAt(resolution) {
  const px = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = 0.5 + 0.3 * Math.sin(x / 7) * Math.cos(y / 5)
  const p = { ...TERRAIN_DEF, ...STYLE_DEF, elevScale: 1, resolution }
  return { t: buildTerrain(px, new Uint8Array(W * H).fill(1), W, H, p), p }
}
const dots = (t, p, spacing) => buildStipple(t, p, spacing, 'slope', 1, 0.8).positions.length / 6

describe('Stipple spacing', () => {
  it('draws denser below one grid cell, at any resolution', () => {
    for (const res of [1, 2]) {
      const { t, p } = terrainAt(res)
      const n = [0.25, 0.5, 1, 2].map((s) => dots(t, p, s))
      for (let i = 1; i < n.length; i++) expect(n[i - 1]).toBeGreaterThan(n[i])
    }
  })

  it('keeps the whole-cell grid for an older plate', () => {
    const { t, p } = terrainAt(2)
    const snap = { ...p, snapStipple: true }
    expect(dots(t, snap, 0.25)).toBe(dots(t, snap, 1))
  })
})

/** Ground from a function of the column, and the columns its dots stand in. */
function ground(f) {
  const px = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = f(x)
  const p = { ...TERRAIN_DEF, ...STYLE_DEF, elevScale: 1, resolution: 1 }
  return { t: buildTerrain(px, new Uint8Array(W * H).fill(1), W, H, p), p }
}
const columns = (t, res) => {
  const out = []
  for (let i = 0; i < res.positions.length; i += 6) out.push((res.positions[i] + t.halfW) / t.scl)
  return out
}
const ridge = (x) => 0.5 + 0.4 * (1 - Math.abs(x - 32) / 32)

describe('Stipple even spacing', () => {
  const minGap = (res) => {
    const P = res.positions
    let best = Infinity
    for (let a = 0; a < P.length; a += 6) for (let b = a + 6; b < P.length; b += 6) {
      best = Math.min(best, Math.hypot(P[a] - P[b], P[a + 2] - P[b + 2]))
    }
    return best
  }

  it('keeps every dot more than half the spacing from the next', () => {
    const { t, p } = terrainAt(1)
    const even = buildStipple(t, p, 2, 'invSlope', 0.2, 0.8, { even: true })
    const random = buildStipple(t, p, 2, 'invSlope', 0.2, 0.8)
    expect(even.positions.length).toBeGreaterThan(600)
    expect(minGap(even)).toBeGreaterThan(0.55 * 2)
    expect(minGap(random)).toBeLessThan(0.55 * 2)
  })

  it('gives the same dots for the same seed, and other dots for another', () => {
    const { t, p } = terrainAt(1)
    const run = (seed) => buildStipple(t, { ...p, seedStipple: seed }, 2, 'slope', 1, 0.8, { even: true }).positions
    expect(run(5)).toEqual(run(5))
    expect(run(5)).not.toEqual(run(6))
  })
})

describe('Stipple density sources', () => {
  it('hillshade fills the face that looks away from the sun and leaves the other clear', () => {
    const { t, p } = ground(ridge)
    const cols = columns(t, buildStipple(t, p, 1, 'shade', 1, 0.5, { azimuth: 270 }))
    expect(cols.length).toBeGreaterThan(100)
    expect(cols.filter((c) => c > 30).length / cols.length).toBeGreaterThan(0.97)
  })

  it('leaves level ground clear under hillshade', () => {
    const { t, p } = ground(() => 0.5)
    expect(buildStipple(t, p, 1, 'shade', 1, 0.5, { azimuth: 315 }).positions.length).toBe(0)
  })

  it('cast shadow fills the ground behind the ridge, and a high sun clears it', () => {
    const { t, p } = ground(ridge)
    const low = columns(t, buildStipple(t, p, 1, 'cast', 1, 0.5, { azimuth: 270, altitude: 10 }))
    expect(low.length).toBeGreaterThan(100)
    expect(low.filter((c) => c > 30).length / low.length).toBeGreaterThan(0.97)
    const high = buildStipple(t, p, 1, 'cast', 1, 0.5, { azimuth: 270, altitude: 85 })
    expect(high.positions.length / 6).toBeLessThan(low.length * 0.1)
  })

  it('openness fills the valley floor and leaves the ridge clear', () => {
    const { t, p } = ground((x) => 0.5 - 0.4 * (1 - Math.abs(x - 32) / 32))
    const cols = columns(t, buildStipple(t, p, 1, 'openness', 1, 0.5, { radius: 4 }))
    expect(cols.length).toBeGreaterThan(50)
    expect(cols.filter((c) => Math.abs(c - 32) < 14).length / cols.length).toBeGreaterThan(0.9)
  })
})

describe('Stipple density amount', () => {
  it('thins a full tone, and changes nothing at 100%', () => {
    const { t, p } = terrainAt(1)
    const n = (o) => buildStipple(t, p, 1, 'invSlope', 0.2, 0.8, o).positions.length / 6
    expect(n({ amount: 1 })).toBe(n({}))
    expect(n({ amount: 0.3 }) / n({})).toBeGreaterThan(0.2)
    expect(n({ amount: 0.3 }) / n({})).toBeLessThan(0.4)
  })
})
