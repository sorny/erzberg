/**
 * Helpers every builder family shares: typed writers, sampling, colour, masks, tracing.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { cellElev, boxBlur, sampleBilinear } from '../terrain'
import { computeVertexColor } from '../colorUtils'
import { isVectorLayerId } from '../vectorLayers'
import { isTextLayerId, textLayerName } from '../textLayers'
import { layerDisplayName } from '../drawModes'
import { ALL_CLASSES, maskHasClass } from '../coverPlate'

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
  // `showImagery` belongs here even though it is not a *fill*: the satellite
  // drape is painted by the surface shader, and with every other flag off the
  // surface is not drawn at all — so fetching imagery on bare defaults put a
  // texture on a mesh nobody could see and looked exactly like a broken fetch.
  return !!(p.showFill || p.showRawTerrain || p.showHillshade || p.showSlopeShade ||
            p.showWaterFill || p.showAO || p.showAspectMap ||
            (p.showImagery && p.imagery))
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
  // The drape samples `uImageryTex` at `vUv`, and UVs are one of the two
  // attributes this gates. Without it the whole texture collapses to a single
  // texel and the terrain comes out one flat colour.
  return !!(p.showFill || p.showHillshade || p.showSlopeShade ||
            p.showWaterFill || p.showAO || p.showAspectMap || p.profileMode ||
            (p.showImagery && p.imagery))
}

/**
 * How one layer is drawn, and what it is called.
 *
 * The name matters as much as the style: it is the `inkscape:label` on the pen
 * layer, and the only thing the person at the plotter reads to tell one pass
 * from another. Vector and text layers carry a name of their own; a draw mode's
 * comes from the registry, and is added here on the way out rather than in each
 * of the thirty branches below.
 */
export function layerStyle(id, p) {
  const st = resolveLayerStyle(id, p)
  return st.name ? st : { ...st, name: layerDisplayName(id) }
}

function resolveLayerStyle(id, p) {
  // Free text carries its ink on its own record, the way a vector layer does,
  // so recolouring one is a material update rather than a worker rebuild. It
  // never reaches the worker at all: the lettering is built on the main thread
  // because a face is fetched rather than computed.
  if (isTextLayerId(id)) {
    const t = p.textLayers?.find((l) => l.id === id)
    if (!t) return { weight: 1, opacity: 1, dash: 'solid' }
    return {
      weight: t.weight, opacity: t.opacity, dash: t.dash, color: t.color,
      fillColor: t.fillColor ?? t.color,
      fillOpacity: t.fillOpacity ?? t.opacity,
      strokeOutside: !!t.strokeOutside,
      // What the Inkscape layer is called, so a plot is separable by pen.
      // Read from the text itself rather than from a name captured when the
      // layer was made: two texts both exporting as "erzberg" because that is
      // what they said when they were added is a plot nobody can separate.
      name: textLayerName(t),
    }
  }

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

  /*
   * Pillars inked by land cover, one layer per class and half — so a plot gets
   * one pen per class. Styled by its half, and named for its class and ink,
   * the way the filled areas' pen layers carry theirs.
   */
  const pillarClass = /^Pillars(-Above)?-Class(\d+)$/.exec(id)
  if (pillarClass) {
    const suf = pillarClass[1] ? 'PillarsAbove' : 'Pillars'
    const k = Number(pillarClass[2])
    const c = p.cover?.classes?.find((x) => x.index === k)
    const cname = c?.name ?? `Class ${String.fromCharCode(65 + k)}`
    return {
      weight: p[`weight${suf}`], opacity: p[`opacity${suf}`], dash: p[`dash${suf}`],
      name: `Pillars · ${pillarClass[1] ? 'Above · ' : ''}${cname}${c?.color ? ` ${c.color}` : ''}`,
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
      /*
       * The one draw-mode layer that carries a flat colour.
       *
       * Every other one is coloured per vertex, hypsometrically or not, and the
       * renderer reads that buffer. Lettering has no such buffer — a number is
       * not at an elevation the way a contour is — so it took the `color || '#000000'`
       * fallback and came out black whatever the contours were set to.
       *
       * `null` means "follow the contours", the same cascade the vector layers'
       * ink uses: the numbers match their lines until told otherwise. Which is
       * usually what is wanted, and occasionally exactly not — a red index
       * elevation on grey contours is a normal thing for a sheet to do.
       */
      return { weight: p.labelWeightContours ?? 1, opacity: p.opacityContours, dash: 'solid',
               color: p.labelColorContours ?? p.colorContours ?? '#000000' }
    case 'Gpx':
      return { weight: p.weightGpx, opacity: p.opacityGpx, dash: p.dashGpx }
    // The upper half of Pillars, with its own flat style keys.
    case 'Pillars-Above':
      return { weight: p.weightPillarsAbove, opacity: p.opacityPillarsAbove, dash: p.dashPillarsAbove }
    case 'Swiss-Rock':
      return { weight: p.weightSwiss, opacity: p.opacitySwiss, dash: p.dashSwiss }
    case 'Swiss-Scree':
      return { weight: p.screeWeightSwiss ?? 2.5, opacity: p.opacitySwiss, dash: 'solid' }
    case 'Bitplane-Step':
      return { weight: p.weightBitplane, opacity: p.opacityBitplane, dash: p.dashBitplane }
    // The dither is a dot, so it takes a dot's radius rather than the staircase's
    // stroke width, and it is never dashed — a dashed point is a point.
    case 'Bitplane-Screen':
      return { weight: p.screenWeightBitplane ?? 3, opacity: p.opacityBitplane, dash: 'solid' }
    case 'Halation-Grain':
      return { weight: p.weightHalation, opacity: p.opacityHalation, dash: 'solid' }
    // The halo is a second ink on the same plate, so it carries its own radius
    // and its own opacity — a glow at the grain's weight is just more grain.
    case 'Halation-Bloom':
      return { weight: p.glowWeightHalation ?? 5, opacity: p.glowOpacityHalation ?? 0.55, dash: 'solid' }
    // The flight is the picture and the run-in is the annotation, so they part
    // company on weight and dash rather than on colour.
    case 'Air-Flight':
      return { weight: p.weightAir, opacity: p.opacityAir, dash: p.dashAir }
    case 'Air-RunIn':
      return { weight: p.runInWeightAir ?? 1, opacity: (p.opacityAir ?? 1) * 0.5, dash: 'dotted' }
    case 'RaceLine-Field':
      return { weight: p.weightRaceLine, opacity: (p.opacityRaceLine ?? 1) * 0.45, dash: p.dashRaceLine }
    case 'RaceLine-Best':
      return { weight: p.bestWeightRaceLine ?? 3, opacity: p.opacityRaceLine, dash: 'solid' }
    case 'Panorama-Crests':
      return { weight: p.weightPanorama, opacity: p.opacityPanorama, dash: p.dashPanorama }
    // The skyline is the line the board is drawn for, so it takes the heavier pen.
    case 'Panorama-Skyline':
      return { weight: p.skylineWeightPanorama ?? 2.4, opacity: p.opacityPanorama, dash: 'solid' }
    case 'Bedding-Beds':
      return { weight: p.weightBedding, opacity: p.opacityBedding, dash: p.dashBedding }
    case 'Bedding-Marker':
      return { weight: p.markerWeightBedding ?? 2.4, opacity: p.opacityBedding, dash: 'solid' }
    // One pen per band, named for its degrees, so the plot says which is which.
    case 'SlopeClass-Low':
    case 'SlopeClass-Mid':
    case 'SlopeClass-High': {
      const [a, b, c] = [p.lowSlopeClass ?? 30, p.midSlopeClass ?? 35, p.highSlopeClass ?? 40].sort((x, y) => x - y)
      const band = id === 'SlopeClass-Low' ? `${a}–${b}°` : id === 'SlopeClass-Mid' ? `${b}–${c}°` : `over ${c}°`
      return { weight: p.weightSlopeClass, opacity: p.opacitySlopeClass, dash: p.dashSlopeClass,
               name: `Slope classes · ${band}` }
    }
    default:
      return { weight: p[`weight${id}`], opacity: p[`opacity${id}`], dash: p[`dash${id}`] }
  }
}

/**
 * Growable typed-array writers. The builders emit millions of floats per rebuild;
 * accumulating them in plain JS arrays (boxed doubles + push/spread) and converting
 * at the end dominated worker time and GC. These append straight into typed
 * storage with doubling growth.
 *
 * ── What toArray() returns, and why it depends ───────────────────────────────
 * A subarray view costs nothing but keeps the *whole* backing buffer alive, and
 * the worker transfers `arr.buffer` — so a layer that finished just past a
 * doubling boundary ships nearly twice the bytes it needs and holds them for as
 * long as it is on screen. Measured on a 1024² raster at resolution 1:
 *
 *   Stipple    16.8 MB used   32.0 MB allocated   1.91×   15.2 MB wasted
 *   Swiss      12.9           16.9                1.31     4.0
 *   Contours   65.0           75.0                1.15    10.0
 *   Lines      59.9           68.0                1.13     8.0
 *
 * Stipple is the case the doubling is worst for, and it is not a rounding error.
 * But copying unconditionally is not free either: `slice` holds the old buffer
 * and the new one at the same time, so it trades a lower steady state for a
 * higher peak — which is the wrong way round for the small layers, where the
 * slack is a few hundred kilobytes and the copy buys nothing.
 *
 * So the copy is spent only where it pays: a large buffer that is also mostly
 * slack. Everything else keeps the free view it always had.
 */

// Trim when the waste is worth a copy — both tests have to pass. The ratio alone
// would copy a 64 KB buffer to save 32 KB; the size alone would copy a 60 MB
// buffer to save 8 MB, which is the 1.13× case above and not worth the peak.
const TRIM_MIN_WASTE_BYTES = 2 * 1024 * 1024
const TRIM_MIN_RATIO = 1.5

/** Whether a writer's slack is worth one copy to reclaim. See above. */
function worthTrimming(used, capacity, bytesPerElement) {
  return (capacity - used) * bytesPerElement >= TRIM_MIN_WASTE_BYTES
      && capacity >= used * TRIM_MIN_RATIO
}
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
  toArray() {
    if (this.n === this.a.length) return this.a
    return worthTrimming(this.n, this.a.length, 4) ? this.a.slice(0, this.n) : this.a.subarray(0, this.n)
  }
}

/** Float64 variant, used for contour chain coordinates. Double precision keeps
 *  the chained/smoothed output bit-identical to the pre-optimisation builder;
 *  Float32 was measured to be no faster here, so there is nothing to trade. */
export class F64List {
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

export class I32List {
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
  toArray() {
    if (this.n === this.a.length) return this.a
    return worthTrimming(this.n, this.a.length, 4) ? this.a.slice(0, this.n) : this.a.subarray(0, this.n)
  }
}

// Shared zero-length buffers for "nothing to emit" returns. Immutable in
// practice — callers only ever read them — so one instance each is enough.
export const EMPTY_F64 = new Float64Array(0)
export const EMPTY_F32 = new Float32Array(0)
export const EMPTY_U8  = new Uint8Array(0)

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
export function neighbour(field, gridMask, i, o) {
  return gridMask[i + o] ? field[i + o] : field[i]
}

export function normElev(elev, minElev, maxElev) {
  return maxElev > minElev ? (elev - minElev) / (maxElev - minElev) : 0
}

export function inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut) {
  const n = normElev(elev, minElev, maxElev)
  return n >= elevMinCut / 100 && n <= elevMaxCut / 100
}


// ─── Land cover masking ───────────────────────────────────────────────────────

/**
 * One layer's view of the ground, restricted to the classes it draws on.
 *
 * Thirty-three draw modes were already in this file, and not one of them needed
 * changing. Every builder here already asks `gridMask` whether a cell carries data,
 * because a GeoTIFF with a void in it has always been possible and a mode that
 * ignored the mask would draw across the hole. So a class filter is not a new
 * question to ask at every mark — it is the *same* question, asked of a mask
 * with more zeros in it.
 *
 * That is the whole mechanism. The layers that trace descent runs, the ones that
 * march isolines, the ones that fill lattice cells: all of them inherit masking
 * for free, and all of them keep inheriting it when the next mode is added.
 *
 * ── What is deliberately not recomputed ──────────────────────────────────────
 * Only `gridMask` changes. `halfW`, `minElev`, `maxElev` and `maxSlope` are
 * carried over untouched, and that is load-bearing rather than lazy: they are
 * the frame every layer is drawn against. Re-measuring them over one class's
 * cells would re-centre that layer on its own bounding box and re-stretch its
 * hypsometric ramp over its own elevation range, so two masked layers over the
 * same terrain would drift apart on the page and disagree about what colour
 * 1 200 m is. The picture has one coordinate system; only the stencil moves.
 */
export function maskedTerrain(terrain, classMask, painted) {
  const byClass = classMask && classMask !== ALL_CLASSES && terrain.gridClass
  // `gridPaint` is the union of whichever hand-drawn masks this layer selected,
  // already carried onto the grid. Two independent stencils, and a layer may
  // carry both — cover says what the ground is, a painted mask says which part
  // of the picture you meant. A cell has to satisfy both to be marked.
  const byPaint = Boolean(painted)
  if (!byClass && !byPaint) return terrain

  const src = terrain.gridMask
  const cls = terrain.gridClass
  const out = new Uint8Array(src.length)
  for (let i = 0; i < src.length; i++) {
    if (!src[i]) continue
    if (byClass && !maskHasClass(classMask, cls[i])) continue
    if (byPaint && !painted[i]) continue
    out[i] = 1
  }
  // `hasNoData` switches on the mask-aware paths — the normalised blur, the
  // hole-skipping neighbour reads. A masked layer has holes by construction, so
  // it needs them on whatever the source raster looked like.
  return { ...terrain, gridMask: out, hasNoData: true }
}

/**
 * The union of the masks one layer selected, carried onto the grid.
 *
 * Memoised on the selection for the length of a build, because several layers
 * commonly share one — "everything inside the ridge" is the sort of mask a
 * whole plate is drawn against — and the union is a pass over every cell.
 */
let paintCache = { gen: null, bySelection: new Map() }

export function paintFor(terrain, selection) {
  if (!selection || !terrain.gridMasks?.length) return null
  if (paintCache.gen !== terrain.gridMasks) {
    paintCache = { gen: terrain.gridMasks, bySelection: new Map() }
  }
  const hit = paintCache.bySelection.get(selection)
  if (hit !== undefined) return hit

  const n = terrain.rows * terrain.cols
  let out = null
  for (let i = 0; i < terrain.gridMasks.length; i++) {
    if (!(selection & (1 << i))) continue
    const plane = terrain.gridMasks[i]
    if (!plane || plane.length !== n) continue
    if (!out) { out = plane; continue }
    // Only copy once a second plane actually joins: a single selected mask is
    // by far the common case and needs no allocation at all.
    if (out === plane) continue
    const merged = new Uint8Array(n)
    for (let k = 0; k < n; k++) merged[k] = out[k] || plane[k] ? 1 : 0
    out = merged
  }
  paintCache.bySelection.set(selection, out)
  return out
}

export function concat(a, b) { const out = new Float32Array(a.length+b.length); out.set(a, 0); out.set(b, a.length); return out }

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
export function getChainScratch(size) {
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
export function chainLevelSegments(segE, segXY, nSegs, scratch) {
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

export function chaikinSmoothFlat(pts, closed, iterations, interEps = 0) {
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

export function edgeLerp01(va, vb, level) {
  return Math.abs(vb - va) < 1e-10 ? 0.5 : (level - va) / (vb - va)
}

// Scratch for the 4 marching-squares edge midpoints (top, right, bottom, left).
export const _edgeX = new Float64Array(4)
export const _edgeY = new Float64Array(4)
// …and their grid-edge ids, used to chain segments without stringifying coords.
export const _edgeId = new Int32Array(4)

// Flatness tolerance for post-smoothing decimation, in grid units. Well under a
// screen pixel at any usual zoom — see simplifyFlat().
export const SMOOTH_SIMPLIFY_EPS = 0.02
export const MARCHING_TABLE = { 1:[3,2], 2:[2,1], 3:[3,1], 4:[0,1], 5:[0,3,2,1], 6:[0,2], 7:[0,3], 8:[0,3], 9:[0,2], 10:[0,1,2,3], 11:[0,1], 12:[3,1], 13:[2,1], 14:[3,2] }

// ─── Seeded randomness ───────────────────────────────────────────────────────

/** Mulberry32 PRNG — deterministic per seed so stochastic modes (Stipple,
 *  Swiss scree) are reproducible: the same seed always yields the same art. */
export function mulberry32(seed) {
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
 * The same light convention as the hillshade shader — a true bearing, and
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
/**
 * Where the light comes from, as a unit vector.
 *
 * The azimuth is a **true bearing**: 0° north, 90° east. East is +X and north is
 * −Z in this scene, which is why the pair is `(sin, −cos)` rather than
 * `(cos, sin)`.
 *
 * It did not used to be. Until v1.14.0 every light here but Tanaka's was built
 * as `(cos az, sin alt, sin az)`, putting azimuth 0 at the raster's *eastern*
 * edge — so the same 315° lit Tanaka from the north-west and the hillshade from
 * the north-east, and the almanac, fed a real bearing, lit the noon sun in the
 * west. Every stored azimuth gained 90° in the migration, so no plate changed.
 *
 * Exported because the unit suite needs to ask the app which face an azimuth
 * lights, and a copy of these three lines in a test is a copy that drifts. The
 * surface shader holds the one unavoidable second copy, in GLSL.
 */
export function lightVector(azimuthDeg, altitudeDeg) {
  const az = (azimuthDeg * Math.PI) / 180
  const alt = (altitudeDeg * Math.PI) / 180
  const c = Math.cos(alt)
  return [Math.sin(az) * c, Math.sin(alt), -Math.cos(az) * c]
}

export function lambertDarkness(terrain, sunAzimuth, gamma, elevScale, radius = 0) {
  const { gridMask, rows, cols, scl } = terrain
  // Mask-aware, or the step down to the zeros in NoData would read as a cliff
  // and ring the whole selection with lines.
  const grid = radius > 0
    ? boxBlur(terrain.grid, cols, rows, radius, terrain.hasNoData ? gridMask : null)
    : terrain.grid
  const [Lx, Ly, Lz] = lightVector(sunAzimuth ?? 315, 45)
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

// ─── Sun hours ───────────────────────────────────────────────────────────────

/**
 * Isolines of how many hours of direct sun a place gets.
 *
 * The same construction as the contours and the isophotes above — marching
 * squares over a scalar field, chained, then draped — and the field is the only
 * one in this file that is a **measurement of the ground rather than of the
 * picture**. A contour is a height and an isophote is a shading convention; this
 * is the number an alpine hut, a ski aspect or a panel array is chosen by, and it
 * falls out of the raster's own latitude. See utils/sunHours.js for how it is
 * computed and what "lit" means.
 *
 * Four things follow from the field being hours rather than a fraction:
 *
 * - **The levels are round numbers of hours, not evenly spaced fractions.** The
 *   range is not knowable in advance — a few thousand hours for a year, a
 *   handful for a day, and less in a deep valley — so the panel asks roughly how
 *   many lines and `sunHourLevels` fits a 1-2-5 step inside whatever the field
 *   turned out to be. A line at 1 000 h means a thousand hours.
 * - **There is a line at almost nothing.** The lowest level sits just above zero
 *   and traces the edge of the ground that never sees the sun at all. Marching
 *   squares cannot trace the zero region itself, and that closed ring round the
 *   north face is the whole reason the field is worth drawing.
 * - **It is the most expensive mode here, by a distance.** A few hundred shadow
 *   sweeps over the whole grid, once per rebuild. `cost: 7` says so to the
 *   randomiser and the panel says so to the user.
 * - **NoData is a hole, not a shoreline** — the same rule the isophotes follow,
 *   for the same reason. There is no sunlight where there is no ground.
 */
/**
 * Contours of any per-cell field, draped on the ground.
 *
 * Sun Hours and Isochrones both contour a field that is not the elevation, with
 * −1 for "no value here". A cell with such a corner is skipped, so a level never
 * wraps the edge of the data. Chains are Chaikin-smoothed `smooth` passes and
 * draped a cell at a time: these lines cross elevations freely.
 */
export function traceLevelSet(terrain, p, field, levels, smooth) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const sMask = terrain.hasNoData ? gridMask : null
  const positions = new F32List(), colors = new F32List()
  const ex = _edgeX, ey = _edgeY, eid = _edgeId
  const scratch = getChainScratch(rows * cols * 2)

  for (const level of levels) {
    const segE = new I32List(), segXY = new F64List()

    for (let r = 0; r < rows - 1; r++) {
      const row0 = r * cols, row1 = row0 + cols
      for (let c = 0; c < cols - 1; c++) {
        const d00 = field[row0 + c],     d10 = field[row0 + c + 1]
        const d01 = field[row1 + c],     d11 = field[row1 + c + 1]
        if (d00 < 0 || d10 < 0 || d01 < 0 || d11 < 0) continue

        const idx = (d00 >= level ? 8 : 0) | (d10 >= level ? 4 : 0) |
                    (d11 >= level ? 2 : 0) | (d01 >= level ? 1 : 0)
        if (idx === 0 || idx === 15) continue

        ex[0] = c + edgeLerp01(d00, d10, level); ey[0] = r
        ex[1] = c + 1;                           ey[1] = r + edgeLerp01(d10, d11, level)
        ex[2] = c + edgeLerp01(d01, d11, level); ey[2] = r + 1
        ex[3] = c;                               ey[3] = r + edgeLerp01(d00, d01, level)

        const base = (row0 + c) * 2
        eid[0] = base
        eid[1] = (row0 + c + 1) * 2 + 1
        eid[2] = (row1 + c) * 2
        eid[3] = base + 1

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

      // Draped a cell at a time, for the reason the isophotes set out at length:
      // a sun-hours isoline crosses elevations freely, so a decimated chord is
      // horizontally faithful and says nothing about the ground under it.
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

// ─── Sprite blocks / Reticulation ────────────────────────────────────────────

/**
 * Tier index and snapped elevation per cell — Bitplane's quantiser, shared.
 *
 * Anchored to `normElev` against the terrain's own bounds rather than to raw
 * brightness, which is what keeps the plateaus still when the exaggeration
 * slider moves and what keeps them correctly ordered at negative `elevScale`.
 */
export function quantiseTiers(terrain, p, tiers) {
  const { grid, gridMask, rows, cols, minElev, maxElev } = terrain
  const { elevScale, jitterAmt } = p
  const nT = Math.max(2, Math.min(64, Math.round(tiers ?? 8)))
  const bandH = (maxElev - minElev) / nT
  const n = rows * cols
  const tier = new Int16Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { tier[i] = -1; continue }
      const ne = normElev(cellElev(grid, r, c, cols, elevScale, jitterAmt), minElev, maxElev)
      tier[i] = Math.min(nT - 1, Math.max(0, Math.floor(ne * nT)))
    }
  }
  return { tier, nT, bandH, yOf: (t) => minElev + t * bandH }
}

// ─── Point-set modes: Single Line, Roughness Mesh ────────────────────────────

/**
 * One straight edge in grid coordinates, draped onto the ground a cell at a
 * time.
 *
 * The point-set modes join samples that can lie many cells apart, and a chord
 * between two draped ends says nothing about the ridge between them. Walking it
 * in one-cell steps is the same answer the isophotes give a terminator. A step
 * over NoData or outside the elevation cut lifts the pen for that step only.
 */
export function drapeEdge(out, terrain, p, sMask, c0, r0, c1, r1, angle) {
  const { grid, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const steps = Math.max(1, Math.ceil(Math.hypot(c1 - c0, r1 - r0)))
  let pc = 0, pr = 0, pe = 0, prevOk = false
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    const fc = Math.max(0, Math.min(cols - 1, c0 + (c1 - c0) * t))
    const fr = Math.max(0, Math.min(rows - 1, r0 + (r1 - r0) * t))
    const b = sampleBilinear(grid, sMask, rows, cols, fr, fc)
    const e = (b - 0.5) * 100 * elevScale
    const ok = b === b && inElevCut(e, minElev, maxElev, elevMinCut, elevMaxCut)
    if (ok && prevOk) {
      out.positions.push6(pc * scl - halfW, pe, pr * scl - halfH, fc * scl - halfW, e, fr * scl - halfH)
      const i = Math.round(fr) * cols + Math.round(fc)
      out.colors.pushRgb2(computeVertexColor(normElev(e, minElev, maxElev), gridSlopes[i] / (maxSlope || 1), angle, p))
    }
    prevOk = ok; pc = fc; pr = fr; pe = e
  }
}

/**
 * Parallel strokes through every cell where `test(idx)` holds, draped.
 *
 * Lines are marched across the whole raster at each angle, `pitch` cells apart,
 * and drawn only where the test passes, so each stroke starts and stops at the
 * region's edge. Shadow Hatch and Viewshed both hatch a region this way.
 */
export function hatchWhere(terrain, p, test, angles, pitch) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const sMask = terrain.hasNoData ? gridMask : null
  const positions = new F32List(), colors = new F32List()
  const cc = (cols - 1) / 2, rc = (rows - 1) / 2
  const halfDiag = Math.sqrt(cc * cc + rc * rc) + 1
  for (const deg of angles) {
    const theta = (deg * Math.PI) / 180
    const dx = Math.cos(theta), dz = Math.sin(theta), nx = -dz, nz = dx
    for (let off = -halfDiag; off <= halfDiag; off += pitch) {
      const ox = cc + nx * off, oz = rc + nz * off
      let prevC = 0, prevR = 0, prevE = 0, inRun = false
      for (let t = -halfDiag; t <= halfDiag; t += 0.5) {
        const fc = ox + dx * t, fr = oz + dz * t
        let ok = fc >= 0 && fc <= cols - 1 && fr >= 0 && fr <= rows - 1
        let elev = 0
        if (ok) {
          const idx = Math.round(fr) * cols + Math.round(fc)
          ok = gridMask[idx] === 1 && test(idx)
          if (ok) {
            const b = sampleBilinear(grid, sMask, rows, cols, fr, fc)
            elev = (b - 0.5) * 100 * elevScale
            ok = b === b && inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)
          }
        }
        if (ok && inRun) {
          positions.push6(prevC * scl - halfW, prevE, prevR * scl - halfH, fc * scl - halfW, elev, fr * scl - halfH)
          const idx = Math.round(fr) * cols + Math.round(fc)
          colors.pushRgb2(computeVertexColor(normElev(elev, minElev, maxElev), gridSlopes[idx] / (maxSlope || 1), theta, p))
        }
        inRun = ok
        prevC = fc; prevR = fr; prevE = elev
      }
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

/** Two `{positions, colors}` results as one. */
export function joinLayers(a, b) {
  const pos = new Float32Array(a.positions.length + b.positions.length)
  pos.set(a.positions); pos.set(b.positions, a.positions.length)
  const col = new Float32Array(a.colors.length + b.colors.length)
  col.set(a.colors); col.set(b.colors, a.colors.length)
  return { positions: pos, colors: col }
}

// ─── Bitplane (quantised tiers + ordered dither) ─────────────────────────────

/**
 * The 4×4 Bayer matrix, flattened, holding 0…15.
 *
 * Ordered dither is the *wrong* screen for a photograph and the right one here:
 * it lays down a visible, regular pattern, and a visible regular pattern is what
 * a 16-colour ramp looks like when it shades a sky. Flashbulb wants blue noise
 * for exactly the opposite reason.
 */
/** Three inks cannot sum past 3.0, so a cap at this value can never bind. */
export const RISO_TAC_OFF = 3

export const BAYER4 = new Uint8Array([
   0,  8,  2, 10,
  12,  4, 14,  6,
   3, 11,  1,  9,
  15,  7, 13,  5,
])
