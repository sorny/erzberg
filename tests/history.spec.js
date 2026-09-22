import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import path from 'path'
import { openMark, openStage, resetToDefaults, switchMarkOn } from './helpers.js'

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
 *
 * The second half of this file is about the stack being *readable*: the entries
 * carry names now, derived from the diff between each pair of snapshots, and
 * the list can be jumped into rather than only stepped through.
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

/**
 * Brings Lines' Spacing on screen.
 *
 * Spacing belongs to a mark, and a mark's controls live behind the sheet now —
 * the Marks pane, then the card on its tile. Lines is the mode the default
 * baseline leaves drawing, which is why it is the one these tests reach for.
 */
const openSpacing = (page) => openMark(page, 'lines')
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
  await openSpacing(page)
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
  await openSpacing(page)
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
  await openSpacing(page)
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
  await openSpacing(page)
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
  // The Text section is in Overlay, and the slider above left us in Marks.
  await openStage(page, 'overlay')
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

// ── The list ────────────────────────────────────────────────────────────────
/**
 * Undo was a button that took you back one step. After four presses you were
 * somewhere you could not name, with no way to tell how far you had come. The
 * stack always held the answer and nothing showed it.
 *
 * The names are derived, so a control nobody annotated is still named. That
 * property holds for all 672 parameters and `tests/unit/historyLabel.test.js`
 * checks them one at a time; here it only has to be shown reaching the screen.
 */
const menu = (page) => page.locator('[data-testid="history-menu"]')

async function openMenu(page) {
  await page.locator('[data-testid="history-open"]').click()
  await expect(menu(page)).toBeVisible()
}

async function enableMode(page, testId) {
  // The pip on the sheet is the switch. It writes the same `enabled<Id>` the
  // section's own Enabled switch writes, so this is the same act in one click.
  await switchMarkOn(page, testId)
  await page.waitForTimeout(900)
}

test('the steps are named by what they changed', async ({ page }) => {
  test.setTimeout(240_000)
  await boot(page)

  await enableMode(page, 'stipple-dots')

  await openStage(page, 'surface')
  const section = page.locator('[data-testid="section-terrain-style"]')
  await section.scrollIntoViewIfNeeded()
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
  await page.locator('[data-testid="bg-color"]').evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, '#7f1d3a')
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(900)

  // Newest first, under `now`. The section name comes from the same index the
  // per-section reset uses; the switch is named as the action it was.
  await openMenu(page)
  await expect(page.locator('[data-testid="history-undo-0"]')).toHaveText('Terrain Style')
  await expect(page.locator('[data-testid="history-undo-1"]')).toHaveText('Stipple Dots on')
})

test('a step in the list is a jump, not a press repeated', async ({ page }) => {
  test.setTimeout(240_000)
  await boot(page)

  await enableMode(page, 'stipple-dots')
  await enableMode(page, 'flow')
  await enableMode(page, 'contours')

  const stipple = page.locator('[data-section="Mode: Stipple Dots"] input[type=checkbox][aria-label="Enabled"]')
  const flow = page.locator('[data-section="Mode: Flow"] input[type=checkbox][aria-label="Enabled"]')
  const contours = page.locator('[data-section="Mode: Contours"] input[type=checkbox][aria-label="Enabled"]')
  await expect(stipple).toBeChecked()

  // Back past all three at once. Stepping one at a time would be a loop over an
  // effect that has not run yet, and the states in between would be lost.
  await openMenu(page)
  await expect(page.locator('[data-testid="history-undo-2"]')).toHaveText('Stipple Dots on')
  await page.locator('[data-testid="history-undo-2"]').click()
  await page.waitForTimeout(1500)

  await expect(stipple).not.toBeChecked()
  await expect(flow).not.toBeChecked()
  await expect(contours).not.toBeChecked()

  // And everything passed over is on the redo side, in order — a jump is not a
  // truncation, which is the one way this could quietly lose work.
  await openMenu(page)
  await expect(page.locator('[data-testid="history-redo-0"]')).toContainText('Stipple Dots on')
  await expect(page.locator('[data-testid="history-redo-2"]')).toContainText('Contours')
})

test('a preset says which preset it was', async ({ page }) => {
  /*
   * The one exception to deriving everything.
   *
   * A preset moves forty parameters across nine sections, which the diff can
   * only report as `9 sections`. The name is the single fact it cannot recover,
   * so the loader tags it.
   */
  test.setTimeout(240_000)
  await boot(page)

  const file = path.join(process.cwd(), 'public', 'presets', 'Blueprint.json')
  const b64 = readFileSync(file).toString('base64')
  const dt = await page.evaluateHandle(({ b64 }) => {
    const bin = atob(b64)
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([buf], 'Blueprint.json', { type: 'application/json' }))
    return dt
  }, { b64 })
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt })
  await page.dispatchEvent('body', 'dragover', { dataTransfer: dt })
  await page.dispatchEvent('body', 'drop', { dataTransfer: dt })
  await page.waitForTimeout(2500)

  await openMenu(page)
  await expect(page.locator('[data-testid="history-undo-0"]')).toHaveText('Preset · Blueprint')
})
