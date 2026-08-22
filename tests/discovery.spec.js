import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { resetToDefaults } from './helpers.js'

/**
 * Play & discovery — preset thumbnails and the randomiser.
 *
 * The state these features move is otherwise invisible from the outside, so the
 * assertions lean on two readable proxies: the Background colour input (which
 * mirrors `style.bgColor` exactly) and the `Grid:` readout (which only updates
 * when the geometry actually rebuilt).
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const PRESETS_DIR = path.resolve(here, '../public/presets')

async function boot(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  await page.waitForSelector('text=Grid:', { timeout: 30000 })
  await resetToDefaults(page)
}

async function openPresets(page) {
  // Idempotent: the section ships open, and clicking it unconditionally used to
  // close it — leaving every tile inside a zero-height row and unclickable.
  const header = page.locator('[data-testid="section-presets"]')
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await page.waitForTimeout(300)
}

const bgColor = (page) => page.locator('[data-testid="bg-color"]').inputValue()

/**
 * Every slider and colour well in the panel, as one string.
 *
 * A roll changes an arbitrary subset of ~250 parameters, so no single control is
 * a reliable witness — the background alone is not, because `#ffffff` is in the
 * randomiser's own paper palette and a roll may legitimately land on it.
 */
const signature = (page) =>
  page.$$eval('input[type=range], input[type=color]', (els) => els.map((e) => e.value).join('|'))

test('every preset in the manifest has a thumbnail', () => {
  const manifest = JSON.parse(readFileSync(path.join(PRESETS_DIR, 'manifest.json'), 'utf8'))
  const missing = manifest
    .map((f) => f.replace('.json', ''))
    .filter((name) => !existsSync(path.join(PRESETS_DIR, 'thumbs', `${name}.webp`)))
  expect(missing, `run \`npm run thumbs\` — missing: ${missing.join(', ')}`).toEqual([])
})

test('preset tiles show their thumbnail and still apply', async ({ page }) => {
  await boot(page)
  await openPresets(page)

  const tile = page.locator('[data-testid="preset-Neon City"]')
  await expect(tile.locator('img')).toBeVisible()
  // A thumbnail that 404s would leave a zero-height broken image.
  expect(await tile.locator('img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)

  await tile.click()
  await page.waitForTimeout(1200)
  expect(await bgColor(page)).not.toBe('#ffffff')
})

test('Surprise me rolls a look, and the arrow walks back', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await boot(page)
  await openPresets(page)

  const before = await signature(page)
  await page.locator('[data-testid="surprise-me"]').click()
  await expect(page.locator('[data-testid="roll-seed"]')).toBeVisible()
  await page.waitForTimeout(1500)
  const first = await signature(page)
  const firstSeed = await page.locator('[data-testid="roll-seed"]').innerText()
  expect(first).not.toBe(before)              // a roll actually rolls

  await page.locator('[data-testid="surprise-me"]').click()
  await page.waitForTimeout(1500)
  const secondSeed = await page.locator('[data-testid="roll-seed"]').innerText()
  expect(secondSeed).not.toBe(firstSeed)
  expect(await signature(page)).not.toBe(first)

  // ↩ restores the previous roll exactly — the seed is the look, so the history
  // is a list of integers rather than a stack of snapshots.
  await page.locator('[data-testid="surprise-back"]').click()
  await page.waitForTimeout(1500)
  expect(await page.locator('[data-testid="roll-seed"]').innerText()).toBe(firstSeed)
  expect(await signature(page)).toBe(first)

  expect(errors).toEqual([])
})

test('a roll describes the whole look, not just the parts it changed', async ({ page }) => {
  await boot(page)
  const r = await page.evaluate(async () => {
    const { randomPreset } = await import('/src/utils/presetGenetics.js')
    const { POINTS_DEF, STYLE_DEF } = await import('/src/defaults.js')
    // applyPreset merges over the previous state, so any key a roll omits is
    // inherited from the roll before it — and the seed stops being the look.
    let missingPoints = [], missingStyle = []
    for (let s = 1; s <= 60; s++) {
      const p = randomPreset(s)
      for (const k of Object.keys(POINTS_DEF)) {
        if (!(k in p.points) && !missingPoints.includes(k)) missingPoints.push(k)
      }
      for (const k of Object.keys(STYLE_DEF)) {
        if (!(k in p.style) && !missingStyle.includes(k)) missingStyle.push(k)
      }
    }
    return { missingPoints, missingStyle }
  })
  expect(r.missingPoints, 'every roll must fully specify the particle field').toEqual([])
  expect(r.missingStyle, 'and the style').toEqual([])
})

test('a roll is reproducible and always leaves something visible', async ({ page }) => {
  await boot(page)

  const r = await page.evaluate(async () => {
    const { randomPreset } = await import('/src/utils/presetGenetics.js')
    const { DRAW_MODES } = await import('/src/utils/drawModes.js')
    const lum = (h) => {
      const n = parseInt(String(h).slice(1), 16)
      return 0.2126 * ((n >> 16 & 255) / 255) + 0.7152 * ((n >> 8 & 255) / 255) + 0.0722 * ((n & 255) / 255)
    }
    let blank = 0, invisible = 0, maxCost = 0
    for (let s = 1; s <= 200; s++) {
      const p = randomPreset(s)
      const on = DRAW_MODES.filter((m) => p.style['enabled' + m.id])
      maxCost = Math.max(maxCost, on.reduce((t, m) => t + m.cost, 0))
      if (!on.length && !p.style.showFill && !p.points.showPoints) blank++
      const bg = lum(p.style.bgColor)
      for (const m of on) {
        if (p.style['hypso' + m.id]) continue
        if (Math.abs(lum(p.style['color' + m.id]) - bg) < 0.18) invisible++
      }
    }
    return {
      same: JSON.stringify(randomPreset(4242)) === JSON.stringify(randomPreset(4242)),
      differs: JSON.stringify(randomPreset(4242)) !== JSON.stringify(randomPreset(4243)),
      blank, invisible, maxCost,
    }
  })

  expect(r.same).toBe(true)       // the seed *is* the look
  expect(r.differs).toBe(true)
  expect(r.blank).toBe(0)         // never hand back an empty canvas
  expect(r.invisible).toBe(0)     // never ink that matches its own background
  expect(r.maxCost).toBeLessThanOrEqual(9)   // never stack every expensive mode
})

test('the app opens on a style, not on bare defaults', async ({ page }) => {
  /*
   * The one place the shipped opening state is asserted.
   *
   * Every other spec calls resetToDefaults() so its precondition is stated
   * rather than inherited — which is right, and would otherwise leave nothing at
   * all covering what a first-time visitor actually meets.
   */
  await page.goto('http://localhost:5173')
  await page.waitForSelector('[data-testid="section-presets"]', { timeout: 30000 })
  await page.waitForTimeout(4000)

  // The panel names the look, and the tile for it is the selected one.
  await expect(page.locator('[data-testid="jump-to-presets"]')).toHaveText('Alpine Survey')
  await expect(page.locator('[data-testid="preset-edited"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="section-presets"]'))
    .toHaveAttribute('aria-expanded', 'true')

  // And it is an opening state, not a new baseline: Reset all still goes to the
  // defaults, which carry no preset at all.
  await resetToDefaults(page)
  await expect(page.locator('[data-testid="jump-to-presets"]')).toHaveCount(0)
})
