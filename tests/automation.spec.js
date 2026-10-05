/**
 * `window.erzberg` as a script writes it: a change and the wait in one call.
 *
 * The command line makes one `page.evaluate` per step, and each round trip gives
 * React time to render. A script that writes `setModes(…)` and `settle()` in one
 * call gives it none, and `settle()` used to return before the rebuild had even
 * started: the plate had been still since the raster loaded, so it counted as
 * settled, and the file written next was the old plate, Lines and not the mode
 * asked for. It happened to about one first change in three, so this makes six.
 *
 * What is checked is which pen layers the file holds, not how much ink: the
 * framing of a plate right after a load can still move a little, and that is
 * not what this is about.
 */
import { test, expect } from '@playwright/test'

const APP = 'http://localhost:5173'
const DEM = `${APP}/tests/testdata/geotiff.tif`
const CASES = [
  [['Hachure'], { lengthHachure: '5', spacingHachure: '6' }],
  [['Pillars'], { spacingPillars: '8', pillarStyle: 'cuboid' }],
]

test('settle waits for a rebuild started in the same call', async ({ page }) => {
  test.setTimeout(300_000)
  for (let round = 0; round < 3; round++) {
    for (const [modes, params] of CASES) {
      await page.goto(`${APP}/?automation`)
      await page.waitForFunction(() => !!window.erzberg, null, { timeout: 60_000 })
      await page.evaluate((url) => window.erzberg.loadRaster('geotiff.tif', url), DEM)
      // The first change after the load, made and waited for in one call.
      await page.evaluate(async ([m, s]) => {
        window.erzberg.setModes(m, true)
        window.erzberg.setParams(s)
        await window.erzberg.settle()
      }, [modes, params])
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 180_000 }),
        page.evaluate(() => window.erzberg.export('svg')),
      ])
      const chunks = []
      for await (const c of await dl.createReadStream()) chunks.push(c)
      const svg = Buffer.concat(chunks).toString('utf-8')
      const pens = [...svg.matchAll(/inkscape:label="([^"]+)"/g)].map((m) => m[1])
      expect(pens, `${modes[0]}, round ${round + 1}`).toEqual(modes)
    }
  }
})
