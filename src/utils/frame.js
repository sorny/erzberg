/**
 * Paper framing — the geometry behind the frame overlay and the SVG crop.
 *
 * Pure functions over numbers, with no notion of a canvas, a device pixel or a
 * React component. That is deliberate: the overlay works in CSS pixels and the
 * exporter in drawing-buffer pixels, and those differ by `min(dpr, 2) ×
 * renderScale` clamped again by the buffer guard. One function that never sees
 * a device pixel is what stops the frame you compose against and the frame you
 * export from drifting apart.
 */

/**
 * Sheet shapes, grouped for the picker.
 *
 * Keyed by *ratio*, not by sheet name. Every ISO A size — A0 through A10, and
 * the B and C series besides — is the same 1:√2 rectangle; that is the whole
 * point of the series, since halving the long side reproduces the shape.
 * Listing A3, A4 and A5 separately, as this first did, gave three entries that
 * drew an identical frame and differed only in what you called the file. The
 * export carries pixel dimensions rather than millimetres, so the ratio is
 * genuinely all there is to choose.
 *
 * Each carries its long-side-over-short ratio; `paperAspect` orients it.
 */
export const PAPERS = {
  iso:     { label: 'ISO A / B / C', note: 'A3, A4, A5…',  group: 'ISO',   ratio: Math.SQRT2 },
  letter:  { label: 'US Letter',     note: '8.5 × 11 in',  group: 'US',    ratio: 11 / 8.5 },
  legal:   { label: 'US Legal',      note: '8.5 × 14 in',  group: 'US',    ratio: 14 / 8.5 },
  tabloid: { label: 'US Tabloid',    note: '11 × 17 in',   group: 'US',    ratio: 17 / 11 },
  square:  { label: 'Square',                              group: 'Ratio', ratio: 1 },
  r43:     { label: '4:3',                                 group: 'Ratio', ratio: 4 / 3 },
  r32:     { label: '3:2',                                 group: 'Ratio', ratio: 3 / 2 },
  golden:  { label: 'Golden',                              group: 'Ratio', ratio: (1 + Math.sqrt(5)) / 2 },
  r169:    { label: '16:9',                                group: 'Ratio', ratio: 16 / 9 },
  custom:  { label: 'Custom',                              group: 'Ratio', custom: true },
}

/**
 * Ids that no longer exist, mapped to the shape they actually drew. A3, A4 and
 * A5 were three names for 1:√2 and `wide` is now `r169`. Saved presets carry
 * the old ids, and silently changing a stored composition's page shape would be
 * worse than keeping three lines.
 */
const LEGACY = { a3: 'iso', a4: 'iso', a5: 'iso', wide: 'r169' }

const resolve = (id) => PAPERS[LEGACY[id] ?? id]

/** "1:1.414" — the honest name for a shape, and what the picker shows. */
export function paperRatioLabel(id, customRatio = 1.414) {
  const paper = resolve(id)
  const r = (!paper || paper.custom) ? (customRatio || 1.414) : paper.ratio
  return r === 1 ? '1:1' : `1:${r.toFixed(3)}`
}

/** Width ÷ height for a paper id, honouring the orientation flag. */
export function paperAspect(id, landscape = false, customRatio = 1.414) {
  const paper = resolve(id)
  // Ratios are stored exactly rather than as rounded sheet dimensions: the ISO
  // series is 1:√2 *by definition*, and 297 × 420 mm is itself a rounding of
  // it, so deriving the shape from the millimetres would bake in an error of
  // 1e-4 that nothing here needs to carry.
  const r = (!paper || paper.custom)
    ? Math.max(1, Math.min(4, customRatio || 1.414))
    : paper.ratio
  // Stored long-over-short, so "landscape" means the long side horizontal.
  return landscape ? r : 1 / r
}

/**
 * The largest rectangle of the given aspect that fits `canvasW × canvasH`,
 * scaled, centred, then nudged by a normalised offset.
 *
 * Returned in the same units it was given. Offsets are fractions of the canvas
 * so they mean the same thing at any resolution.
 */
export function frameRect(canvasW, canvasH, aspect, scale = 1, offX = 0, offY = 0) {
  const cw = Math.max(1, canvasW), ch = Math.max(1, canvasH)
  const a = Math.max(0.01, aspect || 1)
  const s = Math.max(0.05, Math.min(1, scale))

  let w, h
  if (a > cw / ch) { w = cw; h = w / a } else { h = ch; w = h * a }
  w *= s; h *= s

  return {
    x: (cw - w) / 2 + (offX || 0) * cw,
    y: (ch - h) / 2 + (offY || 0) * ch,
    w, h,
  }
}

/** Shrink a rect inwards on all sides by `frac` of its shorter side. */
export function insetRect(rect, frac = 0) {
  const d = Math.max(0, Math.min(0.45, frac)) * Math.min(rect.w, rect.h)
  return { x: rect.x + d, y: rect.y + d, w: Math.max(1, rect.w - 2 * d), h: Math.max(1, rect.h - 2 * d) }
}

/** Is a point inside the rect? Used for marks that cannot be cut in half. */
export function insideRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

/**
 * Liang–Barsky: clip a segment to a rectangle.
 *
 * Returns the surviving piece, or `null` if the segment misses the rect
 * entirely. `tHead` is how far along the *original* segment the survivor
 * starts, as a fraction — the caller needs it because dash phase accumulates
 * along a chain of segments, and a piece whose head was cut off but whose dash
 * offset was not advanced restarts its pattern at the paper edge.
 */
export function clipSegment(x0, y0, x1, y1, r) {
  const dx = x1 - x0, dy = y1 - y0
  let t0 = 0, t1 = 1

  // Four half-planes. For each, `p` is the direction into the boundary and `q`
  // the distance to it; p === 0 means the segment is parallel to that edge, in
  // which case it is either entirely outside (q < 0) or unconstrained by it.
  const edges = [[-dx, x0 - r.x], [dx, r.x + r.w - x0], [-dy, y0 - r.y], [dy, r.y + r.h - y0]]
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue }
    const t = q / p
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t } // entering
    else       { if (t < t0) return null; if (t < t1) t1 = t } // leaving
  }

  return {
    x0: x0 + t0 * dx, y0: y0 + t0 * dy,
    x1: x0 + t1 * dx, y1: y0 + t1 * dy,
    tHead: t0,
  }
}
