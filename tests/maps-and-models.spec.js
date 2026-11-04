import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { writeArrayBuffer } from 'geotiff'
import { openStage, resetToDefaults, waitForApp } from './helpers.js'

/**
 * The shelf, the project file, the sheet's furniture, and the map and model
 * exports, in the real app.
 *
 * Fixture: tests/testdata/geotiff.tif, 1200×700 in UTM 33N at 10 m, near the
 * Grimming (641–2350 m). It is gitignored, so the specs that need it skip
 * without it. In the heavy project: they read downloads and pixels.
 */
const FIXTURE = 'tests/testdata/geotiff.tif'
const hasFixture = existsSync(FIXTURE)

async function open(page) {
  await page.goto('http://localhost:5173/?automation')
  await waitForApp(page)
  await page.waitForFunction(() => window.erzberg?.version === 1)
  // Automation opens with the panel shut, for clean renders. These specs use it.
  const toggle = page.locator('[data-testid="sidebar-toggle"]')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }
}

async function loadFixture(page, file = FIXTURE) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="load-geotiff"]')])
  await chooser.setFiles(file)
  await page.waitForFunction(
    () => /Elevation:\s*\d/.test(document.querySelector('[data-testid="panel-stats"]')?.textContent ?? ''),
    { timeout: 30000 })
  await page.evaluate(() => window.erzberg.settle())
}

const set = (page, values) => page.evaluate(async (v) => { window.erzberg.setParams(v); await window.erzberg.settle() }, values)

/** Click, wait for the download, and give back its bytes and name. */
async function download(page, info, start) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), start()])
  const path = info.outputPath(d.suggestedFilename())
  await d.saveAs(path)
  return { name: d.suggestedFilename(), path, bytes: readFileSync(path) }
}

test('the shelf keeps a look with a thumbnail, across a reload, and removes it', async ({ page }) => {
  await open(page)
  await resetToDefaults(page)
  await openStage(page, 'presets')
  await page.fill('[data-testid="shelf-name"]', 'Dusk')
  await page.click('[data-testid="shelf-keep"]')
  await expect(page.locator('[data-testid="shelf-Dusk"] img')).toBeVisible()

  await open(page)
  await openStage(page, 'presets')
  await expect(page.locator('[data-testid="shelf-Dusk"]')).toBeVisible()
  await page.click('[data-testid="shelf-remove-Dusk"]')
  await expect(page.locator('[data-testid="shelf-Dusk"]')).toHaveCount(0)
})

test.describe('with the GeoTIFF', () => {
  test.skip(!hasFixture, `${FIXTURE} not present (gitignored)`)

  test('a project file brings back the terrain and the look', async ({ page }, info) => {
    await open(page)
    await resetToDefaults(page)
    await loadFixture(page)
    await set(page, { bgColor: '#123456' })
    await openStage(page, 'output')
    const saved = await download(page, info, () => page.click('[data-testid="project-save"]'))
    expect(saved.name).toMatch(/\.erzberg$/)
    expect(saved.bytes.subarray(0, 2).toString('ascii')).toBe('PK')

    // Back to the default ground and look, then the project.
    await open(page)
    await resetToDefaults(page)
    expect((await page.evaluate(() => window.erzberg.get(['bgColor']))).bgColor).not.toBe('#123456')
    await openStage(page, 'output')
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="project-open"]')])
    await chooser.setFiles(saved.path)
    await page.waitForFunction(
      () => /Elevation:\s*641/.test(document.querySelector('[data-testid="panel-stats"]')?.textContent ?? ''),
      { timeout: 30000 })
    expect((await page.evaluate(() => window.erzberg.get(['bgColor']))).bgColor).toBe('#123456')
  })

  test('Print size writes the whole sheet at its DPI', async ({ page }, info) => {
    await open(page)
    await resetToDefaults(page)
    await loadFixture(page)
    await set(page, { showFrame: true, framePaper: 'iso', frameLandscape: false, plotWidthMm: 210, framePrintDpi: 150 })
    const png = await download(page, info, () => page.evaluate(() => window.erzberg.export('png')))
    // 210 mm at 150 DPI is 1240 px; the ISO sheet is 1:√2.
    expect(png.bytes.readUInt32BE(16)).toBe(1240)
    expect(png.bytes.readUInt32BE(20)).toBe(1754)
    const phys = png.bytes.indexOf('pHYs')
    expect(phys).toBeGreaterThan(0)
    expect(png.bytes.readUInt32BE(phys + 4)).toBe(5906)   // 150 DPI in pixels per metre
  })

  test('the sheet letters a title, a grid and magnetic north', async ({ page }) => {
    await open(page)
    await resetToDefaults(page)
    await loadFixture(page)
    await set(page, {
      showFrame: true, frameNorth: true, frameMagnetic: true, frameTitle: true, frameTitleText: 'Grimming',
      frameGrid: 'ticks', tilt: 0, rotation: 0, orthographic: true,
    })
    const marks = page.locator('[data-testid="sheet-marks"] text')
    await expect(marks.filter({ hasText: 'Grimming' })).toHaveCount(1)
    await expect(marks.filter({ hasText: 'EPSG:32633' })).toHaveCount(1)
    // Magnetic north replaces grid north: one arrow, labelled MN, with its angle.
    await expect(marks.filter({ hasText: /^MN$/ })).toHaveCount(1)
    await expect(marks.filter({ hasText: /^N$/ })).toHaveCount(0)
    await expect(marks.filter({ hasText: /^\d\.\d° E$/ })).toHaveCount(1)
    expect(await marks.filter({ hasText: /^\d{3} 000$/ }).count()).toBeGreaterThan(1)

    // Tilted, there is no grid: a tilted plate is at another scale at its far side.
    await set(page, { tilt: 40 })
    await expect(marks.filter({ hasText: /^\d{3} 000$/ })).toHaveCount(0)
  })

  test('GeoJSON, glTF and 3MF carry the plate', async ({ page }, info) => {
    test.setTimeout(240_000)
    await open(page)
    await resetToDefaults(page)
    await loadFixture(page)
    await page.evaluate(async () => { window.erzberg.setModes(['Contours'], true); await window.erzberg.settle() })
    await openStage(page, 'output')

    const geo = await download(page, info, () => page.click('[data-testid="export-geojson"]'))
    const doc = JSON.parse(geo.bytes.toString('utf8'))
    expect(doc.crs.properties.name).toBe('urn:ogc:def:crs:EPSG::32633')
    expect(doc.features.length).toBeGreaterThan(100)
    const [x, y, z] = doc.features[0].geometry.coordinates[0]
    expect(x).toBeGreaterThan(418999); expect(x).toBeLessThan(431001)
    expect(y).toBeGreaterThan(5258999); expect(y).toBeLessThan(5266001)
    expect(z).toBeGreaterThan(600); expect(z).toBeLessThan(2400)
    expect(doc.features[0].properties.mode).toBe('Contours')

    const glb = await download(page, info, () => page.click('[data-testid="export-glb"]'))
    expect(glb.bytes.subarray(0, 4).toString('ascii')).toBe('glTF')
    expect(glb.bytes.readUInt32LE(8)).toBe(glb.bytes.length)

    const mf = await download(page, info, () => page.click('[data-testid="export-3mf"]'))
    const { unzip } = await import('but-unzip')
    const names = [...unzip(new Uint8Array(mf.bytes))].map((e) => e.filename)
    expect(names).toContain('3D/3dmodel.model')
  })

  test('a GPX layer charts its route with its length and climb', async ({ page }) => {
    await open(page)
    await resetToDefaults(page)
    await loadFixture(page)
    await openStage(page, 'overlay')
    await page.click('[data-testid="section-vector-layers"]')
    const pts = [0, 1, 2, 3, 4].map((i) => `<trkpt lat="${47.495 + i * 0.006}" lon="${13.97 + i * 0.015}"></trkpt>`)
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="load-gpx"]')])
    await chooser.setFiles({
      name: 'route.gpx', mimeType: 'application/gpx+xml',
      buffer: Buffer.from(`<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`),
    })
    await page.locator('[data-section="Vector Layers"] [data-testid^="vector-name-"]').first().click()
    await page.locator('[data-testid^="vector-profile-"]').first().click()
    await expect(page.locator('[data-testid="profile-route"]')).toContainText(/\d km · ↑ \d/)
  })
})

/** 64 × 48 cells in UTM 33N, three bands: an index, a cone in metres, a ramp. */
function threeBandTiff(path) {
  const w = 64, h = 48
  const bands = [
    (x, y) => ((x + y) % 10) / 9,
    (x, y) => 1500 - 1000 * Math.min(1, Math.hypot(x - w / 2, y - h / 2) / (w / 2)),
    (x) => -20 + 40 * x / (w - 1),
  ]
  const values = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let b = 0; b < 3; b++) values[(y * w + x) * 3 + b] = bands[b](x, y)
  writeFileSync(path, Buffer.from(writeArrayBuffer(values, {
    width: w, height: h, PhotometricInterpretation: 1,
    ModelPixelScale: [10, 10, 0], ModelTiepoint: [0, 0, 0, 420000, 5265000, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 32633,
  })))
}

test('a band goes to the imagery drape and to a mask', async ({ page }, info) => {
  const path = info.outputPath('three-band.tif')
  threeBandTiff(path)
  await open(page)
  await loadFixture(page, path)
  await page.click('[data-testid="band-3-imagery"]')
  await expect(page.getByText('Band 3 of three-band.tif is the imagery drape.')).toBeVisible()
  expect((await page.evaluate(() => window.erzberg.get(['showImagery']))).showImagery).toBe(true)
  await page.click('[data-testid="band-1-mask"]')
  await expect(page.getByText(/Band 1 of three-band\.tif is a mask/)).toBeVisible()
})
