/**
 * Dot work for one pen: the step of a dotted line, and Stipple's even spacing
 * and density sources.
 *
 * The unit suite proves what the builders and `dotSpacing` return. This checks
 * the two ends a unit test cannot see: that the panel shows each control only
 * where it applies, and that the step reaches the circles in the SVG.
 */
import { test, expect } from '@playwright/test'
import { openFold, openMark, resetToDefaults, setMark } from './helpers.js'

const APP = 'http://localhost:5173'

async function open(page) {
  await page.goto(APP)
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
}

test('Dot step shows only for the dotted dash', async ({ page }) => {
  await open(page)
  await setMark(page, 'Contours', true)
  await openMark(page, 'Contours')
  await openFold(page, 'line-style-Contours')
  const step = page.locator('[data-testid="dot-step-Contours"]')
  await expect(step).toHaveCount(0)
  await page.getByRole('group', { name: 'Dash' }).first().getByRole('button', { name: 'dotted', exact: true }).click()
  await expect(step).toBeVisible()
  await page.getByRole('group', { name: 'Dash' }).first().getByRole('button', { name: 'solid', exact: true }).click()
  await expect(step).toHaveCount(0)
})

test('each Stipple density source shows its own controls', async ({ page }) => {
  await open(page)
  await setMark(page, 'Stipple', true)
  await openMark(page, 'Stipple')
  const shown = async (ids) => {
    for (const id of ['stipple-azimuth', 'stipple-altitude', 'stipple-radius']) {
      await expect(page.locator(`[data-testid="${id}"]`)).toHaveCount(ids.includes(id) ? 1 : 0)
    }
  }
  await expect(page.locator('[data-testid="stipple-even"]')).toBeVisible()
  await expect(page.locator('[data-testid="stipple-amount"]')).toBeVisible()
  await shown([])
  await page.click('[data-testid="stipple-density-shade"]')
  await shown(['stipple-azimuth'])
  await page.click('[data-testid="stipple-density-cast"]')
  await shown(['stipple-azimuth', 'stipple-altitude'])
  await page.click('[data-testid="stipple-density-openness"]')
  await shown(['stipple-radius'])
})

test('a wider dot step writes fewer circles to the SVG', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto(`${APP}/?automation`)
  await page.waitForFunction(() => !!window.erzberg, null, { timeout: 60_000 })
  const circles = async (params) => {
    await page.evaluate(async (s) => {
      window.erzberg.setModes(['Contours'], true)
      window.erzberg.setParams(s)
      await window.erzberg.settle()
    }, params)
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 180_000 }),
      page.evaluate(() => window.erzberg.export('svg')),
    ])
    const chunks = []
    for await (const c of await dl.createReadStream()) chunks.push(c)
    return (Buffer.concat(chunks).toString('utf-8').match(/<circle /g) ?? []).length
  }
  const base = await circles({ dashContours: 'dots', weightContours: '2', dotStepContours: '2.2' })
  const wide = await circles({ dashContours: 'dots', weightContours: '2', dotStepContours: '6.6' })
  expect(base).toBeGreaterThan(1000)
  // Three times the step: a third of the dots, plus the one that starts each stroke.
  expect(wide / base).toBeGreaterThan(0.3)
  expect(wide / base).toBeLessThan(0.6)
})
