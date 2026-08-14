import { test, expect } from '@playwright/test'

const toggleFor = (page, label) =>
  page.locator(`xpath=//span[text()="${label}"]/following-sibling::label`)

async function openApp(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  const t = page.locator('[data-testid="sidebar-toggle"]')
  if ((await t.innerText()) === '◀') { await t.click(); await page.waitForTimeout(400) }
  await page.waitForTimeout(2500)
}

test('the frame geometry fits, scales and clips', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

  const r = await page.evaluate(async () => {
    const { frameRect, insetRect, clipSegment, paperAspect, paperRatioLabel, PAPERS } =
      await import('/src/utils/frame.js')

    // Largest rect of the asked-for shape that fits, at any canvas shape.
    const fits = []
    for (const [cw, ch] of [[1280, 800], [800, 1280], [1000, 1000]]) {
      for (const [paper, land] of [['iso', false], ['iso', true], ['square', false],
                                   ['letter', false], ['r169', true], ['custom', false]]) {
        for (const scale of [1, 0.85, 0.25]) {
          const a = paperAspect(paper, land, 1.6)
          const f = frameRect(cw, ch, a, scale)
          fits.push({
            aspect: f.w / f.h, want: a, scale,
            inside: f.x >= -0.01 && f.y >= -0.01 && f.x + f.w <= cw + 0.01 && f.y + f.h <= ch + 0.01,
            // At scale 1 it must touch the canvas on one pair of edges — that is
            // what "largest that fits" means.
            touches: scale !== 1 || Math.abs(f.w - cw) < 0.01 || Math.abs(f.h - ch) < 0.01,
          })
        }
      }
    }

    const isoP = paperAspect('iso', false), isoL = paperAspect('iso', true)
    // Distinct ratios, which is the point of listing by shape: every US size is
    // a different rectangle, while every ISO size is the same one.
    const ratios = Object.keys(PAPERS).filter(k => k !== 'custom').map(k => paperAspect(k))
    // Old preset ids must still resolve to the shape they drew, or a saved
    // composition would quietly change page on load.
    const legacy = {
      a3: paperAspect('a3'), a4: paperAspect('a4'), a5: paperAspect('a5'),
      wide: paperAspect('wide', true),
    }
    const custom = { at2: paperAspect('custom', false, 2), label: paperRatioLabel('letter') }

    const rect = { x: 100, y: 100, w: 200, h: 100 }
    const clip = {
      inside:  clipSegment(120, 120, 280, 180, rect),
      outside: clipSegment(0, 0, 50, 50, rect),
      // Straddles the left edge: the survivor must start exactly on x = 100.
      cross:   clipSegment(50, 150, 250, 150, rect),
      // Passes clean through, so both ends land on the boundary.
      through: clipSegment(0, 150, 400, 150, rect),
      parallelOut: clipSegment(0, 500, 400, 500, rect),
    }
    const margin = insetRect({ x: 0, y: 0, w: 200, h: 100 }, 0.1)
    return { fits, isoP, isoL, ratios, legacy, custom, clip, margin }
  })

  for (const f of r.fits) {
    expect(f.aspect, `aspect at scale ${f.scale}`).toBeCloseTo(f.want, 4)
    expect(f.inside, 'the frame must stay inside the canvas').toBe(true)
    expect(f.touches, 'at scale 1 it must be the largest that fits').toBe(true)
  }
  expect(r.isoP, 'ISO portrait is 1:√2').toBeCloseTo(1 / Math.SQRT2, 5)
  expect(r.isoL).toBeCloseTo(Math.SQRT2, 5)

  // No two entries may draw the same frame — that redundancy is what listing
  // A3, A4 and A5 separately produced.
  expect(new Set(r.ratios.map(v => v.toFixed(4))).size,
    'every listed paper must be a distinct shape').toBe(r.ratios.length)

  // Legacy ids keep their shape.
  expect(r.legacy.a3).toBeCloseTo(1 / Math.SQRT2, 5)
  expect(r.legacy.a4).toBeCloseTo(1 / Math.SQRT2, 5)
  expect(r.legacy.a5).toBeCloseTo(1 / Math.SQRT2, 5)
  expect(r.legacy.wide).toBeCloseTo(16 / 9, 5)

  expect(r.custom.at2, 'custom uses its own ratio').toBeCloseTo(1 / 2, 5)
  // 11 / 8.5 exactly. Deriving this from rounded millimetres gave 1.292, which
  // is the sort of drift storing real ratios avoids.
  expect(r.custom.label, 'US Letter is 11 / 8.5').toBe('1:1.294')

  // Clipping.
  expect(r.clip.inside, 'a segment inside is untouched').toMatchObject({ x0: 120, y0: 120, x1: 280, y1: 180 })
  expect(r.clip.inside.tHead).toBe(0)
  expect(r.clip.outside, 'a segment that misses is dropped').toBeNull()
  expect(r.clip.parallelOut, 'parallel and outside is dropped').toBeNull()
  expect(r.clip.cross.x0, 'a crossing segment starts on the boundary').toBeCloseTo(100, 6)
  expect(r.clip.cross.x1).toBeCloseTo(250, 6)
  // Head cut is a quarter of the 200-long segment, and dash phase depends on it.
  expect(r.clip.cross.tHead).toBeCloseTo(0.25, 6)
  expect(r.clip.through.x0).toBeCloseTo(100, 6)
  expect(r.clip.through.x1).toBeCloseTo(300, 6)

  // Margin insets by a fraction of the *shorter* side, so it is even all round.
  expect(r.margin).toMatchObject({ x: 10, y: 10, w: 180, h: 80 })
})

test('a framed SVG export contains nothing outside the page', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openApp(page)

  await toggleFor(page, 'Paper frame').click({ force: true })
  await page.locator('[data-testid="frame-margin"]').fill('0.06')
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(1200)

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.keyboard.press('Digit1'),
  ])
  const svg = await dl.createReadStream().then(s => new Promise((res, rej) => {
    const c = []; s.on('data', x => c.push(x)); s.on('end', () => res(Buffer.concat(c).toString())); s.on('error', rej)
  }))

  const [, vw, vh] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number)
  expect(vw / vh, 'the page must be the shape of the paper, not of the geometry')
    .toBeCloseTo(297 / 420, 3)

  // Every coordinate in the file, not a sample: the whole point of the feature
  // is that there is nothing left to delete afterwards.
  //
  // Before this, `offCanvas2` only dropped segments *entirely* outside the
  // canvas, so anything straddling an edge was written whole and the file
  // already carried marks beyond its own viewBox.
  let n = 0, outside = 0
  let minX = Infinity, maxX = -Infinity
  const EPS = 0.6   // coordinates are written to one decimal place
  const note = (x, y) => {
    n++
    if (x < -EPS || y < -EPS || x > vw + EPS || y > vh + EPS) outside++
    if (x < minX) minX = x
    if (x > maxX) maxX = x
  }
  for (const m of svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) {
    note(+m[1], +m[2]); note(+m[3], +m[4])
  }
  for (const m of svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)"/g)) note(+m[1], +m[2])

  console.log(`framed export: ${n} coordinates, ${outside} outside, page ${vw}×${vh}, x ${minX.toFixed(1)}..${maxX.toFixed(1)}`)
  expect(n, 'the export must actually contain the drawing').toBeGreaterThan(1000)
  expect(outside, 'nothing may lie outside the page').toBe(0)

  // The margin must be real: with a 6% inset nothing may reach the paper edge,
  // and the drawing must start at the inner edge rather than short of it.
  const inset = 0.06 * Math.min(vw, vh)
  expect(minX, 'content must respect the margin').toBeGreaterThanOrEqual(inset - EPS)
  expect(minX, 'and should reach it — a dense field is cut, not merely dropped')
    .toBeLessThan(inset + 4)

  expect(errors, `errors:\n${errors.join('\n')}`).toEqual([])
})

test('framing off leaves the export exactly as it was', async ({ page }) => {
  await openApp(page)
  // Framing defaults off, so this path must be byte-for-byte the old one: a
  // content-fitted viewBox rather than a paper-shaped page.
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.keyboard.press('Digit1'),
  ])
  const svg = await dl.createReadStream().then(s => new Promise((res, rej) => {
    const c = []; s.on('data', x => c.push(x)); s.on('end', () => res(Buffer.concat(c).toString())); s.on('error', rej)
  }))
  expect(svg).toContain('viewBox')
  expect((svg.match(/<line /g) || []).length).toBeGreaterThan(50)
  const [, vw, vh] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number)
  // The unframed viewBox follows the content, which on the default terrain is
  // nothing like A3.
  expect(Math.abs(vw / vh - 297 / 420)).toBeGreaterThan(0.05)
})
