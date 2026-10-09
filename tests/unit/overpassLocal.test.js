/**
 * The local Overpass server's region: which extents it may be asked for.
 */
import { describe, it, expect } from 'vitest'
import { parsePoly, bboxInside } from '../../src/utils/overpassLocal'

// An L-shaped region, as Geofabrik writes it, with a square hole in its foot.
// The L's box holds the notch at the top right, which the region does not.
const POLY = `l-shape
1
   0.000000E+00   0.000000E+00
   1.000000E+01   0.000000E+00
   1.000000E+01   4.000000E+00
   4.000000E+00   4.000000E+00
   4.000000E+00   1.000000E+01
   0.000000E+00   1.000000E+01
END
!2
   6.000000E+00   1.000000E+00
   8.000000E+00   1.000000E+00
   8.000000E+00   3.000000E+00
   6.000000E+00   3.000000E+00
END
END
`

describe('parsePoly', () => {
  it('reads the rings and the holes, in scientific notation', () => {
    const p = parsePoly(POLY)
    expect(p.outer).toHaveLength(1)
    expect(p.outer[0]).toHaveLength(6)
    expect(p.outer[0][1]).toEqual([10, 0])
    expect(p.holes).toHaveLength(1)
  })
})

describe('bboxInside', () => {
  const p = parsePoly(POLY)

  it('takes an extent wholly inside', () => {
    expect(bboxInside(p, [1, 1, 3, 8])).toBe(true)
    expect(bboxInside(p, [1, 0.5, 5, 3.5])).toBe(true)
  })

  it('refuses one that reaches past the boundary', () => {
    expect(bboxInside(p, [3, 3, 11, 3.5])).toBe(false)
    expect(bboxInside(p, [-1, 1, 2, 2])).toBe(false)
  })

  it('refuses one in the notch, inside the region\'s box but not the region', () => {
    expect(bboxInside(p, [5, 5, 9, 9])).toBe(false)
  })

  it('refuses one whose corners are all inside but whose side crosses a bay', () => {
    // A U: two arms joined at the bottom, the bay between them open at the top.
    const u = parsePoly('u\n1\n0 0\n10 0\n10 10\n7 10\n7 3\n3 3\n3 10\n0 10\nEND\nEND\n')
    expect(bboxInside(u, [1, 1, 9, 9])).toBe(false)
    expect(bboxInside(u, [1, 1, 9, 2])).toBe(true)
  })

  it('refuses one that holds a hole, or lies in one', () => {
    expect(bboxInside(p, [5, 0.5, 9, 3.5])).toBe(false)
    expect(bboxInside(p, [6.5, 1.5, 7.5, 2.5])).toBe(false)
  })
})
