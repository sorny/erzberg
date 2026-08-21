/**
 * Transport for the flock's track: play, restart, skip, scrub.
 *
 * The playhead is read in an animation frame and written straight to the DOM
 * rather than held in React state. A scrubber backed by state would re-render
 * the whole sidebar several times a second — for a panel this size that is the
 * most expensive thing on the page, and it is precisely what the rest of the
 * audio path is built to avoid. Two nodes get touched per frame: the range
 * input's value and one text node.
 *
 * Seeking needs no resynchronisation of anything downstream. Everything the
 * flock reads is a function of *time* — the features come from the precomputed
 * spectrogram at `currentTime`, not from a running stream — so the next frame
 * simply reads a different column and the flock reacts to where it landed.
 */
import { useEffect, useRef } from 'react'
import { ACCENT, BORDER, DIM, MUTED, SURF } from './panel/ui'

const fmt = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const btn = (extra = {}) => ({
  padding: '4px 7px', background: SURF, color: DIM, border: `1px solid ${BORDER}`,
  borderRadius: 3, cursor: 'pointer', fontSize: 10, lineHeight: 1, ...extra,
})

export function AudioTransport({ fa }) {
  const scrubRef = useRef(null)
  const timeRef = useRef(null)
  // True while the pointer owns the scrubber. Without it the rAF below would
  // fight the drag, snapping the handle back to the playhead on every frame.
  const draggingRef = useRef(false)
  const faRef = useRef(fa)
  faRef.current = fa

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const f = faRef.current
      const t = f?.liveRef?.current?.getTime?.() ?? 0
      const d = f?.duration || 0
      if (timeRef.current) timeRef.current.textContent = `${fmt(t)} / ${fmt(d)}`
      if (scrubRef.current && !draggingRef.current) {
        const v = String(d > 0 ? t / d : 0)
        if (scrubRef.current.value !== v) scrubRef.current.value = v
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const seekFrac = (frac) => fa.seek?.((fa.duration || 0) * frac)

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
        <button data-testid="flock-audio-play" onClick={fa.toggle} title="Play / pause  (space)"
          style={btn({ background: fa.isPlaying ? ACCENT : SURF, color: fa.isPlaying ? '#fff' : DIM,
                       borderColor: fa.isPlaying ? ACCENT : BORDER, minWidth: 26 })}>
          {fa.isPlaying ? '❚❚' : '▶'}
        </button>
        <button data-testid="flock-audio-restart" onClick={fa.restart} title="Back to the start"
          style={btn()}>⏮</button>
        <button data-testid="flock-audio-back" onClick={() => fa.skip?.(-5)} title="Back 5 seconds"
          style={btn()}>−5s</button>
        <button data-testid="flock-audio-fwd" onClick={() => fa.skip?.(5)} title="Forward 5 seconds"
          style={btn()}>+5s</button>
        <button data-testid="flock-audio-loop" onClick={() => fa.setLoop?.(!fa.loop)} title="Loop the track"
          style={btn({ marginLeft: 'auto',
                       background: fa.loop ? ACCENT : SURF, color: fa.loop ? '#fff' : MUTED,
                       borderColor: fa.loop ? ACCENT : BORDER })}>⟲</button>
      </div>

      <input
        ref={scrubRef} type="range" className="hmr" data-testid="flock-audio-scrub"
        min={0} max={1} step={0.0005} defaultValue={0}
        onPointerDown={() => { draggingRef.current = true }}
        onPointerUp={() => { draggingRef.current = false }}
        onPointerCancel={() => { draggingRef.current = false }}
        // Seeking on `input` rather than on release, so scrubbing is audible and
        // the flock reacts as you drag — which is how you find the bar you want.
        onChange={(e) => seekFrac(parseFloat(e.target.value))}
        style={{ width: '100%' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
        <span ref={timeRef} data-testid="flock-audio-time"
          style={{ fontSize: 9, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>0:00 / 0:00</span>
        <span style={{ fontSize: 9, color: MUTED, flex: 1, overflow: 'hidden',
                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fa.fileName}</span>
        <button type="button" onClick={fa.release} className="hmi" title="Remove this track"
          aria-label={`Remove ${fa.fileName}`}>
          <span aria-hidden="true" style={{ fontSize: 9, border: 'none' }}>✕</span>
        </button>
      </div>
    </div>
  )
}
