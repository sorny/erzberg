/** Parse '#rrggbb' → [r,g,b] in 0–1 range. Cached: computeVertexColor calls this
 *  once per vertex in the geometry worker, almost always with the same few strings. */
const _hexCache = new Map()
export function hexToRgb(hex) {
  const key = hex || '#000000'
  let rgb = _hexCache.get(key)
  if (rgb) return rgb
  const n = parseInt(key.replace('#', ''), 16)
  rgb = [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255]
  _hexCache.set(key, rgb)
  return rgb
}

/** Lerp two [r,g,b] triples */
export function lerpRgb(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]
}

/* Rotating scratch pool for interpolated gradient samples. computeVertexColor
 * runs once per vertex in the geometry worker; a fresh [r,g,b] per call is pure
 * GC pressure. Callers hold at most two results at a time (segment endpoints),
 * so a 4-slot pool is safe — copy the result if it must outlive the next calls. */
const _lerpPool = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
let _lerpPoolIdx = 0
function lerpRgbPooled(a, b, t) {
  const out = _lerpPool[_lerpPoolIdx = (_lerpPoolIdx + 1) & 3]
  out[0] = a[0] + (b[0] - a[0]) * t
  out[1] = a[1] + (b[1] - a[1]) * t
  out[2] = a[2] + (b[2] - a[2]) * t
  return out
}

/**
 * Sample a multi-stop gradient (sorted by pos 0→1).
 * stops: [{ pos: 0–1, color: '#rrggbb' }]
 *
 * Single-slot memo: the same `stops` array is reused for every vertex within one
 * geometry build, so we sort + pre-parse it once and reuse until the reference
 * changes. React state treats `gradientStops` immutably, so a new edit = new array.
 */
let _gradStops = null
let _gradPrepared = null
function prepareStops(stops) {
  if (stops === _gradStops) return _gradPrepared
  _gradStops = stops
  _gradPrepared = stops
    .map(s => ({ pos: s.pos, rgb: hexToRgb(s.color) }))
    .sort((a, b) => a.pos - b.pos)
  return _gradPrepared
}

/** NOTE: the returned triple may come from a small rotating pool — treat it as
 *  read-only and copy it if it must be retained across further sample calls. */
export function sampleGradient(stops, t) {
  if (!stops || stops.length === 0) return [1, 1, 1]
  if (stops.length === 1) return hexToRgb(stops[0].color)
  t = Math.max(0, Math.min(1, t))
  const sorted = prepareStops(stops)
  if (t <= sorted[0].pos) return sorted[0].rgb
  const last = sorted[sorted.length - 1]
  if (t >= last.pos) return last.rgb
  for (let i = 1; i < sorted.length; i++) {
    if (t <= sorted[i].pos) {
      const local = (t - sorted[i - 1].pos) / (sorted[i].pos - sorted[i - 1].pos)
      return lerpRgbPooled(sorted[i - 1].rgb, sorted[i].rgb, local)
    }
  }
  return last.rgb
}

/**
 * Compute per-vertex [r, g, b] for a given elevation and slope.
 * Decoupled for lines only (see lineHypsometric params).
 *
 * @param {number} normElev  0–1 within the rendered elevation range
 * @param {number} normSlope 0–1 normalised slope magnitude
 * @param {number} aspect    Aspect angle in radians
 * @param {object} params    All visual params
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
