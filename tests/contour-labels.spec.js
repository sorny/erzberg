import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * Contour labels — the elevation printed *into* the line.
 *
 * A printed topographic sheet does not set the number beside the contour, it
 * breaks the contour and sets the number in the gap at the line's own angle.
 * That is what makes a page of nested curves readable, and doing it means the
 * work is split across the worker boundary: placing a label needs the contour as
 * one chained stroke and breaking it moves geometry, both of which are worker
 * work — but naming the level needs the raster's real elevation range and
 * drawing it needs a font, and neither of those exists in the worker.
 *
 * So what is pinned here is that split holding together end to end.
 */
const PAGE = 'http://localhost:5173'

async function contoursOnly(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  const setMode = async (title, on) => {
    const row = page.locator('#hm-panel-body > div').filter({ hasText: new RegExp(`^${title}`) }).first()
    const tog = row.locator('label').first()
    await tog.scrollIntoViewIfNeeded()
    if ((await tog.locator('input').isChecked()) !== on) await tog.click({ force: true })
  }
  await setMode('Mode: Lines', false)
  await page.getByText('Mode: Contours', { exact: true }).click()
  await page.waitForTimeout(400)
  await setMode('Mode: Contours', true)
  await page.waitForTimeout(2000)
}

/** Exports an SVG and returns its text. */
async function exportSvg(page) {
  await page.locator('canvas').first().click({ position: { x: 5, y: 5 } })
  const dl = page.waitForEvent('download', { timeout: 120_000 })
  await page.keyboard.press('Digit1')
  let svg = ''
  for await (const c of await (await dl).createReadStream()) svg += c
  return svg
}

test('the worker places labels and breaks the line to fit them', async ({ page }) => {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  const r = await page.evaluate(async () => {
    const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
    const { buildTerrain } = await import('/src/utils/terrain.js')
    const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')

    const N = 160
    const px = new Float32Array(N * N)
    for (let r2 = 0; r2 < N; r2++) for (let c = 0; c < N; c++) {
      const dx = (c - N / 2) / (N / 2), dy = (r2 - N / 2) / (N / 2)
      px[r2 * N + c] = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)) * 0.8 + 0.1
    }
    const base = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale: 1, blurRadius: 0,
                   enabledLines: false, enabledContours: true }
    const t = buildTerrain(px, new Uint8Array(N * N).fill(1), N, N, base)

    const run = (over) => {
      const layers = buildLineGeometry(t, { ...base, ...over })
      const major = layers.find((l) => l.id === 'Contours-Major')
      return { segs: major ? major.positions.length / 6 : 0,
               anchors: major?.labelAnchors?.length ?? 0,
               sample: major?.labelAnchors?.[0] ?? null }
    }
    return { off: run({}), on: run({ labelContours: true }), minElev: t.minElev }
  })

  expect(r.off.anchors, 'no anchors when labelling is off').toBe(0)
  expect(r.on.anchors, 'labels must be placed').toBeGreaterThan(2)

  // The line is broken for them: the same contours carry *fewer* segments once
  // room has been made. This is the half that cannot be seen from the labels.
  expect(r.on.segs, 'the contour must be cut where a number goes').toBeLessThan(r.off.segs)

  // Anchors are placements, in world coordinates with a baseline angle — not
  // geometry, and not grid coordinates the main thread would have to convert.
  expect(r.on.sample).toHaveProperty('angle')
  expect(r.on.sample).toHaveProperty('rel')
  expect(Number.isFinite(r.on.sample.x)).toBe(true)
  // Height above the lowest ground, so an ordinary hill is never labelled
  // negative the way the zero-centred world elevation would make it.
  expect(r.on.sample.rel).toBeGreaterThanOrEqual(0)
})

test('labels are lettered, and read as height above the ground', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await contoursOnly(page)

  const before = await exportSvg(page)
  expect(before, 'no label layer before it is switched on').not.toContain('Labels')

  await page.locator('input[aria-label="Label heights"]').click({ force: true })
  await page.waitForTimeout(3000)
  const after = await exportSvg(page)

  // Its own pen layer, so the numbers can be a different pen from the lines.
  expect(after).toMatch(/inkscape:label="[^"]*Labels"/)

  // An outline face exports as editable text, exactly like the vector labels.
  const texts = [...after.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])
  expect(texts.length, 'the elevations must reach the SVG as text').toBeGreaterThan(5)
  for (const t of texts) {
    expect(t, `"${t}" is not a height`).toMatch(/^\d+$/)
  }
  // Every label on one contour says the same thing, and different contours do
  // not — the number has to come from the level, not from the position.
  expect(new Set(texts).size, 'more than one level must be labelled').toBeGreaterThan(1)
  expect(errors).toEqual([])
})

test('a stroke face letters the numbers as strokes', async ({ page }) => {
  // The same bargain the vector labels take: a single-line face has no installed
  // font for a reader to set `<text>` in, so it stays geometry.
  await contoursOnly(page)
  await page.locator('input[aria-label="Label heights"]').click({ force: true })
  await page.waitForTimeout(2000)
  await page.locator('input[aria-label="Use single-line font"]').last().click({ force: true })
  await page.waitForTimeout(3000)

  const svg = await exportSvg(page)
  const layer = svg.match(/<g id="layer-Contours-Labels"[\s\S]*?<\/g>\s*<\/g>/)?.[0] ?? ''
  expect(layer, 'the label layer must still export').not.toBe('')
  expect(layer, 'a stroke face draws its digits').toMatch(/<line |<polyline /)
  expect(layer).not.toContain('<text')
})

test('no contour is drawn through a label, and clearance is adjustable', async ({ page }) => {
  /*
   * The bug this guards.
   *
   * Room was reserved by cutting the label's own chain *by arclength*, which
   * leaves two ways for a line to end up across the digits. A contour that
   * hairpins comes back within a few units of the number while being a long way
   * off along the curve, so nothing removed it; and a different chain at the
   * same level — the far side of a narrow ridge, the next ring in a tight nest —
   * was never considered at all. On the reference terrain that put a contour
   * through 14 of 182 labels.
   *
   * Every segment at the level is now tested against every label box, so what is
   * asserted is the property rather than the mechanism: nothing at a label's own
   * elevation may cross the box the digits occupy.
   */
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)

  const measure = async (pad) => page.evaluate(async (pad) => {
    const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
    const { buildTerrain } = await import('/src/utils/terrain.js')
    const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')
    const { loadTextFont, fontStyleKey, textPolylines } = await import('/src/utils/textGeometry.js')

    // The real raster: a synthetic dome has no hairpins and cannot show this.
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = '/Heightmap.png'
    })
    const cv = document.createElement('canvas')
    cv.width = img.width; cv.height = img.height
    cv.getContext('2d').drawImage(img, 0, 0)
    const id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    const px = new Float32Array(cv.width * cv.height)
    for (let i = 0, j = 0; i < id.length; i += 4, j++) px[j] = id[i] / 255

    const P = { ...TERRAIN_DEF, ...STYLE_DEF, enabledLines: false, enabledContours: true,
                labelContours: true, elevScale: 6, labelPadContours: pad }
    const t = buildTerrain(px, new Uint8Array(cv.width * cv.height).fill(1), cv.width, cv.height, P)
    const major = buildLineGeometry(t, P).find((l) => l.id === 'Contours-Major')
    const font = await loadTextFont(fontStyleKey({}))
    const size = P.labelSizeContours
    const LIFT = 0.35

    let intruded = 0
    for (const a of major.labelAnchors) {
      const built = textPolylines(String(Math.round(a.rel)), font)
      let lo = Infinity, hi = -Infinity, vLo = Infinity, vHi = -Infinity
      for (const poly of built.polylines) for (let i = 0; i < poly.length; i += 2) {
        if (poly[i] < lo) lo = poly[i]
        if (poly[i] > hi) hi = poly[i]
        if (poly[i+1] < vLo) vLo = poly[i+1]
        if (poly[i+1] > vHi) vHi = poly[i+1]
      }
      const ca = Math.cos(a.angle), sa = Math.sin(a.angle)
      const halfAdv = (built.width * size) / 2
      const ox = a.x - ca * halfAdv, oz = a.z - sa * halfAdv
      const inkL = (ox + ca * lo * size - a.x) * ca + (oz + sa * lo * size - a.z) * sa
      const inkR = (ox + ca * hi * size - a.x) * ca + (oz + sa * hi * size - a.z) * sa
      const perpLo = (vLo - LIFT) * size, perpHi = (vHi - LIFT) * size

      const p = major.positions
      for (let i = 0; i < p.length; i += 3) {
        if (Math.abs(p[i + 1] - a.y) > 0.01) continue       // this label's level only
        const dx = p[i] - a.x, dz = p[i + 2] - a.z
        const across = -dx * sa + dz * ca
        if (across < perpLo || across > perpHi) continue     // above or below the glyphs
        const along = dx * ca + dz * sa
        if (along > inkL && along < inkR) { intruded++; break }
      }
    }
    return { anchors: major.labelAnchors.length, intruded }
  }, pad)

  const dflt = await measure(4)
  console.log(`clearance 4: ${dflt.anchors} labels, ${dflt.intruded} with a line through them`)
  expect(dflt.anchors, 'the terrain must carry plenty of labels').toBeGreaterThan(80)
  expect(dflt.intruded, 'no contour may cross its own label').toBe(0)

  // Clearance is real: more of it erases more line, so fewer contours fit a
  // label at all. (It is not merely accepted and ignored.)
  const wide = await measure(20)
  console.log(`clearance 20: ${wide.anchors} labels, ${wide.intruded} with a line through them`)
  expect(wide.intruded).toBe(0)
  expect(wide.anchors, 'a wider clearance must cost some placements')
    .toBeLessThan(dflt.anchors)
})
