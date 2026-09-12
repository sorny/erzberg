/**
 * The keyboard card.
 *
 * Small feature, two claims worth pinning. The first is that it opens — on the
 * key, and on the affordance in the viewport hint, because the key is no use to
 * somebody who does not yet know it exists. The second is the one that would
 * cause real damage if it broke: while the card is up, the export keys must not
 * fire. `1` under an open card would write an SVG the user cannot see being
 * written, from a reading position rather than a working one.
 */
import { expect, test } from '@playwright/test'
import { waitForApp } from './helpers.js'

const card = (page) => page.locator('[data-testid="shortcuts-overlay"]')

test('the card opens on ? and closes three ways', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })

  await expect(card(page)).toHaveCount(0)

  // Focus must not be in a field — every shortcut in the app is guarded on that.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.keyboard.press('?')
  await expect(card(page)).toBeVisible()

  // What it is for: the keys that were nowhere on screen before it existed.
  await expect(card(page)).toContainText('Auto-rotate')
  await expect(card(page)).toContainText('Show or hide the panel')
  await expect(card(page)).toContainText('Freeze the particles')

  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)

  await page.keyboard.press('?')
  await page.locator('[data-testid="shortcuts-close"]').click()
  await expect(card(page)).toHaveCount(0)

  await page.keyboard.press('?')
  await page.keyboard.press('?')                       // the key toggles
  await expect(card(page)).toHaveCount(0)
})

test('the viewport hint offers a way in', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })

  // The hint is dismissed for good once dismissed, so this is a fresh profile.
  const hint = page.locator('[data-testid="viewport-hint"]')
  await expect(hint).toBeVisible()
  await page.locator('[data-testid="hint-keys"]').click()
  await expect(card(page)).toBeVisible()
})

test('the export keys do not fire underneath the card', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })

  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.keyboard.press('?')
  await expect(card(page)).toBeVisible()

  // A download would take many seconds to arrive; the export overlay comes up
  // immediately and is the thing to watch for. Nothing must appear.
  let download = false
  page.on('download', () => { download = true })
  await page.keyboard.press('Digit1')
  await page.keyboard.press('Digit2')
  await page.waitForTimeout(2500)
  expect(download).toBe(false)
  await expect(page.locator('text=Exporting SVG…')).toHaveCount(0)
  await expect(page.locator('text=Capturing PNG…')).toHaveCount(0)
  await expect(card(page)).toBeVisible()

  // And they work again the moment it is closed.
  await page.keyboard.press('Escape')
  const wait = page.waitForEvent('download', { timeout: 90_000 })
  await page.keyboard.press('Digit1')
  expect(await (await wait).suggestedFilename()).toMatch(/\.svg$/)
})
