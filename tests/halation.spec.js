import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * Halation is Flashbulb plus a glow, and both halves of that have to hold.
 *
 * The glow half: the bloom must come from *blown highlights* rather than from
 * busy terrain. Blurring the exposure gradient is the obvious first idea and it
 * covers the whole picture on real ground, because every ridge and gully is an
 * edge — so the source is the overexposure, and the assertion is that a plate
 * with nothing blown on it produces no halo at all.
 *
 * The Flashbulb half: with the glow turned off, the two modes must agree cell
 * for cell. That is what pins the shared optics after they were lifted out of
 * `buildFlashbulb` into `flashExposure`/`flashTone`/`flashShadowed`.
 */
const PAGE = 'http://localhost:5173'

async function ready(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
}

const run = (page, over) => page.evaluate(async (over) => {
  const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
  const { buildTerrain } = await import('/src/utils/terrain.js')
  const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')

  const N = 140
  const g = new Float32Array(N * N)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const dx = (c - N / 2) / (N / 2), dy = (r - N / 2) / (N / 2)
    g[r * N + c] = Math.max(0, 1 - Math.hypot(dx, dy))
  }
  const mask = new Uint8Array(N * N).fill(1)
  const p = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale: 1, blurRadius: 0,
              enabledLines: false, spacingHalation: 1, spacingFlashbulb: 1, ...over }
  const t = buildTerrain(g, mask, N, N, p)
  const layers = buildLineGeometry(t, p)
  const n = (id) => { const l = layers.find((x) => x.id === id); return l ? l.positions.length / 6 : 0 }
  /*
   * Area of support: how many 4×4 world buckets the halo touches at all.
   *
   * Deliberately not a radius from its own centroid, which is the obvious
   * measure and moves the wrong way — as the halo fills in, the centroid slides
   * into the mass and the spread reads *smaller* while the ink covers more
   * ground. Measured over radii 1…30 the centroid p95 falls 76→68 while the
   * occupied area rises 8→315.
   */
  const spread = (id) => {
    const l = layers.find((x) => x.id === id)
    if (!l || !l.positions.length) return 0
    const cells = new Set()
    for (let i = 0; i < l.positions.length; i += 6) {
      cells.add(((l.positions[i] / 4) | 0) + ':' + ((l.positions[i + 2] / 4) | 0))
    }
    return cells.size
  }
  return { ids: layers.map((l) => l.id),
           grain: n('Halation-Grain'), bloom: n('Halation-Bloom'),
           flash: n('Flashbulb'), bloomSpread: spread('Halation-Bloom'),
           isPoints: layers.filter((l) => l.id.startsWith('Halation')).every((l) => l.isPoints) }
}, over)

const BULB = {
  azimuthHalation: 315, distanceHalation: 0.9, heightHalation: 2, falloffHalation: 1.6,
  exposureHalation: 2, gammaHalation: 1, contrastHalation: 1.2, grainHalation: 1,
  shadowHalation: false, seedHalation: 42,
}
const SAME_BULB = {
  azimuthFlashbulb: 315, distanceFlashbulb: 0.9, heightFlashbulb: 2, falloffFlashbulb: 1.6,
  exposureFlashbulb: 2, gammaFlashbulb: 1, contrastFlashbulb: 1.2, grainFlashbulb: 1,
  shadowFlashbulb: false, seedFlashbulb: 42,
}

test('both populations are points, under their own ids', async ({ page }) => {
  await ready(page)
  const r = await run(page, { enabledHalation: true, ...BULB })
  expect(r.ids).toContain('Halation-Grain')
  expect(r.ids).toContain('Halation-Bloom')
  expect(r.isPoints).toBe(true)
  expect(r.grain).toBeGreaterThan(500)
  expect(r.bloom).toBeGreaterThan(50)
})

test('with the glow off, the grain is Flashbulb exactly', async ({ page }) => {
  await ready(page)
  // Same bulb, same tone, same seed, bleed and glow at zero: the two modes are
  // reading one set of optics, so they must agree on every cell.
  const r = await run(page, {
    enabledHalation: true, enabledFlashbulb: true,
    ...BULB, ...SAME_BULB, bleedHalation: 0, glowHalation: 0,
  })
  expect(r.flash).toBeGreaterThan(500)
  expect(r.grain).toBe(r.flash)
  expect(r.bloom).toBe(0)
})

test('bleed takes ink out of the shadow', async ({ page }) => {
  await ready(page)
  const none = await run(page, { enabledHalation: true, ...BULB, bleedHalation: 0 })
  const some = await run(page, { enabledHalation: true, ...BULB, bleedHalation: 0.8 })
  const lots = await run(page, { enabledHalation: true, ...BULB, bleedHalation: 1.6 })
  expect(some.grain).toBeLessThan(none.grain)
  expect(lots.grain).toBeLessThan(some.grain)
})

test('nothing blown, no halo — the bloom follows highlights, not busy ground', async ({ page }) => {
  await ready(page)
  // A cone is nothing but edges. Under-expose it so no cell is above full white
  // and the overexposure field is identically zero; a gradient-sourced bloom
  // would still glow all over it.
  const dark = await run(page, { enabledHalation: true, ...BULB, exposureHalation: 0.25 })
  expect(dark.bloom).toBe(0)
  expect(dark.grain).toBeGreaterThan(500)
})

test('a wider bloom radius spreads the halo over more ground', async ({ page }) => {
  await ready(page)
  const areas = []
  for (const bloomHalation of [2, 8, 20]) {
    const r = await run(page, { enabledHalation: true, ...BULB, bloomHalation, glowHalation: 1 })
    areas.push(r.bloomSpread)
  }
  expect(areas[1]).toBeGreaterThan(areas[0] * 2)
  expect(areas[2]).toBeGreaterThan(areas[1] * 2)
})
