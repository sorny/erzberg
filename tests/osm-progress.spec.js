import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resetToDefaults } from './helpers.js'

/**
 * What a fetch is able to say about how far along it is.
 *
 * The wait has three phases and only two of them can be measured. Overpass
 * withholds response headers until the query has finished running, so between
 * the POST and the first byte there is no length, no bytes and no status — on a
 * province that stretch is most of the wait. Once bytes arrive they are real
 * progress. `JSON.parse` after them is one unsplittable blocking call.
 *
 * So the thing worth pinning is not that a bar reaches 100%. It is that the bar
 * is honest: indeterminate exactly while there is nothing to measure, and
 * determinate exactly while there is. A bar that sits at 0% for ninety seconds
 * and then races to the end says the wrong thing about which part is slow.
 *
 * Overpass is never called — the route answers both the count and the geometry.
 */
const PAGE = 'http://localhost:5173'

// Above COUNT_ABOVE_KM2 (2 500), so the count pre-flight runs and supplies the
// denominator the download is measured against.
const BIG = [13.55, 46.62, 16.18, 47.84]
// Below it, so no count runs and there is nothing to divide by.
const SMALL = [15.00, 47.20, 15.10, 47.26]

// The panel will not query without a georeferenced raster, so the one UI test
// needs the same fixture the vector suite uses. It is gitignored for size.
const FIXTURE = 'tests/testdata/geotiff.tif'

/** Answers a count with `count`, and geometry with `ways` fat ways. */
async function routeOverpass(page, { count = 5_000, ways = 400 } = {}) {
  await page.route('**/api/interpreter', async (route) => {
    const body = decodeURIComponent((route.request().postData() ?? '')
      .replace(/^data=/, '').replace(/\+/g, ' '))
    const counts = (body.match(/out count;/g) ?? []).length
    const json = counts
      ? { version: 0.6, elements: Array.from({ length: counts }, () => ({
          type: 'count', id: 0, tags: { total: String(count) },
        })) }
      : { version: 0.6, elements: Array.from({ length: ways }, (_, i) => ({
          type: 'way', id: i + 1, tags: { highway: 'motorway' },
          // Long enough that the body is worth streaming rather than a token.
          geometry: Array.from({ length: 40 }, (_, k) => ({
            lat: 47.2 + k * 1e-4, lon: 15.0 + i * 1e-4,
          })),
        })) }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
  })
}

/** Runs a fetch and returns every progress report it made, in order. */
function fetchReports(page, bbox, detail) {
  return page.evaluate(async ([bbox, detail]) => {
    const { fetchOsm } = await import('/src/utils/osmFetch.js')
    const reports = []
    await fetchOsm(bbox, ['roads'], {
      detail,
      onProgress: (f, label) => reports.push({ f, label }),
    })
    return reports
  }, [bbox, detail])
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
})

test('the bar is indeterminate exactly while there is nothing to measure', async ({ page }) => {
  await routeOverpass(page)
  const reports = await fetchReports(page, BIG, 'broad')
  expect(reports.length).toBeGreaterThan(2)

  // Nothing can be known before the server has answered, so the opening reports
  // carry no fraction at all rather than a fabricated 0%.
  expect(reports[0].f).toBeNull()
  expect(reports[0].label).toMatch(/measuring the extent/i)
  const firstNumber = reports.findIndex((r) => r.f != null)
  expect(firstNumber).toBeGreaterThan(0)
  for (const r of reports.slice(0, firstNumber)) expect(r.f).toBeNull()

  // …and once one exists, it never disappears again. A bar that goes back to
  // indeterminate mid-fetch reads as a restart.
  for (const r of reports.slice(firstNumber)) expect(r.f).not.toBeNull()
})

test('the measured phases move forward and finish', async ({ page }) => {
  await routeOverpass(page)
  const reports = await fetchReports(page, BIG, 'broad')
  const nums = reports.filter((r) => r.f != null).map((r) => r.f)

  expect(nums.length).toBeGreaterThan(0)
  // Monotonic: a progress bar that goes backwards is worse than none.
  for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThanOrEqual(nums[i - 1])
  expect(nums[nums.length - 1]).toBeCloseTo(1, 2)

  // The parse is announced before it runs, not animated through — it is one
  // blocking call and a bar moving during it would be a lie about the freeze.
  const reading = reports.find((r) => /reading/i.test(r.label ?? ''))
  expect(reading, 'the parse step names itself').toBeTruthy()
  expect(reading.f).toBeGreaterThan(0.5)

  // Draping happens after the parse and owns the end of the bar.
  const last = reports[reports.length - 1]
  expect(last.f).toBeCloseTo(1, 2)
})

test('an extent too small to count still reports, without inventing a total', async ({ page }) => {
  await routeOverpass(page)
  const reports = await fetchReports(page, SMALL, 'full')
  // No count ran, so there is no denominator for the download — but the fetch
  // still says what it is doing, and still finishes at the end of the bar.
  expect(reports.some((r) => /querying openstreetmap/i.test(r.label ?? ''))).toBe(true)
  expect(reports.some((r) => !/measuring the extent/i.test(r.label ?? ''))).toBe(true)
  const nums = reports.filter((r) => r.f != null).map((r) => r.f)
  expect(nums[nums.length - 1]).toBeCloseTo(1, 2)
})

test('the panel draws the bar, and takes it away again', async ({ page }) => {
  test.skip(!existsSync(FIXTURE), `${FIXTURE} not present (gitignored) — see tests/testdata/README.md`)
  await routeOverpass(page, { ways: 60 })

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="load-geotiff"]'),
  ])
  await chooser.setFiles(FIXTURE)
  await page.waitForFunction(() => !!document.body.innerText.match(/Elevation:\s*\d/), { timeout: 30_000 })
  await page.click('[data-testid="section-vector-layers"]')
  await page.waitForSelector('[data-testid="osm-fetch"]')

  const bar = page.locator('[data-testid="osm-progress"]')
  await expect(bar).toHaveCount(0)

  await page.click('[data-testid="osm-fetch"]')
  // It appears while the fetch runs…
  await expect(bar).toBeVisible()
  // …and goes away when it is over, rather than sitting at 100% for ever.
  await expect(bar).toHaveCount(0, { timeout: 30_000 })
})
