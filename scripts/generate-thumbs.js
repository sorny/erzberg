/**
 * Generate a thumbnail for every preset in public/presets/manifest.json.
 *
 * Same approach as update-presets.js: drive the live dev server with Playwright,
 * apply each preset, and take the picture. The picture comes from the app's own
 * 4K PNG exporter rather than a page screenshot, because the exporter renders
 * the scene into an offscreen target — no sidebar, no orientation gizmo, and
 * trimmed to the art. It is then scaled down *in the browser* (canvas
 * cover-crop) so the script needs no image tooling on the host.
 *
 * Usage:
 *   node scripts/generate-thumbs.js                 # every preset in the manifest
 *   node scripts/generate-thumbs.js "Swiss Topo"    # just one
 *
 * Requires a running dev server at http://localhost:5173.
 */

import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PRESETS_DIR = resolve(__dirname, '../public/presets')
const THUMBS_DIR = resolve(PRESETS_DIR, 'thumbs')
const APP_URL = 'http://localhost:5173'

// 2× the 16:10 tile the sidebar draws, so it stays sharp on a Retina panel.
const THUMB_W = 320
const THUMB_H = 200

function loadManifest() {
  return JSON.parse(readFileSync(resolve(PRESETS_DIR, 'manifest.json'), 'utf8'))
}

/** Scale a PNG buffer to exactly THUMB_W×THUMB_H, cropping to fill. */
async function shrink(page, buffer) {
  return await page.evaluate(async ({ b64, w, h }) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    // cover: fill the tile, crop the overflow — the same thing the CSS does.
    const scale = Math.max(w / img.width, h / img.height)
    const dw = img.width * scale, dh = img.height * scale
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
    // WebP: this runs in Chrome, which can encode it, and every browser that
    // can run the app can display it. PNG of a stipple field was 55 KB a tile —
    // 56 of those is 3 MB in the repository for pictures 160 px wide.
    return cv.toDataURL('image/webp', 0.82).split(',')[1]
  }, { b64: buffer.toString('base64'), w: THUMB_W, h: THUMB_H })
}

async function shoot(page, name) {
  // The tile itself, as a click on it would: bundled presets are applied as
  // they are, not through parsePreset, so window.erzberg.applyPreset would
  // migrate them a second time.
  const found = await page.evaluate((n) => {
    const tile = document.querySelector(`[data-testid="preset-${CSS.escape(n)}"]`)
    tile?.click()
    return !!tile
  }, name)
  if (!found) throw new Error('no such style tile')
  await page.evaluate(() => window.erzberg.settle())

  const [download, status] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.evaluate(() => window.erzberg.export('png')),
  ])
  if (status !== 'done') throw new Error(`export ended "${status}"`)
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)

  const small = await shrink(page, Buffer.concat(chunks))
  const out = resolve(THUMBS_DIR, `${name}.webp`)
  writeFileSync(out, Buffer.from(small, 'base64'))
  return Buffer.from(small, 'base64').length
}

async function main() {
  const requested = process.argv.slice(2)
  const names = (requested.length ? requested : loadManifest().map((f) => f.replace('.json', '')))
  mkdirSync(THUMBS_DIR, { recursive: true })

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
  })
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()

  // ?automation for window.erzberg: settle() and the PNG export. Each preset
  // carries its own camera, so the tile shows the view the preset opens with.
  await page.goto(`${APP_URL}/?automation`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.erzberg?.version === 1, null, { timeout: 30000 })
  await page.waitForSelector('[data-testid="preset-grid"] .hmpreset', { state: 'attached', timeout: 30000 })
  await page.evaluate(() => window.erzberg.settle())

  let total = 0
  for (const name of names) {
    process.stdout.write(`→ ${name} … `)
    try {
      const bytes = await shoot(page, name)
      total += bytes
      console.log(`${(bytes / 1024).toFixed(0)} KB`)
    } catch (e) {
      console.log(`FAILED (${e.message.split('\n')[0]})`)
    }
  }

  await browser.close()

  // Report the two ways this can drift out of sync with the presets themselves.
  const manifest = loadManifest().map((f) => f.replace('.json', ''))
  const have = readdirSync(THUMBS_DIR).filter((f) => f.endsWith('.webp')).map((f) => f.replace('.webp', ''))
  const missing = manifest.filter((n) => !have.includes(n))
  const orphans = have.filter((n) => !manifest.includes(n))
  if (missing.length) console.log(`\n⚠ no thumbnail: ${missing.join(', ')}`)
  if (orphans.length) console.log(`\n⚠ orphan thumbnail (no such preset): ${orphans.join(', ')}`)
  console.log(`\n${have.length} thumbnails · ${(total / 1024).toFixed(0)} KB written`)
}

if (!existsSync(resolve(PRESETS_DIR, 'manifest.json'))) {
  console.error('No manifest.json in public/presets — nothing to do.')
  process.exit(1)
}
main()
