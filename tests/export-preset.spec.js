/**
 * A plate is its own project file.
 *
 * The unit suite proves the chunk and the comment round-trip as bytes. What it
 * cannot prove is that the *app* puts the current look into them and takes it
 * back out again — the payload is built in App.jsx, threaded through Scene.jsx
 * on an export trigger, and read back through a file picker. Every one of those
 * three joins can be wired to the wrong thing and still pass a byte test.
 *
 * So this exports for real, reads the downloaded file in Node, and then opens
 * that file back into a reset app. The last assertion is the whole feature: a
 * control that was moved before the export is at the same value afterwards,
 * having travelled only inside a picture.
 */
import { test, expect } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { openStage, resetToDefaults } from './helpers.js'
import { readPngPreset, readSvgPreset } from '../src/utils/presetFile.js'

const OUT = path.join(process.cwd(), 'test-results')

test.beforeAll(() => mkdirSync(OUT, { recursive: true }))

/** A tilt no default and no preset uses, so finding it later means something. */
const TILT = 33

const tiltSlider = (page) =>
  page.locator('input[type="range"][min="0"][max="180"][step="0.1"]').first()

/**
 * Move the camera off its default and hand focus back.
 *
 * The export hotkeys are a window listener that ignores events aimed at an
 * INPUT, so leaving focus on the slider makes the Digit2 below vanish and the
 * test time out waiting for a download that was never asked for.
 */
async function setTilt(page, deg) {
  // Tilt is in View, which is in the Frame pane.
  await openStage(page, 'frame')
  const tilt = tiltSlider(page)
  await expect(tilt).toBeVisible({ timeout: 15_000 })
  await tilt.fill(String(deg))
  await expect(tilt).toHaveValue(String(deg))
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(400)
}

/** Press an export hotkey and write what comes back to disk. */
async function exportTo(page, key, filename) {
  const wait = page.waitForEvent('download', { timeout: 90_000 })
  await page.keyboard.press(key)
  const dl = await wait
  const file = path.join(OUT, filename)
  writeFileSync(file, readFileSync(await dl.path()))
  return file
}

test('a PNG carries the look, and opens it again', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await setTilt(page, TILT)

  const file = await exportTo(page, 'Digit2', 'preset-carrier.png')

  // ── The chunk is there, and it holds this session's parameters ───────────
  const preset = readPngPreset(readFileSync(file))
  expect(preset, 'the exported PNG carries no erzberg:preset chunk').not.toBeNull()
  expect(preset.app).toBe('erzberg')
  expect(preset.format).toBe(2)
  expect(preset.view.tilt).toBe(TILT)
  // The promise the README makes. A plate is a picture that leaves the machine.
  expect(JSON.stringify(preset)).not.toContain('heightmapDataURL')

  // ── Put the camera back, then open the picture and watch it return ──────
  await resetToDefaults(page)
  await expect(tiltSlider(page)).not.toHaveValue(String(TILT))

  // Export opens by default, so the section is only clicked when something has
  // closed it — clicking an open one collapses it and hides the button below.
  await openStage(page, 'output')
  const section = page.locator('[data-testid="section-export"]')
  if ((await section.getAttribute('aria-expanded')) !== 'true') {
    await section.click()
    await page.waitForTimeout(300)
  }
  const open = page.locator('[data-testid="preset-load"]')
  await open.scrollIntoViewIfNeeded()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    open.click(),
  ])
  await chooser.setFiles(file)

  await expect(tiltSlider(page)).toHaveValue(String(TILT), { timeout: 15_000 })
})

test('an SVG carries the look as a comment a plotter never draws', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await setTilt(page, TILT)

  const svg = readFileSync(await exportTo(page, 'Digit1', 'preset-carrier.svg'), 'utf8')

  const preset = readSvgPreset(svg)
  expect(preset, 'the exported SVG carries no erzberg:preset comment').not.toBeNull()
  expect(preset.view.tilt).toBe(TILT)

  // A comment, not a mark: it sits above the first group and draws nothing.
  expect(svg.indexOf('erzberg:preset')).toBeLessThan(svg.indexOf('<g'))
  // And the document is still well formed — the escaping exists so that a `--`
  // inside the payload cannot close the comment and strand a `-->` in the file.
  expect(svg.match(/-->/g).length).toBe(svg.match(/<!--/g).length)
})
