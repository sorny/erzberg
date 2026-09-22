import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fromArrayBuffer } from 'geotiff'
import { unprojectWgs84 } from '../src/utils/geoCoords.js'
import { openStage, resetToDefaults, waitForApp } from './helpers.js'

/**
 * Clipping the heightmap to a map feature.
 *
 * The same choosing the Masks section does, spent differently: there a feature
 * becomes a stencil over the whole raster, here it becomes the raster's own
 * outline. "Cut this to the municipality" was previously only answerable by
 * tracing a border by hand with the lasso.
 *
 * The fixture delivers the boundary the way Overpass really delivers one — a
 * relation of *open* member ways — because that is the shape that broke the
 * mask version, and a clip that only worked on already-closed rings would be
 * the same bug in a second place.
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

/** One municipality, as a relation of four open segments, plus a road. */
function overpassFixture() {
  const { lat, lon } = INSIDE
  return {
    version: 0.6,
    elements: [
      {
        type: 'relation', id: 700,
        tags: { type: 'boundary', boundary: 'administrative', admin_level: '8', name: 'Gemeinde Eins' },
        members: [
          [[-0.018, -0.009], [0.018, -0.009]],
          [[0.018, -0.009], [0.018, 0.009]],
          [[0.018, 0.009], [-0.018, 0.009]],
          [[-0.018, 0.009], [-0.018, -0.009]],
        ].map((pts) => ({
          type: 'way', role: 'outer',
          geometry: pts.map(([dx, dy]) => ({ lat: lat + dy, lon: lon + dx })),
        })),
      },
      // A road, so the "cannot clip to this" path has something to select.
      {
        type: 'way', id: 701, tags: { highway: 'motorway', name: 'A9' },
        geometry: [[-0.05, -0.02], [0.05, 0.02]].map(([dx, dy]) => ({ lat: lat + dy, lon: lon + dx })),
      },
    ],
  }
}

async function boot(page) {
  // A render crash in the panel looks exactly like a slow test from the
  // outside — the element the assertion waits for simply never appears. This
  // turns it into a line of output instead of three minutes of timeout.
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.route('**/api/interpreter', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(overpassFixture()),
  }))
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
  await page.click('[data-testid="osm-cat-boundaries"]')
  await page.click('[data-testid="osm-fetch"]')
  await page.waitForSelector('[data-section="Vector Layers"] >> text=Boundary', { timeout: 20_000 })
  await page.fill('[data-testid="panel-filter"]', '')
  await page.click('[data-testid="edit-heightmap"]')
  await expect(page.locator('[data-testid="edit-panel"]')).toBeVisible()
}

/** Select the layer whose option text matches, in the Edit panel's picker. */
async function pickLayer(page, match) {
  const value = await page.locator('[data-testid="edit-from-layer"] option')
    .filter({ hasText: match }).first().getAttribute('value')
  expect(value, `no layer matching ${match}`).toBeTruthy()
  await page.selectOption('[data-testid="edit-from-layer"]', value)
  await page.waitForTimeout(400)
}

test.describe('clip to a feature', () => {
  test.skip(!existsSync(FIXTURE), `${FIXTURE} not present (gitignored) — see tests/testdata/README.md`)

  test('a boundary of open segments becomes the clip outline', async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)

    const before = await page.locator('[data-testid="edit-result"]').textContent()
    expect(before, 'the raster starts uncropped').toMatch(/^\d+×\d+$/)

    await pickLayer(page, 'Boundary')
    await page.click('[data-testid="edit-from-apply"]')
    await page.waitForTimeout(800)

    // The result shrinks to the feature's own extent, and the panel names it.
    const after = await page.locator('[data-testid="edit-result"]').textContent()
    expect(after).not.toBe(before)
    const [bw] = before.split('×').map(Number)
    const [aw] = after.split('×').map(Number)
    expect(aw, 'the clip is smaller than the raster').toBeLessThan(bw)
    expect(aw, 'but not empty').toBeGreaterThan(10)
    await expect(page.locator('[data-testid="edit-panel"]')).toContainText('Gemeinde Eins')

    // And it survives Apply into the terrain itself.
    await page.click('[data-testid="edit-apply"]')
    await page.waitForTimeout(2500)
    const grid = await page.locator('text=Grid:').first().textContent()
    expect(grid).toMatch(/Grid:\s*\d+×\d+/)
  })

  test('a layer that encloses nothing cannot be clipped to', async ({ page }) => {
    // A road network has no inside. Saying so with a disabled button beats
    // producing an empty raster and making the user work out why.
    test.setTimeout(180_000)
    await boot(page)
    await pickLayer(page, 'Roads')
    await expect(page.locator('[data-testid="edit-from-apply"]')).toBeDisabled()
    await expect(page.locator('[data-testid="edit-panel"]')).toContainText('do not enclose anything')
  })
})
