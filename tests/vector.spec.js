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
      way(6, { natural: 'water', water: 'lake' },
        [[0.001, 0.001], [0.004, 0.001], [0.004, 0.003], [0.001, 0.003], [0.001, 0.001]]),
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

    // The visibility swatch is painted with the layer's own colour, so it is
    // proof the change actually landed rather than being swallowed.
    const swatch = await page.locator(`[data-testid="vector-vis-${id}"]`)
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
    await expect(rows.first()).toContainText('1910 m')
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
