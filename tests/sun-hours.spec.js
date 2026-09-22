/**
 * The sun-hours field, in the app rather than in isolation.
 *
 * The unit suite proves the field against the sky: a south face beats a north
 * face, east and west are symmetric, a flat plain gets exactly the year's
 * daylight. None of that reaches the joins — the latitude has to come off the
 * raster's own bounding box inside the *worker*, the levels have to be chosen
 * from a range nobody knew in advance, and the tracer has to turn all of it into
 * marks. Any of those can be wired to nothing and leave a panel that looks fine.
 *
 * So this switches the mode on against a real GeoTIFF and counts what it drew.
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { openMark, resetToDefaults } from './helpers.js'

/** The segment total the panel prints, which is how many marks are on the plate. */
async function segments(page) {
  const text = await page.locator('#hm-panel-body').textContent()
  return Number(/Segments:\s*([\d,]+)/.exec(text)[1].replace(/,/g, ''))
}

async function openMode(page) {
  await openMark(page, 'sun-hours')
  const section = page.locator('[data-testid="section-mode:-sun-hours"]')
  await section.scrollIntoViewIfNeeded()
  if ((await section.getAttribute('aria-expanded')) !== 'true') {
    await section.click()
    await page.waitForTimeout(300)
  }
}

async function loadGeoTiff(page) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="load-geotiff"]'),
  ])
  await chooser.setFiles(path.join(process.cwd(), 'tests', 'testdata', 'benchmark.tif'))
  await page.waitForTimeout(6000)
}

test('a georeferenced raster draws its own sun hours', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await loadGeoTiff(page)
  await openMode(page)

  const before = await segments(page)
  await page.locator('[data-testid="mode-sunhours"]').click()
  await page.waitForTimeout(6000)

  // It drew, and it drew a lot: a year of sun over real relief is a dense set of
  // closed isolines, not a handful of strokes.
  const after = await segments(page)
  expect(after).toBeGreaterThan(before + 500)

  // The latitude is the raster's own. This is the whole idea — nobody typed it,
  // and the control for typing it is not even rendered.
  await expect(page.locator('[data-testid="sunhours-note"]')).toContainText('Latitude from the raster')
  await expect(page.locator('input.hmr[aria-label="Latitude"]')).toHaveCount(0)
})

test('a period is a measurement, and changing it changes the answer', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await loadGeoTiff(page)
  await openMode(page)
  await page.locator('[data-testid="mode-sunhours"]').click()
  await page.waitForTimeout(6000)

  const yearly = await segments(page)
  // The shut header says which period it measured, not a slider position.
  await page.locator('#hm-panel-body').evaluate((el) => { el.scrollTop = 0 })

  await openMode(page)
  await page.locator('[data-testid="sunhours-period-day"]').click()
  await page.waitForTimeout(6000)
  const daily = await segments(page)

  // A midwinter day and a whole year are different fields, so they trace
  // differently. Equal totals would mean the period never reached the worker.
  expect(daily).not.toBe(yearly)
  expect(daily).toBeGreaterThan(0)
  await expect(page.locator('[data-testid="sunhours-date"]')).toBeVisible()
})

test('the panel says what the field is about to cost', async ({ page }) => {
  // The two sampling sliders multiply and nothing said so: the top of both
  // ranges is over a thousand sweeps of the whole grid, which on a large raster
  // reads as a hang rather than as work.
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openMode(page)
  await page.locator('[data-testid="mode-sunhours"]').click()
  await page.waitForTimeout(4000)

  const note = page.locator('[data-testid="sunhours-note"]')
  // The defaults are the cheap end: 8 days by 12 positions.
  await expect(note).toContainText('96 sun positions')

  // Four times the positions is four times the work, and the estimate follows.
  // It is the seconds rather than the count that is worth printing: the same
  // count is a fifth of a second on a small grid and thirteen on a large one.
  const seconds = (t) => Number(/about ([\d.]+)s a rebuild/.exec(t)?.[1] ?? 0)
  const before = seconds(await note.textContent())
  await page.locator('input.hmr[aria-label="Per day"]').fill('48')
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(4000)
  await expect(note).toContainText('384 sun positions')
  expect(seconds(await note.textContent())).toBeGreaterThan(before * 3)
})

test('a plain PNG has to be told where it is', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openMode(page)
  await page.locator('[data-testid="mode-sunhours"]').click()
  await page.waitForTimeout(4000)

  // The app opens on a heightmap with no georeference at all, so the latitude
  // becomes a control rather than a fact — and the panel says which it is.
  await expect(page.locator('[data-testid="sunhours-note"]')).toContainText('No georeference')
  const lat = page.locator('input.hmr[aria-label="Latitude"]')
  await expect(lat).toBeVisible()

  const north = await segments(page)
  // Move it to the tropics and the field is a different field: the sun passes
  // overhead there, so far less ground is permanently shaded.
  await lat.fill('5')
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(6000)
  expect(await segments(page)).not.toBe(north)
})
