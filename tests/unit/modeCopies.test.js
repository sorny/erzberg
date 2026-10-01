/**
 * Mode copies: one draw mode, several settings, each with its own mask.
 *
 * Built on a real grid with a cover plate, because what a copy is for is a
 * second set of settings on a *different* part of the ground, and that only
 * shows when the mask and the builder actually run.
 */
import { describe, expect, it } from 'vitest'
import { buildTerrain } from '../../src/utils/terrain'
import { buildLineGeometry, layerStyle } from '../../src/utils/geometryBuilders'
import { geometryKey } from '../../src/params'
import { classBit } from '../../src/utils/coverPlate'
import { makeCopy, nextUid, ownedKeys, patchCopy } from '../../src/utils/modeCopies'
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from '../../src/defaults'

const W = 64
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false }
const px = new Float32Array(W * W)
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) px[y * W + x] = 0.5 + 0.2 * Math.sin(x / 7) * Math.cos(y / 9)
// Left half class 0, right half class 1.
const labels = new Uint8Array(W * W)
for (let y = 0; y < W; y++) for (let x = W / 2; x < W; x++) labels[y * W + x] = 1
const t = buildTerrain(px, new Uint8Array(W * W).fill(1), W, W, p0, null,
  { labels, width: W, height: W, classColors: ['#ff0000', '#0000ff'] })
const build = (p) => buildLineGeometry(t, { ...p0, ...p })
const segs = (geo, id) => (geo.find((l) => l.id === id)?.positions.length ?? 0) / 6

const contours = { ...STYLE_DEF, enabledContours: true, intervalContours: 4 }
const copyOf = (values) => ({ ...makeCopy('Contours', contours, []), values: { ...makeCopy('Contours', contours, []).values, ...values } })

describe('a copy in the dispatcher', () => {
  it('draws with its own settings and mask, beside the original', () => {
    const copy = copyOf({ intervalContours: 12, coverMaskContours: classBit(1) })
    const geo = build({ enabledContours: true, intervalContours: 4, modeCopies: [copy] })
    const ids = geo.map((l) => l.id)
    expect(ids).toEqual(['Contours-Minor', 'Contours-Major', 'Contours-Minor@c1', 'Contours-Major@c1'])
    expect(segs(geo, 'Contours-Minor@c1')).toBeGreaterThan(0)
    expect(segs(geo, 'Contours-Minor@c1')).toBeLessThan(segs(geo, 'Contours-Minor') / 2)
    // Only on class 1: the right half, x > 0 in world units.
    const P = geo.find((l) => l.id === 'Contours-Minor@c1').positions
    for (let i = 0; i < P.length; i += 3) expect(P[i]).toBeGreaterThan(-t.scl * 1.5)
  })

  it('draws while the original is off, and not while it is off itself', () => {
    const on = copyOf({})
    const off = { ...copyOf({}), uid: 'c2', values: { ...on.values, enabledContours: false } }
    const ids = build({ enabledContours: false, modeCopies: [on, off] }).map((l) => l.id)
    expect(ids).toEqual(['Contours-Minor@c1', 'Contours-Major@c1'])
  })

  it('combines with the class split', () => {
    const copy = copyOf({ hypsoContours: true, hypsoModeContours: 'class' })
    const ids = build({ enabledContours: false, modeCopies: [copy] }).map((l) => l.id)
    expect(ids).toContain('Contours-Minor-Class1@c1')
  })
})

describe('the rebuild key', () => {
  const key = (values) => geometryKey({ ...p0, modeCopies: [copyOf(values)] })
  it('moves for a copy\'s geometry, and not for its style', () => {
    expect(key({ intervalContours: 12 })).not.toBe(key({ intervalContours: 8 }))
    expect(key({ weightContours: 3 })).toBe(key({ weightContours: 1 }))
  })
})

describe('a copy\'s layers', () => {
  it('take the copy\'s style and the copy\'s name', () => {
    const copy = { ...copyOf({ majorWeightContours: 4, opacityContours: 0.5 }), name: 'Rock contours' }
    const s = layerStyle('Contours-Major@c1', { ...p0, modeCopies: [copy] })
    expect(s.weight).toBe(4)
    expect(s.opacity).toBe(0.5)
    expect(s.name).toBe('Rock contours · Major')
  })
  it('fall back to the original if the copy is gone', () => {
    expect(layerStyle('Contours-Major@c9', { ...p0, majorWeightContours: 2 }).weight).toBe(2)
  })
})

describe('the copy data', () => {
  it('snapshots every key the mode owns, and nothing else', () => {
    const keys = ownedKeys('Contours')
    expect(keys).toContain('intervalContours')
    expect(keys).toContain('coverMaskContours')
    expect(keys).toContain('tanakaSunAzimuth')
    expect(keys).not.toContain('modeCopies')
    expect(keys.some((k) => k.endsWith('Cross'))).toBe(false)
  })
  it('numbers uids and names past the ones in use', () => {
    const a = makeCopy('Contours', contours, [])
    const b = makeCopy('Contours', contours, [a])
    expect([a.uid, b.uid]).toEqual(['c1', 'c2'])
    expect([a.name, b.name]).toEqual(['Contours 2', 'Contours 3'])
    expect(nextUid([{ uid: 'c7' }])).toBe('c8')
  })
  it('keeps a patch to the keys the copy owns', () => {
    const a = makeCopy('Contours', contours, [])
    const [out] = patchCopy([a], 'c1', { intervalContours: 9, spacingLines: 3 })
    expect(out.values.intervalContours).toBe(9)
    expect(out.values.spacingLines).toBeUndefined()
  })
})
