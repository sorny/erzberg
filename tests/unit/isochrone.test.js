import { describe, it, expect } from 'vitest'
import { travelTimeField, toblerSpeed } from '../../src/utils/isochrone'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const N = 101
const grid = (f) => {
  const h = new Float32Array(N * N)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) h[r * N + c] = f(r, c)
  return { heights: h, mask: new Uint8Array(N * N).fill(1), rows: N, cols: N, cellX: 10, cellY: 10 }
}
const at = (t, r, c) => t[r * N + c]

describe('toblerSpeed', () => {
  it('peaks at 6 km/h on a gentle descent', () => {
    expect(toblerSpeed(-0.05) * 3.6).toBeCloseTo(6, 6)
    expect(toblerSpeed(0) * 3.6).toBeCloseTo(5.04, 2)
  })
})

describe('travelTimeField', () => {
  it('walks flat ground at 5 km/h in every direction', () => {
    const t = travelTimeField(grid(() => 0), { row: 50, col: 50 })
    const v = toblerSpeed(0)
    expect(at(t, 50, 50)).toBe(0)
    expect(at(t, 50, 90)).toBeCloseTo(400 / v, 3)
    // The diagonal is within the sixteen-neighbour error of the true distance.
    const diag = at(t, 80, 80) / (Math.hypot(300, 300) / v)
    expect(diag).toBeGreaterThan(0.999)
    expect(diag).toBeLessThan(1.03)
  })

  it('is slower uphill than down', () => {
    // Rising to the east at 20%: 2.5 km/h up against 3.5 km/h down.
    const g = grid((r, c) => c * 2)
    const t = travelTimeField(g, { row: 50, col: 50 })
    const ratio = at(t, 50, 80) / at(t, 50, 20)
    expect(ratio).toBeCloseTo(Math.exp(3.5 * 0.1), 2)
  })

  it('swaps the slope when walking back', () => {
    const g = grid((r, c) => c * 2)
    const out = travelTimeField(g, { row: 50, col: 50, direction: 'out' })
    const back = travelTimeField(g, { row: 50, col: 50, direction: 'back' })
    expect(at(back, 50, 20)).toBeCloseTo(at(out, 50, 80), 3)
  })

  it('goes around a wall that is too steep to climb', () => {
    // A 50 m wall three cells thick, with a gap at the bottom.
    const g = grid((r, c) => (c >= 60 && c <= 62 && r < 90 ? 50 : 0))
    const t = travelTimeField(g, { row: 10, col: 50, maxSlopeDeg: 40 })
    const straight = 200 / toblerSpeed(0)
    expect(at(t, 10, 70)).toBeGreaterThan(straight * 3)
  })

  it('marks unreachable ground as −1', () => {
    const g = grid(() => 0)
    g.mask.fill(0, 0, N * 5)
    const t = travelTimeField(g, { row: 50, col: 50 })
    expect(at(t, 0, 0)).toBe(-1)
  })
})

describe('Mode: Isochrones', () => {
  it('draws rings round the start', () => {
    const W = 96
    const px = new Float32Array(W * W)
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = 0.5 + 0.2 * Math.sin(x / 11) * Math.cos(y / 13)
    const p = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false,
      enabledIsochrone: true, intervalIsochrone: 2 }
    const t = buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p)
    const l = buildLineGeometry(t, p).find((x) => x.id === 'Isochrone')
    expect(l.positions.length).toBeGreaterThan(300)
    expect(l.colors.length).toBe(l.positions.length)
    for (const v of l.positions) expect(Number.isFinite(v)).toBe(true)
  })
})
