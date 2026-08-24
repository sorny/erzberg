/**
 * Fetch the single-line (stroke) fonts and flatten them into stroke data.
 *
 * Usage:
 *   node scripts/build-single-line-fonts.js
 *
 * Source: https://gitlab.com/oskay/svg-fonts — Evil Mad Scientist's collection
 * of SVG fonts for Hershey Text v3, which is the canonical modern home for the
 * Hershey originals plus the "EMS" faces converted from openly-licensed
 * typefaces. Licences travel with the data; see LICENSE.txt in the output
 * directory.
 *
 * ── Why these are worth having ───────────────────────────────────────────────
 * The label faces this app already ships are *outline* fonts: Space Mono
 * flattened to contours, so a plotted 'A' draws both sides of every stem and the
 * pen goes round each letter twice. A single-line font is the skeleton instead —
 * that same 'A' is three strokes:
 *
 *   <glyph unicode="A" horiz-adv-x="567"
 *          d="M 378 662 L 126 0 M 378 662 L 630 0 M 220 220 L 536 220"/>
 *
 * which is what a pen plotter actually wants to follow.
 *
 * ── Why pre-flattened, unlike build-font.js ──────────────────────────────────
 * The outline builder emits `d` strings because the app already owns a sampler
 * and a simplifier for them — the browser's own path geometry, which the icons
 * go through. That machinery is the wrong tool here twice over. It resamples
 * dead-straight strokes into hundreds of points only for Douglas–Peucker to
 * throw them away again, and it has to *guess* where subpaths break, because
 * `getPointAtLength` walks across a `moveTo` without saying so.
 *
 * A stroke font is nothing but that information: every `M` is the pen lifting,
 * and there are ~2.4 of them per glyph. Guessing at what the data states outright
 * would be perverse, so this emits polylines and the runtime does no parsing at
 * all. The handful of `C` curves (about eighty per face against three thousand
 * lines) are flattened here, where a fixed subdivision is exact enough and costs
 * nothing at load time.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/fonts/single-line')
const RAW = 'https://gitlab.com/oskay/svg-fonts/-/raw/master/'
const TREE = 'https://gitlab.com/api/v4/projects/oskay%2Fsvg-fonts/repository/tree'
// Golan Levin's archive of monoline fonts, which is where several faces below
// were converted into the SVG 1.1 font format this script reads.
const LEVIN = 'https://raw.githubusercontent.com/golanlevin/p5-single-line-font-resources/main/'

/**
 * Faces from outside the EMS collection that ship a real SVG font.
 *
 * Relief SingleLine (OFL) is the find: drawn as single-line from the start
 * rather than converted from an outline face, and 423 glyphs against the EMS
 * collection's 216 — the accented Latin that the Hershey faces simply do not
 * have. It ships OTF-SVG for Illustrator and a plain SVG font for Inkscape's
 * Hershey Text, and it is the second of those that lands here unchanged.
 *
 * Pendot is Simon Cozens' fork of it, and is not the redundant near-duplicate it
 * looks like. Relief draws a period as a 33-point circle, which a plotter has to
 * trace as a tiny loop; Pendot replaces every dot in the font — periods, colons,
 * the i/j tittles, the accents built on them — with a single short stroke the pen
 * can dab. 131 of the 423 glyphs differ, and they are exactly those. Both are
 * here because that choice is the user's to make, not the build's.
 *
 * Their `font-family` metadata collides (both say "Relief SingleLine"), so the
 * names below are stated rather than sniffed.
 *
 * These paths are drawn relative with h/v and the smooth-cubic shorthand, which
 * is why the parser above speaks more than the EMS dialect.
 */
const EXTRA = [
  { group: 'Relief', id: 'ReliefSingleLine', family: 'Relief SingleLine',
    url: 'https://raw.githubusercontent.com/isdat-type/Relief-SingleLine/main/fonts/open_svg/ReliefSingleLineSVG-Regular.svg' },
  { group: 'Relief', id: 'ReliefPendot', family: 'Relief SingleLine Pendot',
    url: 'https://raw.githubusercontent.com/simoncozens/Relief-Pendot/main/fonts/open_svg/ReliefSingleLine-Regular.svg' },
  { group: 'Relief', id: 'ReliefSingleLineOrnament', family: 'Relief SingleLine Ornament',
    url: 'https://raw.githubusercontent.com/isdat-type/Relief-SingleLine/main/fonts/open_svg/ReliefSingleLineOrnament-Regular.svg' },

  /*
   * ISO 3098 — the lettering standard for technical drawings, adopted 1974.
   *
   * The most apt face in this whole list: everything else here was drawn for
   * some other purpose and pressed into service, while this is the alphabet the
   * standard specifies for exactly the kind of drawing this app produces. It is
   * built from straight lines and circular arcs, which is why the parser above
   * learned `A`.
   *
   * Public domain. The letterforms come from File:ISO3098.svg on Wikimedia
   * Commons, released by its author as own work into the public domain with no
   * attribution required; AZO extracted the strokes and published the result as
   * free to use; Golan Levin converted that to an SVG 1.1 font.
   */
  { group: 'ISO 3098', id: 'ISO3098', family: 'ISO 3098', respace: true,
    url: `${LEVIN}p5_single_line_svg_fonts/single_line_svg_fonts/ISO3098/ISO3098-Regular.svg` },
  { group: 'ISO 3098', id: 'ISO3098Italic', family: 'ISO 3098 Italic', respace: true,
    url: `${LEVIN}p5_single_line_svg_fonts/single_line_svg_fonts/ISO3098/ISO3098-Italic.svg` },

  /*
   * Fonts that were born on a plotter.
   *
   * The first two are ROM data from machines that drew with an actual pen, so
   * their letterforms were shaped by the same constraint this app exports for —
   * the Commodore 1520 was a four-colour ballpoint plotter for the C64, and the
   * Apple 410 a pen plotter whose glyphs sit on a 16×16 lattice. DearPlotter was
   * drawn for pen plotters on purpose rather than by necessity.
   *
   * Commodore 1520: WTFPL, recovered from ROM by Jim Brain, Gerrit Heitsch,
   * Silver Dream and Stewart C. Russell. Apple 410: MIT, extracted from firmware
   * by Adam Mayer. DearPlotter: SIL OFL 1.1, by Licia He, commissioned by the
   * Processing Foundation and the Tezos Foundation. All three reach here through
   * Golan Levin's SVG 1.1 font conversions.
   */
  { group: 'Plotter', id: 'DearPlotter', family: 'DearPlotter',
    url: `${LEVIN}licia_he_font/licia_he_dearplotter.svg` },
  { group: 'Plotter', id: 'Commodore1520', family: 'Commodore 1520',
    url: `${LEVIN}commodore_1520_font/Commodore1520.svg` },
  { group: 'Plotter', id: 'Apple410', family: 'Apple 410',
    url: `${LEVIN}apple_410_font/Apple410.svg` },
]

/** Points per cubic. Glyphs are ~1000 units tall and curves here are gentle. */
const CURVE_STEPS = 8

/** Coordinates are rounded to this many decimals — 1000 upm needs no more. */
const DP = 1

const dec = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))

/** Attributes of one tag, without pulling in an XML parser for four of them. */
function attrs(tag) {
  const out = {}
  for (const m of tag.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = dec(m[2])
  return out
}

/** Segments per full turn when flattening an elliptical arc. */
const ARC_STEPS_PER_TURN = 48

/**
 * One elliptical arc, as points along it.
 *
 * SVG states an arc by where it ends, which is convenient to author and useless
 * to draw: the centre, the start angle and the sweep all have to be recovered
 * first. This is the conversion given in the SVG 1.1 specification, appendix
 * F.6.5, including F.6.6's correction step for radii too small to span the two
 * endpoints — which is not a defensive nicety but a case ISO 3098 actually
 * contains, since rounding a radius down by a hair is enough to trigger it.
 *
 * `push` receives every point after the start, so the caller's pen is already
 * where the arc begins.
 */
function arcPoints(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2, push) {
  // Degenerate cases the spec calls out: no movement draws nothing, and a zero
  // radius is a straight line rather than an error.
  if (x1 === x2 && y1 === y2) return
  rx = Math.abs(rx); ry = Math.abs(ry)
  if (rx === 0 || ry === 0) { push(x2, y2); return }

  const phi = (phiDeg * Math.PI) / 180
  const cos = Math.cos(phi), sin = Math.sin(phi)

  // Into the ellipse's own frame, with the chord's midpoint at the origin.
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const px = cos * dx + sin * dy
  const py = -sin * dx + cos * dy
  let px2 = px * px, py2 = py * py

  // F.6.6: scale the radii up if they cannot reach across the chord.
  const lambda = px2 / (rx * rx) + py2 / (ry * ry)
  if (lambda > 1) { const k = Math.sqrt(lambda); rx *= k; ry *= k }

  const rx2 = rx * rx, ry2 = ry * ry
  const denom = rx2 * py2 + ry2 * px2
  // Guarded because the radicand is a difference of near-equal quantities and
  // can land a hair below zero on an arc that exactly spans its own diameter.
  const num = Math.max(0, rx2 * ry2 - denom)
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(denom === 0 ? 0 : num / denom)
  const cxp = coef * (rx * py) / ry
  const cyp = coef * -(ry * px) / rx

  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2

  const ang = (ux, uy, vx, vy) => {
    const d = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    const t = d === 0 ? 0 : Math.min(1, Math.max(-1, (ux * vx + uy * vy) / d))
    return (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(t)
  }
  const sx = (px - cxp) / rx, sy = (py - cyp) / ry
  const ex = (-px - cxp) / rx, ey = (-py - cyp) / ry
  const theta = ang(1, 0, sx, sy)
  let delta = ang(sx, sy, ex, ey)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  else if (sweep && delta < 0) delta += 2 * Math.PI

  const steps = Math.max(2, Math.ceil((Math.abs(delta) / (2 * Math.PI)) * ARC_STEPS_PER_TURN))
  for (let i = 1; i <= steps; i++) {
    const t = theta + (delta * i) / steps
    const ct = Math.cos(t), st = Math.sin(t)
    push(cos * rx * ct - sin * ry * st + cx, sin * rx * ct + cos * ry * st + cy)
  }
}

/**
 * Path data → polylines.
 *
 * M, L, H, V, C, S, A and Z, in either case. The EMS collection is almost
 * entirely absolute M and L; the Relief faces are drawn relative and lean on h,
 * v and the smooth-cubic shorthand; ISO 3098 is built from lines and arcs,
 * because that is how the standard itself defines the letterforms.
 *
 * Anything else throws rather than being silently dropped: a glyph quietly
 * missing a stroke is far worse than a build that stops and says so.
 */
function strokes(d) {
  // Scientific notation appears in a few converted faces (1e-5), so the number
  // pattern has to admit an exponent.
  // Every letter is a token, not just the supported ones — otherwise an arc's
  // `A` would be skipped and its seven numbers swallowed by whichever command
  // came before, drawing a plausible wrong glyph instead of raising. The number
  // pattern still wins inside an exponent, because at the digit it is the only
  // alternative that matches — and the exponent may be signed either way, which
  // two glyphs in this collection are the only evidence for: EMS Brush's Ä and
  // EMS Swiss's É each carry a coordinate written `1e+03`.
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[+-]?\d+)?/g) ?? []
  const out = []
  let run = null, x = 0, y = 0, sx = 0, sy = 0, cmd = null, i = 0
  // Where the previous cubic's second control point was, reflected — which is
  // the whole definition of the smooth shorthand. Null after any non-cubic, so
  // an `s` that does not follow one curves from its own start point.
  let px = null, py = null

  const num = () => parseFloat(tokens[i++])
  const push = (px, py) => run.push(+px.toFixed(DP), +py.toFixed(DP))

  while (i < tokens.length) {
    const t = tokens[i]
    if (/^[A-Za-z]$/.test(t)) { cmd = t; i++ }
    else if (!cmd) throw new Error(`path starts with a number: ${d.slice(0, 40)}`)

    switch (cmd) {
      case 'M': case 'm': {
        const nx = num(), ny = num()
        x = cmd === 'm' ? x + nx : nx
        y = cmd === 'm' ? y + ny : ny
        sx = x; sy = y
        if (run && run.length >= 4) out.push(run)
        run = []; push(x, y); px = py = null
        // A repeated coordinate pair after M is an implicit L.
        cmd = cmd === 'M' ? 'L' : 'l'
        break
      }
      case 'L': case 'l': {
        const nx = num(), ny = num()
        x = cmd === 'l' ? x + nx : nx
        y = cmd === 'l' ? y + ny : ny
        push(x, y); px = py = null
        break
      }
      case 'H': case 'h': {
        const nx = num()
        x = cmd === 'h' ? x + nx : nx
        push(x, y); px = py = null
        break
      }
      case 'V': case 'v': {
        const ny = num()
        y = cmd === 'v' ? y + ny : ny
        push(x, y); px = py = null
        break
      }
      case 'C': case 'c': case 'S': case 's': {
        const rel = cmd === 'c' || cmd === 's'
        const smooth = cmd === 'S' || cmd === 's'
        // The smooth form states one control point and infers the other by
        // reflecting the previous curve's through the current point.
        const x1 = smooth ? (px == null ? x : 2 * x - px) : (rel ? x : 0) + num()
        const y1 = smooth ? (py == null ? y : 2 * y - py) : (rel ? y : 0) + num()
        const x2 = (rel ? x : 0) + num(), y2 = (rel ? y : 0) + num()
        const x3 = (rel ? x : 0) + num(), y3 = (rel ? y : 0) + num()
        for (let s = 1; s <= CURVE_STEPS; s++) {
          const u = s / CURVE_STEPS, v = 1 - u
          push(v*v*v*x + 3*v*v*u*x1 + 3*v*u*u*x2 + u*u*u*x3,
               v*v*v*y + 3*v*v*u*y1 + 3*v*u*u*y2 + u*u*u*y3)
        }
        px = x2; py = y2
        x = x3; y = y3
        break
      }
      case 'A': case 'a': {
        const rel = cmd === 'a'
        const rx = num(), ry = num(), rot = num()
        // The two flags are single characters in the grammar and may be written
        // unseparated from what follows; these faces space them out, and the
        // tokeniser reads them as ordinary numbers either way.
        const large = num() !== 0, sweep = num() !== 0
        const nx = num(), ny = num()
        const ex = rel ? x + nx : nx
        const ey = rel ? y + ny : ny
        arcPoints(x, y, rx, ry, rot, large, sweep, ex, ey, push)
        x = ex; y = ey; px = py = null
        break
      }
      case 'Z': case 'z':
        push(sx, sy); x = sx; y = sy; px = py = null; i++
        break
      default:
        throw new Error(`unsupported path command "${cmd}" in ${d.slice(0, 40)}`)
    }
  }
  if (run && run.length >= 4) out.push(run)
  return out
}

/**
 * Drops the zero-length strokes that draw nothing, and only those.
 *
 * A stroke with no length is not automatically junk. Under a round cap it is a
 * dot, and in Apple 410 that is exactly what it is: the tittle of an i and a j,
 * the point of a ! and a ?. Dropping those would quietly unspell four glyphs.
 *
 * In ISO 3098 the same construct is an artefact — its round letters chain
 * subpath to subpath and finish with a `M300 650 L300 650` back at a corner
 * another stroke already occupies, so the dot is stamped on top of a line that
 * is drawn anyway and cannot be seen. That is the whole distinction: a dot the
 * glyph draws nowhere else is a mark, and one that lands on an existing stroke
 * is a redundant pen-down. So the test is whether any other stroke in the same
 * glyph already passes through the point, not whether the stroke has length.
 */
function dropRedundantDots(polylines) {
  const zero = (p) => {
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (p[i] !== p[i + 2] || p[i + 1] !== p[i + 3]) return false
    }
    return true
  }
  const covered = new Set()
  for (const p of polylines) {
    if (zero(p)) continue
    for (let i = 0; i < p.length; i += 2) covered.add(`${p[i]},${p[i + 1]}`)
  }
  return polylines.filter((p) => !(zero(p) && covered.has(`${p[0]},${p[1]}`)))
}

/**
 * Gives a face real side bearings, for a source that never had any.
 *
 * ISO 3098 reaches here from a specimen sheet on Wikimedia Commons — the whole
 * alphabet drawn out on a grid — by way of two conversions. Nothing in that
 * chain ever knew how wide a letter is: all 319 glyphs declare no advance of
 * their own and inherit the font's single `horiz-adv-x="1100"`, which is the
 * pitch of the specimen's grid. Against a mean ink width of 437 that leaves
 * about sixty percent of every cell empty, and the glyphs sit centred in it, so
 * text set from the file as-is reads `E r z b e r g`.
 *
 * The standard itself is the way out. ISO 3098 specifies its own spacing in
 * terms of cap height h: letters are set `0.2h` apart and words `0.6h`. So the
 * grid pitch is replaced by exactly that — ink shifted to the origin, and an
 * advance of its own width plus the standard's gap. The strokes are untouched;
 * only the empty space around them changes, and it changes to the number the
 * standard gives rather than to one that looks right.
 *
 * Applied only where it is asked for, because everywhere else the advances in
 * the file are the designer's and are not ours to improve.
 */
function respace(glyphs, capHeight) {
  const gap = 0.2 * capHeight
  const wordSpace = 0.6 * capHeight
  for (const g of Object.values(glyphs)) {
    const [, polylines] = g
    let lo = Infinity, hi = -Infinity
    for (const p of polylines) {
      for (let i = 0; i < p.length; i += 2) {
        if (p[i] < lo) lo = p[i]
        if (p[i] > hi) hi = p[i]
      }
    }
    if (!isFinite(lo)) { g[0] = wordSpace; continue }   // a space, or an empty glyph
    for (const p of polylines) {
      for (let i = 0; i < p.length; i += 2) p[i] = +(p[i] - lo).toFixed(DP)
    }
    g[0] = +(hi - lo + gap).toFixed(DP)
  }
}

async function get(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.text()
}

async function main() {
  const tree = JSON.parse(await get(`${TREE}?per_page=100&recursive=true`))
  const files = tree.map((e) => e.path).filter((p) => /^fonts\/.+\.svg$/.test(p)).sort()
  if (!files.length) throw new Error('no fonts found in the source tree')

  mkdirSync(OUT_DIR, { recursive: true })
  const manifest = []

  const sources = [
    ...files.map((path) => ({
      url: RAW + path,
      id: path.split('/').pop().replace('.svg', ''),
      group: path.split('/')[1],
    })),
    ...EXTRA,
  ]

  for (const { url, id, group, family: named, respace: doRespace } of sources) {
    const svg = await get(url)

    const face = attrs(svg.match(/<font-face\b[^>]*>/)?.[0] ?? '')
    const font = attrs(svg.match(/<font\b[^>]*>/)?.[0] ?? '')
    const upm = +(face['units-per-em'] || 1000)
    const fallback = +(font['horiz-adv-x'] || upm / 2)

    const glyphs = {}
    let strokeCount = 0
    for (const m of svg.matchAll(/<glyph\b[^>]*?\/?>/g)) {
      const a = attrs(m[0])
      // Ligatures and unnamed glyphs have no single character to key on, and
      // nothing in this app asks for one.
      if (!a.unicode || [...a.unicode].length !== 1) continue
      const s = a.d ? dropRedundantDots(strokes(a.d)) : []
      strokeCount += s.length
      glyphs[a.unicode] = [+(a['horiz-adv-x'] ?? fallback), s]
    }

    if (doRespace) respace(glyphs, +(face['cap-height'] || upm))

    // The name in the EMS metadata block is the one the designers wrote. Outside
    // that collection there is no such block, so fall back to the font-face
    // attribute, and to a stated name where even that is ambiguous.
    const family = (named ?? svg.match(/Font name:\s*(.+)/)?.[1] ?? face['font-family'] ?? id).trim()
    const out = {
      id, family, group,
      unitsPerEm: upm,
      ascender: +(face.ascent || upm * 0.8),
      descender: +(face.descent || -upm * 0.2),
      defaultAdvance: fallback,
      glyphs,
    }
    writeFileSync(resolve(OUT_DIR, `${id}.json`), JSON.stringify(out))
    manifest.push({ id, family, group })
    const kb = (JSON.stringify(out).length / 1024).toFixed(1)
    console.log(`${group}/${id}`.padEnd(34), `${Object.keys(glyphs).length} glyphs`.padEnd(12),
                `${strokeCount} strokes`.padEnd(14), `${kb} kB`)
  }

  manifest.sort((a, b) => a.group.localeCompare(b.group) || a.family.localeCompare(b.family))
  writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\n${manifest.length} faces → ${OUT_DIR}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
