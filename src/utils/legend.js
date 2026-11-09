/**
 * The legend: what each colour and line on the plate stands for.
 *
 * Two halves, like the other sheet marks. `legendEntries` reads the plate's
 * parameters and says what there is to explain: a ramp for every colour source
 * a layer draws with, the class inks of Landforms and Land cover, the surface
 * tints, and one line sample per layer drawn in its own ink. `legendShapes`
 * lays those out as rectangles, lines and text in screen pixels, which the
 * viewport, the PNG and the SVG then draw, as they draw the scale bar.
 *
 * Only what is on screen is listed. A mode that is off, a layer that is hidden
 * and a tint at 0% opacity say nothing, so the legend cannot explain a colour
 * the plate does not show.
 *
 * Nothing here imports three.js, React or a canvas.
 */
import { DRAW_MODES, MODE_LABEL } from './drawModes'
import { LANDFORMS } from './landforms'
import { effectiveClasses } from './coverPlate'
import { sampleGradient } from './colorUtils'
import { screenInk } from './screenInk'
import { gridValueToMetres, metresPerWorldUnit } from './geoCoords'

/** The groups a legend can show, in the order it shows them, and their panel names. */
export const LEGEND_PARTS = [
  ['ramp', 'Ramps'],
  ['class', 'Classes'],
  ['surface', 'Tints'],
  ['line', 'Layers'],
]

/** The CSS font stacks the sheet marks can letter in. Generic last, so any reader has one. */
export const MARK_FONTS = {
  sans: 'sans-serif',
  mono: "Menlo, Consolas, 'DejaVu Sans Mono', monospace",
  serif: "Georgia, 'Times New Roman', serif",
}
export const markFont = (name) => MARK_FONTS[name] ?? MARK_FONTS.sans

const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)
  .toString(16).padStart(2, '0')).join('')
const fmtM = (v) => `${Math.round(v).toLocaleString('en-US').replace(/,/g, ' ')}`

/** The modes whose colour is not a line ink or a ramp: a legend line sample would say nothing true. */
const NO_LINE_SAMPLE = new Set(['Landform', 'Cover', 'Indexed', 'Mineral', 'Riso', 'Shed', 'Outrun'])

/** Read a mode's key from a copy's values first, then from the plate. */
const reader = (p, values) => (k) => (values && values[k] !== undefined ? values[k] : p[k])

/** A mode at opacity 0 draws nothing and exports nothing, so it has no legend. */
const shows = (get, id) => (get(`opacity${id}`) ?? 1) > 0

/** Every draw mode on the plate, the mode itself and each copy of it, with a name. */
function drawnModes(p) {
  const out = []
  for (const m of DRAW_MODES) {
    const get = reader(p, null)
    if (p[`enabled${m.id}`] && shows(get, m.id)) out.push({ id: m.id, key: `mode:${m.id}`, name: m.label, get })
  }
  for (const c of p.modeCopies ?? []) {
    if (!c?.mode || !c.values?.[`enabled${c.mode}`]) continue
    const get = reader(p, c.values)
    if (!shows(get, c.mode)) continue
    out.push({ id: c.mode, key: `copy:${c.uid}`, name: c.name ?? MODE_LABEL[c.mode] ?? c.mode, get })
  }
  return out
}

/** The colour source a mode draws with: 'line', or the ramp or class it reads. */
function sourceOf(get, id) {
  return get(`hypso${id}`) ? (get(`hypsoMode${id}`) ?? 'elevation') : 'line'
}

/**
 * The two ends of a ramp, in the words or numbers a reader can use.
 * Elevation is in metres when the raster is georeferenced.
 */
function rampEnds(p, source) {
  if (source === 'elevation') {
    if (p.geoTiffElevMin != null && p.geoTiffElevMax != null) {
      const lo = gridValueToMetres(0, p.geoTiffElevMin, p.geoTiffElevMax, p.blackPoint ?? 0, p.whitePoint ?? 255)
      const hi = gridValueToMetres(1, p.geoTiffElevMin, p.geoTiffElevMax, p.blackPoint ?? 0, p.whitePoint ?? 255)
      return { low: fmtM(lo), high: `${fmtM(hi)} m`, range: `${fmtM(lo)} – ${fmtM(hi)} m` }
    }
    return { low: 'Low', high: 'High', range: 'Low – high' }
  }
  if (source === 'speed') return { low: 'Slow', high: 'Fast', range: 'Slow – fast' }
  return { low: 'Gentle', high: 'Steep', range: 'Gentle – steep' }
}

const RAMP_TITLE = { elevation: 'Elevation', slope: 'Slope', speed: 'Speed' }

/**
 * The aspect ramp as four facing directions. The line colour reads
 * `atan2(gz, gx) / 2π + 0.5` of the uphill gradient, so 0 faces east, ¼ south,
 * ½ west and ¾ north.
 */
const ASPECT_SAMPLES = [[0.75, 'North-facing'], [0, 'East-facing'], [0.25, 'South-facing'], [0.5, 'West-facing']]

/**
 * What the legend explains, in order.
 *
 * @param {object} p      the shared parameters, with `gradientStops` and `modeCopies`
 * @param {object} facts  { cover, vectorLayers }: the land cover plate and the vector layer records
 * @param {object} [o]
 * @param {number} [o.steps]  how many cells a smooth ramp is drawn in
 * @returns {object[]}  entries: { kind: 'ramp'|'class'|'line', title, … }
 */
export function legendEntries(p, facts = {}, { steps = 7 } = {}) {
  const want = new Set(String(p.legendParts ?? 'ramp,class,surface,line').split(',').map((s) => s.trim()))
  const modes = drawnModes(p)
  const stops = p.gradientStops
  const out = []

  // ── Ramps: one per colour source, because every source shares one gradient ─
  if (want.has('ramp') && stops?.length >= 2) {
    const users = new Map()
    // Keyed by source and softness: a soft ramp draws other colours from the same stops.
    const addUser = (source, name, banded, interval, soft = false) => {
      const key = `${source}${soft ? ':soft' : ''}`
      if (!users.has(key)) users.set(key, { source, names: [], banded, interval, soft })
      users.get(key).names.push(name)
    }
    if (p.showFill && p.fillHypsometric) addUser(p.fillHypsoMode ?? 'elevation', 'Fill', !!p.fillBanded, p.fillHypsoInterval)
    for (const m of modes) {
      const s = sourceOf(m.get, m.id)
      if (['elevation', 'slope', 'aspect', 'speed'].includes(s)) {
        addUser(s, m.name, !!m.get(`hypsoBanded${m.id}`), m.get(`hypsoInterval${m.id}`), !!m.get(`hypsoSoft${m.id}`))
      }
    }
    for (const u of users.values()) {
      const { source } = u
      const at = (t) => { const c = sampleGradient(stops, t); return u.soft ? screenInk(c[0], c[1], c[2]) : hex(c) }
      if (source === 'aspect') {
        out.push({ kind: 'class', title: 'Aspect', items: ASPECT_SAMPLES.map(([t, name]) => ({ color: at(t), name })) })
        continue
      }
      // A banded ramp is drawn in its own bands, up to twelve. A smooth one is
      // drawn in `steps` cells, sampled at each cell's middle.
      const bands = u.banded ? Math.round(100 / (u.interval || 10)) : 0
      const n = bands >= 2 && bands <= 12 ? bands : Math.max(2, Math.min(12, Math.round(steps)))
      const colors = Array.from({ length: n }, (_, i) => at(u.banded ? i / n : (i + 0.5) / n))
      out.push({ kind: 'ramp', title: RAMP_TITLE[source] ?? source, ...rampEnds(p, source), colors })
    }
  }

  // ── Classes: the inks of a classification ─────────────────────────────────
  if (want.has('class')) {
    const formUsed = modes.some((m) => m.id === 'Landform' || sourceOf(m.get, m.id) === 'form')
    if (formUsed) {
      out.push({
        kind: 'class', title: 'Landforms',
        items: LANDFORMS.map((f, i) => ({ color: p[`color${'ABCDEFGHIJ'[i]}Landform`] ?? f.color, name: f.name })),
      })
    }
    const coverUsed = modes.some((m) => m.id === 'Cover' || ['class', 'plate'].includes(sourceOf(m.get, m.id)))
    const classes = facts.cover?.classes
    if (coverUsed && classes?.length) {
      out.push({
        kind: 'class', title: 'Land cover',
        items: effectiveClasses(classes, p.coverInks).map((c) => ({ color: c.color, name: c.name })),
      })
    }
  }

  // ── Tints on the surface ──────────────────────────────────────────────────
  if (want.has('surface')) {
    const items = []
    const on = (show, opacity) => show && (opacity ?? 1) > 0
    if (on(p.showSlopeShade, p.slopeShadeOpacity)) {
      const max = p.slopeShadeMax ?? 45
      out.push({ kind: 'ramp', title: 'Slope', low: '0°', high: `${max}°`, range: `0 – ${max}°`,
        colors: Array.from({ length: 5 }, (_, i) => mix(p.slopeColorLow, p.slopeColorHigh, (i + 0.5) / 5)) })
    }
    if (on(p.showSunTint, p.sunTintOpacity)) {
      out.push({ kind: 'ramp', title: 'Sun hours', low: 'Few', high: 'Many', range: 'Few – many',
        colors: Array.from({ length: 5 }, (_, i) => mix(p.sunTintShade, p.sunTintSun, (i + 0.5) / 5)) })
    }
    if (on(p.showLocalRelief, p.localReliefOpacity)) {
      items.push({ color: p.localReliefHigh, name: 'Above its surroundings' }, { color: p.localReliefLow, name: 'Below its surroundings' })
    }
    if (on(p.showCurvShade, p.curvShadeOpacity)) {
      items.push({ color: p.curvShadeConvex, name: 'Convex ground' }, { color: p.curvShadeConcave, name: 'Hollows' })
    }
    if (on(p.showWetness, p.wetnessOpacity)) items.push({ color: p.wetnessColor, name: 'Wet ground' })
    if (on(p.showWaterFill, p.waterOpacity)) items.push({ color: p.waterColor, name: 'Water' })
    if (items.length) out.push({ kind: 'class', title: 'Surface', items })
  }

  // ── Layers: one line sample per layer in its own ink ───────────────────────
  if (want.has('line')) {
    const items = []
    for (const m of modes) {
      if (NO_LINE_SAMPLE.has(m.id) || sourceOf(m.get, m.id) !== 'line') continue
      items.push({ key: m.key, color: m.get(`color${m.id}`) ?? '#000000', dash: m.get(`dash${m.id}`) ?? 'solid', name: lineName(p, m) })
    }
    for (const l of facts.vectorLayers ?? []) {
      if (!l || l.visible === false || !l.name || (l.opacity ?? 1) <= 0) continue
      const key = `vector:${l.id}`
      items.push(l.fill
        ? { key, color: l.fillColor ?? l.color, name: l.name, area: true }
        : { key, color: l.color ?? '#000000', dash: l.dash ?? 'solid', name: l.name })
    }
    // A name typed in the panel replaces the generated one, which is kept as
    // `base` for the panel to offer back.
    const names = legendNames(p)
    for (const it of items) {
      it.base = it.name
      if (names[it.key]) it.name = names[it.key]
    }
    // Every item stays in the list, and the ones switched off in the panel
    // are marked: the panel lists them all, and `legendShapes` skips them.
    const hide = new Set(String(p.legendHide ?? '').split(',').filter(Boolean))
    for (const it of items) if (hide.has(it.key)) it.hidden = true
    // The order set in the panel. A sample it does not name keeps its place
    // after the named ones, so a new layer joins at the foot of the list.
    const rank = new Map(String(p.legendOrder ?? '').split(',').filter(Boolean).map((k, i) => [k, i]))
    if (rank.size) {
      const at = (it, i) => (rank.has(it.key) ? rank.get(it.key) : rank.size + i)
      const sorted = items.map((it, i) => [at(it, i), it]).sort((a, b) => a[0] - b[0]).map(([, it]) => it)
      items.splice(0, items.length, ...sorted)
    }
    if (items.length) out.push({ kind: 'line', title: String(p.legendLineTitle ?? 'Layers'), items })
  }
  return out
}

/** The names typed for line samples, by sample key. `legendNames` is a JSON object. */
export function legendNames(p) {
  try {
    const o = JSON.parse(p.legendNames || '{}')
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch {
    return {}
  }
}

/** The line's name, with the contour interval in metres where the plate can say it. */
function lineName(p, m) {
  if (m.id !== 'Contours') return m.name
  const k = metresPerWorldUnit(p.geoTiffElevMin, p.geoTiffElevMax, p.elevScale, p.blackPoint ?? 0, p.whitePoint ?? 255)
  const metres = k && (m.get('intervalContours') ?? 0) * k
  return metres > 0 && Number.isFinite(metres) ? `${m.name}, ${Math.round(metres * 10) / 10} m` : m.name
}

function mix(a, b, t) {
  const pa = /^#[0-9a-f]{6}$/i.test(a ?? '') ? a : '#000000', pb = /^#[0-9a-f]{6}$/i.test(b ?? '') ? b : '#ffffff'
  const c = (s, i) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16) / 255
  return hex([0, 1, 2].map((i) => c(pa, i) + (c(pb, i) - c(pa, i)) * t))
}

/** On and off lengths of a dash style, in stroke widths. */
const DASH = { dashed: [6, 4], dotted: [1, 3], 'long-dash': [12, 5] }

/**
 * The legend as shapes in screen pixels, inside `box`.
 *
 * Rects and lines carry their own colour as a fifth element, and texts a
 * `color`. Anything without one is drawn in the marks' ink.
 *
 * @param {object[]} entries  from `legendEntries`
 * @param {object} o
 * @param {{x,y,w,h}} o.box      the sheet, or the whole canvas
 * @param {string} o.corner      'bl' | 'br' | 'tl' | 'tr'
 * @param {number} o.scale       size multiplier from the panel
 * @param {boolean} o.upper      titles in capitals, as survey sheets letter them
 * @param {boolean} o.boxed      a rule round the legend
 * @param {string|null} o.heading a line over the whole legend
 * @param {object[]} o.avoid     boxes other marks hold, so the legend moves clear of them
 * @returns {{rects, lines, texts, bounds}|null}
 */
/** The entries with the items switched off in the panel taken out, and empty groups dropped. */
export function shownEntries(entries) {
  return (entries ?? [])
    .map((e) => (e.items ? { ...e, items: e.items.filter((it) => !it.hidden) } : e))
    .filter((e) => !e.items || e.items.length)
}

export function legendShapes(all, { box, corner = 'bl', scale = 1, upper = true, boxed = false, heading = null, avoid = [] }) {
  const entries = shownEntries(all)
  if (!entries.length || !(box?.w > 0) || !(box?.h > 0)) return null
  const short = Math.min(box.w, box.h)
  const pad = short * 0.05
  const size = Math.max(6, short * 0.016 * scale)
  const lead = size * 1.35
  const cell = size * 1.15
  const glyph = 0.6
  const caps = (s) => (upper ? String(s).toUpperCase() : String(s))
  const stroke = Math.max(0.5, size * 0.08)

  // Each entry is laid out at (0, 0) first, then the whole block is moved
  // into its corner. Blocks taller than the sheet allows flow into a second column.
  const blocks = []
  for (const e of entries) {
    const b = { rects: [], lines: [], texts: [], w: 0, h: 0 }
    if (e.kind === 'ramp') {
      const n = e.colors.length
      // Highest at the top, as the ground reads.
      e.colors.slice().reverse().forEach((c, i) => b.rects.push([0, i * cell, cell * 1.2, cell, c]))
      const colH = n * cell
      b.lines.push([0, 0, cell * 1.2, 0], [cell * 1.2, 0, cell * 1.2, colH], [cell * 1.2, colH, 0, colH], [0, colH, 0, 0])
      const tx = cell * 1.2 + size * 0.7
      const words = [caps(e.title), e.range]
      words.forEach((t, i) => b.texts.push({ x: tx, y: size + i * lead, text: t, size, anchor: 'start' }))
      b.w = tx + glyph * size * Math.max(...words.map((t) => t.length))
      b.h = Math.max(colH, size + lead)
    } else {
      // A group whose title is cleared in the panel starts with its first item.
      const titled = !!String(e.title ?? '').trim()
      if (titled) b.texts.push({ x: 0, y: size, text: caps(e.title), size, anchor: 'start' })
      let y = titled ? size + lead * 0.5 : 0
      let wide = titled ? glyph * size * e.title.length : 0
      for (const it of e.items) {
        const sw = cell * 1.6
        if (e.kind === 'class' || it.area) {
          b.rects.push([0, y, sw, cell * 0.8, it.color])
          b.lines.push([0, y, sw, y], [sw, y, sw, y + cell * 0.8], [sw, y + cell * 0.8, 0, y + cell * 0.8], [0, y + cell * 0.8, 0, y])
        } else {
          const w = Math.max(stroke * 2.5, size * 0.18)
          for (const [x0, x1] of dashPieces(sw, it.dash, w)) b.lines.push([x0, y + cell * 0.4, x1, y + cell * 0.4, it.color, w])
        }
        b.texts.push({ x: sw + size * 0.7, y: y + cell * 0.4 + size * 0.35, text: it.name, size: size * 0.9, anchor: 'start' })
        wide = Math.max(wide, sw + size * 0.7 + glyph * size * 0.9 * it.name.length)
        y += cell * 1.05
      }
      b.w = wide
      b.h = y
    }
    blocks.push(b)
  }

  // Stack the blocks, a gap between each, into columns no taller than 70% of the sheet.
  const gap = size * 1.2
  const maxH = box.h * 0.7
  const placed = []
  const headH = heading ? size * 1.3 + lead : 0
  let cx = 0, cy = headH, colW = 0
  for (const b of blocks) {
    if (cy > headH && cy + b.h > maxH) { cx += colW + gap * 1.5; cy = headH; colW = 0 }
    placed.push([b, cx, cy])
    cy += b.h + gap
    colW = Math.max(colW, b.w)
  }
  const W = Math.max(cx + colW, heading ? glyph * size * 1.3 * heading.length : 0)
  const H = Math.max(...placed.map(([b, , y]) => y + b.h))
  const m = boxed ? size * 0.9 : 0

  // Into the corner, then clear of anything else on the sheet in that corner.
  const left = corner.endsWith('l'), top = corner.startsWith('t')
  let ox = left ? box.x + pad + m : box.x + box.w - pad - m - W
  let oy = top ? box.y + pad + m : box.y + box.h - pad - m - H
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  for (let i = 0; i < 4; i++) {
    const me = { x: ox - m, y: oy - m, w: W + 2 * m, h: H + 2 * m }
    const other = avoid.find((r) => r && hit(me, r))
    if (!other) break
    oy = top ? other.y + other.h + size + m : other.y - size - m - H
  }

  const rects = [], lines = [], texts = []
  if (heading) {
    texts.push({ x: ox, y: oy + size * 1.3, text: caps(heading), size: size * 1.3, anchor: 'start' })
    lines.push([ox, oy + size * 1.3 + lead * 0.35, ox + W, oy + size * 1.3 + lead * 0.35])
  }
  for (const [b, bx, by] of placed) {
    const dx = ox + bx, dy = oy + by
    for (const [x, y, w, h, c] of b.rects) rects.push([x + dx, y + dy, w, h, c])
    for (const [x0, y0, x1, y1, c, w] of b.lines) lines.push([x0 + dx, y0 + dy, x1 + dx, y1 + dy, c, w])
    for (const t of b.texts) texts.push({ ...t, x: t.x + dx, y: t.y + dy })
  }
  if (boxed) {
    const [x0, y0, x1, y1] = [ox - m, oy - m, ox + W + m, oy + H + m]
    lines.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0])
  }
  // Trailing undefined elements would read as an explicit colour downstream.
  const trim = (a) => { while (a.length && a[a.length - 1] === undefined) a.pop(); return a }
  return { rects: rects.map(trim), lines: lines.map(trim), texts, bounds: { x: ox - m, y: oy - m, w: W + 2 * m, h: H + 2 * m } }
}

/** A line sample of length `len` cut into the dashes of `dash`, as [x0, x1] pieces. */
function dashPieces(len, dash, w) {
  const d = DASH[dash]
  if (!d) return [[0, len]]
  const [on, off] = d.map((v) => v * w)
  const out = []
  for (let x = 0; x < len; x += on + off) out.push([x, Math.min(len, x + Math.max(on, 0.01))])
  return out
}
