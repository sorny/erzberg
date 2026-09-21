import { test, expect } from '@playwright/test'
import { deflateSync } from 'zlib'
import { resetToDefaults } from './helpers.js'

/**
 * Drawing from what the ground *is* rather than from its shape.
 *
 * Every other draw mode in this app reads slope, curvature or elevation, so two
 * pieces of ground at the same gradient get the same mark whatever is standing
 * on them. A cover plate breaks that tie, and four claims are worth pinning
 * because each is a way the feature could be silently useless.
 *
 * **The plate is taken.** A `.json` is three things now — preset, GeoJSON, cover
 * — and the router has to hand this one to the right loader from the bytes.
 *
 * **The class map is linked to the legend.** Six swatches in a column is a list
 * of six unknowns until you have seen their shapes, so pointing at the map names
 * a class and pointing at a legend row lights it up on the map. One state drives
 * both, and a broken link leaves a view that looks fine and answers nothing.
 *
 * **A mask actually stencils.** This is the load-bearing one. Masking works by
 * thinning the terrain grid a layer is built from rather than by editing each of
 * the thirty-odd builders, so if the mechanism works at all it works for every
 * mode at once — and if it silently does not, the picture looks perfectly
 * reasonable and is simply not masked.
 *
 * **The mode inks one colour per class**, which is the same contract the other
 * blocking colour modes are held to in `areas.spec.js`.
 *
 * The plate here is synthetic — three equal horizontal bands over the bundled
 * sample raster — precisely so the third of the picture each class covers is a
 * number the test knows in advance and can hold the mask to.
 */
const PAGE = 'http://localhost:5173'

const SIZE = 1024          // the bundled sample raster, exactly
const BANDS = 3

/** A cover plate over the sample raster: three bands, top to bottom. */
function syntheticPlate() {
  const labels = new Uint8Array(SIZE * SIZE)
  const plate = new Uint8Array(SIZE * SIZE * 3)
  const colors = [[210, 70, 50], [60, 150, 110], [70, 100, 200]]
  for (let r = 0; r < SIZE; r++) {
    const band = Math.min(BANDS - 1, Math.floor((r / SIZE) * BANDS))
    for (let c = 0; c < SIZE; c++) {
      const i = r * SIZE + c
      labels[i] = band
      plate[i * 3] = colors[band][0]
      plate[i * 3 + 1] = colors[band][1]
      plate[i * 3 + 2] = colors[band][2]
    }
  }
  const pack = (a) => deflateSync(Buffer.from(a)).toString('base64')
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
  return JSON.stringify({
    kind: 'erzberg.landcover/1',
    name: 'Three bands',
    year: 2024,
    crs: 'EPSG:32633',
    bbox: [0, 0, SIZE * 10, SIZE * 10],
    width: SIZE, height: SIZE,
    classes: colors.map((c, i) => ({
      index: i, name: `Class ${String.fromCharCode(65 + i)}`, color: hex(c), share: 1 / BANDS,
    })),
    variance: 0.5,
    labels: pack(labels),
    plate: pack(plate),
    attribution: 'Synthetic fixture, not a real dataset.',
  })
}

async function dropPlate(page, text, name = 'bands.cover.json') {
  const dt = await page.evaluateHandle(({ text, name }) => {
    const dt = new DataTransfer()
    dt.items.add(new File([text], name, { type: 'application/json' }))
    return dt
  }, { text, name })
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt })
  await page.dispatchEvent('body', 'dragover', { dataTransfer: dt })
  await page.dispatchEvent('body', 'drop', { dataTransfer: dt })
  await page.waitForTimeout(1200)
}

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

/** How many line segments one pen layer holds. */
function segmentsIn(svg, label) {
  const start = svg.indexOf(`inkscape:label="${label}"`)
  if (start < 0) return 0
  const end = svg.indexOf('</g>', start)
  return (svg.slice(start, end).match(/<(path|line|polyline)\b/g) ?? []).length
}

async function boot(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
}

test('a dropped plate is read as cover, not as a preset', async ({ page }) => {
  test.setTimeout(120_000)
  await boot(page)
  await dropPlate(page, syntheticPlate())

  await page.fill('[data-testid="panel-filter"]', 'Land Cover')
  await page.waitForTimeout(500)
  // The section reports what it took. Three classes, named and counted.
  await expect(page.locator('text=Three bands').first()).toBeVisible()
  await expect(page.locator('text=Class A').first()).toBeVisible()
  await expect(page.locator('text=Class C').first()).toBeVisible()
})

test('the class map names what the pointer is over, both ways round', async ({ page }) => {
  test.setTimeout(120_000)
  await boot(page)
  await dropPlate(page, syntheticPlate())
  await page.fill('[data-testid="panel-filter"]', 'Land Cover')
  await page.waitForTimeout(600)

  const section = page.locator('[data-section="Land Cover"]')
  const canvas = section.locator('canvas')
  await expect(canvas).toHaveCount(1)
  // The plate is drawn at its own grid, not the raster's, so the backing store
  // is the size the file states.
  await expect(canvas).toHaveAttribute('width', String(SIZE))
  await expect(section).toContainText('Point at the map to name a class')

  // Pointing at the map names the class under the cursor. The fixture is three
  // equal bands top to bottom, so the top sixth is unambiguously the first.
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 6)
  await page.waitForTimeout(400)
  await expect(section).toContainText('Class A')
  await expect(section).not.toContainText('Point at the map')

  // And the bottom sixth the last.
  await page.mouse.move(box.x + box.width / 2, box.y + (box.height * 5) / 6)
  await page.waitForTimeout(400)
  await expect(section).toContainText('Class C')

  // Leaving the map puts the prompt back rather than stranding a name.
  await page.mouse.move(box.x - 40, box.y - 40)
  await page.waitForTimeout(400)
  await expect(section).toContainText('Point at the map to name a class')

  // The other direction: pointing at a legend row lights that class up, which
  // shows as the readout under the map naming it.
  await section.locator('div').filter({ hasText: /^Class B/ }).last().hover()
  await page.waitForTimeout(400)
  await expect(section).toContainText('Class B ·')
})

test('a class mask stencils an ordinary draw mode', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)

  // Lines is on after a reset, and it is deliberately an *ordinary* mode here:
  // nothing in its builder knows land cover exists. If it comes out masked, the
  // mechanism reaches every mode rather than the one that was written for it.
  const before = segmentsIn(await exportSvg(page), 'Lines')
  expect(before, 'the unmasked layer has to draw something').toBeGreaterThan(20)

  await dropPlate(page, syntheticPlate())

  // Mask Lines to the first band — one third of the raster.
  await page.fill('[data-testid="panel-filter"]', 'Mode: Lines')
  await page.waitForTimeout(500)
  await page.locator('button[title^="Class A"]:visible').first().click()
  await page.waitForTimeout(2500)
  await page.fill('[data-testid="panel-filter"]', '')
  await page.waitForTimeout(400)

  const after = segmentsIn(await exportSvg(page), 'Lines')
  expect(after, 'a masked layer still draws inside its class').toBeGreaterThan(0)
  // A third of the picture, with room for the marching to land differently at
  // the new edges. The point of the bound is that it is nowhere near unmasked.
  expect(after).toBeLessThan(before * 0.6)
})

test('the Land cover mode inks one layer per class', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  await dropPlate(page, syntheticPlate())

  await setSwitch(page, 'Mode: Lines', 'Enabled', false)
  await setSwitch(page, 'Mode: Land cover', 'Enabled', true)
  await page.waitForTimeout(3500)

  const svg = await exportSvg(page)
  const mine = labelsOf(svg).filter((l) => l.startsWith('Land cover · ink '))
  expect(mine.length, 'one pen layer per class').toBe(BANDS)
  expect(new Set(mine.map((l) => l.slice(-7))).size).toBe(BANDS)

  // CC-BY travels with the work, not with the app: a plate that is actually in
  // the picture puts its credit in the file.
  expect(svg).toContain('Synthetic fixture')
})
