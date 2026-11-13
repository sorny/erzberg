/**
 * Sediment: dots that slide down the fall line and settle, on a cone whose
 * fall lines all run outward from its top.
 */
import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const W = 96
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false, resolution: 1 }
const px = new Float32Array(W * W)
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = Math.max(0, 1 - Math.hypot(x - 48, y - 48) / 44)
const cone = buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0)
const sediment = (p) => buildLineGeometry(cone, { ...p0, enabledSediment: true, ...p }).find((l) => l.id === 'Sediment')
/** Each dot's distance from the top of the cone, in grid cells. */
const radii = (l) => {
  const out = []
  for (let i = 0; i < l.positions.length; i += 6) {
    out.push(Math.hypot((l.positions[i] + cone.halfW) / cone.scl - 48, (l.positions[i + 2] + cone.halfH) / cone.scl - 48))
  }
  return out
}

describe('Sediment', () => {
  it('draws dots, and reads back how many', () => {
    const l = sediment({})
    expect(l.isPoints).toBe(true)
    expect(l.positions.length).toBeGreaterThan(0)
    expect(l.positions.length % 6).toBe(0)
    expect(l.colors.length).toBe(l.positions.length)
    for (const v of l.positions) expect(Number.isFinite(v)).toBe(true)
    expect(l.note.dots).toBe(l.positions.length / 6)
  })

  it('leaves the dots where they start when the travel is zero', () => {
    const still = radii(sediment({ travelSediment: 0, stillSediment: true }))
    expect(still.filter((r) => r < 20).length).toBeGreaterThan(40)
  })

  it('draws a dot that never moved only with Level ground on', () => {
    expect(sediment({ travelSediment: 0 })?.positions.length ?? 0).toBe(0)
    const plain = (rs) => rs.filter((r) => r > 60).length
    expect(plain(radii(sediment({})))).toBe(0)
    expect(plain(radii(sediment({ stillSediment: true })))).toBeGreaterThan(3)
  })

  it('empties the top of the cone and fills its foot', () => {
    const still = radii(sediment({ travelSediment: 0, stillSediment: true }))
    const moved = radii(sediment({ travelSediment: 200 }))
    const top = (rs) => rs.filter((r) => r < 20).length
    const foot = (rs) => rs.filter((r) => r > 36 && r < 52).length
    expect(top(moved)).toBeLessThan(top(still) * 0.2)
    expect(foot(moved)).toBeGreaterThan(foot(still))
  })

  it('keeps every dot the gap clear of the others', () => {
    const l = sediment({ spacingSediment: 4, gapSediment: 0.5, travelSediment: 200 })
    const P = l.positions
    let best = Infinity
    for (let a = 0; a < P.length; a += 6) for (let b = a + 6; b < P.length; b += 6) {
      best = Math.min(best, Math.hypot(P[a] - P[b], P[a + 2] - P[b + 2]))
    }
    expect(best).toBeGreaterThanOrEqual(4 * 0.5 * 0.999)
  })

  it('gives the same dots for the same seed, and other dots for another', () => {
    expect(sediment({ seedSediment: 3 }).positions).toEqual(sediment({ seedSediment: 3 }).positions)
    expect(sediment({ seedSediment: 3 }).positions).not.toEqual(sediment({ seedSediment: 4 }).positions)
  })
})
