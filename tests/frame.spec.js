import { test, expect } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

/**
 * The space frame, and the one claim it makes that is more than decoration.
 *
 * A rectangular panel with pin joints is a mechanism: it needs one diagonal, and
 * *which* diagonal depends on which way it is being racked. The mode reads that
 * from the terrain's twist — the Hessian's off-diagonal — so the assertion is
 * that the bracing genuinely follows the sign of h_xy rather than being a
 * texture laid over the lattice.
 *
 * The field that proves it is H ∝ (c−c₀)(r−r₀): the saddle whose mixed second
 * derivative is a nonzero constant of known sign everywhere. Flip the sign and
 * every brace in the frame must flip with it. (The obvious saddle, x² − y², has
 * h_xy = 0 and would brace nothing.)
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
    const u = (c - N / 2) / (N / 2), v = (r - N / 2) / (N / 2)
    if (field === 'twist')    g[r * N + c] = 0.5 + 0.45 * u * v
    else if (field === 'antitwist') g[r * N + c] = 0.5 - 0.45 * u * v
    else if (field === 'plane') g[r * N + c] = 0.9 - 0.8 * (r / (N - 1))
    else g[r * N + c] = Math.max(0, 1 - Math.hypot(u, v))
  }
  const mask = new Uint8Array(N * N).fill(1)
  const p = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale: 1, blurRadius: 0,
              enabledLines: false, ...over }
  const t = buildTerrain(g, mask, N, N, p)
  const layers = buildLineGeometry(t, p)
  const of = (id) => layers.find((x) => x.id === id)
  const n = (id) => { const l = of(id); return l ? l.positions.length / 6 : 0 }
  // Which way each brace runs: sign of Δx·Δz. NW–SE is positive, NE–SW negative.
  const braceSigns = (id) => {
    const l = of(id)
    if (!l) return { pos: 0, neg: 0 }
    let pos = 0, neg = 0
    for (let i = 0; i < l.positions.length; i += 6) {
      const s = (l.positions[i + 3] - l.positions[i]) * (l.positions[i + 5] - l.positions[i + 2])
      if (s > 0) pos++; else if (s < 0) neg++
    }
    return { pos, neg }
  }
  // Every distinct y in a layer, rounded — for the section's cut level.
  const levels = (id) => {
    const l = of(id)
    if (!l) return []
    return [...new Set([...l.positions].filter((_, i) => i % 3 === 1)
      .map((v) => Math.round(v * 100) / 100))]
  }
  return { ids: layers.map((l) => l.id),
           chord: n('Truss-Chord'), brace: n('Truss-Brace'), post: n('Truss-Post'),
           signs: braceSigns('Truss-Brace'),
           hasLids: !!of('Truss-Chord')?.lids,
           hatch: n('Section-Hatch'), face: n('Section-Face'), beyond: n('Section-Beyond'),
           faceLevels: levels('Section-Face'), hatchLevels: levels('Section-Hatch'),
           minElev: t.minElev, maxElev: t.maxElev,
           expChord: n('Exploded-Chord'), expLeader: n('Exploded-Leader'),
           weldLeader: n('Weldment-Leader'),
           weldAnchors: of('Weldment-Leader')?.labelAnchors?.length ?? 0 }
}, [over, field])

test('the frame ships three pens plus gusset plates', async ({ page }) => {
  await ready(page)
  const r = await run(page, { enabledTruss: true, spacingTruss: 20, depthTruss: 20 })
  expect(r.ids).toEqual(expect.arrayContaining(['Truss-Chord', 'Truss-Brace', 'Truss-Post']))
  expect(r.chord).toBeGreaterThan(50)
  expect(r.brace).toBeGreaterThan(10)
  expect(r.post).toBeGreaterThan(10)
  expect(r.hasLids).toBe(true)
})

test('the bracing follows the sign of the twist', async ({ page }) => {
  await ready(page)
  const opts = { enabledTruss: true, spacingTruss: 20, bracedTruss: 1, radiusTruss: 1 }
  const pos = await run(page, opts, 'twist')
  const neg = await run(page, opts, 'antitwist')

  expect(pos.brace).toBeGreaterThan(20)
  expect(neg.brace).toBeGreaterThan(20)
  // h_xy is a nonzero constant of one sign across the whole field, so the frame
  // must commit entirely to one diagonal — and to the other when it flips.
  expect(pos.signs.neg).toBe(0)
  expect(neg.signs.pos).toBe(0)
  expect(pos.signs.pos).toBeGreaterThan(20)
  expect(neg.signs.neg).toBeGreaterThan(20)
})

test('a plane is a plane — braced 0 leaves it bare, braced 1 fills it', async ({ page }) => {
  await ready(page)
  const none = await run(page, { enabledTruss: true, spacingTruss: 18, bracedTruss: 0 })
  const half = await run(page, { enabledTruss: true, spacingTruss: 18, bracedTruss: 0.5 })
  const all  = await run(page, { enabledTruss: true, spacingTruss: 18, bracedTruss: 1 })
  expect(none.brace).toBe(0)
  expect(half.brace).toBeGreaterThan(0)
  expect(all.brace).toBeGreaterThan(half.brace)
  // The chords do not care how much is braced.
  expect(half.chord).toBe(none.chord)
  expect(all.chord).toBe(none.chord)
})

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

test('exploded adds leaders without touching the frame', async ({ page }) => {
  await ready(page)
  const flat = await run(page, { enabledExploded: true, spacingExploded: 20, explodeExploded: 0 })
  const out  = await run(page, { enabledExploded: true, spacingExploded: 20, explodeExploded: 0.2 })
  expect(out.expChord).toBe(flat.expChord)
  expect(out.expLeader).toBeGreaterThan(10)
})

test('weldment calls out the braced joints and nothing else', async ({ page }) => {
  await ready(page)
  const few  = await run(page, { enabledWeldment: true, spacingWeldment: 20, bracedWeldment: 0.1 })
  const many = await run(page, { enabledWeldment: true, spacingWeldment: 20, bracedWeldment: 0.6 })
  expect(few.weldAnchors).toBeGreaterThan(0)
  expect(many.weldAnchors).toBeGreaterThan(few.weldAnchors)
  // Two segments per callout — the leader and the shelf it lands on.
  expect(many.weldLeader).toBe(many.weldAnchors * 2)
})
