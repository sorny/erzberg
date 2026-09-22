/**
 * What the app says while it is thinking.
 *
 * Two things, one replacing a silence and one replacing a guess.
 *
 * The silence: a rebuild showed nothing at all for a full second, and a second
 * is a long time to look at a frozen picture. The guess: nothing anywhere said
 * what the current plate costs to rebuild, so "is it slow because of what I
 * just switched on" had no answer but a stopwatch and memory.
 *
 * Both tests lean on Sun Hours, which is the one mode expensive enough to be
 * slow on any machine — it integrates the sun over a whole year, and measures
 * at about 1.8 s against 70 ms for the opening plate. Everything else here
 * rebuilds in under 250 ms on ordinary hardware, which is why the pill needs a
 * genuinely heavy mode to show at all.
 */
import { expect, test } from '@playwright/test'
import { resetToDefaults, setMark, waitForApp } from './helpers.js'

/** `Rebuild: 153 ms` → 153, `Rebuild: 1.8 s` → 1800. */
const ms = (text) => {
  const m = /Rebuild: ([\d.]+) (ms|s)/.exec(text ?? '')
  return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : NaN
}



test('the panel reports how long the last rebuild took', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  const readout = page.locator('[data-testid="build-time"]')
  await expect(readout).toBeVisible({ timeout: 30_000 })
  const before = ms(await readout.textContent())
  expect(before).toBeGreaterThan(0)
  expect(before).toBeLessThan(1000)

  // A measurement, not a constant. An order of magnitude between the opening
  // plate and a year of sun is too much for a hard-coded string or a figure
  // captured once at startup to survive.
  await setMark(page, 'sun-hours', true)
  await page.waitForTimeout(15_000)
  const heavy = ms(await readout.textContent())
  expect(heavy).toBeGreaterThan(before * 4)

  // And it comes back down, so it is tracking rather than latching high.
  await setMark(page, 'sun-hours', false)
  await page.waitForTimeout(10_000)
  expect(ms(await readout.textContent())).toBeLessThan(heavy / 2)
})

test('a slow rebuild says so, and a fast one stays quiet', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  const pill = page.locator('[data-testid="computing-pill"]')

  /*
   * The quiet half first, and it is the half that matters most.
   *
   * The threshold used to be a second and the overlay behind it is a
   * full-screen dim with a modal card. Simply lowering that to 250 ms would
   * strobe the whole screen on every slider drag, which is worse than the
   * silence it replaced. So the fast path must show nothing at all.
   */
  await setMark(page, 'lines', false)
  await page.waitForTimeout(1200)
  await expect(pill).toHaveCount(0)
  await expect(page.locator('text=Computing geometry…')).toHaveCount(0)

  // The loud half. Sun Hours takes long enough to cross both thresholds.
  const appeared = page.waitForSelector('[data-testid="computing-pill"]', { timeout: 60_000 })
  await setMark(page, 'sun-hours', true)
  await appeared

  // And it clears itself. A latched spinner is the failure this replaces, and
  // an easy one to reintroduce: the timers key on the delivered-frame count so
  // that a continuous stream keeps resetting them.
  await expect(pill).toHaveCount(0, { timeout: 90_000 })
  await expect(page.locator('text=Computing geometry…')).toHaveCount(0)
})
