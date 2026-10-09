import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry, layerStyle } from '../../src/utils/geometryBuilders'
import { PRINTER_RAMP, waveformLine, waveformProfile } from '../../src/utils/builders/signal'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const W = 96
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false }
const plate = (f) => {
  const px = new Float32Array(W * W)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = f(x, y)
  return buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0)
}
const t = plate((x, y) => 0.5 + 0.2 * Math.sin(x / 9) * Math.cos(y / 11))
const layers = (p, terrain = t) => buildLineGeometry(terrain, { ...p0, ...p })
const layer = (ls, id) => ls.find((l) => l.id === id)

describe('Line printer', () => {
  it('prints a glyph per cell, and leaves the lowest class blank when asked', () => {
    const full = layer(layers({ enabledPrinter: true }), 'Printer')
    const blank = layer(layers({ enabledPrinter: true, blankPrinter: true }), 'Printer')
    expect(full.positions.length).toBeGreaterThan(0)
    expect(blank.positions.length).toBeLessThan(full.positions.length)
  })

  it('runs light to dark: each glyph has at least the strokes of the one before', () => {
    for (let k = 1; k < PRINTER_RAMP.length; k++) expect(PRINTER_RAMP[k].length).toBeGreaterThanOrEqual(PRINTER_RAMP[k - 1].length)
  })
})

describe('Stems', () => {
  it('stands up and hangs down from the mean, with tips as their own pen', () => {
    const ls = layers({ enabledStems: true })
    const stems = layer(ls, 'Stems'), tips = layer(ls, 'Stems-Tips')
    let up = 0, down = 0
    for (let q = 0; q < stems.positions.length; q += 6) (stems.positions[q + 4] > stems.positions[q + 1] ? up++ : down++)
    expect(up).toBeGreaterThan(0)
    expect(down).toBeGreaterThan(0)
    expect(tips.positions.length).toBeGreaterThan(0)
    expect(layerStyle('Stems-Tips', STYLE_DEF).name).toBe('Stems · Tips')
  })

  it('starts every stem at the lowest point with that datum', () => {
    const stems = layer(layers({ enabledStems: true, datumStems: 'min', tipsStems: false }), 'Stems')
    for (let q = 0; q < stems.positions.length; q += 6) expect(stems.positions[q + 1]).toBeCloseTo(t.minElev, 4)
  })
})

describe('Hair', () => {
  it('is the same for the same seed and different for another', () => {
    const a = layer(layers({ enabledHair: true }), 'Hair').positions
    const b = layer(layers({ enabledHair: true }), 'Hair').positions
    const c = layer(layers({ enabledHair: true, seedHair: 2 }), 'Hair').positions
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(Array.from(a)).not.toEqual(Array.from(c))
  })

  it('draws one stroke of the set segments per sampled cell', () => {
    const step = Math.max(1, Math.round(3 / t.scl)), n = Math.ceil(t.rows / step) * Math.ceil(t.cols / step)
    expect(layer(layers({ enabledHair: true }), 'Hair').positions.length / 6).toBe(n * 6)
  })
})

describe('Waveform', () => {
  it('is a column of strokes mirrored about the middle, widest at the summit', () => {
    const peak = plate((x, y) => 0.2 + 0.6 * Math.exp(-((x - 30) ** 2 + (y - 60) ** 2) / 300))
    const w = layer(layers({ enabledWaveform: true, detailWaveform: 0 }, peak), 'Waveform')
    let widest = 0, atZ = 0
    for (let q = 0; q < w.positions.length; q += 6) {
      expect(w.positions[q]).toBeCloseTo(-w.positions[q + 3], 4)
      if (w.positions[q + 3] > widest) { widest = w.positions[q + 3]; atZ = w.positions[q + 2] }
    }
    expect(widest).toBeCloseTo(60, 0)
    // The summit pixel (30, 60) is cell (15, 30) of the half-resolution grid.
    expect(atZ).toBeCloseTo(30 * peak.scl - peak.halfH, 0)
  })
})

describe('Waveform options', () => {
  const peak = plate((x, y) => 0.2 + 0.6 * Math.exp(-((x - 30) ** 2 + (y - 60) ** 2) / 300))
  const strokes = (p) => {
    const a = layer(layers({ enabledWaveform: true, detailWaveform: 0, ...p }, peak), 'Waveform').positions
    const out = []
    for (let q = 0; q < a.length; q += 6) out.push([a[q], a[q + 2], a[q + 3], a[q + 5]])
    return out
  }

  it('at 180° reads the same line from the other end', () => {
    const down = strokes({}), up = strokes({ angleWaveform: 180 })
    expect(up.length).toBe(down.length)
    expect(up[0][2]).toBeCloseTo(down[down.length - 1][2], 3)
  })

  it('at 90° reads west to east, through the summit', () => {
    const s = strokes({ angleWaveform: 90 })
    // Column: every stroke is horizontal, centred on x = 0.
    for (const [x0, z0, x1, z1] of s) { expect(z0).toBeCloseTo(z1, 4); expect(x0).toBeCloseTo(-x1, 4) }
    // The summit is at column 15 of 48, so the widest stroke is above the middle.
    const widest = s.reduce((m, q) => (q[2] > m[2] ? q : m))
    expect(widest[1]).toBeCloseTo(15 * peak.scl - peak.halfW, 0)
  })

  it('lies left to right as a row, and on the ground along the line it reads', () => {
    for (const [x0, z0, x1, z1] of strokes({ placeWaveform: 'row' })) { expect(x0).toBeCloseTo(x1, 4); expect(z0).toBeCloseTo(-z1, 4) }
    // On line at 0°: the strokes are centred on the summit's column, x = 15 cells.
    for (const [x0, , x1] of strokes({ placeWaveform: 'line' })) expect((x0 + x1) / 2).toBeCloseTo(15 * peak.scl - peak.halfW, 3)
  })

  it('draws one side up from a row', () => {
    for (const [, z0, , z1] of strokes({ placeWaveform: 'row', sidesWaveform: 'one' })) {
      expect(z0).toBeCloseTo(0, 4)
      expect(z1).toBeLessThanOrEqual(0)
    }
  })

  it('reads through a picked point, and the guide reads the same line', () => {
    // The point is a fraction of the raster, x right and y down, as a pick writes it.
    const o = { line: 'point', originX: 0.75, originY: 0.25, angle: 90 }
    const l = waveformLine(peak, o)
    expect(l.c0).toBeCloseTo(0.75 * (peak.cols - 1), 6)
    expect(l.r0).toBeCloseTo(0.25 * (peak.rows - 1), 6)
    // At 90° on line, every stroke is centred on the point's row.
    const s = strokes({ lineWaveform: 'point', originXWaveform: 0.75, originYWaveform: 0.25, angleWaveform: 90, placeWaveform: 'line' })
    for (const [, z0, , z1] of s) expect((z0 + z1) / 2).toBeCloseTo(l.r0 * peak.scl - peak.halfH, 3)
  })

  it('compresses a high Detail into the width, where it used to cut it flat', () => {
    // A rough peak: the sharpened profile overshoots, by a lot at Detail 6.
    const rough = plate((x, y) => 0.2 + 0.6 * Math.exp(-((x - 30) ** 2 + (y - 60) ** 2) / 300) + 0.03 * Math.sin(x * 1.7 + y * 2.3))
    const o = { line: 'summit', angle: 0, spacing: 1.5, detail: 6, smooth: 4, gamma: 1 }
    const full = (w) => Array.from(w).filter((v) => v >= 1 - 1e-6).length
    const fit = waveformProfile(rough, o), clip = waveformProfile(rough, { ...o, clip: true })
    expect(full(clip.w), 'the old cut: a run at full width').toBeGreaterThan(3)
    expect(full(fit.w), 'limited: one widest sample').toBe(1)
    expect(Math.min(...fit.w)).toBeGreaterThanOrEqual(0)
    // Below the knee nothing moves, and the limiter keeps the order of the samples.
    for (let k = 0; k < fit.n; k++) if (clip.w[k] > 0 && clip.w[k] <= 0.7) expect(fit.w[k]).toBeCloseTo(clip.w[k], 6)
    for (let k = 1; k < fit.n; k++) {
      const a = fit.w[k] - fit.w[k - 1], b = clip.w[k] - clip.w[k - 1]
      if (clip.w[k] > 0 && clip.w[k] < 1 && clip.w[k - 1] > 0 && clip.w[k - 1] < 1) expect(Math.sign(a)).toBe(Math.sign(b))
    }
  })

  it('reads only the part of the line Chainage keeps', () => {
    const o = { line: 'summit', angle: 90 }
    const full = waveformLine(peak, o), part = waveformLine(peak, { ...o, from: 0.25, to: 0.75 })
    const L = full.t1 - full.t0
    expect(part.t0).toBeCloseTo(full.t0 + 0.25 * L, 9)
    expect(part.t1).toBeCloseTo(full.t0 + 0.75 * L, 9)
    expect(waveformLine(peak, { ...o, from: 0.6, to: 0.6 })).toBeNull()
    // Half the line, about half the scanlines, all inside the kept part.
    const all = strokes({ angleWaveform: 90 }), half = strokes({ angleWaveform: 90, fromWaveform: 0.25, toWaveform: 0.75 })
    expect(half.length / all.length).toBeGreaterThan(0.45)
    expect(half.length / all.length).toBeLessThan(0.55)
  })

  it('draws one side at the same full width', () => {
    const both = strokes({}), one = strokes({ sidesWaveform: 'one' })
    for (let k = 0; k < one.length; k++) {
      expect(one[k][0]).toBeCloseTo(0, 4)
      expect(one[k][2] - one[k][0]).toBeCloseTo(both[k][2] - both[k][0], 3)
    }
  })
})

describe('Contours: summit and hollow', () => {
  it('marks the highest point with a plus and the lowest with a minus, as its own pen', () => {
    const ls = layers({ enabledContours: true, extremesContours: true })
    const ext = layer(ls, 'Contours-Extremes')
    expect(ext.positions.length / 6).toBe(3)
    expect(layerStyle('Contours-Extremes', STYLE_DEF).name).toBe('Contours · Summit and hollow')
    expect(layer(layers({ enabledContours: true }), 'Contours-Extremes')).toBeUndefined()
  })
})
