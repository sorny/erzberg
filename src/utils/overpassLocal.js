/**
 * A local Overpass server, asked first where it holds the data.
 *
 * The public servers can take minutes. A server of one's own, holding one
 * country, answers in seconds (`scripts/overpass-austria.sh`). Two settings in
 * `.env.development.local` turn it on, so a build never carries them:
 *
 *   VITE_OVERPASS_LOCAL       its interpreter URL
 *   VITE_OVERPASS_LOCAL_POLY  the region it holds, as an Osmosis .poly file
 *                             under public/
 *
 * Outside its region such a server answers with no data and no error, which
 * would read as "nothing here". So it is asked only for an extent that lies
 * wholly inside the region's polygon. A bounding box is not enough: the box
 * around Austria holds Munich. With no polygon set, it is asked for every
 * extent, which is right for a server that holds the planet.
 */

const ENV = import.meta.env ?? {}
const LOCAL_URL = ENV.VITE_OVERPASS_LOCAL || null
const LOCAL_POLY = ENV.VITE_OVERPASS_LOCAL_POLY || null

/**
 * An Osmosis .poly file as rings of [lon, lat]: a name line, then sections of
 * one coordinate pair per line, each closed by END, and a final END. A section
 * whose name starts with ! is a hole.
 */
export function parsePoly(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const outer = [], holes = []
  let ring = null, hole = false
  for (const line of lines.slice(1)) {
    if (line === 'END') {
      if (!ring) break
      if (ring.length >= 3) (hole ? holes : outer).push(ring)
      ring = null
    } else if (!ring) {
      ring = []; hole = line.startsWith('!')
    } else {
      const [lon, lat] = line.split(/\s+/).map(Number)
      if (Number.isFinite(lon) && Number.isFinite(lat)) ring.push([lon, lat])
    }
  }
  return { outer, holes }
}

function inRing(ring, x, y) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function crosses(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}

/**
 * Whether the box [west, south, east, north] lies wholly inside the region:
 * its corners are inside an outer ring and outside every hole, and no ring's
 * edge crosses its sides. A hole wholly inside the box crosses no side, so
 * the holes' own points are checked too.
 */
export function bboxInside(poly, [w, s, e, n]) {
  const corners = [[w, s], [e, s], [e, n], [w, n]]
  const inRegion = ([x, y]) => poly.outer.some((r) => inRing(r, x, y)) && !poly.holes.some((r) => inRing(r, x, y))
  if (!corners.every(inRegion)) return false
  for (const ring of [...poly.outer, ...poly.holes]) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      for (let k = 0; k < 4; k++) if (crosses(ring[j], ring[i], corners[k], corners[(k + 1) % 4])) return false
    }
  }
  for (const ring of poly.holes) {
    if (ring.some(([x, y]) => x > w && x < e && y > s && y < n)) return false
  }
  return true
}

let polyPromise = null

/** The local server's URL if it holds this extent, else null. */
export async function localEndpointFor(bboxWgs84) {
  if (!LOCAL_URL || !bboxWgs84) return null
  if (!LOCAL_POLY) return LOCAL_URL
  polyPromise ??= fetch(`${ENV.BASE_URL ?? '/'}${LOCAL_POLY.replace(/^\//, '')}`)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
    .then(parsePoly)
    .catch((err) => {
      console.warn(`Local Overpass: could not read ${LOCAL_POLY} (${err.message}). Using the public servers.`)
      return null
    })
  const poly = await polyPromise
  return poly && bboxInside(poly, bboxWgs84) ? LOCAL_URL : null
}
