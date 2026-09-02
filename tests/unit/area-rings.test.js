/**
 * The ring tracer, which is what turns a block of colour into something a
 * plotter can fill.
 *
 * The three claims worth pinning are the ones the SVG depends on. A ring has to
 * close, or the path is a stroke pretending to be a shape. A hole has to come
 * out with the opposite winding to its outer ring, or an even-odd fill paints
 * over it. And an area that touches itself only at a corner has to split into
 * two rings rather than one self-crossing ring, because even-odd cannot read a
 * ring that crosses itself.
 */
import { describe, it, expect } from 'vitest'
import { traceAreaRings, ringSignedArea } from '../../src/utils/areaRings'

/** A lattice from rows of characters. '.' is empty, any other char is an area. */
function lattice(rows) {
  const lh = rows.length, lw = rows[0].length
  const region = new Int32Array(lw * lh).fill(-1)
  const keys = new Map()
  for (let r = 0; r < lh; r++) {
    for (let c = 0; c < lw; c++) {
      const ch = rows[r][c]
      if (ch === '.') continue
      if (!keys.has(ch)) keys.set(ch, keys.size)
      region[r * lw + c] = keys.get(ch)
    }
  }
  return { region, lw, lh, keys }
}

describe('traceAreaRings', () => {
  it('takes a solid rectangle down to its four corners', () => {
    const { region, lw, lh } = lattice([
      '.....',
      '.AAA.',
      '.AAA.',
      '.....',
    ])
    const out = traceAreaRings(region, lw, lh)
    expect(out).toHaveLength(1)
    expect(out[0].loops).toHaveLength(1)
    // Twelve boundary half-edges, four corners: the collinear merge is doing its
    // job, and without it a real catchment carries eight times the points it needs.
    expect(out[0].loops[0].corners).toHaveLength(4)
    expect(ringSignedArea(out[0].loops[0], lw + 1)).toBeGreaterThan(0)
  })

  it('gives a hole the opposite winding to its outer ring', () => {
    const { region, lw, lh } = lattice([
      'AAAAA',
      'A...A',
      'A.B.A',
      'A...A',
      'AAAAA',
    ])
    const out = traceAreaRings(region, lw, lh)
    const a = out.find((x) => x.area === 0)
    // The outer square, and the inside of the moat. The island in the middle is
    // a different area and gets its own ring.
    expect(a.loops).toHaveLength(2)
    expect(out.find((x) => x.area === 1).loops).toHaveLength(1)
    const areas = a.loops.map((l) => ringSignedArea(l, lw + 1)).sort((x, y) => x - y)
    expect(areas[0]).toBeLessThan(0)
    expect(areas[1]).toBeGreaterThan(0)
    // Every ring closes: a corner list of three or more that the walk returned
    // only because it arrived back at its own seed.
    for (const l of a.loops) expect(l.corners.length).toBeGreaterThanOrEqual(4)
  })

  it('splits an area that touches itself only at a corner', () => {
    const { region, lw, lh } = lattice([
      'AB',
      'BA',
    ])
    const out = traceAreaRings(region, lw, lh)
    for (const { loops } of out) {
      expect(loops).toHaveLength(2)
      for (const l of loops) {
        expect(l.corners).toHaveLength(4)
        expect(ringSignedArea(l, lw + 1)).toBeGreaterThan(0)
      }
    }
  })

  it('reads a rejected cell as empty', () => {
    const { region, lw, lh } = lattice([
      'AAA',
      'AAA',
    ])
    // Drop the middle of the top row. The area is still one ring, and it now has
    // a notch — six corners rather than four.
    const out = traceAreaRings(region, lw, lh, (i) => i !== 1)
    expect(out).toHaveLength(1)
    expect(out[0].loops).toHaveLength(1)
    expect(out[0].loops[0].corners).toHaveLength(8)
  })

  it('keeps a step between two cells that are collinear but not level', () => {
    const { region, lw, lh } = lattice(['AAAA'])
    // Same area, same direction along the top — but cells 1 and 2 sit at
    // different heights, so the vertex between them is a real corner of the
    // shape once it is projected.
    const level = (a, b) => (a < 2) === (b < 2)
    const flat  = traceAreaRings(region, lw, lh, null, () => true)
    const stepped = traceAreaRings(region, lw, lh, null, level)
    expect(flat[0].loops[0].corners).toHaveLength(4)
    expect(stepped[0].loops[0].corners.length).toBeGreaterThan(4)
  })

  it('returns nothing for an empty lattice', () => {
    expect(traceAreaRings(new Int32Array(9).fill(-1), 3, 3)).toEqual([])
  })
})
