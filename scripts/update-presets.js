/**
 * Update preset JSON files in public/presets/ by round-tripping them through
 * the live app. This picks up any new params added to STYLE_DEF / TERRAIN_DEF
 * since the preset was created, and strips the embedded heightmapDataURL.
 *
 * Usage:
 *   node scripts/update-presets.js                  # update all presets in manifest
 *   node scripts/update-presets.js "Swiss Topo"     # update one preset by name
 *   node scripts/update-presets.js "Swiss Topo" "Blueprint"  # update several
 *
 * Requires a running dev server at http://localhost:5173.
 */

import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PRESETS_DIR = resolve(__dirname, '../public/presets')
const APP_URL = 'http://localhost:5173'

function loadManifest() {
  return JSON.parse(readFileSync(resolve(PRESETS_DIR, 'manifest.json'), 'utf8'))
}

async function updatePreset(page, name) {
  console.log(`\n→ ${name}`)

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

  // Ensure sidebar is open (toggle shows ◀ when open)
  const toggle = page.locator('[data-testid="sidebar-toggle"]')
  if ((await toggle.innerText()) !== '◀') {
    await toggle.click()
    await page.waitForTimeout(300)
  }

  // Open Presets section and click the preset — sidebar is a fixed overlay with
  // its own scroll container, so we drive clicks via JS to bypass viewport checks.
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('span')]
      .find(el => el.textContent.trim() === 'Presets')
    heading?.click()
  })
  await page.waitForTimeout(150)

  // Click the preset button by exact label match
  await page.evaluate((presetName) => {
    const btn = [...document.querySelectorAll('button')]
      .find(el => el.textContent.trim() === presetName)
    btn?.click()
  }, name)

  // Wait for geometry to settle
  await page.waitForTimeout(1500)

  // Intercept the download triggered by "Preset ⬇"
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(el => el.textContent.includes('Preset') && el.textContent.includes('⬇'))
      btn?.click()
    }),
  ])

  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const json = JSON.parse(Buffer.concat(chunks).toString('utf8'))

  // Strip heightmapDataURL — it's large and not useful in shared presets
  delete json.heightmapDataURL

  const outPath = resolve(PRESETS_DIR, `${name}.json`)
  writeFileSync(outPath, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ saved ${outPath}`)

  // Let the page settle before navigating away
  await page.waitForTimeout(500)
}

async function main() {
  const manifest = loadManifest()
  // Names in manifest are like "Swiss Topo.json" → strip .json for display/lookup
  const allNames = manifest.map(f => f.replace(/\.json$/, ''))

  const requested = process.argv.slice(2)
  const names = requested.length ? requested : allNames

  const unknown = names.filter(n => !allNames.includes(n))
  if (unknown.length) {
    console.error(`Unknown preset(s): ${unknown.join(', ')}`)
    console.error(`Available: ${allNames.join(', ')}`)
    process.exit(1)
  }

  const browser = await chromium.launch({ headless: false })

  try {
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()

    for (const name of names) {
      await updatePreset(page, name)
    }

    await context.close()
  } finally {
    await browser.close()
  }

  console.log('\n✓ Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
