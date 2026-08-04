/**
 * Web Worker — runs the STFT off the main thread.
 *
 * Analysis of a full track is seconds of solid FFT work; on the main thread it
 * would freeze the UI (and the render loop) for the duration. All the actual
 * maths lives in spectrogram.js so it stays unit-testable without a worker.
 */
import { computeSpectrogram } from './spectrogram'

self.onmessage = (e) => {
  const { pcm, sampleRate, fftSize, bins, logFreq } = e.data
  try {
    const result = computeSpectrogram(
      pcm, sampleRate, { fftSize, bins, logFreq },
      (progress) => self.postMessage({ progress }),
    )
    self.postMessage({ result }, [result.data.buffer])
  } catch (err) {
    self.postMessage({ error: err.message })
  }
}
