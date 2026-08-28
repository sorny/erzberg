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
  test('a formatted slider announces what the panel prints', async ({ page }) => {
    // aria-label gave a screen reader the name and the raw number, so a control
    // reading "315°" was announced as "315" and one reading "100%" as "1" — the
    // value heard and the value beside it disagreed.
    await openApp(page)
    await page.click('[data-testid="section-hillshade"]')
    await page.waitForTimeout(300)
    await page.locator('input[type=checkbox][aria-label="Enabled"]').first().click()
    await page.waitForTimeout(1200)

    const slider = page.locator('input.hmr[aria-label="Azimuth"]')
    await expect(slider).toHaveValue('315')
    await expect(slider).toHaveAttribute('aria-valuetext', '315°')

    // And it tracks the value rather than being a one-off at mount.
    await page.locator('input.hmval[aria-label="Azimuth value"]').fill('90')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(slider).toHaveAttribute('aria-valuetext', '90°')
  })

  test('clicking a control’s label focuses the control', async ({ page }) => {
    // Every row used to build a <span> for its label and hand the input an
    // aria-label, so a screen reader was served but the pointer was not:
    // clicking the visible word did nothing, on 10px text.
    await openApp(page)
    await page.click('[data-testid="section-hillshade"]')
    await page.waitForTimeout(300)
    await page.locator('input[type=checkbox][aria-label="Enabled"]').first().click()
    await page.waitForTimeout(1200)

    const slider = page.locator('input.hmr[aria-label="Azimuth"]')
    const id = await slider.getAttribute('id')
    expect(id, 'the slider must carry an id to be pointed at').toBeTruthy()

    const label = page.locator(`label[for="${id}"]`)
    await expect(label).toHaveText('Azimuth')
    await label.click()
    await expect(slider).toBeFocused()
  })

  test('the help button does not toggle the control it explains', async ({ page }) => {
    // The `?` sits inside the same row as the label. Wrapping the whole row in a
    // <label> would have made every click on it flip the switch beside it, so
    // the association deliberately covers the text and nothing else.
    await openApp(page)
    await page.click('[data-testid="section-hillshade"]')
    await page.waitForTimeout(300)
    const enabled = page.locator('input[type=checkbox][aria-label="Enabled"]').first()
    await enabled.click()
    await page.waitForTimeout(1200)
    await expect(enabled).toBeChecked()

    // Cast shadows carries both a switch and a help button.
    const help = page.locator('button.hmi[aria-label="What Cast Shadows does"]')
    const shadows = page.locator('input[type=checkbox][aria-label="Cast Shadows"]')
    const before = await shadows.isChecked()
    await help.click()
    await page.waitForTimeout(300)
    expect(await shadows.isChecked(), 'asking what it does must not do it').toBe(before)
  })
})
