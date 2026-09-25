import { describe, expect, it } from 'vitest'
import { chainSegments } from '../../src/utils/chainSegments'

/** Flat 2D segments [x0, y0, x1, y1, …] from a list of [a, b] point pairs. */
const flat = (pairs) => new Float64Array(pairs.flatMap(([a, b]) => [...a, ...b]))

/** The strokes a chaining describes, each as its list of points in walk order. */
function strokes(pairs, { order, flip, start }) {
  const out = []
  for (let k = 0; k < order.length; k++) {
    const [a, b] = pairs[order[k]]
    const [p, q] = flip[k] ? [b, a] : [a, b]
    if (start[k]) out.push([p])
    out[out.length - 1].push(q)
  }
  return out
}

describe('chainSegments', () => {
  it('walks a shuffled, partly reversed line as one stroke', () => {
    // A line 0 → 4 along x, cut into four pieces, listed out of order with two
    // of them backwards — the way marching squares hands over a contour.
    const pairs = [[[2, 0], [3, 0]], [[1, 0], [0, 0]], [[3, 0], [4, 0]], [[2, 0], [1, 0]]]
    const got = strokes(pairs, chainSegments(flat(pairs), 2))
    expect(got).toHaveLength(1)
    const xs = got[0].map(([x]) => x)
    // Either direction is one stroke; what matters is that it is continuous.
    expect(xs[0] === 0 ? xs : xs.reverse()).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps separate lines separate, and visits every segment once', () => {
    const pairs = [[[0, 0], [1, 0]], [[5, 5], [6, 5]], [[1, 0], [2, 0]], [[6, 5], [7, 5]]]
    const c = chainSegments(flat(pairs), 2)
    expect(strokes(pairs, c)).toHaveLength(2)
    expect([...c.order].sort()).toEqual([0, 1, 2, 3])
  })

  it('closes a ring into one stroke that ends where it began', () => {
    const pairs = [[[0, 0], [1, 0]], [[1, 1], [0, 1]], [[1, 0], [1, 1]], [[0, 1], [0, 0]]]
    const got = strokes(pairs, chainSegments(flat(pairs), 2))
    expect(got).toHaveLength(1)
    expect(got[0][0]).toEqual(got[0][got[0].length - 1])
  })
})
