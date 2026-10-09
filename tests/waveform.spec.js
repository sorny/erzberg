/**
 * Waveform's panel, through the buttons a user presses.
 *
 * Up to v1.58.1, Place and Sides wrote their labels instead of their values:
 * `on line` drew a column, both Sides drew the same shape, and no Sides button
 * showed as pressed. The unit tests passed the right values to the builder and
 * never saw it. So this presses the buttons.
 *
 * It also covers the guide: the read line in the accent colour over the
 * terrain, shown while the section is open.
 */
import { test, expect } from '@playwright/test'
import { openMark, resetToDefaults, setMark, waitForApp } from './helpers.js'

const SHOTS = process.env.WAVE_SHOTS

/** The canvas as the page shows it, in RGBA. */
async function pixels(page) {
  await page.waitForTimeout(1200)
  return page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const c = document.querySelector('canvas[data-engine]')
      const o = document.createElement('canvas')
      o.width = c.width; o.height = c.height
      const g = o.getContext('2d')
      g.drawImage(c, 0, 0)
      resolve(Array.from(g.getImageData(0, 0, o.width, o.height).data))
    }))
  }))
}

/** Pixels in the guide's orange, and their mean x. */
function orange(px, width) {
  let n = 0, sx = 0
  for (let i = 0; i < px.length; i += 4) {
    if (Math.abs(px[i] - 232) < 30 && Math.abs(px[i + 1] - 130) < 30 && Math.abs(px[i + 2] - 58) < 30) { n++; sx += (i / 4) % width }
  }
  return { n, x: n ? sx / n : 0 }
}

function differing(a, b) {
  let n = 0
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++
  return n
}

async function press(page, id) {
  await page.click(`[data-testid="${id}"]`)
  await expect(page.locator(`[data-testid="${id}"]`)).toHaveAttribute('aria-pressed', 'true')
}

test('every Place and Sides button takes, and changes the drawing', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await resetToDefaults(page)
  await setMark(page, 'Waveform', true)
  await openMark(page, 'Waveform')
  const width = await page.evaluate(() => document.querySelector('canvas[data-engine]').width)

  // The preview: the ground and the scanlines, between the line's two ends.
  const preview = page.locator('[data-testid="waveform-preview"]')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('N')
  expect(await preview.locator('svg line').count()).toBeGreaterThan(50)

  // Set 30° first, so the line on the ground is not the column's own axis.
  const angle = page.locator('[data-testid="waveform-angle"]')
  await angle.fill('30')
  await expect(page.getByRole('textbox', { name: 'Direction value' })).toHaveValue('30° NNW→SSE')

  await press(page, 'waveform-place-column')
  await press(page, 'waveform-sides-both')
  const column = await pixels(page)
  await press(page, 'waveform-place-line')
  const line = await pixels(page)
  await press(page, 'waveform-sides-one')
  const lineOne = await pixels(page)
  await press(page, 'waveform-place-row')
  await press(page, 'waveform-place-column')
  await press(page, 'waveform-sides-both')
  const again = await pixels(page)

  expect(differing(column, line), 'line is not a column').toBeGreaterThan(2000)
  expect(differing(line, lineOne), 'one side is not both').toBeGreaterThan(1000)
  expect(differing(column, again), 'and back again').toBeLessThan(200)

  // Chainage: keep the middle half of the line, then all of it again.
  await page.locator('[data-testid="waveform-chainage-lo"]').fill('0.25')
  await page.locator('[data-testid="waveform-chainage-hi"]').fill('0.75')
  const part = await pixels(page)
  expect(differing(again, part), 'Chainage cuts the drawing').toBeGreaterThan(1000)
  await page.locator('[data-testid="waveform-chainage-lo"]').fill('0')
  await page.locator('[data-testid="waveform-chainage-hi"]').fill('1')
  expect(differing(again, await pixels(page)), 'and back to the whole line').toBeLessThan(200)

  // The guide shows while the section is open, and not once it is left.
  const open = orange(column, width)
  expect(open.n, 'the guide in the accent colour').toBeGreaterThan(300)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/waveform-open.png` })

  // Show line switches it off, and on again.
  await page.click('[data-testid="waveform-guide"]')
  expect(orange(await pixels(page), width).n, 'guide switched off').toBeLessThan(open.n / 10)
  await page.click('[data-testid="waveform-guide"]')
  expect(orange(await pixels(page), width).n, 'guide switched on').toBeGreaterThan(open.n / 2)
  await page.click('[data-testid="mode-back"]')
  expect(orange(await pixels(page), width).n, 'no guide on the sheet').toBeLessThan(open.n / 10)
})

test('Through point picks on the terrain, and the guide follows', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await resetToDefaults(page)
  await setMark(page, 'Waveform', true)
  await openMark(page, 'Waveform')
  const width = await page.evaluate(() => document.querySelector('canvas[data-engine]').width)
  const before = orange(await pixels(page), width)

  await press(page, 'waveform-line-point')
  await expect(page.locator('[data-testid="waveform-pick"]')).toHaveText(/Click the point/)
  // Picking makes the surface the click target; give it a frame or two.
  await page.waitForTimeout(1500)
  const box = await page.locator('canvas[data-engine]').boundingBox()
  await page.mouse.click(box.x + box.width * 0.28, box.y + box.height * 0.62)
  await expect(page.locator('[data-testid="waveform-pick"]')).toHaveText(/Pick point/)
  await expect(page.locator('[data-testid="waveform-line-point"]')).toHaveAttribute('aria-pressed', 'true')

  const after = orange(await pixels(page), width)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/waveform-point.png` })
  expect(after.n).toBeGreaterThan(300)
  expect(after.x, 'the guide moved toward the click').toBeLessThan(before.x - 50)
})
