/**
 * Dark and light: the toggle in the panel head, and what it has to reach.
 *
 * The palette lives in custom properties for the DOM and in `HEX` for the
 * canvases, so the test reads both. A light panel over a canvas still drawn in
 * dark ink is the failure this exists to catch.
 */
import { test, expect } from '@playwright/test'
import { waitForApp } from './helpers.js'

const PAGE = 'http://localhost:5173'
const bg = (page) => page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--hm-bg').trim())

test('the theme toggle switches the palette and survives a reload', async ({ page }) => {
  await page.goto(PAGE)
  await waitForApp(page)
  await page.evaluate(() => localStorage.removeItem('erzberg.theme'))
  await page.reload()
  await waitForApp(page)

  // Dark by default: the panel has always been dark.
  await expect(page.locator('html')).toHaveAttribute('data-hm-theme', 'dark')
  expect(await bg(page)).toBe('#151412')

  await page.click('[data-testid="theme-toggle"]')
  await expect(page.locator('html')).toHaveAttribute('data-hm-theme', 'light')
  expect(await bg(page)).toBe('#FBFAF7')
  // The panel itself follows, not only the variable.
  const panelBg = await page.locator('#hm-panel').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(panelBg).toBe('rgb(251, 250, 247)')

  await page.reload()
  await waitForApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-hm-theme', 'light')

  await page.click('[data-testid="theme-toggle"]')
  await expect(page.locator('html')).toHaveAttribute('data-hm-theme', 'dark')
})

test('the canvas palette follows the theme', async ({ page }) => {
  await page.goto(PAGE)
  await waitForApp(page)
  await page.evaluate(() => localStorage.setItem('erzberg.theme', 'dark'))
  await page.reload()
  await waitForApp(page)
  const hexBg = () => page.evaluate(async () => (await import('/src/utils/theme.js')).HEX.bg)
  expect(await hexBg()).toBe('#151412')
  await page.click('[data-testid="theme-toggle"]')
  expect(await hexBg()).toBe('#FBFAF7')
})
