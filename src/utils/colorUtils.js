/** Parse '#rrggbb' → [r,g,b] in 0–1 range */
export function hexToRgb(hex) {
  const n = parseInt((hex || '#000000').replace('#', ''), 16)
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255]
}

/** Lerp two [r,g,b] triples */
export function lerpRgb(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

/**
 * Sample a multi-stop gradient (sorted by pos 0→1).
 * stops: [{ pos: 0–1, color: '#rrggbb' }]
 */
export function sampleGradient(stops, t) {
  if (!stops || stops.length === 0) return [1, 1, 1]
  if (stops.length === 1) return hexToRgb(stops[0].color)
  t = Math.max(0, Math.min(1, t))
  const sorted = [...stops].sort((a, b) => a.pos - b.pos)
  if (t <= sorted[0].pos) return hexToRgb(sorted[0].color)
  if (t >= sorted[sorted.length - 1].pos) return hexToRgb(sorted[sorted.length - 1].color)
  for (let i = 1; i < sorted.length; i++) {
    if (t <= sorted[i].pos) {
      const local = (t - sorted[i - 1].pos) / (sorted[i].pos - sorted[i - 1].pos)
      return lerpRgb(hexToRgb(sorted[i - 1].color), hexToRgb(sorted[i].color), local)
    }
  }
  return hexToRgb(sorted[sorted.length - 1].color)
}

/**
 * Compute per-vertex [r, g, b] for a given elevation and slope.
 *
 * strokeByElev: simulated by lerping line colour toward background colour at low
 * elevations (WebGL cannot vary linewidth per-vertex; this gives a visual
 * light→heavy progression by making low-elevation lines appear faded/thin).
 *
 * @param {number} normElev  0–1 within the rendered elevation range
 * @param {number} slope     raw slope gradient magnitude
 * @param {object} params    all visual params (from Leva + gradientStops)
 * @param {object} terrain   { maxSlope }
 */
export function computeVertexColor(normElev, slope, params, terrain) {
  const {
    lineColor, lineColorHigh,
    lineGradient, gradientStops,
    strokeByElev, strokeElevLow, strokeElevHigh,
    slopeOpacity,
    bgColor,
  } = params

  let rgb

  if (lineGradient) {
    if (gradientStops && gradientStops.length > 1) {
      rgb = sampleGradient(gradientStops, normElev)
    } else {
      rgb = lerpRgb(hexToRgb(lineColor), hexToRgb(lineColorHigh), normElev)
    }
  } else {
    rgb = hexToRgb(lineColor)
  }

  // Stroke-weight-by-elevation: lerp toward bgColor at low elevations.
  // Simulates a thinner (less opaque) stroke where elevation is low.
  if (strokeByElev) {
    const lo = strokeElevLow  ?? 0
    const hi = strokeElevHigh ?? 1
    const t  = hi > lo ? Math.max(0, Math.min(1, (normElev - lo) / (hi - lo))) : 1
    const weight = 0.1 + 0.9 * t   // 0.1 at low end, 1.0 at high end
    const bg = hexToRgb(bgColor ?? '#ffffff')
    rgb = lerpRgb(bg, rgb, weight)
  }

  // Slope-opacity: premultiply toward zero (transparent) for flat areas
  if (slopeOpacity && terrain.maxSlope > 0) {
    const ns = Math.min(1, slope / terrain.maxSlope)
    const alpha = Math.max(0.05, ns)
    const bg = hexToRgb(bgColor ?? '#ffffff')
    rgb = lerpRgb(bg, rgb, alpha)
  }

  return rgb  // [r, g, b]
}
