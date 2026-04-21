import { test, expect } from '@playwright/test'

/**
 * Grid resolution test.
 * Verifies that the grid size is calculated correctly based on resolution.
 * Default Heightmap.png is 500x500.
 */
test('grid size matches resolution for 500px image', async ({ page }) => {
  console.log('Navigating to app...')
  await page.goto('http://localhost:5173')

  // Wait for the main UI and Sidebar to render
  await page.waitForSelector('text=Heightmap Lines', { timeout: 15000 })
  
  // --- Check Resolution 2 (Default) ---
  console.log('Checking Resolution 2...')
  // The stats should show 250x250
  await expect(page.locator('text=Grid: 250×250')).toBeVisible({ timeout: 10000 })
  console.log('Resolution 2 matches 250x250 ✓')

  // --- Change to Resolution 1 ---
  console.log('Switching to Resolution 1...')
  // Select the resolution slider specifically
  const resolutionSlider = page.locator('input[type="range"][min="1"][max="20"]').first()
  await resolutionSlider.fill('1')
  
  // Wait for computation to finish (stats to update)
  await expect(page.locator('text=Grid: 500×500')).toBeVisible({ timeout: 15000 })
  console.log('Resolution 1 matches 500x500 ✓')

  // --- Change to Resolution 4 ---
  console.log('Switching to Resolution 4...')
  await resolutionSlider.fill('4')
  
  // 500 / 4 = 125
  await expect(page.locator('text=Grid: 125×125')).toBeVisible({ timeout: 15000 })
  console.log('Resolution 4 matches 125x125 ✓')
})
