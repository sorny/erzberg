/**
 * Hydraulic erosion: finishing, and getting out.
 *
 * Erosion is the third operation in the app long enough to need a progress bar,
 * and until now it was the only one of the three with no way out — SVG and STL
 * have shared an overlay, a progress channel and a Cancel all along. It also had
 * no spec of any kind, so a run that died reported nothing and nothing noticed.
 *
 * Two things worth pinning: a run completes and arms its Undo, and a run in
 * progress can be abandoned and leaves the panel usable.
 */
import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

async function openErosion(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30_000 })
  const t = page.locator('[data-testid="sidebar-toggle"]')
  if ((await t.innerText()) === '◀') { await t.click(); await page.waitForTimeout(400) }
  await page.waitForTimeout(3000)
  await resetToDefaults(page)

  const section = page.locator('[data-testid="section-hydraulic-erosion"]')
  await section.scrollIntoViewIfNeeded()
  if ((await section.getAttribute('aria-expanded')) !== 'true') {
    await section.click()
    await page.waitForTimeout(400)
  }
}

const runBtn    = (page) => page.locator('button', { hasText: /^Run Erosion$|^Eroding…/ })
const cancelBtn = (page) => page.locator('[data-testid="erosion-cancel"]')
const undoBtn   = (page) => page.locator('button', { hasText: /^Undo$/ })

test('a short run completes and arms Undo', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openErosion(page)

  // The floor of the slider — enough droplets to be a real run, few enough to
  // finish inside the test budget without racing anything.
  await page.locator('input.hmr[aria-label="Iterations"]').fill('1000')
  await page.waitForTimeout(200)

  await expect(undoBtn(page)).toBeDisabled()
  await runBtn(page).click()

  // Back to its resting label once the worker has posted its result.
  await expect(runBtn(page)).toHaveText('Run Erosion', { timeout: 30_000 })
  // Undo is armed only by a run that actually wrote pixels.
  await expect(undoBtn(page)).toBeEnabled()
  // And nothing failed on the way: the error line stays absent.
  await expect(page.locator('[data-testid="erosion-error"]')).toHaveCount(0)

  expect(errors, 'no uncaught page errors').toEqual([])
})

test('a long run can be abandoned, and leaves nothing behind', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openErosion(page)

  // Two million droplets, so the run is certainly still going when Cancel is
  // pressed — the point is to catch it mid-flight, not to race it.
  await page.locator('input.hmr[aria-label="Iterations"]').fill('2000000')
  await page.waitForTimeout(200)
  await runBtn(page).click()

  // Cancel takes Undo's place for as long as the run is live.
  await expect(cancelBtn(page)).toBeVisible({ timeout: 10_000 })
  await expect(undoBtn(page)).toHaveCount(0)

  await cancelBtn(page).click()

  // The button comes back, and the row returns to Run + Undo.
  await expect(runBtn(page)).toHaveText('Run Erosion', { timeout: 10_000 })
  await expect(cancelBtn(page)).toHaveCount(0)
  // Abandoning is the user's own decision, so it is not reported as a failure…
  await expect(page.locator('[data-testid="erosion-error"]')).toHaveCount(0)
  // …and it wrote nothing, so there is nothing to undo. Offering one would
  // promise to restore a raster identical to the one on screen.
  await expect(undoBtn(page)).toBeDisabled()

  // The panel is still live afterwards — a terminated worker must not take the
  // section with it.
  await expect(runBtn(page)).toBeEnabled()
  expect(errors, 'no uncaught page errors').toEqual([])
})
