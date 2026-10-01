import { useEffect, useMemo, useState } from 'react'
import { loadTextFont, fontStyleKey, singleLineKey, textPolylines } from '../utils/textGeometry'
import { gridValueToMetres } from '../utils/geoCoords'

/**
 * Letters the contour labels the worker reserved room for.
 *
 * The split is not arbitrary. Placing a label needs the *chain* — the contour as
 * one continuous stroke — which only exists inside `buildContours`, and breaking
 * the line for it moves geometry, which is worker work. But turning a level into
 * a number needs the raster's real elevation range, which the worker never sees,
 * and drawing that number needs a font, which is fetched and cached on the main
 * thread. So the worker decides *where* and this decides *what* and *how it
 * looks*, exactly as `useVectorLabels` splits the same job for point features.
 *
 * The anchors arrive in world coordinates with a baseline angle, so nothing here
 * needs to know the raster's cell size or centring.
 */

/** Half a cap height, in ems — what lifts a baseline onto the line it labels. */
const BASELINE_LIFT = 0.35

/**
 * What a contour level is called.
 *
 * With a GeoTIFF loaded the app knows what the raster's brightness means in
 * metres, and a contour that says 1450 is the whole point of the feature.
 *
 * With a PNG it knows no such thing. The world elevation is the wrong answer
 * there: it is centred on zero, so half of a perfectly ordinary hill comes out
 * negative and a mountain is labelled −44. Height above the lowest ground is
 * both honest and readable — the bottom contour reads 0 and they climb from
 * there, spaced by exactly the interval the slider is set to.
 */
function levelLabel(anchor, elevMin, elevMax, blackPoint, whitePoint) {
  if (elevMin == null || elevMax == null) return String(Math.round(anchor.rel))
  // Through the histogram, not around it: `anchor.v` is a brightness the
  // Shadows/Highlights handles have already clipped and restretched, so the file
  // range alone would name the wrong metre — and by a different amount at each
  // end, which is exactly the error a reader cannot see.
  return String(Math.round(gridValueToMetres(anchor.v, elevMin, elevMax, blackPoint, whitePoint)))
}

/** The face a contour label is set in — the same key space as vector labels. */
function contourFontKey(style) {
  return style?.labelSingleLineContours
    ? singleLineKey(style.labelFontContours ?? 'HersheySans1')
    : fontStyleKey({})
}

/**
 * Builds the `Contours-Labels` layer, or null when there is nothing to letter.
 */
function buildContourLabelLayer(anchors, size, font, elevMin, elevMax, blackPoint, whitePoint) {
  const positions = []
  const textRuns = font.stroke ? null : []

  for (const a of anchors) {
    const text = levelLabel(a, elevMin, elevMax, blackPoint, whitePoint)
    const built = textPolylines(text, font)
    if (!built) continue

    // The label lies flat in the ground plane at its contour's own height, so
    // the em box is two directions in XZ rather than a camera-facing basis:
    // `d` runs along the line, `u` is text-up, which is `d` turned a quarter
    // turn against +z (screen-down in a plan view).
    const ca = Math.cos(a.angle), sa = Math.sin(a.angle)
    const dx = ca, dz = sa
    const ux = sa, uz = -ca

    // Centred on the anchor along the line, and lifted so the baseline sits on
    // the line rather than under it.
    const halfW = (built.width * size) / 2
    const ox = a.x - dx * halfW + ux * (-BASELINE_LIFT * size)
    const oz = a.z - dz * halfW + uz * (-BASELINE_LIFT * size)

    for (const poly of built.polylines) {
      for (let i = 0; i + 3 < poly.length; i += 2) {
        const u0 = poly[i] * size,     v0 = poly[i + 1] * size
        const u1 = poly[i + 2] * size, v1 = poly[i + 3] * size
        positions.push(
          ox + dx * u0 + ux * v0, a.y, oz + dz * u0 + uz * v0,
          ox + dx * u1 + ux * v1, a.y, oz + dz * u1 + uz * v1,
        )
      }
    }

    // An outline face also travels as text, so the SVG export can write a
    // `<text>` a reader can retype. A stroke face has no installed font to set
    // it in, so it stays strokes — the same bargain the vector labels take.
    if (textRuns) {
      textRuns.push({
        text,
        origin:  [ox, a.y, oz],
        emRight: [ox + dx * size, a.y, oz + dz * size],
        emUp:    [ox + ux * size, a.y, oz + uz * size],
        anchor: 'start',
      })
    }
  }

  if (!positions.length) return null
  return {
    id: 'Contours-Labels',
    positions: new Float32Array(positions),
    colors: null,
    curtains: null,
    lids: null,
    isPoints: false,
    isLabelText: true,
    textRuns: textRuns?.length ? textRuns : null,
    textStyle: textRuns?.length ? { family: font.family ?? 'Space Mono', weight: 400, style: 'normal' } : null,
    fills: null,
  }
}

/**
 * Splices a lettered `Contours-Labels` layer in behind the contours it labels.
 *
 * Returns `lineGeo` untouched when labelling is off, when no contour was long
 * enough to hold a number, or while the face is still on the wire — a missing
 * font is a missing label, not a broken scene.
 */
export function useContourLabels(lineGeo, style, geoTiffElevMin, geoTiffElevMax,
                                 blackPoint = 0, whitePoint = 255) {
  /*
   * One view per Contours that can carry labels: the mode itself, and each
   * mode copy with its values over the style (see utils/modeCopies.js). Each
   * labels its own host layer, `Contours-Minor` or `Contours-Minor@c3`, in its
   * own size and face.
   *
   * Only what the *geometry* depends on goes into `sig`: the em size and the
   * face. `style` is a fresh object on every edit, so depending on it rebuilt
   * every label on every slider drag anywhere in the panel. Colour, weight and
   * opacity reach these through `layerStyle`, which is the whole reason
   * recolouring is a re-render rather than a rebuild.
   */
  const views = [{ suffix: '', st: style },
    ...(style?.modeCopies ?? []).filter((c) => c.mode === 'Contours')
      .map((c) => ({ suffix: `@${c.uid}`, st: { ...style, ...c.values } }))]
  const wants = views.filter((v) => v.st?.labelContours)
    .map((v) => ({ suffix: v.suffix, fontKey: contourFontKey(v.st), size: v.st.labelSizeContours ?? 9 }))
  const sig = wants.length ? JSON.stringify(wants) : ''
  const [fonts, setFonts] = useState({})

  useEffect(() => {
    let alive = true
    for (const key of new Set(sig ? JSON.parse(sig).map((w) => w.fontKey) : [])) {
      if (fonts[key]) continue
      loadTextFont(key).then((f) => {
        if (alive && f) setFonts((prev) => (prev[key] ? prev : { ...prev, [key]: f }))
      })
    }
    return () => { alive = false }
  }, [sig, fonts])

  return useMemo(() => {
    if (!sig || !Array.isArray(lineGeo)) return lineGeo
    const bySuffix = new Map(JSON.parse(sig).map((w) => [w.suffix, w]))
    let changed = false
    const out = []
    // Directly behind the contours each belongs to, not appended: `layerIndex`
    // becomes `renderOrder`, so a label tacked onto the end would draw in front
    // of the whole scene.
    for (const entry of lineGeo) {
      out.push(entry)
      if (!entry.labelAnchors?.length) continue
      const suffix = /(@\w+)$/.exec(entry.id)?.[1] ?? ''
      const want = bySuffix.get(suffix)
      const font = want && fonts[want.fontKey]
      if (!font) continue
      const built = buildContourLabelLayer(entry.labelAnchors, want.size, font,
                                           geoTiffElevMin, geoTiffElevMax, blackPoint, whitePoint)
      if (!built) continue
      out.push({ ...built, id: built.id + suffix })
      changed = true
    }
    return changed ? out : lineGeo
  }, [lineGeo, fonts, sig, geoTiffElevMin, geoTiffElevMax, blackPoint, whitePoint])
}
