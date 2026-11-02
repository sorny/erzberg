import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { writeArrayBuffer } from 'geotiff'
import { loadProjections, projectWgs84 } from '../src/utils/geoCoords.js'
import { openStage, waitForApp } from './helpers.js'

/**
 * Shapefile, KML and KMZ uploads, through the buttons and by drop.
 *
 * Fixtures in tests/testdata/vector: a zip of two Shapefile layers in
 * MGI / Austria Lambert, and the same Erzberg peak and path as KML and KMZ.
 * The terrain is a small GeoTIFF this file writes, in MGI / Austria Lambert
 * around the Erzberg, so the features are also placed on a national grid.
 */
const DIR = 'tests/testdata/vector'

const layer = (page, name) =>
  page.waitForSelector(`[data-section="Vector Layers"] >> text=${name}`, { timeout: 20000 })

// 6 × 6 km of a cone, centred on the Erzberg, in EPSG:31287.
async function lambertTiff(path) {
  await loadProjections()
  const [cx, cy] = projectWgs84(47.5241, 14.9024, 'EPSG:31287')
  const n = 60, cell = 100
  const v = Float32Array.from({ length: n * n }, (_, i) =>
    1466 - 0.2 * Math.hypot((i % n) - n / 2, Math.floor(i / n) - n / 2) * cell)
  writeFileSync(path, Buffer.from(writeArrayBuffer(v, {
    width: n, height: n, ModelPixelScale: [cell, cell, 0],
    ModelTiepoint: [0, 0, 0, cx - n * cell / 2, cy + n * cell / 2, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 31287,
  })))
}

async function open(page, info) {
  const tif = info.outputPath('erzberg-lambert.tif')
  await lambertTiff(tif)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="load-geotiff"]')])
  await chooser.setFiles(tif)
  await page.waitForFunction(
    () => /Elevation:\s*\d/.test(document.querySelector('[data-testid="panel-stats"]')?.textContent ?? ''),
    { timeout: 30000 })
  await openStage(page, 'overlay')
  await page.click('[data-testid="section-vector-layers"]')
  await page.waitForSelector('[data-testid="load-shapefile"]')
}

async function upload(page, button, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(`[data-testid="${button}"]`)])
  await chooser.setFiles(`${DIR}/${file}`)
}

async function drop(page, file) {
  const b64 = readFileSync(`${DIR}/${file}`).toString('base64')
  const dt = await page.evaluateHandle(({ b64, name }) => {
    const bin = atob(b64)
    const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([buf], name))
    return dt
  }, { b64, name: file })
  for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('body', type, { dataTransfer: dt })
}

test('a zipped Shapefile becomes one layer per geometry', async ({ page }, info) => {
  await open(page, info)
  await upload(page, 'load-shapefile', 'lambert-shp.zip')
  await layer(page, 'lambert-shp.zip · Points')
  await layer(page, 'lambert-shp.zip · Lines')
  // Stephansdom is in Vienna, off this raster; the Erzberg and the path are on it.
  await expect(page.locator('[data-section="Vector Layers"]')).toContainText('4 of 5 vertices fall inside')
})

test('KML and KMZ load through the KML button', async ({ page }, info) => {
  await open(page, info)
  await upload(page, 'load-kml', 'peaks.kml')
  await layer(page, 'peaks.kml · Points')
  // Every vertex of this file lies on the Lambert raster: no coverage warning.
  await expect(page.locator('[data-section="Vector Layers"]')).not.toContainText('fall inside')
  await upload(page, 'load-kml', 'peaks.kmz')
  await layer(page, 'peaks.kmz · Lines')
})

test('a dropped Shapefile zip and KML are read as overlays', async ({ page }, info) => {
  await open(page, info)
  await drop(page, 'lambert-shp.zip')
  await layer(page, 'lambert-shp.zip · Points')
  await drop(page, 'peaks.kml')
  await layer(page, 'peaks.kml · Lines')
})

test('a loose .shp says to zip it', async ({ page }, info) => {
  await open(page, info)
  const dt = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(100)], 'roads.shp'))
    return dt
  })
  for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('body', type, { dataTransfer: dt })
  await expect(page.getByText('Zip the .shp, .dbf and .prj together')).toBeVisible()
})
