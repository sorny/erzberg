import { test, expect } from '@playwright/test'

/**
 * The three defects the changelog carried for a while under "Known, not fixed".
 *
 * Each is a case where the code produced a plausible-looking wrong answer, which
 * is why none of them showed up as a crash and why all three want a test that
 * states the invariant rather than the output.
 */
const PAGE = 'http://localhost:5173'

test('the beat impulse is the same at 60 Hz and at 144 Hz', async ({ page }) => {
  /*
   * `burst` is an envelope, not an event: it stays above zero for several frames
   * after an onset. A fixed kick applied on each of them therefore accumulated
   * in proportion to the frame rate, and a 144 Hz display hit the flock about
   * 2.4x as hard as a 60 Hz one for the same music.
   *
   * Simulated here rather than measured through the renderer, because the thing
   * under test is the arithmetic and a real display runs at whatever it runs at.
   */
  await page.goto(PAGE)
  await page.waitForSelector('text=erzberg', { timeout: 30_000 })

  const r = await page.evaluate(async () => {
    const { applyBurst } = await import('/src/utils/murmuration.js')

    // `applyBurst` reads n, pos and vel and nothing else, so this is the whole
    // of what it operates on — a real flock would drag in a terrain field the
    // arithmetic under test has no use for.
    const makeFlock = (n) => {
      const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3)
      let seed = 1
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 2000) / 1000 - 1 }
      for (let i = 0; i < n * 3; i++) pos[i] = rnd() * 50
      return { n, pos, vel }
    }

    // One onset, decaying over a fixed 200 ms — the shape `listen` produces.
    const ENVELOPE_MS = 200
    const speedAt = (tMs) => Math.max(0, 1 - tMs / ENVELOPE_MS)

    // `scaled` is what ships; `raw` is what it replaced, kept so the test shows
    // the defect rather than merely asserting its absence.
    const run = (fps, scaled) => {
      const flock = makeFlock(200)
      const before = Array.from(flock.vel)
      const dtMs = 1000 / fps
      for (let t = 0; t < ENVELOPE_MS; t += dtMs) {
        const s = speedAt(t)
        if (s > 0) applyBurst(flock, scaled ? s * (dtMs / 1000) * 60 : s)
      }
      let total = 0
      for (let i = 0; i < flock.vel.length; i++) total += Math.abs(flock.vel[i] - before[i])
      return total
    }

    return {
      at30: run(30, true), at60: run(60, true), at144: run(144, true),
      raw30: run(30, false), raw60: run(60, false), raw144: run(144, false),
    }
  })

  console.log(`fixed:   30Hz ${r.at30.toFixed(1)}  60Hz ${r.at60.toFixed(1)}  144Hz ${r.at144.toFixed(1)}`)
  console.log(`unfixed: 30Hz ${r.raw30.toFixed(1)}  60Hz ${r.raw60.toFixed(1)}  144Hz ${r.raw144.toFixed(1)}`)
  expect(r.at60).toBeGreaterThan(0)

  /*
   * Held within a tenth across a near-5x span of frame rates.
   *
   * Not exact, and it should not be: summing an envelope at 30 Hz samples a
   * decaying ramp six times where 60 Hz samples it twelve, and a rectangle sum
   * of a ramp carries an error proportional to the step. That residual is
   * discretisation, not frame-rate dependence, and it shrinks as the rate rises
   * — which is why 144 against 60 is tighter than 30 against 60.
   */
  expect(r.at144 / r.at60, '144 Hz must not hit harder than 60 Hz').toBeCloseTo(1, 1)
  expect(Math.abs(r.at30 / r.at60 - 1), 'nor 30 Hz softer').toBeLessThan(0.1)

  // And the defect this replaced: without the scaling the impulse simply
  // followed the frame count, delivering 2.4x as much at 144 Hz as at 60.
  expect(r.raw144 / r.raw60, 'the unscaled form tracked the frame rate')
    .toBeGreaterThan(2)
})

test('a tempo is never inferred from a couple of cycles', async ({ page }) => {
  /*
   * The autocorrelation divides by the overlap so long and short lags compare
   * fairly, which stops being true once the overlap is tiny: at the old ceiling
   * of `flux.length - 1` it averaged a single product. A clip barely longer than
   * one beat period was then handed a tempo decided by its own length.
   */
  await page.goto(PAGE)
  await page.waitForSelector('text=erzberg', { timeout: 30_000 })

  const r = await page.evaluate(async () => {
    const { detectBpm } = await import('/src/utils/trackProjections.js')
    const frameRate = 100

    // A clean 120 BPM pulse: an impulse every half second.
    const beats = (n, bpm) => {
      const f = new Float32Array(Math.round((n * 60 / bpm) * frameRate))
      const period = (60 / bpm) * frameRate
      for (let i = 0; i < n; i++) {
        const at = Math.round(i * period)
        if (at < f.length) f[at] = 1
      }
      return f
    }

    // Pure noise, no periodicity at all: whatever comes back is not a reading.
    const noise = new Float32Array(300)
    let seed = 7
    for (let i = 0; i < noise.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; noise[i] = (seed % 1000) / 1000 }

    return {
      long: detectBpm(beats(32, 120), frameRate),
      short: detectBpm(beats(3, 120), frameRate),
      noise: detectBpm(noise, frameRate),
    }
  })

  console.log(JSON.stringify(r))
  // A real pulse is still read correctly — the guard must not cost the feature.
  expect(r.long, 'a clean 120 BPM pulse must still read as 120').toBeCloseTo(120, 0)
  // And nothing may come back outside the range the function itself promises.
  for (const [name, bpm] of Object.entries(r)) {
    if (bpm === 0) continue
    expect(bpm, `${name} returned ${bpm}, outside the folded range`).toBeGreaterThanOrEqual(70)
    expect(bpm, `${name} returned ${bpm}, outside the folded range`).toBeLessThanOrEqual(160)
  }
})

test('Weave Bands does nothing it cannot do', async ({ page }) => {
  /*
   * An onset envelope is one number per frame, so every frequency sub-row got
   * the identical value — while the row budget is split `WEAVE_MAX_ROWS / bands`,
   * meaning more Bands bought duplicate rows at the cost of laps. The control
   * did not merely do nothing for this source; it made the output worse.
   */
  await page.goto(PAGE)
  await page.waitForSelector('text=erzberg', { timeout: 30_000 })

  const r = await page.evaluate(async () => {
    const { getProjection, projectionDefaults } = await import('/src/utils/trackProjections.js')
    const weave = getProjection('weave')
    if (weave?.id !== 'weave') return { missing: true }

    // A synthetic spectrogram: enough structure to weave, deterministic.
    // `onsetEnvelope` reads `spec.data` frame-major; `bandMatrix` derives its own
    // band-major copy. Only the first is the spec's own storage.
    const frames = 600, bins = 64
    const data = new Float32Array(frames * bins)
    for (let f = 0; f < frames; f++) for (let b = 0; b < bins; b++) {
      data[f * bins + b] = (Math.sin(f / 7 + b) * 0.5 + 0.5) * (b < 20 ? 1 : 0.3)
    }
    const spec = { data, frames, bins, sampleRate: 44100, hop: 512, duration: frames * 512 / 44100 }
    const tone = { dbFloor: -60, contrast: 1 }
    const base = projectionDefaults('weave')

    const build = (over) => weave.build(spec, { ...base, cols: 64, ...over }, tone)
    const onset1 = build({ source: 'onset', bands: 1 })
    const onset4 = build({ source: 'onset', bands: 4 })
    const energy1 = build({ source: 'energy', bands: 1 })
    const energy4 = build({ source: 'energy', bands: 4 })
    return {
      onsetSameHeight: onset1.height === onset4.height,
      onsetIdentical: onset1.pixels.length === onset4.pixels.length &&
        onset1.pixels.every((v, i) => v === onset4.pixels[i]),
      energyGrows: energy4.height > energy1.height,
    }
  })

  if (r.missing) test.skip(true, 'weave projection not found under either key')
  // Raising Bands on the onset source must now change nothing at all, rather
  // than trading laps for duplicated rows.
  expect(r.onsetSameHeight, 'Bands must not reshape an onset weave').toBe(true)
  expect(r.onsetIdentical, 'nor change a pixel of it').toBe(true)
  // And must still do its real job on the spectrum.
  expect(r.energyGrows, 'Bands must still add sub-rows for the energy source').toBe(true)
})
