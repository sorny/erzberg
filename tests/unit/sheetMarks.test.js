/**
 * The scale bar's arithmetic, checked without a camera.
 *
 * `measureScale` takes a projection rather than a three.js camera precisely so
 * this file can hand it one it wrote itself — a plan view, a rotated one, a view
 * seen edge-on — and assert the answer against a figure worked out by hand. The
 * alternative is measuring a bar in a screenshot, which tells you it drew and
 * not whether 500 m is 500 m.
 */
import { describe, expect, it } from 'vitest'
import { formatDistance, measureScale, niceDistance, sheetMarks } from '../../src/utils/sheetMarks'

/**
 * A plan view: straight down, `k` screen pixels per world unit, optionally
 * turned by `spin` radians. World y — elevation — never reaches the screen,
 * which is what makes it a plan.
 */
const planView = (k, spin = 0) => (x, y, z) => {
  const c = Math.cos(spin), s = Math.sin(spin)
  return [500 + (x * c - z * s) * k, 500 + (x * s + z * c) * k]
}

/** 30 m ground pixels, and the mesh lays one world unit per raster pixel. */
const GROUND = { x: 30, y: 30 }

describe('measureScale', () => {
  it('turns pixels per world unit into metres per pixel', () => {
    // Two screen pixels to a world unit, thirty metres to a world unit: fifteen
    // metres of ground under every pixel.
    expect(measureScale(planView(2), GROUND).metresPerPixel).toBeCloseTo(15, 6)
    expect(measureScale(planView(0.5), GROUND).metresPerPixel).toBeCloseTo(60, 6)
  })

  it('points north up the screen in an unrotated plan view', () => {
    // North is −Z: row 0 of a GeoTIFF is its northern edge. Screen y grows
    // downward, so up the screen is −π/2.
    expect(measureScale(planView(2), GROUND).northAngle).toBeCloseTo(-Math.PI / 2, 6)
  })

  it('turns the arrow with the camera', () => {
    // `planView`'s spin turns the world clockwise on screen, so north walks
    // round with it: up, then across to the right, then down the sheet.
    expect(measureScale(planView(2, Math.PI / 2), GROUND).northAngle).toBeCloseTo(0, 6)
    expect(measureScale(planView(2, Math.PI), GROUND).northAngle).toBeCloseTo(Math.PI / 2, 6)
  })

  it('keeps the scale under rotation, because a rotation is not a zoom', () => {
    const straight = measureScale(planView(2), GROUND).metresPerPixel
    for (const spin of [0.3, 1.1, 2.7, 4.9]) {
      expect(measureScale(planView(2, spin), GROUND).metresPerPixel).toBeCloseTo(straight, 6)
    }
  })

  it('reads a non-square ground pixel along the axis that is on screen', () => {
    // A geographic raster at 47° N: 55 m tall, 37 m wide. Squared up on load in
    // the real app, and the arithmetic still has to be right if it is not.
    const wide = measureScale(planView(1), { x: 37, y: 55 })
    expect(wide.metresPerPixel).toBeCloseTo(37, 6)
    // Turn it a quarter and the north–south pixel is the one lying across the
    // screen, so the bar measures the other figure.
    const tall = measureScale(planView(1, Math.PI / 2), { x: 37, y: 55 })
    expect(tall.metresPerPixel).toBeCloseTo(55, 6)
  })

  it('refuses a view with no ground on it', () => {
    // Edge-on: both ground axes land on the same screen line, so no horizontal
    // bar drawn across it would mean anything. Null, rather than a number.
    const edgeOn = (x, y, z) => [500 + x + z, 500]
    expect(measureScale(edgeOn, GROUND)).toBeNull()
    expect(measureScale(planView(2), null)).toBeNull()
    expect(measureScale(planView(2), { x: 0, y: 0 })).toBeNull()
  })
})

describe('niceDistance', () => {
  it('only ever returns a distance somebody would say out loud', () => {
    expect(niceDistance(437)).toBe(200)
    expect(niceDistance(500)).toBe(500)
    expect(niceDistance(1499)).toBe(1000)
    expect(niceDistance(7300)).toBe(5000)
    expect(niceDistance(0.7)).toBe(0.5)
    expect(niceDistance(0)).toBeNull()
  })

  it('never overruns the space it was given', () => {
    for (let t = 1; t < 100_000; t *= 1.37) expect(niceDistance(t)).toBeLessThanOrEqual(t)
  })
})

describe('formatDistance', () => {
  it('says metres below a kilometre and kilometres above', () => {
    expect(formatDistance(500)).toBe('500 m')
    expect(formatDistance(999)).toBe('999 m')
    expect(formatDistance(1000)).toBe('1 km')
    expect(formatDistance(2500)).toBe('2.5 km')
    expect(formatDistance(0)).toBe('')
  })
})

describe('sheetMarks', () => {
  const base = { width: 1000, height: 800, metresPerPixel: 15, northAngle: -Math.PI / 2 }

  it('draws a bar whose length is the round distance it claims', () => {
    const m = sheetMarks({ ...base, north: false })
    // The label and the geometry are the same fact: the drawn width times the
    // scale is the number printed under it.
    const drawn = m.rects.reduce((w, r) => w + r[2], 0) * 2   // four cells, two filled
    expect(drawn * base.metresPerPixel).toBeCloseTo(m.distance, 6)
    expect(m.texts.some((t) => t.text === formatDistance(m.distance))).toBe(true)
    expect(m.texts.some((t) => t.text === '0')).toBe(true)
  })

  it('keeps both marks inside the sheet when one is declared', () => {
    const frame = { x: 200, y: 100, w: 600, h: 500 }
    const m = sheetMarks({ ...base, frame })
    const xs = [...m.lines.flatMap((l) => [l[0], l[2]]), ...m.rects.map((r) => r[0])]
    const ys = [...m.lines.flatMap((l) => [l[1], l[3]]), ...m.rects.map((r) => r[1])]
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(frame.x)
    expect(Math.max(...xs)).toBeLessThanOrEqual(frame.x + frame.w)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(frame.y)
    expect(Math.max(...ys)).toBeLessThanOrEqual(frame.y + frame.h)
  })

  it('turns the arrow with north and leaves the bar level', () => {
    const up = sheetMarks({ ...base, bar: false })
    const right = sheetMarks({ ...base, bar: false, northAngle: 0 })
    // The shaft is the first line of the arrow. Straight up, then to the right.
    const shaft = (m) => Math.atan2(m.lines[0][3] - m.lines[0][1], m.lines[0][2] - m.lines[0][0])
    expect(shaft(up)).toBeCloseTo(-Math.PI / 2, 6)
    expect(shaft(right)).toBeCloseTo(0, 6)
    // The bar never turns: it is drawn across the sheet, and its length is the
    // ground distance that lies under a horizontal screen run.
    const bar = sheetMarks({ ...base, north: false, northAngle: 1.2 })
    for (const r of bar.rects) expect(r[1]).toBeCloseTo(bar.rects[0][1], 6)
  })

  it('says nothing rather than something invented', () => {
    expect(sheetMarks({ ...base, bar: false, north: false })).toBeNull()
    expect(sheetMarks({ ...base, metresPerPixel: 0 })).toBeNull()
    expect(sheetMarks({ ...base, metresPerPixel: NaN })).toBeNull()
    expect(sheetMarks({ ...base, width: 0 })).toBeNull()
  })

  it('scales both marks together', () => {
    const one = sheetMarks({ ...base })
    const two = sheetMarks({ ...base, scale: 2 })
    expect(two.texts[0].size).toBeCloseTo(one.texts[0].size * 2, 6)
    // The bar's *length* is the round distance, so it does not double — only the
    // weight of the mark does. That is the point of a scale bar.
    expect(two.distance).toBe(one.distance)
  })
})
