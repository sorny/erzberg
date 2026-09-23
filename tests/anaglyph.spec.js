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
import { openStage, resetToDefaults, waitForApp } from './helpers.js'

const OUT = path.join(process.cwd(), 'test-results')
test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

async function openAnaglyph(page) {
  await openStage(page, 'frame')
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

test('the filters change how they combine when the ground goes dark', async ({ page }) => {
  /*
   * Multiply can only darken, which is right on paper and wrong on black: there
   * is nothing left to darken, so every mark goes to the ground and the plate
   * comes out empty. Forcing multiply here drops the ink pixel count from ~40k
   * to *zero*. Additive is the same relationship the other way up.
   *
   * The assertion is that the overlap flips: on paper, where the eyes cross is
   * *darker* than either; on a dark ground it is *lighter*.
   */
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openAnaglyph(page)
  await page.locator('[data-testid="anaglyph-on"]').click()
  await page.waitForTimeout(2500)

  const note = page.locator('[data-testid="anaglyph-note"]')
  await expect(note).toContainText('the filters multiply')

  /*
   * The darkest and lightest *ink* on the plate, with the ground excluded.
   *
   * Counting dark pixels outright would only measure the background: on black
   * almost everything is dark whatever the filters do. What separates the two
   * blends is where the crossings land — the two inks alone sit at luma 99 and
   * 170, so anything below 60 or above 200 can only be an overlap.
   */
  const inkRange = (bgLuma) => page.locator('canvas').first().evaluate((c, bg) => {
    const gl = c.getContext('webgl2', { preserveDrawingBuffer: true })
      || c.getContext('webgl', { preserveDrawingBuffer: true })
    const w = c.width, h = c.height
    const px = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    let min = 255, max = 0, n = 0
    // The middle of the plate only. The orientation gizmo renders into this same
    // canvas in the bottom-left corner, in bright unblended primaries — sampling
    // the whole frame reads *it* as the brightest thing present and reports 248
    // whatever the filters did.
    const x0 = Math.floor(w * 0.25), x1 = Math.floor(w * 0.75)
    const y0 = Math.floor(h * 0.25), y1 = Math.floor(h * 0.75)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4
        if (px[i + 3] < 8) continue
        const l = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114
        if (Math.abs(l - bg) < 20) continue        // the ground, not a mark
        if (l < min) min = l
        if (l > max) max = l
        n++
      }
    }
    return { min, max, n }
  }, bgLuma)
  const onPaper = await inkRange(255)

  // Now a black ground. Terrain Style owns the background colour, in Surface.
  // The write below goes straight at the DOM and would reach a hidden input —
  // but the rule is the same for every spec, and a control reached in a pane
  // nobody selected is one panel change away from being reached by nothing.
  await openStage(page, 'surface')
  await page.evaluate(() => {
    const el = document.querySelector('input.hmc[aria-label="Background"]')
      || [...document.querySelectorAll('input[type=color]')].find((i) => i.value === '#ffffff')
    if (el) {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(el, '#000000')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
  await page.waitForTimeout(2500)

  await expect(note).toContainText('the filters add')
  const onBlack = await inkRange(0)

  expect(onPaper.n).toBeGreaterThan(1000)
  expect(onBlack.n).toBeGreaterThan(1000)

  /*
   * The inversion, in three comparisons.
   *
   * The two filters alone sit at luma 99 and 170, so anything outside that band
   * is an overlap — and each ground can only produce one side of it.
   *
   * On paper, antialiasing runs from the white ground *down* to the ink, so it
   * can never reach 60. A reading below that is multiply darkening past both
   * filters. On black it runs *up* to the ink, so it can never reach 250, and a
   * reading above that is additive stacking them to white.
   *
   * The mirrored pair — nothing light on paper, nothing dark on black — is not
   * assertable for exactly that reason: both are the antialiasing ramp, at 235
   * and 26, and neither says anything about the blend.
   */
  expect(onPaper.min).toBeLessThan(60)
  expect(onBlack.max).toBeGreaterThan(250)
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
  await openStage(page, 'frame')
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
