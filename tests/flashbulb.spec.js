import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * The three things that make Flashbulb a bulb rather than a sun.
 *
 * Falloff — ink has to increase with distance from the light, which a
 * directional source cannot produce at all. Occlusion — the marched shadow may
 * only ever add ink, never remove it. And the grain — blue noise is the whole
 * reason the mode reads as emulsion instead of as a halftone screen, so the
 * emitted dots are checked for the property that distinguishes it from a random
 * threshold at the same density: blue noise does not clump.
 */
const PAGE = 'http://localhost:5173'

async function ready(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
}

const run = (page, over, field = 'cone') => page.evaluate(async ([over, field]) => {
  const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
  const { buildTerrain } = await import('/src/utils/terrain.js')
  const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')

  const N = 140
  const g = new Float32Array(N * N)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (field === 'ramp') {
      // A gentle plane: one constant normal, so the exposure — and therefore the
      // dot density — is near-uniform across the plate. That is what makes a
      // uniform-random baseline a fair comparison for the dither.
      g[r * N + c] = 0.35 + 0.30 * (c / (N - 1))
    } else {
      const dx = (c - N / 2) / (N / 2), dy = (r - N / 2) / (N / 2)
      g[r * N + c] = Math.max(0, 1 - Math.hypot(dx, dy))     // a cone
    }
  }
  const mask = new Uint8Array(N * N).fill(1)
  const p = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale: 1, blurRadius: 0,
              enabledLines: false, enabledFlashbulb: true, spacingFlashbulb: 1, ...over }
  const t = buildTerrain(g, mask, N, N, p)
  const l = buildLineGeometry(t, p).find((x) => x.id === 'Flashbulb')
  if (!l) return { dots: 0 }

  // Dot centres back in cell coordinates.
  const P = l.positions, pts = []
  for (let i = 0; i < P.length; i += 6) {
    pts.push([(P[i] + P[i + 3]) / 2 / t.scl + t.halfW / t.scl,
              P[i + 2] / t.scl + t.halfH / t.scl])
  }
  return { dots: pts.length, pts, N, isPoints: !!l.isPoints,
           checksum: Math.round(P.reduce((a, v) => a + v, 0) * 100) }
}, [over, field])

test('ink increases with distance from the bulb — a directional light cannot do this', async ({ page }) => {
  await ready(page)
  // Bulb close and overhead: the falloff bites, so the far half of the plate is
  // dark and the near half is blown out. Split the plate along the light's own
  // bearing and the two halves must be lopsided.
  const r = await run(page, { azimuthFlashbulb: 0, distanceFlashbulb: 0.6,
                              falloffFlashbulb: 0.35, shadowFlashbulb: false })
  expect(r.dots).toBeGreaterThan(500)
  const near = r.pts.filter(([x]) => x > r.N * 0.6).length
  const far  = r.pts.filter(([x]) => x < r.N * 0.4).length
  expect(far).toBeGreaterThan(near * 1.5)
})

test('cast shadow only ever adds ink', async ({ page }) => {
  await ready(page)
  const off = await run(page, { shadowFlashbulb: false })
  const on  = await run(page, { shadowFlashbulb: true, shadowStepsFlashbulb: 32 })
  expect(on.dots).toBeGreaterThanOrEqual(off.dots)
  // And it has to actually do something on a cone lit from the side.
  expect(on.dots).toBeGreaterThan(off.dots)
})

test('the dither tile is blue noise, not a random threshold', async ({ page }) => {
  await ready(page)

  // Tested on the tile rather than through the emitted dots. The pipeline's own
  // tone curve makes the density strongly non-uniform, and a clumping measure
  // over a non-uniform field says more about the terrain than about the noise.
  const r = await page.evaluate(async () => {
    const { blueNoiseTile } = await import('/src/utils/geometryBuilders.js')
    const { S, tile } = blueNoiseTile()

    // Toroidal nearest-neighbour distance, since the tile is meant to wrap.
    const meanNN = (pts) => {
      let sum = 0
      for (const [ax, ay] of pts) {
        let best = Infinity
        for (const [bx, by] of pts) {
          if (bx === ax && by === ay) continue
          let dx = Math.abs(bx - ax), dy = Math.abs(by - ay)
          if (dx > S / 2) dx = S - dx
          if (dy > S / 2) dy = S - dy
          const d = dx * dx + dy * dy
          if (d < best) best = d
        }
        sum += Math.sqrt(best)
      }
      return sum / pts.length
    }
    const setAt = (t, pick) => {
      const out = []
      for (let i = 0; i < S * S; i++) if (pick(tile[i], i) < t) out.push([i % S, (i / S) | 0])
      return out
    }
    let seed = 99
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
    const white = new Float32Array(S * S)
    for (let i = 0; i < white.length; i++) white[i] = rnd()

    const rows = []
    for (const t of [0.04, 0.08, 0.15, 0.3]) {
      rows.push({
        t,
        n: setAt(t, (v) => v).length,
        blue: meanNN(setAt(t, (v) => v)),
        white: meanNN(setAt(t, (_, i) => white[i])),
      })
    }
    // The rank ordering must be a permutation of 0…n−1: every cell distinct, so
    // the tile is a usable threshold at every density.
    const uniq = new Set(tile).size
    return { S, rows, uniq, total: S * S,
             min: Math.min(...tile), max: Math.max(...tile) }
  })

  expect(r.S).toBe(64)
  expect(r.uniq).toBe(r.total)       // a strict ranking, so every level is usable
  expect(r.min).toBeGreaterThan(0)
  expect(r.max).toBeLessThan(1)

  for (const row of r.rows) {
    console.log(`[BlueNoise] t=${row.t} n=${row.n} meanNN blue ${row.blue.toFixed(2)} white ${row.white.toFixed(2)}`)
    expect(row.n).toBeGreaterThan(20)
    /*
     * Blue noise holds its points apart; white noise does not. The gap is the
     * whole reason the grain reads as emulsion rather than as sand, and a swap
     * to Math.random() erases it.
     *
     * The margin narrows with density, and not because the tile gets worse: at
     * 30% coverage on an integer lattice the *best possible* mean separation is
     * only about 1.8 cells, so there is barely any room above white noise's 1.1
     * to claim. Measured 1.6× at 4% and 8%, 1.5× at 15%, 1.11× at 30%. The
     * assertion follows the headroom rather than pretending it is constant.
     */
    expect(row.blue).toBeGreaterThan(row.white * (row.t <= 0.15 ? 1.3 : 1.05))
  }
})

test('solarising folds the tone curve rather than just darkening', async ({ page }) => {
  await ready(page)
  const plain = await run(page, { foldFlashbulb: false, shadowFlashbulb: false })
  const fold  = await run(page, { foldFlashbulb: true,  shadowFlashbulb: false })
  expect(fold.dots).not.toBe(plain.dots)
  expect(fold.checksum).not.toBe(plain.checksum)
})

test('the same seed gives the identical grain', async ({ page }) => {
  await ready(page)
  const a = await run(page, { seedFlashbulb: 7 })
  const b = await run(page, { seedFlashbulb: 7 })
  const c = await run(page, { seedFlashbulb: 8 })
  expect(a.checksum).toBe(b.checksum)
  expect(c.checksum).not.toBe(a.checksum)
})
