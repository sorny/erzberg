/**
 * Geographic coordinate helpers shared between the geometry worker (GPX viewport
 * layer) and the STL exporter (GPX ribbon solid).
 *
 * Supported CRS for GeoTIFF bounding boxes:
 *   EPSG:4326  — WGS84 geographic (lon/lat). Default assumption when geokeys are absent.
 *   EPSG:3857  — Web Mercator. GPX lon/lat is converted to Mercator before bbox lookup.
 *   EPSG:326xx — UTM North zones 1–60 (standard WGS84 Transverse Mercator formulas).
 *   EPSG:327xx — UTM South zones 1–60.
 *   EPSG:projected-unknown — Any other projected CRS whose bbox has values outside
 *                            geographic range; UTM zone is inferred from the point's
 *                            own longitude.
 */

// ── WGS84 constants ───────────────────────────────────────────────────────────
const WGS84_A  = 6378137.0           // semi-major axis (m)
const WGS84_F  = 1 / 298.257223563   // flattening
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F  // eccentricity²

// ── UTM helpers ───────────────────────────────────────────────────────────────

/**
 * Parse EPSG codes for standard UTM zones.
 * EPSG:326xx → UTM Zone xx North
 * EPSG:327xx → UTM Zone xx South
 * Returns { zone, isSouth } or null.
 */
function parseUtmEpsg(crs) {
  const mN = crs?.match(/^EPSG:326(\d{2})$/)
  if (mN) return { zone: parseInt(mN[1]), isSouth: false }
  const mS = crs?.match(/^EPSG:327(\d{2})$/)
  if (mS) return { zone: parseInt(mS[1]), isSouth: true }
  return null
}

/**
 * Standard Transverse Mercator (WGS84 ellipsoid) → UTM easting / northing.
 * Accurate to sub-meter within the zone. Handles both N and S hemispheres.
 */
function wgs84ToUtm(lat, lon, zone, isSouth) {
  const k0 = 0.9996
  const E0 = 500000
  const N0 = isSouth ? 10000000 : 0
  const lam0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180  // central meridian

  const phi  = lat * Math.PI / 180
  const dlam = lon * Math.PI / 180 - lam0

  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi), tanPhi = Math.tan(phi)
  const N_r = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi)  // radius of curvature
  const T   = tanPhi * tanPhi
  const C   = (WGS84_E2 / (1 - WGS84_E2)) * cosPhi * cosPhi
  const A   = cosPhi * dlam

  // Meridional arc
  const e4 = WGS84_E2 * WGS84_E2, e6 = e4 * WGS84_E2
  const ep2 = WGS84_E2 / (1 - WGS84_E2)
  const M = WGS84_A * (
    (1 - WGS84_E2/4 - 3*e4/64 - 5*e6/256)      * phi
    - (3*WGS84_E2/8 + 3*e4/32 + 45*e6/1024)     * Math.sin(2*phi)
    + (15*e4/256 + 45*e6/1024)                   * Math.sin(4*phi)
    - (35*e6/3072)                               * Math.sin(6*phi)
  )

  const easting  = k0 * N_r * (A + (1-T+C)*A**3/6 + (5-18*T+T*T+72*C-58*ep2)*A**5/120) + E0
  const northing = k0 * (M + N_r * tanPhi * (A**2/2 + (5-T+9*C+4*C*C)*A**4/24 + (61-58*T+T*T+600*C-330*ep2)*A**6/720)) + N0

  return [easting, northing]
}

/**
 * Infer UTM zone from a WGS84 longitude.
 * Used as a fallback when CRS code is unknown but bbox is clearly projected.
 */
function inferUtmZone(lon, lat) {
  return { zone: Math.floor((lon + 180) / 6) + 1, isSouth: lat < 0 }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert WGS84 (lat, lon) → pixel space → world space using the GeoTIFF extent.
 * Returns { pixelCol, pixelRow, worldX, worldZ } or null if outside the extent.
 *
 * Supported CRS: EPSG:4326 (geographic), EPSG:3857 (Web Mercator),
 *                EPSG:326xx / EPSG:327xx (UTM zones),
 *                EPSG:projected-unknown (UTM zone inferred from lon).
 */
export function geoToWorld(lat, lon, geoTiffBbox, geoTiffCRS,
                           imageWidth, imageHeight, peakOff, lineOff, halfW, halfH) {
  const [minX, minY, maxX, maxY] = geoTiffBbox

  let bx, by
  if (geoTiffCRS === 'EPSG:3857') {
    bx = lon * 20037508.34 / 180
    by = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180
  } else {
    const utmInfo = parseUtmEpsg(geoTiffCRS)
    if (utmInfo) {
      ;[bx, by] = wgs84ToUtm(lat, lon, utmInfo.zone, utmInfo.isSouth)
    } else if (geoTiffCRS === 'EPSG:projected-unknown') {
      const inf = inferUtmZone(lon, lat)
      ;[bx, by] = wgs84ToUtm(lat, lon, inf.zone, inf.isSouth)
    } else {
      // EPSG:4326 or any geographic CRS: bbox is in lon/lat
      bx = lon; by = lat
    }
  }

  const pixelCol = (bx - minX) / (maxX - minX) * imageWidth
  const pixelRow = (maxY - by) / (maxY - minY) * imageHeight  // Y-flip: row 0 = top

  if (pixelCol < 0 || pixelCol >= imageWidth || pixelRow < 0 || pixelRow >= imageHeight)
    return null

  return {
    pixelCol,
    pixelRow,
    worldX: (pixelCol - peakOff) - halfW,
    worldZ: (pixelRow - lineOff) - halfH,
  }
}

/**
 * Bilinear terrain elevation sample at a given pixel position.
 * Returns world-space Y (elevation).
 */
export function sampleTerrainElev(pixelCol, pixelRow, terrain, scl, peakOff, lineOff) {
  const { grid, rows, cols, elevScale } = terrain
  const fc = (pixelCol - peakOff) / scl
  const fr = (pixelRow - lineOff) / scl
  const c0 = Math.max(0, Math.min(cols - 2, Math.floor(fc)))
  const r0 = Math.max(0, Math.min(rows - 2, Math.floor(fr)))
  const c1 = c0 + 1, r1 = r0 + 1
  const dc = fc - c0, dr = fr - r0
  const b = grid[r0 * cols + c0] * (1 - dr) * (1 - dc)
           + grid[r0 * cols + c1] * (1 - dr) * dc
           + grid[r1 * cols + c0] * dr       * (1 - dc)
           + grid[r1 * cols + c1] * dr       * dc
  return (b - 0.5) * 100 * elevScale
}
