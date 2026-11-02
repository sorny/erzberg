/**
 * Shapefile import: a zip of two layers in MGI / Austria Lambert, with the
 * ESRI-style .prj that ArcGIS and GDAL write (no TOWGS84). The points must
 * land on their WGS84 positions within a few metres, which needs the MGI
 * datum shift that `converterFromWkt` adds.
 *
 * Fixture: tests/testdata/vector/lambert-shp.zip, written by ogr2ogr from
 * WGS84 points (Erzberg 14.9024 E 47.5241 N, Stephansdom 16.3731 E 48.2085 N)
 * and one three-point path.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { shapefileToSource } from '../../src/utils/vectorImport'

const zip = () => {
  const b = readFileSync('tests/testdata/vector/lambert-shp.zip')
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

describe('shapefileToSource', () => {
  it('reads every layer in the zip and places it in WGS84', async () => {
    const { source, note } = await shapefileToSource(zip(), 'lambert-shp.zip')
    expect(note).toBeNull()   // MGI is shifted, so nothing is approximate
    const geoms = source.buckets.map((b) => b.geom).sort()
    expect(geoms).toEqual(['line', 'point'])
    // The names come from the .dbf of each layer.
    const names = source.buckets.flatMap((b) => [...b.names.values()])
    expect(names).toEqual(expect.arrayContaining(['Erzberg', 'Wien Stephansdom', 'Steig']))
  })

  it('lands the points within a few metres of where they started', async () => {
    const { source } = await shapefileToSource(zip(), 'lambert-shp.zip')
    // Coordinates are flat [lon, lat, …]. Find the vertex nearest each known point.
    const coords = source.buckets.flatMap((b) => Array.from(b.coords))
    const nearest = (lon, lat) => {
      let best = Infinity
      for (let i = 0; i < coords.length; i += 2)
        best = Math.min(best, Math.hypot((coords[i] - lon) * 75_000, (coords[i + 1] - lat) * 111_000))
      return best
    }
    expect(nearest(14.9024, 47.5241)).toBeLessThan(5)
    expect(nearest(16.3731, 48.2085)).toBeLessThan(5)
  })

  it('refuses a zip with no Shapefile in it', async () => {
    const empty = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]).buffer
    await expect(shapefileToSource(empty, 'empty.zip')).rejects.toThrow(/no \.shp file/)
  })
})
