/**
 * The paper edge, drawn over the viewport.
 *
 * A DOM overlay rather than anything in the 3D scene, following `CenterGuides`:
 * `position: fixed`, `pointerEvents: none` so orbit drags pass straight through,
 * and z-index 500 — under the panel, over the canvas. Being DOM it cannot leak
 * into either exporter, which is what you want from a composition aid.
 *
 * It works in **CSS pixels**; the exporter computes the same rect in
 * drawing-buffer pixels. Both go through `frameRect`, which is why they agree
 * across device pixel ratios and supersampling settings.
 *
 * One thing worth knowing: the canvas fills the window and the sidebar floats
 * *over* it rather than shrinking it, so a window-centred frame is not visually
 * centred while the panel is open. Centring on the window is still the right
 * default — it does not jump when the panel collapses — and Offset X is there
 * to nudge it across.
 */
import { useEffect, useState } from 'react'
import { frameRect, insetRect, paperAspect } from '../utils/frame'

export function FrameOverlay({ view, bgColor }) {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Same brightness test CenterGuides uses, so the frame reads on paper and ink
  // alike rather than disappearing into whichever background is set.
  const rgb = String(bgColor || '#ffffff').match(/\w\w/g)?.map((h) => parseInt(h, 16)) ?? [255, 255, 255]
  const bright = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000
  const line = bright > 128 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.6)'
  const soft = bright > 128 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.2)'
  // Dimming the outside is what makes the crop legible at a glance. Kept light:
  // it is a composition aid, not a preview of the export.
  const veil = bright > 128 ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)'

  const r = frameRect(
    size.w, size.h,
    paperAspect(view.framePaper ?? 'iso', !!view.frameLandscape, view.frameCustomRatio),
    view.frameScale ?? 0.85, view.frameOffsetX ?? 0, view.frameOffsetY ?? 0,
  )
  const inner = insetRect(r, view.frameMargin ?? 0)
  const hasMargin = (view.frameMargin ?? 0) > 0.001

  const panel = (style) => <div style={{ position: 'absolute', background: veil, ...style }} />

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 500 }}>
      {/* Four panels rather than one box-shadow: a shadow large enough to cover
          the window would have to be guessed at, and these are exact. */}
      {panel({ left: 0, top: 0, right: 0, height: Math.max(0, r.y) })}
      {panel({ left: 0, top: r.y + r.h, right: 0, bottom: 0 })}
      {panel({ left: 0, top: r.y, width: Math.max(0, r.x), height: r.h })}
      {panel({ left: r.x + r.w, top: r.y, right: 0, height: r.h })}

      <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h,
                    border: `1px solid ${line}` }} />
      {hasMargin && (
        <div style={{ position: 'absolute', left: inner.x, top: inner.y, width: inner.w, height: inner.h,
                      border: `1px dashed ${soft}` }} />
      )}
    </div>
  )
}
