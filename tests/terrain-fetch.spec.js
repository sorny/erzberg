/**
 * Terrain by name, with both servers played by this file.
 *
 * The endpoints are intercepted rather than called. A suite that depends on
 * somebody else's server being up goes red for reasons the code cannot fix, and
 * a suite that hammers a shared open-data bucket on every run is a bad citizen —
 * the whole feature is built around not being one of those.
 *
 * Mocking also lets the tile bytes be *known*, which is the only way to assert
 * that the terrarium decode is right: the elevation range the app reports has to
 * be the range this file encoded.
 *
 * The first assertion is the load-bearing one. The README promises the app
 * contacts nobody until asked, and a search box is exactly the kind of control
 * that quietly grows an autocomplete.
 */
import { test, expect } from '@playwright/test'
import { deflateSync } from 'zlib'
import { resetToDefaults } from './helpers.js'

// ── A terrarium tile, encoded by hand ────────────────────────────────────────
// Mapzen's encoding: metres, offset by 32 768, packed across the three colour
// channels with blue carrying the fraction.

const TILE = 256
const BASE_M = 1000          // elevation of the first row
const STEP_M = 2             // metres gained per row

function crc32(bytes) {
  let c, table = crc32.t
  if (!table) {
    table = crc32.t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      table[n] = c >>> 0
    }
  }
  c = 0xFFFFFFFF
  for (const b of bytes) c = table[(c ^ b) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** A 256×256 RGB PNG whose rows encode a steady climb from BASE_M. */
function terrariumTile() {
  const raw = Buffer.alloc(TILE * (1 + TILE * 3))
  for (let r = 0; r < TILE; r++) {
    const v = BASE_M + r * STEP_M + 32768
    const row = r * (1 + TILE * 3)
    raw[row] = 0                                   // filter: none
    for (let c = 0; c < TILE; c++) {
      const p = row + 1 + c * 3
      raw[p] = Math.floor(v / 256)
      raw[p + 1] = Math.floor(v) % 256
      raw[p + 2] = Math.round((v - Math.floor(v)) * 256) & 0xFF
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(TILE, 0)
  ihdr.writeUInt32BE(TILE, 4)
  ihdr[8] = 8       // bit depth
  ihdr[9] = 2       // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** What Nominatim returns for the mountain this tool is named after. */
const ERZBERG = [{
  name: 'Erzberg',
  display_name: 'Erzberg, Eisenerz, Bezirk Leoben, Steiermark, Österreich',
  type: 'quarry',
  lat: '47.5242554', lon: '14.9117535',
  boundingbox: ['47.5096550', '47.5390150', '14.8868072', '14.9391517'],
}]

async function stubTheWorld(page) {
  const png = terrariumTile()
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ERZBERG) }))
  await page.route('**/elevation-tiles-prod/**', (route) =>
    route.fulfill({
      status: 200, contentType: 'image/png', body: png,
      headers: {
        'x-amz-meta-x-imagery-sources': 'eudem/eudem_dem_5deg_n45e010.tif',
        // Both of these are what the real bucket sends, and both are load
        // bearing. Without the second the browser hides the header from script
        // — it is not on the CORS safelist — and the provenance line comes back
        // empty against a stub that looked correct.
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'x-amz-meta-x-imagery-sources',
      },
    }))
}

async function openFetch(page) {
  const section = page.locator('[data-testid="section-fetch"]')
  await section.scrollIntoViewIfNeeded()
  if ((await section.getAttribute('aria-expanded')) !== 'true') {
    await section.click()
    await page.waitForTimeout(300)
  }
}

test('nothing is sent until the button is pressed', async ({ page }) => {
  const sent = []
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname
    if (host !== 'localhost') sent.push(r.url())
  })
  await stubTheWorld(page)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openFetch(page)

  // Typing is not asking. Nominatim's usage policy says so, and so does the
  // note under the field.
  await page.locator('[data-testid="place-query"]').fill('Erzberg')
  await page.waitForTimeout(1500)
  expect(sent, `contacted while typing: ${sent.join(', ')}`).toEqual([])

  await page.locator('[data-testid="place-search"]').click()
  await expect(page.locator('[data-testid="place-results"]')).toBeVisible({ timeout: 20_000 })
  expect(sent.some((u) => u.includes('nominatim'))).toBe(true)
  // And still nothing has been asked of the tile host — that needs a second,
  // separate decision about which of the answers you meant.
  expect(sent.some((u) => u.includes('elevation-tiles'))).toBe(false)
})

test('a typed place becomes ground you can draw', async ({ page }) => {
  test.setTimeout(180_000)
  await stubTheWorld(page)
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await openFetch(page)

  await page.locator('[data-testid="place-query"]').fill('Erzberg')
  await page.locator('[data-testid="place-search"]').click()
  const first = page.locator('[data-testid="place-result-0"]')
  await expect(first).toBeVisible({ timeout: 20_000 })
  await expect(first).toContainText('Erzberg')
  await expect(first).toContainText('Eisenerz')

  await first.click()
  await expect(page.locator('[data-testid="dem-credit"]')).toBeVisible({ timeout: 60_000 })

  // The raster is named after the place, which is what the exports get named
  // after too.
  await expect(page.locator('#hm-panel-body')).toContainText('Erzberg')

  // It arrived georeferenced. This is the whole point: everything downstream —
  // contours in metres, the OSM overlay, the scale bar, the almanac's latitude —
  // was already waiting for a raster that knows where it is.
  const stats = page.locator('#hm-panel-body')
  await expect(stats).toContainText('Projection:')
  await expect(stats).toContainText('Web Mercator')

  // And the terrarium decode is right: the tile this file wrote climbs from
  // 1 000 m at two metres a row, so the range is fixed and known.
  await expect(stats).toContainText('Elevation: 1000 – 1510 m')

  // The credit names both services and the survey the tiles themselves reported.
  const credit = page.locator('[data-testid="dem-credit"]')
  await expect(credit).toContainText('Nominatim')
  await expect(credit).toContainText('Terrain Tiles on AWS Open Data')
  await expect(credit).toContainText('eudem')
})
