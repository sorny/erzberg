import { test, expect } from '@playwright/test'

test('verify black lines are rendered on the canvas center', async ({ page }) => {
  // 1. Navigate to the app
  await page.goto('http://localhost:5173')

  // 2. Wait for the app to initialize and the canvas to appear
  await page.waitForSelector('canvas', { timeout: 15000 })
  
  // 3. Wait a few seconds for the geometry to be computed by the worker
  await page.waitForTimeout(3000)

  // 4. Capture pixel data from the 100x100 center region
  // Default bg is #ffffff, default lines are #000000.
  const hasLines = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return false
    
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true }) || 
               canvas.getContext('webgl', { preserveDrawingBuffer: true })
    if (!gl) return false

    const width = canvas.width
    const height = canvas.height
    
    const scanW = 100
    const scanH = 100
    const startX = Math.floor(width / 2 - scanW / 2)
    const startY = Math.floor(height / 2 - scanH / 2)

    const pixels = new Uint8Array(scanW * scanH * 4)
    gl.readPixels(startX, startY, scanW, scanH, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

    // Search for non-white pixels (lines)
    for (let i = 0; i < pixels.length; i += 4) {
      // Check if pixel is significantly darker than the white background
      if (pixels[i] < 200 || pixels[i+1] < 200 || pixels[i+2] < 200) {
        return true 
      }
    }
    return false
  })

  if (!hasLines) {
    await page.screenshot({ path: 'test-results/center-lines-error.png' })
  }

  expect(hasLines, 'The center 100x100px area is empty; no lines detected.').toBe(true)
})
