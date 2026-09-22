/**
 * The cover plate: what it accepts, what it refuses, and what a mask means.
 *
 * Two of these matter more than they look.
 *
 * `alignCover` is the only thing standing between a plate and the wrong ground.
 * A misaligned cover renders perfectly well — it has classes, it has regions,
 * every mask built on it stencils *something* — so nothing downstream can tell
 * that the answer is nonsense. It has to be refused here or not at all.
 *
 * `toggleClass` decides when a mask is "unfiltered", and it has to answer that
 * with one canonical value. Two masks meaning the same thing but comparing
 * unequal would put a no-op step in the history and a spurious rebuild behind it.
 */
import { describe, it, expect } from 'vitest'
import { deflateSync } from 'zlib'
import {
  ALL_CLASSES, MAX_CLASSES, alignCover, classBit, decodeCover, describeMask,
  maskHasClass, parseCover, suggestInks, toggleClass,
} from '../../src/utils/coverPlate'

const pack = (bytes) => deflateSync(Buffer.from(bytes)).toString('base64')

/** A plate of `n` classes over a `w × h` grid, one class per row band. */
function plate({ w = 4, h = 4, n = 2, bbox = [0, 0, 40, 40], crs = 'EPSG:32633' } = {}) {
  const labels = new Uint8Array(w * h)
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) labels[r * w + c] = Math.min(n - 1, Math.floor((r / h) * n))
  }
  const rgb = new Uint8Array(w * h * 3).fill(120)
  return {
    kind: 'erzberg.landcover/1',
    name: 'Fixture', year: 2024, crs, bbox, width: w, height: h,
    classes: Array.from({ length: n }, (_, i) => ({
      index: i, name: `Class ${i}`, color: '#aabbcc', share: 1 / n,
      note: i === 0 ? 'OpenStreetMap: 90% quarry' : undefined,
    })),
    variance: 0.5,
    labels: pack(labels), plate: pack(rgb),
    attribution: 'Fixture credit',
  }
}

describe('parseCover', () => {
  it('takes only what declares itself a cover plate', async () => {
    expect(parseCover(JSON.stringify(plate()))).not.toBeNull()
    // The two other things a `.json` can be in this app. Both must fall
    // through rather than throw, or the drop router cannot offer the file on.
    expect(parseCover('{"type":"FeatureCollection","features":[]}')).toBeNull()
    expect(parseCover('{"style":{"enabledLines":true}}')).toBeNull()
    expect(parseCover('not json at all')).toBeNull()
    expect(parseCover(JSON.stringify({ kind: 'erzberg.landcover/2' }))).toBeNull()
  })
})

describe('decodeCover', () => {
  it('unpacks the payloads and keeps the plate', async () => {
    const c = await decodeCover(plate({ w: 4, h: 4, n: 2 }))
    expect(c.labels).toHaveLength(16)
    expect(c.plate).toHaveLength(48)
    expect(c.classes.map((x) => x.index)).toEqual([0, 1])
    // The evidence for a class's name travels with it, and a class that has
    // none — a plate cut before the naming existed — reads as null rather than
    // as the string "undefined".
    expect(c.classes[0].note).toBe('OpenStreetMap: 90% quarry')
    expect(c.classes[1].note).toBeNull()
    // Row 0 is the first class and the last row is the last one.
    expect(c.labels[0]).toBe(0)
    expect(c.labels[15]).toBe(1)
  })

  it('refuses a file whose payload does not match its own header', async () => {
    const bad = { ...plate({ w: 4, h: 4 }), width: 8 }
    await expect(decodeCover(bad)).rejects.toThrow(/carries 16 labels/)
  })

  it('refuses a file that lists no classes', async () => {
    await expect(decodeCover({ ...plate(), classes: [] })).rejects.toThrow(/no classes/)
  })

  it('refuses more classes than a mask can hold', async () => {
    // Past 32 the bit for class 32 is the bit for class 0. A wrapped mask
    // stencils the wrong ground and looks entirely deliberate doing it, so the
    // file is refused rather than loaded and quietly misapplied.
    const many = { ...plate({ n: 2 }),
      classes: Array.from({ length: MAX_CLASSES + 1 }, (_, i) => (
        { index: i, name: `Class ${i}`, color: '#aabbcc', share: 0 })) }
    await expect(decodeCover(many)).rejects.toThrow(/a layer mask holds 32/)
  })

  it('drops a mismatched colour plate but keeps the classes', async () => {
    // The masks are the part everything is built on, and they are still good.
    const c = await decodeCover({ ...plate({ w: 4, h: 4 }), plate: pack(new Uint8Array(9)) })
    expect(c.plate).toBeNull()
    expect(c.labels).toHaveLength(16)
  })
})

describe('alignCover', () => {
  it('copies straight across when the grids already match', async () => {
    const c = await decodeCover(plate({ w: 4, h: 4 }))
    const out = alignCover(c, { width: 4, height: 4, bbox: null, crs: 'EPSG:none' })
    expect(out.labels).toBe(c.labels)      // the same array, not a resample of it
  })

  it('resamples through the extents when the grids differ', async () => {
    const c = await decodeCover(plate({ w: 4, h: 4, n: 2, bbox: [0, 0, 40, 40] }))
    const out = alignCover(c, { width: 8, height: 8, bbox: [0, 0, 40, 40], crs: 'EPSG:32633' })
    expect(out.labels).toHaveLength(64)
    // North-up on both sides: the top row is still the first class.
    expect(out.labels[0]).toBe(0)
    expect(out.labels[63]).toBe(1)
  })

  it('keeps the class shares when a coarse plate meets a fine raster', async () => {
    // Not a rare case any more, and that is why this is asserted separately.
    // The embeddings are 10 m, so a raster finer than that gets a plate cut
    // deliberately coarser than itself — a 4.2 m city raster comes back at
    // half its width by design. Upsampling must not move the boundaries, or
    // every share the script printed would be a share the app disagrees with.
    const c = await decodeCover(plate({ w: 16, h: 16, n: 4, bbox: [0, 0, 160, 160] }))
    const out = alignCover(c, { width: 64, height: 64, bbox: [0, 0, 160, 160], crs: 'EPSG:32633' })
    const hist = [0, 0, 0, 0]
    for (const v of out.labels) hist[v]++
    expect(hist.map((h) => h / out.labels.length)).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('refuses ground it does not cover', async () => {
    const c = await decodeCover(plate({ bbox: [0, 0, 40, 40] }))
    expect(() => alignCover(c, { width: 8, height: 8, bbox: [1000, 1000, 1040, 1040], crs: 'EPSG:32633' }))
      .toThrow(/different ground/)
  })

  it('refuses a different projection rather than guessing', async () => {
    const c = await decodeCover(plate({ crs: 'EPSG:32633' }))
    expect(() => alignCover(c, { width: 8, height: 8, bbox: [0, 0, 40, 40], crs: 'EPSG:3857' }))
      .toThrow(/EPSG:32633/)
  })

  it('says so when neither side has an extent to match on', async () => {
    const c = await decodeCover(plate({ w: 4, h: 4, bbox: null }))
    expect(() => alignCover(c, { width: 8, height: 8, bbox: null, crs: 'EPSG:none' }))
      .toThrow(/no way to line them up/)
  })
})

describe('masks', () => {
  const classes = [0, 1, 2].map((i) => ({ index: i, name: `Class ${i}`, color: '#000000', share: 1 / 3 }))

  it('treats zero as every class', () => {
    expect(maskHasClass(ALL_CLASSES, 0)).toBe(true)
    expect(maskHasClass(ALL_CLASSES, 2)).toBe(true)
    expect(describeMask(ALL_CLASSES, classes)).toBe('All classes')
  })

  it('selects and deselects one class at a time', () => {
    const one = toggleClass(ALL_CLASSES, 1, 3)
    expect(one).toBe(classBit(1))
    expect(maskHasClass(one, 1)).toBe(true)
    expect(maskHasClass(one, 0)).toBe(false)
    expect(describeMask(one, classes)).toBe('Class 1')

    const two = toggleClass(one, 2, 3)
    expect(describeMask(two, classes)).toBe('2 of 3 classes')
  })

  it('collapses both ends of the range back to unfiltered', () => {
    // Every class ticked means the same thing as none ticked, and so does the
    // last one being unticked. One canonical value, or the rebuild key sees a
    // change where there is none.
    let m = toggleClass(ALL_CLASSES, 0, 3)
    m = toggleClass(m, 1, 3)
    expect(toggleClass(m, 2, 3)).toBe(ALL_CLASSES)
    expect(toggleClass(toggleClass(ALL_CLASSES, 0, 3), 0, 3)).toBe(ALL_CLASSES)
  })
})

describe('the edges of a 32-bit mask', () => {
  /*
   * The two counts where the obvious arithmetic breaks, in opposite directions.
   *
   * `(1 << count) - 1` goes negative at 31 — `&` coerces it to int32 while
   * `===` compares the uncoerced number, so ticking every class stopped
   * registering as "all of them". At 32 the shift wraps to `1 << 0`, the mask
   * comes out as 0, and every selection read as unfiltered: picking one class
   * turned the filter off entirely.
   */
  for (const n of [2, 16, 30, 31, MAX_CLASSES]) {
    it(`holds at ${n} classes`, () => {
      // One class selected stays one class selected.
      const one = toggleClass(ALL_CLASSES, 0, n)
      expect(one, 'selecting one class must not read as unfiltered').not.toBe(ALL_CLASSES)
      expect(maskHasClass(one, 0)).toBe(true)
      if (n > 1) expect(maskHasClass(one, 1)).toBe(false)

      // Every class selected means the same thing as none, and must say so with
      // the same value, or the rebuild key sees a change where there is none.
      let all = ALL_CLASSES
      for (let i = 0; i < n; i++) all = toggleClass(all, i, n)
      expect(all, 'every class ticked must collapse to unfiltered').toBe(ALL_CLASSES)

      // And back off again.
      expect(toggleClass(one, 0, n)).toBe(ALL_CLASSES)
    })
  }

  it('gives the top class a bit of its own', () => {
    // 1 << 31 is negative, and that is fine — the mask is a bit field, not a
    // count. What matters is that it round-trips.
    const top = toggleClass(ALL_CLASSES, MAX_CLASSES - 1, MAX_CLASSES)
    expect(classBit(MAX_CLASSES - 1)).toBe(-2147483648)
    expect(maskHasClass(top, MAX_CLASSES - 1)).toBe(true)
    expect(maskHasClass(top, 0)).toBe(false)
  })
})

describe('suggestInks', () => {
  it('deals a distinct mark per class, steepest ground first', () => {
    const classes = [0, 1, 2].map((i) => ({ index: i, name: `Class ${i}`, color: '#123456', share: 1 / 3 }))
    const plan = suggestInks(classes, { 0: 0.1, 1: 0.9, 2: 0.5 })
    expect(plan.map((x) => x.classIndex)).toEqual([1, 2, 0])
    expect(new Set(plan.map((x) => x.mode)).size).toBe(3)
  })
})
