/**
 * Magnetic declination from the World Magnetic Model 2025.
 *
 * Declination is the angle between true north and the way a compass needle
 * points, positive to the east. A topographic sheet prints it beside the north
 * arrow, so a walker can turn a bearing on the map into one on the compass.
 *
 * The model is a spherical harmonic series to degree 12 (NOAA NCEI and BGS,
 * public domain). `wmm2025.json` holds its coefficients as published, and this
 * evaluates the field the way the WMM report describes: geodetic to geocentric
 * coordinates, Schmidt semi-normalised Legendre functions, then the field
 * turned back to the ellipsoid. It is valid from 2025.0 to 2030.0.
 */
import WMM from './wmm2025.json'

const A = 6378.137, F = 1 / 298.257223563, E2 = F * (2 - F)
const R_REF = 6371.2
const RAD = Math.PI / 180

/** A date as a decimal year: 2026-11-04 → 2026.84. */
export function decimalYear(date) {
  const d = date instanceof Date ? date : new Date(date)
  const y = d.getUTCFullYear()
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1)
  return y + (d.getTime() - start) / (end - start)
}

/**
 * Declination in degrees, east positive, at a place and time.
 *
 * @param {number} lat   geodetic latitude, degrees
 * @param {number} lon   longitude, degrees
 * @param {number} year  decimal year
 * @param {number} altKm height above the ellipsoid, km
 * @returns {{ declination: number, valid: boolean }} `valid` is false outside the model's years
 */
export function declination(lat, lon, year, altKm = 0) {
  const phi = lat * RAD, lam = lon * RAD
  // Geodetic to geocentric spherical.
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi)
  const rc = A / Math.sqrt(1 - E2 * sinPhi * sinPhi)
  const p = (rc + altKm) * cosPhi, z = (rc * (1 - E2) + altKm) * sinPhi
  const r = Math.hypot(p, z)
  const phiC = Math.asin(z / r)
  const cosT = Math.sin(phiC), sinT = Math.cos(phiC)   // colatitude θ = 90° − φ′

  const N = WMM.nMax
  const dt = year - WMM.epoch
  const P = [], dP = []
  for (let n = 0; n <= N; n++) { P.push(new Float64Array(n + 1)); dP.push(new Float64Array(n + 1)) }
  P[0][0] = 1; dP[0][0] = 0
  for (let n = 1; n <= N; n++) {
    for (let m = 0; m <= n; m++) {
      if (n === m) {
        if (n === 1) { P[1][1] = sinT; dP[1][1] = cosT; continue }
        const k = Math.sqrt((2 * n - 1) / (2 * n))
        P[n][n] = k * sinT * P[n - 1][n - 1]
        dP[n][n] = k * (sinT * dP[n - 1][n - 1] + cosT * P[n - 1][n - 1])
      } else {
        const a = Math.sqrt(n * n - m * m)
        const b = n >= 2 && m <= n - 2 ? Math.sqrt((n - 1) * (n - 1) - m * m) : 0
        const p2 = m <= n - 2 ? P[n - 2][m] : 0, dp2 = m <= n - 2 ? dP[n - 2][m] : 0
        P[n][m] = ((2 * n - 1) * cosT * P[n - 1][m] - b * p2) / a
        dP[n][m] = ((2 * n - 1) * (cosT * dP[n - 1][m] - sinT * P[n - 1][m]) - b * dp2) / a
      }
    }
  }

  let bx = 0, by = 0, bz = 0
  for (let n = 1; n <= N; n++) {
    const ar = Math.pow(R_REF / r, n + 2)
    for (let m = 0; m <= n; m++) {
      const i = (n * (n + 1)) / 2 + m
      const g = WMM.g[i] + dt * WMM.gDot[i], h = WMM.h[i] + dt * WMM.hDot[i]
      const cm = Math.cos(m * lam), sm = Math.sin(m * lam)
      // dP/dθ is the negative of dP/dφ′, which is what the north component wants.
      bx += ar * (g * cm + h * sm) * dP[n][m]
      by += ar * m * (g * sm - h * cm) * P[n][m]
      bz -= ar * (n + 1) * (g * cm + h * sm) * P[n][m]
    }
  }
  by /= sinT > 1e-10 ? sinT : 1e-10
  // Geocentric to geodetic: turn the field by the difference of the latitudes.
  const psi = phiC - phi
  const X = bx * Math.cos(psi) - bz * Math.sin(psi)
  const Y = by
  const valid = year >= WMM.epoch && year <= WMM.validUntil
  return { declination: Math.atan2(Y, X) / RAD, valid }
}

/** `4.6° E`, `1.2° W`, `0.0°`. */
export function formatDeclination(deg) {
  const v = Math.round(Math.abs(deg) * 10) / 10
  if (v === 0) return '0.0°'
  return `${v.toFixed(1)}° ${deg > 0 ? 'E' : 'W'}`
}
