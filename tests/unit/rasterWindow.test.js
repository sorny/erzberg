/**
 * The pixel window of a raster that covers a box in longitude and latitude,
 * which the atlas uses to cut sheets from one GeoTIFF.
 */
import { describe, expect, it } from 'vitest'
import { windowBbox, windowForArea } from '../../src/utils/rasterWindow'
import { projectWgs84 } from '../../src/utils/geoCoords'

// tests/testdata/geotiff.tif: 1200 × 700, UTM 33N, 10 m pixels.
const GRID = { origin: [418999.5, 5266000.5], resolution: [10, -10], width: 1200, height: 700 }

describe('windowForArea', () => {
  it('holds every edge of the box, in pixels of the grid', () => {
    const area = [13.98, 47.49, 14.0, 47.51]
    const win = windowForArea(area, 'EPSG:32633', GRID)
    expect(win).not.toBeNull()
    for (const [lon, lat] of [[13.98, 47.49], [14.0, 47.51], [13.98, 47.51], [14.0, 47.49]]) {
      const [x, y] = projectWgs84(lat, lon, 'EPSG:32633')
      const col = (x - GRID.origin[0]) / 10, row = (y - GRID.origin[1]) / -10
      expect(col).toBeGreaterThanOrEqual(win[0]); expect(col).toBeLessThanOrEqual(win[2])
      expect(row).toBeGreaterThanOrEqual(win[1]); expect(row).toBeLessThanOrEqual(win[3])
    }
    // About 1.5 km by 2.2 km at 10 m.
    expect(win[2] - win[0]).toBeGreaterThan(140); expect(win[2] - win[0]).toBeLessThan(160)
    expect(win[3] - win[1]).toBeGreaterThan(215); expect(win[3] - win[1]).toBeLessThan(230)
  })

  it('clamps a box that runs over the edge, and refuses one that misses', () => {
    const win = windowForArea([13.9, 47.45, 14.0, 47.6], 'EPSG:32633', GRID)
    expect(win[0]).toBe(0); expect(win[1]).toBe(0); expect(win[3]).toBe(700)
    expect(windowForArea([16.3, 48.1, 16.4, 48.2], 'EPSG:32633', GRID)).toBeNull()
  })

  it('refuses a CRS it cannot place', () => {
    expect(windowForArea([13.98, 47.49, 14.0, 47.51], 'EPSG:none', GRID)).toBeNull()
  })
})

describe('windowBbox', () => {
  it('gives the extent of the window in grid units', () => {
    expect(windowBbox([10, 20, 110, 70], GRID)).toEqual([419099.5, 5265300.5, 420099.5, 5265800.5])
  })
})
