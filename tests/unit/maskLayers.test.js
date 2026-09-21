/**
 * Masks: the plane of bits, and the selection that spends it.
 *
 * Two things here are worth holding down.
 *
 * `toggleMaskSelection` is deliberately *asymmetric* with the cover classes'
 * version, and an asymmetry that is not tested reads as a bug the next time
 * somebody compares the two files. Every class selected is the unfiltered
 * raster, because classes partition it. Every mask selected is the union of the
 * regions you drew, which is almost never the whole raster.
 *
 * `stamp` and `stroke` are the brush. A stroke that leaves gaps between pointer
 * samples is the classic painting bug, and it only shows up when the pointer
 * moves faster than the test harness usually moves it.
 */
import { describe, it, expect } from 'vitest'
import {
  MAX_MASKS, NO_MASKS, createMask, describeSelection, fillAll, invert,
  maskBit, maskCoverage, maskFromImageData, selectionHasMask, stamp, stroke,
  toggleMaskSelection, unionOf,
} from '../../src/utils/maskLayers'

const W = 64, H = 64
const blank = () => new Uint8Array(W * H)
const countOn = (d) => d.reduce((n, v) => n + (v ? 1 : 0), 0)

describe('a mask', () => {
  it('starts empty, over the raster it was made for', () => {
    const m = createMask(W, H, 0)
    expect(m.data).toHaveLength(W * H)
    expect(countOn(m.data)).toBe(0)
    expect(m.width).toBe(W)
    expect(maskCoverage(m)).toBe(0)
    // Invisible in the viewport until asked for: the Studio shows it while you
    // draw and the terrain does not need a wash over it afterwards.
    expect(m.visible).toBe(false)
  })

  it('gives each one its own colour', () => {
    const colors = [0, 1, 2, 3].map((i) => createMask(W, H, i).color)
    expect(new Set(colors).size).toBe(4)
  })

  it('fills and inverts', () => {
    const d = blank()
    fillAll(d, 1)
    expect(countOn(d)).toBe(W * H)
    invert(d)
    expect(countOn(d)).toBe(0)
  })
})

describe('the brush', () => {
  it('stamps a round patch of about the right area', () => {
    const d = blank()
    stamp(d, W, H, 32, 32, 10)
    const area = countOn(d)
    // πr² = 314. Rasterised at pixel centres, so a few per cent either way.
    expect(area).toBeGreaterThan(280)
    expect(area).toBeLessThan(350)
    // Round, not square: the corner of the bounding box stays clear.
    expect(d[(32 - 9) * W + (32 - 9)]).toBe(0)
    expect(d[32 * W + 32]).toBe(1)
  })

  it('clips at the edges instead of wrapping', () => {
    const d = blank()
    stamp(d, W, H, 0, 0, 8)
    expect(d[0]).toBe(1)
    // A stamp at the origin must not appear on the far side of row 0.
    expect(d[W - 1]).toBe(0)
  })

  it('joins a fast drag into a continuous stroke', () => {
    // The whole point: a pointer reports positions tens of pixels apart, and
    // stamping only where it was reported paints a dotted line.
    const d = blank()
    stroke(d, W, H, 4, 32, 60, 32, 3)
    let gaps = 0
    for (let x = 6; x < 58; x++) if (!d[32 * W + x]) gaps++
    expect(gaps, 'a stroke must not be dotted').toBe(0)
  })

  it('erases what it painted', () => {
    const d = blank()
    stamp(d, W, H, 32, 32, 12)
    expect(countOn(d)).toBeGreaterThan(0)
    stamp(d, W, H, 32, 32, 12, true)
    expect(countOn(d)).toBe(0)
  })
})

describe('the selection', () => {
  const masks = [0, 1, 2].map((i) => createMask(W, H, i))

  it('reads zero as the whole raster', () => {
    expect(describeSelection(NO_MASKS, masks)).toBe('Whole raster')
    expect(selectionHasMask(NO_MASKS, 0)).toBe(false)
  })

  it('selects one at a time', () => {
    const one = toggleMaskSelection(NO_MASKS, 1)
    expect(one).toBe(maskBit(1))
    expect(selectionHasMask(one, 1)).toBe(true)
    expect(selectionHasMask(one, 0)).toBe(false)
    expect(describeSelection(one, masks)).toBe(masks[1].name)
  })

  it('does NOT collapse when every mask is picked', () => {
    // The asymmetry against the cover classes, stated. Classes partition the
    // raster so all-of-them is the unfiltered raster; masks overlap and their
    // union is some particular shape.
    let sel = NO_MASKS
    for (let i = 0; i < masks.length; i++) sel = toggleMaskSelection(sel, i)
    expect(sel).not.toBe(NO_MASKS)
    expect(describeSelection(sel, masks)).toBe('All 3 masks')
  })

  it('does collapse when the last one is unpicked', () => {
    const one = toggleMaskSelection(NO_MASKS, 2)
    expect(toggleMaskSelection(one, 2)).toBe(NO_MASKS)
  })

  it('holds the top bit', () => {
    const top = toggleMaskSelection(NO_MASKS, MAX_MASKS - 1)
    expect(selectionHasMask(top, MAX_MASKS - 1)).toBe(true)
    expect(selectionHasMask(top, 0)).toBe(false)
  })
})

describe('unionOf', () => {
  it('is null when nothing is selected, so no work is done', () => {
    expect(unionOf([createMask(W, H, 0)], NO_MASKS, W, H)).toBeNull()
  })

  it('hands back the one plane when one is selected, without copying', () => {
    const m = createMask(W, H, 0)
    stamp(m.data, W, H, 10, 10, 4)
    expect(unionOf([m], maskBit(0), W, H)).toBe(m.data)
  })

  it('unions overlapping masks rather than intersecting them', () => {
    const a = createMask(W, H, 0), b = createMask(W, H, 1)
    stamp(a.data, W, H, 20, 32, 6)
    stamp(b.data, W, H, 44, 32, 6)
    const out = unionOf([a, b], maskBit(0) | maskBit(1), W, H)
    expect(out[32 * W + 20]).toBe(1)
    expect(out[32 * W + 44]).toBe(1)
    expect(countOn(out)).toBe(countOn(a.data) + countOn(b.data))
  })

  it('ignores a mask cut for a different raster', () => {
    const good = createMask(W, H, 0)
    fillAll(good.data, 1)
    const stale = createMask(8, 8, 1)
    fillAll(stale.data, 1)
    const out = unionOf([good, stale], maskBit(0) | maskBit(1), W, H)
    expect(out).toHaveLength(W * H)
  })
})

describe('importing an image', () => {
  /** A tiny image: left half white, right half black, all opaque. */
  const split = (alpha = 255) => {
    const data = new Uint8ClampedArray(4 * 4 * 4)
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const o = (r * 4 + c) * 4
        const v = c < 2 ? 255 : 0
        data[o] = data[o + 1] = data[o + 2] = v
        data[o + 3] = alpha
      }
    }
    return { data, width: 4, height: 4 }
  }

  it('takes white as inside and black as outside', () => {
    const out = maskFromImageData(split(), 4, 4)
    expect(Array.from(out.slice(0, 4))).toEqual([1, 1, 0, 0])
  })

  it('takes transparent as outside whatever colour is under it', () => {
    // A PNG cut out with transparency is the other common way one of these
    // arrives, and reading luminance alone would take its transparent region
    // as black — which is the same answer here, so the white half is the test.
    const out = maskFromImageData(split(0), 4, 4)
    expect(countOn(out)).toBe(0)
  })

  it('inverts on request', () => {
    const out = maskFromImageData(split(), 4, 4, { invert: true })
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 1, 1])
  })

  it('resamples to the raster rather than refusing a mismatch', () => {
    const out = maskFromImageData(split(), 16, 16)
    expect(out).toHaveLength(256)
    expect(out[0]).toBe(1)
    expect(out[15]).toBe(0)
  })
})
