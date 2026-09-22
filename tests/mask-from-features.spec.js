import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fromArrayBuffer } from 'geotiff'
import { unprojectWgs84 } from '../src/utils/geoCoords.js'
import { resetToDefaults, waitForApp } from './helpers.js'

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
  await page.click('[data-testid="section-vector-layers"]')
  await page.waitForSelector('[data-testid="osm-fetch"]')
  // Admin boundaries starts unticked — it is not what most rasters want.
  await page.click('[data-testid="osm-cat-boundaries"]')
  await page.click('[data-testid="osm-fetch"]')
  // Attached rather than visible: this text is also an <option> inside the
  // Masks section's picker, and an option in a closed select is never visible.
  await page.waitForSelector('text=Water · Lake', { state: 'attached', timeout: 20_000 })
}

async function filter(page, term) {
  await page.fill('[data-testid="panel-filter"]', term)
  await page.waitForTimeout(500)
}

/** Pick the layer whose option text matches, then make the mask. */
async function makeMask(page, match, dist = null) {
  await filter(page, 'Masks')
  await page.waitForSelector('[data-testid="mask-from-layer"]')
  const value = await page.locator('[data-testid="mask-from-layer"] option')
    .filter({ hasText: match }).first().getAttribute('value')
  await page.selectOption('[data-testid="mask-from-layer"]', value)
  if (dist !== null) await page.fill('[data-testid="mask-from-dist"]', String(dist))
  await page.click('[data-testid="mask-from-features"]')
  await page.waitForTimeout(1500)
}

function segmentsIn(svg, label) {
  const start = svg.indexOf(`inkscape:label="${label}"`)
  if (start < 0) return 0
  const end = svg.indexOf('</g>', start)
  return (svg.slice(start, end).match(/<(path|line|polyline)\b/g) ?? []).length
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

/** Coverage of the newest mask row, as a number. */
async function newestCoverage(page) {
  const text = await page.locator('[data-section="Masks"]').textContent()
  const all = [...text.matchAll(/(\d+)%/g)].map((m) => Number(m[1]))
  return all[all.length - 1]
}

test.describe('a mask from features', () => {
  test.skip(!existsSync(FIXTURE), `${FIXTURE} not present (gitignored) — see tests/testdata/README.md`)

  test('an area layer becomes a mask covering roughly its own ground', async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)
    await makeMask(page, 'Water · Lake')

    const section = page.locator('[data-section="Masks"]')
    await expect(section).toContainText('Water · Lake')
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

    await makeMask(page, 'Water · Stream', 20)
    const section = page.locator('[data-section="Masks"]')
    const narrow = Number((await section.textContent()).match(/(\d+(?:\.\d+)?)%/)[1])

    await makeMask(page, 'Water · Stream', 400)
    const both = await section.textContent()
    const all = [...both.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]))
    expect(all.length, 'two masks now').toBeGreaterThanOrEqual(2)
    expect(Math.max(...all), 'the wider corridor covers more').toBeGreaterThan(narrow)
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
    await filter(page, 'Masks')
    await page.waitForSelector('[data-testid="mask-from-layer"]')
    const value = await page.locator('[data-testid="mask-from-layer"] option')
      .filter({ hasText: 'Water · Lake' }).first().getAttribute('value')
    await page.selectOption('[data-testid="mask-from-layer"]', value)
    await page.waitForTimeout(400)

    // Two lakes in this layer, both ticked to begin with because both are drawn.
    await expect(page.locator('[data-testid="mask-from-count"]')).toContainText('Using 2 of 2')

    // Take just the small one. Its area is a fraction of the big one's, so the
    // coverage figure alone proves which was used.
    await page.click('[data-testid="mask-from-none"]')
    await expect(page.locator('[data-testid="mask-from-count"]')).toContainText('Using 0 of 2')
    await expect(page.locator('[data-testid="mask-from-features"]')).toBeDisabled()

    // Tick by label rather than by index — the list is sorted named-first, so
    // an index is a statement about the sort and not about the feature.
    await page.locator('label', { hasText: 'Kleiner See' }).first().locator('input').check()
    await expect(page.locator('[data-testid="mask-from-count"]')).toContainText('Using 1 of 2')

    await page.click('[data-testid="mask-from-features"]')
    await page.waitForTimeout(1500)
    const onlySmall = await newestCoverage(page)

    // The mask takes the feature's own name when exactly one was picked.
    await expect(page.locator('[data-section="Masks"]')).toContainText('Kleiner See')

    // Now both, which must cover materially more.
    await page.click('[data-testid="mask-from-all"]')
    await expect(page.locator('[data-testid="mask-from-count"]')).toContainText('Using 2 of 2')
    await page.click('[data-testid="mask-from-features"]')
    await page.waitForTimeout(1500)
    const both = await newestCoverage(page)

    expect(both, 'both lakes cover more than the small one alone').toBeGreaterThan(onlySmall)
  })

  test('a boundary made of open segments fills, and can trace instead', async ({ page }) => {
    // The bug a user hit: a mask of a municipality came back as its contour.
    // Two reasons, and both had to be fixed. The layer is declared `geom:
    // 'line'` because a boundary is *drawn* as a line, and its rings arrive as
    // separate open ways that have to be stitched before anything can be
    // filled at all.
    test.setTimeout(180_000)
    await boot(page)
    await filter(page, 'Masks')
    await page.waitForSelector('[data-testid="mask-from-layer"]')
    const value = await page.locator('[data-testid="mask-from-layer"] option')
      .filter({ hasText: 'City district' }).first().getAttribute('value')
    expect(value, 'the level-9 boundary must become a layer').toBeTruthy()
    await page.selectOption('[data-testid="mask-from-layer"]', value)
    await page.waitForTimeout(500)

    // The switch appears only because these lines actually close.
    const fill = page.locator('[data-testid="mask-from-fill"]')
    await expect(fill).toBeVisible()

    await page.click('[data-testid="mask-from-features"]')
    await page.waitForTimeout(1500)
    const filled = await newestCoverage(page)
    expect(filled, 'a filled district covers real ground').toBeGreaterThan(3)

    // Switched off it traces the border, which must be a fraction of the area.
    await fill.uncheck()
    await page.fill('[data-testid="mask-from-dist"]', '30')
    await page.click('[data-testid="mask-from-features"]')
    await page.waitForTimeout(1500)
    const traced = await newestCoverage(page)
    expect(traced, 'the outline is much less than the inside').toBeLessThan(filled)
  })
})
