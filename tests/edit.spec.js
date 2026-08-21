import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const MP3 = path.join(here, 'testdata', 'sweep.mp3')
const GEOTIFF = 'tests/testdata/geotiff.tif'

/**
 * Edit Mode — clipping the loaded heightmap.
 *
 * The default Heightmap.png is 1024×1024 and autoResolution() picks 1 for it, so
 * the grid readout is the clipped raster's size in pixels. That makes the grid
 * line the cheapest end-to-end assertion available: it only reads 512×512 if the
 * clip reached the store, survived the derive, and rebuilt the geometry.
 */

async function boot(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  await expect(page.locator('text=Grid: 1024×1024')).toBeVisible({ timeout: 20000 })
}

async function openEditor(page) {
  await page.locator('[data-testid="edit-heightmap"]').click()
  await expect(page.locator('[data-testid="heightmap-editor"]')).toBeVisible()
  await expect(page.locator('[data-testid="edit-panel"]')).toBeVisible()
}

/** Numeric crop fields publish on blur/Enter, so type then commit. */
async function setCrop(page, { x, y, w, h }) {
  for (const [id, v] of [['edit-x', x], ['edit-y', y], ['edit-w', w], ['edit-h', h]]) {
    const f = page.locator(`[data-testid="${id}"]`)
    await f.fill(String(v))
    await f.press('Enter')
  }
}

test('crop applies, survives as a re-editable clip, and clears', async ({ page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  await boot(page)
  await openEditor(page)

  await setCrop(page, { x: 0, y: 0, w: 512, h: 512 })
  await expect(page.locator('[data-testid="edit-result"]')).toHaveText('512×512')

  await page.locator('[data-testid="edit-apply"]').click()
  await expect(page.locator('[data-testid="heightmap-editor"]')).toHaveCount(0)
  await expect(page.locator('text=Grid: 512×512')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('[data-testid="edit-summary"]')).toContainText('512×512 of 1024×1024')

  // Re-entering shows the *full* raster with the clip still set — the whole
  // point of keeping the source around.
  await openEditor(page)
  await expect(page.locator('[data-testid="edit-w"]')).toHaveValue('512')
  await page.locator('[data-testid="edit-cancel"]').click()
  await expect(page.locator('text=Grid: 512×512')).toBeVisible()

  await page.locator('[data-testid="edit-clear"]').click()
  await expect(page.locator('text=Grid: 1024×1024')).toBeVisible({ timeout: 20000 })

  expect(errors).toEqual([])
})

test('Escape leaves Edit Mode without applying the draft', async ({ page }) => {
  await boot(page)
  await openEditor(page)

  await setCrop(page, { x: 100, y: 100, w: 256, h: 256 })
  await expect(page.locator('[data-testid="edit-result"]')).toHaveText('256×256')

  await page.locator('[data-testid="heightmap-editor"]').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-testid="heightmap-editor"]')).toHaveCount(0)
  await expect(page.locator('text=Grid: 1024×1024')).toBeVisible()
  await expect(page.locator('[data-testid="edit-summary"]')).toHaveCount(0)
})

test('the clip maths crops, masks, feathers and re-georeferences', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

  // heightmapEdit is pure, so the dev server can hand it over directly rather
  // than these numbers being inferred from what the terrain looks like.
  const r = await page.evaluate(async () => {
    const { applyEdit, cropBbox } = await import('/src/utils/heightmapEdit.js')
    const w = 100, h = 100
    const px = new Float32Array(w * h)
    for (let i = 0; i < px.length; i++) px[i] = 0.2 + 0.6 * ((i % w) / (w - 1))  // horizontal ramp
    const src = { pixels: px, mask: null, width: w, height: h }
    const full = { x: 0, y: 0, w, h }

    const crop = applyEdit(src, { rect: { x: 10, y: 20, w: 30, h: 40 }, shape: null, feather: 0 })
    const poly = applyEdit(src, {
      rect: full,
      shape: { type: 'polygon', points: [50, 50, 70, 50, 70, 70, 50, 70] },
      feather: 0,
    })
    const feat = applyEdit(src, { rect: full, shape: null, feather: 10 })

    let inside = 0
    for (let i = 0; i < poly.mask.length; i++) inside += poly.mask[i]

    return {
      crop: { w: crop.width, h: crop.height, corner: crop.pixels[0], want: px[20 * w + 10] },
      poly: { w: poly.width, h: poly.height, inside },
      feat: { edge: feat.pixels[50 * w + 99], middle: feat.pixels[50 * w + 50] },
      source: { edge: px[50 * w + 99], middle: px[50 * w + 50] },
      bbox: cropBbox([0, 0, 1000, 1000], { x: 10, y: 20, w: 30, h: 40 }, w, h),
    }
  })

  // A crop is the sub-rectangle, with its own top-left where the rect starts.
  expect(r.crop.w).toBe(30)
  expect(r.crop.h).toBe(40)
  expect(r.crop.corner).toBeCloseTo(r.crop.want, 6)

  // A 20×20 square selection: cropped to its bounds, everything else masked out.
  expect(r.poly.w).toBe(21)
  expect(r.poly.h).toBe(21)
  expect(r.poly.inside).toBe(400)

  // Feather ramps the edge down to the selection's own floor (0.2 here) while
  // leaving anything further in than the radius untouched.
  expect(r.feat.middle).toBeCloseTo(r.source.middle, 6)
  expect(r.source.edge).toBeCloseTo(0.8, 6)
  expect(r.feat.edge).toBeLessThan(0.3)
  expect(r.feat.edge).toBeGreaterThanOrEqual(0.2)

  // Cropping moves the georeferenced corners with the pixels, or a GPX track
  // would be projected against the extent of a raster that no longer exists.
  expect(r.bbox).toEqual([100, 400, 400, 800])
})

test('a lasso selection clips the terrain down to what it encloses', async ({ page }) => {
  await boot(page)
  await openEditor(page)
  await page.locator('[data-testid="edit-tool-lasso"]').click()

  // Trace a triangle across the middle of the preview. The exact pixel bounds
  // depend on the fit, so the assertion is "much smaller than the source",
  // not an exact size.
  const box = await page.locator('[data-testid="heightmap-editor"]').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.move(cx - 120, cy - 100)
  await page.mouse.down()
  await page.mouse.move(cx + 120, cy - 100, { steps: 12 })
  await page.mouse.move(cx + 120, cy + 100, { steps: 12 })
  await page.mouse.move(cx - 120, cy + 100, { steps: 12 })
  await page.mouse.up()

  await expect(page.locator('[data-testid="edit-panel"]')).toContainText('lasso')

  await page.locator('[data-testid="edit-apply"]').click()
  await expect(page.locator('[data-testid="heightmap-editor"]')).toHaveCount(0)

  // Poll rather than read once: the readout still says 1024×1024 until the
  // worker delivers, and a regex locator matches that perfectly well.
  const grid = page.locator('text=/Grid: \\d+×\\d+/')
  const readGrid = async () => (await grid.innerText()).match(/Grid: (\d+)×(\d+)/).slice(1).map(Number)
  await expect.poll(async () => (await readGrid())[0], { timeout: 20000 }).toBeLessThan(900)

  const [w, h] = await readGrid()
  expect(w).toBeGreaterThan(50)
  expect(h).toBeGreaterThan(50)
  expect(h).toBeLessThan(900)
})

test('a clip holds while a Soundscape streams new frames under it', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  await page.locator('text=SOUNDSCAPES').click()

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=↑ Audio'),
  ])
  await chooser.setFiles(MP3)
  await expect(page.locator('[data-testid="soundscape-play"]')).toBeVisible({ timeout: 30000 })
  // The streaming window is 512 frames × 512 bins.
  await expect(page.locator('text=Grid: 512×512')).toBeVisible({ timeout: 20000 })

  await page.locator('[data-testid="edit-heightmap"]').click()
  await setCrop(page, { x: 0, y: 0, w: 256, h: 128 })
  await page.locator('[data-testid="edit-apply"]').click()
  await expect(page.locator('text=Grid: 256×128')).toBeVisible({ timeout: 20000 })

  // Playback pushes a fresh raster ~30×/s. Each one is a new *source*, so the
  // clip has to be re-applied on the way through rather than dropped.
  await page.locator('[data-testid="soundscape-play"]').click()
  await page.waitForTimeout(1500)
  await page.locator('[data-testid="soundscape-play"]').click()
  await expect(page.locator('text=Grid: 256×128')).toBeVisible()

  // Freezing changes the raster's dimensions, which is what drops the clip.
  await page.locator('[data-testid="soundscape-freeze"]').click()
  await expect(page.locator('[data-testid="edit-summary"]')).toHaveCount(0)
})

test.describe('GeoTIFF', () => {
  test.skip(!existsSync(GEOTIFF), `${GEOTIFF} not present (gitignored) — see tests/testdata/README.md`)

  test('cropping keeps the elevation range the raster reported', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForSelector('text=erzberg', { timeout: 30000 })
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-testid="load-geotiff"]'),
    ])
    await chooser.setFiles(GEOTIFF)
    await page.waitForFunction(() => !!document.body.innerText.match(/Elevation:\s*\d/), { timeout: 30000 })
    const before = await page.innerText('body')
    expect(before).toContain('Elevation: 641 – 2350 m')

    await page.locator('[data-testid="edit-heightmap"]').click()
    await setCrop(page, { x: 200, y: 100, w: 400, h: 300 })
    await page.locator('[data-testid="edit-apply"]').click()
    await expect(page.locator('text=Grid: 400×300')).toBeVisible({ timeout: 20000 })

    // Pixels are normalised against the file's own min/max at load. A crop must
    // not renormalise, or every elevation readout and cut would drift with it.
    expect(await page.innerText('body')).toContain('Elevation: 641 – 2350 m')
  })
})

test('the polygon tool closes on Enter and clips to the ring', async ({ page }) => {
  await boot(page)
  await openEditor(page)
  await page.locator('[data-testid="edit-tool-polygon"]').click()

  const box = await page.locator('[data-testid="heightmap-editor"]').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  for (const [dx, dy] of [[-100, -80], [110, -90], [130, 60], [-40, 100]]) {
    await page.mouse.click(cx + dx, cy + dy)
  }
  // Vertices being placed live on the canvas, not in React state, so the panel
  // still reads "none" until the ring closes.
  await expect(page.locator('[data-testid="edit-panel"]')).toContainText('none')

  // Enter closes the ring; it must not also leave Edit Mode, which is what the
  // same key does once no shape is being drawn.
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-testid="heightmap-editor"]')).toBeVisible()
  await expect(page.locator('[data-testid="edit-panel"]')).toContainText('polygon · 4 pts')

  await page.locator('[data-testid="edit-apply"]').click()
  await expect(page.locator('[data-testid="heightmap-editor"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="edit-summary"]')).toContainText('polygon')
})

test('the ellipse tool draws an ellipse, and Shift makes it a circle', async ({ page }) => {
  await boot(page)
  await openEditor(page)
  await page.locator('[data-testid="edit-tool-ellipse"]').click()

  const box = await page.locator('[data-testid="heightmap-editor"]').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2

  await page.mouse.move(cx - 200, cy - 100)
  await page.mouse.down()
  await page.mouse.move(cx + 100, cy + 120, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('[data-testid="edit-panel"]')).toContainText('ellipse')

  // An ellipse drawn freely is not round…
  const free = await page.locator('[data-testid="edit-result"]').innerText()
  const [fw, fh] = free.split('×').map(Number)
  expect(Math.abs(fw - fh)).toBeGreaterThan(20)

  // …but Shift makes the two axes equal, whatever the drag shape.
  await page.mouse.move(cx - 180, cy - 120)
  await page.mouse.down()
  await page.mouse.move(cx + 40, cy + 30, { steps: 6 })
  await page.keyboard.down('Shift')
  await page.mouse.move(cx + 120, cy + 50, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Shift')

  const circle = await page.locator('[data-testid="edit-result"]').innerText()
  const [w, h] = circle.split('×').map(Number)
  expect(Math.abs(w - h)).toBeLessThanOrEqual(1)

  await page.locator('[data-testid="edit-apply"]').click()
  await expect(page.locator('[data-testid="edit-summary"]')).toContainText('ellipse')
})

test('an ellipse selection fills the area an ellipse should', async ({ page }) => {
  await boot(page)

  const r = await page.evaluate(async () => {
    const { applyEdit } = await import('/src/utils/heightmapEdit.js')
    const w = 400, h = 300
    const src = { pixels: new Float32Array(w * h).fill(0.5), mask: null, width: w, height: h }
    const out = applyEdit(src, {
      rect: { x: 0, y: 0, w, h },
      shape: { type: 'ellipse', cx: 200, cy: 150, rx: 120, ry: 80 },
      feather: 0,
    })
    let inside = 0
    for (let i = 0; i < out.mask.length; i++) inside += out.mask[i]
    return { w: out.width, h: out.height, inside, expected: Math.PI * 120 * 80 }
  })

  // Cropped to the ellipse's own bounding box, plus the inclusive edge pixel.
  expect(r.w).toBeGreaterThanOrEqual(240)
  expect(r.w).toBeLessThanOrEqual(242)
  expect(r.h).toBeGreaterThanOrEqual(160)
  expect(r.h).toBeLessThanOrEqual(162)
  // πab, to within a pixel of quantisation around the perimeter.
  expect(Math.abs(r.inside - r.expected) / r.expected).toBeLessThan(0.01)
})

test('a committed ring can be reshaped without redrawing it', async ({ page }) => {
  await boot(page)
  await openEditor(page)
  await page.locator('[data-testid="edit-tool-polygon"]').click()

  const box = await page.locator('[data-testid="heightmap-editor"]').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  const corners = [[-120, -100], [120, -100], [120, 100], [-120, 100]]
  for (const [dx, dy] of corners) await page.mouse.click(cx + dx, cy + dy)
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-testid="edit-panel"]')).toContainText('polygon · 4 pts')
  const before = await page.locator('[data-testid="edit-result"]').innerText()

  // Drag the top-left vertex further out — the selection must follow it.
  await page.mouse.move(cx - 120, cy - 100)
  await page.mouse.down()
  await page.mouse.move(cx - 220, cy - 180, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  expect(await page.locator('[data-testid="edit-result"]').innerText()).not.toBe(before)
  await expect(page.locator('[data-testid="edit-panel"]')).toContainText('polygon · 4 pts')

  // Grabbing an edge splits it, right-clicking a point takes it away.
  await page.mouse.click(cx + 120, cy)
  await expect(page.locator('[data-testid="edit-panel"]')).toContainText('polygon · 5 pts')
  await page.mouse.click(cx + 120, cy, { button: 'right' })
  await expect(page.locator('[data-testid="edit-panel"]')).toContainText('polygon · 4 pts')
})

/**
 * Read the canvas cursor after parking the pointer somewhere.
 *
 * The handles are 7–8 screen pixels on a busy greyscale raster, so the cursor is
 * what tells you a press will grab one rather than start a new shape. These
 * hover the exact screen points a gesture was made at — a drag's endpoints *are*
 * the box corners, a click's position *is* the vertex — so nothing here has to
 * know the editor's zoom or pan.
 */
async function cursorAt(page, x, y) {
  await page.mouse.move(x, y)
  await page.waitForTimeout(60)
  return page.locator('[data-testid="heightmap-editor"] canvas')
    .evaluate(el => getComputedStyle(el).cursor)
}

test('the cursor says which ring point the pointer has', async ({ page }) => {
  await boot(page)
  await openEditor(page)
  await page.locator('[data-testid="edit-tool-polygon"]').click()

  const box = await page.locator('[data-testid="heightmap-editor"]').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  const corners = [[-120, -100], [120, -100], [120, 100], [-120, 100]]
  for (const [dx, dy] of corners) await page.mouse.click(cx + dx, cy + dy)
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-testid="edit-panel"]')).toContainText('polygon · 4 pts')

  expect(await cursorAt(page, cx - 120, cy - 100), 'on a vertex').toBe('grab')
  expect(await cursorAt(page, cx + 120, cy),       'midway along an edge').toBe('copy')
  expect(await cursorAt(page, cx, cy),             'interior, no handle').toBe('crosshair')

  // Mid-drag it stays `grabbing` even though the pointer has left the vertex —
  // pointer capture means the gesture, not the ground under it, decides.
  await page.mouse.move(cx - 120, cy - 100)
  await page.mouse.down()
  await page.mouse.move(cx - 40, cy - 30, { steps: 6 })
  const held = await page.locator('[data-testid="heightmap-editor"] canvas')
    .evaluate(el => getComputedStyle(el).cursor)
  await page.mouse.up()
  expect(held, 'while dragging a vertex').toBe('grabbing')
})

test('the cursor says which way a box handle resizes', async ({ page }) => {
  await boot(page)
  await openEditor(page)

  const box = await page.locator('[data-testid="heightmap-editor"]').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  const x0 = cx - 160, y0 = cy - 120, x1 = cx + 160, y1 = cy + 120

  // The crop starts at the full extent, where a drag inside draws rather than
  // moves — so draw a smaller one first. Its corners land on the drag endpoints.
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x1, y1, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(200)

  expect(await cursorAt(page, x0, y0),           'crop nw corner').toBe('nwse-resize')
  expect(await cursorAt(page, x1, y0),           'crop ne corner').toBe('nesw-resize')
  expect(await cursorAt(page, (x0 + x1) / 2, y0), 'crop n edge').toBe('ns-resize')
  expect(await cursorAt(page, x0, (y0 + y1) / 2), 'crop w edge').toBe('ew-resize')
  expect(await cursorAt(page, cx, cy),           'inside the crop').toBe('move')
  expect(await cursorAt(page, box.x + 6, box.y + 6), 'outside it').toBe('crosshair')

  // The ellipse carries the same eight grips on its bounding box.
  await page.locator('[data-testid="edit-tool-ellipse"]').click()
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x1, y1, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('[data-testid="edit-panel"]')).toContainText('ellipse')

  expect(await cursorAt(page, x0, y0),            'ellipse nw grip').toBe('nwse-resize')
  expect(await cursorAt(page, (x0 + x1) / 2, y1), 'ellipse s grip').toBe('ns-resize')
  expect(await cursorAt(page, cx, cy),            'inside the ellipse').toBe('move')
})
