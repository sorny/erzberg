/**
 * Short-Time Fourier Transform — pure, no worker/DOM dependencies.
 *
 * Turns a mono PCM buffer into a time × frequency magnitude grid. The whole
 * track is analysed once on upload; playback then just slices windows out of
 * the result, so scrubbing and re-styling never re-run the FFT.
 *
 * Values are stored as dB normalized over a FIXED range (DB_MIN…0). Keeping the
 * storage range fixed — rather than baking in the user's floor/contrast — lets
 * the dB Floor and Contrast controls be applied per frame at streaming time for
 * free, instead of forcing a re-analysis of the file on every slider tick.
 */
import { FFT, hannWindow } from './fft'

export const DB_MIN = -110

// Ceiling on the number of STFT frames retained for a track. Long files would
// otherwise allocate without bound (a 10-minute track at hop 512 is ~52k
// frames); past this the hop is stretched so time resolution degrades
// gracefully instead of exhausting memory.
export const MAX_FRAMES = 24000

/**
 * Frequency-bin edges into the half-spectrum.
 *
 * Log spacing is the musically meaningful one — an octave is a constant
 * distance, so bass detail is not crushed into the bottom few rows the way it
 * is under linear spacing. Edges are forced strictly increasing so no output
 * bin is empty when many bins map into the sparse low end.
 */
export function binEdges(bins, specLen, sampleRate, logFreq) {
  const edges = new Uint32Array(bins + 1)
  const nyquist = sampleRate / 2
  if (logFreq) {
    const fMin = 30, fMax = nyquist
    for (let i = 0; i <= bins; i++) {
      const f = fMin * Math.pow(fMax / fMin, i / bins)
      edges[i] = Math.round((f / nyquist) * (specLen - 1))
    }
  } else {
    for (let i = 0; i <= bins; i++) edges[i] = Math.round((i / bins) * (specLen - 1))
  }
  edges[0] = Math.min(edges[0], specLen - 1)
  for (let i = 1; i <= bins; i++) {
    if (edges[i] <= edges[i - 1]) edges[i] = edges[i - 1] + 1
    if (edges[i] > specLen) edges[i] = specLen
  }
  return edges
}

/**
 * @param {Float32Array} pcm        mono samples, nominally −1…1
 * @param {number}       sampleRate Hz
 * @param {object}       opts       { fftSize, bins, logFreq }
 * @param {(pct:number)=>void} [onProgress]
 * @returns {{data:Float32Array, frames:number, bins:number, hop:number,
 *            sampleRate:number, fftSize:number, logFreq:boolean, duration:number}}
 *          `data` is row-major [frame][bin], each value 0…1.
 */
export function computeSpectrogram(pcm, sampleRate, { fftSize, bins, logFreq }, onProgress) {
  if (!pcm || pcm.length === 0) throw new Error('Empty audio buffer.')

  // Hop is normally fftSize/4 (75% overlap). It is stretched only if that
  // would blow past MAX_FRAMES for a long track.
  const baseHop = Math.max(1, Math.floor(fftSize / 4))
  const hop = Math.max(baseHop, Math.ceil(pcm.length / MAX_FRAMES))
  const frames = Math.max(1, Math.floor(Math.max(0, pcm.length - fftSize) / hop) + 1)

  const specLen = fftSize >> 1              // usable bins, DC … Nyquist
  const edges = binEdges(bins, specLen, sampleRate, logFreq)

  const fft = new FFT(fftSize)
  const win = hannWindow(fftSize)
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)

  // Coherent gain of the window, so a full-scale sinusoid lands near 0 dB.
  let winSum = 0
  for (let i = 0; i < fftSize; i++) winSum += win[i]
  const magScale = 2 / winSum

  const data = new Float32Array(frames * bins)
  const invDbRange = 1 / -DB_MIN
  let nextReport = 0

  for (let f = 0; f < frames; f++) {
    const off = f * hop
    for (let i = 0; i < fftSize; i++) {
      const s = off + i
      re[i] = s < pcm.length ? pcm[s] * win[i] : 0
      im[i] = 0
    }
    fft.transform(re, im)

    const rowOff = f * bins
    for (let b = 0; b < bins; b++) {
      const lo = edges[b]
      const hi = Math.max(lo + 1, Math.min(edges[b + 1], specLen))
      // Peak-hold across the band rather than a mean: averaging washes out
      // narrow partials, which are exactly the ridges that make a spectrogram
      // read as terrain.
      let peak = 0
      for (let k = lo; k < hi; k++) {
        const m = re[k] * re[k] + im[k] * im[k]
        if (m > peak) peak = m
      }
      const db = 20 * Math.log10(Math.sqrt(peak) * magScale + 1e-12)
      const v = (db - DB_MIN) * invDbRange
      data[rowOff + b] = v < 0 ? 0 : v > 1 ? 1 : v
    }

    if (onProgress && f >= nextReport) {
      onProgress(Math.round((f / frames) * 100))
      nextReport = f + Math.ceil(frames / 25)
    }
  }

  return {
    data, frames, bins, hop, sampleRate, fftSize, logFreq,
    duration: pcm.length / sampleRate,
  }
}

/**
 * Slices the scrolling window that is fed to the terrain as a heightmap.
 *
 * Output is a width=`windowFrames` × height=`bins` image with time on X and
 * frequency on Y, low frequencies at the bottom (row `bins-1`) to match how a
 * spectrogram is conventionally read. `endFrame` is the newest column, drawn at
 * the right edge; frames before the start of the track stay silent, so a track
 * scrolls in from the right rather than starting mid-stream.
 *
 * dbFloor01/contrast are applied here, not at analysis time — see the note on
 * the fixed storage range at the top of this file.
 */
export function sliceWindow(spec, endFrame, windowFrames, dbFloor01 = 0, contrast = 1) {
  const { data, frames, bins } = spec
  const out = new Float32Array(bins * windowFrames)
  const inv = 1 / Math.max(1e-6, 1 - dbFloor01)

  for (let x = 0; x < windowFrames; x++) {
    const f = endFrame - (windowFrames - 1 - x)
    if (f < 0 || f >= frames) continue
    const src = f * bins
    for (let b = 0; b < bins; b++) {
      let v = (data[src + b] - dbFloor01) * inv
      v = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, contrast)
      out[(bins - 1 - b) * windowFrames + x] = v
    }
  }
  return out
}

/**
 * Time-axis downsample of the whole track to at most `maxCols` columns, for the
 * "freeze whole track" heightmap and the sidebar overview. Peak-holds within
 * each column bucket for the same reason the frequency binning does.
 */
export function resampleTime(spec, maxCols, dbFloor01 = 0, contrast = 1) {
  const { data, frames, bins } = spec
  const cols = Math.max(1, Math.min(maxCols, frames))
  const out = new Float32Array(bins * cols)
  const inv = 1 / Math.max(1e-6, 1 - dbFloor01)

  for (let x = 0; x < cols; x++) {
    const f0 = Math.floor((x / cols) * frames)
    const f1 = Math.max(f0 + 1, Math.floor(((x + 1) / cols) * frames))
    for (let b = 0; b < bins; b++) {
      let peak = 0
      for (let f = f0; f < f1 && f < frames; f++) {
        const v = data[f * bins + b]
        if (v > peak) peak = v
      }
      let v = (peak - dbFloor01) * inv
      v = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, contrast)
      out[(bins - 1 - b) * cols + x] = v
    }
  }
  return { pixels: out, width: cols, height: bins }
}
