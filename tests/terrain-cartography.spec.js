import { test, expect } from '@playwright/test'
import { openMark, openStage, resetToDefaults, setMark } from './helpers.js'

/*
 * Plan oblique and Landforms, end to end through the SVG.
 *
 * The maths has unit tests (planOblique, landforms). What only the app can show
 * is that the exporter follows them: plan oblique has to move the strokes the
 * SVG writes, not just the picture on screen, and Landforms has to arrive as
 * pen layers a plotter can use — areas for the mode, and one pen per landform
 * for a mode coloured by Form.
 */
const PAGE = 'http://localhost:5173'

async function boot(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
}

async function exportSvg(page) {
  await openStage(page, 'output')
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 180_000 }),
    page.click('[data-testid="export-svg"]'),
  ])
  const stream = await dl.createReadStream()
  const chunks = []
  for await (const c of stream) chunks.push(c)
  return Buffer.concat(chunks).toString('utf-8')
}

const labelsOf = (svg) => [...svg.matchAll(/inkscape:label="([^"]+)"/g)].map((m) => m[1])
// Every coordinate the strokes are written with, in order.
const strokes = (svg) => [...svg.matchAll(/ (?:points|x1|y1|x2|y2|d)="([^"]+)"/g)].map((m) => m[1]).join(' ')

test('plan oblique moves the strokes the SVG writes', async ({ page }) => {
  test.setTimeout(420_000)
  await boot(page)
  await openStage(page, 'frame')
  await page.getByRole('button', { name: 'Look straight down' }).click()
  await page.waitForTimeout(1500)
  const flat = await exportSvg(page)

  await openStage(page, 'frame')
  await page.locator('[data-testid="plan-oblique"]').check({ force: true })
  await page.waitForTimeout(1500)
  await expect(page.locator('[data-section="Camera"]')).toContainText('oblique')
  const oblique = await exportSvg(page)

  // The same layers, drawn in different places.
  expect(labelsOf(oblique)).toEqual(labelsOf(flat))
  expect(strokes(flat).length).toBeGreaterThan(1000)
  expect(strokes(oblique)).not.toBe(strokes(flat))
})

test('Landforms exports areas, and Form inks a mode by landform', async ({ page }) => {
  test.setTimeout(480_000)
  await boot(page)
  await setMark(page, 'Lines', false)
  await setMark(page, 'Landform', true)
  await page.waitForTimeout(3000)
  // The plate line counts the ten landform inks.
  await expect(page.getByText(/1 mark, 10 inks/)).toBeVisible({ timeout: 60_000 })
  const areas = await exportSvg(page)
  const areaLayers = labelsOf(areas).filter((l) => l.startsWith('Landforms'))
  expect(areaLayers.length).toBeGreaterThanOrEqual(4)

  await setMark(page, 'Landform', false)
  await setMark(page, 'Contours', true)
  await openMark(page, 'Contours')
  await page.click('[data-testid="colour-Contours-form"]')
  await page.waitForTimeout(3000)
  const svgInked = await exportSvg(page)
  const inked = labelsOf(svgInked)
  // One pen per landform, named after it.
  expect(inked).toContain('Contours · Minor · Ridge')
  expect(inked).toContain('Contours · Minor · Valley')
})

test('a landform mask says what it keeps, and All clears it', async ({ page }) => {
  await boot(page)
  await setMark(page, 'Contours', true)
  await openMark(page, 'Contours')
  const readout = page.locator('[data-testid="form-mask-Contours"]')
  await expect(readout).toHaveText('all')
  for (const f of ['Flat', 'Peak', 'Shoulder', 'Spur', 'Slope', 'Hollow', 'Footslope', 'Pit']) {
    await page.click(`[data-testid="form-chip-Contours-${f}"]`)
  }
  await expect(readout).toHaveText('ridge, valley')
  await page.locator('[data-section="Mode: Contours"]').getByRole('button', { name: 'All', exact: true }).click()
  await expect(readout).toHaveText('all')
})
