import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import {
  bboxToWgs84, classifyCRS, crsDisplayName, featureCoverage, geoToPixel, isInvertible,
  isProjectable, metresPerLonDegree, projectWgs84, suggestElevScale, unprojectWgs84,
  wgs84ExtentKm,
} from '../src/utils/geoCoords.js'

/**
 * GeoTIFF CRS handling, which nothing covered before.
 *
 * The bug that prompted these: `geoToWorld` transformed WGS84 into Web Mercator
 * and the WGS84 UTM blocks, then *fell through* for every other projected CRS to
 * `bx = lon; by = lat` — feeding degrees into a bounding box measured in metres.
 * Every point then landed outside the extent, and points outside the extent are
 * dropped as ordinary clipping, so the track silently vanished. EPSG:25832
 * (ETRS89 / UTM 32N), the standard for Austrian and German elevation data, hit
 * exactly this path.
 *
 * The maths cases run in the test runner rather than the browser — geoCoords.js
 * is pure arithmetic with no DOM or WebGL, so a page would only add latency. The
 * load-path cases at the bottom do need a page, because what they cover is how
 * geotiff.js hands its tags over.
 */

// A 10 km × 10 km, 1000 px raster in UTM 33N centred on the Erzberg.
const ERZBERG = { lat: 47.5333, lon: 14.8833 }
const centre = projectWgs84(ERZBERG.lat, ERZBERG.lon, 'EPSG:32633')
const BBOX = [centre[0] - 5000, centre[1] - 5000, centre[0] + 5000, centre[1] + 5000]

test.describe('CRS classification', () => {
  test('recognises the transformable families', () => {
    const kind = (c) => classifyCRS(c).kind
    expect(kind('EPSG:4326')).toBe('geographic')      // WGS84
    expect(kind('EPSG:4258')).toBe('geographic')      // ETRS89
    expect(kind('EPSG:3857')).toBe('mercator')
    expect(kind('EPSG:900913')).toBe('mercator')
    expect(kind('EPSG:32633')).toBe('utm')            // WGS84 zone 33N
    expect(kind('EPSG:32733')).toBe('utm')            // WGS84 zone 33S
    expect(kind('EPSG:25832')).toBe('utm')            // ETRS89 zone 32N
    expect(kind('EPSG:26918')).toBe('utm')            // NAD83 zone 18N
  })

  test('reads the zone and hemisphere out of each UTM block', () => {
    for (const [code, zone, isSouth] of [
      ['EPSG:32601', 1, false], ['EPSG:32660', 60, false],
      ['EPSG:32701', 1, true],  ['EPSG:32760', 60, true],
      ['EPSG:25832', 32, false], ['EPSG:26918', 18, false], ['EPSG:26718', 18, false],
    ]) {
      const c = classifyCRS(code)
      expect(c, code).toMatchObject({ kind: 'utm', zone, isSouth })
    }
  })

  test('does not mistake a neighbouring code for a UTM zone', () => {
    // 32661 is UPS North, one past zone 60. A naive `326(\d\d)` match reads it
    // as "zone 61" and projects with a central meridian off the end of the world.
    expect(classifyCRS('EPSG:32661').kind).toBe('projected')
    expect(classifyCRS('EPSG:32661').supported).toBe(false)
    expect(classifyCRS('EPSG:25827').supported).toBe(false)  // below the ETRS89 block
    expect(classifyCRS('EPSG:25839').supported).toBe(false)  // above it
  })

  test('rejects national grids instead of approximating them', () => {
    for (const code of ['EPSG:31287', 'EPSG:31255', 'EPSG:2056', 'EPSG:27700', 'EPSG:2154', 'EPSG:3035', 'EPSG:3395']) {
      const c = classifyCRS(code)
      expect(c.kind, code).toBe('projected')
      expect(c.supported, code).toBe(false)
    }
  })

  test('flags datums it does not shift for', () => {
    expect(classifyCRS('EPSG:4326').accuracy).toBe('exact')
    expect(classifyCRS('EPSG:4267').accuracy).toBe('approx')   // NAD27, ~100 m out
    expect(classifyCRS('EPSG:4312').accuracy).toBe('approx')   // MGI, ~400 m out
    expect(classifyCRS('EPSG:26718').accuracy).toBe('approx')  // NAD27 / UTM
    expect(classifyCRS('EPSG:projected-unknown').accuracy).toBe('guess')
  })

  test('handles the sentinels and junk', () => {
    expect(classifyCRS('EPSG:none').supported).toBe(false)
    expect(classifyCRS(null).kind).toBe('none')
    expect(classifyCRS('WGS84').kind).toBe('none')
    expect(classifyCRS('EPSG:projected-unknown').supported).toBe(true)
    expect(classifyCRS('EPSG:geographic-unknown').kind).toBe('geographic')
  })

  test('names a CRS for the sidebar, preferring the file’s own citation', () => {
    expect(crsDisplayName('EPSG:32633')).toBe('WGS 84 / UTM zone 33N (EPSG:32633)')
    expect(crsDisplayName('EPSG:31287')).toBe('MGI / Austria Lambert (EPSG:31287)')
    expect(crsDisplayName('EPSG:99999')).toBe('EPSG:99999')
    expect(crsDisplayName('EPSG:99999', 'Custom Grid')).toBe('Custom Grid (EPSG:99999)')
    expect(crsDisplayName('EPSG:none')).toBe('Not georeferenced')
  })
})

test.describe('forward projection', () => {
  test('UTM matches its two exactly-defined points', () => {
    // On the central meridian the easting is the false easting exactly, and at
    // the equator the northing is zero exactly. Both hold for any correct TM.
    const [e1, n1] = projectWgs84(0, 15, 'EPSG:32633')
    expect(e1).toBeCloseTo(500000, 6)
    expect(n1).toBeCloseTo(0, 6)

    const [e2] = projectWgs84(47, 15, 'EPSG:32633')
    expect(e2).toBeCloseTo(500000, 6)

    // 45°N on the central meridian is the standard published check value.
    const [, n3] = projectWgs84(45, 15, 'EPSG:32633')
    expect(n3).toBeCloseTo(4982950.4, 0)
  })

  test('the southern block applies the false northing', () => {
    const [, north] = projectWgs84(-1, 15, 'EPSG:32733')
    expect(north).toBeGreaterThan(9_800_000)   // 10 000 000 offset, minus ~110 km
  })

  test('Web Mercator matches the closed-form definition', () => {
    const R = 6378137
    const [x, y] = projectWgs84(ERZBERG.lat, ERZBERG.lon, 'EPSG:3857')
    expect(x).toBeCloseTo(R * ERZBERG.lon * Math.PI / 180, 1)
    expect(y).toBeCloseTo(R * Math.log(Math.tan(Math.PI / 4 + (ERZBERG.lat * Math.PI / 180) / 2)), 1)
  })

  test('geographic passes lon/lat through untouched', () => {
    expect(projectWgs84(ERZBERG.lat, ERZBERG.lon, 'EPSG:4326')).toEqual([ERZBERG.lon, ERZBERG.lat])
  })

  test('an untransformable CRS returns null rather than raw degrees', () => {
    // The regression this whole file exists for. Returning [lon, lat] here is
    // what made the failure silent.
    expect(projectWgs84(ERZBERG.lat, ERZBERG.lon, 'EPSG:31287')).toBeNull()
    expect(projectWgs84(ERZBERG.lat, ERZBERG.lon, 'EPSG:none')).toBeNull()
    expect(projectWgs84(ERZBERG.lat, ERZBERG.lon, null)).toBeNull()
  })

  test('ETRS89 UTM projects to metres, not degrees', () => {
    const [x, y] = projectWgs84(ERZBERG.lat, ERZBERG.lon, 'EPSG:25832')
    expect(Math.abs(x)).toBeGreaterThan(100_000)
    expect(Math.abs(y)).toBeGreaterThan(100_000)
    // Zone 32's central meridian is 9°E, so a point at 14.9°E is far east of it.
    expect(x).toBeGreaterThan(500_000)
  })

  /**
   * A zone that meets the dateline.
   *
   * Zone 1's central meridian is −177°, so a point at +179° lies 4° to its *west* —
   * but subtracting the two longitudes gives +356°, and the Transverse Mercator
   * series is a small-angle expansion in exactly that quantity. Unwrapped it
   * returned an easting of −9.7e8, which put the point outside any raster and got
   * it dropped as out-of-bounds: silent point loss, the failure the null returns
   * above exist to prevent.
   *
   * The check is an identity rather than a constant — +179° and −181° name the same
   * meridian, so they must project to the same grid coordinates.
   */
  test('a longitude across the dateline projects the same as its unwrapped twin', () => {
    const east = projectWgs84(52, 179,  'EPSG:32601')
    const west = projectWgs84(52, -181, 'EPSG:32601')
    expect(east[0]).toBeCloseTo(west[0], 6)
    expect(east[1]).toBeCloseTo(west[1], 6)
    // And it lands on the grid: west of the false easting, inside a plausible zone.
    expect(east[0]).toBeGreaterThan(0)
    expect(east[0]).toBeLessThan(500_000)
  })
})

/**
 * Reprojecting a DEM must not change how steep it looks.
 *
 * The numbers below are measured from real files, not invented: tests/testdata/
 * geotiff.tif (EPSG:32633, 10 m pixels, 1200 columns) and the output of
 * `gdalwarp -t_srs EPSG:4326` on it (0.000123769920162° pixels, 1297 columns).
 * Same terrain, same 641.36–2349.51 m elevation range, so the rendered relief
 * has to come out the same — and with the equatorial 111 320 it did not, because
 * the ground pixel was overstated by 1/cos(47.5°) = 1.48×.
 *
 * Apparent relief is `elevScale / columns`: the mesh spans one world unit per
 * pixel column horizontally and 100 × elevScale vertically.
 */
test.describe('suggested vertical exaggeration', () => {
  const RANGE = 2349.5124511719 - 641.35766601562

  // bbox is [minX, minY, maxX, maxY], derived from each file's origin, pixel
  // size and dimensions exactly as image.getBoundingBox() does.
  const UTM = {
    px: 10, cols: 1200, crs: 'EPSG:32633',
    bbox: [418999.5, 5266000.5 - 700 * 10, 418999.5 + 1200 * 10, 5266000.5],
  }
  const WGS = {
    px: 0.000123769920162, cols: 1297, crs: 'EPSG:4326',
    bbox: [
      13.923616052913024,
      47.543760509340828 - 520 * 0.000123769920162,
      13.923616052913024 + 1297 * 0.000123769920162,
      47.543760509340828,
    ],
  }

  test('survives a reprojection to EPSG:4326', () => {
    const utmRelief = suggestElevScale(RANGE, UTM.px, UTM.crs, UTM.bbox) / UTM.cols
    const wgsRelief = suggestElevScale(RANGE, WGS.px, WGS.crs, WGS.bbox) / WGS.cols

    // Within 2%. The equatorial constant put this at 0.67 — a third flatter.
    expect(wgsRelief / utmRelief).toBeGreaterThan(0.98)
    expect(wgsRelief / utmRelief).toBeLessThan(1.02)
  })

  test('a degree of longitude shrinks with latitude', () => {
    expect(metresPerLonDegree([0, 0, 0, 0])).toBeCloseTo(111320, 0)
    expect(metresPerLonDegree([0, 47, 0, 48])).toBeCloseTo(111320 * Math.cos(47.5 * Math.PI / 180), 0)
    // Floored, so a polar raster cannot drive the ground pixel to zero.
    expect(metresPerLonDegree([0, 89, 0, 90])).toBeCloseTo(111320 * 0.05, 0)
  })

  test('a projected CRS is taken at face value, in its own linear unit', () => {
    expect(suggestElevScale(1000, 10, 'EPSG:32633', UTM.bbox)).toBeCloseTo(1, 2)
    // Same raster stated in US survey feet: a foot of ground is less than a
    // metre, so the same elevation range is proportionally steeper.
    expect(suggestElevScale(1000, 10, 'EPSG:32633', UTM.bbox, 1200 / 3937)).toBeCloseTo(3.28, 1)
  })

  test('clamps, and declines when there is nothing to scale against', () => {
    expect(suggestElevScale(1e9, 1, 'EPSG:32633', UTM.bbox)).toBe(50)     // ceiling
    expect(suggestElevScale(1, 1e6, 'EPSG:32633', UTM.bbox)).toBe(0.1)    // floor
    expect(suggestElevScale(RANGE, 10, 'EPSG:none', null)).toBeNull()
    expect(suggestElevScale(0, 10, 'EPSG:32633', UTM.bbox)).toBeNull()
    expect(suggestElevScale(RANGE, 0, 'EPSG:32633', UTM.bbox)).toBeNull()
  })
})

test.describe('pixel mapping', () => {
  test('the centre of the extent is the centre pixel', () => {
    const px = geoToPixel(ERZBERG.lat, ERZBERG.lon, BBOX, 'EPSG:32633', 1000, 1000)
    expect(px.col).toBeCloseTo(500, 3)
    expect(px.row).toBeCloseTo(500, 3)
  })

  test('north is up — row 0 is the top of the image', () => {
    const north = geoToPixel(ERZBERG.lat + 0.01, ERZBERG.lon, BBOX, 'EPSG:32633', 1000, 1000)
    const east  = geoToPixel(ERZBERG.lat, ERZBERG.lon + 0.01, BBOX, 'EPSG:32633', 1000, 1000)
    expect(north.row).toBeLessThan(500)
    expect(east.col).toBeGreaterThan(500)
  })

  test('returns null when the CRS cannot be transformed', () => {
    expect(geoToPixel(ERZBERG.lat, ERZBERG.lon, BBOX, 'EPSG:31287', 1000, 1000)).toBeNull()
    expect(geoToPixel(ERZBERG.lat, ERZBERG.lon, null, 'EPSG:32633', 1000, 1000)).toBeNull()
  })
})

test.describe('feature coverage', () => {
  // The flat [lon, lat, …] ring form every vector source normalises to.
  const onTile  = [Float64Array.from([ERZBERG.lon, ERZBERG.lat, ERZBERG.lon + 0.01, ERZBERG.lat + 0.01])]
  const offTile = [Float64Array.from([0, 0, 0.01, 0.01])]

  test('distinguishes the ways features fail to appear', () => {
    const status = (rings, crs) => featureCoverage(rings, BBOX, crs, 1000, 1000).status
    expect(status(onTile, 'EPSG:32633')).toBe('ok')
    expect(status(offTile, 'EPSG:32633')).toBe('outside')       // right CRS, wrong place
    expect(status([...onTile, ...offTile], 'EPSG:32633')).toBe('partial')
    expect(status(onTile, 'EPSG:31287')).toBe('unsupported')    // cannot project at all
    expect(status(onTile, 'EPSG:none')).toBe('none')            // raster has no georeferencing
    expect(status([], 'EPSG:32633')).toBe('empty')
    expect(status([new Float64Array(0)], 'EPSG:32633')).toBe('empty')
  })

  test('counts the vertices that land on the raster', () => {
    const c = featureCoverage([...onTile, ...offTile], BBOX, 'EPSG:32633', 1000, 1000)
    expect(c).toMatchObject({ inside: 2, total: 4 })
  })
})

test.describe('inverse projection', () => {
  // A degree of latitude is ~111 km, so 1e-5° is about a metre. Overpass is
  // queried with the result, and a metre of slop there costs nothing — but a
  // kilometre would clip features off the edge of the extent.
  const METRE = 1e-5

  test('round-trips every CRS family the forward path accepts', () => {
    // Each point is inside the grid it is projected into. A UTM series is a
    // small-angle expansion around its own central meridian: 120° away it does
    // not merely lose accuracy, it returns nonsense, and testing that would be
    // testing the wrong thing.
    const cases = [
      { lat: ERZBERG.lat, lon: ERZBERG.lon, crs: 'EPSG:4326'  },
      { lat: ERZBERG.lat, lon: ERZBERG.lon, crs: 'EPSG:3857'  },
      { lat: ERZBERG.lat, lon: ERZBERG.lon, crs: 'EPSG:32633' },
      { lat: ERZBERG.lat, lon: ERZBERG.lon, crs: 'EPSG:25833' },
      { lat: 39.74, lon: -104.99, crs: 'EPSG:26913' },   // Denver, NAD83 / UTM 13N
    ]
    for (const { lat, lon, crs } of cases) {
      const [x, y] = projectWgs84(lat, lon, crs)
      const [rLat, rLon] = unprojectWgs84(x, y, crs)
      expect(rLat, crs).toBeCloseTo(lat, 5)
      expect(rLon, crs).toBeCloseTo(lon, 5)
    }
  })

  test('round-trips in the southern hemisphere and near a zone edge', () => {
    const cases = [
      { lat: -33.87, lon: 151.21, crs: 'EPSG:32756' },  // Sydney, UTM 56S
      { lat: 60.0,   lon: 11.99,  crs: 'EPSG:32632' },  // just inside zone 32's west edge
      { lat: 0.0,    lon: 15.0,   crs: 'EPSG:32633' },  // on the equator
    ]
    for (const { lat, lon, crs } of cases) {
      const [x, y] = projectWgs84(lat, lon, crs)
      const [rLat, rLon] = unprojectWgs84(x, y, crs)
      expect(Math.abs(rLat - lat), crs).toBeLessThan(METRE)
      expect(Math.abs(rLon - lon), crs).toBeLessThan(METRE)
    }
  })

  test('refuses what it cannot invert, including a CRS it can project into', () => {
    // The asymmetry that matters: forward works by guessing a zone from the
    // point's longitude, and there is no longitude to guess from coming back.
    expect(projectWgs84(ERZBERG.lat, ERZBERG.lon, 'EPSG:projected-unknown')).not.toBeNull()
    expect(isInvertible('EPSG:projected-unknown')).toBe(false)
    expect(unprojectWgs84(500000, 5265000, 'EPSG:projected-unknown')).toBeNull()

    expect(isInvertible('EPSG:31287')).toBe(false)
    expect(isInvertible('EPSG:none')).toBe(false)
    expect(isInvertible(null)).toBe(false)
    expect(isInvertible('EPSG:geographic-unknown')).toBe(true)
  })
})

test.describe('extent as a WGS84 envelope', () => {
  test('encloses the raster it came from', () => {
    const env = bboxToWgs84(BBOX, 'EPSG:32633')
    expect(env[0]).toBeLessThan(ERZBERG.lon)
    expect(env[2]).toBeGreaterThan(ERZBERG.lon)
    expect(env[1]).toBeLessThan(ERZBERG.lat)
    expect(env[3]).toBeGreaterThan(ERZBERG.lat)
    // 10 km square, so ~0.13° of longitude at 47.5°N and ~0.09° of latitude.
    expect(env[2] - env[0]).toBeCloseTo(0.133, 2)
    expect(env[3] - env[1]).toBeCloseTo(0.090, 2)
  })

  test('edge midpoints widen the envelope the corners alone would give', () => {
    // An extent straddling its own central meridian is where the corners lie:
    // a line of constant northing peaks in latitude *at* the CM, which is
    // interior to this box, so the four corners all sit below the true top edge.
    const straddle = [300000, 5200000, 700000, 5400000]   // CM of zone 33 is x = 500000
    const env = bboxToWgs84(straddle, 'EPSG:32633')
    const corners = [[straddle[0], straddle[1]], [straddle[0], straddle[3]],
                     [straddle[2], straddle[1]], [straddle[2], straddle[3]]]
      .map(([x, y]) => unprojectWgs84(x, y, 'EPSG:32633'))
    const cornerMaxLat = Math.max(...corners.map(c => c[0]))
    expect(env[3]).toBeGreaterThan(cornerMaxLat)
    expect(env[3] - cornerMaxLat).toBeGreaterThan(0.01)   // ~3.5 km of missed extent
  })

  test('returns null rather than a wrong envelope', () => {
    expect(bboxToWgs84(BBOX, 'EPSG:31287')).toBeNull()
    expect(bboxToWgs84(BBOX, 'EPSG:projected-unknown')).toBeNull()
    expect(bboxToWgs84(null, 'EPSG:32633')).toBeNull()
    expect(bboxToWgs84([0, 0, NaN, 1], 'EPSG:32633')).toBeNull()
  })

  test('reports the ground size the OSM panel shows', () => {
    const { w, h } = wgs84ExtentKm(bboxToWgs84(BBOX, 'EPSG:32633'))
    expect(w).toBeCloseTo(10, 0)
    expect(h).toBeCloseTo(10, 0)
  })
})

test.describe('projectability gate', () => {
  test('admits only what can actually be drawn', () => {
    expect(isProjectable('EPSG:32633', BBOX)).toBe(true)
    expect(isProjectable('EPSG:25832', BBOX)).toBe(true)
    // Both of these passed the old `crs?.startsWith('EPSG:')` gate.
    expect(isProjectable('EPSG:none', BBOX)).toBe(false)
    expect(isProjectable('EPSG:31287', BBOX)).toBe(false)
  })

  test('rejects a missing or degenerate extent', () => {
    expect(isProjectable('EPSG:32633', null)).toBe(false)
    expect(isProjectable('EPSG:32633', [0, 0, 0, 0])).toBe(false)
    expect(isProjectable('EPSG:32633', [0, 0, NaN, 10])).toBe(false)
  })
})

/**
 * What the GPX parser is willing to call a point.
 *
 * In the browser because parseGpx uses DOMParser, which Node does not have.
 *
 * The case worth guarding is a <trkpt> with no lat/lon: getAttribute returns null
 * for a missing attribute, +null is 0, and an isNaN test passes it — so the parser
 * invented a point at (0, 0). That is not a sentinel, it is the Gulf of Guinea,
 * and note that the coverage tests above use exactly (0, 0) as their example of a
 * track in the wrong place. A fabricated point is therefore indistinguishable from
 * a real one: it counts in `total`, never in `inside`, and turns a track that
 * landed perfectly into a 'partial' with a warning about it.
 */
test.describe('GPX parsing', () => {
  const parse = (page, xml) => page.evaluate(async (x) => {
    const { parseGpx } = await import('/src/utils/gpxParser.js')
    return parseGpx(x)
  }, xml)

  const gpx = (body) => `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${body}</trkseg></trk></gpx>`

  test.beforeEach(async ({ page }) => { await page.goto('http://localhost:5173') })

  test('drops a point that has no coordinates instead of inventing (0, 0)', async ({ page }) => {
    const pts = await parse(page, gpx(`
      <trkpt lat="47.5" lon="14.9"><ele>1200</ele></trkpt>
      <trkpt><ele>1210</ele></trkpt>
      <trkpt lat="47.6" lon="15.0"><ele>1220</ele></trkpt>
      <trkpt lat="not-a-number" lon="15.1"></trkpt>
    `))
    expect(pts.map(p => [p.lat, p.lon])).toEqual([[47.5, 14.9], [47.6, 15.0]])
  })

  test('keeps a sea-level elevation instead of reading 0 as absent', async ({ page }) => {
    // `parseFloat(…) || null` made these indistinguishable, and a coastal track
    // starts at exactly 0 m. Nothing consumes `ele` yet; this is so it stays right
    // for whatever does.
    const pts = await parse(page, gpx(`
      <trkpt lat="47.5" lon="14.9"><ele>0</ele></trkpt>
      <trkpt lat="47.6" lon="15.0"></trkpt>
    `))
    expect(pts[0].ele).toBe(0)
    expect(pts[1].ele).toBeNull()
  })

  test('falls back to route points only when there are no track points', async ({ page }) => {
    const routeOnly = '<?xml version="1.0"?><gpx version="1.1"><rte>' +
      '<rtept lat="47.5" lon="14.9"></rtept></rte></gpx>'
    expect(await parse(page, routeOnly)).toHaveLength(1)
    // A file with both prefers the track.
    const both = '<?xml version="1.0"?><gpx version="1.1">' +
      '<trk><trkseg><trkpt lat="1" lon="2"></trkpt></trkseg></trk>' +
      '<rte><rtept lat="3" lon="4"></rtept></rte></gpx>'
    expect(await parse(page, both)).toEqual([{ lat: 1, lon: 2, ele: null }])
  })
})

/**
 * The GeoTIFF load path, end to end through the real UI.
 *
 * The unit tests above cover the maths; these cover the geokey reading that
 * feeds it, which is exactly where the first cut of this work broke. Current
 * geotiff.js exposes `fileDirectory` as a lazy object whose tags are reachable
 * only via `hasTag`/`getValue` — plain property access returns `undefined`
 * without throwing, so a georeferenced file silently read as unreferenced.
 * Nothing short of loading a real GeoTIFF catches that.
 *
 * Fixture: tests/testdata/geotiff.tif — 1200×700, EPSG:32633, 10 m pixels,
 * elevation 641.36–2349.51 m (per gdalinfo). It is gitignored, so these skip
 * rather than fail on a clean checkout: a missing fixture is not a regression,
 * and a red suite that means "you have no test data" trains people to ignore
 * red. They announce themselves as skipped, which a silent pass would not.
 *
 * Any georeferenced GeoTIFF dropped at that path will run them, but the
 * assertions below name this one's CRS and elevation range, so a different file
 * needs those updated to match its own gdalinfo.
 */
const FIXTURE = 'tests/testdata/geotiff.tif'

test.describe('GeoTIFF load path', () => {
  test.skip(!existsSync(FIXTURE), `${FIXTURE} not present (gitignored) — see tests/testdata/README.md`)

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForSelector('text=erzberg', { timeout: 30000 })
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-testid="load-geotiff"]'),
    ])
    await chooser.setFiles(FIXTURE)
    await page.waitForFunction(
      () => !!document.body.innerText.match(/Elevation:\s*\d/),
      { timeout: 30000 },
    )
  })

  test('reports the projection in the sidebar metadata', async ({ page }) => {
    const meta = await page.innerText('body')
    // The whole point of the readout: the real CRS, named, with its code.
    expect(meta).toContain('WGS 84 / UTM zone 33N (EPSG:32633)')
    // A supported, exact CRS earns no caveat.
    expect(meta).not.toContain('assumed UTM')
    expect(meta).not.toContain('vector overlay unsupported')
    expect(meta).not.toContain('Not georeferenced')
  })

  test('reads the elevation range from the raster', async ({ page }) => {
    // 641.36–2349.51 per gdalinfo, rounded for display. Wrong NoData handling
    // would drag the floor to -3.4e38 and show a nonsense range.
    expect(await page.innerText('body')).toContain('Elevation: 641 – 2350 m')
  })

  test('offers the Vector Layers section with no complaint about the raster', async ({ page }) => {
    // By test id, not by title text: Section uppercases its title in CSS and
    // innerText reports what is rendered.
    await expect(page.locator('[data-testid="section-vector-layers"]')).toHaveCount(1)
    const body = await page.innerText('body')
    expect(body).toContain('Fetch from OpenStreetMap')
    expect(body).not.toContain('carries no georeferencing')
    expect(body).not.toContain('is not one this tool can place WGS84 features in')
  })
})
