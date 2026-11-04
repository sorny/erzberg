import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fromArrayBuffer } from 'geotiff'
import { openStage, waitForApp } from './helpers.js'

/**
 * The GeoTIFF export: heights in metres, with the projection and the extent,
 * so the file reopens in a GIS tool, or here, where it started.
 *
 * Fixture: tests/testdata/geotiff.tif, 1200×700, EPSG:32633, 10 m pixels,
 * 641.36–2349.51 m. It is gitignored, so these skip without it.
 */
const FIXTURE = 'tests/testdata/geotiff.tif'

async function loadFixture(page, file) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="load-geotiff"]'),
  ])
  await chooser.setFiles(file)
  await page.waitForFunction(
    () => /Elevation:\s*\d/.test(document.querySelector('[data-testid="panel-stats"]')?.textContent ?? ''),
    { timeout: 30000 },
  )
}

test.describe('GeoTIFF export', () => {
  test.skip(!existsSync(FIXTURE), `${FIXTURE} not present (gitignored)`)

  test('writes metres, the projection and the extent, and reopens unchanged', async ({ page }, info) => {
    await page.goto('http://localhost:5173')
    await waitForApp(page)
    await loadFixture(page, FIXTURE)
    await openStage(page, 'output')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="export-geotiff"]'),
    ])
    expect(download.suggestedFilename()).toMatch(/-heightmap\.tif$/)
    const path = info.outputPath('out.tif')
    await download.saveAs(path)

    const buf = readFileSync(path)
    const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const image = await tiff.getImage()
    const src = await (await fromArrayBuffer(readFileSync(FIXTURE).buffer)).getImage()

    expect(image.getWidth()).toBe(src.getWidth())
    expect(image.getHeight()).toBe(src.getHeight())
    expect(image.getGeoKeys().ProjectedCSTypeGeoKey).toBe(32633)
    const bb = image.getBoundingBox(), sb = src.getBoundingBox()
    for (let i = 0; i < 4; i++) expect(bb[i]).toBeCloseTo(sb[i], 3)

    // Float32, in metres: the same values as the source, within float precision.
    const [out] = await image.readRasters({ samples: [0] })
    const [ref] = await src.readRasters({ samples: [0] })
    expect(out).toBeInstanceOf(Float32Array)
    let worst = 0
    for (let i = 0; i < ref.length; i += 97) worst = Math.max(worst, Math.abs(out[i] - ref[i]))
    expect(worst).toBeLessThan(0.01)

    // And it opens here again with the same projection and range.
    await page.goto('http://localhost:5173')
    await waitForApp(page)
    await loadFixture(page, path)
    await openStage(page, 'output')
    const stats = await page.innerText('[data-testid="panel-stats"]')
    expect(stats).toContain('Elevation: 641 – 2350 m')
    expect(stats).toContain('(EPSG:32633)')
  })

  test('says what is missing for a PNG heightmap', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await waitForApp(page)
    await openStage(page, 'output')
    let downloaded = false
    page.on('download', () => { downloaded = true })
    await page.click('[data-testid="export-geotiff"]')
    await expect(page.getByText('A GeoTIFF needs a georeferenced raster in metres.')).toBeVisible()
    expect(downloaded).toBe(false)
  })
})
