import { test, expect } from '@playwright/test'

// Switch inputs are display:none inside a label that is a *sibling* of the text
// span, so clicking the label text does nothing — walk from the span instead.
const toggleFor = (page, label) =>
  page.locator(`xpath=//span[text()="${label}"]/following-sibling::label`)

async function openApp(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  const t = page.locator('[data-testid="sidebar-toggle"]')
  if ((await t.innerText()) === '◀') { await t.click(); await page.waitForTimeout(400) }
  await page.waitForTimeout(1500)
}

/**
 * Count of *well-populated* luminance levels over the left 60% of the canvas
 * (clear of the sidebar), in 32 buckets.
 *
 * Counting merely-present levels is not enough to tell lit relief from an unlit
 * slab: the slab plus the page background plus antialiased edges already touch
 * plenty of buckets. Requiring each level to hold ≥1% of the sampled pixels
 * leaves only the levels that cover real area — 2–3 for a flat slab, many more
 * once the surface is actually shaded.
 */
const shadingLevels = (page) => page.evaluate(() => {
  const c = document.querySelector('canvas')
  const off = document.createElement('canvas')
  off.width = 300; off.height = 200
  const ctx = off.getContext('2d')
  ctx.drawImage(c, 0, 0, Math.round(c.width * 0.6), c.height, 0, 0, 300, 200)
  const d = ctx.getImageData(0, 0, 300, 200).data
  const hist = new Array(32).fill(0)
  let total = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue
    hist[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) >> 3]++
    total++
  }
  return hist.filter((n) => n > total * 0.01).length
})

test('raw terrain view renders shaded relief', async ({ page }) => {
  await openApp(page)
  // Lines off, so the surface is the only thing on screen.
  await page.locator('#hm-panel-body > div').filter({ hasText: /^Mode: Lines/ }).first()
    .locator('label').first().click({ force: true })
  await page.waitForTimeout(1200)

  const tog = toggleFor(page, 'Raw terrain view')
  await tog.click({ force: true })
  await expect(tog.locator('input')).toBeChecked()
  await page.waitForTimeout(2500)

  // Regression guard: needsSurfaceShading once read showRawTerrain off `style`,
  // but it lives on `view`. The worker then shipped no normals and the surface
  // rendered as a flat unlit slab. Measured 2 levels broken, 8 lit — 5 splits
  // them with margin on both sides.
  const levels = await shadingLevels(page)
  console.log(`raw terrain shading levels: ${levels}`)
  expect(levels, 'raw terrain must be lit, not a flat slab').toBeGreaterThan(5)
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
