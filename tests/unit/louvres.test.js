/**
 * Louvres on a ramp whose answer is known: the value rises to the east, so the
 * bars deepen to the east and stay inside their rows.
 */
import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { depthIntervals } from '../../src/utils/builders/signal'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const W = 96
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false, resolution: 1 }
const ramp = (() => {
  const px = new Float32Array(W * W)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = x / (W - 1)
  return buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0)
})()
const louvre = (p) => buildLineGeometry(ramp, { ...p0, enabledLouvre: true, blurLouvre: 0, pitchLouvre: 12, cellLouvre: 16, gapLouvre: 0.5, ...p }).find((l) => l.id === 'Louvre')
/** Each segment as grid-space ends: [c0, r0, c1, r1]. */
const segs = (l) => {
  const out = [], P = l.positions, t = ramp
  for (let i = 0; i < P.length; i += 6) out.push([(P[i] + t.halfW) / t.scl, (P[i + 2] + t.halfH) / t.scl, (P[i + 3] + t.halfW) / t.scl, (P[i + 5] + t.halfH) / t.scl])
  return out
}

describe('depthIntervals', () => {
  it('finds where a linear edge is deep enough', () => {
    expect(depthIntervals([0, 10], [0, 10], 5)).toEqual([[5, 10]])
    expect(depthIntervals([0, 10], [10, 0], 5)).toEqual([[0, 5]])
    expect(depthIntervals([0, 10], [3, 3], 5)).toEqual([])
    expect(depthIntervals([0, 5, 10], [10, 0, 10], 5)).toEqual([[0, 2.5], [7.5, 10]])
  })
})

describe('Louvres', () => {
  it('deepens the bars where the value is higher, and leaves the floor empty', () => {
    const l = louvre({ floorLouvre: 0.3, edgeLouvre: 'traced', barLouvre: 'lines' })
    expect(l.note.cells).toBeGreaterThan(20)
    const s = segs(l)
    const ink = (lo, hi) => s.filter(([c0, , c1]) => (c0 + c1) / 2 >= lo && (c0 + c1) / 2 < hi).length
    expect(ink(0, 0.25 * W)).toBe(0)
    expect(ink(0.75 * W, W)).toBeGreaterThan(ink(0.4 * W, 0.6 * W) * 1.3)
  })

  it('keeps every stroke inside its row, within the set depth', () => {
    const pitch = 12, depth = 0.5
    const rc = (W - 1) / 2
    for (const hang of ['top', 'bottom', 'centre']) {
      for (const [c0, r0, c1, r1] of segs(louvre({ pitchLouvre: pitch, depthLouvre: depth, hangLouvre: hang, barLouvre: 'lines' }))) {
        for (const [c, r] of [[c0, r0], [c1, r1]]) {
          if (c <= 0.01 || c >= W - 1.01) continue
          const off = (((r - rc) % pitch) + pitch) % pitch
          const near = (a) => Math.min(Math.abs(off - a), pitch - Math.abs(off - a))
          if (hang === 'top') expect(off <= depth * pitch + 1e-3 || near(0) < 1e-3).toBe(true)
          if (hang === 'bottom') expect(off >= pitch - depth * pitch - 1e-3 || near(0) < 1e-3).toBe(true)
          if (hang === 'centre') expect(Math.abs(off - pitch / 2)).toBeLessThanOrEqual(depth * pitch / 2 + 1e-3)
        }
      }
    }
  })

  it('draws nothing above a full floor, and less with no fill', () => {
    expect(louvre({ floorLouvre: 0.95, depthLouvre: 0.75 })?.note.cells ?? 0).toBeLessThan(10)
    const solid = louvre({ barLouvre: 'lines' }).positions.length, outline = louvre({ barLouvre: 'none' }).positions.length
    expect(outline).toBeGreaterThan(0)
    expect(solid).toBeGreaterThan(outline * 1.5)
  })

  it('fills solid bars as a draped mesh and one closed ring each', () => {
    const pitch = 12, depth = 0.75, rc = (W - 1) / 2
    const l = louvre({ pitchLouvre: pitch, depthLouvre: depth, outlineLouvre: false })
    expect(l.positions.length).toBe(0)
    expect(l.lids.indices.length).toBeGreaterThan(0)
    const { positions: P, starts, inks } = l.polys
    expect(starts.length - 1).toBe(inks.length / 3)
    expect(starts.length - 1).toBeGreaterThanOrEqual(l.note.cells)
    // Every mesh vertex hangs from a row's upper edge, no deeper than the depth.
    const L = l.lids.positions
    for (let i = 0; i < L.length; i += 3) {
      const r = (L[i + 2] + ramp.halfH) / ramp.scl
      const off = (((r - rc) % pitch) + pitch) % pitch
      expect(off <= depth * pitch + 1e-3 || pitch - off < 1e-3).toBe(true)
    }
    // A ring's corners lie on the ground.
    for (let v = 0; v < P.length / 3; v += 7) {
      const c = (P[v * 3] + ramp.halfW) / ramp.scl
      expect(Math.abs(P[v * 3 + 1] - ((c / (W - 1)) - 0.5) * 100)).toBeLessThan(1.5)
    }
  })

  it('turns the rows with the angle', () => {
    // At 90° the rows run down the plate, so the long strokes run along r.
    const s = segs(louvre({ angleLouvre: 90, edgeLouvre: 'stepped', barLouvre: 'none' }))
    const alongR = s.filter(([c0, r0, c1, r1]) => Math.abs(r1 - r0) > Math.abs(c1 - c0)).length
    expect(alongR).toBeGreaterThan(s.length / 2)
  })
})
