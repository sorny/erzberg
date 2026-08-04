/**
 * Soundscapes — drives the terrain from an audio file.
 *
 * An uploaded track is decoded once, analysed once into a full spectrogram
 * (off-thread), and then *streamed* into the heightmap store: on every tick a
 * window of the spectrogram ending at the current playback position is written
 * as the heightmap. Because it lands in the same store slot a PNG or GeoTIFF
 * would, every existing tool — draw modes, hillshade, erosion, exports —
 * applies to it unchanged.
 *
 * The audio itself plays through a plain <audio> element rather than a Web
 * Audio graph: the visuals are driven by the precomputed spectrogram, so all
 * that is needed from playback is a clock (`currentTime`) plus native seeking.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { resampleTime, sliceWindow } from '../utils/spectrogram'
import SpectrogramWorker from '../utils/spectrogram.worker?worker'

export const SOUNDSCAPE_DEFAULTS = {
  fftSize: 2048,      // analysis window — larger = finer frequency, coarser time
  bins: 512,          // frequency rows; also the heightmap height
  logFreq: true,      // log frequency axis (musically even) vs linear
  windowFrames: 512,  // time columns held on screen; also the heightmap width
  fps: 30,            // heightmap pushes per second (each triggers a rebuild)
  dbFloor: 0.35,      // noise gate, as a fraction of the stored dB range
  contrast: 1.4,      // gamma on the gated value
}

// Params that change the analysis itself and so require re-running the FFT.
const ANALYSIS_KEYS = ['fftSize', 'bins', 'logFreq']

// Column cap for "freeze whole track" — keeps the static heightmap in the same
// size class as a normal raster instead of tens of thousands of columns wide.
const FREEZE_MAX_COLS = 1024

export function useSoundscape() {
  const setHeightmap = useStore((s) => s.setHeightmap)
  const clearGeoTiffMeta = useStore((s) => s.clearGeoTiffMeta)

  const [fileName, setFileName] = useState('')
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const [spec, setSpec] = useState(null)
  const [opts, setOptsState] = useState(SOUNDSCAPE_DEFAULTS)
  // True while the soundscape owns the heightmap slot. Cleared when another
  // loader takes over so the section can show whether it is still driving.
  const [active, setActive] = useState(false)

  const audioRef = useRef(null)
  const urlRef = useRef(null)
  const workerRef = useRef(null)
  const pcmRef = useRef(null)        // decoded mono PCM, kept for re-analysis
  const sampleRateRef = useRef(44100)
  const specRef = useRef(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const fileNameRef = useRef('')
  fileNameRef.current = fileName

  // ── Push one window into the heightmap store ──────────────────────────────
  // The filename is deliberately constant across pushes: it feeds the document
  // title and export base name, and rewriting it per frame would churn both.
  const pushFrame = useCallback((time) => {
    const s = specRef.current
    if (!s) return
    const o = optsRef.current
    const frame = Math.max(0, Math.min(s.frames - 1, Math.round((time * s.sampleRate) / s.hop)))
    const pixels = sliceWindow(s, frame, o.windowFrames, o.dbFloor, o.contrast)
    setHeightmap(pixels, null, o.windowFrames, s.bins, fileNameRef.current || 'soundscape')
    setActive(true)
  }, [setHeightmap])

  const pushFrameRef = useRef(pushFrame)
  pushFrameRef.current = pushFrame

  // ── Analysis ──────────────────────────────────────────────────────────────
  const runAnalysis = useCallback((pcm, sampleRate, o) => {
    workerRef.current?.terminate()
    const worker = new SpectrogramWorker()
    workerRef.current = worker
    setIsAnalyzing(true)
    setProgress(0)
    setError(null)

    worker.onmessage = (e) => {
      const { progress, result, error } = e.data
      if (progress !== undefined) { setProgress(progress); return }
      if (error) {
        setError(error)
        setIsAnalyzing(false)
        return
      }
      specRef.current = result
      setSpec(result)
      setIsAnalyzing(false)
      setProgress(100)
      clearGeoTiffMeta()
      // Seed the terrain immediately so there is something on screen before
      // the user hits play.
      pushFrameRef.current(audioRef.current?.currentTime ?? 0)
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }

    worker.postMessage({
      pcm, sampleRate,
      fftSize: o.fftSize, bins: o.bins, logFreq: o.logFreq,
    })
  }, [clearGeoTiffMeta])

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadFile = useCallback(async (file) => {
    setError(null)
    setIsAnalyzing(true)
    setProgress(0)
    try {
      const buf = await file.arrayBuffer()

      // A short-lived context purely for decoding — playback goes through the
      // <audio> element, so nothing needs to stay open afterwards.
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) throw new Error('Web Audio is not available in this browser.')
      const ctx = new Ctx()
      let audioBuf
      try {
        audioBuf = await ctx.decodeAudioData(buf.slice(0))
      } finally {
        ctx.close?.()
      }

      // Mono mixdown — a spectrogram of the summed channels is what reads as
      // terrain; per-channel analysis would just double the work.
      const chans = audioBuf.numberOfChannels
      const len = audioBuf.length
      const pcm = new Float32Array(len)
      for (let c = 0; c < chans; c++) {
        const src = audioBuf.getChannelData(c)
        for (let i = 0; i < len; i++) pcm[i] += src[i]
      }
      if (chans > 1) for (let i = 0; i < len; i++) pcm[i] /= chans

      pcmRef.current = pcm
      sampleRateRef.current = audioBuf.sampleRate

      // Playback source.
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = URL.createObjectURL(file)
      if (!audioRef.current) audioRef.current = new Audio()
      const a = audioRef.current
      a.pause()
      a.src = urlRef.current
      a.currentTime = 0

      setFileName(file.name)
      fileNameRef.current = file.name
      setDuration(audioBuf.duration)
      setCurrentTime(0)
      setIsPlaying(false)

      runAnalysis(pcm, audioBuf.sampleRate, optsRef.current)
      return { width: optsRef.current.windowFrames, height: optsRef.current.bins }
    } catch (err) {
      setError(err?.message || 'Could not decode this audio file.')
      setIsAnalyzing(false)
      return null
    }
  }, [runAnalysis])

  const loadFromPicker = useCallback((onLoaded) => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      accept: 'audio/mpeg,audio/mp3,.mp3,audio/wav,audio/ogg,audio/flac,audio/mp4,.m4a',
    })
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (file) loadFile(file).then((r) => { if (r) onLoaded?.(r) })
    }
    input.click()
  }, [loadFile])

  // ── Option changes ────────────────────────────────────────────────────────
  // Computed outside the state updater: spawning a worker from inside one is a
  // side effect in a function React is free to call more than once.
  const setOpts = useCallback((patch) => {
    const prev = optsRef.current
    const next = { ...prev, ...patch }
    optsRef.current = next
    setOptsState(next)

    if (ANALYSIS_KEYS.some((k) => next[k] !== prev[k])) {
      if (pcmRef.current) runAnalysis(pcmRef.current, sampleRateRef.current, next)
    } else if (specRef.current) {
      // Stream-time params (window width, floor, contrast) re-slice the current
      // position without touching the FFT.
      pushFrameRef.current(audioRef.current?.currentTime ?? 0)
    }
  }, [runAnalysis])

  // ── Transport ─────────────────────────────────────────────────────────────
  const play = useCallback(() => {
    const a = audioRef.current
    if (!a || !specRef.current) return
    a.play().then(() => setIsPlaying(true)).catch((err) => setError(err?.message || 'Playback blocked.'))
  }, [])

  const pause = useCallback(() => {
    audioRef.current?.pause()
    setIsPlaying(false)
  }, [])

  const toggle = useCallback(() => {
    if (isPlaying) pause(); else play()
  }, [isPlaying, play, pause])

  const stop = useCallback(() => {
    const a = audioRef.current
    if (a) { a.pause(); a.currentTime = 0 }
    setIsPlaying(false)
    setCurrentTime(0)
    if (specRef.current) pushFrameRef.current(0)
  }, [])

  const seek = useCallback((t) => {
    const a = audioRef.current
    const clamped = Math.max(0, Math.min(duration || 0, t))
    if (a) a.currentTime = clamped
    setCurrentTime(clamped)
    if (specRef.current) pushFrameRef.current(clamped)
  }, [duration])

  /** Writes the whole track as one static heightmap and stops streaming. */
  const freezeFullTrack = useCallback(() => {
    const s = specRef.current
    if (!s) return null
    pause()
    const o = optsRef.current
    const { pixels, width, height } = resampleTime(s, FREEZE_MAX_COLS, o.dbFloor, o.contrast)
    setHeightmap(pixels, null, width, height, `${fileNameRef.current || 'soundscape'} (full)`)
    setActive(true)
    return { width, height }
  }, [pause, setHeightmap])

  /** Called when another loader takes the heightmap slot. */
  const release = useCallback(() => {
    audioRef.current?.pause()
    setIsPlaying(false)
    setActive(false)
  }, [])

  // ── Streaming tick ────────────────────────────────────────────────────────
  // Throttled to opts.fps because each push replaces the heightmap and so costs
  // a full geometry rebuild. The loop reads the pusher through a ref so slider
  // changes don't restart it.
  //
  // Pacing is deadline-based rather than "has `interval` elapsed since the last
  // push". Ticks only arrive on rAF boundaries (~16.7 ms), so an elapsed test
  // can only ever produce rates of 60/n — asking for 45/s would silently give
  // 30/s, because the frame at 16.7 ms is always short of a 22.2 ms interval.
  // Advancing a deadline by exactly `interval` instead lets the gap alternate
  // between one and two frames so the *average* matches the request. The
  // deadline is resynced when it falls more than an interval behind, so a stall
  // is absorbed rather than repaid as a burst of catch-up pushes.
  //
  // SLACK covers the 60/s case, where the deadline and the frame boundary
  // coincide and ordinary jitter would drop every other frame.
  useEffect(() => {
    if (!isPlaying) return
    const SLACK = 2
    let raf = 0
    let next = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const a = audioRef.current
      if (!a) return
      const now = performance.now()
      const interval = 1000 / Math.max(1, optsRef.current.fps)
      if (now < next - SLACK) return
      next = (next === 0 || now - next > interval) ? now + interval : next + interval
      setCurrentTime(a.currentTime)
      pushFrameRef.current(a.currentTime)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying])

  // Playback reaching the end is the element's business, not the tick's.
  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio()
    const a = audioRef.current
    const onEnded = () => setIsPlaying(false)
    a.addEventListener('ended', onEnded)
    return () => a.removeEventListener('ended', onEnded)
  }, [])

  useEffect(() => () => {
    workerRef.current?.terminate()
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  return {
    fileName, duration, currentTime, isPlaying, isAnalyzing, progress, error, spec,
    opts, setOpts, active,
    loadFromPicker, play, pause, toggle, stop, seek, freezeFullTrack, release,
    clearError: () => setError(null),
  }
}
