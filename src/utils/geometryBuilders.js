/**
 * CPU-side geometry builders: the dispatcher.
 *
 * `buildLineGeometry` runs every enabled draw mode and wraps its output in
 * curtains, lids and mirrored octants. The builders themselves live in
 * `builders/`, one module per family, with the helpers they share in
 * `builders/shared.js`. This file re-exports the public API, so importers
 * never need to know which module a helper moved to.
 */
import { shadowSun } from './sunHours'
import { buildCover, buildIndexed, buildMineral, buildOutrun, buildRiso, buildWatershed } from './builders/colour.js'
import { buildContours } from './builders/contours.js'
import { buildAir, buildBerm, buildFallLine, buildRaceLine } from './builders/descent.js'
import { buildIsochrone, buildRoute, buildViewshed } from './builders/ground.js'
import { buildHachure, buildLehmannHachure } from './builders/hachure.js'
import { buildEngraving, buildFlashbulb, buildHalation, buildIsophotes, buildShadowHatch, buildShadowLine, buildSunHours } from './builders/light.js'
import { buildAngleLines, buildCrosshatch, buildCurvature, buildDagThinning, buildFlowLines, buildPencilShading, buildRidgeLines, buildTpiFeatures } from './builders/lines.js'
import { buildPillars } from './builders/pillars.js'
import { buildBitplane, buildSection } from './builders/relief.js'
import { maskedTerrain, paintFor } from './builders/shared.js'
import { buildReticulation, buildRugged, buildSprite, buildStipple, buildSwissRockScree, buildTruchet, buildTsp, buildZeroCross } from './builders/tone.js'
export { blueNoiseTile } from './builders/light.js'
export { F32List, U32List, hasFillLayer, layerStyle, lightVector, needsSurfaceShading, simplifyFlat } from './builders/shared.js'
export { buildSurfaceGeometry } from './builders/surface.js'

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
    { id:'Hachure', builder: (t, ctx) => p.styleHachure === 'lehmann'
        ? buildLehmannHachure(t, ctx, p.spacingHachure, p.bandsHachure, p.gammaHachure)
        : buildHachure(t, ctx, p.spacingHachure, p.lengthHachure) },
    { id:'Flow',    builder: (t, ctx) => buildFlowLines(t, ctx, p.spacingFlow, p.stepFlow, p.maxLenFlow) },
    { id:'Dag',     builder: (t, ctx) => buildDagThinning(t, ctx, p.thresholdDag, {
        accum: p.accumDag, passes: p.passesDag, gap: p.gapDag }) },
    { id:'Pencil',  builder: (t, ctx) => buildPencilShading(t, ctx, p.spacingPencil, p.thresholdPencil) },
    { id:'Ridge',   builder: (t, ctx) => buildRidgeLines(t, ctx, p.spacingRidge, p.radiusRidge, p.thresholdRidge) },
    { id:'Valley',  builder: (t, ctx) => buildTpiFeatures(t, ctx, p.spacingValley, p.radiusValley, p.thresholdValley, false) },
    { id:'Stipple', builder: (t, ctx) => buildStipple(t, ctx, p.spacingStipple, p.stippleDensityMode, p.stippleGamma, p.stippleJitter) },
    { id:'Engrave', builder: (t, ctx) => buildEngraving(t, ctx, p.spacingEngrave, p.angleEngrave, p.levelsEngrave, p.sunAzimuthEngrave, p.gammaEngrave) },
    { id:'Curv',    builder: (t, ctx) => buildCurvature(t, ctx, p.spacingCurv, p.lengthCurv, p.thresholdCurv, p.radiusCurv, p.dirModeCurv, p.stepCurv) },
    { id:'Swiss',   builder: (t, ctx) => buildSwissRockScree(t, ctx, p.spacingSwiss, p.thresholdSwiss, p.lengthSwiss, p.screeSwiss) },
    { id:'Iso',     builder: (t, ctx) => buildIsophotes(t, ctx, p.levelsIso, p.sunAzimuthIso, p.gammaIso, p.smoothingIso, p.radiusIso) },
    { id:'ShadowLine', builder: (t, ctx) => buildShadowLine(t, ctx, {
        ...shadowSun(p), smoothing: p.smoothingShadowLine, radius: p.radiusShadowLine }) },
    { id:'SunHours',builder: (t, ctx) => buildSunHours(t, ctx, {
        levels: p.levelsSunHours, period: p.periodSunHours, days: p.daysSunHours,
        perDay: p.perDaySunHours, date: p.dateSunHours,
        smoothing: p.smoothingSunHours, radius: p.radiusSunHours }) },
    { id:'Bitplane',builder: (t, ctx) => buildBitplane(t, ctx, p.tiersBitplane, p.ditherBitplane, p.spacingBitplane, p.risersBitplane) },
    { id:'Sprite',  builder: (t, ctx) => buildSprite(t, ctx, {
        tiers: p.tiersSprite, spacing: p.spacingSprite, size: p.sizeSprite,
        faces: p.facesSprite, faceColor: p.faceColorSprite }) },
    { id:'Retic',   builder: (t, ctx) => buildReticulation(t, ctx, {
        cell: p.cellRetic, spacing: p.spacingRetic, width: p.widthRetic,
        gamma: p.gammaRetic, densityMode: p.densityModeRetic, seed: p.seedRetic }) },
    { id:'ZeroCross',builder: (t, ctx) => buildZeroCross(t, ctx, {
        detrend: p.detrendZeroCross, spacing: p.spacingZeroCross, axes: p.axesZeroCross }) },
    { id:'Section', builder: (t, ctx) => buildSection(t, ctx, {
        cut: p.cutSection, hatch: p.hatchSection, hatchAngle: p.hatchAngleSection,
        beyond: p.beyondSection }) },
    { id:'FallLine',builder: (t, ctx) => buildFallLine(t, ctx, {
        spacing: p.spacingFallLine, gravity: p.gravityFallLine, drag: p.dragFallLine,
        dragQuad: p.dragQuadFallLine, carve: p.carveFallLine, smoothing: p.smoothingFallLine, maxLen: p.maxLenFallLine }) },
    { id:'Berm',    builder: (t, ctx) => buildBerm(t, ctx, {
        spacing: p.spacingBerm, gravity: p.gravityBerm, drag: p.dragBerm,
        dragQuad: p.dragQuadBerm, carve: p.carveBerm, smoothing: p.smoothingBerm, maxLen: p.maxLenBerm,
        length: p.lengthBerm }) },
    { id:'Air',     builder: (t, ctx) => buildAir(t, ctx, {
        spacing: p.spacingAir, gravity: p.gravityAir, drag: p.dragAir,
        dragQuad: p.dragQuadAir, carve: p.carveAir, smoothing: p.smoothingAir, maxLen: p.maxLenAir,
        runIn: p.runInAir, airGravity: p.airGravityAir, lip: p.lipAir,
        minAir: p.minAirAir }) },
    { id:'RaceLine',builder: (t, ctx) => buildRaceLine(t, ctx, {
        spacing: p.spacingRaceLine, gravity: p.gravityRaceLine, drag: p.dragRaceLine,
        dragQuad: p.dragQuadRaceLine, carve: p.carveRaceLine, smoothing: p.smoothingRaceLine, maxLen: p.maxLenRaceLine,
        fan: p.fanRaceLine, spreadDeg: p.spreadRaceLine, drops: p.dropsRaceLine,
        dropSpeed: p.dropSpeedRaceLine }) },
    { id:'Halation',builder: (t, ctx) => buildHalation(t, ctx, {
        azimuth: p.azimuthHalation, distance: p.distanceHalation, height: p.heightHalation,
        falloff: p.falloffHalation, exposure: p.exposureHalation, gamma: p.gammaHalation,
        contrast: p.contrastHalation, grain: p.grainHalation, spacing: p.spacingHalation,
        shadow: p.shadowHalation, shadowSteps: p.shadowStepsHalation,
        bloom: p.bloomHalation, bleed: p.bleedHalation, glow: p.glowHalation,
        glowColor: p.glowColorHalation, seed: p.seedHalation }) },
    { id:'Indexed', builder: (t, ctx) => buildIndexed(t, ctx, {
        tiers: p.tiersIndexed, slopeBands: p.slopeBandsIndexed,
        steepShift: p.steepShiftIndexed, dither: p.ditherIndexed,
        spacing: p.spacingIndexed }) },
    { id:'Outrun',  builder: (t, ctx) => buildOutrun(t, ctx, {
        levels: p.levelsOutrun, whiten: p.whitenOutrun }) },
    { id:'Riso',    builder: (t, ctx) => buildRiso(t, ctx, {
        pitch: p.pitchRiso, offset: p.offsetRiso, limit: p.limitRiso, azimuth: p.azimuthRiso,
        colorA: p.colorARiso, colorB: p.colorBRiso, colorC: p.colorCRiso,
        gammaA: p.gammaARiso, gammaB: p.gammaBRiso, gammaC: p.gammaCRiso,
        seed: p.seedRiso }) },
    { id:'Mineral', builder: (t, ctx) => buildMineral(t, ctx, {
        spacing: p.spacingMineral, radius: p.radiusMineral, steep: p.steepMineral,
        broken: p.brokenMineral, grain: p.grainMineral,
        colorA: p.colorAMineral, colorB: p.colorBMineral, colorC: p.colorCMineral,
        colorD: p.colorDMineral, colorE: p.colorEMineral, }) },
    { id:'Cover',   builder: (t, ctx) => buildCover(t, ctx, {
        spacing: p.spacingCover, source: p.sourceCover, grain: p.grainCover,
        color: p.colorCover, }) },
    { id:'Shed',    builder: (t, ctx) => buildWatershed(t, ctx, {
        spacing: p.spacingShed, inks: p.inksShed, minBasin: p.minBasinShed, radius: p.radiusShed,
        shade: p.shadeShed, azimuth: p.azimuthShed, seed: p.seedShed, }) },
    { id:'Flashbulb',builder: (t, ctx) => buildFlashbulb(t, ctx, {
        azimuth: p.azimuthFlashbulb, distance: p.distanceFlashbulb, height: p.heightFlashbulb,
        falloff: p.falloffFlashbulb, exposure: p.exposureFlashbulb, gamma: p.gammaFlashbulb,
        contrast: p.contrastFlashbulb, grain: p.grainFlashbulb, spacing: p.spacingFlashbulb,
        shadow: p.shadowFlashbulb, shadowSteps: p.shadowStepsFlashbulb,
        fold: p.foldFlashbulb, seed: p.seedFlashbulb }) },
    { id:'Tsp',     builder: (t, ctx) => buildTsp(t, ctx, {
        count: p.countTsp, densityMode: p.densityModeTsp, gamma: p.gammaTsp,
        azimuth: p.azimuthTsp, seed: p.seedTsp, closed: p.closedTsp }) },
    { id:'ShadowHatch', builder: (t, ctx) => buildShadowHatch(t, ctx, {
        azimuth: p.azimuthShadowHatch, altitude: p.altitudeShadowHatch,
        spacing: p.spacingShadowHatch, angle: p.angleShadowHatch, cross: p.crossShadowHatch,
        radius: p.radiusShadowHatch, outline: p.outlineShadowHatch }) },
    { id:'Isochrone', builder: (t, ctx) => buildIsochrone(t, ctx, {
        originX: p.originXIsochrone, originY: p.originYIsochrone, direction: p.directionIsochrone,
        interval: p.intervalIsochrone, limit: p.limitIsochrone, maxSlope: p.steepIsochrone,
        cellMetres: p.cellMetresIsochrone, relief: p.reliefIsochrone,
        smoothing: p.smoothingIsochrone, radius: p.radiusIsochrone, marker: p.markerIsochrone }) },
    { id:'Truchet', builder: (t, ctx) => buildTruchet(t, ctx, {
        spacing: p.spacingTruchet, threshold: p.thresholdTruchet, align: p.alignTruchet, seed: p.seedTruchet }) },
    { id:'Viewshed', builder: (t, ctx) => buildViewshed(t, ctx, {
        originX: p.originXViewshed, originY: p.originYViewshed, eye: p.eyeViewshed,
        side: p.sideViewshed, spacing: p.spacingViewshed, angle: p.angleViewshed, cross: p.crossViewshed,
        outline: p.outlineViewshed, radius: p.radiusViewshed, marker: p.markerViewshed,
        cellMetres: p.cellMetresViewshed, relief: p.reliefViewshed }) },
    { id:'Route',   builder: (t, ctx) => buildRoute(t, ctx, {
        startX: p.startXRoute, startY: p.startYRoute, endX: p.endXRoute, endY: p.endYRoute,
        maxSlope: p.steepRoute, smoothing: p.smoothingRoute, marker: p.markerRoute,
        cellMetres: p.cellMetresRoute, relief: p.reliefRoute }) },
    { id:'Rugged',  builder: (t, ctx) => buildRugged(t, ctx, {
        count: p.countRugged, gamma: p.gammaRugged, floor: p.floorRugged,
        radius: p.radiusRugged, kind: p.kindRugged, seed: p.seedRugged }) },
  ]

  const finalLayers = []

  const mX = [p.showMirrorPlusX ? 1 : null, p.showMirrorMinusX ? -1 : null].filter(v => v !== null)
  const mY = [p.showMirrorPlusY ? 1 : null, p.showMirrorMinusY ? -1 : null].filter(v => v !== null)
  const mZ = [p.showMirrorPlusZ ? 1 : null, p.showMirrorMinusZ ? -1 : null].filter(v => v !== null)

  for (const cfg of MODES_CONFIG) {
    if (!p[`enabled${cfg.id}`]) continue

    const ctx = getLayerContext(cfg.id, p[`color${cfg.id}`])

    // The layer's own view of the ground, with both stencils folded in.
    // Identity when the layer has neither, which is every layer by default.
    const layerTerrain = maskedTerrain(terrain, p[`coverMask${cfg.id}`],
                                       paintFor(terrain, p[`layerMask${cfg.id}`]))

    // Build the base pass for this layer once
    const baseRes = cfg.builder(layerTerrain, ctx)
    if (!baseRes) continue

    // Handle builders that return sub-layers (e.g. { minor: {...}, major: {...} })
    const subLayers = (baseRes.positions instanceof Float32Array) 
      ? { [cfg.id]: baseRes } 
      : baseRes

    for (const [subId, res] of Object.entries(subLayers)) {
      // A layer is drawable if it has strokes *or* fills. Until the colour modes
      // arrived every layer had strokes, so an empty `positions` meant an empty
      // layer — and Indexed, Mineral and Watershed are all area and no line,
      // which this used to drop on the floor in silence.
      const hasLines = res.positions && res.positions.length > 0
      const hasFill  = res.lids && res.lids.positions.length > 0
      if (!hasLines && !hasFill) continue
      if (!res.positions) res.positions = new Float32Array(0)
      if (!res.colors)    res.colors    = new Float32Array(0)

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
        // A vertical segment's curtain lies in its own line and has no area.
        // It hides nothing, so it is not built. This also covers a zero-length one.
        if (Math.abs(x0-x1)<1e-4 && Math.abs(z0-z1)<1e-4) continue
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
      let cPbase = cPn === cPfull.length ? cPfull : cPfull.subarray(0, cPn)
      let cIbase = cIn === cIfull.length ? cIfull : cIfull.subarray(0, cIn)
      /*
       * A builder's own occluder, appended to the curtains.
       *
       * A curtain hangs from a segment to the floor, which is right for a line
       * across the ground and useless for a vertical one: Pillars' curtains have
       * no width, so without this a pillar field hid nothing, and with no
       * surface layer on, the far side of a hill showed straight through it.
       * `occluder` is depth-only triangles in the same form, so the viewport and
       * the SVG's Z-buffer both take it with the curtains.
       */
      if (p.depthOcclusion && res.occluder?.indices?.length) {
        const oP = res.occluder.positions, oI = res.occluder.indices, off = cPbase.length / 3
        const mP = new Float32Array(cPbase.length + oP.length)
        mP.set(cPbase); mP.set(oP, cPbase.length)
        const mI = new Uint32Array(cIbase.length + oI.length)
        mI.set(cIbase)
        for (let k = 0; k < oI.length; k++) mI[cIbase.length + k] = oI[k] + off
        cPbase = mP; cIbase = mI
      }
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
          lids: hasLids ? { positions: baseLidP, colors: baseLidC, indices: baseLidI,
                            hugsSurface: !!res.lids?.hugsSurface } : null,
          isPoints: res.isPoints ?? false,
          // The lattice the SVG traces its filled areas from. It rides this path
          // only, for the same reason `labelAnchors` does: it describes one
          // octant in the terrain's own coordinates, and a mirrored copy of the
          // scene has no lattice of its own. A mirrored layer falls back to the
          // boundary lines, which *are* mirrored — see `traceAreaRings`.
          areas: res.areas ?? null,
          // Placements for the main thread to letter. Not geometry, so it rides
          // the un-mirrored path only: a mirrored label reads backwards, and a
          // kaleidoscope of reversed numbers is not what the option is for.
          labelAnchors: res.labelAnchors ?? null,
          // A fact the panel reports, such as a route's walking time. Not geometry.
          note: res.note ?? null,
          // Lines that write depth and test against it, so the nearer of two
          // covers the farther whatever order they were emitted in.
          selfOcclude: !!res.selfOcclude,
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
          ? { positions: layerLidPos, colors: layerLidCol, indices: layerLidInd,
              hugsSurface: !!res.lids?.hugsSurface }
          : null,
        // No lattice for a mirrored scene: it describes one octant, and the
        // copies have none. The SVG falls back to the boundary lines, which are
        // mirrored with everything else.
        areas: null,
        isPoints: res.isPoints ?? false,
        selfOcclude: !!res.selfOcclude,
      })
    }
  }

  return finalLayers
}
