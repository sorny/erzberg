/**
 * Free text layers → geometry.
 *
 * The lettering here is the same lettering `useVectorLabels` does, and
 * deliberately so: the same faces, the same flattener, the same fill
 * triangulation, the same plane basis. What differs is only where the anchor
 * comes from. A point label reads it off a feature's dot; a text layer is told.
 *
 * That means everything a height label can do, a text layer can do — including
 * the two things easiest to lose in a reimplementation. An outline face records
 * a `textRun`, so the SVG carries real editable `<text>` rather than forty
 * little paths; a stroke face records none, because a font nobody has installed
 * would be substituted for whatever the reader had to hand.
 *
 * Built on the main thread like the icons and the labels, for the same reason: a
 * face is fetched rather than computed, and size, lift and orientation are then
 * a frame rather than a worker rebuild.
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import { loadTextFont, fontStyleKey, singleLineKey, textPolylines } from '../utils/textGeometry'
import { iconBasis, iconTriangles } from './useVectorIcons'
import { sampleBilinear } from '../utils/terrain'

/** Segments one text may add, past which it draws nothing and says so. */
const MAX_TEXT_SEGMENTS = 80_000

/** Baseline to baseline, in em — the same figure the point labels use. */
const LINE_HEIGHT = 1.25

/** The face one text layer letters in, as one key. */
function faceKeyOf(l) {
  if (l?.singleLine && l?.font) return singleLineKey(l.font)
  return fontStyleKey({ bold: l?.bold, italic: l?.italic })
}

/**
 * Where a text stands, in world units.
 *
 * `x` and `z` are fractions of the plate's half-extent rather than world units,
 * so moving the resolution slider does not slide every annotation across the
 * terrain under it. The ground height is sampled at that point, so a text sits
 * on the surface and `lift` raises it off — which is what keeps one placed on a
 * summit on that summit when the exaggeration changes.
 */
function anchorOf(l, terrain) {
  const fx = Math.max(-1, Math.min(1, l.x ?? 0))
  const fz = Math.max(-1, Math.min(1, l.z ?? 0))
  const lift = l.lift ?? 0
  if (!terrain) return [fx * 50, lift, fz * 50]

  const { grid, gridMask, rows, cols, scl, halfW, halfH, elevScale } = terrain
  const wx = fx * halfW, wz = fz * halfH
  const fc = (wx + halfW) / scl, fr = (wz + halfH) / scl
  const b = sampleBilinear(grid, gridMask, rows, cols, fr, fc)
  // A text over a hole in the raster has no ground to stand on, so it stands at
  // the base rather than following the NaN down.
  const brightness = Number.isFinite(b) ? b : 0.5
  return [wx, (brightness - 0.5) * 100 * (elevScale ?? 1) + lift, wz]
}

/** One text layer, as a `lineGeo`-shaped record. */
function buildTextLayer(l, terrain, font, viewTilt, viewSpin) {
  const raw = (l.text ?? '')
  if (!raw.trim()) return null

  const lines = raw.split(/\r?\n/)
  const blocks = lines.map((t) => (t.length ? textPolylines(t, font) : null))
  if (!blocks.some(Boolean)) return null

  let segments = 0
  for (const b of blocks) if (b) segments += b.segments
  if (!segments) return null
  if (segments > MAX_TEXT_SEGMENTS) return { id: l.id, overflow: true }

  const size = l.size ?? 14
  const align = l.align ?? 'center'
  const dx = l.dx ?? 0
  const dy = l.dy ?? 0
  const { rx, ry, rz, ux, uy, uz } = iconBasis(
    l.faceCamera ? viewTilt : (l.tilt ?? 50),
    l.faceCamera ? viewSpin : (l.spin ?? 0),
  )
  const [ax, ay, az] = anchorOf(l, terrain)

  /*
   * A stroke face has no interior to fill.
   *
   * A single-line glyph is the centre line of the stem, an open path that never
   * closes, so triangulating it gives a smear roughly where the letter is —
   * worse than nothing, and it reads as a rendering fault rather than a setting.
   * The setting is ignored rather than obeyed, and the panel hides it, which is
   * the same call bold and italic get.
   */
  const shapes = l.fill && !font.stroke
    ? blocks.map((b) => (b ? iconTriangles(b) : null))
    : null
  let triVerts = 0
  if (shapes) for (const sh of shapes) if (sh) for (const s of sh) triVerts += s.tris.length

  const textRuns = font.stroke ? null : []
  const positions = new Float32Array(segments * 6)
  const fillPos = triVerts ? new Float32Array(triVerts * 3) : null
  const fillIdx = triVerts ? new Uint32Array(triVerts) : null
  let w = 0, fw = 0, fi = 0

  // Multi-line text hangs *down* from its anchor, so adding a second line does
  // not shift the first — which is what makes typing into the box feel stable.
  for (let li = 0; li < blocks.length; li++) {
    const block = blocks[li]
    if (!block) continue
    const wide = block.width * size
    const x0 = dx - (align === 'center' ? wide / 2 : align === 'right' ? wide : 0)
    const y0 = dy - li * LINE_HEIGHT * size

    const place = (ex, ey, out, at) => {
      const u = x0 + ex * size, v = y0 + ey * size
      out[at]     = ax + u * rx + v * ux
      out[at + 1] = ay + u * ry + v * uy
      out[at + 2] = az + u * rz + v * uz
    }

    if (textRuns) {
      const at = (u, v) => [ax + u * rx + v * ux, ay + u * ry + v * uy, az + u * rz + v * uz]
      textRuns.push({
        text: block.text,
        feature: 0,
        origin: at(dx, y0),
        emRight: at(dx + size, y0),
        emUp: at(dx, y0 + size),
        anchor: align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start',
      })
    }

    if (shapes?.[li]) {
      for (const shape of shapes[li]) {
        for (let t = 0; t < shape.tris.length; t++) {
          const pi = shape.tris[t] * 2
          place(shape.pts[pi], shape.pts[pi + 1], fillPos, fw)
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
      }
    }
  }

  return {
    id: l.id,
    positions: w === positions.length ? positions : positions.subarray(0, w),
    colors: null,
    curtains: null,
    lids: null,
    isPoints: false,
    // A text is a flat drawing planted on rough ground, exactly as an icon is,
    // and wants the same depth bias so the terrain does not eat half of it.
    isLabelText: true,
    textRuns: textRuns?.length ? textRuns : null,
    textStyle: textRuns?.length ? {
      family: font.family ?? 'Space Mono',
      weight: l.bold ? 700 : 400,
      style: l.italic ? 'italic' : 'normal',
    } : null,
    fills: fw ? { positions: fillPos.subarray(0, fw), indices: fillIdx.subarray(0, fi) } : null,
  }
}

/**
 * Appends one entry per visible text layer, last, so they draw in front.
 *
 * Returns `{ lineGeo, overflowed }`, `overflowed` naming any text that would
 * have cost more than the budget — the panel says so rather than leaving a blank
 * where a title was asked for.
 */
export function useTextLayers(lineGeo, textLayers, terrain, viewTilt, viewSpin) {
  const [fonts, setFonts] = useState({})
  const asked = useRef(new Set())

  const live = useMemo(
    () => (textLayers ?? []).filter((l) => l.visible !== false && (l.text ?? '').trim()),
    [textLayers])

  const wantedFaces = [...new Set(live.map(faceKeyOf))].sort().join(',')
  useEffect(() => {
    for (const key of wantedFaces ? wantedFaces.split(',') : []) {
      if (asked.current.has(key)) continue
      asked.current.add(key)
      loadTextFont(key).then((f) => {
        // A face that failed is forgotten, so switching away and back retries
        // rather than leaving the layer permanently unlettered.
        if (!f) asked.current.delete(key)
        setFonts((cur) => ({ ...cur, [key]: f }))
      })
    }
  }, [wantedFaces])

  // A string rather than the array: `textLayers` is replaced on every colour
  // tick, and re-flattening a face for a change that cannot move a vertex is
  // waste. Colour, weight, opacity and dash are resolved render-side and are
  // deliberately absent from this key.
  const anyFaceCamera = live.some((l) => l.faceCamera)
  const key = live.map((l) => [
    l.id, l.text, l.size, l.align, l.dx, l.dy, l.x, l.z, l.lift,
    l.bold, l.italic, l.singleLine, l.font, l.fill,
    l.faceCamera, l.faceCamera ? '' : l.tilt, l.faceCamera ? '' : l.spin,
  ].join(' ')).join('')

  const tiltKey = anyFaceCamera ? viewTilt : 0
  const spinKey = anyFaceCamera ? viewSpin : 0

  return useMemo(() => {
    if (!live.length) return { lineGeo, overflowed: [] }
    const out = Array.isArray(lineGeo) ? [...lineGeo] : []
    const overflowed = []
    for (const l of live) {
      const font = fonts[faceKeyOf(l)]
      if (!font) continue
      const rec = buildTextLayer(l, terrain, font, tiltKey, spinKey)
      if (!rec) continue
      if (rec.overflow) { overflowed.push(l.id); continue }
      out.push(rec)
    }
    return { lineGeo: out, overflowed }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineGeo, key, fonts, terrain, tiltKey, spinKey])
}
