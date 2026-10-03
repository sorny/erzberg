/**
 * Transport for a track: play, restart, skip, loop, scrub. The flock and the
 * Soundscape both use it. A button shows only when its handler is there, so a
 * player with no loop has no loop button, and `scrub={false}` leaves the bar
 * out for a player that seeks some other way (the spectrogram, for Soundscapes).
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
import { Btn, MUTED, RowBtn } from './panel/ui'

const fmt = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function AudioTransport({ fa, testIdPrefix = 'flock-audio', scrub = true }) {
  const id = (name) => `${testIdPrefix}-${name}`
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <Btn variant="toggle" on={fa.isPlaying} data-testid={id('play')} onClick={fa.toggle}
          title="Play / pause  (space)" aria-label={fa.isPlaying ? 'Pause' : 'Play'} style={{ minWidth: 26 }}>
          {fa.isPlaying ? '❚❚' : '▶'}
        </Btn>
        {fa.restart && <Btn data-testid={id('restart')} onClick={fa.restart} title="Back to the start" aria-label="Back to the start">⏮</Btn>}
        {fa.skip && <><Btn data-testid={id('back')} onClick={() => fa.skip?.(-5)} title="Back 5 seconds">−5 s</Btn>
        <Btn data-testid={id('fwd')} onClick={() => fa.skip?.(5)} title="Forward 5 seconds">+5 s</Btn></>}
        {fa.setLoop && <Btn variant="toggle" on={fa.loop} data-testid={id('loop')} onClick={() => fa.setLoop?.(!fa.loop)}
          title="Loop the track" aria-label="Loop" aria-pressed={!!fa.loop} style={{ marginLeft: 'auto' }}>⟲</Btn>}
      </div>

      {scrub && (
        <input
          ref={scrubRef} type="range" className="hmr" data-testid={id('scrub')}
          min={0} max={1} step={0.0005} defaultValue={0}
          onPointerDown={() => { draggingRef.current = true }}
          onPointerUp={() => { draggingRef.current = false }}
          onPointerCancel={() => { draggingRef.current = false }}
          // Seeking on `input` rather than on release, so scrubbing is audible and
          // the flock reacts as you drag — which is how you find the bar you want.
          onChange={(e) => seekFrac(parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
        <span ref={timeRef} data-testid={id('time')}
          style={{ fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>0:00 / 0:00</span>
        <span style={{ fontSize: 10, color: MUTED, flex: 1, overflow: 'hidden',
                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fa.fileName}</span>
        {fa.release && <RowBtn onClick={fa.release} label={`Remove ${fa.fileName}`} title="Remove">✕</RowBtn>}
      </div>
    </div>
  )
}
