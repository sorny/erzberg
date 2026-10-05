/**
 * Occlusion in the app: what hides what, measured off the exported SVG.
 *
 * The unit suite proves the parts: no wall in the air, the skirt, a solid's
 * walls, the halo raster. This proves the join. The panel's choice reaches the
 * worker, the exporter's depth buffer follows it, and the case that started it
 * is gone: long Hachure ticks on a peak, with no fill, cut white notches into
 * the Lines behind them.
 *
 * The plates are driven through `window.erzberg` (`?automation`), the same
 * calls the command line makes, so each one is a known set of modes and values
 * rather than whatever the panel happened to leave behind.
 */
import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { openMark, resetToDefaults, setMark } from './helpers.js'

const APP = 'http://localhost:5173'
const DEM = `${APP}/tests/testdata/geotiff.tif`

/** Long ticks at a wide spacing: the user's case, walls in the air and all. */
const TICKS = { lengthHachure: '5', spacingHachure: '6', spacingLines: '6' }

async function bootAutomation(page) {
  await page.goto(`${APP}/?automation`)
  await page.waitForFunction(() => !!window.erzberg, null, { timeout: 60_000 })
  await page.evaluate((url) => window.erzberg.loadRaster('geotiff.tif', url), DEM)
}

let dumped = 0

/**
 * Draws only `modes`, with `params` over the defaults, and returns the SVG.
 * One call per step, as the command line makes them. `OCC_SVG_DIR` keeps each
 * file, to look at.
 */
async function plate(page, modes, params) {
  await page.evaluate(([m]) => window.erzberg.setModes(m, true), [modes])
  await page.evaluate(([s]) => window.erzberg.setParams(s), [params])
  await page.evaluate(() => window.erzberg.settle())
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 180_000 }),
    page.evaluate(() => window.erzberg.export('svg')),
  ])
  const chunks = []
  for await (const c of await dl.createReadStream()) chunks.push(c)
  const svg = Buffer.concat(chunks).toString('utf-8')
  if (process.env.OCC_SVG_DIR) writeFileSync(`${process.env.OCC_SVG_DIR}/${++dumped}-${modes.join('+')}.svg`, svg)
  return svg
}

/** Equal but for the last decimal: coordinates are written to 0.1 px from the drawing's own corner. */
function expectSame(a, b) {
  expect(a.strokes).toBe(b.strokes)
  expect(Math.abs(a.length - b.length)).toBeLessThan(b.length * 1e-3)
}

/** One pen layer's strokes and pen-down length, by its label. */
function ink(svg, label) {
  const start = svg.indexOf(`inkscape:label="${label}"`)
  if (start < 0) return { strokes: 0, length: 0 }
  const body = svg.slice(start, svg.indexOf('</g>', start))
  let strokes = 0, length = 0
  for (const m of body.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) {
    const [x0, y0, x1, y1] = m.slice(1, 5).map(Number)
    strokes++; length += Math.hypot(x1 - x0, y1 - y0)
  }
  for (const m of body.matchAll(/<polyline points="([^"]+)"/g)) {
    const v = m[1].split(/[ ,]/).map(Number)
    strokes++
    for (let k = 0; k + 3 < v.length; k += 2) length += Math.hypot(v[k + 2] - v[k], v[k + 3] - v[k + 1])
  }
  return { strokes, length }
}

test('the panel offers an occluder switch where walls mean something, and a halo everywhere', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto(APP)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  // A mode's style rows show once it draws. From the sheet, before any mode's
  // own section is open over it.
  await setMark(page, 'Pillars', true)
  await setMark(page, 'Hachure', true)

  // A new plate is occluded by lines, the classic model.
  await page.fill('[data-testid="panel-filter"]', 'occluder')
  await page.waitForTimeout(450)
  await expect(page.locator('[data-testid="occlude-by-lines"]:visible')).toHaveAttribute('aria-pressed', 'true')
  await page.fill('[data-testid="panel-filter"]', '')

  // Lines is an occluder; the ticks are not, or their walls notch the Lines.
  await openMark(page, 'Lines')
  await expect(page.locator('[data-testid="walls-Lines"]')).toBeChecked()
  await expect(page.locator('[data-testid="halo-Lines"]')).toBeVisible()
  await openMark(page, 'Hachure')
  await expect(page.locator('[data-testid="walls-Hachure"]')).not.toBeChecked()

  // Under Ground the terrain hides, so Lines has a halo and no switch.
  await page.fill('[data-testid="panel-filter"]', 'occluder')
  await page.waitForTimeout(450)
  await page.locator('[data-testid="occlude-by-ground"]:visible').click()
  await page.fill('[data-testid="panel-filter"]', '')
  await openMark(page, 'Lines')
  const lines = page.locator('[data-testid="occlusion-Lines"]')
  await expect(lines.locator('[data-testid="halo-Lines"]')).toBeVisible()
  await expect(lines.locator('[data-testid="walls-Lines"]')).toHaveCount(0)
  // Pillars' walls are its columns' sides, which the ground cannot stand in for.
  await openMark(page, 'Pillars')
  await expect(page.locator('[data-testid="walls-Pillars"]')).toHaveCount(1)
})

test('long ticks no longer notch the Lines behind them', async ({ page }) => {
  test.setTimeout(300_000)
  await bootAutomation(page)

  // Under Ground the ticks hide nothing the ground does not, so the Lines come
  // out exactly as they do alone.
  const alone = ink(await plate(page, ['Lines'], { ...TICKS, occludeBy: 'ground' }), 'Lines')
  const both = await plate(page, ['Lines', 'Hachure'], { ...TICKS, occludeBy: 'ground' })
  expect(alone.length, 'the Lines have to draw something').toBeGreaterThan(1000)
  expectSame(ink(both, 'Lines'), alone)
  expect(ink(both, 'Hachure').length).toBeGreaterThan(0)

  // The classic model with the ticks' walls off, which is how it starts: the
  // same. With them on, the old look, whose walls still cut the Lines.
  const classicAlone = ink(await plate(page, ['Lines'], { ...TICKS, occludeBy: 'lines' }), 'Lines')
  const wallsOff = ink(await plate(page, ['Lines', 'Hachure'], { ...TICKS, occludeBy: 'lines', wallsHachure: 'false' }), 'Lines')
  const wallsOn = ink(await plate(page, ['Lines', 'Hachure'], { ...TICKS, occludeBy: 'lines', wallsHachure: 'true' }), 'Lines')
  expectSame(wallsOff, classicAlone)
  expect(wallsOn.length).toBeLessThan(classicAlone.length * 0.99)
})

test('the ground hides marks that hang no walls', async ({ page }) => {
  test.setTimeout(300_000)
  await bootAutomation(page)

  // Ticks alone, no fill. In the classic model with their walls off nothing
  // hides them, so the far side of every hill shows through. Under Ground the
  // hills hide it.
  const seeThrough = ink(await plate(page, ['Hachure'], { ...TICKS, occludeBy: 'lines', wallsHachure: 'false' }), 'Hachure')
  const ground = ink(await plate(page, ['Hachure'], { ...TICKS, occludeBy: 'ground' }), 'Hachure')
  expect(seeThrough.length).toBeGreaterThan(1000)
  expect(ground.length).toBeLessThan(seeThrough.length * 0.98)
})

test('Pillars and Stems stand inside the ground and keep their look', async ({ page }) => {
  test.setTimeout(300_000)
  await bootAutomation(page)

  // The columns are the ground's body: the closed ground of the new model must
  // not swallow them, and a solid's walls are kept under both models.
  const pillars = { spacingPillars: '8', pillarStyle: 'cuboid' }
  const classicP = ink(await plate(page, ['Pillars'], { ...pillars, occludeBy: 'lines' }), 'Pillars')
  const groundP = ink(await plate(page, ['Pillars'], { ...pillars, occludeBy: 'ground' }), 'Pillars')
  expect(classicP.length).toBeGreaterThan(1000)
  expectSame(groundP, classicP)

  // Without tips, whose small walls hide bits of stems in the classic model.
  const classicS = ink(await plate(page, ['Stems'], { tipsStems: 'false', occludeBy: 'lines' }), 'Stems')
  const groundS = ink(await plate(page, ['Stems'], { tipsStems: 'false', occludeBy: 'ground' }), 'Stems')
  expect(classicS.length).toBeGreaterThan(100)
  expectSame(groundS, classicS)
})

test('a halo breaks the Lines behind the ticks', async ({ page }) => {
  test.setTimeout(300_000)
  await bootAutomation(page)

  const plain = await plate(page, ['Lines', 'Hachure'], { ...TICKS, occludeBy: 'ground', haloHachure: '0' })
  const haloed = await plate(page, ['Lines', 'Hachure'], { ...TICKS, occludeBy: 'ground', haloHachure: '2' })
  const [l0, l1] = [ink(plain, 'Lines'), ink(haloed, 'Lines')]
  // Broken in more places, and shorter by the gaps. The ticks break too, where
  // one passes behind another: a halo cuts every line farther away.
  expect(l1.strokes).toBeGreaterThan(l0.strokes)
  expect(l1.length).toBeLessThan(l0.length * 0.99)
})
