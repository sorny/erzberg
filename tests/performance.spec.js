import { test, expect } from '@playwright/test'

test('rotation remains responsive during resolution change', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  
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

  const start = Date.now()
  await rotSlider.fill('-71')
  console.log('Rotation command sent.')

  await expect(rotSlider).toHaveValue('-71', { timeout: 10000 })
  
  const duration = Date.now() - start
  console.log(`Rotation responsiveness: ${duration}ms`)
  expect(duration).toBeLessThan(2000)
})

test('render-performance-baseline', async ({ page }) => {
  let perfLog = null
  page.on('console', msg => {
    if (msg.text().includes('[Perf] Terrain ready')) {
      perfLog = msg.text()
      console.log(`Captured: ${perfLog}`)
    }
  })

  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

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
