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
import { frameRect, guideDash, guideSegments, insetRect, paperAspect } from '../utils/frame'
import { isDarkBackground } from '../utils/colorUtils'

/**
 * The centre guides over the free canvas: the part of the window that the
 * panel does not cover, so they move when the panel opens or closes.
 */
export function CenterGuides({ view, bgColor, rightInset = 0 }) {
  const [win, setWin] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const w = Math.max(0, win.w - rightInset), h = win.h
  return (
    <div data-testid="centre-guide-lines" style={{ position: 'fixed', top: 0, left: 0, bottom: 0, right: rightInset,
                  pointerEvents: 'none', zIndex: 500 }}>
      <GuideLines segs={guideSegments({ x: 0, y: 0, w, h }, 'centre')} w={w} h={h}
        dark={isDarkBackground(bgColor)} color={view.guideColor} weight={view.guideWeight ?? 1}
        opacity={view.guideOpacity ?? 0.25} dash={view.guideDash ?? 'solid'} />
    </div>
  )
}

export function FrameOverlay({ view, bgColor, rightInset = 0 }) {
  const [win, setWin] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))

  useEffect(() => {
    const onResize = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // The canvas is inset to the control panel, and the sheet falls on the canvas.
  // Measuring the window instead put the frame a half-panel to the right of the
  // crop the SVG exporter would actually cut, which is the one thing this
  // overlay exists not to do.
  const size = { w: win.w - rightInset, h: win.h }

  // The same test the centre guides and the anaglyph use, so the frame reads on
  // paper and ink alike rather than disappearing into whichever background is set.
  const dark = isDarkBackground(bgColor)
  const line = dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)'
  const soft = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.18)'
  // Dimming the outside is what makes the crop legible at a glance. Kept light:
  // it is a composition aid, not a preview of the export.
  const veil = dark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)'

  const r = frameRect(
    size.w, size.h,
    paperAspect(view.framePaper ?? 'iso', !!view.frameLandscape, view.frameCustomRatio),
    view.frameScale ?? 0.85, view.frameOffsetX ?? 0, view.frameOffsetY ?? 0,
  )
  const inner = insetRect(r, view.frameMargin ?? 0)
  const hasMargin = (view.frameMargin ?? 0) > 0.001

  const panel = (style) => <div style={{ position: 'absolute', background: veil, ...style }} />

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, right: rightInset,
                  pointerEvents: 'none', zIndex: 500 }}>
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
      {/* Composition guides across the printed area, inside the margin. */}
      <GuideLines segs={guideSegments(inner, view.frameGuides)} w={size.w} h={size.h} dark={dark}
        color={view.frameGuideColor} weight={view.frameGuideWeight ?? 1}
        opacity={view.frameGuideOpacity ?? 0.5} dash={view.frameGuideDash ?? 'solid'} testId="paper-guides" />
    </div>
  )
}

/**
 * Guide segments as an SVG over the canvas. A composition aid like the frame:
 * DOM only, so no exporter draws it. An empty colour takes black or white,
 * whichever reads on the background.
 */
export function GuideLines({ segs, w, h, dark, color, weight = 1, opacity = 0.5, dash = 'solid', testId }) {
  if (!segs?.length) return null
  const ink = color || (dark ? '#ffffff' : '#000000')
  return (
    <svg data-testid={testId} width={w} height={h} viewBox={`0 0 ${w} ${h}`}
         style={{ position: 'absolute', left: 0, top: 0, display: 'block', overflow: 'visible' }}>
      <g stroke={ink} strokeOpacity={opacity} strokeWidth={weight} strokeDasharray={guideDash(dash, weight)} fill="none">
        {segs.map(([x0, y0, x1, y1], i) => <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} />)}
      </g>
    </svg>
  )
}
