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

  // Convention is the default, and it is not a fallback. 45° is a north-east
  // light — the same light the old 315° gave, under the true-bearing scale.
  await expect(page.locator('input.hmr[aria-label="Azimuth"]')).toHaveValue('45')
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

test('the lit side of the plate is the side the bearing names', async ({ page }) => {
  /*
   * The assertion the other tests here were missing, and the one that would
   * have caught v1.13.0's almanac bug.
   *
   * "Moving the clock moves the light" passes whether or not the light is in
   * the right quarter, and so does a readout that prints the bearing. The sun
   * was being fed into `hillshadeAzimuth` as a raw bearing, and that scale sits
   * a quarter turn from one — so the morning sun lit the south faces and noon
   * lit the west. The plate looked entirely plausible.
   *
   * So this measures the picture. From directly overhead with north up, an
   * eastern sun lights the eastern half brighter than the western half, and an
   * evening sun reverses it. Nothing about that can be true by accident.
   */
  test.setTimeout(180_000)
  await openHillshade(page)
  // Straight down, so east is screen-right and the test is about the compass
  // rather than about the camera.
  const tilt = page.locator('input[type="range"][min="0"][max="180"][step="0.1"]').first()
  await tilt.fill('1')
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(1200)

  await page.click('[data-testid="sun-mode-almanac"]')
  await page.waitForTimeout(800)

  /** Mean luminance of the left and right thirds of the canvas. */
  const halves = async () => page.locator('canvas').first().evaluate((c) => {
    const gl = c.getContext('webgl2', { preserveDrawingBuffer: true })
      || c.getContext('webgl', { preserveDrawingBuffer: true })
    const w = c.width, h = c.height
    const px = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    let left = 0, nl = 0, right = 0, nr = 0
    for (let y = Math.floor(h * 0.3); y < h * 0.7; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (px[i + 3] < 8) continue                    // nothing drawn here
        const v = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114
        if (x < w * 0.35) { left += v; nl++ }
        else if (x > w * 0.65) { right += v; nr++ }
      }
    }
    return { left: nl ? left / nl : 0, right: nr ? right / nr : 0 }
  })

  await hourSlider(page).fill('8')
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(1500)
  const morning = await halves()

  await hourSlider(page).fill('17')
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(1500)
  const evening = await halves()

  // An eight o'clock sun is in the east, which is the right of a north-up plate.
  expect(morning.right).toBeGreaterThan(morning.left)
  // And a five o'clock sun is in the west, which is the left of it.
  expect(evening.left).toBeGreaterThan(evening.right)
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
