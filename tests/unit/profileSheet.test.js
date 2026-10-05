/**
 * Profile Sheet: the stack of profiles, the stations where they bend, and the
 * sheet lying flat above the plate.
 */
import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

// Two hills, wider than deep, so the cross band is the shorter of the two.
const W = 120, H = 60
const px = new Float32Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const a = Math.exp(-((x - 35) ** 2 + (y - 25) ** 2) / 200)
  const b = Math.exp(-((x - 85) ** 2 + (y - 35) ** 2) / 300)
  px[y * W + x] = 0.2 + 0.5 * a + 0.3 * b
}
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false, enabledProfileSheet: true }
const terrain = buildTerrain(px, new Uint8Array(W * H).fill(1), W, H, p0)
const build = (p = {}) => Object.fromEntries(buildLineGeometry(terrain, { ...p0, ...p }).map((l) => [l.id, l]))
const segs = (P) => Array.from({ length: P.length / 6 }, (_, k) => Array.from(P.subarray(6 * k, 6 * k + 6)))
const isRule = ([x0, , , x1]) => Math.abs(x0 - x1) < 1e-6

describe('the profile sheet', () => {
  it('lies flat at the highest point, as two pens', () => {
    const l = build()
    expect(Object.keys(l).sort()).toEqual(['ProfileSheet', 'ProfileSheet-Rules'])
    for (const id of Object.keys(l)) {
      const P = l[id].positions
      expect(P.length).toBeGreaterThan(0)
      for (let i = 1; i < P.length; i += 3) expect(P[i]).toBeCloseTo(terrain.maxElev, 4)
    }
  })

  it('plots the elevation change so far, which never falls, and the height, which does', () => {
    // Up the sheet is −z, and every profile segment runs left to right.
    const rises = (plot) => segs(build({ valueProfileSheet: plot }).ProfileSheet.positions)
      .map(([x0, , z0, x1, , z1]) => (x1 > x0 ? z0 - z1 : 0))
    expect(Math.min(...rises('change'))).toBeGreaterThan(-1e-6)
    expect(Math.min(...rises('climb'))).toBeGreaterThan(-1e-6)
    expect(Math.min(...rises('height'))).toBeLessThan(-1e-3)
  })

  it('rules a station wherever a profile bends, more of them at a finer tolerance', () => {
    const stations = (tol) => segs(build({ toleranceProfileSheet: tol })['ProfileSheet-Rules'].positions).filter(isRule).length
    expect(stations(0.15)).toBeGreaterThan(stations(1.5))
    // Each rule reaches past the frame by the tick at both ends.
    const l = build({ tickProfileSheet: 2 })
    const rules = segs(l['ProfileSheet-Rules'].positions)
    const frame = rules.filter((s) => Math.abs(s[2] - s[5]) < 1e-6).map((s) => s[2])
    const top = Math.min(...frame)
    const first = rules.find(isRule)
    expect(Math.min(first[2], first[5])).toBeLessThan(top)
  })

  it('draws the cross band below, shorter on a plate wider than deep', () => {
    // No level marks: one centred on the last station reaches past the edge.
    const P = segs(build({ bandsProfileSheet: 2, nodeProfileSheet: 0 }).ProfileSheet.positions)
    const mid = 0.6 * 2 * terrain.halfH - terrain.halfH
    const reach = (upper) => Math.max(...P.filter((s) => (s[2] < mid) === upper).map((s) => Math.max(s[0], s[3])))
    expect(reach(true)).toBeCloseTo(terrain.halfW, 3)
    expect(reach(false)).toBeLessThan(terrain.halfW * 0.2)
    // One band fills the sheet.
    const one = segs(build({ bandsProfileSheet: 1 }).ProfileSheet.positions)
    expect(Math.max(...one.map((s) => Math.max(s[2], s[5])))).toBeGreaterThan(mid)
  })

  it('numbers the stations under the frame, one to a cluster', () => {
    const rules = build()['ProfileSheet-Rules']
    const anchors = rules.scaleAnchors
    expect(anchors.length).toBeGreaterThan(3)
    // Counted from the left, rising, and never closer than the room a number needs.
    // The upper band's numbers hang under its frame, a little below the middle.
    const upper = anchors.filter((a) => a.z < 0.5 * terrain.halfH)
    const nums = upper.map((a) => Number(a.text))
    expect(nums[0]).toBe(1)
    for (let k = 1; k < nums.length; k++) {
      expect(nums[k]).toBeGreaterThan(nums[k - 1])
      expect(upper[k].x - upper[k - 1].x).toBeGreaterThanOrEqual(2.4 * upper[k].size - 1e-6)
    }
    expect(build({ numbersProfileSheet: false })['ProfileSheet-Rules'].scaleAnchors).toBeNull()
  })
})
