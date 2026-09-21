/**
 * Land cover, as a second opinion about the ground.
 *
 * Every draw mode in this app chooses its mark from the *shape* of the terrain —
 * slope, curvature, aspect, how the light falls. That is the whole vocabulary,
 * and it is why the app has never been able to do the one thing a hand-drawn
 * survey sheet does without thinking: put a different mark on forest than on
 * scree, because they are different things and not merely different gradients.
 *
 * A cover plate is that missing fact. It carries one class index per pixel over
 * the same ground as the raster, and every class carries a colour taken from the
 * imagery rather than from a palette someone invented. `scripts/embed-window.js`
 * writes them from AlphaEarth Foundations; nothing here knows or cares about
 * that, and any other source producing this shape would work identically.
 *
 * ── Why a file and not a fetch ───────────────────────────────────────────────
 * The embeddings are readable by anyone without a key, and unreadable by a
 * *browser*: the bucket answers with no `access-control-*` header, so the fetch
 * that works from a terminal is blocked from a page. Rather than stand up a
 * proxy — which is a server, which the app does not have — the reduction happens
 * offline and the app loads the result. That also keeps the download honest: one
 * byte per pixel instead of the sixty-four it was derived from.
 *
 * ── The contract ─────────────────────────────────────────────────────────────
 * A plate is self-describing. It states its own extent and projection, so it can
 * be checked against the raster it is being laid over instead of being trusted.
 * A plate that does not cover the same ground is refused with a message saying
 * so, because a silently misaligned cover is indistinguishable from a styling
 * choice and would quietly poison every mask built on it.
 */
// Explicit extension, like `geoCoords.js` itself: `scripts/embed-window.js`
// imports MAX_CLASSES from here in plain Node, and Node's ESM resolver does not
// guess extensions the way the bundler does. One definition of the ceiling,
// shared, rather than a number written down in two places that can drift.
import { classifyCRS } from './geoCoords.js'

/** The only shape this module claims to understand. */
const KIND = 'erzberg.landcover/1'

/** Ceiling on a plate's own grid, so a malformed header cannot ask for gigabytes. */
const MAX_PIXELS = 64e6

/**
 * Is this parsed JSON a cover plate?
 *
 * Returns null rather than throwing, because `.json` is an ambiguous extension
 * in this app — it is also what `Preset ⬇` writes and what GeoJSON is called
 * half the time — and the drop router works by offering a file to each loader in
 * turn until one takes it. A loader that throws on someone else's file breaks
 * that. `parsePreset` answers the same way for the same reason.
 */
export function parseCover(text) {
  let obj
  try { obj = typeof text === 'string' ? JSON.parse(text) : text } catch { return null }
  if (!obj || typeof obj !== 'object' || obj.kind !== KIND) return null
  return obj
}

/** zlib bytes, base64 in the file, back to the array they were. */
async function unpack(b64) {
  const bin = atob(b64)
  const packed = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) packed[i] = bin.charCodeAt(i)

  const stream = new DecompressionStream('deflate')
  const writer = stream.writable.getWriter()
  writer.write(packed)
  writer.close()

  const parts = []
  let total = 0
  const reader = stream.readable.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value); total += value.length
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

/**
 * A parsed plate, with its payloads decoded and its claims checked.
 *
 * Every failure here is a thrown message written for the person holding the
 * file, because by this point the file has already been identified as a cover
 * plate — the ambiguity that `parseCover` guards against is behind us, and the
 * useful thing to do with a malformed one is say what is wrong with it.
 */
export async function decodeCover(obj) {
  const width = Math.round(obj.width), height = Math.round(obj.height)
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS) {
    throw new Error(`Cover plate states a ${obj.width} × ${obj.height} grid, which is not a usable size.`)
  }
  const classes = Array.isArray(obj.classes) ? obj.classes : []
  if (!classes.length) throw new Error('Cover plate lists no classes.')
  // Checked here and not only in the script that writes them. Past 32 the
  // per-layer mask wraps — class 32 would set the same bit as class 0 — and a
  // wrapped mask stencils the wrong ground while looking entirely deliberate.
  if (classes.length > MAX_CLASSES) {
    throw new Error(
      `Cover plate carries ${classes.length} classes, and a layer mask holds ${MAX_CLASSES}. ` +
      `Re-cut it with --classes ${MAX_CLASSES} or fewer.`)
  }

  const labels = await unpack(obj.labels)
  if (labels.length !== width * height) {
    throw new Error(`Cover plate says ${width} × ${height} but carries ${labels.length} labels.`)
  }

  let plate = null
  if (obj.plate) {
    const rgb = await unpack(obj.plate)
    // A plate that does not match is dropped rather than refused: the colour
    // layer is a convenience and the masks — the part everything else is built
    // on — are still perfectly usable without it.
    if (rgb.length === width * height * 3) plate = rgb
  }

  return {
    kind: KIND,
    name: obj.name ?? 'Land cover',
    year: obj.year ?? null,
    crs: obj.crs ?? 'EPSG:none',
    bbox: Array.isArray(obj.bbox) && obj.bbox.length === 4 ? obj.bbox.map(Number) : null,
    width, height, labels, plate,
    classes: classes.map((c, i) => ({
      index: Number.isFinite(c.index) ? c.index : i,
      name: String(c.name ?? `Class ${String.fromCharCode(65 + i)}`),
      color: /^#[0-9a-f]{6}$/i.test(c.color ?? '') ? c.color : '#888888',
      share: Number.isFinite(c.share) ? c.share : 0,
      // What the name is based on — an OpenStreetMap tally, or the terrain the
      // class sits on when nothing is mapped. Optional, because a plate cut
      // before this existed has no note and reads perfectly well without one.
      note: typeof c.note === 'string' ? c.note : null,
    })),
    variance: Number.isFinite(obj.variance) ? obj.variance : null,
    attribution: typeof obj.attribution === 'string' ? obj.attribution : null,
    osmCredit: typeof obj.osmCredit === 'string' ? obj.osmCredit : null,
  }
}

/** Two CRS strings naming the same grid. */
function sameCrs(a, b) {
  if (!a || !b) return false
  if (String(a).toUpperCase() === String(b).toUpperCase()) return true
  const ca = classifyCRS(a), cb = classifyCRS(b)
  return Boolean(ca.supported && cb.supported && ca.kind === cb.kind &&
                 ca.zone === cb.zone && ca.isSouth === cb.isSouth)
}

/**
 * The plate, resampled onto the raster it is being laid over.
 *
 * Done once, at load, rather than per rebuild: the result is indexed by raster
 * pixel exactly as the heightmap is, so `buildTerrain` can subsample it with the
 * arithmetic it already does for elevation and a slider drag costs nothing.
 *
 * Two routes, and the order matters. A plate cut by the script for this very
 * window matches the raster pixel for pixel, and copying it is both exact and
 * free — no resampling error, no dependence on the bboxes agreeing to the
 * metre. Everything else goes through the extents, which is nearest-neighbour
 * because a class index has no meaningful average: halfway between water and
 * forest is not a third thing.
 */
export function alignCover(cover, raster) {
  const { width: rw, height: rh, bbox: rbbox, crs: rcrs } = raster
  if (!(rw > 0 && rh > 0)) throw new Error('Load a terrain raster before a cover plate.')

  const fit = (labels, plate) => ({ labels, plate, width: rw, height: rh })

  if (cover.width === rw && cover.height === rh) return fit(cover.labels, cover.plate)

  if (!cover.bbox || !rbbox) {
    throw new Error(
      `This cover plate is ${cover.width} × ${cover.height} and the terrain is ${rw} × ${rh}. ` +
      `Without a bounding box on both there is no way to line them up — load the .tif that ` +
      `was written beside the plate, or re-cut the plate for this raster.`)
  }
  if (!sameCrs(cover.crs, rcrs)) {
    throw new Error(
      `The cover plate is in ${cover.crs} and the terrain is in ${rcrs}. ` +
      `Re-cut the plate for this raster, or load the .tif written beside it.`)
  }

  const [cx0, cy0, cx1, cy1] = cover.bbox
  const [rx0, ry0, rx1, ry1] = rbbox
  if (rx1 <= cx0 || rx0 >= cx1 || ry1 <= cy0 || ry0 >= cy1) {
    throw new Error(`The cover plate covers different ground than this terrain — the two extents do not overlap.`)
  }

  const labels = new Uint8Array(rw * rh)
  const plate = cover.plate ? new Uint8Array(rw * rh * 3) : null
  const cw = cover.width, ch = cover.height
  const sx = cw / (cx1 - cx0), sy = ch / (cy1 - cy0)

  for (let r = 0; r < rh; r++) {
    // Raster row to world northing, north-up on both sides.
    const north = ry1 - ((r + 0.5) / rh) * (ry1 - ry0)
    const srcRow = Math.floor((cy1 - north) * sy)
    if (srcRow < 0 || srcRow >= ch) continue
    for (let c = 0; c < rw; c++) {
      const east = rx0 + ((c + 0.5) / rw) * (rx1 - rx0)
      const srcCol = Math.floor((east - cx0) * sx)
      if (srcCol < 0 || srcCol >= cw) continue
      const s = srcRow * cw + srcCol, d = r * rw + c
      labels[d] = cover.labels[s]
      if (plate) { plate[d * 3] = cover.plate[s * 3]; plate[d * 3 + 1] = cover.plate[s * 3 + 1]; plate[d * 3 + 2] = cover.plate[s * 3 + 2] }
    }
  }
  return fit(labels, plate)
}

// ── Masks ────────────────────────────────────────────────────────────────────

/**
 * A layer's class selection, as a bitmask.
 *
 * One integer per layer rather than an array, because it has to travel through
 * the parameter bus, the preset file, the history stack and the randomiser, all
 * of which handle a number and none of which would handle an array without
 * special cases. Zero means "every class", which is also the default — so a
 * layer that has never heard of land cover behaves exactly as it always did.
 */
export const ALL_CLASSES = 0

/**
 * The most classes a plate may carry.
 *
 * One bit per class in one signed 32-bit integer, which is what lets a layer's
 * whole selection travel as a single number through the parameter bus, the
 * preset file, the history stack and the rebuild key. Thirty-two bits, thirty-
 * two classes, and no arithmetic beyond the word size to get wrong.
 *
 * Well past useful in practice: `suggestInks` has eight marks to deal, and a
 * legend of thirty-two swatches is four rows of a 244 px panel.
 */
export const MAX_CLASSES = 32

export const classBit = (index) => 1 << index

export function maskHasClass(mask, index) {
  return mask === ALL_CLASSES || (mask & classBit(index)) !== 0
}

/**
 * Turn one class on or off in a layer's mask.
 *
 * Both ends of the range collapse to `ALL_CLASSES`, which is one rule and not
 * two. Ticking every class one by one plainly means "unfiltered". Unticking the
 * *last* one means it too: a layer restricted to nothing draws nothing, which is
 * what the section's own Enabled switch is for and is not a state worth being
 * able to reach by accident from a row of swatches. Collapsing keeps a single
 * canonical value for "unfiltered" either way, so two masks that mean the same
 * thing cannot compare unequal in the rebuild key.
 */
export function toggleClass(mask, index, count) {
  const next = mask === ALL_CLASSES ? 0 : mask
  const flipped = next ^ classBit(index)
  if (flipped === 0 || flipped === fullMask(count)) return ALL_CLASSES
  return flipped
}

/**
 * Every class of `count` selected, as the signed 32-bit integer `&` produces.
 *
 * `(1 << count) - 1` is the obvious way to write this and it is wrong at both
 * ends of the range, in different directions.
 *
 * At 31 classes `1 << 31` is negative, so the subtraction lands on
 * −2 147 483 649 — a number `&` silently coerces to 2 147 483 647 while `===`
 * goes on comparing against the uncoerced one. Ticking every class then failed
 * to register as "all of them".
 *
 * At 32 it is worse: JavaScript takes the shift count modulo 32, so `1 << 32`
 * is 1, the mask comes out as 0, and *every* selection read as unfiltered —
 * picking one class turned the filter off.
 *
 * Both are answered by naming the two edges outright and coercing to int32 with
 * `| 0`, which is the width the mask actually lives in. 32 is the ceiling for
 * the same reason: one bit per class, one int32 to hold them.
 */
function fullMask(count) {
  if (count >= 32) return -1
  return ((1 << count) - 1) | 0
}

/** How a mask reads in the panel, without listing every class in a long line. */
export function describeMask(mask, classes) {
  if (mask === ALL_CLASSES) return 'All classes'
  const on = classes.filter((c) => (mask & classBit(c.index)) !== 0)
  if (on.length === 1) return on[0].name
  if (on.length === classes.length) return 'All classes'
  return `${on.length} of ${classes.length} classes`
}

/**
 * A mark for every class, dealt by how steep its ground is.
 *
 * This is the whole of "ink by land class": each class gets its own layer, its
 * own mask and its own mark, set up in one press. What it deliberately does not
 * do is claim to know which class is forest — the plate's axes are unsigned and
 * its classes unnamed, so any such mapping would be a guess dressed as a fact.
 *
 * Mean slope is not a guess. It is measured from the terrain already on screen,
 * and it is the one ordering that reliably matches how a survey sheet is drawn:
 * broken rock at the top, tone and stipple at the bottom. The user re-points any
 * of them afterwards, which is the point of assigning rather than hard-wiring.
 */
export const INK_BY_SLOPE = ['Swiss', 'Hachure', 'Curv', 'Cross', 'Stipple', 'Pencil', 'Lines', 'Contours']

export function suggestInks(classes, meanSlopeByClass) {
  const ordered = [...classes].sort(
    (a, b) => (meanSlopeByClass[b.index] ?? 0) - (meanSlopeByClass[a.index] ?? 0))
  const out = []
  for (let i = 0; i < ordered.length && i < INK_BY_SLOPE.length; i++) {
    out.push({ mode: INK_BY_SLOPE[i], classIndex: ordered[i].index, color: ordered[i].color })
  }
  return out
}
