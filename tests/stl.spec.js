import { test, expect } from '@playwright/test'
import { deflateSync } from 'node:zlib'

/**
 * STL export content, which nothing covered before.
 *
 * The bug that prompted these: `buildSurfaceGeometry` parks NoData vertices at
 * y = -10000 as a hide-it sentinel — safe for rendering, because no index ever
 * references them, but the exporter read the raw position array. One voided
 * pixel dragged the base plate 10 000 units below the model and extruded the
 * side walls to match, so every DEM with holes exported an unprintable object.
 */

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function png(w, h, rgba) {
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A 128² heightmap with a fully transparent quadrant — alpha < 128 is NoData. */
function noDataHeightmap() {
  const w = 128, h = 128
  const rgba = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const v = Math.round(80 + 120 * Math.sin(x / 14) * Math.cos(y / 11))
      rgba[i] = rgba[i + 1] = rgba[i + 2] = Math.max(0, Math.min(255, v))
      // Transparent quadrant, including a run along the top and left borders so
      // the perimeter walk has to skip masked cells too.
      rgba[i + 3] = (x < w / 2 && y < h / 2) ? 0 : 255
    }
  }
  return png(w, h, rgba)
}

async function openApp(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  const t = page.locator('[data-testid="sidebar-toggle"]')
  if ((await t.innerText()) === '◀') { await t.click(); await page.waitForTimeout(400) }
  await page.waitForTimeout(2000)
}

const read = (dl) => dl.createReadStream().then((s) => new Promise((res, rej) => {
  const chunks = []
  s.on('data', (c) => chunks.push(c))
  s.on('end', () => res(Buffer.concat(chunks)))
  s.on('error', rej)
}))

/** Vertex bounds of a binary STL, per axis. */
function stlBounds(buf) {
  const nTri = buf.readUInt32LE(80)
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  let nonFinite = 0
  for (let t = 0; t < nTri; t++) {
    const base = 84 + t * 50 + 12          // skip the facet normal
    for (let v = 0; v < 3; v++) {
      for (let a = 0; a < 3; a++) {
        const f = buf.readFloatLE(base + v * 12 + a * 4)
        if (!Number.isFinite(f)) { nonFinite++; continue }
        if (f < lo[a]) lo[a] = f
        if (f > hi[a]) hi[a] = f
      }
    }
  }
  return { nTri, lo, hi, nonFinite }
}

test('STL export is unaffected by NoData regions', async ({ page }) => {
  await openApp(page)

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=↑ PNG'),
  ])
  await chooser.setFiles({ name: 'nodata.png', mimeType: 'image/png', buffer: noDataHeightmap() })
  await page.waitForTimeout(4000)

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.keyboard.press('Digit4'),
  ])
  const { nTri, lo, hi, nonFinite } = stlBounds(await read(dl))
  console.log(`STL: ${nTri} triangles, Z ${lo[2].toFixed(2)}…${hi[2].toFixed(2)}`)

  expect(nTri).toBeGreaterThan(100)
  expect(nonFinite, 'STL must contain no NaN or Infinity coordinates').toBe(0)

  // The sentinel is -10000; a model built from a heightmap this size spans a few
  // hundred units at most. Anything near the sentinel means it leaked into the
  // base plate or the side walls.
  expect(lo[2], 'the NoData sentinel must not reach the exported model').toBeGreaterThan(-1000)
  // And the model must still have real relief rather than collapsing to a plate.
  expect(hi[2] - lo[2]).toBeGreaterThan(1)
})

test('STL export writes nothing when an axis has no octants', async ({ page }) => {
  await openApp(page)

  // Clearing both +X and −X leaves zero octants, so the surface has no vertices.
  // The viewport going blank is fair feedback; silently downloading a multi-MB
  // file of NaN floats is not.
  // The Mirror section is collapsed by default and its wrapper swallows clicks
  // while closed, so it has to be opened rather than force-clicked through.
  await page.locator('#hm-panel-body > div').filter({ hasText: /^Mirror/ }).first()
    .locator('div').first().click()
  await page.waitForTimeout(400)

  for (const title of ['Mirror Right (+X)', 'Mirror Left (-X)']) {
    const btn = page.locator(`button[title="${title}"]`)
    // Only the enabled ones need clearing; +X is on by default, −X is not.
    if ((await btn.getAttribute('class'))?.includes('on')) await btn.click({ force: true })
  }

  // Wait on the rebuild actually landing rather than on a fixed delay: the whole
  // point is that geometry is empty before the export runs, and under load a
  // timeout can expire while the worker is still mid-build — which exports the
  // *previous* geometry and quietly passes for the wrong reason.
  await expect.poll(async () => {
    const t = await page.locator('text=/Triangles: [\\d,]+/').innerText()
    return Number(t.match(/Triangles: ([\d,]+)/)[1].replace(/,/g, ''))
  }, { timeout: 20000 }).toBe(0)

  let downloaded = false
  page.on('download', () => { downloaded = true })
  await page.keyboard.press('Digit4')
  await page.waitForTimeout(3000)
  expect(downloaded, 'no STL should be produced from empty geometry').toBe(false)
})

/**
 * The STL export must not freeze the page either.
 *
 * Same probe as the SVG freeze test in export.spec.js: a rAF loop timestamps
 * every frame, so the largest gap is the stretch during which the tab was
 * unresponsive. STL had no overlay at all before this — a big DEM simply stopped
 * the app with nothing on screen to explain it. Measured on the default plate at
 * the finest resolution, the block was 122 ms; paced, 47 ms.
 *
 * Resolution is driven to 1 because that is what makes the triangle count large
 * enough for the difference to exist at all.
 */
test('exporting STL keeps the page alive and says what it is doing', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30_000 })
  await page.waitForTimeout(2500)

  const driven = await page.evaluate(() => {
    const el = [...document.querySelectorAll('input.hmr')].find((i) => i.max === '20' && i.min === '1')
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '1')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })
  expect(driven, 'the Resolution slider should be reachable').toBe(true)
  await page.waitForTimeout(8000)

  const r = await page.evaluate(async () => {
    const gaps = []; const seen = []
    let last = performance.now(); let running = true; let sawOverlay = false
    const tick = () => {
      const n = performance.now(); gaps.push(n - last); last = n
      if (document.querySelector('[data-testid="loading-overlay"]')) sawOverlay = true
      const el = document.querySelector('[data-testid="export-progress"]')
      if (el) seen.push(Number(el.dataset.pct))
      if (running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    await new Promise((res) => setTimeout(res, 300))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4', bubbles: true }))
    await new Promise((res) => setTimeout(res, 6000))
    running = false
    return { longest: Math.max(...gaps), sawOverlay, seen }
  })

  console.log(`STL export: longest frozen stretch ${r.longest.toFixed(0)}ms, ` +
              `progress ${JSON.stringify(r.seen.slice(0, 10))}`)

  expect(r.sawOverlay, 'an STL export should put an overlay up').toBe(true)
  expect(r.longest,
    'the page must never sit unresponsive long enough to look hung').toBeLessThan(120)
})
