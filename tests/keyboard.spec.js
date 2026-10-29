import { test, expect } from '@playwright/test'
import { openStage, resetToDefaults } from './helpers.js'

/**
 * The panel from the keyboard, and the preset toast.
 *
 * The Marks sheet was 124 Tab stops (a card and a pip on each of 62 tiles),
 * the history menu could only be left by a click, and a drilled-in mark had
 * no Escape. The preset toast said "Applied" at the click, before the plate
 * had changed, and never said what the preset had switched off.
 */
const PAGE = 'http://localhost:5173'

async function boot(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
  await page.waitForTimeout(600)
}

const focused = (page) => page.evaluate(() => document.activeElement?.dataset?.testid ?? null)

test('the Marks sheet is one Tab stop, walked with the arrows', async ({ page }) => {
  await boot(page)
  await openStage(page, 'marks')
  const stops = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="mode-sheet"] button')].filter((b) => b.tabIndex >= 0).length)
  expect(stops).toBe(1)

  await page.focus('[data-testid="mode-open-Lines"]')
  await page.keyboard.press('ArrowRight')
  expect(await focused(page)).toBe('mode-open-Contours')
  await page.keyboard.press('ArrowLeft')
  expect(await focused(page)).toBe('mode-open-Lines')
  // The stop follows the focus, so Tab out and back returns to the same card.
  const roving = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="mode-sheet"] .hmcardhit')].find((b) => b.tabIndex === 0)?.dataset.testid)
  expect(roving).toBe('mode-open-Lines')
})

test('Space switches the mark in focus, Enter opens it, Escape comes back to it', async ({ page }) => {
  await boot(page)
  await openStage(page, 'marks')
  const pip = page.locator('[data-testid="mode-tile-Hachure"]')
  await expect(pip).toHaveAttribute('aria-pressed', 'false')

  await page.focus('[data-testid="mode-open-Hachure"]')
  await page.keyboard.press('Space')
  await expect(pip).toHaveAttribute('aria-pressed', 'true')
  // Switched, not opened: Space's release must not also click the card.
  await expect(page.locator('[data-testid="mode-back"]')).toHaveCount(0)

  await page.keyboard.press('Enter')
  await expect(page.locator('[data-testid="mode-back"]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-testid="mode-back"]')).toHaveCount(0)
  await expect.poll(() => focused(page)).toBe('mode-open-Hachure')
})

test('the history menu takes focus and closes on Escape', async ({ page }) => {
  await boot(page)
  // One step to list.
  await openStage(page, 'marks')
  await page.click('[data-testid="mode-tile-Hachure"]')
  await page.waitForTimeout(700)

  await page.click('[data-testid="history-open"]')
  await expect(page.locator('[data-testid="history-menu"]')).toBeVisible()
  expect(await focused(page)).toMatch(/^history-(undo|redo)-/)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-testid="history-menu"]')).toHaveCount(0)
  expect(await focused(page)).toBe('history-open')
  // And nothing is left over the panel to swallow the next click.
  await page.click('[data-testid="stage-tab-frame"]')
  await expect(page.locator('[data-testid="stage-tab-frame"]')).toHaveAttribute('aria-selected', 'true')
})

test('the preset toast comes after the rebuild and names what it switched off', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  await openStage(page, 'marks')
  await page.click('[data-testid="mode-tile-Hachure"]')
  await page.waitForTimeout(700)
  await openStage(page, 'presets')
  await page.click('[data-testid="preset-Blueprint"]')
  const toast = page.locator('[data-testid="toast"]')
  await expect(toast).toContainText('Applied Blueprint', { timeout: 120_000 })
  await expect(toast).toContainText('Hachure')
})

test('the preset grid is one Tab stop, and the picked style says so', async ({ page }) => {
  await boot(page)
  await openStage(page, 'presets')
  const stops = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="preset-grid"] button')].filter((b) => b.tabIndex >= 0).length)
  expect(stops).toBe(1)

  await page.focus('[data-testid="preset-grid"] [tabindex="0"]')
  const from = await focused(page)
  await page.keyboard.press('ArrowRight')
  expect(await focused(page)).not.toBe(from)

  await page.click('[data-testid="preset-Blueprint"]')
  await expect(page.locator('[data-testid="preset-Blueprint"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-testid="preset-Blueprint"] [data-testid="preset-picked"]')).toHaveCount(1)
})

test('the marks that are on head the sheet, and each opens its mark', async ({ page }) => {
  await boot(page)
  await openStage(page, 'marks')
  // The defaults draw Lines only.
  await expect(page.locator('[data-testid^="mode-lit-"]')).toHaveCount(1)
  await page.click('[data-testid="mode-tile-Hachure"]')
  await expect(page.locator('[data-testid="mode-lit-Hachure"]')).toBeVisible()
  await page.click('[data-testid="mode-lit-Hachure"]')
  await expect(page.locator('[data-testid="mode-back"]')).toContainText('Hachure')
})

test('a drawing is named after the style it started from', async ({ page }) => {
  await boot(page)
  await openStage(page, 'output')
  // Bare defaults: the raster's name alone.
  await expect(page.locator('[data-testid="export-name"]')).toContainText('Heightmap.svg')
  await openStage(page, 'presets')
  await page.click('[data-testid="preset-Blueprint"]')
  await openStage(page, 'output')
  await expect(page.locator('[data-testid="export-name"]')).toContainText('Heightmap-blueprint.svg')
})

test('the filter marks the control it found, Enter goes to it, and a miss offers words', async ({ page }) => {
  await boot(page)
  await page.fill('[data-testid="panel-filter"]', 'focal')
  await expect(page.locator('#hm-panel-body label[data-hit]').first()).toBeVisible()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => document.activeElement?.closest('[data-section]') != null)).toBe(true)

  await page.fill('[data-testid="panel-filter"]', 'contuor')
  await expect(page.locator('[data-testid="filter-count"]')).toContainText('Nothing answers')
  const offer = page.locator('[data-testid^="filter-suggest-contour"]')
  await expect(offer).toHaveCount(1)
  await offer.click()
  await expect(page.locator('[data-testid="panel-filter"]')).toHaveValue(/^contours?$/)
})

test('Enter on a tile puts focus on the way back', async ({ page }) => {
  await boot(page)
  await openStage(page, 'marks')
  await page.focus('[data-testid="mode-open-Contours"]')
  await page.keyboard.press('Enter')
  await expect.poll(() => focused(page)).toBe('mode-back')
})

test('Enter on a search that only finds locked controls lands on Draw', async ({ page }) => {
  await boot(page)
  // Interval is a Contours control, and the defaults leave Contours off.
  await page.fill('[data-testid="panel-filter"]', 'interval')
  await expect(page.locator('#hm-panel-body label[data-hit]').first()).toBeAttached()
  await page.keyboard.press('Enter')
  const at = await page.evaluate(() => {
    const el = document.activeElement
    return { id: el?.dataset?.testid ?? null, inert: !!el?.closest('[inert]'), input: el?.tagName === 'INPUT' && el.dataset.testid === 'panel-filter' }
  })
  expect(at.input).toBe(false)
  expect(at.inert).toBe(false)
})

test('an off section offers one way on, and its locked controls fold away', async ({ page }) => {
  await boot(page)
  await openStage(page, 'marks')
  await page.click('[data-testid="mode-open-Contours"]')
  const sec = page.locator('[data-section="Mode: Contours"]')
  await expect(sec.locator('[data-testid="off-draw"]')).toBeVisible()
  await expect(sec.locator('[data-testid="off-controls"]')).toHaveCount(0)
  await sec.locator('[data-testid="off-controls-toggle"]').click()
  await expect(sec.locator('[data-testid="off-controls"]')).toBeVisible()
})

test('? on a control with help opens its help, not the card', async ({ page }) => {
  await boot(page)
  await openStage(page, 'surface')
  const occl = page.locator('input[type=checkbox][aria-label="Occlusion"]').first()
  await occl.focus()
  await page.keyboard.press('Shift+Slash')
  await expect(page.locator('[data-testid="shortcuts-overlay"]')).toHaveCount(0)
  await expect(page.locator('button.hmi[aria-label="What Occlusion does"]')).toHaveAttribute('aria-expanded', 'true')
})

test('Tab through a value field writes nothing', async ({ page }) => {
  await boot(page)
  await openStage(page, 'terrain')
  await page.waitForTimeout(800)
  const undo = page.locator('[data-testid="undo"]')
  const before = await undo.isDisabled()
  const field = page.locator('input.hmval').first()
  await field.focus()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(800)
  expect(await undo.isDisabled()).toBe(before)
})

test('a slider is one Tab stop, and Enter opens its value', async ({ page }) => {
  await boot(page)
  await openStage(page, 'terrain')
  const range = page.locator('#hm-panel-body input.hmr').first()
  await range.focus()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.classList.contains('hmval'))).toBe(false)
  await range.focus()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => document.activeElement?.classList.contains('hmval'))).toBe(true)
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.activeElement?.classList.contains('hmr'))).toBe(true)
})

test('a switch shows a focus ring', async ({ page }) => {
  await boot(page)
  await openStage(page, 'surface')
  // A key first, so the browser counts the focus as keyboard focus.
  await page.keyboard.press('Shift')
  await page.locator('#hm-panel-body .hmsw input[type=checkbox]:visible').first().focus()
  const ring = await page.evaluate(() => {
    const el = document.activeElement
    return { visible: el.matches(':focus-visible'), outline: getComputedStyle(el.nextElementSibling).outlineStyle }
  })
  expect(ring.visible).toBe(true)
  expect(ring.outline).toBe('solid')
})

test('a search that finds locked controls says them to a screen reader', async ({ page }) => {
  await boot(page)
  // Hillshade is off in the defaults, so its Sun altitude is a locked hit.
  await page.fill('[data-testid="panel-filter"]', 'sun altitude')
  const said = page.locator('[data-section="Hillshade"] [data-testid="off-controls-said"]')
  await expect(said).toContainText('Locked:')
  await expect(said).toContainText('Sun altitude')
})
