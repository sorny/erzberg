/**
 * Stipple's spacing, which rounded to whole grid cells before format 9 and left
 * most of its slider drawing one picture.
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
