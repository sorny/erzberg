/**
 * Paper framing and segment clipping.
 *
 * `clipSegment` is what makes SVG export cut at the page edge rather than hide
 * behind a clip path, and `tHead` is the part that is easy to get subtly wrong:
 * dash phase accumulates along a chain, so a piece whose head was cut off but
 * whose offset was not advanced restarts its pattern at the paper edge.
 */
import { describe, expect, it } from 'vitest'
import { clipSegment, guideDash, guideSegments, insetRect, insideRect, paperAspect, paperRatioLabel } from '../../src/utils/frame'

const R = { x: 0, y: 0, w: 100, h: 100 }

describe('insideRect', () => {
  it('counts the boundary as inside', () => {
    expect(insideRect(0, 0, R)).toBe(true)
    expect(insideRect(100, 100, R)).toBe(true)
  })
  it('rejects points outside on either axis', () => {
    expect(insideRect(-0.5, 50, R)).toBe(false)
    expect(insideRect(50, 100.5, R)).toBe(false)
  })
})

describe('clipSegment', () => {
  it('passes a fully contained segment through unchanged, with tHead 0', () => {
    const c = clipSegment(10, 10, 90, 90, R)
    expect(c).toMatchObject({ x0: 10, y0: 10, x1: 90, y1: 90, tHead: 0 })
  })

  it('returns null for a segment entirely outside', () => {
    expect(clipSegment(-50, -50, -10, -10, R)).toBeNull()
    expect(clipSegment(120, 10, 200, 90, R)).toBeNull()
  })

  it('trims the leading half and reports how far in the survivor starts', () => {
    // Enters the rect at x = 0, which is halfway along a segment from -100 to 100.
    const c = clipSegment(-100, 50, 100, 50, R)
    expect(c.x0).toBeCloseTo(0, 9)
    expect(c.x1).toBeCloseTo(100, 9)
    expect(c.tHead).toBeCloseTo(0.5, 9)
  })

  it('trims the trailing end without moving tHead', () => {
    const c = clipSegment(50, 50, 250, 50, R)
    expect(c.x1).toBeCloseTo(100, 9)
    expect(c.tHead).toBe(0)
  })

  it('handles a segment parallel to an edge and outside it', () => {
    // Horizontal, above the rect: parallel to both horizontal edges (dy === 0)
    // and outside, which is the p === 0 && q < 0 branch.
    expect(clipSegment(10, -10, 90, -10, R)).toBeNull()
  })

  it('keeps a segment running exactly along an edge', () => {
    const c = clipSegment(10, 0, 90, 0, R)
    expect(c).toMatchObject({ x0: 10, x1: 90, y0: 0, y1: 0 })
  })

  it('clips both ends of a segment that crosses the whole rect diagonally', () => {
    const c = clipSegment(-50, -50, 150, 150, R)
    expect(c.x0).toBeCloseTo(0, 9)
    expect(c.y0).toBeCloseTo(0, 9)
    expect(c.x1).toBeCloseTo(100, 9)
    expect(c.y1).toBeCloseTo(100, 9)
    expect(c.tHead).toBeCloseTo(0.25, 9)
  })
})

describe('insetRect', () => {
  it('is the identity at 0', () => {
    expect(insetRect(R, 0)).toMatchObject(R)
  })
  it('insets by a fraction of the shorter side, on all four edges', () => {
    const r = insetRect({ x: 0, y: 0, w: 200, h: 100 }, 0.1)   // 10% of 100 = 10
    expect(r).toMatchObject({ x: 10, y: 10, w: 180, h: 80 })
  })
})

describe('paperAspect', () => {
  it('returns ISO A portrait as 1 : √2 and flips it for landscape', () => {
    const portrait = paperAspect('iso', false)
    const landscape = paperAspect('iso', true)
    expect(portrait).toBeCloseTo(1 / Math.SQRT2, 3)
    expect(landscape).toBeCloseTo(Math.SQRT2, 3)
    expect(portrait * landscape).toBeCloseTo(1, 9)
  })

  it('honours a custom ratio', () => {
    expect(paperAspect('custom', false, 2)).toBeCloseTo(0.5, 9)
    expect(paperAspect('custom', true, 2)).toBeCloseTo(2, 9)
  })

  it('names a paper for the panel', () => {
    expect(typeof paperRatioLabel('iso')).toBe('string')
    expect(paperRatioLabel('iso').length).toBeGreaterThan(0)
  })
})

describe('guideSegments', () => {
  const r = { x: 10, y: 20, w: 300, h: 600 }
  it('draws nothing for no set', () => {
    expect(guideSegments(r, '')).toEqual([])
  })
  it('crosses the centre', () => {
    expect(guideSegments(r, 'centre')).toEqual([[160, 20, 160, 620], [10, 320, 310, 320]])
  })
  it('divides in thirds and at the golden section', () => {
    expect(guideSegments(r, 'thirds').map((s) => s[0])).toEqual([110, 10, 210, 10])
    const g = guideSegments(r, 'golden')
    expect(g[0][0]).toBeCloseTo(10 + 300 * 0.381966, 3)
    expect(g[2][0]).toBeCloseTo(10 + 300 * 0.618034, 3)
  })
  it('runs the diagonals corner to corner', () => {
    expect(guideSegments(r, 'diagonals')).toEqual([[10, 20, 310, 620], [310, 20, 10, 620]])
  })
  it('scales the dash with the width', () => {
    expect(guideDash('dashed', 2)).toBe('12 8')
    expect(guideDash('solid', 2)).toBeUndefined()
  })
})
