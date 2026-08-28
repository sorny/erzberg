import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * What makes Bitplane a tilemap rather than a contour set.
 *
 * Three properties, and all three are arithmetic rather than pixels, so they are
 * asserted against the builder's own output: every vertex sits on one of a small
 * set of elevations; the staircase runs along the cell lattice and nowhere else;
 * and the ladder is anchored to the terrain, so the exaggeration slider scales
 * the steps without reshuffling which cell is on which one.
 *
 * That last one is the reason the tier is taken from `normElev` and not from
 * brightness, and it is the property a reader would notice breaking: the
 * plateaus would crawl while the slider moved.
 */
const PAGE = 'http://localhost:5173'

async function ready(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
}

/** A cone, so tiers are concentric and their count is predictable. */
const build = (page, over) => page.evaluate(async (over) => {
  const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
  const { buildTerrain } = await import('/src/utils/terrain.js')
  const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')

  const N = 96
  const px = new Float32Array(N * N)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const dx = (c - N / 2) / (N / 2), dy = (r - N / 2) / (N / 2)
    px[r * N + c] = Math.max(0, 1 - Math.hypot(dx, dy))
  }
  const mask = new Uint8Array(N * N).fill(1)

  const p = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, blurRadius: 0,
              enabledLines: false, enabledBitplane: true, elevScale: 1, ...over }
  const t = buildTerrain(px, mask, N, N, p)
  const layers = buildLineGeometry(t, p)

  const pick = (id) => layers.find((l) => l.id === id)
  const rd = (v) => Math.round(v * 1e4) / 1e4
  const step = pick('Bitplane-Step'), screen = pick('Bitplane-Screen')
  return {
    ids: layers.map((l) => l.id),
    minElev: rd(t.minElev), maxElev: rd(t.maxElev), scl: t.scl,
    halfW: t.halfW, halfH: t.halfH,
    stepVerts: step ? step.positions.length / 3 : 0,
    screenVerts: screen ? screen.positions.length / 3 : 0,
    screenIsPoints: !!screen?.isPoints,
    stepIsPoints: !!step?.isPoints,
    // Every distinct y a staircase vertex sits at.
    levels: step ? [...new Set([...step.positions].filter((_, i) => i % 3 === 1).map(rd))].sort((a, b) => a - b) : [],
    // A rim must run along cell *boundaries*, so in cell space — world x is
    // `c·scl − halfW` — every endpoint sits exactly half a cell off a centre.
    // An interpolated crossing, which is what Contours emits, would land
    // anywhere in between.
    offLattice: step ? (() => {
      let bad = 0
      const P = step.positions
      const onEdge = (v, off) => {
        const cells = (v + off) / t.scl
        return Math.abs(cells - Math.floor(cells) - 0.5) < 1e-6
      }
      for (let i = 0; i < P.length; i += 6) {
        if (P[i + 1] !== P[i + 4]) continue                    // a riser, not a rim
        if (!onEdge(P[i], t.halfW) || !onEdge(P[i + 3], t.halfW)) bad++
        if (!onEdge(P[i + 2], t.halfH) || !onEdge(P[i + 5], t.halfH)) bad++
      }
      return bad
    })() : -1,
  }
}, over)

test('the staircase quantises to exactly `tiers` levels, on the lattice', async ({ page }) => {
  await ready(page)

  for (const tiers of [4, 8, 16]) {
    const r = await build(page, { tiersBitplane: tiers, risersBitplane: false })
    expect(r.ids).toContain('Bitplane-Step')
    expect(r.ids).toContain('Bitplane-Screen')
    expect(r.stepVerts).toBeGreaterThan(0)

    // A cone touches every tier, and a step is emitted at the *higher* of the
    // two it separates — so level 0 never appears and the count is tiers − 1.
    expect(r.levels.length).toBe(tiers - 1)

    // The levels are evenly spaced by exactly one band.
    const band = (r.maxElev - r.minElev) / tiers
    for (let i = 1; i < r.levels.length; i++) {
      expect(r.levels[i] - r.levels[i - 1]).toBeCloseTo(band, 3)
    }

    // Nothing between the plateaus: no interpolated crossing anywhere.
    expect(r.offLattice).toBe(0)
  }
})

test('the dither is points and the staircase is not', async ({ page }) => {
  await ready(page)
  const r = await build(page, { tiersBitplane: 10 })
  expect(r.screenIsPoints).toBe(true)
  expect(r.stepIsPoints).toBe(false)
  expect(r.screenVerts).toBeGreaterThan(0)
})

test('dither 0 leaves the plateaus bare, dither 1 fills them', async ({ page }) => {
  await ready(page)
  const off = await build(page, { ditherBitplane: 0 })
  const on  = await build(page, { ditherBitplane: 1 })
  expect(off.screenVerts).toBe(0)
  expect(on.screenVerts).toBeGreaterThan(200)
  // The screen must not change the staircase.
  expect(off.stepVerts).toBe(on.stepVerts)
})

test('risers add the verticals without moving a rim', async ({ page }) => {
  await ready(page)
  const flat = await build(page, { risersBitplane: false })
  const box  = await build(page, { risersBitplane: true })
  // One rim, then two verticals per boundary.
  expect(box.stepVerts).toBe(flat.stepVerts * 3)
  expect(box.levels).toEqual(expect.arrayContaining(flat.levels))
})

test('the plateaus are anchored to the terrain, not to world elevation', async ({ page }) => {
  await ready(page)

  // The same tier ladder at three exaggerations: the levels scale with the range
  // and stay at the same *fractions* of it. Anchoring to world elevation instead
  // would reshuffle which cells share a plateau every time the slider moved.
  const fractions = []
  for (const elevScale of [1, 2.5, 4]) {
    const r = await build(page, { elevScale, tiersBitplane: 8, risersBitplane: false })
    const span = r.maxElev - r.minElev
    fractions.push(r.levels.map((y) => Math.round(((y - r.minElev) / span) * 1e4) / 1e4))
  }
  expect(fractions[1]).toEqual(fractions[0])
  expect(fractions[2]).toEqual(fractions[0])
})
