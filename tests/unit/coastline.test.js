import { describe, it, expect } from 'vitest'
import { joinChains, seaRings } from '../../src/utils/coastline'

const BOX = [0, 0, 10, 10]
const area = (r) => {
  let a = 0
  for (let i = 0; i + 3 < r.length; i += 2) a += r[i] * r[i + 3] - r[i + 2] * r[i + 1]
  return a / 2
}

describe('joinChains', () => {
  it('joins ways end to start and finds closed rings', () => {
    const { closed, open } = joinChains([[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 0], [5, 5, 6, 6]])
    expect(closed).toHaveLength(1)
    expect(open).toHaveLength(1)
  })
})

describe('seaRings', () => {
  it('puts the sea on the right of a coastline crossing the extent', () => {
    // Running east: the land is on the left, to the north.
    const rings = seaRings([[-1, 5, 11, 5]], BOX)
    expect(rings).toHaveLength(1)
    const r = rings[0]
    // The southern half, walked clockwise (negative area with y up).
    expect(Math.abs(area(r))).toBeCloseTo(50, 6)
    expect(area(r)).toBeLessThan(0)
    for (let i = 1; i < r.length; i += 2) expect(r[i]).toBeLessThanOrEqual(5 + 1e-9)
  })

  it('turns the other way round for a coastline running west', () => {
    const [r] = seaRings([[11, 5, -1, 5]], BOX)
    for (let i = 1; i < r.length; i += 2) expect(r[i]).toBeGreaterThanOrEqual(5 - 1e-9)
  })

  it('takes an extent the coast never crosses, with an island in it, as sea round the island', () => {
    const island = [4, 4, 6, 4, 6, 6, 4, 6, 4, 4]   // anticlockwise: land on the left
    const rings = seaRings([island], BOX)
    expect(rings).toHaveLength(2)
    expect(Math.abs(area(rings[0]))).toBeCloseTo(100, 6)
  })

  it('draws no sea where there is no coastline', () => {
    expect(seaRings([], BOX)).toEqual([])
  })

  it('closes a bay between two crossing pieces', () => {
    // A coast entering from the west and leaving to the west again, around a bay
    // that opens to the west: land on the left of each piece.
    const ring = seaRings([[-1, 8, 5, 8, 5, 2, -1, 2]], BOX)
    expect(ring).toHaveLength(1)
    // The water is the bay's inside: 5 × 6, the part west of x = 5.
    expect(Math.abs(area(ring[0]))).toBeCloseTo(30, 6)
  })
})
