/**
 * The anaglyph, on screen and on the page.
 *
 * It is a modifier rather than a mode, so there is no geometry of its own to
 * check — what there is instead is a claim: that the same drawing comes out
 * twice, in two filter inks, offset by an eye separation that is real parallax
 * rather than a rigid shift.
 *
 * The viewport half is cheap and the SVG half is not: the projection, the
 * software Z-buffer, the occlusion walk and the paper clip all depend on where
 * the camera is, so a stereo pair has to be two complete passes. These tests are
 * mostly about that second half, because it is the half that can be wired to
 * nothing and still look plausible on screen.
 */
import { test, expect } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { resetToDefaults, waitForApp } from './helpers.js'

const OUT = path.join(process.cwd(), 'test-results')
test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

async function openAnaglyph(page) {
  const section = page.locator('[data-testid="section-anaglyph"]')
  await section.scrollIntoViewIfNeeded()
  if ((await section.getAttribute('aria-expanded')) !== 'true') {
    await section.click()
    await page.waitForTimeout(300)
  }
}

/**
 * How many pixels lean warm and how many lean cool.
 *
 * Counted rather than averaged: the two filters multiply on white paper, so
 * wherever the eyes overlap the result is dark and belongs to neither. What is
 * left is each eye's own fringe, and both have to be there in quantity.
 */
const splitInk = (page) => page.locator('canvas').first().evaluate((c) => {
  const gl = c.getContext('webgl2', { preserveDrawingBuffer: true })
    || c.getContext('webgl', { preserveDrawingBuffer: true })
  const w = c.width, h = c.height
  const px = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
  let warm = 0, cool = 0
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue
    const r = px[i], b = px[i + 2]
    if (r - b > 40) warm++
    if (b - r > 40) cool++
  }
  return { warm, cool }
})

test('the viewport draws both eyes, in both filter colours', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  // The baseline is not zero — the opening plate carries a hypsometric ramp, so
  // there is some warm ink on it already. What there is none of is *cyan*, and
  // what the anaglyph does to both is not subtle.
  const plain = await splitInk(page)

  await openAnaglyph(page)
  await page.locator('[data-testid="anaglyph-on"]').click()
  await page.waitForTimeout(3000)

  const stereo = await splitInk(page)
  // Both eyes, in quantity. Not a ratio between them: the two multiply where
  // they overlap, so on a dense line field the split depends on how much of each
  // eye the other happens to cover, which is a fact about the drawing rather
  // than about the feature.
  expect(stereo.warm).toBeGreaterThan(Math.max(2000, plain.warm * 3))
  expect(stereo.cool).toBeGreaterThan(Math.max(2000, plain.cool * 3))
  expect(stereo.cool).toBeGreaterThan(plain.cool + 2000)
})

test('the SVG carries two eyes as two pen layers', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openAnaglyph(page)
  await page.locator('[data-testid="anaglyph-on"]').click()
  await page.waitForTimeout(2500)

  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.locator('#hm-panel-body').evaluate((el) => { el.scrollTop = 0 })
  const wait = page.waitForEvent('download', { timeout: 180_000 })
  await page.keyboard.press('Digit1')
  const file = path.join(OUT, 'anaglyph.svg')
  writeFileSync(file, readFileSync(await (await wait).path()))
  const svg = readFileSync(file, 'utf8')

  // One document, not two stapled together.
  expect((svg.match(/<svg\b/g) ?? []).length).toBe(1)

  // Two outer layers, so the plot is two pen changes rather than sixty-six
  // interleaved ones. This is what "native to a two-pen plotter" means.
  expect(svg).toContain('inkscape:label="Anaglyph · left"')
  expect(svg).toContain('inkscape:label="Anaglyph · right"')

  // Each eye in one filter ink, with the per-vertex ramp short-circuited — a
  // ramp under an anaglyph is a colour only one eye would ever see.
  const inks = new Set([...svg.matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase()))
  expect(inks.size).toBeLessThanOrEqual(2)

  // And the two eyes are genuinely different drawings. Equal geometry would mean
  // the offset never reached the projection and the file is a doubled copy.
  const left = svg.slice(svg.indexOf('anaglyph-left'), svg.indexOf('anaglyph-right'))
  const right = svg.slice(svg.indexOf('anaglyph-right'))
  const firstX = (s) => /x1="(-?[\d.]+)"/.exec(s)?.[1]
  expect(firstX(left)).toBeDefined()
  expect(firstX(left)).not.toBe(firstX(right))
})

test('the panel says when the camera cannot give it depth', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openAnaglyph(page)
  await page.locator('[data-testid="anaglyph-on"]').click()
  await page.waitForTimeout(800)

  const note = page.locator('[data-testid="anaglyph-note"]')
  await expect(note).toContainText('perspective camera')

  // The depth is the perspective divide: a near mark shifts further across the
  // screen than a far one. An orthographic camera shifts them equally, which is
  // a double image with no depth in it — so the panel says so rather than
  // leaving somebody wondering why the glasses do nothing.
  const camera = page.locator('[data-testid="section-camera"]')
  await camera.scrollIntoViewIfNeeded()
  if ((await camera.getAttribute('aria-expanded')) !== 'true') {
    await camera.click()
    await page.waitForTimeout(300)
  }
  await page.locator('input[type=checkbox][aria-label="Orthographic"]').click()
  await page.waitForTimeout(1200)
  await openAnaglyph(page)
  await expect(note).toContainText('Orthographic — no depth')
})
