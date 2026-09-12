/**
 * Dragging a file onto the window.
 *
 * The routing table has its own unit suite; what cannot be proved there is that
 * a drop reaches the same loaders the buttons reach. Three claims:
 *
 *  · the highlight comes up for a file and not for a text drag,
 *  · an exported plate is read as a *preset* and not as terrain — the one
 *    ambiguity in the whole feature, and the one that would be silently wrong,
 *  · a file nothing takes says where it does go, rather than nothing at all.
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'fs'
import path from 'path'
import { resetToDefaults, waitForApp } from './helpers.js'

/**
 * A `DataTransfer` in the page, holding one file read from disk.
 *
 * `name` is separate from the path because a Playwright download lands at a
 * temporary path with no extension at all, and the router reads the extension.
 * Passing the basename of that path would test a case the app never sees.
 */
async function fileTransfer(page, filePath, type = 'application/octet-stream', name = null) {
  const b64 = readFileSync(filePath).toString('base64')
  return page.evaluateHandle(({ b64, name, type }) => {
    const bin = atob(b64)
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([buf], name, { type }))
    return dt
  }, { b64, name: name ?? path.basename(filePath), type })
}

async function dropOn(page, dataTransfer) {
  await page.dispatchEvent('body', 'dragenter', { dataTransfer })
  await page.dispatchEvent('body', 'dragover', { dataTransfer })
  await page.dispatchEvent('body', 'drop', { dataTransfer })
}

const target = (page) => page.locator('[data-testid="drop-target"]')

test('the window says what it takes, and only for files', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })

  const dt = await fileTransfer(page, path.join(process.cwd(), 'public', 'presets', 'Blueprint.json'))
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt })
  await expect(target(page)).toBeVisible()
  await expect(target(page)).toContainText('GeoTIFF')

  await page.dispatchEvent('body', 'dragleave', { dataTransfer: dt })
  await expect(target(page)).toHaveCount(0)

  // A text drag — selected words from another tab — must not raise it.
  const textDt = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'Erzberg')
    return dt
  })
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: textDt })
  await expect(target(page)).toHaveCount(0)
})

test('a dropped preset is applied', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  const bg = page.locator('[data-testid="bg-color"]')
  const before = await bg.inputValue()

  const file = path.join(process.cwd(), 'public', 'presets', 'Blueprint.json')
  const wanted = JSON.parse(readFileSync(file, 'utf8')).style.bgColor
  expect(wanted).not.toBe(before)          // otherwise this proves nothing

  await dropOn(page, await fileTransfer(page, file, 'application/json'))
  await expect(bg).toHaveValue(wanted, { timeout: 15_000 })
  await expect(target(page)).toHaveCount(0)
})

test('a dropped plate restores its look and leaves the ground alone', async ({ page }) => {
  /*
   * The ambiguity, end to end.
   *
   * A PNG is both the heightmap format and an export format, so the router
   * reads the `tEXt` chunk to decide. Getting it backwards would load a picture
   * of a mountain *as* a mountain — a plausible-looking result that is entirely
   * wrong, and the reason this is worth eleven seconds.
   */
  test.setTimeout(300_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  const bg = page.locator('[data-testid="bg-color"]')
  const mark = '#7f1d3a'
  await bg.evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, v)
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, mark)
  await expect(bg).toHaveValue(mark)
  await page.waitForTimeout(1500)

  // Export the plate, which carries that colour inside it.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  const wait = page.waitForEvent('download', { timeout: 180_000 })
  await page.keyboard.press('Digit2')
  const dl = await wait
  const png = await dl.path()
  const pngName = dl.suggestedFilename()
  expect(pngName).toMatch(/\.png$/)

  const grid = await page.locator('text=Grid:').first().textContent()

  // Move the colour away, then drop the plate back.
  await bg.evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, '#123456')
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(bg).toHaveValue('#123456')

  await dropOn(page, await fileTransfer(page, png, 'image/png', pngName))
  await expect(bg).toHaveValue(mark, { timeout: 20_000 })

  // And the terrain is untouched: read as a heightmap, the plate's own pixels
  // would have replaced the ground and the grid would have changed with them.
  expect(await page.locator('text=Grid:').first().textContent()).toBe(grid)
})

test('a file nothing takes says where it does go', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('http://localhost:5173')
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })

  await dropOn(page, await fileTransfer(page,
    path.join(process.cwd(), 'tests', 'testdata', 'sweep.mp3'), 'audio/mpeg'))

  // The banner, not a refusal: audio has a home in this app, three sections up.
  await expect(page.locator('text=Soundscapes').last()).toBeVisible({ timeout: 10_000 })
})
