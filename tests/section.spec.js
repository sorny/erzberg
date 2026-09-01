import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * The section, and the one claim it makes that is more than decoration.
 *
 * The tool already *culls* by elevation. What makes this a drawing rather than
 * another cut is that the plane is drawn as a plane: a heavy cut face, the
 * material below it hatched at 45° in the drafting convention, and the ground
 * beyond it in outline. So there are two things worth pinning, and neither is
 * about how it looks.
 *
 * Face and hatch must lie *in* the cutting plane — at one elevation and no
 * other. And the cut level must decide how much of the terrain is material and
 * how much is beyond, in the right directions: the hatch is the material below
 * the plane rather than the disc the plane cuts, so on a cone it *grows* as the
 * plane rises even though the disc shrinks. Getting that backwards is the
 * mistake this spec exists to catch.
 *
 * This file was `frame.spec.js`, which also covered the space frame Exploded
 * Frame drew. That mode is gone and its three tests with it; these two never
 * depended on it.
 */
const PAGE = 'http://localhost:5173'

async function ready(page) {
  await page.goto(PAGE)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
}

const run = (page, over) => page.evaluate(async ([over]) => {
  const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
  const { buildTerrain } = await import('/src/utils/terrain.js')
  const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')

  // A cone: radially symmetric, so the only thing that moves the numbers below
  // is the height of the plane.
  const N = 140
  const g = new Float32Array(N * N)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const u = (c - N / 2) / (N / 2), v = (r - N / 2) / (N / 2)
    g[r * N + c] = Math.max(0, 1 - Math.hypot(u, v))
  }
  const mask = new Uint8Array(N * N).fill(1)
  const p = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale: 1, blurRadius: 0,
              enabledLines: false, ...over }
  const t = buildTerrain(g, mask, N, N, p)
  const layers = buildLineGeometry(t, p)
  const of = (id) => layers.find((x) => x.id === id)
  const n = (id) => { const l = of(id); return l ? l.positions.length / 6 : 0 }
  // Every distinct y in a layer, rounded — for the cut level.
  const levels = (id) => {
    const l = of(id)
    if (!l) return []
    return [...new Set([...l.positions].filter((_, i) => i % 3 === 1)
      .map((v) => Math.round(v * 100) / 100))]
  }
  return { ids: layers.map((l) => l.id),
           hatch: n('Section-Hatch'), face: n('Section-Face'), beyond: n('Section-Beyond'),
           faceLevels: levels('Section-Face'), hatchLevels: levels('Section-Hatch'),
           minElev: t.minElev, maxElev: t.maxElev }
}, [over])

test('the section cuts at one level, and the hatch stays under it', async ({ page }) => {
  await ready(page)
  for (const cutSection of [0.25, 0.5, 0.75]) {
    const r = await run(page, { enabledSection: true, cutSection, hatchSection: 4 })
    expect(r.ids).toEqual(expect.arrayContaining(['Section-Hatch', 'Section-Face', 'Section-Beyond']))
    const want = r.minElev + (r.maxElev - r.minElev) * cutSection
    // Both the face and the hatch lie *in* the cutting plane — one level, no others.
    expect(r.faceLevels.length).toBe(1)
    expect(r.faceLevels[0]).toBeCloseTo(want, 1)
    expect(r.hatchLevels.length).toBe(1)
    expect(r.hatchLevels[0]).toBeCloseTo(want, 1)
  }
})

test('the cut level decides how much is material and how much is beyond', async ({ page }) => {
  await ready(page)
  const low  = await run(page, { enabledSection: true, cutSection: 0.2, hatchSection: 3 })
  const high = await run(page, { enabledSection: true, cutSection: 0.8, hatchSection: 3 })
  /*
   * The two move in opposite directions, and it is worth being careful about
   * which way. The hatch is the *material below* the plane, not the disc the
   * plane cuts — on a cone the disc does shrink as the plane rises, while the
   * ground under it grows to nearly the whole raster. Beyond is the complement
   * and shrinks to nothing.
   */
  expect(high.hatch).toBeGreaterThan(low.hatch)
  expect(high.beyond).toBeLessThan(low.beyond)
})
