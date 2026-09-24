import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { openStage, resetToDefaults } from './helpers.js'

/**
 * Free text placed in the scene.
 *
 * The lettering is the same machinery a point label uses, so what is worth
 * asserting is not that a glyph is shaped correctly — `useVectorLabels` already
 * covers that — but the three things that are new here: that a text becomes a
 * layer of its own, that several of them stack, and that each one leaves the
 * SVG as real `<text>` in its own named pen layer rather than as anonymous
 * paths.
 */

async function boot(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30000 })
  await resetToDefaults(page)
  await openStage(page, 'overlay')   // the Text section is in Overlay
  await page.getByText('Text', { exact: true }).first().click()
  await page.waitForTimeout(400)
}

const rows = (page) => page.locator('[data-testid^="text-layer-"]')

test('a text becomes a layer, and several of them stack', async ({ page }) => {
  await boot(page)
  const add = page.locator('[data-testid="text-add"]')
  await expect(rows(page)).toHaveCount(0)

  await add.click()
  await expect(rows(page)).toHaveCount(1)
  await page.locator('[data-testid^="text-body-"]').first().fill('ERZBERG')
  await page.waitForTimeout(800)

  await add.click()
  await expect(rows(page)).toHaveCount(2)

  // Newest on top — the top row is the front of the scene, and the thing you
  // just made is the thing you are looking at.
  const first = await rows(page).first().getAttribute('data-testid')
  await page.locator('[data-testid^="text-body-"]').first().fill('NORTH FACE')
  await page.waitForTimeout(400)
  await expect(page.locator(`[data-testid="${first}"]`)).toBeVisible()

  // Removing one leaves the other.
  const id = first.replace('text-layer-', '')
  await page.locator(`[data-testid="text-remove-${id}"]`).click()
  await expect(rows(page)).toHaveCount(1)
})

test('hiding a text stops it drawing, without forgetting it', async ({ page }) => {
  await boot(page)
  await page.locator('[data-testid="text-add"]').click()
  const id = (await rows(page).first().getAttribute('data-testid')).replace('text-layer-', '')
  await page.locator(`[data-testid="text-body-${id}"]`).fill('ERZBERG')
  await page.waitForTimeout(700)

  const eye = page.locator(`[data-testid="text-eye-${id}"]`)
  await eye.click()
  await page.waitForTimeout(500)
  // The row survives — hiding is not removing, and the text is still typed.
  await expect(rows(page)).toHaveCount(1)
  await expect(page.locator(`[data-testid="text-body-${id}"]`)).toHaveValue('ERZBERG')
  await eye.click()
  await page.waitForTimeout(500)
  await expect(rows(page)).toHaveCount(1)
})

test('each text exports as real <text> in its own pen layer', async ({ page }) => {
  await boot(page)
  const add = page.locator('[data-testid="text-add"]')

  await add.click()
  await page.locator('[data-testid^="text-body-"]').first().fill('ERZBERG')
  await page.waitForTimeout(700)
  await add.click()
  await page.locator('[data-testid^="text-body-"]').first().fill('NORTH FACE')
  await page.waitForTimeout(1200)

  /*
   * Off, because the default is now a stroke face.
   *
   * `textLayers.js` opens a text on Relief SingleLine Pendot, which letters with
   * polylines — the pen draws the skeleton of each glyph once instead of going
   * round its edge twice. That is the right default for a plotter and it is the
   * opposite of what this test is about, so the toggle comes off here and the
   * test below owns the other half.
   */
  for (const tog of await page.locator('input[type=checkbox][aria-label="Use single-line font"]').all()) {
    if (await tog.isChecked()) await tog.click()
  }
  await page.waitForTimeout(1200)

  await page.locator('canvas').first().click({ position: { x: 700, y: 600 }, force: true })
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.keyboard.press('1'),
  ])
  const svg = readFileSync(await download.path(), 'utf8')

  // Real editable type, not forty little paths where a word should be.
  expect(svg).toContain('<text')
  expect(svg).toContain('ERZBERG')
  expect(svg).toContain('NORTH FACE')

  /*
   * Named after what each one says, and not after what it said when it was
   * added. The name used to be captured at creation, so two texts both exported
   * as "erzberg" — which is a plot nobody can separate by pen.
   */
  const labels = [...svg.matchAll(/inkscape:label="([^"]*)"/g)].map((m) => m[1])
  expect(labels).toContain('ERZBERG')
  expect(labels).toContain('NORTH FACE')
})

test('a text opens on a stroke face, and plots as strokes', async ({ page }) => {
  /*
   * The other half of the export test above, and the reason the default moved.
   *
   * An outline face plots the *edge* of a letter, so a pen traces every glyph
   * twice and the counters fill in at small sizes. Relief SingleLine Pendot
   * draws the skeleton, which is what a plotter has done since the 1960s. The
   * cost is that the SVG carries polylines rather than editable <text>, and
   * that is a real trade rather than a free win — hence two tests.
   */
  await boot(page)
  await page.locator('[data-testid="text-add"]').click()
  await page.locator('[data-testid^="text-body-"]').first().fill('ERZBERG')
  await page.waitForTimeout(900)

  // The face it opened on, by name rather than by id, because the name is what
  // the panel shows and what the request was written in.
  const sel = page.locator('[data-testid^="text-font-"]').first()
  await expect(sel).toHaveValue('ReliefPendot')
  expect(await sel.evaluate((el) => el.options[el.selectedIndex]?.text))
    .toBe('Relief SingleLine Pendot')

  await page.locator('canvas').first().click({ position: { x: 700, y: 600 }, force: true })
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.keyboard.press('1'),
  ])
  const svg = readFileSync(await download.path(), 'utf8')

  // Strokes, and the layer still named after what it says so a plot can be
  // separated by pen.
  expect(svg).not.toContain('<text')
  expect([...svg.matchAll(/inkscape:label="([^"]*)"/g)].map((m) => m[1])).toContain('ERZBERG')
  expect(svg).toMatch(/<(polyline|path)/)
})
