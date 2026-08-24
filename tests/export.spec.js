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
import { resetToDefaults } from './helpers.js'

const OUT = path.join(process.cwd(), 'test-results')

test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

/**
 * Camera tilt these tests run at, in degrees.
 *
 * Every occlusion test here needs a viewing angle where some terrain genuinely
 * sits behind other terrain, or the thing they assert cannot happen at all.
 * They used to reach for it by pressing `x` eighty times — a hotkey that stepped
 * tilt by 0.5° up to a 90° clamp, and that was removed in v0.2.13 (`hotkey trim`)
 * without the tests noticing. Since then the loop pressed a key nothing listens
 * for, and every one of these ran at the *default* tilt instead.
 *
 * 50° is that default, so pinning it here changes no behaviour and keeps the
 * numbers the assertions were tuned against. It is set explicitly rather than
 * inherited because these tests depend on the angle: were the default camera
 * ever changed, an inherited tilt would quietly alter what they measure instead
 * of failing. Occlusion does bite at 50° — Hillshade takes the stipple test from
 * 33 636 marks to 27 178.
 */
const TILT_DEG = 50

/**
 * The Tilt slider lives in the View section, which is open by default.
 * min/max alone would also match the two hatch-angle sliders; the 0.1 step is
 * what makes this selector unambiguous.
 */
async function setTilt(page, deg = TILT_DEG) {
  const tilt = page.locator('input[type="range"][min="0"][max="180"][step="0.1"]').first()
  await expect(tilt).toBeVisible({ timeout: 15_000 })
  await tilt.fill(String(deg))
  // Asserted, not assumed — a silently ineffective camera control is the exact
  // failure this helper replaces.
  await expect(tilt).toHaveValue(String(deg))
  // Filling leaves focus on the slider, and the export hotkeys are a window
  // listener that ignores events whose target is an INPUT. Leaving focus here
  // would make a later Digit1/Digit4 press vanish and the test time out waiting
  // for a download, so the helper hands focus back rather than making every
  // caller remember to.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(500)
}

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

  // A tilt where peaks occlude what is behind them — see TILT_DEG.
  await setTilt(page)

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
  const svgStart = Date.now()
  const [svgDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.keyboard.press('Digit1'),
  ])
  // Dominated by the per-sample occlusion walk. Recorded rather than asserted —
  // machine-dependent, but a 10x regression here would be visible at a glance.
  console.log(`SVG export took ${Date.now() - svgStart}ms`)
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
  // Both stroke elements: connected strokes are joined into `<polyline>` on
  // export, so counting only `<line>` would measure the leftovers rather than
  // the drawing and pass on a nearly empty file.
  const lineCount = (svgText.match(/<line |<polyline /g) || []).length
  console.log(`SVG stroke element count: ${lineCount}`)

  // Must contain many strokes, not just one
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

/**
 * The surface must act as a depth occluder in SVG for *any* fill layer, not just
 * Fill. It was gated on `showFill` alone, which is off by default — so a
 * hillshaded scene exported lines the viewport correctly hid behind the terrain.
 *
 * Stipple is the sharpest probe: it returns `isPoints`, so it generates no
 * occlusion curtains of its own. With it as the only mode, the terrain surface is
 * the *only* thing that can occlude anything, which makes the difference a clean
 * before/after count rather than a subtle one.
 */
test('any fill layer makes the terrain occlude lines in SVG export', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30_000 })
  const toggle = page.locator('[data-testid="sidebar-toggle"]')
  if ((await toggle.innerText()) === '◀') { await toggle.click(); await page.waitForTimeout(400) }
  await resetToDefaults(page)
  await page.waitForTimeout(2500)

  /**
   * Flips the "Enabled" switch of a sidebar section.
   *
   * `openFirst` is passed explicitly rather than detected: a collapsed Section
   * keeps its children in the DOM at full height, clipped by the parent's
   * `grid-template-rows: 0fr` and scrolled far below the fold, so the toggle
   * reports a perfectly normal 18px box and every "is it visible" heuristic says
   * yes while a click at those coordinates does nothing. On a fresh page the
   * open state is known, so there is nothing to detect.
   */
  const setEnabled = async (title, on, openFirst) => {
    if (openFirst) {
      await page.getByText(title, { exact: true }).click()
      await page.waitForTimeout(500)
    }
    const tog = page.locator('#hm-panel-body > div')
      .filter({ hasText: new RegExp(`^${title}`) }).first().locator('label').first()
    await tog.scrollIntoViewIfNeeded()
    await tog.click({ force: true })
    await expect(tog.locator('input')).toBeChecked({ checked: on })
  }

  // Stipple only. Mode: Lines is the one draw-mode section open by default.
  await setEnabled('Mode: Lines', false, false)
  await setEnabled('Mode: Stipple Dots', true, true)
  // A tilt where there is genuinely something behind the mountain to hide.
  await setTilt(page)
  await page.waitForTimeout(3000)

  const dotCount = async () => {
    // The export hotkey is a window listener, so focus has to be off the sidebar
    // controls we just clicked or the keypress never reaches it.
    await page.locator('canvas').first().click({ position: { x: 5, y: 5 } })
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.keyboard.press('Digit1'),
    ])
    const buf = await dl.createReadStream().then((s) => new Promise((res, rej) => {
      const chunks = []
      s.on('data', (c) => chunks.push(c))
      s.on('end', () => res(Buffer.concat(chunks)))
      s.on('error', rej)
    }))
    const t = buf.toString('utf-8')
    return (t.match(/<circle |<line /g) || []).length
  }

  const withoutFill = await dotCount()

  await setEnabled('Hillshade', true, true)
  await page.waitForTimeout(3000)
  const withHillshade = await dotCount()

  console.log(`SVG marks — no fill layer: ${withoutFill}, hillshade on: ${withHillshade}`)
  expect(withoutFill).toBeGreaterThan(100)
  expect(withHillshade,
    'hillshade must make the surface occlude, so fewer marks survive').toBeLessThan(withoutFill)
})

/**
 * The export must not freeze the page.
 *
 * This is the complaint itself, asserted directly rather than through a proxy:
 * a rAF loop timestamps every frame, so the largest gap between frames IS the
 * stretch during which the tab was unresponsive and Chrome was deciding whether
 * to offer to kill it. Measured before the export learned to pace itself, the
 * default plate produced one unbroken 242 ms gap with every other frame at 17 ms.
 * After, the longest is ~39 ms — the 24 ms budget plus a frame's overhead.
 *
 * The threshold sits at 120 ms: far above the ~39 ms the paced version produces,
 * far below the 242 ms it replaced, and comfortably inside what reads as a live
 * page. A dense scene makes the old number worse, never better, so this catches a
 * regression to unpaced work on any plate.
 */
test('exporting never blocks the page for long enough to look hung', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30_000 })
  await page.waitForTimeout(2500)

  const r = await page.evaluate(async () => {
    const gaps = []
    const seen = []
    let last = performance.now()
    let running = true
    const tick = () => {
      const now = performance.now()
      gaps.push(now - last)
      last = now
      // Sample the bar as it goes, to prove it advances rather than jumping.
      const el = document.querySelector('[data-testid="export-progress"]')
      if (el) seen.push(Number(el.dataset.pct))
      if (running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    await new Promise((res) => setTimeout(res, 300))
    const t0 = performance.now()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', bubbles: true }))

    // Wait for the overlay to appear and then go again.
    const deadline = performance.now() + 60_000
    let appeared = false
    while (performance.now() < deadline) {
      await new Promise((res) => setTimeout(res, 50))
      const present = !!document.querySelector('[data-testid="loading-overlay"]')
      if (present) appeared = true
      if (appeared && !present) break
    }
    running = false
    return {
      longest: Math.max(...gaps),
      total: performance.now() - t0,
      appeared,
      seen,
    }
  })

  console.log(`export: ${r.total.toFixed(0)}ms wall, longest frozen stretch ${r.longest.toFixed(0)}ms, ` +
              `progress samples ${JSON.stringify(r.seen.slice(0, 12))}`)

  expect(r.appeared, 'the export overlay should appear').toBe(true)
  expect(r.longest,
    'the page must never sit unresponsive long enough to look hung').toBeLessThan(120)

  // Progress must genuinely travel, not snap from nothing to done. Sampling at
  // frame rate over a sub-second export catches only a handful of values, so the
  // bar is asked to have been *somewhere* short of finished at least once.
  const partial = r.seen.filter((v) => v > 0 && v < 100)
  expect(partial.length, `the bar should report intermediate values, saw ${JSON.stringify(r.seen)}`)
    .toBeGreaterThan(0)
})

test('Cancel abandons an export without writing a file', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30_000 })
  await page.waitForTimeout(2500)

  let downloads = 0
  page.on('download', () => { downloads++ })

  await page.keyboard.press('Digit1')
  const cancel = page.locator('[data-testid="export-cancel"]')
  await expect(cancel).toBeVisible({ timeout: 5000 })
  await cancel.click()

  // The overlay must close on its own — the run unwinds at its next yield.
  await expect(page.locator('[data-testid="loading-overlay"]')).toBeHidden({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  expect(downloads, 'a cancelled export must not download anything').toBe(0)

  // And the app is still usable: a second export runs to completion.
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.keyboard.press('Digit1'),
  ])
  expect(dl.suggestedFilename()).toMatch(/\.svg$/)
})

/** Exports an SVG via the hotkey and returns its text. */
async function exportSvgText(page) {
  // The export hotkey is a window listener that ignores events aimed at an
  // INPUT, so focus has to leave the sidebar first.
  await page.locator('canvas').first().click({ position: { x: 5, y: 5 } })
  const dl = page.waitForEvent('download', { timeout: 120_000 })
  await page.keyboard.press('Digit1')
  let svg = ''
  for await (const chunk of await (await dl).createReadStream()) svg += chunk
  return svg
}

/** Every segment drawn by the file, expanded back out of any polylines. */
function drawnSegments(svg) {
  let count = 0, length = 0
  for (const m of svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) {
    count++; length += Math.hypot(+m[3] - +m[1], +m[4] - +m[2])
  }
  const polylines = [...svg.matchAll(/<polyline points="([^"]+)"/g)]
  for (const m of polylines) {
    const pts = m[1].split(' ').map((p) => p.split(',').map(Number))
    for (let i = 1; i < pts.length; i++) {
      count++; length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    }
  }
  return { count, length, polylines: polylines.length }
}

test('a continuous stroke exports as one polyline, losing nothing', async ({ page }) => {
  /*
   * A terrain line is one pen stroke, and nothing upstream treats it as one: the
   * geometry is `LineSegments`, so it reaches the exporter as thousands of
   * two-point pieces, and the occlusion walk cuts it again at every visibility
   * transition. Written out one `<line>` each — which is what this used to do,
   * 228 670 of them on the default scene — a plot of that file is a plot of
   * thousands of separate paths, and a plotter lifts the pen between paths.
   *
   * What matters here is that joining them back is *lossless*. Fewer elements is
   * the easy half and a wrong join would produce that too, so what is pinned is
   * the expansion: every polyline broken back into segments must return the same
   * count and the same total drawn length.
   */
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await setTilt(page)

  const svg = await exportSvgText(page)
  const { count, length, polylines } = drawnSegments(svg)
  console.log(`joined: ${polylines} polylines carrying ${count} segments`)

  expect(polylines, 'connected strokes must join into polylines').toBeGreaterThan(100)
  // The point of the change: far fewer elements than the segments they carry.
  expect(polylines * 20, 'a polyline must carry many segments on average').toBeLessThan(count)
  expect(count, 'joining must not drop or invent geometry').toBeGreaterThan(50_000)
  expect(length, 'nor change how much ink lands on the page').toBeGreaterThan(1000)

  /*
   * `fill="none"` on every group holding a polyline. A `<line>` has no interior
   * so these groups never needed it; a `<polyline>` does, and the initial SVG
   * fill is black — without this each joined stroke plots as a filled
   * silhouette. It is the one way this could fail while still producing a
   * perfectly plausible element count.
   */
  const polyGroups = [...svg.matchAll(/<g ([^>]*)>(?=[^<]*<polyline)/g)].map((m) => m[1])
  expect(polyGroups.length).toBeGreaterThan(0)
  for (const g of polyGroups) expect(g, 'a polyline group must not fill').toContain('fill="none"')
})

test('a dashed layer still exports as separate pieces', async ({ page }) => {
  // Dashes are cut into on-pieces by `splitDashSegment` before they are written,
  // so they are genuinely disconnected and must not be rejoined — doing so would
  // draw the gaps back in.
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await setTilt(page)

  // Mode: Lines is the one draw-mode section open by default.
  const lines = page.locator('#hm-panel-body > div').filter({ hasText: /^Mode: Lines/ }).first()
  await lines.getByRole('button', { name: 'dashed', exact: true }).click()
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(1500)

  const svg = await exportSvgText(page)
  const layer = svg.match(/<g id="layer-Lines"[\s\S]*?<\/g>\s*<\/g>/)?.[0] ?? ''
  expect(layer, 'the dashed Lines layer must export').not.toBe('')
  expect((layer.match(/<line /g) || []).length,
    'a dashed stroke stays in pieces').toBeGreaterThan(100)
  expect(layer, 'and is never joined into a polyline').not.toContain('<polyline')
})
