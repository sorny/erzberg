/**
 * The elevation profile of a route: a GPX track sampled on the terrain.
 *
 * The click profile samples a straight line between two points. A route bends,
 * so this walks its points, measures each step on the ellipsoid's mean sphere
 * (haversine), and samples the raster at an even spacing along that distance.
 * Ascent and descent are summed over the even samples, which also smooths out
 * the jitter of a GPS track's own points.
 */

const R = 6371008.8   // mean Earth radius, metres
const RAD = Math.PI / 180

export function haversine(lat0, lon0, lat1, lon1) {
  const dLat = (lat1 - lat0) * RAD, dLon = (lon1 - lon0) * RAD
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat0 * RAD) * Math.cos(lat1 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * @param {ArrayLike<number>} lonLat  the route, as lon, lat pairs
 * @param {(lat, lon) => number|null} valueAt  the raster's 0–1 value there, null off it
 * @param {(v) => number} toMetres
 * @param {number} n  samples along the route
 * @returns {{ points, elevMin, elevMax, distanceM, ascent, descent, off }|null}
 *   `points` are 0–1 raster values, as the click profile's are; `off` is the
 *   share of samples that fell off the terrain. Null with no route on the terrain.
 */
export function routeProfile(lonLat, valueAt, toMetres, n = 400) {
  const count = Math.floor((lonLat?.length ?? 0) / 2)
  if (count < 2) return null
  const cum = new Float64Array(count)
  for (let i = 1; i < count; i++) {
    cum[i] = cum[i - 1] + haversine(lonLat[2 * i - 1], lonLat[2 * i - 2], lonLat[2 * i + 1], lonLat[2 * i])
  }
  const total = cum[count - 1]
  if (!(total > 0)) return null

  const raw = new Array(n)
  let seg = 1, off = 0
  for (let k = 0; k < n; k++) {
    const d = (k / (n - 1)) * total
    while (seg < count - 1 && cum[seg] < d) seg++
    const span = cum[seg] - cum[seg - 1]
    const t = span > 0 ? (d - cum[seg - 1]) / span : 0
    const lon = lonLat[2 * seg - 2] + (lonLat[2 * seg] - lonLat[2 * seg - 2]) * t
    const lat = lonLat[2 * seg - 1] + (lonLat[2 * seg + 1] - lonLat[2 * seg - 1]) * t
    const v = valueAt(lat, lon)
    raw[k] = Number.isFinite(v) ? v : null
    if (raw[k] == null) off++
  }
  if (off > n / 2) return null

  // A sample off the terrain takes its nearest neighbour on it, so the line
  // stays whole and the sums do not jump.
  const points = raw.slice()
  for (let k = 0; k < n; k++) {
    if (points[k] != null) continue
    let j = 1
    while (points[k] == null) {
      if (k - j >= 0 && raw[k - j] != null) points[k] = raw[k - j]
      else if (k + j < n && raw[k + j] != null) points[k] = raw[k + j]
      j++
    }
  }

  let ascent = 0, descent = 0, elevMin = Infinity, elevMax = -Infinity
  for (let k = 0; k < n; k++) {
    if (points[k] < elevMin) elevMin = points[k]
    if (points[k] > elevMax) elevMax = points[k]
    if (k) {
      const dm = toMetres(points[k]) - toMetres(points[k - 1])
      if (dm > 0) ascent += dm; else descent -= dm
    }
  }
  return { points, elevMin, elevMax, distanceM: total, ascent, descent, off: off / n }
}

/** Round distances for the chart's x axis: 0, 2, 4 … km, five or so ticks. */
export function distanceTicks(totalM) {
  if (!(totalM > 0)) return []
  const target = totalM / 5
  const decade = 10 ** Math.floor(Math.log10(target))
  const step = [1, 2, 5, 10].map((s) => s * decade).find((s) => s >= target) ?? decade * 10
  const out = []
  for (let d = 0; d <= totalM + 1e-6; d += step) out.push(d)
  return out
}

/** `850` → `850 m`, `12400` → `12.4 km`. */
export function formatKm(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(Math.round(m / 100) / 10).toLocaleString('en-US')} km`
}
