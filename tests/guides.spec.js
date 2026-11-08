/**
 * The composition guides: the centre guides follow the free canvas as the
 * panel opens and closes, and the paper frame draws its own guide sets inside
 * the margin. The segments are pinned in tests/unit/frame.test.js.
 */
import { test, expect } from '@playwright/test'
import { openStage, resetToDefaults } from './helpers.js'

test('the centre guides move with the panel, and the paper draws its own guides', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { state: 'attached', timeout: 30_000 })
  await resetToDefaults(page)
  await openStage(page, 'frame')
  const tog = page.locator('[data-testid="centre-guides"]')
  if (!(await tog.isVisible())) await page.locator('[data-testid="section-camera"]').click()
  await tog.check()
  const guides = page.locator('[data-testid="centre-guide-lines"]')
  await expect(guides).toBeVisible()
  const vertical = async () => Number(await guides.locator('line').first().getAttribute('x1'))
  const width = page.viewportSize().width
  const open = await vertical()
  expect(open).toBeLessThan(width / 2 - 50)
  await page.locator('[data-testid="centre-guide-weight"]').fill('2')
  await page.locator('[data-testid="centre-guide-weight"]').blur()
  await expect(guides.locator('g')).toHaveAttribute('stroke-width', '2')
  await page.keyboard.press('Backslash')
  await expect.poll(vertical).toBeCloseTo(width / 2, 0)

  await page.keyboard.press('Backslash')
  const section = page.locator('[data-testid="section-paper"]')
  await section.scrollIntoViewIfNeeded()
  await section.click()
  await page.getByText('Paper frame', { exact: true }).click()
  await page.locator('[data-testid="paper-guide-thirds"]').click()
  await page.locator('[data-testid="paper-guide-diagonals"]').click()
  await expect(page.locator('[data-testid="paper-guides"] line')).toHaveCount(6)
  await page.locator('[data-testid="paper-guide-dash-dashed"]').click()
  await expect(page.locator('[data-testid="paper-guides"] g')).toHaveAttribute('stroke-dasharray', '6 4')
  expect(errors).toEqual([])
})
