/**
 * An SVG reduced to polylines, so an icon can be drawn as terrain line geometry.
 *
 * Everything this app draws is line segments, and everything it exports assumes
 * that — the plotter path especially. So an icon is not a texture or a sprite:
 * it is flattened into the same `positions` array a contour or a road uses, and
 * from there it inherits the layer's colour, weight, opacity and dash, the ghost
 * occlusion, the hidden-line removal and every exporter, without any of them
 * learning that icons exist.
 *
 * The bundled set is Maki (CC0), which is drawn *filled*. That sounds like the
 * wrong choice for a line renderer and is not: flattening a filled glyph traces
 * its silhouette, and for a map symbol the silhouette is the line drawing. It
 * costs roughly double the segments of the same shape drawn as a stroke, and
 * buys the vocabulary a terrain plot actually needs — mountain, volcano,
 * shelter, viewpoint — which no UI icon set has.
 *
 * What comes back is therefore a set of fill *boundaries*, not a set of strokes:
 * a skull's outline and, separately, its eye sockets. `useVectorIcons` sorts out
 * which of them are holes before filling. Nothing here needs to know that — the
 * rings are the same either way — but it is why a ring here is not always ink.
 *
 * ── Why the browser does the hard part ───────────────────────────────────────
 * There is no path parser here. Every drawable SVG element is an
 * `SVGGeometryElement`, which means `<path>`, `<circle>`, `<rect>`, `<ellipse>`,
 * `<line>`, `<polyline>` and `<polygon>` all answer `getTotalLength()` and
 * `getPointAtLength()` — so arcs and béziers come out exact, from one code path,
 * with no arc-to-bézier conversion to get subtly wrong. `getCTM()` then folds in
 * whatever nesting and `transform` attributes an uploaded file happens to carry.
 *
 * The cost is that these only answer inside a rendered document, which is why
 * this is main-thread-only and why icon geometry is built outside the worker.
 */

import { simplifyFlat } from './geometryBuilders'

// Points per unit of the viewBox's diagonal. Dense enough that a 24-unit
// icon's curves are smooth before simplification thins them again.
const SAMPLES_PER_DIAGONAL = 220

// Douglas–Peucker tolerance, as a fraction of the viewBox diagonal. At this
// scale a straight run collapses back to its two endpoints while a rounded
// corner keeps enough points to still read as round.
const SIMPLIFY_FRAC = 0.0025

// A gap between consecutive samples larger than this multiple of the sampling
// step means the parameterisation jumped — see `sampleElement`.
const BREAK_FACTOR = 3

const DRAWABLE = 'path, circle, ellipse, rect, line, polyline, polygon'

/**
 * Does this element actually put ink on the page?
 *
 * Invisible helper geometry is everywhere in real SVGs — icon sets pin their
 * bounds with `<path stroke="none" fill="none" d="M0 0h24v24H0z"/>`, and hit
 * areas and spacers are the same trick. Sampled blindly, each one draws a square
 * around the icon it was meant to size. Asking the browser for the *computed*
 * paint catches all of them, including `display:none` and a zero opacity, and it
 * costs one call per element on a handful of elements.
 */
function paints(el) {
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden') return false
  if (parseFloat(cs.opacity) === 0) return false
  const blank = (v) => !v || v === 'none' || v === 'transparent' || /^rgba\(.*,\s*0\)$/.test(v)
  return !(blank(cs.fill) && blank(cs.stroke))
}

/**
 * Sample one element into one or more polylines, in the SVG's own user units.
 *
 * The subpath split is the part worth explaining. A `<path>` with several
 * subpaths is one continuous arc-length parameterisation, and a move between
 * them has no length — so walking it end to end silently draws a segment from
 * where one subpath stopped to where the next began. Splitting the `d` attribute
 * would be the obvious fix and is wrong: a subpath that starts with a *relative*
 * `m` is relative to the previous subpath's end, so the pieces do not stand
 * alone. Detecting the spatial discontinuity instead needs no parsing and cannot
 * be fooled — a genuine segment sampled at step `s` never advances more than `s`.
 */
function sampleElement(el, step) {
  const total = el.getTotalLength?.() ?? 0
  if (!(total > 0)) return []

  const ctm = el.getCTM()
  const n = Math.max(1, Math.ceil(total / step))
  const breakDist = step * BREAK_FACTOR

  const out = []
  let run = []
  let prevX = null, prevY = null

  for (let i = 0; i <= n; i++) {
    const pt = el.getPointAtLength((i / n) * total)
    let x = pt.x, y = pt.y
    if (ctm) {
      const tx = ctm.a * x + ctm.c * y + ctm.e
      const ty = ctm.b * x + ctm.d * y + ctm.f
      x = tx; y = ty
    }
    if (prevX !== null && Math.hypot(x - prevX, y - prevY) > breakDist) {
      if (run.length >= 4) out.push(run)
      run = []
    }
    run.push(x, y)
    prevX = x; prevY = y
  }
  if (run.length >= 4) out.push(run)
  return out
}

/**
 * SVG source → polylines in a −0.5…0.5 box, y up.
 *
 * Normalised against the `viewBox` rather than the sampled bounds, so a set of
 * icons drawn on a common grid stays a set: a compass and a mountain keep their
 * relative weight instead of each being stretched to fill the same square.
 *
 * Throws with a message the panel can show — an uploaded file that turns out to
 * be a raster wrapped in an `<svg>`, or a bitmap traced into `<image>`, has
 * nothing to flatten and should say so rather than appearing as an empty layer.
 */
export function flattenSvg(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (doc.querySelector('parsererror')) throw new Error('That file is not valid SVG.')
  const svg = doc.documentElement
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('That file has no <svg> root.')

  // getTotalLength / getPointAtLength / getCTM only answer for an element in a
  // rendered document, so it has to be attached — off-screen, and pulled again
  // in a `finally` so a throw cannot leak a node into the page.
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden'
  const live = document.importNode(svg, true)
  host.appendChild(live)
  document.body.appendChild(host)

  try {
    const vb = (live.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    // The origin is deliberately dropped: `getCTM` has already applied it — see
    // the centre below.
    const [, , vw, vh] = vb.length === 4 && vb.every(Number.isFinite)
      ? vb
      : [0, 0, +live.getAttribute('width') || 24, +live.getAttribute('height') || 24]
    if (!(vw > 0 && vh > 0)) throw new Error('That SVG has no usable size.')

    // `getCTM` includes the *viewport* transform — the mapping from the
    // viewBox onto whatever CSS size the element happens to have. Plenty of
    // real files are sized in `em` or `%`, and a 256-unit viewBox rendered at
    // the default 16 px then arrives scaled by 1/16 on top of the normalisation
    // below, which is a recognisable icon shrunk to a speck. Pinning the
    // rendered size to the viewBox's own units makes that transform the
    // identity, so what `getCTM` still reports is exactly what it is wanted
    // for: the element's own nesting and `transform` attributes.
    live.setAttribute('width', String(vw))
    live.setAttribute('height', String(vh))
    live.style.width = `${vw}px`
    live.style.height = `${vh}px`

    const diag = Math.hypot(vw, vh)
    const step = diag / SAMPLES_PER_DIAGONAL
    const eps = diag * SIMPLIFY_FRAC

    const raw = []
    for (const el of live.querySelectorAll(DRAWABLE)) {
      // A shape used only as a clip or mask is not part of the drawing.
      if (el.closest('defs, clipPath, mask, marker, pattern')) continue
      if (!paints(el)) continue
      raw.push(...sampleElement(el, step))
    }
    if (!raw.length) throw new Error('That SVG has no lines, curves or shapes to draw.')

    // Longest side to 1, so the icon fits a unit box whatever its aspect.
    const scale = 1 / Math.max(vw, vh)
    // The centre is in *viewBox-relative* coordinates, not user units: `getCTM`
    // on a descendant already includes the viewBox's own translate, so what
    // `sampleElement` returns is measured from (vx, vy). Adding vx/vy here
    // subtracted the origin a second time, which put a `viewBox="-12 -12 24 24"`
    // icon half its own width out of the box. Every bundled icon starts at 0 0,
    // which is why nothing shipped looked wrong; an uploaded one need not.
    const cx = vw / 2, cy = vh / 2

    const polylines = []
    let n = 0
    for (const pts of raw) {
      const flat = Float64Array.from(pts)
      const simplified = simplifyFlat(flat, eps)
      if (simplified.length < 4) continue
      const outPts = new Float32Array(simplified.length)
      for (let i = 0; i < simplified.length; i += 2) {
        outPts[i]     = (simplified[i] - cx) * scale
        // SVG's y grows downward; every consumer here wants it up.
        outPts[i + 1] = -(simplified[i + 1] - cy) * scale
      }
      polylines.push(outPts)
      n += outPts.length / 2 - 1
    }
    if (!polylines.length) throw new Error('That SVG has no lines, curves or shapes to draw.')

    return { polylines, segments: n }
  } finally {
    host.remove()
  }
}
