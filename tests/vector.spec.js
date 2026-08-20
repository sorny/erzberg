import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fromArrayBuffer } from 'geotiff'
import { unprojectWgs84 } from '../src/utils/geoCoords.js'

/**
 * Vector layers — OpenStreetMap, GeoJSON and GPX draped on the terrain.
 *
 * The maths that places them is covered in projection.spec.js. What is covered
 * here is the part that only exists once the whole path is wired: that a fetch
 * turns into named layers, that hiding and removing one changes what is drawn,
 * that the SVG export carries them, and that a cancelled fetch leaves nothing
 * behind.
 *
 * Overpass is never actually called. The route below answers with a fixture, so
 * the suite neither depends on a volunteer service being up nor costs it a
 * query per run — and the fixture can hold exactly the tag mix the assertions
 * name.
 *
 * Fixture: tests/testdata/geotiff.tif — 1200×700, EPSG:32633, 10 m pixels,
 * gitignored, so these skip rather than fail on a clean checkout.
 */
const FIXTURE = 'tests/testdata/geotiff.tif'

/**
 * The centre of the fixture raster, in WGS84 — read from the file rather than
 * written down, so dropping a different GeoTIFF at that path still produces
 * features that land on it. Every offset below is a few thousandths of a degree
 * from here, well inside a 12 × 7 km extent.
 */
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

/** A tiny Overpass response covering four categories and six buckets. */
function overpassFixture() {
  const { lat, lon } = INSIDE
  const way = (id, tags, pts) => ({
    type: 'way', id, tags,
    geometry: pts.map(([dx, dy]) => ({ lat: lat + dy, lon: lon + dx })),
  })
  return {
    version: 0.6,
    elements: [
      // Long enough to cross most of the raster: the picking test finds it by
      // sweeping the pointer, and a 600 m stub in a 12 km extent is a needle.
      way(1, { highway: 'motorway', name: 'A9' },
        [[-0.055, -0.018], [-0.02, 0.004], [0.02, -0.004], [0.055, 0.016]]),
      way(2, { highway: 'motorway_link' },            [[0.008, 0.001], [0.009, 0.003]]),
      way(3, { highway: 'track', name: 'Erzweg' },     [[-0.004, 0], [-0.002, 0.003]]),
      // Enough tracks to bring out the filter box, which a two-row list has no
      // business showing.
      ...Array.from({ length: 12 }, (_, i) =>
        way(100 + i, { highway: 'track' },
            [[-0.005 - i * 0.001, 0.001], [-0.003 - i * 0.001, 0.004]])),
      way(5, { waterway: 'stream' },                  [[0, -0.003], [0.002, -0.001]]),
      // Overlaps the right-hand half of the lake below, and only that half. Two
      // areas that cover each other are what the stacking test measures, and the
      // half of each that the other never touches is what stops it passing on a
      // blank canvas.
      way(4, { natural: 'wood' },
        [[0.025, 0.008], [0.055, 0.008], [0.055, 0.026], [0.025, 0.026], [0.025, 0.008]]),
      // Big enough to be a solid target on screen: the fill-opacity test reads
      // pixels, and a 200 m pond in a 12 km extent is a smudge. Every assertion
      // that touches this lake is relative, so its size is free to change.
      way(6, { natural: 'water', water: 'lake' },
        [[0.010, 0.008], [0.040, 0.008], [0.040, 0.026], [0.010, 0.026], [0.010, 0.008]]),
      way(7, { building: 'yes' },
        [[-0.001, -0.001], [-0.0005, -0.001], [-0.0005, -0.0005], [-0.001, -0.0005], [-0.001, -0.001]]),
      { type: 'node', id: 8, lat: lat + 0.002, lon: lon - 0.001,
        tags: { natural: 'peak', name: 'Polster', ele: '1910' } },
      { type: 'node', id: 10, lat: lat + 0.003, lon: lon + 0.002, tags: { natural: 'peak' } },
      // A real name from the test extent, and long enough that a tooltip which
      // truncates instead of wrapping would visibly lose the end of it.
      { type: 'node', id: 11, lat: lat - 0.002, lon: lon - 0.002,
        tags: { natural: 'peak', name: 'Steinfeldspitze-Südwest-Gipfel', ele: '2280' } },
      // No tags at all: must be ignored rather than counted into a bucket.
      { type: 'node', id: 9, lat, lon },
    ],
  }
}

/** Loads the fixture raster and opens the Vector Layers section. */
async function openVectorPanel(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=↑ GeoTIFF'),
  ])
  await chooser.setFiles(FIXTURE)
  await page.waitForFunction(() => !!document.body.innerText.match(/Elevation:\s*\d/), { timeout: 30000 })
  await page.click('[data-testid="section-vector-layers"]')
  await page.waitForSelector('[data-testid="osm-fetch"]')
}

/** Segment count from the stats footer — what actually reached the GPU. */
async function segments(page) {
  const body = await page.innerText('body')
  const m = body.match(/Segments:\s*([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

/** Triangle count from the stats footer — the surface plus any area fills. */
async function triangles(page) {
  const body = await page.innerText('body')
  const m = body.match(/Triangles:\s*([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

async function routeOverpass(page, body = overpassFixture(), delayMs = 0) {
  await page.route('**/api/interpreter', async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test.describe('vector layers', () => {
  test.skip(!existsSync(FIXTURE), `${FIXTURE} not present (gitignored) — see tests/testdata/README.md`)

  test('an OSM fetch becomes named layers, split by tag value', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)

    // Buildings is heavy and starts unticked, so its way must not produce a row.
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Motorway', { timeout: 20000 })

    const body = await page.innerText('body')
    // Category + subtype naming, and only for buckets with features in them.
    expect(body).toContain('Roads · Motorway')
    expect(body).toContain('Roads · Track')
    expect(body).toContain('Water · Stream')
    expect(body).toContain('Peaks')
    expect(body).toContain('Buildings')          // the category button, not a layer
    expect(body).not.toContain('Roads · Residential')
    // A single-bucket category says its own name rather than "Water · Lake".
    expect(body).toContain('Water · Lake')
    // ODbL. Non-negotiable once OSM data is on screen.
    expect(body).toContain('© OpenStreetMap contributors')
  })

  test('a link road is counted with its parent class, not as its own layer', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Motorway')

    const body = await page.innerText('body')
    expect(body).not.toContain('Motorway link')
    // Two motorway ways (one of them a _link) and two tracks.
    const row = await page.locator('[data-testid^="vector-layer-"]', { hasText: 'Roads · Motorway' }).innerText()
    expect(row).toMatch(/\b2\b/)
  })

  test('an unticked category is not fetched', async ({ page }) => {
    let query = null
    await page.route('**/api/interpreter', async (route) => {
      query = route.request().postData()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overpassFixture()) })
    })
    await openVectorPanel(page)
    await page.click('[data-testid="osm-cat-roads"]')     // untick
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Water · Stream', { timeout: 20000 })

    expect(query).not.toContain('highway')
    expect(query).toContain('waterway')
    expect(await page.innerText('body')).not.toContain('Roads · Motorway')
  })

  test('hiding a layer removes its segments; removing it takes the row too', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Motorway')
    await page.waitForTimeout(1500)

    const withAll = await segments(page)
    expect(withAll).toBeGreaterThan(0)

    const row = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Roads · Motorway' })
    const id = (await row.getAttribute('data-testid')).replace('vector-layer-', '')

    await page.click(`[data-testid="vector-vis-${id}"]`)
    await expect.poll(() => segments(page), { timeout: 20000 }).toBeLessThan(withAll)

    await page.click(`[data-testid="vector-remove-${id}"]`)
    await expect(row).toHaveCount(0)
    // The other layers are untouched.
    expect(await page.innerText('body')).toContain('Roads · Track')
  })

  test('an area layer carries a terrain-conforming fill that can be switched off', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Water · Lake')
    await page.waitForTimeout(1500)

    // Water bodies default to filled, so the lake arrives with one: a lattice
    // over roughly 220 × 220 m of a 10 m raster is hundreds of quads, each
    // taking its own elevation sample at all four corners.
    const filled = await triangles(page)

    const row = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Water · Lake' })
    const id = (await row.getAttribute('data-testid')).replace('vector-layer-', '')
    await row.locator('button', { hasText: 'Water · Lake' }).click()

    // Polled rather than slept on: the count arrives from a worker round trip,
    // and a fixed wait is a race that only shows up under the GPU contention of
    // a full suite run.
    const fillToggle = page.locator(`[data-testid="vector-fill-${id}"] label`)
    await fillToggle.click()
    await expect.poll(() => triangles(page), { timeout: 20000 }).toBeLessThan(filled)

    await fillToggle.click()
    await expect.poll(() => triangles(page), { timeout: 20000 }).toBe(filled)
  })

  test('the eye hides a layer without removing it', async ({ page }) => {
    // Hide and delete now sit next to each other, which is the point — but it is
    // also exactly the arrangement where a mislabelled control loses someone's
    // work. The eye must never remove the row, and the chip must show the state.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const row = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Peaks' }).first()
    const id = (await row.getAttribute('data-testid')).replace('vector-layer-', '')
    const rows = await page.locator('[data-testid^="vector-layer-"]').count()
    const all = await segments(page)

    const eye = page.locator(`[data-testid="vector-vis-${id}"]`)
    await expect(eye).toHaveAttribute('title', 'Hide this layer')
    await eye.click()
    await expect.poll(() => segments(page), { timeout: 20000 }).toBeLessThan(all)

    // Hidden, not gone: the row stays, the count stays, the chip dims.
    await expect(page.locator('[data-testid^="vector-layer-"]')).toHaveCount(rows)
    await expect(eye).toHaveAttribute('title', 'Show this layer')
    const dimmed = await page.locator(`[data-testid="vector-swatch-${id}"]`)
      .evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    expect(dimmed).toBeLessThan(1)

    await eye.click()
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(all)
  })

  test('recolouring a layer never enters the worker', async ({ page }) => {
    // The design claim behind the whole panel: a vector layer's geometry has no
    // per-vertex colour buffer unless hypsometric is on, so its colour is a
    // material uniform. Twenty OSM layers is something you recolour constantly,
    // and each recolour must not rebuild all fourteen draw modes.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Motorway')
    await page.waitForTimeout(1500)

    const row = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Roads · Motorway' })
    const id = (await row.getAttribute('data-testid')).replace('vector-layer-', '')
    await row.locator('button', { hasText: 'Roads · Motorway' }).click()

    // The worker announces every completed build on the console; the specs
    // already rely on that line elsewhere.
    let rebuilds = 0
    page.on('console', (m) => { if (m.text().includes('[Benchmark] Viewport Updated')) rebuilds++ })
    await page.waitForTimeout(500)
    rebuilds = 0

    await page.locator(`[data-testid="vector-layer-${id}"] input[type="color"]`).fill('#00ff00')
    await page.waitForTimeout(1500)

    // The row's colour chip is painted with the layer's own colour, so it is
    // proof the change actually landed rather than being swallowed.
    const swatch = await page.locator(`[data-testid="vector-swatch-${id}"]`)
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(swatch).toBe('rgb(0, 255, 0)')
    expect(rebuilds).toBe(0)
  })

  test('a vector layer is one colour, and offers no hypsometric control', async ({ page }) => {
    // Vector layers deliberately carry no per-vertex colour buffer. That is what
    // keeps recolouring one a frame rather than a worker rebuild, and it is why
    // the hypsometric block is hidden for them: a road has no elevation of its
    // own, so the tint could only read the ground under it — a different thing
    // from what the draw modes mean by it, and not what it was wanted for.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Motorway')
    await page.waitForTimeout(1500)

    const row = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Roads · Motorway' })
    await row.locator('button', { hasText: 'Roads · Motorway' }).click()
    const id = (await row.getAttribute('data-testid')).replace('vector-layer-', '')

    await expect(page.locator(`[data-testid="vector-layer-${id}"]`)
      .locator('text=Hypsometric')).toHaveCount(0)

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.keyboard.press('Digit1'),
    ])
    const stream = await download.createReadStream()
    let svg = ''
    for await (const chunk of stream) svg += chunk
    const group = svg.match(/<g[^>]*inkscape:label="[^"]*Motorway"[^>]*>[\s\S]*?<\/g>/)
    expect(group, 'the motorway layer must be in the SVG').not.toBeNull()
    const strokes = new Set([...group[0].matchAll(/stroke="([^"]+)"/g)].map((m) => m[1]))
    expect(strokes.size).toBe(1)
  })

  /** Opens a layer's Features list and returns its layer id. */
  async function openFeatures(page, layerName) {
    const row = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: layerName }).first()
    const id = (await row.getAttribute('data-testid')).replace('vector-layer-', '')
    await row.locator('button', { hasText: layerName }).click()
    await page.click(`[data-testid="features-toggle-${id}"]`)
    return id
  }

  test('a layer lists its features, named first, with a filter', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openFeatures(page, 'Peaks')
    await expect(page.locator(`[data-testid="feature-count-${id}"]`)).toHaveText('Showing 3 of 3')

    const rows = page.locator(`[data-testid^="feature-${id}-"]`)
    // Named sorts first; the unnamed one still gets something to point at
    // rather than a blank row, and the `ele` tag rides along as the note.
    await expect(rows.first()).toContainText('Polster')
    await expect(rows.first()).toContainText('1910m')
    await expect(rows.nth(1)).toContainText('Steinfeldspitze')
    // Unnamed sorts last and still gets something to point at.
    await expect(rows.last()).toContainText('#')

    // Tracks: one named among thirteen, and the filter narrows to it.
    const tid = await openFeatures(page, 'Roads · Track')
    await expect(page.locator(`[data-testid^="feature-${tid}-"]`)).toHaveCount(13)
    await expect(page.locator(`[data-testid^="feature-${tid}-"]`).first()).toContainText('Erzweg')
    await page.fill(`[data-testid="feature-filter-${tid}"]`, 'erz')
    await expect(page.locator(`[data-testid^="feature-${tid}-"]`)).toHaveCount(1)
    await expect(page.locator(`[data-testid^="feature-${tid}-"]`).first()).toContainText('Erzweg')
  })

  test('unchecking a feature drops only that feature', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openFeatures(page, 'Peaks')
    const all = await segments(page)

    // A point feature is exactly one segment, so the arithmetic is exact rather
    // than merely "fewer" — which is what catches an off-by-one in the
    // segment→feature map.
    await page.click(`[data-testid="feature-none-${id}"]`)
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(all - 3)
    await expect(page.locator(`[data-testid="feature-count-${id}"]`)).toHaveText('Showing 0 of 3')

    await page.locator(`[data-testid^="feature-${id}-"] input`).first().check()
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(all - 2)

    await page.click(`[data-testid="feature-all-${id}"]`)
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(all)
  })

  test('hiding a feature keeps the others addressable', async ({ page }) => {
    // The indices in `hidden` name features in the source, not in whatever is
    // currently drawn. If hiding renumbered the rest, the checkbox under the
    // cursor would not be the one that moves.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Track')
    await page.waitForTimeout(1500)

    const id = await openFeatures(page, 'Roads · Track')
    const first = page.locator(`[data-testid^="feature-${id}-"]`).first()
    const label = await first.innerText()
    await first.locator('input').uncheck()
    await page.waitForTimeout(1200)

    // Same row, same label, now unchecked — not a reshuffled list.
    await expect(page.locator(`[data-testid^="feature-${id}-"]`).first()).toContainText(label.split('\n')[0])
    await expect(page.locator(`[data-testid^="feature-${id}-"] input`).first()).not.toBeChecked()
    await expect(page.locator(`[data-testid^="feature-${id}-"] input`).nth(1)).toBeChecked()
  })

  test('pointing at the terrain names a feature; clicking reveals its row', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Motorway')
    await page.waitForTimeout(1500)

    // Everything but the motorway hidden, and that one drawn fat. Not to make
    // picking easier than it is — the slop is unchanged — but so the sweep is a
    // handful of samples instead of a thousand, and so the name it finds is
    // known in advance rather than whatever happened to be under the cursor.
    const rows = page.locator('[data-testid^="vector-layer-"]')
    const ids = await rows.evaluateAll(
      (els) => els.map((e) => e.getAttribute('data-testid').replace('vector-layer-', '')))
    const road = rows.filter({ hasText: 'Roads · Motorway' }).first()
    const roadId = (await road.getAttribute('data-testid')).replace('vector-layer-', '')
    for (const id of ids) if (id !== roadId) await page.click(`[data-testid="vector-vis-${id}"]`)
    await road.locator('button', { hasText: 'Roads · Motorway' }).click()
    await page.locator(`[data-testid="vector-layer-${roadId}"] input[type="range"]`).first().fill('10')
    await page.waitForTimeout(2500)

    const box = await page.locator('canvas[data-engine]').boundingBox()
    const tip = page.locator('[data-testid="feature-tooltip"]')

    let found = null
    outer:
    for (let y = box.y + 220; y < box.y + box.height - 160 && !found; y += 30) {
      for (let x = box.x + 340; x < box.x + 800; x += 30) {
        await page.mouse.move(x, y)
        // Picking is debounced to pointer-rest, so each stop has to outlast it.
        await page.waitForTimeout(170)
        if (await tip.count()) { found = await tip.getAttribute('data-feature-name'); break outer }
      }
    }
    expect(found, 'the pointer must be able to find a feature on the terrain').toBe('A9')

    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(1200)

    // The click has to *show* the feature, not merely select it: its layer and
    // feature list are opened and its row scrolled into view.
    const selected = page.locator('[data-selected="true"]')
    await expect(selected).toHaveCount(1)
    await expect(selected.first()).toContainText('A9')
  })

  /** Hides every vector layer except the one named, and returns its id. */
  async function isolateLayer(page, layerName) {
    const rows = page.locator('[data-testid^="vector-layer-"]')
    const ids = await rows.evaluateAll(
      (els) => els.map((e) => e.getAttribute('data-testid').replace('vector-layer-', '')))
    const keep = rows.filter({ hasText: layerName }).first()
    const keepId = (await keep.getAttribute('data-testid')).replace('vector-layer-', '')
    for (const id of ids) if (id !== keepId) await page.click(`[data-testid="vector-vis-${id}"]`)
    return keepId
  }

  test('a peak is hittable at its ordinary size', async ({ page }) => {
    // A point has no length to catch a passing cursor, so it lives or dies by
    // the pick radius. Three tests `distance < (linewidth + threshold) / 2`, so
    // at the original fixed slop a weight-5 peak had a 5 px target — measured at
    // a 0.5% hit rate across a sweep, against 9.5% now. Nothing here inflates
    // the layer's weight: the point is that the default is usable.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)
    await isolateLayer(page, 'Peaks')
    await page.waitForTimeout(2000)

    const box = await page.locator('canvas[data-engine]').boundingBox()
    const tip = page.locator('[data-testid="feature-tooltip"]')
    const cx = box.x + box.width / 2, cy = box.y + box.height * 0.53

    let name = null
    outer:
    for (let dy = -110; dy <= 110 && !name; dy += 18) {
      for (let dx = -110; dx <= 110; dx += 18) {
        await page.mouse.move(cx + dx, cy + dy)
        await page.waitForTimeout(165)
        if (await tip.count()) { name = await tip.getAttribute('data-feature-name'); break outer }
      }
    }
    expect(name, 'a peak must be findable without aiming to the pixel').not.toBeNull()
  })

  test('the tooltip shows a long name in full and stays on screen', async ({ page }) => {
    // Narrow, so that anything the sweep finds sits inside the band where the
    // tooltip has to open leftward instead of rightward. At full width the
    // terrain never reaches that band and the flip would go untested.
    await page.setViewportSize({ width: 700, height: 520 })
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Motorway')
    await page.waitForTimeout(1500)

    const roadId = await isolateLayer(page, 'Roads · Motorway')
    await page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Roads · Motorway' })
      .first().locator('button', { hasText: 'Roads · Motorway' }).click()
    await page.locator(`[data-testid="vector-layer-${roadId}"] input[type="range"]`).first().fill('10')
    await page.waitForTimeout(2500)

    const box = await page.locator('canvas[data-engine]').boundingBox()
    const tip = page.locator('[data-testid="feature-tooltip"]')

    const seen = []
    outer:
    for (let y = box.y + 120; y < box.y + box.height - 90; y += 22) {
      for (let x = box.x + 200; x < box.x + 460; x += 22) {
        await page.mouse.move(x, y)
        await page.waitForTimeout(165)
        if (!(await tip.count())) continue
        seen.push(await tip.evaluate((el, cursorX) => {
          const r = el.getBoundingClientRect()
          return {
            // Nothing clipped away: the box has to be as tall and wide as the
            // text it holds, which is what wrapping instead of truncating buys.
            clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
            onScreen: r.left >= 0 && r.top >= 0
                   && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
            // Opened leftward — the tooltip ends at or before the cursor.
            flipped: r.right <= cursorX + 1,
            wouldOverflow: cursorX + 16 + 320 > window.innerWidth,
            text: el.innerText,
          }
        }, x))
        if (seen.length >= 3) break outer
      }
    }

    expect(seen.length, 'the sweep must find the motorway').toBeGreaterThan(0)
    for (const t of seen) {
      expect(t.clipped, 'the tooltip must wrap, never truncate').toBe(false)
      expect(t.onScreen, 'the tooltip must stay inside the window').toBe(true)
      expect(t.text).toContain('A9')
      // Where it would have overflowed, it must actually have flipped.
      if (t.wouldOverflow) expect(t.flipped, 'it must open leftward near the edge').toBe(true)
    }
  })

  test('a drag orbits without selecting anything', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(2000)

    const box = await page.locator('canvas[data-engine]').boundingBox()
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    await page.mouse.move(cx - 80, cy - 40)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 40, { steps: 14 })
    await page.mouse.up()
    await page.waitForTimeout(1000)

    // Nothing disables OrbitControls while picking, so the only thing keeping a
    // rotation from also selecting is the drag threshold.
    await expect(page.locator('[data-selected="true"]')).toHaveCount(0)
  })

  test('Identify off stops the tooltip appearing', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(2000)

    await page.locator('text=Identify on hover').locator('..').locator('label').click()
    await page.waitForTimeout(500)

    const box = await page.locator('canvas[data-engine]').boundingBox()
    for (let x = box.x + 400; x < box.x + 740; x += 20) {
      await page.mouse.move(x, box.y + box.height / 2)
      await page.waitForTimeout(180)
    }
    await expect(page.locator('[data-testid="feature-tooltip"]')).toHaveCount(0)
  })

  /** Opens a point layer's icon picker and returns its layer id. */
  async function openIconPicker(page, layerName) {
    const row = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: layerName }).first()
    const id = (await row.getAttribute('data-testid')).replace('vector-layer-', '')
    await row.locator('button', { hasText: layerName }).click()
    await page.waitForSelector(`[data-testid="icon-none-${id}"]`)
    return id
  }

  test('every bundled icon flattens into usable polylines', async ({ page }) => {
    // The flattener leans on the browser's own SVG geometry API rather than a
    // path parser, so the thing worth guarding is not the arithmetic but the
    // set: one icon whose subpaths are joined by a stray segment, or which
    // normalises outside the unit box, would be a visible defect on the terrain
    // and invisible here without this.
    await page.goto('http://localhost:5173')
    await page.waitForSelector('text=erzberg', { timeout: 30000 })

    const rows = await page.evaluate(async () => {
      const { flattenSvg } = await import('/src/utils/svgFlatten.js')
      const man = await (await fetch('/icons/manifest.json')).json()
      const out = []
      for (const { id } of man.icons) {
        const text = await (await fetch(`/icons/${id}.svg`)).text()
        try {
          const g = flattenSvg(text)
          let lo = Infinity, hi = -Infinity
          for (const p of g.polylines) for (let i = 0; i < p.length; i++) {
            if (p[i] < lo) lo = p[i]
            if (p[i] > hi) hi = p[i]
          }
          out.push({ id, polys: g.polylines.length, segs: g.segments, lo, hi })
        } catch (e) { out.push({ id, error: e.message }) }
      }
      return out
    })

    // The set is small and curated now, so the manifest is checkable in full
    // rather than by a floor: a file deleted without its entry, or an entry
    // without its file, is the failure this catches.
    expect(rows.length).toBe(16)
    for (const r of rows) {
      expect(r.error, `${r.id} failed to flatten`).toBeUndefined()
      // The lightest mark in the set is the star, at ten.
      expect(r.segs, `${r.id} drew nothing`).toBeGreaterThanOrEqual(1)
      // Normalised against the *viewBox*, so an icon drawn flush with its own
      // frame — danger runs a bone right to y = 15 of 15 — lands on the wall of
      // the box, and curve sampling can put it a thousandth past it.
      // The guard is against geometry escaping, not against that.
      expect(r.lo, `${r.id} escapes the unit box`).toBeGreaterThanOrEqual(-0.502)
      expect(r.hi, `${r.id} escapes the unit box`).toBeLessThanOrEqual(0.502)
    }
  })

  test('an icon replaces a point layer\'s dots, exactly', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    const dots = await segments(page)

    // A triangle flattens to a fixed 13 segments, so the arithmetic is exact
    // rather than merely "more": three point features lose three dots and gain
    // three glyphs. (It is also the surveyor's symbol for a summit, which is why
    // it is what a peak layer suggests.)
    const TRIANGLE_SEGMENTS = 13
    await page.click(`[data-testid="icon-${id}-triangle"]`)
    await expect.poll(() => segments(page), { timeout: 20000 })
      .toBe(dots - 3 + 3 * TRIANGLE_SEGMENTS)

    // Lift adds one leader line per feature and nothing else.
    await page.locator(`[data-testid="icon-lift-${id}"]`).fill('30')
    await expect.poll(() => segments(page), { timeout: 20000 })
      .toBe(dots - 3 + 3 * TRIANGLE_SEGMENTS + 3)

    await page.click(`[data-testid="icon-none-${id}"]`)
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(dots)
  })

  test('a fill at 100% hides what is behind it', async ({ page }) => {
    // The fill material used to be permanently `transparent` with `depthWrite`
    // off, so it stayed in the blended pass and everything drawn after it
    // composited over the top — 100% read as roughly half. Measured by how much
    // of the filled area is a single flat colour: blended, it takes a different
    // shade over every contour line behind it.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Water · Lake')
    await page.waitForTimeout(1500)

    const id = await isolateLayer(page, 'Water · Lake')
    await page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Water · Lake' })
      .first().locator('button', { hasText: 'Water · Lake' }).click()
    await page.waitForTimeout(2500)

    /** Share of the fill's pixels that are one single shade. */
    const flatness = () => page.evaluate(() => {
      const c = document.querySelector('canvas[data-engine]')
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      const px = new Uint8Array(c.width * c.height * 4)
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
      const seen = new Map()
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2]
        if (!(b > r + 20 && b > 60)) continue          // the lake's blue only
        const k = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3)
        seen.set(k, (seen.get(k) || 0) + 1)
      }
      const total = [...seen.values()].reduce((a, b) => a + b, 0)
      if (total < 400) return null                     // too small to judge
      const top = Math.max(...seen.values())
      return top / total
    })

    // Fill Op. is the last range control in the expanded row.
    const ranges = page.locator(`[data-testid="vector-layer-${id}"] input[type="range"]`)
    const last = (await ranges.count()) - 1

    await ranges.nth(last).fill('0.5')
    await page.waitForTimeout(2000)
    const blended = await flatness()
    expect(blended, 'the lake must be big enough on screen to measure').not.toBeNull()

    await ranges.nth(last).fill('1')
    await page.waitForTimeout(2000)
    const solid = await flatness()

    expect(solid, 'a fill at 100% must be one flat colour').toBeGreaterThan(0.5)
    expect(solid, 'and markedly flatter than the same fill at 50%').toBeGreaterThan(blended * 1.5)
  })

  test('an icon lands in the unit box wherever its viewBox starts', async ({ page }) => {
    // Normalisation is against the viewBox, and `getCTM` on a descendant already
    // carries that viewBox's own translate — so subtracting the origin here as
    // well moved an icon by half its own size and could put it outside the box
    // entirely. Every bundled icon starts at `0 0`, which is exactly why this
    // went unnoticed; an uploaded one need not.
    await page.goto('http://localhost:5173')
    await page.waitForSelector('text=erzberg', { timeout: 30000 })

    const box = await page.evaluate(async () => {
      const { flattenSvg } = await import('/src/utils/svgFlatten.js')
      const out = {}
      // The same circle three times, drawn against three different origins.
      for (const [name, vb, cx, cy] of [
        ['zero', '0 0 24 24', 12, 12],
        ['negative', '-12 -12 24 24', 0, 0],
        ['positive', '10 10 24 24', 22, 22],
      ]) {
        const g = flattenSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">` +
                             `<circle cx="${cx}" cy="${cy}" r="10" fill="black"/></svg>`)
        let lo = Infinity, hi = -Infinity
        for (const p of g.polylines) for (let i = 0; i < p.length; i++) {
          if (p[i] < lo) lo = p[i]
          if (p[i] > hi) hi = p[i]
        }
        out[name] = { lo: +lo.toFixed(3), hi: +hi.toFixed(3) }
      }
      return out
    })

    // r = 10 in a 24-unit box is ±0.417, wherever that box's corner happens
    // to be.
    for (const [name, b] of Object.entries(box)) {
      expect(b.lo, `${name} origin`).toBeCloseTo(-0.417, 2)
      expect(b.hi, `${name} origin`).toBeCloseTo(0.417, 2)
    }
  })

  test('the plain marks are one ring each, not two', async ({ page }) => {
    // Maki draws everything filled, including its `-stroked` variants: a stroked
    // circle is a filled *band*, so flattening traces both of its edges and
    // draws two concentric rings where one was meant, at twice the segments.
    // The solid variant is the one that flattens to the single ring wanted, and
    // this is what stops the wrong one being swapped in later.
    await page.goto('http://localhost:5173')
    await page.waitForSelector('text=erzberg', { timeout: 30000 })

    const geo = await page.evaluate(async () => {
      const { flattenSvg } = await import('/src/utils/svgFlatten.js')
      const man = await (await fetch('/icons/manifest.json')).json()
      const out = { ids: man.icons.map((i) => i.id), rings: {} }
      for (const id of ['circle', 'square', 'triangle', 'star']) {
        const g = flattenSvg(await (await fetch(`/icons/${id}.svg`)).text())
        out.rings[id] = g.polylines.length
      }
      return out
    })

    for (const [id, rings] of Object.entries(geo.rings)) {
      expect(rings, `${id} should be a single ring`).toBe(1)
    }
    expect(geo.ids.filter((id) => id.endsWith('-stroked')),
      'a -stroked variant flattens to a double line').toEqual([])
  })

  test('an icon arrives filled, in its own colour, and the fill stays out of the SVG', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    const bare = await triangles(page)
    await page.click(`[data-testid="icon-${id}-triangle"]`)
    await page.waitForTimeout(2000)

    // The icons are a map set drawn as silhouettes, so they are solid on
    // arrival rather than after a toggle — a hollow outline of a mountain is a
    // wireframe of the mark, not the mark.
    const filled = await triangles(page)
    expect(filled, 'choosing an icon fills it').toBeGreaterThan(bare)

    // Solid in the layer's own colour, at full opacity: the 45% an area fill
    // starts at is right for a lake seen through contours and wrong for a glyph.
    const swatch = page.locator(`[data-testid="vector-layer-${id}"] input[type="color"]`)
    expect(await swatch.nth(1).inputValue()).toBe(await swatch.first().inputValue())
    expect(await page.locator(`[data-testid="icon-fill-opacity-${id}"]`).inputValue()).toBe('1')

    // The SVG is a line-art format; a fill is triangles and has no business there.
    await page.evaluate(() => document.activeElement?.blur())
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.keyboard.press('Digit1'),
    ])
    let svg = ''
    for await (const chunk of await download.createReadStream()) svg += chunk
    const group = svg.match(/<g[^>]*inkscape:label="[^"]*Peaks[^"]*icons"[^>]*>([\s\S]*?)<\/g>/)
    expect(group, 'the icon layer must still export').not.toBeNull()
    expect(group[1]).toContain('<line')
    expect(group[1]).not.toContain('<polygon')

    // Switching Fill off leaves the outline, which is what a plotter draws.
    await page.locator(`[data-testid="icon-fill-${id}"] label`).click()
    await expect.poll(() => triangles(page), { timeout: 20000 }).toBe(bare)
  })

  test('a point layer is labelled with the names and heights it actually has', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    const dots = await segments(page)

    // The fixture's three summits are the whole point of the arithmetic: two
    // carry a name and an `ele`, and one carries neither. Text is deterministic
    // — the same string flattens to the same segment count every time — so the
    // expected totals can be computed from the strings themselves, and a peak
    // with nothing to say is caught by simply not being in them.
    const cost = await page.evaluate(async () => {
      const { loadTextFont, textPolylines } = await import('/src/utils/textGeometry.js')
      const font = await loadTextFont()
      const of = (t) => textPolylines(t, font).segments
      return {
        names: of('Polster') + of('Steinfeldspitze-Südwest-Gipfel'),
        heights: of('1910m') + of('2280m'),
      }
    })
    expect(cost.names).toBeGreaterThan(0)

    await page.locator(`[data-testid="label-name-${id}"] label`).click()
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(dots + cost.names)

    await page.locator(`[data-testid="label-height-${id}"] label`).click()
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(dots + cost.names + cost.heights)

    // The height stands on its own — a plot of spot elevations is a real thing.
    await page.locator(`[data-testid="label-name-${id}"] label`).click()
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(dots + cost.heights)

    // And off is off, with no residue.
    await page.locator(`[data-testid="label-height-${id}"] label`).click()
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(dots)
  })

  test('the lettering has its own stroke, independent of the marks', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    await page.click(`[data-testid="icon-${id}-triangle"]`)
    await page.locator(`[data-testid="label-name-${id}"] label`).click()
    await page.locator(`[data-testid="label-weight-${id}"]`).fill('5')
    await page.waitForTimeout(2000)

    /** The stroke-width the SVG gives one pen layer. */
    const strokeOf = (svg, suffix) => {
      const g = svg.match(new RegExp(`<g[^>]*inkscape:label="[^"]*Peaks[^"]*${suffix}"[^>]*>([\\s\\S]*?)</g>`))
      return g ? Number(g[1].match(/stroke-width="([\d.]+)"/)?.[1]) : null
    }

    const download = async () => {
      await page.evaluate(() => document.activeElement?.blur())
      const [d] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.keyboard.press('Digit1'),
      ])
      let svg = ''
      for await (const chunk of await d.createReadStream()) svg += chunk
      return svg
    }

    const svg = await download()
    const icons = strokeOf(svg, 'icons')
    const labels = strokeOf(svg, 'labels')
    expect(icons, 'the icon layer must export').toBeGreaterThan(0)
    expect(labels, 'the label layer must export').toBeGreaterThan(0)
    // A stroke that draws a summit triangle well closes up the counters of
    // small type, which is the whole reason the two are separate numbers.
    expect(labels).not.toBe(icons)

    // …and the label's own slider is what moves it.
    await page.locator(`[data-testid="label-weight-${id}"]`).fill('1')
    await page.waitForTimeout(1500)
    const thin = strokeOf(await download(), 'labels')
    expect(thin).toBeLessThan(labels)
    expect(strokeOf(await download(), 'icons')).toBe(icons)
  })

  test('the lettering has its own colour and opacity', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    await page.click(`[data-testid="icon-${id}-triangle"]`)
    await page.locator(`[data-testid="label-name-${id}"] label`).click()
    await page.waitForTimeout(2000)

    /** What one pen layer draws with: its stroke colour and its opacity. */
    const penOf = (svg, suffix) => {
      const g = svg.match(new RegExp(`<g[^>]*inkscape:label="[^"]*Peaks[^"]*${suffix}"[^>]*>([\\s\\S]*?)</g>`))
      if (!g) return null
      return {
        stroke: g[1].match(/stroke="(#[0-9a-fA-F]{6})"/)?.[1]?.toLowerCase(),
        opacity: Number(g[1].match(/opacity="([\d.]+)"/)?.[1]),
      }
    }
    const download = async () => {
      await page.evaluate(() => document.activeElement?.blur())
      const [d] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.keyboard.press('Digit1'),
      ])
      let svg = ''
      for await (const chunk of await d.createReadStream()) svg += chunk
      return svg
    }

    // Untouched, a label is its layer: same ink, same opacity as the mark.
    const before = await download()
    expect(penOf(before, 'labels').stroke).toBe(penOf(before, 'icons').stroke)
    expect(penOf(before, 'labels').opacity).toBeCloseTo(penOf(before, 'icons').opacity, 3)

    await page.locator(`[data-testid="label-color-${id}"]`).fill('#00ff00')
    await page.locator(`[data-testid="label-opacity-${id}"]`).fill('0.4')
    await page.waitForTimeout(1500)

    const after = await download()
    expect(penOf(after, 'labels').stroke).toBe('#00ff00')
    expect(penOf(after, 'labels').opacity).toBeCloseTo(0.4, 3)
    // …and the marks it labels are untouched by either.
    expect(penOf(after, 'icons')).toEqual(penOf(before, 'icons'))

    // Match layer puts both back rather than leaving a colour that only looks
    // like the layer's until the layer changes.
    await page.click(`[data-testid="label-match-${id}"]`)
    await page.waitForTimeout(1500)
    const reset = await download()
    expect(penOf(reset, 'labels')).toEqual(penOf(before, 'labels'))
  })

  test('the icon and the labels carry six inks each, and neither touches the other', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    await page.click(`[data-testid="icon-${id}-triangle"]`)
    await page.locator(`[data-testid="label-name-${id}"] label`).click()
    await page.waitForTimeout(2000)

    const val = (what) => page.locator(`[data-testid="${what}-${id}"]`).inputValue()
    const penOf = (svg, suffix) => {
      const g = svg.match(new RegExp(`<g[^>]*inkscape:label="[^"]*Peaks[^"]*${suffix}"[^>]*>([\\s\\S]*?)</g>`))
      if (!g) return null
      return {
        stroke: g[1].match(/stroke="(#[0-9a-fA-F]{6})"/)?.[1]?.toLowerCase(),
        width: Number(g[1].match(/stroke-width="([\d.]+)"/)?.[1]),
        opacity: Number(g[1].match(/opacity="([\d.]+)"/)?.[1]),
      }
    }
    const download = async () => {
      await page.evaluate(() => document.activeElement?.blur())
      const [d] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.keyboard.press('Digit1'),
      ])
      let svg = ''
      for await (const chunk of await d.createReadStream()) svg += chunk
      return svg
    }

    // Six controls each, set to six different values.
    await page.locator(`[data-testid="icon-color-${id}"]`).fill('#ff00ff')
    await page.locator(`[data-testid="icon-weight-${id}"]`).fill('4')
    await page.locator(`[data-testid="icon-opacity-${id}"]`).fill('0.5')
    await page.locator(`[data-testid="icon-fill-color-${id}"]`).fill('#ff0000')
    await page.locator(`[data-testid="icon-fill-opacity-${id}"]`).fill('0.25')

    await page.locator(`[data-testid="label-color-${id}"]`).fill('#00ff00')
    await page.locator(`[data-testid="label-weight-${id}"]`).fill('1')
    await page.locator(`[data-testid="label-opacity-${id}"]`).fill('0.9')
    await page.locator(`[data-testid="label-fill-color-${id}"]`).fill('#0000ff')
    await page.locator(`[data-testid="label-fill-opacity-${id}"]`).fill('0.75')
    await page.waitForTimeout(1500)

    // The three stroke inks are visible in the export, per pen layer.
    const svg = await download()
    expect(penOf(svg, 'icons')).toEqual({ stroke: '#ff00ff', width: expect.any(Number), opacity: 0.5 })
    expect(penOf(svg, 'labels').stroke).toBe('#00ff00')
    expect(penOf(svg, 'labels').opacity).toBeCloseTo(0.9, 3)
    expect(penOf(svg, 'labels').width).toBeLessThan(penOf(svg, 'icons').width)

    // The three fill inks are not — a fill is triangles and the SVG is line art
    // — so they are checked where they live.
    expect(await val('icon-fill-color')).toBe('#ff0000')
    expect(await val('icon-fill-opacity')).toBe('0.25')
    expect(await val('label-fill-color')).toBe('#0000ff')
    expect(await val('label-fill-opacity')).toBe('0.75')

    // Each mark's fill can be switched off without touching the other's.
    await page.locator(`[data-testid="icon-fill-${id}"] label`).click()
    await page.waitForTimeout(500)
    expect(await val('label-fill-color')).toBe('#0000ff')

    // Match layer returns one mark to the layer's ink and leaves the other.
    const layerColor = (await page.locator(`[data-testid="vector-layer-${id}"] input[type="color"]`)
      .first().inputValue()).toLowerCase()
    await page.click(`[data-testid="icon-match-${id}"]`)
    await page.waitForTimeout(1500)
    const after = await download()
    expect(penOf(after, 'icons').stroke).toBe(layerColor)
    expect(penOf(after, 'labels').stroke).toBe('#00ff00')
    // …and the width, which is the mark's own number rather than the layer's,
    // survives Match layer: it is ink, not inheritance.
    expect(penOf(after, 'icons').width).toBe(penOf(svg, 'icons').width)
  })

  test('a mark\'s fill and its own stroke keep a fixed order', async ({ page }) => {
    // Two things at once, because they are the same measurement.
    //
    // *Where the stroke sits*: centred straddles the shape's edge, so it takes
    // half its width out of the fill; outside lies entirely beyond the edge and
    // leaves the fill whole. So the fill's own area, and the mark's silhouette,
    // are both larger with an outside stroke.
    //
    // *That the order is fixed at all*: a mark's fill and its stroke are exactly
    // coplanar, and a wide stroke is a screen-space quad whose depth is
    // interpolated across its width — so a fill that writes depth wins on some
    // pixels and loses on others, and the mark comes out a patchwork. When that
    // was happening, the fill's area did not change between the two modes at
    // all, because depth decided instead of `renderOrder`. This measures that it
    // does change, which is the same thing as saying the order is settled.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    // One feature, lifted clear of the terrain: overlapping marks would have
    // each one's fill covering its neighbour's stroke, and the areas below
    // would stop meaning what they say.
    const id = await isolateLayer(page, 'Peaks')
    await page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Peaks' })
      .first().locator('button', { hasText: 'Peaks' }).click()
    await page.click(`[data-testid="features-toggle-${id}"]`)
    await page.click(`[data-testid="feature-none-${id}"]`)
    await page.click(`[data-testid="feature-check-${id}-0"]`)
    await page.click(`[data-testid="icon-${id}-circle"]`)
    await page.locator(`[data-testid="icon-size-${id}"]`).fill('80')
    await page.locator(`[data-testid="icon-lift-${id}"]`).fill('120')
    await page.locator(`[data-testid="icon-weight-${id}"]`).fill('8')
    await page.locator(`[data-testid="icon-fill-color-${id}"]`).fill('#00ff00')
    await page.locator(`[data-testid="icon-color-${id}"]`).fill('#0000ff')
    await page.waitForTimeout(2500)

    /**
     * Pixels of the stroke's blue and the fill's green, which nothing else in
     * this scene draws — the terrain is grey and the one road is red.
     *
     * Classified by which channel dominates rather than by the hex that was
     * typed in: the scene is tone-mapped, so the fill's `#00ff00` reaches the
     * buffer as `147,228,89`. The axis gizmo is cut out because it is drawn in
     * its own overlay pass, *isn't* tone-mapped, and is green.
     */
    const ink = () => page.evaluate(() => {
      const c = document.querySelector('canvas[data-engine]')
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      const px = new Uint8Array(c.width * c.height * 4)
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
      let stroke = 0, fill = 0
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (x < 260 && y < 260) continue                    // the gizmo's corner
          const i = (y * c.width + x) * 4
          const r = px[i], g = px[i + 1], b = px[i + 2]
          if (b > r + 40 && b > g + 40) stroke++
          if (g > r + 40 && g > b + 40) fill++
        }
      }
      return { stroke, fill }
    })

    const outside = await ink()
    expect(outside.fill, 'the mark must be on screen').toBeGreaterThan(250)
    expect(outside.stroke).toBeGreaterThan(250)

    await page.click(`[data-testid="icon-stroke-centred-${id}"]`)
    await page.waitForTimeout(2000)
    const centred = await ink()

    // Half the stroke width off every edge of a disc this size is a fifth of it.
    expect(centred.fill).toBeLessThan(outside.fill * 0.9)
    // …and the whole mark is smaller, because outside grows it by that width.
    expect(centred.fill + centred.stroke).toBeLessThan(outside.fill + outside.stroke)

    // The export is unmoved by any of it: a plotter draws one pass along the
    // outline whichever side of it the screen puts the ink on, so what it
    // carries is the width the slider says, not the doubled one the screen used.
    await page.click(`[data-testid="icon-stroke-outside-${id}"]`)
    await page.waitForTimeout(1000)
    await page.evaluate(() => document.activeElement?.blur())
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.keyboard.press('Digit1'),
    ])
    let svg = ''
    for await (const chunk of await download.createReadStream()) svg += chunk
    const g = svg.match(/<g[^>]*inkscape:label="[^"]*Peaks[^"]*icons"[^>]*>([\s\S]*?)<\/g>/)
    expect(Number(g[1].match(/stroke-width="([\d.]+)"/)[1])).toBeCloseTo(4, 3)
  })

  test('a mark\'s fill and its stroke are cut by the terrain in one place', async ({ page }) => {
    // The bug this pins down: a mark is a flat drawing planted on a rough
    // surface, so the terrain cuts through its plane — and the two halves of the
    // mark were being cut in different places, because the fill carried a
    // `polygonOffset` toward the camera and the stroke carried none. Along that
    // intersection the fill survived where the stroke was rejected, and the mark
    // came apart into patches of fill and patches of stroke that moved as the
    // camera moved.
    //
    // Reading it off the screen would mean measuring raggedness, which is a
    // fragile thing to assert. The invariant is not: the two materials must
    // agree about depth. three announces its scene to a devtools hook, so
    // stubbing one before the app loads is enough to walk it and ask them.
    await page.addInitScript(() => {
      // Every scene, not the last one: the view gizmo renders in its own, and
      // it is not the one the terrain is in.
      window.__scenes = []
      window.__THREE_DEVTOOLS__ = {
        dispatchEvent(e) { if (e.detail?.isScene) window.__scenes.push(e.detail) },
      }
    })
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    await page.click(`[data-testid="icon-${id}-triangle"]`)
    await page.locator(`[data-testid="label-name-${id}"] label`).click()
    await page.waitForTimeout(2500)

    const marks = await page.evaluate(() => {
      const out = {}
      const visit = (o) => {
        const kind = o.userData?.vectorLayerId?.split('#')[1]
        if (!kind || !o.material) return
        // The mark's fill is the mesh beside its lines, in the same group.
        const fill = o.parent?.children.find((c) => c.isMesh && c.material?.isMeshBasicMaterial)
        out[kind] = {
          strokeOffset: o.material.polygonOffset ? o.material.polygonOffsetUnits : 0,
          strokeOffsetFactor: o.material.polygonOffset ? o.material.polygonOffsetFactor : 0,
          fillOffset: fill?.material.polygonOffset ? fill.material.polygonOffsetUnits : null,
          fillOffsetFactor: fill?.material.polygonOffset ? fill.material.polygonOffsetFactor : null,
          fillDepthWrite: fill?.material.depthWrite ?? null,
          fillOpacity: fill?.material.opacity ?? null,
        }
      }
      for (const s of window.__scenes ?? []) s.traverse(visit)
      return out
    })

    for (const kind of ['icons', 'labels']) {
      const m = marks[kind]
      expect(m, `${kind} must be in the scene`).toBeTruthy()
      // Biased toward the camera, and by the same amount on both, or the
      // terrain cuts one before the other.
      expect(m.strokeOffset, `${kind} stroke must be biased`).toBeLessThan(0)
      expect(m.fillOffset, `${kind} fill must match its stroke`).toBe(m.strokeOffset)
      expect(m.fillOffsetFactor).toBe(m.strokeOffsetFactor)
      // …and the fill must not write depth even when it is opaque, or it
      // rejects its own stroke per-pixel and which of the two you see stops
      // being a decision and starts being a coin toss.
      expect(m.fillOpacity, 'the fill is opaque here').toBeGreaterThan(0.99)
      expect(m.fillDepthWrite, `${kind} fill must not write depth`).toBe(false)
    }
  })

  test('labels can be set in another face', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    const dots = await segments(page)

    // Regular is the default, and each face is its own file rather than a slant
    // applied to one of them — so the same string flattens to a different
    // drawing, and the segment count is the cheapest proof of that.
    const cost = await page.evaluate(async () => {
      const { loadTextFont, textPolylines } = await import('/src/utils/textGeometry.js')
      const out = {}
      for (const face of ['regular', 'bold', 'italic', 'bolditalic']) {
        const font = await loadTextFont(face)
        out[face] = textPolylines('Polster', font).segments +
                    textPolylines('Steinfeldspitze-Südwest-Gipfel', font).segments
      }
      return out
    })
    expect(cost.bold).not.toBe(cost.regular)
    expect(cost.italic).not.toBe(cost.regular)

    await page.locator(`[data-testid="label-name-${id}"] label`).click()
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(dots + cost.regular)

    await page.click(`[data-testid="label-bold-${id}"]`)
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(dots + cost.bold)

    await page.click(`[data-testid="label-italic-${id}"]`)
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(dots + cost.bolditalic)

    await page.click(`[data-testid="label-bold-${id}"]`)
    await expect.poll(() => segments(page), { timeout: 20000 }).toBe(dots + cost.italic)
  })

  test('a label sits in its own layer\'s slot in the stack', async ({ page }) => {
    // Labels are appended to the geometry rather than substituted into it, and
    // `renderOrder` is built from the array index — so an entry tacked onto the
    // end draws in front of the whole scene. Dragging a labelled layer to the
    // bottom would then send its marks behind everything and leave its lettering
    // on top of everything.
    //
    // The SVG writes one pen layer per entry, in paint order, so the export is
    // where that order can be read back.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('[data-testid^="vector-layer-"]')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    await page.locator(`[data-testid="label-name-${id}"] label`).click()
    await page.waitForTimeout(2000)

    await page.evaluate(() => document.activeElement?.blur())
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.keyboard.press('Digit1'),
    ])
    let svg = ''
    for await (const chunk of await download.createReadStream()) svg += chunk

    const pens = [...svg.matchAll(/inkscape:label="([^"]*)"/g)].map((m) => m[1])
    const peaks = pens.indexOf('Peaks')
    const labels = pens.indexOf('Peaks · labels')
    expect(peaks, 'the layer must export').toBeGreaterThanOrEqual(0)
    expect(labels, 'and so must its labels').toBeGreaterThanOrEqual(0)
    // Directly behind its own layer, not at the end of the list.
    expect(labels).toBe(peaks + 1)

    // Peaks starts at the top of the stack, so "last" and "in its own slot"
    // look the same from here. Drag it to the bottom and they part company: the
    // lettering has to go to the *back* of the drawing with its layer.
    // Collapse the row first: an expanded layer is several times the height of
    // a collapsed one, and the drag is raw pointer coordinates.
    await page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Peaks' })
      .first().locator('button', { hasText: 'Peaks' }).click()
    await page.waitForTimeout(500)

    const ids = await stackIds(page)
    // Pull the bottom layer to the top rather than pushing Peaks down: either
    // way something ends up above Peaks, which is all this needs, and this is
    // the direction the drag helper is exercised in elsewhere.
    await dragLayer(page, ids[ids.length - 1], ids[0])
    await expect.poll(() => stackIds(page).then((s) => s[0])).toBe(ids[ids.length - 1])
    await page.waitForTimeout(1500)

    const pens2 = await exportedPenLayers(page)
    expect(pens2.indexOf('Peaks · labels')).toBe(pens2.indexOf('Peaks') + 1)
    expect(pens2.indexOf('Peaks · labels'), 'behind everything the stack puts above it')
      .toBeLessThan(pens2.length - 1)
  })

  test('labels export as strokes, in their own pen layer', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    await page.locator(`[data-testid="label-name-${id}"] label`).click()
    await page.waitForTimeout(2000)

    await page.evaluate(() => document.activeElement?.blur())
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.keyboard.press('Digit1'),
    ])
    let svg = ''
    for await (const chunk of await download.createReadStream()) svg += chunk

    // Its own Inkscape layer, so the lettering can be a different pen from the
    // marks it labels — which is most of the reason to plot at all.
    const group = svg.match(/<g[^>]*inkscape:label="[^"]*Peaks[^"]*labels"[^>]*>([\s\S]*?)<\/g>/)
    expect(group, 'the label layer must export').not.toBeNull()
    expect(group[1]).toContain('<line')
    // Filled type is triangles, and the SVG is a line-art format.
    expect(group[1]).not.toContain('<polygon')
  })

  test('a glyph is filled with its holes cut out', async ({ page }) => {
    // Maki draws filled silhouettes, so what the flattener returns is a set of
    // fill *boundaries*: the skull's outline, and separately its eye sockets and
    // its teeth. Triangulating those blindly fills the sockets in, and a solid
    // oval is not a skull. Measured as area rather than by eye: with the holes
    // cut, the filled area is strictly less than the sum of every ring.
    await page.goto('http://localhost:5173')
    await page.waitForSelector('text=erzberg', { timeout: 30000 })

    const area = await page.evaluate(async () => {
      const { flattenSvg } = await import('/src/utils/svgFlatten.js')
      const { iconTriangles } = await import('/src/hooks/useVectorIcons.js')
      const out = {}
      for (const id of ['danger', 'mountain', 'triangle']) {
        const g = flattenSvg(await (await fetch(`/icons/${id}.svg`)).text())
        let filled = 0
        for (const sh of iconTriangles(g)) {
          for (let t = 0; t < sh.tris.length; t += 3) {
            const a = sh.tris[t] * 2, b = sh.tris[t + 1] * 2, c = sh.tris[t + 2] * 2
            filled += Math.abs((sh.pts[b] - sh.pts[a]) * (sh.pts[c + 1] - sh.pts[a + 1]) -
                               (sh.pts[c] - sh.pts[a]) * (sh.pts[b + 1] - sh.pts[a + 1])) / 2
          }
        }
        let gross = 0
        for (const p of g.polylines) {
          let s = 0
          for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
            s += p[j] * p[i + 1] - p[i] * p[j + 1]
          }
          gross += Math.abs(s) / 2
        }
        out[id] = { filled, gross }
      }
      return out
    })

    // The skull loses its sockets and teeth; the mountain loses its inner peak.
    expect(area.danger.filled, 'the skull keeps its eye sockets').toBeLessThan(area.danger.gross * 0.95)
    expect(area.mountain.filled, 'the mountain keeps its inner peak').toBeLessThan(area.mountain.gross * 0.95)
    // …and a mark with no hole loses nothing, which is what rules out a
    // triangulator that simply drops geometry it cannot place.
    expect(area.triangle.filled).toBeCloseTo(area.triangle.gross, 5)
    expect(area.danger.filled).toBeGreaterThan(0)
  })

  test('an icon exports as strokes, not as a circle per feature', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')

    const peaksGroup = async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.keyboard.press('Digit1'),
      ])
      const stream = await download.createReadStream()
      let svg = ''
      for await (const chunk of stream) svg += chunk
      return [...svg.matchAll(/<g[^>]*inkscape:label="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g)]
        .filter((m) => m[1].includes('Peaks'))
    }

    const asDots = await peaksGroup()
    expect(asDots.length).toBe(1)
    expect(asDots[0][2]).toContain('<circle')

    await page.click(`[data-testid="icon-${id}-triangle"]`)
    await page.waitForTimeout(2500)

    const asIcons = await peaksGroup()
    expect(asIcons.length).toBe(1)
    // Its own pen layer name, and strokes — a plotter can draw this.
    expect(asIcons[0][1]).toContain('icons')
    expect(asIcons[0][2]).toContain('<line')
    expect(asIcons[0][2]).not.toContain('<circle')
  })

  test('Match view aims the icons at the camera, and Face camera follows it', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    await page.click(`[data-testid="icon-${id}-triangle"]`)
    await page.locator(`[data-testid="icon-size-${id}"]`).fill('60')
    await page.waitForTimeout(2000)

    // Compared through the exported geometry rather than through pixels: the
    // claim is that the same angles produce the same lines, and an SVG says so
    // exactly where a PNG only says "these two frames encoded differently".
    const drawn = async () => {
      // The export shortcuts ignore keys aimed at an input, and `fill()` leaves
      // the focus in the slider it just moved.
      await page.evaluate(() => document.activeElement?.blur())
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.keyboard.press('Digit1'),
      ])
      const stream = await download.createReadStream()
      let svg = ''
      for await (const chunk of stream) svg += chunk
      const g = svg.match(/<g[^>]*inkscape:label="[^"]*Peaks[^"]*icons"[^>]*>([\s\S]*?)<\/g>/)
      expect(g, 'the icon layer must be in the SVG').not.toBeNull()
      return g[1]
    }

    const facing = await drawn()

    // Off, and aimed flat at the ground: the glyphs foreshorten, so the drawing
    // must change.
    await page.locator('text=Face camera').locator('..').locator('label').click()
    await page.locator(`[data-testid="icon-tilt-${id}"]`).fill('0')
    await page.waitForTimeout(2000)
    expect(await drawn(), 'tilt must change what is drawn').not.toBe(facing)

    // Match view snaps the manual angles onto the camera's own, which must
    // reproduce exactly what Face camera was drawing.
    await page.click(`[data-testid="icon-match-${id}"]`)
    await page.waitForTimeout(2000)
    expect(await page.locator(`[data-testid="icon-tilt-${id}"]`).inputValue()).toBe('50')
    expect(await page.locator(`[data-testid="icon-spin-${id}"]`).inputValue()).toBe('0')
    expect(await drawn(), 'matching the view must reproduce what Face camera drew').toBe(facing)
  })

  test('a custom SVG becomes the icon; one with no geometry is refused', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    const dots = await segments(page)

    // Two subpaths and a curve — the case a naive `d`-splitting flattener joins
    // with a stray segment, and the case an arc-free one gets wrong.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<path d="M2 20 L12 4 L22 20 Z m2 -4 a3 3 0 0 1 6 0"/></svg>'
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click(`[data-testid="icon-upload-${id}"]`),
    ])
    await chooser.setFiles({ name: 'peak.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })

    await page.waitForSelector(`[data-testid="icon-${id}-custom"]`, { timeout: 10000 })
    await expect.poll(() => segments(page), { timeout: 20000 }).toBeGreaterThan(dots)

    // A well-formed SVG with nothing drawable is a message, not a silent
    // empty layer.
    const empty = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>nothing</title></svg>'
    const [chooser2] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click(`[data-testid="icon-upload-${id}"]`),
    ])
    await chooser2.setFiles({ name: 'blank.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(empty) })
    await expect(page.locator('text=/no lines, curves or shapes/')).toHaveCount(1, { timeout: 10000 })
  })

  test('a second upload under the same file name still redraws', async ({ page }) => {
    // The memo that builds icon geometry keys a custom glyph by its file name,
    // and two uploads can easily share one — `icon.svg`, `Untitled.svg`. Without
    // something to tell them apart the memo does not re-run, and the *old*
    // drawing keeps being drawn until some unrelated field is touched.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('[data-testid^="vector-layer-"]')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    const dots = await segments(page)

    const upload = async (body) => {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click(`[data-testid="icon-upload-${id}"]`),
      ])
      // The same name both times, which is the whole point.
      await chooser.setFiles({ name: 'mark.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(body) })
      await page.waitForSelector(`[data-testid="icon-${id}-custom"]`, { timeout: 10000 })
      await page.waitForTimeout(1500)
      return segments(page)
    }

    // A triangle: three segments per feature, over three features.
    const tri = await upload('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<path d="M4 20 L20 20 L12 4 Z" fill="none" stroke="black"/></svg>')
    expect(tri).toBe(dots - 3 + 3 * 3)

    // A single stroke: one segment per feature. Same name, different drawing.
    const dash = await upload('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<path d="M4 12 L20 12" fill="none" stroke="black"/></svg>')
    expect(dash, 'the second upload must replace the first').toBe(dots - 3 + 3 * 1)
  })

  test('an icon is still pickable, and names its own feature', async ({ page }) => {
    // The icon layer carries a rebuilt segment→feature map, so a glyph has to
    // answer for the summit its dot stood on.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Peaks')
    await page.waitForTimeout(1500)

    await isolateLayer(page, 'Peaks')
    const id = await openIconPicker(page, 'Peaks')
    await page.click(`[data-testid="icon-${id}-triangle"]`)
    await page.locator(`[data-testid="icon-size-${id}"]`).fill('60')
    await page.waitForTimeout(2500)

    const box = await page.locator('canvas[data-engine]').boundingBox()
    const tip = page.locator('[data-testid="feature-tooltip"]')
    const cx = box.x + box.width / 2, cy = box.y + box.height * 0.53

    let name = null
    outer:
    for (let dy = -110; dy <= 110 && !name; dy += 18) {
      for (let dx = -110; dx <= 110; dx += 18) {
        await page.mouse.move(cx + dx, cy + dy)
        await page.waitForTimeout(165)
        if (await tip.count()) { name = await tip.getAttribute('data-feature-name'); break outer }
      }
    }
    expect(name, 'an icon must be pointable at').not.toBeNull()

    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(1200)
    const selected = page.locator('[data-selected="true"]')
    await expect(selected).toHaveCount(1)
    await expect(selected.first()).toContainText(name)
  })

  test('a query OpenStreetMap rejects is not asked of every mirror', async ({ page }) => {
    // 429 and 504 are about the server; anything else is about the query, and
    // asking three more volunteers the same bad question only wastes their
    // bandwidth. The `throw` that enforced that used to land in this very
    // function's own `catch`, which files anything that is not an abort as
    // "that mirror failed" and moves on — so the loop ran the whole list.
    let calls = 0
    await page.route('**/api/interpreter', async (route) => {
      calls++
      await route.fulfill({ status: 400, contentType: 'text/plain', body: 'Bad Request' })
    })
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=/returned 400/', { timeout: 30000 })
    expect(calls, 'one endpoint asked, not the whole list').toBe(1)
  })

  test('a busy endpoint is worth asking the next one', async ({ page }) => {
    // The other half of the same rule: 429 says the mirror is busy, so the next
    // one gets the same question — and this is what stops the fix above from
    // being "give up on the first refusal".
    let calls = 0
    await page.route('**/api/interpreter', async (route) => {
      calls++
      if (calls === 1) {
        await route.fulfill({ status: 429, contentType: 'text/plain', body: 'Too Many Requests' })
      } else {
        await route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify(overpassFixture()),
        })
      }
    })
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    // The layer row, not the category chip — "Peaks & summits" is on screen
    // before any fetch happens.
    await page.waitForSelector('[data-testid^="vector-layer-"]', { timeout: 30000 })
    expect(calls, 'the busy one, then the next').toBe(2)
  })

  test('a preset carries a look, not a glyph, and says which way its stack reads', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('[data-testid^="vector-layer-"]')
    await page.waitForTimeout(1500)

    const id = await openIconPicker(page, 'Peaks')
    await page.click(`[data-testid="icon-${id}-triangle"]`)

    // An uploaded glyph, which is the thing that must *not* travel.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
                '<path d="M4 20 L12 4 L20 20 Z" fill="none" stroke="black"/></svg>'
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click(`[data-testid="icon-upload-${id}"]`),
    ])
    await chooser.setFiles({ name: 'mine.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })
    await page.waitForSelector(`[data-testid="icon-${id}-custom"]`, { timeout: 10000 })
    await page.waitForTimeout(1000)

    await page.evaluate(() => document.activeElement?.blur())
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.click('button:has-text("Preset ⬇")'),
    ])
    let text = ''
    for await (const chunk of await download.createReadStream()) text += chunk
    const preset = JSON.parse(text)

    // Written top-of-stack first, and saying so: the same array used to be
    // written ground-cover first, and reading one of those as a stack order
    // turns the picture inside out.
    expect(preset.vectorStackOrder, 'the order must be declared').toBe(true)

    // `iconCustom` holds typed arrays, which JSON writes as `{"0":…}` objects
    // with no length — every loop over them would run zero times and the layer
    // would draw neither its icon nor its dots. It does not travel, and `icon`
    // falls back with it rather than pointing at a glyph that is not there.
    for (const v of preset.vectorStyles) {
      expect(v.iconCustom, 'a preset is a look, not an upload').toBeUndefined()
      expect(v.icon, 'and never points at a glyph it does not carry').not.toBe('custom')
    }
    // The rest of the look is still there.
    expect(preset.vectorStyles.some((v) => v.iconFill !== undefined)).toBe(true)
  })

  test('Cancel abandons a fetch without adding layers', async ({ page }) => {
    await routeOverpass(page, overpassFixture(), 3000)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=✕ Cancel')
    await page.click('[data-testid="osm-fetch"]')          // now the Cancel button

    await page.waitForTimeout(1000)
    const body = await page.innerText('body')
    expect(body).not.toContain('Roads · Motorway')
    expect(body).toContain('Fetch from OpenStreetMap')
  })

  test('a GeoJSON upload becomes a layer named after its file', async ({ page }) => {
    await openVectorPanel(page)
    const doc = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [[INSIDE.lon, INSIDE.lat], [INSIDE.lon + 0.005, INSIDE.lat + 0.003]],
        },
      }],
    }
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-testid="load-geojson"]'),
    ])
    await chooser.setFiles({
      name: 'ridge.geojson', mimeType: 'application/geo+json',
      buffer: Buffer.from(JSON.stringify(doc)),
    })
    await page.waitForSelector('text=ridge.geojson', { timeout: 10000 })
    // One geometry class in the file, so no "· Lines" suffix.
    expect(await page.innerText('body')).not.toContain('ridge.geojson · Lines')
  })

  test('a GeoJSON in a projected CRS is refused rather than drawn in the wrong place', async ({ page }) => {
    await openVectorPanel(page)
    const doc = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32633' } },
      features: [{
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: [[491216, 5264437], [491316, 5264537]] },
      }],
    }
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-testid="load-geojson"]'),
    ])
    await chooser.setFiles({
      name: 'utm.geojson', mimeType: 'application/geo+json',
      buffer: Buffer.from(JSON.stringify(doc)),
    })
    await page.waitForSelector('text=/not WGS84/', { timeout: 10000 })
    expect(await page.innerText('body')).toContain('ogr2ogr')
  })

  test('a GPX layer still exports its STL ribbon; an OSM layer does not', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)

    // A short track across the middle of the raster.
    const pts = [0, 1, 2, 3].map((i) =>
      `<trkpt lat="${INSIDE.lat + i * 0.002}" lon="${INSIDE.lon + i * 0.003}"><ele>${1200 + i * 50}</ele></trkpt>`)
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-testid="load-gpx"]'),
    ])
    await chooser.setFiles({
      name: 'route.gpx', mimeType: 'application/gpx+xml',
      buffer: Buffer.from(`<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`),
    })
    await page.waitForSelector('text=route.gpx', { timeout: 10000 })

    // OSM layers alongside it, all with the ribbon switch off by default.
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Motorway')
    await page.waitForTimeout(2500)

    const names = []
    page.on('download', (d) => names.push(d.suggestedFilename()))
    await page.keyboard.press('Digit4')
    // Two files: the plate, then the ribbon. The plate is written first, so
    // waiting on one download would race the second.
    await expect.poll(() => names.length, { timeout: 60000 }).toBe(2)

    expect(names.some((n) => n.endsWith('-vectors.stl'))).toBe(true)
    expect(names.some((n) => n === 'geotiff.stl')).toBe(true)
  })

  /** The layer ids in panel order — top of the stack first. */
  const stackIds = (page) => page.locator('[data-testid^="vector-layer-"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-testid').replace('vector-layer-', '')))

  /**
   * Drags one layer's grip onto another row, the way a hand would.
   *
   * Both rows are scrolled into view first: `page.mouse` is raw viewport
   * coordinates with none of `click()`'s scrolling, and the layer list on a
   * 720 px viewport starts below the fold — aiming at a boundingBox down there
   * fires the whole gesture into empty space outside the window.
   */
  async function dragLayer(page, fromId, ontoId) {
    const ids = await stackIds(page)
    const up = ids.indexOf(fromId) > ids.indexOf(ontoId)
    await page.locator(`[data-testid="vector-layer-${fromId}"]`).scrollIntoViewIfNeeded()
    await page.locator(`[data-testid="vector-layer-${ontoId}"]`).scrollIntoViewIfNeeded()
    const grip = await page.locator(`[data-testid="vector-grip-${fromId}"]`).boundingBox()
    const onto = await page.locator(`[data-testid="vector-layer-${ontoId}"]`).boundingBox()
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    // Past the destination's midpoint, not onto it — a row is claimed when it is
    // crossed, and the midpoint itself is the boundary that decides nothing.
    await page.mouse.move(onto.x + 10, up ? onto.y + 3 : onto.y + onto.height - 3, { steps: 12 })
    await page.mouse.up()
  }

  /** The pen layers of an SVG export, in document order. */
  async function exportedPenLayers(page) {
    await page.evaluate(() => document.activeElement?.blur())
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.click('text=SVG'),
    ])
    let svg = ''
    for await (const chunk of await download.createReadStream()) svg += chunk
    return [...svg.matchAll(/inkscape:label="([^"]*)"/g)].map((m) => m[1])
  }

  test('the top of the list is the front of the scene, and a drag moves it there', async ({ page }) => {
    // A stack is read top-first — QGIS, Photoshop, every layer list anyone has
    // met — while paint order is last-wins, so the two are reverses of each
    // other. The SVG export is where that is unambiguous: a pen layer written
    // later in the document is a pen that draws later.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Motorway')
    await page.waitForTimeout(1500)

    const names = () => page.locator('[data-testid^="vector-name-"]')
      .evaluateAll((els) => els.map((e) => e.textContent.replace(/^[▾▸]\s*/, '').trim()))

    const before = await names()
    expect(before.length).toBeGreaterThan(3)
    // OSM hands its catalogue over ground-cover first; the stack shows it the
    // other way up, so the wood is at the bottom and the peaks are at the top.
    expect(before[before.length - 1]).toContain('Wood')
    expect(before[0]).toContain('Peaks')

    const pens = await exportedPenLayers(page)
    const rank = (n) => pens.indexOf(n)
    // Every vector layer that made it into the export, in document order,
    // reverses the panel.
    const drawn = before.filter((n) => pens.includes(n))
    expect(drawn.length).toBeGreaterThan(2)
    for (let i = 1; i < drawn.length; i++) {
      expect(rank(drawn[i]), `${drawn[i]} must be drawn before ${drawn[i - 1]}`)
        .toBeLessThan(rank(drawn[i - 1]))
    }

    // Now drag the bottom layer to the top and watch the export follow.
    const ids = await stackIds(page)
    const bottom = ids[ids.length - 1]
    await dragLayer(page, bottom, ids[0])
    await expect.poll(() => stackIds(page).then((s) => s[0])).toBe(bottom)

    const after = await names()
    const pens2 = await exportedPenLayers(page)
    const moved = after[0]
    expect(pens2).toContain(moved)
    // Last pen down among the vector layers is the ink that ends up on top.
    for (const other of after.slice(1)) {
      if (!pens2.includes(other)) continue
      expect(pens2.indexOf(other), `${other} must be drawn before ${moved}`)
        .toBeLessThan(pens2.indexOf(moved))
    }

    // The keyboard reaches the same place, which is the only way to do this
    // without a pointer.
    await page.locator(`[data-testid="vector-grip-${bottom}"]`).press('ArrowDown')
    await expect.poll(() => stackIds(page).then((s) => s[1])).toBe(bottom)
  })

  test('reordering the stack never enters the worker', async ({ page }) => {
    // Same claim as recolouring, and it matters more here: a reorder fires
    // continuously while the cursor crosses rows, and re-draping a valley of
    // roads per step would make the drag lag the hand. The worker's build key is
    // sorted precisely so the stack is not in it.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Motorway')
    await page.waitForTimeout(1500)

    let rebuilds = 0
    page.on('console', (m) => { if (m.text().includes('[Benchmark] Viewport Updated')) rebuilds++ })
    await page.waitForTimeout(500)
    rebuilds = 0

    const ids = await stackIds(page)
    await dragLayer(page, ids[ids.length - 1], ids[0])
    await page.waitForTimeout(1500)

    expect(await stackIds(page).then((s) => s[0])).toBe(ids[ids.length - 1])
    expect(rebuilds).toBe(0)
  })

  test('the layer at the top of the list covers the ones below it', async ({ page }) => {
    // The whole point of the stack, measured where the user sees it: a wood and
    // a lake that overlap by half, each painted a colour nothing else in the
    // scene comes near. Whichever is on top owns the overlap.
    //
    // Both are held just under fully opaque on purpose. At 1.0 a fill writes
    // depth, and two fills draped on the same terrain are coplanar to within a
    // float — the winner would then be decided by depth-buffer ties rather than
    // by the stack, which is not the thing under test.
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Water · Lake')
    await page.waitForTimeout(1500)

    const rows = page.locator('[data-testid^="vector-layer-"]')
    const idOf = async (name) => (await rows.filter({ hasText: name }).first()
      .getAttribute('data-testid')).replace('vector-layer-', '')
    const lakeId = await idOf('Water · Lake')
    const woodId = await idOf('Wood')
    for (const id of await stackIds(page)) {
      if (id !== lakeId && id !== woodId) await page.click(`[data-testid="vector-vis-${id}"]`)
    }

    /** Paints one layer's fill a colour and opens it up to nearly solid. */
    const paintFill = async (id, hex) => {
      await page.click(`[data-testid="vector-name-${id}"]`)
      const fill = page.locator(`[data-testid="vector-fill-${id}"]`)
      if (!(await fill.locator('input[type="color"]').count())) await fill.locator('label').click()
      await fill.locator('input[type="color"]').fill(hex)
      await fill.locator('input[type="range"]').fill('0.95')
      await page.click(`[data-testid="vector-name-${id}"]`)
    }
    await paintFill(woodId, '#00ff00')
    await paintFill(lakeId, '#ff0000')
    await page.evaluate(() => document.activeElement?.blur())
    await page.waitForTimeout(2500)

    /** How much of each fill is on screen, by its own hue. */
    const share = () => page.evaluate(() => {
      const c = document.querySelector('canvas[data-engine]')
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      const px = new Uint8Array(c.width * c.height * 4)
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
      let green = 0, red = 0
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2]
        if (g > 120 && r < g - 60 && b < g - 60) green++
        else if (r > 120 && g < r - 60 && b < r - 60) red++
      }
      return { green, red }
    })

    // Landuse is ground cover, so OSM hands it over first and the stack puts it
    // at the bottom: the lake starts on top of the wood.
    const before = await share()
    expect(before.red, 'the lake must be big enough on screen to measure').toBeGreaterThan(300)
    expect(before.green, 'and so must the half of the wood it does not cover').toBeGreaterThan(300)

    await dragLayer(page, woodId, lakeId)
    await expect.poll(() => stackIds(page).then((s) => s.indexOf(woodId) < s.indexOf(lakeId)))
      .toBe(true)
    await page.waitForTimeout(2000)

    const after = await share()
    // The overlap changes hands, both ways, and nothing else on screen does.
    expect(after.green, 'the wood on top must take the overlap').toBeGreaterThan(before.green * 1.3)
    expect(after.red, 'and the lake must lose exactly that').toBeLessThan(before.red * 0.8)
    expect(after.green + after.red).toBeGreaterThan((before.green + before.red) * 0.9)
  })

  test('SVG export carries a visible layer and skips a hidden one', async ({ page }) => {
    await routeOverpass(page)
    await openVectorPanel(page)
    await page.click('[data-testid="osm-fetch"]')
    await page.waitForSelector('text=Roads · Motorway')
    await page.waitForTimeout(1500)

    const row = page.locator('[data-testid^="vector-layer-"]').filter({ hasText: 'Roads · Track' })
    const id = (await row.getAttribute('data-testid')).replace('vector-layer-', '')
    await page.click(`[data-testid="vector-vis-${id}"]`)   // hide Roads · Track
    await page.waitForTimeout(1500)

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.click('text=SVG'),
    ])
    const stream = await download.createReadStream()
    let svg = ''
    for await (const chunk of stream) svg += chunk
    // Vector layers become their own Inkscape layers, which is what makes a plot
    // separable by pen.
    const motorway = [...svg.matchAll(/inkscape:label="([^"]*)"/g)].map((m) => m[1])
    expect(motorway.some((n) => n.includes('Motorway'))).toBe(true)
    expect(motorway.some((n) => n.includes('Track'))).toBe(false)
  })
})
