/**
 * Making a Sentinel-2 drape legible.
 *
 * ── Why it arrives dark ──────────────────────────────────────────────────────
 * The `visual` asset is not a photograph. It is a fixed-gain product: ESA maps
 * reflectance onto 0–255 with one constant for the whole planet, so a scene is
 * exposed for the brightest ground there is — cloud, snow, bare limestone — and
 * ordinary vegetated terrain lands near the floor.
 *
 * Measured over Graz, 2023-09-09, a thousand pixels square of real ground:
 *
 *     channel   p2    median   p98
 *     R         12      24     130
 *     G         20      43     121
 *     B         13      26      89
 *
 * The median pixel is at 9–17% brightness. Draped on terrain and then mixed
 * with a hillshade and multiplied by ambient occlusion, it reads as black.
 *
 * ── Why a stretch alone does not fix it ──────────────────────────────────────
 * The obvious repair is a 2–98% levels stretch per channel, and on this data it
 * is not enough. The distribution is heavily skewed: most of the ground is dark
 * and a small bright tail drags p98 up to 130. Stretching red by those ends
 * puts the median at (24−12)/(130−12) = **0.10** — still almost black, now with
 * the contrast spent on outliers.
 *
 * So the stretch is followed by a gamma, and the gamma is not a constant
 * either. It is solved per scene so the stretched median lands on `TARGET`:
 *
 *     median^gamma = TARGET   ⇒   gamma = ln(TARGET) / ln(median)
 *
 * For the numbers above that is ln(0.45)/ln(0.102) ≈ 0.35, and the median comes
 * out at 0.45 where it can be seen. A scene that is already well exposed solves
 * to a gamma near 1 and is left alone, which is the property that makes this
 * safe to leave on by default.
 *
 * ── Why the maths lives here and not in the shader ───────────────────────────
 * Two consumers have to agree pixel for pixel: the surface shader draping the
 * terrain, and the Mask Studio's backdrop, which is a 2D canvas and cannot run
 * GLSL. A mask painted against one exposure and checked against another would
 * put the boundary in a different place, so the pipeline is written once here,
 * in `applyTone`, and transcribed into `TONE_GLSL` directly below it.
 */

/** Rec. 709 luminance, the same weights the rest of the app uses. */
const LUMA = [0.2126, 0.7152, 0.0722]

/** Where a scene's median brightness is aimed. Mid-grey, very slightly under. */
const TARGET = 0.45

/**
 * Gamma is clamped rather than trusted.
 *
 * A scene that is nearly all shadow — a winter valley, a window that caught the
 * edge of a cloud bank — solves for a gamma low enough to turn sensor noise
 * into visible mush. A scene that is nearly all cloud solves the other way and
 * would crush the little real ground it has.
 */
const GAMMA_MIN = 0.25
const GAMMA_MAX = 1.0

/** A stretch narrower than this is noise being amplified, not contrast. */
const MIN_SPAN = 12

/**
 * How far the per-channel ends are pulled toward their shared mean.
 *
 * Stretching each channel by its own percentiles is a white balance, and on
 * Sentinel-2 it overcorrects in a way that is obvious once seen. Blue's useful
 * range over vegetated ground is much narrower than red's — 13–89 against
 * 12–130 over Graz — so blue receives about 1.55× the gain, and every shadow
 * in the scene turns slate.
 *
 * Not stretching per channel at all is worse in the other direction: the shared
 * span leaves the product's green bias on everything, so roofs and roads that
 * should read neutral come out tinted.
 *
 * Half way removes most of the cast and keeps the shadows neutral. Chosen by
 * rendering all three against the Graz scene and looking at them, which is the
 * only way this particular number can honestly be chosen.
 */
const BALANCE = 0.5

/** Identity: what the pipeline does when auto levels is switched off. */
export const NEUTRAL_TONE = { lo: [0, 0, 0], hi: [255, 255, 255], gamma: 1 }

export const TONE_DEFAULTS = {
  imageryAutoLevels: true,
  imageryBrightness: 1,
  imageryContrast: 1,
  imagerySaturation: 1,
}

/**
 * The levels and gamma a particular window of imagery asks for.
 *
 * One pass to build three 256-bin histograms, which is the whole cost — a
 * 2048-square drape is four million reads of a typed array and lands in a few
 * milliseconds. Fully transparent pixels are skipped: a Sentinel-2 scene is a
 * rotated square inside its own grid, so a window near its edge has genuinely
 * empty corners, and counting those as black would drag every percentile down.
 */
export function autoTone(rgba, width, height) {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  let n = 0
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (rgba[o + 3] === 0) continue
    hist[0][rgba[o]]++; hist[1][rgba[o + 1]]++; hist[2][rgba[o + 2]]++
    n++
  }
  if (!n) return { ...NEUTRAL_TONE }

  const at = (h, frac) => {
    const want = frac * n
    let seen = 0
    for (let v = 0; v < 256; v++) { seen += h[v]; if (seen >= want) return v }
    return 255
  }

  const lo = [0, 0, 0], hi = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    lo[c] = at(hist[c], 0.02)
    hi[c] = at(hist[c], 0.98)
    if (hi[c] - lo[c] < MIN_SPAN) {
      // Widen about the middle rather than giving up, so a genuinely flat
      // window still gets its colour cast removed.
      const mid = (hi[c] + lo[c]) / 2
      lo[c] = Math.max(0, Math.round(mid - MIN_SPAN / 2))
      hi[c] = Math.min(255, Math.round(mid + MIN_SPAN / 2))
    }
  }

  // Pull the ends part-way toward their shared mean — see BALANCE.
  const midLo = (lo[0] + lo[1] + lo[2]) / 3
  const midHi = (hi[0] + hi[1] + hi[2]) / 3
  for (let c = 0; c < 3; c++) {
    lo[c] = Math.round(lo[c] + (midLo - lo[c]) * BALANCE)
    hi[c] = Math.round(hi[c] + (midHi - hi[c]) * BALANCE)
  }

  // The gamma is solved on luminance, not per channel: solving each channel
  // separately would move the three medians to the same place and grey the
  // scene out, which is the one thing a drape must not do — the colour is why
  // it is there.
  const medL = medianLuma(hist, n, lo, hi)
  let gamma = 1
  if (medL > 0.001 && medL < 0.999) gamma = Math.log(TARGET) / Math.log(medL)
  gamma = Math.min(GAMMA_MAX, Math.max(GAMMA_MIN, gamma))

  return { lo, hi, gamma }
}

/**
 * The median of post-stretch luminance, from the per-channel histograms.
 *
 * The channels are not sampled together, so this is an approximation: it
 * combines each channel's own median rather than the median of the combined
 * luminance. That is the right trade. Holding a joint histogram would mean
 * 16.7 million bins or a second pass over the pixels, to refine a number whose
 * only job is to seed a curve the user can then drag.
 */
function medianLuma(hist, n, lo, hi) {
  const at = (h, frac) => {
    const want = frac * n
    let seen = 0
    for (let v = 0; v < 256; v++) { seen += h[v]; if (seen >= want) return v }
    return 255
  }
  let sum = 0
  for (let c = 0; c < 3; c++) {
    const med = at(hist[c], 0.5)
    const span = Math.max(1, hi[c] - lo[c])
    sum += LUMA[c] * Math.min(1, Math.max(0, (med - lo[c]) / span))
  }
  return sum
}

/**
 * The tone a given imagery object and style resolve to.
 *
 * Auto levels off means the raw product, which is the honest thing to show
 * someone who switched the correction off — not a milder correction.
 */
export function toneFor(imagery, style = {}) {
  const auto = style.imageryAutoLevels ?? TONE_DEFAULTS.imageryAutoLevels
  const base = (auto && imagery?.tone) ? imagery.tone : NEUTRAL_TONE
  return {
    lo: base.lo, hi: base.hi, gamma: base.gamma,
    brightness: style.imageryBrightness ?? TONE_DEFAULTS.imageryBrightness,
    contrast: style.imageryContrast ?? TONE_DEFAULTS.imageryContrast,
    saturation: style.imagerySaturation ?? TONE_DEFAULTS.imagerySaturation,
  }
}

/**
 * The pipeline, on the CPU, for the Studio backdrop.
 *
 * Returns a new buffer rather than editing in place: `imagery.rgba` is the
 * original product and every other consumer expects it untouched, including
 * the next call to this function with a different setting.
 */
export function applyTone(rgba, width, height, tone) {
  const out = new Uint8ClampedArray(rgba.length)
  const { lo, hi, gamma, brightness, contrast, saturation } = tone
  // One lookup table per channel: the levels, the gamma and the contrast all
  // depend on the input value alone, so 768 pow() calls replace three per
  // pixel — four million on a 2048-square drape.
  const lut = [0, 1, 2].map((c) => {
    const span = Math.max(1, hi[c] - lo[c])
    const t = new Float32Array(256)
    for (let v = 0; v < 256; v++) {
      let x = Math.min(1, Math.max(0, (v - lo[c]) / span))
      x = Math.pow(x, gamma)
      x = (x - 0.5) * contrast + 0.5
      t[v] = x * brightness
    }
    return t
  })

  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    out[o + 3] = rgba[o + 3]
    if (rgba[o + 3] === 0) continue
    const r = lut[0][rgba[o]], g = lut[1][rgba[o + 1]], b = lut[2][rgba[o + 2]]
    const l = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b
    out[o]     = 255 * clamp01(l + (r - l) * saturation)
    out[o + 1] = 255 * clamp01(l + (g - l) * saturation)
    out[o + 2] = 255 * clamp01(l + (b - l) * saturation)
  }
  return out
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * The same pipeline in GLSL, for the surface shader.
 *
 * Kept beside `applyTone` on purpose. These two must not drift: a mask painted
 * against the Studio's exposure and checked against the terrain's would put its
 * boundary in a different place, and nothing would report the disagreement.
 */
export const TONE_GLSL = `
  vec3 toneImagery(vec3 c) {
    c = clamp((c * 255.0 - uImageryLo) / max(uImageryHi - uImageryLo, vec3(1.0)), 0.0, 1.0);
    c = pow(c, vec3(uImageryGamma));
    c = (c - 0.5) * uImageryContrast + 0.5;
    c *= uImageryBrightness;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return clamp(mix(vec3(l), c, uImagerySaturation), 0.0, 1.0);
  }
`
