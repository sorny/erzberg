import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * The four that read the raster as a display rather than as ground.
 *
 * The sharpest assertion here is Palette Cycle's: a palette cycle is, by
 * definition, a change of colour and *nothing else* — the whole trick on a
 * 16-colour machine was animating a waterfall without touching a pixel of the
 * frame buffer. If advancing the phase moves a single vertex, the mode is
 * mis-named.
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
  return { sprite: pick('Sprite'), scan: pick('Scanline'),
           pal: pick('Palette'), ret: pick('Retic') }
}, over)

const GRAD = {
  hypsoPalette: true, hypsoModePalette: 'elevation',
  gradientStops: [{ pos: 0, color: '#0000ff' }, { pos: 0.5, color: '#ffff00' },
                  { pos: 1, color: '#ff0000' }],
}

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

test('interlace drops lines, roll moves them, comb only recolours', async ({ page }) => {
  await ready(page)
  // interlace 1 draws every line — the default is 2, which is the look but the
  // wrong baseline for measuring what dropping lines does.
  const base = { enabledScanline: true, spacingScanline: 3, rollScanline: 0,
                 combScanline: 0, interlaceScanline: 1 }
  const solid = await run(page, base)
  const every2 = await run(page, { ...base, interlaceScanline: 2 })
  expect(every2.scan.n).toBeLessThan(solid.scan.n * 0.6)

  const rolled = await run(page, { ...base, rollScanline: 6 })
  expect(rolled.scan.pos).not.toBe(solid.scan.pos)

  // The comb rides the colour buffer, because opacity is per layer and could
  // not vary line to line. So it must leave every vertex exactly where it was.
  const combed = await run(page, { ...base, combScanline: 0.9 })
  expect(combed.scan.pos).toBe(solid.scan.pos)
  expect(combed.scan.col).not.toBe(solid.scan.col)
})

test('a palette cycle moves colour and nothing else', async ({ page }) => {
  await ready(page)
  const base = { enabledPalette: true, tiersPalette: 12, ...GRAD }
  const a = await run(page, { ...base, phasePalette: 0 })
  const b = await run(page, { ...base, phasePalette: 0.37 })
  const c = await run(page, { ...base, phasePalette: 0.74 })
  expect(a.pal.n).toBeGreaterThan(100)
  // Identical geometry at every phase — that is what makes it a *palette* cycle.
  expect(b.pal.pos).toBe(a.pal.pos)
  expect(c.pal.pos).toBe(a.pal.pos)
  // And a different palette at each.
  expect(b.pal.col).not.toBe(a.pal.col)
  expect(c.pal.col).not.toBe(a.pal.col)
  expect(c.pal.col).not.toBe(b.pal.col)
})

test('the phase wraps rather than running off the end of the ramp', async ({ page }) => {
  await ready(page)
  const base = { enabledPalette: true, tiersPalette: 12, ...GRAD }
  const zero = await run(page, { ...base, phasePalette: 0 })
  const one  = await run(page, { ...base, phasePalette: 1 })
  expect(one.pal.col).toBe(zero.pal.col)
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
