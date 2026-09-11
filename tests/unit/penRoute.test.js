/**
 * The pen's route, measured rather than admired.
 *
 * Reordering strokes is invisible on paper by construction — that is the whole
 * licence the optimiser operates under — so nothing about the drawing can tell
 * you whether it worked. The only evidence is the travel figure, and the only
 * way a reorder can be *wrong* is by losing a stroke, duplicating one, or
 * changing the ink laid down. Every test here is one of those four things.
 */
import { describe, expect, it } from 'vitest'
import { orderRuns, plotEstimate, routeStats } from '../../src/utils/penRoute'

/** A horizontal stroke of length `len` starting at (x, y). */
const stroke = (x, y, len = 10) => ({ pts: [x, y, x + len, y] })

/** Deterministic pseudo-random strokes, so a failure is reproducible. */
function scatter(n) {
  let seed = 12345
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  return Array.from({ length: n }, () => {
    const x = rnd() * 1000, y = rnd() * 1000
    return { pts: [x, y, x + rnd() * 30 - 15, y + rnd() * 30 - 15] }
  })
}

describe('routeStats', () => {
  it('separates the ink from the air', () => {
    // Two 10-long strokes, 90 apart end to start.
    const s = routeStats([stroke(0, 0), stroke(100, 0)])
    expect(s.ink).toBeCloseTo(20, 9)
    expect(s.travel).toBeCloseTo(90, 9)
    expect(s.strokes).toBe(2)
  })

  it('charges no travel for the first stroke', () => {
    expect(routeStats([stroke(500, 500)]).travel).toBe(0)
  })

  it('measures a polyline along its own bends', () => {
    expect(routeStats([{ pts: [0, 0, 3, 4, 3, 14] }]).ink).toBeCloseTo(15, 9)
  })
})

describe('orderRuns', () => {
  it('leaves the drawing exactly as it was, stroke for stroke', () => {
    const runs = scatter(400)
    const out = orderRuns(runs)
    expect(out).toHaveLength(runs.length)
    // Every stroke present once, whichever way round it is drawn.
    const key = ({ pts }) => {
      const a = `${pts[0].toFixed(6)},${pts[1].toFixed(6)}`
      const b = `${pts[2].toFixed(6)},${pts[3].toFixed(6)}`
      return a < b ? `${a}|${b}` : `${b}|${a}`
    }
    expect(new Set(out.map(key))).toEqual(new Set(runs.map(key)))
    // And the same ink: reversing a stroke does not change its length.
    expect(routeStats(out).ink).toBeCloseTo(routeStats(runs).ink, 6)
  })

  it('cuts the travel it exists to cut', () => {
    const runs = scatter(400)
    const before = routeStats(runs).travel
    const after = routeStats(orderRuns(runs)).travel
    expect(after).toBeLessThan(before * 0.35)
  })

  it('draws a stroke backwards when its tail is the nearer end', () => {
    // Three strokes on a line, the middle one written right-to-left. A route
    // that could not reverse would cross the gap twice.
    const runs = [
      { pts: [0, 0, 10, 0] },
      { pts: [40, 0, 20, 0] },
      { pts: [50, 0, 60, 0] },
    ]
    const out = orderRuns(runs)
    expect(routeStats(out).travel).toBeCloseTo(20, 6)   // 10→20, 40→50
    expect(out[1].pts).toEqual([20, 0, 40, 0])          // reversed
  })

  it('is deterministic, because a plot has to be repeatable', () => {
    const runs = scatter(200)
    expect(orderRuns(runs).map((r) => r.pts.join())).toEqual(
      orderRuns(runs).map((r) => r.pts.join()))
  })

  it('carries every other field on a stroke through untouched', () => {
    // `stroke` is the ink, and it is per run: a hypsometric layer changes colour
    // along its length, so losing it would repaint the drawing.
    const runs = [
      { pts: [0, 0, 1, 0], stroke: '#ff0000' },
      { pts: [50, 0, 51, 0], stroke: '#00ff00' },
      { pts: [9, 0, 8, 0], stroke: '#0000ff' },
    ]
    const out = orderRuns(runs)
    expect(new Set(out.map((r) => r.stroke))).toEqual(new Set(['#ff0000', '#00ff00', '#0000ff']))
  })

  it('leaves a list too short to reorder alone', () => {
    const two = [stroke(0, 0), stroke(5, 5)]
    expect(orderRuns(two)).toBe(two)
    expect(orderRuns([])).toEqual([])
  })

  it('survives strokes that all sit on one point', () => {
    // A degenerate grid — zero width and height — must not divide by zero or
    // loop forever.
    const same = Array.from({ length: 20 }, () => ({ pts: [7, 7, 7, 7] }))
    expect(orderRuns(same)).toHaveLength(20)
  })
})

describe('plotEstimate', () => {
  it('needs the one fact only the operator has', () => {
    expect(plotEstimate({ ink: 1000, travel: 500, widthPx: 1000, widthMm: 0 })).toBeNull()
    expect(plotEstimate({ ink: 1000, travel: 500, widthPx: 0, widthMm: 297 })).toBeNull()
  })

  it('converts by the sheet width and counts the lifts', () => {
    // 1 000 px across 300 mm of paper: 0.3 mm a pixel. 1 000 px of ink is 300 mm
    // at 120 mm/s — two and a half seconds — and 500 px of air is 150 mm at
    // 250 mm/s, another 0.6.
    const e = plotEstimate({ ink: 1000, travel: 500, widthPx: 1000, widthMm: 300, strokes: 0 })
    expect(e.inkMm).toBeCloseTo(300, 6)
    expect(e.travelMm).toBeCloseTo(150, 6)
    expect(e.minutes * 60).toBeCloseTo(300 / 120 + 150 / 250, 6)
  })

  it('makes the lift cost visible, because on a stipple field it is the plot', () => {
    // Forty thousand dots: the carriage has travelled almost nowhere and the
    // machine has still been running for hours.
    const dots = plotEstimate({ ink: 0, travel: 0, widthPx: 1000, widthMm: 300, strokes: 40_000 })
    expect(dots.minutes).toBeCloseTo(40_000 * 0.3 / 60, 6)
    expect(dots.minutes).toBeGreaterThan(180)
  })

  it('charges for a pen change', () => {
    const one = plotEstimate({ ink: 0, travel: 0, widthPx: 1, widthMm: 1, penChanges: 1 })
    expect(one.minutes).toBeCloseTo(0.5, 6)
  })
})
