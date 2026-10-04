/**
 * Local light reads which way the ground runs. A roof running north–south has
 * its across-ridge axis east–west; a dome has no one direction, so no strength.
 */
import { describe, expect, it } from 'vitest'
import { localLightField } from '../../src/utils/surfaceFields'

const N = 64
function field(f) {
  const grid = new Float32Array(N * N), mask = new Uint8Array(N * N).fill(1)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) grid[r * N + c] = f(r - N / 2, c - N / 2)
  const [cos2, sin2] = localLightField({ grid, mask, rows: N, cols: N, scl: 1 }, 3)
  const i = (N / 2) * N + N / 2 + 8
  const across = 90 - 0.5 * Math.atan2(sin2[i], cos2[i]) * 180 / Math.PI
  return { across: ((across % 180) + 180) % 180, strength: Math.hypot(cos2[i], sin2[i]) }
}

describe('localLightField', () => {
  it('finds the across-ridge axis of a north–south ridge', () => {
    const f = field((y, x) => -Math.abs(x))
    expect(f.across).toBeCloseTo(90, 0)
    expect(f.strength).toBeGreaterThan(0.9)
  })

  it('finds it for an east–west ridge too', () => {
    const f = field((y) => -Math.abs(y))
    expect(Math.min(f.across, 180 - f.across)).toBeLessThan(1)
  })

  it('gives a dome little strength near its top', () => {
    const grid = new Float32Array(N * N), mask = new Uint8Array(N * N).fill(1)
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) grid[r * N + c] = -Math.hypot(r - N / 2, c - N / 2)
    const [cos2, sin2] = localLightField({ grid, mask, rows: N, cols: N, scl: 1 }, 6)
    const i = (N / 2) * N + N / 2
    expect(Math.hypot(cos2[i], sin2[i])).toBeLessThan(0.5)
  })
})
