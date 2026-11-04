/**
 * Carry a plate drawn under the old soft inks into exact inks.
 *
 * Until format 10 every line ink went through the viewport's ACES curve, so a
 * stored hex was not the colour the plate showed: `#39ff6a` drew as `#b6e3c1`.
 * Inks are now drawn as picked, so a plate keeps its look only if each line ink
 * is rewritten as the colour the curve made of it.
 *
 * Only inks the line layers draw change. The paper, the surface shading, the
 * particles and the sheet furniture are drawn as they were, so their colours
 * stay. A key a sparse preset leaves out takes the default the plate drew with,
 * curved, because the default itself now draws exact.
 */
import { STYLE_DEF } from '../defaults'
import { DRAW_MODE_IDS } from './drawModes'
import { hexToRgb } from './colorUtils'
import { screenInk, screenInkHex } from './screenInk'

/** Style colours that are not line inks: the paper, the surface, particles, furniture. */
const NOT_INK = /^(bgColor|bgGradient|fillColor$|meshColor|hillshade|slopeColor|localRelief|curvShade|aerialColor|wetnessColor|sunTint|waterColor|pointColor|holoGlowColor|flockShadowColor|frameMarkColor|anaglyph|inksAsPicked)/

/** Mode ids, longest first, so `colorPillarsAbove` belongs to PillarsAbove, not Above. */
const MODE_BY_LENGTH = [...DRAW_MODE_IDS].sort((a, b) => b.length - a.length)

/** Pillars' lid and the pillars above the ground, named apart from the mode. */
const PILLAR_INK = /^(pillarLidColor|colorPillarsAbove)$/

const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** Every hex in a value, curved: an ink, a mode copy's values, a text layer. */
function curveAll(v) {
  if (isHex(v)) return screenInkHex(v)
  if (Array.isArray(v)) return v.map(curveAll)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, curveAll(x)]))
  return v
}

/** Whether any line layer inks from the elevation gradient. */
function linesUseRamp(style) {
  const on = (s) => Object.entries(s ?? {}).some(([k, v]) =>
    v === true && (k === 'lineHypsometric' || (/^hypso[A-Z]/.test(k) && !/^hypso(Mode|Banded|Interval)/.test(k))))
  return on(style) || (style.modeCopies ?? []).some((c) => on(c.values))
}

const toRgb8 = (hex) => hexToRgb(hex).map((c) => Math.round(c * 255))
const far = (a, b, tol) => a.some((v, i) => Math.abs(v - b[i]) > tol)
const hex2 = (c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')

/**
 * The gradient as the curve showed it. The curve is not straight, so the colour
 * between two curved stops is not the curved colour between them: Jet's blue to
 * cyan bent through a pale blue the straight blend misses. Stops are added at
 * midpoints until the blend is within two levels of the curve.
 */
export function curveStops(stops) {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos)
  const out = []
  const split = (a, b, depth) => {
    const ca = hexToRgb(a.color), cb = hexToRgb(b.color)
    const sa = toRgb8(screenInkHex(a.color)), sb = toRgb8(screenInkHex(b.color))
    // Tested at the quarters as well as the middle: a ramp can bend near one end.
    const bent = [0.25, 0.5, 0.75].some((t) => far(
      sa.map((v, i) => v + (sb[i] - v) * t),
      toRgb8(screenInk(...ca.map((v, i) => v + (cb[i] - v) * t))), 2))
    if (depth >= 6 || !bent) return
    const mid = { pos: (a.pos + b.pos) / 2, color: '#' + ca.map((v, i) => hex2(((v + cb[i]) / 2) * 255)).join('') }
    split(a, mid, depth + 1); out.push(mid); split(mid, b, depth + 1)
  }
  sorted.forEach((s, i) => { if (i) split(sorted[i - 1], s, 0); out.push(s) })
  return out.map((s) => ({ ...s, pos: Math.round(s.pos * 1e4) / 1e4, color: screenInkHex(s.color) }))
}

const lum = (rgb) => rgb[0] + rgb[1] + rgb[2]

/**
 * Mineral's grain under the curve. Each cell is its material's ink times a
 * grain factor, and the curve flattened that factor where an ink is pale: the
 * same grain reads twice as strong once the ink is drawn as picked. The grain
 * is scaled by how much the curve kept of it, averaged over the five materials.
 */
function grainUnderCurve(style) {
  if (!style.enabledMineral) return null
  const grain = style.grainMineral ?? STYLE_DEF.grainMineral
  if (!(grain > 0)) return null
  const keep = ['A', 'B', 'C', 'D', 'E'].map((m) => {
    const c = hexToRgb(style[`color${m}Mineral`] ?? STYLE_DEF[`color${m}Mineral`])
    const lo = c.map((v) => v * (1 - grain / 2)), hi = c.map((v) => Math.min(1, v * (1 + grain / 2)))
    const soft = lum(hexToRgb(screenInk(...hi))) - lum(hexToRgb(screenInk(...lo)))
    const exact = lum(hexToRgb(screenInk(...c))) * grain
    return exact > 1e-6 ? soft / exact : 1
  })
  const k = keep.reduce((s, v) => s + v, 0) / keep.length
  return Math.round(Math.min(1, Math.max(0, grain * k)) * 1000) / 1000
}

/**
 * A preset or session payload, its line inks rewritten as the soft curve drew
 * them. A plate that already drew inks as picked loses only the switch.
 *
 * `full` fills inks the style leaves out from the defaults, curved. A payload
 * that is merged over the defaults needs it; one that carries every key does not.
 */
export function softenInks(payload, { full = true } = {}) {
  const { inksAsPicked, ...style } = payload.style ?? {}
  if (inksAsPicked === true) return { ...payload, style }
  const out = { ...style }
  for (const [k, v] of Object.entries(style)) if (!NOT_INK.test(k)) out[k] = curveAll(v)
  if (full) {
    // Only for marks the plate draws, itself or as a copy, and the inks no mark
    // owns. A mark it turns on later starts from the default, as on any plate.
    const drawn = new Set([
      ...DRAW_MODE_IDS.filter((m) => style[`enabled${m}`]),
      ...(style.modeCopies ?? []).map((c) => c.mode),
    ])
    for (const [k, v] of Object.entries(STYLE_DEF)) {
      if (k in style || NOT_INK.test(k) || !isHex(v)) continue
      const owner = PILLAR_INK.test(k) ? 'Pillars' : MODE_BY_LENGTH.find((m) => k.endsWith(m))
      if (owner && !drawn.has(owner)) continue
      const soft = screenInkHex(v)
      if (soft !== v.toLowerCase()) out[k] = soft
    }
  }
  const grain = grainUnderCurve(style)
  if (grain != null) out.grainMineral = grain
  const next = { ...payload, style: out }
  // The gradient is shared with the surface's hypsometric fill, which still
  // draws through the curve: it is curved only when lines alone read it.
  if (Array.isArray(payload.gradientStops) && payload.gradientStops.length > 1 &&
      linesUseRamp(style) && !style.fillHypsometric) {
    next.gradientStops = curveStops(payload.gradientStops)
  }
  // Vector and text layers carry their inks on their own records.
  for (const f of ['vectorLayers', 'vectorStyles', 'textLayers']) {
    if (Array.isArray(payload[f])) next[f] = payload[f].map(curveAll)
  }
  return next
}
