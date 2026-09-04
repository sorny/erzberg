import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

// The switch itself, by the name it carries. This used to walk
// `//span[text()="X"]/following-sibling::label` because the text was a bare
// node in a span and clicking it did nothing — which is the accessibility gap
// that has since been fixed, so the text is now a real <label> and the span has
// no direct text node to match. Naming the checkbox is both shorter and immune
// to the row's layout: TogColor nests its switch a level deeper and this finds
// it just the same.
const toggleFor = (page, label) =>
  page.locator(`input[type=checkbox][aria-label="${label}"]`)

async function openApp(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  const t = page.locator('[data-testid="sidebar-toggle"]')
  if ((await t.innerText()) === '◀') { await t.click(); await page.waitForTimeout(400) }
  await page.waitForTimeout(1500)
  await resetToDefaults(page)
}

/**
 * Downsampled signature of the canvas, the largest channel spread found, and a
 * count of *well-populated* luminance levels in 32 buckets.
 *
 * Sampling is a central band, deliberately clear of the bottom-left axes gizmo —
 * that widget is UI chrome and stays coloured in raw view by design, so
 * including it would make the achromatic check meaningless.
 *
 * Counting merely-present levels would not distinguish a heightmap from a flat
 * slab: the slab plus the background plus antialiased edges already touch plenty
 * of buckets. Requiring each level to hold ≥1% of the sampled pixels leaves only
 * the levels covering real area — 2–3 for a flat tone, many more for real data.
 */
const rawSample = (page) => page.evaluate(() => {
  const c = document.querySelector('canvas')
  const off = document.createElement('canvas')
  off.width = 200; off.height = 100
  const ctx = off.getContext('2d')
  ctx.drawImage(c, 0, Math.round(c.height * 0.1), Math.round(c.width * 0.55), Math.round(c.height * 0.6),
                0, 0, 200, 100)
  const d = ctx.getImageData(0, 0, 200, 100).data
  let maxChroma = 0, n = 0
  const hist = new Array(32).fill(0)
  const sig = []
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    if (d[i + 3] >= 8) {
      maxChroma = Math.max(maxChroma, Math.abs(r - g), Math.abs(g - b), Math.abs(r - b))
      hist[(0.299 * r + 0.587 * g + 0.114 * b) >> 3]++
      n++
    }
    if ((i / 4) % 37 === 0) sig.push(r, g, b)
  }
  return { maxChroma, levels: hist.filter((x) => x > n * 0.01).length, sig: sig.join(',') }
})

test('raw terrain view shows the heightmap as a flat greyscale plane', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openApp(page)

  const tog = toggleFor(page, 'Raw terrain view')
  await tog.click({ force: true })
  await expect(tog).toBeChecked()
  await page.waitForTimeout(2500)

  const raw = await rawSample(page)
  console.log(`raw terrain: maxChroma=${raw.maxChroma} levels=${raw.levels}`)

  // Greyscale: the surface is drawn straight from the brightness attribute, so
  // no fill colour, gradient or overlay may survive into the output.
  expect(raw.maxChroma, 'raw terrain must be achromatic').toBeLessThanOrEqual(2)
  // …but still carrying the heightmap, not one flat tone. This also covers the
  // case that made the old shading assertion necessary: raw view is now the only
  // fill layer, so the worker ships geometry with no normals at all, and the
  // shader must return before it ever touches vNormal.
  expect(raw.levels, 'raw terrain must show the heightmap, not a flat slab').toBeGreaterThan(5)

  // Nothing else may be drawn — so a draw mode going on or off cannot move a
  // single pixel. A weaker "are lines dark?" check would pass even with lines
  // visible, since most of them are dark against a dark plane anyway.
  const lines = page.locator('[data-section="Mode: Lines"]')
    .locator('label').first()
  const wasOn = await lines.isChecked()
  await lines.click({ force: true })
  // Without this the pixel-equality check below would also pass if the click
  // simply missed its target.
  await expect(lines).toBeChecked({ checked: !wasOn })
  await page.waitForTimeout(2000)
  const after = await rawSample(page)
  expect(after.sig, 'toggling a draw mode must not change raw view').toBe(raw.sig)

  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
})

test('brightness bounds follow the data, not the 0–1 range', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

  // buildTerrain is pure, so the dev server can hand it over directly — this
  // checks the numbers the greyscale stretch is built on rather than inferring
  // them from pixels.
  const r = await page.evaluate(async () => {
    const { buildTerrain } = await import('/src/utils/terrain.js')
    const w = 64, h = 64
    const px = new Float32Array(w * h)
    for (let i = 0; i < px.length; i++) px[i] = 0.4 + 0.2 * ((i % w) / (w - 1))
    const p = { resolution: 1, blurRadius: 0, gridOffsetX: 0, gridOffsetY: 0,
                blackPoint: 0, whitePoint: 255, elevScale: 1 }
    const t = buildTerrain(px, null, w, h, p)
    const empty = buildTerrain(px, new Uint8Array(w * h), w, h, p)
    return { minB: t.minB, maxB: t.maxB, emptyMin: empty.minB, emptyMax: empty.maxB }
  })
  console.log(`brightness bounds: ${JSON.stringify(r)}`)

  // A raster confined to 0.4–0.6 must report exactly that, so raw view can
  // stretch it to a full black-to-white ramp instead of drawing flat mid-grey.
  expect(r.minB).toBeCloseTo(0.4, 2)
  expect(r.maxB).toBeCloseTo(0.6, 2)
  // The bounds seed to 1 and 0, so an all-NoData raster would otherwise ship a
  // crossed range and invert the ramp.
  expect(r.emptyMin).toBe(0)
  expect(r.emptyMax).toBe(1)
})

test.describe('large retina window', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 2560, height: 1440 } })

  test('supersampling never outruns the real drawing buffer', async ({ page }) => {
    await openApp(page)
    const buf = () => page.evaluate(() => {
      const c = document.querySelector('canvas')
      const g = c.getContext('webgl2') || c.getContext('webgl')
      return {
        req: [c.width, c.height],
        got: [g.drawingBufferWidth, g.drawingBufferHeight],
        vp: Array.from(g.getParameter(g.VIEWPORT)).slice(2),
      }
    })

    for (const v of ['1', '1.5', '2']) {
      await page.locator('input[type="range"][min="1"][max="2"][step="0.5"]').fill(v)
      await page.waitForTimeout(2000)
      const b = await buf()
      console.log(`supersampling ${v}× req=${b.req} got=${b.got} vp=${b.vp}`)
      // A browser that cannot afford the buffer clamps it silently while
      // canvas.width keeps reporting the request, so Three draws through a
      // viewport bigger than the framebuffer and the scene lands off-centre.
      expect(b.got, `${v}×: drawing buffer must match the request`).toEqual(b.req)
      expect(b.vp, `${v}×: viewport must match the buffer`).toEqual(b.got)
    }
  })
})
