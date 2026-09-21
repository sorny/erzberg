/**
 * Masks you draw yourself.
 *
 * Land cover answers "what is this ground" and answers it for the whole window
 * at once, from a satellite. That is the right tool when the distinction you
 * want is one the planet already makes. It is the wrong one when the
 * distinction is yours: the far side of the ridge, the part of the valley the
 * plate is actually about, everything except that one quarry.
 *
 * A mask is that second kind. One bit per pixel, authored by hand or loaded
 * from an image, and — this is the whole point — spent through exactly the same
 * stencil the cover classes go through. `maskedTerrain` in `geometryBuilders.js`
 * already thins a layer's `gridMask`, every builder already gates on it, and
 * nothing in this file needed a single draw mode to change.
 *
 * ── Why masks are not classes ────────────────────────────────────────────────
 * They look similar in the panel and they are a different shape underneath.
 * Cover classes **partition**: every pixel belongs to exactly one, which is why
 * one `Uint8Array` of indices holds them all. Masks **overlap**: a pixel can be
 * in the ridge mask and the north-face mask at once, so each carries its own
 * plane of bits.
 *
 * That difference decides the combination rule too. Selecting two classes means
 * "either of these materials". Selecting two masks means the same thing —
 * union, not intersection — because a mask is a region you drew and picking two
 * of them plainly means both regions.
 *
 * ── The grid they live on ────────────────────────────────────────────────────
 * The *source* raster, always, never the cropped one. Edit Mode's clip can be
 * changed or cleared at any time, and a mask authored against a crop would be
 * the wrong size the moment it was. The store crops masks alongside the pixels
 * on the way through, exactly as it does the NoData mask.
 */

/**
 * The most masks that may exist at once.
 *
 * One bit per mask in one signed 32-bit integer, for the same reason as the
 * cover classes: it lets a layer's whole selection travel as a single number
 * through the parameter bus, the preset file, the history stack and the rebuild
 * key with no special case anywhere.
 */
export const MAX_MASKS = 32

/** No mask selected: the layer draws everywhere, which is every layer by default. */
export const NO_MASKS = 0

/**
 * Colours a new mask is given, in order.
 *
 * Distinct at a glance and distinct from the cover classes' colours, which are
 * averaged from imagery and therefore tend to the muted end. A mask is a thing
 * you drew; it is allowed to be loud.
 */
const MASK_COLORS = [
  '#ff4d6d', '#4dd0ff', '#ffd23f', '#7bff8a', '#c77dff',
  '#ff9f4d', '#4d7dff', '#ff7bd5', '#5fffd0', '#d4ff4d',
]

export const maskColorFor = (i) => MASK_COLORS[i % MASK_COLORS.length]

let nextId = 1

/** An empty mask over a raster, ready to be painted into. */
export function createMask(width, height, index, name) {
  return {
    id: `mask-${nextId++}`,
    name: name ?? `Mask ${index + 1}`,
    color: maskColorFor(index),
    width, height,
    data: new Uint8Array(width * height),
    // Painted masks start invisible in the viewport. The Studio shows them
    // while you draw; the terrain does not need a red wash over it afterwards.
    visible: false,
  }
}

/** How much of the raster a mask covers, as a fraction. */
export function maskCoverage(mask) {
  if (!mask?.data?.length) return 0
  let on = 0
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) on++
  return on / mask.data.length
}

// ── Selection, one bit per mask ──────────────────────────────────────────────

export const maskBit = (index) => 1 << index

export function selectionHasMask(selection, index) {
  return (selection & maskBit(index)) !== 0
}

/**
 * Turn one mask on or off in a layer's selection.
 *
 * Only one end of the range collapses, and the asymmetry against the cover
 * classes is real rather than an oversight. Every *class* selected genuinely is
 * the unfiltered raster, because classes partition it, so that end collapses
 * there. Every *mask* selected is the union of the regions you drew, which is
 * some particular shape and almost never the whole raster — so it stays a
 * selection, and `fullSelection` arithmetic never arises here at all.
 *
 * Unticking the last one does collapse, because a layer restricted to nothing
 * draws nothing, and that is what the layer's own Enabled switch is for.
 */
export function toggleMaskSelection(selection, index) {
  const flipped = (selection ?? NO_MASKS) ^ maskBit(index)
  return flipped === 0 ? NO_MASKS : flipped
}

/** How a selection reads in the panel, without listing every mask in a row. */
export function describeSelection(selection, masks) {
  if (!selection) return 'Whole raster'
  const on = masks.filter((_, i) => selectionHasMask(selection, i))
  if (!on.length) return 'Whole raster'
  if (on.length === 1) return on[0].name
  if (on.length === masks.length) return `All ${on.length} masks`
  return `${on.length} of ${masks.length} masks`
}

/**
 * The union of the selected masks, as one plane of bits.
 *
 * Returns null when nothing is selected, which every consumer reads as "no
 * restriction" — so a layer that has never met a mask behaves exactly as it
 * always did, and the union is never computed for it.
 */
export function unionOf(masks, selection, width, height) {
  if (!selection || !masks?.length) return null
  const chosen = masks.filter((m, i) => selectionHasMask(selection, i) &&
                                        m.width === width && m.height === height)
  if (!chosen.length) return null
  if (chosen.length === 1) return chosen[0].data

  const out = new Uint8Array(width * height)
  for (const m of chosen) {
    for (let i = 0; i < out.length; i++) if (m.data[i]) out[i] = 1
  }
  return out
}

// ── Painting ─────────────────────────────────────────────────────────────────

/**
 * A round brush, stamped once.
 *
 * Hard-edged on purpose. A mask is a bit per pixel — there is no half-selected
 * — so a soft brush would have to either dither the boundary or quantise at
 * some threshold, and both produce an edge that looks deliberate and is not.
 * The feather that matters is the one applied to the *terrain* at the edge of a
 * selection, and that already exists in Edit Mode where it belongs.
 *
 * Spans per row rather than a test per pixel in the bounding box: a circle
 * fills about 79% of its square, and solving for the span is one square root
 * against the alternative of a distance check on every cell.
 */
export function stamp(data, width, height, cx, cy, radius, erase = false) {
  const value = erase ? 0 : 1
  const r = Math.max(0.5, radius)
  const r2 = r * r
  const rowFrom = Math.max(0, Math.ceil(cy - r))
  const rowTo = Math.min(height - 1, Math.floor(cy + r))

  for (let y = rowFrom; y <= rowTo; y++) {
    const dy = y - cy
    const half = Math.sqrt(Math.max(0, r2 - dy * dy))
    const from = Math.max(0, Math.ceil(cx - half))
    const to = Math.min(width - 1, Math.floor(cx + half))
    const off = y * width
    for (let x = from; x <= to; x++) data[off + x] = value
  }
}

/**
 * A stroke between two points, as overlapping stamps.
 *
 * A pointer moving quickly reports positions tens of pixels apart, so stamping
 * only where it was reported paints a dotted line. Stepping at half the brush
 * radius is what makes a drag read as a stroke; smaller than that is redundant
 * work over ground already covered.
 */
export function stroke(data, width, height, x0, y0, x1, y1, radius, erase = false) {
  const dist = Math.hypot(x1 - x0, y1 - y0)
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.5)))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    stamp(data, width, height, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, erase)
  }
}

/** Every bit on, or every bit off. */
export function fillAll(data, value) {
  data.fill(value ? 1 : 0)
}

/** Swap inside for outside. */
export function invert(data) {
  for (let i = 0; i < data.length; i++) data[i] = data[i] ? 0 : 1
}

// ── Import ───────────────────────────────────────────────────────────────────

/**
 * A mask from an ordinary image.
 *
 * Luminance above a threshold, which is what a black-and-white mask painted in
 * any other tool already means. Alpha counts too and counts first: a PNG cut
 * out with transparency is the other common way one of these arrives, and
 * reading only luminance would take its transparent region as black — the exact
 * inverse of what the author drew.
 *
 * The image is resampled to the raster's grid by nearest neighbour. A mask has
 * no meaningful intermediate value, so there is nothing to interpolate.
 */
export function maskFromImageData(imageData, width, height, { threshold = 0.5, invert: flip = false } = {}) {
  const { data: px, width: iw, height: ih } = imageData
  const out = new Uint8Array(width * height)
  const cut = threshold * 255

  for (let r = 0; r < height; r++) {
    const sr = Math.min(ih - 1, Math.floor((r / height) * ih))
    for (let c = 0; c < width; c++) {
      const sc = Math.min(iw - 1, Math.floor((c / width) * iw))
      const o = (sr * iw + sc) * 4
      const alpha = px[o + 3]
      // Transparent is outside, whatever colour sits underneath it.
      let on = alpha >= 128 && (px[o] * 0.299 + px[o + 1] * 0.587 + px[o + 2] * 0.114) >= cut
      if (flip) on = !on
      out[r * width + c] = on ? 1 : 0
    }
  }
  return out
}

/** A mask cropped to the same rectangle the raster was cropped to. */
export function cropMaskData(data, srcWidth, bounds) {
  const { x, y, w, h } = bounds
  const out = new Uint8Array(w * h)
  for (let row = 0; row < h; row++) {
    const from = (y + row) * srcWidth + x
    out.set(data.subarray(from, from + w), row * w)
  }
  return out
}
