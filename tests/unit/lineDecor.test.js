import { describe, it, expect } from 'vitest'
import {
  offsetPolyline, ticksAlong, marksAlong, stationsAlong, orientRings, ringArea2,
} from '../../src/utils/lineDecor'
import { splitDashSegment, dashPattern } from '../../src/utils/svgExport'

const line = (...xy) => Float64Array.from(xy)

describe('offsetPolyline', () => {
  it('moves a straight line to its left', () => {
    // Pixel rows grow downward, so the left of an eastward line is up (−y).
    const o = offsetPolyline(line(0, 0, 10, 0), 2, false, 3)
    expect([...o]).toEqual([0, -3, 10, -3])
  })

  it('mitres a right angle at the offset distance from both legs', () => {
    const o = offsetPolyline(line(0, 0, 10, 0, 10, 10), 3, false, 2)
    // East then south: the left side is the outside of the turn.
    expect(o[2]).toBeCloseTo(12, 9)
    expect(o[3]).toBeCloseTo(-2, 9)
  })

  it('bevels a turn sharper than the mitre limit', () => {
    const o = offsetPolyline(line(0, 0, 10, 0, 0, 0.5), 3, false, 1, 2)
    expect(o.length).toBe(8)   // the corner became two points
  })

  it('closes a ring', () => {
    const o = offsetPolyline(line(0, 0, 10, 0, 10, 10, 0, 10, 0, 0), 5, true, 1)
    expect(o[0]).toBeCloseTo(o[o.length - 2], 9)
    expect(o[1]).toBeCloseTo(o[o.length - 1], 9)
  })
})

describe('stations and ticks', () => {
  it('spaces stations evenly from half a spacing in', () => {
    const s = stationsAlong(line(0, 0, 100, 0), 2, false, 20)
    expect(s.map((p) => p.x)).toEqual([10, 30, 50, 70, 90])
  })

  it('puts right ticks on the right of the direction', () => {
    const t = ticksAlong(line(0, 0, 100, 0), 2, false, 50, 4, 'right')
    // Right of east is down (+y).
    expect(t.slice(0, 4)).toEqual([25, 0, 25, 4])
  })

  it('centres two-sided ticks on the line', () => {
    const t = ticksAlong(line(0, 0, 100, 0), 2, false, 50, 4, 'both')
    expect(t.slice(0, 4)).toEqual([25, 2, 25, -2])
  })
})

describe('marksAlong', () => {
  it('turns a chevron with the line', () => {
    const [m] = marksAlong(line(0, 0, 0, 100), 2, false, 200, 10, 'chevron')
    // Southward line: the tip points to +y.
    expect(m[3]).toBeGreaterThan(m[1])
  })

  it('keeps the sheet orientation when fixed', () => {
    const [m] = marksAlong(line(0, 0, 0, 100), 2, false, 200, 10, 'chevron', { fixed: true })
    expect(m[2]).toBeGreaterThan(m[0])
  })

  it('stands a tooth on the requested side', () => {
    const [r] = marksAlong(line(0, 0, 100, 0), 2, false, 200, 10, 'triangle', { side: 'right' })
    const [l] = marksAlong(line(0, 0, 100, 0), 2, false, 200, 10, 'triangle', { side: 'left' })
    expect(r[3]).toBeGreaterThan(0)
    expect(l[3]).toBeLessThan(0)
  })
})

describe('orientRings', () => {
  it('turns an outer ring clockwise and its hole anticlockwise', () => {
    const outer = line(0, 0, 0, 10, 10, 10, 10, 0)       // anticlockwise on screen
    const hole = line(3, 3, 6, 3, 6, 6, 3, 6)            // clockwise on screen
    const [o, h] = orientRings([outer, hole])
    expect(ringArea2(o, 4)).toBeGreaterThan(0)
    expect(ringArea2(h, 4)).toBeLessThan(0)
  })
})

describe('dash patterns in the SVG', () => {
  it('keeps a plain dash as it was', () => {
    const s = splitDashSegment(0, 0, 10, 0, 0, [3, 2])
    expect(s.map((d) => [d.x0, d.x1])).toEqual([[0, 3], [5, 8]])
  })

  it('draws a dash, a gap, a dot and a gap', () => {
    const p = dashPattern({ dashPx: 6, gapPx: 2, dotPx: 1, dotCount: 1 })
    expect(p).toEqual([6, 2, 1, 2])
    const s = splitDashSegment(0, 0, 22, 0, 0, p)
    expect(s.map((d) => [d.x0, d.x1])).toEqual([[0, 6], [8, 9], [11, 17], [19, 20]])
  })

  it('starts mid-pattern from the offset', () => {
    const s = splitDashSegment(0, 0, 4, 0, 7, [6, 2, 1, 2])
    // 7 is one pixel into the gap after the dash: one more pixel of gap, then the dot.
    expect(s.map((d) => [d.x0, d.x1])).toEqual([[1, 2]])
  })
})
