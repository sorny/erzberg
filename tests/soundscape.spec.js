import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
// 6 s mono MP3: exponential 120 Hz→8 kHz sweep + steady 300 Hz drone + 1.5 kHz
// bursts once a second. Chosen so the spectrogram has verifiable structure
// (a diagonal ridge, a horizontal ridge, and periodic peaks).
const MP3 = path.join(here, 'testdata', 'sweep.mp3')

async function openSoundscapes(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  const toggle = page.locator('[data-testid="sidebar-toggle"]')
  if ((await toggle.innerText()) === '◀') { await toggle.click(); await page.waitForTimeout(400) }
  await page.locator('text=SOUNDSCAPES').click()
  await page.waitForTimeout(300)
}

async function uploadTrack(page) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=↑ Audio'),
  ])
  await chooser.setFiles(MP3)
  // Analysis finishes when the transport appears.
  await expect(page.locator('[data-testid="soundscape-play"]')).toBeVisible({ timeout: 30000 })
}

test('mp3 analyses to a spectrogram and drives the heightmap', async ({ page }) => {
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))

  await openSoundscapes(page)
  await uploadTrack(page)

  // The spectrogram window must have replaced the default heightmap: the
  // geometry grid should now be windowFrames × bins (512 × 512 by default).
  const stats = page.locator('text=/Grid: \\d+×\\d+/')
  await expect(stats).toContainText('Grid: 512×512', { timeout: 15000 })

  // Filename readout tracks the uploaded file.
  await expect(page.locator('text=sweep.mp3').first()).toBeVisible()

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([])
})

test('playback advances the transport and keeps rebuilding terrain', async ({ page }) => {
  let rebuilds = 0
  page.on('console', m => { if (m.text().includes('[Perf] Terrain ready')) rebuilds++ })

  await openSoundscapes(page)
  await uploadTrack(page)

  const before = rebuilds
  await page.click('[data-testid="soundscape-play"]')
  await expect(page.locator('[data-testid="soundscape-play"]')).toContainText('Pause')

  await page.waitForTimeout(2500)

  // Transport clock advanced past 0:00 …
  await expect(page.locator('text=/0:0[1-9] \\/ 0:0[0-9]/')).toBeVisible({ timeout: 5000 })
  // … and each tick pushed a new heightmap, so geometry rebuilt repeatedly.
  const during = rebuilds - before
  console.log(`rebuilds during 2.5s of playback: ${during}`)
  expect(during).toBeGreaterThan(5)

  await page.click('[data-testid="soundscape-play"]')
  await expect(page.locator('[data-testid="soundscape-play"]')).toContainText('Play')

  // Pausing must stop the stream.
  const afterPause = rebuilds
  await page.waitForTimeout(1200)
  expect(rebuilds - afterPause).toBeLessThanOrEqual(1)
})

test('freeze whole track writes a static heightmap', async ({ page }) => {
  await openSoundscapes(page)
  await uploadTrack(page)

  await page.click('text=Freeze Whole Track')

  // The store filename gains a "(full)" suffix only on the freeze path.
  await expect(page.locator('text=sweep.mp3 (full)').first()).toBeVisible({ timeout: 15000 })

  // Whole track resampled to <=1024 columns; 6 s at hop 512 is ~560 frames, so
  // the grid must end up wider than the 512-column streaming window. Polled
  // rather than matched in one go: the pre-freeze "Grid: 512×512" also
  // satisfies a loose /Grid: \d+×\d+/ and would let the stale state pass.
  await expect.poll(async () => {
    const t = await page.locator('text=/Grid: \\d+×\\d+/').innerText()
    return Number(t.match(/Grid: (\d+)×/)[1])
  }, { timeout: 15000 }).toBeGreaterThan(512)

  const finalText = await page.locator('text=/Grid: \\d+×\\d+/').innerText()
  const cols = Number(finalText.match(/Grid: (\d+)×/)[1])
  console.log(`frozen grid columns: ${cols}`)
  expect(cols).toBeLessThanOrEqual(1024)
})

test('loading a PNG releases the soundscape', async ({ page }) => {
  await openSoundscapes(page)
  await uploadTrack(page)
  await page.click('[data-testid="soundscape-play"]')
  await expect(page.locator('[data-testid="soundscape-play"]')).toContainText('Pause')

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=↑ PNG'),
  ])
  await chooser.setFiles(path.join(here, '..', 'public', 'Heightmap.png'))

  // Playback must stop so audio is not driving a heightmap it no longer owns.
  await expect(page.locator('[data-testid="soundscape-play"]')).toContainText('Play', { timeout: 15000 })
})

test('heavy preset streams without latching the computing overlay', async ({ page }) => {
  const times = []
  page.on('console', m => {
    const x = m.text().match(/\[Perf\] Terrain ready Main: (\d+)ms/)
    if (x) times.push(Number(x[1]))
  })

  await openSoundscapes(page)
  await uploadTrack(page)

  // Ink Atlas is the heaviest bundled preset: contours at interval 1 plus
  // sub-cell stipple, ~450k segments per rebuild at the 512×512 default.
  await page.click('text=Ink Atlas')
  await page.waitForTimeout(2000)

  const overlay = page.locator('[data-testid="loading-overlay"]')
  times.length = 0
  const t0 = Date.now()
  await page.click('[data-testid="soundscape-play"]')

  let overlaySeen = 0
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(400)
    if (await overlay.isVisible().catch(() => false)) overlaySeen++
  }
  const el = (Date.now() - t0) / 1000
  await page.click('[data-testid="soundscape-play"]')

  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0
  console.log(`ink atlas streaming: ${times.length} builds, avg ${avg.toFixed(0)}ms, overlay seen ${overlaySeen}/12`)

  // The overlay means "the terrain stopped updating". Under a continuous stream
  // rebuild requests queue back to back and isComputing never falls, so keying
  // the overlay on that alone latched it on permanently.
  expect(overlaySeen, 'computing overlay must not appear while streaming').toBe(0)
  // And the stream must actually be keeping up, not merely hiding a stall.
  expect(times.length / el).toBeGreaterThan(15)
})

test('contours with close-rings and smoothing keep streaming', async ({ page }) => {
  const times = []
  page.on('console', m => {
    const x = m.text().match(/\[Perf\] Terrain ready Main: (\d+)ms/)
    if (x) times.push(Number(x[1]))
  })

  await openSoundscapes(page)
  await uploadTrack(page)

  // Ink Atlas already enables Contours (at interval 1), so only the two
  // chain-path options need toggling. Both used to stringify a Map key per
  // endpoint and unshift() chains into quadratic time.
  await page.click('text=Ink Atlas')
  await page.waitForTimeout(1500)
  await page.locator('text=MODE: CONTOURS').click()
  await page.waitForTimeout(500)

  // "Close contours" is a unique label; Tog renders <span>label</span> next to
  // <label><input hidden></label>, so reach the switch through the shared row.
  await page.locator('span', { hasText: /^Close contours$/ }).first()
      .locator('xpath=..').locator('label').first().click({ force: true })
  await page.waitForTimeout(800)
  // Smoothing is the only 0..4 step-1 slider in the panel.
  await page.locator('input[type="range"][min="0"][max="4"][step="1"]').fill('3')
  await page.waitForTimeout(2000)

  const overlay = page.locator('[data-testid="loading-overlay"]')
  times.length = 0
  const t0 = Date.now()
  await page.click('[data-testid="soundscape-play"]')

  let overlaySeen = 0
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(400)
    if (await overlay.isVisible().catch(() => false)) overlaySeen++
  }
  const el = (Date.now() - t0) / 1000
  await page.click('[data-testid="soundscape-play"]')

  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0
  console.log(`contours close+smooth3 streaming: ${(times.length / el).toFixed(1)}/s, avg ${avg.toFixed(0)}ms, overlay ${overlaySeen}/10`)
  expect(overlaySeen, 'must not stall into the computing overlay').toBe(0)
  // Guards the contour work as a whole: measured 22.4/s here, against 12.8/s
  // before the chaining rewrite and post-smoothing decimation, on the same
  // machine and settings. A drop back under 18/s means one of them regressed.
  expect(times.length / el, 'contour throughput regressed').toBeGreaterThan(18)
})

test('freezing the whole track updates the sidebar spectrogram', async ({ page }) => {
  await openSoundscapes(page)
  await uploadTrack(page)

  const spectro = page.locator('#hm-panel-body > div')
    .filter({ hasText: /^Soundscapes/ }).first().locator('canvas').first()
  const freeze = page.locator('[data-testid="soundscape-freeze"]')

  // Mean luminance of the readout. The overlay marking "this is what is driving
  // the terrain" is a translucent white wash, so covering the whole track is
  // measurably brighter than shading a single streamed window.
  const brightness = () => spectro.evaluate((c) => {
    const off = document.createElement('canvas')
    off.width = 120; off.height = 40
    const ctx = off.getContext('2d')
    ctx.drawImage(c, 0, 0, 120, 40)
    const d = ctx.getImageData(0, 0, 120, 40).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    return sum / (d.length / 4)
  })

  // Play briefly so the streamed window sits mid-track, then pause.
  await page.click('[data-testid="soundscape-play"]')
  await page.waitForTimeout(1500)
  await page.click('[data-testid="soundscape-play"]')
  await page.waitForTimeout(400)
  const streaming = await brightness()

  await freeze.click()
  await page.waitForTimeout(1500)
  const frozen = await brightness()
  console.log(`spectrogram brightness: streaming=${streaming.toFixed(1)} frozen=${frozen.toFixed(1)}`)

  // Regression guard: the readout used to keep drawing the moving-window
  // highlight after a freeze, so it was pixel-identical before and after.
  expect(frozen, 'freezing must mark the whole track as the source').toBeGreaterThan(streaming + 3)
  await expect(freeze).toHaveText(/Frozen/)

  // Resuming playback must hand the readout back to the streaming window.
  await page.click('[data-testid="soundscape-play"]')
  await page.waitForTimeout(900)
  await page.click('[data-testid="soundscape-play"]')
  await page.waitForTimeout(400)
  const resumed = await brightness()
  console.log(`spectrogram brightness after resume: ${resumed.toFixed(1)}`)
  expect(resumed, 'playing again must release the frozen state').toBeLessThan(frozen - 3)
  await expect(freeze).toHaveText(/Freeze Whole Track/)
})
