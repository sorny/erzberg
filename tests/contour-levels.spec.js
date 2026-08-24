import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * Where the contour levels sit.
 *
 * A contour ladder has to be anchored to something, and the only thing on the
 * page that means anything to a reader is the ground. World elevation does not:
 * it is centred on zero and stretched by the exaggeration slider, so a ladder of
 * round world elevations meets the terrain at an offset with no relation to it —
 * the lowest line an arbitrary fraction of an interval above the floor, moving
 * every time the exaggeration does.
 *
 * These run the builders directly rather than through the canvas: what is being
 * pinned is which levels exist, which is arithmetic, and reading it off pixels
 * would only make the failure harder to read.
 */
const PAGE = 'http://localhost:5173'

/** A cone spanning the full brightness range, plus a page with the app on it. */
async function ready(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
}

test('the ladder is anchored to the terrain floor, at every interval and exaggeration', async ({ page }) => {
  await ready(page)

  const runs = await page.evaluate(async () => {
    const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
    const { buildTerrain } = await import('/src/utils/terrain.js')
    const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')

    const N = 120
    const px = new Float32Array(N * N)
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const dx = (c - N / 2) / (N / 2), dy = (r - N / 2) / (N / 2)
      px[r * N + c] = Math.max(0, 1 - Math.hypot(dx, dy))
    }
    const mask = new Uint8Array(N * N).fill(1)

    const out = []
    for (const elevScale of [1, 2.5, 3.7]) {
      const base = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale, blurRadius: 0,
                     enabledLines: false, enabledContours: true, labelContours: true }
      const t = buildTerrain(px, mask, N, N, base)
      for (const interval of [2, 4, 7, 10, 25, 30]) {
        const layers = buildLineGeometry(t, { ...base, intervalContours: interval })
        const ys = new Set()
        for (const id of ['Contours-Minor', 'Contours-Major']) {
          const l = layers.find((x) => x.id === id)
          if (l) for (let i = 1; i < l.positions.length; i += 3) ys.add(+l.positions[i].toFixed(4))
        }
        const anchors = layers.find((x) => x.id === 'Contours-Major')?.labelAnchors ?? []
        out.push({
          elevScale, interval, minElev: t.minElev,
          levels: [...ys].sort((a, b) => a - b),
          rels: [...new Set(anchors.map((a) => +a.rel.toFixed(4)))].sort((a, b) => a - b),
        })
      }
    }
    return out
  })

  for (const r of runs) {
    const where = `elevScale ${r.elevScale}, interval ${r.interval}`
    expect(r.levels.length, `${where}: contours must be drawn`).toBeGreaterThan(2)

    // The floor itself carries no line on solid ground — every corner is at or
    // above it — so the first line drawn is one whole interval up, always. Under
    // the old anchoring this was anywhere from 0 to a full interval, and at
    // exaggeration 1 with a 30-unit interval it was 20 units: two thirds of an
    // interval of unlined valley floor.
    const above = r.levels[0] - r.minElev
    expect(above, `${where}: lowest contour is one interval above the floor`)
      .toBeCloseTo(r.interval, 6)

    // And every level from there is a multiple of the interval above the ground,
    // which is what makes the printed numbers the slider's own.
    for (const y of r.levels) {
      const k = (y - r.minElev) / r.interval
      expect(Math.abs(k - Math.round(k)), `${where}: level ${y} is off the ladder`).toBeLessThan(1e-6)
    }

    // The labels say the same thing the geometry does.
    for (const rel of r.rels) {
      const k = rel / r.interval
      expect(Math.abs(k - Math.round(k)), `${where}: label ${rel} is not a multiple`).toBeLessThan(1e-6)
    }
  }
})

test('an inverted terrain still draws contours on its cliffs', async ({ page }) => {
  await ready(page)

  /*
   * The bug this guards. The cell-major scan maps a cell's value range to a
   * range of level indices, and it read the low index off the low value — but a
   * negative exaggeration runs the levels *down* the brightness range, so the
   * two came out crossed for any cell spanning more than one level. Gentle
   * ground drew; cliffs drew nothing, and a full-range scarp drew nothing at all.
   */
  const r = await page.evaluate(async () => {
    const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
    const { buildTerrain } = await import('/src/utils/terrain.js')
    const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')

    const N = 64
    const px = new Float32Array(N * N)
    for (let r2 = 0; r2 < N; r2++) for (let c = 0; c < N; c++) px[r2 * N + c] = c < N / 2 ? 0 : 1
    const mask = new Uint8Array(N * N).fill(1)

    const count = (elevScale) => {
      const base = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale, blurRadius: 0,
                     enabledLines: false, enabledContours: true, intervalContours: 4 }
      const layers = buildLineGeometry(buildTerrain(px, mask, N, N, base), base)
      return ['Contours-Minor', 'Contours-Major'].reduce((n, id) => {
        const l = layers.find((x) => x.id === id)
        return n + (l ? l.positions.length / 6 : 0)
      }, 0)
    }
    return { up: count(1), down: count(-1) }
  })

  expect(r.up, 'the scarp draws upright').toBeGreaterThan(100)
  // Inverted, it is the same scarp read the other way — not necessarily segment
  // for segment, but the same order of drawing, and emphatically not zero.
  expect(r.down, 'the scarp draws inverted').toBeGreaterThan(r.up * 0.5)
})
