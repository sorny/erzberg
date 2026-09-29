import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fromArrayBuffer } from 'geotiff'
import { unprojectWgs84 } from '../src/utils/geoCoords.js'
import { openStage, resetToDefaults, waitForApp } from './helpers.js'

/**
 * A mask from features that are already loaded.
 *
 * The rasteriser itself — holes, winding, the metres-per-pixel of a geographic
 * bbox — is pinned in unit/maskFromVector.test.js against a synthetic grid,
 * because that is where those failures are legible. What is covered here is the
 * part that only exists once the whole path is wired: that a layer the user can
 * see in the panel turns into a mask row with a plausible coverage, and that
 * the mask then thins an ordinary draw mode exactly as a painted one does.
 *
 * Overpass is never called. The route answers with a fixture holding one large
 * lake, which is the shape the assertions below reason about.
 *
 * Fixture: tests/testdata/geotiff.tif — gitignored, so this skips rather than
 * fails on a clean checkout.
 */
const FIXTURE = 'tests/testdata/geotiff.tif'
const PAGE = 'http://localhost:5173'

let INSIDE = null

test.beforeAll(async () => {
  if (!existsSync(FIXTURE)) return
  const buf = readFileSync(FIXTURE)
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const img = await tiff.getImage()
  const [minX, minY, maxX, maxY] = img.getBoundingBox()
  const crs = `EPSG:${img.getGeoKeys().ProjectedCSTypeGeoKey}`
  const [lat, lon] = unprojectWgs84((minX + maxX) / 2, (minY + maxY) / 2, crs)
  INSIDE = { lat, lon }
})

/** One lake and one stream, both well inside the fixture's extent. */
function overpassFixture() {
  const { lat, lon } = INSIDE
  const way = (id, tags, pts) => ({
    type: 'way', id, tags,
    geometry: pts.map(([dx, dy]) => ({ lat: lat + dy, lon: lon + dx })),
  })
  return {
    version: 0.6,
    elements: [
      // A rectangle covering a known, sizeable slice of the raster — big
      // enough that a coverage figure is a number this test can reason about.
      way(1, { natural: 'water', water: 'lake', name: 'Grosser See' },
        [[-0.03, -0.012], [0.03, -0.012], [0.03, 0.012], [-0.03, 0.012], [-0.03, -0.012]]),
      // A second, much smaller lake with its own name: the picker has to be
      // able to tell two features of one layer apart, which is the whole point.
      way(3, { natural: 'water', water: 'lake', name: 'Kleiner See' },
        [[0.040, -0.020], [0.050, -0.020], [0.050, -0.014], [0.040, -0.014], [0.040, -0.020]]),
      way(2, { waterway: 'stream' }, [[-0.05, 0.02], [0.05, 0.02]]),
      // A municipality, delivered the way Overpass really delivers one: a
      // relation whose members are *open* segments, none of them closed. Graz's
      // district Jakomini arrives as seven of these. Filling each separately
      // paints slivers; treating the layer as lines paints only the outline.
      {
        type: 'relation', id: 500,
        tags: { type: 'boundary', boundary: 'administrative', admin_level: '9', name: 'Bezirk Eins' },
        members: [
          [[-0.020, -0.010], [0.020, -0.010]],
          [[0.020, -0.010], [0.020, 0.010]],
          [[0.020, 0.010], [-0.020, 0.010]],
          [[-0.020, 0.010], [-0.020, -0.010]],
        ].map((pts) => ({
          type: 'way', role: 'outer',
          geometry: pts.map(([dx, dy]) => ({ lat: lat + dy, lon: lon + dx })),
        })),
      },
    ],
  }
}

async function boot(page) {
  await page.route('**/api/interpreter', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(overpassFixture()),
    })
  })
  await page.goto(PAGE)
  await waitForApp(page)
  await resetToDefaults(page)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="load-geotiff"]'),
  ])
  await chooser.setFiles(FIXTURE)
  await page.waitForFunction(() => !!document.body.innerText.match(/Elevation:\s*\d/), { timeout: 30_000 })
  await openStage(page, 'overlay')
  await page.click('[data-testid="section-vector-layers"]')
  await page.waitForSelector('[data-testid="osm-fetch"]')
  // Admin boundaries starts unticked — it is not what most rasters want.
  await page.click('[data-testid="osm-cat-boundaries"]')
  await page.click('[data-testid="osm-fetch"]')
  // Attached rather than visible: the layer list can sit on a closed pane.
  await page.waitForSelector('text=Water · Lake', { state: 'attached', timeout: 20_000 })
}

async function filter(page, term) {
  await page.fill('[data-testid="panel-filter"]', term)
  await page.waitForTimeout(500)
}

/** A new mask, open in the Studio on its Features tool. */
async function openFeatures(page) {
  await filter(page, 'Masks')
  await page.click('[data-testid="add-mask"]')
  await page.waitForSelector('[data-testid="mask-studio"]')
  await page.click('[data-testid="studio-tool-features"]')
  await page.waitForSelector('[data-testid="mask-from-layer"]')
}

/** Choose the layer whose option text matches. */
async function pickLayer(page, match) {
  const value = await page.locator('[data-testid="mask-from-layer"] option')
    .filter({ hasText: match }).first().getAttribute('value')
  expect(value, `a layer matching ${match}`).toBeTruthy()
  await page.selectOption('[data-testid="mask-from-layer"]', value)
}

/** The previewed coverage, in percent, after the preview's pause. */
async function previewShare(page) {
  await page.waitForTimeout(900)
  const text = await page.locator('[data-testid="studio-preview-coverage"]').textContent()
  return text.startsWith('<') ? 0.5 : Number(text.replace('%', ''))
}

async function applyAndClose(page) {
  await page.waitForTimeout(900)
  await page.click('[data-testid="studio-apply"]')
  await page.click('[data-testid="studio-done"]')
  await page.waitForTimeout(1000)
}

/** Pick the layer whose option text matches, then make the mask. */
async function makeMask(page, match, dist = null) {
  await openFeatures(page)
  await pickLayer(page, match)
  if (dist !== null) await page.fill('[data-testid="mask-from-dist"]', String(dist))
  await applyAndClose(page)
}

/** The names in the mask list. They are inputs, so text matching cannot see them. */
async function maskNames(page) {
  await filter(page, 'Masks')
  return page.locator('[data-section="Masks"] input[aria-label^="Name of"]')
    .evaluateAll((els) => els.map((e) => e.value))
}

function segmentsIn(svg, label) {
  const start = svg.indexOf(`inkscape:label="${label}"`)
  if (start < 0) return 0
  const end = svg.indexOf('</g>', start)
  return (svg.slice(start, end).match(/<(path|line|polyline)\b/g) ?? []).length
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

test.describe('a mask from features', () => {
  test.skip(!existsSync(FIXTURE), `${FIXTURE} not present (gitignored) — see tests/testdata/README.md`)

  test('an area layer becomes a mask covering roughly its own ground', async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)
    await makeMask(page, 'Water · Lake')

    const section = page.locator('[data-section="Masks"]')
    expect(await maskNames(page)).toContain('Water · Lake')
    const shown = (await section.textContent()).match(/(\d+)%/)
    expect(shown, 'the new mask reports a coverage').not.toBeNull()
    // The lake spans 0.06° × 0.024° inside a 12 × 7 km extent: a real slice of
    // the raster, and nowhere near all of it.
    expect(Number(shown[1])).toBeGreaterThan(3)
    expect(Number(shown[1])).toBeLessThan(80)
  })

  test('a line layer becomes a corridor, and a wider one covers more', async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)
    await openFeatures(page)
    await pickLayer(page, 'Water · Stream')

    await page.fill('[data-testid="mask-from-dist"]', '20')
    const narrow = await previewShare(page)
    await page.fill('[data-testid="mask-from-dist"]', '400')
    const wide = await previewShare(page)
    expect(narrow, 'a corridor covers something').toBeGreaterThan(0)
    expect(wide, 'the wider corridor covers more').toBeGreaterThan(narrow)
  })

  test('the mask stencils an ordinary draw mode', async ({ page }) => {
    test.setTimeout(240_000)
    await boot(page)

    const before = segmentsIn(await exportSvg(page), 'Lines')
    expect(before, 'the unmasked layer has to draw something').toBeGreaterThan(20)

    await makeMask(page, 'Water · Lake')

    // Lines knows nothing about masks. If it comes out stencilled, a mask made
    // this way lands in exactly the place a painted one does.
    await filter(page, 'Mode: Lines')
    const swatch = page.locator('[data-section="Mode: Lines"] button[aria-label$="drawn"], ' +
                                '[data-section="Mode: Lines"] button[aria-label$="skipped"]')
    await swatch.first().click()
    await page.waitForTimeout(2500)
    await page.fill('[data-testid="panel-filter"]', '')
    await page.waitForTimeout(400)

    const after = segmentsIn(await exportSvg(page), 'Lines')
    expect(after, 'a masked layer still draws inside its mask').toBeGreaterThan(0)
    expect(after, 'and less than unmasked').toBeLessThan(before * 0.9)
  })

  test('only the picked features go into the mask', async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)
    await openFeatures(page)
    await pickLayer(page, 'Water · Lake')
    await page.waitForTimeout(400)

    // Two lakes in this layer, both ticked to begin with because both are drawn.
    await expect(page.locator('[data-testid="mask-from-count"]')).toContainText('Using 2 of 2')

    await page.click('[data-testid="mask-from-none"]')
    await expect(page.locator('[data-testid="mask-from-count"]')).toContainText('Using 0 of 2')
    expect(await previewShare(page), 'nothing picked, nothing previewed').toBe(0)

    // Tick by label rather than by index — the list is sorted named-first, so
    // an index is a statement about the sort and not about the feature.
    await page.locator('label', { hasText: 'Kleiner See' }).first().locator('input').check()
    await expect(page.locator('[data-testid="mask-from-count"]')).toContainText('Using 1 of 2')
    const onlySmall = await previewShare(page)

    // Both must cover materially more. The small lake's area is a fraction of
    // the big one's, so the coverage alone proves which was used.
    await page.click('[data-testid="mask-from-all"]')
    const both = await previewShare(page)
    expect(both, 'both lakes cover more than the small one alone').toBeGreaterThan(onlySmall)

    // Back to the small one, applied. The mask takes the feature's own name
    // when exactly one was picked.
    await page.click('[data-testid="mask-from-none"]')
    await page.locator('label', { hasText: 'Kleiner See' }).first().locator('input').check()
    await applyAndClose(page)
    expect(await maskNames(page)).toContain('Kleiner See')
  })

  test('a boundary made of open segments fills, and can trace instead', async ({ page }) => {
    // The bug a user hit: a mask of a municipality came back as its contour.
    // Two reasons, and both had to be fixed. The layer is declared `geom:
    // 'line'` because a boundary is *drawn* as a line, and its rings arrive as
    // separate open ways that have to be stitched before anything can be
    // filled at all.
    test.setTimeout(180_000)
    await boot(page)
    await openFeatures(page)
    await pickLayer(page, 'City district')

    // The switch appears only because these lines actually close.
    const fill = page.locator('[data-testid="mask-from-fill"]')
    await expect(fill).toBeVisible()
    const filled = await previewShare(page)
    expect(filled, 'a filled district covers real ground').toBeGreaterThan(3)

    // Switched off it traces the border, which must be a fraction of the area.
    await fill.uncheck()
    await page.fill('[data-testid="mask-from-dist"]', '30')
    const traced = await previewShare(page)
    expect(traced, 'the outline is much less than the inside').toBeLessThan(filled)
  })
})
