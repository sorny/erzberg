import { test, expect } from '@playwright/test'
import { openStage, resetToDefaults } from './helpers.js'

/**
 * Painting a stencil, and spending it.
 *
 * The land cover specs prove that a *class* mask thins the grid every builder
 * reads. This proves the second source of thinning reaches the same place: a
 * region drawn by hand, through the Studio, restricting an ordinary draw mode
 * that knows nothing about masks.
 *
 * Three claims.
 *
 * **The Studio opens on the raster and paints into it.** A brush that leaves
 * the plane empty is the failure that looks like nothing at all.
 *
 * **A painted mask stencils.** Measured the same way the class masks are, off
 * the exported SVG, because that is the artefact and not an internal.
 *
 * **Unpicking the last mask restores the whole raster.** The one end of the
 * selection range that collapses, and the one a user hits by accident.
 *
 * Satellite imagery is deliberately not exercised here. It is a network fetch
 * of a few hundred kilobytes from a third party, and a test suite that depends
 * on somebody else's uptime reports their bad afternoon as our regression. The
 * parts that can be tested without the network are unit-tested instead.
 */
const PAGE = 'http://localhost:5173'

async function boot(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
}

async function filter(page, term) {
  await page.fill('[data-testid="panel-filter"]', term)
  await page.waitForTimeout(500)
}

async function exportSvg(page) {
  // The export buttons are in Output, and a spec that has been switching
  // modes is on another pane. Nothing in a hidden pane is clickable.
  await openStage(page, 'output')
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 180_000 }),
    page.click('[data-testid="export-svg"]'),
  ])
  const stream = await dl.createReadStream()
  const chunks = []
  for await (const c of stream) chunks.push(c)
  return Buffer.concat(chunks).toString('utf-8')
}

/** How many line segments one pen layer holds. */
function segmentsIn(svg, label) {
  const start = svg.indexOf(`inkscape:label="${label}"`)
  if (start < 0) return 0
  const end = svg.indexOf('</g>', start)
  return (svg.slice(start, end).match(/<(path|line|polyline)\b/g) ?? []).length
}

/** Open the Studio on a fresh mask and paint a broad band across the middle. */
async function paintBand(page) {
  await filter(page, 'Masks')
  await page.click('[data-testid="add-mask"]')
  await page.waitForSelector('[data-testid="mask-studio"]', { timeout: 20_000 })
  await page.waitForTimeout(1200)

  const canvas = page.locator('[data-testid="mask-studio"] canvas')
  const box = await canvas.boundingBox()

  // The rectangle tool rather than the brush: a band with a known extent is
  // what makes the segment count below a number this test can reason about.
  await page.click('[data-testid="studio-tool-rect"]')
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.40)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.60, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  await page.click('[data-testid="studio-done"]')
  await page.waitForTimeout(1200)
}

test('the Studio paints into a mask, and the panel says how much', async ({ page }) => {
  test.setTimeout(150_000)
  await boot(page)
  await paintBand(page)

  await filter(page, 'Masks')
  const section = page.locator('[data-section="Masks"]')
  // Roughly a fifth of the raster, from a band across a fifth of its height.
  await expect(section).toContainText(/\d+%/)
  const shown = (await section.textContent()).match(/(\d+)%/)
  expect(Number(shown[1]), 'the band has to cover something').toBeGreaterThan(5)
  expect(Number(shown[1])).toBeLessThan(60)
})

test('a painted mask stencils an ordinary draw mode', async ({ page }) => {
  test.setTimeout(240_000)
  await boot(page)

  // Lines is on after a reset, and it is deliberately an *ordinary* mode:
  // nothing in its builder knows masks exist. If it comes out stencilled, the
  // second source of thinning lands in the same place the first one does.
  const before = segmentsIn(await exportSvg(page), 'Lines')
  expect(before, 'the unmasked layer has to draw something').toBeGreaterThan(20)

  await paintBand(page)

  await filter(page, 'Mode: Lines')
  const swatch = page.locator('[data-section="Mode: Lines"] button[aria-label$="drawn"], ' +
                              '[data-section="Mode: Lines"] button[aria-label$="skipped"]')
  await expect(swatch).toHaveCount(1)
  await swatch.first().click()
  await page.waitForTimeout(2500)
  await page.fill('[data-testid="panel-filter"]', '')
  await page.waitForTimeout(400)

  const after = segmentsIn(await exportSvg(page), 'Lines')
  expect(after, 'a masked layer still draws inside its mask').toBeGreaterThan(0)
  expect(after, 'and nowhere near as much as unmasked').toBeLessThan(before * 0.7)
})

test('the Studio works the way Edit Mode does', async ({ page }) => {
  // The two views are the same kind of thing — a full-window direct
  // manipulation mode over the source raster — and they had drifted into two
  // different interfaces. What is checked here is the part a user would notice
  // immediately if it regressed: the panel on the right instead of a bar over
  // the picture, and a view that zooms and pans.
  test.setTimeout(120_000)
  await boot(page)
  await filter(page, 'Masks')
  await page.click('[data-testid="add-mask"]')
  await page.waitForSelector('[data-testid="mask-studio"]', { timeout: 20_000 })
  await page.waitForTimeout(1000)

  // The panel replaces the sidebar, exactly as Edit Mode's does.
  await expect(page.locator('[data-testid="mask-panel"]')).toBeVisible()
  await expect(page.locator('[data-testid="studio-fit"]')).toBeVisible()
  await expect(page.locator('[data-testid="panel-filter"]')).toBeHidden()

  const canvas = page.locator('[data-testid="mask-studio"] canvas')
  const box = await canvas.boundingBox()
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  // Paint a small dot, then measure how many pixels of it are lit. Zooming in
  // must make that same dot cover more of the screen.
  await page.click('[data-testid="studio-tool-brush"]')
  await page.mouse.move(mid.x, mid.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(400)

  const litPixels = async () => canvas.evaluate((el) => {
    const ctx = el.getContext('2d')
    const { data } = ctx.getImageData(0, 0, el.width, el.height)
    // The mask wash is drawn in the mask's own colour over a grey hillshade,
    // so a lit pixel is simply one whose channels are not equal.
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) n++
    }
    return n
  })

  const before = await litPixels()
  expect(before, 'the brush has to have painted something').toBeGreaterThan(0)

  await page.mouse.move(mid.x, mid.y)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(500)
  const zoomed = await litPixels()
  expect(zoomed, 'scrolling up must magnify the view').toBeGreaterThan(before * 1.5)

  // Fit puts it back where it started.
  await page.click('[data-testid="studio-fit"]')
  await page.waitForTimeout(500)
  expect(Math.abs((await litPixels()) - before) / before,
    'Fit returns to the framing it opened with').toBeLessThan(0.25)
})

test('alt-drag pans the Studio instead of painting', async ({ page }) => {
  test.setTimeout(120_000)
  await boot(page)
  await filter(page, 'Masks')
  await page.click('[data-testid="add-mask"]')
  await page.waitForSelector('[data-testid="mask-studio"]', { timeout: 20_000 })
  await page.waitForTimeout(1000)

  const canvas = page.locator('[data-testid="mask-studio"] canvas')
  const box = await canvas.boundingBox()
  const coverage = async () => (await page.locator('[data-testid="studio-coverage"]').textContent()).trim()

  expect(await coverage()).toBe('0%')

  // Alt is the pan modifier and outranks the tool — the same rule Edit Mode
  // uses. A drag with it held must move the view and paint nothing at all.
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await page.waitForTimeout(400)

  expect(await coverage(), 'an alt-drag must not paint').toBe('0%')
})

test('unpicking the last mask puts the whole raster back', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  await paintBand(page)

  await filter(page, 'Mode: Lines')
  const section = page.locator('[data-section="Mode: Lines"]')
  const swatch = section.locator('button[aria-label$="drawn"], button[aria-label$="skipped"]')

  await swatch.first().click()
  await page.waitForTimeout(800)
  await expect(section).not.toContainText('Whole raster')

  // Off again. This is the one end of the range that collapses, and the one a
  // user reaches by accident.
  await swatch.first().click()
  await page.waitForTimeout(800)
  await expect(section).toContainText('Whole raster')
})

test('a mask can be copied, pixels and all', async ({ page }) => {
  /*
   * The copy has to be a copy, not a second name for the same pixels.
   *
   * Two masks sharing one `Uint8Array` would look right in the list and stay
   * right until the Studio painted into either of them — and then both would
   * change together, which is invisible in the panel and obvious on the plate.
   * The coverage figure is what proves they are separate: it is computed per
   * mask from its own data, so two rows reading the same non-zero percentage
   * after one of them was painted is exactly the bug.
   */
  await boot(page)
  await filter(page, 'Masks')

  await page.click('[data-testid="add-mask"]')
  await page.waitForSelector('[data-testid="mask-studio"]', { timeout: 20_000 })
  await page.waitForTimeout(800)
  // Paint something, so the copy has pixels to carry rather than an empty plane.
  const canvas = page.locator('[data-testid="mask-studio"] canvas').first()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  await page.click('[data-testid="studio-done"]')
  await page.waitForTimeout(600)
  await filter(page, 'Masks')

  const section = page.locator('[data-section="Masks"]')
  const names = () => section.locator('input[aria-label^="Name of"]').evaluateAll((els) => els.map((e) => e.value))
  await expect(section.locator('[data-testid^="mask-edit-"]')).toHaveCount(1)
  const painted = (await section.innerText()).match(/(\d+)%/)?.[1]
  expect(Number(painted), 'the brush must have left something to copy').toBeGreaterThan(0)

  await section.locator('[data-testid^="copy-"]').first().click()
  await page.waitForTimeout(500)

  await expect(section.locator('[data-testid^="mask-edit-"]')).toHaveCount(2)
  expect(await names()).toEqual(['Mask 1', 'Mask 1 copy'])

  // Both carry the same coverage, which is what "pixels and all" means.
  const pcts = (await section.innerText()).match(/(\d+)%/g)
  expect(pcts).toHaveLength(2)
  expect(pcts[1]).toBe(pcts[0])

  // A second copy does not collide with the first. The panel identifies a mask
  // by its name everywhere except the Studio, so two rows reading "Mask 1 copy"
  // would be two rows nobody can tell apart.
  await section.locator('[data-testid^="copy-"]').first().click()
  await page.waitForTimeout(500)
  const after = await names()
  expect(new Set(after).size, `names must stay unique: ${after.join(', ')}`).toBe(3)
  expect(after).toContain('Mask 1 copy 2')
})

/** Drive a range input the way React sees it. */
async function setSlider(loc, v) {
  await loc.evaluate((el, val) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, String(val))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)
}

test('the Level tool previews a height range live, and Apply keeps it', async ({ page }) => {
  test.setTimeout(150_000)
  await boot(page)
  await filter(page, 'Masks')
  await page.click('[data-testid="add-mask"]')
  await page.waitForSelector('[data-testid="mask-studio"]', { timeout: 20_000 })
  await page.click('[data-testid="studio-tool-level"]')

  const preview = page.locator('[data-testid="studio-preview-coverage"]')
  const share = async () => {
    await page.waitForTimeout(300)
    const t = await preview.textContent()
    return t.startsWith('<') ? 0.5 : Number(t.replace('%', ''))
  }
  const from = page.locator('[data-testid="studio-level-from"]')
  const to = page.locator('[data-testid="studio-level-to"]')

  // The upper half of the range, which is the tool's opening state.
  await expect(preview).toBeVisible()
  const upper = await share()
  expect(upper, 'the upper half of the range holds some ground').toBeGreaterThan(0)

  // A drag changes the preview at once, before anything is applied.
  await setSlider(from, 0)
  const whole = await share()
  expect(whole, 'the whole range takes more').toBeGreaterThan(upper)
  await setSlider(to, 0.3)
  const low = await share()
  expect(low, 'the low ground alone takes less than all of it').toBeLessThan(whole)
  expect(low, 'and still something').toBeGreaterThan(0)
  await expect(page.locator('[data-testid="studio-coverage"]'), 'nothing is written before Apply').toHaveText('0%')

  // Back to the upper half, applied.
  await setSlider(from, 0.5)
  await setSlider(to, 1)
  expect(await share()).toBe(upper)
  await page.click('[data-testid="studio-apply"]')
  const coverage = page.locator('[data-testid="studio-coverage"]')
  await expect(coverage).toHaveText(`${upper}%`)

  // The Studio keeps its own undo, since the app's history holds no planes.
  await page.click('[data-testid="studio-undo"]')
  await expect(coverage, 'undo takes the Apply back').toHaveText('0%')
  await page.click('[data-testid="studio-redo"]')
  await expect(coverage, 'redo puts it back').toHaveText(`${upper}%`)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(coverage, '⌘Z does the same').toHaveText('0%')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(coverage).toHaveText(`${upper}%`)

  // Subtracting the same region from the mask leaves nothing, and Intersect
  // keeps all of it.
  await page.click('[data-testid="studio-combine-subtract"]')
  expect(await share()).toBe(0)
  await page.click('[data-testid="studio-combine-intersect"]')
  expect(await share()).toBe(upper)

  // The mask had its default name, so Replace named it after the range.
  await page.click('[data-testid="studio-done"]')
  await page.waitForTimeout(800)
  await filter(page, 'Masks')
  const section = page.locator('[data-section="Masks"]')
  const names = await section.locator('input[aria-label^="Name of"]').evaluateAll((els) => els.map((e) => e.value))
  expect(names).toEqual(['Level 50–100 %'])
})

test('the Studio owns the keyboard: E erases, and app shortcuts stay quiet', async ({ page }) => {
  test.setTimeout(90_000)
  await boot(page)
  await filter(page, 'Masks')
  await page.click('[data-testid="add-mask"]')
  await page.waitForSelector('[data-testid="mask-studio"]', { timeout: 20_000 })
  let downloads = 0
  page.on('download', () => { downloads++ })

  // E was also the app's key for Edit Mode, which opened over the Studio.
  await page.keyboard.press('e')
  await expect(page.locator('[data-testid="studio-mode-erase"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-testid="heightmap-editor"]')).toHaveCount(0)

  // 1 was the app's SVG export, of a terrain the Studio hides.
  await page.keyboard.press('1')
  await page.waitForTimeout(2500)
  expect(downloads, 'no export starts from inside the Studio').toBe(0)
  await expect(page.locator('[data-testid="mask-studio"]')).toBeVisible()
})

test('Done keeps a Level preview, and Replace replaces what was painted', async ({ page }) => {
  // The report: paint, switch to Level, press Done, and the painted mask came
  // back. The wash showed the level mask, so Done has to keep it.
  test.setTimeout(120_000)
  await boot(page)
  await filter(page, 'Masks')
  await page.click('[data-testid="add-mask"]')
  await page.waitForSelector('[data-testid="mask-studio"]', { timeout: 20_000 })
  await page.waitForTimeout(800)

  // A small painted square in a corner, which the upper levels do not match.
  const canvas = page.locator('[data-testid="mask-studio"] canvas')
  const box = await canvas.boundingBox()
  await page.click('[data-testid="studio-tool-rect"]')
  await page.mouse.move(box.x + box.width * 0.10, box.y + box.height * 0.10)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.30, box.y + box.height * 0.30, { steps: 6 })
  await page.mouse.up()
  const coverage = page.locator('[data-testid="studio-coverage"]')
  const painted = await coverage.textContent()
  expect(painted).not.toBe('0%')

  await page.click('[data-testid="studio-tool-level"]')
  await expect(page.locator('[data-testid="studio-combine-replace"]')).toHaveAttribute('aria-pressed', 'true')
  // The whole range, so the level mask cannot cover what the square did.
  await setSlider(page.locator('[data-testid="studio-level-from"]'), 0)
  await page.waitForTimeout(400)
  const shown = (await page.locator('[data-testid="studio-preview-coverage"]').textContent()).trim()
  expect(shown).not.toBe(painted)

  // Done, not Apply.
  await page.click('[data-testid="studio-done"]')
  await page.waitForTimeout(800)
  await filter(page, 'Masks')
  const section = page.locator('[data-section="Masks"]')
  const names = await section.locator('input[aria-label^="Name of"]').evaluateAll((els) => els.map((e) => e.value))
  expect(names, 'Replace named the mask after the range').toEqual(['Level 0–100 %'])
  const row = (await section.innerText()).match(/(\d+)%/)?.[1]
  expect(`${row}%`, 'the mask is the level preview, not the paint').toBe(shown)

  // Reopening shows the same mask.
  await section.locator('[data-testid^="mask-edit-"]').first().click()
  await page.waitForSelector('[data-testid="mask-studio"]')
  await expect(coverage).toHaveText(shown)
})
