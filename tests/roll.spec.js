/**
 * Camera roll: a turn about the line of sight.
 *
 * Seen straight down, a roll and a turn of Rotation are the same camera, so the
 * two SVGs must draw the same lines. The comparison is a coarse occupancy grid
 * of every exported point, which does not care in what order the paths come.
 */
import { test, expect } from '@playwright/test'

async function svgAt(page, patch) {
  await page.evaluate(async (patch) => {
    window.erzberg.setParams(patch)
    await window.erzberg.settle()
  }, patch)
  await page.waitForTimeout(500)
  const [d] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.evaluate(() => window.erzberg.export('svg')),
  ])
  let svg = ''
  for await (const c of await d.createReadStream()) svg += c
  return svg
}

/** A 12 × 12 grid of how many exported points fall in each cell, normalised. */
function grid(svg) {
  const vb = svg.match(/viewBox="([^"]+)"/)[1].split(/[\s,]+/).map(Number)
  const n = 12, g = new Array(n * n).fill(0)
  let total = 0
  for (const m of svg.matchAll(/\b(?:d|points)="([^"]+)"/g)) {
    const v = m[1].match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    for (let i = 0; i + 1 < v.length; i += 2) {
      const x = Math.floor(((v[i] - vb[0]) / vb[2]) * n), y = Math.floor(((v[i + 1] - vb[1]) / vb[3]) * n)
      if (x < 0 || y < 0 || x >= n || y >= n) continue
      g[y * n + x]++; total++
    }
  }
  return g.map((c) => c / Math.max(1, total))
}
const diff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0)

test('seen straight down, a roll draws what the same turn of Rotation draws', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5173/?automation')
  await page.waitForFunction(() => window.erzberg?.version === 1, null, { timeout: 60_000 })

  const rolled = grid(await svgAt(page, { tilt: 0, rotation: 0, cameraRoll: 90 }))
  const plus = grid(await svgAt(page, { tilt: 0, rotation: 90, cameraRoll: 0 }))
  const minus = grid(await svgAt(page, { tilt: 0, rotation: -90, cameraRoll: 0 }))
  const level = grid(await svgAt(page, { tilt: 0, rotation: 0, cameraRoll: 0 }))
  expect(diff(rolled, plus), 'a roll of 90° is a Rotation of 90°').toBeLessThan(0.01)
  // And it moved at all, the right way round.
  expect(diff(rolled, minus)).toBeGreaterThan(0.03)
  expect(diff(rolled, level)).toBeGreaterThan(0.03)
  expect(errors).toEqual([])
})
