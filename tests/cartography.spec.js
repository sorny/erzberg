import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fromArrayBuffer } from 'geotiff'
import { unprojectWgs84 } from '../src/utils/geoCoords.js'
import { openStage, resetToDefaults, waitForApp } from './helpers.js'

/**
 * Survey-sheet cartography on vector layers: hatched areas, line decorations,
 * dash-dot lines, lettering along lines, label collisions and free OSM queries.
 *
 * Overpass is answered by a fixture, as in vector.spec.js. The fixture raster is
 * tests/testdata/geotiff.tif (1200×700, EPSG:32633, 10 m pixels), gitignored,
 * so these skip on a clean checkout.
 */
const FIXTURE = 'tests/testdata/geotiff.tif'
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

function fixture() {
  const { lat, lon } = INSIDE
  const way = (id, tags, pts) => ({
    type: 'way', id, tags,
    geometry: pts.map(([dx, dy]) => ({ lat: lat + dy, lon: lon + dx })),
  })
  return {
    version: 0.6,
    elements: [
      way(1, { natural: 'wood', name: 'Hochwald' },
        [[-0.03, -0.015], [0.0, -0.015], [0.0, 0.0], [-0.03, 0.0], [-0.03, -0.015]]),
      way(2, { railway: 'rail', name: 'Erzbergbahn' },
        [[-0.05, 0.01], [0.0, 0.012], [0.05, 0.01]]),
      way(3, { highway: 'primary', ref: 'B115', name: 'Eisenstraße' },
        [[-0.05, -0.02], [0.0, -0.018], [0.05, -0.02]]),
      way(4, { waterway: 'river', name: 'Erzbach' },
        [[-0.05, 0.02], [-0.02, 0.019], [0.01, 0.021], [0.05, 0.02]]),
      { type: 'node', id: 10, lat: lat + 0.002, lon: lon - 0.001, tags: { natural: 'peak', name: 'Polster', ele: '1910' } },
      { type: 'node', id: 11, lat: lat + 0.0021, lon: lon - 0.0009, tags: { natural: 'peak', name: 'Polsterkopf', ele: '1890' } },
    ],
  }
}

async function routeOverpass(page, body) {
  await page.route('**/api/interpreter', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body ?? fixture()) })
  })
}

async function openVectorPanel(page) {
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await resetToDefaults(page)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="load-geotiff"]'),
  ])
  await chooser.setFiles(FIXTURE)
  await page.waitForFunction(() => !!(document.querySelector('[data-testid="panel-stats"]')?.textContent ?? '').match(/Elevation:\s*\d/), { timeout: 30000 })
  await openStage(page, 'overlay')
  await page.click('[data-testid="section-vector-layers"]')
  await page.waitForSelector('[data-testid="osm-fetch"]')
}

async function fetchAll(page) {
  await page.click('[data-testid="osm-fetch"]')
  await page.waitForSelector('[data-section="Vector Layers"] >> text=Erzbergbahn >> visible=false', { state: 'attached', timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1500)
}

/** Opens a layer row by a word in its name, and returns its id. */
async function openLayer(page, word) {
  const row = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: word }).first()
  await expect(row).toBeVisible({ timeout: 20000 })
  const id = (await row.getAttribute('data-testid')).replace('vector-layer-', '')
  await page.click(`[data-testid="vector-name-${id}"]`)
  return id
}

async function exportSvg(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.keyboard.press('Digit1'),
  ])
  let svg = ''
  for await (const chunk of await download.createReadStream()) svg += chunk
  return svg
}

const group = (svg, name) => svg.match(new RegExp(`<g[^>]*data-name="[^"]*${name}[^"]*"[^>]*>[\\s\\S]*?</g>`))

test.describe('cartography', () => {
  test.skip(!existsSync(FIXTURE), `${FIXTURE} not present (gitignored) — see tests/testdata/README.md`)

  test('a hatched wood and a ticked railway reach the SVG as their own pens', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await fetchAll(page)

    const wood = await openLayer(page, 'Wood')
    await page.locator(`[data-testid="vector-hatch-${wood}"] input[type="checkbox"]`).first().check()
    await page.click(`[data-testid="vector-name-${wood}"]`)

    const rail = await openLayer(page, 'Rail')
    await page.click(`[data-testid="deco-ticks-both-${rail}"]`)
    await page.waitForTimeout(2500)

    const svg = await exportSvg(page)
    const hatch = group(svg, 'hatch')
    expect(hatch, 'the hatch must be its own pen layer').not.toBeNull()
    expect((hatch[0].match(/<(line|polyline|path)/g) ?? []).length).toBeGreaterThan(5)
    expect(group(svg, 'decoration'), 'the ticks must be their own pen layer').not.toBeNull()
  })

  test('a dash-dot boundary splits into long and short dashes in the SVG', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await fetchAll(page)
    const road = await openLayer(page, 'Primary')
    await page.locator(`[data-testid="vector-layer-${road}"]`).getByRole('button', { name: '–·', exact: true }).click()
    await page.waitForTimeout(1500)
    const svg = await exportSvg(page)
    const g = group(svg, 'Primary')
    expect(g).not.toBeNull()
    const segs = [...g[0].matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g)]
      .map((m) => m.slice(1, 5).map(Number))
    // A dash is drawn as several draped pieces end to end; join them into runs.
    const runs = []
    let run = 0
    for (let i = 0; i < segs.length; i++) {
      const [x0, y0, x1, y1] = segs[i]
      const prev = segs[i - 1]
      if (prev && Math.hypot(x0 - prev[2], y0 - prev[3]) > 0.05) { runs.push(run); run = 0 }
      run += Math.hypot(x1 - x0, y1 - y0)
    }
    runs.push(run)
    const longest = Math.max(...runs)
    expect(runs.length).toBeGreaterThan(6)
    // Long dashes and dots, and the dots well under half a dash.
    expect(runs.filter((r) => r < longest * 0.35).length).toBeGreaterThan(2)
    expect(runs.filter((r) => r > longest * 0.7).length).toBeGreaterThan(2)
  })
  test('a free query arrives as its own layers, with every tag on the feature', async ({ page }) => {
    let query = null
    const { lat, lon } = INSIDE
    await page.route('**/api/interpreter', async (route) => {
      query = decodeURIComponent((route.request().postData() ?? '').replace(/\+/g, ' '))
      const body = { version: 0.6, elements: [
        { type: 'way', id: 70, tags: { natural: 'cliff', name: 'Wand', height: '40' },
          geometry: [[-0.01, 0.0], [0.0, 0.002], [0.01, 0.0]].map(([dx, dy]) => ({ lat: lat + dy, lon: lon + dx })) },
        { type: 'node', id: 71, lat: lat + 0.001, lon: lon + 0.001, tags: { natural: 'cliff', name: 'Kanzel' } },
      ] }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await openVectorPanel(page)
    await page.fill('[data-testid="osm-query"]', 'natural=cliff')
    await page.click('[data-testid="osm-query-add"]')
    await expect(page.locator('[data-testid="osm-query-chip"]')).toHaveText(/natural=cliff/)
    await page.click('[data-testid="osm-fetch"]')
    const row = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'natural=cliff · cliff (lines)' })
    await expect(row).toBeVisible({ timeout: 20000 })
    expect(query).toContain('nwr["natural"="cliff"]')
    await expect(page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'natural=cliff · cliff (points)' })).toBeVisible()

    const id = (await row.getAttribute('data-testid')).replace('vector-layer-', '')
    await page.click(`[data-testid="vector-name-${id}"]`)
    await page.click(`[data-testid="features-toggle-${id}"]`)
    await page.click(`[data-testid="feature-${id}-0"]`)
    await expect(page.locator(`[data-testid="feature-tags-${id}"]`)).toContainText('height=40')
  })

  test('a river is lettered along itself, and a road number stands in a shield', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await fetchAll(page)
    const river = await openLayer(page, 'River')
    await page.locator(`[data-testid="label-name-${river}"] input[type="checkbox"]`).check()
    await page.click(`[data-testid="vector-name-${river}"]`)
    const road = await openLayer(page, 'Primary')
    await page.locator(`[data-testid="label-shield-${road}"] input[type="checkbox"]`).check()
    await page.waitForTimeout(2500)

    const svg = await exportSvg(page)
    const riverText = group(svg, 'River · labels')
    expect(riverText, 'the river name must be a labels pen').not.toBeNull()
    // Lettered glyph by glyph along the line, each glyph its own <text>.
    const glyphs = [...riverText[0].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join('')
    expect(glyphs).toBe('Erzbach')
    expect(group(svg, 'Primary · shields'), 'the shield box must be drawn').not.toBeNull()
    expect(svg).toMatch(/>B115</)
  })

  test('Avoid overlaps drops the lower of two summits that collide', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await fetchAll(page)
    const peaks = await openLayer(page, 'Peaks')
    await page.locator(`[data-testid="label-name-${peaks}"] input[type="checkbox"]`).check()
    await page.locator(`[data-testid="label-avoid-${peaks}"] input[type="checkbox"]`).check()
    await expect(page.locator(`[data-testid="label-dropped-${peaks}"]`)).toContainText('1 label', { timeout: 15000 })
    const svg = await exportSvg(page)
    const g = group(svg, 'Peaks · labels')
    expect(g[0]).toContain('Polster<')
    expect(g[0]).not.toContain('Polsterkopf')
  })

  test('a local .osm file becomes layers, cut to the terrain', async ({ page }) => {
    const { lat, lon } = INSIDE
    const dir = mkdtempSync(join(tmpdir(), 'erzberg-osm-'))
    const file = join(dir, 'valley.osm')
    writeFileSync(file, `<?xml version="1.0"?><osm version="0.6">
      <node id="1" lat="${lat}" lon="${lon}"><tag k="natural" v="peak"/><tag k="name" v="Reichenstein"/><tag k="ele" v="2165"/></node>
      <node id="2" lat="${lat + 0.002}" lon="${lon}"/><node id="3" lat="${lat + 0.004}" lon="${lon + 0.003}"/>
      <node id="4" lat="${lat + 5}" lon="${lon + 5}"><tag k="natural" v="peak"/><tag k="name" v="Far away"/></node>
      <way id="10"><nd ref="2"/><nd ref="3"/><tag k="highway" v="track"/></way>
    </osm>`)
    await openVectorPanel(page)
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="load-osm-file"]')])
    await chooser.setFiles(file)
    await expect(page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Roads · Track' })).toBeVisible({ timeout: 20000 })
    const peaks = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Peaks' })
    await expect(peaks).toBeVisible()
    // The summit five degrees away is outside the raster and is left out.
    await expect(peaks).toContainText('1')
  })
  test('a typed map scale zooms the view to that ratio', async ({ page }) => {
    await page.goto('http://localhost:5173/?automation')
    await waitForApp(page)
    await page.waitForFunction(() => window.erzberg?.version === 1)
    const toggle = page.locator('[data-testid="sidebar-toggle"]')
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="load-geotiff"]')])
    await chooser.setFiles(FIXTURE)
    await page.waitForFunction(() => /Elevation:\s*\d/.test(document.querySelector('[data-testid="panel-stats"]')?.textContent ?? ''), { timeout: 30000 })
    await page.evaluate(async () => {
      window.erzberg.setParams({ frameScaleBar: true, plotWidthMm: 297, tilt: 0, orthographic: true })
      await window.erzberg.settle()
    })
    await openStage(page, 'frame')
    const section = page.locator('[data-testid="section-map-elements"]')
    if ((await section.getAttribute('aria-expanded')) === 'false') await section.click()
    await expect(page.locator('[data-testid="map-ratio"]')).toBeVisible({ timeout: 15000 })
    await page.fill('[data-testid="map-scale-input"]', '50000')
    await page.press('[data-testid="map-scale-input"]', 'Enter')
    await expect.poll(async () => {
      const t = (await page.textContent('[data-testid="map-ratio"]')) ?? ''
      return Number(t.replace(/^1 : ([\d,]+).*/s, '$1').replace(/,/g, ''))
    }, { timeout: 15000 }).toBeGreaterThan(49000)
    const t = await page.textContent('[data-testid="map-ratio"]')
    const n = Number(t.replace(/^1 : ([\d,]+).*/s, '$1').replace(/,/g, ''))
    expect(n).toBeLessThan(51000)
    // 12 × 7 km at 1 : 50 000 is 240 × 140 mm.
    await expect(page.locator('[data-testid="map-scale-paper"]')).toContainText('mm')
  })
  test('the plate exports as a GeoTIFF, a PNG with a world file and a KMZ', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await fetchAll(page)
    await openStage(page, 'output')
    const grab = async (id) => {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(`[data-testid="${id}"]`)])
      const chunks = []
      for await (const c of await download.createReadStream()) chunks.push(c)
      return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) }
    }
    const tif = await grab('export-plate-geotiff')
    expect(tif.name).toMatch(/-plate\.tif$/)
    const { fromArrayBuffer } = await import('geotiff')
    const img = await (await fromArrayBuffer(tif.bytes.buffer.slice(tif.bytes.byteOffset, tif.bytes.byteOffset + tif.bytes.byteLength))).getImage()
    expect(img.getSamplesPerPixel()).toBe(4)
    expect(img.getGeoKeys().ProjectedCSTypeGeoKey).toBe(32633)
    // The plate covers the raster's own extent, give or take the mesh's last cell.
    const raw = readFileSync(FIXTURE)
    const src = await (await fromArrayBuffer(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))).getImage()
    const [a0, b0, c0, d0] = src.getBoundingBox(), [a1, b1, c1, d1] = img.getBoundingBox()
    for (const [p, q] of [[a0, a1], [b0, b1], [c0, c1], [d0, d1]]) expect(Math.abs(p - q)).toBeLessThan(60)

    const world = await grab('export-plate-world')
    expect(world.name).toMatch(/-georeferenced\.zip$/)
    expect(world.bytes.includes(Buffer.from('.pgw'))).toBe(true)
    const kmz = await grab('export-plate-kmz')
    expect(kmz.name).toMatch(/\.kmz$/)
    expect(kmz.bytes.includes(Buffer.from('doc.kml'))).toBe(true)
  })
  test('a map drape comes from tiles, and from an image with its world file', async ({ page }) => {
    // One small red tile, for every tile the drape asks for.
    const red = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
    let asked = 0
    await page.route('**/*.tile.opentopomap.org/**', async (route) => {
      asked++
      await route.fulfill({ status: 200, contentType: 'image/png', body: red, headers: { 'access-control-allow-origin': '*' } })
    })
    await openVectorPanel(page)
    await openStage(page, 'surface')
    const sec = page.locator('[data-testid="section-imagery"]')
    if ((await sec.getAttribute('aria-expanded')) === 'false') await sec.click()
    await page.click('[data-testid="fetch-tiles"]')
    await expect(page.locator('body')).toContainText('OpenTopoMap', { timeout: 20000 })
    expect(asked).toBeGreaterThan(0)
    expect(asked).toBeLessThanOrEqual(64)
    await expect(page.locator('body')).toContainText('© OpenTopoMap')

    // A picture of the raster's left half, in its own projection (no .prj).
    const raw = readFileSync(FIXTURE)
    const src = await (await fromArrayBuffer(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))).getImage()
    const [minX, , maxX, maxY] = src.getBoundingBox()
    const dir = mkdtempSync(join(tmpdir(), 'erzberg-wld-'))
    writeFileSync(join(dir, 'half.png'), red)
    const px = (maxX - minX) / 2
    writeFileSync(join(dir, 'half.pgw'), [px, 0, 0, -px, minX + px / 2, maxY - px / 2].join('\n'))
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid="load-world-image"]')])
    await chooser.setFiles([join(dir, 'half.png'), join(dir, 'half.pgw')])
    await expect(page.locator('body')).toContainText(/half\.png covers \d+% of the terrain/, { timeout: 20000 })
  })
  test('a coastline across the extent gives a sea layer on its water side', async ({ page }) => {
    const { lat, lon } = INSIDE
    await page.route('**/api/interpreter', async (route) => {
      const body = { version: 0.6, elements: [
        { type: 'way', id: 90, tags: { natural: 'coastline' },
          geometry: [[-0.3, 0], [0.3, 0]].map(([dx, dy]) => ({ lat: lat + dy, lon: lon + dx })) },
      ] }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await openVectorPanel(page)
    await page.click('[data-testid="osm-cat-coast"]')
    await page.click('[data-testid="osm-fetch"]')
    const sea = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Coast · Sea' })
    await expect(sea).toBeVisible({ timeout: 20000 })
    await expect(page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Coast · Coastline' })).toBeVisible()
  })
})
