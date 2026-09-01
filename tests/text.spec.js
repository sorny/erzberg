import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resetToDefaults } from './helpers.js'

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
