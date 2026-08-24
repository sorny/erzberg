import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * Isophotes — lines of constant illumination.
 *
 * The mode is marching squares over a different field, so what is worth pinning
 * is not the tracing (Contours already covers that) but the three things that
 * make the field different from elevation:
 *
 *  - it is a *derivative* of the terrain, so it needs pre-smoothing or it
 *    fractures into noise;
 *  - it moves when the sun moves, which no other isoline in this app does;
 *  - it is not level, so every vertex has to be draped rather than emitted at a
 *    constant height.
 */
const PAGE = 'http://localhost:5173'

/** Builds a smooth synthetic cone and returns the Iso layer under `over`. */
async function isoStats(page, over = {}) {
  return page.evaluate(async (over) => {
    const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
    const { buildTerrain } = await import('/src/utils/terrain.js')
    const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')

    const N = 128
    const px = new Float32Array(N * N)
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const dx = (c - N / 2) / (N / 2), dy = (r - N / 2) / (N / 2)
      px[r * N + c] = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)) * 0.8 + 0.1
    }
    const P = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale: 1, blurRadius: 0 }
    const terrain = buildTerrain(px, new Uint8Array(N * N).fill(1), N, N, P)
    const layer = buildLineGeometry(terrain, { ...P, enabledLines: false, enabledIso: true, ...over })
      .find((l) => l.id === 'Iso')
    if (!layer) return null

    const pos = layer.positions
    let finite = true, minY = Infinity, maxY = -Infinity
    for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) finite = false
    for (let i = 1; i < pos.length; i += 3) {
      if (pos[i] < minY) minY = pos[i]
      if (pos[i] > maxY) maxY = pos[i]
    }
    return { segs: pos.length / 6, finite, yRange: +(maxY - minY).toFixed(2),
             first: Array.from(pos.slice(0, 6)) }
  }, over)
}

test('isophotes trace the light, and it is not a level set of the ground', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  const base = await isoStats(page)
  expect(base, 'the mode must produce a layer').not.toBeNull()
  expect(base.segs, 'and draw something').toBeGreaterThan(100)
  expect(base.finite, 'with no NaN reaching the buffer').toBe(true)

  /*
   * The defining difference from Contours. A contour sits at one elevation, so
   * its layer would be flat in y; an isophote crosses the terrain freely, so it
   * must span a real share of the relief. On this cone the full range is 80
   * world units.
   */
  expect(base.yRange, 'an isophote is not level').toBeGreaterThan(20)

  // More levels, more lines — the count is a count, not an interval.
  const more = await isoStats(page, { levelsIso: 16 })
  expect(more.segs).toBeGreaterThan(base.segs)
})

test('moving the sun moves the lines', async ({ page }) => {
  // No other isoline in this app does this: contours are indifferent to the
  // light. If this ever passes trivially, the field is not being recomputed.
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  const nw = await isoStats(page, { sunAzimuthIso: 315 })
  const se = await isoStats(page, { sunAzimuthIso: 135 })
  expect(nw.segs).toBeGreaterThan(100)
  expect(se.segs).toBeGreaterThan(100)
  expect(nw.first, 'the same line cannot start in the same place under two suns')
    .not.toEqual(se.first)
})

test('flat ground has no isophotes, and raw ground has too many', async ({ page }) => {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  // With no relief every face points the same way, so the field is constant and
  // there is no level set to trace. Drawing anything here would be inventing it.
  expect(await isoStats(page, { elevScale: 0 })).toBeNull()

  /*
   * And the reason `radiusIso` exists. Illumination is a slope, so measuring it
   * off the raw grid inherits every cell-scale bump: on the reference terrain
   * the level set runs to 1 386 994 segments at radius 0 against 87 372 at 6.
   * Smoothing must therefore cost lines, and cost them monotonically.
   */
  const sharp  = await isoStats(page, { radiusIso: 0 })
  const smooth = await isoStats(page, { radiusIso: 6 })
  expect(sharp.segs, 'the raw field is the noisy one').toBeGreaterThan(smooth.segs)
})
