import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resetToDefaults } from './helpers.js'

/**
 * What "Reset all" is required to reset.
 *
 * It used to mean six state objects: terrain, style, points, view and the two
 * gradients. The vectors and the free text were not among them, so a reset left
 * a fetched province of roads, an uploaded track and a typed title sitting on
 * top of bare defaults — the one state the button's own label says it does not
 * produce.
 *
 * The Undo it offers has to put all of it back, and for the vectors that means
 * two halves: the style records *and* the coordinates they point at. One without
 * the other is a layer list drawing nothing.
 */
const PAGE = 'http://localhost:5173'
const FIXTURE = 'tests/testdata/geotiff.tif'

const resetBtn = (page) => page.locator('button', { hasText: /^Reset all$/ })
const textRows = (page) => page.locator('[data-testid^="text-layer-"]')
const vectorRows = (page) => page.locator('[data-testid^="vector-layer-"]')

async function boot(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
}

test('a reset clears the text, and Undo brings it back', async ({ page }) => {
  await boot(page)
  await page.getByText('Text', { exact: true }).first().click()
  await page.waitForTimeout(300)
  await page.locator('[data-testid="text-add"]').click()
  await page.locator('[data-testid^="text-body-"]').first().fill('ERZBERG')
  await page.waitForTimeout(700)
  await expect(textRows(page)).toHaveCount(1)

  await resetBtn(page).click()
  await page.waitForTimeout(900)
  await expect(textRows(page), 'a reset takes the text with it').toHaveCount(0)

  await page.locator('[data-testid="toast-action"]').click()
  await page.waitForTimeout(900)
  await expect(textRows(page), 'Undo puts it back').toHaveCount(1)
  await page.getByText('Text', { exact: true }).first().click()
  await page.waitForTimeout(300)
  await expect(page.locator('[data-testid^="text-body-"]').first()).toHaveValue('ERZBERG')
})

test('a reset clears fetched layers, and Undo restores their geometry too', async ({ page }) => {
  test.skip(!existsSync(FIXTURE), `${FIXTURE} not present (gitignored) — see tests/testdata/README.md`)

  // One way is enough: this is about what a reset does to layers, not about OSM.
  await page.route('**/api/interpreter', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ version: 0.6, elements: [{
      type: 'way', id: 1, tags: { highway: 'motorway' },
      geometry: [{ lat: 47.2, lon: 15.0 }, { lat: 47.3, lon: 15.1 }],
    }] }),
  }))

  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="load-geotiff"]'),
  ])
  await chooser.setFiles(FIXTURE)
  await page.waitForFunction(() => !!document.body.innerText.match(/Elevation:\s*\d/), { timeout: 30_000 })
  await page.click('[data-testid="section-vector-layers"]')
  await page.click('[data-testid="osm-fetch"]')
  await expect(vectorRows(page).first()).toBeVisible({ timeout: 30_000 })
  const had = await vectorRows(page).count()
  expect(had).toBeGreaterThan(0)

  await resetBtn(page).click()
  await page.waitForTimeout(1200)
  await expect(vectorRows(page), 'a reset takes the fetched layers with it').toHaveCount(0)

  await page.locator('[data-testid="toast-action"]').click()
  await page.waitForTimeout(1200)
  // Both halves: the rows are the style records, and segments on screen mean the
  // coordinates came back with them.
  await expect(vectorRows(page)).toHaveCount(had)
  const drew = await page.evaluate(() => {
    const m = document.body.innerText.match(/Segments:\s*([\d,]+)/)
    return m ? Number(m[1].replace(/,/g, '')) : 0
  })
  expect(drew, 'the geometry came back, not just the layer list').toBeGreaterThan(0)
})
