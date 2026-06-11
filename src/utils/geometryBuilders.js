/**
 * CPU-side geometry builders.
 */

import { cellElev, hasData, boxBlur } from './terrain'
import { hexToRgb, computeVertexColor } from './colorUtils'
import { geoToWorld, sampleTerrainElev } from './geoCoords'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps a rendered layer id → its { weight, opacity, dash } from the live params.
 *
 * These three properties are purely render-side (LineMaterial) and are NOT baked
 * into the worker geometry, so changing them never triggers a rebuild. This is the
 * single source of truth, consumed by both HeightmapLines (live render) and
 * svgExport (export). Sub-layers (Contours-*, Gpx) map to their dedicated params.
 */
export function layerStyle(id, p) {
  switch (id) {
    case 'Contours-Minor':
      return { weight: p.weightContours, opacity: p.opacityContours, dash: p.dashContours }
    case 'Contours-Major':
      return { weight: p.majorWeightContours, opacity: p.opacityContours, dash: p.dashContours }
    case 'Contours-Tanaka-Bright':
      return { weight: p.tanakaWeightBright ?? 2.5, opacity: p.opacityContours, dash: p.dashContours }
    case 'Contours-Tanaka-Dark':
      return { weight: p.tanakaWeightDark ?? 0.5, opacity: p.opacityContours, dash: p.dashContours }
    case 'Gpx':
      return { weight: p.weightGpx, opacity: p.opacityGpx, dash: p.dashGpx }
    case 'Swiss-Rock':
      return { weight: p.weightSwiss, opacity: p.opacitySwiss, dash: p.dashSwiss }
    case 'Swiss-Scree':
      return { weight: p.screeWeightSwiss ?? 2.5, opacity: p.opacitySwiss, dash: 'solid' }
    default:
      return { weight: p[`weight${id}`], opacity: p[`opacity${id}`], dash: p[`dash${id}`] }
  }
}

/**
 * Growable typed-array writers. The builders emit millions of floats per rebuild;
 * accumulating them in plain JS arrays (boxed doubles + push/spread) and converting
 * at the end dominated worker time and GC. These append straight into typed
 * storage with doubling growth. toArray() returns a subarray view (no copy) — the
 * backing buffer is at most 2× the payload, which is cheaper than a final copy
 * for both the worker transfer and peak memory.
 */
class F32List {
  constructor(cap = 4096) { this.a = new Float32Array(cap); this.n = 0 }
  _grow(need) {
    let cap = this.a.length * 2
    while (cap < need) cap *= 2
    const next = new Float32Array(cap)
    next.set(this.a.subarray(0, this.n))
    this.a = next
  }
  push3(x, y, z) {
    if (this.n + 3 > this.a.length) this._grow(this.n + 3)
    const a = this.a, n = this.n
    a[n] = x; a[n + 1] = y; a[n + 2] = z
    this.n = n + 3
  }
  push6(x0, y0, z0, x1, y1, z1) {
    if (this.n + 6 > this.a.length) this._grow(this.n + 6)
    const a = this.a, n = this.n
    a[n] = x0; a[n + 1] = y0; a[n + 2] = z0
    a[n + 3] = x1; a[n + 4] = y1; a[n + 5] = z1
    this.n = n + 6
  }
  /** Append one [r,g,b] triple. */
  pushRgb(c) { this.push3(c[0], c[1], c[2]) }
  /** Append the same [r,g,b] triple twice (both vertices of a segment). */
  pushRgb2(c) { this.push6(c[0], c[1], c[2], c[0], c[1], c[2]) }
  get length() { return this.n }
  toArray() { return this.n === this.a.length ? this.a : this.a.subarray(0, this.n) }
}

class U32List {
  constructor(cap = 4096) { this.a = new Uint32Array(cap); this.n = 0 }
  _grow(need) {
    let cap = this.a.length * 2
    while (cap < need) cap *= 2
    const next = new Uint32Array(cap)
    next.set(this.a.subarray(0, this.n))
    this.a = next
  }
  push3(x, y, z) {
    if (this.n + 3 > this.a.length) this._grow(this.n + 3)
    const a = this.a, n = this.n
    a[n] = x; a[n + 1] = y; a[n + 2] = z
    this.n = n + 3
  }
  get length() { return this.n }
  toArray() { return this.n === this.a.length ? this.a : this.a.subarray(0, this.n) }
}

function normElev(elev, minZ, maxZ) {
  return maxZ > minZ ? (elev - minZ) / (maxZ - minZ) : 0
}

function inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut) {
  const n = normElev(elev, minZ, maxZ)
  return n >= elevMinCut / 100 && n <= elevMaxCut / 100
}


// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Returns an ARRAY of layers, each with its own geometry and styling.
 */
export function buildLineGeometry(terrain, p) {
  if (!terrain) return []
  
  // Helper to map per-layer hypsometric params to the keys computeVertexColor expects
  const getLayerContext = (id, baseColor, baseOpacity) => ({
    ...p,
    lineColor:        baseColor,
    lineOpacity:      baseOpacity,
    lineHypsometric:  p[`hypso${id}`],
    lineHypsoMode:    p[`hypsoMode${id}`],
    lineBanded:       p[`hypsoBanded${id}`],
    lineHypsoInterval:p[`hypsoInterval${id}`]
  })

  const MODES_CONFIG = [
    { id:'X',       builder: (t, ctx) => buildRidgelines(t, ctx, false, p.spacingX, p.shiftX) },
    { id:'Y',       builder: (t, ctx) => buildRidgelines(t, ctx, true,  p.spacingY, p.shiftY) },
    { id:'Cross',   builder: (t, ctx) => buildCrosshatch(t, ctx, p.spacingCross) },
    { id:'Pillars', builder: (t, ctx) => buildPillars(t, ctx, p.spacingPillars) },
    { id:'Contours',builder: (t, ctx) => buildContours(t, ctx, p.intervalContours, p.majorIntervalContours, p.majorOffsetContours, p.closeRingsContours) },
    { id:'Hachure', builder: (t, ctx) => buildHachure(t, ctx, p.spacingHachure, p.lengthHachure) },
    { id:'Flow',    builder: (t, ctx) => buildFlowLines(t, ctx, p.spacingFlow, p.stepFlow, p.maxLenFlow) },
    { id:'Dag',     builder: (t, ctx) => buildDagThinning(t, ctx, p.thresholdDag) },
    { id:'Pencil',  builder: (t, ctx) => buildPencilShading(t, ctx, p.spacingPencil, p.thresholdPencil) },
    { id:'Ridge',   builder: (t, ctx) => buildRidgeLines(t, ctx, p.spacingRidge, p.radiusRidge, p.thresholdRidge) },
    { id:'Valley',  builder: (t, ctx) => buildTpiFeatures(t, ctx, p.spacingValley, p.radiusValley, p.thresholdValley, false) },
    { id:'Stipple', builder: (t, ctx) => buildStipple(t, ctx, p.spacingStipple, p.stippleDensityMode, p.stippleGamma, p.stippleJitter) },
    { id:'Engrave', builder: (t, ctx) => buildEngraving(t, ctx, p.spacingEngrave, p.angleEngrave, p.levelsEngrave, p.sunAzimuthEngrave, p.gammaEngrave) },
    { id:'Swiss',   builder: (t, ctx) => buildSwissRockScree(t, ctx, p.spacingSwiss, p.thresholdSwiss, p.lengthSwiss, p.screeSwiss) },
  ]

  const finalLayers = []

  const mX = [p.showMirrorPlusX ? 1 : null, p.showMirrorMinusX ? -1 : null].filter(v => v !== null)
  const mY = [p.showMirrorPlusY ? 1 : null, p.showMirrorMinusY ? -1 : null].filter(v => v !== null)
  const mZ = [p.showMirrorPlusZ ? 1 : null, p.showMirrorMinusZ ? -1 : null].filter(v => v !== null)

  for (const cfg of MODES_CONFIG) {
    if (!p[`enabled${cfg.id}`]) continue

    const ctx = getLayerContext(cfg.id, p[`color${cfg.id}`], p[`opacity${cfg.id}`])
    
    // Build the base pass for this layer once
    const baseRes = cfg.builder(terrain, ctx)
    if (!baseRes) continue

    // Handle builders that return sub-layers (e.g. { minor: {...}, major: {...} })
    const subLayers = (baseRes.positions instanceof Float32Array) 
      ? { [cfg.id]: baseRes } 
      : baseRes

    for (const [subId, res] of Object.entries(subLayers)) {
      if (!res.positions || res.positions.length === 0) continue

      const baseP = res.positions
      // Curtain bottom: a curtain only has to occlude sight lines to other
      // rendered content, and nothing renders below minZ except pillar shafts
      // (minZ - pillarDepth). Hanging every curtain a fixed 500 units deep
      // instead multiplied the rasterized depth-only fragment area ~10× for a
      // typical ±50-unit terrain — pure GPU fill-rate waste when zoomed in.
      const floorY = terrain.minZ
        - (p.enabledPillars ? (p.pillarDepth ?? 0) : 0)
        - Math.max(2, (terrain.maxZ - terrain.minZ) * 0.05)

      // Base curtain quads (one per non-degenerate segment) — built once, then
      // mirrored into each octant below. Written straight into pre-sized typed
      // arrays (segment count is known up front) and trimmed; this avoids the
      // millions of JS-array push() calls a dense layer would otherwise make.
      const segCount = res.isPoints ? 0 : (baseP.length / 6) | 0
      const cPfull = new Float32Array(segCount * 12)
      const cIfull = new Uint32Array(segCount * 6)
      let cPn = 0, cIn = 0, vIdx = 0
      for (let i = 0; i < segCount * 6; i += 6) {
        const x0 = baseP[i], y0 = baseP[i+1], z0 = baseP[i+2]
        const x1 = baseP[i+3], y1 = baseP[i+4], z1 = baseP[i+5]
        if (Math.abs(x0-x1)<1e-4 && Math.abs(y0-y1)<1e-4 && Math.abs(z0-z1)<1e-4) continue
        cPfull[cPn]=x0;   cPfull[cPn+1]=y0;     cPfull[cPn+2]=z0
        cPfull[cPn+3]=x1; cPfull[cPn+4]=y1;     cPfull[cPn+5]=z1
        cPfull[cPn+6]=x1; cPfull[cPn+7]=floorY; cPfull[cPn+8]=z1
        cPfull[cPn+9]=x0; cPfull[cPn+10]=floorY; cPfull[cPn+11]=z0
        cPn += 12
        cIfull[cIn]=vIdx; cIfull[cIn+1]=vIdx+1; cIfull[cIn+2]=vIdx+2
        cIfull[cIn+3]=vIdx; cIfull[cIn+4]=vIdx+2; cIfull[cIn+5]=vIdx+3
        cIn += 6
        vIdx += 4
      }
      const cPbase = cPn === cPfull.length ? cPfull : cPfull.subarray(0, cPn)
      const cIbase = cIn === cIfull.length ? cIfull : cIfull.subarray(0, cIn)
      const cVerts = cPbase.length / 3

      const baseLidP = res.lids?.positions ?? new Float32Array(0)
      const baseLidC = res.lids?.colors   ?? new Float32Array(0)
      const baseLidI = res.lids?.indices  ?? new Uint32Array(0)
      const lidVerts = baseLidP.length / 3
      const hasLids  = baseLidP.length > 0

      const nOct = mX.length * mY.length * mZ.length

      // Fast path: single identity octant (no mirroring — the default) means the
      // base arrays ARE the final layer. Skip the octant copy loop entirely.
      if (nOct === 1 && mX[0] === 1 && mY[0] === 1 && mZ[0] === 1) {
        finalLayers.push({
          id: (subId === cfg.id) ? cfg.id : subId,
          positions: baseP,
          colors: res.colors,
          curtains: { positions: cPbase, indices: cIbase },
          lids: hasLids ? { positions: baseLidP, colors: baseLidC, indices: baseLidI } : null,
          isPoints: res.isPoints ?? false,
        })
        continue
      }

      // Pre-allocate every octant up front. Repeated concat() would reallocate and
      // recopy the growing buffers on each octant (O(octants²)); a single sized
      // allocation filled by offset is O(octants) and avoids the garbage churn.
      const layerPos    = new Float32Array(baseP.length * nOct)
      const layerCol    = new Float32Array(res.colors.length * nOct)
      const layerCPos   = new Float32Array(cPbase.length * nOct)
      const layerCInd   = new Uint32Array(cIbase.length * nOct)
      const layerLidPos = new Float32Array(baseLidP.length * nOct)
      const layerLidCol = new Float32Array(baseLidC.length * nOct)
      const layerLidInd = new Uint32Array(baseLidI.length * nOct)

      let posOff = 0, colOff = 0, cPosOff = 0, cIndOff = 0, cIndBase = 0
      let lidPosOff = 0, lidColOff = 0, lidIndOff = 0, lidIndBase = 0

      for (const sx of mX) {
        for (const sy of mY) {
          for (const sz of mZ) {
            const flipWinding = (sx * sy * sz) < 0

            // Lines
            for (let i = 0; i < baseP.length; i += 3) {
              layerPos[posOff+i]   = baseP[i]   * sx
              layerPos[posOff+i+1] = baseP[i+1] * sy
              layerPos[posOff+i+2] = baseP[i+2] * sz
            }
            posOff += baseP.length
            layerCol.set(res.colors, colOff); colOff += res.colors.length

            // Curtains
            for (let i = 0; i < cPbase.length; i += 3) {
              layerCPos[cPosOff+i]   = cPbase[i]   * sx
              layerCPos[cPosOff+i+1] = cPbase[i+1] * sy
              layerCPos[cPosOff+i+2] = cPbase[i+2] * sz
            }
            cPosOff += cPbase.length
            for (let i = 0; i < cIbase.length; i += 3) {
              const a = cIbase[i] + cIndBase, b = cIbase[i+1] + cIndBase, c = cIbase[i+2] + cIndBase
              if (flipWinding) { layerCInd[cIndOff+i] = a; layerCInd[cIndOff+i+1] = c; layerCInd[cIndOff+i+2] = b }
              else             { layerCInd[cIndOff+i] = a; layerCInd[cIndOff+i+1] = b; layerCInd[cIndOff+i+2] = c }
            }
            cIndOff += cIbase.length; cIndBase += cVerts

            // Lids
            if (hasLids) {
              for (let i = 0; i < baseLidP.length; i += 3) {
                layerLidPos[lidPosOff+i]   = baseLidP[i]   * sx
                layerLidPos[lidPosOff+i+1] = baseLidP[i+1] * sy
                layerLidPos[lidPosOff+i+2] = baseLidP[i+2] * sz
              }
              lidPosOff += baseLidP.length
              layerLidCol.set(baseLidC, lidColOff); lidColOff += baseLidC.length
              for (let i = 0; i < baseLidI.length; i += 3) {
                const a = baseLidI[i] + lidIndBase, b = baseLidI[i+1] + lidIndBase, c = baseLidI[i+2] + lidIndBase
                if (flipWinding) { layerLidInd[lidIndOff+i] = a; layerLidInd[lidIndOff+i+1] = c; layerLidInd[lidIndOff+i+2] = b }
                else             { layerLidInd[lidIndOff+i] = a; layerLidInd[lidIndOff+i+1] = b; layerLidInd[lidIndOff+i+2] = c }
              }
              lidIndOff += baseLidI.length; lidIndBase += lidVerts
            }
          }
        }
      }

      // weight / opacity / dash are render-side params resolved via layerStyle(id, p),
      // not baked here — see layerStyle() above.
      finalLayers.push({
        id: (subId === cfg.id) ? cfg.id : subId,
        positions: layerPos,
        colors: layerCol,
        curtains: { positions: layerCPos, indices: layerCInd },
        lids: layerLidInd.length > 0
          ? { positions: layerLidPos, colors: layerLidCol, indices: layerLidInd }
          : null,
        isPoints: res.isPoints ?? false,
      })
    }
  }

  return finalLayers
}

function concat(a, b) { const out = new Float32Array(a.length+b.length); out.set(a, 0); out.set(b, a.length); return out }

// ─── Ridgelines ──────────────────────────────────────────────────────────────

function buildRidgelines(terrain, p, isY, spacing, shift) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const lineStep = Math.max(1, Math.round((spacing ?? 4) / scl)), lineOffset = (shift ?? 0) % lineStep
  const outerCount = isY ? cols : rows, innerCount = isY ? rows : cols
  const positions = new F32List(), colors = new F32List()
  const aspect = isY ? Math.PI : Math.PI / 2

  for (let outer = lineOffset; outer < outerCount; outer += lineStep) {
    const outerPos = outer * scl - (isY ? halfW : halfH)
    for (let inner = 0; inner < innerCount - 1; inner++) {
      const r0 = isY ? inner : outer, c0 = isY ? outer : inner
      const r1 = isY ? inner + 1 : outer, c1 = isY ? outer : inner + 1
      if (!hasData(gridMask, r0, c0, cols) || !hasData(gridMask, r1, c1, cols)) continue
      const elev0 = cellElev(grid, r0, c0, cols, elevScale, jitterAmt)
      const elev1 = cellElev(grid, r1, c1, cols, elevScale, jitterAmt)
      if (!inElevCut(elev0, minZ, maxZ, elevMinCut, elevMaxCut) || !inElevCut(elev1, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      const innerPos0 = inner * scl - (isY ? halfH : halfW), innerPos1 = (inner + 1) * scl - (isY ? halfH : halfW)
      let x0, z0, x1, z1
      if (isY) { x0 = outerPos; z0 = innerPos0; x1 = outerPos; z1 = innerPos1 }
      else { x0 = innerPos0; z0 = outerPos; x1 = innerPos1; z1 = outerPos }
      positions.push6(x0, elev0, z0, x1, elev1, z1)
      const slope0 = gridSlopes[r0 * cols + c0], slope1 = gridSlopes[r1 * cols + c1]
      colors.pushRgb(computeVertexColor(normElev(elev0, minZ, maxZ), slope0 / (maxSlope || 1), aspect, p))
      colors.pushRgb(computeVertexColor(normElev(elev1, minZ, maxZ), slope1 / (maxSlope || 1), aspect, p))
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

function buildCrosshatch(terrain, p, spacing) {
  const x = buildRidgelines(terrain, p, false, spacing, 0)
  const y = buildRidgelines(terrain, p, true,  spacing, 0)
  return { positions: concat(x.positions, y.positions), colors: concat(x.colors, y.colors) }
}

// ─── Hachure ──────────────────────────────────────────────────────────────────

function buildHachure(terrain, p, spacing, length) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const lineStep = Math.max(1, Math.round((spacing ?? 4) / scl))
  const positions = new F32List(), colors = new F32List()

  for (let r = 0; r < rows; r += lineStep) {
    for (let c = 0; c < cols; c += lineStep) {
      if (!hasData(gridMask, r, c, cols)) continue
      const bC = grid[r * cols + c], elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      const bL = (c > 0 && gridMask[r * cols + c - 1]) ? grid[r * cols + c - 1] : bC
      const bR = (c < cols - 1 && gridMask[r * cols + c + 1]) ? grid[r * cols + c + 1] : bC
      const bU = (r > 0 && gridMask[(r - 1) * cols + c]) ? grid[(r - 1) * cols + c] : bC
      const bD = (r < rows - 1 && gridMask[(r + 1) * cols + c]) ? grid[(r + 1) * cols + c] : bC
      const gx = (bR - bL) * 50 * elevScale, gz = (bD - bU) * 50 * elevScale, mag = Math.sqrt(gx * gx + gz * gz)
      if (mag < 0.005) continue
      const tickLen = mag * (length ?? 1) * scl, nx = -gz / mag, nz = gx / mag, wx = c * scl - halfW, wz = r * scl - halfH
      positions.push6(wx - nx * tickLen * 0.5, elev, wz - nz * tickLen * 0.5, wx + nx * tickLen * 0.5, elev, wz + nz * tickLen * 0.5)
      const col = computeVertexColor(normElev(elev, minZ, maxZ), gridSlopes[r * cols + c] / (maxSlope || 1), Math.atan2(gz, gx), p)
      colors.pushRgb2(col)
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Contours ─────────────────────────────────────────────────────────────────

// Chains raw marching-squares segments (grid coords) into polylines, then closes
// any open ends that sit on the grid border by walking the border between them.
// Returns a flat world-space array [x0,y,z0, x1,y,z1, ...] of segment pairs.
function closeContourRings(levelSegs, rows, cols, scl, halfW, halfH, elev) {
  const n = levelSegs.length / 4
  if (n === 0) return []

  const toWorld = (c, r) => [c * scl - halfW, r * scl - halfH]
  const key = (c, r) => `${c},${r}`

  // Build endpoint adjacency: key -> [segment indices]
  const adj = new Map()
  for (let i = 0; i < n; i++) {
    const k0 = key(levelSegs[i*4],   levelSegs[i*4+1])
    const k1 = key(levelSegs[i*4+2], levelSegs[i*4+3])
    if (!adj.has(k0)) adj.set(k0, [])
    if (!adj.has(k1)) adj.set(k1, [])
    adj.get(k0).push(i)
    adj.get(k1).push(i)
  }

  // Chain segments into polylines
  const visited = new Uint8Array(n)
  const chains = []
  for (let start = 0; start < n; start++) {
    if (visited[start]) continue
    visited[start] = 1
    const chain = [
      { c: levelSegs[start*4],   r: levelSegs[start*4+1] },
      { c: levelSegs[start*4+2], r: levelSegs[start*4+3] },
    ]
    // Extend tail then head
    for (const [getEnd, insert] of [
      [() => chain[chain.length - 1], pt => chain.push(pt)],
      [() => chain[0],                pt => chain.unshift(pt)],
    ]) {
      let tip = getEnd()
      while (true) {
        const next = (adj.get(key(tip.c, tip.r)) || []).find(i => !visited[i])
        if (next === undefined) break
        visited[next] = 1
        const nc0 = levelSegs[next*4], nr0 = levelSegs[next*4+1]
        const nc1 = levelSegs[next*4+2], nr1 = levelSegs[next*4+3]
        tip = key(nc0, nr0) === key(tip.c, tip.r) ? { c: nc1, r: nr1 } : { c: nc0, r: nr0 }
        insert(tip)
      }
    }
    chains.push(chain)
  }

  // Emit all chain segments
  const result = []
  for (const chain of chains) {
    for (let i = 0; i < chain.length - 1; i++) {
      const [x0, z0] = toWorld(chain[i].c,   chain[i].r)
      const [x1, z1] = toWorld(chain[i+1].c, chain[i+1].r)
      result.push(x0, elev, z0, x1, elev, z1)
    }
  }

  // Collect open border endpoints
  // Clockwise border position in [0, 4): top=0..1, right=1..2, bottom=2..3, left=3..4
  const EPS = 1e-9
  const onBorder = (c, r) => c <= EPS || r <= EPS || c >= cols - 1 - EPS || r >= rows - 1 - EPS
  const borderPos = (c, r) => {
    if (r <= EPS)            return c / (cols - 1)
    if (c >= cols - 1 - EPS) return 1 + r / (rows - 1)
    if (r >= rows - 1 - EPS) return 2 + (1 - c / (cols - 1))
    return                          3 + (1 - r / (rows - 1))
  }

  const bpts = []
  for (const chain of chains) {
    const head = chain[0], tail = chain[chain.length - 1]
    if (key(head.c, head.r) === key(tail.c, tail.r)) continue // already closed
    if (onBorder(head.c, head.r)) bpts.push({ c: head.c, r: head.r, pos: borderPos(head.c, head.r) })
    if (onBorder(tail.c, tail.r)) bpts.push({ c: tail.c, r: tail.r, pos: borderPos(tail.c, tail.r) })
  }

  if (bpts.length < 2 || bpts.length % 2 !== 0) return result
  bpts.sort((a, b) => a.pos - b.pos)

  // Grid corners in clockwise order
  const corners = [
    { c: 0,        r: 0,        pos: 0 },
    { c: cols - 1, r: 0,        pos: 1 },
    { c: cols - 1, r: rows - 1, pos: 2 },
    { c: 0,        r: rows - 1, pos: 3 },
  ]

  // Walk border clockwise from p0 to p1, inserting any corners in between
  const traceBorder = (p0, p1) => {
    const pts = [{ c: p0.c, r: p0.r }]
    const inRange = pos => p0.pos < p1.pos
      ? pos > p0.pos + EPS && pos < p1.pos - EPS
      : pos > p0.pos + EPS || pos  < p1.pos - EPS
    const dist = pos => (pos - p0.pos + 4) % 4
    corners
      .filter(corner => inRange(corner.pos))
      .sort((a, b) => dist(a.pos) - dist(b.pos))
      .forEach(corner => pts.push({ c: corner.c, r: corner.r }))
    pts.push({ c: p1.c, r: p1.r })
    return pts
  }

  // Pair consecutive border endpoints and emit border segments
  for (let i = 0; i < bpts.length; i += 2) {
    const pts = traceBorder(bpts[i], bpts[i + 1])
    for (let j = 0; j < pts.length - 1; j++) {
      const [x0, z0] = toWorld(pts[j].c,   pts[j].r)
      const [x1, z1] = toWorld(pts[j+1].c, pts[j+1].r)
      result.push(x0, elev, z0, x1, elev, z1)
    }
  }

  return result
}

// Per-level metadata shared by buildContours / buildContoursTanaka. levelVal is
// the marching-squares threshold in brightness (grid) space; it increases
// linearly with the level index, which is what lets the cell-major pass map a
// cell's value range straight to a level-index range.
function prepareContourLevels(terrain, p, interval) {
  const { minZ, maxZ } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const step = (interval ?? 4)
  // Use a small epsilon to ensure we catch 0.0 if the terrain starts there
  const startElev = Math.ceil((minZ - 1e-7) / step) * step
  const maxElevPossible = Math.ceil(maxZ / step) * step
  const numSteps = Math.max(0, Math.floor((maxElevPossible - startElev) / step) + 1)

  const levelElev = new Float64Array(numSteps)
  const levelVal = new Float64Array(numSteps)
  const levelActive = new Uint8Array(numSteps)
  const levelRgb = new Float32Array(numSteps * 3)
  for (let i = 0; i < numSteps; i++) {
    const elev = startElev + i * step
    levelElev[i] = elev
    levelVal[i] = elev / (100 * elevScale) + 0.5
    levelActive[i] = inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut) ? 1 : 0
    const col = computeVertexColor(normElev(elev, minZ, maxZ), 0, 0, p)
    levelRgb[i * 3] = col[0]; levelRgb[i * 3 + 1] = col[1]; levelRgb[i * 3 + 2] = col[2]
  }
  return { step, numSteps, levelElev, levelVal, levelActive, levelRgb, lvlStep: step / (100 * elevScale) }
}

function edgeLerp01(va, vb, level) {
  return Math.abs(vb - va) < 1e-10 ? 0.5 : (level - va) / (vb - va)
}

// Scratch for the 4 marching-squares edge midpoints (top, right, bottom, left).
const _edgeX = new Float64Array(4)
const _edgeY = new Float64Array(4)

function buildContours(terrain, p, interval, majorInterval, majorOffset, closeRings) {
  if (p.tanakaContours) return buildContoursTanaka(terrain, p, interval)
  const { grid, gridMask, rows, cols, scl, halfW, halfH } = terrain

  const minorPos = new F32List(), minorCol = new F32List()
  const majorPos = new F32List(), majorCol = new F32List()

  const { numSteps, levelElev, levelVal, levelActive, levelRgb, lvlStep } =
    prepareContourLevels(terrain, p, interval)

  const majorMod = majorInterval ?? 0
  const offset = majorOffset ?? 1
  // Major/minor routing per bottom-up level index + phase offset
  const levelMajor = new Uint8Array(numSteps)
  for (let i = 0; i < numSteps; i++) {
    levelMajor[i] = (majorMod > 1)
      ? (((i + (majorMod - offset)) % majorMod === 0) ? 1 : 0)
      : (majorMod === 1 ? 1 : 0)
  }

  // closeRings chains raw grid-space segments per level after the scan.
  const levelSegs = closeRings ? new Array(numSteps).fill(null) : null
  const lvl0 = numSteps > 0 ? levelVal[0] : 0
  const ex = _edgeX, ey = _edgeY

  // Single cell-major pass: instead of re-scanning the whole grid once per level
  // (O(levels × cells)), visit each cell once and only test the levels that can
  // cross its value range (O(cells + emitted segments)).
  if (numSteps > 0) for (let r = 0; r < rows - 1; r++) {
    const row0 = r * cols, row1 = row0 + cols
    for (let c = 0; c < cols - 1; c++) {
      // If all 4 are NoData, skip cell
      const m00 = gridMask[row0 + c], m10 = gridMask[row0 + c + 1]
      const m01 = gridMask[row1 + c], m11 = gridMask[row1 + c + 1]
      if (!m00 && !m10 && !m01 && !m11) continue

      // Value range over valid corners. NoData corners count as "just below the
      // level" at every level (so shorelines draw) — they never bound the range.
      let vmin = Infinity, vmax = -Infinity, v
      if (m00) { v = grid[row0 + c];     if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m10) { v = grid[row0 + c + 1]; if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m01) { v = grid[row1 + c];     if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m11) { v = grid[row1 + c + 1]; if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      const anyMasked = !(m00 && m10 && m01 && m11)

      // Conservative level-index range (±1 slack for float safety); the exact
      // idx === 0 / 15 test below filters identically to the per-level scan.
      const kLo = anyMasked ? 0 : Math.max(0, Math.floor((vmin - lvl0) / lvlStep))
      const kHi = Math.min(numSteps - 1, Math.floor((vmax - lvl0) / lvlStep) + 1)

      for (let k = kLo; k <= kHi; k++) {
        if (!levelActive[k]) continue
        const level = levelVal[k]
        // Treat NoData as being slightly below the level so shorelines draw
        const v00 = m00 ? grid[row0 + c] : level - 1e-7
        const v10 = m10 ? grid[row0 + c + 1] : level - 1e-7
        const v11 = m11 ? grid[row1 + c + 1] : level - 1e-7
        const v01 = m01 ? grid[row1 + c] : level - 1e-7

        const idx = (v00 >= level ? 8 : 0) | (v10 >= level ? 4 : 0) | (v11 >= level ? 2 : 0) | (v01 >= level ? 1 : 0)
        if (idx === 0 || idx === 15) continue

        ex[0] = c + edgeLerp01(v00, v10, level); ey[0] = r
        ex[1] = c + 1;                           ey[1] = r + edgeLerp01(v10, v11, level)
        ex[2] = c + edgeLerp01(v01, v11, level); ey[2] = r + 1
        ex[3] = c;                               ey[3] = r + edgeLerp01(v00, v01, level)

        const pairs = MARCHING_TABLE[idx]
        for (let pi = 0; pi < pairs.length; pi += 2) {
          const e0 = pairs[pi], e1 = pairs[pi + 1]
          if (closeRings) {
            (levelSegs[k] ??= []).push(ex[e0], ey[e0], ex[e1], ey[e1])
          } else {
            const isMajor = levelMajor[k] === 1
            const tp = isMajor ? majorPos : minorPos
            const tc = isMajor ? majorCol : minorCol
            tp.push6(ex[e0] * scl - halfW, levelElev[k], ey[e0] * scl - halfH,
                     ex[e1] * scl - halfW, levelElev[k], ey[e1] * scl - halfH)
            tc.push6(levelRgb[k * 3], levelRgb[k * 3 + 1], levelRgb[k * 3 + 2],
                     levelRgb[k * 3], levelRgb[k * 3 + 1], levelRgb[k * 3 + 2])
          }
        }
      }
    }
  }

  if (closeRings) {
    for (let k = 0; k < numSteps; k++) {
      const segs = levelSegs[k]
      if (!segs || segs.length === 0) continue
      const worldSegs = closeContourRings(segs, rows, cols, scl, halfW, halfH, levelElev[k])
      const isMajor = levelMajor[k] === 1
      const tp = isMajor ? majorPos : minorPos
      const tc = isMajor ? majorCol : minorCol
      for (let j = 0; j < worldSegs.length; j += 6) {
        tp.push6(worldSegs[j], worldSegs[j+1], worldSegs[j+2], worldSegs[j+3], worldSegs[j+4], worldSegs[j+5])
        tc.push6(levelRgb[k * 3], levelRgb[k * 3 + 1], levelRgb[k * 3 + 2],
                 levelRgb[k * 3], levelRgb[k * 3 + 1], levelRgb[k * 3 + 2])
      }
    }
  }

  return {
    'Contours-Minor': { positions: minorPos.toArray(), colors: minorCol.toArray() },
    'Contours-Major': { positions: majorPos.toArray(), colors: majorCol.toArray() },
  }
}
const MARCHING_TABLE = { 1:[3,2], 2:[2,1], 3:[3,1], 4:[0,1], 5:[0,3,2,1], 6:[0,2], 7:[0,3], 8:[0,3], 9:[0,2], 10:[0,1,2,3], 11:[0,1], 12:[3,1], 13:[2,1], 14:[3,2] }

function buildContoursTanaka(terrain, p, interval) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH } = terrain

  const brightPos = new F32List(), brightCol = new F32List()
  const darkPos = new F32List(), darkCol = new F32List()

  const { numSteps, levelElev, levelVal, levelActive, levelRgb, lvlStep } =
    prepareContourLevels(terrain, p, interval)

  const sunAzRad = ((p.tanakaSunAzimuth ?? 315) * Math.PI) / 180
  const sunDirX =  Math.sin(sunAzRad)
  const sunDirZ = -Math.cos(sunAzRad)

  const lvl0 = numSteps > 0 ? levelVal[0] : 0
  const ex = _edgeX, ey = _edgeY

  // Same single cell-major pass as buildContours (see comment there).
  if (numSteps > 0) for (let r = 0; r < rows - 1; r++) {
    const row0 = r * cols, row1 = row0 + cols
    for (let c = 0; c < cols - 1; c++) {
      const m00 = gridMask[row0 + c], m10 = gridMask[row0 + c + 1]
      const m01 = gridMask[row1 + c], m11 = gridMask[row1 + c + 1]
      if (!m00 && !m10 && !m01 && !m11) continue

      let vmin = Infinity, vmax = -Infinity, v
      if (m00) { v = grid[row0 + c];     if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m10) { v = grid[row0 + c + 1]; if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m01) { v = grid[row1 + c];     if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      if (m11) { v = grid[row1 + c + 1]; if (v < vmin) vmin = v; if (v > vmax) vmax = v }
      const anyMasked = !(m00 && m10 && m01 && m11)

      const kLo = anyMasked ? 0 : Math.max(0, Math.floor((vmin - lvl0) / lvlStep))
      const kHi = Math.min(numSteps - 1, Math.floor((vmax - lvl0) / lvlStep) + 1)

      for (let k = kLo; k <= kHi; k++) {
        if (!levelActive[k]) continue
        const level = levelVal[k]
        const v00 = m00 ? grid[row0 + c] : level - 1e-7
        const v10 = m10 ? grid[row0 + c + 1] : level - 1e-7
        const v11 = m11 ? grid[row1 + c + 1] : level - 1e-7
        const v01 = m01 ? grid[row1 + c] : level - 1e-7

        const idx = (v00 >= level ? 8 : 0) | (v10 >= level ? 4 : 0) | (v11 >= level ? 2 : 0) | (v01 >= level ? 1 : 0)
        if (idx === 0 || idx === 15) continue

        ex[0] = c + edgeLerp01(v00, v10, level); ey[0] = r
        ex[1] = c + 1;                           ey[1] = r + edgeLerp01(v10, v11, level)
        ex[2] = c + edgeLerp01(v01, v11, level); ey[2] = r + 1
        ex[3] = c;                               ey[3] = r + edgeLerp01(v00, v01, level)

        const pairs = MARCHING_TABLE[idx]
        for (let pi = 0; pi < pairs.length; pi += 2) {
          const e0 = pairs[pi], e1 = pairs[pi + 1]
          const mc = Math.max(0, Math.min(cols - 1, Math.round((ex[e0] + ex[e1]) / 2)))
          const mr = Math.max(0, Math.min(rows - 1, Math.round((ey[e0] + ey[e1]) / 2)))
          const gx = (grid[mr*cols + Math.min(mc+1,cols-1)] - grid[mr*cols + Math.max(mc-1,0)]) / (2 * scl)
          const gz = (grid[Math.min(mr+1,rows-1)*cols + mc] - grid[Math.max(mr-1,0)*cols + mc]) / (2 * scl)
          const lit = sunDirX * gx + sunDirZ * gz >= 0

          const tp = lit ? brightPos : darkPos
          const tc = lit ? brightCol : darkCol
          tp.push6(ex[e0] * scl - halfW, levelElev[k], ey[e0] * scl - halfH,
                   ex[e1] * scl - halfW, levelElev[k], ey[e1] * scl - halfH)
          tc.push6(levelRgb[k * 3], levelRgb[k * 3 + 1], levelRgb[k * 3 + 2],
                   levelRgb[k * 3], levelRgb[k * 3 + 1], levelRgb[k * 3 + 2])
        }
      }
    }
  }

  return {
    'Contours-Tanaka-Bright': { positions: brightPos.toArray(), colors: brightCol.toArray() },
    'Contours-Tanaka-Dark':   { positions: darkPos.toArray(),   colors: darkCol.toArray() },
  }
}

// ─── Flow lines ───────────────────────────────────────────────────────────────

function sampleB(grid, rows, cols, fr, fc) {
  const r0 = Math.max(0, Math.min(rows-1, Math.floor(fr))), c0 = Math.max(0, Math.min(cols-1, Math.floor(fc))), r1 = Math.min(rows-1, r0+1), c1 = Math.min(cols-1, c0+1), dr = fr-r0, dc = fc-c0
  return grid[r0*cols+c0]*(1-dr)*(1-dc) + grid[r0*cols+c1]*(1-dr)*dc + grid[r1*cols+c0]*dr*(1-dc) + grid[r1*cols+c1]*dr*dc
}

function buildFlowLines(terrain, p, spacing, step, maxLen) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const seedStep = Math.max(1, (spacing ?? 10) / scl), n = rows*cols, posBuf = new Float32Array(n*6), colBuf = new Float32Array(n*6), mask = new Uint8Array(n), eps = 0.5
  const seeds = []
  for (let rf = 0; rf < rows; rf += seedStep) {
    const r = Math.min(rows - 1, Math.round(rf))
    for (let cf = 0; cf < cols; cf += seedStep) {
      const c = Math.min(cols - 1, Math.round(cf))
      if (gridMask[r*cols+c]) seeds.push(r*cols+c)
    }
  }
  seeds.sort((a, b) => grid[b] - grid[a])
  let totalSegments = 0
  for (const idx of seeds) {
    const r = Math.floor(idx / cols), c = idx % cols
    if (mask[idx]) continue
    let fr = r, fc = c, b0 = sampleB(grid, rows, cols, fr, fc), e0 = (b0 - 0.5)*100*elevScale
    for (let s = 0; s < (maxLen ?? 100); s++) {
        if (fr < eps || fr > rows-1-eps || fc < eps || fc > cols-1-eps) break
        const ri = Math.round(fr), ci = Math.round(fc)
        if (!gridMask[ri*cols+ci]) break
        mask[ri*cols+ci] = 1
        const bL = sampleB(grid, rows, cols, fr, fc-eps), bR = sampleB(grid, rows, cols, fr, fc+eps), bU = sampleB(grid, rows, cols, fr-eps, fc), bD = sampleB(grid, rows, cols, fr+eps, fc)
        const gx = bR-bL, gz = bD-bU, mag = Math.sqrt(gx*gx+gz*gz)
        if (mag < 0.0005) break
        const nfc = fc-(gx/mag)*(step??1), nfr = fr-(gz/mag)*(step??1)
        if (mask[Math.round(nfr)*cols+Math.round(nfc)] || !gridMask[Math.round(nfr)*cols+Math.round(nfc)]) break
        const b1 = sampleB(grid, rows, cols, nfr, nfc), e1 = (b1-0.5)*100*elevScale
        if (inElevCut(e0, minZ, maxZ, elevMinCut, elevMaxCut) && inElevCut(e1, minZ, maxZ, elevMinCut, elevMaxCut)) {
          const pIdx = totalSegments*6; posBuf[pIdx]=fc*scl-halfW; posBuf[pIdx+1]=e0; posBuf[pIdx+2]=fr*scl-halfH; posBuf[pIdx+3]=nfc*scl-halfW; posBuf[pIdx+4]=e1; posBuf[pIdx+5]=nfr*scl-halfH
          const col0 = computeVertexColor(normElev(e0, minZ, maxZ), Math.min(1, mag/(maxSlope||0.02)), Math.atan2(gz, gx), p)
          colBuf[pIdx]=col0[0]; colBuf[pIdx+1]=col0[1]; colBuf[pIdx+2]=col0[2]; colBuf[pIdx+3]=col0[0]; colBuf[pIdx+4]=col0[1]; colBuf[pIdx+5]=col0[2]
          totalSegments++
        } else if (!(inElevCut(e0, minZ, maxZ, elevMinCut, elevMaxCut) || inElevCut(e1, minZ, maxZ, elevMinCut, elevMaxCut))) break
        fr=nfr; fc=nfc; b0=b1; e0=e1
      }
  }
  return { positions: posBuf.slice(0, totalSegments*6), colors: colBuf.slice(0, totalSegments*6) }
}

// ─── Stream Network ──────────────────────────────────────────────────────

function buildDagThinning(terrain, p, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const n = rows*cols, next = new Int32Array(n).fill(-1), inDeg = new Int32Array(n).fill(0)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!gridMask[r*cols+c]) continue
      const i = r*cols+c; let minH = grid[i], target = -1
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = r+dr, nc = c+dc
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && gridMask[nr*cols+nc]) {
            const ni = nr*cols+nc; if (grid[ni] < minH) { minH = grid[ni]; target = ni }
          }
        }
      }
      if (target !== -1) { next[i] = target; inDeg[target]++ }
    }
  }
  const order = new Int32Array(n).fill(1), currentInDeg = new Int32Array(inDeg), maxInOrder = new Int32Array(n).fill(0), countMaxOrder = new Int32Array(n).fill(0), queue = []
  for (let i = 0; i < n; i++) if (gridMask[i] && inDeg[i] === 0) queue.push(i)
  let head = 0
  while (head < queue.length) {
    const i = queue[head++], dst = next[i]; if (dst === -1) continue
    const o = order[i]; if (o > maxInOrder[dst]) { maxInOrder[dst] = o; countMaxOrder[dst] = 1 } else if (o === maxInOrder[dst]) countMaxOrder[dst]++
    currentInDeg[dst]--; if (currentInDeg[dst] === 0) { order[dst] = (countMaxOrder[dst] > 1) ? maxInOrder[dst]+1 : maxInOrder[dst]; queue.push(dst) }
  }
  const positions = new F32List(), colors = new F32List()
  const strahlerThreshold = Math.max(1, Math.round(threshold ?? 2))
  for (let i = 0; i < n; i++) {
    const dst = next[i]; if (dst === -1 || order[i] < strahlerThreshold) continue
    const r0 = Math.floor(i/cols), c0 = i%cols, r1 = Math.floor(dst/cols), c1 = dst%cols, e0 = (grid[i]-0.5)*100*elevScale, e1 = (grid[dst]-0.5)*100*elevScale
    if (!inElevCut(e0, minZ, maxZ, elevMinCut, elevMaxCut)) continue
    positions.push6(c0*scl-halfW, e0, r0*scl-halfH, c1*scl-halfW, e1, r1*scl-halfH)
    const col = computeVertexColor(normElev(e0, minZ, maxZ), gridSlopes[i]/(maxSlope||1), Math.atan2(r1-r0, c1-c0), p); colors.pushRgb2(col)
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Pencil Shading ───────────────────────────────────────────────────────────

function buildPencilShading(terrain, p, spacing, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ } = terrain
  const { elevScale, jitterAmt, elevMinCut, elevMaxCut } = p
  const positions = new F32List(), colors = new F32List(), step = Math.max(1, Math.round((spacing ?? 4) / scl))
  const curvThreshold = threshold ?? 0.5
  for (let r = step; r < rows - step; r += step) {
    for (let c = step; c < cols - step; c += step) {
      if (!gridMask[r*cols+c] || r <= 0 || r >= rows-1 || c <= 0 || c >= cols-1) continue
      const curv = -(grid[(r-1)*cols+c] + grid[(r+1)*cols+c] + grid[r*cols+c-1] + grid[r*cols+c+1] - 4*grid[r*cols+c]) * 100
      if (curv < curvThreshold) continue
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      const wx = c*scl-halfW, wz = r*scl-halfH, len = Math.min(scl*2, curv*0.5), col = computeVertexColor(normElev(elev, minZ, maxZ), 0, 0, p)
      positions.push6(wx-0.7*len, elev, wz-0.7*len, wx+0.7*len, elev, wz+0.7*len)
      positions.push6(wx-0.7*len, elev, wz+0.7*len, wx+0.7*len, elev, wz-0.7*len)
      colors.pushRgb2(col); colors.pushRgb2(col)
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Ridge Lines (Differential Geometry) ──────────────────────────────────────

function buildRidgeLines(terrain, p, spacing, radius, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  
  // 1. Pre-smooth for stable second derivatives
  const smoothed = boxBlur(grid, cols, rows, radius)
  const ridgeThreshold = (threshold ?? 0.5) * 0.1
  const step = Math.max(1, Math.round((spacing ?? 2) / scl))
  const positions = new F32List(), colors = new F32List()
  
  // 2. Compute Ridge points using Hessian Eigenvalues
  // Point is a ridge if max principal curvature is high AND it's a local maximum in direction of curvature
  const isRidge = new Uint8Array(rows * cols)
  const curvatures = new Float32Array(rows * cols)

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      
      // Finite differences for second derivatives
      const hxx = smoothed[i+1] + smoothed[i-1] - 2*smoothed[i]
      const hyy = smoothed[i+cols] + smoothed[i-cols] - 2*smoothed[i]
      const hxy = (smoothed[i+cols+1] - smoothed[i+cols-1] - smoothed[i-cols+1] + smoothed[i-cols-1]) / 4
      
      // Eigenvalues of Hessian J = [[hxx, hxy], [hxy, hyy]]
      // lambda = (tr(J) +- sqrt(tr(J)^2 - 4*det(J))) / 2
      const tr = hxx + hyy
      const det = hxx * hyy - hxy * hxy
      const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det))
      const lambda1 = (tr - disc) / 2 // Smallest eigenvalue (most negative for ridge)
      
      curvatures[i] = -lambda1
      if (-lambda1 > ridgeThreshold) isRidge[i] = 1
    }
  }

  // 3. Connect neighboring Ridge points to form segments
  for (let r = 1; r < rows - 1; r += step) {
    for (let c = 1; c < cols - 1; c += step) {
      const i = r * cols + c
      if (!isRidge[i]) continue
      
      // Check 8-neighborhood for other ridge points to connect to
      for (let dr = 0; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc <= 0) continue // Skip self and previous columns in current row
          const nr = r + dr, nc = c + dc
          const ni = nr * cols + nc
          if (nr >= rows || nc < 0 || nc >= cols || !isRidge[ni]) continue
          
          const e0 = cellElev(grid, r, c, cols, elevScale, jitterAmt)
          const e1 = cellElev(grid, nr, nc, cols, elevScale, jitterAmt)
          
          if (inElevCut(e0, minZ, maxZ, elevMinCut, elevMaxCut) && inElevCut(e1, minZ, maxZ, elevMinCut, elevMaxCut)) {
            positions.push6(c*scl-halfW, e0, r*scl-halfH, nc*scl-halfW, e1, nr*scl-halfH)
            const col = computeVertexColor(normElev(e0, minZ, maxZ), gridSlopes[i]/(maxSlope||1), 0, p)
            colors.pushRgb2(col)
          }
        }
      }
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Ridge & Valley (TPI) ────────────────────────────────────────────────────

function buildTpiFeatures(terrain, p, spacing, radius, threshold, isRidge) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  
  // 1. Calculate neighborhood mean using Integral Image (boxBlur)
  const blurred = boxBlur(grid, cols, rows, radius)
  
  const step = Math.max(1, Math.round((spacing ?? 2) / scl))
  const positions = new F32List(), colors = new F32List()

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      
      const val = grid[i]
      const avg = blurred[i]
      const tpi = val - avg
      
      const meetsThreshold = isRidge ? (tpi > threshold * 0.05) : (tpi < -threshold * 0.05)
      if (!meetsThreshold) continue
      
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      
      const wx = c * scl - halfW
      const wz = r * scl - halfH
      
      // Draw a small cross-mark centered at the feature point
      const size = Math.abs(tpi) * 50 * scl
      positions.push6(wx - size, elev, wz, wx + size, elev, wz)

      const slope = gridSlopes[i]
      const col = computeVertexColor(normElev(elev, minZ, maxZ), slope / (maxSlope || 1), 0, p)
      colors.pushRgb2(col)
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Pillars ──────────────────────────────────────────────────────────────

function buildPillars(terrain, p, spacing) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt, pillarGap, pillarDepth } = p

  const step     = Math.max(1, Math.round((spacing ?? 8) / scl))
  const gap      = pillarGap ?? 0
  const depth    = pillarDepth ?? 0
  const style    = p.pillarStyle ?? 'line'
  const halfSize = (p.pillarSize ?? 0.8) * step * scl * 0.5
  const segs     = Math.max(3, Math.round(p.pillarSegments ?? 8))

  const positions = new F32List(), colors = new F32List()
  const lidP = new F32List(), lidC = new F32List(), lidI = new U32List()
  let lidVIdx = 0

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue

      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue

      const wx = c * scl - halfW
      const wz = r * scl - halfH
      const top    = elev - gap
      const bottom = minZ - depth
      if (top <= bottom) continue

      const slope   = gridSlopes[i]
      const colBase = computeVertexColor(normElev(bottom, minZ, maxZ), 0, 0, p)
      const colPeak = computeVertexColor(normElev(top,    minZ, maxZ), slope / (maxSlope || 1), 0, p)
      const colLid  = p.pillarLidColor ? hexToRgb(p.pillarLidColor) : colPeak

      if (style === 'cuboid') {
        const h = halfSize
        // Top face perimeter (4 edges)
        positions.push6(wx-h,top,wz-h, wx+h,top,wz-h); positions.push6(wx+h,top,wz-h, wx+h,top,wz+h)
        positions.push6(wx+h,top,wz+h, wx-h,top,wz+h); positions.push6(wx-h,top,wz+h, wx-h,top,wz-h)
        for (let e = 0; e < 4; e++) colors.pushRgb2(colPeak)
        // Bottom face (4 edges)
        positions.push6(wx-h,bottom,wz-h, wx+h,bottom,wz-h); positions.push6(wx+h,bottom,wz-h, wx+h,bottom,wz+h)
        positions.push6(wx+h,bottom,wz+h, wx-h,bottom,wz+h); positions.push6(wx-h,bottom,wz+h, wx-h,bottom,wz-h)
        for (let e = 0; e < 4; e++) colors.pushRgb2(colBase)
        // 4 vertical edges (base → peak colour gradient)
        positions.push6(wx-h,bottom,wz-h, wx-h,top,wz-h); positions.push6(wx+h,bottom,wz-h, wx+h,top,wz-h)
        positions.push6(wx+h,bottom,wz+h, wx+h,top,wz+h); positions.push6(wx-h,bottom,wz+h, wx-h,top,wz+h)
        for (let e = 0; e < 4; e++) { colors.pushRgb(colBase); colors.pushRgb(colPeak) }
        // Lid mesh — 2 triangles covering the top face
        lidP.push6(wx-h,top,wz-h, wx+h,top,wz-h); lidP.push6(wx+h,top,wz+h, wx-h,top,wz+h)
        for (let v = 0; v < 4; v++) lidC.pushRgb(colLid)
        lidI.push3(lidVIdx, lidVIdx+1, lidVIdx+2); lidI.push3(lidVIdx, lidVIdx+2, lidVIdx+3)
        lidVIdx += 4
      } else if (style === 'cylinder') {
        const rad = halfSize
        for (let s = 0; s < segs; s++) {
          const a0 = (s       / segs) * Math.PI * 2
          const a1 = ((s + 1) / segs) * Math.PI * 2
          const x0 = wx + rad * Math.cos(a0), z0 = wz + rad * Math.sin(a0)
          const x1 = wx + rad * Math.cos(a1), z1 = wz + rad * Math.sin(a1)
          positions.push6(x0, top,    z0, x1, top,    z1); colors.pushRgb2(colPeak)
          positions.push6(x0, bottom, z0, x1, bottom, z1); colors.pushRgb2(colBase)
          positions.push6(x0, bottom, z0, x0, top,    z0); colors.pushRgb(colBase); colors.pushRgb(colPeak)
        }
        // Lid mesh — N-gon fan from centre
        lidP.push3(wx, top, wz); lidC.pushRgb(colLid)          // centre vertex
        for (let s = 0; s < segs; s++) {
          const a = (s / segs) * Math.PI * 2
          lidP.push3(wx + rad * Math.cos(a), top, wz + rad * Math.sin(a))
          lidC.pushRgb(colLid)
        }
        for (let s = 0; s < segs; s++)
          lidI.push3(lidVIdx, lidVIdx + s + 1, lidVIdx + ((s + 1) % segs) + 1)
        lidVIdx += segs + 1
      } else {
        positions.push6(wx, bottom, wz, wx, top, wz)
        colors.pushRgb(colBase); colors.pushRgb(colPeak)
      }
    }
  }

  const lids = lidI.length > 0
    ? { positions: lidP.toArray(), colors: lidC.toArray(), indices: lidI.toArray() }
    : null
  return { positions: positions.toArray(), colors: colors.toArray(), lids }
}

// ─── Seeded randomness ───────────────────────────────────────────────────────

/** Mulberry32 PRNG — deterministic per seed so stochastic modes (Stipple,
 *  Swiss scree) are reproducible: the same seed always yields the same art. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Engraving (illumination cross-hatch) ────────────────────────────────────

/**
 * Copperplate-style hatching: per-cell darkness = 1 − Lambert illumination from
 * a configurable sun. Up to 4 hatch layers at angles θ, θ+90°, θ+45°, θ+135°;
 * layer k only draws where darkness exceeds (k+1)/(levels+1), so lit slopes get
 * sparse single-direction strokes and shadows build up stacked cross-hatching.
 * Strokes are continuous polylines marched across the grid, draped on the
 * terrain, breaking wherever the surface is too bright.
 */
function buildEngraving(terrain, p, spacing, angleDeg, levels, sunAzimuth, gamma) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const positions = new F32List(), colors = new F32List()

  // Per-cell darkness from Lambert shading (same light convention as the
  // hillshade shader: az 315° = NW, altitude fixed at 45°).
  const azRad  = ((sunAzimuth ?? 315) * Math.PI) / 180
  const altRad = Math.PI / 4
  const Lx = Math.cos(azRad) * Math.cos(altRad)
  const Ly = Math.sin(altRad)
  const Lz = Math.sin(azRad) * Math.cos(altRad)
  const dScale = (100 * elevScale) / (2 * scl)   // brightness diff → world slope
  const gam = gamma ?? 1

  const n = rows * cols
  const darkness = new Float32Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { darkness[i] = -1; continue }  // -1 = NoData, never hatched
      const b = grid[i]
      const bL = (c > 0        && gridMask[i - 1])    ? grid[i - 1]    : b
      const bR = (c < cols - 1 && gridMask[i + 1])    ? grid[i + 1]    : b
      const bU = (r > 0        && gridMask[i - cols]) ? grid[i - cols] : b
      const bD = (r < rows - 1 && gridMask[i + cols]) ? grid[i + cols] : b
      const gx = (bR - bL) * dScale, gz = (bD - bU) * dScale
      const inv = 1 / Math.sqrt(gx * gx + gz * gz + 1)
      const lambert = Math.max(0, (-gx * Lx + Ly - gz * Lz) * inv)
      darkness[i] = Math.pow(1 - lambert, gam)
    }
  }

  const nLevels = Math.max(1, Math.min(4, Math.round(levels ?? 3)))
  const HATCH_OFFSETS = [0, 90, 45, 135]
  const lineStep = Math.max(1, (spacing ?? 3) / scl)   // pitch between hatch lines, in cells
  const cc = (cols - 1) / 2, rc = (rows - 1) / 2       // grid centre
  // Half-diagonal: lines offset/marched this far in both directions cover the grid
  const halfDiag = Math.sqrt(cc * cc + rc * rc) + 1

  for (let lvl = 0; lvl < nLevels; lvl++) {
    const thresh = (lvl + 1) / (nLevels + 1)
    const theta = (((angleDeg ?? 45) + HATCH_OFFSETS[lvl]) * Math.PI) / 180
    const dx = Math.cos(theta), dz = Math.sin(theta)      // march direction (grid units)
    const nx = -dz, nz = dx                                // line-pitch normal

    for (let o = -halfDiag; o <= halfDiag; o += lineStep) {
      const ox = cc + nx * o, oz = rc + nz * o
      let prevC = 0, prevR = 0, prevE = 0, inRun = false
      for (let t = -halfDiag; t <= halfDiag; t += 1) {
        const fc = ox + dx * t, fr = oz + dz * t
        let ok = fc >= 0 && fc <= cols - 1 && fr >= 0 && fr <= rows - 1
        let elev = 0
        if (ok) {
          const ci = Math.round(fc), ri = Math.round(fr), idx = ri * cols + ci
          ok = gridMask[idx] === 1 && darkness[idx] >= thresh
          if (ok) {
            elev = (sampleB(grid, rows, cols, fr, fc) - 0.5) * 100 * elevScale
            ok = inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)
          }
        }
        if (ok && inRun) {
          positions.push6(prevC * scl - halfW, prevE, prevR * scl - halfH,
                          fc * scl - halfW, elev, fr * scl - halfH)
          const ci = Math.round(fc), ri = Math.round(fr), idx = ri * cols + ci
          const col = computeVertexColor(normElev(elev, minZ, maxZ),
                                         gridSlopes[idx] / (maxSlope || 1), theta, p)
          colors.pushRgb2(col)
        }
        inRun = ok
        prevC = fc; prevR = fr; prevE = elev
      }
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Swiss rock & scree ──────────────────────────────────────────────────────

/**
 * Swisstopo-style alpine rock depiction, returned as two sub-layers:
 *  • Swiss-Rock  — cliff hachures: short downslope strokes (perpendicular to
 *    the contours) on cells steeper than the cliff threshold, with a little
 *    seeded jitter for a hand-drawn feel.
 *  • Swiss-Scree — slope-graded debris dots (isPoints) on the moderately steep
 *    band below the cliff threshold, denser toward the cliffs.
 */
function buildSwissRockScree(terrain, p, spacing, threshold, length, screeDensity) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const rng = mulberry32(((p.seedSwiss ?? 42) * 2654435761 + 0x9e3779b9) >>> 0)

  const step = Math.max(1, Math.round((spacing ?? 2) / scl))
  const cliffT = Math.max(0.02, threshold ?? 0.45)
  const screeT = cliffT * 0.45                       // lower edge of the scree band
  const dens  = Math.max(0, Math.min(1, screeDensity ?? 0.5))
  const eps   = Math.max(0.001, scl * 0.003)         // stipple-style dot half-length
  const maxS  = maxSlope || 1

  const rockPos = new F32List(), rockCol = new F32List()
  const screePos = new F32List(), screeCol = new F32List()

  for (let r = 1; r < rows - 1; r += step) {
    for (let c = 1; c < cols - 1; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const slopeNorm = gridSlopes[i] / maxS
      if (slopeNorm < screeT) continue

      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      const normE = normElev(elev, minZ, maxZ)
      const wx = c * scl - halfW, wz = r * scl - halfH

      if (slopeNorm >= cliffT) {
        // Cliff hachure: stroke pointing downslope, longer on steeper rock.
        const gx = grid[i + 1] - grid[i - 1]
        const gz = grid[i + cols] - grid[i - cols]
        const mag = Math.sqrt(gx * gx + gz * gz)
        if (mag < 1e-9) continue
        const ux = gx / mag, uz = gz / mag           // +gradient = uphill; stroke goes downhill
        const len = (length ?? 1) * scl * step * (0.6 + slopeNorm * 1.2)
        // Slight seeded perpendicular wobble — engraver's hand, reproducible.
        const j = (rng() - 0.5) * 0.35
        const sx = -ux * len, sz = -uz * len
        const jx = -uz * len * j, jz = ux * len * j
        const ex = wx + sx + jx, ez = wz + sz + jz
        const e1 = (sampleB(grid, rows, cols,
                            Math.max(0, Math.min(rows - 1, (ez + halfH) / scl)),
                            Math.max(0, Math.min(cols - 1, (ex + halfW) / scl))) - 0.5) * 100 * elevScale
        rockPos.push6(wx, elev, wz, ex, e1, ez)
        const col = computeVertexColor(normE, slopeNorm, Math.atan2(gz, gx), p)
        rockCol.pushRgb2(col)
      } else if (rng() < dens * ((slopeNorm - screeT) / (cliffT - screeT))) {
        // Scree dot: jittered within the cell, denser approaching the cliffs.
        const jc = c + (rng() - 0.5) * step, jr = r + (rng() - 0.5) * step
        const sx2 = jc * scl - halfW, sz2 = jr * scl - halfH
        const se = (sampleB(grid, rows, cols,
                            Math.max(0, Math.min(rows - 1, jr)),
                            Math.max(0, Math.min(cols - 1, jc))) - 0.5) * 100 * elevScale
        screePos.push6(sx2 - eps, se, sz2, sx2 + eps, se, sz2)
        const col = computeVertexColor(normElev(se, minZ, maxZ), slopeNorm, 0, p)
        screeCol.pushRgb2(col)
      }
    }
  }

  return {
    'Swiss-Rock':  { positions: rockPos.toArray(),  colors: rockCol.toArray() },
    'Swiss-Scree': { positions: screePos.toArray(), colors: screeCol.toArray(), isPoints: true },
  }
}

// ─── Stipple ──────────────────────────────────────────────────────────────────

function buildStipple(terrain, p, spacing, densityMode, gamma, jitter) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const step = Math.max(1, Math.round((spacing ?? 0.5) / scl))
  const eps = Math.max(0.001, scl * 0.003)
  const jAmt = (jitter ?? 0.8) * step
  const gam  = gamma ?? 1.2
  const dm   = densityMode ?? 'slope'
  const positions = new F32List(), colors = new F32List()
  // Seeded so a given seed always produces the identical dot pattern.
  const rng = mulberry32(((p.seedStipple ?? 42) * 2654435761) >>> 0)

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const jr = r + (rng() - 0.5) * jAmt
      const jc = c + (rng() - 0.5) * jAmt
      const ri = Math.max(0, Math.min(rows - 1, Math.floor(jr)))
      const ci = Math.max(0, Math.min(cols - 1, Math.floor(jc)))
      if (!gridMask[ri * cols + ci]) continue

      const elev = cellElev(grid, ri, ci, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue

      const normE = normElev(elev, minZ, maxZ)
      const slope = gridSlopes[ri * cols + ci] / (maxSlope || 1)

      let density
      if      (dm === 'elevation') density = normE
      else if (dm === 'invElev')   density = 1 - normE
      else if (dm === 'invSlope')  density = 1 - slope
      else                         density = slope

      density = Math.pow(Math.max(0, Math.min(1, density)), gam)
      if (rng() > density) continue

      const wx = jc * scl - halfW
      const wz = jr * scl - halfH
      positions.push6(wx - eps, elev, wz, wx + eps, elev, wz)
      const col = computeVertexColor(normE, slope, 0, p)
      colors.pushRgb2(col)
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray(), isPoints: true }
}

// ─── Surface ──────────────────────────────────────────────────────────────────

export function buildSurfaceGeometry(terrain, p) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, elevScale } = terrain
  const { jitterAmt } = p
  const vertexCount = rows * cols
  const basePos = new Float32Array(vertexCount * 3), baseBright = new Float32Array(vertexCount)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { basePos[i*3]=c*scl-halfW; basePos[i*3+1]=-10000; basePos[i*3+2]=r*scl-halfH; baseBright[i]=0 }
      else { basePos[i*3]=c*scl-halfW; basePos[i*3+1]=cellElev(grid, r, c, cols, elevScale, jitterAmt); basePos[i*3+2]=r*scl-halfH; baseBright[i]=grid[i] }
    }
  }
  // Two-pass index build: count valid quads first so the buffer is allocated once.
  let quadCount = 0
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = r*cols+c
      if (gridMask[tl] && gridMask[tl+1] && gridMask[tl+cols] && gridMask[tl+cols+1]) quadCount++
    }
  }
  if (!quadCount) return { positions: new Float32Array(0), brightnessBuf: new Float32Array(0), indices: new Uint32Array(0), metadata: { rows, cols } }
  const baseIndices = new Uint32Array(quadCount * 6)
  let bi = 0
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = r*cols+c, tr = tl+1, bl = tl+cols, br = bl+1
      if (gridMask[tl] && gridMask[tr] && gridMask[bl] && gridMask[br]) {
        baseIndices[bi] = tl; baseIndices[bi+1] = bl; baseIndices[bi+2] = tr
        baseIndices[bi+3] = tr; baseIndices[bi+4] = bl; baseIndices[bi+5] = br
        bi += 6
      }
    }
  }
  const mX = [p.showMirrorPlusX ? 1 : null, p.showMirrorMinusX ? -1 : null].filter(v => v !== null)
  const mY = [p.showMirrorPlusY ? 1 : null, p.showMirrorMinusY ? -1 : null].filter(v => v !== null)
  const mZ = [p.showMirrorPlusZ ? 1 : null, p.showMirrorMinusZ ? -1 : null].filter(v => v !== null)
  const nOct = mX.length * mY.length * mZ.length

  // Fast path: single identity octant — the base buffers are the final mesh.
  if (nOct === 1 && mX[0] === 1 && mY[0] === 1 && mZ[0] === 1) {
    return { positions: basePos, brightnessBuf: baseBright, indices: baseIndices, metadata: { rows, cols } }
  }

  // Pre-allocate all octants once (repeated concat() is O(octants²) in copies).
  const finalPos = new Float32Array(basePos.length * nOct)
  const finalBright = new Float32Array(baseBright.length * nOct)
  const finalIndices = new Uint32Array(baseIndices.length * nOct)
  let posOff = 0, brightOff = 0, indOff = 0, indexOffset = 0
  for (const sx of mX) {
    for (const sy of mY) {
      for (const sz of mZ) {
        for (let i = 0; i < basePos.length; i += 3) {
          finalPos[posOff + i]     = basePos[i]     * sx
          finalPos[posOff + i + 1] = basePos[i + 1] * sy
          finalPos[posOff + i + 2] = basePos[i + 2] * sz
        }
        posOff += basePos.length
        finalBright.set(baseBright, brightOff); brightOff += baseBright.length
        const flipWinding = (sx * sy * sz) < 0
        for (let i = 0; i < baseIndices.length; i += 3) {
          finalIndices[indOff + i] = baseIndices[i] + indexOffset
          if (flipWinding) {
            finalIndices[indOff + i + 1] = baseIndices[i + 2] + indexOffset
            finalIndices[indOff + i + 2] = baseIndices[i + 1] + indexOffset
          } else {
            finalIndices[indOff + i + 1] = baseIndices[i + 1] + indexOffset
            finalIndices[indOff + i + 2] = baseIndices[i + 2] + indexOffset
          }
        }
        indOff += baseIndices.length
        indexOffset += vertexCount
      }
    }
  }
  return { positions: finalPos, brightnessBuf: finalBright, indices: finalIndices, metadata: { rows, cols } }
}

// ─── GPX Track ───────────────────────────────────────────────────────────────

// Small Y lift so the track never clips into the terrain surface.
const GPX_Y_OFFSET = 0.5

/**
 * Build the GPX track as a standard lineGeo layer.
 *
 * Unlike the 12 draw modes this builder is called directly from the worker
 * after buildLineGeometry(), NOT via the MODES_CONFIG dispatch table, because:
 *   • GPX is geo-referenced and must not go through the mirror/symmetry loop.
 *   • It requires imageWidth/imageHeight which are worker top-level inputs,
 *     not terrain-derived values.
 *
 * Coordinate path: WGS84 lat/lon → (geoToWorld) → pixel space → world space →
 * bilinear terrain elevation sample → Y + GPX_Y_OFFSET.
 *
 * Points outside the GeoTIFF extent are mapped to null and skipped; the
 * resulting gaps produce disconnected segments (correct for clipped tracks).
 */
export function buildGpxGeometry(terrain, p, imageWidth, imageHeight) {
  const { scl, halfW, halfH, minZ, maxZ } = terrain
  const { gpxPoints, geoTiffBbox, geoTiffCRS } = p
  if (!gpxPoints?.length || !geoTiffBbox || !geoTiffCRS?.startsWith('EPSG:')) return null

  const peakOff = Math.floor(p.gridOffsetX ?? 0)
  const lineOff = Math.floor(p.gridOffsetY ?? 0)

  const ctx = {
    ...p,
    lineColor:         p.colorGpx,
    lineOpacity:       p.opacityGpx,
    lineHypsometric:   p.hypsoGpx,
    lineHypsoMode:     p.hypsoModeGpx,
    lineBanded:        p.hypsoBandedGpx,
    lineHypsoInterval: p.hypsoIntervalGpx,
  }

  const positions = new F32List(), colors = new F32List()

  const worldPts = gpxPoints.map(({ lat, lon }) =>
    geoToWorld(lat, lon, geoTiffBbox, geoTiffCRS, imageWidth, imageHeight, peakOff, lineOff, halfW, halfH)
  )

  for (let i = 0; i < worldPts.length - 1; i++) {
    const a = worldPts[i], b = worldPts[i + 1]
    if (!a || !b) continue

    const elevA = sampleTerrainElev(a.pixelCol, a.pixelRow, terrain, scl, peakOff, lineOff) + GPX_Y_OFFSET
    const elevB = sampleTerrainElev(b.pixelCol, b.pixelRow, terrain, scl, peakOff, lineOff) + GPX_Y_OFFSET

    const normA = minZ < maxZ ? (elevA - minZ) / (maxZ - minZ) : 0
    const normB = minZ < maxZ ? (elevB - minZ) / (maxZ - minZ) : 0

    positions.push6(a.worldX, elevA, a.worldZ, b.worldX, elevB, b.worldZ)
    colors.pushRgb(computeVertexColor(normA, 0, 0, ctx))
    colors.pushRgb(computeVertexColor(normB, 0, 0, ctx))
  }

  if (positions.length === 0) return null
  // weight / opacity / dash resolved via layerStyle('Gpx', p) at render/export time.
  return {
    id: 'Gpx',
    positions: positions.toArray(),
    colors: colors.toArray(),
    curtains: null,
    lids: null,
  }
}
