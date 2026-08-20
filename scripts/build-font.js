/**
 * Turn a TTF into the glyph outlines `utils/textGeometry.js` draws labels with.
 *
 * Usage:
 *   node scripts/build-font.js path/to/SpaceMono-*.ttf
 *
 * The faces this repository ships were built from
 * https://github.com/googlefonts/spacemono/tree/main/fonts/ttf — SpaceMono
 * Regular, Bold, Italic and BoldItalic, SIL OFL 1.1, whose licence travels with
 * them in `public/fonts/OFL.txt`.
 *
 * One file per style: labels can be set regular, bold, italic or both, and each
 * is a separate face rather than a slant or a smear applied to one of them.
 * The output name comes from the font's own subfamily, so the app can ask for
 * `space-mono-bolditalic.json` from two booleans without a lookup table.
 *
 * ── Why a build step and not a runtime font ──────────────────────────────────
 * A browser will happily *render* a font and will not tell you where the curves
 * went: there is no API that hands back the outline of a glyph. Labels here are
 * line geometry like everything else in this app — they inherit the layer's
 * colour and weight, the ghost occlusion and every exporter — so the outlines
 * have to come from somewhere, and the only somewhere is the font file.
 *
 * Parsing a TTF at runtime would mean shipping a font parser to every visitor to
 * read the same 200 glyphs on every load. Doing it here instead ships path data
 * a fetch and a `JSON.parse` away, and keeps `opentype.js` a devDependency.
 *
 * The output is deliberately path `d` strings rather than pre-flattened
 * polylines: `d` is a fraction of the size, and the app already owns a good
 * sampler and simplifier for exactly this — the one the icons go through.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
// CommonJS package: the named exports are not visible through ESM.
import opentype from 'opentype.js'

const { parse } = opentype

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/fonts')

/**
 * Which characters to carry.
 *
 * ASCII, then the Latin-1 letters and the handful of marks a place name in this
 * part of the world actually uses — Präbichl, Großglockner, Hochschwab, and the
 * Slovene and Czech names that come with a border. A label falls back to a
 * space for anything outside this, which is a hole in a word rather than a
 * broken build; widening the set is a rerun of this script.
 */
const CHARS = [
  // Printable ASCII.
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
  // Latin-1 supplement letters, plus the degree sign and the middle dot.
  ...'°·–—‘’“”€',
  ...'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß',
  ...'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ',
  // Latin Extended-A, for Czech, Slovak, Slovene, Polish and Hungarian names.
  ...'ĂăĄąĆćČčĎďĐđĘęĚěŁłŃńŇňŐőŔŕŘřŚśŞşŠšŢţŤťŮůŰűŹźŻżŽž',
]

const sources = process.argv.slice(2)
if (!sources.length) {
  console.error('usage: node scripts/build-font.js <font.ttf> [more.ttf …]')
  process.exit(1)
}

for (const src of sources) build(src)

function build(src) {
  const buf = readFileSync(src)
  const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

  /** One name record, from whichever platform's table the font actually has. */
  const name = (key) => {
    const n = font.names
    return (n.windows?.[key] ?? n.macintosh?.[key] ?? n[key])?.en
  }
  const upm = font.unitsPerEm

  // Space Mono is monospaced, which is the whole reason the layout in
  // `textGeometry.js` is a cursor and an addition rather than a kerning table.
  // A proportional font would need per-glyph advances; assert rather than
  // silently produce labels with the spacing of the wrong font.
  const advances = new Set(
    CHARS.map((c) => font.charToGlyph(c)).filter((g) => g.index).map((g) => g.advanceWidth),
  )
  if (advances.size !== 1) {
    console.error(`not monospaced: ${advances.size} distinct advances — ${[...advances].join(', ')}`)
    process.exit(1)
  }

  const glyphs = {}
  let missing = []
  for (const ch of CHARS) {
    const glyph = font.charToGlyph(ch)
    if (!glyph.index && ch !== ' ') { missing.push(ch); continue }
    // Path at size = upm, so the numbers are font units and the app can scale
    // them by one factor. opentype hands back SVG's y-down convention, which is
    // what the sampler downstream expects and flips once, in one place.
    const d = glyph.getPath(0, 0, upm).toPathData(2)
    if (d) glyphs[ch] = d
  }

  const out = {
    // Where the name lives depends on which name records the font carries;
    // Space Mono has only the Windows set.
    family: name('fontFamily') ?? basename(src),
    style: name('fontSubfamily') ?? '',
    license: 'SIL Open Font License 1.1 — see OFL.txt in this directory',
    unitsPerEm: upm,
    // One number, because the font is monospaced (asserted above).
    advance: [...advances][0],
    ascender: font.ascender,
    descender: font.descender,
    glyphs,
  }

  mkdirSync(OUT_DIR, { recursive: true })
  // `Space Mono` + `Bold Italic` → `space-mono-bolditalic.json`, which is the
  // name `textGeometry.js` builds from its two booleans.
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const outPath = resolve(OUT_DIR, `${slug(out.family).replace(/^space/, 'space-')}-${slug(out.style) || 'regular'}.json`)
  writeFileSync(outPath, JSON.stringify(out))

  const kb = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(1)
  console.log(`${outPath}: ${Object.keys(glyphs).length} glyphs, ${kb} kB`)
  if (missing.length) console.log(`not in the font, skipped: ${missing.join(' ')}`)
}
