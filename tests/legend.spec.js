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

test('a preset without a sheet block takes back the marks the last one set', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
  await openStage(page, 'presets')
  const pick = async (name) => {
    const tile = page.locator(`[data-testid="preset-${name}"]`)
    await tile.scrollIntoViewIfNeeded()
    await tile.click()
  }
  const marks = page.locator('[data-testid="sheet-marks"]')
  await pick('Wild Terrain')
  await expect(marks.locator('text', { hasText: 'ELEVATION' })).toHaveCount(1)
  await pick('Caustics')
  await expect(marks).toHaveCount(0)
  // And back again: the lettered look still letters the sheet.
  await pick('Wild Terrain')
  await expect(marks.locator('text', { hasText: 'Wild Terrain' })).toHaveCount(1)
})

test('the Layers group takes its own title, and each sample can be switched off', async ({ page }) => {
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
  const marks = page.locator('[data-testid="sheet-marks"]')
  await page.locator('[data-testid="legend-line-title"]').fill('Pens')
  await expect(marks.locator('text', { hasText: 'PENS' })).toHaveCount(1)
  await page.locator('[data-testid="legend-line-title"]').fill('')
  await expect(marks.locator('text', { hasText: /^(PENS|LAYERS)$/ })).toHaveCount(0)
  await expect(marks.locator('text', { hasText: 'Lines' })).toHaveCount(1)
  // A typed name replaces the generated one, and clearing it brings that back.
  const name = page.locator('[data-testid="legend-name-mode:Lines"]')
  await expect(name).toHaveAttribute('placeholder', 'Lines')
  await name.fill('Ridge strokes')
  await expect(marks.locator('text', { hasText: 'Ridge strokes' })).toHaveCount(1)
  await name.fill('')
  await expect(marks.locator('text', { hasText: 'Lines' })).toHaveCount(1)
  await page.locator('[data-testid="legend-font-mono"]').click()
  await expect(marks.locator('text', { hasText: 'Lines' })).toHaveAttribute('font-family', /monospace/)
  // The sheet's font is in reach from the legend too.
  await page.locator('[data-testid="legend-font-line"]').click()
  await expect(page.locator('[data-testid="legend-line-font"]')).toBeVisible()
  await expect.poll(() => marks.locator('polyline').count(), { timeout: 15_000 }).toBeGreaterThan(3)
  await expect(marks.locator('text')).toHaveCount(0)
  await page.locator('[data-testid="legend-item-mode:Lines"]').uncheck()
  await expect(marks).toHaveCount(0)
  await expect(page.locator('[data-testid="legend-readout"]')).toContainText('Nothing to explain')
  expect(errors).toEqual([])
})

test('a single-line face letters the marks as strokes, in the viewport and the SVG', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5173/?automation')
  await page.waitForFunction(() => window.erzberg?.version === 1, null, { timeout: 60_000 })
  await page.evaluate(async () => {
    window.erzberg.setParams({ legendOn: true, frameTitle: true, frameTitleText: 'Erzberg', frameMarkFont: 'line', frameMarkLineFont: 'HersheySans1' })
    await window.erzberg.settle()
  })
  const marks = page.locator('[data-testid="sheet-marks"]')
  await expect.poll(() => marks.locator('polyline').count(), { timeout: 30_000 }).toBeGreaterThan(10)
  await expect(marks.locator('text')).toHaveCount(0)
  const [d] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.evaluate(() => window.erzberg.export('svg')),
  ])
  const file = info.outputPath('strokes.svg')
  await d.saveAs(file)
  const svg = readFileSync(file, 'utf8')
  const layer = svg.slice(svg.indexOf('data-name="Scale and north"'))
  expect(layer).toContain('<polyline')
  expect(layer).not.toContain('<text')
  expect(errors).toEqual([])
})

test('the line samples reorder by dragging a grip, or with the arrow keys', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5173/?automation')
  await page.waitForFunction(() => window.erzberg?.version === 1, null, { timeout: 60_000 })
  await page.evaluate(async () => {
    window.erzberg.setParams({ legendOn: true, enabledContours: true, legendCaps: false })
    await window.erzberg.settle()
  })
  await page.keyboard.press('Backslash')
  await openStage(page, 'overlay')
  const section = page.locator('[data-testid="section-legend"]')
  await section.scrollIntoViewIfNeeded()
  // A closed section keeps its body mounted but inert, so ask the header.
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await expect(section).toHaveAttribute('aria-expanded', 'true')
  const marks = page.locator('[data-testid="sheet-marks"]')
  const order = () => marks.locator('text').evaluateAll((ts) => ts.map((t) => t.textContent).filter((t) => /^(Lines|Contours)/.test(t)))
  await expect.poll(order).toEqual(['Lines', expect.stringMatching(/^Contours/)])

  // Drag Contours above Lines.
  const grip = page.locator('[data-testid="legend-grip-mode:Contours"]')
  // `page.mouse` takes raw viewport coordinates, so both rows must be on screen.
  await page.locator('[data-testid="legend-row-mode:Lines"]').scrollIntoViewIfNeeded()
  await grip.scrollIntoViewIfNeeded()
  const target = await page.locator('[data-testid="legend-row-mode:Lines"]').boundingBox()
  const g = await grip.boundingBox()
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  await page.mouse.move(g.x + g.width / 2, target.y + 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(order).toEqual([expect.stringMatching(/^Contours/), 'Lines'])

  // And back down with the keyboard.
  await grip.focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(order).toEqual(['Lines', expect.stringMatching(/^Contours/)])
  expect(errors).toEqual([])
})
