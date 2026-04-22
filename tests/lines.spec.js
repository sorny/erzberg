import { test, expect } from '@playwright/test'

test('verify black lines are rendered on the canvas', async ({ page }) => {
  // 1. Navigate to the app
  await page.goto('http://localhost:5173')

  // 2. Wait for the app to initialize and the canvas to appear
  await page.waitForSelector('canvas', { timeout: 15000 })
  
  // 3. Wait a few seconds for the geometry to be computed by the worker
  await page.waitForTimeout(3000)

  // 4. Capture pixel data from the canvas
  // We check for any non-white pixels. 
  // Default bg is #ffffff, default lines are #000000.
  const hasLines = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return false
    
    // We need to ensure we capture the current frame
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) return false

    const width = canvas.width
    const height = canvas.height
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

    // Search for non-white pixels (lines)
    // We check if R, G, or B are significantly lower than 255
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 200 || pixels[i+1] < 200 || pixels[i+2] < 200) {
        return true // Found a dark pixel!
      }
    }
    return false
  })

  if (!hasLines) {
    // Take a screenshot for debugging if it fails
    await page.screenshot({ path: 'test-results/no-lines-error.png' })
  }

  expect(hasLines, 'The viewport is completely white (or background color); no lines detected.').toBe(true)
})
