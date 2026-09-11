import { test, expect } from '@playwright/test'

test('app loads without console errors', async ({ page }) => {
  const errors = []

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      const text = msg.text()
      const url = msg.location().url
      const type = msg.type() === 'error' ? 'Error' : 'Warning'
      console.error(`[Browser Console ${type}] ${text} @ ${url}`)
      errors.push({ text, url, type: msg.type() })
    }
  })

  page.on('pageerror', err => {
    console.error(`[Browser Page Error] ${err.message}`)
    errors.push({ text: err.message, url: 'pageerror' })
  })

  page.on('response', response => {
    if (response.status() >= 400) {
      console.error(`[HTTP ${response.status()}] ${response.url()}`)
      errors.push({ text: `HTTP ${response.status()}`, url: response.url() })
    }
  })

  console.log('Navigating to http://localhost:5173 ...')
  await page.goto('http://localhost:5173')

  await page.waitForSelector('#root', { timeout: 10000 })
  await page.waitForTimeout(3000)

  // The wordmark, by its heading rather than by its text.
  //
  // `text=erzberg` is a bet that the app's own name appears exactly once in the
  // DOM, and a line of panel copy naming the app has already collected it once.
  // Both of these use the wordmark as a "the app has rendered" sentinel and
  // neither asserts anything about it, so the heading is what they actually mean.
  const header = page.getByRole('heading', { name: 'erzberg' })
  await expect(header).toBeVisible({ timeout: 10000 })
  
  await page.waitForSelector('canvas', { timeout: 20000 })

  // Filter out harmless errors
  const realErrors = errors.filter(e => {
    if (e.url.includes('favicon.svg')) return false
    if (e.text.includes('THREE.Clock: This module has been deprecated')) return false
    return true
  })

  expect(realErrors.length, `Total errors: ${realErrors.length}. ${realErrors.map(e => e.text).join('; ')}`).toBe(0)
  console.log('Runtime test passed ✓')
})
