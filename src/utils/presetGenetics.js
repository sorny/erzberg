/**
 * Rolling a look.
 *
 * Blind randomness over ~250 parameters produces mud: three heavy modes stacked
 * on top of each other, black ink on a black background, a gradient nothing
 * reads from. So `randomPreset` is a *recipe* — it makes a handful of decisions
 * in the order a person would (paper or ink, which marks, which palette, one
 * overlay at most) and derives the rest from them.
 *
 * Everything is driven by a seeded RNG, so a roll is reproducible: the same seed
 * always yields the same look, which is what lets the seed be displayed and
 * stepped back to.
 *
 * Output shape matches a preset JSON's `{ style, points, gradientStops,
 * bgGradientStops }`, so `applyPreset` in Sidebar.jsx consumes it unchanged.
 */
import { hexToRgb } from './colorUtils'
import { DRAW_MODES } from './drawModes'
import { GRADIENT_PRESETS } from './gradientPresets'
import { STYLE_DEF } from '../defaults'

// ── RNG ───────────────────────────────────────────────────────────────────────

/** mulberry32 — small, fast, and good enough that successive rolls don't rhyme. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const between = (rng, lo, hi) => lo + rng() * (hi - lo)
const intBetween = (rng, lo, hi) => Math.floor(between(rng, lo, hi + 1))
const roundTo = (v, step) => Math.round(v / step) * step
const chance = (rng, p) => rng() < p
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]

function weightedPick(rng, entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  for (const [value, w] of entries) { r -= w; if (r <= 0) return value }
  return entries[entries.length - 1][0]
}

function shuffled(rng, arr) {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ── Colour ────────────────────────────────────────────────────────────────────

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** Perceptual-ish luminance, 0–1. Used only to keep ink off its own background. */
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** A ramp of 3–5 stops walking a hue, always ascending in lightness. */
function generateRamp(rng) {
  const stops = intBetween(rng, 3, 5)
  const baseHue = rng() * 360
  const spread = between(rng, 20, 140) * (chance(rng, 0.5) ? 1 : -1)
  const sat = between(rng, 0.35, 0.95)
  const out = []
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1)
    out.push({
      pos: +t.toFixed(3),
      color: hslToHex((baseHue + spread * t + 360) % 360, sat * (1 - 0.25 * t), 0.12 + 0.75 * t),
    })
  }
  return out
}

const PAPERS = ['#ffffff', '#f7f3ea', '#f0ebe3', '#eef1f2', '#f5efe6']
const INKS   = ['#0b0b0d', '#101010', '#12141a', '#0a0f14', '#161213']

// ── Rolling a look ────────────────────────────────────────────────────────────

/**
 * @param {number} seed
 * @returns {{ style: object, points: object, gradientStops: Array, bgGradientStops: Array, seed: number }}
 */
export function randomPreset(seed) {
  const rng = mulberry32(seed)
  const style = { ...STYLE_DEF }

  // Every mode off to start with; the roll switches on what it wants.
  for (const m of DRAW_MODES) style[`enabled${m.id}`] = false

  // 1 ── palette, decided first because the ink is drawn from it
  const gradientStops = chance(rng, 0.6)
    ? GRADIENT_PRESETS[pick(rng, Object.keys(GRADIENT_PRESETS))]
    : generateRamp(rng)

  // 2 ── paper, ink, or a tint pulled from the palette
  const surface = weightedPick(rng, [['paper', 0.4], ['ink', 0.45], ['tint', 0.15]])
  const paletteHue = rng() * 360
  const bgColor = surface === 'paper' ? pick(rng, PAPERS)
                : surface === 'ink'   ? pick(rng, INKS)
                : hslToHex(paletteHue, between(rng, 0.15, 0.5), between(rng, 0.12, 0.3))
  style.bgColor = bgColor
  const bgLum = luminance(bgColor)
  const onDark = bgLum < 0.4

  style.bgGradient = chance(rng, 0.2)
  const bgGradientStops = style.bgGradient
    ? [{ pos: 0, color: bgColor },
       { pos: 1, color: hslToHex(paletteHue, between(rng, 0.2, 0.6), onDark ? between(rng, 0.02, 0.1) : between(rng, 0.75, 0.95)) }]
    : [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#cccccc' }]

  // 3 ── which marks. A cost budget rather than a count: three cheap layers is a
  //      fine picture, three expensive ones is a slideshow.
  let budget = between(rng, 3, 6)
  const chosen = []
  for (const mode of shuffled(rng, DRAW_MODES)) {
    if (chosen.length >= 3) break
    if (mode.cost > budget && chosen.length > 0) continue
    chosen.push(mode)
    budget -= mode.cost
  }

  // 4 ── hypsometric or flat ink, decided once for the whole look
  const hypso = chance(rng, 0.35)

  // 5 ── per-mode parameters
  for (const mode of chosen) {
    const id = mode.id
    const p = mode.pick
    style[`enabled${id}`] = true
    style[`weight${id}`]  = +between(rng, 0.6, id === 'Stipple' ? 4 : 2.4).toFixed(1)
    style[`opacity${id}`] = +between(rng, 0.55, 1).toFixed(2)
    style[`dash${id}`]    = weightedPick(rng, [['solid', 0.85], ['dashed', 0.06], ['dotted', 0.06], ['long-dash', 0.03]])
    style[`color${id}`]   = inkColor(rng, gradientStops, onDark, bgLum)
    style[`hypso${id}`]   = hypso
    style[`hypsoMode${id}`] = pick(rng, ['elevation', 'slope'])

    if (p.spacing)   style[`spacing${id}`]   = +roundTo(between(rng, ...p.spacing), id === 'Stipple' ? 0.05 : 0.5).toFixed(2)
    if (p.angle)     style[`angle${id}`]     = Math.round(between(rng, ...p.angle))
    if (p.shift)     style[`shift${id}`]     = Math.round(between(rng, ...p.shift))
    if (p.length)    style[`length${id}`]    = +between(rng, ...p.length).toFixed(2)
    if (p.threshold) style[`threshold${id}`] = +between(rng, ...p.threshold).toFixed(2)
    if (p.radius)    style[`radius${id}`]    = Math.round(between(rng, ...p.radius))
    if (p.gamma)     style[`gamma${id}`]     = +between(rng, ...p.gamma).toFixed(2)
    if (p.levels)    style[`levels${id}`]    = intBetween(rng, ...p.levels)
    if (p.step)      style[`step${id}`]      = +between(rng, ...p.step).toFixed(2)
    if (p.maxLen)    style[`maxLen${id}`]    = Math.round(between(rng, ...p.maxLen))
    if (p.interval)  style[`interval${id}`]  = Math.round(between(rng, ...p.interval))
    if (p.jitter)    style[`jitter${id}`]    = +between(rng, ...p.jitter).toFixed(2)
    if (p.scree)     style[`scree${id}`]     = +between(rng, ...p.scree).toFixed(2)
    if (p.majorInterval) style[`majorInterval${id}`] = Math.round(between(rng, ...p.majorInterval))
    if (p.smoothing) style[`smoothing${id}`] = intBetween(rng, ...p.smoothing)
    if (p.pillarGap)   style.pillarGap   = +between(rng, ...p.pillarGap).toFixed(2)
    if (p.pillarDepth) style.pillarDepth = Math.round(between(rng, ...p.pillarDepth))
    if (p.pillarSize)  style.pillarSize  = +between(rng, ...p.pillarSize).toFixed(2)
  }

  // Reproducible stochastic modes get a seed of their own, derived from this one.
  style.seedStipple = intBetween(rng, 1, 9999)
  style.seedSwiss   = intBetween(rng, 1, 9999)

  // 6 ── at most one surface overlay: they compete for the same pixels
  if (chance(rng, 0.4)) {
    const overlay = pick(rng, ['hillshade', 'slope', 'water', 'ao'])
    style.showFill = true
    style.fillColor = onDark ? hslToHex(paletteHue, 0.15, 0.18) : hslToHex(paletteHue, 0.12, 0.85)
    style.fillHypsometric = hypso || chance(rng, 0.5)
    if (overlay === 'hillshade') {
      style.showHillshade = true
      style.hillshadeAzimuth = Math.round(between(rng, 0, 360))
      style.hillshadeAltitude = Math.round(between(rng, 20, 70))
      style.hillshadeOpacity = +between(rng, 0.35, 0.9).toFixed(2)
      style.hillshadeExaggeration = +between(rng, 1, 3).toFixed(1)
      style.hillshadeMultiDir = chance(rng, 0.3)
    } else if (overlay === 'slope') {
      style.showSlopeShade = true
      style.slopeShadeOpacity = +between(rng, 0.4, 0.9).toFixed(2)
      style.slopeColorLow  = hslToHex((paletteHue + 150) % 360, 0.5, 0.65)
      style.slopeColorHigh = hslToHex(paletteHue, 0.7, 0.45)
    } else if (overlay === 'water') {
      style.showWaterFill = true
      style.waterLevel = +between(rng, 0.1, 0.5).toFixed(2)
      style.waterColor = hslToHex(between(rng, 180, 230), between(rng, 0.4, 0.9), between(rng, 0.3, 0.55))
      style.waterOpacity = +between(rng, 0.5, 0.9).toFixed(2)
    } else {
      style.showAO = true
      style.aoStrength = +between(rng, 0.4, 1).toFixed(2)
      style.aoRays = pick(rng, [8, 12, 16])
    }
  }

  // 7 ── occlusion. Mostly plain hidden-line removal; occasionally an X-ray.
  style.depthOcclusion = chance(rng, 0.85)
  if (style.depthOcclusion && chance(rng, 0.25)) {
    style.occlusionOpacity = +between(rng, 0.08, 0.35).toFixed(2)
    style.occlusionColor = inkColor(rng, gradientStops, onDark, bgLum)
  } else {
    style.occlusionOpacity = 0
  }

  style.gradientStops = gradientStops

  // 8 ── particles, rarely
  const points = { showPoints: false }
  if (chance(rng, 0.12)) {
    points.showPoints = true
    points.pointColor = inkColor(rng, gradientStops, onDark, bgLum)
    points.pointSize = +between(rng, 1.5, 6).toFixed(1)
    points.particleSpacing = intBetween(rng, 1, 6)
    points.animateParticles = chance(rng, 0.6)
    points.holoGlowColor = hslToHex(paletteHue, 0.9, 0.65)
  }

  // 9 ── sanity: something has to be visible
  const drawsSomething = chosen.length > 0 || style.showFill || points.showPoints
  if (!drawsSomething) {
    style.enabledLines = true
    style.colorLines = onDark ? '#ffffff' : '#000000'
  }

  return { style, points, gradientStops, bgGradientStops, seed }
}

/**
 * An ink colour that will actually be seen: drawn from the palette when it
 * contrasts with the background, and falling back to plain contrast ink when it
 * does not. Without this, roughly a fifth of dark rolls came back as a black
 * line on a black field — technically a valid point in the space, and not a
 * picture anybody wanted.
 */
function inkColor(rng, stops, onDark, bgLum) {
  if (chance(rng, 0.55)) {
    const candidate = pick(rng, stops).color
    if (Math.abs(luminance(candidate) - bgLum) > 0.25) return candidate
  }
  return onDark
    ? hslToHex(rng() * 360, between(rng, 0, 0.25), between(rng, 0.82, 0.98))
    : hslToHex(rng() * 360, between(rng, 0, 0.35), between(rng, 0.04, 0.22))
}
