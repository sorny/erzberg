import { test, expect } from '@playwright/test'
import { openFold, openMark, openStage, resetToDefaults, setMark } from './helpers.js'

/**
 * Z offset and plumb lines through the panel. The geometry is pinned in
 * tests/unit/lift.test.js. This checks the two controls and the pen layer the
 * plot gets. Heavy project: it waits on a download.
 */
const PAGE = 'http://localhost:5173'

async function exportSvg(page) {
  await openStage(page, 'output')
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 180_000 }),
    page.click('[data-testid="export-svg"]'),
  ])
  const chunks = []
  for await (const c of await dl.createReadStream()) chunks.push(c)
  return Buffer.concat(chunks).toString('utf-8')
}

test('a Z offset raises a mode, stacks it by landform, and plumb lines and footprints get their own pens', async ({ page }) => {
  test.setTimeout(420_000)
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
  await setMark(page, 'Contours', true)
  await openMark(page, 'Contours')
  await openFold(page, 'masks-Contours')

  const z = page.locator('[data-testid="z-offset-Contours"]:visible')
  await expect(z).toBeVisible()
  // Plumb lines need something to drop from.
  await expect(page.locator('[data-testid="plumb-Contours"]')).toHaveCount(0)
  await z.fill('1')
  await z.blur()
  await expect(page.locator('[data-testid="masks-Contours"]')).toContainText('raised')
  await expect(page.locator('[data-testid="plumb-dash-Contours"]')).toHaveCount(0)
  await page.locator('[data-testid="plumb-Contours"]:visible').check()
  // Their style opens under the switch.
  for (const id of ['plumb-colour', 'plumb-weight', 'plumb-opacity', 'plumb-dash', 'plumb-gap', 'plumb-size']) {
    await expect(page.locator(`[data-testid="${id}-Contours"]:visible`)).toBeVisible()
  }
  await page.locator('[data-testid="plumb-mark-Contours-cross"]:visible').click()
  await page.locator('[data-testid="plumb-points-Contours-summit"]:visible').click()
  await expect(page.locator('[data-testid="plumb-mark-Contours-cross"]:visible')).toHaveAttribute('aria-pressed', 'true')
  // Stack by landform and a footprint, each their own pen layers.
  await page.locator('[data-testid="z-stack-Contours-form"]:visible').click()
  await page.locator('[data-testid="footprint-Contours-solid"]:visible').click()
  await expect(page.locator('[data-testid="z-stack-Contours-form"]:visible')).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(2500)

  // The stack is a worker rebuild. Export again until the plot carries it.
  let svg = ''
  await expect(async () => {
    svg = await exportSvg(page)
    expect(svg).toMatch(/data-name="Contours · Footprint · [A-Z]/)
  }).toPass({ timeout: 200_000 })
  expect(svg).toMatch(/data-name="Contours · Plumb lines · [A-Z]/)
  expect(svg).toMatch(/data-name="Contours · Footprint · [A-Z]/)
  expect(svg).toMatch(/data-name="Contours · Minor · (Ridge|Peak|Valley|Pit|Flat, Slope)"/)
})
