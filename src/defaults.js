/**
 * Default parameter sets.
 *
 * Lifted out of App.jsx so that anything needing to reason about the parameter
 * space — the preset randomiser, which starts from these and overwrites what it
 * decides to change — can import them without importing the root component.
 * App.jsx remains the only place that seeds React state from them.
 */
import { GRADIENT_PRESETS } from './utils/gradientPresets'

// ── Default param sets ────────────────────────────────────────────────────────
export const TERRAIN_DEF = {
  resolution: 2, elevScale: 0, blurRadius: 0,
  gridOffsetX: 0, gridOffsetY: 0, elevMinCut: 0, elevMaxCut: 100,
  blackPoint: 0, whitePoint: 255, jitterAmt: 0,
}

export const STYLE_DEF = {
  showFill: false, fillColor: '#ffffff',
  fillHypsometric: false, fillBanded: false, fillHypsoInterval: 10, fillHypsoWeight: 1.5, fillHypsoMode: 'elevation',
  showMesh: false, meshColor: '#888888', bgColor: '#ffffff',
  bgGradient: false,
  depthOcclusion: true,
  occlusionBias: 1.0,
  occlusionColor: '#a80000',
  occlusionOpacity: 0.0,

  // Texture overlay
  showTexture: false, textureScale: 1, textureShiftX: 0, textureShiftY: 0, textureBlendMode: 'normal', textureOpacity: 1,

  // Creative 3D Symmetry
  showMirrorPlusX: true, showMirrorMinusX: false,
  showMirrorPlusY: true, showMirrorMinusY: false,
  showMirrorPlusZ: true, showMirrorMinusZ: false,

  // ── DRAW MODES ───────────────────────────────────────────────────────────
  // Lines (arbitrary bearing — 0° is the old X Lines, 90° the old Y Lines)
  enabledLines: true, spacingLines: 4, shiftLines: 0, angleLines: 0, colorLines: '#000000', weightLines: 1, opacityLines: 1, dashLines: 'solid',
  hypsoLines: false, hypsoModeLines: 'elevation', hypsoBandedLines: false, hypsoIntervalLines: 10,
  // Crosshatch (two perpendicular line sets at angleCross / angleCross+90)
  enabledCross: false, spacingCross: 4, angleCross: 0, colorCross: '#000000', weightCross: 1, opacityCross: 1, dashCross: 'solid',
  hypsoCross: false, hypsoModeCross: 'elevation', hypsoBandedCross: false, hypsoIntervalCross: 10,
  // Pillars
  enabledPillars: false, spacingPillars: 8, colorPillars: '#000000', weightPillars: 1, opacityPillars: 1, dashPillars: 'solid',
  hypsoPillars: false, hypsoModePillars: 'elevation', hypsoBandedPillars: false, hypsoIntervalPillars: 10,
  pillarGap: 0, pillarDepth: 0, pillarStyle: 'line', pillarSize: 0.8, pillarSegments: 8, pillarLidColor: '#ffffff',
  // Contours
  enabledContours: false, intervalContours: 4, colorContours: '#000000', weightContours: 1, opacityContours: 1, dashContours: 'solid',
  hypsoContours: false, hypsoModeContours: 'elevation', hypsoBandedContours: false, hypsoIntervalContours: 10,
  majorIntervalContours: 10, majorWeightContours: 2, majorOffsetContours: 1, closeRingsContours: false, smoothingContours: 0,
  // Hachure
  enabledHachure: false, spacingHachure: 4, lengthHachure: 1, colorHachure: '#000000', weightHachure: 1, opacityHachure: 1, dashHachure: 'solid',
  hypsoHachure: false, hypsoModeHachure: 'elevation', hypsoBandedHachure: false, hypsoIntervalHachure: 10,
  // Flow
  enabledFlow: false, spacingFlow: 10, stepFlow: 1, maxLenFlow: 100, colorFlow: '#000000', weightFlow: 1, opacityFlow: 1, dashFlow: 'solid',
  hypsoFlow: false, hypsoModeFlow: 'elevation', hypsoBandedFlow: false, hypsoIntervalFlow: 10,
  // Stream Network (DAG)
  enabledDag: false, thresholdDag: 2, colorDag: '#000000', weightDag: 1, opacityDag: 1, dashDag: 'solid',
  hypsoDag: false, hypsoModeDag: 'elevation', hypsoBandedDag: false, hypsoIntervalDag: 10,
  // Pencil Shading
  enabledPencil: false, spacingPencil: 4, thresholdPencil: 0.5, colorPencil: '#000000', weightPencil: 1, opacityPencil: 1, dashPencil: 'solid',
  hypsoPencil: false, hypsoModePencil: 'elevation', hypsoBandedPencil: false, hypsoIntervalPencil: 10,

  // Ridge
  enabledRidge: false, spacingRidge: 1, radiusRidge: 1, thresholdRidge: 0.1, colorRidge: '#000000', weightRidge: 1, opacityRidge: 1, dashRidge: 'solid',
  hypsoRidge: false, hypsoModeRidge: 'elevation', hypsoBandedRidge: false, hypsoIntervalRidge: 10,
  // Valley
  enabledValley: false, spacingValley: 2, radiusValley: 2, thresholdValley: 0.5, colorValley: '#000000', weightValley: 1, opacityValley: 1, dashValley: 'solid',
  hypsoValley: false, hypsoModeValley: 'elevation', hypsoBandedValley: false, hypsoIntervalValley: 10,

  // Stipple — seedStipple: same seed, same dot pattern (reproducible prints)
  enabledStipple: false, spacingStipple: 0.5, weightStipple: 4, opacityStipple: 0.85, colorStipple: '#1a1a1a', dashStipple: 'solid',
  stippleDensityMode: 'slope', stippleGamma: 1.2, stippleJitter: 0.8, seedStipple: 42,
  hypsoStipple: false, hypsoModeStipple: 'elevation', hypsoBandedStipple: false, hypsoIntervalStipple: 10,
  // Engraving (illumination cross-hatch)
  enabledEngrave: false, spacingEngrave: 3, angleEngrave: 45, levelsEngrave: 3, sunAzimuthEngrave: 315, gammaEngrave: 1.5,
  colorEngrave: '#000000', weightEngrave: 1, opacityEngrave: 1, dashEngrave: 'solid',
  hypsoEngrave: false, hypsoModeEngrave: 'elevation', hypsoBandedEngrave: false, hypsoIntervalEngrave: 10,
  // Curvature engraving — strokes trace the principal-curvature direction field
  enabledCurv: false, spacingCurv: 4, lengthCurv: 60, thresholdCurv: 0.15, radiusCurv: 1,
  dirModeCurv: 'max', stepCurv: 1,
  colorCurv: '#000000', weightCurv: 1, opacityCurv: 1, dashCurv: 'solid',
  hypsoCurv: false, hypsoModeCurv: 'elevation', hypsoBandedCurv: false, hypsoIntervalCurv: 10,
  // Swiss rock & scree — seedSwiss: same seed, same stroke wobble + scree pattern
  enabledSwiss: false, spacingSwiss: 2, thresholdSwiss: 0.45, lengthSwiss: 1, screeSwiss: 0.5, screeWeightSwiss: 2.5, seedSwiss: 42,
  colorSwiss: '#000000', weightSwiss: 1, opacitySwiss: 1, dashSwiss: 'solid',
  hypsoSwiss: false, hypsoModeSwiss: 'elevation', hypsoBandedSwiss: false, hypsoIntervalSwiss: 10,

  // GPX Track
  colorGpx: '#a80000', weightGpx: 2, opacityGpx: 1, dashGpx: 'solid',
  hypsoGpx: false, hypsoModeGpx: 'elevation', hypsoBandedGpx: false, hypsoIntervalGpx: 10,

  // Hillshade
  showHillshade: false, hillshadeAzimuth: 315, hillshadeAltitude: 45,
  hillshadeIntensity: 1.0, hillshadeOpacity: 0.6, hillshadeExaggeration: 2.0,
  hillshadeHighlightColor: '#ffffff', hillshadeShadowColor: '#000000',
  hillshadeCastShadows: false, hillshadeShadowSteps: 64,
  hillshadeShadowSoftness: 1.5, hillshadeShadowDarkness: 0.85,
  showSun: false,

  // Multi-directional hillshade
  hillshadeMultiDir: false,

  // Slope & Aspect shading
  showSlopeShade: false, slopeShadeOpacity: 0.75, slopeColorLow: '#86efac', slopeColorHigh: '#dc2626',

  // Aspect map overlay
  showAspectMap: false, aspectMapOpacity: 0.8,

  // Ambient occlusion (Sky View Factor)
  showAO: false, aoStrength: 0.7, aoRays: 8,

  // Water fill
  showWaterFill: false, waterLevel: 0.3, waterColor: '#1a78c2', waterOpacity: 0.82,

  // Tanaka contours
  tanakaContours: false, tanakaSunAzimuth: 315, tanakaWeightBright: 2.5, tanakaWeightDark: 0.5,

  // Global Gradient Stops
  gradientStops: GRADIENT_PRESETS['Jet'],
}

export const POINTS_DEF = {
  showPoints: false, pointColor: '#2e7bff', pointSize: 4,
  // Grid-cell stride between particles: 1 = one per cell (dense carpet),
  // higher = sparse field. The only density control — the home buffer is
  // otherwise one particle per valid terrain cell.
  particleSpacing: 1,
  // Hologram field (GPU-animated). `animateParticles` toggles the motion.
  animateParticles: true,
  holoGlowColor: '#7df9ff', holoFloat: 1, holoNoiseAmt: 1, holoNoiseScale: 1,
  holoFlowSpeed: 1, holoMaskContrast: 1.5, holoShimmer: 0.4,
}
export const VIEW_DEF = {
  tilt: 50, rotation: 0, zoom: 0.75,
  fov: 60, orthographic: false,
  // Supersampling multiplier on top of the device pixel ratio. Dense 1px line
  // fields are undersampled and "boil" during pan/rotate; 2× rendering cuts
  // hard pixel flips by ~97% (measured) at 4× fragment cost. Render-side only.
  renderScale: 1,
  panX: 0, panY: 0,
  autoRotate: false, autoRotateSpeed: 0.2, autoRotateAxis: 'Y', autoRotateDir: 1,
  showGuides: false, showRawTerrain: false,
}
