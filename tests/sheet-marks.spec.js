/**
 * The scale bar and the north arrow, end to end.
 *
 * The unit suite proves the arithmetic against a projection it wrote itself.
 * What it cannot reach is whether the number on screen came from *this* raster
 * and *this* camera — the measurement is taken in the render loop, published
 * through the store, and taken again independently by each exporter. Three
 * places, and a bar that is simply wrong looks exactly like a bar that is right.
 *
 * So these tests change the camera and watch the printed distance follow, and
 * then check the exported file carries the same figure the screen did.
 */
import { test, expect } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { resetToDefaults } from './helpers.js'

const OUT = path.join(process.cwd(), 'test-results')
test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

async function openMarks(page) {
  await page.locator('[data-testid="section-scale-and-north"]').scrollIntoViewIfNeeded()
  await page.click('[data-testid="section-scale-and-north"]')
  await page.waitForTimeout(300)
}

async function loadGeoTiff(page) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="load-geotiff"]'),
  ])
  await chooser.setFiles(path.join(process.cwd(), 'tests', 'testdata', 'benchmark.tif'))
  await page.waitForTimeout(6000)
}

/** The distance the overlay is currently printing, in metres. */
async function barMetres(page) {
  const texts = await page.locator('[data-testid="sheet-marks"] text').allTextContents()
  const label = texts.find((t) => /^[\d.]+ (m|km)$/.test(t))
  if (!label) return null
  const [n, unit] = label.split(' ')
  return Number(n) * (unit === 'km' ? 1000 : 1)
}

test('a heightmap with no georeference gets no bar, and is told why', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openMarks(page)

  await page.locator('[data-testid="mark-bar"]').click()
  await page.waitForTimeout(800)

  // The app opens on a plain PNG. There is no honest answer, so there is no bar
  // — rather than one drawn against a scale the app made up.
  await expect(page.locator('[data-testid="mark-readout"]')).toContainText('No georeference')
  await expect(page.locator('[data-testid="sheet-marks"]')).toHaveCount(0)
})

test('the bar measures the raster, and follows the camera', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await loadGeoTiff(page)
  await openMarks(page)

  await page.locator('[data-testid="mark-bar"]').click()
  await page.locator('[data-testid="mark-north"]').click()
  await page.waitForTimeout(1200)

  const overlay = page.locator('[data-testid="sheet-marks"]')
  await expect(overlay).toBeVisible()
  const wide = await barMetres(page)
  expect(wide, 'the overlay prints no distance').not.toBeNull()
  expect(wide).toBeGreaterThan(0)
  // Round, always: 200 m or 500 m or 1 km, never 437 m.
  expect([1, 2, 5]).toContain(Math.round(wide / 10 ** Math.floor(Math.log10(wide))))

  // Zoom in and the same bar length now covers less ground. This is the
  // assertion that separates a measurement from a decoration.
  const zoom = page.locator('input.hmr[aria-label="Zoom"]').first()
  const before = Number(await zoom.inputValue())
  await zoom.fill(String(before * 3))
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(1200)
  const close = await barMetres(page)
  expect(close).toBeLessThan(wide)

  // And the north arrow is on the sheet.
  await expect(overlay.locator('text', { hasText: /^N$/ })).toHaveCount(1)
})

test('the SVG carries the marks as their own plotter layer', async ({ page }) => {
  // A full GeoTIFF's SVG is a slower export than the sample plate's.
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await loadGeoTiff(page)
  await openMarks(page)

  await page.locator('[data-testid="mark-bar"]').click()
  await page.locator('[data-testid="mark-north"]').click()
  await page.waitForTimeout(1200)
  const onScreen = await barMetres(page)

  // The export hotkeys are a window listener that ignores events aimed at an
  // INPUT, and the last thing clicked above was a checkbox. Without this the
  // Digit1 vanishes and the test waits out its budget on a download nobody
  // asked for.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.locator('#hm-panel-body').evaluate((el) => { el.scrollTop = 0 })
  const wait = page.waitForEvent('download', { timeout: 120_000 })
  await page.keyboard.press('Digit1')
  const file = path.join(OUT, 'sheet-marks.svg')
  writeFileSync(file, readFileSync(await (await wait).path()))
  const svg = readFileSync(file, 'utf8')

  // Its own Inkscape layer, so a plotter run can put the annotation in a
  // different pen from the terrain.
  expect(svg).toContain('inkscape:label="Scale and north"')
  expect(svg).toContain('>N</text>')
  // The exporter measures again in its own pixels — a 4× plate has four times as
  // many pixels per metre — but it must land on the same round distance the
  // screen showed, because that distance is a fact about the ground.
  const label = /<text[^>]*>([\d.]+ (?:m|km))<\/text>/.exec(svg)
  expect(label, 'the SVG carries no distance label').not.toBeNull()
  const [n, unit] = label[1].split(' ')
  expect(Number(n) * (unit === 'km' ? 1000 : 1)).toBe(onScreen)

  // And the PNG compositor draws the same shapes onto its 2D context. There is
  // no reading a distance back out of pixels, so what this asserts is that the
  // third renderer runs at all — a throw in it would take the whole export down.
  const png = page.waitForEvent('download', { timeout: 120_000 })
  await page.keyboard.press('Digit2')
  expect((await (await png).path()).length).toBeGreaterThan(0)
})
