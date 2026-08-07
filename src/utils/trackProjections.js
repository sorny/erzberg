/**
 * Whole-track projections — alternative ways to fold an entire analysed track
 * into one static heightmap.
 *
 * "Freeze Whole Track" started out as a single view: the spectrogram stretched
 * end to end. That is the literal projection, and it is a poor portrait of a
 * *song* — a four-minute STFT squeezed into 1024 columns mostly reads as noise
 * with a loud middle. The projections here take the same analysis and ask
 * different questions of it: what does the track look like wound into a disc,
 * where does it repeat itself, what is its groove, what do its measurable
 * qualities look like stacked as strata.
 *
 * Every projection is a pure function of the spectrogram, so nothing here
 * decodes audio, re-runs an FFT, or touches the DOM. Each returns the same
 * contract the heightmap store expects — a row-major Float32Array of 0…1
 * values plus its dimensions — which is why all of them inherit every draw
 * mode, hillshade, erosion pass and export for free.
 *
 * Cost note: these run synchronously on the main thread. Freezing is a one-shot
 * user action that already pauses playback, and the heaviest projection
 * (similarity at its largest size) is tens of milliseconds, so a worker would
 * buy latency nobody is waiting on.
 */
import { binFrequencies, resampleTime, toneInv, toneMap } from './spectrogram'

// Column cap for the plain spectrogram projection — keeps the static heightmap
// in the same size class as a normal raster instead of tens of thousands of
// columns wide.
const LINEAR_MAX_COLS = 1024

// Row ceiling for the weave. Past this the laps are folded together instead.
const WEAVE_MAX_ROWS = 512

// ── Shared reductions ───────────────────────────────────────────────────────

/**
 * A time × band grid, `d[row * cols + col]`, row 0 = lowest band.
 *
 * Peak-held across time and averaged across frequency: peaks keep transients
 * from being smeared away by long buckets, while averaging within a band is
 * what makes the band a *level* rather than whichever partial happened to be
 * loudest in it.
 *
 * Because the spectrogram's own bins are already log-spaced (when the analysis
 * is in log mode), uniform grouping of bin indices here preserves that spacing.
 *
 * `range` narrows the slice of the spectrum the rows span, as fractions of the
 * bin count — the weave uses it to look at the kick or the hats alone.
 */
export function bandMatrix(spec, cols, rows, dbFloor = 0, contrast = 1, range = null) {
  const { data, frames, bins } = spec
  const out = new Float32Array(rows * cols)
  const inv = toneInv(dbFloor)

  const from = Math.min(bins - 1, Math.round((range ? Math.min(range[0], range[1]) : 0) * bins))
  const to = Math.max(from + 1, Math.min(bins, Math.round((range ? Math.max(range[0], range[1]) : 1) * bins)))
  const span = to - from

  for (let c = 0; c < cols; c++) {
    const f0 = Math.min(frames - 1, Math.floor((c / cols) * frames))
    const f1 = Math.min(frames, Math.max(f0 + 1, Math.floor(((c + 1) / cols) * frames)))
    for (let r = 0; r < rows; r++) {
      const b0 = Math.min(to - 1, from + Math.floor((r / rows) * span))
      const b1 = Math.min(to, Math.max(b0 + 1, from + Math.floor(((r + 1) / rows) * span)))
      const width = b1 - b0
      let peak = 0
      for (let f = f0; f < f1; f++) {
        const off = f * bins
        let sum = 0
        for (let b = b0; b < b1; b++) sum += data[off + b]
        const m = sum / width
        if (m > peak) peak = m
      }
      out[r * cols + c] = toneMap(peak, dbFloor, inv, contrast)
    }
  }
  return { d: out, cols, rows }
}

/**
 * Half-wave-rectified spectral flux, one value per analysis frame.
 *
 * Only *rising* energy counts: a note starting is an event, the same note
 * decaying is not, and summing the signed difference would cancel the two into
 * near-silence.
 */
export function onsetEnvelope(spec) {
  const { data, frames, bins } = spec
  const flux = new Float32Array(frames)
  for (let f = 1; f < frames; f++) {
    const off = f * bins
    const prev = off - bins
    let sum = 0
    for (let b = 0; b < bins; b++) {
      const d = data[off + b] - data[prev + b]
      if (d > 0) sum += d
    }
    flux[f] = sum / bins
  }
  if (frames > 1) flux[0] = flux[1]
  return flux
}

/**
 * Dominant beat period, in frames, from the onset envelope.
 *
 * Autocorrelation over the lag range that corresponds to 60–200 BPM, on a
 * mean-removed envelope so the DC level of a loud track cannot outvote its
 * rhythm. The result is then folded into a musically plausible octave: raw
 * autocorrelation is just as happy to lock onto half or double the tempo, and
 * a listener naming the tempo of a 240 BPM reading would say 120.
 */
export function detectBpm(flux, frameRate) {
  const minLag = Math.max(2, Math.floor((60 / 200) * frameRate))
  const maxLag = Math.min(flux.length - 1, Math.ceil((60 / 60) * frameRate))
  if (maxLag <= minLag) return 0

  let mean = 0
  for (let i = 0; i < flux.length; i++) mean += flux[i]
  mean /= Math.max(1, flux.length)

  let bestLag = 0
  let best = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0
    for (let i = lag; i < flux.length; i++) acc += (flux[i] - mean) * (flux[i - lag] - mean)
    // Longer lags correlate over fewer samples; dividing by the overlap keeps
    // the comparison between lags fair instead of biased toward short periods.
    acc /= flux.length - lag
    if (acc > best) { best = acc; bestLag = lag }
  }
  if (!bestLag) return 0

  let bpm = (60 * frameRate) / bestLag
  while (bpm < 70) bpm *= 2
  while (bpm > 160) bpm /= 2
  return bpm
}

/** Rescales in place so the data spans the full 0…1 the heightmap expects. */
function normalize(a) {
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < a.length; i++) {
    const v = a[i]
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const range = hi - lo
  if (!(range > 1e-9)) { a.fill(0); return a }
  const inv = 1 / range
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * inv
  return a
}

/** Moving average of half-width `r` along a 1-D curve. */
function smoothCurve(a, r) {
  if (r < 1) return a
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) {
    let sum = 0, n = 0
    for (let k = -r; k <= r; k++) {
      const j = i + k
      if (j < 0 || j >= a.length) continue
      sum += a[j]; n++
    }
    out[i] = sum / n
  }
  return out
}

/** Bilinear sample of a bandMatrix at fractional (col, row). */
function sampleMat(m, col, row) {
  const { d, cols, rows } = m
  const x = Math.max(0, Math.min(cols - 1, col))
  const y = Math.max(0, Math.min(rows - 1, row))
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const a = d[y0 * cols + x0], b = d[y0 * cols + x1]
  const c = d[y1 * cols + x0], e = d[y1 * cols + x1]
  return (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy
}

// ── Projections ─────────────────────────────────────────────────────────────

/** Time × frequency, the whole track end to end. The original freeze view. */
function buildLinear(spec, _params, tone) {
  const { pixels, width, height } = resampleTime(spec, LINEAR_MAX_COLS, tone.dbFloor, tone.contrast)
  return { pixels, width, height }
}

/**
 * The track wound into a disc, or into a spiral groove.
 *
 * With one turn this is a record: time runs once around the circle, frequency
 * runs from the label out to the rim. With more turns it becomes an Archimedean
 * groove, and the reason to want that is alignment — set the turn count to the
 * number of bars or phrases in the track and every repeat lands at the same
 * angle, so a verse/chorus structure resolves into visible sectors.
 *
 * The spiral is parameterised the honest way, by nearest groove rather than by
 * "which ring am I in": for the groove centred at radius `t` and angle
 * `2π·t·turns`, a pixel's turn index is the nearest integer to
 * `u·turns − angle`. Deriving the turn from the radius alone would tear the
 * image along the seam where the angle wraps, which is exactly where the groove
 * is supposed to run continuously into its next lap.
 */
function buildPolar(spec, params, tone) {
  const size = params.size | 0
  const turns = Math.max(1, params.turns | 0)
  const inner = Math.min(0.8, Math.max(0, params.inner))
  const band = Math.min(1, Math.max(0.05, params.bandFreq))
  const rotate = params.rotate ?? 0
  const inward = !!params.freqInward

  // Angular sampling has to out-resolve the rim, which is the longest path
  // through the data; the radial axis is handled by bilinear interpolation.
  const timeCols = Math.max(512, Math.min(4096, size * 2))
  const m = bandMatrix(spec, timeCols, Math.min(spec.bins, 512), tone.dbFloor, tone.contrast)

  const out = new Float32Array(size * size)
  const invSpan = 1 / Math.max(1e-6, 1 - inner)
  const halfBand = band * 0.5

  for (let y = 0; y < size; y++) {
    const dy = ((y + 0.5) / size) * 2 - 1
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1
      const r = Math.sqrt(dx * dx + dy * dy)
      if (r > 1) continue
      const u = (r - inner) * invSpan
      if (u < 0) continue

      // 0…1 clockwise from twelve o'clock, so the track starts at the top.
      let ang = Math.atan2(dx, -dy) / (2 * Math.PI)
      ang -= Math.floor(ang)
      ang += rotate
      ang -= Math.floor(ang)

      let t, fq
      if (turns === 1) {
        t = ang
        fq = u
      } else {
        const s = u * turns - ang
        const k = Math.round(s)
        if (k < 0 || k >= turns) continue
        const off = s - k               // −0.5…0.5 across the groove
        if (Math.abs(off) > halfBand) continue   // the gap between laps
        t = (k + ang) / turns
        fq = off / band + 0.5
      }

      if (fq < 0 || fq > 1) continue
      out[y * size + x] = sampleMat(m, t * (m.cols - 1), (inward ? 1 - fq : fq) * (m.rows - 1))
    }
  }
  return { pixels: out, width: size, height: size }
}

/**
 * Self-similarity of the track against itself — the structural portrait.
 *
 * Every pair of moments is compared, so a repeated chorus shows up as a stripe
 * parallel to the main diagonal and a section that holds still shows up as a
 * block. This is the projection that makes song *form* visible rather than
 * sound.
 *
 * Two things matter for it reading as terrain rather than as static:
 *  - Path enhancement. A single frame-to-frame comparison is noisy; averaging
 *    along the diagonal direction is what turns a dotted repeat into a
 *    continuous ridge, because a genuine repeat is precisely the case where
 *    consecutive moments match consecutive moments.
 *  - Renormalisation. Cosine similarity between non-negative spectra clusters
 *    in the top of its range, so the raw matrix is a plateau with faint marks
 *    on it. Rescaling to the observed min/max is what gives it relief.
 */
function buildSSM(spec, params, tone) {
  const n = params.size | 0
  const chroma = params.feature === 'chroma'
  const dim = chroma ? 12 : 24
  const enhance = Math.max(0, params.enhance | 0)
  const sparsity = Math.min(0.95, Math.max(0, params.sparsity ?? 0))
  const lag = params.layout === 'lag'

  // Feature vectors, column-major: f[t * dim + k].
  const f = chroma
    ? chromaMatrix(spec, n, tone.dbFloor, tone.contrast)
    : transpose(bandMatrix(spec, n, dim, tone.dbFloor, tone.contrast))

  // L2-normalise each moment so similarity is a plain dot product and a loud
  // passage cannot look "more similar to everything" than a quiet one.
  for (let t = 0; t < n; t++) {
    const off = t * dim
    let mag = 0
    for (let k = 0; k < dim; k++) mag += f[off + k] * f[off + k]
    mag = Math.sqrt(mag)
    if (mag < 1e-9) continue
    for (let k = 0; k < dim; k++) f[off + k] /= mag
  }

  let s = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    const a = i * dim
    for (let j = i; j < n; j++) {
      const b = j * dim
      let dot = 0
      for (let k = 0; k < dim; k++) dot += f[a + k] * f[b + k]
      s[i * n + j] = dot
      s[j * n + i] = dot
    }
  }

  if (enhance > 0) s = enhanceDiagonals(s, n, enhance)
  normalize(s)
  if (sparsity > 0) applySparsity(s, sparsity)

  if (!lag) return { pixels: s, width: n, height: n }

  // Time-lag view: row = how far apart the two moments are, so the diagonal
  // stripes of the matrix straighten into horizontal ledges. The matrix is
  // symmetric, so forward lag alone loses nothing; the empty upper corner is
  // the honest consequence of long lags having fewer moments to compare.
  const out = new Float32Array(n * n)
  for (let l = 0; l < n; l++) {
    for (let i = 0; i + l < n; i++) out[l * n + i] = s[i * n + (i + l)]
  }
  return { pixels: out, width: n, height: n }
}

/** bandMatrix (row-major by band) → feature vectors (row-major by time). */
function transpose(m) {
  const { d, cols, rows } = m
  const out = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out[c * rows + r] = d[r * cols + c]
  }
  return out
}

/**
 * Twelve pitch-class energies per time step, `out[t * 12 + pc]`.
 *
 * Folding octaves together is what makes this a *harmonic* description: the
 * same chord voiced high or low lands in the same place, so a similarity matrix
 * built on it tracks the song's harmony rather than its production. Content
 * above ~5 kHz is dropped — cymbals and air have no pitch class worth folding.
 */
function chromaMatrix(spec, cols, dbFloor, contrast) {
  const { data, frames, bins } = spec
  const freqs = binFrequencies(spec)
  const inv = toneInv(dbFloor)

  const pc = new Int8Array(bins)
  for (let b = 0; b < bins; b++) {
    const hz = freqs[b]
    if (hz < 30 || hz > 5000) { pc[b] = -1; continue }
    const midi = Math.round(69 + 12 * Math.log2(hz / 440))
    pc[b] = ((midi % 12) + 12) % 12
  }

  const out = new Float32Array(cols * 12)
  for (let c = 0; c < cols; c++) {
    const f0 = Math.min(frames - 1, Math.floor((c / cols) * frames))
    const f1 = Math.min(frames, Math.max(f0 + 1, Math.floor(((c + 1) / cols) * frames)))
    const off = c * 12
    for (let f = f0; f < f1; f++) {
      const row = f * bins
      for (let b = 0; b < bins; b++) {
        const p = pc[b]
        if (p < 0) continue
        const v = toneMap(data[row + b], dbFloor, inv, contrast)
        if (v > out[off + p]) out[off + p] = v
      }
    }
  }
  return out
}

/**
 * Moving average along the diagonal direction — see buildSSM.
 *
 * Every cell's window lies entirely on its own diagonal, so the matrix is really
 * 2n−1 independent 1-D moving averages. Walking each diagonal once with a
 * rolling sum makes this O(n²) instead of O(n²·r): at size 768 with enhance 32
 * that is 590k accumulator updates rather than 38.4M reads. Output is identical,
 * including the shrinking window at the ends, because the divisor is the true
 * count of in-range taps either way.
 */
function enhanceDiagonals(s, n, r) {
  const out = new Float32Array(n * n)
  // Each diagonal starts at (i0, j0) with one of the two on the top/left edge.
  for (let d = -(n - 1); d <= n - 1; d++) {
    const i0 = d < 0 ? -d : 0
    const j0 = d < 0 ? 0 : d
    const len = n - Math.max(i0, j0)

    let sum = 0
    // Prime with the leading half-window of the first cell.
    const first = Math.min(r, len - 1)
    for (let t = 0; t <= first; t++) sum += s[(i0 + t) * n + (j0 + t)]

    for (let t = 0; t < len; t++) {
      const lo = t - r, hi = t + r
      const from = lo < 0 ? 0 : lo
      const to = hi >= len ? len - 1 : hi
      out[(i0 + t) * n + (j0 + t)] = sum / (to - from + 1)

      // Slide: drop the tap leaving the window, add the one entering it.
      const drop = t - r
      if (drop >= 0) sum -= s[(i0 + drop) * n + (j0 + drop)]
      const add = t + r + 1
      if (add < len) sum += s[(i0 + add) * n + (j0 + add)]
    }
  }
  return out
}

/**
 * Drops the weakest `frac` of the matrix to zero and rescales what is left.
 *
 * The cut point comes from a 256-bucket histogram rather than a sort: the input
 * is up to ~590k cells and the quantile only has to be accurate to a bucket.
 */
function applySparsity(s, frac) {
  const BUCKETS = 256
  const hist = new Uint32Array(BUCKETS)
  for (let i = 0; i < s.length; i++) hist[Math.min(BUCKETS - 1, (s[i] * BUCKETS) | 0)]++

  const target = s.length * frac
  let acc = 0, cut = 0
  for (let b = 0; b < BUCKETS; b++) {
    acc += hist[b]
    if (acc >= target) { cut = b / BUCKETS; break }
  }

  const inv = toneInv(cut)
  for (let i = 0; i < s.length; i++) s[i] = toneMap(s[i], cut, inv, 1)
}

/**
 * The track folded onto its own bar grid — the groove made visible.
 *
 * Time no longer runs left to right across the whole piece: it runs across one
 * bar and then wraps to the next row. Anything the drummer repeats therefore
 * stacks into a vertical ridge, and the places where the pattern breaks — a
 * fill, a dropped beat, a section change — appear as interruptions in an
 * otherwise woven surface.
 */
function buildWeave(spec, params, tone) {
  const cols = params.cols | 0
  const bands = Math.max(1, params.bands | 0)
  const beatsPerBar = Math.max(1, params.beatsPerBar | 0)
  const phase = params.phase ?? 0
  const frameRate = spec.sampleRate / spec.hop

  const flux = onsetEnvelope(spec)
  // Detection only comes back empty for a clip too short to hold one beat period.
  // Folding at a plain 120 then beats a degenerate one-row heightmap, and the BPM
  // control is right there if the guess is wrong.
  const bpm = params.bpm > 0 ? params.bpm : (detectBpm(flux, frameRate) || 120)

  const beatSec = 60 / bpm
  const unitSec = beatSec * (params.unit === 'beat' ? 1 : params.unit === 'phrase' ? beatsPerBar * 4 : beatsPerBar)

  const units = Math.max(1, Math.floor(spec.duration / unitSec))
  const maxUnits = Math.max(1, Math.floor(WEAVE_MAX_ROWS / bands))
  const outUnits = Math.min(units, maxUnits)
  // More units than rows: fold several laps into one row by peak, so a long
  // track loses resolution rather than being truncated halfway through.
  const group = Math.ceil(units / outUnits)

  const onset = params.source === 'onset'
  const perFrame = onset
    ? null
    : bandMatrix(spec, spec.frames, bands, tone.dbFloor, tone.contrast, [params.bandLo, params.bandHi])
  if (onset) normalize(flux)

  const rows = outUnits * bands
  const out = new Float32Array(rows * cols)

  for (let u = 0; u < outUnits; u++) {
    for (let g = 0; g < group; g++) {
      const srcUnit = u * group + g
      if (srcUnit >= units) break
      for (let x = 0; x < cols; x++) {
        const t = (srcUnit + phase + (x + 0.5) / cols) * unitSec
        const frame = Math.round(t * frameRate)
        if (frame < 0 || frame >= spec.frames) continue
        for (let b = 0; b < bands; b++) {
          const src = onset ? flux[frame] : perFrame.d[b * spec.frames + frame]
          // Row 0 is the top of the image, and within a lap the low band should
          // sit at the bottom, matching how every other view here is read.
          const o = (u * bands + (bands - 1 - b)) * cols + x
          if (src > out[o]) out[o] = src
        }
      }
    }
  }
  return { pixels: normalize(out), width: cols, height: rows }
}

/**
 * Measurable qualities of the track, stacked as horizontal strata.
 *
 * Each enabled feature gets its own band, drawn either as a filled silhouette
 * or as a flat terrace at the feature's value. Stacked, they are the closest
 * thing here to a plotter's superimposed layers: loudness, brightness, onset
 * density and harmony described separately over the same timeline instead of
 * mixed into one image.
 */
function buildStrata(spec, params, tone) {
  const cols = params.cols | 0
  const bandH = Math.max(4, params.bandH | 0)
  const gap = Math.max(0, params.gap | 0)
  const profile = params.render !== 'ridge'

  const smooth = Math.max(0, params.smooth | 0)

  const enabled = STRATA_FEATURES.filter((ft) => params[ft.key] !== false)
  if (!enabled.length) return { pixels: new Float32Array(cols), width: cols, height: 1 }

  // The enabled set is resolved *before* the curves are computed, so the two
  // genuinely expensive optional features can be skipped: noisiness needs a
  // Math.log per bin per frame (~10M calls on a real track) and harmony needs a
  // second full pass over the spectrogram. Both are off by default.
  const curves = featureCurves(spec, cols, tone.dbFloor, new Set(enabled.map((ft) => ft.id)))

  const rows = enabled.length * bandH + Math.max(0, enabled.length - 1) * gap
  const out = new Float32Array(rows * cols)

  let top = 0
  for (const ft of enabled) {
    if (ft.id === 'chroma') {
      // Harmony has twelve simultaneous values, not one — it gets a strip of
      // pitch classes rather than a silhouette.
      const ch = curves.chroma
      for (let r = 0; r < bandH; r++) {
        const p = Math.min(11, Math.floor(((bandH - 1 - r) / bandH) * 12))
        const dst = (top + r) * cols
        for (let x = 0; x < cols; x++) out[dst + x] = Math.pow(ch[x * 12 + p], tone.contrast)
      }
    } else {
      const c = smoothCurve(curves[ft.id], smooth)
      const shaped = new Float32Array(cols)
      for (let x = 0; x < cols; x++) shaped[x] = Math.pow(c[x], tone.contrast)
      for (let r = 0; r < bandH; r++) {
        // Height within the band, measured from its bottom edge.
        const level = (bandH - 1 - r + 0.5) / bandH
        const dst = (top + r) * cols
        for (let x = 0; x < cols; x++) {
          // A hard v >= level test aliases badly once a band is only tens of
          // rows tall; ramping across a single row keeps the silhouette edge
          // readable as a slope instead of a staircase.
          out[dst + x] = profile
            ? Math.max(0, Math.min(1, (shaped[x] - level) * bandH + 0.5))
            : shaped[x]
        }
      }
    }
    top += bandH + gap
  }
  return { pixels: out, width: cols, height: rows }
}

/** The strata catalogue — id doubles as the key into `featureCurves`. */
export const STRATA_FEATURES = [
  { id: 'rms',       key: 'fRms',       label: 'Loudness' },
  { id: 'centroid',  key: 'fCentroid',  label: 'Brightness' },
  { id: 'flux',      key: 'fFlux',      label: 'Onsets' },
  { id: 'bandwidth', key: 'fBandwidth', label: 'Spread' },
  { id: 'rolloff',   key: 'fRolloff',   label: 'Rolloff' },
  { id: 'flatness',  key: 'fFlatness',  label: 'Noisiness' },
  { id: 'low',       key: 'fLow',       label: 'Low' },
  { id: 'mid',       key: 'fMid',       label: 'Mid' },
  { id: 'high',      key: 'fHigh',      label: 'High' },
  { id: 'chroma',    key: 'fChroma',    label: 'Harmony' },
]

/**
 * All strata curves in one pass over the spectrogram, each normalised to its
 * own range over the track.
 *
 * Normalising per feature is the point: spectral flatness lives in a very
 * different numeric range from loudness, and a shared scale would flatten most
 * of the strata into straight lines. What matters visually is how each quality
 * moves across *this* track, not its absolute value.
 *
 * Frequency-derived features are measured on a log axis, because the perceptual
 * distance between 200 Hz and 400 Hz is the same as between 2 kHz and 4 kHz and
 * a linear centroid would spend its whole range in the top octave.
 *
 * `want` narrows the work to a set of feature ids. Most of them ride along free
 * on the single pass this already makes, but two do not — noisiness costs a
 * Math.log per bin per frame, and harmony is an entire second pass — so those
 * are computed only when asked for. Omit the argument for all of them.
 */
export function featureCurves(spec, cols, dbFloor = 0, want = null) {
  const wants = (id) => !want || want.has(id)
  const wantFlatness = wants('flatness')
  const wantChroma = wants('chroma')
  const { data, frames, bins } = spec
  const freqs = binFrequencies(spec)
  const inv = toneInv(dbFloor)
  const nyquist = spec.sampleRate / 2

  const logMin = Math.log2(30)
  const logSpan = Math.max(1e-6, Math.log2(Math.max(60, nyquist)) - logMin)
  const logF = new Float32Array(bins)
  for (let b = 0; b < bins; b++) {
    logF[b] = Math.min(1, Math.max(0, (Math.log2(Math.max(30, freqs[b])) - logMin) / logSpan))
  }

  // Which of the three named bands each bin belongs to, resolved once rather
  // than re-tested per frame.
  const group = new Uint8Array(bins)
  let nLow = 0, nMid = 0, nHigh = 0
  for (let b = 0; b < bins; b++) {
    const hz = freqs[b]
    if (hz < 250) { group[b] = 0; nLow++ }
    else if (hz < 2000) { group[b] = 1; nMid++ }
    else { group[b] = 2; nHigh++ }
  }

  const out = {}
  for (const ft of STRATA_FEATURES) {
    if (ft.id !== 'chroma') out[ft.id] = new Float32Array(cols)
  }
  const counts = new Float32Array(cols)
  const flux = onsetEnvelope(spec)
  const gated = new Float32Array(bins)   // one frame's gated magnitudes

  for (let f = 0; f < frames; f++) {
    const c = Math.min(cols - 1, Math.floor((f / frames) * cols))
    const row = f * bins
    let sum = 0, wSum = 0, low = 0, mid = 0, high = 0, logSum = 0

    for (let b = 0; b < bins; b++) {
      const v = toneMap(data[row + b], dbFloor, inv, 1)
      gated[b] = v
      sum += v
      wSum += v * logF[b]
      if (wantFlatness) logSum += Math.log(v + 1e-6)
      const g = group[b]
      if (g === 0) low += v
      else if (g === 1) mid += v
      else high += v
    }

    const centroid = sum > 1e-9 ? wSum / sum : 0
    const target = sum * 0.85
    let spread = 0, cum = 0, rolloff = 0
    for (let b = 0; b < bins; b++) {
      const d = logF[b] - centroid
      spread += gated[b] * d * d
      if (cum < target) { cum += gated[b]; rolloff = logF[b] }
    }
    spread = sum > 1e-9 ? Math.sqrt(spread / sum) : 0

    const mean = sum / bins

    out.rms[c] += mean
    out.centroid[c] += centroid
    out.flux[c] += flux[f]
    out.bandwidth[c] += spread
    out.rolloff[c] += rolloff
    if (wantFlatness) {
      // Spectral flatness: geometric over arithmetic mean. A flat (noisy)
      // spectrum pushes it toward 1, a few loud partials over near-silence
      // toward 0.
      const geo = Math.exp(logSum / bins)
      out.flatness[c] += mean > 1e-9 ? Math.min(1, geo / mean) : 0
    }
    out.low[c] += nLow ? low / nLow : 0
    out.mid[c] += nMid ? mid / nMid : 0
    out.high[c] += nHigh ? high / nHigh : 0
    counts[c]++
  }

  for (const ft of STRATA_FEATURES) {
    if (ft.id === 'chroma') continue
    const a = out[ft.id]
    for (let c = 0; c < cols; c++) if (counts[c] > 0) a[c] /= counts[c]
    normalize(a)
  }
  // A whole second pass over the spectrogram, so it is only made on request.
  out.chroma = wantChroma ? normalize(chromaMatrix(spec, cols, dbFloor, 1)) : null
  return out
}

// ── Registry ────────────────────────────────────────────────────────────────
//
// `params` is a declarative schema rather than hand-written controls: five
// projections carrying four to ten settings each would otherwise be several
// hundred lines of near-identical JSX in the sidebar. Descriptor types map onto
// the control atoms that already exist there — a bare descriptor is a slider,
// `seg` is a segmented button row, `tog` is a switch.

export const TRACK_PROJECTIONS = [
  {
    id: 'linear',
    label: 'Spectrogram',
    blurb: 'The whole track end to end — time across, frequency up.',
    build: buildLinear,
    params: [],
  },
  {
    id: 'polar',
    label: 'Disc',
    blurb: 'The track wound into a record. Set Turns to the bar or phrase count and repeats line up radially.',
    build: buildPolar,
    params: [
      { key: 'size', label: 'Size', min: 256, max: 1024, step: 64, value: 768, fmt: (v) => `${v}px`,
        help: 'Width and height of the square output.' },
      { key: 'turns', label: 'Turns', min: 1, max: 64, step: 1, value: 1,
        help: 'Laps the track makes. 1 is a single ring; higher winds it into a spiral groove, and matching the track’s bar or phrase count makes repeats line up at the same angle.' },
      { key: 'inner', label: 'Label', min: 0, max: 0.6, step: 0.01, value: 0.15, fmt: (v) => `${Math.round(v * 100)}%`,
        help: 'Radius of the empty hole at the centre.' },
      { key: 'bandFreq', label: 'Groove', min: 0.1, max: 1, step: 0.05, value: 0.85, fmt: (v) => `${Math.round(v * 100)}%`,
        help: 'Fraction of each lap the frequency axis fills. Below 100% leaves a gap so the laps read as separate ridges.' },
      { key: 'rotate', label: 'Rotate', min: 0, max: 1, step: 0.01, value: 0, fmt: (v) => `${Math.round(v * 360)}°`,
        help: 'Angle the track starts at.' },
      { key: 'freqInward', label: 'Bass out', type: 'tog', value: false,
        help: 'Flips the frequency axis so low frequencies sit at the rim.' },
    ],
  },
  {
    id: 'ssm',
    label: 'Similarity',
    blurb: 'Every moment compared against every other. Diagonals are repeats, blocks are sections.',
    build: buildSSM,
    params: [
      { key: 'size', label: 'Size', min: 128, max: 768, step: 64, value: 512, fmt: (v) => `${v}px`,
        help: 'Moments compared, and the width and height of the square output.' },
      { key: 'feature', label: 'Compare', type: 'seg', value: 'timbre',
        options: [['Timbre', 'timbre'], ['Harmony', 'chroma']],
        help: 'Timbre matches production and instrumentation; Harmony folds octaves onto twelve pitch classes so it tracks chords instead.' },
      { key: 'layout', label: 'Layout', type: 'seg', value: 'matrix',
        options: [['Matrix', 'matrix'], ['Lag', 'lag']],
        help: 'Matrix is the symmetric plot. Lag re-plots it by distance between moments, which straightens repeat diagonals into horizontal ledges.' },
      { key: 'enhance', label: 'Enhance', min: 0, max: 32, step: 1, value: 6,
        help: 'Averages along the diagonal direction. Raise it to consolidate speckle into continuous repeat lines.' },
      { key: 'sparsity', label: 'Sparsity', min: 0, max: 0.9, step: 0.05, value: 0, fmt: (v) => `${Math.round(v * 100)}%`,
        help: 'Drops the weakest share of the matrix to flat ground, leaving only the strongest matches standing.' },
    ],
  },
  {
    id: 'weave',
    label: 'Weave',
    blurb: 'The track folded onto its own bar grid. Repeated patterns stack into vertical ridges.',
    build: buildWeave,
    params: [
      { key: 'cols', label: 'Steps', min: 32, max: 512, step: 16, value: 256,
        help: 'Columns across one fold unit.' },
      { key: 'bpm', label: 'BPM', min: 0, max: 200, step: 1, value: 0, fmt: (v) => (v ? v : 'auto'),
        help: 'Tempo used for the fold. 0 detects it from the onset envelope; override it if the detected value is an octave off.' },
      { key: 'unit', label: 'Fold by', type: 'seg', value: 'bar',
        options: [['Beat', 'beat'], ['Bar', 'bar'], ['Phrase', 'phrase']],
        help: 'How much time one row covers. Phrase is four bars.' },
      { key: 'beatsPerBar', label: 'Beats/bar', min: 2, max: 12, step: 1, value: 4,
        help: 'Time signature numerator.' },
      { key: 'phase', label: 'Phase', min: -1, max: 1, step: 0.01, value: 0, fmt: (v) => v.toFixed(2),
        help: 'Shifts the downbeat. Nudge it until the ridges stand upright.' },
      { key: 'bands', label: 'Bands', min: 1, max: 8, step: 1, value: 1,
        help: 'Frequency sub-rows per fold unit. Above 1 the fold becomes a woven texture rather than a stripe chart.' },
      { key: 'source', label: 'Source', type: 'seg', value: 'energy',
        options: [['Energy', 'energy'], ['Onsets', 'onset']],
        help: 'Energy weaves the spectrum; Onsets weaves only the attacks, which isolates the rhythm.' },
      { key: 'bandLo', label: 'Band low', min: 0, max: 1, step: 0.05, value: 0, fmt: (v) => `${Math.round(v * 100)}%`,
        help: 'Lower edge of the frequency range fed into the weave — raise both edges together to weave the hats instead of the kick.' },
      { key: 'bandHi', label: 'Band high', min: 0, max: 1, step: 0.05, value: 1, fmt: (v) => `${Math.round(v * 100)}%`,
        help: 'Upper edge of the frequency range fed into the weave.' },
    ],
  },
  {
    id: 'strata',
    label: 'Strata',
    blurb: 'Measured qualities of the track stacked as separate layers over one timeline.',
    build: buildStrata,
    params: [
      { key: 'cols', label: 'Width', min: 128, max: 1024, step: 64, value: 512, fmt: (v) => `${v}px`,
        help: 'Time columns across the whole track.' },
      { key: 'bandH', label: 'Band', min: 8, max: 128, step: 4, value: 40, fmt: (v) => `${v}px`,
        help: 'Rows each stratum occupies.' },
      { key: 'gap', label: 'Gap', min: 0, max: 32, step: 1, value: 4, fmt: (v) => `${v}px`,
        help: 'Flat rows between strata.' },
      { key: 'smooth', label: 'Smooth', min: 0, max: 64, step: 1, value: 3,
        help: 'Moving average on each curve. Raise it for gentle landforms, drop it to keep every twitch.' },
      { key: 'render', label: 'Draw', type: 'seg', value: 'profile',
        options: [['Profile', 'profile'], ['Terrace', 'ridge']],
        help: 'Profile fills each band up to its curve, giving a silhouette. Terrace fills the whole band at the curve’s value.' },
      // Nine strata at once is a wall; the three most redundant with the others
      // start off so the default output reads as layers rather than as noise.
      ...STRATA_FEATURES.map((ft) => ({
        key: ft.key, label: ft.label, type: 'tog', group: 'Layers',
        value: !['bandwidth', 'rolloff', 'flatness'].includes(ft.id),
        help: `Include the ${ft.label.toLowerCase()} stratum.`,
      })),
    ],
  },
]

/** Defaults for one projection, taken straight from its schema. */
export function projectionDefaults(id) {
  const def = TRACK_PROJECTIONS.find((p) => p.id === id)
  const out = {}
  for (const p of def?.params ?? []) out[p.key] = p.value
  return out
}

/** Defaults for every projection, keyed by id — the shape `opts.proj` holds. */
export function allProjectionDefaults() {
  const out = {}
  for (const p of TRACK_PROJECTIONS) out[p.id] = projectionDefaults(p.id)
  return out
}

export function getProjection(id) {
  return TRACK_PROJECTIONS.find((p) => p.id === id) ?? TRACK_PROJECTIONS[0]
}

/**
 * Tempo the weave panel shows next to its BPM slider. Exposed separately
 * because the readout wants the detected value even when the user has pinned an
 * override, and re-running the projection just to learn it would be absurd.
 */
export function detectTrackBpm(spec) {
  if (!spec) return 0
  return detectBpm(onsetEnvelope(spec), spec.sampleRate / spec.hop)
}
