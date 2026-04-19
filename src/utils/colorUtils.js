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
  const { lineColor, lineGradient, gradientStops } = params

  if (lineGradient && gradientStops && gradientStops.length > 1) {
    return sampleGradient(gradientStops, normElev)
  }

  return hexToRgb(lineColor)
}
