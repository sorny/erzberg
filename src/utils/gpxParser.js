/**
 * Minimal GPX parser — no external dependencies, uses the browser's DOMParser.
 *
 * Priority: track points (<trk><trkseg><trkpt>) are collected first. If the file
 * contains no track points, route points (<rte><rtept>) are used as a fallback.
 * Waypoints (<wpt>) are not collected (they are unordered; a track is expected).
 *
 * Returns Array<{ lat: number, lon: number, ele: number | null }>.
 */
export function parseGpx(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Invalid GPX file.')

  const pts = []
  const collect = (selector) => {
    doc.querySelectorAll(selector).forEach(el => {
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
      // Sea level is data, and a coastal track starts there. Nothing consumes
      // `ele` yet, which is the reason to get it right now rather than later.
      const ele = parseFloat(el.querySelector('ele')?.textContent)
      pts.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null })
    })
  }

  collect('trk trkseg trkpt')
  if (pts.length === 0) collect('rte rtept')
  return pts
}
