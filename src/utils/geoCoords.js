/**
 * Geographic coordinate helpers shared between the geometry worker (vector
 * layers), the STL exporter (track ribbon solids), the OpenStreetMap query and
 * the sidebar readouts.
 *
 * GPX and GeoJSON have no projection to declare: both formats define their
 * coordinates as WGS84 lon/lat, full stop. All the variety lives on the GeoTIFF
 * side, so "matching the two projections" means one thing — projecting WGS84
 * forward into whatever grid the raster's bounding box is stated in.
 * `classifyCRS` decides whether that forward step is one this file can actually
 * make.
 *
 * Asking OpenStreetMap what is inside the raster needs the *inverse* step as
 * well, because Overpass only speaks WGS84: the extent has to be handed back out
 * of the raster's grid before it can be a query. That direction is strictly
 * narrower — see `isInvertible` — since a guessed forward projection has nothing
 * to guess from on the way back.
 *
 * That verdict has to be explicit rather than implied, because the failure is
 * otherwise invisible: feeding degrees into a bbox measured in metres puts every
 * point outside the extent, and points outside the extent are silently dropped
 * as ordinary clipping. A track that is simply *absent* looks the same as a
 * track that missed the tile.
 *
 * Transformable CRS:
 *   Geographic (lon/lat)  — used directly. WGS84, ETRS89, NAD83, GDA94/2020 and
 *                           friends are within a metre or two of each other, so
 *                           no datum shift is applied; older datums (NAD27,
 *                           ED50, MGI, …) are flagged `accuracy: 'approx'`
 *                           because ignoring their shift costs 100–400 m.
 *   Web Mercator          — EPSG:3857 and its aliases.
 *   UTM                   — the WGS84 (326xx/327xx), ETRS89 (258xx), NAD83
 *                           (269xx) and NAD27 (267xx) zone blocks, via the
 *                           standard Transverse Mercator series below.
 *   projected-unknown     — projected, but the file did not record which grid.
 *                           The zone is guessed from the point's own longitude,
 *                           which is right for a UTM tile and wrong for anything
 *                           else; flagged `accuracy: 'guess'`.
 *
 * Everything else — national grids such as Austria Lambert (31287), Swiss LV95
 * (2056) or OSGB (27700) — is reported unsupported rather than approximated.
 * Reprojecting those needs Lambert/Gauss-Krüger maths plus a datum shift, and a
 * silently wrong overlay is worse than a message saying to run the raster
 * through `gdalwarp -t_srs EPSG:4326` first.
 */

import { sampleBilinear } from './terrain'

// ── CRS classification ────────────────────────────────────────────────────────

// Geographic CRS whose datum sits close enough to WGS84 (≲2 m) that GPX
// coordinates can be used unshifted.
const GEOGRAPHIC_EXACT = new Map([
  [4326, 'WGS 84'],
  [4979, 'WGS 84 (3D)'],
  [4327, 'WGS 84 (3D)'],
  [4258, 'ETRS89'],
  [4269, 'NAD83'],
  [4152, 'NAD83(HARN)'],
  [6318, 'NAD83(2011)'],
  [4283, 'GDA94'],
  [7844, 'GDA2020'],
])

// Geographic, but on a datum far enough from WGS84 that the unshifted overlay
// is off by a visible amount. Still usable — just honest about it.
const GEOGRAPHIC_APPROX = new Map([
  [4267, 'NAD27'],
  [4230, 'ED50'],
  [4312, 'MGI'],
  [4314, 'DHDN'],
  [4265, 'Monte Mario'],
  [4149, 'CH1903'],
])

const MERCATOR = new Map([
  [3857, 'WGS 84 / Pseudo-Mercator'],
  [3785, 'WGS 84 / Pseudo-Mercator'],
  [900913, 'Google Mercator'],
  [102100, 'WGS 84 / Pseudo-Mercator'],
  [102113, 'WGS 84 / Pseudo-Mercator'],
])

// EPSG allocates UTM zones in contiguous blocks, code = base + zone, so one
// range test per family covers every zone in it.
const UTM_FAMILIES = [
  { base: 32600, lo: 1,  hi: 60, south: false, datum: 'WGS 84', accuracy: 'exact'  },
  { base: 32700, lo: 1,  hi: 60, south: true,  datum: 'WGS 84', accuracy: 'exact'  },
  { base: 25800, lo: 28, hi: 38, south: false, datum: 'ETRS89', accuracy: 'exact'  },
  { base: 26900, lo: 1,  hi: 23, south: false, datum: 'NAD83',  accuracy: 'exact'  },
  { base: 26700, lo: 3,  hi: 22, south: false, datum: 'NAD27',  accuracy: 'approx' },
]

// Named purely so the sidebar can say what a rejected file actually is, which is
// the difference between "unsupported" and "unsupported, and here is the fix".
const KNOWN_UNSUPPORTED = new Map([
  [31287, 'MGI / Austria Lambert'],
  [31254, 'MGI / Austria GK West'],
  [31255, 'MGI / Austria GK Central'],
  [31256, 'MGI / Austria GK East'],
  [31257, 'MGI / Austria GK M28'],
  [31258, 'MGI / Austria GK M31'],
  [31259, 'MGI / Austria GK M34'],
  [3416,  'ETRS89 / Austria Lambert'],
  [3035,  'ETRS89 / LAEA Europe'],
  [3034,  'ETRS89 / LCC Europe'],
  [2056,  'CH1903+ / LV95'],
  [21781, 'CH1903 / LV03'],
  [27700, 'OSGB36 / British National Grid'],
  [2154,  'RGF93 / Lambert-93'],
  [3395,  'WGS 84 / World Mercator'],
  [5514,  'S-JTSK / Krovak East North'],
])

/**
 * What can be done with a GeoTIFF's CRS string.
 *
 * Accepts the codes the loader emits: `EPSG:<n>`, plus the three sentinels
 * `EPSG:projected-unknown`, `EPSG:geographic-unknown` and `EPSG:none`.
 *
 * Returns { kind, code, zone, isSouth, supported, accuracy, name }, where
 * `kind` is 'geographic' | 'mercator' | 'utm' | 'projected' | 'none' and
 * `accuracy` is 'exact' | 'approx' | 'guess' | null.
 */
export function classifyCRS(crs) {
  const none = { kind: 'none', code: null, zone: null, isSouth: false, supported: false, accuracy: null, name: null }
  if (!crs) return none
  if (crs === 'EPSG:none') return none
  if (crs === 'EPSG:projected-unknown')
    return { ...none, kind: 'projected', supported: true, accuracy: 'guess', name: 'Projected grid, code not recorded' }
  if (crs === 'EPSG:geographic-unknown')
    return { ...none, kind: 'geographic', supported: true, accuracy: 'approx', name: 'Geographic, code not recorded' }

  const m = /^EPSG:(\d+)$/.exec(crs)
  if (!m) return none
  const code = +m[1]

  if (GEOGRAPHIC_EXACT.has(code))
    return { ...none, kind: 'geographic', code, supported: true, accuracy: 'exact', name: GEOGRAPHIC_EXACT.get(code) }
  if (GEOGRAPHIC_APPROX.has(code))
    return { ...none, kind: 'geographic', code, supported: true, accuracy: 'approx', name: GEOGRAPHIC_APPROX.get(code) }
  if (MERCATOR.has(code))
    return { ...none, kind: 'mercator', code, supported: true, accuracy: 'exact', name: MERCATOR.get(code) }

  for (const f of UTM_FAMILIES) {
    const zone = code - f.base
    if (zone < f.lo || zone > f.hi) continue
    return {
      ...none, kind: 'utm', code, zone, isSouth: f.south, supported: true, accuracy: f.accuracy,
      name: `${f.datum} / UTM zone ${zone}${f.south ? 'S' : 'N'}`,
    }
  }

  // EPSG keeps geographic CRS in the 4xxx block. One outside the tables above is
  // still lon/lat and still usable — only its datum shift is unknown.
  if (code >= 4000 && code <= 4999)
    return { ...none, kind: 'geographic', code, supported: true, accuracy: 'approx', name: null }

  return { ...none, kind: 'projected', code, supported: false, accuracy: null, name: KNOWN_UNSUPPORTED.get(code) ?? null }
}

/** One-line CRS description for the sidebar. `fileName` is the file's own citation. */
export function crsDisplayName(crs, fileName = null) {
  const c = classifyCRS(crs)
  if (c.kind === 'none') return 'Not georeferenced'
  const label = fileName || c.name
  if (!c.code) return label ?? 'Unknown'
  return label ? `${label} (EPSG:${c.code})` : `EPSG:${c.code}`
}

/**
 * Metres per degree of longitude at the raster's own latitude.
 *
 * 111 320 is the equatorial figure, and meridians converge: at 47°N a degree of
 * longitude is only ~75 km. The cosine is floored because a raster reaching the
 * poles would otherwise drive the ground pixel to zero.
 */
export function metresPerLonDegree(bbox) {
  const midLat = bbox ? (bbox[1] + bbox[3]) / 2 : 0
  return 111_320 * Math.max(0.05, Math.cos(midLat * Math.PI / 180))
}

/**
 * Mean metres per degree of latitude.
 *
 * Unlike its longitude counterpart this is very nearly a constant — 110 574 at
 * the equator to 111 694 at the pole, 1% end to end — so one figure is ample for
 * deciding what shape a pixel is.
 */
const METRES_PER_LAT_DEGREE = 110_574

/**
 * Ground size of one pixel, in metres, as `{ x, y }` — east–west, north–south.
 *
 * These are the same number less often than one would hope, and the gap is not
 * small. A geographic raster's square *degree* pixel is not square on the
 * *ground*: at 47°N a degree of longitude is 75 km against a degree of
 * latitude's 111, so `gdalwarp -t_srs EPSG:4326 -tr 0.0005 0.0005` yields a cell
 * 55 m tall and 37 m wide. Projected grids are usually square but are not
 * required to be — `-tr 30 20` is legal.
 *
 * Web Mercator's ground distances are inflated by 1/cos(lat), but inflated
 * *equally* in both axes, so its cell stays square and the un-corrected figures
 * below carry the right ratio. Only the ratio is load-bearing.
 *
 * Returns null when the raster declares nothing to measure against.
 */
export function groundPixelSize(resX, resY, crs, bbox, metresPerUnit = 1) {
  const ax = Math.abs(resX), ay = Math.abs(resY)
  if (!(ax > 0) || !(ay > 0)) return null
  const kind = classifyCRS(crs).kind
  if (kind === 'none') return null
  if (kind === 'geographic')
    return { x: ax * metresPerLonDegree(bbox), y: ay * METRES_PER_LAT_DEGREE }
  return { x: ax * metresPerUnit, y: ay * metresPerUnit }
}

/**
 * The raster shape that would make one pixel square on the ground.
 *
 * The mesh lays one world unit per pixel on both axes — `c·scl − halfW` and
 * `r·scl − halfH`, one `scl` — and the surface normals that hillshade reads are
 * built from that same grid. So a cell that is 55 m one way and 37 m the other
 * is not a subtle inaccuracy: it stretches the terrain by half its width and
 * tilts every north–south slope. Correcting it at the raster is what keeps the
 * one-unit-per-pixel assumption true everywhere downstream, rather than
 * threading a second step through every builder, exporter and normal.
 *
 * The *finer* axis is the one that shrinks. Squaring up by stretching the
 * coarser axis instead would preserve every sample, at the price of inventing
 * detail along one of them and paying up to 1/cos(lat) more memory for it — 1.5×
 * in the Alps, 3× at 70°N. Nothing isotropic downstream could use resolution the
 * other axis does not have anyway, so the honest move is to meet at the coarser
 * figure.
 *
 * Returns null when the pixel is already square, when the shape cannot be known,
 * or when the correction would collapse an axis below `minPx`.
 */
export function squareGroundShape(width, height, ground, minPx = 2, tolerance = 0.01) {
  if (!ground || !(width > 0) || !(height > 0)) return null
  const { x, y } = ground
  if (!(x > 0) || !(y > 0)) return null
  if (Math.abs(y / x - 1) <= tolerance) return null

  const newWidth  = x < y ? Math.max(minPx, Math.round(width * (x / y))) : width
  const newHeight = y < x ? Math.max(minPx, Math.round(height * (y / x))) : height
  if (newWidth === width && newHeight === height) return null
  return { width: newWidth, height: newHeight }
}

export const ELEV_SCALE_MIN = 0.1
export const ELEV_SCALE_MAX = 50

/**
 * Vertical exaggeration that renders a raster at roughly true proportions.
 *
 * The mesh lays one grid step per pixel *column* and spans `100 × elevScale`
 * world units vertically, so the figure that has to be right is the east–west
 * ground size of one pixel — that alone fixes the ratio between horizontal and
 * vertical world units.
 *
 * Which makes the latitude term load-bearing rather than a refinement. Reading a
 * geographic raster's degrees with the equatorial 111 320 overstates that ground
 * size by 1/cos(lat) — 1.48× in the Alps — and understates the exaggeration by
 * the same factor. Symptom: `gdalwarp -t_srs EPSG:4326` of a projected DEM came
 * back visibly flatter than the original it was made from, same terrain and same
 * elevation range, because its ground pixel had silently grown by half.
 *
 * `metresPerUnit` converts a projected CRS's linear unit; degrees never reach it.
 * Returns null when there is nothing real to scale against.
 */
export function suggestElevScale(elevRange, pixelSize, crs, bbox, metresPerUnit = 1) {
  if (!(pixelSize > 0) || !(elevRange > 0)) return null
  const kind = classifyCRS(crs).kind
  if (kind === 'none') return null

  const groundPx = kind === 'geographic'
    ? pixelSize * metresPerLonDegree(bbox)
    : pixelSize * metresPerUnit
  if (!(groundPx > 0)) return null

  const scale = elevRange / (groundPx * 100)
  return Math.max(ELEV_SCALE_MIN, Math.min(ELEV_SCALE_MAX, +scale.toFixed(2)))
}

/**
 * WHAT ONE WORLD ELEVATION UNIT IS WORTH ON THE GROUND.
 *
 * The renderer knows nothing about metres. A GeoTIFF's elevations are
 * normalised to 0…1 on load, the histogram's Shadows/Highlights then clip and
 * restretch that, and the mesh finally lays the result across `100 · elevScale`
 * world units centred on zero. Three linear maps, and every one of them has a
 * slider on it — which is why anything that wants to *say* metres has to ask
 * here rather than assume the range it remembers.
 *
 * Returns null when the raster has no elevations of its own (a PNG heightmap),
 * because there is no honest answer then, and the caller must say so rather
 * than print a number.
 */
export function metresPerWorldUnit(elevMin, elevMax, elevScale, blackPoint = 0, whitePoint = 255) {
  if (elevMin == null || elevMax == null) return null
  // Signed scale, unsigned answer: a negative exaggeration turns the terrain
  // upside down, and the distance between two contours is a distance either way.
  const scale = Math.abs(elevScale ?? 0)
  if (!(scale > 0) || !(elevMax > elevMin)) return null
  const span = Math.max(1e-6, (whitePoint - blackPoint) / 255)
  return ((elevMax - elevMin) * span) / (100 * scale)
}

/**
 * What a grid brightness — 0…1 *after* the histogram — reads as on the raster.
 *
 * The inverse of the clip-and-restretch: brightness 0 is the Shadows handle, not
 * the file's lowest elevation, so a raised handle moves what the whole ladder of
 * numbers says. Everything below it is clamped flat onto that value, which is
 * what the drawing shows too.
 */
export function gridValueToMetres(v, elevMin, elevMax, blackPoint = 0, whitePoint = 255) {
  const bp = blackPoint / 255
  const span = Math.max(1e-6, whitePoint / 255 - bp)
  return elevMin + (bp + v * span) * (elevMax - elevMin)
}

/** Whether WGS84 features can be placed on this raster at all. */
export function isProjectable(crs, bbox) {
  if (!bbox || bbox.length !== 4) return false
  const [minX, minY, maxX, maxY] = bbox
  if (!(isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY))) return false
  if (maxX === minX || maxY === minY) return false
  return classifyCRS(crs).supported
}

// ── WGS84 constants ───────────────────────────────────────────────────────────
const WGS84_A  = 6378137.0           // semi-major axis (m)
const WGS84_F  = 1 / 298.257223563   // flattening
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F  // eccentricity²

// ── UTM helpers ───────────────────────────────────────────────────────────────

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

  // Wrapped into ±180°, because the difference of two longitudes is not yet an
  // angular separation: a zone 1 raster has its central meridian at −177°, so a
  // track point at +179° — 4° to its west — subtracts to +356° instead of −4°.
  // The series below is a small-angle expansion and A⁵ of 6.2 rad is not small:
  // the easting came out at −9.7e8, the point fell outside the raster, and it was
  // dropped as out-of-bounds. Silent point loss is the exact failure the callers
  // return null to avoid. A no-op for every zone that does not meet the dateline.
  let dlam = lon * Math.PI / 180 - lam0
  if (dlam >  Math.PI) dlam -= 2 * Math.PI
  if (dlam < -Math.PI) dlam += 2 * Math.PI

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
 * Standard Transverse Mercator (WGS84 ellipsoid) → WGS84 lat / lon.
 *
 * The exact inverse of `wgs84ToUtm` above, by the same Snyder series: the
 * meridional arc is inverted through the footpoint latitude `phi1` — the
 * latitude whose arc from the equator equals the point's own northing — and the
 * remaining terms are expansions around it.
 */
function utmToWgs84(easting, northing, zone, isSouth) {
  const k0 = 0.9996
  const E0 = 500000
  const N0 = isSouth ? 10000000 : 0
  const lam0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180

  const e4 = WGS84_E2 * WGS84_E2, e6 = e4 * WGS84_E2
  const ep2 = WGS84_E2 / (1 - WGS84_E2)

  const M = (northing - N0) / k0
  const mu = M / (WGS84_A * (1 - WGS84_E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256))

  // Third flattening, the expansion parameter of the footpoint series.
  const e1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2))
  const e1_2 = e1 * e1, e1_3 = e1_2 * e1, e1_4 = e1_3 * e1
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1_3 / 32) * Math.sin(2 * mu)
    + (21 * e1_2 / 16 - 55 * e1_4 / 32) * Math.sin(4 * mu)
    + (151 * e1_3 / 96) * Math.sin(6 * mu)
    + (1097 * e1_4 / 512) * Math.sin(8 * mu)

  const sinPhi1 = Math.sin(phi1), cosPhi1 = Math.cos(phi1), tanPhi1 = Math.tan(phi1)
  const C1 = ep2 * cosPhi1 * cosPhi1
  const T1 = tanPhi1 * tanPhi1
  const s = 1 - WGS84_E2 * sinPhi1 * sinPhi1
  const N1 = WGS84_A / Math.sqrt(s)
  const R1 = WGS84_A * (1 - WGS84_E2) / (s * Math.sqrt(s))
  const D = (easting - E0) / (N1 * k0)

  const lat = phi1 - (N1 * tanPhi1 / R1) * (
    D ** 2 / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720
  )
  const lon = lam0 + (
    D
    - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120
  ) / cosPhi1

  return [lat * 180 / Math.PI, lon * 180 / Math.PI]
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
 * Project WGS84 (lat, lon) forward into the raster's own CRS.
 * Returns [x, y] in that CRS's units, or null if the CRS is not transformable.
 *
 * Returning null is the load-bearing part: the previous version fell through to
 * treating lon/lat as if they were already grid coordinates, which is how an
 * unsupported CRS turned into an empty overlay instead of an error.
 */
export function projectWgs84(lat, lon, crs) {
  const c = classifyCRS(crs)
  if (!c.supported) return null

  switch (c.kind) {
    case 'geographic':
      return [lon, lat]
    case 'mercator':
      return [
        lon * 20037508.34 / 180,
        Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180,
      ]
    case 'utm':
      return wgs84ToUtm(lat, lon, c.zone, c.isSouth)
    case 'projected': {
      // 'projected-unknown' only — a coded projected CRS that got here is
      // unsupported and was rejected above.
      const inf = inferUtmZone(lon, lat)
      return wgs84ToUtm(lat, lon, inf.zone, inf.isSouth)
    }
    default:
      return null
  }
}

/**
 * Whether the raster's CRS can be projected *out of*, not just into.
 *
 * Strictly narrower than `classifyCRS(crs).supported`, and the difference is
 * entirely 'projected-unknown': the forward path guesses its UTM zone from the
 * point's own longitude, and a coordinate already in that grid has no longitude
 * to guess from. Going forward a wrong guess is at least self-consistent for a
 * real UTM tile; coming back it would place the extent in the wrong hemisphere
 * with no way to notice. So the OSM query is refused for those rasters instead —
 * uploads still work, since they only need the forward step.
 */
export function isInvertible(crs) {
  const kind = classifyCRS(crs).kind
  return classifyCRS(crs).supported && (kind === 'geographic' || kind === 'mercator' || kind === 'utm')
}

/**
 * Project (x, y) in the raster's own CRS back out to WGS84.
 * Returns [lat, lon], or null when the CRS cannot be inverted.
 */
export function unprojectWgs84(x, y, crs) {
  const c = classifyCRS(crs)
  if (!isInvertible(crs)) return null

  switch (c.kind) {
    case 'geographic':
      return [y, x]
    case 'mercator': {
      const lon = x / 20037508.34 * 180
      const t = y / 20037508.34 * 180
      return [180 / Math.PI * (2 * Math.atan(Math.exp(t * Math.PI / 180)) - Math.PI / 2), lon]
    }
    case 'utm':
      return utmToWgs84(x, y, c.zone, c.isSouth)
    default:
      return null
  }
}

/**
 * The raster's extent as a WGS84 envelope — [minLon, minLat, maxLon, maxLat].
 * Returns null when the CRS cannot be inverted or the bbox is not usable.
 *
 * Nine samples rather than four corners, because a projected extent is not a
 * rectangle in WGS84: a UTM tile's edges bow away from the central meridian, and
 * at the corners of a wide tile the sag is a few hundred metres. Sampling the
 * edge midpoints and the centre too costs nothing here and stops the Overpass
 * query from clipping features that really are inside the raster.
 */
export function bboxToWgs84(bbox, crs) {
  if (!bbox || bbox.length !== 4 || !isInvertible(crs)) return null
  const [minX, minY, maxX, maxY] = bbox
  if (!(isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY))) return null

  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity

  for (const x of [minX, midX, maxX]) {
    for (const y of [minY, midY, maxY]) {
      const ll = unprojectWgs84(x, y, crs)
      if (!ll) return null
      const [lat, lon] = ll
      if (!(isFinite(lat) && isFinite(lon))) return null
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
  }
  return [minLon, minLat, maxLon, maxLat]
}

/**
 * Ground size of a WGS84 envelope, in kilometres — the figure the OSM panel
 * shows so a query's cost is visible before it is sent.
 */
export function wgs84ExtentKm(bboxWgs84) {
  if (!bboxWgs84) return null
  const [minLon, minLat, maxLon, maxLat] = bboxWgs84
  const midLat = (minLat + maxLat) / 2
  return {
    w: (maxLon - minLon) * 111.320 * Math.max(0.05, Math.cos(midLat * Math.PI / 180)),
    h: (maxLat - minLat) * 110.574,
  }
}

/**
 * WGS84 (lat, lon) → fractional pixel coordinates in the raster.
 * Returns { col, row } unclamped, or null if the CRS is not transformable.
 * Row 0 is the top of the image, hence the Y-flip.
 */
export function geoToPixel(lat, lon, geoTiffBbox, geoTiffCRS, imageWidth, imageHeight) {
  if (!geoTiffBbox) return null
  const xy = projectWgs84(lat, lon, geoTiffCRS)
  if (!xy) return null

  const [minX, minY, maxX, maxY] = geoTiffBbox
  return {
    col: (xy[0] - minX) / (maxX - minX) * imageWidth,
    row: (maxY - xy[1]) / (maxY - minY) * imageHeight,
  }
}

/**
 * Convert WGS84 (lat, lon) → pixel space → world space using the GeoTIFF extent.
 * Returns { pixelCol, pixelRow, worldX, worldZ }, or null if the CRS cannot be
 * transformed or the point falls outside the extent.
 */
export function geoToWorld(lat, lon, geoTiffBbox, geoTiffCRS,
                           imageWidth, imageHeight, peakOff, lineOff, halfW, halfH) {
  const px = geoToPixel(lat, lon, geoTiffBbox, geoTiffCRS, imageWidth, imageHeight)
  if (!px) return null

  const { col: pixelCol, row: pixelRow } = px
  if (!(pixelCol >= 0 && pixelCol < imageWidth && pixelRow >= 0 && pixelRow < imageHeight))
    return null

  return {
    pixelCol,
    pixelRow,
    worldX: (pixelCol - peakOff) - halfW,
    worldZ: (pixelRow - lineOff) - halfH,
  }
}

/**
 * How much of a vector source actually lands on the raster — the check that
 * turns a mismatch into a message instead of an empty overlay.
 *
 * Two different failures share the "nothing appears" symptom and need different
 * advice, so they are reported separately: 'unsupported' means the projection
 * cannot be computed at all, 'outside' means it was computed fine and the
 * features are simply somewhere else on Earth.
 *
 * `rings` is the flat coordinate form every source normalises to — an array of
 * Float64Arrays holding [lon, lat, lon, lat, …]. Counting vertices rather than
 * features is deliberate: a single OSM way that half-crosses the tile edge is
 * exactly the 'partial' case this exists to name.
 *
 * Returns { status, inside, total }, status one of
 * 'ok' | 'partial' | 'outside' | 'unsupported' | 'none' | 'empty'.
 */
export function featureCoverage(rings, geoTiffBbox, geoTiffCRS, imageWidth, imageHeight) {
  let total = 0
  for (const r of rings ?? []) total += r.length >> 1
  const base = { inside: 0, total }
  if (!total) return { ...base, status: 'empty' }
  if (classifyCRS(geoTiffCRS).kind === 'none') return { ...base, status: 'none' }
  if (!isProjectable(geoTiffCRS, geoTiffBbox)) return { ...base, status: 'unsupported' }

  let inside = 0
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) {
      const px = geoToPixel(r[i + 1], r[i], geoTiffBbox, geoTiffCRS, imageWidth, imageHeight)
      if (px && px.col >= 0 && px.col < imageWidth && px.row >= 0 && px.row < imageHeight) inside++
    }
  }

  return { inside, total, status: inside === 0 ? 'outside' : inside < total ? 'partial' : 'ok' }
}

/**
 * Bilinear terrain elevation sample at a given pixel position.
 * Returns world-space Y (elevation), or NaN over NoData.
 *
 * Masked, so a track crossing the edge of a clipped raster follows the ground
 * it has instead of being dragged toward the base of the scene by the zeros
 * stored in NoData cells.
 */
export function sampleTerrainElev(pixelCol, pixelRow, terrain, scl, peakOff, lineOff) {
  const { grid, gridMask, rows, cols, elevScale } = terrain
  const fc = (pixelCol - peakOff) / scl
  const fr = (pixelRow - lineOff) / scl
  const b = sampleBilinear(grid, gridMask, rows, cols,
                           Math.max(0, Math.min(rows - 1, fr)),
                           Math.max(0, Math.min(cols - 1, fc)))
  return (b - 0.5) * 100 * elevScale
}
