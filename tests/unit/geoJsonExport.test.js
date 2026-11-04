import { describe, expect, it } from 'vitest'
import { joinSegments, linesToGeoJson, modeOfLayer } from '../../src/utils/geoJsonExport'

describe('lines as GeoJSON', () => {
  it('names the mode of a layer, a copy included', () => {
    expect(modeOfLayer('Contours-Minor@c3')).toBe('Contours')
    expect(modeOfLayer('Riso-A')).toBe('Riso')
    expect(modeOfLayer('vector-roads')).toBeNull()
  })

  it('joins touching segments into one run', () => {
    const runs = joinSegments(new Float32Array([0, 0, 0, 1, 0, 0,  1, 0, 0, 2, 0, 0,  5, 0, 5, 6, 0, 5]))
    expect(runs.map((r) => r.length)).toEqual([3, 2])
  })

  it('places a line in the raster grid with its height, and leaves charts out', () => {
    // A 100 × 50 raster over 1000 × 500 m, centred on the world origin.
    const place = {
      halfW: 50, halfH: 25, width: 100, height: 50,
      bbox: [400000, 5000000, 401000, 5000500], crs: 'EPSG:32633',
      metresAt: () => 1200, nameOf: (id) => `pen ${id}`,
    }
    const seg = new Float32Array([-50, 0, -25, 50, 0, 25])
    const { geojson, lines, layers } = linesToGeoJson([
      { id: 'Contours-Major', positions: seg },
      { id: 'ProfileSheet', positions: seg },
      { id: 'Stipple', positions: seg, isPoints: true },
    ], place)
    expect(lines).toBe(1)
    expect(layers).toBe(1)
    const f = geojson.features[0]
    expect(f.geometry.coordinates).toEqual([[400000, 5000500, 1200], [401000, 5000000, 1200]])
    expect(f.properties).toMatchObject({ layer: 'Contours-Major', mode: 'Contours', name: 'pen Contours-Major', elevation: 1200 })
    expect(geojson.crs.properties.name).toBe('urn:ogc:def:crs:EPSG::32633')
  })
})
