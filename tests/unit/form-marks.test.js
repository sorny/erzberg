/**
 * Loxodromes, Breaklines, Surface Network, Flow Time and Prominence, and the
 * extensions to Contours, Lines, Engraving, Stream Network and Bitplane, on small
 * synthetic plates whose answers are known.
 */
import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const W = 96
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false, resolution: 1 }
const plate = (f) => {
  const px = new Float32Array(W * W)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = f(x, y)
  return buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0)
}
const cone = plate((x, y) => Math.max(0, 1 - Math.hypot(x - 48, y - 48) / 44))
const layers = (t, p) => buildLineGeometry(t, { ...p0, ...p })
const layer = (t, p, id) => layers(t, p).find((l) => l.id === id)
const count = (l) => (l ? l.positions.length / 6 : 0)
/** Each segment as grid-space ends: [c0, r0, c1, r1, y0, y1]. */
const segs = (t, l) => {
  const out = []
  for (let i = 0; i < l.positions.length; i += 6) {
    const P = l.positions
    out.push([(P[i] + t.halfW) / t.scl, (P[i + 2] + t.halfH) / t.scl, (P[i + 3] + t.halfW) / t.scl, (P[i + 5] + t.halfH) / t.scl, P[i + 1], P[i + 4]])
  }
  return out
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
/** The angle between a segment and the cone's fall line, in degrees, 0–90. */
const toFallLine = ([c0, r0, c1, r1]) => {
  const mc = (c0 + c1) / 2 - 48, mr = (r0 + r1) / 2 - 48, dc = c1 - c0, dr = r1 - r0
  const cos = Math.abs(mc * dc + mr * dr) / (Math.hypot(mc, mr) * Math.hypot(dc, dr) || 1)
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI
}
const onSlope = (s) => { const r = Math.hypot((s[0] + s[2]) / 2 - 48, (s[1] + s[3]) / 2 - 48); return r > 8 && r < 38 }

describe('Loxodromes', () => {
  it('crosses the contours of a cone at the set angle', () => {
    for (const angle of [30, 60]) {
      const l = layer(cone, { enabledLoxo: true, angleLoxo: angle, spacingLoxo: 4, radiusLoxo: 0 }, 'Loxo')
      expect(l.note.lines).toBeGreaterThan(5)
      expect(Math.abs(median(segs(cone, l).filter(onSlope).map(toFallLine)) - angle)).toBeLessThan(6)
    }
  })

  it('turns closer to the fall line for a steeper grade', () => {
    const at = (grade) => median(segs(cone, layer(cone, { enabledLoxo: true, holdLoxo: 'grade', gradeLoxo: grade, spacingLoxo: 4, radiusLoxo: 0 }, 'Loxo')).filter(onSlope).map(toFallLine))
    expect(at(40)).toBeGreaterThan(at(150) + 10)
  })

  it('turns the other way with Turn left', () => {
    const turn = (dir) => {
      const l = layer(cone, { enabledLoxo: true, angleLoxo: 60, turnLoxo: dir, spacingLoxo: 4, radiusLoxo: 0 }, 'Loxo')
      // The sign of the cross product of the outward radius and the stroke, read
      // with each stroke pointed downhill.
      let s = 0
      for (const [c0, r0, c1, r1, y0, y1] of segs(cone, l)) {
        const down = y1 < y0 ? 1 : -1
        s += Math.sign(((c0 + c1) / 2 - 48) * (r1 - r0) * down - ((r0 + r1) / 2 - 48) * (c1 - c0) * down)
      }
      return s
    }
    expect(Math.sign(turn('right'))).toBe(-Math.sign(turn('left')))
  })
})

describe('Breaklines', () => {
  // A plain, a scarp across x = 40…56, and a plateau.
  const scarp = plate((x) => 0.2 + 0.6 / (1 + Math.exp(-(x - 48) / 3)))
  it('puts the convex break at the top of the scarp and the concave break at its foot', () => {
    const ls = layers(scarp, { enabledBreaks: true, radiusBreaks: 2, minLengthBreaks: 4, minSlopeBreaks: 1 })
    const cx = (id) => median(segs(scarp, ls.find((l) => l.id === id)).map((s) => (s[0] + s[2]) / 2))
    expect(cx('Breaks-Convex')).toBeGreaterThan(50)
    expect(cx('Breaks-Concave')).toBeLessThan(46)
  })

  it('draws only the pens that are on', () => {
    const ids = layers(scarp, { enabledBreaks: true, concaveBreaks: false }).map((l) => l.id)
    expect(ids).toContain('Breaks-Convex')
    expect(ids).not.toContain('Breaks-Concave')
  })
})

describe('Surface Network', () => {
  const twin = plate((x, y) => 0.1 + 0.8 * Math.exp(-((x - 30) ** 2 + (y - 48) ** 2) / 120) + 0.7 * Math.exp(-((x - 66) ** 2 + (y - 48) ** 2) / 120))
  it('finds the col between two summits and joins it to both', () => {
    const ls = layers(twin, { enabledMorse: true, radiusMorse: 2 })
    const ridges = ls.find((l) => l.id === 'Morse-Ridges')
    expect(ridges.note).toEqual({ cols: 1, summits: 2 })
    const xs = segs(twin, ridges).flatMap((s) => [s[0], s[2]])
    expect(Math.min(...xs)).toBeLessThan(33)
    expect(Math.max(...xs)).toBeGreaterThan(63)
    expect(count(ls.find((l) => l.id === 'Morse-Courses'))).toBeGreaterThan(0)
    expect(count(ls.find((l) => l.id === 'Morse-Points'))).toBeGreaterThan(0)
  })

  it('drops a col of low persistence', () => {
    // No col left: an empty layer is not returned at all.
    const ridges = layer(twin, { enabledMorse: true, radiusMorse: 2, persistenceMorse: 0.9 }, 'Morse-Ridges')
    expect(count(ridges)).toBe(0)
  })
})

describe('Flow Time', () => {
  it('rings a cone, the slowest ground highest', () => {
    const l = layer(cone, { enabledFlowTime: true, levelsFlowTime: 8, radiusFlowTime: 0 }, 'FlowTime')
    expect(l.note.levels).toBe(8)
    expect(count(l)).toBeGreaterThan(20)
    // On a cone every drop runs straight down, so a line is a ring round the top.
    const rs = segs(cone, l).map((s) => Math.hypot((s[0] + s[2]) / 2 - 48, (s[1] + s[3]) / 2 - 48))
    expect(Math.max(...rs)).toBeLessThan(45)
  })
})

describe('Contours: auxiliary contours and the crowding cut', () => {
  const gentle = plate((x, y) => Math.max(0, 1 - Math.hypot(x - 48, y - 48) / 60) * 0.3)
  it('draws auxiliary contours only where the contours lie far apart', () => {
    const near = layer(gentle, { enabledContours: true, intervalContours: 3, auxContours: true, auxGapContours: 4 }, 'Contours-Aux')
    const far = layer(gentle, { enabledContours: true, intervalContours: 3, auxContours: true, auxGapContours: 400 }, 'Contours-Aux')
    expect(count(near)).toBeGreaterThan(0)
    expect(count(far)).toBe(0)
    expect(layer(gentle, { enabledContours: true, intervalContours: 3 }, 'Contours-Aux')).toBeUndefined()
  })

  it('cuts minor contours where they crowd and keeps the majors', () => {
    const base = { enabledContours: true, intervalContours: 1, majorIntervalContours: 5 }
    const all = layers(cone, base), cut = layers(cone, { ...base, crowdContours: true, crowdGapContours: 3 })
    const n = (ls, id) => count(ls.find((l) => l.id === id))
    expect(n(cut, 'Contours-Minor')).toBeLessThan(n(all, 'Contours-Minor') * 0.5)
    expect(n(cut, 'Contours-Major')).toBe(n(all, 'Contours-Major'))
  })
})

describe('Contours: depression ticks', () => {
  // A ring wall round a crater whose floor lies below the plain outside.
  const crater = plate((x, y) => {
    const r = Math.hypot(x - 48, y - 48)
    return 0.3 + 0.5 * Math.exp(-((r - 26) ** 2) / 60) - 0.25 * Math.exp(-(r ** 2) / 120)
  })
  const base = { enabledContours: true, intervalContours: 8 }
  // The same chained contours with the ticks spaced too far apart to appear.
  const none = { ...base, depressionContours: true, tickSpacingContours: 1e6 }
  const key = (q) => {
    const a = q.slice(0, 2).map((v) => v.toFixed(3)).join(), b = q.slice(2, 4).map((v) => v.toFixed(3)).join()
    return a < b ? a + '|' + b : b + '|' + a
  }
  const contourSegs = (t, p) => layers(t, p).filter((l) => l.id === 'Contours-Minor' || l.id === 'Contours-Major').flatMap((l) => segs(t, l))
  it('ticks the rings round a hollow, pointing down into it', () => {
    const plain = new Set(contourSegs(crater, none).map(key))
    const ticks = contourSegs(crater, { ...base, depressionContours: true, tickLengthContours: 2, tickSpacingContours: 4 })
      .filter((q) => !plain.has(key(q)))
    expect(ticks.length).toBeGreaterThan(10)
    // Inside the ring wall every ring is a depression: its ticks point at the centre.
    const inward = ticks.filter(([c0, r0, c1, r1]) => Math.hypot(c1 - 48, r1 - 48) < Math.hypot(c0 - 48, r0 - 48))
    expect(inward.length).toBe(ticks.length)
    expect(Math.max(...ticks.map(([c0, r0]) => Math.hypot(c0 - 48, r0 - 48)))).toBeLessThan(26)
  })

  it('leaves the rings round a hill alone', () => {
    expect(contourSegs(cone, { ...base, depressionContours: true }).length).toBe(contourSegs(cone, none).length)
  })
})

describe('Prominence', () => {
  const twin = plate((x, y) => 0.1 + 0.8 * Math.exp(-((x - 30) ** 2 + (y - 48) ** 2) / 120) + 0.5 * Math.exp(-((x - 66) ** 2 + (y - 48) ** 2) / 120))
  it('outlines the lower summit at its key col and the higher one at the plain', () => {
    const ls = layers(twin, { enabledProm: true, radiusProm: 0, minProminenceProm: 0.05 })
    const out = ls.find((l) => l.id === 'Prom')
    expect(out.note).toEqual({ summits: 2 })
    // The key col lies on the line between the summits, where the sum dips lowest.
    const h = (x) => 0.1 + 0.8 * Math.exp(-((x - 30) ** 2) / 120) + 0.5 * Math.exp(-((x - 66) ** 2) / 120)
    let colX = 30
    for (let x = 30; x <= 66; x += 0.01) if (h(x) < h(colX)) colX = x
    // The lower summit's outline touches the col and stays east of it.
    const s = segs(twin, out)
    const east = s.filter((q) => q[0] > colX - 1 && q[2] > colX - 1)
    expect(east.length).toBeGreaterThan(10)
    expect(Math.min(...east.flatMap((q) => [q[0], q[2]]))).toBeLessThan(colX + 1.5)
    // The higher summit's island is all the ground above the plain: it spans both.
    const xs = s.flatMap((q) => [q[0], q[2]])
    expect(Math.min(...xs)).toBeLessThan(20)
    expect(Math.max(...xs)).toBeGreaterThan(76)
    expect(count(ls.find((l) => l.id === 'Prom-Points'))).toBeGreaterThan(0)
  })

  it('drops summits below the minimum prominence', () => {
    const one = layer(twin, { enabledProm: true, radiusProm: 0, minProminenceProm: 0.9, marksProm: false }, 'Prom')
    expect(one.note).toEqual({ summits: 1 })
    expect(layers(twin, { enabledProm: true, marksProm: false }).map((l) => l.id)).not.toContain('Prom-Points')
  })
})

describe('Lines: shade fill', () => {
  it('adds lines only on the side that faces away from the sun', () => {
    const plain = segs(cone, layer(cone, { enabledLines: true, spacingLines: 6 }, 'Lines'))
    const shaded = segs(cone, layer(cone, { enabledLines: true, spacingLines: 6, shadeLines: true, sunLines: 315 }, 'Lines'))
    expect(shaded.length).toBeGreaterThan(plain.length)
    // The added rows are not on any line of the plain set.
    const rows = new Set(plain.map((s) => Math.round(s[1] * 100)))
    const added = shaded.filter((s) => !rows.has(Math.round(s[1] * 100)))
    // A sun in the north-west shades the south-east: right and down the plate.
    const se = added.filter((s) => s[0] > 48 && s[1] > 48).length
    const nw = added.filter((s) => s[0] < 48 && s[1] < 48).length
    expect(se).toBeGreaterThan(nw * 3)
  })
})

describe('Engraving: form strokes', () => {
  it('lays the first layer along the contours', () => {
    const l = layer(cone, { enabledEngrave: true, strokesEngrave: 'form', levelsEngrave: 1, gammaEngrave: 0.5, spacingEngrave: 3 }, 'Engrave')
    const a = segs(cone, l).filter(onSlope).map(toFallLine)
    expect(a.length).toBeGreaterThan(20)
    expect(median(a)).toBeGreaterThan(75)
  })
})

describe('Stream Network: banks', () => {
  // A valley down the middle of a tilted plate, so one river drains it all.
  const valley = plate((x, y) => 0.9 - 0.5 * (y / W) + 0.35 * Math.abs(x - 47.5) / 48)
  it('splits a wide river into two banks either side of its line', () => {
    const at = (width) => segs(valley, layer(valley, { enabledDag: true, thresholdDag: 2, banksDag: true, bankWidthDag: width, bankFromDag: 2 }, 'Dag'))
      .filter((s) => s[1] > 85 && s[1] < 90 && Math.abs(s[0] - 47.5) < 8).map((s) => (s[0] + s[2]) / 2)
    const two = at(0.15), one = at(0.001)
    expect(two.some((x) => x < 46.5)).toBe(true)
    expect(two.some((x) => x > 48.5)).toBe(true)
    expect(one.length).toBeGreaterThan(0)
    expect(one.every((x) => Math.abs(x - 47.5) < 1.5)).toBe(true)
  })
})

describe('Bitplane: smooth steps', () => {
  it('runs the steps off the cell edges, at the tier heights, with risers', () => {
    const steps = segs(cone, layer(cone, { enabledBitplane: true, edgeBitplane: 'smooth', tiersBitplane: 6 }, 'Bitplane-Step'))
    const flat = steps.filter((s) => Math.abs(s[4] - s[5]) < 1e-6)
    const diagonal = flat.filter((s) => Math.abs(s[2] - s[0]) > 0.05 && Math.abs(s[3] - s[1]) > 0.05)
    expect(diagonal.length).toBeGreaterThan(flat.length * 0.3)
    const heights = new Set(flat.map((s) => s[4].toFixed(4)))
    expect(heights.size).toBeLessThanOrEqual(5)
    expect(steps.some((s) => Math.abs(s[4] - s[5]) > 1 && s[0] === s[2] && s[1] === s[3])).toBe(true)
    const cells = segs(cone, layer(cone, { enabledBitplane: true, tiersBitplane: 6 }, 'Bitplane-Step'))
    expect(cells.filter((s) => Math.abs(s[2] - s[0]) > 0.05 && Math.abs(s[3] - s[1]) > 0.05).length).toBe(0)
  })
})
