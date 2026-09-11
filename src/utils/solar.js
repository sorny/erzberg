/**
 * Where the sun actually was.
 *
 * Hillshade takes an azimuth and an altitude as two free numbers, and the
 * default pair — 315°, 45° — is the cartographic convention. It is also a
 * position the sky never offers: at the Erzberg's own latitude, 47.53° N, the
 * sun never passes 307° of bearing on any day of any year. The convention is
 * still right, because light from the upper left is what defeats the
 * relief-inversion illusion, so this module does not replace it. It stands
 * beside it, and turns the two free numbers into an ephemeris when asked.
 *
 * The app already knows where the ground is: a GeoTIFF carries a coordinate
 * system and a bounding box, and `bboxToWgs84` has been converting that to
 * latitude and longitude for the OpenStreetMap query since v0.9. Add a date and
 * a clock and every one of these numbers is answered by the ground rather than
 * invented — including the cast shadows the surface shader already marches,
 * which become the shadows that fell at that hour.
 *
 * ── The maths ────────────────────────────────────────────────────────────────
 * NOAA's solar position polynomials, as published in their spreadsheet and in
 * Meeus, *Astronomical Algorithms*, chapter 25. Accurate to well under a minute
 * of arc for any year this tool will see, which is far finer than a shading
 * angle can express. Arithmetic only: no dependency, no network, no table.
 *
 * Everything here is pure and takes its inputs as arguments, so the unit suite
 * can check it against published positions rather than against itself.
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** Degrees, wrapped into [0, 360). */
const wrap360 = (d) => ((d % 360) + 360) % 360

/**
 * Julian Day for a civil date and a UTC clock.
 *
 * The Gregorian branch only — the calendar reform predates every DEM by three
 * centuries, and carrying the Julian branch would be arithmetic nothing here can
 * reach.
 */
export function julianDay(year, month, day, hoursUTC = 0) {
  let y = year, m = month
  if (m <= 2) { y -= 1; m += 12 }
  const a = Math.floor(y / 100)
  const b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1))
    + day + b - 1524.5 + hoursUTC / 24
}

/**
 * Atmospheric refraction, in degrees, to add to a true elevation.
 *
 * Included rather than skipped because it is what makes the horizon honest: the
 * sun is already fully above it, by about its own diameter, at the moment
 * geometry says its centre is still below. Without this a winter afternoon at a
 * high latitude reports a negative altitude for light that is visibly on the
 * hill. NOAA's piecewise fit, in arcseconds.
 */
function refraction(elevation) {
  if (elevation > 85) return 0
  const te = Math.tan(elevation * RAD)
  let arcsec
  if (elevation > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
  else if (elevation > -0.575) arcsec = 1735 + elevation *
    (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)))
  else arcsec = -20.772 / te
  return arcsec / 3600
}

/**
 * The sun's declination and the equation of time, for one instant.
 *
 * Split out because both are properties of the date alone — the same two
 * numbers serve every latitude — and because the equation of time is the part
 * worth being able to show: it is why solar noon wanders by up to a quarter of
 * an hour across the year while the clock does not.
 *
 * @returns {{declination: number, eqTime: number}} degrees, and minutes
 */
export function solarDate(jd) {
  const t = (jd - 2451545) / 36525                      // Julian centuries J2000
  const l0 = wrap360(280.46646 + t * (36000.76983 + t * 0.0003032))
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const c = Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m * RAD) * 0.000289
  const trueLong = l0 + c
  // Apparent longitude: the nutation term the true longitude does not carry.
  const omega = 125.04 - 1934.136 * t
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  const e0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const eps = e0 + 0.00256 * Math.cos(omega * RAD)

  const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG

  const y = Math.tan(eps / 2 * RAD) ** 2
  const eqTime = 4 * DEG * (
    y * Math.sin(2 * l0 * RAD)
    - 2 * e * Math.sin(m * RAD)
    + 4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD)
    - 0.5 * y * y * Math.sin(4 * l0 * RAD)
    - 1.25 * e * e * Math.sin(2 * m * RAD))

  return { declination, eqTime }
}

/**
 * Where the sun is, from the ground and the clock.
 *
 * @param {object} at
 * @param {number} at.lat        degrees north
 * @param {number} at.lon        degrees east
 * @param {number} at.year
 * @param {number} at.month      1–12
 * @param {number} at.day        1–31
 * @param {number} at.hours      local standard time, 0–24, fractional
 * @param {number} at.utcOffset  hours the local clock runs ahead of UTC
 * @returns {{azimuth: number, altitude: number, declination: number,
 *            eqTime: number, hourAngle: number}}
 *   Azimuth is degrees clockwise from north, which is the convention the
 *   hillshade slider has always used. Altitude carries the refraction
 *   correction, so it is where the sun *looks* rather than where it is.
 */
export function solarPosition({ lat, lon, year, month, day, hours = 12, utcOffset = 0 }) {
  const jd = julianDay(year, month, day, hours - utcOffset)
  const { declination, eqTime } = solarDate(jd)

  // True solar time, in minutes past local solar midnight. The three
  // corrections are the whole of the difference between a clock and the sky:
  // the equation of time, the longitude's offset from its own zone meridian,
  // and the zone itself.
  const tst = (hours * 60 + eqTime + 4 * lon - 60 * utcOffset + 1440) % 1440
  const hourAngle = tst / 4 - 180

  const latR = lat * RAD, decR = declination * RAD, haR = hourAngle * RAD
  const cosZenith = Math.min(1, Math.max(-1,
    Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(haR)))
  const zenith = Math.acos(cosZenith) * DEG
  const trueElevation = 90 - zenith
  const altitude = trueElevation + refraction(trueElevation)

  // Azimuth from the zenith triangle. The hour-angle sign is what puts the
  // morning in the east: the cosine alone cannot tell one side of the meridian
  // from the other.
  const sinZenith = Math.sin(zenith * RAD)
  let azimuth
  if (Math.abs(sinZenith) < 1e-9 || Math.abs(Math.cos(latR)) < 1e-9) {
    // The sun overhead, or the observer at a pole: every direction is the same
    // direction. North is as good an answer as any and is a stable one.
    azimuth = 180
  } else {
    const cosAz = Math.min(1, Math.max(-1,
      (Math.sin(latR) * cosZenith - Math.sin(decR)) / (Math.cos(latR) * sinZenith)))
    const a = Math.acos(cosAz) * DEG
    azimuth = hourAngle > 0 ? wrap360(a + 180) : wrap360(540 - a)
  }

  return { azimuth, altitude, declination, eqTime, hourAngle }
}

/**
 * Sunrise, solar noon and sunset, in local standard hours.
 *
 * −0.833° rather than 0: the standard rise/set definition puts the sun's *upper
 * limb* on the horizon, which is its semi-diameter plus mean refraction below
 * geometric zero. Returns nulls for `rise` and `set` where the sun does not
 * cross that altitude at all — a polar day or a polar night is a real answer
 * about the ground, and pretending to a time there would be a worse one.
 */
export function sunTimes({ lat, lon, year, month, day, utcOffset = 0 }) {
  const jd = julianDay(year, month, day, 12 - utcOffset)
  const { declination, eqTime } = solarDate(jd)
  const noon = (720 - 4 * lon - eqTime + 60 * utcOffset) / 60

  const latR = lat * RAD, decR = declination * RAD
  const cosH = (Math.cos(90.833 * RAD) - Math.sin(latR) * Math.sin(decR))
    / (Math.cos(latR) * Math.cos(decR))
  if (!(cosH >= -1 && cosH <= 1)) {
    return { rise: null, set: null, noon, polar: cosH < -1 ? 'day' : 'night' }
  }
  const h = Math.acos(cosH) * DEG / 15
  return { rise: noon - h, set: noon + h, noon, polar: null }
}

/**
 * The sun's own path across a day, sampled — and why there is no clock in it.
 *
 * The almanac above answers "where is the sun at 09:15". This answers a
 * different question: *how much* sun does a place get. Counting hours needs no
 * clock at all, and saying so removes three inputs and two ways to be wrong.
 *
 * The day is walked in **hour angle** rather than in local time. Hour angle is
 * the sun's own position east or west of the meridian: −H₀ at sunrise, 0 at
 * solar noon, +H₀ at sunset, where
 *
 *     cos H₀ = −tan(φ)·tan(δ)
 *
 * for latitude φ and declination δ. The equation of time, the longitude and the
 * time zone all shift *when* on a clock the sun is at a given hour angle. None
 * of them changes how long it is up, and none of them changes where it is in the
 * sky while it is. So a sun-hours field needs the latitude and the date, and
 * nothing else — a total that came out different in Vienna and in Innsbruck for
 * the same mountain would be a bug wearing a time zone.
 *
 * Each sample carries the **hours it stands for**, so the caller sums weights
 * rather than counting hits and never has to know how the day was divided.
 *
 * @param {object} at
 * @param {number} at.lat        degrees north
 * @param {number} at.year       the reference year — declination varies by a
 *                               few hundredths of a degree between years, so
 *                               this is fixed rather than exposed
 * @param {number[]} at.dayNumbers  days of the year to sample, 1-based
 * @param {number} at.perDay     samples between sunrise and sunset
 * @returns {{azimuth:number, altitude:number, hours:number}[]}
 *   Empty for a polar night. A polar day returns a full 24 hours of samples.
 */
export function sunPath({ lat, year = 2026, dayNumbers = [], perDay = 16 }) {
  const out = []
  const n = Math.max(1, Math.round(perDay))
  const latR = lat * RAD

  for (const day of dayNumbers) {
    // Day 1 is 1 January. `julianDay` takes a civil date, and month 1 with a day
    // number past its end is exactly how a Julian Day is meant to absorb one.
    const { declination } = solarDate(julianDay(year, 1, day, 12))
    const decR = declination * RAD

    // The half-day angle, at the geometric horizon. Not the −0.833° upper-limb
    // definition `sunTimes` uses: this counts *direct* sun on a slope, and the
    // shading test a caller applies is `altitude > 0` for the same surface. Two
    // horizons half a degree apart would leave a rim of sunlit ground that the
    // shading says is dark.
    const cosH = -Math.tan(latR) * Math.tan(decR)
    if (cosH > 1) continue                                   // polar night
    const h0 = cosH < -1 ? 180 : Math.acos(cosH) * DEG       // polar day
    const dayHours = (2 * h0) / 15
    const weight = dayHours / n

    for (let k = 0; k < n; k++) {
      // Mid-interval sampling. Sunrise and sunset are the two moments the sun
      // contributes nothing, so putting samples on them would throw away two
      // slices of a short winter day at the ends where it can least afford it.
      const hourAngle = -h0 + ((k + 0.5) / n) * 2 * h0
      const haR = hourAngle * RAD
      const sinAlt = Math.min(1, Math.max(-1,
        Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(haR)))
      const altitude = Math.asin(sinAlt) * DEG
      if (altitude <= 0) continue

      const zenith = 90 - altitude
      const sinZ = Math.sin(zenith * RAD)
      let azimuth = 180
      if (Math.abs(sinZ) > 1e-9 && Math.abs(Math.cos(latR)) > 1e-9) {
        const cosAz = Math.min(1, Math.max(-1,
          (Math.sin(latR) * sinAlt - Math.sin(decR)) / (Math.cos(latR) * sinZ)))
        const a = Math.acos(cosAz) * DEG
        azimuth = hourAngle > 0 ? wrap360(a + 180) : wrap360(540 - a)
      }
      out.push({ azimuth, altitude, hours: weight })
    }
  }
  return out
}

/**
 * Days of the year to stand for a whole year, spread evenly.
 *
 * Evenly spaced rather than the 21st of each month. The declination is a sine
 * wave, so twelve evenly spaced days sample it without the seasonal bias that
 * comes from a calendar whose months are not equal — and the mid-interval offset
 * keeps the set symmetric about the solstices, which is what makes a small
 * sample honest about the extremes.
 */
export function yearDays(count = 12) {
  const n = Math.max(1, Math.round(count))
  return Array.from({ length: n }, (_, k) => Math.round(((k + 0.5) / n) * 365) || 1)
}

/** `'2026-06-21'` → 172. The day number `sunPath` walks. */
export function dayOfYear({ year, month, day }) {
  const start = julianDay(year, 1, 1, 12)
  return Math.round(julianDay(year, month, day, 12) - start) + 1
}

/**
 * The time zone a longitude sits in, as whole hours ahead of UTC.
 *
 * A guess, and stated as one in the panel — political zones follow borders, not
 * meridians, and no offline table can be honest about that. What it *is* honest
 * about is solar geometry: this is the zone whose standard meridian is nearest,
 * so the clock it implies runs within half an hour of the local sun.
 */
export function zoneForLongitude(lon) {
  return Math.max(-12, Math.min(14, Math.round(lon / 15)))
}

/**
 * `9.25` → `09:15`. The panel says hours as a clock, never as a decimal.
 *
 * Rounded to the minute *before* the wrap, not after: 23.999 h rounds to 1440
 * minutes, and wrapping only the input would print that as `24:00`.
 */
export function formatClock(hours) {
  if (hours == null || !Number.isFinite(hours)) return '—'
  const total = ((Math.round(hours * 60) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * `'2026-06-21'` → `{year, month, day}`, or null.
 *
 * The panel stores the date as the string an `<input type="date">` hands back,
 * so this is the one place that shape is understood. Strict: a half-typed value
 * has to read as "no date" rather than as year 202.
 */
export function parseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''))
  if (!m) return null
  const year = +m[1], month = +m[2], day = +m[3]
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}
