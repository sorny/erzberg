import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * The scanline read as a signal — what survives of it.
 *
 * Bandsplit, Envelope and Lissajous were cut. Zero Crossings is the one left,
 * and its claim is that it measures something neither slope nor curvature does:
 * how often the ground crosses its own running mean, which is a *pitch*. That
 * only holds because of the detrend, so that is what is asserted here — without
 * it a scanline crosses its own average twice on a whole mountain and the mode
 * draws two dots.
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

  const N = 130
  const g = new Float32Array(N * N)
  const h2 = (x, y, s) => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0
    n = Math.imul(n ^ (n >>> 13), 1274126177)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295
  }
  const vn = (x, y, s) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
    return h2(ix, iy, s) * (1 - u) * (1 - v) + h2(ix + 1, iy, s) * u * (1 - v)
         + h2(ix, iy + 1, s) * (1 - u) * v + h2(ix + 1, iy + 1, s) * u * v
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    let a = 0, amp = 1, f = 1 / 34, sum = 0
    for (let o = 0; o < 5; o++) {
      a += amp * vn(c * f, r * f, 7 + o * 29); sum += amp; amp *= 0.55; f *= 2.03
    }
    g[r * N + c] = a / sum
  }
  const mask = new Uint8Array(N * N).fill(1)
  const p = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale: 1, blurRadius: 0,
              enabledLines: false, ...over }
  const t = buildTerrain(g, mask, N, N, p)
  const layers = buildLineGeometry(t, p)
  const of = (id) => layers.find((x) => x.id === id)
  const n = (id) => { const l = of(id); return l ? l.positions.length / 6 : 0 }
  return { zero: n('ZeroCross'), zeroIsPoints: !!of('ZeroCross')?.isPoints,
           range: t.maxElev - t.minElev }
}, over)

test('zero crossings are points, and detrending is what makes them a pitch', async ({ page }) => {
  await ready(page)
  const tight = await run(page, { enabledZeroCross: true, detrendZeroCross: 2, spacingZeroCross: 2 })
  const loose = await run(page, { enabledZeroCross: true, detrendZeroCross: 30, spacingZeroCross: 2 })
  expect(tight.zeroIsPoints).toBe(true)
  expect(tight.zero).toBeGreaterThan(200)
  // A wider running mean is crossed less often: with no detrend at all a
  // scanline crosses its own average twice on a whole mountain.
  expect(loose.zero).toBeLessThan(tight.zero * 0.6)
})
