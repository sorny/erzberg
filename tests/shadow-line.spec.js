/**
 * The edge of the shadow, in the app rather than in isolation.
 *
 * The unit suite proves the lit field against a cone and a wall. What it cannot
 * reach is the join: the panel writes a date, a time and a zone, the worker turns
 * those into a bearing and an elevation off the raster's own bounding box, and
 * the tracer turns the boundary into marks. Any of those can be wired to nothing
 * and leave a panel that looks entirely reasonable.
 *
 * The assertion worth having is the shape of the day. A low sun reaches under
 * everything and throws long shadows; a high one shadows almost nothing. So the
 * mark count has to fall toward noon and rise again toward dusk, and nothing
 * about that curve can be true by accident.
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { openMark, openStage, resetToDefaults, waitForApp } from './helpers.js'

/** The segment total the panel prints, which is how many marks are on the plate. */
async function segments(page) {
  const text = await page.locator('#hm-panel-body').textContent()
  return Number(/Segments:\s*([\d,]+)/.exec(text)[1].replace(/,/g, ''))
}

async function openMode(page) {
  await openMark(page, 'shadow-line')
  const section = page.locator('[data-testid="section-mode:-shadow-line"]')
  await section.scrollIntoViewIfNeeded()
  if ((await section.getAttribute('aria-expanded')) !== 'true') {
    await section.click()
    await page.waitForTimeout(300)
  }
}

/** A georeferenced raster, so the sun comes off the ground rather than a slider. */
async function loadGeoTiff(page) {
  // The load buttons are at the top of Source, and a caller may be anywhere —
  // `openMode` leaves the panel in Marks.
  await openStage(page, 'terrain')
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="load-geotiff"]'),
  ])
  await chooser.setFiles(path.join(process.cwd(), 'tests', 'testdata', 'benchmark.tif'))
  await page.waitForTimeout(6000)
}

async function setHour(page, h) {
  await page.locator('input.hmr[aria-label="Time"]').first().fill(String(h))
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(4500)
}

test('the shadow is longest at the ends of the day and shortest at noon', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await loadGeoTiff(page)
  await openMode(page)

  const before = await segments(page)
  await page.locator('[data-testid="mode-shadowline"]').click()
  await page.waitForTimeout(5000)
  expect(await segments(page)).toBeGreaterThan(before)

  // Midwinter, so the sun stays low and the difference across the day is stark.
  await setHour(page, 9)
  const morning = await segments(page)
  await setHour(page, 12)
  const noon = await segments(page)
  await setHour(page, 16)
  const afternoon = await segments(page)

  // A high sun reaches into places a low one cannot, so there is less edge to
  // draw. This is the whole behaviour of the mode in three numbers.
  expect(noon).toBeLessThan(morning)
  expect(noon).toBeLessThan(afternoon)
  expect(morning).toBeGreaterThan(0)

  // And the sun the panel reports is where it should be either side of noon.
  const note = page.locator('[data-testid="shadowline-note"]')
  await setHour(page, 9)
  expect(Number(/(\d+)°/.exec(await note.textContent())[1])).toBeLessThan(180)
  await setHour(page, 16)
  expect(Number(/(\d+)°/.exec(await note.textContent())[1])).toBeGreaterThan(180)
})

test('there is no shadow edge at night, and the panel says why', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await loadGeoTiff(page)
  await openMode(page)
  await page.locator('[data-testid="mode-shadowline"]').click()
  await page.waitForTimeout(5000)

  const lit = await segments(page)
  await setHour(page, 22)

  // Nothing drawn, rather than the outline of the whole raster — which is what a
  // field of uniform darkness would trace if the sun were not checked first.
  expect(await segments(page)).toBeLessThan(lit)
  await expect(page.locator('[data-testid="shadowline-note"]'))
    .toContainText('Below the horizon')
})

test('the latitude comes off the raster, and a PNG has to be told', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openMode(page)
  await page.locator('[data-testid="mode-shadowline"]').click()
  await page.waitForTimeout(4000)

  // The app opens on a plain PNG, which knows nothing about where it is.
  await expect(page.locator('[data-testid="shadowline-note"]')).toContainText('no georeference')
  await expect(page.locator('input.hmr[aria-label="Longitude"]')).toBeVisible()

  await loadGeoTiff(page)
  await openMode(page)
  await expect(page.locator('[data-testid="shadowline-note"]')).toContainText('from the raster')
  await expect(page.locator('input.hmr[aria-label="Longitude"]')).toHaveCount(0)
})
