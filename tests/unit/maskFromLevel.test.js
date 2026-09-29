import { describe, expect, it } from 'vitest'
import { levelSource, maskFromLevel, thresholdLevel } from '../../src/utils/maskFromLevel.js'
import { combineMask } from '../../src/utils/maskLayers.js'

// A 4 × 1 ramp, and a NoData cell at the top end.
const ramp = new Float32Array([0, 0.25, 0.5, 1])
const valid = new Uint8Array([1, 1, 1, 0])

describe('maskFromLevel', () => {
  it('takes the ground between the two levels, ends included', () => {
    const { data, on } = maskFromLevel(ramp, null, 4, 1, { lo: 0.25, hi: 0.5 })
    expect([...data]).toEqual([0, 1, 1, 0])
    expect(on).toBe(2)
  })

  it('reads the levels in either order', () => {
    const a = maskFromLevel(ramp, null, 4, 1, { lo: 0.5, hi: 0.25 })
    expect([...a.data]).toEqual([0, 1, 1, 0])
  })

  it('never takes NoData', () => {
    const { data } = maskFromLevel(ramp, valid, 4, 1, { lo: 0, hi: 1 })
    expect([...data]).toEqual([1, 1, 1, 0])
  })

  it('writes into a buffer it is given, and clears what it held', () => {
    const out = new Uint8Array([1, 1, 1, 1])
    const { data } = thresholdLevel(ramp, null, 0.9, 1, out)
    expect(data).toBe(out)
    expect([...out]).toEqual([0, 0, 0, 1])
  })

  it('smooths the heights before the cut', () => {
    // One spike in flat ground: a cut above the floor finds it unsmoothed and
    // loses it once the blur has spread it out.
    const w = 9
    const flat = new Float32Array(w * w).fill(0.2)
    flat[4 * w + 4] = 1
    expect(maskFromLevel(flat, null, w, w, { lo: 0.5, hi: 1 }).on).toBe(1)
    expect(maskFromLevel(flat, null, w, w, { lo: 0.5, hi: 1, smooth: 2 }).on).toBe(0)
    expect(levelSource(flat, null, w, w, 0)).toBe(flat)
  })
})

describe('combineMask', () => {
  const base = new Uint8Array([1, 1, 0, 0])
  const region = new Uint8Array([1, 0, 1, 0])
  const run = (mode) => {
    const out = new Uint8Array(4)
    const on = combineMask(out, base, region, mode)
    return [[...out], on]
  }

  it('replaces', () => expect(run('replace')).toEqual([[1, 0, 1, 0], 2]))
  it('adds', () => expect(run('add')).toEqual([[1, 1, 1, 0], 3]))
  it('subtracts', () => expect(run('subtract')).toEqual([[0, 1, 0, 0], 1]))
  it('intersects', () => expect(run('intersect')).toEqual([[1, 0, 0, 0], 1]))
})
