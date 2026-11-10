/**
 * Pen preview: the screen draws every line at the pen tip's width on paper,
 * and the SVG keeps the widths set in each mode.
 */
import { test, expect } from '@playwright/test'

/** Dark pixels in a screenshot of the canvas, counted in the page. */
async function inkOf(page, patch) {
  await page.evaluate(async (patch) => {
    window.erzberg.setParams(patch)
    await window.erzberg.settle()
  }, patch)
  const png = (await page.locator('canvas').first().screenshot()).toString('base64')
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 384) n++
    return n
  }, png)
}

async function svgOf(page) {
  const [d] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.evaluate(() => window.erzberg.export('svg')),
  ])
  let svg = ''
  for await (const c of await d.createReadStream()) svg += c
  return svg
}

test('pen preview draws lines at the pen width on screen and leaves the SVG alone', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5173/?automation')
  await page.waitForFunction(() => window.erzberg?.version === 1, null, { timeout: 60_000 })

  const base = { enabledLines: true, weightLines: 1, colorLines: '#000000', bgColor: '#ffffff',
    showFrame: true, plotWidthMm: 297 }
  const off = await inkOf(page, { ...base, plotPenPreview: false, plotPenMm: 1.5 })
  const thick = await inkOf(page, { ...base, plotPenPreview: true, plotPenMm: 1.5 })
  const thin = await inkOf(page, { ...base, plotPenPreview: true, plotPenMm: 0.1 })
  expect(off).toBeGreaterThan(0)
  expect(thick, 'a 1.5 mm pen draws wider than 1 px lines').toBeGreaterThan(off * 1.5)
  expect(thin, 'a 0.1 mm pen draws thinner than 1.5 mm').toBeLessThan(thick)

  // The readout names the same conversion.
  await expect(page.getByTestId('plot-pen-px')).toContainText('Pen 0.10 mm =')

  // The SVG keeps the mode's own width either way.
  const width = (svg) => svg.match(/data-name="Lines"[^>]*data-pen-mm="([\d.]+)"|data-pen-mm="([\d.]+)"[^>]*data-name="Lines"/)
  const a = width(await svgOf(page))
  await page.evaluate(async () => { window.erzberg.setParams({ plotPenPreview: false }); await window.erzberg.settle() })
  const b = width(await svgOf(page))
  expect(a?.[0], 'the Lines layer carries a pen width').toBeTruthy()
  expect(a.slice(1)).toEqual(b.slice(1))
  expect(errors).toEqual([])
})

test('pen preview gives dashes round pen ends, so gaps narrower than the pen close', async ({ page }) => {
  /*
   * A pen rounds both ends of every dash, so each dash on paper is one pen
   * width longer than its length, and a gap narrower than the pen fills in.
   * LineMaterial draws dashes with flat ends at their true length, which left
   * gaps in the preview that the pen would close.
   */
  test.setTimeout(240_000)
  await page.goto('http://localhost:5173/?automation')
  await page.waitForFunction(() => window.erzberg?.version === 1, null, { timeout: 60_000 })
  const base = { enabledLines: true, spacingLines: 14, colorLines: '#000000', bgColor: '#ffffff',
    showFrame: true, plotWidthMm: 297, plotPenPreview: true, plotPenMm: 2 }
  const solid = await inkOf(page, { ...base, dashLines: 'solid' })
  const dashed = await inkOf(page, { ...base, dashLines: 'dashed' })
  expect(dashed / solid, `dashed ${dashed} vs solid ${solid}`).toBeGreaterThan(0.85)
})
