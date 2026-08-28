import { existsSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * Where the contour levels sit.
 *
 * A contour ladder has to be anchored to something, and the only thing on the
 * page that means anything to a reader is the ground. World elevation does not:
 * it is centred on zero and stretched by the exaggeration slider, so a ladder of
 * round world elevations meets the terrain at an offset with no relation to it —
 * the lowest line an arbitrary fraction of an interval above the floor, moving
 * every time the exaggeration does.
 *
 * These run the builders directly rather than through the canvas: what is being
 * pinned is which levels exist, which is arithmetic, and reading it off pixels
 * would only make the failure harder to read.
 */
const PAGE = 'http://localhost:5173'

/** A cone spanning the full brightness range, plus a page with the app on it. */
async function ready(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
}

test('the ladder is anchored to the terrain floor, at every interval and exaggeration', async ({ page }) => {
  await ready(page)

  const runs = await page.evaluate(async () => {
    const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
    const { buildTerrain } = await import('/src/utils/terrain.js')
    const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')

    const N = 120
    const px = new Float32Array(N * N)
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const dx = (c - N / 2) / (N / 2), dy = (r - N / 2) / (N / 2)
      px[r * N + c] = Math.max(0, 1 - Math.hypot(dx, dy))
    }
    const mask = new Uint8Array(N * N).fill(1)

    const out = []
    for (const elevScale of [1, 2.5, 3.7]) {
      const base = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale, blurRadius: 0,
                     enabledLines: false, enabledContours: true, labelContours: true }
      const t = buildTerrain(px, mask, N, N, base)
      for (const interval of [2, 4, 7, 10, 25, 30]) {
        const layers = buildLineGeometry(t, { ...base, intervalContours: interval })
        const ys = new Set()
        for (const id of ['Contours-Minor', 'Contours-Major']) {
          const l = layers.find((x) => x.id === id)
          if (l) for (let i = 1; i < l.positions.length; i += 3) ys.add(+l.positions[i].toFixed(4))
        }
        const anchors = layers.find((x) => x.id === 'Contours-Major')?.labelAnchors ?? []
        out.push({
          elevScale, interval, minElev: t.minElev,
          levels: [...ys].sort((a, b) => a - b),
          rels: [...new Set(anchors.map((a) => +a.rel.toFixed(4)))].sort((a, b) => a - b),
        })
      }
    }
    return out
  })

  for (const r of runs) {
    const where = `elevScale ${r.elevScale}, interval ${r.interval}`
    expect(r.levels.length, `${where}: contours must be drawn`).toBeGreaterThan(2)

    // The floor itself carries no line on solid ground — every corner is at or
    // above it — so the first line drawn is one whole interval up, always. Under
    // the old anchoring this was anywhere from 0 to a full interval, and at
    // exaggeration 1 with a 30-unit interval it was 20 units: two thirds of an
    // interval of unlined valley floor.
    const above = r.levels[0] - r.minElev
    expect(above, `${where}: lowest contour is one interval above the floor`)
      .toBeCloseTo(r.interval, 6)

    // And every level from there is a multiple of the interval above the ground,
    // which is what makes the printed numbers the slider's own.
    for (const y of r.levels) {
      const k = (y - r.minElev) / r.interval
      expect(Math.abs(k - Math.round(k)), `${where}: level ${y} is off the ladder`).toBeLessThan(1e-6)
    }

    // The labels say the same thing the geometry does.
    for (const rel of r.rels) {
      const k = rel / r.interval
      expect(Math.abs(k - Math.round(k)), `${where}: label ${rel} is not a multiple`).toBeLessThan(1e-6)
    }
  }
})

test('an inverted terrain still draws contours on its cliffs', async ({ page }) => {
  await ready(page)

  /*
   * The bug this guards. The cell-major scan maps a cell's value range to a
   * range of level indices, and it read the low index off the low value — but a
   * negative exaggeration runs the levels *down* the brightness range, so the
   * two came out crossed for any cell spanning more than one level. Gentle
   * ground drew; cliffs drew nothing, and a full-range scarp drew nothing at all.
   */
  const r = await page.evaluate(async () => {
    const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
    const { buildTerrain } = await import('/src/utils/terrain.js')
    const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')

    const N = 64
    const px = new Float32Array(N * N)
    for (let r2 = 0; r2 < N; r2++) for (let c = 0; c < N; c++) px[r2 * N + c] = c < N / 2 ? 0 : 1
    const mask = new Uint8Array(N * N).fill(1)

    const count = (elevScale) => {
      const base = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale, blurRadius: 0,
                     enabledLines: false, enabledContours: true, intervalContours: 4 }
      const layers = buildLineGeometry(buildTerrain(px, mask, N, N, base), base)
      return ['Contours-Minor', 'Contours-Major'].reduce((n, id) => {
        const l = layers.find((x) => x.id === id)
        return n + (l ? l.positions.length / 6 : 0)
      }, 0)
    }
    return { up: count(1), down: count(-1) }
  })

  expect(r.up, 'the scarp draws upright').toBeGreaterThan(100)
  // Inverted, it is the same scarp read the other way — not necessarily segment
  // for segment, but the same order of drawing, and emphatically not zero.
  expect(r.down, 'the scarp draws inverted').toBeGreaterThan(r.up * 0.5)
})

// ── The interval in metres ────────────────────────────────────────────────────

const GEOTIFF = 'tests/testdata/geotiff.tif'

/** Switches a draw mode's section toggle, by the section's own title. */
async function setMode(page, title, on) {
  const row = page.locator('#hm-panel-body > div').filter({ hasText: new RegExp(`^${title}`) }).first()
  const tog = row.locator('input[type=checkbox]').first()
  await tog.scrollIntoViewIfNeeded()
  if ((await tog.isChecked()) !== on) await tog.click({ force: true })
}

/** Exports an SVG and returns its text. */
async function exportSvg(page) {
  await page.locator('canvas').first().click({ position: { x: 5, y: 5 } })
  const dl = page.waitForEvent('download', { timeout: 120_000 })
  await page.keyboard.press('Digit1')
  let svg = ''
  for await (const c of await (await dl).createReadStream()) svg += c
  return svg
}

test.describe('the interval slider says metres', () => {
  test.skip(!existsSync(GEOTIFF), `${GEOTIFF} not present (gitignored) — see tests/testdata/README.md`)

  /*
   * The slider was labelled "(m)" and passed its number through as world units.
   * A world unit is worth a metre only by coincidence: it is the file's
   * elevation range, clipped by Shadows/Highlights, spread over 100 × the
   * exaggeration. On this raster — 641…2350 m — the two differ by more than a
   * factor of ten.
   *
   * What settles it is not the conversion but the drawing: with the slider at
   * 100 m, the elevations the contours print must be 100 apart, in the file's
   * own metres.
   */
  test('a 100 m interval prints elevations 100 m apart', async ({ page }) => {
    test.setTimeout(240_000)
    await page.goto(PAGE)
    await page.waitForSelector('text=Grid:', { timeout: 30_000 })
    await resetToDefaults(page)

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-testid="load-geotiff"]'),
    ])
    await chooser.setFiles(GEOTIFF)
    await page.waitForFunction(() => /Elevation:\s*\d/.test(document.body.innerText), null, { timeout: 60_000 })

    await setMode(page, 'Mode: Lines', false)
    await page.getByText('Mode: Contours', { exact: true }).click()
    await setMode(page, 'Mode: Contours', true)
    await page.waitForTimeout(1500)

    const slider = page.locator('[data-testid="contour-interval-m"]')
    await expect(slider, 'a GeoTIFF gets the metre slider').toBeVisible()
    await slider.fill('100')
    // Every level lettered, so a gap in the numbers means a missing contour
    // rather than a minor one.
    await page.locator('input[aria-label="Major Every"]').fill('1')
    await page.locator('input[aria-label="Label heights"]').click({ force: true })
    await page.waitForTimeout(4000)

    const svg = await exportSvg(page)
    const nums = [...svg.matchAll(/<text[^>]*>(\d+)<\/text>/g)].map((m) => +m[1])
    const uniq = [...new Set(nums)].sort((a, b) => a - b)
    expect(uniq.length, 'several levels must be lettered').toBeGreaterThan(3)

    // Real elevations off the file, not heights above the lowest ground.
    expect(uniq[0], 'below the raster floor').toBeGreaterThanOrEqual(641)
    expect(uniq[uniq.length - 1], 'above the raster ceiling').toBeLessThanOrEqual(2350)

    // Every level is a whole number of intervals from the lowest one — ±1 for
    // the rounding each printed number carries — and the closest pair is one
    // interval apart, which is what says 100 rather than some multiple of it.
    let closest = Infinity
    for (const v of uniq) {
      const off = (v - uniq[0]) % 100
      expect(Math.min(off, 100 - off), `${v} is not a whole interval above ${uniq[0]}`).toBeLessThanOrEqual(1)
    }
    for (let i = 1; i < uniq.length; i++) closest = Math.min(closest, uniq[i] - uniq[i - 1])
    expect(Math.abs(closest - 100), 'the interval itself must be 100 m').toBeLessThanOrEqual(1)
  })

  /*
   * The conversion runs through the exaggeration, so the readout is not a
   * setting that pins itself: raise the exaggeration and the same stored world
   * interval covers less ground, which the number has to admit. Pinned here
   * because the direction is the half that can be silently inverted — and a
   * slider that read *more* metres as the terrain stretched would be worse than
   * the bug this replaces.
   */
  test('the metre readout follows the exaggeration', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto(PAGE)
    await page.waitForSelector('text=Grid:', { timeout: 30_000 })
    await resetToDefaults(page)

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-testid="load-geotiff"]'),
    ])
    await chooser.setFiles(GEOTIFF)
    await page.waitForFunction(() => /Elevation:\s*\d/.test(document.body.innerText), null, { timeout: 60_000 })

    await page.getByText('Mode: Contours', { exact: true }).click()
    await setMode(page, 'Mode: Contours', true)
    await page.waitForTimeout(1500)

    const slider = page.locator('[data-testid="contour-interval-m"]')
    await slider.fill('100')
    await page.waitForTimeout(2000)
    const before = parseFloat(await slider.inputValue())
    expect(before, 'the slider holds what it was set to').toBeCloseTo(100, 0)

    await page.locator('input[aria-label="Elev scale"]').fill('4')
    await page.waitForTimeout(3000)
    const after = parseFloat(await slider.inputValue())
    expect(after, 'a taller terrain makes a world unit worth fewer metres').toBeLessThan(before)
    expect(after, 'and it is still a real interval').toBeGreaterThan(0)
  })
})
