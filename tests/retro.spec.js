import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * The two that read the raster as a surface to be tiled or cracked.
 *
 * Scanline and Palette Cycle were cut from this family. What is left is Sprite,
 * which quantises the ground into blocks, and Reticulation, which lays a
 * cellular network over it — and in both the interesting assertion is about what
 * the mode *refuses* to draw: a riser only where a neighbour actually sits
 * lower, a wall only where the plate is dark enough to have cracked.
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

  const N = 120
  const g = new Float32Array(N * N)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const dx = (c - N / 2) / (N / 2), dy = (r - N / 2) / (N / 2)
    g[r * N + c] = Math.max(0.02, 1 - Math.hypot(dx, dy))
  }
  const mask = new Uint8Array(N * N).fill(1)
  const p = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale: 1, blurRadius: 0,
              enabledLines: false, ...over }
  const t = buildTerrain(g, mask, N, N, p)
  const layers = buildLineGeometry(t, p)
  const of = (id) => layers.find((x) => x.id === id)
  const sig = (a) => {
    if (!a) return null
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[i] * (1 + (i % 7))
    return Math.round(s * 1000)
  }
  const pick = (id) => {
    const l = of(id)
    if (!l) return { n: 0 }
    return { n: l.positions.length / 6, pos: sig(l.positions), col: sig(l.colors),
             lids: l.lids ? l.lids.indices.length / 3 : 0, isPoints: !!l.isPoints }
  }
  return { sprite: pick('Sprite'), ret: pick('Retic') }
}, over)

test('sprite draws blocks with filled tops', async ({ page }) => {
  await ready(page)
  const r = await run(page, { enabledSprite: true, spacingSprite: 6, tiersSprite: 8 })
  expect(r.sprite.n).toBeGreaterThan(200)
  expect(r.sprite.lids).toBeGreaterThan(100)     // two triangles per block top
  const bare = await run(page, { enabledSprite: true, spacingSprite: 6, facesSprite: false })
  expect(bare.sprite.lids).toBe(0)
  expect(bare.sprite.n).toBe(r.sprite.n)         // the outline is unaffected
})

test('more tiers means more risers', async ({ page }) => {
  await ready(page)
  const few  = await run(page, { enabledSprite: true, spacingSprite: 5, tiersSprite: 3 })
  const many = await run(page, { enabledSprite: true, spacingSprite: 5, tiersSprite: 20 })
  // The top-face outlines are fixed by the lattice; only the risers can grow,
  // and they only exist where a neighbour actually sits lower.
  expect(many.sprite.n).toBeGreaterThan(few.sprite.n)
})

test('reticulation draws cell walls, seeded and tone-gated', async ({ page }) => {
  await ready(page)
  const a = await run(page, { enabledRetic: true, cellRetic: 12, seedRetic: 5 })
  const b = await run(page, { enabledRetic: true, cellRetic: 12, seedRetic: 5 })
  const c = await run(page, { enabledRetic: true, cellRetic: 12, seedRetic: 6 })
  expect(a.ret.isPoints).toBe(true)
  expect(a.ret.n).toBeGreaterThan(300)
  expect(b.ret.pos).toBe(a.ret.pos)
  expect(c.ret.pos).not.toBe(a.ret.pos)

  /*
   * Cell size changes the *pattern*, not the coverage.
   *
   * The crack width is proportional to the cell, so total wall area comes out
   * roughly constant as the cells grow: fewer boundaries, each wider. That is
   * deliberate — it keeps the crazing looking like crazing at any scale rather
   * than fading out as the cells open up — and it means coverage is `width`'s
   * job, not the cell's. Measured: cell 5 → 768 dots, cell 30 → 838.
   */
  const fine   = await run(page, { enabledRetic: true, cellRetic: 5 })
  const coarse = await run(page, { enabledRetic: true, cellRetic: 30 })
  expect(fine.ret.pos).not.toBe(coarse.ret.pos)
  expect(coarse.ret.n).toBeLessThan(fine.ret.n * 2)
  expect(coarse.ret.n).toBeGreaterThan(fine.ret.n * 0.5)

  // Width is the control that adds ink.
  const thin  = await run(page, { enabledRetic: true, cellRetic: 12, widthRetic: 0.2 })
  const thick = await run(page, { enabledRetic: true, cellRetic: 12, widthRetic: 1.5 })
  expect(thick.ret.n).toBeGreaterThan(thin.ret.n * 2)

  // The tone gate is what stops it being wallpaper: inverting it moves the
  // crazing off the low ground and onto the high.
  const low  = await run(page, { enabledRetic: true, cellRetic: 12, densityModeRetic: 'invElev' })
  const high = await run(page, { enabledRetic: true, cellRetic: 12, densityModeRetic: 'elevation' })
  expect(high.ret.pos).not.toBe(low.ret.pos)
})
