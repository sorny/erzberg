import { GRADIENT_PRESETS } from './gradientPresets'

/**
 * One-click style presets — each bundles enabled modes and their 
 * unique layered parameters into a named look.
 */
export const STYLE_PRESETS = {
  'Swiss Topo': {
    style: {
      enabledContours: true,
      colorContours: '#7b4f2e', intervalContours: 2, weightContours: 1, opacityContours: 1, dashContours: 'solid', hypsoContours: false,
      bgColor: '#f2ede4', bgGradient: false,
      showFill: false, showMesh: false, depthOcclusion: true,
    },
    gradientStops: null,
  },

  'Neon City': {
    style: {
      enabledX: true,
      colorX: '#00f2ff', spacingX: 4, weightX: 1.5, opacityX: 1, dashX: 'solid', hypsoX: true, hypsoModeX: 'elevation', hypsoBandedX: false,
      showFill: true, fillColor: '#0d0221',
      fillHypsometric: true, fillBanded: false, fillHypsoMode: 'elevation',
      bgColor: '#050505', bgGradient: false,
      showMesh: false, depthOcclusion: true,
    },
    gradientStops: [
      { pos: 0, color: '#0d0221' },
      { pos: 0.5, color: '#b000ff' },
      { pos: 1, color: '#00ffe7' }
    ],
  },

  'Blueprint': {
    style: {
      enabledX: true, enabledY: true,
      colorX: '#c8e8ff', spacingX: 4, weightX: 0.5, opacityX: 1, dashX: 'dashed', hypsoX: false,
      colorY: '#c8e8ff', spacingY: 4, weightY: 0.5, opacityY: 0.5, dashY: 'solid', hypsoY: false,
      bgColor: '#0d2b4e', bgGradient: false,
      showFill: false, showMesh: false, depthOcclusion: true,
    },
    gradientStops: null,
  },

  'Burnt Paper': {
    style: {
      enabledX: true,
      colorX: '#1a1005', spacingX: 4, weightX: 1.2, opacityX: 1, dashX: 'solid', hypsoX: true, hypsoModeX: 'elevation', hypsoBandedX: false,
      showFill: true, fillColor: '#000000',
      fillHypsometric: true, fillBanded: false, fillHypsoMode: 'elevation',
      bgColor: '#d9cbb4', bgGradient: false,
      showMesh: false, depthOcclusion: true,
    },
    gradientStops: [
      { pos: 0,    color: '#000000' },
      { pos: 0.35, color: '#442200' },
      { pos: 0.7,  color: '#ff7b3a' },
      { pos: 1,    color: '#ffe066' },
    ],
  },
}

/** Configuration for THREE.LineMaterial dash properties. */
export const DASH_CONFIGS = {
  solid:       { dashed: false },
  dashed:      { dashed: true,   dashSize: 4,  gapSize: 3 },
  dotted:      { dashed: true,   dashSize: 1.5, gapSize: 4 },
  'long-dash': { dashed: true,   dashSize: 12,  gapSize: 5 },
}

/** SVG stroke-dasharray value for each dash style (empty = no dashes). */
export const DASH_SVG = {
  solid:       '',
  dashed:      '3 2',
  dotted:      '2 5',
  'long-dash': '16 6',
}
