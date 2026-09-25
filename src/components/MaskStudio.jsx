/**
 * Mask Studio — drawing a stencil by hand, over the ground it is about.
 *
 * Edit Mode answers "which part of this raster is the picture". This answers a
 * different question — "which part of the picture does *this layer* draw on" —
 * and the two are deliberately separate views rather than two modes of one. A
 * clip changes the raster for everything; a mask changes one layer and leaves
 * the rest alone. Sharing a window would mean every gesture had to say which it
 * meant.
 *
 * ── Why the imagery matters ──────────────────────────────────────────────────
 * A mask drawn over a grey hillshade is a guess. You are trying to say "the
 * worked ground, not the forest" or "this side of the ridge", and those are
 * distinctions you can see in a satellite picture and largely cannot see in
 * shaded relief. So the backdrop is the Sentinel-2 drape when one has been
 * fetched, and the hillshade when it has not — the same view either way, with
 * more or less to go on.
 *
 * ── What is drawn, and where it lives ────────────────────────────────────────
 * One plane of bits at the *source* raster's size. The brush writes into it
 * directly — no undo stack of its own, because the app's history already
 * snapshots the mask list and a stroke is a step like any other.
 *
 * The canvas is drawn at source resolution and scaled by the view transform, so
 * a stroke lands on the pixel the pointer is over at any zoom. `image-rendering`
 * stays pixelated for the mask overlay, because a mask has no intermediate
 * value and a smoothed edge would show a boundary that is not there.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fillAll, invert, stamp, stroke } from '../utils/maskLayers'
import { MaskPanel } from './MaskPanel'
import { BORDER, MUTED, SURF } from './panel/ui'
import { useBackdrop } from '../hooks/useBackdrop'

/** Tools, and the one letter each answers to. The panel draws the buttons;
 *  this is only the keyboard map. */
const STUDIO_TOOLS = [
  ['brush', 'Brush', 'B'],
  ['rect', 'Rectangle', 'R'],
  ['ellipse', 'Ellipse', 'O'],
  ['lasso', 'Lasso', 'L'],
]

const MIN_BRUSH = 1
const MAX_BRUSH = 400

export function MaskStudio({
  srcPixels, srcMask, srcWidth, srcHeight,
  imagery, tone, mask, onCommit, onClose, rightInset = 0,
  backdrop = 'auto', setBackdrop,
  style, ss,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 })
  const dragRef = useRef(null)
  const hoverRef = useRef(null)
  const ringRef = useRef(null)
  const drawRef = useRef(() => {})
  const frameRef = useRef(0)
  const overlayRef = useRef(null)
  const dataRef = useRef(mask?.data ?? null)

  const [tool, setTool] = useState('brush')
  const [brush, setBrush] = useState(24)
  const [erase, setErase] = useState(false)
  const [, bump] = useState(0)

  dataRef.current = mask?.data ?? null

  // The same backdrop builder as Edit Mode, and the same choice. The imagery
  // is under the drape's own exposure: a boundary painted against one
  // exposure and checked against another would move.
  const { canvas: bg, hasPhoto } = useBackdrop({
    srcPixels, srcMask, srcWidth, srcHeight, imagery, tone, choice: backdrop,
  })

  /*
   * The mask wash, kept as one canvas and patched in place.
   *
   * It used to be rebuilt from the whole plane on every draw, and a draw ran on
   * every pointer move — hover included. On a 3804 × 2558 raster that was a
   * 39 MB allocation and a full-raster loop per move, about 20 ms, and the brush
   * ring (which is the cursor here) trailed the pointer. Now a stroke rewrites
   * only the brush's bounding box.
   */
  const rebuildOverlay = useCallback(() => {
    const plane = dataRef.current
    if (!plane || !srcWidth || !srcHeight) { overlayRef.current = null; return }
    let o = overlayRef.current
    if (!o || o.canvas.width !== srcWidth || o.canvas.height !== srcHeight) {
      const canvas = document.createElement('canvas')
      canvas.width = srcWidth; canvas.height = srcHeight
      const ctx = canvas.getContext('2d')
      o = { canvas, ctx, img: ctx.createImageData(srcWidth, srcHeight) }
      overlayRef.current = o
    }
    o.rgb = hexRgb(mask?.color)
    paintOverlay(o, plane, srcWidth, 0, 0, srcWidth - 1, srcHeight - 1)
  }, [srcWidth, srcHeight, mask?.color])

  // A new plane (import, copy, another mask) or a new colour repaints it all.
  useEffect(() => { rebuildOverlay(); drawRef.current() }, [rebuildOverlay, mask?.data])

  /** Repaint the overlay inside a box of image pixels, after a brush stamp. */
  const patchOverlay = (x0, y0, x1, y1) => {
    const o = overlayRef.current, plane = dataRef.current
    if (!o || !plane) return
    const ax = Math.max(0, Math.floor(Math.min(x0, x1))), bx = Math.min(srcWidth - 1, Math.ceil(Math.max(x0, x1)))
    const ay = Math.max(0, Math.floor(Math.min(y0, y1))), by = Math.min(srcHeight - 1, Math.ceil(Math.max(y0, y1)))
    if (bx >= ax && by >= ay) paintOverlay(o, plane, srcWidth, ax, ay, bx, by)
  }

  // ── View transform ─────────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap || !srcWidth || !srcHeight) return
    const { width, height } = wrap.getBoundingClientRect()
    const scale = Math.min(width / srcWidth, height / srcHeight) * 0.9
    viewRef.current = {
      scale,
      ox: (width - srcWidth * scale) / 2,
      oy: (height - srcHeight * scale) / 2,
    }
    drawRef.current()
  }, [srcWidth, srcHeight])

  const toImage = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    const { scale, ox, oy } = viewRef.current
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale }
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !srcWidth) return
    const { width, height } = wrap.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const { scale, ox, oy } = viewRef.current
    ctx.imageSmoothingEnabled = false
    ctx.save()
    ctx.translate(ox, oy)
    ctx.scale(scale, scale)

    if (bg) ctx.drawImage(bg, 0, 0, srcWidth, srcHeight)

    // The mask itself, as a wash in its own colour. Composited rather than
    // drawn opaque so the ground stays readable underneath it — you are aiming
    // at what is in the picture, not at the paint.
    const overlay = overlayRef.current
    if (overlay && dataRef.current) {
      ctx.globalAlpha = 0.45
      ctx.drawImage(overlay.canvas, 0, 0, srcWidth, srcHeight)
      ctx.globalAlpha = 1
    }
    ctx.restore()

    // The gesture in progress, in screen space so its stroke stays one pixel
    // wide however far the view is zoomed in.
    const d = dragRef.current
    if (d && d.preview) {
      ctx.strokeStyle = mask?.color ?? '#ffffff'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      if (d.tool === 'rect') {
        const a = toScreen(d.from), b = toScreen(d.to)
        ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
      } else if (d.tool === 'ellipse') {
        const a = toScreen(d.from), b = toScreen(d.to)
        ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2,
          Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
      } else if (d.tool === 'lasso' && d.points.length > 1) {
        const p0 = toScreen(d.points[0])
        ctx.moveTo(p0.x, p0.y)
        for (const pt of d.points.slice(1)) { const s = toScreen(pt); ctx.lineTo(s.x, s.y) }
        ctx.closePath()
      }
      ctx.stroke()
      ctx.setLineDash([])
    }

    placeRing()

    function toScreen(pt) {
      const v = viewRef.current
      return { x: pt.x * v.scale + v.ox, y: pt.y * v.scale + v.oy }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcWidth, srcHeight, bg, mask, tool, brush, erase])

  drawRef.current = draw

  /** At most one full redraw per frame, however many pointer events arrive. */
  const requestDraw = () => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => { frameRef.current = 0; drawRef.current() })
  }
  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  /*
   * The brush ring is the cursor in brush mode, so it must never wait for a
   * canvas redraw. It is a DOM circle moved by a transform, which the
   * compositor handles on its own.
   */
  function placeRing() {
    const el = ringRef.current
    if (!el) return
    const pt = hoverRef.current
    if (tool !== 'brush' || !pt) { el.style.display = 'none'; return }
    const v = viewRef.current
    const r = brush * v.scale
    el.style.display = 'block'
    el.style.width = el.style.height = `${2 * r}px`
    el.style.transform = `translate(${pt.x * v.scale + v.ox - r}px, ${pt.y * v.scale + v.oy - r}px)`
    el.style.borderColor = erase ? '#ff6b6b' : '#ffffff'
  }

  useEffect(() => { fit() }, [fit])
  useEffect(() => { draw() })
  useEffect(() => {
    const onResize = () => fit()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fit])

  // ── Gestures ───────────────────────────────────────────────────────────────
  const commit = () => { onCommit?.(); bump((n) => n + 1) }

  const onDown = (e) => {
    // Alt is the pan modifier and outranks every tool, exactly as it does in
    // Edit Mode. Middle-drag too, because a trackpad has no comfortable Alt.
    if (e.altKey || e.button === 1) {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      dragRef.current = { tool: 'pan', sx: e.clientX, sy: e.clientY,
                          ox: viewRef.current.ox, oy: viewRef.current.oy }
      return
    }
    if (!dataRef.current || e.button !== 0) return
    const pt = toImage(e)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (tool === 'brush') {
      dragRef.current = { tool, last: pt }
      stamp(dataRef.current, srcWidth, srcHeight, pt.x, pt.y, brush, erase)
      patchOverlay(pt.x - brush, pt.y - brush, pt.x + brush, pt.y + brush)
      requestDraw()
    } else if (tool === 'lasso') {
      dragRef.current = { tool, points: [pt], preview: true }
    } else {
      dragRef.current = { tool, from: pt, to: pt, preview: true }
    }
  }

  const onMove = (e) => {
    const d0 = dragRef.current
    if (d0?.tool === 'pan') {
      viewRef.current = { ...viewRef.current,
                          ox: d0.ox + (e.clientX - d0.sx), oy: d0.oy + (e.clientY - d0.sy) }
      requestDraw()
      return
    }
    const pt = toImage(e)
    hoverRef.current = pt
    placeRing()
    const d = dragRef.current
    if (!d) return   // a hover moves the ring and nothing else
    if (dataRef.current) {
      if (d.tool === 'brush') {
        stroke(dataRef.current, srcWidth, srcHeight, d.last.x, d.last.y, pt.x, pt.y, brush, erase)
        patchOverlay(Math.min(d.last.x, pt.x) - brush, Math.min(d.last.y, pt.y) - brush,
                     Math.max(d.last.x, pt.x) + brush, Math.max(d.last.y, pt.y) + brush)
        d.last = pt
      } else if (d.tool === 'lasso') {
        const prev = d.points[d.points.length - 1]
        // One point per few pixels of travel: a pointer reports far more than a
        // polygon needs, and every extra vertex costs a crossing test per row.
        if (Math.hypot(pt.x - prev.x, pt.y - prev.y) > 2) d.points.push(pt)
      } else {
        d.to = pt
      }
    }
    requestDraw()
  }

  const onUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.tool === 'pan') { draw(); return }
    if (!d || !dataRef.current) { draw(); return }
    if (d.tool !== 'brush') { fillShape(dataRef.current, srcWidth, srcHeight, d, erase); rebuildOverlay() }
    commit()
    draw()
  }

  /**
   * Zoom about the cursor: the image point under it must not move.
   *
   * The same curve and the same 0.02–64 clamp as Edit Mode. A mask is painted
   * against a boundary in a photograph, and a boundary a person is willing to
   * trace by hand is routinely a few raster pixels wide — fit-to-window is the
   * one zoom at which that work cannot be done.
   */
  const onWheel = (e) => {
    e.preventDefault()
    const r = canvasRef.current.getBoundingClientRect()
    const v = viewRef.current
    const k = Math.exp(-e.deltaY * 0.0015)
    const scale = Math.max(0.02, Math.min(64, v.scale * k))
    const cx = e.clientX - r.left, cy = e.clientY - r.top
    viewRef.current = {
      scale,
      ox: cx - (cx - v.ox) * (scale / v.scale),
      oy: cy - (cy - v.oy) * (scale / v.scale),
    }
    requestDraw()
  }

  // ── Keys ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return
      const k = e.key.toLowerCase()
      if (k === 'escape') { onClose?.(); return }
      const hit = STUDIO_TOOLS.find(([, , key]) => key.toLowerCase() === k)
      if (hit) { setTool(hit[0]); e.preventDefault(); return }
      if (k === 'e') { setErase((v) => !v); e.preventDefault() }
      if (k === '[') { setBrush((b) => Math.max(MIN_BRUSH, Math.round(b * 0.8))); e.preventDefault() }
      if (k === ']') { setBrush((b) => Math.min(MAX_BRUSH, Math.round(b * 1.25) + 1)); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div ref={wrapRef} data-testid="mask-studio"
      style={{
        position: 'absolute', inset: 0, right: rightInset,
        background: '#0b0d10', overflow: 'hidden', zIndex: 20,
      }}>
      <canvas ref={canvasRef}
        onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => { hoverRef.current = null; placeRing() }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        style={{ display: 'block', cursor: tool === 'brush' ? 'none' : 'crosshair', touchAction: 'none' }} />
      <div ref={ringRef} aria-hidden="true" style={{
        position: 'absolute', left: 0, top: 0, display: 'none', pointerEvents: 'none',
        border: '1.2px solid #ffffff', borderRadius: '50%', boxSizing: 'border-box',
        willChange: 'transform',
      }} />

      {/* Hints + view controls, in the same corner and the same shape as Edit
          Mode's. The two views are the same kind of thing and now say so. */}
      <div style={{
        position: 'absolute', left: 14, bottom: 14, display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: 'system-ui,sans-serif', fontSize: 11, color: MUTED,
      }}>
        <button onClick={fit} data-testid="studio-fit" style={{
          background: SURF, color: '#d4d4d8', border: `1px solid ${BORDER}`,
          borderRadius: 5, padding: '5px 10px', fontSize: 11, cursor: 'pointer',
        }}>Fit</button>
        <span style={{ background: 'rgba(0,0,0,.45)', padding: '5px 9px', borderRadius: 5 }}>
          {srcWidth}×{srcHeight} px
          {' · '}
          {tool === 'brush'   && 'drag to paint · [ and ] resize'}
          {tool === 'rect'    && 'drag a rectangle'}
          {tool === 'ellipse' && 'drag an ellipse'}
          {tool === 'lasso'   && 'drag to trace · it closes itself'}
          {' · alt-drag to pan · scroll to zoom'}
        </span>
      </div>

      <MaskPanel
        mask={mask} srcWidth={srcWidth} srcHeight={srcHeight}
        tool={tool} setTool={setTool}
        brush={brush} setBrush={setBrush}
        erase={erase} setErase={setErase}
        backdrop={backdrop} setBackdrop={setBackdrop}
        hasPhoto={hasPhoto} imagery={imagery}
        style={style} ss={ss}
        onFill={() => { if (dataRef.current) { fillAll(dataRef.current, 1); rebuildOverlay(); commit(); draw() } }}
        onInvert={() => { if (dataRef.current) { invert(dataRef.current); rebuildOverlay(); commit(); draw() } }}
        onClear={() => { if (dataRef.current) { fillAll(dataRef.current, 0); rebuildOverlay(); commit(); draw() } }}
        onDone={onClose}
      />
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexRgb(color) {
  const n = parseInt((color ?? '#ffffff').slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Write the plane into the overlay inside [x0..x1] × [y0..y1] and upload that box. */
function paintOverlay(o, plane, width, x0, y0, x1, y1) {
  const d = o.img.data
  const [r, g, b] = o.rgb
  for (let y = y0; y <= y1; y++) {
    for (let x = x0, i = y * width + x0; x <= x1; x++, i++) {
      const k = i * 4
      if (plane[i]) { d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255 } else d[k + 3] = 0
    }
  }
  o.ctx.putImageData(o.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
}

/** Rasterise a finished rect, ellipse or lasso into the plane. */
function fillShape(plane, width, height, d, erase) {
  const value = erase ? 0 : 1
  if (d.tool === 'rect') {
    const x0 = Math.max(0, Math.floor(Math.min(d.from.x, d.to.x)))
    const x1 = Math.min(width - 1, Math.ceil(Math.max(d.from.x, d.to.x)))
    const y0 = Math.max(0, Math.floor(Math.min(d.from.y, d.to.y)))
    const y1 = Math.min(height - 1, Math.ceil(Math.max(d.from.y, d.to.y)))
    for (let y = y0; y <= y1; y++) plane.fill(value, y * width + x0, y * width + x1 + 1)
    return
  }
  if (d.tool === 'ellipse') {
    const cx = (d.from.x + d.to.x) / 2, cy = (d.from.y + d.to.y) / 2
    const rx = Math.abs(d.to.x - d.from.x) / 2, ry = Math.abs(d.to.y - d.from.y) / 2
    if (rx < 0.5 || ry < 0.5) return
    const y0 = Math.max(0, Math.ceil(cy - ry)), y1 = Math.min(height - 1, Math.floor(cy + ry))
    for (let y = y0; y <= y1; y++) {
      // Solve the ellipse for x on this row rather than testing every cell in
      // the bounding box, the same way Edit Mode fills one.
      const t = 1 - ((y - cy) / ry) ** 2
      if (t <= 0) continue
      const half = rx * Math.sqrt(t)
      const x0 = Math.max(0, Math.ceil(cx - half)), x1 = Math.min(width - 1, Math.floor(cx + half))
      if (x1 >= x0) plane.fill(value, y * width + x0, y * width + x1 + 1)
    }
    return
  }
  if (d.tool === 'lasso' && d.points.length >= 3) {
    // Even-odd scanline, the same shape as the fill in heightmapEdit.js. Kept
    // here rather than shared because that one writes a selection mask with a
    // feather weight and this writes one bit.
    const pts = d.points
    const xs = new Float64Array(pts.length)
    for (let y = 0; y < height; y++) {
      const yc = y + 0.5
      let count = 0
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const yi = pts[i].y, yj = pts[j].y
        if ((yi > yc) === (yj > yc)) continue
        xs[count++] = pts[i].x + ((yc - yi) / (yj - yi)) * (pts[j].x - pts[i].x)
      }
      if (count < 2) continue
      const spans = xs.subarray(0, count)
      spans.sort()
      for (let k = 0; k + 1 < count; k += 2) {
        const x0 = Math.max(0, Math.ceil(spans[k] - 0.5))
        const x1 = Math.min(width - 1, Math.floor(spans[k + 1] - 0.5))
        if (x1 >= x0) plane.fill(value, y * width + x0, y * width + x1 + 1)
      }
    }
  }
}
