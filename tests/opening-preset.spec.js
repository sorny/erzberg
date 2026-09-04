/**
 * The opening preset must never land on top of a look the user asked for.
 *
 * It waits on 56 preset files. On a dev server those arrive in milliseconds and
 * the window is invisible; on a deployed build it is wide enough to click
 * through, which is where this was reported from — Reset all gave bare defaults
 * and then Alpine Survey a moment later.
 *
 * These make the window deterministic by holding the preset requests, so the
 * race is reproduced rather than waited for.
 */
import { test, expect } from '@playwright/test'

const PAGE = 'http://localhost:5173'
const HOLD_MS = 4000

/**
 * Serves the presets, but only after `ms` — a slow connection, on demand.
 *
 * Fetch first, then hold, then fulfil with the real bytes. Delaying and calling
 * `route.continue()` instead does not work: the request never completes, no
 * preset ever arrives, and the two tests below then pass whatever the code does
 * — which is worse than failing, because it looks like proof.
 */
async function holdPresets(page, ms = HOLD_MS) {
  // The manifest only. Holding every preset as well multiplies the delay by
  // however many the app fetches, which is what made an early version of this
  // helper look like it worked while nothing was arriving at all — and the two
  // race tests then passed whatever the code did.
  await page.route('**/presets/manifest.json', async (route) => {
    const res = await route.fetch()
    const body = await res.body()
    await new Promise((r) => setTimeout(r, ms))
    await route.fulfill({ response: res, body })
  })
}

/** Guards against the above regressing: the presets must genuinely turn up. */
async function expectPresetsLoaded(page) {
  await expect(page.locator('[data-testid="preset-Alpine Survey"]'))
    .toHaveCount(1, { timeout: 20_000 })
}

/** Alpine Survey turns Lines off and Hillshade on; the defaults are the inverse. */
async function look(page) {
  const enabledIn = async (section) => {
    const sec = page.locator(`[data-testid="section-${section}"]`)
    if (!(await sec.count())) return null
    const box = sec.locator('xpath=following-sibling::div[1]').locator('input[type=checkbox]').first()
    if (!(await box.count())) return null
    return box.isChecked()
  }
  return { lines: await enabledIn('mode:-lines'), hillshade: await enabledIn('hillshade') }
}

test.describe('opening preset', () => {
  test('Reset all is not overwritten by a preset still in flight', async ({ page }) => {
    await holdPresets(page)
    await page.goto(PAGE)
    await page.waitForSelector('canvas', { timeout: 30_000 })

    // Reset while the presets are still on the wire — the reported case.
    const reset = page.locator('button', { hasText: /^Reset all$/ })
    await reset.waitFor({ state: 'visible', timeout: 20_000 })
    await reset.click()
    await page.locator('[data-testid="toast"] button[aria-label="Dismiss"]')
      .click({ timeout: 3000 }).catch(() => {})

    // Let them land — and assert they did, or this test passes whatever the
    // code does.
    await expectPresetsLoaded(page)
    await page.waitForTimeout(1500)

    const after = await look(page)
    expect(after.lines, 'defaults draw Lines; Alpine Survey turns them off').toBe(true)
    expect(after.hillshade, 'defaults have no hillshade; Alpine Survey does').toBe(false)
  })

  test('a rolled look is not overwritten either', async ({ page }) => {
    await holdPresets(page)
    await page.goto(PAGE)
    await page.waitForSelector('canvas', { timeout: 30_000 })
    // Presets opens shut now, so the roller is one click behind the label that
    // names the applied style — which is the shortest it has ever been, against
    // the 1 450 px scroll it used to sit behind.
    await page.click('[data-testid="jump-to-presets"]')
    const surprise = page.locator('[data-testid="surprise-me"]')
    await surprise.waitFor({ state: 'visible', timeout: 20_000 })
    await surprise.click()
    await page.waitForTimeout(800)
    const rolled = await look(page)

    await expectPresetsLoaded(page)
    await page.waitForTimeout(1500)
    const after = await look(page)
    expect(after, 'the roll survives the presets arriving').toEqual(rolled)
  })

  test('and it still applies when nothing was touched', async ({ page }) => {
    // The guard must not have turned the opening off altogether: with no input,
    // Alpine Survey is exactly what should arrive.
    await holdPresets(page, 1200)
    await page.goto(PAGE)
    await page.waitForSelector('canvas', { timeout: 30_000 })
    await expectPresetsLoaded(page)
    await page.waitForTimeout(2000)
    const after = await look(page)
    expect(after.lines, 'the opening preset turns Lines off').toBe(false)
    expect(after.hillshade, 'and hillshade on').toBe(true)
  })
})
