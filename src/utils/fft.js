/**
 * Minimal iterative radix-2 Cooley–Tukey FFT.
 *
 * Used by the spectrogram worker to turn windowed PCM frames into magnitude
 * spectra. Kept dependency-free and allocation-free per frame: bit-reversal
 * indices and twiddle factors are precomputed once per FFT size, and
 * transform() runs in place on caller-owned scratch buffers.
 */
export class FFT {
  /** @param {number} n transform size — must be a power of two. */
  constructor(n) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`)
    this.n = n

    // Bit-reversal permutation table.
    const bits = Math.log2(n)
    this.rev = new Uint32Array(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
      this.rev[i] = r
    }

    // Twiddles for the largest stage; smaller stages stride through them.
    const half = n >> 1
    this.cos = new Float64Array(half)
    this.sin = new Float64Array(half)
    for (let i = 0; i < half; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n)
    }
  }

  /**
   * Forward transform, in place.
   * @param {Float64Array} re real parts, length n
   * @param {Float64Array} im imaginary parts, length n
   */
  transform(re, im) {
    const { n, rev, cos, sin } = this

    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t
        t = im[i]; im[i] = im[j]; im[j] = t
      }
    }

    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const stride = n / size
      for (let base = 0; base < n; base += size) {
        for (let j = base, k = 0; j < base + half; j++, k += stride) {
          const l = j + half
          const wr = cos[k], wi = sin[k]
          const xr = re[l] * wr - im[l] * wi
          const xi = re[l] * wi + im[l] * wr
          re[l] = re[j] - xr; im[l] = im[j] - xi
          re[j] += xr;        im[j] += xi
        }
      }
    }
  }
}

/** Periodic Hann window of length n — the standard choice for STFT analysis. */
export function hannWindow(n) {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n))
  return w
}
