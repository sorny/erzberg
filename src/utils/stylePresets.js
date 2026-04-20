import { GRADIENT_PRESETS } from './gradientPresets'

/**
 * One-click style presets — each bundles drawMode, colors, stroke, fill,
 * gradient, and dash pattern into a named look.
 */
export const STYLE_PRESETS = {
  'Swiss Topo': {
    style: {
      drawMode: ['contours'],
      lineColor: '#7b4f2e', bgColor: '#f2ede4',
      strokeWeight: 1, showFill: false, showMesh: false,
      hypsometricFill: false, contourInterval: 2, lineDash: 'solid',
    },
    gradientStops: null,
  },

  'Neon City': {
    style: {
      drawMode: 'lines-x',
      lineColor: '#00f2ff', bgColor: '#050505',
      strokeWeight: 1.5, showFill: true, showMesh: false,
      hypsometricFill: true, lineDash: 'solid',
    },
    gradientStops: [
      { pos: 0, color: '#0d0221' },
      { pos: 0.5, color: '#b000ff' },
      { pos: 1, color: '#00ffe7' }
    ],
  },

  'Blueprint': {
    style: {
      drawMode: 'lines-x',
      lineColor: '#c8e8ff', bgColor: '#0d2b4e',
      strokeWeight: 0.5, showFill: false, showMesh: false,
      hypsometricFill: false, lineDash: 'dashed',
    },
    gradientStops: null,
  },

  'Burnt Paper': {
    style: {
      drawMode: 'lines-x',
      lineColor: '#1a1005', bgColor: '#d9cbb4',
      strokeWeight: 1.2, showFill: true, showMesh: false,
      hypsometricFill: true, lineDash: 'solid',
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
  dashed:      { dashed: true,   dashSize: 10,  gapSize: 5 },
  dotted:      { dashed: true,   dashSize: 1.5, gapSize: 4 },
  'long-dash': { dashed: true,   dashSize: 12,  gapSize: 5 },
}

/** SVG stroke-dasharray value for each dash style (empty = no dashes). */
export const DASH_SVG = {
  solid:       '',
  dashed:      '6 4',
  dotted:      '2 5',
  'long-dash': '16 6',
}
