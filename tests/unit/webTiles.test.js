import { describe, expect, it } from 'vitest'
import { renderTile, tileLonLat, tileOf, tilesFor } from '../../src/utils/webTiles'

describe('web tiles', () => {
  it('finds the tile of a place and back', () => {
    const [x, y] = tileOf(14.9, 47.52, 12)
    expect([x, y]).toEqual([2217, 1431])
    const [lon, lat] = tileLonLat(12, x, y, 0.5, 0.5)
    expect(Math.abs(lon - 14.9)).toBeLessThan(0.1)
    expect(Math.abs(lat - 47.52)).toBeLessThan(0.1)
  })

  it('covers a box', () => {
    expect(tilesFor([14.0, 47.47, 14.09, 47.53], 10).length).toBeGreaterThan(0)
  })

  it('traces each tile pixel back into the picture', () => {
    // A 2 × 1 picture, red then blue, mapped straight from degrees.
    const image = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255])
    const [x, y] = tileOf(14.5, 47.5, 8)
    const [w0] = tileLonLat(8, x, y, 0, 0), [w1] = tileLonLat(8, x, y, 1, 0)
    const { rgba, empty } = renderTile({
      tile: [8, x, y], toCrs: (lat, lon) => [lon, lat],
      toImage: (X) => [((X - w0) / (w1 - w0)) * 2, 0.5], image, width: 2, height: 1, size: 4,
    })
    expect(empty).toBe(false)
    expect(Array.from(rgba.subarray(0, 4))).toEqual([255, 0, 0, 255])
    expect(Array.from(rgba.subarray(12, 16))).toEqual([0, 0, 255, 255])
  })
})
