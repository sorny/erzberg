/**
 * Pillars: extrusions below and above the ground.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { cellElev } from '../terrain'
import { hexToRgb, computeVertexColor } from '../colorUtils'
import { F32List, U32List, inElevCut, normElev } from './shared.js'

// ─── Pillars ──────────────────────────────────────────────────────────────

/**
 * Extruded pillars — one per sampled cell, standing from a base up to the
 * surface height at that cell.
 *
 * Three styles: a bare vertical `line`, or a `cuboid` or `cylinder` drawn as
 * edges. `pillarGap` shortens each one so neighbours read as separate columns
 * rather than a solid block, and `pillarDepth` sinks the base below the terrain
 * minimum so the field reads as extruded rather than as floating.
 *
 * Unlike every other mode this one emits more than lines: the cuboid and
 * cylinder styles also return a `lids` sub-mesh of filled caps. That is a
 * separate triangle geometry rather than more segments because a cap has to be
 * opaque — without it you see straight down the inside of every column.
 *
 * ── Above ────────────────────────────────────────────────────────────────────
 * `pillarAbove` mirrors each pillar upwards, from the surface to a ceiling at
 * the highest point plus `pillarCeiling`. With both halves the field fills a
 * rectangular block, and the terrain is the surface where they meet. The gap
 * applies on both sides of it, so a gap opens a seam that follows the ground
 * through the block. The upper half has no lids: a lid on every ceiling would
 * cover the whole plate when seen from above.
 *
 * The upper half is its own sub-layer, `Pillars-Above`, with its own colour,
 * weight, opacity, dash and hypsometric tint (`<prop>PillarsAbove`). One ink
 * for both halves hides the seam that the whole option exists to show, and a
 * separate layer is also a separate pen on the plot.
 *
 * ── Occlusion ────────────────────────────────────────────────────────────────
 * A vertical line hangs a curtain of no width, so pillars hide nothing by
 * themselves. `pillarSolid` gives each half an `occluder`: depth-only walls a
 * share of the cell wide, which hide what stands behind them. At 0, the
 * default, there are none. Both follow the Depth occlusion switch.
 *
 * ── Ink ──────────────────────────────────────────────────────────────────────
 * `pillarInk` (below) and `pillarAboveInk` (above) take the colour from that
 * half's line style (`line`), from the land cover class of the pillar's cell
 * (`class`), or from the cover plate's own imagery at that cell (`plate`).
 * Without a loaded plate both fall back to the line style.
 */
export function buildPillars(terrain, p, spacing) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes,
          gridClass, gridPlate } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt, pillarGap, pillarDepth } = p

  const step     = Math.max(1, Math.round((spacing ?? 8) / scl))
  const gap      = pillarGap ?? 0
  const depth    = pillarDepth ?? 0
  const style    = p.pillarStyle ?? 'line'
  const halfSize = (p.pillarSize ?? 0.8) * step * scl * 0.5
  const segs     = Math.max(3, Math.round(p.pillarSegments ?? 8))
  const above    = !!p.pillarAbove
  const ceiling  = maxElev + (p.pillarCeiling ?? 0)

  const palette = gridClass ? (terrain.classColors ?? []).map(hexToRgb) : null
  const inkAt = (mode, i) => {
    if (mode === 'class' && palette) return palette[gridClass[i]] ?? null
    if (mode === 'plate' && gridPlate) return [gridPlate[i * 3] / 255, gridPlate[i * 3 + 1] / 255, gridPlate[i * 3 + 2] / 255]
    return null
  }
  // The upper half's own line style, in the keys `computeVertexColor` reads.
  const pAbove = {
    ...p,
    lineColor:         p.colorPillarsAbove ?? '#888888',
    lineHypsometric:   p.hypsoPillarsAbove,
    lineHypsoMode:     p.hypsoModePillarsAbove,
    lineBanded:        p.hypsoBandedPillarsAbove,
    lineHypsoInterval: p.hypsoIntervalPillarsAbove,
  }

  const below = { positions: new F32List(), colors: new F32List() }
  const upper = { positions: new F32List(), colors: new F32List() }
  // Inked by land cover, a half splits into one layer per class, so the SVG
  // writes one pen layer per class. Keyed by class index.
  const splitBelow = !!gridClass && (p.pillarInk === 'class' || p.pillarInk === 'plate')
  const splitAbove = !!gridClass && (p.pillarAboveInk === 'class' || p.pillarAboveInk === 'plate')
  const belowBy = new Map(), upperBy = new Map()
  const targetOf = (map, k) => {
    let t = map.get(k)
    if (!t) { t = { positions: new F32List(), colors: new F32List() }; map.set(k, t) }
    return t
  }
  const lidP = new F32List(), lidC = new F32List(), lidI = new U32List()
  let lidVIdx = 0
  // Depth-only walls for each half — see `occluder` in the dispatcher.
  const occBelow = { p: new F32List(), i: new U32List(), v: 0 }
  const occUpper = { p: new F32List(), i: new U32List(), v: 0 }
  let occ = occBelow
  const wall = (x0, z0, x1, z1, bottom, top) => {
    occ.p.push6(x0, bottom, z0, x1, bottom, z1); occ.p.push6(x1, top, z1, x0, top, z0)
    occ.i.push3(occ.v, occ.v + 1, occ.v + 2); occ.i.push3(occ.v, occ.v + 2, occ.v + 3)
    occ.v += 4
  }
  // How much of its cell a pillar hides, 0–1. At 0 the lines hide nothing.
  const solid = Math.max(0, Math.min(1, p.pillarSolid ?? 0))
  const wallHalf = step * scl * 0.5 * solid
  /*
   * What a pillar hides. A line has no body, so it stands for a share of its
   * cell: two crossed walls `solid` of a cell wide. At 1 they join into one
   * solid block across the field; lower values hide only a band around each
   * line. A cuboid or cylinder hides with its own sides. The pillar's own lines
   * lie on these faces, and the curtain bias keeps them in front.
   */
  const occlude = (target, wx, wz, bottom, top) => {
    if (!p.depthOcclusion || solid <= 0) return
    occ = target
    if (style === 'cuboid') {
      const h = halfSize
      wall(wx-h, wz-h, wx+h, wz-h, bottom, top); wall(wx+h, wz-h, wx+h, wz+h, bottom, top)
      wall(wx+h, wz+h, wx-h, wz+h, bottom, top); wall(wx-h, wz+h, wx-h, wz-h, bottom, top)
    } else if (style === 'cylinder') {
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * Math.PI * 2, a1 = ((s + 1) / segs) * Math.PI * 2
        wall(wx + halfSize * Math.cos(a0), wz + halfSize * Math.sin(a0),
             wx + halfSize * Math.cos(a1), wz + halfSize * Math.sin(a1), bottom, top)
      }
    } else {
      wall(wx - wallHalf, wz, wx + wallHalf, wz, bottom, top)
      wall(wx, wz - wallHalf, wx, wz + wallHalf, bottom, top)
    }
  }

  // One pillar body from `bottom` to `top`, in the current style, into `out`.
  // `lid` caps the top face; the upper half passes null.
  const body = (out, wx, wz, bottom, top, colBottom, colTop, lid) => {
    const { positions, colors } = out
    if (style === 'cuboid') {
      const h = halfSize
      // Top face perimeter (4 edges)
      positions.push6(wx-h,top,wz-h, wx+h,top,wz-h); positions.push6(wx+h,top,wz-h, wx+h,top,wz+h)
      positions.push6(wx+h,top,wz+h, wx-h,top,wz+h); positions.push6(wx-h,top,wz+h, wx-h,top,wz-h)
      for (let e = 0; e < 4; e++) colors.pushRgb2(colTop)
      // Bottom face (4 edges)
      positions.push6(wx-h,bottom,wz-h, wx+h,bottom,wz-h); positions.push6(wx+h,bottom,wz-h, wx+h,bottom,wz+h)
      positions.push6(wx+h,bottom,wz+h, wx-h,bottom,wz+h); positions.push6(wx-h,bottom,wz+h, wx-h,bottom,wz-h)
      for (let e = 0; e < 4; e++) colors.pushRgb2(colBottom)
      // 4 vertical edges (bottom → top colour gradient)
      positions.push6(wx-h,bottom,wz-h, wx-h,top,wz-h); positions.push6(wx+h,bottom,wz-h, wx+h,top,wz-h)
      positions.push6(wx+h,bottom,wz+h, wx+h,top,wz+h); positions.push6(wx-h,bottom,wz+h, wx-h,top,wz+h)
      for (let e = 0; e < 4; e++) { colors.pushRgb(colBottom); colors.pushRgb(colTop) }
      if (lid) {
        // Lid mesh — 2 triangles covering the top face
        lidP.push6(wx-h,top,wz-h, wx+h,top,wz-h); lidP.push6(wx+h,top,wz+h, wx-h,top,wz+h)
        for (let v = 0; v < 4; v++) lidC.pushRgb(lid)
        lidI.push3(lidVIdx, lidVIdx+1, lidVIdx+2); lidI.push3(lidVIdx, lidVIdx+2, lidVIdx+3)
        lidVIdx += 4
      }
    } else if (style === 'cylinder') {
      const rad = halfSize
      for (let s = 0; s < segs; s++) {
        const a0 = (s       / segs) * Math.PI * 2
        const a1 = ((s + 1) / segs) * Math.PI * 2
        const x0 = wx + rad * Math.cos(a0), z0 = wz + rad * Math.sin(a0)
        const x1 = wx + rad * Math.cos(a1), z1 = wz + rad * Math.sin(a1)
        positions.push6(x0, top,    z0, x1, top,    z1); colors.pushRgb2(colTop)
        positions.push6(x0, bottom, z0, x1, bottom, z1); colors.pushRgb2(colBottom)
        positions.push6(x0, bottom, z0, x0, top,    z0); colors.pushRgb(colBottom); colors.pushRgb(colTop)
      }
      if (lid) {
        // Lid mesh — N-gon fan from centre
        lidP.push3(wx, top, wz); lidC.pushRgb(lid)          // centre vertex
        for (let s = 0; s < segs; s++) {
          const a = (s / segs) * Math.PI * 2
          lidP.push3(wx + rad * Math.cos(a), top, wz + rad * Math.sin(a))
          lidC.pushRgb(lid)
        }
        for (let s = 0; s < segs; s++)
          lidI.push3(lidVIdx, lidVIdx + s + 1, lidVIdx + ((s + 1) % segs) + 1)
        lidVIdx += segs + 1
      }
    } else {
      positions.push6(wx, bottom, wz, wx, top, wz)
      colors.pushRgb(colBottom); colors.pushRgb(colTop)
    }
  }

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue

      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue

      const wx = c * scl - halfW
      const wz = r * scl - halfH
      const top    = elev - gap
      const bottom = minElev - depth
      const slope  = gridSlopes[i] / (maxSlope || 1)

      if (top > bottom) {
        const ink = inkAt(p.pillarInk, i)
        const colBase = ink ?? computeVertexColor(normElev(bottom, minElev, maxElev), 0, 0, p)
        const colPeak = ink ?? computeVertexColor(normElev(top, minElev, maxElev), slope, 0, p)
        const colLid  = p.pillarLidColor ? hexToRgb(p.pillarLidColor) : colPeak
        body(splitBelow ? targetOf(belowBy, gridClass[i]) : below, wx, wz, bottom, top, colBase, colPeak, colLid)
        occlude(occBelow, wx, wz, bottom, top)
      }
      const low = elev + gap
      if (above && ceiling > low) {
        const ink = inkAt(p.pillarAboveInk, i)
        const colLow  = ink ?? computeVertexColor(normElev(low, minElev, maxElev), slope, 0, pAbove)
        const colCeil = ink ?? computeVertexColor(normElev(ceiling, minElev, maxElev), 0, 0, pAbove)
        body(splitAbove ? targetOf(upperBy, gridClass[i]) : upper, wx, wz, low, ceiling, colLow, colCeil, null)
        occlude(occUpper, wx, wz, low, ceiling)
      }
    }
  }

  const lids = lidI.length > 0
    ? { positions: lidP.toArray(), colors: lidC.toArray(), indices: lidI.toArray() }
    : null
  const occluderOf = (o) => (o.i.length ? { positions: o.p.toArray(), indices: o.i.toArray() } : null)
  // `selfOcclude`: the pillars are emitted row by row whatever the camera does,
  // so without depth the last row drawn covered the rest — the far ones, seen
  // from behind. See the renderer.
  const pack = (t) => ({ positions: t.positions.toArray(), colors: t.colors.toArray(), selfOcclude: true })
  const layers = {}
  // One half: a single layer, or one per class in class order. The half's
  // lids and occluder ride on its first layer; both are drawn for every layer.
  const half = (id, single, split, byClass, extra) => {
    const ids = []
    if (split) {
      for (const k of [...byClass.keys()].sort((a, b) => a - b)) {
        layers[`${id}-Class${k}`] = pack(byClass.get(k)); ids.push(`${id}-Class${k}`)
      }
    } else {
      layers[id] = pack(single); ids.push(id)
    }
    if (ids.length) Object.assign(layers[ids[0]], extra)
  }
  half('Pillars', below, splitBelow, belowBy, { lids, occluder: occluderOf(occBelow) })
  if (above) half('Pillars-Above', upper, splitAbove, upperBy, { occluder: occluderOf(occUpper) })
  return layers
}
