import { test, expect } from '@playwright/test'
import { openMark, openStage, resetToDefaults, setMark } from './helpers.js'

/**
 * Mode copies through the panel: one mode, a second set of settings, its own
 * pens in the file.
 *
 * The geometry is pinned in tests/unit/modeCopies.test.js. What only the app
 * can show is the round trip a person makes: a copy made from the section, its
 * name on the plot, its place in undo, and its place in the look the file
 * carries. Heavy project: it waits on downloads.
 */
const PAGE = 'http://localhost:5173'

async function exportSvg(page) {
  await openStage(page, 'output')
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 180_000 }),
    page.click('[data-testid="export-svg"]'),
  ])
  const chunks = []
  for await (const c of await dl.createReadStream()) chunks.push(c)
  return Buffer.concat(chunks).toString('utf-8')
}

const labelsOf = (svg) => [...svg.matchAll(/inkscape:label="([^"]+)"/g)].map((m) => m[1])
const lookOf = (svg) => JSON.parse(/<!-- erzberg:preset (.*?) -->/.exec(svg)[1])

test('a copy of a mode is its own pens, in undo and in the file', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await setMark(page, 'Contours', true)
  await openMark(page, 'Contours')

  // Duplicate from the section. The new copy opens with the mode's controls.
  await page.click('[data-testid="mode-duplicate-contours"]')
  await page.waitForTimeout(800)
  const copy = page.locator('[data-testid="mode-copy-c1"]')
  await expect(copy).toBeVisible()
  await expect(copy.locator('[data-copy-body="Mode: Contours"]')).toBeVisible()
  await page.fill('[data-testid="mode-copy-name-c1"]', 'Sparse')
  await page.waitForTimeout(2500)

  let svg = await exportSvg(page)
  let labels = labelsOf(svg)
  expect(labels).toContain('Contours · Minor')
  expect(labels).toContain('Sparse · Minor')
  // The copy travels in the look the file carries.
  expect(lookOf(svg).style.modeCopies.map((c) => c.name)).toEqual(['Sparse'])

  // Off by its own switch: its pens go, the original's stay.
  await openMark(page, 'Contours')
  await page.locator('[data-testid="mode-copy-on-c1"]').click()
  await page.waitForTimeout(2500)
  labels = labelsOf(await exportSvg(page))
  expect(labels).toContain('Contours · Minor')
  expect(labels.some((l) => l.startsWith('Sparse'))).toBe(false)

  // Undo, back past the switch, the rename and the duplicate: no copy at all.
  for (let i = 0; i < 8 && (await page.locator('[data-testid="undo"]').isEnabled()); i++) {
    await page.locator('[data-testid="undo"]').click()
    await page.waitForTimeout(250)
    await openMark(page, 'Contours')
    if (!(await page.locator('[data-testid="mode-copy-c1"]').count())) break
  }
  await expect(page.locator('[data-testid="mode-copy-c1"]')).toHaveCount(0)
})
