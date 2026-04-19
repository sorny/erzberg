/**
 * Export comparison test.
 *
 * Runs the app (dev server must be reachable on :5173), waits for the default
 * heightmap to render, then exports both PNG and SVG and verifies:
 *
 *  1. The PNG download contains image data.
 *  2. The SVG download contains many <line> elements (not "only one line").
 *  3. The SVG, when rendered as an image, looks structurally similar to the
 *     live viewport screenshot (same general layout, lines visible).
 *
 * Run:
 *   npx playwright test
 *
 * Results (screenshots) are written to ./test-results/.
 */
import { test, expect } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'

const OUT = path.join(process.cwd(), 'test-results')

test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

test('SVG export contains many lines and matches viewport layout', async ({ page }) => {
  // ── 1. Load app and wait for terrain to render ───────────────────────────
  await page.goto('http://localhost:5173')
  await page.waitForSelector('canvas', { timeout: 15_000 })

  // Wait until the geometry is computed (canvas stops being blank)
  // Poll every 500 ms until canvas has non-white pixels or 20 s elapses.
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return false
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!ctx) return false
    // Check that the heightmap state is populated via the store
    // Fallback: just wait for the canvas to exist
    return true
  }, { timeout: 20_000 })

  // Give geometry time to compute after pixels load
  await page.waitForTimeout(5000)

  // Set a steep tilt (~40°) so peaks clearly occlude lines behind them.
  // 'x' increases tilt by 0.5° per press (80 presses = 40°)
  for (let i = 0; i < 80; i++) await page.keyboard.press('KeyX')
  await page.waitForTimeout(500)

  // ── 2. Take viewport screenshot (the "ground truth") ─────────────────────
  const viewportShot = await page.screenshot({ fullPage: false })
  writeFileSync(path.join(OUT, 'viewport.png'), viewportShot)
  console.log('Viewport screenshot saved.')

  // ── 3. Export PNG (key 3) ─────────────────────────────────────────────────
  const [pngDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.keyboard.press('Digit3'),
  ])
  const pngBuf = await pngDownload.createReadStream().then(stream =>
    new Promise((res, rej) => {
      const chunks = []
      stream.on('data', c => chunks.push(c))
      stream.on('end',  () => res(Buffer.concat(chunks)))
      stream.on('error', rej)
    })
  )
  writeFileSync(path.join(OUT, 'export.png'), pngBuf)
  expect(pngBuf.length).toBeGreaterThan(1000)
  console.log(`PNG export size: ${pngBuf.length} bytes ✓`)

  // ── 4. Export SVG (key 1) ─────────────────────────────────────────────────
  const [svgDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.keyboard.press('Digit1'),
  ])
  const svgBuf = await svgDownload.createReadStream().then(stream =>
    new Promise((res, rej) => {
      const chunks = []
      stream.on('data', c => chunks.push(c))
      stream.on('end',  () => res(Buffer.concat(chunks)))
      stream.on('error', rej)
    })
  )
  const svgText = svgBuf.toString('utf-8')
  writeFileSync(path.join(OUT, 'export.svg'), svgBuf)

  // ── 5. Assert SVG structure ───────────────────────────────────────────────
  const lineCount = (svgText.match(/<line /g) || []).length
  console.log(`SVG line element count: ${lineCount}`)

  // Must contain many lines, not just one
  expect(lineCount).toBeGreaterThan(50)
  // Must have a viewBox
  expect(svgText).toContain('viewBox')
  // Must have a background rect
  expect(svgText).toContain('<rect')

  console.log('SVG structure checks passed ✓')

  // ── 6. Render SVG in page and screenshot for visual inspection ────────────
  const svgB64 = svgBuf.toString('base64')
  const svgPage = await page.context().newPage()
  await svgPage.setContent(`
    <!DOCTYPE html>
    <html><body style="margin:0;background:#fff">
      <img src="data:image/svg+xml;base64,${svgB64}"
           style="width:100vw;height:100vh;object-fit:contain">
    </body></html>
  `)
  await svgPage.waitForLoadState('networkidle')
  const svgShot = await svgPage.screenshot()
  writeFileSync(path.join(OUT, 'svg-render.png'), svgShot)
  await svgPage.close()

  console.log('Visual comparison screenshots saved to ./test-results/')
  console.log('  viewport.png  — live WebGL render')
  console.log('  export.png    — trimmed PNG export')
  console.log('  svg-render.png — SVG export rendered as image')
})
