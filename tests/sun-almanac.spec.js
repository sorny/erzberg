/**
 * The sun, from the ground rather than from a slider.
 *
 * The unit suite proves the ephemeris against published positions. What it
 * cannot reach is the join: the panel writes a date and an hour, App.jsx turns
 * those into an azimuth and an altitude, and those two numbers replace the
 * slider pair on the way into the shader without ever being written to it. Each
 * of those steps can be wired to nothing and leave a panel that looks right.
 *
 * So the assertions here are about what changed on the canvas, and about the
 * slider that must *not* have moved.
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { resetToDefaults } from './helpers.js'

async function openHillshade(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await page.click('[data-testid="section-hillshade"]')
  await page.waitForTimeout(300)
  await page.locator('input[type=checkbox][aria-label="Enabled"]').first().click()
  await page.waitForTimeout(1200)
}

/** The hour slider, by the label the panel gives it. */
const hourSlider = (page) => page.locator('input.hmr[aria-label="Time"]')

test('the almanac replaces the azimuth slider and says where the sun is', async ({ page }) => {
  await openHillshade(page)

  // Convention is the default, and it is not a fallback — 315° is the
  // cartographic standard and no real sun ever sits there.
  await expect(page.locator('input.hmr[aria-label="Azimuth"]')).toHaveValue('315')
  await expect(page.locator('[data-testid="sun-readout"]')).toHaveCount(0)

  await page.click('[data-testid="sun-mode-almanac"]')
  await page.waitForTimeout(600)

  // The two free numbers are gone: they are being computed now.
  await expect(page.locator('input.hmr[aria-label="Azimuth"]')).toHaveCount(0)
  await expect(page.locator('input.hmr[aria-label="Altitude"]')).toHaveCount(0)

  const readout = page.locator('[data-testid="sun-readout"]')
  await expect(readout).toBeVisible()
  const text = await readout.textContent()
  // A bearing, an elevation, and the three times of the day.
  expect(text).toMatch(/\d+° · \d+° above/)
  expect(text).toMatch(/rise \d\d:\d\d · noon \d\d:\d\d · set \d\d:\d\d/)
  // The app opens on a plain PNG, which carries no location at all — so the
  // latitude becomes a control and the panel says so rather than guessing.
  expect(text).toContain('no georeference')
  await expect(page.locator('input.hmr[aria-label="Latitude"]')).toBeVisible()
})

test('moving the clock moves the light', async ({ page }) => {
  await openHillshade(page)
  await page.click('[data-testid="sun-mode-almanac"]')
  await page.waitForTimeout(600)

  const canvas = page.locator('canvas').first()
  const readout = page.locator('[data-testid="sun-readout"]')

  await hourSlider(page).fill('7')
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(1200)
  const morningText = await readout.textContent()
  const morning = await canvas.screenshot()

  await hourSlider(page).fill('17')
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(1200)
  const eveningText = await readout.textContent()
  const evening = await canvas.screenshot()

  // The bearing swung from the east side of the sky to the west.
  const bearing = (s) => Number(/(\d+)°/.exec(s)[1])
  expect(bearing(morningText)).toBeLessThan(180)
  expect(bearing(eveningText)).toBeGreaterThan(180)

  // And the plate is genuinely lit differently — this is the assertion that the
  // computed pair reaches the shader at all.
  expect(Buffer.compare(morning, evening)).not.toBe(0)
  expect(morning.length).toBeGreaterThan(1000)
})

test('the almanac never writes to the sliders it replaces', async ({ page }) => {
  await openHillshade(page)
  await page.locator('input.hmval[aria-label="Azimuth value"]').fill('120')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)

  await page.click('[data-testid="sun-mode-almanac"]')
  await page.waitForTimeout(400)
  await hourSlider(page).fill('16')
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(800)

  // Switch back and the hand-set light is exactly where it was left. An
  // ephemeris that wrote through to the parameters would have overwritten it,
  // and filled the undo history with one entry per tick of the clock.
  await page.click('[data-testid="sun-mode-convention"]')
  await page.waitForTimeout(400)
  await expect(page.locator('input.hmr[aria-label="Azimuth"]')).toHaveValue('120')
})

test('a georeferenced raster answers the latitude itself', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="load-geotiff"]'),
  ])
  await chooser.setFiles(path.join(process.cwd(), 'tests', 'testdata', 'benchmark.tif'))
  await page.waitForTimeout(6000)

  await page.click('[data-testid="section-hillshade"]')
  await page.waitForTimeout(300)
  await page.locator('input[type=checkbox][aria-label="Enabled"]').first().click()
  await page.waitForTimeout(1200)
  await page.click('[data-testid="sun-mode-almanac"]')
  await page.waitForTimeout(600)

  const text = await page.locator('[data-testid="sun-readout"]').textContent()
  // The whole idea in one line: the raster carries a coordinate system and a
  // bounding box, so nobody has to type where the mountain is.
  expect(text).toContain('from the raster')
  await expect(page.locator('input.hmr[aria-label="Latitude"]')).toHaveCount(0)
})
