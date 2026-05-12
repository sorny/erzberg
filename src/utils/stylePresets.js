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

/**
 * Pixel sizes used to split segments into real dash sub-segments for SVG export.
 * Null = solid (no splitting needed).
 */
export const DASH_SEGMENT_SIZES = {
  solid:       null,
  dashed:      { dashPx: 3,  gapPx: 2 },
  dotted:      { dashPx: 2,  gapPx: 5 },
  'long-dash': { dashPx: 16, gapPx: 6 },
}
