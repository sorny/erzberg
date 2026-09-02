import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * What the three blocking colour modes put in an SVG.
 *
 * Indexed, Mineral and Watershed paint areas rather than draw marks, and until
 * now they left as unordered boundary edges. That is enough to look at and
 * nothing to plot: Inkscape had no closed shape to select, so its hatch-fill
 * tools had nothing to work on, and the one flat pen layer mixed every colour
 * together.
 *
 * Three claims are pinned here, and each of them is a way the export was wrong.
 *
 * The file must hold closed filled paths, not lines. Each ink must get its own
 * pen layer, because a plot is sorted by pen. And two areas that carry the same
 * ink must arrive as one shape: Watershed deals ten colours to hundreds of
 * catchments, so keyed by catchment the reference plate traced 31 189 shapes
 * with shared seams and doubled strokes, against the ten flat areas on screen.
 */
const PAGE = 'http://localhost:5173'

/** Isolate one section with the panel filter, then set the one switch in it. */
async function setSwitch(page, term, label, on) {
  await page.fill('[data-testid="panel-filter"]', term)
  await page.waitForTimeout(450)
  await page.locator(`input[type=checkbox][aria-label="${label}"]:visible`).first()
    .evaluate((el, want) => { if (el.checked !== want) el.click() }, on)
  await page.waitForTimeout(350)
  await page.fill('[data-testid="panel-filter"]', '')
  await page.waitForTimeout(250)
}

async function boot(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  // A tilt, so the depth buffer has something to hide.
  await page.locator('input[type="range"][min="0"][max="180"][step="0.1"]').first()
    .evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(el, '55'); el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  // Lines is on by default and would put its own pen layer in every file here.
  await setSwitch(page, 'Mode: Lines', 'Enabled', false)
}

async function exportSvg(page) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 180_000 }),
    page.click('[data-testid="export-svg"]'),
  ])
  const stream = await dl.createReadStream()
  const chunks = []
  for await (const c of stream) chunks.push(c)
  return Buffer.concat(chunks).toString('utf-8')
}

const labelsOf = (svg) => [...svg.matchAll(/inkscape:label="([^"]+)"/g)].map((m) => m[1])

for (const [term, label, expectInks] of [
  ['Mode: Watershed', 'Watershed', 10],
  ['Mode: Indexed', 'Indexed', 6],
  ['Mode: Mineral', 'Mineral', 5],
]) {
  test(`${label} exports one filled layer per ink`, async ({ page }) => {
    await boot(page)
    await setSwitch(page, term, 'Enabled', true)
    await page.waitForTimeout(3500)
    const svg = await exportSvg(page)

    const mine = labelsOf(svg).filter((l) => l.startsWith(`${label} · ink `))
    expect(mine.length, 'one pen layer per ink').toBe(expectInks)
    // The label carries the hex, because that is what somebody sorting a plot by
    // pen reads. Two layers must never claim the same one.
    const hexes = mine.map((l) => l.slice(-7))
    expect(new Set(hexes).size).toBe(expectInks)
    for (const h of hexes) expect(h).toMatch(/^#[0-9a-f]{6}$/)

    // One shape per ink, and every shape closed. Same-ink areas merged: keyed by
    // region instead, Watershed alone wrote thousands of shapes here.
    const paths = [...svg.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1])
    expect(paths.length).toBe(expectInks)
    for (const d of paths) {
      expect(d.endsWith('Z'), 'a fill has to be a closed path').toBe(true)
      expect(d.startsWith('M')).toBe(true)
    }

    // Even-odd, or a catchment with a lake in it paints over the lake.
    expect(svg).toContain('fill-rule="evenodd"')
    // The traced ring *is* the boundary, so the old line layer would be the same
    // geometry a second time — and a plotter would draw every divide twice.
    expect(labelsOf(svg)).not.toContain(label)
  })
}

test('the paper frame cuts the fills, and closes them along the cut', async ({ page }) => {
  await boot(page)
  await setSwitch(page, 'Mode: Watershed', 'Enabled', true)
  await setSwitch(page, 'Paper frame', 'Paper frame', true)
  await page.waitForTimeout(3500)
  const svg = await exportSvg(page)

  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  expect(vb, 'framed exports set the viewBox to the paper').toBeTruthy()
  const vw = Number(vb[1]), vh = Number(vb[2])

  /*
   * A line can be cut by dropping the part that leaves the paper. A filled area
   * cannot: cutting it edge by edge leaves the shape open and the paint runs out
   * of it, which is why this goes through a polygon clip rather than through the
   * segment clip the lines use. What that has to produce is a shape entirely on
   * the paper.
   */
  const paths = [...svg.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1])
  expect(paths.length).toBeGreaterThan(0)
  const EPS = 0.6   // the coordinates are written to one decimal
  for (const d of paths) {
    for (const m of d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) {
      const x = Number(m[1]), y = Number(m[2])
      expect(x).toBeGreaterThanOrEqual(-EPS)
      expect(y).toBeGreaterThanOrEqual(-EPS)
      expect(x).toBeLessThanOrEqual(vw + EPS)
      expect(y).toBeLessThanOrEqual(vh + EPS)
    }
  }
})

test('switching occlusion off exports whole areas instead of what the camera sees', async ({ page }) => {
  await boot(page)
  await setSwitch(page, 'Mode: Watershed', 'Enabled', true)
  await page.waitForTimeout(3500)

  /*
   * There is no separate control for this, and there should not be: the fills
   * are cut against the same depth buffer the lines are, so the switch that
   * already decides whether terrain hides a line decides whether it hides a
   * fill. Off, every catchment comes out whole — a map rather than a view, which
   * is the file to plot from.
   *
   * The plate is convex from this angle, so the difference is small. What is
   * asserted is the direction, not a size.
   */
  const cut = await exportSvg(page)
  await setSwitch(page, 'Occlusion', 'Occlusion', false)
  await page.waitForTimeout(3500)
  const whole = await exportSvg(page)

  const points = (s) => [...s.matchAll(/<path d="([^"]+)"\/>/g)]
    .reduce((n, m) => n + (m[1].match(/[ML]/g) || []).length, 0)
  expect(points(whole)).toBeGreaterThan(0)
  expect(points(cut)).toBeGreaterThan(0)
  // Nothing hidden means fewer places for a ring to be cut open and closed
  // again along a silhouette.
  expect(points(whole)).toBeLessThan(points(cut))
})
