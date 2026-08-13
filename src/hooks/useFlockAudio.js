/**
 * A track for the flock to fly to — and nothing else.
 *
 * Deliberately separate from `useSoundscape`, which exists to *become* the
 * terrain: every frame it analyses is pushed into the heightmap store, so
 * loading a track there replaces whatever raster you were working on. That is
 * the whole point of Soundscapes and exactly wrong here. Wanting the birds to
 * react to music is not wanting your mountain replaced by a spectrogram.
 *
 * So this hook decodes, analyses and plays, and touches no store at all. The
 * terrain is untouched; the only thing that reads the result is the murmuration.
 *
 * If a Soundscape *is* loaded and playing, that is used as a fallback rather
 * than making you upload the same file twice — see `liveRef` below.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import SpectrogramWorker from '../utils/spectrogram.worker?worker'

// Coarser than Soundscapes' defaults on purpose. Nothing here becomes a
// heightmap: the flock reduces the spectrum to three bands and a flux figure,
// so 128 rows is already far more resolution than any of those readings can
// use, and it analyses in a fraction of the time.
const FFT_SIZE = 2048
const BINS = 128
const LOG_FREQ = true

export function useFlockAudio(fallbackLiveRef) {
  const [fileName, setFileName] = useState('')
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  // Looping is the sane default for a backdrop the flock reacts to, but not
  // everyone wants a six-minute track on repeat while they work.
  const [loop, setLoopState] = useState(true)

  const audioRef = useRef(null)
  const urlRef = useRef(null)
  const workerRef = useRef(null)
  const specRef = useRef(null)

  // Stable across renders, like the Soundscapes one: the flock reads this sixty
  // times a second from inside useFrame, and re-rendering the tree for it is the
  // thing this codebase spends the most effort avoiding.
  //
  // Own track first, Soundscape second. The fallback means that if you already
  // have music playing through Soundscapes, the flock listens to that rather
  // than asking for the same file again.
  const fallbackRef = useRef(fallbackLiveRef)
  fallbackRef.current = fallbackLiveRef
  const liveRef = useRef(null)
  if (!liveRef.current) {
    const own = () => (specRef.current ? specRef.current : null)
    const fb = () => fallbackRef.current?.current ?? null
    liveRef.current = {
      getSpec: () => own() ?? fb()?.getSpec() ?? null,
      getTime: () => (own() ? (audioRef.current?.currentTime ?? 0) : (fb()?.getTime() ?? 0)),
      isPlaying: () => (own()
        ? !!(audioRef.current && !audioRef.current.paused && !audioRef.current.ended)
        : !!fb()?.isPlaying()),
      /** Which source the flock is actually listening to, for the panel to report. */
      source: () => (specRef.current ? 'own' : (fb()?.getSpec() ? 'soundscape' : 'none')),
    }
  }

  const release = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    audioRef.current?.pause()
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
    specRef.current = null
    setFileName('')
    setDuration(0)
    setIsPlaying(false)
    setIsAnalyzing(false)
    setProgress(0)
    setReady(false)
  }, [])

  const loadFile = useCallback(async (file) => {
    setError(null)
    setIsAnalyzing(true)
    setProgress(0)
    setReady(false)
    try {
      const buf = await file.arrayBuffer()

      // A short-lived context purely for decoding — playback goes through the
      // <audio> element, so nothing needs to stay open afterwards.
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) throw new Error('Web Audio is not available in this browser.')
      const ctx = new Ctx()
      let audioBuf
      try { audioBuf = await ctx.decodeAudioData(buf.slice(0)) } finally { ctx.close?.() }

      // Mono mixdown: the flock reads band energy, which is a property of the
      // mix rather than of either channel.
      const chans = audioBuf.numberOfChannels
      const len = audioBuf.length
      const pcm = new Float32Array(len)
      for (let c = 0; c < chans; c++) {
        const src = audioBuf.getChannelData(c)
        for (let i = 0; i < len; i++) pcm[i] += src[i]
      }
      if (chans > 1) for (let i = 0; i < len; i++) pcm[i] /= chans

      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = URL.createObjectURL(file)
      if (!audioRef.current) audioRef.current = new Audio()
      const a = audioRef.current
      a.pause()
      a.src = urlRef.current
      a.currentTime = 0

      setFileName(file.name)
      setDuration(audioBuf.duration)

      workerRef.current?.terminate()
      const worker = new SpectrogramWorker()
      workerRef.current = worker
      worker.onmessage = (e) => {
        const { progress: pct, result, error: err } = e.data
        if (pct !== undefined) { setProgress(pct); return }
        if (err) { setError(err); setIsAnalyzing(false); return }
        specRef.current = result
        setIsAnalyzing(false)
        setProgress(100)
        setReady(true)
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
      }
      worker.postMessage({ pcm, sampleRate: audioBuf.sampleRate, fftSize: FFT_SIZE, bins: BINS, logFreq: LOG_FREQ })
      return true
    } catch (err) {
      setError(err?.message || 'Could not decode this audio file.')
      setIsAnalyzing(false)
      return false
    }
  }, [])

  const loadFromPicker = useCallback(() => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      accept: 'audio/mpeg,audio/mp3,.mp3,audio/wav,audio/ogg,audio/flac,audio/mp4,.m4a',
    })
    input.onchange = (e) => { const f = e.target.files[0]; if (f) loadFile(f) }
    input.click()
  }, [loadFile])

  const play = useCallback(() => {
    const a = audioRef.current
    if (!a || !specRef.current) return
    a.play().then(() => setIsPlaying(true)).catch((err) => setError(err?.message || 'Playback blocked.'))
  }, [])
  const pause = useCallback(() => { audioRef.current?.pause(); setIsPlaying(false) }, [])
  const toggle = useCallback(() => { if (isPlaying) pause(); else play() }, [isPlaying, play, pause])

  /**
   * Move the playhead. Everything the flock reads is a function of *time*
   * — features come from the precomputed spectrogram at `currentTime`, not from
   * a running stream — so seeking needs no resynchronisation of anything: the
   * next frame simply reads a different column and the flock reacts to where it
   * landed.
   */
  const seek = useCallback((t) => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Math.max(0, Math.min(duration || 0, t))
  }, [duration])

  const restart = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = 0
    if (!isPlaying) play()
  }, [isPlaying, play])

  const skip = useCallback((delta) => {
    const a = audioRef.current
    if (!a) return
    // Wrapping rather than clamping: skipping back from the first second of a
    // looping track should land near its end, not pin at zero.
    const d = duration || 0
    let t = a.currentTime + delta
    if (d > 0) t = ((t % d) + d) % d
    a.currentTime = Math.max(0, t)
  }, [duration])

  const setLoop = useCallback((v) => {
    setLoopState(v)
    if (audioRef.current) audioRef.current.loop = v
  }, [])

  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio()
    const a = audioRef.current
    a.loop = loop
    const onEnded = () => setIsPlaying(false)
    a.addEventListener('ended', onEnded)
    return () => a.removeEventListener('ended', onEnded)
  }, [loop])

  useEffect(() => () => {
    workerRef.current?.terminate()
    audioRef.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
  }, [])

  return {
    fileName, duration, isPlaying, isAnalyzing, progress, error, ready, loop,
    loadFromPicker, play, pause, toggle, release, liveRef,
    seek, restart, skip, setLoop,
    clearError: () => setError(null),
  }
}
