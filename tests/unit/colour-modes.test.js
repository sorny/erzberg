/**
 * The colour modes, driven end to end on a synthetic plate.
 *
 * These builders are arithmetic over a grid, which is exactly what `test:unit`
 * is for — and two real bugs came out of writing this rather than out of looking
 * at the app. A layer with fills and no strokes was dropped by the sub-layer
 * dispatch in silence, and the first version of this file passed anyway because
 * it counted the whole scene while `Mode: Lines` is on by default. Both are
 * asserted against below.
 */
import { describe, it, expect } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry } from '../../src/utils/geometryBuilders'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

const W = 96, H = 96
function plate() {
  const px = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = x / W, fy = y / H
    px[y * W + x] =
      0.5 + 0.30 * Math.sin(fx * 7.1) * Math.cos(fy * 5.3)
          + 0.12 * Math.sin(fx * 19) * Math.sin(fy * 23)
  }
  return px
}

const MODES = ['Indexed','Outrun','Riso','Mineral','Shed']

describe('colour modes produce geometry', () => {
  const px = plate()
  const mask = new Uint8Array(W * H).fill(1)
  // elevScale defaults to 0 — the app is flat until a loaded file suggests a
  // scale, so a bare-defaults terrain has no relief for any mode to read.
  const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1 }
  const terrain = buildTerrain(px, mask, W, H, p0)

  for (const id of MODES) {
    it(`${id} emits drawable geometry`, () => {
      const p = { ...p0, [`enabled${id}`]: true }
      // Only this mode's own layers. Lines is on by default, and counting the
      // whole scene let every one of these pass while the mode emitted nothing.
      const all = buildLineGeometry(terrain, p)
      const mine = all.filter(l => l.id === id || l.id.startsWith(id + '-') ||
                                   (id === 'Riso' && l.id.startsWith('Riso-')) ||
                                   (id === 'Riso' && l.id.startsWith('Riso-')))
      expect(mine.length).toBeGreaterThan(0)
      const verts = mine.reduce((a, l) =>
        a + (l.positions?.length ?? 0) / 3 + (l.lids?.positions?.length ?? 0) / 3, 0)
      expect(verts).toBeGreaterThan(100)
      for (const l of mine) {
        if (l.positions?.length) expect(l.colors.length).toBe(l.positions.length)
        if (l.lids) expect(l.lids.colors.length).toBe(l.lids.positions.length)
        for (const v of (l.positions ?? [])) expect(Number.isFinite(v)).toBe(true)
        for (const v of (l.lids?.positions ?? [])) expect(Number.isFinite(v)).toBe(true)
        for (const c of (l.colors ?? [])) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1) }
      }
    })
  }

  // A mode that draws only fills exported an empty SVG, because the exporter
  // reads strokes and never looks at `lids`. The fills now carry the boundary
  // between regions as real line geometry — the outline of each region rather
  // than of each square, so a plotter gets a map instead of a grid.
  it('the area modes carry strokes a plotter can draw', () => {
    for (const id of ['Indexed', 'Mineral', 'Shed']) {
      const l = buildLineGeometry(terrain, { ...p0, [`enabled${id}`]: true })
        .find(x => x.id === id)
      expect(l, id).toBeTruthy()
      expect(l.lids.positions.length, `${id} fills`).toBeGreaterThan(0)
      expect(l.positions.length, `${id} strokes`).toBeGreaterThan(0)
      expect(l.colors.length).toBe(l.positions.length)
      // Boundaries only: every cell edge would be four strokes per quad, and
      // four quads share every interior edge.
      const quads = l.lids.positions.length / 12
      const segs = l.positions.length / 6
      expect(segs, `${id} draws region edges, not every cell edge`).toBeLessThan(quads * 2)
    }
  })

  // The SVG exporter reads the per-vertex colour buffer and never looks at the
  // fills, so a single outline pen meant Watershed plotted as one colour and
  // Mineral as black. Each boundary segment now carries the *base* ink of the
  // region it bounds — not the fill's colour, which the per-cell grain and
  // relief shading modulate separately. Using the fill put 703 near-identical
  // greens into a Mineral plot: true to the screen and useless as a drawing.
  it('area modes plot a small, meaningful set of inks', () => {
    const inksOf = (l) => {
      const set = new Set()
      for (let i = 0; i < l.colors.length; i += 3) {
        set.add(`${Math.round(l.colors[i] * 255)},${Math.round(l.colors[i+1] * 255)},${Math.round(l.colors[i+2] * 255)}`)
      }
      return set
    }
    const layerOf = (id, extra = {}) => buildLineGeometry(terrain, { ...p0, [`enabled${id}`]: true, ...extra })
      .find(x => x.id === id)

    // One ink per palette entry, and no more.
    const indexed = inksOf(layerOf('Indexed', { tiersIndexed: 6, slopeBandsIndexed: 2 }))
    expect(indexed.size).toBeGreaterThan(1)
    expect(indexed.size).toBeLessThanOrEqual(6)

    // Five materials plot as at most five inks, however grained the fill is.
    const mineral = inksOf(layerOf('Mineral'))
    expect(mineral.size).toBeGreaterThan(1)
    expect(mineral.size, 'the grain must not reach the stroke').toBeLessThanOrEqual(5)

    // Basins are dealt from a palette of `inksShed`, so that caps the strokes.
    const shed = inksOf(layerOf('Shed', { inksShed: 10 }))
    expect(shed.size).toBeGreaterThan(1)
    expect(shed.size, 'the relief shading must not reach the stroke').toBeLessThanOrEqual(10)
  })

  // The cap was its own mode until it turned out to differ from Riso by two
  // knobs and nothing else. At the top of its range it must be a no-op, or the
  // "off" the panel prints is a lie.
  it("Riso's coverage cap removes ink, and is inert at the top of its range", () => {
    const base = { ...p0, enabledRiso: true }
    const count = ls => ls.reduce((a, l) => a + (l.positions?.length ?? 0), 0)
    const off   = count(buildLineGeometry(terrain, { ...base, limitRiso: 3 }))
    const tight = count(buildLineGeometry(terrain, { ...base, limitRiso: 0.35 }))
    expect(tight).toBeLessThan(off)
    // Three inks cannot sum past 3.0, so 3 and anything above it are identical.
    expect(count(buildLineGeometry(terrain, { ...base, limitRiso: 2.999 })))
      .toBeLessThanOrEqual(off)
  })

  it('registration at zero puts every plate on the same lattice', () => {
    const base = { ...p0, enabledRiso: true, offsetRiso: 0 }
    const ls = buildLineGeometry(terrain, base).filter(l => l.id.startsWith('Riso-'))
    expect(ls.length).toBe(3)
    for (const l of ls) expect(l.positions.length).toBeGreaterThan(0)
  })

  it('Outrun emits a glow pen and a core pen over the same paths', () => {
    const ls = buildLineGeometry(terrain, { ...p0, enabledOutrun: true })
    const core = ls.find(l => l.id === 'Outrun-Core')
    const glow = ls.find(l => l.id === 'Outrun-Glow')
    expect(core).toBeTruthy(); expect(glow).toBeTruthy()
    expect(core.positions.length).toBe(glow.positions.length)
    // The core is the hue pushed toward white, so it is never darker.
    let coreSum = 0, glowSum = 0
    for (let i = 0; i < core.colors.length; i++) { coreSum += core.colors[i]; glowSum += glow.colors[i] }
    expect(coreSum).toBeGreaterThan(glowSum)
  })

  it('Watershed folds small basins away', () => {
    const few = buildLineGeometry(terrain, { ...p0, enabledShed: true, minBasinShed: 3 })
    const many = buildLineGeometry(terrain, { ...p0, enabledShed: true, minBasinShed: 0 })
    const inks = ls => new Set(Array.from(ls.find(l => l.id === 'Shed').lids.colors).map(v => Math.round(v * 255))).size
    expect(inks(few)).toBeLessThanOrEqual(inks(many))
  })

  it('Indexed dithers: the screen changes which entry a cell takes', () => {
    const off = buildLineGeometry(terrain, { ...p0, enabledIndexed: true, ditherIndexed: 0 })
    const on  = buildLineGeometry(terrain, { ...p0, enabledIndexed: true, ditherIndexed: 1 })
    const a = off.find(l => l.id === 'Indexed').lids.colors, b = on.find(l => l.id === 'Indexed').lids.colors
    expect(a.length).toBe(b.length)
    let diff = 0
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) diff++
    expect(diff).toBeGreaterThan(0)
  })
})
