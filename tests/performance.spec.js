import { test, expect } from '@playwright/test'

test('rotation remains responsive during resolution change (max 2s)', async ({ page }) => {
  // 1. Launch the app
  await page.goto('http://localhost:5173')
  // High timeout for initial load in CI
  await page.waitForSelector('canvas', { timeout: 30000 })
  await page.waitForTimeout(5000)

  // 2. Target specific sliders by looking for the span and its following input
  const findSlider = async (label) => {
    const span = page.locator('span', { hasText: new RegExp(`^${label}$`) }).first()
    return span.locator('xpath=../..//input[@type="range"]')
  }

  const resSlider = await findSlider('Resolution')
  const rotSlider = await findSlider('Rotation')

  // 3. Change resolution from 2 to 1 (Triggering worker)
  await resSlider.fill('1')
  console.log('Resolution changed to 1. Heavy worker task triggered.')
  
  // Give it a tiny moment to start the debounce timer
  await page.waitForTimeout(100)

  // 4. Immediately change rotation to -71
  const start = Date.now()
  await rotSlider.fill('-71')
  console.log('Rotation command sent.')

  // 5. Verify rotation text display updates within 2 seconds
  // The UI text "-71.0" should update immediately because it's not debounced
  // and the worker is running in the background.
  const rotValue = page.locator('div:has(> div > span:text-is("Rotation")) span').last()
  await expect(rotValue).toHaveText(/-71\.0/, { timeout: 2000 })
  
  const duration = Date.now() - start
  console.log(`Rotation responsiveness: ${duration}ms`)
  
  expect(duration).toBeLessThan(2000)
})
