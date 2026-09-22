/**
 * Putting one section back.
 *
 * The scope of each reset has its own unit suite, checked against the panel's
 * own source. What that cannot show is the part that makes the feature worth
 * having and the part that would do damage:
 *
 *  · the ↺ appears only where something changed, which is what turns it from
 *    fifty-five icons into a map of the work,
 *  · it puts that section back and leaves every other section alone,
 *  · and the toast's Undo brings the change back.
 */
import { expect, test } from '@playwright/test'
import { openStage, resetToDefaults, waitForApp } from './helpers.js'

/** Write a colour input the way React will notice. */
async function setColor(locator, value) {
  await locator.evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, v)
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

/**
 * Opens a section, having first brought its pane on screen.
 *
 * Every section this spec touches is in Surface, so that is the default. A
 * caller reaching into another pane passes its name — a section in a pane you
 * are not on is in the DOM and hidden, and a click on it does nothing.
 */
async function open(page, testId, stage = 'surface') {
  await openStage(page, stage)
  const section = page.locator(`[data-testid="${testId}"]`)
  await section.scrollIntoViewIfNeeded()
  if ((await section.getAttribute('aria-expanded')) !== 'true') {
    await section.click()
    await page.waitForTimeout(250)
  }
}

test('the mark appears where the work is, and nowhere else', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  /*
   * The mark, not the button.
   *
   * The `↺` itself is revealed on hover and costs no layout width, because
   * reserving room for it clipped ten mode headers by up to 25 px — the
   * truncation guard in `panel.spec.js` caught exactly that. What is drawn at
   * all times is a two-pixel accent at the left edge, and that is the half of
   * this that has to be visible from across a scroll.
   */
  const mark = page.locator('[data-testid="modified-terrain-style"]')
  const reset = page.locator('[data-testid="reset-terrain-style"]')
  await expect(mark).toHaveCount(0)

  await open(page, 'section-terrain-style')
  const bg = page.locator('[data-testid="bg-color"]')
  const original = await bg.inputValue()
  await setColor(bg, '#7f1d3a')
  await expect(mark).toBeVisible()
  await expect(reset).toHaveCount(1)

  // And only there. Hillshade was not touched, so it carries no mark.
  await expect(page.locator('[data-testid="modified-hillshade"]')).toHaveCount(0)

  // Back by hand, and the mark goes with it — the mark is a comparison against
  // the defaults, not a record that something was once touched.
  await setColor(bg, original)
  await expect(mark).toHaveCount(0)
  await expect(reset).toHaveCount(0)
})

test('a reset puts its own section back and leaves the rest', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  await open(page, 'section-terrain-style')
  const bg = page.locator('[data-testid="bg-color"]')
  const bgWas = await bg.inputValue()
  await setColor(bg, '#7f1d3a')

  // Its own switch, rather than one of the controls inside it: most of
  // Hillshade only renders once it is on, and a locator for a control that is
  // not there yet times out rather than failing.
  await open(page, 'section-hillshade')
  const lit = page.locator('[data-section="Hillshade"] input[type=checkbox][aria-label="Enabled"]')
  await lit.click()
  await expect(lit).toBeChecked()

  await page.locator('[data-testid="reset-terrain-style"]').click()
  await page.waitForTimeout(600)

  await expect(bg).toHaveValue(bgWas)
  // The other section is untouched — the whole point of a scoped reset, and the
  // failure that would be invisible until somebody lost an hour of work.
  await expect(lit).toBeChecked()
  await expect(page.locator('[data-testid="modified-hillshade"]')).toBeVisible()
})

test('the toast takes the reset back', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  await open(page, 'section-terrain-style')
  const bg = page.locator('[data-testid="bg-color"]')
  await setColor(bg, '#7f1d3a')

  await page.locator('[data-testid="reset-terrain-style"]').click()
  await expect(bg).not.toHaveValue('#7f1d3a')

  await page.locator('button', { hasText: 'Undo' }).last().click()
  await expect(bg).toHaveValue('#7f1d3a')
})
