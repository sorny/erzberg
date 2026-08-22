import { test, expect } from '@playwright/test'

/**
 * Settings that survive a reload.
 *
 * The feature is one debounced `localStorage` write and one read at mount, and
 * every test here exists because a plausible-looking version of that was wrong
 * in a way the obvious test — change a value, reload, check it — could not see.
 * They are the adversarial cases: a continuous stream of changes, a visit where
 * nobody touched anything, a reset, and a raster that is not the one the stored
 * numbers were measured against.
 */
const KEY = 'erzberg.session.v1'

const session = (page) => page.evaluate((k) => localStorage.getItem(k), KEY)

async function openApp(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('[data-testid="section-terrain"]', { timeout: 30000 })
  await page.waitForTimeout(2500)
}

async function reload(page) {
  await page.reload()
  await page.waitForSelector('[data-testid="section-terrain"]', { timeout: 30000 })
  await page.waitForTimeout(2500)
}

test('a change survives a reload', async ({ page }) => {
  await openApp(page)
  await page.locator('input.hmval[aria-label="Blur value"]').fill('6')
  await page.keyboard.press('Enter')
  await page.locator('input.hmval[aria-label="Tilt value"]').fill('22')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  await reload(page)
  await expect(page.locator('input.hmr[aria-label="Blur"]')).toHaveValue('6')
  await expect(page.locator('input.hmr[aria-label="Tilt"]')).toHaveValue('22')
  await expect(page.locator('[data-testid="session-restored"]')).toHaveCount(1)
})

test('auto-rotate does not starve the write', async ({ page }) => {
  // The camera syncs into `view` every 150 ms while spinning, and the debounce
  // is 400 — so a plain trailing debounce was rescheduled forever and nothing
  // was ever stored. That is precisely the unattended hour this exists to keep.
  await openApp(page)
  await page.evaluate((k) => localStorage.removeItem(k), KEY)
  await page.locator('input[type=checkbox][aria-label="Auto-rotate"]').click()
  await page.waitForTimeout(500)
  await page.locator('input.hmval[aria-label="Blur value"]').fill('5')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(3000)

  const stored = await session(page)
  expect(stored, 'a spinning plate must not hold the write off forever').not.toBeNull()
  expect(JSON.parse(stored).terrain.blurRadius).toBe(5)
})

test('a visit where nothing was touched is not announced as a restore', async ({ page }) => {
  // Loading the sample plate sets terrain.resolution, which is a real state
  // change — so the settings do get written. What must not happen is the next
  // visit claiming to have restored something, when all that came back were the
  // defaults it would have used anyway.
  await page.goto('http://localhost:5173')
  await page.evaluate(() => localStorage.clear())
  await reload(page)
  await reload(page)
  await expect(page.locator('[data-testid="session-restored"]')).toHaveCount(0)
})

test('Reset all clears the session rather than rewriting it', async ({ page }) => {
  // Clearing alone did nothing: the six setState calls in the reset re-ran the
  // save effect, which wrote the defaults straight back a moment later.
  await openApp(page)
  await page.locator('input.hmval[aria-label="Blur value"]').fill('7')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  expect(await session(page)).not.toBeNull()

  await page.locator('button', { hasText: /^Reset all$/ }).click()
  await page.waitForTimeout(2500)
  expect(await session(page), 'the clear must outlive the save it triggers').toBeNull()
})

test('a stored resolution is not carried onto a different raster', async ({ page }) => {
  // resolution comes from autoResolution(width, height) exactly as zoom does.
  // Restoring a 12 000 px GeoTIFF's 12 onto the ~1024 px sample plate would
  // render it on an 85×85 grid with nothing on screen to say why.
  await openApp(page)
  await page.evaluate((k) => localStorage.setItem(k,
    JSON.stringify({ terrain: { blurRadius: 3, resolution: 12 } })), KEY)
  await reload(page)
  await expect(page.locator('input.hmr[aria-label="Blur"]')).toHaveValue('3')
  await expect(page.locator('input.hmr[aria-label="Resolution"]')).not.toHaveValue('12')
})

test('a restored mode comes back with its section open', async ({ page }) => {
  // applyPreset has always called syncSectionsToStyle; seeding the same style
  // straight into React state at mount skipped it, so a reload left a mode
  // drawing with its controls behind a collapsed disclosure.
  await openApp(page)
  // Pillars rather than Contours: the opening preset already draws contours, so
  // toggling that one would be switching a mode *off* and asserting the section
  // opened for a mode that is not running.
  const section = page.locator('[data-testid="section-mode:-pillars"]')
  await page.click('[data-testid="section-mode:-pillars"]')
  await page.waitForTimeout(300)
  await section.locator('xpath=following-sibling::div[1]')
    .locator('input[type=checkbox]').first().click()
  await page.waitForTimeout(2000)
  await page.click('[data-testid="section-mode:-pillars"]')   // collapse it again
  await page.waitForTimeout(400)
  await expect(section).toHaveAttribute('aria-expanded', 'false')

  await reload(page)
  await expect(section).toHaveAttribute('aria-expanded', 'true')
})
