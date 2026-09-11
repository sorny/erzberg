/**
 * The scale bar and the north arrow, over the viewport.
 *
 * A DOM overlay, positioned exactly like `FrameOverlay` — and unlike it, this
 * one is *ink*. The frame is a composition aid that deliberately cannot reach
 * either exporter; these two marks are part of the plate, and the PNG
 * compositor and the SVG writer draw the same shapes from the same layout
 * function. See utils/sheetMarks.js.
 *
 * It works in CSS pixels, which is what `Scene` measured the scale in. The two
 * exporters measure again in their own pixels, because a 4× plate has four times
 * as many pixels per metre and a bar laid out against the screen would come out
 * a quarter of its length.
 *
 * Silent when there is nothing honest to say. A PNG heightmap carries no
 * georeference, so `mapScale` is null and no bar is drawn however the switch is
 * set — the panel says why rather than this drawing a number it invented.
 */
import { useEffect, useState } from 'react'
import { frameRect, paperAspect } from '../utils/frame'
import { sheetMarks } from '../utils/sheetMarks'
import { useStore } from '../store/useStore'

export function SheetMarks({ view, rightInset = 0 }) {
  const scale = useStore((s) => s.mapScale)
  const [win, setWin] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))

  useEffect(() => {
    const onResize = () => setWin({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const bar = !!view.frameScaleBar, north = !!view.frameNorth
  if ((!bar && !north) || !scale) return null

  const w = win.w - rightInset, h = win.h
  const marks = sheetMarks({
    width: w, height: h,
    frame: view.showFrame
      ? frameRect(w, h,
        paperAspect(view.framePaper ?? 'iso', !!view.frameLandscape, view.frameCustomRatio),
        view.frameScale ?? 0.85, view.frameOffsetX ?? 0, view.frameOffsetY ?? 0)
      : null,
    metresPerPixel: scale.metresPerPixel, northAngle: scale.northAngle,
    bar, north, scale: view.frameMarkScale ?? 1,
  })
  if (!marks) return null

  const ink = view.frameMarkColor ?? '#000000'
  const stroke = Math.max(0.5, (marks.texts[0]?.size ?? 12) * 0.08)

  return (
    <div data-testid="sheet-marks"
         style={{ position:'fixed', top:0, left:0, bottom:0, right: rightInset,
                  pointerEvents:'none', zIndex: 501 }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display:'block' }}>
        {marks.rects.map(([x, y, rw, rh], i) => (
          <rect key={`r${i}`} x={x} y={y} width={rw} height={rh} fill={ink} />
        ))}
        {marks.lines.map(([x0, y0, x1, y1], i) => (
          <line key={`l${i}`} x1={x0} y1={y0} x2={x1} y2={y1} stroke={ink} strokeWidth={stroke} />
        ))}
        {marks.texts.map((t, i) => (
          <text key={`t${i}`} x={t.x} y={t.y} fill={ink} fontSize={t.size}
                fontFamily="sans-serif" textAnchor={t.anchor}>{t.text}</text>
        ))}
      </svg>
    </div>
  )
}
