/**
 * Hours of direct sun, checked against the sky rather than against a picture.
 *
 * This field is the one thing this app computes that somebody might *act* on —
 * where to put a hut, which aspect holds snow, whether a panel array is worth
 * it. A shading convention that is subtly wrong makes a slightly odd drawing. A
 * sun-hours field that is subtly wrong gives an answer, confidently, and nothing
 * in the plate contradicts it.
 *
 * So the assertions here are facts about the world, not about the code: a north
 * face gets less sun than a south face and the whole thing inverts below the
 * equator; east and west are exactly symmetric on a symmetric hill; a flat
 * unshaded plain gets the whole of the daylight and no more; a wall in the way
 * takes hours off the ground behind it.
 */
import { describe, expect, it } from 'vitest'
import {
  SHADE_EDGE, latitudeFor, litField, samplingFor, shadowSun, smoothField,
  sunHourLevels, sunHoursField,
} from '../../src/utils/sunHours'
import { sunPath, yearDays } from '../../src/utils/solar'

const ERZ_LAT = 47.53

/** A symmetric cone on a plain: the one shape whose sun pattern is predictable. */
function cone(n, height = 1) {
  const grid = new Float32Array(n * n)
  const gridMask = new Uint8Array(n * n).fill(1)
  const mid = (n - 1) / 2
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      grid[r * n + c] = Math.max(0, 1 - Math.hypot(c - mid, r - mid) / mid) * height
    }
  }
  return { grid, gridMask, rows: n, cols: n, scl: 1, hasNoData: false }
}

/** Dead flat, with nothing to cast a shadow. */
function plain(n) {
  return {
    grid: new Float32Array(n * n).fill(0.5),
    gridMask: new Uint8Array(n * n).fill(1),
    rows: n, cols: n, scl: 1, hasNoData: false,
  }
}

const year = (over = {}) => ({
  elevScale: 1, lat: ERZ_LAT, perDay: 12, ...samplingFor('year', 12), ...over,
})

describe('sunHoursField', () => {
  it('gives a flat plain the whole of the daylight and no more', () => {
    // A horizontal surface with a clear horizon is lit whenever the sun is up,
    // so its total *is* the length of the year's daylight. That figure is
    // computed independently by `sunPath`, which is what makes this a check on
    // the field rather than on itself.
    const f = sunHoursField(plain(64), year())
    expect(f.min).toBeCloseTo(f.max, 1)
    const daylight = sunPath({ lat: ERZ_LAT, dayNumbers: yearDays(12), perDay: 12 })
      .reduce((t, s) => t + s.hours, 0) * (365 / 12)
    // To the minute, over four and a half thousand hours. The gap is the
    // accumulator being a Float32 summed over a hundred and forty-four terms,
    // not a disagreement about the sky.
    expect(f.hours[0]).toBeCloseTo(daylight, 1)
    expect(f.max).toBeCloseTo(daylight, 1)
    // About 4 400 hours — half the year, near enough, which is the sanity check
    // anybody can do in their head.
    expect(daylight).toBeGreaterThan(4200)
    expect(daylight).toBeLessThan(4600)
  })

  it('puts more sun on the south face than the north face, north of the equator', () => {
    const n = 128, m = (n - 1) / 2 | 0
    const f = sunHoursField(cone(n), year())
    const at = (dc, dr) => f.hours[(m + dr) * n + (m + dc)]
    // Row 0 is the raster's northern edge, so a smaller row is further north.
    const north = at(0, -30), south = at(0, 30)
    expect(south).toBeGreaterThan(north * 1.25)
  })

  it('is symmetric east to west, because the sun’s day is', () => {
    // The strongest test of the direction convention there is: any error in the
    // bearing, the sweep axis or the sign of the hour angle breaks this and
    // almost nothing else.
    const n = 128, m = (n - 1) / 2 | 0
    const f = sunHoursField(cone(n), year())
    const east = f.hours[m * n + (m + 30)], west = f.hours[m * n + (m - 30)]
    expect(east).toBeCloseTo(west, 6)
  })

  it('inverts below the equator', () => {
    const n = 96, m = (n - 1) / 2 | 0
    const f = sunHoursField(cone(n), year({ lat: -33 }))
    const north = f.hours[(m - 24) * n + m], south = f.hours[(m + 24) * n + m]
    expect(north).toBeGreaterThan(south * 1.2)
  })

  it('takes hours off the ground a ridge stands in front of', () => {
    // A wall right across a plain. At this latitude the sun is in the southern
    // half of the sky for most of the year, so the ground north of the wall —
    // behind it, from the sun's point of view — loses most of its hours.
    const n = 96, wall = 60
    const t = plain(n)
    for (let c = 0; c < n; c++) t.grid[wall * n + c] = 1
    const f = sunHoursField(t, year())
    const open = sunHoursField(plain(n), year()).hours[0]
    const at = (row) => f.hours[row * n + 40]

    expect(at(wall - 1)).toBeLessThan(open * 0.25)
    expect(at(wall - 20)).toBeLessThan(open * 0.5)
    // Closer to the wall is darker, all the way in.
    expect(at(wall - 1)).toBeLessThan(at(wall - 20))

    /*
     * And the *southern* side loses a slice too, which is the result worth
     * having: it is the one a hand-drawn intuition gets wrong.
     *
     * At 47° N the midsummer sun rises at a bearing of about 53° and sets at
     * about 307° — north of due east and due west. Roughly a sixth of the
     * year's daylight arrives while the sun is in the northern half of the sky,
     * and during it a wall to the *north* shades the ground to the south of it.
     * So the strip in front keeps most of its hours, not all of them, and it
     * recovers with distance as the wall drops below the low morning sun.
     */
    expect(at(wall + 1)).toBeGreaterThan(at(wall - 1) * 4)
    expect(at(wall + 1)).toBeLessThan(open * 0.9)
    expect(at(wall + 25)).toBeGreaterThan(at(wall + 1))
    expect(at(wall + 25)).toBeLessThan(open)
  })

  it('counts one date as that date, and a year as a year', () => {
    const n = 48
    const solstice = sunHoursField(plain(n), {
      elevScale: 1, lat: ERZ_LAT, perDay: 48, ...samplingFor('day', 0, '2026-06-21'),
    })
    // Sixteen hours at the Erzberg's midsummer, at the geometric horizon.
    expect(solstice.hours[0]).toBeCloseTo(15.77, 1)
    const midwinter = sunHoursField(plain(n), {
      elevScale: 1, lat: ERZ_LAT, perDay: 48, ...samplingFor('day', 0, '2026-12-21'),
    })
    expect(midwinter.hours[0]).toBeCloseTo(8.23, 1)
  })

  it('leaves a void at −1 rather than calling it dark', () => {
    // A hole in the data is not shaded ground. The tracer skips any cell with a
    // negative corner, which is how a sun-hours line stops at the edge of a
    // selection instead of drawing round it.
    const n = 32
    const t = plain(n)
    t.hasNoData = true
    t.gridMask[5 * n + 5] = 0
    const f = sunHoursField(t, year())
    expect(f.hours[5 * n + 5]).toBe(-1)
    expect(f.hours[5 * n + 6]).toBeGreaterThan(0)
    // And the sentinel stays out of the range the levels are fitted to. A
    // minimum of −1 would put every contour level outside the field.
    expect(f.min).toBeGreaterThan(0)
  })

  it('lengthens the shadows when the relief is exaggerated', () => {
    // The sweep works in world units, so it shadows the terrain *as drawn*. This
    // is the bargain the panel states out loud, and it is the same one the
    // hillshade's own cast shadows already make.
    const n = 96, m = (n - 1) / 2 | 0
    const flat = sunHoursField(cone(n), year({ elevScale: 0.4 }))
    const tall = sunHoursField(cone(n), year({ elevScale: 4 }))
    const north = (f) => f.hours[(m - 30) * n + m]
    expect(north(tall)).toBeLessThan(north(flat))
  })
})

describe('litField', () => {
  it('lights a flat plain whole, so there is no edge to draw', () => {
    // Nothing casts and nothing turns away: the field is uniform, and a uniform
    // field has no level set. An empty plate is the right answer here.
    const f = litField(plain(48), { elevScale: 1, azimuth: 180, altitude: 30 })
    expect([...f].every((v) => v === 1)).toBe(true)
  })

  it('draws nothing at all after sunset', () => {
    // There is no shadow edge at night. Tracing the outline of the whole raster
    // instead would be a lie with a closed boundary round it.
    const f = litField(cone(48), { elevScale: 1, azimuth: 180, altitude: -5 })
    expect([...f].every((v) => v === 0)).toBe(true)
  })

  it('puts the shadow on the side away from the sun', () => {
    const n = 96, m = (n - 1) / 2 | 0
    // A low sun due south: the northern flank of the cone is the dark one, both
    // because it faces away and because the summit stands in the way.
    const f = litField(cone(n), { elevScale: 1, azimuth: 180, altitude: 12 })
    const at = (dc, dr) => f[(m + dr) * n + (m + dc)]
    expect(at(0, 30)).toBe(1)     // south flank, toward the sun
    expect(at(0, -30)).toBe(0)    // north flank, away from it
  })

  it('throws a strip of shadow behind a wall', () => {
    // The cast half, separate from the facing half: flat ground on the far side
    // of a ridge is unlit even though it faces straight up.
    const n = 96, wall = 48
    const t = plain(n)
    for (let c = 0; c < n; c++) t.grid[wall * n + c] = 1
    const f = litField(t, { elevScale: 1, azimuth: 180, altitude: 10 })
    expect(f[(wall - 3) * n + 40]).toBe(0)     // north of the wall, in its shadow
    expect(f[(wall + 3) * n + 40]).toBe(1)     // south of it, in the sun
  })

  it('leaves a void out of it entirely', () => {
    const n = 32
    const t = plain(n)
    t.hasNoData = true
    t.gridMask[5 * n + 5] = 0
    const f = litField(t, { elevScale: 1, azimuth: 180, altitude: 30 })
    expect(f[5 * n + 5]).toBe(-1)
  })
})

describe('shadowSun', () => {
  it('needs a clock, where the hours field does not', () => {
    // A terminator is a fact about one moment, so the longitude and the zone
    // both matter — they decide which moment a time on a clock is naming.
    const base = {
      dateShadowLine: '2026-12-21', hourShadowLine: 15, zoneShadowLine: 1,
      latShadowLine: 47.53, lonShadowLine: 14.89,
    }
    const s = shadowSun(base)
    expect(s.fromRaster).toBe(false)
    expect(s.altitude).toBeGreaterThan(0)
    expect(s.azimuth).toBeGreaterThan(180)        // afternoon, west of south
    // Move the clock an hour and the sun moves with it.
    expect(shadowSun({ ...base, hourShadowLine: 9 }).azimuth).toBeLessThan(180)
    // Move the zone and the same clock reading names a different moment.
    expect(shadowSun({ ...base, zoneShadowLine: 5 }).azimuth).not.toBeCloseTo(s.azimuth, 3)
  })

  it('reads the raster when the raster knows', () => {
    const s = shadowSun({
      geoTiffCRS: 'EPSG:32633', geoTiffBbox: [490000, 5260000, 510000, 5280000],
      dateShadowLine: '2026-06-21', hourShadowLine: 12, zoneShadowLine: 1,
    })
    expect(s.fromRaster).toBe(true)
    expect(s.lat).toBeGreaterThan(47)
  })

  it('puts the sun below the horizon rather than guess at a half-typed date', () => {
    expect(shadowSun({ dateShadowLine: '2026-12', latShadowLine: 47 }).altitude).toBeLessThan(0)
  })
})

describe('the field cache', () => {
  it('recomputes only when the field itself would change', () => {
    /*
     * Three of the mode's parameters do not touch the field — the contour count
     * and the two smoothings — and every one of them is a geometry parameter, so
     * each drags a full rebuild behind it. Without the cache that rebuild pays
     * for a few hundred shadow sweeps to draw the same numbers at different
     * heights: a second a tick on a large grid.
     *
     * Identity is the assertion. A recomputed field is a new object even when
     * every number in it matches, so `toBe` catches a cache that silently is not
     * one, which `toEqual` would not.
     */
    const t = cone(64)
    const first = sunHoursField(t, year())
    expect(sunHoursField(t, year())).toBe(first)

    // A different latitude is a different field.
    expect(sunHoursField(t, year({ lat: 20 }))).not.toBe(first)
    // So is a different exaggeration: the sweep shadows the terrain as drawn.
    expect(sunHoursField(t, year({ elevScale: 4 }))).not.toBe(first)

    // One entry, so going back to the first set recomputes rather than
    // returning it. That is the trade: the mode is being tuned or it is not, and
    // a second entry would hold a second terrain alive for nothing.
    const again = sunHoursField(t, year())
    expect(again).not.toBe(first)
    expect(again.max).toBeCloseTo(first.max, 6)
  })

  it('never serves one terrain’s field for another', () => {
    // The grid is compared by identity, because the worker builds a new one
    // whenever anything upstream moves — and hashing a million cells to avoid
    // recomputing over them would be its own kind of silly.
    const a = cone(64), b = cone(64, 0.4)
    const fa = sunHoursField(a, year())
    const fb = sunHoursField(b, year())
    expect(fb).not.toBe(fa)
    expect(fb.max).not.toBeCloseTo(fa.max, 0)
  })
})

describe('sunHourLevels', () => {
  it('picks a round hour step to fit the field it was given', () => {
    // The interval is chosen, not typed: the range runs from thousands of hours
    // over a year to a handful over one winter day.
    expect(sunHourLevels(0, 4300, 6).filter((v) => v > SHADE_EDGE))
      .toEqual([500, 1000, 1500, 2000, 2500, 3000, 3500, 4000])
    expect(sunHourLevels(0, 8.2, 4).filter((v) => v > SHADE_EDGE)).toEqual([2, 4, 6, 8])
  })

  it('fits the steps to the field’s own range, not to zero', () => {
    /*
     * The result that makes a year's plate readable at all.
     *
     * A year's field clusters against its maximum — most of a gentle landscape
     * gets nearly the whole of the daylight, and all of the shape is in the top
     * fifth. Counted up from zero, nineteen of twenty levels land on ground
     * where nothing is happening. A contour map does not start a plateau at sea
     * level either.
     */
    const clustered = sunHourLevels(3600, 4400, 8)
    expect(clustered).toEqual([3700, 3800, 3900, 4000, 4100, 4200, 4300])
    // Nothing below the floor, and no shade edge: this ground is never dark.
    expect(clustered.every((v) => v > 3600)).toBe(true)
    expect(clustered).not.toContain(SHADE_EDGE)
  })

  it('traces the edge of the permanent shade, when there is any', () => {
    // The line the whole mode exists for. Marching squares cannot trace the zero
    // region itself — a test of `field ≥ 0` puts every cell on the same side of
    // it — so a level just above zero draws that boundary instead.
    expect(sunHourLevels(0, 4300, 6)[0]).toBe(SHADE_EDGE)
    // And it stays below the first real step even when the steps are tiny.
    const tiny = sunHourLevels(0, 1.2, 6)
    expect(tiny[0]).toBeLessThan(tiny[1])
  })

  it('has nothing to say about a field with no sun in it', () => {
    expect(sunHourLevels(0, 0, 6)).toEqual([])
    expect(sunHourLevels(0, -1, 6)).toEqual([])
    expect(sunHourLevels(500, 500, 6)).toEqual([])
  })
})

describe('latitudeFor', () => {
  it('reads the raster when the raster knows', () => {
    // A UTM zone 33N box over Styria. The same call the OpenStreetMap query and
    // the almanac make.
    const p = { geoTiffCRS: 'EPSG:32633', geoTiffBbox: [490000, 5260000, 510000, 5280000] }
    const { lat, fromRaster } = latitudeFor(p)
    expect(fromRaster).toBe(true)
    expect(lat).toBeGreaterThan(47)
    expect(lat).toBeLessThan(48)
  })

  it('falls back to the mode’s own control when it does not', () => {
    const { lat, fromRaster } = latitudeFor({ latSunHours: -12.5 })
    expect(fromRaster).toBe(false)
    expect(lat).toBe(-12.5)
  })
})

describe('samplingFor', () => {
  it('spreads a year and weights each day for the ones it stands for', () => {
    const s = samplingFor('year', 12)
    expect(s.dayNumbers).toHaveLength(12)
    expect(s.daysStandFor).toBeCloseTo(365 / 12, 9)
  })

  it('takes a date as itself', () => {
    expect(samplingFor('day', 12, '2026-06-21')).toEqual({ dayNumbers: [172], daysStandFor: 1 })
  })

  it('falls back to the year rather than to a guess at a day', () => {
    // Half a typed date is not a date, and a year is the answer this mode is
    // really for.
    expect(samplingFor('day', 8, '2026-06').dayNumbers).toHaveLength(8)
  })
})

describe('smoothField', () => {
  it('keeps the hole a hole', () => {
    /*
     * The bug this exists to stop, and it is silent.
     *
     * `boxBlur`'s masked path writes 0 into a void, because every other consumer
     * gates on the mask separately and 0 is the safe floor for a brightness.
     * This field gates on the *value*: −1 means "no ground" and the tracer skips
     * any cell with a negative corner. Left at 0 after a blur, a void reads as
     * ground that gets no sun at all — so the tracer stops skipping it and draws
     * a closed line round the edge of the selection, describing the selection
     * rather than the terrain.
     */
    const n = 16
    const hours = new Float32Array(n * n).fill(1000)
    const mask = new Uint8Array(n * n).fill(1)
    for (const i of [5 * n + 5, 5 * n + 6, 6 * n + 5]) { mask[i] = 0; hours[i] = -1 }

    const out = smoothField(hours, n, n, 2, mask)
    expect(out[5 * n + 5]).toBe(-1)
    expect(out[6 * n + 5]).toBe(-1)
    // And the ground beside it is still ground, not dragged down by the void.
    expect(out[8 * n + 8]).toBeCloseTo(1000, 3)
    expect(out[5 * n + 8]).toBeGreaterThan(900)
  })

  it('is the identity at no radius, without copying', () => {
    const hours = new Float32Array([1, 2, 3, 4])
    expect(smoothField(hours, 2, 2, 0, null)).toBe(hours)
  })
})
