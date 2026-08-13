/**
 * Live audio features for the murmuration — the flock listening to playback.
 *
 * There is no second analysis here and no Web Audio graph. Soundscapes already
 * decodes a track once into a full spectrogram and plays it through a plain
 * `<audio>` element, so everything the flock needs is a read of that same
 * spectrogram at the playhead. Three consequences worth having:
 *
 *   - the flock and the terrain are two readings of one analysis, at one
 *     instant, so they cannot drift apart;
 *   - scrubbing works, because the features are a function of *time*, not of a
 *     running stream — drag the playhead and the flock reacts to where it lands;
 *   - it costs a few hundred array reads per frame instead of an FFT.
 *
 * The trade is that this is what the track *contains*, not what the speakers are
 * emitting — volume, muting and the browser's own output chain are invisible
 * here. For driving a flock that is the right side of the trade.
 */
import { binFrequencies } from './spectrogram'

// Band edges in Hz. Three is the useful number: a kick, a voice and a cymbal
// pull the flock in visibly different directions, while five bands mostly
// produce two sliders nobody can hear the difference between.
const BANDS = [
  [20, 160],      // bass — kick and bassline, the flock's pulse
  [160, 2000],    // mid  — voice and body, its overall drive
  [2000, 16000],  // high — hats and air, its shimmer
]

// Envelope time constants, seconds. Attack is much faster than release because
// that is how percussion reads: a kick arrives instantly and decays away. Equal
// rates give a flock that lags the beat and then twitches after it.
const ATTACK  = 0.010
const RELEASE = 0.16
// The onset envelope is faster still on both ends — it is a startle, not a mood.
const STARTLE_ATTACK  = 0.010
const STARTLE_RELEASE = 0.45
// How long a band's running peak takes to halve. This is the auto-gain: without
// it a quiet track never moves the flock and a loud one pins every slider at
// maximum, because the stored values are absolute dB and music is not.
const PEAK_HALFLIFE = 4.0
// Below this the peak follower is treated as silence rather than amplified into
// noise — a fade-out would otherwise ramp the gain up until the room tone drove
// the flock.
const SILENCE = 0.02

/**
 * Resolve the three bands to bin index ranges for a given spectrogram.
 *
 * Depends on `logFreq`, `bins` and the sample rate, so it is recomputed when the
 * analysis is, and cached against the spec object by the caller.
 */
export function makeBandPlan(spec) {
  const freqs = binFrequencies(spec)
  const ranges = BANDS.map(([lo, hi]) => {
    let i0 = spec.bins, i1 = 0
    for (let b = 0; b < spec.bins; b++) {
      if (freqs[b] >= lo && freqs[b] <= hi) { if (b < i0) i0 = b; if (b + 1 > i1) i1 = b + 1 }
    }
    // A band can fall outside the analysis entirely — 16 kHz does not exist in a
    // 22 kHz-sampled file binned to 64 rows. Collapse it to one bin rather than
    // an empty range that would read as permanent silence.
    if (i1 <= i0) { i0 = Math.min(spec.bins - 1, Math.max(0, i0)); i1 = i0 + 1 }
    return [i0, i1]
  })
  return { ranges, bins: spec.bins }
}

/** Per-track listening state: envelopes, running peaks, and the last frame read. */
export function createAudioState() {
  return {
    prevFrame: -1,
    prevRow: null,        // the bins of the last *different* frame, for flux
    prevFluxEnv: 0,
    onset: 0,             // rising edge of the flux envelope — fires once per attack
    env:  [0, 0, 0],      // bass, mid, high
    peak: [0, 0, 0],
    fluxEnv: 0,
    fluxPeak: 0,
    level: 0,
    startle: 0,
  }
}

/** Neutral features — what a silent or stopped track hands the flock. */
export const SILENT = { level: 0, bass: 0, mid: 0, high: 0, startle: 0 }

/**
 * Read the spectrogram at `time` and advance the envelopes by `dt` seconds.
 *
 * Mutates and returns `state`, which carries the envelopes; the caller keeps one
 * per flock. `playing` false decays everything toward silence instead of
 * holding the last value, so pausing the track returns the flock to its own
 * behaviour rather than freezing it mid-gesture.
 */
export function sampleAudio(spec, plan, state, time, dt, playing = true) {
  const st = state
  const step = Math.max(1e-4, Math.min(0.25, dt))
  const atk = 1 - Math.exp(-step / ATTACK)
  const rel = 1 - Math.exp(-step / RELEASE)
  const decay = Math.pow(0.5, step / PEAK_HALFLIFE)

  if (!spec || !plan || !playing) {
    // Release toward zero on the slow constant — an abrupt cut reads as the
    // flock being yanked, which is exactly what pausing should not look like.
    for (let i = 0; i < 3; i++) st.env[i] += (0 - st.env[i]) * rel
    st.fluxEnv += (0 - st.fluxEnv) * rel
    st.startle += (0 - st.startle) * (1 - Math.exp(-step / STARTLE_RELEASE))
    st.onset = 0
    st.level = (st.env[0] + st.env[1] + st.env[2]) / 3
    return st
  }

  const { data, bins, frames, hop, sampleRate } = spec
  const frame = Math.max(0, Math.min(frames - 1, Math.round((time * sampleRate) / hop)))
  const row = frame * bins

  // ── Bands ──────────────────────────────────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    const [i0, i1] = plan.ranges[i]
    let sum = 0
    for (let b = i0; b < i1; b++) sum += data[row + b]
    const raw = sum / (i1 - i0)

    // Auto-gain: a running peak that leaks away, so the band reads 1 at its own
    // recent loudest rather than at some absolute dB nobody's track reaches.
    st.peak[i] = Math.max(raw, st.peak[i] * decay)
    const norm = st.peak[i] > SILENCE ? Math.min(1, raw / st.peak[i]) : 0
    st.env[i] += (norm - st.env[i]) * (norm > st.env[i] ? atk : rel)
  }
  st.level = (st.env[0] + st.env[1] + st.env[2]) / 3

  // ── Onsets ─────────────────────────────────────────────────────────────────
  // Spectral flux: the summed *rise* between consecutive analysis frames. Falls
  // are ignored, which is what makes this find attacks rather than amplitude.
  //
  // Compared against the last frame actually read, not the last render — the
  // analysis runs at ~86 frames a second and the renderer at 60, so on some
  // frames the playhead has not moved to a new column and there is no new rise
  // to measure. Re-measuring against the same row would report zero flux on
  // those frames and chop every onset into a flicker.
  if (frame !== st.prevFrame) {
    if (!st.prevRow || st.prevRow.length !== bins) st.prevRow = new Float32Array(bins)
    else {
      let flux = 0
      for (let b = 0; b < bins; b++) {
        const d = data[row + b] - st.prevRow[b]
        if (d > 0) flux += d
      }
      flux /= bins
      st.fluxPeak = Math.max(flux, st.fluxPeak * decay)
      const norm = st.fluxPeak > SILENCE * 0.25 ? Math.min(1, flux / st.fluxPeak) : 0
      // The *rise* of the flux envelope, not its level: this fires once as an
      // attack lands rather than staying high for as long as the transient
      // decays, which is what makes it usable as a trigger.
      st.onset = Math.max(0, norm - st.prevFluxEnv)
      st.prevFluxEnv = norm
      st.fluxEnv = norm
    }
    st.prevRow.set(data.subarray(row, row + bins))
    st.prevFrame = frame
  } else {
    // No new analysis column this render — there is no new attack to report.
    st.onset = 0
  }
  st.startle += (st.fluxEnv - st.startle) *
    (1 - Math.exp(-step / (st.fluxEnv > st.startle ? STARTLE_ATTACK : STARTLE_RELEASE)))

  return st
}

/** Pull the five windows out of the params object, so the flock and the meter
 *  cannot disagree about where they are. */
export function audioRanges(p) {
  return {
    pace:    [p.flockAudioPaceLo ?? 0,    p.flockAudioPaceHi ?? 1],
    pulse:   [p.flockAudioPulseLo ?? 0,   p.flockAudioPulseHi ?? 1],
    shimmer: [p.flockAudioShimmerLo ?? 0, p.flockAudioShimmerHi ?? 1],
    size:    [p.flockAudioSizeLo ?? 0,    p.flockAudioSizeHi ?? 1],
    burst:   [p.flockAudioBurstLo ?? 0.15, p.flockAudioBurstHi ?? 0.9],
  }
}

/**
 * Map the slice `[lo, hi]` of a signal onto the full 0…1, clamped outside it.
 *
 * This is the control that makes a dense track usable. The band envelopes are
 * already auto-gained against the track's own recent peak, so on something that
 * is loud from end to end — drum and bass, most of a mix's chorus — they sit
 * near the top and barely move, and an "amount" slider can only scale a signal
 * that is not varying. Windowing to, say, 0.65–0.95 throws away the constant
 * floor and stretches what is left across the whole range, which turns a wall of
 * energy back into visible hits.
 */
export function window01(v, lo = 0, hi = 1) {
  const a = Math.min(lo, hi - 1e-4)
  const t = (v - a) / Math.max(1e-4, hi - a)
  return t <= 0 ? 0 : t >= 1 ? 1 : t
}

/**
 * Resolve raw features into one windowed value per channel.
 *
 * Each channel gets its own window because each is looking for something
 * different in the same track: Burst wants only the sharpest attacks, while Pace
 * wants the broad shape of the whole thing. Pulse and Size both read bass but
 * are usually wanted at different thresholds — a swell you can see against a
 * kick you can feel.
 */
export function shapeFeatures(f, r = {}) {
  const w = (v, k) => window01(v, r[k]?.[0] ?? 0, r[k]?.[1] ?? 1)
  return {
    pace:    w(f.level ?? 0, 'pace'),
    pulse:   w(f.bass ?? 0, 'pulse'),
    shimmer: w(f.high ?? 0, 'shimmer'),
    size:    w(f.bass ?? 0, 'size'),
    burst:   w(f.onset ?? 0, 'burst'),
    startle: w(f.startle ?? 0, 'burst'),
  }
}

/**
 * Modulate the flock's parameters with what the track is doing.
 *
 * Deliberately a *parameter* transform rather than new forces in the simulation:
 * `stepFlock` already resolves its scales from params on every call, so the
 * whole feature lives outside the physics and murmuration.js does not know
 * audio exists. It also means every audio mapping is something a user could
 * have dialled by hand, which is what keeps the result legible rather than
 * magic.
 *
 * `amt` is 0…1-ish per target; 0 leaves that aspect alone.
 */
export function applyAudio(params, ch, amt) {
  const level = ch.pace ?? 0
  const bass = ch.pulse ?? 0
  const high = ch.shimmer ?? 0
  const startle = ch.startle ?? 0
  const out = { ...params }

  // Loudness → pace. Centred at 0.45 so a track of average energy flies at
  // roughly its dialled speed, and quiet passages genuinely slow down instead
  // of the flock only ever speeding up.
  if (amt.speed) out.speed = Math.max(0.05, params.speed * (1 + amt.speed * 1.4 * (level - 0.45)))

  // Bass → the flock breathes. Separation opens on the kick while cohesion
  // eases off, which reads as an expansion rather than as a jitter; pulling
  // both in the same direction just makes it vibrate.
  if (amt.pulse) {
    out.separation = params.separation * (1 + amt.pulse * 2.0 * bass)
    out.cohesion   = params.cohesion   * Math.max(0.15, 1 - amt.pulse * 0.7 * bass)
  }

  // Highs → shimmer, on top of whatever turbulence is dialled in.
  if (amt.shimmer) out.turbulence = (params.turbulence ?? 0) + amt.shimmer * 1.6 * high

  // Onsets also widen the hawk's fear radius, so an accented beat tears the same
  // hole a strike does — but only when there is a hawk. This used to be the
  // *whole* of the onset mapping, which made the most percussive control in the
  // panel do nothing at all in the default configuration, where the predator is
  // off. The burst in `applyBurst` is the part that always fires.
  if (amt.startle && params.predator) {
    out.predatorFear = (params.predatorFear ?? 1) * (1 + amt.startle * 2.5 * startle)
  }
  return out
}

/**
 * The parts of the reaction that must not go through the integrator.
 *
 * Sprite size and streak length are shader uniforms: they change on the frame
 * they are set, with none of the several-hundred-millisecond lag that steering
 * forces carry. That is what makes the flock look like it is *on* the beat
 * rather than swelling vaguely after it, and it is why the punchiest mappings
 * live here rather than in `applyAudio`.
 */
export function audioVisuals(ch, amt) {
  const bass = ch.size ?? 0
  const level = ch.pace ?? 0
  return {
    size:  1 + (amt.size ?? 0) * 1.2 * bass,
    trail: 1 + (amt.size ?? 0) * 1.0 * level,
  }
}
