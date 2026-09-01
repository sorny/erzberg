/**
 * A string reduced to polylines, so a label can be drawn as terrain geometry.
 *
 * Labels are not sprites and not a texture: a peak's name is flattened into the
 * same `positions` array a contour, a road or an icon uses, and from there it
 * inherits the layer's colour, weight, opacity and dash, the ghost occlusion,
 * the hidden-line removal and every exporter — including the SVG a plotter
 * draws, where the name arrives as strokes it can actually follow.
 *
 * The outlines come from `public/fonts/space-mono-*.json`, built from the font
 * by `scripts/build-font.js` — Space Mono, the face the erzberg logo is set in,
 * so a plot is labelled in the same voice the tool speaks in. See that script
 * for why the conversion cannot happen in a browser.
 *
 * Regular, bold, italic and bold-italic are four separate faces, fetched only
 * when a layer asks for one. Slanting or thickening a single face in the
 * geometry would be cheaper and would look like exactly what it is; a real
 * italic redraws the letters.
 *
 * ── Units ────────────────────────────────────────────────────────────────────
 * Everything here is in *em* units with the origin on the baseline: a cap is
 * ~0.7 tall, the advance is ~0.61 wide, and one line of text is a strip roughly
 * y ∈ −0.36 … 1.12. One multiplication by the label's world size is all that
 * stands between this and the terrain, which is what keeps dragging the size
 * slider a frame rather than a rebuild.
 */

import { simplifyFlat } from './geometryBuilders'

// Points per em of outline. Space Mono's curves are gentle at label sizes, and
// the simplifier below throws most of these away again; the number only has to
// be high enough that a bowl is round before it is thinned.
const SAMPLES_PER_EM = 260

// Douglas–Peucker tolerance in em. A stem collapses to its two endpoints, a
// bowl keeps enough points to still read as round at plotter weights.
const SIMPLIFY_EM = 0.0025

// A jump larger than this multiple of the sampling step means the path moved to
// another subpath rather than drew — the counter of an 'o', the dot of an 'i'.
// Same reasoning as `svgFlatten`, and the same fix: split on the discontinuity
// rather than on the `d` attribute, which lies about relative subpaths.
const BREAK_FACTOR = 3

const base = () => import.meta.env.BASE_URL || '/'

const fontPromises = new Map()

/** `{ bold, italic }` → the file name half `build-font.js` wrote. */
export function fontStyleKey({ bold, italic } = {}) {
  return `${bold ? 'bold' : ''}${italic ? 'italic' : ''}` || 'regular'
}

/**
 * Single-line faces live in the same key space, behind a prefix.
 *
 * One string identifies a face wherever a face is asked for — the fetch, the
 * cache, and the "which faces does this scene need" set that each lettering
 * pass keeps (`useVectorLabels`, `useContourLabels`, `useTextLayers`). A prefix
 * keeps that true across two collections that share no naming at all.
 */
const SL = 'sl:'
export const singleLineKey = (id) => `${SL}${id}`
export const isSingleLineKey = (key) => typeof key === 'string' && key.startsWith(SL)

/** The bundled stroke faces, as `{ id, family, group }`. Fetched once. */
let manifestPromise = null
export function loadSingleLineManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`${base()}fonts/single-line/manifest.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest: ${r.status}`))))
      .catch((err) => {
        console.error('[text] single-line manifest unavailable:', err)
        manifestPromise = null
        return []
      })
  }
  return manifestPromise
}

/**
 * One label face, fetched once.
 *
 * A missing font is a missing feature, not a broken app: nothing is lettered
 * and every layer goes on drawing exactly what it drew before.
 */
export function loadTextFont(style) {
  const key = typeof style === 'string' ? style : fontStyleKey(style)
  let hit = fontPromises.get(key)
  if (!hit) {
    const url = isSingleLineKey(key)
      ? `${base()}fonts/single-line/${key.slice(SL.length)}.json`
      : `${base()}fonts/space-mono-${key}.json`
    hit = fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`fonts: ${r.status}`))))
      // `stroke` is what tells the two builders below apart: a stroke face
      // arrives as polylines and needs none of the sampling an outline does.
      .then((font) => ({ ...font, key, stroke: isSingleLineKey(key) }))
      .catch((err) => {
        console.error('[text] font unavailable:', key, err)
        fontPromises.delete(key)
        return null
      })
    fontPromises.set(key, hit)
  }
  return hit
}

/**
 * One glyph's outlines, in em units with y up, cached forever.
 *
 * The sampling is `getPointAtLength` on a real path in a real document, exactly
 * as the icons are flattened — there is no path parser in this app, and adding
 * one for text would be a second implementation of the hard part of the first.
 */
const glyphCache = new Map()

/**
 * A stroke face's glyph, which is already what this function exists to produce.
 *
 * The strokes were flattened at build time and arrive as flat coordinate runs in
 * font units; all that is left is the divide into em. No sampling, no simplifier
 * and — the part that matters — no guessing where the pen lifted, because every
 * stroke is its own array. The outline path below has to infer that from a jump
 * in arc length, which is the right tool for a contour and the wrong one here.
 */
function strokeGlyphPolylines(ch, font) {
  const g = font.glyphs[ch]
  if (!g) return []
  const upm = font.unitsPerEm || 1000
  return g[1].map((run) => {
    const out = new Float32Array(run.length)
    for (let i = 0; i < run.length; i++) out[i] = run[i] / upm
    return out
  })
}

function glyphPolylines(ch, font) {
  // Keyed by face as well as by character: an italic 'a' is not a slanted
  // roman one, it is a different drawing.
  const cacheKey = `${font.key}\u0000${ch}`
  const hit = glyphCache.get(cacheKey)
  if (hit) return hit

  if (font.stroke) {
    const built = strokeGlyphPolylines(ch, font)
    glyphCache.set(cacheKey, built)
    return built
  }

  const d = font.glyphs[ch]
  if (!d) { glyphCache.set(cacheKey, []); return [] }

  const upm = font.unitsPerEm
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  // Sized in its own units so `getCTM` is the identity and the numbers coming
  // back are font units — the same trick `flattenSvg` plays for the same reason.
  svg.setAttribute('viewBox', `0 ${-upm} ${upm} ${upm * 2}`)
  svg.setAttribute('width', String(upm))
  svg.setAttribute('height', String(upm * 2))
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  svg.appendChild(path)
  host.appendChild(svg)
  document.body.appendChild(host)

  const out = []
  try {
    const total = path.getTotalLength()
    const step = (upm / SAMPLES_PER_EM)
    const n = Math.max(1, Math.ceil(total / step))
    const breakDist = step * BREAK_FACTOR

    const runs = []
    let run = []
    let px = null, py = null
    for (let i = 0; i <= n; i++) {
      const pt = path.getPointAtLength((i / n) * total)
      if (px !== null && Math.hypot(pt.x - px, pt.y - py) > breakDist) {
        if (run.length >= 6) runs.push(run)
        run = []
      }
      run.push(pt.x, pt.y)
      px = pt.x; py = pt.y
    }
    if (run.length >= 6) runs.push(run)

    const eps = upm * SIMPLIFY_EM
    for (const pts of runs) {
      const simplified = simplifyFlat(Float64Array.from(pts), eps)
      if (simplified.length < 6) continue
      const em = new Float32Array(simplified.length)
      for (let i = 0; i < simplified.length; i += 2) {
        em[i] = simplified[i] / upm
        // The font's own path data is SVG's y-down; every consumer wants y up.
        em[i + 1] = -simplified[i + 1] / upm
      }
      out.push(em)
    }
  } catch (err) {
    console.error('[text] could not flatten glyph', ch, err)
  } finally {
    host.remove()
  }

  glyphCache.set(cacheKey, out)
  return out
}

/**
 * A whole string as `{ polylines, width, segments }`, in em units.
 *
 * Laid out with a cursor and an addition, which is legitimate here and would
 * not be for another face: Space Mono is monospaced, and `build-font.js`
 * refuses to emit a font where that is not true. Kerning does not enter into it.
 *
 * Cached per string. A layer's labels are drawn from a small vocabulary — a few
 * dozen names, and heights that repeat — and the same string never flattens to
 * anything different.
 */
const textCache = new Map()

export function textPolylines(text, font) {
  if (!font || !text) return null
  const cacheKey = `${font.key}\u0000${text}`
  const hit = textCache.get(cacheKey)
  if (hit) return hit

  const upm = font.unitsPerEm
  // Space Mono is monospaced and carries one advance for the whole face; a
  // stroke face is proportional and carries one per glyph, so an 'i' is not
  // given the room of an 'm'. Everything downstream is unchanged either way —
  // the advance only ever decides where the next glyph starts.
  const advanceOf = font.stroke
    ? (ch) => (font.glyphs[ch]?.[0] ?? font.defaultAdvance ?? upm / 2) / upm
    : () => font.advance / upm

  const polylines = []
  let segments = 0
  let x = 0

  for (const ch of text) {
    for (const g of glyphPolylines(ch, font)) {
      const moved = new Float32Array(g.length)
      for (let i = 0; i < g.length; i += 2) {
        moved[i] = g[i] + x
        moved[i + 1] = g[i + 1]
      }
      polylines.push(moved)
      segments += moved.length / 2 - 1
    }
    x += advanceOf(ch)
  }

  // Never unbounded: a label vocabulary is small, but a user typing into a
  // filter is not, and this is a module-level Map.
  if (textCache.size > 512) textCache.clear()

  // The string travels with its geometry: the SVG exporter emits `<text>` for
  // outline faces and would otherwise have to be told twice what was drawn.
  const built = { text, polylines, width: x, segments }
  textCache.set(cacheKey, built)
  return built
}
