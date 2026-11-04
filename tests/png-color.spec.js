import { test, expect } from '@playwright/test'

/**
 * The PNG carries the colours the viewport shows, and both are the ink as picked.
 *
 * Exports render into a target, and three.js tone-maps only what it draws to
 * the screen, so a PNG once drew inks differently from the viewport: Green
 * Screen's phosphor came out deeper and greener in the file than on screen.
 * This reads the ink back from a screenshot and from the PNG, and holds both
 * to the hex the preset stores.
 *
 * Green Screen draws hair-thin strokes, which no pixel is fully covered by, so
 * the Printer weight is raised until each stroke has a core of pure ink. The
 * ink is the most common colour well away from the paper.
 *
 * In the heavy project: it reads pixels and a download.
 */
// The phosphor as format 10 stores it: `#39ff6a` as the old tone curve drew it.
const PAPER = '#050805', INK = '#b6e3c1'
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

/**
 * The ink of an image, the most common colour far from the paper, and the
 * share of pixels that are the paper exactly.
 */
async function inksOf(page, png) {
  return page.evaluate(async ([b64, paper]) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const count = new Map()
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]
      count.set(k, (count.get(k) ?? 0) + 1)
    }
    const ranked = [...count].sort((a, b) => b[1] - a[1]).map(([k]) => [k >> 16, (k >> 8) & 255, k & 255])
    const ink = ranked.find((p) => p.reduce((s, v, i) => s + Math.abs(v - paper[i]), 0) > 200)
    const paperShare = (count.get((paper[0] << 16) | (paper[1] << 8) | paper[2]) ?? 0) / (d.length / 4)
    return { ink, paperShare }
  }, [png.toString('base64'), rgb(PAPER)])
}

async function shoot(page, info, tag) {
  // The whole viewport: the plate and the paper round it. The panel is shut
  // under automation, and the hint and the gizmo are too small to outrank the ink.
  const view = await page.screenshot()
  const [d] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.evaluate(() => window.erzberg.export('png')),
  ])
  const path = info.outputPath(`${tag}.png`)
  await d.saveAs(path)
  const { readFileSync } = await import('node:fs')
  return { view: await inksOf(page, view), file: await inksOf(page, readFileSync(path)) }
}

test('a PNG of Green Screen carries the ink the viewport shows, as picked', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('http://localhost:5173/?automation')
  await page.waitForFunction(() => window.erzberg?.version === 1, null, { timeout: 60_000 })
  await page.evaluate(() => window.erzberg.applyPreset('Green Screen.json', '/presets/Green Screen.json'))
  await page.evaluate(async () => {
    window.erzberg.setParams({ weightPrinter: 3, tilt: 0, rotation: 0 })
    await window.erzberg.settle()
  })

  const shot = await shoot(page, info, 'green')
  // The paper is exact, and a real share of both pictures.
  expect(shot.view.paperShare, 'viewport paper').toBeGreaterThan(0.05)
  expect(shot.file.paperShare, 'PNG paper').toBeGreaterThan(0.05)
  expect(near(shot.file.ink, shot.view.ink, 2), `PNG ink ${shot.file.ink} vs viewport ${shot.view.ink}`).toBe(true)
  expect(near(shot.view.ink, rgb(INK), 2), `viewport ink ${shot.view.ink} vs ${INK}`).toBe(true)
  expect(await page.evaluate(() => window.erzberg.get(['colorPrinter']).colorPrinter)).toBe(INK)
  expect(errors).toEqual([])
})

// A 4× capture of a large window is a target no GPU allocates in one piece at
// 16-bit floats with four samples: Chrome left it empty and the PNG was paper
// alone. The capture is drawn in tiles, so it carries the ink at any size.
test('a PNG from a large window is drawn in tiles and carries the ink', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const gl = []
  page.on('console', (m) => { if (/Framebuffer is incomplete|GL_INVALID/.test(m.text())) gl.push(m.text()) })
  await page.setViewportSize({ width: 2560, height: 1600 })
  await page.goto('http://localhost:5173/?automation')
  await page.waitForFunction(() => window.erzberg?.version === 1, null, { timeout: 60_000 })
  await page.evaluate(() => window.erzberg.applyPreset('Green Screen.json', '/presets/Green Screen.json'))
  await page.evaluate(async () => {
    window.erzberg.setParams({ weightPrinter: 3, tilt: 0, rotation: 0 })
    await window.erzberg.settle()
  })
  const shot = await shoot(page, info, 'large')
  expect(near(shot.file.ink, shot.view.ink, 2), `PNG ink ${shot.file.ink} vs viewport ${shot.view.ink}`).toBe(true)
  expect(near(shot.file.ink, rgb(INK), 2), `PNG ink ${shot.file.ink}`).toBe(true)
  expect(gl).toEqual([])
  expect(errors).toEqual([])
})
