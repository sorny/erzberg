/**
 * Projections.
 *
 * The rule this file exists to hold: a CRS that cannot be transformed returns
 * `null` rather than falling through to treating lon/lat as grid coordinates.
 * That fallthrough is how an unsupported projection used to become an empty
 * overlay instead of a stated refusal, and it is invisible from a screenshot —
 * the features simply are not there.
 *
 * Round trips are asserted to metre accuracy, which is the honest bar for the
 * UTM series implemented here and far tighter than anything the draping needs.
 */
import { describe, expect, it } from 'vitest'
import {
  bboxToWgs84, classifyCRS, isInvertible, isProjectable,
  metresPerWorldUnit, gridValueToMetres, projectWgs84, unprojectWgs84, wgs84ExtentKm,
} from '../../src/utils/geoCoords'

describe('classifyCRS', () => {
  it('recognises WGS84 as geographic', () => {
    expect(classifyCRS('EPSG:4326')).toMatchObject({ kind: 'geographic', supported: true })
  })
  it('recognises Web Mercator', () => {
    expect(classifyCRS('EPSG:3857')).toMatchObject({ kind: 'mercator', supported: true })
  })
  it('reads a UTM zone and hemisphere out of the code', () => {
    expect(classifyCRS('EPSG:32633')).toMatchObject({ kind: 'utm', zone: 33, isSouth: false, supported: true })
    expect(classifyCRS('EPSG:32733')).toMatchObject({ kind: 'utm', zone: 33, isSouth: true, supported: true })
  })
  it('declines a national grid rather than approximating it', () => {
    // Gauss-Krüger / Lambert grids need a datum shift this does not do.
    expect(classifyCRS('EPSG:31287').supported).toBe(false)
  })
  it('treats an unreferenced raster as unsupported', () => {
    expect(classifyCRS('EPSG:none').supported).toBe(false)
    expect(classifyCRS(null).supported).toBe(false)
  })
})

describe('projectWgs84', () => {
  it('passes lon/lat straight through for a geographic CRS', () => {
    expect(projectWgs84(47.07, 15.44, 'EPSG:4326')).toEqual([15.44, 47.07])
  })

  it('returns null for a CRS it cannot transform', () => {
    // The load-bearing case: null is what stops the caller treating degrees as
    // grid units and drawing the overlay somewhere plausible but wrong.
    expect(projectWgs84(47, 15, 'EPSG:31287')).toBeNull()
    expect(projectWgs84(47, 15, 'EPSG:none')).toBeNull()
  })

  it('puts the origin at the origin in Web Mercator', () => {
    const [x, y] = projectWgs84(0, 0, 'EPSG:3857')
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(0, 6)
  })

  it('places a UTM easting near the 500 km false easting on its central meridian', () => {
    // Zone 33's central meridian is 15°E.
    const [x] = projectWgs84(47, 15, 'EPSG:32633')
    expect(x).toBeCloseTo(500000, 0)
  })
})

describe('round trip', () => {
  const points = [
    [47.07, 15.44],   // Graz
    [-33.87, 151.21], // Sydney, southern hemisphere
    [0, 0],
    [60.17, 24.94],   // Helsinki
  ]

  for (const crs of ['EPSG:4326', 'EPSG:3857']) {
    it(`survives ${crs}`, () => {
      for (const [lat, lon] of points) {
        const xy = projectWgs84(lat, lon, crs)
        const back = unprojectWgs84(xy[0], xy[1], crs)
        expect(back[0]).toBeCloseTo(lat, 6)
        expect(back[1]).toBeCloseTo(lon, 6)
      }
    })
  }

  it('survives UTM to within a metre', () => {
    for (const [lat, lon] of points) {
      const zone = Math.floor((lon + 180) / 6) + 1
      const code = (lat < 0 ? 32700 : 32600) + zone
      const xy = projectWgs84(lat, lon, `EPSG:${code}`)
      const back = unprojectWgs84(xy[0], xy[1], `EPSG:${code}`)
      // 1e-5° of latitude is about a metre.
      expect(back[0]).toBeCloseTo(lat, 5)
      expect(back[1]).toBeCloseTo(lon, 5)
    }
  })
})

describe('isInvertible', () => {
  it('is narrower than "supported", and projected-unknown is the difference', () => {
    // Forward, a wrong zone guess is at least self-consistent for a real tile.
    // Backward there is no longitude to guess from, so the OSM query — which
    // needs the inverse — is refused for these rasters instead.
    expect(classifyCRS('EPSG:projected-unknown').supported).toBe(true)
    expect(isInvertible('EPSG:projected-unknown')).toBe(false)
    expect(isInvertible('EPSG:32633')).toBe(true)
    expect(isInvertible('EPSG:4326')).toBe(true)
  })

  it('returns null from unprojectWgs84 for the same case', () => {
    expect(unprojectWgs84(500000, 5200000, 'EPSG:projected-unknown')).toBeNull()
  })
})

describe('isProjectable', () => {
  it('needs both a supported CRS and a usable bbox', () => {
    expect(isProjectable('EPSG:4326', [15, 47, 15.1, 47.1])).toBe(true)
    expect(isProjectable('EPSG:4326', null)).toBe(false)
    expect(isProjectable('EPSG:none', [15, 47, 15.1, 47.1])).toBe(false)
  })
})

describe('bboxToWgs84', () => {
  it('returns a WGS84 envelope that contains the projected corners', () => {
    const out = bboxToWgs84([500000, 5200000, 520000, 5220000], 'EPSG:32633')
    expect(out).toHaveLength(4)
    const [minLon, minLat, maxLon, maxLat] = out
    expect(minLon).toBeLessThan(maxLon)
    expect(minLat).toBeLessThan(maxLat)
    expect(minLon).toBeGreaterThan(14)
    expect(maxLon).toBeLessThan(16)
  })

  it('refuses a CRS it cannot invert', () => {
    expect(bboxToWgs84([0, 0, 1, 1], 'EPSG:projected-unknown')).toBeNull()
    expect(bboxToWgs84(null, 'EPSG:4326')).toBeNull()
  })
})

describe('wgs84ExtentKm', () => {
  it('measures a one-degree box as roughly 111 km tall', () => {
    const km = wgs84ExtentKm([15, 47, 16, 48])
    expect(km.h).toBeGreaterThan(110)
    expect(km.h).toBeLessThan(112)
    // A degree of longitude at 47° is about cos(47) of that.
    expect(km.w).toBeGreaterThan(70)
    expect(km.w).toBeLessThan(80)
  })
})

describe('elevation scaling', () => {
  it('reports metres per world unit as the range over the scene height', () => {
    // 0–100 world units span the full brightness range by construction.
    expect(metresPerWorldUnit(0, 1000, 1)).toBeCloseTo(10, 6)
    expect(metresPerWorldUnit(0, 1000, 2)).toBeCloseTo(5, 6)
  })

  it('maps a normalised grid value back to metres', () => {
    expect(gridValueToMetres(0, 200, 1200)).toBeCloseTo(200, 6)
    expect(gridValueToMetres(1, 200, 1200)).toBeCloseTo(1200, 6)
    expect(gridValueToMetres(0.5, 200, 1200)).toBeCloseTo(700, 6)
  })
})
