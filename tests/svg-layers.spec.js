/**
 * What the SVG's layer tree holds: nothing for a layer at opacity 0, and, by
 * ink, one top layer per ink with that ink's pen layers inside it.
 */
import { test, expect } from '@playwright/test'

async function svgWith(page, patch) {
  await page.evaluate(async (patch) => {
    window.erzberg.setParams(patch)
    await window.erzberg.settle()
  }, patch)
  const [d] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.evaluate(() => window.erzberg.export('svg')),
  ])
  let svg = ''
  for await (const c of await d.createReadStream()) svg += c
  return svg
}

test('a layer at opacity 0 is left out, and By ink nests the pen layers and legend marks under their ink', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5173/?automation')
  await page.waitForFunction(() => window.erzberg?.version === 1, null, { timeout: 60_000 })

  const base = { enabledLines: true, enabledContours: true, colorContours: '#ff0000', colorLines: '#000000' }
  const hidden = await svgWith(page, { ...base, opacityContours: 0 })
  expect(hidden).toContain('data-name="Lines"')
  expect(hidden, 'a layer at opacity 0 writes no pen layer').not.toMatch(/data-name="Contours/)

  const flat = await svgWith(page, { ...base, opacityContours: 1, plotGroupBy: 'layer' })
  expect(flat).toMatch(/data-name="Contours/)
  expect(flat).not.toContain('id="ink-')

  const byInk = await svgWith(page, { ...base, opacityContours: 1, plotGroupBy: 'ink', legendOn: true })
  // The top layers by ink, each cut out up to the next.
  const at = [...byInk.matchAll(/<g id="ink-/g)].map((m) => m.index)
  const groups = at.map((i, k) => byInk.slice(i, at[k + 1] ?? byInk.length))
  const labelOf = (g) => g.match(/inkscape:label="([^"]+)"/)[1]
  expect(groups.map(labelOf).slice(0, 2)).toEqual(['01 · #000000', '02 · #ff0000'])
  expect(groups[0]).toContain('data-name="Lines"')
  expect(groups[0]).not.toMatch(/data-name="Contours/)
  expect(groups[1]).toContain('data-name="Contours · Minor"')
  expect(groups[1]).toContain('data-name="Contours · Major"')
  // The legend's red sample is drawn by the red pen, not the sheet ink's.
  expect(groups[1]).toContain('data-name="Legend"')
  expect(groups[0]).toContain('data-name="Scale and north"')
  expect(groups[0]).not.toMatch(/(stroke|fill)="#ff0000"/)
  // The sublayer gave its plot number to the ink.
  expect(byInk).not.toMatch(/inkscape:label="\d+ · Contours/)
  expect(errors).toEqual([])
})
