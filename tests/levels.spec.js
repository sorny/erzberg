import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * Shadows and Highlights are the two ends of one range.
 *
 * `buildTerrain` already survives them crossing — it divides by
 * `max(1e-6, wp - bp)` — but surviving is not the same as being usable. Past the
 * crossing every cell clamps to one end, the plate goes flat, and no control on
 * screen says why. The pair is held apart at the interface instead, and held two
 * ways: the sliders' own bounds move, so the limit is something you feel at the
 * end of the track, and both writes clamp, because the histogram's handles are a
 * second way in and a restored session is a third.
 */
const PAGE = 'http://localhost:5173'

const slider = (page, label) =>
  page.locator(`[data-section="Levels"] input[type=range][aria-label="${label}"]`)

/** Drive a range input the way React sees it. */
const setSlider = (loc, v) => loc.evaluate((el, val) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(el, String(val))
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, v)

test('Highlights cannot be dragged past Shadows, or the other way', async ({ page }) => {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await page.fill('[data-testid="panel-filter"]', 'Levels')
  await page.waitForTimeout(500)

  const shadows = slider(page, 'Shadows')
  const highlights = slider(page, 'Highlights')
  await expect(shadows).toHaveCount(1)
  await expect(highlights).toHaveCount(1)

  // The case from the report: Shadows at 40 puts the floor under Highlights at 41.
  await setSlider(shadows, 40)
  await page.waitForTimeout(400)
  await expect(highlights).toHaveAttribute('min', '41')

  // And the bound is real, not decorative: a write below it lands on it.
  await setSlider(highlights, 20)
  await page.waitForTimeout(400)
  await expect(highlights).toHaveValue('41')

  // Symmetric. With Highlights at 41 the ceiling under Shadows is 40.
  await expect(shadows).toHaveAttribute('max', '40')
  await setSlider(shadows, 200)
  await page.waitForTimeout(400)
  await expect(shadows).toHaveValue('40')
})
