/**
 * One-click style presets — each bundles drawMode, colors, stroke, fill,
 * gradient, and dash pattern into a named look.
 *
 * DASH_CONFIGS maps lineDash → LineMaterial props.
 * DASH_SVG     maps lineDash → SVG stroke-dasharray string.
 */

// ── Named presets ─────────────────────────────────────────────────────────────

export const STYLE_PRESETS = {
  'Swiss Topo': {
    style: {
      drawMode: 'contours',
      lineColor: '#7b4f2e', bgColor: '#f2ede4',
      strokeWeight: 1, showFill: false, showMesh: false,
      hypsometricFill: false, contourInterval: 2, lineDash: 'solid',
    },
    gradientStops: null,   // leave gradient unchanged
  },

  'Neon City': {
    style: {
      drawMode: 'lines-x',
      lineColor: '#00ffcc', bgColor: '#06050f',
      strokeWeight: 1, showFill: true, showMesh: false,
      hypsometricFill: true, lineDash: 'solid',
    },
    gradientStops: [
      { pos: 0,    color: '#06050f' },
      { pos: 0.28, color: '#1a0060' },
      { pos: 0.56, color: '#00ccff' },
      { pos: 0.82, color: '#ff00cc' },
      { pos: 1,    color: '#ffffff' },
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
      lineColor: '#c86420', bgColor: '#140802',
      strokeWeight: 1.5, showFill: true, showMesh: false,
      hypsometricFill: true, lineDash: 'solid',
    },
    gradientStops: [
      { pos: 0,    color: '#0d0400' },
      { pos: 0.28, color: '#5c1800' },
      { pos: 0.56, color: '#c86420' },
      { pos: 0.8,  color: '#e8a020' },
      { pos: 1,    color: '#fff4c0' },
    ],
  },
}

// ── Dash configs ──────────────────────────────────────────────────────────────

/** LineMaterial properties for each dash style. */
export const DASH_CONFIGS = {
  solid:      { dashed: false,  dashSize: 5,   gapSize: 3 },
  dashed:     { dashed: true,   dashSize: 5,   gapSize: 3 },
  dotted:     { dashed: true,   dashSize: 1.5, gapSize: 4 },
  'long-dash':{ dashed: true,   dashSize: 12,  gapSize: 5 },
}

/** SVG stroke-dasharray value for each dash style (empty = no dashes). */
export const DASH_SVG = {
  solid:       '',
  dashed:      '6 4',
  dotted:      '2 5',
  'long-dash': '16 6',
}
