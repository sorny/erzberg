/**
 * Geomorphons on shapes whose answer is not in doubt: a cone is a peak at its
 * top, a bowl a pit at its bottom, a tilted plane slope, a level plane flat, a
 * roof a ridge along its crest and a trough a valley along its floor.
 */
import { describe, expect, it } from 'vitest'
import { ALL_FORMS, LANDFORMS, formMaskHas, geomorphons } from '../../src/utils/landforms'

const N = 41, C = 20
const form = (f) => {
  const h = new Float32Array(N * N)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) h[r * N + c] = f(r - C, c - C)
  return LANDFORMS[geomorphons(h, null, N, N, 10, 10, 150, 1)[C * N + C]].id
}

describe('geomorphons', () => {
  it('names the six plain shapes', () => {
    expect(form((y, x) => -Math.hypot(x, y) * 5)).toBe('Peak')
    expect(form((y, x) => Math.hypot(x, y) * 5)).toBe('Pit')
    expect(form((y) => y * 5)).toBe('Slope')
    expect(form(() => 0)).toBe('Flat')
    expect(form((y, x) => -Math.abs(x) * 5)).toBe('Ridge')
    expect(form((y, x) => Math.abs(x) * 5)).toBe('Valley')
  })

  it('reads a slope under the flatness angle as flat', () => {
    // 0.5 m in 10 m is 2.9°.
    const h = new Float32Array(N * N)
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) h[r * N + c] = r * 0.5
    expect(LANDFORMS[geomorphons(h, null, N, N, 10, 10, 150, 5)[C * N + C]].id).toBe('Flat')
    expect(LANDFORMS[geomorphons(h, null, N, N, 10, 10, 150, 1)[C * N + C]].id).toBe('Slope')
  })

  it('skips cells outside the mask', () => {
    const h = new Float32Array(N * N), mask = new Uint8Array(N * N)
    expect(geomorphons(h, mask, N, N, 10, 10, 150, 1)[0]).toBe(255)
  })
})

describe('landform masks', () => {
  it('lets everything through at 0 and only the chosen bits otherwise', () => {
    expect(LANDFORMS.every((_, k) => formMaskHas(0, k))).toBe(true)
    const ridges = 1 << LANDFORMS.findIndex((f) => f.id === 'Ridge')
    expect(LANDFORMS.filter((_, k) => formMaskHas(ridges, k)).map((f) => f.id)).toEqual(['Ridge'])
    expect(ALL_FORMS).toBe(1023)
  })
})
