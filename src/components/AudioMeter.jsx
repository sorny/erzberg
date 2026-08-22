/**
 * Live readout of what the flock is hearing, and of what that is doing to it.
 *
 * Two rows. The top is the spectrum at the playhead with the three bands tinted
 * behind it and each band's envelope drawn as a cap — so you can see that the
 * kick really is landing in the bass band and not smearing into the mid. The
 * bottom is one bar per channel showing its *current contribution*, which is the
 * part that makes the sliders tunable by eye: raise Pulse and watch its bar grow
 * on every kick, rather than raising it and squinting at the flock.
 *
 * It samples the spectrogram itself rather than reading the simulation's state.
 * Both are deterministic functions of the same playhead with the same envelope
 * constants, so they agree; sampling independently means the meter keeps working
 * when the flock is paused, which is exactly when you want to be setting it up.
 *
 * Everything happens inside one requestAnimationFrame loop writing to a canvas.
 * Nothing here re-renders React — the whole point of the audio path is that it
 * runs at frame rate without touching the tree, and a meter that undid that
 * would cost more than the feature it is reporting on.
 */
import { useEffect, useRef } from 'react'
import { makeBandPlan, createAudioState, sampleAudio, applyAudio, audioVisuals, shapeFeatures, audioRanges } from '../utils/audioFeatures'
// HEX rather than the var() exports: this component paints on a 2D canvas,
// which resolves literal colours only.
import { BORDER, HEX } from './panel/ui'

const H_SPECTRUM = 46
const H_BARS = 24
const H = H_SPECTRUM + H_BARS

// Bass, mid, high. Warm to cool, low to high — the same reading direction as a
// spectrogram, so the picture matches the terrain a Soundscape would make.
const BAND_COLOURS = ['#f97316', '#22c55e', '#38bdf8']
const CHANNELS = [
  ['PACE',  '#a78bfa'],
  ['PULSE', '#f97316'],
  ['SHIM',  '#38bdf8'],
  ['SIZE',  '#facc15'],
  ['BURST', '#f43f5e'],
]

export function AudioMeter({ liveRef, points }) {
  const canvasRef = useRef(null)
  const pRef = useRef(points)
  pRef.current = points

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const cache = { spec: null, plan: null, state: createAudioState() }
    let raf = 0
    let last = performance.now()
    // A collapsed Section still renders its children — it is a zero-height grid
    // row, not an unmount — so without this the meter would sample the
    // spectrogram and repaint sixty times a second for a widget nobody can see.
    // An observer catches being scrolled out of the panel too, which a
    // visibility check on the element itself would not.
    let onScreen = true
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting }, { threshold: 0 })
    io.observe(canvas)
    // Onsets are single-frame events; without a decaying trace they would flash
    // for 16 ms and be gone before the eye caught them.
    let onsetTrace = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!onScreen) { last = performance.now(); return }
      const now = performance.now()
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const cssW = canvas.clientWidth || 232
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(H * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const W = cssW

      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#141417'
      ctx.fillRect(0, 0, W, H)

      const p = pRef.current ?? {}
      const live = liveRef?.current
      const spec = live?.getSpec?.() ?? null

      if (!spec) {
        ctx.fillStyle = HEX.muted
        ctx.font = '9px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('no track', W / 2, H / 2 + 3)
        return
      }
      if (cache.spec !== spec) {
        cache.spec = spec
        cache.plan = makeBandPlan(spec)
        cache.state = createAudioState()
      }

      const playing = !!live.isPlaying?.()
      const t = (live.getTime?.() ?? 0) + (p.flockAudioSync ?? 0.04)
      const f = sampleAudio(spec, cache.plan, cache.state, t, dt, playing)
      const raw = { level: f.level, bass: f.env[0], mid: f.env[1], high: f.env[2],
                    startle: f.startle, onset: f.onset }
      const ranges = audioRanges(p)
      const ch = shapeFeatures(raw, ranges)

      // ── Spectrum ────────────────────────────────────────────────────────────
      const { data, bins, frames, hop, sampleRate } = spec
      const frame = Math.max(0, Math.min(frames - 1, Math.round((t * sampleRate) / hop)))
      const row = frame * bins
      const bw = W / bins

      // Band backgrounds, so the bar heights can be read against where each band
      // actually sits rather than against a guess.
      cache.plan.ranges.forEach(([i0, i1], i) => {
        ctx.fillStyle = BAND_COLOURS[i] + '14'
        ctx.fillRect(i0 * bw, 0, (i1 - i0) * bw, H_SPECTRUM)
      })

      ctx.fillStyle = '#3f3f46'
      for (let b = 0; b < bins; b++) {
        const v = playing ? data[row + b] : 0
        const h = v * (H_SPECTRUM - 2)
        if (h > 0.4) ctx.fillRect(b * bw, H_SPECTRUM - h, Math.max(0.7, bw - 0.3), h)
      }

      // Each band's window, drawn as a bracket behind its envelope cap. Without
      // this the range handles are guesswork: the whole point is to see where
      // the track actually sits so you can put the window around it.
      const yOf = (v) => H_SPECTRUM - 1 - v * (H_SPECTRUM - 3)
      const BAND_RANGE = ['pace', 'pulse', 'shimmer']   // level shown over bass's band
      cache.plan.ranges.forEach(([i0, i1], i) => {
        const [lo, hi] = ranges[BAND_RANGE[i]] ?? [0, 1]
        const x0 = i0 * bw, w = (i1 - i0) * bw
        ctx.fillStyle = BAND_COLOURS[i] + '30'
        ctx.fillRect(x0, yOf(hi), w, Math.max(1, yOf(lo) - yOf(hi)))
        ctx.fillStyle = BAND_COLOURS[i] + '99'
        ctx.fillRect(x0, yOf(lo), w, 1)
        ctx.fillRect(x0, yOf(hi), w, 1)
      })

      // Envelope caps: what the flock is actually reacting to, which is smoothed
      // and auto-gained and so sits nowhere near the raw spectrum's height.
      cache.plan.ranges.forEach(([i0, i1], i) => {
        const y = yOf(f.env[i])
        ctx.fillStyle = BAND_COLOURS[i]
        ctx.fillRect(i0 * bw, y, (i1 - i0) * bw, 1.5)
      })

      // Overall level, across the full width.
      const ly = yOf(f.level)
      ctx.strokeStyle = '#e4e4e7'
      ctx.globalAlpha = 0.5
      ctx.setLineDash([2, 3])
      ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W, ly); ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      // ── Channels ────────────────────────────────────────────────────────────
      // Derived by running the real transforms over neutral parameters and
      // reading what comes back, rather than by restating their formulas here —
      // a meter that drifts from the thing it is metering is worse than none.
      onsetTrace = Math.max(onsetTrace * Math.pow(0.05, dt / 0.35), ch.burst ?? 0)
      const drive = p.flockAudioDrive ?? 1
      const amt = {
        speed:   drive * (p.flockAudioSpeed ?? 1),
        pulse:   drive * (p.flockAudioPulse ?? 1),
        shimmer: drive * (p.flockAudioShimmer ?? 1),
        startle: drive * (p.flockAudioStartle ?? 1),
      }
      const neutral = { speed: 1, cohesion: 1, separation: 1, turbulence: 0, predator: true, predatorFear: 1 }
      const out = applyAudio(neutral, ch, amt)
      const vis = audioVisuals(ch, { size: drive * (p.flockAudioSize ?? 1) })
      const values = [
        Math.abs(out.speed - 1) / 0.7,
        (out.separation - 1) / 2,
        out.turbulence / 1.6,
        (vis.size - 1) / 1.2,
        (drive * (p.flockAudioBurst ?? 1) * 1.8 * onsetTrace) / 1.8,
      ]

      // Labels sit *under* the bars rather than inside them. Inside, a label
      // spanning the fill boundary is half dark-on-bright and half light-on-dark
      // whatever colour it is drawn in, and it was unreadable at exactly the
      // moment it mattered — when the channel was half lit.
      const gap = 4
      const cw = (W - gap * (CHANNELS.length - 1)) / CHANNELS.length
      const top = H_SPECTRUM + 4
      const barH = 8
      ctx.font = '7px system-ui, sans-serif'
      ctx.textAlign = 'center'
      CHANNELS.forEach(([label, colour], i) => {
        const x = i * (cw + gap)
        ctx.fillStyle = '#27272a'
        ctx.fillRect(x, top, cw, barH)
        const v = Math.max(0, Math.min(1, values[i] || 0))
        ctx.fillStyle = colour
        ctx.fillRect(x, top, cw * v, barH)
        ctx.fillStyle = v > 0.02 ? colour : HEX.muted
        ctx.fillText(label, x + cw / 2, top + barH + 8)
      })

      // A track that is loaded but not playing should look stopped rather than
      // broken, so say so instead of drawing a flat line and leaving you to
      // wonder whether the analysis failed.
      if (!playing) {
        ctx.fillStyle = 'rgba(20,20,23,0.72)'
        ctx.fillRect(0, 0, W, H_SPECTRUM)
        ctx.fillStyle = HEX.muted
        ctx.font = '9px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('paused', W / 2, H_SPECTRUM / 2 + 3)
      }
    }

    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); io.disconnect() }
  }, [liveRef])

  return (
    <canvas
      ref={canvasRef}
      data-testid="flock-audio-meter"
      style={{ width: '100%', height: H, display: 'block', borderRadius: 4,
               border: `1px solid ${BORDER}`, marginBottom: 8 }}
    />
  )
}
