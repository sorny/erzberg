/**
 * The look, written into the picture that the look produced.
 *
 * `Preset ⬇` has always been able to write the parameters out as JSON, and
 * almost nobody presses it before the interesting plate is already exported and
 * the panel has moved on. So the file that *does* get kept — the PNG somebody
 * posts, the SVG they hand to the plotter — carried no way back to the settings
 * that made it, and "how did you make this" had no answer but memory.
 *
 * The PNG writer already splices `tEXt` chunks for the OpenStreetMap credit,
 * with a CRC and a unit suite behind it. This module is the second thing to put
 * in beside it, and the reader that takes it out again.
 *
 * ── Three rules ──────────────────────────────────────────────────────────────
 * **A preset is a look, never a data set.** The same rule `savePreset` already
 * follows: no raster, no feature selections, no uploaded glyphs. What travels is
 * what would land correctly on somebody else's mountain.
 *
 * **The raster's filename never travels.** The README promises that your files
 * stay on your machine, and a plate posted to a forum is that file leaving by
 * another route — it would carry `Kaisergebirge-private-survey.tif` in a chunk
 * nobody thinks to look in. The payload below has no field for it, which is a
 * stronger guarantee than remembering to strip one.
 *
 * **The bytes are ASCII.** `tEXt` is Latin-1 and an XML comment must not contain
 * `--`, so the JSON is escaped to printable ASCII before it goes into either
 * container. A layer named in Greek would otherwise drop the whole chunk on the
 * floor, silently, because `textChunk` refuses what it cannot represent.
 */

/** The `tEXt` keyword, and the marker the SVG comment opens with. */
export const PRESET_KEYWORD = 'erzberg:preset'

/**
 * The payload's own version, so a plate exported today opens in a later build.
 *
 * Bumped only when the *shape* changes in a way a reader has to know about.
 * Adding a parameter is not that: the loader merges what it finds over the
 * current defaults, so an old plate missing a field gets that field's default
 * rather than `undefined`, which is the same rule `withDefaults` follows for a
 * restored session.
 */
export const PRESET_FORMAT = 1

/**
 * The look, as a plain object.
 *
 * One description of the shape, shared by the JSON file and the two exports, so
 * they cannot drift into carrying different things. `savePreset` in App.jsx adds
 * `heightmapDataURL` on top of this for the JSON case only — a whole raster as
 * base64 is right in a file somebody chose to save and wrong in every plate.
 */
export function buildPreset({
  terrain, style, points, view, gradientStops, bgGradientStops, vectorLayers = [],
} = {}) {
  const out = {
    format: PRESET_FORMAT, app: 'erzberg',
    terrain, style, points, view, gradientStops, bgGradientStops,
  }
  // Vector layer *style* travels; the coordinates do not. Identity fields, the
  // feature selection and any uploaded glyph are stripped for the reasons
  // `savePreset` sets out at length — they are data about one fetch, and they
  // mean nothing against the next one.
  if (vectorLayers.length) {
    out.vectorStyles = vectorLayers.map(
      ({ id: _id, sourceId: _s, count: _c, hidden: _h, iconCustom: _ic, ...rest }) =>
        (rest.icon === 'custom' ? { ...rest, icon: null } : rest))
    out.vectorStackOrder = true
  }
  return out
}

/**
 * The payload as one line of printable ASCII.
 *
 * `\uXXXX` for anything above `~`, which JSON accepts inside a string and both
 * containers accept anywhere. JSON.stringify has already escaped everything
 * below 0x20, so what is left is exactly the characters Latin-1 cannot carry
 * plus DEL.
 */
export function presetToText(payload) {
  return JSON.stringify(payload).replace(/[^\x20-\x7E]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

/**
 * The comment an SVG carries, and the pattern that finds it again.
 *
 * An SVG is a text file somebody opens in an editor, so this is the legible
 * half of the feature — the preset is right there above the first `<g>`, and a
 * plotter still never draws it because a comment is not a mark.
 *
 * `--` cannot appear inside an XML comment. In valid JSON two minus signs in a
 * row can only occur *inside* a string — nothing in the grammar puts two
 * outside one — so escaping every `-` that is followed by another to `-`
 * is both safe and reversible by the parser itself. A run of any length works:
 * each minus but the last is rewritten.
 */
export function presetComment(payload) {
  const text = presetToText(payload).replace(/-(?=-)/g, '\\u002d')
  return `<!-- ${PRESET_KEYWORD} ${text} -->`
}

/**
 * Parse and sanity-check one preset string.
 *
 * Returns the payload, or null. Null is the only failure mode on purpose: every
 * caller here is reading a file the user chose, and the answer that matters is
 * "is there a look in this or not".
 */
export function parsePreset(text) {
  if (!text) return null
  try {
    const d = JSON.parse(text)
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null
    // A preset from before this module existed has no `format` and is still a
    // preset — `Preset ⬇` wrote the same six fields. So the test is whether it
    // holds any of them, not whether it announces itself.
    const FIELDS = ['terrain', 'style', 'points', 'view', 'gradientStops', 'bgGradientStops']
    return FIELDS.some((f) => d[f] != null) ? d : null
  } catch {
    return null
  }
}

/**
 * The preset inside an exported SVG, or null.
 *
 * Non-greedy to the first `-->`, which the escaping above guarantees is the end
 * of this comment rather than something inside it.
 */
export function readSvgPreset(svg) {
  const m = String(svg ?? '').match(
    new RegExp(`<!--\\s*${PRESET_KEYWORD}\\s+([\\s\\S]*?)-->`))
  return m ? parsePreset(m[1].trim()) : null
}

/**
 * The preset inside an exported PNG, or null.
 *
 * Walks the chunk list rather than searching the bytes for the keyword: a
 * compressed `IDAT` can contain any byte sequence at all, and a substring search
 * would happily find the keyword in the middle of the image data and then read
 * megabytes of pixels as JSON.
 *
 * Every malformed length, every truncated buffer and every unreadable chunk ends
 * the walk instead of throwing. This runs on whatever file the user picked.
 */
export function readPngPreset(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
  if (bytes.length < 8 + 12 || SIG.some((b, i) => bytes[i] !== b)) return null

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let i = 8
  while (i + 12 <= bytes.length) {
    const len = dv.getUint32(i)
    if (!Number.isFinite(len) || i + 12 + len > bytes.length) return null
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
    if (type === 'IEND') return null
    if (type === 'tEXt') {
      const data = bytes.subarray(i + 8, i + 8 + len)
      const z = data.indexOf(0)
      if (z > 0) {
        let keyword = ''
        for (let k = 0; k < z; k++) keyword += String.fromCharCode(data[k])
        if (keyword === PRESET_KEYWORD) {
          let text = ''
          for (let k = z + 1; k < data.length; k++) text += String.fromCharCode(data[k])
          return parsePreset(text)
        }
      }
    }
    i += 12 + len
  }
  return null
}

/**
 * The preset inside whichever of the three files this is, or null.
 *
 * The extension decides how to read it, because the three containers need three
 * different reads — bytes for the PNG, text for the other two — and a File is
 * happy to give either. Anything the browser has not named `.png` or `.svg` is
 * tried as JSON, which is what `Preset ⬇` writes and what somebody renaming a
 * preset to `.txt` still deserves to have work.
 */
export async function readPresetFile(file) {
  const name = (file?.name ?? '').toLowerCase()
  if (name.endsWith('.png')) return readPngPreset(await file.arrayBuffer())
  if (name.endsWith('.svg')) return readSvgPreset(await file.text())
  return parsePreset(await file.text())
}
