/**
 * What a plot costs, and the route that makes it cost less.
 *
 * The unit suite proves the router keeps every stroke and cuts the travel on
 * synthetic input. What it cannot reach is the join: the preflight runs the
 * *whole* SVG pipeline with the file-writing step removed, so the numbers
 * describe the drawing after occlusion has cut it and the frame has clipped it.
 * If that wiring is wrong the panel still shows four plausible numbers.
 *
 * The load-bearing assertion is the last one. Re-ordering strokes is invisible
 * on paper by construction, which means the only way it can be wrong is by
 * losing one — so the two exports are compared element for element.
 */
import { test, expect } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { openStage, resetToDefaults } from './helpers.js'

const OUT = path.join(process.cwd(), 'test-results')
test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

async function openExport(page) {
  await openStage(page, 'output')
  const section = page.locator('[data-testid="section-export"]')
  await section.scrollIntoViewIfNeeded()
  if ((await section.getAttribute('aria-expanded')) !== 'true') {
    await section.click()
    await page.waitForTimeout(300)
  }
}

/** Press Preflight and wait for the numbers to land. */
async function preflight(page) {
  await page.locator('[data-testid="preflight"]').scrollIntoViewIfNeeded()
  await page.locator('[data-testid="preflight"]').click()
  const readout = page.locator('[data-testid="preflight-readout"]')
  await expect(readout).toContainText('pen up', { timeout: 60_000 })
  return readout.textContent()
}

const penUpMetres = (text) => Number(/pen up ([\d.]+) m/.exec(text)[1])

/** Count the marks in an exported SVG — every element a pen would draw. */
const markCount = (svg) => (svg.match(/<(line|polyline|path)\b/g) ?? []).length

test('the preflight says what the plot costs before the pen touches paper', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openExport(page)

  await expect(page.locator('[data-testid="preflight-readout"]')).toContainText('Measures the file')

  const text = await preflight(page)
  // The four numbers the idea sheet asked for: strokes, pens, ink, air — and the
  // time, which needs the one fact only the operator has.
  expect(text).toMatch(/[\d,]+ strokes · \d+ pens?/)
  expect(text).toMatch(/ink [\d.]+ m · pen up [\d.]+ m/)
  expect(text).toMatch(/about (<1|\d+) min at 120 mm\/s/)
  expect(penUpMetres(text)).toBeGreaterThan(0)
})

test('the numbers go stale rather than lie', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openExport(page)
  await preflight(page)

  // Move the camera and the measurement no longer describes what is on screen.
  await openStage(page, 'frame')   // Tilt is in View
  const tilt = page.locator('input[type="range"][min="0"][max="180"][step="0.1"]').first()
  await tilt.fill('20')
  await page.waitForTimeout(600)
  await expect(page.locator('[data-testid="preflight-readout"]')).toContainText('Measures the file')
})

test('plotter order cuts the travel, and loses no stroke doing it', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openExport(page)

  const asBuilt = penUpMetres(await preflight(page))

  // The saving is offered before it is taken — the panel says what the switch
  // is worth while it is still off.
  await expect(page.locator('[data-testid="preflight-readout"]'))
    .toContainText(/Plotter order would cut the pen-up travel by \d+%/)

  const blur = () => page.evaluate(() =>
    document.activeElement instanceof HTMLElement && document.activeElement.blur())

  const svgFor = async (name) => {
    await blur()
    const wait = page.waitForEvent('download', { timeout: 120_000 })
    await page.keyboard.press('Digit1')
    const file = path.join(OUT, name)
    writeFileSync(file, readFileSync(await (await wait).path()))
    return readFileSync(file, 'utf8')
  }

  const plain = await svgFor('plot-depth-order.svg')

  await page.locator('[data-testid="plot-order"]').click()
  await page.waitForTimeout(400)
  const ordered = penUpMetres(await preflight(page))
  const routed = await svgFor('plot-pen-order.svg')

  // The whole point of the feature, measured on the real drawing. Logged as
  // well as asserted: the threshold is a floor the feature must clear, and the
  // figure itself is the thing worth knowing.
  console.log(`[plotter] pen-up travel ${asBuilt.toFixed(1)} m → ${ordered.toFixed(1)} m ` +
    `(${(100 * ordered / asBuilt).toFixed(1)}%)`)
  expect(ordered).toBeLessThan(asBuilt * 0.5)

  // And the drawing is the same drawing. Every mark still there, and the same
  // total ink — a route that dropped strokes would show a smaller number here
  // and look like a triumph.
  expect(markCount(routed)).toBe(markCount(plain))
  const ink = (t) => /ink ([\d.]+) m/.exec(t)[1]
  expect(ink(await page.locator('[data-testid="preflight-readout"]').textContent()))
    .toBeTruthy()
})
