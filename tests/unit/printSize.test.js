import { describe, expect, it } from 'vitest'
import { paperAspect, printPixels } from '../../src/utils/frame'
import { withTextChunks } from '../../src/utils/pngExport'

describe('printPixels', () => {
  // The frame is exactly 1:√2, and 210 × 297 mm is a rounding of it, so the
  // height is a pixel from the A4 figures.
  it('is A4 at 300 DPI for a 210 mm portrait ISO sheet', () => {
    expect(printPixels(210, 300, paperAspect('iso', false))).toEqual({ w: 2480, h: 3507 })
  })
  it('follows the aspect for a landscape sheet', () => {
    expect(printPixels(297, 300, paperAspect('iso', true))).toEqual({ w: 3508, h: 2481 })
  })
})

describe('the pHYs chunk', () => {
  // A minimal PNG: signature and a 13-byte IHDR, enough for the splice.
  const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...new Array(13).fill(0), 0, 0, 0, 0,
    0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82])

  it('goes after IHDR with the density in pixels per metre', () => {
    const out = withTextChunks(png, [], 300)
    const dv = new DataView(out.buffer)
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs')
    expect(dv.getUint32(41)).toBe(11811)
    expect(dv.getUint32(45)).toBe(11811)
    expect(out[49]).toBe(1)
  })
  it('is left out at 0 DPI', () => {
    expect(withTextChunks(png, [], 0)).toEqual(png)
  })
})
