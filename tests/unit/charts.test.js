/**
 * Charts: Swath Profile, Hypsometry, Aspect Rose and Stereonet, on a cone,
 * whose answers are known before the charts draw them.
 */
import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

// A cone, 40 cells to its foot, on a level square: every slope faces away from
// the summit at one gradient. At the default 10 m a cell and 1000 m of relief
// that gradient is 1000 / 40 / 10 = 2.5, a dip of atan 2.5 = 68.2°.
const W = 81, H = 81
const px = new Float32Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = Math.max(0, 1 - Math.hypot(x - 40, y - 40) / 40)
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false, resolution: 1 }
const terrain = buildTerrain(px, new Uint8Array(W * H).fill(1), W, H, p0)
const build = (id, p = {}) => Object.fromEntries(buildLineGeometry(terrain, { ...p0, [`enabled${id}`]: true, ...p }).map((l) => [l.id, l]))
const segs = (P) => Array.from({ length: P.length / 6 }, (_, k) => Array.from(P.subarray(6 * k, 6 * k + 6)))

describe('every chart', () => {
  it('lies flat at the highest point, with its rules as a pen of their own', () => {
    for (const id of ['SwathProfile', 'Hypsometry', 'AspectRose', 'Stereonet']) {
      const l = build(id)
      expect(l[id], id).toBeTruthy()
      expect(l[`${id}-Rules`], `${id}-Rules`).toBeTruthy()
      for (const layer of Object.values(l)) {
        const P = layer.positions
        for (let i = 1; i < P.length; i += 3) expect(P[i]).toBeCloseTo(terrain.maxElev, 4)
      }
    }
  })
})

describe('Swath Profile', () => {
  it('reads higher through the summit than across the whole plate', () => {
    // Up the sheet is −z: the mean line's highest point is its least z.
    const peak = (width) => Math.min(...segs(build('SwathProfile', { widthSwathProfile: width }).SwathProfile.positions).map((s) => Math.min(s[2], s[5])))
    expect(peak(0.1)).toBeLessThan(peak(1))
  })

  it('hatches the envelope every few steps', () => {
    const rules = (hatch) => segs(build('SwathProfile', { hatchSwathProfile: hatch })['SwathProfile-Rules'].positions).length
    expect(rules(3) - rules(0)).toBeGreaterThan(150)
  })
})

describe('Hypsometry', () => {
  it('falls from the top left to the bottom right, and states the integral', () => {
    const l = build('Hypsometry')
    const S = segs(l.Hypsometry.positions)
    for (const [x0, , z0, x1, , z1] of S) { expect(x1).toBeGreaterThan(x0); expect(z1).toBeGreaterThanOrEqual(z0 - 1e-6) }
    // The integral is the mean height over the range, every cell counted.
    let sum = 0, n = 0, lo = Infinity, hi = -Infinity
    for (const v of terrain.grid) { if (v < lo) lo = v; if (v > hi) hi = v }
    for (const v of terrain.grid) { sum += (v - lo) / (hi - lo); n++ }
    const text = l['Hypsometry-Rules'].scaleAnchors.map((a) => a.text).find((t) => t.startsWith('HI '))
    expect(text).toBe(`HI ${(sum / n).toFixed(2)}`)
  })
})

describe('Aspect Rose', () => {
  it('is round on a cone, which faces every way alike', () => {
    // A petal's arc keeps one distance from the centre; its edges do not.
    const radii = segs(build('AspectRose').AspectRose.positions)
      .map(([x0, , z0, x1, , z1]) => [Math.hypot(x0, z0), Math.hypot(x1, z1)])
      .filter(([a, b]) => Math.abs(a - b) < 1e-3).map(([a]) => a)
    expect(Math.min(...radii) / Math.max(...radii)).toBeGreaterThan(0.85)
  })

  it('names the compass points', () => {
    const texts = build('AspectRose')['AspectRose-Rules'].scaleAnchors.map((a) => a.text)
    for (const t of ['N', 'E', 'S', 'W']) expect(texts).toContain(t)
  })
})

describe('Stereonet', () => {
  it('puts every pole of the cone on one ring, at its dip', () => {
    const R = 0.42 * Math.min(2 * terrain.halfW, 2 * terrain.halfH)
    const want = R * Math.SQRT2 * Math.sin(Math.atan(2.5) / 2)
    // Each pole is a small cross; its level arm's middle is the pole.
    const at = segs(build('Stereonet')['Stereonet-Poles'].positions)
      .filter(([, , z0, , , z1]) => Math.abs(z0 - z1) < 1e-9)
      .map(([x0, , z0, x1]) => Math.hypot((x0 + x1) / 2, z0))
      .sort((a, b) => a - b)
    expect(at.length).toBeGreaterThan(50)
    expect(at[Math.floor(at.length / 2)] / want).toBeCloseTo(1, 1)
  })

  it('draws the net only when asked', () => {
    const rules = (net) => segs(build('Stereonet', { netStereonet: net })['Stereonet-Rules'].positions).length
    expect(rules(true)).toBeGreaterThan(rules(false) + 1000)
  })
})
