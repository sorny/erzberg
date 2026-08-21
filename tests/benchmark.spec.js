import { test, expect } from '@playwright/test'
import path from 'path'

/**
 * Performance Benchmark — full GeoTIFF workflow:
 * 1. GeoTIFF parse + display timing
 * 2. Rotation to 51° responsiveness
 * 3. Fill enable + color reactivity
 * 4. Full Reset + geometry recompute
 *
 * Each phase takes a screenshot to test-results/ so viewport changes are visible.
 */
test('performance benchmark', async ({ page }) => {
  test.setTimeout(120000)
  const logs = []
  page.on('console', msg => {
    const text = msg.text()
    if (msg.type() === 'error') {
      console.error(`PAGE ERROR: ${text}`)
    }
    if (text.startsWith('[Benchmark]')) {
      logs.push({ text, time: Date.now() })
      console.log(`Captured: ${text}`)
    } else if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`PAGE ${msg.type().toUpperCase()}: ${text}`)
    }
  })

  page.on('pageerror', err => {
    console.error(`UNCAUGHT EXCEPTION: ${err.message}`)
    console.error(err.stack)
  })

  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

  // ─── PHASE 1: GeoTIFF Upload, Parse & Display ─────────────────────────────
  console.log('--- Phase 1: GeoTIFF Upload & Parse ---')

  const filePath = path.join(process.cwd(), 'tests', 'testdata', 'benchmark.tif')
  logs.length = 0

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="load-geotiff"]')
  ])
  await fileChooser.setFiles(filePath)
  console.log(`[Benchmark] File Selected: ${Date.now()}`)

  // Wait for the app's own upload-started marker to get the real start time
  let appUploadStartLog = null
  for (let i = 0; i < 40; i++) {
    appUploadStartLog = logs.find(l => l.text.includes('GeoTIFF Upload Started'))
    if (appUploadStartLog) break
    await page.waitForTimeout(250)
  }
  expect(appUploadStartLog, '[Benchmark] GeoTIFF Upload Started log not captured').not.toBeNull()
  const realUploadStart = appUploadStartLog.time

  // Wait for parse completion
  let parsedLog = null
  for (let i = 0; i < 40; i++) {
    parsedLog = logs.find(l => l.text.includes('GeoTIFF Parsed'))
    if (parsedLog) break
    await page.waitForTimeout(250)
  }
  expect(parsedLog, '[Benchmark] GeoTIFF Parsed log not captured').not.toBeNull()
  const parseTime = parsedLog.time - realUploadStart
  console.log(`RESULT: GeoTIFF Parsing took ${parseTime}ms`)

  // Wait for computing overlay to appear then disappear (geometry worker)
  try {
    await page.waitForSelector('[data-testid="loading-overlay"]', { state: 'visible', timeout: 2000 })
  } catch (_) {
    // The overlay is debounced, so a fast machine can finish the build before it
    // ever appears. Missing it is not a failure — only the hidden wait below is.
  }
  await page.waitForSelector('[data-testid="loading-overlay"]', { state: 'hidden', timeout: 60000 })

  // Wait for the last Viewport Updated log
  let lastViewportLog = null
  for (let i = 0; i < 120; i++) {
    const candidates = logs.filter(l =>
      l.text.includes('Viewport Updated') && l.time >= realUploadStart
    )
    if (candidates.length > 0) {
      lastViewportLog = candidates[candidates.length - 1]
      if (lastViewportLog.text.includes('Worker:')) break
    }
    await page.waitForTimeout(500)
  }
  expect(lastViewportLog, '[Benchmark] Viewport Updated log not captured').not.toBeNull()

  const totalDisplayTime = lastViewportLog.time - realUploadStart
  console.log(`RESULT: GeoTIFF Upload to Viewport took ${totalDisplayTime}ms`)
  console.log(`Final Viewport Log: ${lastViewportLog.text}`)

  await page.screenshot({ path: 'test-results/benchmark-01-geotiff-display.png' })

  // Give the main thread a moment after heavy geometry
  await page.waitForTimeout(2000)

  // ─── PHASE 2: Rotation to 51° ─────────────────────────────────────────────
  console.log('--- Phase 2: Rotation to 51° ---')

  // Target the rotation slider by its unique min="-180" attribute
  const rotSlider = page.locator('input[type="range"][min="-180"]')
  await expect(rotSlider).toBeVisible({ timeout: 15000 })

  const rotStart = Date.now()
  await rotSlider.fill('51')

  // Verify the slider value itself updated
  await expect(rotSlider).toHaveValue('51', { timeout: 5000 })

  const rotTime = Date.now() - rotStart
  console.log(`RESULT: Rotation to 51° took ${rotTime}ms`)

  // Wait one frame for the canvas to render the rotated view
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test-results/benchmark-02-rotation.png' })

  // ─── PHASE 3: Fill Enable + Color Reactivity ──────────────────────────────
  console.log('--- Phase 3: Fill Enable & Color Update ---')

  await page.locator('#hm-panel-body').waitFor({ state: 'visible', timeout: 30000 })

  // Ensure "Terrain Style" section is open
  const styleHeader = page.locator('div:has-text("Terrain Style")').last()
  await styleHeader.click()
  await page.waitForTimeout(500)

  const fillColorRow = page.locator('div:has(> span:text-is("Fill"))')
  const fillToggle = fillColorRow.locator('input[type="checkbox"]')
  const colorInput = fillColorRow.locator('input[type="color"]')

  // Enable fill if not already on
  const isChecked = await fillToggle.evaluate(el => el.checked)
  if (!isChecked) {
    console.log('Enabling Fill...')
    await fillToggle.evaluate(el => el.click())
    await page.waitForTimeout(500)
  }

  // Change color to red and measure reactivity
  console.log('Updating Fill Color to #ff0000...')
  const colorStart = Date.now()
  await colorInput.fill('#ff0000')

  let updatedLog = null
  for (let i = 0; i < 60; i++) {
    const newLogs = logs.filter(l => l.time >= colorStart)
    updatedLog = newLogs.find(l => l.text.includes('Color Updated'))
    if (updatedLog) break
    await page.waitForTimeout(100)
  }
  expect(updatedLog, '[Benchmark] Color Updated log not captured').not.toBeNull()

  const reactivityTime = updatedLog.time - colorStart
  console.log(`RESULT: Color Reactivity took ${reactivityTime}ms`)
  console.log(`Final Color Log: ${updatedLog.text}`)

  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/benchmark-03-fill-red.png' })

  // ─── PHASE 4: Full Reset ──────────────────────────────────────────────────
  console.log('--- Phase 4: Full Reset ---')

  // The app-level control is "Reset all" — the bare "Reset" inside the View
  // section only recentres the camera, and matching /^Reset$/ would now measure
  // that one instead while still passing, because it also zeroes rotation.
  const resetBtn = page.locator('button').filter({ hasText: /^Reset all$/ }).first()
  await expect(resetBtn).toBeVisible({ timeout: 10000 })

  const resetStart = Date.now()
  await resetBtn.click()

  // Rotation and fill styling are render-side params: a Reset that only touches
  // those no longer spawns a geometry-worker rebuild (the geometry already
  // matches the default params). Reset completion is measured by the UI
  // returning to defaults; if a worker recompute does happen (terrain params
  // were changed), its Viewport Updated log is reported as extra detail.
  await expect(rotSlider).toHaveValue('0', { timeout: 10000 })
  const resetTime = Date.now() - resetStart
  console.log(`RESULT: Full Reset took ${resetTime}ms`)

  const resetViewportLogs = logs.filter(l => l.time >= resetStart && l.text.includes('Viewport Updated'))
  console.log(resetViewportLogs.length > 0
    ? `Reset Viewport Log: ${resetViewportLogs[resetViewportLogs.length - 1].text}`
    : 'Reset triggered no worker rebuild (render-side params only)')

  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/benchmark-04-reset.png' })

  // ─── SUMMARY ──────────────────────────────────────────────────────────────
  console.log('--- BENCHMARK COMPLETE ---')
  console.log(`GeoTIFF Parse:    ${parseTime}ms`)
  console.log(`GeoTIFF Display:  ${totalDisplayTime}ms`)
  console.log(`Rotation 51°:     ${rotTime}ms`)
  console.log(`Color Reactivity: ${reactivityTime}ms`)
  console.log(`Full Reset:       ${resetTime}ms`)
  expect(resetTime).toBeLessThan(10000)
})
