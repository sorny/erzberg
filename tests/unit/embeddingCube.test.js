/**
 * The one GeoTIFF shape the loader must refuse.
 *
 * `loadGeoTiffPixels` reads band 0 and nothing else, which is right for a DEM
 * and free for an RGB plate. On a 64-band satellite embedding it is silently
 * wrong: the file opens, band `A00` renders as ground, and the result has a
 * range, has relief and takes contours. Nothing downstream can tell that the
 * landscape is one arbitrary axis of a machine-learned description.
 *
 * So the rule has to be exactly wide enough. Too narrow and the cube still
 * loads; too wide and it starts refusing files people legitimately open on
 * band 0 — which would be the more annoying failure, because those work today.
 */
import { describe, it, expect } from 'vitest'
import { isEmbeddingCube } from '../../src/hooks/useHeightmap'

const bands = (n, bits, fmt) => [Array(n).fill(bits), Array(n).fill(fmt)]

describe('isEmbeddingCube', () => {
  it('catches the AlphaEarth shape', () => {
    // 64 signed 8-bit samples — what the Satellite Embedding tiles actually are.
    expect(isEmbeddingCube(64, ...bands(64, 8, 2))).toBe(true)
    expect(isEmbeddingCube(8, ...bands(8, 8, 2))).toBe(true)
  })

  it('leaves the rasters people legitimately open on band 0 alone', () => {
    expect(isEmbeddingCube(1, [32], [3])).toBe(false)          // a float DEM
    expect(isEmbeddingCube(1, [16], [1])).toBe(false)          // a 16-bit DEM
    expect(isEmbeddingCube(3, ...bands(3, 8, 1))).toBe(false)  // an RGB plate
    expect(isEmbeddingCube(4, ...bands(4, 8, 1))).toBe(false)  // RGBA
    expect(isEmbeddingCube(12, ...bands(12, 32, 3))).toBe(false) // stacked float epochs
  })

  it('does not fire on unsigned bands, whatever their count', () => {
    // A many-band *unsigned* 8-bit raster is a multispectral image, and reading
    // band 0 of one as terrain is a choice rather than a mistake.
    expect(isEmbeddingCube(64, ...bands(64, 8, 1))).toBe(false)
  })

  it('survives a file that states neither tag', () => {
    expect(isEmbeddingCube(64, undefined, undefined)).toBe(false)
    expect(isEmbeddingCube(64, [], [])).toBe(false)
  })
})
