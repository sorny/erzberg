import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * The descent family, and the one property that separates it from Flow.
 *
 * Flow is a massless particle: it points exactly downhill at every step, so it
 * cannot overshoot, cannot bank, and stops when the gradient does. Everything
 * here integrates a velocity instead, and every assertion below is a consequence
 * a massless walk could not produce.
 *
 * The fields are picked so the answer is known before the code runs, and picking
 * them was most of the work. A cone is the obvious test terrain and it is the
 * wrong one for three of these: it is radially symmetric, so every track runs
 * straight down a fall line, never turns, and never meets a lip — Berm and Air
 * correctly draw nothing on it, and the carve slider correctly changes nothing.
 * A ramp-then-flat runout isolates momentum; a rough field gives turns; a sharp
 * step gives exactly one lip; a plane gives neither.
 */
const PAGE = 'http://localhost:5173'

async function ready(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
}

const run = (page, over, field = 'ridge') => page.evaluate(async ([over, field]) => {
  const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
  const { buildTerrain } = await import('/src/utils/terrain.js')
  const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')

  const N = 160
  const g = new Float32Array(N * N)
  const h2 = (x, y, s) => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0
    n = Math.imul(n ^ (n >>> 13), 1274126177)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295
  }
  const vn = (x, y, s) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
    return h2(ix, iy, s) * (1 - u) * (1 - v) + h2(ix + 1, iy, s) * u * (1 - v)
         + h2(ix, iy + 1, s) * (1 - u) * v + h2(ix + 1, iy + 1, s) * u * v
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const t = r / (N - 1)
    if (field === 'plane') {
      g[r * N + c] = 0.9 - 0.8 * t                       // constant gradient
    } else if (field === 'runout') {
      g[r * N + c] = t < 0.55 ? 0.95 - (0.9 * t) / 0.55 : 0.05   // slope, then flat
    } else if (field === 'step') {
      g[r * N + c] = t < 0.5 ? 0.95 - 0.18 * t * 2 : 0.77 - 0.72 * (t - 0.5) * 2
    } else {
      let a = 0, amp = 1, f = 1 / 30, sum = 0
      for (let o = 0; o < 6; o++) {
        a += amp * (1 - Math.abs(vn(c * f, r * f, 11 + o * 37) * 2 - 1))
        sum += amp; amp *= 0.62; f *= 2.03
      }
      g[r * N + c] = Math.pow(a / sum, 1.8)
    }
  }
  const mask = new Uint8Array(N * N).fill(1)
  const p = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale: 1, blurRadius: 0,
              enabledLines: false, ...over }
  const t = buildTerrain(g, mask, N, N, p)
  const layers = buildLineGeometry(t, p)
  const of = (id) => layers.find((x) => x.id === id)
  const n = (id) => { const l = of(id); return l ? l.positions.length / 6 : 0 }
  const sum = (id) => { const l = of(id); return l ? Math.round(l.positions.reduce((a, v) => a + v, 0)) : 0 }
  // How far down-slope (+z) the ink reaches, in cells past the seed row.
  const reach = (id) => {
    const l = of(id)
    if (!l) return -Infinity
    let m = -Infinity
    for (let i = 2; i < l.positions.length; i += 3) if (l.positions[i] > m) m = l.positions[i]
    return Math.round((m + t.halfH) / t.scl)
  }
  return { fall: n('FallLine'), fallSum: sum('FallLine'), fallReach: reach('FallLine'),
           flow: n('Flow'), flowReach: reach('Flow'),
           berm: n('Berm'), flight: n('Air-Flight'),
           field: n('RaceLine-Field'), best: n('RaceLine-Best'),
           ids: layers.map((l) => l.id) }
}, [over, field])

test('momentum carries a track out onto ground with no gradient left', async ({ page }) => {
  await ready(page)
  // A slope for the first 55% of the plate, dead flat after it. Flow has nothing
  // to follow past the break and stops there; a rider arrives with speed and
  // runs out across the flat. That overshoot is the mode.
  const r = await run(page, {
    enabledFallLine: true, enabledFlow: true,
    spacingFallLine: 14, spacingFlow: 14, maxLenFlow: 400, maxLenFallLine: 400,
    dragFallLine: 0.03, dragQuadFallLine: 0.004,
  }, 'runout')
  expect(r.flow).toBeGreaterThan(0)
  expect(r.fall).toBeGreaterThan(0)
  // The break is at row 88 of 160.
  expect(r.flowReach).toBeLessThan(100)
  expect(r.fallReach).toBeGreaterThan(r.flowReach + 20)
})

test('carve moves the line, on ground that has something to turn around',
  async ({ page }) => {
    await ready(page)
    // The yaw limit is mapped geometrically precisely so no part of the slider is
    // inert; two earlier scalings left everything below 0.5 byte-identical. It
    // still only bites where the track is already turning, which is why this runs
    // on a rough field rather than on a cone.
    const sums = []
    for (const carveFallLine of [0, 0.25, 0.5, 0.75, 1]) {
      const r = await run(page, { enabledFallLine: true, spacingFallLine: 10, carveFallLine })
      sums.push(r.fallSum)
    }
    expect(new Set(sums).size).toBe(sums.length)
  })

test('berms mark turning and nothing else', async ({ page }) => {
  await ready(page)
  const plane = await run(page, { enabledBerm: true, spacingBerm: 10 }, 'plane')
  const rough = await run(page, { enabledBerm: true, spacingBerm: 10 }, 'ridge')
  expect(plane.berm).toBe(0)
  expect(rough.berm).toBeGreaterThan(50)
})

test('a plane has no lips, so nobody leaves the ground', async ({ page }) => {
  await ready(page)
  const plane = await run(page, { enabledAir: true, spacingAir: 10 }, 'plane')
  expect(plane.flight).toBe(0)

  // The same ramp with one convex break in it — a 4× steepening — read off the
  // raw surface, at thresholds low enough that a single change of gradient is
  // enough. The defaults want sustained convex curvature rather than one break.
  const step = await run(page, {
    enabledAir: true, spacingAir: 10, smoothingAir: 0, minAirAir: 1,
    airGravityAir: 0.15, lipAir: 0.05,
  }, 'step')
  expect(step.flight).toBeGreaterThan(0)
})

test('smoothing keeps the airborne test off the grain', async ({ page }) => {
  await ready(page)
  const soft = { enabledAir: true, spacingAir: 10, minAirAir: 4, airGravityAir: 0.15, lipAir: 0.05 }
  const raw    = await run(page, { ...soft, smoothingAir: 0 })
  const smooth = await run(page, { ...soft, smoothingAir: 5 })
  expect(raw.flight).toBeGreaterThan(0)
  expect(smooth.flight).toBeLessThan(raw.flight)
})

test('a race line is a fan with one best run picked out of it', async ({ page }) => {
  await ready(page)
  const r = await run(page, {
    enabledRaceLine: true, dropsRaceLine: 1, fanRaceLine: 9, spacingRaceLine: 60,
  })
  expect(r.ids).toContain('RaceLine-Field')
  expect(r.ids).toContain('RaceLine-Best')
  expect(r.best).toBeGreaterThan(0)
  expect(r.field).toBeGreaterThan(r.best * 2)
})
