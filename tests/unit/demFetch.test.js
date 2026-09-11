/**
 * The tile arithmetic behind "type a place, get the ground".
 *
 * Everything here is pure and offline. The two network calls are asserted in
 * `tests/terrain-fetch.spec.js`, against intercepted endpoints — a suite that
 * depends on somebody else's server being up is a suite that goes red for
 * reasons the code cannot fix.
 *
 * What these tests are actually protecting is the *budget*. A tile cover is a
 * step function of the zoom, so an off-by-one in the range makes one press pull
 * four times the tiles it promised — from a shared open-data bucket, at
 * somebody else's expense.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_TILES, MAX_ZOOM, demToHeightmap, padBbox, tileRange, zoomForExtent,
} from '../../src/utils/demFetch'

/** The Erzberg, as OpenStreetMap gives it: about 4 km by 3 km. */
const ERZ = [14.8868072, 47.5096550, 14.9391517, 47.5390150]

describe('tileRange', () => {
  it('covers the whole world with one tile at zoom 0', () => {
    const r = tileRange([-180, -85, 180, 85], 0)
    expect(r).toMatchObject({ x0: 0, x1: 0, y0: 0, y1: 0, count: 1 })
  })

  it('puts the northern edge in the first row', () => {
    // Tile rows run north to south, which is the sign error this catches: a
    // range built from minLat first comes back inverted and covers nothing.
    const r = tileRange(ERZ, 12)
    expect(r.y0).toBeLessThanOrEqual(r.y1)
    expect(r.x0).toBeLessThanOrEqual(r.x1)
    expect(r.count).toBe((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1))
  })

  it('puts the Erzberg where the Erzberg is', () => {
    // The standard slippy-map indices for 14.9° E, 47.53° N — the numbers any
    // tile viewer gives for this corner of Styria. A sign error or a missing
    // clamp moves these by hundreds, not by one.
    const r = tileRange(ERZ, 10)
    expect([r.x0, r.x1, r.y0, r.y1]).toEqual([554, 554, 357, 358])
    expect(r.count).toBe(2)
    expect(tileRange(ERZ, 12)).toMatchObject({ x0: 2217, y0: 1431, count: 2 })
  })

  it('clamps rather than walking off the edge of the world', () => {
    const r = tileRange([-181, -90, 181, 90], 3)
    expect(r.x0).toBeGreaterThanOrEqual(0)
    expect(r.y0).toBeGreaterThanOrEqual(0)
    expect(r.x1).toBeLessThan(8)
    expect(r.y1).toBeLessThan(8)
  })
})

describe('zoomForExtent', () => {
  it('takes the finest zoom the two caps allow', () => {
    // Two things bind: the tile budget, and the zoom past which the dataset is
    // upsampling rather than surveying. A small extent hits the zoom cap first.
    const small = zoomForExtent(ERZ)
    expect(small).toBe(MAX_ZOOM)
    expect(tileRange(ERZ, small).count).toBeLessThanOrEqual(MAX_TILES)

    // A large one hits the budget, and is genuinely the finest that fits.
    const europe = [-10, 35, 30, 60]
    const z = zoomForExtent(europe)
    expect(z).toBeLessThan(MAX_ZOOM)
    expect(tileRange(europe, z).count).toBeLessThanOrEqual(MAX_TILES)
    expect(tileRange(europe, z + 1).count).toBeGreaterThan(MAX_TILES)
  })

  it('never overruns the budget, at any extent from a quarry to a continent', () => {
    const boxes = [
      ERZ,
      [6, 45, 7, 46],            // an alpine degree
      [-10, 35, 30, 60],         // most of Europe
      [-180, -60, 180, 75],      // the inhabited world
      [14.9115, 47.5243, 14.9116, 47.5244],  // one node
    ]
    for (const b of boxes) {
      expect(tileRange(b, zoomForExtent(b)).count).toBeLessThanOrEqual(MAX_TILES)
    }
  })

  it('honours a smaller budget', () => {
    expect(tileRange(ERZ, zoomForExtent(ERZ, 4)).count).toBeLessThanOrEqual(4)
  })
})

describe('padBbox', () => {
  it('turns a named point into ground', () => {
    // A summit resolves to a box a few metres across — the node itself. A DEM of
    // one point is not a terrain.
    const node = [14.91153, 47.52439, 14.91163, 47.52449]
    const [w, s, e, n] = padBbox(node, 6)
    expect(n - s).toBeCloseTo(12 / 110.574, 3)
    // Degrees of longitude are shorter at 47° N, so the box is wider in degrees
    // than it is tall — which is what makes it square on the ground.
    expect(e - w).toBeGreaterThan(n - s)
  })

  it('leaves a box that is already big enough alone', () => {
    const [w, s, e, n] = padBbox(ERZ, 1)
    expect([w, s, e, n]).toEqual(ERZ)
  })

  it('keeps the place in the middle', () => {
    const [w, s, e, n] = padBbox(ERZ, 20)
    expect((w + e) / 2).toBeCloseTo((ERZ[0] + ERZ[2]) / 2, 9)
    expect((s + n) / 2).toBeCloseTo((ERZ[1] + ERZ[3]) / 2, 9)
  })
})

describe('demToHeightmap', () => {
  it('normalises to the 0…1 raster the rest of the app consumes', () => {
    const dem = {
      pixels: new Float32Array([700, 1200, 1700, 2200]),
      width: 2, height: 2, elevMin: 700, elevMax: 2200,
    }
    const { pixels, nodataMask } = demToHeightmap(dem)
    expect(pixels[0]).toBeCloseTo(0, 6)
    expect(pixels[3]).toBeCloseTo(1, 6)
    expect(pixels[1]).toBeCloseTo(1 / 3, 6)
    // Terrarium has no holes: the ocean carries real bathymetry rather than a
    // sentinel, so every cell is data.
    expect([...nodataMask]).toEqual([1, 1, 1, 1])
  })

  it('survives ground with no relief at all', () => {
    const flat = { pixels: new Float32Array([5, 5]), width: 2, height: 1, elevMin: 5, elevMax: 5 }
    expect([...demToHeightmap(flat).pixels].every(Number.isFinite)).toBe(true)
  })
})
