import { describe, it, expect } from 'vitest'
import { viewshedField } from '../../src/utils/viewshed'
import { leastCostPath, toblerSpeed } from '../../src/utils/isochrone'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const N = 101
const grid = (f) => {
  const h = new Float32Array(N * N)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) h[r * N + c] = f(r, c)
  return { heights: h, mask: new Uint8Array(N * N).fill(1), rows: N, cols: N, cellX: 10, cellY: 10 }
}

describe('viewshedField', () => {
  it('sees all of a flat plain', () => {
    const v = viewshedField(grid(() => 0), { row: 50, col: 50, eye: 2 })
    expect(v.reduce((a, b) => a + b, 0)).toBe(N * N)
  })

  it('loses the ground behind a wall and keeps its top', () => {
    const v = viewshedField(grid((r, c) => (c === 60 ? 30 : 0)), { row: 50, col: 50, eye: 2 })
    expect(v[50 * N + 60]).toBe(1)          // the wall itself
    expect(v[50 * N + 70]).toBe(0)          // the ground behind it
    expect(v[50 * N + 30]).toBe(1)          // the other way
  })

  it('bends the far ground away with the earth', () => {
    // 1 km cells. A 20 m eye over flat ground on a curved earth, with
    // refraction, sees √(2R·20 / 0.87) ≈ 17 km before the ground drops away.
    const g = grid(() => 0); g.cellX = g.cellY = 1000
    const v = viewshedField(g, { row: 50, col: 0, eye: 20 })
    expect(v[50 * N + 5]).toBe(1)
    expect(v[50 * N + 15]).toBe(1)
    expect(v[50 * N + 20]).toBe(0)
    expect(v[50 * N + 60]).toBe(0)
  })
})

describe('leastCostPath', () => {
  it('walks straight across a flat plain', () => {
    const p = leastCostPath(grid(() => 0), [50, 10], [50, 90])
    expect(p.metres).toBeCloseTo(800, 6)
    expect(p.seconds).toBeCloseTo(800 / toblerSpeed(0), 3)
    expect(p.climb).toBe(0)
    expect(p.cells[0]).toBe(50 * N + 10)
    expect(p.cells[p.cells.length - 1]).toBe(50 * N + 90)
  })

  it('goes round a wall through the gap', () => {
    const p = leastCostPath(grid((r, c) => (c >= 49 && c <= 51 && r < 90 ? 60 : 0)), [20, 20], [20, 80])
    const rows = p.cells.map((k) => (k / N) | 0)
    expect(Math.max(...rows)).toBeGreaterThanOrEqual(90)
    expect(p.climb).toBe(0)
  })

  it('reports no route when none exists', () => {
    expect(leastCostPath(grid((r, c) => (c === 50 ? 500 : 0)), [20, 20], [20, 80])).toBeNull()
  })
})

describe('Truchet, Viewshed and Route modes', () => {
  const W = 96
  const px = new Float32Array(W * W)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = 0.5 + 0.25 * Math.sin(x / 11) * Math.cos(y / 13)
  const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false }
  const terrain = buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0)
  const layer = (p, id) => buildLineGeometry(terrain, { ...p0, ...p }).find((l) => l.id === id)
  const wellFormed = (l) => {
    expect(l.positions.length).toBeGreaterThan(60)
    expect(l.colors.length).toBe(l.positions.length)
    for (const v of l.positions) expect(Number.isFinite(v)).toBe(true)
  }

  for (const align of ['fall', 'contour', 'random']) {
    it(`Truchet draws arcs (${align})`, () => wellFormed(layer({ enabledTruchet: true, alignTruchet: align, spacingTruchet: 6 }, 'Truchet')))
  }

  it('Viewshed hatches and reports how much it sees', () => {
    const l = layer({ enabledViewshed: true }, 'Viewshed')
    wellFormed(l)
    expect(l.note.visible).toBeGreaterThan(0)
    expect(l.note.visible).toBeLessThanOrEqual(1)
  })

  it('Route draws one line and reports the walk', () => {
    const l = layer({ enabledRoute: true, markerRoute: false }, 'Route')
    wellFormed(l)
    expect(l.note.seconds).toBeGreaterThan(0)
    expect(l.note.metres).toBeGreaterThan(0)
    // One stroke: every segment starts where the last one ended.
    const P = l.positions
    for (let s = 6; s < P.length; s += 6) {
      expect(P[s]).toBeCloseTo(P[s - 3], 4)
      expect(P[s + 2]).toBeCloseTo(P[s - 1], 4)
    }
  })
})
