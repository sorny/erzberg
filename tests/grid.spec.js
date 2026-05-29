import { test, expect } from '@playwright/test'

/**
 * Grid resolution test.
 * Verifies that the grid size is calculated correctly from the resolution:
 * grid cols/rows = floor(imageSize / resolution).
 *
 * The default Heightmap.png is 1024×1024, and autoResolution() picks resolution 1
 * for it (the geometry grid is capped at 1024×1024), so the default view is 1024×1024.
 */
test('grid size matches resolution for the default 1024px image', async ({ page }) => {
  console.log('Navigating to app...')
  await page.goto('http://localhost:5173')

  // Wait for the main UI and Sidebar to render
  await page.waitForSelector('text=erzberg', { timeout: 15000 })

  // --- Check default (Resolution 1 → 1024×1024) ---
  console.log('Checking default resolution...')
  await expect(page.locator('text=Grid: 1024×1024')).toBeVisible({ timeout: 10000 })
  console.log('Default matches 1024×1024 ✓')

  const resolutionSlider = page.locator('input[type="range"][min="1"][max="20"]').first()

  // --- Change to Resolution 2 → 512×512 ---
  console.log('Switching to Resolution 2...')
  await resolutionSlider.fill('2')
  await expect(page.locator('text=Grid: 512×512')).toBeVisible({ timeout: 15000 })
  console.log('Resolution 2 matches 512×512 ✓')

  // --- Change to Resolution 4 → 256×256 ---
  console.log('Switching to Resolution 4...')
  await resolutionSlider.fill('4')
  await expect(page.locator('text=Grid: 256×256')).toBeVisible({ timeout: 15000 })
  console.log('Resolution 4 matches 256×256 ✓')
})
