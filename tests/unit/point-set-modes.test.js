/**
 * Single Line, Shadow Hatch, Roughness Mesh, and the two options that joined
 * Hachure and Stream Network with them, on a synthetic plate.
 *
 * Single Line gets the strictest checks, because its promise is geometric:
 * one stroke, and no two of its edges cross in plan.
 */
import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const W = 96, H = 96
function plate() {
  const px = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = x / W, fy = y / H
    px[y * W + x] =
      0.5 + 0.30 * Math.sin(fx * 7.1) * Math.cos(fy * 5.3)
          + 0.12 * Math.sin(fx * 19) * Math.sin(fy * 23)
  }
  return px
}

const px = plate()
const mask = new Uint8Array(W * H).fill(1)
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false }
const terrain = buildTerrain(px, mask, W, H, p0)
const layer = (p, id) => buildLineGeometry(terrain, { ...p0, ...p }).find((l) => l.id === id)

function wellFormed(l) {
  expect(l).toBeTruthy()
  expect(l.positions.length).toBeGreaterThan(60)
  expect(l.colors.length).toBe(l.positions.length)
  for (const v of l.positions) expect(Number.isFinite(v)).toBe(true)
}

describe('new draw modes', () => {
  it('Single Line is one unbroken, non-crossing stroke', () => {
    const l = layer({ enabledTsp: true, countTsp: 400 }, 'Tsp')
    wellFormed(l)
    const P = l.positions, segs = P.length / 6
    // Every segment starts where the one before it ended.
    for (let s = 1; s < segs; s++) {
      expect(P[s * 6]).toBeCloseTo(P[s * 6 - 3], 5)
      expect(P[s * 6 + 2]).toBeCloseTo(P[s * 6 - 1], 5)
    }
    // Plan-view crossings between non-adjacent segments.
    const cross = (a, b, c, d) => {
      const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
    }
    const seg = (s) => [[P[s * 6], P[s * 6 + 2]], [P[s * 6 + 3], P[s * 6 + 5]]]
    let crossings = 0
    for (let i = 0; i < segs; i++) for (let j = i + 2; j < segs; j++) {
      const [a, b] = seg(i), [c, d] = seg(j)
      if (cross(a, b, c, d)) crossings++
    }
    expect(crossings).toBe(0)
  })

  it('Shadow Hatch draws only with the sun up', () => {
    wellFormed(layer({ enabledShadowHatch: true, altitudeShadowHatch: 12 }, 'ShadowHatch'))
    const night = layer({ enabledShadowHatch: true, altitudeShadowHatch: -5 }, 'ShadowHatch')
    expect(night?.positions.length ?? 0).toBe(0)
  })

  it('Shadow Hatch grows with a lower sun', () => {
    const high = layer({ enabledShadowHatch: true, altitudeShadowHatch: 60, outlineShadowHatch: false }, 'ShadowHatch')
    const low = layer({ enabledShadowHatch: true, altitudeShadowHatch: 8, outlineShadowHatch: false }, 'ShadowHatch')
    expect(low.positions.length).toBeGreaterThan(high?.positions.length ?? 0)
  })

  for (const kind of ['delaunay', 'voronoi', 'both']) {
    it(`Roughness Mesh draws a ${kind} net`, () => {
      wellFormed(layer({ enabledRugged: true, countRugged: 600, kindRugged: kind }, 'Rugged'))
    })
  }
})

describe('new options on existing modes', () => {
  it('Lehmann hachures replace the ticks', () => {
    const tick = layer({ enabledHachure: true }, 'Hachure')
    const leh = layer({ enabledHachure: true, styleHachure: 'lehmann' }, 'Hachure')
    wellFormed(leh)
    expect(leh.positions.length).not.toBe(tick.positions.length)
  })

  it('flow accumulation draws the trunk in extra passes', () => {
    const plain = layer({ enabledDag: true }, 'Dag')
    const heavy = layer({ enabledDag: true, accumDag: true, passesDag: 4 }, 'Dag')
    wellFormed(heavy)
    expect(heavy.positions.length).toBeGreaterThan(plain.positions.length)
    expect(heavy.positions.length).toBeLessThanOrEqual(plain.positions.length * 4)
  })
})
