/**
 * Point features labelled with their name and their height.
 *
 * An OSM fetch already knows both — a peak arrives with its `name` and, from its
 * `ele` tag, a note reading "1910m", and the panel has been showing them in the
 * feature list all along. This puts them on the terrain, as geometry rather than
 * as an overlay: a label is flattened into the same `positions` array a contour
 * uses, so it inherits the layer's colour, weight, opacity and dash, the ghost
 * occlusion, the hidden-line removal, and every exporter including the SVG a
 * plotter draws.
 *
 * ── What it adds, and what it never does ─────────────────────────────────────
 * Labels are *appended* to the geometry rather than substituted into it, which
 * is the opposite of what `useVectorIcons` does and for the opposite reason: an
 * icon replaces the dot it is drawn from, while a label sits beside whatever
 * mark the layer already has. A feature with nothing to say — no name, or no
 * height, or neither — is simply not labelled. There is no "(unnamed)" here,
 * because a plot of twenty-nine summits with nine of them labelled "#12" is
 * worse than one with nine unlabelled summits.
 *
 * The anchors come from the layer's *dot* geometry, before any icon replaced
 * it: one degenerate segment per feature, already projected, draped and clipped
 * to the raster. That keeps a label on the same point its mark is on, whatever
 * the mark turns out to be.
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import { loadTextFont, fontStyleKey, textPolylines } from '../utils/textGeometry'
import { iconBasis, iconTriangles } from './useVectorIcons'

// Segments one layer's labels may add. Text is expensive — "Polster" is 266 of
// them and its height another 222 — so this is a few hundred labelled features,
// past which the layer draws none rather than a fraction of them and looking
// like missing data. The panel says so; see `overflowed`.
const MAX_LABEL_SEGMENTS = 80_000

// Baseline-to-baseline distance, in em. Space Mono's ascender and descender
// together are 1.48 em, so this is tight without letting a descender from the
// name touch a digit of the height.
const LINE_HEIGHT = 1.25

/** Does this layer want labels at all? */
export function hasLabels(layer) {
  return !!(layer?.labelName || layer?.labelHeight)
}

/** Which face a layer letters in. */
function fontStyleKeyOf(layer) {
  return fontStyleKey({ bold: layer?.labelBold, italic: layer?.labelItalic })
}

/** The lines one feature shows, in order, skipping what it has nothing for. */
function linesFor(layer, bucket, feature) {
  const out = []
  if (layer.labelName) {
    const name = bucket?.names.get(feature)
    if (name) out.push(name)
  }
  if (layer.labelHeight) {
    // The feature's note, which for a point is what its `ele` tag said — the
    // same string the feature list shows under the name.
    const note = bucket?.notes.get(feature)
    if (note) out.push(note)
  }
  return out
}

/**
 * One point layer's labels, as a `lineGeo`-shaped record.
 *
 * Two passes on purpose: how much geometry a layer needs depends on which of
 * its features turned out to have anything to say, and that is only known after
 * looking at all of them. Sizing the buffers first is what keeps this to two
 * typed arrays instead of a growing pair of JS arrays per frame.
 */
function buildLabelLayer(dots, layer, bucket, font) {
  const src = dots.positions
  const srcFeature = dots.featureOfSegment
  const n = src.length / 6
  if (!n) return null

  const size = layer.labelSize ?? 10
  const align = layer.labelAlign ?? 'center'
  const dx = layer.labelDx ?? 0
  const dy = layer.labelDy ?? 14

  // A label faces the way its layer's icon faces — the two are one mark, and a
  // name lying flat beside an upright summit triangle reads as a mistake.
  const { rx, ry, rz, ux, uy, uz } = iconBasis(
    layer.iconFaceCamera ? layer.viewTilt : (layer.iconTilt ?? 50),
    layer.iconFaceCamera ? layer.viewSpin : (layer.iconSpin ?? 0),
  )

  // ── Pass one: what each feature says, and what that costs ─────────────────
  const jobs = []
  let segments = 0
  for (let i = 0; i < n; i++) {
    const feature = srcFeature ? srcFeature[i] : i
    const lines = linesFor(layer, bucket, feature)
    if (!lines.length) continue
    const blocks = lines.map((t) => textPolylines(t, font)).filter(Boolean)
    if (!blocks.length) continue
    for (const b of blocks) segments += b.segments
    jobs.push({ i, feature, blocks })
  }
  if (!jobs.length) return null
  if (segments > MAX_LABEL_SEGMENTS) return { overflow: true }

  const shapes = layer.labelFill
    ? jobs.map((j) => j.blocks.map((b) => iconTriangles(b)))
    : null
  let triVerts = 0
  if (shapes) {
    for (const perLine of shapes) {
      for (const sh of perLine) for (const s of sh) triVerts += s.tris.length
    }
  }

  const positions = new Float32Array(segments * 6)
  const featureOfSegment = new Int32Array(segments)
  const fillPos = triVerts ? new Float32Array(triVerts * 3) : null
  const fillIdx = triVerts ? new Uint32Array(triVerts) : null
  let w = 0, s = 0, fw = 0, fi = 0

  // ── Pass two: place it ────────────────────────────────────────────────────
  for (let j = 0; j < jobs.length; j++) {
    const { i, feature, blocks } = jobs[j]
    // The dot is a segment shorter than its own width, so its midpoint is the
    // feature's position.
    const ax = (src[i * 6] + src[i * 6 + 3]) * 0.5
    const ay = src[i * 6 + 1]
    const az = src[i * 6 + 2]

    for (let li = 0; li < blocks.length; li++) {
      const block = blocks[li]
      // Left edge of this line, in world units along the plane's right vector.
      const wide = block.width * size
      const x0 = dx - (align === 'center' ? wide / 2 : align === 'right' ? wide : 0)
      const y0 = dy - li * LINE_HEIGHT * size

      const place = (ex, ey, out, at) => {
        const u = x0 + ex * size, v = y0 + ey * size
        out[at]     = ax + u * rx + v * ux
        out[at + 1] = ay + u * ry + v * uy
        out[at + 2] = az + u * rz + v * uz
      }

      if (shapes) {
        for (const shape of shapes[j][li]) {
          for (let t = 0; t < shape.tris.length; t++) {
            const p = shape.tris[t] * 2
            place(shape.pts[p], shape.pts[p + 1], fillPos, fw)
            fillIdx[fi] = fi
            fw += 3; fi++
          }
        }
      }

      for (const poly of block.polylines) {
        for (let k = 0; k + 3 < poly.length; k += 2) {
          place(poly[k], poly[k + 1], positions, w)
          place(poly[k + 2], poly[k + 3], positions, w + 3)
          w += 6
          featureOfSegment[s++] = feature
        }
      }
    }
  }

  return {
    // Suffixed like the icon layer's, so `layerStyle` resolves the style back to
    // the layer and the SVG's pen layer is called "Peaks · labels".
    id: `${layer.id}#labels`,
    positions: w === positions.length ? positions : positions.subarray(0, w),
    colors: null,
    curtains: null,
    lids: null,
    isPoints: false,
    // Pointing at a name should name its feature, exactly as pointing at the
    // mark does…
    featureOfSegment: s === featureOfSegment.length ? featureOfSegment : featureOfSegment.subarray(0, s),
    // …but the *highlight* belongs on the mark: lighting up the text and
    // leaving the summit dark is not what "this one" looks like.
    isLabelText: true,
    fills: fw ? { positions: fillPos.subarray(0, fw), indices: fillIdx.subarray(0, fi) } : null,
  }
}

/**
 * Appends a label entry for every point layer that asked for one.
 *
 * `lineGeo` is what the icons hook already produced — labels go on top of it.
 * `dotsGeo` is the worker's own output, which is where the anchors come from:
 * once an icon has replaced a layer's dots there is no longer one segment per
 * feature to read a position off.
 *
 * Returns `{ lineGeo, overflowed }`, `overflowed` naming the layers whose labels
 * would have cost more than the budget and which are therefore unlabelled, so
 * the panel can say so instead of leaving it a mystery.
 */
export function useVectorLabels(lineGeo, dotsGeo, vectorLayers, vectorSources, viewTilt, viewSpin) {
  // One entry per face in use. Regular, bold, italic and bold-italic are four
  // separate files, and a session that never letters anything fetches none of
  // them; a session that letters in one fetches one.
  const [fonts, setFonts] = useState({})
  // What has been asked for, which is not the same as what has arrived — and it
  // is a ref rather than state because starting a fetch is a side effect and a
  // state updater has to stay pure. React is free to call one twice.
  const asked = useRef(new Set())
  const wantedFaces = [...new Set((vectorLayers ?? []).filter(hasLabels).map(fontStyleKeyOf))].sort().join(',')
  useEffect(() => {
    for (const key of wantedFaces ? wantedFaces.split(',') : []) {
      if (asked.current.has(key)) continue
      asked.current.add(key)
      loadTextFont(key).then((f) => {
        // A face that failed to load is forgotten, so switching away and back
        // tries again rather than leaving the layer permanently unlettered.
        if (!f) asked.current.delete(key)
        setFonts((cur) => ({ ...cur, [key]: f }))
      })
    }
  }, [wantedFaces])

  // Strings rather than the arrays, for the usual reason: `vectorLayers` is
  // replaced on every colour-picker tick, and rebuilding text for a change that
  // cannot move a vertex is waste.
  const anyFaceCamera = (vectorLayers ?? []).some((l) => hasLabels(l) && l.iconFaceCamera)
  const key = (vectorLayers ?? [])
    .filter(hasLabels)
    .map((l) => `${l.id}|${l.labelName ? 1 : 0}|${l.labelHeight ? 1 : 0}|${l.labelSize}|` +
                `${l.labelDx}|${l.labelDy}|${l.labelAlign}|${l.labelFill ? 1 : 0}|` +
                `${fontStyleKeyOf(l)}|${l.iconFaceCamera ? 1 : 0}|${l.iconTilt}|${l.iconSpin}`)
    .join(';')
  const camKey = anyFaceCamera ? `${viewTilt}|${viewSpin}` : ''

  return useMemo(() => {
    const overflowed = new Set()
    if (!key || !Array.isArray(lineGeo) || !Array.isArray(dotsGeo)) {
      return { lineGeo, overflowed }
    }

    const dotsById = new Map()
    for (const e of dotsGeo) if (e.isPoints) dotsById.set(e.id, e)

    // Keyed by the layer whose labels they are, so each one can be put back
    // beside its own geometry rather than at the end of the array.
    const extra = new Map()
    for (const layer of vectorLayers ?? []) {
      if (!hasLabels(layer)) continue
      const dots = dotsById.get(layer.id)
      if (!dots) continue
      const bucket = vectorSources
        ?.find((s) => s.id === layer.sourceId)
        ?.buckets.find((b) => b.key === layer.bucket)
      // Uploaded points carry names but no notes; an OSM fetch carries both.
      if (!bucket) continue

      // Still on the wire, or unreadable: the layer letters nothing this frame
      // and picks it up when the fetch lands.
      const font = fonts[fontStyleKeyOf(layer)]
      if (!font) continue

      const built = buildLabelLayer(dots, { ...layer, viewTilt, viewSpin }, bucket, font)
      if (!built) continue
      if (built.overflow) { overflowed.add(layer.id); continue }
      extra.set(layer.id, built)
    }
    if (!extra.size) return { lineGeo, overflowed }

    // Spliced in directly behind the geometry it labels, not appended.
    // `layerIndex` is the array index and `renderOrder` is built from it, so a
    // label tacked onto the end draws in front of the entire scene — a layer
    // dragged to the bottom of the stack would send its dots behind everything
    // and leave its lettering on top of everything. Here it lands inside its own
    // layer's band: above its marks, below whatever the stack puts above it.
    const out = []
    for (const entry of lineGeo) {
      out.push(entry)
      const label = extra.get(entry.id.split('#')[0])
      if (label) { out.push(label); extra.delete(entry.id.split('#')[0]) }
    }
    // A layer whose geometry never arrived keeps its labels rather than losing
    // them silently; there is nothing to sit beside, so the end is where it goes.
    for (const label of extra.values()) out.push(label)

    return { lineGeo: out, overflowed }
    // `key` and `camKey` stand in for vectorLayers/tilt/rotation — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineGeo, dotsGeo, vectorSources, key, camKey, fonts])
}
