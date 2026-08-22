import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

// Section roots are direct children of #hm-panel-body, which disambiguates the
// many identically-labelled "Enabled" toggles.
const section = (page, title) =>
  page.locator('#hm-panel-body > div').filter({ hasText: new RegExp(`^${title}`) }).first()

async function openApp(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  const t = page.locator('[data-testid="sidebar-toggle"]')
  if ((await t.innerText()) === '◀') { await t.click(); await page.waitForTimeout(400) }
  await page.waitForTimeout(1200)
  await resetToDefaults(page)
}
const segments = async (page) =>
  Number((await page.locator('text=/Segments: /').innerText()).match(/Segments: ([\d,]+)/)[1].replace(/,/g, ''))

test('curvature mode renders and both direction modes differ', async ({ page }) => {
  await openApp(page)
  // Mode: Lines is open by default — clicking its header would collapse it.
  await section(page, 'Mode: Lines').locator('label').first().click({ force: true })
  await page.waitForTimeout(1200)
  expect(await segments(page)).toBe(0)

  await page.locator('text=MODE: CURVATURE').click(); await page.waitForTimeout(400)
  await section(page, 'Mode: Curvature').locator('label').first().click({ force: true })
  await page.waitForTimeout(2500)
  const across = await segments(page)

  await section(page, 'Mode: Curvature').locator('text=ALONG FORM').click()
  await page.waitForTimeout(2500)
  const along = await segments(page)

  console.log(`curvature: across=${across} along=${along}`)
  expect(across, 'across-form must emit strokes').toBeGreaterThan(500)
  expect(along, 'along-form must emit strokes').toBeGreaterThan(500)
  // Along-form follows the weakest curvature, which on a ridged terrain runs
  // much further before hitting another line — the two must not be identical.
  expect(along).not.toBe(across)
})
