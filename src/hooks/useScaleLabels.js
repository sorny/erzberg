import { useEffect, useMemo, useState } from 'react'
import { loadTextFont, singleLineKey, textPolylines } from '../utils/textGeometry'

/**
 * Letters the numbers of Map Grid's edge scale.
 *
 * The worker places them and knows what each one says — a distance from the
 * south-west corner, which it can measure because it has the cell size — but it
 * has no fonts. So this sets each anchor in a single-line face, the one a pen
 * can draw in one pass, and splices the result in behind the scale it belongs
 * to as `MapGrid-Numbers`. Same split as `useContourLabels`.
 *
 * The numbers lie flat in the ground plane and read north-up, like the sheet in
 * a plan view. Each anchor says how it hangs off its point: `align` across and
 * `valign` up and down, so the numbers above the top edge sit on it and those to
 * the left end at it.
 */

const FONT = singleLineKey('HersheySans1')
/** Cap height in ems, for hanging a number below or centring it on a point. */
const CAP = 0.7

function buildNumbers(host, font) {
  const positions = []
  for (const a of host.scaleAnchors) {
    const built = textPolylines(a.text, font)
    if (!built) continue
    const w = built.width * a.size
    const ox = a.align === 'middle' ? a.x - w / 2 : a.align === 'end' ? a.x - w : a.x
    // Text-up is −z, north. A baseline at z: 'bottom' sits on the point, 'top'
    // hangs a cap height below it, 'middle' centres on it.
    const zb = a.valign === 'top' ? a.z + CAP * a.size : a.valign === 'middle' ? a.z + CAP * a.size / 2 : a.z
    for (const poly of built.polylines) {
      for (let i = 0; i + 3 < poly.length; i += 2) {
        positions.push(
          ox + poly[i] * a.size, a.y, zb - poly[i + 1] * a.size,
          ox + poly[i + 2] * a.size, a.y, zb - poly[i + 3] * a.size,
        )
      }
    }
  }
  if (!positions.length) return null
  return {
    id: host.id.replace(/-Scale$/, '-Numbers'),
    positions: new Float32Array(positions),
    colors: null, curtains: null, lids: null,
    isPoints: false, isLabelText: true, textRuns: null, textStyle: null, fills: null,
  }
}

export function useScaleLabels(lineGeo) {
  const need = Array.isArray(lineGeo) && lineGeo.some((l) => l.scaleAnchors?.length)
  const [font, setFont] = useState(null)

  useEffect(() => {
    if (!need || font) return
    let alive = true
    loadTextFont(FONT).then((f) => { if (alive && f) setFont(f) })
    return () => { alive = false }
  }, [need, font])

  return useMemo(() => {
    if (!need || !font) return lineGeo
    const out = []
    for (const l of lineGeo) {
      out.push(l)
      if (l.scaleAnchors?.length) {
        const built = buildNumbers(l, font)
        if (built) out.push(built)
      }
    }
    return out
  }, [lineGeo, need, font])
}
