/**
 * Elevation profile: the section on the terrain, and the file it exports.
 *
 * The chart used to be the only evidence a profile had been taken — two clicks
 * went in, a curve came out, and nothing said which two points it described.
 * These cover both halves of the answer: the section drawn over the terrain, and
 * the standalone SVG the popup writes.
 */
import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

async function openApp(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30_000 })
  const t = page.locator('[data-testid="sidebar-toggle"]')
  if ((await t.innerText()) === '◀') { await t.click(); await page.waitForTimeout(400) }
  await page.waitForTimeout(3000)
  await resetToDefaults(page)
}

/** Arms profile mode and clicks A then B on the terrain. */
async function takeProfile(page) {
  await page.locator('[data-testid="section-analysis"]').click()
  await page.waitForTimeout(300)
  await page.locator('text=Elevation Profile').first().click()
  await page.waitForTimeout(400)
  const box = await page.locator('canvas').first().boundingBox()
  await page.mouse.click(box.x + box.width * 0.34, box.y + box.height * 0.62)
  await page.waitForTimeout(800)
  const afterA = await page.locator('text=Click point B…').count()
  await page.mouse.click(box.x + box.width * 0.66, box.y + box.height * 0.45)
  await page.waitForTimeout(1800)
  return { afterA, box }
}

test('the section and its anchors are drawn on the terrain, and cleared with the chart', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openApp(page)

  // A band of the viewport holding the terrain and both pins, but neither the
  // panel (which overlaps the canvas from x=1008 at this viewport) nor the chart
  // popup (bottom centre). An element screenshot of the canvas would include
  // both, and then every unrelated click on a section header reads as a changed
  // scene.
  const PLATE = { clip: { x: 0, y: 60, width: 980, height: 420 } }
  const before = await page.screenshot(PLATE)

  const { afterA } = await takeProfile(page)
  expect(afterA, 'the first click must arm the second').toBe(1)
  await expect(page.locator('[data-testid="profile-export-svg"]')).toBeVisible()

  // The section line and the two pins are the only thing that changed — the
  // terrain itself is untouched, since a profile samples but does not rebuild.
  const withSection = await page.screenshot(PLATE)
  expect(Buffer.compare(before, withSection),
    'taking a profile must draw something on the terrain').not.toBe(0)

  // Closing the chart is what says "done with this section", so the scene has to
  // come back exactly as it was — a leftover line would follow you into an export.
  await page.locator('[data-testid="profile-export-svg"]').locator('xpath=following-sibling::button').click()
  // Polled rather than waited on: leaving profile mode flips needsSurfaceShading,
  // so the worker rebuilds and the frame that settles is a moment behind the click.
  await expect.poll(
    async () => Buffer.compare(before, await page.screenshot(PLATE)),
    { timeout: 15_000, message: 'closing the chart must clear the section' },
  ).toBe(0)

  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
})

test('the profile exports as a standalone SVG', async ({ page }) => {
  await openApp(page)
  await takeProfile(page)

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.locator('[data-testid="profile-export-svg"]').click(),
  ])
  expect(download.suggestedFilename()).toMatch(/-profile\.svg$/)

  const svg = await download.createReadStream().then((s) => new Promise((res, rej) => {
    const chunks = []
    s.on('data', (c) => chunks.push(c))
    s.on('end', () => res(Buffer.concat(chunks).toString('utf-8')))
    s.on('error', rej)
  }))

  // Standalone: a namespace so it opens as a file rather than only inline, and
  // its own background so it does not composite onto whatever is behind it.
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  expect(svg).toMatch(/<rect[^>]+fill="#ffffff"/)
  // The section itself, at full sampling — a chart with three points would still
  // match a looser "has a path" check.
  const path = svg.match(/<path d="(M[^"]+)"/)
  expect(path, 'the profile line must be in the file').toBeTruthy()
  expect((path[1].match(/L/g) || []).length).toBeGreaterThan(150)
  // Both ends labelled, in the colours the pins wear on the terrain.
  expect(svg).toContain('>A</text>')
  expect(svg).toContain('>B</text>')
  expect(svg).toContain('#22c55e')
  expect(svg).toContain('#ef4444')
})
