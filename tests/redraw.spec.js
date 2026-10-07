/**
 * The viewport shows the state it was given, without a camera move.
 *
 * The canvas draws on demand. A layer's draw order, depth state and uniforms
 * used to be set in passive effects, which can run after the frame that first
 * shows the new objects. Nothing asked for another frame, so that frame stayed
 * on screen: with Ground occlusion a fresh line object kept renderOrder 0, was
 * drawn before the ground's depth, and lay over the terrain until the camera
 * moved. It happened to some changes and not others, so this makes several.
 *
 * The race is narrow: React flushes passive effects in a scheduler task right
 * after the commit, and the frame must come first. A fast machine seldom loses
 * it. So the page's MessageChannel, which React's scheduler posts its tasks
 * through, is slowed by 50 ms, and the frame always comes first.
 *
 * Each frame on screen is compared with a fresh one of the same state. A resize
 * forces that one: the canvas goes one pixel narrower and back, and draws again.
 */
import { test, expect } from '@playwright/test'

const APP = 'http://localhost:5173'
const DEM = `${APP}/tests/testdata/geotiff.tif`

const STEPS = [
  { colorRadar: '#c0392b' },
  { hypsoRadar: 'true' },
  { hypsoModeRadar: 'slope' },
  { hypsoModeRadar: 'aspect' },
  { hypsoRadar: 'false' },
  { colorRadar: '#1a1a1a' },
  { weightRadar: '1.4' },
  { spacingRadar: '6' },
]

/** Pixels that differ by more than a little in any channel. */
function differing(a, b) {
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    let d = 0
    for (let k = 0; k < 4; k++) d += Math.abs(a[i + k] - b[i + k])
    if (d > 24) n++
  }
  return n
}

/** The canvas as the page shows it, in RGBA. */
async function shown(page) {
  return page.evaluate(() => new Promise((resolve) => {
    // Two frames, so a frame that was asked for has been drawn.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const c = document.querySelector('canvas')
      const o = document.createElement('canvas')
      o.width = c.width; o.height = c.height
      const g = o.getContext('2d')
      g.drawImage(c, 0, 0)
      resolve(Array.from(g.getImageData(0, 0, o.width, o.height).data))
    }))
  }))
}

/** Resizes the page and waits until the canvas has drawn at the new size. */
async function resize(page, width, height) {
  await page.setViewportSize({ width, height })
  await page.waitForFunction((w) => document.querySelector('canvas').width === w, width)
  await page.waitForTimeout(300)
}

test('a change is drawn with the ground in front, without a camera move', async ({ page }) => {
  test.setTimeout(240_000)
  await page.addInitScript(() => {
    const post = MessagePort.prototype.postMessage
    MessagePort.prototype.postMessage = function (...args) { setTimeout(() => post.apply(this, args), 50) }
  })
  await page.goto(`${APP}/?automation`)
  await page.waitForFunction(() => !!window.erzberg, null, { timeout: 60_000 })
  await page.evaluate((url) => window.erzberg.loadRaster('geotiff.tif', url), DEM)
  await page.evaluate(() => window.erzberg.setModes(['Radar'], true))
  await page.evaluate(() => window.erzberg.setParams({ occludeBy: 'ground', depthOcclusion: 'true' }))
  await page.evaluate(() => window.erzberg.settle())
  const size = page.viewportSize()

  for (const step of STEPS) {
    await page.evaluate(async (s) => {
      window.erzberg.setParams(s)
      await window.erzberg.settle()
    }, step)
    // The slowed scheduler can let settle() return before React has drawn
    // the change. The stale frame stays on screen forever, so a wait is safe.
    await page.waitForTimeout(500)
    const before = await shown(page)
    await resize(page, size.width - 1, size.height)
    await resize(page, size.width, size.height)
    const fresh = await shown(page)
    expect(before.length, JSON.stringify(step)).toBe(fresh.length)
    expect(differing(before, fresh), JSON.stringify(step)).toBeLessThan(200)
  }
})
