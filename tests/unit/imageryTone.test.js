/**
 * The exposure a Sentinel-2 drape is shown under.
 *
 * The numbers in `graz()` are not invented. They are the measured histogram of
 * scene S2B_33TWN_20230909_1_L2A over a thousand pixels square of real ground:
 * median R 24, G 43, B 26 out of 255, with a bright tail reaching p98 = 130.
 * That is the case the whole module exists for, so it is the fixture.
 *
 * The claim worth holding down is the second one. A plain 2–98% stretch is the
 * obvious repair and it is *not enough* on this data — the tail drags p98 up
 * and leaves the median near black. If someone later simplifies the gamma away,
 * that test is what says why it was there.
 */
import { describe, it, expect } from 'vitest'
import {
  NEUTRAL_TONE, TONE_DEFAULTS, applyTone, autoTone, toneFor,
} from '../../src/utils/imageryTone'

const LUMA = [0.2126, 0.7152, 0.0722]

/**
 * A synthetic window with the Graz scene's measured distribution.
 *
 * Built from the quantile curve rather than by picking two values, because the
 * shape is the whole point: dark and skewed, with a thin bright tail. A
 * two-valued fixture has its p2 and its median in the same place, which makes
 * the stretch look like it works.
 */
function graz(w = 64, h = 64) {
  // (quantile, R, G, B) at the three measured points, plus the ends.
  const q = [
    [0.00, 4, 10, 6], [0.02, 12, 20, 13], [0.50, 24, 43, 26],
    [0.98, 130, 121, 89], [1.00, 255, 255, 255],
  ]
  const at = (f, c) => {
    for (let i = 1; i < q.length; i++) {
      if (f <= q[i][0]) {
        const t = (f - q[i - 1][0]) / (q[i][0] - q[i - 1][0])
        return Math.round(q[i - 1][c] + t * (q[i][c] - q[i - 1][c]))
      }
    }
    return q[q.length - 1][c]
  }
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4, f = i / (w * h - 1)
    rgba[o] = at(f, 1); rgba[o + 1] = at(f, 2); rgba[o + 2] = at(f, 3)
    rgba[o + 3] = 255
  }
  return { rgba, width: w, height: h }
}

/** Mean luminance of an RGBA buffer, 0–1, over opaque pixels only. */
function meanLuma(rgba) {
  let sum = 0, n = 0
  for (let o = 0; o < rgba.length; o += 4) {
    if (!rgba[o + 3]) continue
    sum += (LUMA[0] * rgba[o] + LUMA[1] * rgba[o + 1] + LUMA[2] * rgba[o + 2]) / 255
    n++
  }
  return n ? sum / n : 0
}

/**
 * Median luminance, 0–1.
 *
 * The median and not the mean, because the distribution is skewed and that is
 * the entire problem: a bright tail pulls the mean up while almost every pixel
 * on screen stays dark. The mean of this scene looks acceptable and the scene
 * does not.
 */
function medLuma(rgba) {
  const vals = []
  for (let o = 0; o < rgba.length; o += 4) {
    if (!rgba[o + 3]) continue
    vals.push((LUMA[0] * rgba[o] + LUMA[1] * rgba[o + 1] + LUMA[2] * rgba[o + 2]) / 255)
  }
  vals.sort((a, b) => a - b)
  return vals[Math.floor(vals.length / 2)]
}

describe('autoTone', () => {
  it('reads the window it was given, per channel', () => {
    const { rgba, width, height } = graz()
    const tone = autoTone(rgba, width, height)
    // Blue's tail is lower than red's, so its ceiling must be lower too — a
    // single shared ceiling is what leaves a Sentinel scene looking blue.
    expect(tone.hi[2]).toBeLessThan(tone.hi[0])
    expect(tone.lo[0]).toBeLessThan(tone.hi[0])
  })

  it('lifts the midtones, because a stretch alone does not', () => {
    const { rgba, width, height } = graz()
    const tone = autoTone(rgba, width, height)
    expect(tone.gamma, 'a dark scene must solve for gamma below 1').toBeLessThan(0.7)

    // The point, measured: stretch-only against the full pipeline.
    const stretchOnly = applyTone(rgba, width, height,
      { ...tone, gamma: 1, brightness: 1, contrast: 1, saturation: 1 })
    const full = applyTone(rgba, width, height,
      { ...tone, brightness: 1, contrast: 1, saturation: 1 })

    expect(medLuma(stretchOnly), 'a plain 2–98 stretch leaves it dark').toBeLessThan(0.25)
    expect(medLuma(full), 'the gamma is what makes it visible').toBeGreaterThan(0.35)
  })

  it('half-corrects the colour cast rather than fully', () => {
    // Fully per-channel turns every shadow slate, because blue's useful range
    // is far narrower than red's and so receives far more gain. Not correcting
    // at all leaves the product's green bias on roofs and roads. The measured
    // raw spans here are 118 (R) against 76 (B) — a ratio of 0.64.
    const { rgba, width, height } = graz()
    const tone = autoTone(rgba, width, height)
    const spanR = tone.hi[0] - tone.lo[0], spanB = tone.hi[2] - tone.lo[2]
    expect(spanB, 'not fully equalised').toBeLessThan(spanR)
    expect(spanB / spanR, 'but much closer than raw').toBeGreaterThan(0.75)
  })

  it('leaves a well-exposed scene alone', () => {
    // Nothing to rescue: a scene already spread across the range must not be
    // dragged anywhere, or the correction becomes a distortion.
    const w = 32, h = 32
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4, v = Math.round((i / (w * h)) * 255)
      rgba[o] = rgba[o + 1] = rgba[o + 2] = v
      rgba[o + 3] = 255
    }
    expect(autoTone(rgba, w, h).gamma).toBeGreaterThan(0.75)
  })

  it('ignores the transparent corners of a rotated scene', () => {
    // A Sentinel-2 scene is a rotated square inside its own grid, so a window
    // near its edge has genuinely empty corners. Counting those as black would
    // drag every percentile down and over-brighten the real ground. Padded
    // with transparent black rather than having real pixels removed, so the
    // two buffers differ in exactly the thing under test.
    const { rgba, width, height } = graz()
    const padded = new Uint8ClampedArray(width * height * 2 * 4)
    padded.set(rgba, 0)
    expect(autoTone(padded, width, height * 2)).toEqual(autoTone(rgba, width, height))
  })

  it('does not amplify noise in a flat window', () => {
    const w = 16, h = 16
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      rgba[o] = rgba[o + 1] = rgba[o + 2] = 40 + (i % 2)
      rgba[o + 3] = 255
    }
    const tone = autoTone(rgba, w, h)
    for (let c = 0; c < 3; c++) expect(tone.hi[c] - tone.lo[c]).toBeGreaterThanOrEqual(12)
  })

  it('answers neutrally for a fully transparent window', () => {
    expect(autoTone(new Uint8ClampedArray(4 * 4 * 4), 4, 4)).toEqual(NEUTRAL_TONE)
  })
})

describe('toneFor', () => {
  it('uses the scene tone when auto levels is on', () => {
    const imagery = { tone: { lo: [5, 6, 7], hi: [200, 201, 202], gamma: 0.4 } }
    expect(toneFor(imagery, TONE_DEFAULTS).gamma).toBe(0.4)
  })

  it('shows the raw product when auto levels is off', () => {
    // Off must mean off, not a milder correction — that is what the person who
    // reached for the switch asked to see.
    const imagery = { tone: { lo: [5, 6, 7], hi: [200, 201, 202], gamma: 0.4 } }
    const t = toneFor(imagery, { ...TONE_DEFAULTS, imageryAutoLevels: false })
    expect(t.gamma).toBe(1)
    expect(t.lo).toEqual([0, 0, 0])
    expect(t.hi).toEqual([255, 255, 255])
  })

  it('falls back when a plate carries no measured tone', () => {
    // Imagery fetched by an older build has no `tone` field at all.
    expect(toneFor({}, TONE_DEFAULTS).gamma).toBe(1)
    expect(toneFor(null, TONE_DEFAULTS).gamma).toBe(1)
  })
})

describe('applyTone', () => {
  const { rgba, width, height } = graz()
  const tone = { ...autoTone(rgba, width, height), ...{ brightness: 1, contrast: 1, saturation: 1 } }

  it('does not touch the input buffer', () => {
    const copy = new Uint8ClampedArray(rgba)
    applyTone(rgba, width, height, tone)
    expect(rgba).toEqual(copy)
  })

  it('keeps alpha, so empty corners stay empty', () => {
    const withVoid = new Uint8ClampedArray(rgba)
    withVoid[3] = 0
    expect(applyTone(withVoid, width, height, tone)[3]).toBe(0)
  })

  it('greys the scene at zero saturation and keeps colour above it', () => {
    // Read a mid-distribution pixel: the ends of this fixture clip, and a
    // clipped pixel is grey whatever the saturation is.
    const mid = (Math.floor(width * height * 0.5)) * 4
    const flat = applyTone(rgba, width, height, { ...tone, saturation: 0 })
    expect(flat[mid]).toBe(flat[mid + 1])
    expect(flat[mid + 1]).toBe(flat[mid + 2])
    const colour = applyTone(rgba, width, height, { ...tone, saturation: 1 })
    expect(colour[mid + 1]).not.toBe(colour[mid + 2])
  })

  it('brightens monotonically', () => {
    const dim = meanLuma(applyTone(rgba, width, height, { ...tone, brightness: 0.5 }))
    const mid = meanLuma(applyTone(rgba, width, height, { ...tone, brightness: 1 }))
    const hot = meanLuma(applyTone(rgba, width, height, { ...tone, brightness: 2 }))
    expect(dim).toBeLessThan(mid)
    expect(mid).toBeLessThan(hot)
  })
})
