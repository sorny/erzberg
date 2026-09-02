import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * Undo and redo.
 *
 * The thing worth pinning is not that a value comes back — it is the two
 * properties that make a history usable rather than technically present.
 *
 * A drag has to be *one* step. The panel emits a change per frame, so recording
 * each would make one press worth 16 ms of a gesture and forty presses to get
 * back across a single slider.
 *
 * And a new edit after an undo has to abandon the redo branch, or redo replays a
 * look nobody asked for.
 */
const PAGE = 'http://localhost:5173'

const undoBtn = (page) => page.locator('[data-testid="undo"]')
const redoBtn = (page) => page.locator('[data-testid="redo"]')

async function boot(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await page.waitForTimeout(600)
}

/** A slider in the open Lines section, and the value it holds. */
const spacing = (page) => page.getByRole('slider', { name: /^spacing$/i }).first()
const valueOf = (loc) => loc.inputValue()

/** Drive a range input the way React sees it. */
async function setSlider(loc, v) {
  await loc.evaluate((el, val) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, String(val))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)
}

test('undo puts a value back, and redo takes it forward again', async ({ page }) => {
  await boot(page)
  const s = spacing(page)
  await expect(s).toBeVisible()
  const before = await valueOf(s)

  await setSlider(s, 12)
  await page.waitForTimeout(900)
  expect(await valueOf(s)).toBe('12')

  await undoBtn(page).click()
  await page.waitForTimeout(700)
  expect(await valueOf(s), 'undo restores the previous value').toBe(before)

  await redoBtn(page).click()
  await page.waitForTimeout(700)
  expect(await valueOf(s), 'redo goes forward again').toBe('12')
})

test('a drag is one step, not one per frame', async ({ page }) => {
  await boot(page)
  const s = spacing(page)
  const before = await valueOf(s)

  // Twelve changes inside the coalescing window — what a real drag looks like.
  for (let v = 5; v <= 16; v++) {
    await setSlider(s, v)
    await page.waitForTimeout(25)
  }
  await page.waitForTimeout(900)
  expect(await valueOf(s)).toBe('16')

  // One press has to cross the whole gesture.
  await undoBtn(page).click()
  await page.waitForTimeout(700)
  expect(await valueOf(s), 'one undo crosses the whole drag').toBe(before)
})

test('an edit after an undo abandons the redo branch', async ({ page }) => {
  await boot(page)
  const s = spacing(page)

  await setSlider(s, 9)
  await page.waitForTimeout(900)
  await undoBtn(page).click()
  await page.waitForTimeout(700)
  await expect(redoBtn(page), 'redo is available after an undo').toBeEnabled()

  await setSlider(s, 3)
  await page.waitForTimeout(900)
  await expect(redoBtn(page), 'a new edit throws the branch away').toBeDisabled()
})

test('undo is disabled with nothing to undo', async ({ page }) => {
  await boot(page)
  // Reset all is itself an edit, so the button is live after it — what must not
  // happen is redo offering a future that does not exist.
  await expect(redoBtn(page)).toBeDisabled()
})

test('a fresh load has nothing to undo', async ({ page }) => {
  /*
   * The app applies its opening preset from an effect on mount, and that is a
   * state change like any other — so it was recorded, and the app booted with
   * undo lit. Pressing it threw away the look the app opens on and left bare
   * defaults, which is not a step anybody took.
   *
   * No `boot()` here on purpose: that presses Reset all, which *is* an edit and
   * would hide exactly the thing this is checking.
   */
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await page.waitForSelector('[data-testid="jump-to-presets"]', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await expect(undoBtn(page), 'the opening preset is not an edit').toBeDisabled()
  await expect(redoBtn(page)).toBeDisabled()
})

test('the keyboard shortcut works, and text fields keep their own', async ({ page }) => {
  await boot(page)
  const s = spacing(page)
  const before = await valueOf(s)
  await setSlider(s, 14)
  await page.waitForTimeout(900)

  await page.locator('canvas').first().click({ position: { x: 700, y: 600 }, force: true })
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(700)
  expect(await valueOf(s), '⌘Z undoes').toBe(before)

  /*
   * Inside a text box, ⌘Z belongs to the browser. A text layer's body is a
   * textarea, and stealing the chord there would make it impossible to take back
   * a typo without also taking back the last slider you touched.
   */
  await page.getByText('Text', { exact: true }).first().click()
  await page.waitForTimeout(300)
  await page.locator('[data-testid="text-add"]').click()
  await page.waitForTimeout(400)
  const body = page.locator('[data-testid^="text-body-"]').first()
  await body.fill('ERZBERG')
  await page.waitForTimeout(800)
  const rows = await page.locator('[data-testid^="text-layer-"]').count()

  await body.focus()
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(500)
  // The text layer is still there: the app's history never saw the keystroke.
  expect(await page.locator('[data-testid^="text-layer-"]').count()).toBe(rows)
})
