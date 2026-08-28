/**
 * The raster maths, asserted directly.
 *
 * Every one of these behaviours is currently load-bearing somewhere in the
 * app and was only ever observable as a pixel difference: a blur that sags
 * toward the floor beside a clipped edge, a bilinear tap that dives into a
 * NoData hole, a resample that beats between keeping and dropping whole rows.
 * The comments in terrain.js name the visible symptom of each; these pin the
 * arithmetic that prevents it.
 */
import { describe, expect, it } from 'vitest'
import {
  areaResample, boxBlur, maskHasHoles, sampleBilinear, cellElev, jitterNoise,
} from '../../src/utils/terrain'

/** A w×h Float32Array from a generator, for readable fixtures. */
const grid = (w, h, fn) => {
  const a = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = fn(x, y)
  return a
}

describe('boxBlur', () => {
  it('returns the source untouched at radius 0', () => {
    const src = grid(4, 4, (x) => x / 4)
    // Same reference, not merely equal values: buildTerrain relies on this to
    // skip a full-size copy, and the worker's blur cache stores the result.
    expect(boxBlur(src, 4, 4, 0)).toBe(src)
  })

  it('leaves a constant field constant', () => {
    const src = grid(8, 8, () => 0.5)
    const out = boxBlur(src, 8, 8, 2)
    for (const v of out) expect(v).toBeCloseTo(0.5, 6)
  })

  it('averages a step edge toward its two sides', () => {
    // A vertical step: left half 0, right half 1.
    const src = grid(8, 1, (x) => (x < 4 ? 0 : 1))
    const out = boxBlur(src, 8, 1, 1)
    // Deep on either side is untouched; the two cells at the seam meet in between.
    expect(out[0]).toBeCloseTo(0, 6)
    expect(out[7]).toBeCloseTo(1, 6)
    expect(out[3]).toBeGreaterThan(0)
    expect(out[4]).toBeLessThan(1)
    expect(out[3]).toBeLessThan(out[4])
  })

  it('interpolates a fractional radius between the two integer blurs', () => {
    const src = grid(16, 1, (x) => (x === 8 ? 1 : 0))
    const lo = boxBlur(src, 16, 1, 1)
    const hi = boxBlur(src, 16, 1, 2)
    const mid = boxBlur(src, 16, 1, 1.5)
    for (let i = 0; i < 16; i++) expect(mid[i]).toBeCloseTo((lo[i] + hi[i]) / 2, 6)
  })

  it('does not write into the source when the low radius is 0', () => {
    // radius 0.5 takes the rLo <= 0 branch, whose operand *is* the source.
    const src = grid(8, 1, (x) => x / 8)
    const copy = Float32Array.from(src)
    boxBlur(src, 8, 1, 0.5)
    expect(Array.from(src)).toEqual(Array.from(copy))
  })

  it('ignores NoData rather than averaging against the zeros parked there', () => {
    // Ground at 0.8 on the left, a hole on the right. Without the mask the
    // window would average real ground against the 0s and sag toward the floor.
    const src = grid(8, 1, (x) => (x < 4 ? 0.8 : 0))
    const mask = new Uint8Array([1, 1, 1, 1, 0, 0, 0, 0])
    const masked = boxBlur(src, 8, 1, 2, mask)
    const plain  = boxBlur(src, 8, 1, 2)
    // The valid cell nearest the cut keeps its own level…
    expect(masked[3]).toBeCloseTo(0.8, 6)
    // …where the unmasked blur has already dragged it down.
    expect(plain[3]).toBeLessThan(0.8)
    // And the holes stay holes rather than being filled in from their neighbours.
    for (let i = 4; i < 8; i++) expect(masked[i]).toBe(0)
  })
})

describe('maskHasHoles', () => {
  it('is false for no mask and for a solid one', () => {
    expect(maskHasHoles(null)).toBe(false)
    expect(maskHasHoles(new Uint8Array([1, 1, 1]))).toBe(false)
  })
  it('is true as soon as one cell is excluded', () => {
    expect(maskHasHoles(new Uint8Array([1, 1, 0, 1]))).toBe(true)
  })
})

describe('areaResample', () => {
  const notFinite = (v) => !isFinite(v)

  it('takes the mean over each destination cell on an exact 2:1 shrink', () => {
    // 4×4 counting up; each 2×2 block averages to its own mean.
    const src = grid(4, 4, (x, y) => y * 4 + x)
    const out = areaResample(src, 4, 4, 2, 2, notFinite)
    expect(Array.from(out)).toEqual([2.5, 4.5, 10.5, 12.5])
  })

  it('weights partial overlap on a non-integer ratio', () => {
    // 3 → 2 columns: the middle source cell is split between both destinations.
    const src = new Float32Array([0, 1, 2])
    const out = areaResample(src, 3, 1, 2, 1, notFinite)
    // dest 0 covers [0, 1.5) → 1·cell0 + 0.5·cell1 over weight 1.5
    expect(out[0]).toBeCloseTo((0 * 1 + 1 * 0.5) / 1.5, 6)
    expect(out[1]).toBeCloseTo((1 * 0.5 + 2 * 1) / 1.5, 6)
  })

  it('skips NoData samples and reports an empty cell as NaN', () => {
    const src = new Float32Array([NaN, NaN, 4, 6])
    const out = areaResample(src, 2, 2, 1, 2, notFinite)
    expect(out[0]).toBeNaN()          // top row held nothing valid
    expect(out[1]).toBeCloseTo(5, 6)  // bottom row is the mean of 4 and 6
  })
})

describe('sampleBilinear', () => {
  const g = new Float32Array([0, 1, 2, 3])   // 2×2

  it('returns the cell value exactly at integer coordinates', () => {
    expect(sampleBilinear(g, null, 2, 2, 0, 0)).toBeCloseTo(0, 9)
    expect(sampleBilinear(g, null, 2, 2, 1, 1)).toBeCloseTo(3, 9)
  })

  it('interpolates the centre as the mean of four corners', () => {
    expect(sampleBilinear(g, null, 2, 2, 0.5, 0.5)).toBeCloseTo(1.5, 9)
  })

  it('renormalises over the valid corners instead of blending against a hole', () => {
    // Bottom row masked out. The grid stores 0 there, and 0 is the darkest
    // possible ground — a plain tap at the midpoint would return 0.5 and draw a
    // stroke plunging to the base. Weighting only the live corners returns the
    // height of the ground that is actually there.
    const mask = new Uint8Array([1, 1, 0, 0])
    expect(sampleBilinear(g, mask, 2, 2, 0.5, 0)).toBeCloseTo(0, 9)
    expect(sampleBilinear(g, mask, 2, 2, 0.5, 0.5)).toBeCloseTo(0.5, 9)
  })

  it('returns NaN when the footprint holds no data at all', () => {
    const mask = new Uint8Array([0, 0, 0, 0])
    expect(sampleBilinear(g, mask, 2, 2, 0.5, 0.5)).toBeNaN()
  })
})

describe('cellElev', () => {
  it('maps mid-brightness to zero and is linear in elevScale', () => {
    const g2 = new Float32Array([0.5, 1])
    expect(cellElev(g2, 0, 0, 2, 1)).toBeCloseTo(0, 9)
    expect(cellElev(g2, 0, 1, 2, 1)).toBeCloseTo(50, 9)
    expect(cellElev(g2, 0, 1, 2, 2)).toBeCloseTo(100, 9)
  })

  it('inverts the terrain for a negative scale rather than clamping', () => {
    const g2 = new Float32Array([1])
    expect(cellElev(g2, 0, 0, 1, -1)).toBeCloseTo(-50, 9)
  })
})

describe('jitterNoise', () => {
  it('is deterministic and stays inside [-1, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const v = jitterNoise(i * 0.37, i * 1.13)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
      expect(jitterNoise(i * 0.37, i * 1.13)).toBe(v)
    }
  })
})
