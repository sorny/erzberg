/**
 * The map-symbol, process, mesh and light-shaft modes in the panel: each turns
 * on from the Marks sheet, opens its own section, and reads back what it drew from the
 * live plate.
 *
 * The unit suite proves what each builder draws. This checks that the worker
 * runs them on the sample plate and that the notes reach the readouts.
 */
import { test, expect } from '@playwright/test'
import { openStage, resetToDefaults } from './helpers.js'

const MODES = [
  ['TreeLine', 'Tree Line', 'treeline', /^[\d,.\s ]+ trees$/],
  ['Constellation', 'Constellation', 'constellation', /^\d+ stars$/],
  ['Fronts', 'Weather Fronts', 'fronts', /^\d+ fronts$/],
  ['Tally', 'Tally', 'tally', /^[\d,.\s ]+ marks$/],
  ['Rain', 'Orographic Rain', 'rain', /^[\d,.\s ]+ streaks$/],
  ['Ripples', 'Sand Ripples', 'ripples', /^\d+% sand$/],
  ['Hoarfrost', 'Hoarfrost', 'hoarfrost', /^[\d,.\s ]+ crystals$/],
  ['Sediment', 'Sediment', 'sediment', /^[\d,.\s ]+ dots$/],
  ['Stitch', 'Cross-Stitch', 'stitch', /^[\d,.\s ]+ stitches$/],
  ['Tin', 'TIN Facets', 'tin', /^[\d,.\s ]+ facets$/],
  ['Shafts', 'Light Shafts', 'shafts', /^[\d,.\s ]+ shafts$/],
  ['Envelope', 'Summit Envelope', 'envelope', /^\d+% of the net stands clear of the ground$/],
]

for (const [id, title, kind, readout] of MODES) {
  test(`${title} turns on from the sheet and reads back what it drew`, async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('http://localhost:5173')
    await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
    await resetToDefaults(page)
    await openStage(page, 'marks')
    await page.click(`[data-testid="mode-tile-${id}"]`)
    await page.click(`[data-testid="mode-lit-${id}"]`)
    await expect(page.locator('[data-testid="mode-back"]')).toContainText(title)
    await expect(page.locator(`[data-testid="${kind}-readout"]`)).toHaveText(readout, { timeout: 30_000 })
    expect(errors).toEqual([])
  })
}

test('Constellation draws dots, or only its links, from the point symbol', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
  await openStage(page, 'marks')
  await page.click('[data-testid="mode-tile-Constellation"]')
  await page.click('[data-testid="mode-lit-Constellation"]')
  const readout = page.locator('[data-testid="constellation-readout"]')
  await expect(readout).toHaveText(/^\d+ stars$/, { timeout: 30_000 })
  await page.click('[data-testid="constellation-mark-dot"]')
  await expect(readout).toHaveText(/^\d+ summits$/, { timeout: 30_000 })
  await page.click('[data-testid="constellation-mark-none"]')
  await expect(readout).toHaveText(/^\d+ summits$/, { timeout: 30_000 })
  await expect(page.getByText('Symbol size')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Stems Datum and Line Printer Value show their choice', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
  await openStage(page, 'marks')
  await page.click('[data-testid="mode-tile-Stems"]')
  await page.click('[data-testid="mode-lit-Stems"]')
  // The default is shown as chosen, and each option stores the value the builder reads.
  await expect(page.locator('[data-testid="stems-datum-mean"]')).toHaveAttribute('aria-pressed', 'true')
  await page.click('[data-testid="stems-datum-min"]')
  await expect(page.locator('[data-testid="stems-datum-min"]')).toHaveAttribute('aria-pressed', 'true')
  await page.click('[data-testid="mode-back"]')
  await page.click('[data-testid="mode-tile-Printer"]')
  await page.click('[data-testid="mode-lit-Printer"]')
  await expect(page.locator('[data-testid="printer-field-elevation"]')).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})
