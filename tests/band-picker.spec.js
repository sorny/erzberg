import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { writeArrayBuffer } from 'geotiff'
import { openStage, waitForApp } from './helpers.js'

/**
 * The band picker for a multi-band GeoTIFF.
 *
 * The file is made here: 64×48 cells in UTM 33N with three bands. Band 1 is a
 * 0–1 index, band 2 is a cone from 500 to 1500 m, band 3 is a ramp from
 * -20 to 20. Only band 2 is elevation, and only the picker can say so.
 */
function threeBandTiff(path) {
  const w = 64, h = 48
  // Pixel-interleaved Float32, which is what the writer takes for typed data.
  const bands = [
    (x, y) => ((x + y) % 10) / 9,
    (x, y) => 1500 - 1000 * Math.min(1, Math.hypot(x - w / 2, y - h / 2) / (w / 2)),
    (x) => -20 + 40 * x / (w - 1),
  ]
  const values = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let b = 0; b < 3; b++) values[(y * w + x) * 3 + b] = bands[b](x, y)
  const buf = writeArrayBuffer(values, {
    width: w, height: h, PhotometricInterpretation: 1,
    ModelPixelScale: [10, 10, 0], ModelTiepoint: [0, 0, 0, 420000, 5265000, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 32633,
  })
  writeFileSync(path, Buffer.from(buf))
}

test('a multi-band GeoTIFF offers its bands, and a pick reloads on that band', async ({ page }, info) => {
  const path = info.outputPath('three-band.tif')
  threeBandTiff(path)

  await page.goto('http://localhost:5173')
  await waitForApp(page)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="load-geotiff"]')])
  await chooser.setFiles(path)

  const picker = page.locator('[data-testid="band-picker"]')
  await expect(picker).toContainText('this file has 3')
  await expect(page.locator('[data-testid="band-1"]')).toHaveAttribute('aria-pressed', 'true')
  // The ranges arrive after the load, with a preview for each band.
  await expect(page.locator('[data-testid="band-2"]')).toContainText('500–1,500')
  await expect(page.locator('[data-testid="band-3"]')).toContainText('-20–20')
  await expect(picker.locator('img')).toHaveCount(3)

  await page.click('[data-testid="band-2"]')
  await expect(page.locator('[data-testid="band-2"]')).toHaveAttribute('aria-pressed', 'true')
  await openStage(page, 'output')
  await expect(page.locator('[data-testid="panel-stats"]')).toContainText('Elevation: 500 – 1500 m')
})

test('a single-band GeoTIFF shows no picker', async ({ page }, info) => {
  const path = info.outputPath('one-band.tif')
  const w = 16, h = 16
  writeFileSync(path, Buffer.from(writeArrayBuffer(Float32Array.from({ length: w * h }, (_, i) => 100 + i), {
    width: w, height: h, ModelPixelScale: [10, 10, 0], ModelTiepoint: [0, 0, 0, 420000, 5265000, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 32633,
  })))
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="load-geotiff"]')])
  await chooser.setFiles(path)
  await page.waitForFunction(() => /Elevation:\s*\d/.test(document.querySelector('[data-testid="panel-stats"]')?.textContent ?? ''))
  await expect(page.locator('[data-testid="band-picker"]')).toHaveCount(0)
})
