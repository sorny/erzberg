import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * The control panel itself — the filter, the typed values, the shortcut.
 *
 * These cover the seams the panel grew when it stopped being purely a list of
 * sliders: a filter that decides what renders, a readout that is also an input,
 * and a disclosure that is now a button. Each one broke something adjacent that
 * looked unrelated, which is why they are asserted rather than assumed.
 */
async function openApp(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('[data-testid="section-terrain"]', { timeout: 30000 })
  await page.waitForTimeout(2500)
  await resetToDefaults(page)
}

test.describe('panel', () => {
  test('the filter narrows to the sections that answer to it', async ({ page }) => {
    await openApp(page)
    await page.fill('[data-testid="panel-filter"]', 'azimuth')
    await page.waitForTimeout(400)

    const visible = page.locator('[data-testid^="section-"]:visible')
    await expect(visible).toHaveCount(1)
    await expect(visible.first()).toHaveAttribute('data-testid', 'section-hillshade')
    // Found while switched off: the index is stated, not scraped from whatever
    // happens to be mounted, and Hillshade's controls only exist once it is on.
    await expect(visible.first()).toHaveAttribute('aria-expanded', 'true')

    await page.fill('[data-testid="panel-filter"]', '')
    await page.waitForTimeout(400)
    await expect(page.locator('[data-testid^="section-"]:visible')).toHaveCount(33)
  })

  test('a filtered-out section is hidden, not unmounted', async ({ page }) => {
    // A collapsed section has always kept its children mounted behind a
    // zero-height row, so the panel's local state — a running Overpass fetch and
    // the controller that can cancel it, the category ticks, a feature filter —
    // survived being closed. Returning null on a keystroke threw all of it away.
    await openApp(page)
    await page.fill('[data-testid="panel-filter"]', 'azimuth')
    await page.waitForTimeout(400)
    const inDom = await page.locator('[data-testid^="section-"]').count()
    const onScreen = await page.locator('[data-testid^="section-"]:visible').count()
    expect(inDom).toBe(33)
    expect(onScreen).toBe(1)
  })

  test('a header click while filtering changes nothing behind it', async ({ page }) => {
    // The filter forces every survivor open, so the click had no visible effect
    // — and the section it silently collapsed came back that way once the field
    // was cleared.
    await openApp(page)
    const hillshade = page.locator('[data-testid="section-hillshade"]')
    await expect(hillshade).toHaveAttribute('aria-expanded', 'false')

    await page.fill('[data-testid="panel-filter"]', 'azimuth')
    await page.waitForTimeout(400)
    await hillshade.click({ force: true })
    await page.waitForTimeout(300)
    await page.fill('[data-testid="panel-filter"]', '')
    await page.waitForTimeout(400)
    await expect(hillshade).toHaveAttribute('aria-expanded', 'false')
  })

  test('a typed value lands on the slider’s own step grid', async ({ page }) => {
    // Only sub-1 steps used to snap, so 37 on a step-5 Azimuth was stored as 37
    // while the thumb — which cannot represent it — sat at 35: two controls for
    // one value, disagreeing on screen.
    await openApp(page)
    await page.click('[data-testid="section-hillshade"]')
    await page.waitForTimeout(300)
    await page.locator('input[type=checkbox][aria-label="Enabled"]').first().click()
    await page.waitForTimeout(1200)

    const slider = page.locator('input.hmr[aria-label="Azimuth"]')
    const field  = page.locator('input.hmval[aria-label="Azimuth value"]')
    await expect(slider).toHaveAttribute('step', '5')

    await field.fill('37')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(slider).toHaveValue('35')
    await expect(field).toHaveValue('35°')

    // And still clamped to the range.
    await field.fill('999')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(slider).toHaveValue('360')
  })

  test('the panel shortcut survives a click on a section header', async ({ page }) => {
    // Headers became buttons, and the handler skipped BUTTON — which Controls.jsx
    // does because Space activates a focused one. Backslash activates nothing, so
    // the exclusion only killed the shortcut until focus moved.
    await openApp(page)
    const toggle = page.locator('[data-testid="sidebar-toggle"]')
    await page.click('[data-testid="section-camera"]')
    await page.waitForTimeout(300)
    await page.keyboard.press('Backslash')
    await page.waitForTimeout(400)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Backslash')
    await page.waitForTimeout(400)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  test('the transparent PNG toast names the file that was written', async ({ page }) => {
    await openApp(page)
    const download = page.waitForEvent('download', { timeout: 60000 })
    await page.keyboard.press('3')
    const written = (await download).suggestedFilename()
    await page.waitForTimeout(700)
    const toast = await page.textContent('[data-testid="toast"]')
    expect(written).toBe('Heightmap-alpha.png')
    expect(toast, 'the message exists to name the file').toContain(written)
  })
})
