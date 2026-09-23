import { test, expect } from '@playwright/test'
import { openStage, waitForApp } from './helpers.js'

test('rotation remains responsive during resolution change', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  
  // Ensure sidebar is open (shows ▶ when open)
  const openToggle = page.locator('[data-testid="sidebar-toggle"]')
  if ((await openToggle.innerText()) === '◀') {
    await openToggle.click()
    await page.waitForTimeout(500)
  }

  // Resolution slider is uniquely identified by min=1 max=20
  const resSlider = page.locator('input[type="range"][min="1"][max="20"]').first()
  // Rotation slider is uniquely identified by min=-180 (same selector as benchmark test)
  const rotSlider = page.locator('input[type="range"][min="-180"]')

  await expect(resSlider).toBeVisible({ timeout: 15000 })
  await resSlider.fill('1')
  console.log('Resolution changed to 1. Heavy worker task triggered.')

  await page.waitForTimeout(200)

  // Resolution is Shape's, in the pane the panel opens on. Rotation is
  // Camera's, in Frame — and the point of this test is that the rail click and
  // the fill happen while the worker is still busy with that resolution.
  await openStage(page, 'frame')

  const start = Date.now()
  await rotSlider.fill('-71')
  console.log('Rotation command sent.')

  await expect(rotSlider).toHaveValue('-71', { timeout: 10000 })
  
  const duration = Date.now() - start
  console.log(`Rotation responsiveness: ${duration}ms`)
  expect(duration).toBeLessThan(2000)
})

/*
 * Named for what it measures.
 *
 * This was called `render-performance-baseline` and contains no rendering: it
 * reads `[Perf] Terrain ready Main:`, which is the main-thread cost of taking
 * the worker's buffers and building geometry from them. The name would have
 * been quoted as cover for a React Three Fiber upgrade — see
 * `render-perf.spec.js`, which measures the frame loop this one never touched.
 */
test('terrain build hands off to the main thread promptly', async ({ page }) => {
  let perfLog = null
  page.on('console', msg => {
    if (msg.text().includes('[Perf] Terrain ready')) {
      perfLog = msg.text()
      console.log(`Captured: ${perfLog}`)
    }
  })

  await page.goto('http://localhost:5173')
  await waitForApp(page)

  const openToggle = page.locator('[data-testid="sidebar-toggle"]')
  if ((await openToggle.innerText()) === '◀') {
    await openToggle.click()
    await page.waitForTimeout(500)
  }

  const resSlider = page.locator('div:has-text("Resolution")').locator('input[type="range"]').first()
  await expect(resSlider).toBeVisible({ timeout: 15000 })
  await resSlider.fill('1')

  let attempts = 0
  while (!perfLog && attempts < 40) {
    await page.waitForTimeout(1000)
    attempts++
  }

  expect(perfLog).not.toBeNull()
  const mainMatch = perfLog.match(/Main: ([\d.]+)ms/)
  expect(mainMatch).not.toBeNull()
  const mainThreadTime = parseFloat(mainMatch[1])
  console.log(`Verified Main Thread Parsing: ${mainThreadTime}ms`)
  expect(mainThreadTime).toBeLessThan(500)
})
