/**
 * CPU-side geometry builders.
 */

import { cellElev, hasData, boxBlur, jitterNoise, sampleBilinear, NODATA_SENTINEL_Y } from './terrain'
import { hexToRgb, computeVertexColor } from './colorUtils'
import { isVectorLayerId } from './vectorLayers'

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
  // Vector layers carry their style on their own record instead of in flat
  // `<prop><Id>` params, and they carry `color` here too — their geometry has no
  // per-vertex colour buffer at all, so recolouring one is a material update
  // rather than a worker rebuild. That is what makes a list of twenty OSM layers
  // feel like a layer panel instead of a queue of rebuilds.
  if (isVectorLayerId(id)) {
    // Geometry drawn *from* a layer is styled with it, so `vec:7#icons` and
    // `vec:7#labels` both resolve back to `vec:7`.
    const [base, kind] = id.split('#')
    const l = p.vectorLayers?.find((v) => v.id === base)
    if (!l) return { weight: 1, opacity: 1, dash: 'solid' }
    // Geometry drawn *from* a layer carries its own ink, all six of it: stroke
    // colour, width and opacity, then fill colour and opacity behind the layer's
    // own on/off. A summit triangle is not the road that shares its colour, and
    // lettering is neither.
    //
    // The cascade is the whole design. Every one of these but the width is
    // `null` by default and falls back to the layer's, so a mark matches its
    // layer until it is told not to; the *fill* falls back through the mark's
    // own stroke first, so colouring an icon colours the whole icon while
    // parting its fill from its outline stays possible and stays deliberate.
    if (kind === 'icons' || kind === 'labels') {
      // `p` is the params object in this function; the prefix needs its own name.
      const mark = kind === 'icons' ? 'icon' : 'label'
      const color = l[`${mark}Color`] ?? l.color
      const opacity = l[`${mark}Opacity`] ?? l.opacity
      return {
        weight: l[`${mark}Weight`] ?? l.weight,
        opacity, dash: l.dash, color,
        fillColor: l[`${mark}FillColor`] ?? color,
        fillOpacity: l[`${mark}FillOpacity`] ?? opacity,
        // Not a width: it says where the stroke sits relative to the filled
        // shape's edge, and only the viewport can act on it. The SVG export
        // reads `weight` and is right to — a plotter draws one pass along the
        // outline whichever side of it the screen puts the ink on.
        strokeOutside: !!l[`${mark}StrokeOutside`],
        name: `${l.name} · ${kind}`,
      }
    }

    return {
      weight: l.weight,
      opacity: l.opacity, dash: l.dash, color: l.color,
      fillColor: l.fillColor, fillOpacity: l.fillOpacity,
      // Carried so the SVG's Inkscape layer is called "Roads · Motorway"
      // rather than "vec:12" — the name is what makes a plot separable by pen,
      // and "Peaks · labels" is what makes the lettering its own pen.
      name: kind ? `${l.name} · ${kind}` : l.name,
    }
  }

  switch (id) {
    case 'Contours-Minor':
      return { weight: p.weightContours, opacity: p.opacityContours, dash: p.dashContours }
    case 'Contours-Major':
      return { weight: p.majorWeightContours, opacity: p.opacityContours, dash: p.dashContours }
    case 'Contours-Tanaka-Bright':
      return { weight: p.tanakaWeightBright ?? 2.5, opacity: p.opacityContours, dash: p.dashContours }
    case 'Contours-Tanaka-Dark':
      return { weight: p.tanakaWeightDark ?? 0.5, opacity: p.opacityContours, dash: p.dashContours }
    case 'Contours-Labels':
      // Always solid: a dashed numeral is not a numeral.
      return { weight: p.labelWeightContours ?? 1, opacity: p.opacityContours, dash: 'solid' }
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
export class F32List {
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

export class U32List {
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

/**
 * Neighbour tap for a finite-difference stencil, NoData-aware.
 *
 * `field[i]` is 0 wherever the grid has no data, and 0 is not "absent" — it is
 * the darkest possible ground, so a difference taken against it is the steepest
 * step anywhere on the terrain. Every derivative-based mode therefore used to
 * find its strongest feature exactly along the border of a clipped selection and
 * trace that outline instead of the landscape. Returning the centre value
 * instead reads the missing side as flat, which is the convention `buildTerrain`
 * already uses for slopes and `buildEngraving` for its shading normals.
 */
function neighbour(field, gridMask, i, o) {
  return gridMask[i + o] ? field[i + o] : field[i]
}

function normElev(elev, minElev, maxElev) {
  return maxElev > minElev ? (elev - minElev) / (maxElev - minElev) : 0
}

function inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut) {
  const n = normElev(elev, minElev, maxElev)
  return n >= elevMinCut / 100 && n <= elevMaxCut / 100
}


// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Returns an ARRAY of layers, each with its own geometry and styling.
 */
export function buildLineGeometry(terrain, p) {
  if (!terrain) return []
  
  // Maps the per-layer hypsometric params onto the generic keys
  // computeVertexColor expects. Opacity is deliberately absent: it is resolved
  // render-side by layerStyle, never baked into vertex colours, and carrying it
  // here only suggested otherwise.
  const getLayerContext = (id, baseColor) => ({
    ...p,
    lineColor:        baseColor,
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
    { id:'Iso',     builder: (t, ctx) => buildIsophotes(t, ctx, p.levelsIso, p.sunAzimuthIso, p.gammaIso, p.smoothingIso, p.radiusIso) },
  ]

  const finalLayers = []

  const mX = [p.showMirrorPlusX ? 1 : null, p.showMirrorMinusX ? -1 : null].filter(v => v !== null)
  const mY = [p.showMirrorPlusY ? 1 : null, p.showMirrorMinusY ? -1 : null].filter(v => v !== null)
  const mZ = [p.showMirrorPlusZ ? 1 : null, p.showMirrorMinusZ ? -1 : null].filter(v => v !== null)

  for (const cfg of MODES_CONFIG) {
    if (!p[`enabled${cfg.id}`]) continue

    const ctx = getLayerContext(cfg.id, p[`color${cfg.id}`])
    
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
      // rendered content, and nothing renders below minElev except pillar shafts
      // (minElev - pillarDepth). Hanging every curtain a fixed 500 units deep
      // instead multiplied the rasterized depth-only fragment area ~10× for a
      // typical ±50-unit terrain — pure GPU fill-rate waste when zoomed in.
      const floorY = terrain.minElev
        - (p.enabledPillars ? (p.pillarDepth ?? 0) : 0)
        - Math.max(2, (terrain.maxElev - terrain.minElev) * 0.05)

      // Base curtain quads (one per non-degenerate segment) — built once, then
      // mirrored into each octant below. Written straight into pre-sized typed
      // arrays (segment count is known up front) and trimmed; this avoids the
      // millions of JS-array push() calls a dense layer would otherwise make.
      // Curtains exist only to occlude: HeightmapLines draws them when
      // depthOcclusion is on, and svgExport pushes them into its Z-buffer under
      // the same condition. With it off they were still built and shipped every
      // rebuild — ~18 MB and a 255k-iteration loop at a dense layer, for
      // geometry nothing would look at. Toggling the switch now costs one extra
      // rebuild, which is the right trade against paying for it on every drag.
      const segCount = (res.isPoints || !p.depthOcclusion) ? 0 : (baseP.length / 6) | 0
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
          // Placements for the main thread to letter. Not geometry, so it rides
          // the un-mirrored path only: a mirrored label reads backwards, and a
          // kaleidoscope of reversed numbers is not what the option is for.
          labelAnchors: res.labelAnchors ?? null,
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
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const positions = new F32List(), colors = new F32List()
  // A solid raster takes the plain bilinear path — the renormalising one costs
  // a mask read and a divide per sample, and this is the hottest loop here.
  const sMask = terrain.hasNoData ? gridMask : null

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
          // Masked bilinear: a tap straddling a clipped edge must not blend
          // against the zeros parked in NoData, or the line dives to the floor.
          const b = sampleBilinear(grid, sMask, rows, cols, fr, fc)
          ok = b === b                      // NaN ⇒ nothing to drape on
          elev = (b - 0.5) * 100 * elevScale
          if (jitterAmt > 0) elev += jitterNoise(fc, fr) * jitterAmt
          ok = ok && inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)
        }
      }
      if (ok && prevOk) {
        positions.push6(prevC * scl - halfW, prevE, prevR * scl - halfH,
                        fc * scl - halfW, elev, fr * scl - halfH)
        const i0 = Math.round(prevR) * cols + Math.round(prevC)
        const i1 = Math.round(fr) * cols + Math.round(fc)
        colors.pushRgb(computeVertexColor(normElev(prevE, minElev, maxElev), gridSlopes[i0] / (maxSlope || 1), theta, p))
        colors.pushRgb(computeVertexColor(normElev(elev, minElev, maxElev), gridSlopes[i1] / (maxSlope || 1), theta, p))
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

/**
 * Slope ticks — one stroke per sampled cell, length proportional to steepness.
 *
 * The stroke runs *across* the gradient (perpendicular to `∇H`, so tangent to
 * the contour through that cell) and is centred on it, which makes the field
 * read as stacked contour fragments thickening where the ground steepens —
 * rather than as the downslope hachures the name suggests.
 *
 * Cells flatter than a small fixed epsilon emit nothing, so flats stay blank
 * instead of filling with sub-pixel ticks of arbitrary direction.
 */
function buildHachure(terrain, p, spacing, length) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const lineStep = Math.max(1, Math.round((spacing ?? 4) / scl))
  const positions = new F32List(), colors = new F32List()

  for (let r = 0; r < rows; r += lineStep) {
    for (let c = 0; c < cols; c += lineStep) {
      if (!hasData(gridMask, r, c, cols)) continue
      const bC = grid[r * cols + c], elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      const bL = (c > 0 && gridMask[r * cols + c - 1]) ? grid[r * cols + c - 1] : bC
      const bR = (c < cols - 1 && gridMask[r * cols + c + 1]) ? grid[r * cols + c + 1] : bC
      const bU = (r > 0 && gridMask[(r - 1) * cols + c]) ? grid[(r - 1) * cols + c] : bC
      const bD = (r < rows - 1 && gridMask[(r + 1) * cols + c]) ? grid[(r + 1) * cols + c] : bC
      const gx = (bR - bL) * 50 * elevScale, gz = (bD - bU) * 50 * elevScale, mag = Math.sqrt(gx * gx + gz * gz)
      if (mag < 0.005) continue
      const tickLen = mag * (length ?? 1) * scl, nx = -gz / mag, nz = gx / mag, wx = c * scl - halfW, wz = r * scl - halfH
      positions.push6(wx - nx * tickLen * 0.5, elev, wz - nz * tickLen * 0.5, wx + nx * tickLen * 0.5, elev, wz + nz * tickLen * 0.5)
      const col = computeVertexColor(normElev(elev, minElev, maxElev), gridSlopes[r * cols + c] / (maxSlope || 1), Math.atan2(gz, gx), p)
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
export function simplifyFlat(pts, eps, outBuf = null) {
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
  const { minElev, maxElev } = terrain
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
  const startElev = Math.ceil((minElev - 1e-7) / step) * step
  const maxElevPossible = Math.ceil(maxElev / step) * step
  const numSteps = Math.max(0, Math.floor((maxElevPossible - startElev) / step) + 1)

  const levelElev = new Float64Array(numSteps)
  const levelVal = new Float64Array(numSteps)
  const levelActive = new Uint8Array(numSteps)
  const levelRgb = new Float32Array(numSteps * 3)
  for (let i = 0; i < numSteps; i++) {
    const elev = startElev + i * step
    levelElev[i] = elev
    levelVal[i] = elev / (100 * elevScale) + 0.5
    levelActive[i] = inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut) ? 1 : 0
    const col = computeVertexColor(normElev(elev, minElev, maxElev), 0, 0, p)
    levelRgb[i * 3] = col[0]; levelRgb[i * 3 + 1] = col[1]; levelRgb[i * 3 + 2] = col[2]
  }
  return { step, numSteps, levelElev, levelVal, levelActive, levelRgb, lvlStep: step / (100 * elevScale) }
}

/**
 * Where to letter a contour, and where to break it so the lettering fits.
 *
 * A topographic map does not print the elevation *beside* the line, it prints it
 * *in* the line: the contour stops, the number sits in the gap at the line's own
 * angle, and the contour resumes. That is what makes a sheet of nested curves
 * readable, and it is the one thing this app's contours have never done.
 *
 * Runs on the chained polyline, in grid units, and returns placements only.
 * What gets erased for them is the caller's job, and is decided against every
 * chain at the level rather than only this one — see the two passes there.
 *
 * Placement is by arclength rather than by vertex, so it does not bunch where
 * marching squares happened to emit points close together, and each candidate is
 * nudged to the straightest spot in a window around it. Straightness matters
 * because the label is set on a single baseline: on a hairpin the text would
 * float off the line it belongs to, and a reader would have to guess which curve
 * it names.
 *
 * `gap` is the room to reserve. It is an estimate — the true width is a property
 * of the font, which lives on the main thread — so it is deliberately generous:
 * a gap slightly too wide reads as air, one slightly too narrow has the contour
 * touching the digits.
 */
function placeContourLabels(pts, closed, spacing, gap) {
  const np = pts.length / 2
  if (np < 3) return null

  // Arclength at each vertex.
  const cum = new Float64Array(np)
  for (let i = 1; i < np; i++) {
    const dx = pts[i * 2] - pts[i * 2 - 2], dy = pts[i * 2 + 1] - pts[i * 2 - 1]
    cum[i] = cum[i - 1] + Math.hypot(dx, dy)
  }
  const total = cum[np - 1]
  // No room for even one label with a margin of its own width either side.
  if (total < gap * 3) return null

  /** The point and tangent at arclength `s`, by walking the cumulative table. */
  const at = (s) => {
    let lo = 0, hi = np - 1
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid }
    const seg = cum[hi] - cum[lo]
    const t = seg > 1e-9 ? (s - cum[lo]) / seg : 0
    return [pts[lo * 2] + (pts[hi * 2] - pts[lo * 2]) * t,
            pts[lo * 2 + 1] + (pts[hi * 2 + 1] - pts[lo * 2 + 1]) * t]
  }

  // How far the curve strays from the chord across the label's own span. Zero on
  // a straight stretch; large on a hairpin, where the baseline would leave the line.
  const bend = (s) => {
    const a = at(s - gap / 2), b = at(s + gap / 2)
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return Infinity
    let worst = 0
    for (let k = 1; k < 6; k++) {
      const m = at(s - gap / 2 + (gap * k) / 6)
      // Perpendicular distance from the chord.
      const d = Math.abs((m[0] - a[0]) * dy - (m[1] - a[1]) * dx) / len
      if (d > worst) worst = d
    }
    // Penalise a chord shorter than the text as well: that is a curve doubling
    // back, where the label would overhang both ends.
    return worst + Math.max(0, gap - len)
  }

  const anchors = []
  const first = closed ? gap : Math.max(gap, (total % spacing) / 2 + gap / 2)
  for (let s = first; s <= total - gap; s += spacing) {
    // Nudge to the straightest spot within a third of the spacing.
    let best = s, bestBend = bend(s)
    const win = Math.min(spacing / 3, total / 4)
    for (let d = -win; d <= win; d += win / 4) {
      const cand = s + d
      if (cand - gap / 2 < 0 || cand + gap / 2 > total) continue
      const b = bend(cand)
      if (b < bestBend) { bestBend = b; best = cand }
    }
    // Still bent past half the text height at its best: this stretch cannot hold
    // a straight baseline, so leave the contour unbroken rather than mislabel it.
    if (bestBend > gap * 0.25) continue

    const a = at(best - gap / 2), b = at(best + gap / 2), m = at(best)
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    // Upright rule: keep the text running left-to-right in +x. The scene orbits,
    // so no camera-relative rule would hold; this is the same convention a
    // north-up sheet uses.
    if (b[0] < a[0]) ang += Math.PI

    anchors.push({ c: m[0], r: m[1], angle: ang })
  }
  return anchors.length ? anchors : null
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

/**
 * Contour lines by marching squares, in one pass over the grid.
 *
 * The scan is cell-major, not level-major: each cell is visited once and emits
 * segments for whichever levels cross it, so the cost is O(cells + segments)
 * rather than O(levels × cells). At a 1-unit interval over a 1024² grid the
 * difference is two orders of magnitude.
 *
 * What happens after the scan depends on the options, and only the extra work is
 * paid for:
 *  - Plain contours ship the loose segments straight out.
 *  - **Close rings** and **smoothing** both need the segments chained into
 *    polylines first, so they share `chainLevelSegments` — which joins them by
 *    integer grid-edge identity rather than by coordinate, the rewrite that took
 *    close-contours from 312 ms to 37 ms.
 *  - Smoothing is Chaikin corner-cutting with Douglas–Peucker decimation between
 *    passes, because each pass doubles the point count and almost all of the new
 *    points sit under a pixel from the chord through their neighbours.
 *  - Closing runs *after* smoothing, so border-bridging segments stay straight
 *    against the frame instead of being rounded away from it.
 *
 * Minor and major levels are separated into two layers here rather than being
 * restyled downstream, because they differ in geometry weight, not just colour.
 *
 * Tanaka (illuminated) contours are a different enough construction that they
 * live in their own builder; this is the only place that fork is expressed.
 */
function buildContours(terrain, p, interval, majorInterval, majorOffset, closeRings, smoothing) {
  if (p.tanakaContours) return buildContoursTanaka(terrain, p, interval)
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev } = terrain
  const smooth = Math.max(0, Math.min(4, Math.round(smoothing ?? 0)))
  // Smoothing and ring-closing both need the per-level segments chained into
  // polylines first, so they share the post-scan path.
  // Labels are placed along a *stroke*, so the raw scan-order segments have to be
  // chained first — the same reason smoothing and ring-closing need it.
  const wantLabels = !!p.labelContours
  const needsChains = closeRings || smooth > 0 || wantLabels

  const minorPos = new F32List(), minorCol = new F32List()
  const majorPos = new F32List(), majorCol = new F32List()

  const { numSteps, levelElev, levelVal, levelActive, levelRgb, lvlStep } =
    prepareContourLevels(terrain, p, interval)

  // Room to reserve for the digits, in grid units. The true width belongs to the
  // font and the font lives on the main thread, so this is an estimate from the
  // character count at a generous advance — see `placeContourLabels`.
  const labelEm = (p.labelSizeContours ?? 9) / scl
  const labelSpacingGrid = Math.max(labelEm * 4, (p.labelSpacingContours ?? 140) / scl)
  const labelAnchors = wantLabels ? [] : null
  /*
   * What the label says, and how much room it needs.
   *
   * The digits are decided here only to size the gap; the main thread formats
   * the text it actually letters, because turning a level into metres needs the
   * raster's real elevation range and that never reaches the worker. Both use
   * the same rounding, so the gap matches the number that lands in it.
   */
  const levelText = (k) => String(Math.round(levelElev[k] - minElev))
  // Clearance either side of the digits, in world units like Size and Spacing.
  // Explicit rather than the fudge factor it replaces: how much air a label
  // wants is a matter of taste and of pen width, not something to hard-code.
  const labelPadGrid = Math.max(0, p.labelPadContours ?? 4) / scl
  const labelGapFor = (text) => text.length * 0.62 * labelEm + 2 * labelPadGrid
  /*
   * Half the height of the digits, plus the same clearance the sides get.
   *
   * Nominal, like the width: cap height is a property of the font, and the font
   * is on the main thread. 0.36 em is a little over half the cap height of every
   * face here, which is the right way to be wrong — the box is used to reject
   * placements, so erring tall only moves a label along the contour.
   */
  const labelHalfHeightGrid = 0.36 * labelEm + labelPadGrid

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

      /*
       * Two passes, because a label has to mask every line at its level — not
       * just the one it sits on.
       *
       * Cutting by arclength along the label's own chain is what the first
       * version did, and it leaves two gaps. A contour that hairpins comes back
       * within a few units of the digits while being a long way off along the
       * curve, so nothing removed it; and a *different* chain at the same level
       * — the far side of a narrow ridge, the next ring in a tight nest — was
       * never considered at all. Measured on the reference terrain, 14 of 182
       * labels had a contour drawn straight through them.
       *
       * So placements are collected first, and then every segment at this level
       * is tested against every label box. That subsumes the arclength cut (the
       * box *is* the gap), and it is what a printed sheet does: the number masks
       * whatever lies under it, wherever it came from.
       */
      const prepared = []
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
        prepared.push({ pts, closed: chain.closed })
      }

      // Which levels get lettered. Labelling every minor contour is a page of
      // numbers with a drawing behind it, so the default is the index contours
      // only — which is what a printed sheet does.
      const boxes = []
      if (wantLabels && (isMajor || !(p.labelMajorOnlyContours ?? true))) {
        const gap = labelGapFor(levelText(k))
        for (const c of prepared) {
          const placed = placeContourLabels(c.pts, c.closed, labelSpacingGrid, gap)
          if (!placed) continue
          for (const a of placed) {
            boxes.push({ c: a.c, r: a.r, ca: Math.cos(a.angle), sa: Math.sin(a.angle),
                         halfW: gap / 2, halfH: labelHalfHeightGrid })
            labelAnchors.push({ x: a.c * scl - halfW, z: a.r * scl - halfH,
                                y, angle: a.angle, v: levelVal[k],
                                // Height above the lowest ground, for a raster
                                // with no elevation of its own to report.
                                rel: levelElev[k] - minElev })
          }
        }
      }

      /**
       * Is any of this segment under a label?
       *
       * Endpoints and midpoint, not a full clip. Segments here are about one
       * grid edge long against a box several ems wide, so a segment crossing
       * without any of the three landing inside would have to be longer than the
       * box — and erring toward cutting is the safe direction anyway.
       */
      const masked = (x0, y0, x1, y1) => {
        for (const b of boxes) {
          for (let t = 0; t <= 2; t++) {
            const px = x0 + (x1 - x0) * t / 2, py = y0 + (y1 - y0) * t / 2
            const dx = px - b.c, dy = py - b.r
            if (Math.abs(dx * b.ca + dy * b.sa) <= b.halfW &&
                Math.abs(-dx * b.sa + dy * b.ca) <= b.halfH) return true
          }
        }
        return false
      }

      for (const { pts } of prepared) {
        const np = pts.length / 2
        for (let i = 0; i < np - 1; i++) {
          const j = i * 2
          if (boxes.length && masked(pts[j], pts[j + 1], pts[j + 2], pts[j + 3])) continue
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
    // The anchors ride with the major layer because that is what they label by
    // default. They are placements, not geometry: the main thread letters them,
    // since neither the fonts nor the raster's metre range exist in here.
    'Contours-Major': { positions: majorPos.toArray(), colors: majorCol.toArray(),
                        labelAnchors: labelAnchors?.length ? labelAnchors : null },
  }
}
const MARCHING_TABLE = { 1:[3,2], 2:[2,1], 3:[3,1], 4:[0,1], 5:[0,3,2,1], 6:[0,2], 7:[0,3], 8:[0,3], 9:[0,2], 10:[0,1,2,3], 11:[0,1], 12:[3,1], 13:[2,1], 14:[3,2] }

/**
 * Illuminated ("Tanaka") contours — the same level set, lit rather than uniform.
 *
 * Every segment is sorted into a bright or dark half by the sign of the sun
 * direction dotted with the surface gradient at its midpoint: a contour crossing
 * ground that tilts toward the light goes bright, one on ground tilting away
 * goes dark. Relief then reads from the contour lines alone, with no surface
 * shading underneath — which is the point of the technique on a line plot.
 *
 * The two halves are emitted as separate sub-layers rather than one layer with
 * per-vertex colour because what distinguishes them is stroke *weight*
 * (`tanakaWeightBright` / `tanakaWeightDark`), and weight is resolved per layer
 * at render time, not baked into geometry. Both halves carry the same
 * hypsometric colour for their level; the contrast comes from weight and from
 * whatever per-layer colours are set.
 */
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

/**
 * Streamlines traced down the gradient field — the path water would take.
 *
 * Each seed is integrated downhill in fixed-length steps rather than jumping
 * cell to cell, so a line crosses the grid diagonally instead of staircasing
 * along it; the field is sampled bilinearly between cells for the same reason.
 *
 * Two rules keep the field legible rather than a tangle:
 *  - **Seeds run highest first.** Peaks are where the drainage pattern is
 *    legible, so they get to claim their lines before lower ground does.
 *  - **A trace stops on reaching ground another trace already covered.** Every
 *    streamline in a basin converges on the same outlet, so without this they
 *    would all overdraw the same channel; each cell belongs to the first line
 *    through it.
 *
 * A trace also ends at `maxLen`, at the grid edge, or where the gradient goes
 * flat and there is no longer a direction to follow.
 */
function buildFlowLines(terrain, p, spacing, step, maxLen) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const seedStep = Math.max(1, (spacing ?? 10) / scl), n = rows*cols, mask = new Uint8Array(n), eps = 0.5
  const positions = new F32List(), colors = new F32List()
  // Solid raster ⇒ plain bilinear; see buildAngleLines.
  const sMask = terrain.hasNoData ? gridMask : null
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
    let fr = r, fc = c, e0 = (sampleBilinear(grid, sMask, rows, cols, fr, fc) - 0.5)*100*elevScale
    for (let s = 0; s < (maxLen ?? 100); s++) {
        if (fr < eps || fr > rows-1-eps || fc < eps || fc > cols-1-eps) break
        const ri = Math.round(fr), ci = Math.round(fc)
        if (!gridMask[ri*cols+ci]) break
        mask[ri*cols+ci] = 1
        // Masked taps: reading the zeros in NoData as ground would manufacture a
        // cliff along the clipped edge and send every nearby path over it.
        const bL = sampleBilinear(grid, sMask, rows, cols, fr, fc-eps), bR = sampleBilinear(grid, sMask, rows, cols, fr, fc+eps)
        const bU = sampleBilinear(grid, sMask, rows, cols, fr-eps, fc), bD = sampleBilinear(grid, sMask, rows, cols, fr+eps, fc)
        const gx = bR-bL, gz = bD-bU, mag = Math.sqrt(gx*gx+gz*gz)
        if (!(mag >= 0.0005)) break      // also ends the path on a NaN tap
        const nfc = fc-(gx/mag)*(step??1), nfr = fr-(gz/mag)*(step??1)
        if (mask[Math.round(nfr)*cols+Math.round(nfc)] || !gridMask[Math.round(nfr)*cols+Math.round(nfc)]) break
        const b1 = sampleBilinear(grid, sMask, rows, cols, nfr, nfc), e1 = (b1-0.5)*100*elevScale
        if (e1 !== e1) break
        if (inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut) && inElevCut(e1, minElev, maxElev, elevMinCut, elevMaxCut)) {
          positions.push6(fc*scl-halfW, e0, fr*scl-halfH, nfc*scl-halfW, e1, nfr*scl-halfH)
          const col0 = computeVertexColor(normElev(e0, minElev, maxElev), Math.min(1, mag/(maxSlope||0.02)), Math.atan2(gz, gx), p)
          colors.pushRgb2(col0)
        } else if (!(inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut) || inElevCut(e1, minElev, maxElev, elevMinCut, elevMaxCut))) break
        fr=nfr; fc=nfc; e0=e1
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
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p

  const positions = new F32List(), colors = new F32List()
  if (rows < 5 || cols < 5) return { positions: positions.toArray(), colors: colors.toArray() }

  // Second derivatives are noise amplifiers; pre-smooth before differencing.
  // Mask-aware, or the step down to the zeros in NoData would be the strongest
  // curvature on the terrain and ring the whole selection with strokes.
  const sm = boxBlur(grid, cols, rows, Math.max(0, radius ?? 1), terrain.hasNoData ? gridMask : null)
  const n = rows * cols
  const dirX = new Float32Array(n), dirY = new Float32Array(n)
  const strength = new Float32Array(n)
  const wantMax = (dirMode ?? 'max') !== 'min'
  let maxStrength = 0

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      // Stencil taps read NoData as flat, not as a cliff down to 0 — see
      // `neighbour`. Without it the boundary of a clipped selection is the
      // strongest curvature on the terrain, and it took the strokes with it.
      const hxx = neighbour(sm, gridMask, i, 1) + neighbour(sm, gridMask, i, -1) - 2 * sm[i]
      const hyy = neighbour(sm, gridMask, i, cols) + neighbour(sm, gridMask, i, -cols) - 2 * sm[i]
      const hxy = (neighbour(sm, gridMask, i, cols + 1) - neighbour(sm, gridMask, i, cols - 1)
                 - neighbour(sm, gridMask, i, -cols + 1) + neighbour(sm, gridMask, i, -cols - 1)) / 4

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
        if (inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut) &&
            inElevCut(e1, minElev, maxElev, elevMinCut, elevMaxCut)) {
          positions.push6(fc * scl - halfW, e0, fr * scl - halfH,
                          nfc * scl - halfW, e1, nfr * scl - halfH)
          const gi = Math.round(fr) * cols + Math.round(fc)
          colors.pushRgb2(computeVertexColor(
            normElev(e0, minElev, maxElev),
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

/**
 * Stream network, pruned by Strahler order.
 *
 * Every cell drains to its lowest of eight neighbours, which makes the grid a
 * directed acyclic graph — so a topological sweep (Kahn's algorithm on
 * in-degree, ridges having in-degree 0) can resolve the whole network in one
 * pass with no iteration to a fixed point.
 *
 * `threshold` is a Strahler order, not a cell count: a channel's order rises
 * only where two tributaries of *equal* order meet, and otherwise inherits the
 * highest of its inputs. That is the distinction worth having — it prunes by
 * how branched the network above a point is rather than by how much area drains
 * through it, so a long unbranched gully stays order 1 no matter how far it
 * runs, and raising the threshold strips headwaters while leaving the trunk.
 */
function buildDagThinning(terrain, p, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
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
    if (!inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut)) continue
    positions.push6(c0*scl-halfW, e0, r0*scl-halfH, c1*scl-halfW, e1, r1*scl-halfH)
    const col = computeVertexColor(normElev(e0, minElev, maxElev), gridSlopes[i]/(maxSlope||1), Math.atan2(r1-r0, c1-c0), p); colors.pushRgb2(col)
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}


// ─── Pencil Shading ───────────────────────────────────────────────────────────

/**
 * Cross-hatch marks on convex ground, sized by how sharply it bends.
 *
 * The measure is the negated discrete Laplacian, and the test is one-sided:
 * only cells above `threshold` are marked, so ridges and crests get hatching
 * while hollows of equal curvature get none. Keying on curvature rather than
 * height or illumination is what leaves both flats and uniform slopes clean —
 * only the form transitions are drawn.
 *
 * Each mark is a fixed X of two diagonals in world space, not oriented to the
 * surface; its size grows with curvature up to a cap of two grid cells. The
 * regularity is the point — it reads as a pencil texture rather than as
 * structure competing with the other modes.
 */
function buildPencilShading(terrain, p, spacing, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev } = terrain
  const { elevScale, jitterAmt, elevMinCut, elevMaxCut } = p
  const positions = new F32List(), colors = new F32List(), step = Math.max(1, Math.round((spacing ?? 4) / scl))
  const curvThreshold = threshold ?? 0.5
  for (let r = step; r < rows - step; r += step) {
    for (let c = step; c < cols - step; c += step) {
      const i = r*cols + c
      if (!gridMask[i] || r <= 0 || r >= rows-1 || c <= 0 || c >= cols-1) continue
      // The Laplacian reads NoData as flat (see `neighbour`), so a clipped edge
      // does not pack shading marks along the outline of the selection.
      const curv = -(neighbour(grid, gridMask, i, -cols) + neighbour(grid, gridMask, i, cols)
                   + neighbour(grid, gridMask, i, -1)    + neighbour(grid, gridMask, i, 1)
                   - 4*grid[i]) * 100
      if (curv < curvThreshold) continue
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      const wx = c*scl-halfW, wz = r*scl-halfH, len = Math.min(scl*2, curv*0.5), col = computeVertexColor(normElev(elev, minElev, maxElev), 0, 0, p)
      positions.push6(wx-0.7*len, elev, wz-0.7*len, wx+0.7*len, elev, wz+0.7*len)
      positions.push6(wx-0.7*len, elev, wz+0.7*len, wx+0.7*len, elev, wz-0.7*len)
      colors.pushRgb2(col); colors.pushRgb2(col)
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Ridge Lines (Differential Geometry) ──────────────────────────────────────

/**
 * Ridge crests from the Hessian's principal curvatures.
 *
 * A cell qualifies on two counts: its strongest principal curvature exceeds the
 * threshold, *and* it is a local maximum along that curvature's own direction.
 * The second test is what distinguishes a crest from a merely convex slope —
 * without it the whole flank of a hill passes.
 *
 * `radius` pre-smooths the grid, and is not optional in practice: second
 * derivatives amplify noise, so on raw data every pixel of sensor grain reads as
 * its own ridge. It doubles as the scale control — a small radius finds every
 * spur, a large one only the range.
 *
 * Compare `buildTpiFeatures`, which asks a different question: TPI measures
 * height against the neighbourhood mean, so it finds ground that *sits* high,
 * while this finds ground that is *shaped* like a crest.
 */
function buildRidgeLines(terrain, p, spacing, radius, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  
  // 1. Pre-smooth for stable second derivatives — mask-aware, so the drop to
  //    the zeros in NoData is not read as a crest along the selection edge.
  const smoothed = boxBlur(grid, cols, rows, radius, terrain.hasNoData ? gridMask : null)
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

      // Finite differences for second derivatives, reading NoData as flat (see
      // `neighbour`) so the border of a clipped selection is not the sharpest
      // crest on the terrain and drawn as a ridge in its own right.
      const hxx = neighbour(smoothed, gridMask, i, 1) + neighbour(smoothed, gridMask, i, -1) - 2*smoothed[i]
      const hyy = neighbour(smoothed, gridMask, i, cols) + neighbour(smoothed, gridMask, i, -cols) - 2*smoothed[i]
      const hxy = (neighbour(smoothed, gridMask, i, cols+1) - neighbour(smoothed, gridMask, i, cols-1)
                 - neighbour(smoothed, gridMask, i, -cols+1) + neighbour(smoothed, gridMask, i, -cols-1)) / 4

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
          
          if (inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut) && inElevCut(e1, minElev, maxElev, elevMinCut, elevMaxCut)) {
            positions.push6(c*scl-halfW, e0, r*scl-halfH, nc*scl-halfW, e1, nr*scl-halfH)
            const col = computeVertexColor(normElev(e0, minElev, maxElev), gridSlopes[i]/(maxSlope||1), 0, p)
            colors.pushRgb2(col)
          }
        }
      }
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Ridge & Valley (TPI) ────────────────────────────────────────────────────

/**
 * Ridges and valleys by Topographic Position Index.
 *
 * TPI is a cell's elevation minus the mean of its neighbourhood: strongly
 * positive on a crest, strongly negative in a hollow, near zero on a uniform
 * slope regardless of how steep that slope is. `radius` sets the neighbourhood,
 * and so the scale of landform picked out — a small radius finds every gully, a
 * large one only the major spurs.
 *
 * Ridges and valleys are the same measurement with the sign flipped, so one
 * builder serves both and `isRidge` selects which tail of the distribution is
 * kept. They are separate draw modes because they are usually styled apart.
 */
function buildTpiFeatures(terrain, p, spacing, radius, threshold, isRidge) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  
  // The neighbourhood mean is just a box blur of the grid — separable and O(n),
  // so the radius is free rather than costing a window scan per cell. It is
  // taken over the *valid* neighbours only: counting NoData as zero elevation
  // would drag the mean down near a clipped edge and make every cell there read
  // as a ridge.
  const blurred = boxBlur(grid, cols, rows, radius, terrain.hasNoData ? gridMask : null)
  
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
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      
      const wx = c * scl - halfW
      const wz = r * scl - halfH
      
      // Draw a small cross-mark centered at the feature point
      const size = Math.abs(tpi) * 50 * scl
      positions.push6(wx - size, elev, wz, wx + size, elev, wz)

      const slope = gridSlopes[i]
      const col = computeVertexColor(normElev(elev, minElev, maxElev), slope / (maxSlope || 1), 0, p)
      colors.pushRgb2(col)
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
}

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
 */
function buildPillars(terrain, p, spacing) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
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
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue

      const wx = c * scl - halfW
      const wz = r * scl - halfH
      const top    = elev - gap
      const bottom = minElev - depth
      if (top <= bottom) continue

      const slope   = gridSlopes[i]
      const colBase = computeVertexColor(normElev(bottom, minElev, maxElev), 0, 0, p)
      const colPeak = computeVertexColor(normElev(top,    minElev, maxElev), slope / (maxSlope || 1), 0, p)
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

// ─── Illumination ────────────────────────────────────────────────────────────

/**
 * Per-cell darkness: 1 − Lambert illumination, tone-curved.
 *
 * The same light convention as the hillshade shader — azimuth 315° is NW, and
 * the altitude is fixed at 45° — so a scene lit one way on screen is lit the
 * same way in every mode that hatches by light.
 *
 * NoData is `-1` rather than 0. Zero is a legitimate darkness (fully lit), so a
 * caller could not tell "bright" from "absent"; every reader here tests for the
 * negative explicitly instead.
 *
 * `radius` pre-smooths the height field before differencing it. Illumination is
 * a *derivative* of elevation, so unlike a contour it inherits every cell-scale
 * bump the terrain has and amplifies it — the same reason Ridge and Curvature
 * blur before taking their second derivatives. Engraving passes 0 and is
 * unaffected: it thresholds the field, where noise costs a ragged stroke end,
 * while Isophotes traces its level set, where noise costs a fractal.
 *
 * Shared by Engraving, which hatches where this exceeds a threshold, and
 * Isophotes, which traces its level set.
 */
function lambertDarkness(terrain, sunAzimuth, gamma, elevScale, radius = 0) {
  const { gridMask, rows, cols, scl } = terrain
  // Mask-aware, or the step down to the zeros in NoData would read as a cliff
  // and ring the whole selection with lines.
  const grid = radius > 0
    ? boxBlur(terrain.grid, cols, rows, radius, terrain.hasNoData ? gridMask : null)
    : terrain.grid
  const azRad  = ((sunAzimuth ?? 315) * Math.PI) / 180
  const altRad = Math.PI / 4
  const Lx = Math.cos(azRad) * Math.cos(altRad)
  const Ly = Math.sin(altRad)
  const Lz = Math.sin(azRad) * Math.cos(altRad)
  const dScale = (100 * elevScale) / (2 * scl)   // brightness diff → world slope
  const gam = gamma ?? 1

  const darkness = new Float32Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { darkness[i] = -1; continue }
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
  return darkness
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
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const positions = new F32List(), colors = new F32List()
  // Solid raster ⇒ plain bilinear; see buildAngleLines.
  const sMask = terrain.hasNoData ? gridMask : null

  const darkness = lambertDarkness(terrain, sunAzimuth, gamma, elevScale)

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
            // Masked bilinear — a hatch stroke reaching a clipped edge must end
            // at the ground, not drop a wall to the base of the scene.
            const b = sampleBilinear(grid, sMask, rows, cols, fr, fc)
            elev = (b - 0.5) * 100 * elevScale
            ok = b === b && inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)
          }
        }
        if (ok && inRun) {
          positions.push6(prevC * scl - halfW, prevE, prevR * scl - halfH,
                          fc * scl - halfW, elev, fr * scl - halfH)
          const ci = Math.round(fc), ri = Math.round(fr), idx = ri * cols + ci
          const col = computeVertexColor(normElev(elev, minElev, maxElev),
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

// ─── Isophotes (illumination contours) ───────────────────────────────────────

/**
 * Lines of constant illumination.
 *
 * A contour joins points of equal *height*; an isophote joins points of equal
 * *light*. They are the same construction over a different field, and they read
 * completely differently on the page: a contour describes the ground as a
 * surveyor does, in level steps, while an isophote wraps the terrain the way a
 * reflection wraps a polished object — bunching where the surface turns away
 * from the sun and opening out where it faces it. Neither Engraving nor Hachure
 * gets there: both hatch *by* the light, and this draws the light itself.
 *
 * Three differences from Contours, all of them consequences of the field:
 *
 * - **The lines are not level.** A contour sits at one elevation and can be
 *   emitted at a constant y. An isophote crosses elevations freely, so every
 *   crossing is draped onto the surface with a masked bilinear tap.
 * - **Levels are fractions of the light, not of the terrain.** Darkness runs
 *   [0,1], so the levels are evenly spaced strictly inside it — at 0 or 1 the
 *   whole field is on one side and nothing is drawn.
 * - **NoData is a hole, not a shoreline.** Contours deliberately treat a masked
 *   corner as lying below every level so isolines close along the edge of the
 *   data. That is right for a coastline and wrong here: there is no illumination
 *   where there is no ground, and an isophote drawn round the edge of a
 *   selection would be describing the selection rather than the terrain. Cells
 *   with any masked corner are skipped.
 *
 * Always chained. Marching squares emits in scan order, so consecutive segments
 * in the buffer are unrelated — chaining is what makes a stroke a stroke, and it
 * is also what lets the SVG exporter write each one as a single polyline.
 */
function buildIsophotes(terrain, p, levels, sunAzimuth, gamma, smoothing, radius) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const sMask = terrain.hasNoData ? gridMask : null
  /*
   * Up to 25 passes, though the curve stops moving long before that. Chaikin
   * converges on a quadratic B-spline and each pass halves the distance to it,
   * so on the reference terrain the total drawn length falls 16.4% from 0 to 2
   * passes and then by less than half a percent all the way to 25, while the
   * cost keeps climbing linearly — 32 ms at 4, 343 ms at 25. The range is here
   * because it was asked for; `radiusIso` is the control that actually makes a
   * line broader, because it smooths the field rather than the trace.
   */
  const smooth = Math.max(0, Math.min(25, Math.round(smoothing ?? 0)))

  const darkness = lambertDarkness(terrain, sunAzimuth, gamma, elevScale, Math.max(0, radius ?? 6))
  const nLevels = Math.max(1, Math.min(24, Math.round(levels ?? 8)))

  const positions = new F32List(), colors = new F32List()
  const ex = _edgeX, ey = _edgeY, eid = _edgeId
  const scratch = getChainScratch(rows * cols * 2)

  for (let k = 0; k < nLevels; k++) {
    const level = (k + 1) / (nLevels + 1)
    const segE = new I32List(), segXY = new F64List()

    for (let r = 0; r < rows - 1; r++) {
      const row0 = r * cols, row1 = row0 + cols
      for (let c = 0; c < cols - 1; c++) {
        const d00 = darkness[row0 + c],     d10 = darkness[row0 + c + 1]
        const d01 = darkness[row1 + c],     d11 = darkness[row1 + c + 1]
        // Any corner without ground and the cell is not part of the field.
        if (d00 < 0 || d10 < 0 || d01 < 0 || d11 < 0) continue

        const idx = (d00 >= level ? 8 : 0) | (d10 >= level ? 4 : 0) |
                    (d11 >= level ? 2 : 0) | (d01 >= level ? 1 : 0)
        if (idx === 0 || idx === 15) continue

        ex[0] = c + edgeLerp01(d00, d10, level); ey[0] = r
        ex[1] = c + 1;                           ey[1] = r + edgeLerp01(d10, d11, level)
        ex[2] = c + edgeLerp01(d01, d11, level); ey[2] = r + 1
        ex[3] = c;                               ey[3] = r + edgeLerp01(d00, d01, level)

        const base = (row0 + c) * 2
        eid[0] = base                    // top    → H(r,   c)
        eid[1] = (row0 + c + 1) * 2 + 1  // right  → V(r,   c+1)
        eid[2] = (row1 + c) * 2          // bottom → H(r+1, c)
        eid[3] = base + 1                // left   → V(r,   c)

        const pairs = MARCHING_TABLE[idx]
        for (let pi = 0; pi < pairs.length; pi += 2) {
          const e0 = pairs[pi], e1 = pairs[pi + 1]
          segE.push2(eid[e0], eid[e1])
          segXY.push4(ex[e0], ey[e0], ex[e1], ey[e1])
        }
      }
    }

    if (segE.length === 0) continue
    const chains = chainLevelSegments(segE.a, segXY.a, segE.length / 2, scratch)

    for (const chain of chains) {
      const pts = smooth > 0
        ? simplifyFlat(
            chaikinSmoothFlat(chain.pts, chain.closed, smooth, SMOOTH_SIMPLIFY_EPS / smooth),
            SMOOTH_SIMPLIFY_EPS,
          )
        : chain.pts

      /*
       * Drape as we walk, carrying the previous point so a break in the surface
       * — NoData under the tap, or a vertex outside the elevation cut — ends the
       * stroke instead of drawing a chord across the hole.
       *
       * Every step is taken in unit cells even when the path skips further.
       * Smoothing ends in a Douglas–Peucker pass, which is free to replace a
       * curve with a chord up to nineteen cells long, and that chord is
       * *horizontally* faithful but says nothing about the ground under it: the
       * two ends drape onto the surface and the segment between them cuts
       * through whatever lies in the way. Contours can decimate safely because
       * they are level and a chord stays on the line; an isophote crosses the
       * relief, so it has to be re-walked at the resolution the terrain is
       * stored at. Measured on a clipped dome: max span 18.79 cells before,
       * 1.41 — one diagonal grid edge — after.
       */
      let prevC = 0, prevR = 0, prevE = 0, inRun = false
      let lastC = 0, lastR = 0
      const step = (fc, fr) => {
        const b = sampleBilinear(grid, sMask, rows, cols, fr, fc)
        const elev = (b - 0.5) * 100 * elevScale
        const ok = b === b && inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)
        if (ok && inRun) {
          positions.push6(prevC * scl - halfW, prevE, prevR * scl - halfH,
                          fc * scl - halfW, elev, fr * scl - halfH)
          const ci = Math.min(cols - 1, Math.max(0, Math.round(fc)))
          const ri = Math.min(rows - 1, Math.max(0, Math.round(fr)))
          const col = computeVertexColor(normElev(elev, minElev, maxElev),
                                         gridSlopes[ri * cols + ci] / (maxSlope || 1), 0, p)
          colors.pushRgb2(col)
        }
        inRun = ok
        prevC = fc; prevR = fr; prevE = elev
      }

      for (let i = 0; i < pts.length; i += 2) {
        const fc = pts[i], fr = pts[i + 1]
        if (i === 0) { step(fc, fr) }
        else {
          const n = Math.max(1, Math.ceil(Math.hypot(fc - lastC, fr - lastR)))
          for (let k = 1; k <= n; k++) step(lastC + (fc - lastC) * k / n,
                                            lastR + (fr - lastR) * k / n)
        }
        lastC = fc; lastR = fr
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
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const rng = mulberry32(((p.seedSwiss ?? 42) * 2654435761 + 0x9e3779b9) >>> 0)

  const step = Math.max(1, Math.round((spacing ?? 2) / scl))
  const cliffT = Math.max(0.02, threshold ?? 0.45)
  const screeT = cliffT * 0.45                       // lower edge of the scree band
  const dens  = Math.max(0, Math.min(1, screeDensity ?? 0.5))
  const eps   = Math.max(0.001, scl * 0.003)         // stipple-style dot half-length
  const maxS  = maxSlope || 1
  // Solid raster ⇒ plain bilinear; see buildAngleLines.
  const sMask = terrain.hasNoData ? gridMask : null

  const rockPos = new F32List(), rockCol = new F32List()
  const screePos = new F32List(), screeCol = new F32List()

  for (let r = 1; r < rows - 1; r += step) {
    for (let c = 1; c < cols - 1; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const slopeNorm = gridSlopes[i] / maxS
      if (slopeNorm < screeT) continue

      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      const normE = normElev(elev, minElev, maxElev)
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
        const sx = -ux * len - uz * len * j, sz = -uz * len + ux * len * j
        // The steepest ground is exactly what a selection edge cuts through, so
        // the far end of a cliff stroke is the one most likely to land outside
        // the data — where it would drape on the NoData floor and read as a
        // pillar. Shorten it until it is back on ground; drop it if it never is.
        let ex = 0, ez = 0, e1 = NaN
        for (let f = 1; f > 0.2; f -= 0.25) {
          ex = wx + sx * f; ez = wz + sz * f
          const b1 = sampleBilinear(grid, sMask, rows, cols,
                                    Math.max(0, Math.min(rows - 1, (ez + halfH) / scl)),
                                    Math.max(0, Math.min(cols - 1, (ex + halfW) / scl)))
          if (b1 === b1) { e1 = (b1 - 0.5) * 100 * elevScale; break }
        }
        if (e1 !== e1) continue
        rockPos.push6(wx, elev, wz, ex, e1, ez)
        const col = computeVertexColor(normE, slopeNorm, Math.atan2(gz, gx), p)
        rockCol.pushRgb2(col)
      } else if (rng() < dens * ((slopeNorm - screeT) / (cliffT - screeT))) {
        // Scree dot: jittered within the cell, denser approaching the cliffs.
        const jc = c + (rng() - 0.5) * step, jr = r + (rng() - 0.5) * step
        const sx2 = jc * scl - halfW, sz2 = jr * scl - halfH
        const sb = sampleBilinear(grid, sMask, rows, cols,
                                  Math.max(0, Math.min(rows - 1, jr)),
                                  Math.max(0, Math.min(cols - 1, jc)))
        if (sb !== sb) continue          // jittered clean off the data
        const se = (sb - 0.5) * 100 * elevScale
        screePos.push6(sx2 - eps, se, sz2, sx2 + eps, se, sz2)
        const col = computeVertexColor(normElev(se, minElev, maxElev), slopeNorm, 0, p)
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

/**
 * Stipple dots, placed by rejection sampling against a density field.
 *
 * A candidate is generated per grid cell and kept with probability equal to the
 * local density, so `spacing` sets the *maximum* dot count and the field decides
 * how much of it survives. `densityMode` chooses what drives that field
 * (elevation, slope, …) and `gamma` bends it: above 1 concentrates dots into the
 * densest areas, below 1 spreads them toward an even wash.
 *
 * `jitter` displaces the candidate within its cell *before* the density is read,
 * so it moves the sample as well as the dot. At 0 the output is a visible regular
 * lattice — the grid the candidates came from — so some jitter is what makes it
 * read as stippling rather than as a halftone screen.
 *
 * Returned as `isPoints`, so the dispatcher skips occlusion curtains for it:
 * a dot has no length to hang a curtain from.
 */
function buildStipple(terrain, p, spacing, densityMode, gamma, jitter) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
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
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue

      const normE = normElev(elev, minElev, maxElev)
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

/** Grid UVs for the base octant; mirrored octants keep (0,0). The shader passes
 *  that sample UVs — texture overlay, cast shadows, AO — describe the primary
 *  terrain, and a mirrored copy has no meaningful position in that space. */
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

/**
 * The triangulated terrain surface: the fill layer, the SVG depth buffer's
 * occluder, and the mesh STL export is built from.
 *
 * Three decisions here are load-bearing and not obvious from the code:
 *
 *  - **A quad is emitted only when all four of its corners have data.** That is
 *    what makes a NoData hole a real hole rather than a stretched skin across
 *    the gap.
 *  - **Masked vertices are parked at `NODATA_SENTINEL_Y`** instead of being
 *    compacted out, which keeps vertex index == grid index and so keeps the
 *    index arithmetic trivial. Nothing references them, so the renderer never
 *    sees them — but anything walking the position array directly must skip
 *    them, and STL export once shipped a base plate 10 000 units down because
 *    it did not.
 *  - **Indices are counted in a first pass before being written.** The count is
 *    not known up front once holes are possible, and growing the buffer would
 *    mean reallocating a multi-megabyte array mid-build.
 *
 * Normals and UVs are skipped entirely when no fill layer needs them — see
 * `needsSurfaceShading`. They are the bulk of the work here.
 */
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
