import { test, expect } from '@playwright/test'

/**
 * Runtime stability test.
 * Checks for console errors and ensures the app actually boots up.
 */
test('app loads without console errors', async ({ page }) => {
  const errors = []

  // Catch console logs
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text())
    }
  })

  // Catch page errors
  page.on('pageerror', err => {
    errors.push(err.message)
  })

  console.log('Navigating to app...')
  await page.goto('http://localhost:5173')

  // Log the page title to confirm load
  const title = await page.title()
  console.log(`Page title: ${title}`)

  // Wait for the main canvas to appear (longer timeout)
  console.log('Waiting for canvas...')
  try {
    await page.waitForSelector('canvas', { timeout: 30000 })
    console.log('Canvas detected ✓')
  } catch (e) {
    console.error('Canvas not found within timeout. Taking debug screenshot...')
    await page.screenshot({ path: 'test-results/failure.png' })
    throw e
  }

  // Wait for initial geometry computation to clear
  await page.waitForTimeout(3000)

  // Assert no errors occurred during load
  if (errors.length > 0) {
    console.error('Console errors found:', errors)
  }
  expect(errors.length, `Found ${errors.length} console errors: ${errors.join(', ')}`).toBe(0)

  // Verify app header is visible
  await expect(page.locator('text=Heightmap Lines')).toBeVisible()
  
  console.log('Runtime test passed: No console errors found ✓')
})
