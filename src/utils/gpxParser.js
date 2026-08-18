/**
 * Minimal GPX parser — no external dependencies, uses the browser's DOMParser.
 *
 * Priority: track points (<trk><trkseg><trkpt>) are collected first. If the file
 * contains no track points, route points (<rte><rtept>) are used as a fallback.
 * Waypoints (<wpt>) are not collected (they are unordered; a track is expected).
 *
 * Segments are kept apart. A <trkseg> boundary is the recording pausing — a lift
 * ride, a lost fix, a stop — and joining two of them draws a straight line across
 * whatever lies between, which on a mountain is a line through the mountain.
 */

import { makeSource, nextFallbackColor, packFeatures } from './vectorLayers'

/**
 * Track segments as `{ points: Array<{ lat, lon, ele }>, name }`.
 * Route points, when used, come back as a single segment.
 */
export function parseGpxSegments(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Invalid GPX file.')

  // `<trk><name>` is what a route planner writes and what the walker recognises,
  // so it is worth more as a feature label than the file name is.
  const trackNames = [...doc.querySelectorAll('trk')].map(
    (t) => t.querySelector(':scope > name')?.textContent?.trim() || null)

  const readPoints = (parent, selector) => {
    const pts = []
    parent.querySelectorAll(selector).forEach(el => {
      // The attributes have to be *present*, not merely numeric. getAttribute
      // returns null when one is missing and +null is 0, so testing the number
      // alone accepted a malformed <trkpt> as a point at (0, 0) — which is not a
      // sentinel but a real place in the Gulf of Guinea. It counted against the
      // track's coverage report, making a track that landed perfectly well read
      // back as only 'partial'.
      const latAttr = el.getAttribute('lat'), lonAttr = el.getAttribute('lon')
      if (latAttr === null || lonAttr === null) return
      const lat = +latAttr, lon = +lonAttr
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return

      // `parseFloat(…) || null` read a genuine 0 m as "no elevation recorded".
      // Sea level is data, and a coastal track starts there.
      const ele = parseFloat(el.querySelector('ele')?.textContent)
      pts.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null })
    })
    return pts
  }

  const segs = []
  ;[...doc.querySelectorAll('trk')].forEach((trk, ti) => {
    const trkSegs = [...trk.querySelectorAll('trkseg')]
    trkSegs.forEach((seg, si) => {
      const pts = readPoints(seg, 'trkpt')
      // A multi-segment track needs its parts told apart; a single-segment one
      // would only be made worse by a "(segment 1)" nobody asked for.
      if (pts.length) segs.push({
        points: pts,
        name: trkSegs.length > 1 && trackNames[ti]
          ? `${trackNames[ti]} (segment ${si + 1})`
          : trackNames[ti],
      })
    })
  })
  if (segs.length) return segs

  const route = readPoints(doc, 'rte rtept')
  const routeName = doc.querySelector('rte > name')?.textContent?.trim() || null
  return route.length ? [{ points: route, name: routeName }] : []
}

/**
 * Every track point in the file, segment boundaries flattened away.
 * Returns Array<{ lat: number, lon: number, ele: number | null }>.
 */
export function parseGpx(xmlText) {
  return parseGpxSegments(xmlText).flatMap((s) => s.points)
}

/** A GPX file as a vector source — one bucket, one feature per segment. */
export function gpxToSource(xmlText, label) {
  const segs = parseGpxSegments(xmlText)
  if (!segs.length) throw new Error('No track or route points found in this GPX file.')

  const features = segs.map((seg, i) => {
    const pts = seg.points
    const ring = new Float64Array(pts.length * 2)
    for (let j = 0; j < pts.length; j++) {
      ring[j * 2] = pts[j].lon
      ring[j * 2 + 1] = pts[j].lat
    }
    return {
      bucket: 'track', geom: 'line', rings: [ring],
      name: seg.name || (segs.length > 1 ? `${label} (segment ${i + 1})` : label),
    }
  })

  return makeSource({
    kind: 'gpx',
    label,
    buckets: packFeatures(features, {
      track: { label, geom: 'line', style: { color: nextFallbackColor(), weight: 2 } },
    }, ['track']),
  })
}
