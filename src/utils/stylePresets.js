/**
 * Configuration for THREE.LineMaterial dash properties.
 */
export const DASH_CONFIGS = {
  solid:       { dashed: false },
  dashed:      { dashed: true,   dashSize: 4,  gapSize: 3 },
  dotted:      { dashed: true,   dashSize: 1.5, gapSize: 4 },
  'long-dash': { dashed: true,   dashSize: 12,  gapSize: 5 },
}

/** 
 * SVG stroke-dasharray value for each dash style (empty = no dashes). 
 */
export const DASH_SVG = {
  solid:       '',
  dashed:      '3 2',
  dotted:      '2 5',
  'long-dash': '16 6',
}
