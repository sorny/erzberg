/**
 * Hatch lines for a filled area, for the SVG.
 *
 * The colour modes export closed areas with a fill. A screen shows the fill,
 * and a pen plotter draws only the outline: a fill is not a stroke. This turns
 * an area into the strokes a pen can draw, in the exporter, where the areas
 * already exist as page-space rings.
 *
 * ── The scanline ─────────────────────────────────────────────────────────────
 * The rings are rotated so the hatch runs along x. Each scanline collects its
 * crossings with every edge of every ring, sorts them, and pairs them. Pairing
 * crossings in order is the even-odd rule, which is the rule the exporter
 * writes on the solid fill too, so a hole stays a hole in both. An edge counts
 * on the half-open interval [y0, y1), so a scanline through a vertex crosses
 * once and not twice.
 *
 * ── The order ────────────────────────────────────────────────────────────────
 * Consecutive scanlines run in opposite directions. The pen lifts at the end of
 * one line and puts down next to it, instead of travelling back across the
 * area. On a plotter that is most of the saving a router would find, at no cost.
 */

/**
 * @param {number[][]} loops rings as flat [x, y, x, y, …] in page units
 * @param {number} pitch distance between hatch lines, in the same units
 * @param {number} angleDeg hatch direction, degrees from +x
 * @returns {{segs: number[], ink: number, travel: number, strokes: number}}
 *   `segs` is flat [x0, y0, x1, y1, …] in drawing order.
 */
export function hatchLoops(loops, pitch, angleDeg) {
  const out = { segs: [], ink: 0, travel: 0, strokes: 0 }
  if (!(pitch > 0) || !loops.length) return out
  const a = (angleDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a)
  // Into the hatch frame: u along the stroke, v across it.
  const rot = loops.map((pts) => {
    const r = new Float64Array(pts.length)
    for (let i = 0; i < pts.length; i += 2) {
      r[i] = pts[i] * ca + pts[i + 1] * sa
      r[i + 1] = -pts[i] * sa + pts[i + 1] * ca
    }
    return r
  })
  let vMin = Infinity, vMax = -Infinity
  for (const r of rot) for (let i = 1; i < r.length; i += 2) {
    if (r[i] < vMin) vMin = r[i]
    if (r[i] > vMax) vMax = r[i]
  }
  // Half a pitch in from the edge, so no line grazes a vertex at the extreme.
  const xs = []
  let flip = false, lastX = NaN, lastY = NaN
  for (let v = vMin + pitch / 2; v < vMax; v += pitch) {
    xs.length = 0
    for (const r of rot) {
      const n = r.length
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n
        const u0 = r[i], v0 = r[i + 1], u1 = r[j], v1 = r[j + 1]
        if ((v0 <= v && v < v1) || (v1 <= v && v < v0)) {
          xs.push(u0 + ((v - v0) / (v1 - v0)) * (u1 - u0))
        }
      }
    }
    if (xs.length < 2) continue
    xs.sort((p, q) => p - q)
    const pairs = []
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] > xs[k]) pairs.push(xs[k], xs[k + 1])
    if (flip) pairs.reverse()
    for (let k = 0; k < pairs.length; k += 2) {
      const ua = pairs[k], ub = pairs[k + 1]
      // Back to page space.
      const x0 = ua * ca - v * sa, y0 = ua * sa + v * ca
      const x1 = ub * ca - v * sa, y1 = ub * sa + v * ca
      if (lastX === lastX) out.travel += Math.hypot(x0 - lastX, y0 - lastY)
      out.segs.push(x0, y0, x1, y1)
      out.ink += Math.abs(ub - ua)
      out.strokes++
      lastX = x1; lastY = y1
    }
    flip = !flip
  }
  return out
}

/**
 * CIE L* of a `#rrggbb` ink, scaled to [0, 1].
 *
 * Perceived lightness, not luminance: a mid grey has a luminance of 0.22 and
 * reads as half-way, which is what L* says. Hatch density is a tone, so it
 * follows what the eye sees.
 */
export function inkLightness(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const y = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  const l = y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y
  return l / 100
}

/**
 * How one ink is hatched: its pitch and whether it gets a second direction.
 *
 * The tone the fill stood for is the ink's contrast with the paper, so the hatch
 * density follows that and not the hue. An ink at full contrast gets the base
 * pitch. Half the contrast gets twice the pitch. The darkest third is also
 * crossed. An ink the paper can barely tell apart gets no hatch, only its
 * outline.
 */
export function hatchPlan(inkHex, paperHex, basePitch) {
  const c = Math.abs(inkLightness(inkHex) - inkLightness(paperHex ?? '#ffffff'))
  if (c < 0.04) return null
  return { pitch: basePitch / Math.max(0.12, c), cross: c > 0.66 }
}
