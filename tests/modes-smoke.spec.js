import { test, expect } from '@playwright/test'
import { openMark, openStage, waitForApp } from './helpers.js'
import { DRAW_MODES, MODE_LABEL } from '../src/utils/drawModes.js'

/**
 * Every draw mode, alone, on the sample plate: it draws, it raises nothing,
 * and it reaches the SVG as its own pen layer.
 *
 * Most modes have unit tests on a synthetic grid, which is where their maths
 * lives. None of those runs the mode through the worker, the renderer and the
 * exporter together on real ground, and that is where the Pillars draw-order
 * bug hid for a release: every unit test passed. This is the one place each
 * mode goes through the whole app.
 *
 * Land cover is skipped, because it draws nothing without a plate.
 */
const PAGE = 'http://localhost:5173/'

/**
 * Opens the app with this one mode on and every other off.
 *
 * The session is written before the app boots, not after. In a fresh browser
 * the app deals an opening preset shortly after load, and a session written
 * into a running app lost that race and came back with the preset's modes.
 */
async function openWithOnly(page, id) {
  await page.addInitScript(({ id, ids }) => {
    // One value off its default, which draws nothing: a session equal to the
    // defaults counts as none, and Lines alone *is* the defaults, so without
    // it the opening preset would land on that test.
    const s = { style: {}, view: { plotWidthMm: 298 } }
    for (const k of ids) s.style[`enabled${k}`] = false
    s.style[`enabled${id}`] = true
    localStorage.setItem('erzberg.session.v1', JSON.stringify(s))
  }, { id, ids: DRAW_MODES.map((m) => m.id) })
  await page.goto(PAGE)
  await waitForApp(page)
}

/** The panel's segment readout, once it reports a finished build. */
async function segments(page) {
  const stat = page.locator('text=/Segments:/').first()
  let n = 0
  for (let i = 0; i < 60 && n === 0; i++) {
    const text = (await stat.textContent()) ?? ''
    n = Number(text.match(/Segments:\s*([\d,]+)/)?.[1]?.replace(/,/g, '') ?? 0)
    if (n === 0) await page.waitForTimeout(500)
  }
  return n
}

for (const mode of DRAW_MODES.filter((m) => !m.needsData)) {
  test(`${mode.label} draws, exports, and raises nothing`, async ({ page }) => {
    test.setTimeout(120_000)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error' && !/THREE\.Clock/.test(m.text())) errors.push(m.text()) })

    await openWithOnly(page, mode.id)
    expect(await segments(page), 'the mode drew nothing on the sample plate').toBeGreaterThan(0)

    await openStage(page, 'output')
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 90_000 }),
      page.click('[data-testid="export-svg"]'),
    ])
    const chunks = []
    for await (const c of await dl.createReadStream()) chunks.push(c)
    const svg = Buffer.concat(chunks).toString('utf-8')
    const label = MODE_LABEL[mode.id]
    const pens = [...svg.matchAll(/inkscape:label="([^"]+)"/g)]
      .map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&quot;/g, '"'))
    expect(pens.some((l) => l === label || l.startsWith(`${label} · `)),
      `no pen layer for ${label} in ${pens.join(', ')}`).toBe(true)

    expect(errors, errors.join('\n')).toEqual([])
  })
}

// Isochrones stands for all three picks: Viewshed and Route go through the same
// path, `PICK_KEYS` in App.jsx.
test('a terrain pick moves the start of Isochrones', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1500, height: 950 })
  await openWithOnly(page, 'Isochrone')
  const origin = () => page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('erzberg.session.v1') || '{}').style ?? {}
    return [s.originXIsochrone, s.originYIsochrone]
  })
  await openMark(page, 'Isochrone')
  await page.click('[data-testid="isochrone-pick"]')
  // With no surface layer on, picking rebuilds the surface with the UVs a pick
  // reads, and a click before that lands on nothing. As with the profile.
  await page.waitForTimeout(500)
  await page.locator('text=Computing').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(500)
  // Left of centre on the sample plate, which fills the view at this size.
  // Not `canvas.first()`: the panel's histogram is a canvas too.
  await page.mouse.click(430, 640)
  await page.waitForTimeout(1500)
  const [x, y] = await origin()
  expect(x).toBeLessThan(0.5)
  expect(y).toBeGreaterThan(0)
  // The pick ends after one click, as the button says.
  await expect(page.locator('[data-testid="isochrone-pick"]')).toHaveText('Pick start on terrain')
})
