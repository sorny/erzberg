/**
 * Z offset and plumb lines (builders/lift.js): a mode's marks raised above the
 * ground, and dashed verticals that tie each masked region back down to it.
 */
import { describe, expect, it } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry, layerStyle } from '../../src/utils/geometryBuilders'
import { geometryKey } from '../../src/params'
import { classBit } from '../../src/utils/coverPlate'
import { makeCopy, ownedKeys } from '../../src/utils/modeCopies'
import { buildFootprint, buildPlumb, fencePoints, liftLayer, liftOf, maskOutline, plumbPoints } from '../../src/utils/builders/lift'
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from '../../src/defaults'

const W = 64
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false,
  depthOcclusion: true, occludeBy: 'lines' }
const px = new Float32Array(W * W)
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = 0.5 + 0.2 * Math.sin(x / 7) * Math.cos(y / 9)
// Left half class 0, right half class 1.
const labels = new Uint8Array(W * W)
for (let y = 0; y < W; y++) for (let x = W / 2; x < W; x++) labels[y * W + x] = 1
const t = buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0, null,
  { labels, width: W, height: W, classColors: ['#ff0000', '#0000ff'] })
const build = (p) => buildLineGeometry(t, { ...p0, enabledContours: true, intervalContours: 4, ...p })
const layer = (geo, id) => geo.find((l) => l.id === id)
const ys = (P) => { const out = []; for (let i = 1; i < P.length; i += 3) out.push(P[i]); return out }
const relief = t.maxElev - t.minElev

describe('the Z offset', () => {
  it('is off by default for every mode, and moves the geometry', () => {
    expect(STYLE_DEF.zOffsetContours).toBe(0)
    expect(STYLE_DEF.plumbContours).toBe(false)
    expect(geometryKey({ ...p0, zOffsetContours: 1 })).not.toBe(geometryKey(p0))
    expect(geometryKey({ ...p0, plumbContours: true })).not.toBe(geometryKey(p0))
  })

  it('raises the marks by that many times the relief', () => {
    const flat = layer(build({}), 'Contours-Minor').positions
    const raised = layer(build({ zOffsetContours: 1.5 }), 'Contours-Minor').positions
    expect(raised.length).toBe(flat.length)
    for (let i = 1; i < flat.length; i += 3) expect(raised[i] - flat[i]).toBeCloseTo(1.5 * relief, 3)
    expect(liftOf({ zOffsetContours: 1.5 }, 'Contours', t)).toBeCloseTo(1.5 * relief, 6)
  })

  it('hangs no walls under raised marks', () => {
    // Walls reach the floor below the lowest ground. The raised sheet does not.
    const floor = (geo) => Math.min(...ys(layer(geo, 'Contours-Minor').curtains.positions))
    expect(floor(build({}))).toBeLessThan(t.minElev)
    expect(floor(build({ zOffsetContours: 1 }))).toBeGreaterThan(t.minElev)
  })

  it('hides its own far side with its raised ground, only inside the mask', () => {
    const geo = build({ zOffsetContours: 1, coverMaskContours: classBit(1) })
    const minor = layer(geo, 'Contours-Minor')
    const C = minor.curtains
    expect(C.indices.length).toBeGreaterThan(0)
    const flat = Math.max(...ys(layer(build({}), 'Contours-Minor').positions))
    let lo = Infinity
    for (let i = 0; i < C.positions.length; i += 3) {
      lo = Math.min(lo, C.positions[i + 1])
      expect(C.positions[i]).toBeGreaterThan(-t.scl * 1.5)
    }
    // Raised with the marks, clear of the ground below.
    expect(lo).toBeGreaterThan(flat - relief + 0.5 * relief)
    expect(layer(build({ zOffsetContours: 1, depthOcclusion: false }), 'Contours-Minor').curtains.indices.length).toBe(0)
  })

  it('leaves the skirt a mask edge stacks under the ground behind', () => {
    const mask = { coverMaskContours: classBit(1) }
    const flat = layer(build(mask), 'Contours-Minor').positions
    const raised = layer(build({ ...mask, zOffsetContours: 1 }), 'Contours-Minor').positions
    // On the ground the skirt is there, hidden by the terrain.
    expect(Math.min(...ys(flat))).toBeLessThan(t.minElev + 0.2 * relief)
    expect(raised.length).toBeLessThan(flat.length)
    expect(raised.length).toBeGreaterThan(0)
  })

  it('raises fills, the traced lattice and the label anchors with the strokes', () => {
    const res = {
      positions: new Float32Array([0, 1, 0, 1, 2, 1]),
      lids: { positions: new Float32Array([0, 1, 0]), hugsSurface: true },
      areas: { elev: new Float32Array([3, 4]) },
      labelAnchors: [{ x: 0, y: 5, z: 0 }],
    }
    const up = liftLayer(res, 10)
    expect([...up.positions]).toEqual([0, 11, 0, 1, 12, 1])
    expect(up.lids.positions[1]).toBe(11)
    expect(up.lids.hugsSurface).toBe(false)
    expect([...up.areas.elev]).toEqual([13, 14])
    expect(up.labelAnchors[0].y).toBe(15)
    // The input is left as it was.
    expect(res.positions[1]).toBe(1)
  })

  it('is a copy setting, so each copy floats at its own height', () => {
    expect(ownedKeys('Contours')).toContain('zOffsetContours')
    expect(ownedKeys('Contours')).toContain('plumbContours')
    const copy = { ...makeCopy('Contours', { ...STYLE_DEF, enabledContours: true, intervalContours: 4 }, []) }
    copy.values = { ...copy.values, zOffsetContours: 2, layerMaskContours: 0 }
    const geo = build({ modeCopies: [copy] })
    const base = Math.max(...ys(layer(geo, 'Contours-Minor').positions))
    expect(Math.min(...ys(layer(geo, 'Contours-Minor@c1').positions))).toBeGreaterThan(base)
  })
})

describe('plumb lines', () => {
  it('come only with a Z offset, as their own pen layer', () => {
    expect(layer(build({ plumbContours: true }), 'Contours-Plumb')).toBeUndefined()
    const geo = build({ zOffsetContours: 1, plumbContours: true, coverMaskContours: classBit(1) })
    const pl = layer(geo, 'Contours-Plumb')
    expect(pl.positions.length).toBeGreaterThan(0)
    expect(layerStyle('Contours-Plumb', { ...p0 }).name).toBe('Contours · Plumb lines')
    expect(layerStyle('Contours-Plumb', { ...p0 }).dash).toBe('solid')
  })

  it('run from the ground up to the raised marks, inside the mask', () => {
    const geo = build({ zOffsetContours: 1, plumbContours: true, coverMaskContours: classBit(1) })
    const P = layer(geo, 'Contours-Plumb').positions
    const y = ys(P)
    expect(Math.max(...y) - Math.min(...y)).toBeGreaterThan(relief)
    // Class 1 is the right half: every plumb line stands there.
    for (let i = 0; i < P.length; i += 3) expect(P[i]).toBeGreaterThan(-t.scl * 2)
  })

  it('pick the summit and the four outermost cells of each region', () => {
    const rows = 10, cols = 10
    const gridMask = new Uint8Array(rows * cols)
    const grid = new Float32Array(rows * cols)
    // One region of 5 × 5 cells, rows 2–6 and columns 3–7, highest at (4, 5).
    for (let r = 2; r <= 6; r++) for (let c = 3; c <= 7; c++) gridMask[r * cols + c] = 1
    grid[4 * cols + 5] = 1
    const pts = plumbPoints({ rows, cols, gridMask, grid })
    expect(pts).toContainEqual({ r: 4, c: 5 })
    expect(pts.some((q) => q.c === 3)).toBe(true)
    expect(pts.some((q) => q.c === 7)).toBe(true)
    expect(pts.some((q) => q.r === 2)).toBe(true)
    expect(pts.some((q) => q.r === 6)).toBe(true)
  })

  it('skip specks next to a large region', () => {
    const rows = 40, cols = 40
    const gridMask = new Uint8Array(rows * cols)
    for (let r = 0; r < 30; r++) for (let c = 0; c < 30; c++) gridMask[r * cols + c] = 1
    gridMask[38 * cols + 38] = 1
    const pts = plumbPoints({ rows, cols, gridMask, grid: new Float32Array(rows * cols) })
    expect(pts.every((q) => q.r < 30 && q.c < 30)).toBe(true)
  })

  it('pick the summit alone when asked', () => {
    const rows = 10, cols = 10
    const gridMask = new Uint8Array(rows * cols)
    const grid = new Float32Array(rows * cols)
    for (let r = 2; r <= 6; r++) for (let c = 3; c <= 7; c++) gridMask[r * cols + c] = 1
    grid[4 * cols + 5] = 1
    expect(plumbPoints({ rows, cols, gridMask, grid }, 'summit')).toEqual([{ r: 4, c: 5 }])
  })
})

describe('the plumb style', () => {
  // A flat plate 100 high: one point, lifted 100.
  const flat = { scl: 1, halfW: 50, halfH: 50, minElev: 0, maxElev: 100 }
  const one = (style) => buildPlumb([{ r: 50, c: 50 }], 100, flat, () => 0, [1, 0, 0], style).positions
  const segs = (P) => P.length / 6
  const vertical = (P) => {
    const out = []
    for (let i = 0; i < P.length; i += 6) if (P[i] === P[i + 3] && P[i + 2] === P[i + 5] && P[i + 1] !== P[i + 4]) out.push([P[i + 1], P[i + 4]])
    return out
  }

  it('defaults to a dashed line with a ring at each end', () => {
    const P = one()
    const v = vertical(P)
    expect(v.length).toBe(13)
    expect(v[0][0]).toBeCloseTo(0, 5)
    expect(v.at(-1)[1]).toBeCloseTo(100, 5)
    expect(segs(P)).toBe(13 + 24)
  })

  it('sets the dash and gap lengths, and draws solid at a gap of 0', () => {
    // 110 / 20 rounds to 6 dashes, stretched to fill the 100.
    const v = vertical(one({ dash: 10, gap: 10 }))
    expect(v.length).toBe(6)
    expect(v[0][1] - v[0][0]).toBeCloseTo(v[1][0] - v[0][1], 5)
    expect(vertical(one({ gap: 0 }))).toEqual([[0, 100]])
  })

  it('draws an X instead of a ring, at the ends asked for, or no marker', () => {
    expect(segs(one({ mark: 'cross' }))).toBe(13 + 4)
    const top = one({ mark: 'cross', ends: 'top' })
    expect(segs(top)).toBe(13 + 2)
    const y = []; for (let i = 13 * 6 + 1; i < top.length; i += 3) y.push(top[i])
    expect(y.every((h) => h === 100)).toBe(true)
    expect(segs(one({ ends: 'ground' }))).toBe(13 + 12)
    expect(segs(one({ size: 0 }))).toBe(13)
  })

  it('takes its own ink into the geometry, or the mode ink', () => {
    const on = { zOffsetContours: 1, plumbContours: true, coverMaskContours: classBit(1), colorContours: '#000000' }
    const C0 = layer(build(on), 'Contours-Plumb').colors
    expect([C0[0], C0[1], C0[2]]).toEqual([0, 0, 0])
    const C1 = layer(build({ ...on, plumbColorContours: '#ff0000' }), 'Contours-Plumb').colors
    expect([C1[0], C1[1], C1[2]]).toEqual([1, 0, 0])
  })

  it('resolves weight and opacity render-side, as shares of the mode style', () => {
    const p = { ...p0, weightContours: 2, opacityContours: 0.8, plumbWeightContours: 1.5, plumbOpacityContours: 0.5 }
    const st = layerStyle('Contours-Plumb', p)
    expect(st.weight).toBeCloseTo(3, 6)
    expect(st.opacity).toBeCloseTo(0.4, 6)
    expect(geometryKey({ ...p0, plumbWeightContours: 1.5, plumbOpacityContours: 0.5 })).toBe(geometryKey(p0))
    for (const k of ['plumbColorContours', 'plumbDashContours', 'plumbGapContours', 'plumbMarkContours', 'plumbSizeContours', 'plumbEndsContours', 'plumbPointsContours']) {
      expect(geometryKey({ ...p0, [k]: k === 'plumbMarkContours' ? 'cross' : k === 'plumbEndsContours' ? 'top' : k === 'plumbPointsContours' ? 'summit' : k === 'plumbColorContours' ? '#ff0000' : 9 })).not.toBe(geometryKey(p0))
    }
  })

  it('belongs to each copy', () => {
    const owned = ownedKeys('Contours')
    for (const k of ['plumbColor', 'plumbWeight', 'plumbOpacity', 'plumbDash', 'plumbGap', 'plumbMark', 'plumbSize', 'plumbEnds', 'plumbPoints']) {
      expect(owned).toContain(`${k}Contours`)
    }
  })
})

describe('stack by landform', () => {
  const stacked = (extra = {}) => build({ zOffsetContours: 0.5, zStackContours: 'form', ...extra })
  const tiers = (geo) => geo.filter((l) => /^Contours-Minor-Tier\d$/.test(l.id))

  it('floats each landform tier at its own height, one pen layer each', () => {
    const geo = stacked()
    const list = tiers(geo)
    expect(list.length).toBeGreaterThan(1)
    expect(layer(geo, 'Contours-Minor')).toBeUndefined()
    for (const l of list) {
      // Tier t floats (t + 1) steps of half the relief above the ground.
      const k = Number(l.id.slice(-1))
      expect(Math.min(...ys(l.positions))).toBeGreaterThan(t.minElev + (k + 1) * 0.5 * relief - 1e-3)
    }
    expect(layerStyle('Contours-Minor-Tier5', p0).name).toBe('Contours · Minor · Ridge')
    expect(layerStyle('Contours-Minor-Tier2', p0).name).toBe('Contours · Minor · Footslope, Hollow')
  })

  it('gives each tier its own plumb lines and footprint', () => {
    const geo = stacked({ plumbContours: true, plumbPointsContours: 'summit', footprintContours: 'solid' })
    const plumbs = geo.filter((l) => /^Contours-Plumb-Tier\d$/.test(l.id))
    const feet = geo.filter((l) => /^Contours-Footprint-Tier\d$/.test(l.id))
    // A tier whose regions are all specks gets none.
    expect(plumbs.length).toBeGreaterThan(1)
    expect(plumbs.length).toBeLessThanOrEqual(tiers(geo).length)
    expect(feet.length).toBeGreaterThan(0)
    expect(layerStyle('Contours-Footprint-Tier6', p0).name).toBe('Contours · Footprint · Peak')
  })

  it('is off by default, and needs a Z offset', () => {
    expect(STYLE_DEF.zStackContours).toBe('off')
    expect(tiers(build({ zStackContours: 'form' })).length).toBe(0)
    expect(ownedKeys('Contours')).toContain('zStackContours')
    expect(ownedKeys('Contours')).toContain('footprintContours')
  })
})

describe('the footprint and the fence', () => {
  // A 5 × 5 block of kept cells in a 10 × 10 grid, one unit a cell.
  const rows = 10, cols = 10
  const gridMask = new Uint8Array(rows * cols)
  for (let r = 2; r <= 6; r++) for (let c = 3; c <= 7; c++) gridMask[r * cols + c] = 1
  const sq = { rows, cols, scl: 1, halfW: 0, halfH: 0, gridMask, minElev: 0, maxElev: 10 }

  it('traces a stencil as one closed outline', () => {
    const runs = maskOutline(sq)
    expect(runs.length).toBe(1)
    const r = runs[0]
    expect(r[0]).toBeCloseTo(r.at(-2), 6)
    expect(r[1]).toBeCloseTo(r.at(-1), 6)
    // Half a cell outside the kept block on every side.
    const xs = [], zs = []
    for (let i = 0; i < r.length; i += 2) { xs.push(r[i]); zs.push(r[i + 1]) }
    expect(Math.min(...xs)).toBeCloseTo(2.5, 6)
    expect(Math.max(...xs)).toBeCloseTo(7.5, 6)
    expect(Math.min(...zs)).toBeCloseTo(1.5, 6)
    expect(Math.max(...zs)).toBeCloseTo(6.5, 6)
  })

  it('closes an outline at the edge of the grid', () => {
    const all = { ...sq, gridMask: new Uint8Array(rows * cols).fill(1) }
    expect(maskOutline(all).length).toBe(1)
  })

  it('sets fence posts at the spacing along the outline', () => {
    const runs = maskOutline(sq)
    const posts = fencePoints(runs, sq, 2)
    // The outline is about 18 cells around (the corners are cut): 9 posts.
    expect(posts.length).toBeGreaterThanOrEqual(8)
    expect(posts.length).toBeLessThanOrEqual(10)
    expect(fencePoints(runs, sq, 20)).toEqual([])
  })

  it('drapes the outline on the ground, solid or dashed', () => {
    const runs = maskOutline(sq)
    const solid = buildFootprint(runs, sq, () => 3, [0, 0, 0], false).positions
    const dashed = buildFootprint(runs, { ...sq, halfW: 100, halfH: 100 }, () => 3, [0, 0, 0], true).positions
    expect(solid.length / 6).toBe(runs[0].length / 2 - 1)
    for (let i = 1; i < solid.length; i += 3) expect(solid[i]).toBeGreaterThan(3)
    expect(dashed.length).toBeLessThan(solid.length)
  })

  it('draws a fence of plumb lines in the app', () => {
    const geo = build({ zOffsetContours: 1, plumbContours: true, plumbPointsContours: 'edge', plumbSpacingContours: 6,
      coverMaskContours: classBit(1) })
    const v = layer(geo, 'Contours-Plumb').positions
    const fewer = layer(build({ zOffsetContours: 1, plumbContours: true, coverMaskContours: classBit(1) }), 'Contours-Plumb').positions
    expect(v.length).toBeGreaterThan(fewer.length)
  })
})

describe('explode', () => {
  it('scales every Z offset at once, and 0 sets them on the ground', () => {
    expect(liftOf({ zOffsetContours: 1, explode: 2 }, 'Contours', t)).toBeCloseTo(2 * relief, 6)
    expect(liftOf({ zOffsetContours: 1, explode: 0 }, 'Contours', t)).toBe(0)
    expect(liftOf({ zOffsetContours: 1 }, 'Contours', t)).toBeCloseTo(relief, 6)
    expect(VIEW_DEF.explode).toBe(1)
    expect(geometryKey({ ...p0, explode: 1.5 })).not.toBe(geometryKey(p0))
  })
})

