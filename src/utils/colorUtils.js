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
 * Decoupled for lines only (see lineHypsometric params).
 *
 * @param {number} normElev  0–1 within the rendered elevation range
 * @param {number} normSlope 0–1 normalised slope magnitude
 * @param {number} aspect    Aspect angle in radians
 * @param {object} params    All visual params (from levaSet)
 */
export function computeVertexColor(normElev, normSlope, aspect, params) {
  const { 
    lineColor, lineHypsometric, lineBanded, 
    lineHypsoMode, lineHypsoInterval, gradientStops 
  } = params

  if (!lineHypsometric || !gradientStops || gradientStops.length < 2) {
    return hexToRgb(lineColor)
  }

  let val = normElev
  if (lineHypsoMode === 'slope') val = normSlope
  else if (lineHypsoMode === 'aspect') val = aspect / (Math.PI * 2) + 0.5

  if (lineBanded) {
    const steps = 100 / (lineHypsoInterval || 10)
    val = Math.floor(val * steps) / steps
  }

  return sampleGradient(gradientStops, Math.max(0, Math.min(1, val)))
}
