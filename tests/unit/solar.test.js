/**
 * The sun, checked against the sky rather than against itself.
 *
 * Every assertion here is a published figure — a solstice declination, the two
 * extremes of the equation of time, a solar noon on a date when the equation of
 * time is near zero, a sunrise anyone in Eisenerz can look up. A solar routine
 * that is subtly wrong stays plausible for a long time: the shadows still move
 * the right way round the compass and only the *hour* is a lie, which nothing in
 * a picture can contradict. So the numbers come from outside.
 *
 * Tolerances are stated per assertion and are all far finer than a shading angle
 * can express. NOAA's polynomials are good to well under a minute of arc; a
 * hillshade azimuth slider steps by five degrees.
 */
import { describe, expect, it } from 'vitest'
import {
  formatClock, julianDay, parseDate, solarDate, solarPosition, sunTimes, zoneForLongitude,
} from '../../src/utils/solar'
import { lightVector } from '../../src/utils/geometryBuilders'

/** The mountain the tool is named after. */
const ERZ = { lat: 47.53, lon: 14.89 }

describe('julianDay', () => {
  it('agrees with the standard epochs', () => {
    // J2000.0 is 2000-01-01 12:00 UTC, by definition.
    expect(julianDay(2000, 1, 1, 12)).toBe(2451545)
    // Meeus, chapter 7, worked example.
    expect(julianDay(1957, 10, 4, 19.5 - 0.5)).toBeCloseTo(2436116.29, 2)
  })
})

describe('solarDate', () => {
  it('puts the solstices at the obliquity of the ecliptic', () => {
    const june = solarDate(julianDay(2026, 6, 21, 12)).declination
    const dec = solarDate(julianDay(2026, 12, 21, 12)).declination
    expect(june).toBeCloseTo(23.44, 1)
    expect(dec).toBeCloseTo(-23.44, 1)
  })

  it('puts the equinox declination at zero', () => {
    expect(Math.abs(solarDate(julianDay(2026, 3, 20, 12)).declination)).toBeLessThan(0.5)
  })

  it('reproduces both extremes of the equation of time', () => {
    // The two figures every almanac prints: about −14.2 minutes in mid-February
    // and about +16.4 in early November. They are the reason solar noon wanders
    // by half an hour across the year while the clock does not.
    expect(solarDate(julianDay(2026, 2, 11, 12)).eqTime).toBeCloseTo(-14.2, 0)
    expect(solarDate(julianDay(2026, 11, 3, 12)).eqTime).toBeCloseTo(16.4, 0)
  })
})

describe('solarPosition', () => {
  it('puts the sun overhead at the equator at equinox noon', () => {
    const s = solarPosition({ lat: 0, lon: 0, year: 2026, month: 3, day: 20, hours: 12 })
    expect(s.altitude).toBeGreaterThan(87)
  })

  it('puts the morning sun in the east and the evening sun in the west', () => {
    const at = (hours) => solarPosition({ ...ERZ, year: 2026, month: 6, day: 21, hours, utcOffset: 1 })
    expect(at(7).azimuth).toBeGreaterThan(45)
    expect(at(7).azimuth).toBeLessThan(135)
    expect(at(18).azimuth).toBeGreaterThan(255)
    expect(at(18).azimuth).toBeLessThan(315)
    // And highest in between.
    expect(at(12).altitude).toBeGreaterThan(at(7).altitude)
    expect(at(12).altitude).toBeGreaterThan(at(18).altitude)
  })

  it('reports the sun below the horizon at local midnight', () => {
    const s = solarPosition({ ...ERZ, year: 2026, month: 12, day: 21, hours: 0, utcOffset: 1 })
    expect(s.altitude).toBeLessThan(-40)
  })

  /**
   * The claim the whole idea rests on.
   *
   * erzberg's default hillshade sits at 315° of bearing. Swept minute by minute
   * across a whole year at this latitude, the sun never reaches it — it turns
   * back at about 307°, at the moment of midsummer sunset. The default is a
   * position the sky does not offer, and it is still the right default.
   */
  it('never reaches the default azimuth at the Erzberg, on any day of the year', () => {
    let maxAzimuth = 0
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= 28; day++) {
        for (let hours = 0; hours < 24; hours += 1 / 12) {
          const s = solarPosition({ ...ERZ, year: 2026, month, day, hours, utcOffset: 1 })
          if (s.altitude > 0 && s.azimuth > maxAzimuth) maxAzimuth = s.azimuth
        }
      }
    }
    expect(maxAzimuth).toBeLessThan(308)
    expect(maxAzimuth).toBeGreaterThan(305)
  })

  it('is symmetric about solar noon', () => {
    // Two hours either side of the meridian: near-equal altitudes, azimuths
    // equally far from due south. This is the check that catches a sign error in
    // the hour angle, which every other assertion here would survive.
    //
    // *Near*-equal, and the residual is physics rather than slack. In September
    // the declination moves about a degree a day, so the sun is measurably lower
    // in the afternoon than it was at the matching morning hour. A fifth of a
    // degree over four hours is what that drift is worth here.
    const noon = sunTimes({ ...ERZ, year: 2026, month: 9, day: 15, utcOffset: 1 }).noon
    const before = solarPosition({ ...ERZ, year: 2026, month: 9, day: 15, hours: noon - 2, utcOffset: 1 })
    const after = solarPosition({ ...ERZ, year: 2026, month: 9, day: 15, hours: noon + 2, utcOffset: 1 })
    expect(Math.abs(before.altitude - after.altitude)).toBeLessThan(0.3)
    expect(Math.abs((180 - before.azimuth) - (after.azimuth - 180))).toBeLessThan(0.5)
  })
})

describe('sunTimes', () => {
  it('puts solar noon on the clock where the meridian does', () => {
    // Greenwich on 15 April, when the equation of time passes through zero.
    expect(sunTimes({ lat: 51.5, lon: 0, year: 2026, month: 4, day: 15 }).noon).toBeCloseTo(12, 1)
  })

  it('gives the Erzberg the day lengths it really has', () => {
    // Standard time, no summer clock: about 04:03 to 20:01 at midsummer, and
    // 07:45 to 16:11 at midwinter. Sixteen hours against eight and a half.
    const june = sunTimes({ ...ERZ, year: 2026, month: 6, day: 21, utcOffset: 1 })
    const dec = sunTimes({ ...ERZ, year: 2026, month: 12, day: 21, utcOffset: 1 })
    expect(formatClock(june.rise)).toBe('04:03')
    expect(formatClock(june.set)).toBe('20:01')
    expect(june.set - june.rise).toBeCloseTo(15.97, 1)
    expect(dec.set - dec.rise).toBeCloseTo(8.43, 1)
  })

  it('says polar day and polar night rather than inventing a time', () => {
    const summer = sunTimes({ lat: 78, lon: 15, year: 2026, month: 6, day: 21, utcOffset: 1 })
    expect(summer.rise).toBeNull()
    expect(summer.polar).toBe('day')
    const winter = sunTimes({ lat: 78, lon: 15, year: 2026, month: 12, day: 21, utcOffset: 1 })
    expect(winter.set).toBeNull()
    expect(winter.polar).toBe('night')
  })
})

describe('the shading convention', () => {
  /**
   * The app's own light, asked rather than reproduced.
   *
   * This helper began as a copy of the three lines in `lambertDarkness`, and the
   * copy drifted the moment the convention changed — which is the exact failure
   * it was written to catch, arriving from the other direction. `lightVector` is
   * exported for this.
   *
   * `gx > 0` means the ground rises toward +column, so the surface faces west.
   * `gz > 0` means it rises toward +row, so the surface faces north.
   */
  const lit = (azimuth, altitude, gx, gz) => {
    const [Lx, Ly, Lz] = lightVector(azimuth, altitude)
    return Math.max(0, (-gx * Lx + Ly - gz * Lz) / Math.sqrt(gx * gx + gz * gz + 1))
  }
  const FACE = { west: [1, 0], east: [-1, 0], north: [0, 1], south: [0, -1] }
  /** Which face a light at this app-azimuth falls on hardest. */
  const brightest = (azimuth) => Object.entries(FACE)
    .map(([name, [gx, gz]]) => [name, lit(azimuth, 30, gx, gz)])
    .sort((a, b) => b[1] - a[1])[0][0]

  it('is a compass bearing, so an azimuth lights the face it names', () => {
    /*
     * The assertion the almanac needed and did not have, and now the one that
     * holds the whole v1.14.0 migration in place.
     *
     * Until then the light was `(cos az, sin alt, sin az)`, which puts azimuth 0
     * at the raster's *eastern* edge — so feeding in a real bearing rendered a
     * perfectly plausible plate lit from the wrong quarter. At noon it lit the
     * west faces and called it south.
     */
    expect(brightest(90)).toBe('east')
    expect(brightest(180)).toBe('south')
    expect(brightest(270)).toBe('west')
    expect(brightest(0)).toBe('north')
  })

  it('puts the classic cartographic light in the north-west', () => {
    // 315° is NW, which the panel has claimed all along and only now means. The
    // shipped default is 45° — the same north-east light the old 315° gave, kept
    // so the migration changed no picture.
    const nw = lit(315, 30, ...FACE.west), ne = lit(315, 30, ...FACE.east)
    expect(nw).toBeGreaterThan(ne)
    expect(lit(315, 30, ...FACE.north)).toBeGreaterThan(lit(315, 30, ...FACE.south))
    // And the shipped default, 45°, which is the old default's light under a
    // true name: north-east, so the north and east faces are lit exactly alike
    // and the two behind them exactly alike.
    const at45 = (f) => lit(45, 30, ...FACE[f])
    expect(at45('north')).toBeCloseTo(at45('east'), 9)
    expect(at45('south')).toBeCloseTo(at45('west'), 9)
    expect(at45('north')).toBeGreaterThan(at45('south'))
  })
})

describe('the panel’s helpers', () => {
  it('guesses a zone from the nearest standard meridian', () => {
    expect(zoneForLongitude(14.89)).toBe(1)     // the Erzberg, CET
    expect(zoneForLongitude(-74)).toBe(-5)      // New York, EST
    expect(zoneForLongitude(180)).toBe(12)
    expect(zoneForLongitude(-179)).toBe(-12)
  })

  it('writes hours as a clock', () => {
    expect(formatClock(9.25)).toBe('09:15')
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(23.999)).toBe('00:00')   // rounds up and wraps, not 24:00
    expect(formatClock(null)).toBe('—')
  })

  it('reads a date field strictly, so a half-typed one is no date at all', () => {
    expect(parseDate('2026-06-21')).toEqual({ year: 2026, month: 6, day: 21 })
    expect(parseDate('202-06-21')).toBeNull()
    expect(parseDate('2026-13-01')).toBeNull()
    expect(parseDate('')).toBeNull()
    expect(parseDate(null)).toBeNull()
  })
})
