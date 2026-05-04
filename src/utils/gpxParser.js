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
      const lat = +el.getAttribute('lat')
      const lon = +el.getAttribute('lon')
      if (!isNaN(lat) && !isNaN(lon))
        pts.push({ lat, lon, ele: parseFloat(el.querySelector('ele')?.textContent) || null })
    })
  }

  collect('trk trkseg trkpt')
  if (pts.length === 0) collect('rte rtept')
  return pts
}
