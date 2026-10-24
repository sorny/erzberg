import { layerStyle } from './builders/shared'
import { screenInk, screenInkHex } from './screenInk'

const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')

/** The most swatches one row draws. A row with more says how many it has. */
const MAX_SWATCHES = 6

/**
 * The pen layers an SVG export will write, read from the built geometry.
 *
 * The exporter writes one Inkscape layer per pen, and until Preflight built the
 * file nobody could see them: an artist exported, opened Inkscape and found
 * colours that matched no pen. This reads the same `lineGeo` the exporter is
 * handed, and the same `layerStyle` names, so a row here is a layer there:
 *
 *  - a line, dot or text layer is one pen, in its flat ink;
 *  - a line layer coloured per vertex (Height, Slope, a gradient) is still one
 *    layer, with many colours in it — said, not hidden, because one pen cannot
 *    draw it as the screen shows it;
 *  - a filled-area layer is one pen per ink. The inks are known from the
 *    geometry, but an area the frame cuts away writes no layer, so the count
 *    is an upper bound and Preflight has the last word;
 *  - with hidden lines drawn (Depth occlusion on, Hidden opacity above 0) a
 *    mode can write a second, `· hidden` layer, only where lines actually pass
 *    behind the ground — again Preflight's to count.
 *
 * Inks are shown as the file writes them: through the viewport's tone curve,
 * unless Inks as picked is on.
 *
 * @param {Array|null} lineGeo the worker's layers
 * @param {object} p           the merged params, as `layerStyle` reads them
 * @returns {{ rows: Array<{id: string, name: string, kind: 'line'|'mixed'|'areas',
 *   inks: string[], count: number}>, layers: number, exact: boolean, hidden: boolean }}
 */
export function pensOf(lineGeo, p = {}) {
  const hidden = !!p.depthOcclusion && (p.occlusionOpacity ?? 0) > 0
  if (!Array.isArray(lineGeo)) return { rows: [], layers: 0, exact: !hidden, hidden }
  const rgb = p.inksAsPicked ? (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}` : screenInk
  const hex = p.inksAsPicked ? (h) => (h || '#000000').toLowerCase() : screenInkHex

  const rows = []
  for (const L of lineGeo) {
    const lines = L.positions?.length > 0
    if (!lines && !L.areas) continue
    const st = layerStyle(L.id, p)
    const name = st.name ?? String(L.id)

    if (L.areas?.inks?.length) {
      const inks = distinct(L.areas.inks, rgb)
      rows.push({ id: L.id, name, kind: 'areas', inks, count: inks.length })
      continue
    }
    if (!lines) continue
    // Per-vertex colour, when the buffer holds more than one ink. A buffer of
    // one repeated colour is a flat layer that happens to carry it per vertex.
    // Sampled: a dense layer carries millions of floats, and a few thousand
    // vertices are enough to tell one ink from several.
    const inks = L.colors?.length ? distinct(L.colors, rgb, MAX_SWATCHES + 1, 4096) : []
    if (inks.length > 1) rows.push({ id: L.id, name, kind: 'mixed', inks, count: 1, ...modeOf(L.id) })
    else rows.push({ id: L.id, name, kind: 'line', inks: [inks[0] ?? hex(st.color)], count: 1 })
  }

  const layers = rows.reduce((n, r) => n + r.count, 0)
  return { rows, layers, exact: !hidden && !rows.some((r) => r.kind === 'areas'), hidden }
}

/**
 * The draw mode a layer id belongs to, and whether it is a mode copy's:
 * `Contours-Minor@c3` is Contours, in a copy. What the strip needs to offer
 * the fix in the right mode.
 */
function modeOf(id) {
  const s = String(id)
  return { mode: s.replace(/@\w+$/, '').split('-')[0], copy: /@\w+$/.test(s) }
}

/**
 * The distinct inks in an RGB float buffer, as hex, up to `max` of them, from
 * at most `samples` evenly spaced vertices.
 */
function distinct(buf, rgb, max = Infinity, samples = Infinity) {
  const seen = new Set()
  const n = Math.floor(buf.length / 3)
  const step = 3 * Math.max(1, Math.floor(n / samples))
  for (let i = 0; i + 2 < buf.length && seen.size < max; i += step) {
    seen.add(rgb(buf[i], buf[i + 1], buf[i + 2]))
  }
  return [...seen]
}

export { MAX_SWATCHES }

/**
 * The pens in one line: `3 layers · 1 ink · 2 multicolour`.
 *
 * The standing line at the top of the panel and the strip under the SVG button
 * both print this, from the same `pensOf`, so they cannot disagree. They used
 * to: the top line counted the `color*` settings ("2 inks") while the strip
 * counted layers ("3"), and a mixed layer has no one ink to count at all — so
 * it is counted apart. `up to` where an area layer may write fewer, `+ hidden`
 * where hidden lines may add layers; Preflight counts both exactly.
 */
export function penLine({ rows, layers, hidden }) {
  const inks = new Set()
  let mixed = 0
  for (const r of rows) {
    if (r.kind === 'mixed') mixed++
    else for (const h of r.inks) inks.add(h)
  }
  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`
  const upTo = rows.some((r) => r.kind === 'areas') ? 'up to ' : ''
  // `0 inks · 1 mixed` read as a broken plate. With every layer multicolour
  // there is no single ink to count, so the ink count steps aside.
  return [
    `${upTo}${n(layers, 'layer')}${hidden && rows.length ? ' + hidden' : ''}`,
    (inks.size > 0 || mixed === 0) && n(inks.size, 'ink'),
    mixed > 0 && `${mixed} multicolour`,
  ].filter(Boolean).join(' · ')
}
