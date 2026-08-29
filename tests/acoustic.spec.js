import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * The scanline read as a signal.
 *
 * The load-bearing claim is Bandsplit's: that a pyramid of differences of box
 * blurs is a *decomposition* and not merely a stack of blurs that look like one.
 * A decomposition has one testable property — it sums back to what it came from
 * — so the spec drapes the bands at unit gain and checks the result against the
 * terrain vertex for vertex. If the pyramid is wrong, the equaliser is not an
 * equaliser and the mode is a lie.
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
  const yRange = (id) => {
    const l = of(id)
    if (!l) return null
    let lo = Infinity, hi = -Infinity
    for (let i = 1; i < l.positions.length; i += 3) {
      if (l.positions[i] < lo) lo = l.positions[i]
      if (l.positions[i] > hi) hi = l.positions[i]
    }
    return { lo, hi }
  }
  /*
   * Worst disagreement between a drawn vertex and the terrain under it.
   *
   * Compared against the *bilinear* sample at the vertex's own fractional
   * position, not the nearest cell. The trace is sampled along a ray at
   * fractional coordinates, so a nearest-cell comparison folds up to half a
   * cell of relief into the error and reports 3% of the range on a terrain the
   * pyramid reconstructs exactly — measuring the sampler, not the claim.
   */
  const { sampleBilinear } = await import('/src/utils/terrain.js')
  const drapeError = (id) => {
    const l = of(id)
    if (!l) return Infinity
    let worst = 0
    for (let i = 0; i < l.positions.length; i += 3) {
      const c = (l.positions[i] + t.halfW) / t.scl
      const r = (l.positions[i + 2] + t.halfH) / t.scl
      const b = sampleBilinear(t.grid, null, t.rows, t.cols, r, c)
      if (b !== b) continue
      worst = Math.max(worst, Math.abs(l.positions[i + 1] - (b - 0.5) * 100))
    }
    return worst
  }
  return { band: n('Bandsplit'), bandRange: yRange('Bandsplit'), drapeError: drapeError('Bandsplit'),
           env: n('Envelope'), envRange: yRange('Envelope'),
           liss: n('Lissajous'), lissRange: yRange('Lissajous'),
           zero: n('ZeroCross'), zeroIsPoints: !!of('ZeroCross')?.isPoints,
           range: t.maxElev - t.minElev }
}, over)

const FLAT = { gain0Bandsplit: 1, gain1Bandsplit: 1, gain2Bandsplit: 1, gain3Bandsplit: 1,
               gain4Bandsplit: 1, gain5Bandsplit: 1, gain6Bandsplit: 1 }

test('draped at unit gain, the bands sum back to the terrain', async ({ page }) => {
  await ready(page)
  // ΣL_b = H by construction. If the pyramid is right, draping at unit gain puts
  // every vertex on the ground it came from — to bilinear-sampling error, since
  // the trace is sampled along a ray and compared to the nearest cell.
  const r = await run(page, {
    enabledBandsplit: true, modeBandsplit: 'draped', bandsBandsplit: 5,
    spacingBandsplit: 8, ...FLAT,
  })
  expect(r.band).toBeGreaterThan(500)
  expect(r.drapeError).toBeLessThan(r.range * 0.001)
})

test('the equaliser actually filters', async ({ page }) => {
  await ready(page)
  const base = { enabledBandsplit: true, modeBandsplit: 'draped', bandsBandsplit: 5,
                 spacingBandsplit: 12, ...FLAT }
  const full = await run(page, base)
  // Kill the residual — the band carrying the massif — and the relief collapses.
  const noLow = await run(page, { ...base, gain5Bandsplit: 0 })
  // Kill the finest band and the skyline survives almost intact.
  const noHigh = await run(page, { ...base, gain0Bandsplit: 0 })
  const span = (x) => x.bandRange.hi - x.bandRange.lo
  expect(span(noLow)).toBeLessThan(span(full) * 0.5)
  expect(span(noHigh)).toBeGreaterThan(span(full) * 0.8)
})

test('stacked draws one trace per band', async ({ page }) => {
  await ready(page)
  const three = await run(page, { enabledBandsplit: true, bandsBandsplit: 3, spacingBandsplit: 20 })
  const six   = await run(page, { enabledBandsplit: true, bandsBandsplit: 6, spacingBandsplit: 20 })
  // B bands plus the residual, over the same set of lines.
  expect(six.band / three.band).toBeGreaterThan(1.5)
})

test('the envelope is symmetric about the ground it sits on', async ({ page }) => {
  await ready(page)
  const r = await run(page, { enabledEnvelope: true, spacingEnvelope: 6, rungsEnvelope: 0 })
  expect(r.env).toBeGreaterThan(200)
  // A one-directional follower is lopsided by construction — it rises instantly
  // and decays only afterwards. Running it back over its own output is what makes
  // the block symmetric, so the two halves must span equally about the middle.
  const mid = (r.envRange.hi + r.envRange.lo) / 2
  expect(Math.abs(mid)).toBeLessThan(r.range * 0.08)
})

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

test('lissajous figures are flat, and there are as many as asked for', async ({ page }) => {
  await ready(page)
  const one = await run(page, { enabledLissajous: true, figuresLissajous: 1 })
  const six = await run(page, { enabledLissajous: true, figuresLissajous: 6 })
  expect(six.liss).toBeGreaterThan(one.liss * 4)
  // Flat by design: draping would put the trace at the elevation of a third
  // place, unrelated to either axis.
  expect(one.lissRange.hi - one.lissRange.lo).toBeCloseTo(0, 5)
})
