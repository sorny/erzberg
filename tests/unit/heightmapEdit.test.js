/**
 * The `rings` shape — a clip taken from a map feature.
 *
 * Edit Mode already had two shapes, both hand-drawn and both a single ring.
 * A municipality is neither: it has holes (an enclave, a lake that belongs to
 * the neighbour), it is sometimes several disjoint pieces, and it came from a
 * survey rather than from a pointer.
 *
 * The case worth holding down is the hole. Filling a feature's rings one at a
 * time and unioning the results paints the enclave solid, which looks correct
 * until you know the place — so `fillRings` collects crossings from every ring
 * into one scanline pass.
 */
import { describe, it, expect } from 'vitest'
import {
  buildEditMask, describeEdit, effectiveBounds, isUsableShape, shapeBounds, shapeRings,
} from '../../src/utils/heightmapEdit'

const W = 100, H = 100
const ring = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]

/** A box with a square hole in the middle of it. */
const holed = {
  type: 'rings',
  rings: [ring(20, 20, 80, 80), ring(40, 40, 60, 60)],
  name: 'Jakomini',
}

const countOn = (m) => m.reduce((n, v) => n + (v ? 1 : 0), 0)

describe('isUsableShape', () => {
  it('accepts a rings shape with a real ring in it', () => {
    expect(isUsableShape(holed)).toBe(true)
  })

  it('rejects one with nothing that encloses anything', () => {
    expect(isUsableShape({ type: 'rings', rings: [] })).toBe(false)
    expect(isUsableShape({ type: 'rings', rings: [[0, 0, 1, 1]] })).toBe(false)
  })
})

describe('shapeRings', () => {
  it('lists every ring for a rings shape', () => {
    expect(shapeRings(holed)).toHaveLength(2)
  })

  it('wraps the single-ring kinds so callers need no special case', () => {
    expect(shapeRings({ type: 'lasso', points: ring(0, 0, 10, 10) })).toHaveLength(1)
    expect(shapeRings({ type: 'ellipse', cx: 5, cy: 5, rx: 2, ry: 2 })).toHaveLength(0)
  })
})

describe('shapeBounds', () => {
  it('spans every ring, not just the first', () => {
    const two = { type: 'rings', rings: [ring(10, 10, 20, 20), ring(70, 60, 90, 80)] }
    expect(shapeBounds(two)).toEqual({ x: 10, y: 10, w: 80, h: 70 })
  })
})

describe('buildEditMask with rings', () => {
  const edit = { rect: { x: 0, y: 0, w: W, h: H }, shape: holed, feather: 0 }

  it('crops to the outline and keeps what is inside it', () => {
    const out = buildEditMask(edit, null, W, H)
    expect(out.x).toBe(20)
    expect(out.y).toBe(20)
    // 61 and not 60: `effectiveBounds` adds a pixel on the far side so the
    // boundary cell itself survives the crop.
    expect(out.w).toBe(61)
    expect(out.h).toBe(61)
    // A point between the outer ring and the hole.
    expect(out.mask[10 * out.w + 10]).toBe(1)
  })

  it('cuts the hole instead of filling it', () => {
    // The enclave. Filling each ring separately and unioning would paint this
    // solid, and it would look deliberate.
    const out = buildEditMask(edit, null, W, H)
    const cx = 50 - out.x, cy = 50 - out.y
    expect(out.mask[cy * out.w + cx], 'the middle is the hole').toBe(0)
    // 60² outer minus 20² inner.
    expect(countOn(out.mask)).toBeCloseTo(3600 - 400, -2)
  })

  it('keeps two disjoint pieces as two pieces', () => {
    const split = {
      type: 'rings',
      rings: [ring(10, 10, 30, 30), ring(70, 70, 90, 90)],
    }
    const out = buildEditMask({ rect: { x: 0, y: 0, w: W, h: H }, shape: split, feather: 0 }, null, W, H)
    expect(out.mask[(15 - out.y) * out.w + (15 - out.x)]).toBe(1)
    expect(out.mask[(80 - out.y) * out.w + (80 - out.x)]).toBe(1)
    // The gap between them stays out.
    expect(out.mask[(50 - out.y) * out.w + (50 - out.x)]).toBe(0)
  })

  it('still narrows to the crop rect when there is one', () => {
    const cropped = { rect: { x: 0, y: 0, w: 50, h: H }, shape: holed, feather: 0 }
    expect(effectiveBounds(cropped, W, H).w).toBe(30)   // 20…50
  })
})

describe('describeEdit', () => {
  it('names the feature rather than saying "rings"', () => {
    // "1024×768 · rings" tells the reader about the data structure. The name
    // of the place tells them what they clipped to.
    const out = describeEdit({ rect: { x: 0, y: 0, w: W, h: H }, shape: holed, feather: 0 }, W, H)
    expect(out).toContain('Jakomini')
    expect(out).not.toContain('rings')
  })

  it('falls back when the shape carries no name', () => {
    const out = describeEdit(
      { rect: { x: 0, y: 0, w: W, h: H }, shape: { type: 'rings', rings: [ring(0, 0, 9, 9)] }, feather: 0 },
      W, H,
    )
    expect(out).toContain('feature')
  })
})
