import { hexToRgb } from './colorUtils'

const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')

/* ─── The colour the screen actually shows ───────────────────────────────────
 *
 * An ink does not reach the eye as the number it was written as. React Three
 * Fiber gives its `<Canvas>` ACES filmic tone mapping and an sRGB output
 * encode, and `App.jsx` does not override either, so every fragment the
 * renderer draws passes through both before it is a pixel.
 *
 * The exporter wrote the raw number, so the SVG and the viewport disagreed —
 * and disagreed *most* where a colour was bright and saturated, because that is
 * where the tone curve does the most work. Jet's top stop is `#800000` and the
 * screen shows it as `#ca0006`: a deep red on screen, a brown in the file.
 *
 * Measured against the running app, on four inks, exact on every channel:
 *
 *   picked    on screen   this function
 *   #800000   #ca0006     #ca0006
 *   #00cce6   #85dcde     #85dcde
 *   #66cf00   #c3db50     #c3db50
 *   #ffffff   #e2e2e2     #e2e2e2
 *
 * Two things that measurement settled, and neither was safe to assume:
 *
 * A per-vertex colour and a flat material colour come out the *same*. Colour
 * management would convert a material colour from sRGB on its way in and this
 * would need two transforms; it does not, and one transform is right for both.
 *
 * The background is not tone mapped. It arrives through `setClearColor` rather
 * than through a fragment shader, and white paper stays `#ffffff` while white
 * *geometry* renders `#e2e2e2`. So `bgColor` and the gradient stops are written
 * raw, and only ink goes through here.
 *
 * Black maps to black, so ordinary black-on-white line art is unchanged.
 */
const RRT = (v) => (v * (v + 0.0245786) - 0.000090537) /
                   (v * (0.983729 * v + 0.432951) + 0.238081)
const encodeSRGB = (c) => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/*
 * Keyed on the 8-bit triple, which is the precision the file is written at
 * anyway. The segment walk asks this once per segment — a quarter of a million
 * times on a dense plate — for a handful of distinct inks, and three `pow` calls
 * each would be pure waste.
 */
const _inkCache = new Map()

/** An ink in 0–1 floats, as the `#rrggbb` the screen shows for it. */
export function screenInk(r, g, b) {
  const key = (Math.round(clamp01(r) * 255) << 16) |
              (Math.round(clamp01(g) * 255) << 8) |
               Math.round(clamp01(b) * 255)
  const hit = _inkCache.get(key)
  if (hit !== undefined) return hit
  // `toneMappingExposure / 0.6` with the default exposure of 1, then the ACES
  // input matrix, the RRT/ODT fit and the output matrix — three.js's
  // `ACESFilmicToneMapping`, term for term.
  const x = r / 0.6, y = g / 0.6, z = b / 0.6
  const a0 = RRT(0.59719 * x + 0.35458 * y + 0.04823 * z)
  const a1 = RRT(0.07600 * x + 0.90834 * y + 0.01566 * z)
  const a2 = RRT(0.02840 * x + 0.13383 * y + 0.83777 * z)
  const out = '#' +
    hex2(encodeSRGB(clamp01( 1.60475 * a0 - 0.53108 * a1 - 0.07367 * a2))) +
    hex2(encodeSRGB(clamp01(-0.10208 * a0 + 1.10813 * a1 - 0.00605 * a2))) +
    hex2(encodeSRGB(clamp01(-0.00327 * a0 - 0.07276 * a1 + 1.07602 * a2)))
  _inkCache.set(key, out)
  return out
}

/** The same, for an ink that arrives as a `#rrggbb` style string. */
export function screenInkHex(hex) {
  const c = hexToRgb(hex || '#000000')
  return screenInk(c[0], c[1], c[2])
}
