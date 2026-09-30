import { describe, it, expect } from 'vitest'
import { curvatureField, localReliefField, packFields, sunHoursTint, textureShadeField, wetnessField } from '../../src/utils/surfaceFields'

const N = 64
const gridOf = (f) => {
  const grid = new Float32Array(N * N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) grid[y * N + x] = f(x, y)
  return { grid, mask: new Uint8Array(N * N).fill(1), rows: N, cols: N, scl: 1 }
}
const at = (f, x, y) => f[y * N + x]

describe('surface fields', () => {
  it('local relief keeps a bump and drops the slope under it', () => {
    const g = gridOf((x, y) => x / N + (Math.hypot(x - 32, y - 32) < 3 ? 0.05 : 0))
    const f = localReliefField(g, 8)
    expect(at(f, 32, 32)).toBeGreaterThan(0.5)
    // Away from the bump the ramp is gone.
    expect(Math.abs(at(f, 10, 50))).toBeLessThan(0.1)
  })

  it('curvature is positive on a dome and negative in a bowl', () => {
    const dome = curvatureField(gridOf((x, y) => 1 - ((x - 32) ** 2 + (y - 32) ** 2) / 2000), 3)
    const bowl = curvatureField(gridOf((x, y) => ((x - 32) ** 2 + (y - 32) ** 2) / 2000), 3)
    expect(at(dome, 32, 32)).toBeGreaterThan(0.2)
    expect(at(bowl, 32, 32)).toBeLessThan(-0.2)
  })

  it('texture shading marks a ridge bright and a valley dark', () => {
    const g = gridOf((x) => 0.5 + 0.2 * Math.sin(x / 4))
    const f = textureShadeField(g, 0.5)
    // sin peaks at x = 2π, valleys at x = 6π.
    expect(at(f, Math.round(2 * Math.PI), 32)).toBeGreaterThan(0.3)
    expect(at(f, Math.round(6 * Math.PI), 32)).toBeLessThan(-0.3)
  })

  it('wetness is highest on a valley floor', () => {
    // A V-shaped valley along x = 32, falling to the south.
    const f = wetnessField(gridOf((x, y) => Math.abs(x - 32) / 64 + (N - y) / 400))
    expect(at(f, 32, 60)).toBeGreaterThan(at(f, 5, 60))
  })

  it('a south-facing slope gets more sun than a north-facing one, in the north', () => {
    // A ridge along x, row 0 is north: the south side falls to larger rows.
    const f = sunHoursTint(gridOf((x, y) => 1 - Math.abs(y - 32) / 32), { elevScale: 1, lat: 47, period: 'year' })
    expect(at(f, 32, 40)).toBeGreaterThan(at(f, 32, 24))
  })

  it('packs rows bottom-up, so grid row 0 lands at v = 1', () => {
    const g = { rows: 2, cols: 1 }
    const out = packFields(g, [new Float32Array([1, 2])])
    // Texel row 0 (v = 0) holds grid row 1.
    expect(out[0]).toBe(2)
    expect(out[4]).toBe(1)
  })
})
