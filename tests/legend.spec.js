/**
 * The legend, end to end: the panel switch, the viewport, the SVG, and a preset
 * that carries its sheet.
 *
 * The unit suite proves what the legend lists and where it sits. This checks
 * that the entries App reads from the live plate reach the overlay and the
 * exporter, and that both draw the same ramp.
 *
 * In the heavy project: it reads a download.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { openStage, resetToDefaults } from './helpers.js'

const DEM = 'http://localhost:5173/tests/testdata/geotiff.tif'

test('the legend switch lists the plate in the panel and the viewport', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
  await openStage(page, 'overlay')
  const section = page.locator('[data-testid="section-legend"]')
  await section.scrollIntoViewIfNeeded()
  await section.click()
  await page.locator('[data-testid="legend-on"]').click()
  // The default plate draws Lines in one ink, and nothing by a ramp.
  await expect(page.locator('[data-testid="legend-readout"]')).toHaveText('Layers (1)')
  await expect(page.locator('[data-testid="sheet-marks"] text', { hasText: 'LAYERS' })).toHaveCount(1)
  expect(errors).toEqual([])
})

test('the viewport and the SVG draw the same ramp, in metres', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5173/?automation')
  await page.waitForFunction(() => window.erzberg?.version === 1, null, { timeout: 60_000 })
  await page.evaluate((url) => window.erzberg.loadRaster('geotiff.tif', url), DEM)
  await page.evaluate(async () => {
    window.erzberg.setParams({ showFill: true, fillHypsometric: true, fillBanded: true, fillHypsoInterval: 20,
      legendOn: true, frameMarkFont: 'mono', tilt: 0, rotation: 0 })
    await window.erzberg.settle()
  })
  const marks = page.locator('[data-testid="sheet-marks"]')
  await expect(marks.locator('text', { hasText: 'ELEVATION' })).toHaveCount(1, { timeout: 30_000 })
  await expect(marks.locator('text', { hasText: /^[\d ]+ – [\d ]+ m$/ })).toHaveCount(1)
  // Five bands, each its own colour from the ramp.
  const fills = await marks.locator('rect').evaluateAll((rs) => rs.map((r) => r.getAttribute('fill')))
  const swatches = new Set(fills.filter((f) => /^#[0-9a-f]{6}$/.test(f)))
  expect(swatches.size).toBeGreaterThanOrEqual(5)

  const [d] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.evaluate(() => window.erzberg.export('svg')),
  ])
  const file = info.outputPath('legend.svg')
  await d.saveAs(file)
  const svg = readFileSync(file, 'utf8')
  expect(svg).toContain('>ELEVATION</text>')
  expect(svg).toMatch(/font-family="Menlo[^"]*monospace"/)
  for (const c of swatches) expect(svg, `swatch ${c}`).toContain(`fill="${c}"`)
  expect(errors).toEqual([])
})

test('a preset with a sheet block turns its marks and legend on', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
  await openStage(page, 'presets')
  const tile = page.locator('[data-testid="preset-Wild Terrain"]')
  await tile.scrollIntoViewIfNeeded()
  await tile.click()
  const marks = page.locator('[data-testid="sheet-marks"]')
  await expect(marks.locator('text', { hasText: 'ELEVATION' })).toHaveCount(1)
  await expect(marks.locator('text', { hasText: 'Wild Terrain' })).toHaveCount(1)
  expect(await marks.locator('text').first().getAttribute('font-family')).toMatch(/monospace$/)
  await openStage(page, 'overlay')
  const section = page.locator('[data-testid="section-legend"]')
  await section.scrollIntoViewIfNeeded()
  await section.click()
  await expect(page.locator('[data-testid="legend-on"]')).toBeChecked()
  await expect(page.locator('[data-testid="legend-part-line"]')).not.toBeChecked()
})
