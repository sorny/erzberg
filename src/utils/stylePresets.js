/**
 * Configuration for THREE.LineMaterial dash properties.
 */
export const DASH_CONFIGS = {
  solid:       { dashed: false },
  dashed:      { dashed: true,   dashSize: 4,  gapSize: 3 },
  // Short dashes. The id is historical — presets, OSM path defaults and Fall
  // Line's run-in all say `dotted` — so it keeps it, and the panel calls it
  // "short". Round dots are `dots`, below.
  dotted:      { dashed: true,   dashSize: 1.5, gapSize: 4 },
  'long-dash': { dashed: true,   dashSize: 12,  gapSize: 5 },
  // Not a dash pattern: the line is replaced by round dots, one near-zero
  // segment each, which LineMaterial caps round — the way Stipple draws.
  dots:        { dashed: false, dots: true },
}

/**
 * Centre-to-centre spacing of the dots in a `dots` line, for a given weight.
 *
 * Tied to the weight so a heavier line gets bigger dots *and* keeps a gap
 * between them; a fixed spacing ran the dots together into a bead chain at the
 * top of the weight range. World units in the viewport, where one unit is about
 * one pixel at the opening zoom, and the same ratio in the SVG.
 *
 * `step` is the layer's own `dotStep<Id>`, in dot diameters. At DOT_STEP the
 * spacing is the one every dotted line had before the control existed.
 */
export const DOT_STEP = 2.2

export function dotSpacing(weight, step = DOT_STEP) {
  const s = Number.isFinite(step) && step > 0 ? step : DOT_STEP
  return Math.max(3, (weight || 1) * DOT_STEP) * (s / DOT_STEP)
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
  dots:        { dots: true },
}
