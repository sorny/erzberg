/**
 * Occlusion: which model builds walls, that no wall stands in the air, the
 * skirt that closes the ground into a solid, and the halo in the SVG.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildTerrain, sampleBilinear } from '../../src/utils/terrain'
import { exportSVG } from '../../src/utils/svgExport'
import { buildLineGeometry, buildSurfaceGeometry } from '../../src/utils/geometryBuilders'
import { DRAW_MODES } from '../../src/utils/drawModes'
import { STYLE_DEF, TERRAIN_DEF, VIEW_DEF, POINTS_DEF } from '../../src/defaults'

// A round, convex hill: long hachure ticks on it leave the ground at their ends.
const W = 80, H = 80
const px = new Float32Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = Math.hypot(x - W / 2, y - H / 2) / (W / 2)
  px[y * W + x] = 0.15 + 0.7 * Math.max(0, 1 - d * d)
}
const mask = new Uint8Array(W * H).fill(1)
const p0 = { ...TERRAIN_DEF, ...STYLE_DEF, ...VIEW_DEF, ...POINTS_DEF, elevScale: 1, enabledLines: false }
const terrain = buildTerrain(px, mask, W, H, p0)
const build = (p) => buildLineGeometry(terrain, { ...p0, ...p })
const groundAt = (x, z) => {
  const fc = (x + terrain.halfW) / terrain.scl, fr = (z + terrain.halfH) / terrain.scl
  return (sampleBilinear(terrain.grid, null, terrain.rows, terrain.cols, fr, fc) - 0.5) * 100 * terrain.elevScale
}

describe('which model builds walls', () => {
  const hachure = { enabledHachure: true, lengthHachure: 5, spacingHachure: 3 }

  it('builds none under the Ground model', () => {
    const l = build({ ...hachure, occludeBy: 'ground', enabledContours: true }).filter((x) => x.curtains)
    for (const layer of l) expect(layer.curtains.positions.length).toBe(0)
  })

  it('builds them under Lines only for modes that hide', () => {
    const on = build({ ...hachure, occludeBy: 'lines', wallsHachure: true }).find((l) => l.id === 'Hachure')
    const off = build({ ...hachure, occludeBy: 'lines', wallsHachure: false }).find((l) => l.id === 'Hachure')
    expect(on.curtains.positions.length).toBeGreaterThan(0)
    expect(off.curtains.positions.length).toBe(0)
  })

  it('keeps a solid mode\'s walls under both models, and whole', () => {
    // Cuboid columns on a round hill: the downhill side of each top rim stands
    // above the ground there, and that wall is the column's side.
    const pil = { enabledPillars: true, pillarStyle: 'cuboid', spacingPillars: 6 }
    const pick = (p) => build({ ...pil, ...p }).find((l) => l.id === 'Pillars')
    const ground = pick({ occludeBy: 'ground' }), lines = pick({ occludeBy: 'lines' })
    expect(ground.curtains.positions.length).toBeGreaterThan(0)
    expect(Array.from(ground.curtains.positions)).toEqual(Array.from(lines.curtains.positions))
    // One quad per segment with length in plan, its top on the segment itself.
    const P = ground.positions, C = ground.curtains.positions
    let q = 0
    for (let i = 0; i < P.length; i += 6) {
      if (Math.abs(P[i] - P[i + 3]) < 1e-4 && Math.abs(P[i + 2] - P[i + 5]) < 1e-4) continue
      expect([C[q + 1], C[q + 4]]).toEqual([P[i + 1], P[i + 4]])
      q += 12
    }
    expect(q).toBe(C.length)
    expect(pick({ occludeBy: 'ground', wallsPillars: false }).curtains.positions.length).toBe(0)
  })

  it('starts the marks and floating overlays with walls off', () => {
    const off = DRAW_MODES.filter((m) => STYLE_DEF[`walls${m.id}`] === false).map((m) => m.id).sort()
    expect(off).toEqual(['Air', 'Flashbulb', 'Hachure', 'Hair', 'Halation', 'Printer', 'Radar', 'Runout',
      'ShadowHatch', 'SlopeClass', 'Swiss', 'Truchet', 'Waveform'])
    expect(STYLE_DEF.wallsLines).toBe(true)
    expect(STYLE_DEF.occludeBy).toBe('lines')
  })
})

describe('no wall in the air', () => {
  it('keeps every curtain top on or under the ground', () => {
    const layer = build({ enabledHachure: true, lengthHachure: 5, spacingHachure: 3, occludeBy: 'lines', wallsHachure: true })
      .find((l) => l.id === 'Hachure')
    const P = layer.curtains.positions
    const tol = (terrain.maxElev - terrain.minElev) * 0.01 + 1e-6
    let tops = 0, floating = 0, beyond = 0
    // Each quad is four vertices: two tops, then two at the floor.
    for (let q = 0; q < P.length; q += 12) {
      for (const v of [q, q + 3]) {
        tops++
        const fc = (P[v] + terrain.halfW) / terrain.scl, fr = (P[v + 2] + terrain.halfH) / terrain.scl
        const outside = fc < 0 || fr < 0 || fc > terrain.cols - 1 || fr > terrain.rows - 1
        // Past the raster's edge there is no ground, so no wall: its top is the floor.
        if (outside) { beyond++; if (P[v + 1] >= terrain.minElev) floating++; continue }
        if (P[v + 1] > groundAt(P[v], P[v + 2]) + tol) floating++
      }
    }
    expect(tops).toBeGreaterThan(100)
    expect(beyond).toBeGreaterThan(0)
    expect(floating).toBe(0)
  })

  it('leaves a wall under a stroke on the ground exactly where it was', () => {
    // Contours lie on the ground, so their walls are one quad per segment.
    const layer = build({ enabledContours: true, occludeBy: 'lines' }).find((l) => /^Contours/.test(l.id))
    const P = layer.positions
    let flat = 0
    for (let i = 0; i < P.length; i += 6) if (Math.abs(P[i] - P[i + 3]) > 1e-4 || Math.abs(P[i + 2] - P[i + 5]) > 1e-4) flat++
    // A segment with no length in plan hangs no wall, as it never has.
    expect(layer.curtains.positions.length / 12).toBe(flat)
  })
})

describe('the skirt', () => {
  it('walls every edge of the surface down to the floor, under the Ground model only', () => {
    const geo = buildSurfaceGeometry(terrain, { ...p0, depthOcclusion: true, occludeBy: 'ground' })
    const quads = geo.skirt.positions.length / 12
    // A full raster: one wall per border edge.
    expect(quads).toBe(2 * (terrain.rows - 1) + 2 * (terrain.cols - 1))
    const floor = Math.min(...Array.from(geo.skirt.positions).filter((_, i) => i % 3 === 1))
    expect(floor).toBeLessThan(terrain.minElev)
    expect(buildSurfaceGeometry(terrain, { ...p0, depthOcclusion: true, occludeBy: 'lines' }).skirt).toBeNull()
  })

  it('walls the rim of a NoData hole too', () => {
    const holed = new Uint8Array(W * H).fill(1)
    for (let y = 30; y < 40; y++) for (let x = 30; x < 40; x++) holed[y * W + x] = 0
    const t = buildTerrain(px, holed, W, H, p0)
    const full = buildSurfaceGeometry(terrain, { ...p0, depthOcclusion: true, occludeBy: 'ground' })
    const geo = buildSurfaceGeometry(t, { ...p0, depthOcclusion: true, occludeBy: 'ground' })
    expect(geo.skirt.positions.length).toBeGreaterThan(full.skirt.positions.length)
  })
})

describe('layers inside the ground', () => {
  it('marks Pillars below and Stems, and not Pillars above or the tips', () => {
    const l = build({ enabledPillars: true, pillarAbove: true, enabledStems: true, tipsStems: true })
    const by = Object.fromEntries(l.map((x) => [x.id, !!x.insideGround]))
    expect(by.Pillars).toBe(true)
    expect(by['Pillars-Above']).toBe(false)
    expect(by.Stems).toBe(true)
    expect(by['Stems-Tips']).toBe(false)
  })
})

/*
 * The halo in the SVG. A camera looks at the origin from the front and above.
 * `Near` runs across the view at z = 20 and has the halo. `Far` stands upright
 * at z = -40, so it crosses behind `Near` on the page, 60 units deeper. `Same`
 * lies on the ground and crosses `Near` where both are at one depth. No surface
 * and no walls: the halo needs Occlusion on and nothing else.
 */
describe('the halo in the SVG', () => {
  const W2 = 400, H2 = 400
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000)
  camera.position.set(0, 30, 100)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  const seg = (a, b) => new Float32Array([...a, ...b])
  const layers = {
    Near: { id: 'Near', positions: seg([-40, 0, 20], [40, 0, 20]) },
    Far: { id: 'Far', positions: seg([0, -60, -40], [0, 0, -40]) },
    Same: { id: 'Same', positions: seg([10, 0, 0], [10, 0, 40]) },
    // Dots along Far's line: the ones behind Near's halo go.
    Dots: { id: 'Dots', isPoints: true, positions: new Float32Array(
      Array.from({ length: 41 }, (_, k) => { const y = -60 + k * 1.5; return [0, y, -40, 0, y + 0.01, -40] }).flat()) },
  }
  const ink = { weight: 1, opacity: 1, dash: 'solid', color: '#000000' }

  /** Each layer's strokes on the page, as lists of [x0, y0, x1, y1, …]. */
  async function strokes(ids, halo, extra = {}) {
    const lineStyles = Object.fromEntries(ids.map((id) => [id, { ...ink, ...(id === 'Near' && halo ? { halo } : {}) }]))
    const res = await exportSVG({
      lineGeo: ids.map((id) => layers[id]), lineStyles, camera, width: W2, height: H2,
      groupMatrix: new THREE.Matrix4(), bgColor: '#ffffff', depthOcclusion: true,
      occlusionOpacity: 0, haloDepth: 2, partsOnly: true, ...extra,
    })
    const out = {}
    for (const part of res.parts) {
      const id = /id="layer-([^"]+)"/.exec(part)[1]
      const lines = [...part.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)]
        .map((m) => m.slice(1, 5).map(Number))
      const polys = [...part.matchAll(/<polyline points="([^"]+)"/g)]
        .map((m) => m[1].split(/[ ,]/).map(Number))
      out[id] = { strokes: [...lines, ...polys], dots: (part.match(/<circle/g) ?? []).length }
    }
    return out
  }

  it('breaks a line behind the stroke, with a gap as wide as the halo', async () => {
    const plain = await strokes(['Near', 'Far'], 0)
    const haloed = await strokes(['Near', 'Far'], 2)
    expect(plain.Far.strokes).toHaveLength(1)
    expect(haloed.Far.strokes).toHaveLength(2)
    // Weight 1 and halo 2: a quarter plus one pixel each side of the stroke.
    const span = (s) => { const ys = s.filter((_, k) => k % 2 === 1); return [Math.min(...ys), Math.max(...ys)] }
    const [a, b] = haloed.Far.strokes.map(span).sort((p, q) => p[0] - q[0])
    const gap = b[0] - a[1]
    expect(gap).toBeGreaterThan(1.5)
    expect(gap).toBeLessThan(4)
    expect(haloed.Near.strokes).toHaveLength(1)
  })

  it('does not break a line that meets the stroke at its own depth', async () => {
    const haloed = await strokes(['Near', 'Same'], 2)
    expect(haloed.Same.strokes).toHaveLength(1)
  })

  it('leaves a gap and no ghost in it', async () => {
    const haloed = await strokes(['Near', 'Far'], 2, { occlusionOpacity: 0.5, occlusionColor: '#ff0000' })
    expect(haloed['Far-hidden']).toBeUndefined()
    expect(haloed.Far.strokes).toHaveLength(2)
  })

  it('takes the dots behind it away', async () => {
    const plain = await strokes(['Near', 'Dots'], 0)
    const haloed = await strokes(['Near', 'Dots'], 2)
    expect(plain.Dots.dots).toBe(41)
    // About five pixels apart, so the one at the crossing goes.
    expect(haloed.Dots.dots).toBeLessThan(41)
    expect(haloed.Dots.dots).toBeGreaterThanOrEqual(39)
  })

  it('does nothing with Occlusion off', async () => {
    const haloed = await strokes(['Near', 'Far'], 2, { depthOcclusion: false })
    expect(haloed.Far.strokes).toHaveLength(1)
  })
})
