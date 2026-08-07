/**
 * CPU-side geometry builders.
 */

import { cellElev, hasData, boxBlur, jitterNoise, NODATA_SENTINEL_Y } from './terrain'
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
/**
 * Is any fill layer drawing on the surface?
 *
 * Governs whether the surface mesh rasterizes at all and whether it writes
 * depth. Raw terrain view counts: it draws the surface, it just draws it flat
 * and unlit.
 */
export function hasFillLayer(p) {
  return !!(p.showFill || p.showRawTerrain || p.showHillshade || p.showSlopeShade ||
            p.showWaterFill || p.showAO || p.showAspectMap)
}

/**
 * Does the surface need shading attributes — normals and UVs — built for it?
 *
 * Deliberately *not* the same set as `hasFillLayer`. Raw terrain view is a flat
 * greyscale readout of the heightmap that consults neither, so listing it here
 * would cost a full geometry rebuild on every toggle to produce buffers nothing
 * reads. Profile mode is included because it needs the mesh as a raycast target.
 */
export function needsSurfaceShading(p) {
  return !!(p.showFill || p.showHillshade || p.showSlopeShade ||
            p.showWaterFill || p.showAO || p.showAspectMap || p.profileMode)
}

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

/** Float64 variant, used for contour chain coordinates. Double precision keeps
 *  the chained/smoothed output bit-identical to the pre-optimisation builder;
 *  Float32 was measured to be no faster here, so there is nothing to trade. */
class F64List {
  constructor(cap = 4096) { this.a = new Float64Array(cap); this.n = 0 }
  _grow(need) {
    let cap = this.a.length * 2
    while (cap < need) cap *= 2
    const next = new Float64Array(cap)
    next.set(this.a.subarray(0, this.n))
    this.a = next
  }
  push4(x0, y0, x1, y1) {
    if (this.n + 4 > this.a.length) this._grow(this.n + 4)
    const a = this.a, n = this.n
    a[n] = x0; a[n + 1] = y0; a[n + 2] = x1; a[n + 3] = y1
    this.n = n + 4
  }
  get length() { return this.n }
}

class I32List {
  constructor(cap = 4096) { this.a = new Int32Array(cap); this.n = 0 }
  _grow(need) {
    let cap = this.a.length * 2
    while (cap < need) cap *= 2
    const next = new Int32Array(cap)
    next.set(this.a.subarray(0, this.n))
    this.a = next
  }
  push2(x, y) {
    if (this.n + 2 > this.a.length) this._grow(this.n + 2)
    const a = this.a, n = this.n
    a[n] = x; a[n + 1] = y
    this.n = n + 2
  }
  get length() { return this.n }
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

// Shared zero-length buffers for "nothing to emit" returns. Immutable in
// practice — callers only ever read them — so one instance each is enough.
const EMPTY_F64 = new Float64Array(0)
const EMPTY_F32 = new Float32Array(0)
const EMPTY_U8  = new Uint8Array(0)

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
    { id:'Lines',   builder: (t, ctx) => buildAngleLines(t, ctx, p.spacingLines, p.shiftLines, p.angleLines) },
    { id:'Cross',   builder: (t, ctx) => buildCrosshatch(t, ctx, p.spacingCross, p.angleCross) },
    { id:'Pillars', builder: (t, ctx) => buildPillars(t, ctx, p.spacingPillars) },
    { id:'Contours',builder: (t, ctx) => buildContours(t, ctx, p.intervalContours, p.majorIntervalContours, p.majorOffsetContours, p.closeRingsContours, p.smoothingContours) },
    { id:'Hachure', builder: (t, ctx) => buildHachure(t, ctx, p.spacingHachure, p.lengthHachure) },
    { id:'Flow',    builder: (t, ctx) => buildFlowLines(t, ctx, p.spacingFlow, p.stepFlow, p.maxLenFlow) },
    { id:'Dag',     builder: (t, ctx) => buildDagThinning(t, ctx, p.thresholdDag) },
    { id:'Pencil',  builder: (t, ctx) => buildPencilShading(t, ctx, p.spacingPencil, p.thresholdPencil) },
    { id:'Ridge',   builder: (t, ctx) => buildRidgeLines(t, ctx, p.spacingRidge, p.radiusRidge, p.thresholdRidge) },
    { id:'Valley',  builder: (t, ctx) => buildTpiFeatures(t, ctx, p.spacingValley, p.radiusValley, p.thresholdValley, false) },
    { id:'Stipple', builder: (t, ctx) => buildStipple(t, ctx, p.spacingStipple, p.stippleDensityMode, p.stippleGamma, p.stippleJitter) },
    { id:'Engrave', builder: (t, ctx) => buildEngraving(t, ctx, p.spacingEngrave, p.angleEngrave, p.levelsEngrave, p.sunAzimuthEngrave, p.gammaEngrave) },
    { id:'Curv',    builder: (t, ctx) => buildCurvature(t, ctx, p.spacingCurv, p.lengthCurv, p.thresholdCurv, p.radiusCurv, p.dirModeCurv, p.stepCurv) },
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

// ─── Lines (arbitrary bearing) ───────────────────────────────────────────────

/**
 * Parallel terrain-draped lines at any bearing angle — the merger of the old
 * X Lines (angle 0°) and Y Lines (angle 90°) modes.
 *
 * Lines sit at perpendicular positions pos = k·lineStep + shift (in grid cells)
 * along the normal of the march direction, and are sampled in unit-cell steps.
 * At 0°/90° the sample points land exactly on grid rows/columns, so those
 * angles reproduce the old axis-aligned modes; oblique angles sample the
 * terrain bilinearly along the rotated rays.
 */
function buildAngleLines(terrain, p, spacing, shift, angleDeg, fitBoundary = false) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const positions = new F32List(), colors = new F32List()

  const lineStep = Math.max(1, Math.round((spacing ?? 4) / scl))
  const shiftCells = (shift ?? 0) % lineStep
  const theta = ((angleDeg ?? 0) * Math.PI) / 180
  // Snap near-axis components to exact 0/±1. At multiples of 90° cos/sin carry a
  // ~1e-16 rounding error; with fitBoundary the edge lines sit exactly on the grid
  // border, so that drift accumulates along the march (fc += dx·t) and pushes the
  // samples just outside [0, cols-1], clipping the whole left / part of the right
  // border line. Exact axis values keep them on the inclusive boundary.
  const snap = (v) => Math.abs(v) < 1e-9 ? 0 : Math.abs(v - 1) < 1e-9 ? 1 : Math.abs(v + 1) < 1e-9 ? -1 : v
  const dx = snap(Math.cos(theta)), dz = snap(Math.sin(theta))   // march direction (grid cols/rows)
  const nx = -dz, nz = dx                                        // line-pitch normal

  // Projection of the grid corners onto the normal (line positions) and the
  // march direction (sample range) — covers the grid exactly at any angle.
  let pMin = Infinity, pMax = -Infinity, tMin = Infinity, tMax = -Infinity
  for (const [c, r] of [[0, 0], [cols - 1, 0], [0, rows - 1], [cols - 1, rows - 1]]) {
    const pp = nx * c + nz * r; if (pp < pMin) pMin = pp; if (pp > pMax) pMax = pp
    const tt = dx * c + dz * r; if (tt < tMin) tMin = tt; if (tt > tMax) tMax = tt
  }
  const t0 = Math.ceil(tMin), t1 = Math.floor(tMax)

  // Line positions along the normal. By default lines sit at fixed multiples of
  // lineStep, so the far edge keeps whatever partial gap is left over (open/half
  // rectangles in Crosshatch). When fitBoundary is set, the first and last lines
  // are pinned to the grid edges (pMin/pMax) and the step is nudged so an integer
  // number of intervals spans them exactly — closing the rectangles on all sides.
  const linePos = []
  if (fitBoundary) {
    const span = pMax - pMin
    const n = Math.max(1, Math.round(span / lineStep))
    for (let k = 0; k <= n; k++) linePos.push(pMin + (span * k) / n)
  } else {
    const kMin = Math.ceil((pMin - shiftCells) / lineStep)
    const kMax = Math.floor((pMax - shiftCells) / lineStep)
    for (let k = kMin; k <= kMax; k++) linePos.push(k * lineStep + shiftCells)
  }

  for (const pos of linePos) {
    const ox = nx * pos, oz = nz * pos
    let prevOk = false, prevC = 0, prevR = 0, prevE = 0
    for (let t = t0; t <= t1; t++) {
      const fc = ox + dx * t, fr = oz + dz * t
      let ok = fc >= 0 && fc <= cols - 1 && fr >= 0 && fr <= rows - 1
      let elev = 0
      if (ok) {
        const ci = Math.round(fc), ri = Math.round(fr)
        ok = hasData(gridMask, ri, ci, cols)
        if (ok) {
          elev = (sampleB(grid, rows, cols, fr, fc) - 0.5) * 100 * elevScale
          if (jitterAmt > 0) elev += jitterNoise(fc, fr) * jitterAmt
          ok = inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)
        }
      }
      if (ok && prevOk) {
        positions.push6(prevC * scl - halfW, prevE, prevR * scl - halfH,
                        fc * scl - halfW, elev, fr * scl - halfH)
        const i0 = Math.round(prevR) * cols + Math.round(prevC)
        const i1 = Math.round(fr) * cols + Math.round(fc)
        colors.pushRgb(computeVertexColor(normElev(prevE, minZ, maxZ), gridSlopes[i0] / (maxSlope || 1), theta, p))
        colors.pushRgb(computeVertexColor(normElev(elev, minZ, maxZ), gridSlopes[i1] / (maxSlope || 1), theta, p))
      }
      prevOk = ok; prevC = fc; prevR = fr; prevE = elev
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

function buildCrosshatch(terrain, p, spacing, angleDeg) {
  const a = buildAngleLines(terrain, p, spacing, 0, angleDeg ?? 0, true)
  const b = buildAngleLines(terrain, p, spacing, 0, (angleDeg ?? 0) + 90, true)
  return { positions: concat(a.positions, b.positions), colors: concat(a.colors, b.colors) }
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

// Chains raw marching-squares segments (4 grid coords per segment) into polylines
// by walking shared endpoints. Returns an array of chains, each an ordered list of
// { c, r } grid points; a closed ring has its first point equal to its last.
// Used by buildContours for both Chaikin smoothing and border ring-closing.
/**
 * Chaining scratch, keyed by grid edge id (see EDGE IDS below).
 *
 * Held at module scope and grown on demand rather than allocated per call: at a
 * 512² grid these are ~8 MB per rebuild, and Soundscapes rebuilds 30× a second.
 * adj0/adj1 are left all −1 between levels (each level resets only the ids it
 * touched), so a reused buffer needs no clearing.
 */
let _chainScratch = null
function getChainScratch(size) {
  if (!_chainScratch || _chainScratch.adj0.length < size) {
    _chainScratch = {
      adj0: new Int32Array(size).fill(-1),
      adj1: new Int32Array(size).fill(-1),
      cx: new Float64Array(size),
      cy: new Float64Array(size),
      visited: new Uint8Array(1024),
    }
  }
  return _chainScratch
}

/**
 * Chains one contour level's marching-squares segments into polylines.
 *
 * Segments are joined by GRID EDGE IDENTITY, not by coordinate. Every crossing
 * sits on a specific grid edge, and adjacent cells derive a shared edge's
 * crossing from the same two corner values — so a plain integer id identifies a
 * junction exactly. The previous implementation stringified coordinates
 * (`"12.5,7"`) into a Map and rebuilt two such strings per walk step just to
 * compare tips; that alone was ~270 ms of the 312 ms closeRings cost at 512².
 * Ids also let adjacency live in two flat Int32Arrays (an edge is shared by at
 * most two segments) instead of a Map of arrays.
 *
 * Head extension collects into `back` and is reversed at the end. The old code
 * used chain.unshift() per point, which is O(n) per insert — quadratic in the
 * length of any long ring.
 *
 * @returns {{pts: Float32Array, closed: boolean}[]} pts is flat [c,r,c,r,…]
 */
function chainLevelSegments(segE, segXY, nSegs, scratch) {
  const { adj0, adj1, cx, cy } = scratch
  const touched = []

  for (let i = 0; i < nSegs; i++) {
    const e0 = segE[2 * i], e1 = segE[2 * i + 1]
    if (adj0[e0] === -1) { adj0[e0] = i; touched.push(e0); cx[e0] = segXY[4 * i];     cy[e0] = segXY[4 * i + 1] }
    else if (adj1[e0] === -1) adj1[e0] = i
    if (adj0[e1] === -1) { adj0[e1] = i; touched.push(e1); cx[e1] = segXY[4 * i + 2]; cy[e1] = segXY[4 * i + 3] }
    else if (adj1[e1] === -1) adj1[e1] = i
  }

  if (scratch.visited.length < nSegs) scratch.visited = new Uint8Array(nSegs * 2)
  const visited = scratch.visited
  visited.fill(0, 0, nSegs)

  const chains = []
  const fwd = [], back = []

  for (let s = 0; s < nSegs; s++) {
    if (visited[s]) continue
    visited[s] = 1
    const e0 = segE[2 * s], e1 = segE[2 * s + 1]

    fwd.length = 0
    back.length = 0

    // Walk both directions from the seed segment's two endpoints.
    for (let dir = 0; dir < 2; dir++) {
      const out = dir === 0 ? fwd : back
      let cur = dir === 0 ? e1 : e0
      let from = s
      for (;;) {
        const a = adj0[cur], b = adj1[cur]
        let nx = -1
        if (a !== -1 && a !== from && !visited[a]) nx = a
        else if (b !== -1 && b !== from && !visited[b]) nx = b
        if (nx < 0) break
        visited[nx] = 1
        const na = segE[2 * nx], nb = segE[2 * nx + 1]
        cur = na === cur ? nb : na
        out.push(cur)
        from = nx
      }
    }

    const m = back.length + 2 + fwd.length
    const pts = new Float64Array(m * 2)
    let w = 0
    for (let i = back.length - 1; i >= 0; i--) { const id = back[i]; pts[w++] = cx[id]; pts[w++] = cy[id] }
    pts[w++] = cx[e0]; pts[w++] = cy[e0]
    pts[w++] = cx[e1]; pts[w++] = cy[e1]
    for (let i = 0; i < fwd.length; i++) { const id = fwd[i]; pts[w++] = cx[id]; pts[w++] = cy[id] }

    // A ring closes when the walk arrives back at the edge it started from.
    // Comparing ids is exact; the old coordinate comparison was equivalent but
    // relied on float equality.
    const firstId = back.length ? back[back.length - 1] : e0
    const lastId  = fwd.length  ? fwd[fwd.length - 1]   : e1
    chains.push({ pts, closed: m > 2 && firstId === lastId })
  }

  for (let i = 0; i < touched.length; i++) { const id = touched[i]; adj0[id] = -1; adj1[id] = -1 }
  return chains
}

/**
 * Drops points that lie (near) on the line between their neighbours.
 *
 * Chaikin converges toward a smooth curve, so most of the points it emits are
 * within a small fraction of a pixel of the chord through their neighbours —
 * 3 passes multiply a polyline 8× while adding almost no visible shape. Those
 * redundant points cost segment count everywhere downstream: worker time, the
 * transferred payload, the GPU upload and the draw call.
 *
 * Douglas–Peucker, iterative (explicit stack, no recursion). A greedy
 * neighbour-to-neighbour flatness test is tempting and cheaper, but it only
 * bounds the error against adjacent points, so along a gently curving contour
 * every point looks locally collinear, all of them get dropped and the line
 * drifts arbitrarily far from its true path — measured as a 547× reduction that
 * turned smooth contours into long straight chords. Douglas–Peucker instead
 * guarantees no retained segment deviates more than `eps` from the original
 * polyline. Endpoints are always kept, so a closed ring keeps its duplicated
 * first/last point and stays closed.
 *
 * `eps` is in grid units. At the usual scl=1 a whole 512-unit terrain spans
 * roughly 600 screen pixels, so 0.02 grid units is ~1/40 of a pixel.
 */
let _dpKeep = null
let _dpStack = null
function simplifyFlat(pts, eps, outBuf = null) {
  const n = pts.length / 2
  if (n < 3) return pts
  if (!_dpKeep || _dpKeep.length < n) _dpKeep = new Uint8Array(n * 2)
  if (!_dpStack || _dpStack.length < n * 2) _dpStack = new Int32Array(n * 4)
  const keep = _dpKeep, stack = _dpStack
  keep.fill(0, 0, n)
  keep[0] = 1; keep[n - 1] = 1

  const eps2 = eps * eps
  let sp = 0
  stack[sp++] = 0; stack[sp++] = n - 1

  while (sp > 0) {
    const hi = stack[--sp], lo = stack[--sp]
    if (hi - lo < 2) continue
    const ax = pts[2 * lo], ay = pts[2 * lo + 1]
    const dx = pts[2 * hi] - ax, dy = pts[2 * hi + 1] - ay
    const len2 = dx * dx + dy * dy
    let best = -1, bestD2 = eps2
    for (let i = lo + 1; i < hi; i++) {
      const px = pts[2 * i], py = pts[2 * i + 1]
      let d2
      if (len2 < 1e-20) {
        const ex = px - ax, ey = py - ay
        d2 = ex * ex + ey * ey
      } else {
        const cross = dx * (py - ay) - dy * (px - ax)
        d2 = (cross * cross) / len2
      }
      if (d2 > bestD2) { bestD2 = d2; best = i }
    }
    if (best >= 0) {
      keep[best] = 1
      stack[sp++] = lo; stack[sp++] = best
      stack[sp++] = best; stack[sp++] = hi
    }
  }

  let w = 0
  const out = outBuf && outBuf.length >= pts.length ? outBuf : new Float64Array(pts.length)
  for (let i = 0; i < n; i++) {
    if (keep[i]) { out[w++] = pts[2 * i]; out[w++] = pts[2 * i + 1] }
  }
  return out.subarray(0, w)
}

// Chaikin corner-cutting: replaces the staircase of a marching-squares polyline
// with a smooth curve, run `iterations` times. Closed rings are smoothed as
// loops; open chains keep their two endpoints pinned so border-anchored lines
// stay put. Operates on flat [c,r,…] buffers — the previous version allocated a
// fresh {c,r} object per point per iteration, and point count doubles each pass
// (a 4-iteration smooth is 16× the points, so the object churn dominated).
// Ping-pong scratch for the smoothing passes. Every pass used to allocate a
// fresh Float64Array per chain, and there are tens of thousands of chains per
// rebuild at a 1-unit contour interval — pure GC pressure. The returned view
// points into one of these, so callers must consume it before smoothing the
// next chain (the emit loop does).
let _smA = new Float64Array(8192)
let _smB = new Float64Array(8192)
function ensureSmooth(n) {
  if (_smA.length < n) { _smA = new Float64Array(n * 2); _smB = new Float64Array(n * 2) }
}

function chaikinSmoothFlat(pts, closed, iterations, interEps = 0) {
  let cur = pts
  for (let it = 0; it < iterations; it++) {
    const total = cur.length / 2
    // A closed ring repeats its first point at the end; smooth the distinct set.
    const m = closed ? total - 1 : total
    if (m < 3) break
    const segs = closed ? m : m - 1
    const need = (closed ? segs * 2 + 1 : segs * 2 + 2) * 2
    ensureSmooth(need)
    // Never write into the buffer `cur` views, and never into the caller's array.
    const next = cur.buffer === _smA.buffer ? _smB : _smA
    let w = 0
    if (!closed) { next[w++] = cur[0]; next[w++] = cur[1] }
    for (let i = 0; i < segs; i++) {
      const ai = 2 * i, bi = 2 * ((i + 1) % m)
      const ax = cur[ai], ay = cur[ai + 1], bx = cur[bi], by = cur[bi + 1]
      next[w++] = ax * 0.75 + bx * 0.25; next[w++] = ay * 0.75 + by * 0.25
      next[w++] = ax * 0.25 + bx * 0.75; next[w++] = ay * 0.25 + by * 0.75
    }
    if (closed) { next[w++] = next[0]; next[w++] = next[1] }
    else { next[w++] = cur[2 * (m - 1)]; next[w++] = cur[2 * (m - 1) + 1] }
    cur = next.subarray(0, w)

    // Thin between passes, not just at the end. Each pass doubles the point
    // count, so 4 passes on a 444k-segment contour set builds 7.1M points only
    // to discard 97% of them afterwards. Culling as we go keeps every subsequent
    // pass small; the dropped points were already within tolerance of the kept
    // ones, so the curve is unchanged.
    if (interEps > 0 && it < iterations - 1) {
      const other = cur.buffer === _smA.buffer ? _smB : _smA
      cur = simplifyFlat(cur, interEps, other)
    }
  }
  return cur
}

// Given one contour level's chains (grid coords), returns flat world-space segments
// [x0,y,z0, x1,y,z1, ...] that bridge open chain endpoints sitting on the grid
// border — walking the border between them and inserting any corners — so the level
// closes into rings. Only the bridges are returned; the chains themselves are
// emitted (and optionally smoothed) by the caller, so smoothing and ring-closing
// compose cleanly.
function borderCloseSegments(chains, rows, cols, scl, halfW, halfH, elev) {
  const toWorld = (c, r) => [c * scl - halfW, r * scl - halfH]
  const result = []

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
    if (chain.closed) continue // already a ring
    const pts = chain.pts, last = pts.length - 2
    const hc = pts[0], hr = pts[1], tc = pts[last], tr = pts[last + 1]
    if (onBorder(hc, hr)) bpts.push({ c: hc, r: hr, pos: borderPos(hc, hr) })
    if (onBorder(tc, tr)) bpts.push({ c: tc, r: tr, pos: borderPos(tc, tr) })
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

  // elevScale reaches exactly 0 in one drag (it is baseElevScale plus a signed
  // offset whose slider steps by 0.1), and the terrain is then a flat plane with
  // no contours to draw. Return that answer deliberately: falling through would
  // divide by zero into levelVal = 0/0 = NaN and lvlStep = Infinity, which makes
  // the caller's `for (k = kLo; k <= kHi; k++)` bound NaN and skip silently — the
  // same empty output, arrived at by accident and impossible to debug.
  if (!elevScale) {
    return { step, numSteps: 0, levelElev: EMPTY_F64, levelVal: EMPTY_F64,
             levelActive: EMPTY_U8, levelRgb: EMPTY_F32, lvlStep: 0 }
  }

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
// …and their grid-edge ids, used to chain segments without stringifying coords.
const _edgeId = new Int32Array(4)

// Flatness tolerance for post-smoothing decimation, in grid units. Well under a
// screen pixel at any usual zoom — see simplifyFlat().
const SMOOTH_SIMPLIFY_EPS = 0.02

function buildContours(terrain, p, interval, majorInterval, majorOffset, closeRings, smoothing) {
  if (p.tanakaContours) return buildContoursTanaka(terrain, p, interval)
  const { grid, gridMask, rows, cols, scl, halfW, halfH } = terrain
  const smooth = Math.max(0, Math.min(4, Math.round(smoothing ?? 0)))
  // Smoothing and ring-closing both need the per-level segments chained into
  // polylines first, so they share the post-scan path.
  const needsChains = closeRings || smooth > 0

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

  // When chaining is needed, raw grid-space segments are collected per level and
  // chained/smoothed/closed after the scan; otherwise they emit directly (fast path).
  //
  // EDGE IDS — every marching-squares crossing lies on one grid edge, and two
  // adjacent cells compute a shared edge's crossing from the same corner pair,
  // so an integer id identifies a junction exactly:
  //   horizontal edge, row r between cols c and c+1 → 2·(r·cols + c)
  //   vertical   edge, col c between rows r and r+1 → 2·(r·cols + c) + 1
  // Cell (r,c)'s bottom is (r+1,c)'s top, and its right is (r,c+1)'s left, so
  // neighbours agree on the id without any coordinate comparison.
  const levelSegE  = needsChains ? new Array(numSteps).fill(null) : null
  const levelSegXY = needsChains ? new Array(numSteps).fill(null) : null
  const lvl0 = numSteps > 0 ? levelVal[0] : 0
  const ex = _edgeX, ey = _edgeY, eid = _edgeId

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

        if (needsChains) {
          const base = (row0 + c) * 2
          eid[0] = base                    // top    → H(r,   c)
          eid[1] = (row0 + c + 1) * 2 + 1  // right  → V(r,   c+1)
          eid[2] = (row1 + c) * 2          // bottom → H(r+1, c)
          eid[3] = base + 1                // left   → V(r,   c)
        }

        const pairs = MARCHING_TABLE[idx]
        for (let pi = 0; pi < pairs.length; pi += 2) {
          const e0 = pairs[pi], e1 = pairs[pi + 1]
          if (needsChains) {
            (levelSegE[k]  ??= new I32List()).push2(eid[e0], eid[e1])
            ;(levelSegXY[k] ??= new F64List()).push4(ex[e0], ey[e0], ex[e1], ey[e1])
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

  // Post-scan: chain each level into polylines, optionally Chaikin-smooth them into
  // soft "form lines", and optionally add border-bridging segments to close rings.
  if (needsChains) {
    // Ids run to 2·rows·cols; one shared scratch serves every level.
    const scratch = getChainScratch(rows * cols * 2)
    for (let k = 0; k < numSteps; k++) {
      const segE = levelSegE[k]
      if (!segE || segE.length === 0) continue
      const chains = chainLevelSegments(segE.a, levelSegXY[k].a, segE.length / 2, scratch)
      const isMajor = levelMajor[k] === 1
      const tp = isMajor ? majorPos : minorPos
      const tc = isMajor ? majorCol : minorCol
      const y = levelElev[k]
      const cr = levelRgb[k * 3], cg = levelRgb[k * 3 + 1], cb = levelRgb[k * 3 + 2]

      for (const chain of chains) {
        // Decimation only pays after smoothing: raw marching-squares points are
        // already minimal (one per grid-edge crossing), so there is nothing
        // collinear to drop and the sweep would be pure overhead.
        //
        // Two-level decimation: cheap O(n) thinning between passes, bounded by a
        // fraction of the tolerance so the shifts cannot compound past it, then
        // one Douglas–Peucker pass at full tolerance to reach the point count the
        // curve actually needs.
        const pts = smooth > 0
          ? simplifyFlat(
              chaikinSmoothFlat(chain.pts, chain.closed, smooth, SMOOTH_SIMPLIFY_EPS / smooth),
              SMOOTH_SIMPLIFY_EPS,
            )
          : chain.pts
        const np = pts.length / 2
        for (let i = 0; i < np - 1; i++) {
          const j = i * 2
          tp.push6(pts[j]     * scl - halfW, y, pts[j + 1] * scl - halfH,
                   pts[j + 2] * scl - halfW, y, pts[j + 3] * scl - halfH)
          tc.push6(cr, cg, cb, cr, cg, cb)
        }
      }

      if (closeRings) {
        const bridges = borderCloseSegments(chains, rows, cols, scl, halfW, halfH, y)
        for (let j = 0; j < bridges.length; j += 6) {
          tp.push6(bridges[j], bridges[j+1], bridges[j+2], bridges[j+3], bridges[j+4], bridges[j+5])
          tc.push6(cr, cg, cb, cr, cg, cb)
        }
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
  const seedStep = Math.max(1, (spacing ?? 10) / scl), n = rows*cols, mask = new Uint8Array(n), eps = 0.5
  const positions = new F32List(), colors = new F32List()
  const seeds = []
  for (let rf = 0; rf < rows; rf += seedStep) {
    const r = Math.min(rows - 1, Math.round(rf))
    for (let cf = 0; cf < cols; cf += seedStep) {
      const c = Math.min(cols - 1, Math.round(cf))
      if (gridMask[r*cols+c]) seeds.push(r*cols+c)
    }
  }
  seeds.sort((a, b) => grid[b] - grid[a])
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
          positions.push6(fc*scl-halfW, e0, fr*scl-halfH, nfc*scl-halfW, e1, nfr*scl-halfH)
          const col0 = computeVertexColor(normElev(e0, minZ, maxZ), Math.min(1, mag/(maxSlope||0.02)), Math.atan2(gz, gx), p)
          colors.pushRgb2(col0)
        } else if (!(inElevCut(e0, minZ, maxZ, elevMinCut, elevMaxCut) || inElevCut(e1, minZ, maxZ, elevMinCut, elevMaxCut))) break
        fr=nfr; fc=nfc; b0=b1; e0=e1
      }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Curvature engraving ─────────────────────────────────────────────────

/**
 * Bilinear sample of a principal-direction field, sign-aligned to a reference.
 *
 * Principal directions are a *line* field, not a vector field: ±v describe the
 * same direction, and neighbouring cells are free to disagree on sign. Plain
 * bilinear interpolation of such a field cancels to zero wherever neighbours
 * happen to be anti-aligned, which shreds a streamline into noise. Each corner
 * is therefore flipped to agree with `refX/refY` (the previous step's heading)
 * before being blended.
 */
function sampleDirAligned(dirX, dirY, rows, cols, fr, fc, refX, refY) {
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(fr)))
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(fc)))
  const r1 = Math.min(rows - 1, r0 + 1), c1 = Math.min(cols - 1, c0 + 1)
  const dr = fr - r0, dc = fc - c0
  let x = 0, y = 0
  for (let k = 0; k < 4; k++) {
    const rr = k < 2 ? r0 : r1, cc = (k & 1) ? c1 : c0
    const w = (k < 2 ? 1 - dr : dr) * ((k & 1) ? dc : 1 - dc)
    if (w === 0) continue
    const i = rr * cols + cc
    let vx = dirX[i], vy = dirY[i]
    if (vx * refX + vy * refY < 0) { vx = -vx; vy = -vy }
    x += vx * w; y += vy * w
  }
  const m = Math.hypot(x, y)
  return m < 1e-9 ? null : [x / m, y / m]
}

/**
 * Copperplate-style engraving that follows the *form* rather than the light.
 *
 * Mode: Engraving hatches by illumination — stroke density tracks how lit a
 * cell is. This instead traces streamlines through the principal-curvature
 * direction field, so the strokes themselves wrap around the shape the way a
 * burin follows a surface. The Hessian
 *
 *     H = [[h_xx, h_xy], [h_xy, h_yy]]
 *
 * has eigenvalues λ = (tr ± √(tr² − 4·det)) / 2; its eigenvectors are the
 * principal directions. Hatching across the form (`max`, the default) runs
 * along the direction of greatest bending — lines wrap a ridge like hoops round
 * a barrel. Hatching along the form (`min`) runs down the flattest direction,
 * combing out along ridges and valleys instead.
 *
 * Spacing uses Jobard–Lefebvre style occupancy: each streamline claims a disc
 * of cells as it advances and stops on reaching another line's territory, which
 * gives evenly separated strokes instead of the clumping a fixed seed grid
 * produces.
 */
function buildCurvature(terrain, p, spacing, length, threshold, radius, dirMode, stepLen) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p

  const positions = new F32List(), colors = new F32List()
  if (rows < 5 || cols < 5) return { positions: positions.toArray(), colors: colors.toArray() }

  // Second derivatives are noise amplifiers; pre-smooth before differencing.
  const sm = boxBlur(grid, cols, rows, Math.max(0, radius ?? 1))
  const n = rows * cols
  const dirX = new Float32Array(n), dirY = new Float32Array(n)
  const strength = new Float32Array(n)
  const wantMax = (dirMode ?? 'max') !== 'min'
  let maxStrength = 0

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const hxx = sm[i + 1] + sm[i - 1] - 2 * sm[i]
      const hyy = sm[i + cols] + sm[i - cols] - 2 * sm[i]
      const hxy = (sm[i + cols + 1] - sm[i + cols - 1] - sm[i - cols + 1] + sm[i - cols - 1]) / 4

      const tr = hxx + hyy
      const det = hxx * hyy - hxy * hxy
      const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det))
      const lo = (tr - disc) / 2, hi = (tr + disc) / 2
      // "Max"/"min" are by magnitude: the strongest and weakest bending,
      // regardless of whether the surface curves up or down there.
      const lam = wantMax
        ? (Math.abs(hi) >= Math.abs(lo) ? hi : lo)
        : (Math.abs(hi) <  Math.abs(lo) ? hi : lo)

      // Eigenvector of [[hxx,hxy],[hxy,hyy]] for lam. Both rows give it; pick
      // the better-conditioned one so near-diagonal Hessians stay stable.
      let vx, vy
      if (Math.abs(hxy) > 1e-12) {
        if (Math.abs(lam - hxx) >= Math.abs(lam - hyy)) { vx = hxy; vy = lam - hxx }
        else                                            { vx = lam - hyy; vy = hxy }
      } else {
        // Diagonal Hessian: principal directions are the axes.
        const alongX = Math.abs(hxx - lam) < Math.abs(hyy - lam)
        vx = alongX ? 1 : 0; vy = alongX ? 0 : 1
      }
      const m = Math.hypot(vx, vy)
      if (m < 1e-12) continue
      dirX[i] = vx / m; dirY[i] = vy / m
      // Strength asks "does the surface bend here at all", so it is always the
      // dominant curvature — never the eigenvalue we happened to pick a
      // direction from. Along-form hatching selects the *weakest* curvature,
      // which on a ridge is identically zero: keying the threshold to that
      // suppressed the mode everywhere it is most meaningful.
      const s = Math.max(Math.abs(hi), Math.abs(lo))
      strength[i] = s
      if (s > maxStrength) maxStrength = s
    }
  }
  if (maxStrength <= 0) return { positions: positions.toArray(), colors: colors.toArray() }

  const minStrength = (threshold ?? 0.15) * maxStrength
  const sep = Math.max(0.75, (spacing ?? 4) / scl)
  const sepCells = Math.max(1, Math.round(sep))
  const stepSize = Math.max(0.25, stepLen ?? 1)
  const maxSteps = Math.max(2, Math.round(length ?? 60))
  const owner = new Int32Array(n)      // 0 = free, else the claiming streamline id
  const eps = 0.5
  // Seeds sit `sepCells` apart but a line only blocks its neighbours within
  // half that. Claiming the full separation makes adjacent seeds collide on
  // their first step, chopping every stroke into a stub.
  const claimCells = Math.max(1, Math.round(sepCells / 2))

  const claim = (fr, fc, id) => {
    const r0 = Math.max(0, Math.round(fr) - claimCells), r1 = Math.min(rows - 1, Math.round(fr) + claimCells)
    const c0 = Math.max(0, Math.round(fc) - claimCells), c1 = Math.min(cols - 1, Math.round(fc) + claimCells)
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c
        if (owner[i] === 0) owner[i] = id
      }
    }
  }

  // Seed on a grid at the separation pitch, strongest curvature first so the
  // most structurally meaningful strokes claim their territory before filler.
  const seeds = []
  for (let r = 1; r < rows - 1; r += sepCells) {
    for (let c = 1; c < cols - 1; c += sepCells) {
      const i = r * cols + c
      if (gridMask[i] && strength[i] >= minStrength) seeds.push(i)
    }
  }
  seeds.sort((a, b) => strength[b] - strength[a])

  let id = 0
  for (const seed of seeds) {
    if (owner[seed] !== 0) continue
    id++
    const sr = Math.floor(seed / cols), sc = seed % cols

    // Trace outward from the seed in both senses of the (unoriented) direction.
    for (let dir = 0; dir < 2; dir++) {
      let fr = sr, fc = sc
      let hx = dirX[seed] * (dir ? -1 : 1), hy = dirY[seed] * (dir ? -1 : 1)
      let e0 = cellElev(grid, sr, sc, cols, elevScale, jitterAmt)

      for (let s = 0; s < maxSteps; s++) {
        if (fr < eps || fr > rows - 1 - eps || fc < eps || fc > cols - 1 - eps) break
        const d = sampleDirAligned(dirX, dirY, rows, cols, fr, fc, hx, hy)
        if (!d) break
        hx = d[0]; hy = d[1]

        const nfc = fc + hx * stepSize, nfr = fr + hy * stepSize
        if (nfr < eps || nfr > rows - 1 - eps || nfc < eps || nfc > cols - 1 - eps) break
        const ni = Math.round(nfr) * cols + Math.round(nfc)
        if (!gridMask[ni] || strength[ni] < minStrength) break
        if (owner[ni] !== 0 && owner[ni] !== id) break

        const e1 = cellElev(grid, Math.round(nfr), Math.round(nfc), cols, elevScale, jitterAmt)
        if (inElevCut(e0, minZ, maxZ, elevMinCut, elevMaxCut) &&
            inElevCut(e1, minZ, maxZ, elevMinCut, elevMaxCut)) {
          positions.push6(fc * scl - halfW, e0, fr * scl - halfH,
                          nfc * scl - halfW, e1, nfr * scl - halfH)
          const gi = Math.round(fr) * cols + Math.round(fc)
          colors.pushRgb2(computeVertexColor(
            normElev(e0, minZ, maxZ),
            Math.min(1, gridSlopes[gi] / (maxSlope || 1)),
            Math.atan2(hy, hx), p))
        }
        claim(nfr, nfc, id)
        fr = nfr; fc = nfc; e0 = e1
      }
    }
    claim(sr, sc, id)
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
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

/**
 * Vertex normals for the surface mesh, computed in the worker so the main
 * thread never runs three.js computeVertexNormals() over megavertex meshes.
 * Same semantics as three.js: area-weighted face-normal accumulation
 * (n = (C−B) × (A−B) per triangle), then per-vertex normalization; vertices
 * referenced by no triangle (masked NoData cells) keep a zero normal.
 */
function computeSurfaceNormals(positions, indices) {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3
    const abx = positions[a]     - positions[b],
          aby = positions[a + 1] - positions[b + 1],
          abz = positions[a + 2] - positions[b + 2]
    const cbx = positions[c]     - positions[b],
          cby = positions[c + 1] - positions[b + 1],
          cbz = positions[c + 2] - positions[b + 2]
    const nx = cby * abz - cbz * aby
    const ny = cbz * abx - cbx * abz
    const nz = cbx * aby - cby * abx
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i], y = normals[i + 1], z = normals[i + 2]
    const len = Math.sqrt(x * x + y * y + z * z) || 1
    normals[i] = x / len; normals[i + 1] = y / len; normals[i + 2] = z / len
  }
  return normals
}

/** Grid UVs for the base octant; mirrored octants keep (0,0) — the shader
 *  passes that only sample UVs (texture overlay, cast shadows, SVF) are
 *  meaningful on the primary terrain, matching the previous main-thread build. */
function buildSurfaceUvs(vertexCount, rows, cols) {
  const uvs = new Float32Array(vertexCount * 2)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      uvs[i * 2]     = c / (cols - 1)
      uvs[i * 2 + 1] = 1 - r / (rows - 1)
    }
  }
  return uvs
}

export function buildSurfaceGeometry(terrain, p) {
  // minB/maxB ride along in the metadata rather than being recomputed on the
  // main thread: buildTerrain already has them over the *valid* cells, and a
  // scan of `brightnessBuf` could not tell a genuine 0 from a NoData vertex.
  const { grid, gridMask, rows, cols, scl, halfW, halfH, elevScale, minB, maxB } = terrain
  const { jitterAmt } = p
  // Normals and UVs feed the terrain shader only. STL export derives its own
  // facet normals and SVG export needs just positions/indices, so when nothing
  // shades the surface both are skipped — they are the bulk of this builder.
  // `needsSurfaceShading` is a worker dependency, so turning a fill layer on
  // triggers one rebuild that fills them back in.
  const shade = p.needsSurfaceShading !== false
  const NO_F32 = new Float32Array(0)
  const vertexCount = rows * cols
  const basePos = new Float32Array(vertexCount * 3), baseBright = new Float32Array(vertexCount)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { basePos[i*3]=c*scl-halfW; basePos[i*3+1]=NODATA_SENTINEL_Y; basePos[i*3+2]=r*scl-halfH; baseBright[i]=0 }
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
  if (!quadCount) return { positions: new Float32Array(0), brightnessBuf: new Float32Array(0), indices: new Uint32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), metadata: { rows, cols, minB, maxB } }
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
    return {
      positions: basePos, brightnessBuf: baseBright, indices: baseIndices,
      normals: shade ? computeSurfaceNormals(basePos, baseIndices) : NO_F32,
      uvs: shade ? buildSurfaceUvs(vertexCount, rows, cols) : NO_F32,
      metadata: { rows, cols, minB, maxB },
    }
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
  return {
    positions: finalPos, brightnessBuf: finalBright, indices: finalIndices,
    normals: shade ? computeSurfaceNormals(finalPos, finalIndices) : NO_F32,
    uvs: shade ? buildSurfaceUvs(vertexCount * nOct, rows, cols) : NO_F32,
    metadata: { rows, cols, minB, maxB },
  }
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
