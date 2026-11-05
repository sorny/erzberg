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
import { openStage, resetToDefaults, setMark } from './helpers.js'

const OUT = path.join(process.cwd(), 'test-results')
test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

// Plot holds the sheet, the order, the clean-up and Preflight; Export the files.
async function openExport(page) {
  await openStage(page, 'output')
  for (const id of ['section-plot', 'section-export']) {
    const section = page.locator(`[data-testid="${id}"]`)
    await section.scrollIntoViewIfNeeded()
    if ((await section.getAttribute('aria-expanded')) !== 'true') {
      await section.click()
      await page.waitForTimeout(300)
    }
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
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
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
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
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
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
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

test('join gap, min length and simplify shrink the file and say what they did', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
  await openExport(page)
  await page.locator('[data-testid="plot-order"]').click()

  const blur = () => page.evaluate(() =>
    document.activeElement instanceof HTMLElement && document.activeElement.blur())
  const svgFor = async () => {
    await blur()
    const wait = page.waitForEvent('download', { timeout: 120_000 })
    await page.keyboard.press('Digit1')
    return readFileSync(await (await wait).path(), 'utf8')
  }
  const strokes = (t) => Number(/([\d,]+) strokes/.exec(t)[1].replace(/,/g, ''))
  const points = (svg) => (svg.match(/-?\d+\.\d,-?\d+\.\d/g) ?? []).length

  const before = await preflight(page)
  const plain = await svgFor()
  await expect(page.locator('[data-testid="preflight-cleanup"]')).toHaveCount(0)

  for (const [id, v] of [['plot-join-gap', '0.5'], ['plot-min-length', '0.5'], ['plot-simplify', '0.05']]) {
    await page.locator(`[data-testid="${id}"]`).fill(v)
    await blur()
  }
  await page.waitForTimeout(400)
  const after = await preflight(page)
  const cleaned = await svgFor()

  // Fewer strokes, a smaller file, and the readout names both passes.
  expect(strokes(after)).toBeLessThan(strokes(before))
  await expect(page.locator('[data-testid="preflight-cleanup"]')).toContainText(/[\d,]+ joined/)
  await expect(page.locator('[data-testid="preflight-cleanup"]')).toContainText(/short strokes left out/)
  expect(points(cleaned)).toBeLessThan(points(plain))
  expect(cleaned.length).toBeLessThan(plain.length)
  console.log(`[plotter] clean-up: ${strokes(before)} → ${strokes(after)} strokes, ` +
    `${points(plain)} → ${points(cleaned)} points, ${plain.length} → ${cleaned.length} bytes`)
})

// Recommended values come from the pen tip and the strokes Preflight measured:
// on a plate of lines a short stroke is a stray, on a hachure plate it is the drawing.
test('recommended values follow the pen, as drawn takes them off, and hachures keep their ticks', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
  await openExport(page)
  const value = async (id) => Number(await page.locator(`[data-testid="${id}"]`).inputValue())
  await page.locator('[data-testid="plot-pen"]').fill('0.5')
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.locator('[data-testid="plot-recommend"]').click()
  await expect(page.locator('[data-testid="plot-recommend-note"]')).toHaveText('Set for a 0.50 mm pen.', { timeout: 60_000 })
  await expect(page.locator('[data-testid="preflight-readout"]')).toContainText('pen up', { timeout: 60_000 })
  expect(await value('plot-join-gap')).toBeCloseTo(0.25, 5)
  expect(await value('plot-min-length')).toBeCloseTo(0.5, 5)
  expect(await value('plot-simplify')).toBeCloseTo(0.08, 5)
  expect(await value('plot-dedupe')).toBeCloseTo(0.25, 5)
  await expect(page.locator('[data-testid="plot-order"]')).toBeChecked()

  // As drawn takes every clean-up back off, in one click.
  await page.locator('[data-testid="plot-as-drawn"]').click()
  await expect(page.locator('[data-testid="plot-recommend-note"]')).toContainText('Clean-up off')
  for (const id of ['plot-join-gap', 'plot-min-length', 'plot-simplify', 'plot-dedupe']) expect(await value(id), id).toBe(0)
  expect(await value('plot-passes')).toBe(1)
  await expect(page.locator('[data-testid="plot-order"]')).not.toBeChecked()

  await setMark(page, 'Lines', false)
  await setMark(page, 'Hachure', true)
  await openExport(page)
  await page.locator('[data-testid="plot-recommend"]').click()
  await expect(page.locator('[data-testid="plot-recommend-note"]')).toContainText('min length off', { timeout: 60_000 })
  expect(await value('plot-min-length')).toBe(0)
})

// Pillars draw the sides two columns share twice; Dedupe leaves the second out.
// Passes draw every stroke again with the pen down: more ink, the same strokes.
test('dedupe leaves out shared sides, and passes add ink but no strokes', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
  await setMark(page, 'Lines', false)
  await setMark(page, 'Pillars', true)
  await openExport(page)
  const blur = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  const ink = (t) => Number(/ink ([\d.]+) m/.exec(t)[1])
  const strokes = (t) => Number(/([\d,]+) strokes/.exec(t)[1].replace(/,/g, ''))
  const plain = await preflight(page)
  await page.locator('[data-testid="plot-dedupe"]').fill('0.15')
  await blur()
  await page.waitForTimeout(400)
  const deduped = await preflight(page)
  expect(ink(deduped)).toBeLessThan(ink(plain) * 0.9)
  await expect(page.locator('[data-testid="preflight-cleanup"]')).toContainText('drawn twice left out')
  await page.locator('[data-testid="plot-passes"]').fill('2')
  await blur()
  await page.waitForTimeout(400)
  const twice = await preflight(page)
  expect(strokes(twice)).toBe(strokes(deduped))
  expect(ink(twice)).toBeCloseTo(ink(deduped) * 2, 0)
})
