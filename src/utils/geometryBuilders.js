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
import { buildCover, buildIndexed, buildLandform, buildMineral, buildOutrun, buildRiso, buildWatershed, landformGrid, landformInks } from './builders/colour.js'
import { LANDFORMS } from './landforms'
import { buildContours, contourExtremes, buildSpines } from './builders/contours.js'
import { buildAir, buildBerm, buildFallLine, buildRaceLine } from './builders/descent.js'
import { buildGeodesic, buildIsochrone, buildPanorama, buildRoute, buildViewshed } from './builders/ground.js'
import { buildBedding, buildGlacier, buildProfileSheet, buildRunout, buildSlopeClass } from './builders/survey.js'
import { buildAspectRose, buildHypsometry, buildStereonet, buildSwathProfile } from './builders/charts.js'
import { buildCoral, buildVenation } from './builders/growth.js'
import { buildMapGrid } from './builders/mapGrid.js'
import { buildHair, buildPrinter, buildStems, buildWaveform } from './builders/signal.js'
import { buildWind } from './builders/weather.js'
import { buildHachure, buildLehmannHachure } from './builders/hachure.js'
import { buildEngraving, buildFlashbulb, buildHalation, buildIsophotes, buildRadar, buildShadowHatch, buildShadowLine, buildSunHours } from './builders/light.js'
import { buildAngleLines, buildCrosshatch, buildCurvature, buildDagThinning, buildFlowLines, buildPencilShading, buildRidgeLines, buildTpiFeatures } from './builders/lines.js'
import { buildPillars } from './builders/pillars.js'
import { buildBitplane } from './builders/relief.js'
import { F32List, U32List, maskedTerrain, paintFor } from './builders/shared.js'
import { DRAW_MODES } from './drawModes'
import { jitterNoise, sampleBilinear } from './terrain'
import { CLASS_INK_SOURCES, OWN_CLASS_INK, inkByClass } from './builders/classInk.js'
import { buildReticulation, buildRugged, buildSprite, buildStipple, buildSwissRockScree, buildTruchet, buildTsp, buildZeroCross } from './builders/tone.js'
export { blueNoiseTile } from './builders/light.js'
export { F32List, U32List, haloOf, hasFillLayer, layerStyle, lightVector, needsSurfaceShading, simplifyFlat } from './builders/shared.js'
export { buildSurfaceGeometry } from './builders/surface.js'

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/** Modes whose walls are the sides of bodies; see `solid` in drawModes.js. */
const SOLID_MODES = new Set(DRAW_MODES.filter((m) => m.solid).map((m) => m.id))
/** Marks and overlays, whose strokes can float above the ground (`walls: false`). */
const FLOATING_MODES = new Set(DRAW_MODES.filter((m) => m.walls === false).map((m) => m.id))

/**
 * Returns an ARRAY of layers, each with its own geometry and styling.
 */
export function buildLineGeometry(terrain, p) {
  if (!terrain) return []
  
  // Maps the per-layer hypsometric params onto the generic keys
  // computeVertexColor expects. Opacity is deliberately absent: it is resolved
  // render-side by layerStyle, never baked into vertex colours, and carrying it
  // here only suggested otherwise.
  const getLayerContext = (p, id, baseColor) => ({
    ...p,
    lineColor:        baseColor,
    lineHypsometric:  p[`hypso${id}`],
    lineHypsoMode:    p[`hypsoMode${id}`],
    lineBanded:       p[`hypsoBanded${id}`],
    lineHypsoInterval:p[`hypsoInterval${id}`]
  })

  // A function of `p`, not a constant over it: a mode copy runs the same
  // builders against its own values (see the run list below).
  const modeConfigs = (p) => [
    { id:'Lines',   builder: (t, ctx) => buildAngleLines(t, ctx, p.spacingLines, p.shiftLines, p.angleLines) },
    { id:'Cross',   builder: (t, ctx) => buildCrosshatch(t, ctx, {
        spacing: p.spacingCross, angle: p.angleCross, lines: p.linesCross,
        marks: p.marksCross, markSize: p.markSizeCross, markColor: p.markColorCross }) },
    { id:'Pillars', builder: (t, ctx) => buildPillars(t, ctx, p.spacingPillars) },
    { id:'Contours',builder: (t, ctx) => {
        const res = buildContours(t, ctx, p.intervalContours, p.majorIntervalContours, p.majorOffsetContours, p.closeRingsContours, p.smoothingContours)
        const ext = p.extremesContours ? contourExtremes(t, ctx, p.extremeSizeContours) : null
        return ext ? { ...res, 'Contours-Extremes': ext } : res
      } },
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
    { id:'Landform', builder: (t, ctx) => buildLandform(t, ctx, {
        spacing: p.spacingLandform, inks: landformInks(p) }) },
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
    { id:'Panorama', builder: (t, ctx) => buildPanorama(t, ctx, {
        originX: p.originXPanorama, originY: p.originYPanorama, eye: p.eyePanorama,
        minDepth: p.depthPanorama, skyline: p.skylinePanorama, marker: p.markerPanorama,
        cellMetres: p.cellMetresPanorama, relief: p.reliefPanorama }) },
    { id:'Bedding', builder: (t, ctx) => buildBedding(t, ctx, {
        dip: p.dipBedding, azimuth: p.azimuthBedding, beds: p.bedsBedding, offset: p.offsetBedding,
        marker: p.markerBedding, markerColor: p.markerColorBedding, smoothing: p.smoothingBedding,
        cellMetres: p.cellMetresBedding, relief: p.reliefBedding }) },
    { id:'SlopeClass', builder: (t, ctx) => buildSlopeClass(t, ctx, {
        low: p.lowSlopeClass, mid: p.midSlopeClass, high: p.highSlopeClass,
        spacing: p.spacingSlopeClass, angle: p.angleSlopeClass, radius: p.radiusSlopeClass,
        outline: p.outlineSlopeClass,
        cellMetres: p.cellMetresSlopeClass, relief: p.reliefSlopeClass }) },
    { id:'Wind',    builder: (t, ctx) => buildWind(t, ctx, {
        azimuth: p.azimuthWind, spacing: p.spacingWind, deflect: p.deflectWind,
        crest: p.crestWind, lee: p.leeWind, radius: p.radiusWind,
        stroke: p.strokeWind, eddies: p.eddiesWind,
        cellMetres: p.cellMetresWind, relief: p.reliefWind }) },
    { id:'Runout',  builder: (t, ctx) => buildRunout(t, ctx, {
        release: p.releaseRunout, reach: p.reachRunout, spacing: p.spacingRunout,
        radius: p.radiusRunout, zone: p.zoneRunout, zoneColor: p.zoneColorRunout,
        hatch: p.hatchRunout, angle: p.angleRunout,
        cellMetres: p.cellMetresRunout, relief: p.reliefRunout }) },
    { id:'MapGrid', builder: (t, ctx) => buildMapGrid(t, ctx, {
        interval: p.intervalMapGrid, lines: p.linesMapGrid, marks: p.marksMapGrid,
        markSize: p.markSizeMapGrid, markColor: p.markColorMapGrid,
        scale: p.scaleMapGrid, scaleSize: p.scaleSizeMapGrid, scaleColor: p.scaleColorMapGrid,
        cellMetres: p.cellMetresMapGrid }) },
    { id:'Printer', builder: (t, ctx) => buildPrinter(t, ctx, {
        pitch: p.pitchPrinter, aspect: p.aspectPrinter, classes: p.classesPrinter,
        field: p.fieldPrinter, quantile: p.quantilePrinter, blank: p.blankPrinter }) },
    { id:'Stems',   builder: (t, ctx) => buildStems(t, ctx, {
        spacing: p.spacingStems, datum: p.datumStems, tips: p.tipsStems, tipSize: p.tipSizeStems }) },
    { id:'Hair',    builder: (t, ctx) => buildHair(t, ctx, {
        spacing: p.spacingHair, length: p.lengthHair, jitter: p.jitterHair,
        segments: p.segmentsHair, seed: p.seedHair }) },
    { id:'Waveform', builder: (t, ctx) => buildWaveform(t, ctx, {
        line: p.lineWaveform, angle: p.angleWaveform, place: p.placeWaveform, sides: p.sidesWaveform,
        spacing: p.spacingWaveform, width: p.widthWaveform,
        detail: p.detailWaveform, smooth: p.smoothWaveform, gamma: p.gammaWaveform }) },
    { id:'ProfileSheet', builder: (t, ctx) => buildProfileSheet(t, ctx, {
        plot: p.valueProfileSheet, count: p.countProfileSheet, bands: p.bandsProfileSheet,
        tolerance: p.toleranceProfileSheet, smooth: p.smoothProfileSheet, grid: p.gridProfileSheet,
        tick: p.tickProfileSheet, node: p.nodeProfileSheet, numbers: p.numbersProfileSheet }) },
    { id:'SwathProfile', builder: (t, ctx) => buildSwathProfile(t, ctx, {
        width: p.widthSwathProfile, hatch: p.hatchSwathProfile, quartiles: p.quartilesSwathProfile,
        cellMetres: p.cellMetresSwathProfile, relief: p.reliefSwathProfile }) },
    { id:'Hypsometry', builder: (t, ctx) => buildHypsometry(t, ctx, {
        bins: p.binsHypsometry, cellMetres: p.cellMetresHypsometry, relief: p.reliefHypsometry }) },
    { id:'AspectRose', builder: (t, ctx) => buildAspectRose(t, ctx, {
        sectors: p.sectorsAspectRose, by: p.byAspectRose, scale: p.scaleAspectRose, rings: p.ringsAspectRose,
        minSlope: p.minSlopeAspectRose, hatch: p.hatchAspectRose,
        cellMetres: p.cellMetresAspectRose, relief: p.reliefAspectRose }) },
    { id:'Stereonet', builder: (t, ctx) => buildStereonet(t, ctx, {
        poles: p.polesStereonet, contours: p.contoursStereonet, levels: p.levelsStereonet,
        sample: p.sampleStereonet, net: p.netStereonet, minSlope: p.minSlopeStereonet,
        cellMetres: p.cellMetresStereonet, relief: p.reliefStereonet }) },
    { id:'Venation', builder: (t, ctx) => buildVenation(t, ctx, {
        count: p.countVenation, roots: p.rootsVenation, spacing: p.spacingVenation,
        gamma: p.gammaVenation, seed: p.seedVenation }) },
    { id:'Geodesic', builder: (t, ctx) => buildGeodesic(t, ctx, {
        originX: p.originXGeodesic, originY: p.originYGeodesic, rays: p.raysGeodesic,
        exaggeration: p.exaggerationGeodesic, radius: p.radiusGeodesic, marker: p.markerGeodesic,
        cellMetres: p.cellMetresGeodesic, relief: p.reliefGeodesic }) },
    { id:'Radar',   builder: (t, ctx) => buildRadar(t, ctx, {
        azimuth: p.azimuthRadar, look: p.lookRadar, spacing: p.spacingRadar, gain: p.gainRadar,
        cellMetres: p.cellMetresRadar, relief: p.reliefRadar }) },
    { id:'Spines',  builder: (t, ctx) => buildSpines(t, ctx, {
        levels: p.levelsSpines, depth: p.depthSpines, radius: p.radiusSpines }) },
    { id:'Coral',   builder: (t, ctx) => buildCoral(t, ctx, {
        spacing: p.spacingCoral, level: p.levelCoral, nodes: p.nodesCoral, steps: p.stepsCoral, seed: p.seedCoral }) },
    { id:'Glacier', builder: (t, ctx) => buildGlacier(t, ctx, {
        snowline: p.snowlineGlacier, steep: p.steepGlacier, crack: p.crackGlacier,
        interval: p.intervalGlacier, spacing: p.spacingGlacier, radius: p.radiusGlacier,
        moraine: p.moraineGlacier, iceColor: p.iceColorGlacier,
        cellMetres: p.cellMetresGlacier, relief: p.reliefGlacier }) },
    { id:'Rugged',  builder: (t, ctx) => buildRugged(t, ctx, {
        count: p.countRugged, gamma: p.gammaRugged, floor: p.floorRugged,
        radius: p.radiusRugged, kind: p.kindRugged, seed: p.seedRugged }) },
  ]

  /*
   * The run list: every mode, each followed by its enabled copies.
   *
   * A copy is the same mode built against `{ ...p, ...copy.values }`, so it has
   * its own interval, mask and ink, and its layers carry `@<uid>` on their ids.
   * `layerStyle` resolves that suffix against the same values. A copy can be on
   * while its original is off.
   */
  const runs = []
  const copies = Array.isArray(p.modeCopies) ? p.modeCopies : []
  for (const cfg of modeConfigs(p)) {
    runs.push({ cfg, p, suffix: '' })
    for (const copy of copies) {
      if (copy?.mode !== cfg.id || !copy.values?.[`enabled${cfg.id}`]) continue
      const pp = { ...p, ...copy.values }
      runs.push({ cfg: modeConfigs(pp).find((c) => c.id === cfg.id), p: pp, suffix: `@${copy.uid}` })
    }
  }

  /*
   * Landforms, once per build, for every layer that reads them: the Landforms
   * mode, a layer with a landform mask, and a layer coloured by landform. All
   * three read the one grid, with the Landforms mode's own settings, so a mask
   * and the mode beside it agree on where the ridges are.
   */
  const readsForms = runs.some(({ cfg, p: rp }) => rp[`enabled${cfg.id}`] && (cfg.id === 'Landform'
    || rp[`formMask${cfg.id}`] || (rp[`hypso${cfg.id}`] && rp[`hypsoMode${cfg.id}`] === 'form')))
  if (readsForms) terrain = { ...terrain, gridForm: landformGrid(terrain, p) }
  const formTerrain = readsForms
    ? { ...terrain, gridClass: terrain.gridForm, gridPlate: null, classColors: landformInks(p) } : null

  const finalLayers = []

  // The ground's height under a point, as the lines measure it: bilinear on the
  // grid, plus the same smooth jitter. NaN off the data. For the curtains, so a
  // wall never stands above the ground (see the curtain loop).
  const gMask = terrain.hasNoData ? terrain.gridMask : null
  const gScale = terrain.elevScale ?? p.elevScale ?? 1
  const groundAt = (x, z) => {
    const fc = (x + terrain.halfW) / terrain.scl, fr = (z + terrain.halfH) / terrain.scl
    if (!(fc >= 0 && fr >= 0 && fc <= terrain.cols - 1 && fr <= terrain.rows - 1)) return NaN
    const b = sampleBilinear(terrain.grid, gMask, terrain.rows, terrain.cols, fr, fc)
    if (b !== b) return NaN
    let e = (b - 0.5) * 100 * gScale
    if (p.jitterAmt > 0) e += jitterNoise(fc, fr) * p.jitterAmt
    return e
  }
  // How far above the ground a stroke may sit and still count as on it: the
  // grid is sampled a little differently by each builder.
  const wallTol = Math.max(1e-3, (terrain.maxElev - terrain.minElev) * 0.01)

  const mX = [p.showMirrorPlusX ? 1 : null, p.showMirrorMinusX ? -1 : null].filter(v => v !== null)
  const mY = [p.showMirrorPlusY ? 1 : null, p.showMirrorMinusY ? -1 : null].filter(v => v !== null)
  const mZ = [p.showMirrorPlusZ ? 1 : null, p.showMirrorMinusZ ? -1 : null].filter(v => v !== null)

  for (const run of runs) {
    // The run's own parameters: the bus itself, or a copy's values over it.
    const { cfg, p, suffix } = run
    if (!p[`enabled${cfg.id}`]) continue

    const ctx = getLayerContext(p, cfg.id, p[`color${cfg.id}`])

    // The layer's own view of the ground, with both stencils folded in.
    // Identity when the layer has neither, which is every layer by default.
    const layerTerrain = maskedTerrain(terrain, p[`coverMask${cfg.id}`],
                                       paintFor(terrain, p[`layerMask${cfg.id}`]), p[`formMask${cfg.id}`])

    // Build the base pass for this layer once
    const baseRes = cfg.builder(layerTerrain, ctx)
    if (!baseRes) continue

    // Handle builders that return sub-layers (e.g. { minor: {...}, major: {...} })
    let subLayers = (baseRes.positions instanceof Float32Array) 
      ? { [cfg.id]: baseRes } 
      : baseRes

    // Inked by land cover: each part splits into one layer per class, so the
    // SVG writes one pen per class. See builders/classInk.js. Pillars and the
    // Land cover mode ink by class in their own builders.
    const source = p[`hypso${cfg.id}`] && p[`hypsoMode${cfg.id}`]
    if (CLASS_INK_SOURCES.has(source) && !OWN_CLASS_INK.has(cfg.id) && terrain.gridClass) {
      const split = {}
      for (const [subId, res] of Object.entries(subLayers)) {
        const parts = res?.positions instanceof Float32Array ? inkByClass(res, terrain, source) : null
        if (!parts) { split[subId] = res; continue }
        for (const [suffix, part] of Object.entries(parts)) split[suffix ? `${subId}-${suffix}` : subId] = part
      }
      subLayers = split
    }
    // Coloured by landform: the same split, over the landform grid, one pen per
    // landform, named after it.
    if (source === 'form' && formTerrain && cfg.id !== 'Landform') {
      const split = {}
      for (const [subId, res] of Object.entries(subLayers)) {
        const parts = res?.positions instanceof Float32Array
          ? inkByClass(res, formTerrain, 'class', (k) => LANDFORMS[k].id) : null
        if (!parts) { split[subId] = res; continue }
        for (const [suffix, part] of Object.entries(parts)) split[suffix ? `${subId}-${suffix}` : subId] = part
      }
      subLayers = split
    }

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
      //
      // Walls belong to the classic model (*Occluder: Lines*). Under the
      // Ground model the terrain itself is the occluder, drawn depth-only with a
      // skirt at its edges, and a wall under a stroke would only stand where the
      // ground already is — or in the air, under a stroke that floats, which is
      // the white notch this model exists to remove. In the classic model a mode
      // can still be told not to hang walls (`walls<Id>`, off for marks).
      // A solid's walls are its sides (Pillars' columns), which the ground cannot
      // stand in for, so it keeps them under both models (`solid` in drawModes).
      const solid = SOLID_MODES.has(cfg.id)
      const hangsWalls = p.depthOcclusion && (p.occludeBy !== 'ground' || solid) && p[`walls${cfg.id}`] !== false
      const segCount = (res.isPoints || !hangsWalls) ? 0 : (baseP.length / 6) | 0
      /*
       * No wall in the air. A curtain hangs from its stroke to the floor, and
       * where the stroke floats above the ground — the ends of a long hachure
       * tick on a convex peak, a jump span, a waveform laid over the plate —
       * that wall stood in the air and cut a white slab out of every line
       * behind it. Its top now follows the ground under the stroke instead, so
       * a wall only ever stands where the ground is. A stroke on the ground keeps
       * its wall exactly as before; a floating or long one is split at about a
       * cell, so the top follows the ground between its ends.
       *
       * Only marks and overlays float (`walls: false`). The line modes lie on the
       * ground by construction, and reading the ground twice per segment cost
       * them about 45 ms a rebuild on dense contours for no visible change, so
       * their walls are built as they always were.
       */
      const floats = FLOATING_MODES.has(cfg.id)
      const cP = new F32List(Math.max(16, segCount * 12)), cI = new U32List(Math.max(16, segCount * 6))
      let vIdx = 0
      const quad = (xa, ya, za, xb, yb, zb) => {
        cP.push6(xa, ya, za, xb, yb, zb)
        cP.push6(xb, floorY, zb, xa, floorY, za)
        cI.push3(vIdx, vIdx + 1, vIdx + 2)
        cI.push3(vIdx, vIdx + 2, vIdx + 3)
        vIdx += 4
      }
      // No ground under a point — past the raster's edge, or in a NoData hole —
      // means no wall there: a tick reaching past the plate's edge used to hang
      // one in the air beyond it.
      const top = (y, g) => (g !== g ? floorY : y > g + wallTol ? g : y)
      for (let i = 0; i < segCount * 6; i += 6) {
        const x0 = baseP[i], y0 = baseP[i+1], z0 = baseP[i+2]
        const x1 = baseP[i+3], y1 = baseP[i+4], z1 = baseP[i+5]
        // A vertical segment's curtain lies in its own line and has no area.
        // It hides nothing, so it is not built. This also covers a zero-length one.
        if (Math.abs(x0-x1)<1e-4 && Math.abs(z0-z1)<1e-4) continue
        if (solid || !floats) { quad(x0, y0, z0, x1, y1, z1); continue }
        const g0 = groundAt(x0, z0), g1 = groundAt(x1, z1)
        const len = Math.hypot(x1 - x0, z1 - z0)
        if (top(y0, g0) === y0 && top(y1, g1) === y1 && len <= 2 * terrain.scl) {
          quad(x0, y0, z0, x1, y1, z1)
          continue
        }
        const k = Math.min(64, Math.max(1, Math.ceil(len / terrain.scl)))
        let ax = x0, ay = top(y0, g0), az = z0
        for (let j = 1; j <= k; j++) {
          const f = j / k
          const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f, z = z0 + (z1 - z0) * f
          const by = j === k ? top(y1, g1) : top(y, groundAt(x, z))
          quad(ax, ay, az, x, by, z)
          ax = x; ay = by; az = z
        }
      }
      let cPbase = cP.toArray()
      let cIbase = cI.toArray()
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
          id: ((subId === cfg.id) ? cfg.id : subId) + suffix,
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
          // The same, for the numbers of Map Grid's edge scale. A field of its
          // own, because `useContourLabels` takes the first layer with anchors.
          scaleAnchors: res.scaleAnchors ?? null,
          // A fact the panel reports, such as a route's walking time. Not geometry.
          note: res.note ?? null,
          // Lines that write depth and test against it, so the nearer of two
          // covers the farther whatever order they were emitted in.
          selfOcclude: !!res.selfOcclude,
          // Lines that live inside the ground — Pillars' columns, Stems' stems —
          // and so are not hidden by it under the Ground model.
          insideGround: !!res.insideGround,
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
        id: ((subId === cfg.id) ? cfg.id : subId) + suffix,
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
        insideGround: !!res.insideGround,
      })
    }
  }

  return finalLayers
}
