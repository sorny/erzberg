import { describe, expect, it } from 'vitest'
import { bandMask, bandRgba, scaleBand } from '../../src/utils/bandUse'

describe('a band as imagery or a mask', () => {
  it('stretches to 0–1, resamples, and keeps NoData empty', () => {
    const { values, min, max } = scaleBand(new Float32Array([10, 20, -9999, 30]), 2, 2, 4, 4, -9999)
    expect([min, max]).toEqual([10, 30])
    expect(values.length).toBe(16)
    expect(values[0]).toBe(0)
    expect(values[15]).toBe(1)
    expect(Number.isNaN(values[8])).toBe(true)
  })

  it('makes a grey image and a mask from the values', () => {
    const v = new Float32Array([0, 0.49, 0.5, NaN])
    const rgba = bandRgba(v)
    expect(Array.from(rgba.subarray(8, 12))).toEqual([128, 128, 128, 255])
    expect(rgba[15]).toBe(0)
    expect(Array.from(bandMask(v))).toEqual([0, 0, 1, 0])
  })
})
