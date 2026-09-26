import { describe, it, expect } from 'vitest'
import { hatchLoops, hatchPlan, inkLightness } from '../../src/utils/hatchFill'

const square = (x, y, s) => [x, y, x + s, y, x + s, y + s, x, y + s]

describe('hatchLoops', () => {
  it('fills a square with lines one pitch apart', () => {
    const r = hatchLoops([square(0, 0, 10)], 1, 0)
    expect(r.strokes).toBe(10)
    expect(r.ink).toBeCloseTo(100, 6)
    for (let k = 0; k < r.segs.length; k += 4) {
      expect(r.segs[k + 1]).toBe(r.segs[k + 3])            // horizontal
      expect(Math.abs(r.segs[k + 2] - r.segs[k])).toBeCloseTo(10, 6)
    }
  })

  it('leaves a hole empty under the even-odd rule', () => {
    const r = hatchLoops([square(0, 0, 10), square(3, 3, 4)], 1, 0)
    expect(r.ink).toBeCloseTo(100 - 16, 6)
    for (let k = 0; k < r.segs.length; k += 4) {
      const y = r.segs[k + 1], xa = Math.min(r.segs[k], r.segs[k + 2]), xb = Math.max(r.segs[k], r.segs[k + 2])
      if (y > 3 && y < 7) expect(xb <= 3 + 1e-9 || xa >= 7 - 1e-9).toBe(true)
    }
  })

  it('alternates direction, so the pen never crosses back', () => {
    const r = hatchLoops([square(0, 0, 10)], 1, 0)
    // Each hop is one pitch: the next line starts where the last one ended.
    expect(r.travel).toBeCloseTo(9, 6)
  })

  it('turns with the angle', () => {
    const r = hatchLoops([square(0, 0, 10)], 1, 90)
    for (let k = 0; k < r.segs.length; k += 4) expect(r.segs[k]).toBeCloseTo(r.segs[k + 2], 9)
    expect(r.ink).toBeCloseTo(100, 6)
  })
})

describe('hatchPlan', () => {
  it('uses the base pitch at full contrast and crosses it', () => {
    const p = hatchPlan('#000000', '#ffffff', 2)
    expect(p.pitch).toBeCloseTo(2, 6)
    expect(p.cross).toBe(true)
  })
  it('opens out for a lighter ink', () => {
    const p = hatchPlan('#999999', '#ffffff', 2)
    expect(p.pitch).toBeGreaterThan(3)
    expect(p.cross).toBe(false)
  })
  it('skips an ink the paper cannot tell apart', () => {
    expect(hatchPlan('#fefefe', '#ffffff', 2)).toBeNull()
  })
  it('reads contrast against a dark paper too', () => {
    expect(hatchPlan('#ffffff', '#000000', 2).cross).toBe(true)
  })
  it('measures lightness perceptually', () => {
    expect(inkLightness('#777777')).toBeGreaterThan(0.45)
    expect(inkLightness('#777777')).toBeLessThan(0.55)
  })
})
