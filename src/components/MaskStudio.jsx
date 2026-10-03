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
 * directly. The app's history does not hold mask planes, so the Studio keeps
 * its own undo: a copy of the plane before each stroke, shape, Apply or
 * whole-mask action, the last UNDO_DEPTH of them. A copy is one byte per
 * pixel, so ten on an 8k raster are a few hundred megabytes at worst and a few
 * megabytes on an ordinary one.
 *
 * The canvas is drawn at source resolution and scaled by the view transform, so
 * a stroke lands on the pixel the pointer is over at any zoom. `image-rendering`
 * stays pixelated for the mask overlay, because a mask has no intermediate
 * value and a smoothed edge would show a boundary that is not there.
 *
 * ── Regions the app can compute ──────────────────────────────────────────────
 * Two tools do not paint. Level takes the ground between two heights, and
 * Features takes the outline of loaded map features. Both preview live: while
 * their controls move, the wash shows the mask as Apply would leave it, after
 * Replace, Add, Subtract or Intersect. Apply writes it into the plane and is one
 * step of history, like a stroke.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { combineMask, fillAll, invert, stamp, stroke } from '../utils/maskLayers'
import { levelSource, thresholdLevel } from '../utils/maskFromLevel'
import { canMakeMask, maskFromFeatures } from '../utils/maskFromVector'
import { useFeaturePick } from './panel/FeaturePicker'
import { MaskPanel } from './MaskPanel'
import { useBackdrop } from '../hooks/useBackdrop'
import { DESK, FONT, GLASS_BG, GLASS_BORDER, GLASS_TEXT, TEXT, VEIL } from './panel/ui'
import { THEME_EVENT } from '../utils/theme'

/** Tools, and the one letter each answers to. The panel draws the buttons;
 *  this is only the keyboard map. */
const STUDIO_TOOLS = [
  ['brush', 'Brush', 'B'],
  ['rect', 'Rectangle', 'R'],
  ['ellipse', 'Ellipse', 'O'],
  ['lasso', 'Lasso', 'L'],
  ['level', 'Level', 'H'],
  ['features', 'Features', 'F'],
]

/** The tools that compute a region instead of painting one. */
const REGION_TOOLS = new Set(['level', 'features'])

/** A mask that still has its default name takes the region's name on Replace. */
const DEFAULT_NAME = /^Mask \d+$/

const UNDO_DEPTH = 10

const MIN_BRUSH = 1
const MAX_BRUSH = 400

export function MaskStudio({
  srcPixels, srcMask, srcWidth, srcHeight,
  imagery, tone, mask, onCommit, onClose, rightInset = 0,
  backdrop = 'auto', setBackdrop,
  style, ss,
  vectorLayers = [], vectorSources = [], featureRaster, elevMin, elevMax,
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
  const [rev, bump] = useState(0)

  dataRef.current = mask?.data ?? null

  // ── Undo ───────────────────────────────────────────────────────────────────
  // Per mask: opening another one starts a fresh history.
  const undoRef = useRef({ id: null, past: [], future: [] })
  if (undoRef.current.id !== mask?.id) undoRef.current = { id: mask?.id, past: [], future: [] }
  /** Keep a copy of the plane as it is now, before a change. */
  const remember = () => {
    const plane = dataRef.current
    if (!plane) return
    const h = undoRef.current
    h.past.push(plane.slice())
    if (h.past.length > UNDO_DEPTH) h.past.shift()
    h.future = []
  }

  // ── Computed regions ───────────────────────────────────────────────────────
  const regionTool = REGION_TOOLS.has(tool)
  const [level, setLevel] = useState({ lo: 0.5, hi: 1, smooth: 2 })
  const [combine, setCombine] = useState('replace')
  const [dist, setDist] = useState(0)
  const [fillClosed, setFillClosed] = useState(true)
  const pick = useFeaturePick(vectorLayers, vectorSources)

  const metres = elevMin != null && elevMax != null
  const fmtLevel = useCallback((v) => (metres
    ? `${Math.round(elevMin + v * (elevMax - elevMin))} m`
    : `${Math.round(v * 100)} %`), [metres, elevMin, elevMax])

  // The blur is the slow half of a level mask, so it runs once per Smooth
  // value. A drag of From or To is then one pass over the raster.
  const heights = useMemo(
    () => (tool === 'level' && srcPixels
      ? levelSource(srcPixels, srcMask, srcWidth, srcHeight, level.smooth)
      : null),
    [tool, srcPixels, srcMask, srcWidth, srcHeight, level.smooth])

  const fBbox = featureRaster?.bbox, fCrs = featureRaster?.crs
  const raster = useMemo(() => ({ bbox: fBbox, crs: fCrs, width: srcWidth, height: srcHeight }),
    [fBbox, fCrs, srcWidth, srcHeight])
  const { chosen, bucket, closes, picked } = pick
  const geom = chosen?.geom ?? 'area'
  const filling = geom === 'area' || (closes && fillClosed)
  const featureOk = Boolean(bucket && canMakeMask(bucket, raster))
  const pickedKey = [...picked].sort((a, b) => a - b).join(',')

  // Features rasterise far slower than a threshold, and the buffer is typed
  // digit by digit, so the preview waits for a short pause.
  const [featRegion, setFeatRegion] = useState(null)
  useEffect(() => {
    if (tool !== 'features' || !featureOk) return undefined
    const t = setTimeout(() => {
      setFeatRegion(maskFromFeatures(bucket, raster, {
        geom: bucket.geom, hidden: chosen.hidden,
        only: pickedKey ? pickedKey.split(',').map(Number) : [],
        ...(closes ? { fill: fillClosed } : null),
        ...(filling ? { grow: dist } : { widthM: Math.max(1, dist || 25) }),
      }))
    }, 120)
    return () => clearTimeout(t)
  }, [tool, featureOk, bucket, raster, chosen, pickedKey, closes, fillClosed, filling, dist])

  // The mask as Apply would leave it. Written into two reused buffers, because
  // a slider drag asks for it on every move and a raster is megabytes.
  const buffers = useRef({ region: null, result: null })
  const preview = useMemo(() => {
    const base = mask?.data
    if (!regionTool || !base) return null
    const b = buffers.current
    let region = null
    if (tool === 'level' && heights) {
      region = thresholdLevel(heights, srcMask, level.lo, level.hi, b.region).data
      b.region = region
    } else if (tool === 'features' && featureOk && featRegion?.length === base.length) {
      region = featRegion
    }
    if (!region) return null
    if (b.result?.length !== base.length) b.result = new Uint8Array(base.length)
    const on = combineMask(b.result, base, region, combine)
    return { data: b.result, on }
    // `rev` is here because Apply changes the plane's bytes, not its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionTool, tool, heights, srcMask, level.lo, level.hi, featureOk, featRegion, combine, mask?.data, rev])
  const previewRef = useRef(null)
  previewRef.current = preview

  const regionName = () => (tool === 'level'
    ? `Level ${fmtLevel(Math.min(level.lo, level.hi)).replace(/ (m|%)$/, '')}–${fmtLevel(Math.max(level.lo, level.hi))}`
    : pick.label)

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
    const plane = previewRef.current?.data ?? dataRef.current
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
  // A preview repaints it too, and so does leaving a region tool.
  useEffect(() => { rebuildOverlay(); drawRef.current() }, [rebuildOverlay, preview])

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
    const redraw = () => drawRef.current()
    window.addEventListener(THEME_EVENT, redraw)
    return () => window.removeEventListener(THEME_EVENT, redraw)
  }, [])
  useEffect(() => {
    const onResize = () => fit()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fit])

  // ── Gestures ───────────────────────────────────────────────────────────────
  const commit = (patch) => { onCommit?.(patch); bump((n) => n + 1) }

  /** Write the previewed result into the plane, as one step of history. */
  const apply = () => {
    const plane = dataRef.current
    if (!plane || !preview) return
    remember()
    plane.set(preview.data)
    const name = combine === 'replace' && DEFAULT_NAME.test(mask.name) ? regionName() : ''
    commit(name ? { name } : undefined)
  }

  /**
   * Leave the Studio, keeping what the wash shows.
   *
   * A Level or Features preview looks exactly like the mask, so closing on one
   * and getting the old mask back reads as the Studio losing work: strokes are
   * kept without a button, and a person reasonably expects this to be kept too.
   * So a preview that differs from the mask is applied first, as one undoable
   * step. Switching to another tool still drops it, and the wash shows that.
   */
  const close = () => {
    const plane = dataRef.current
    if (plane && preview && !samePlane(plane, preview.data)) apply()
    onClose?.()
  }
  const closeRef = useRef(close)
  closeRef.current = close

  /** Step the plane back (or forward) one change. The name stays as it is. */
  const step = (back) => {
    const plane = dataRef.current, h = undoRef.current
    const from = back ? h.past : h.future, to = back ? h.future : h.past
    if (!plane || !from.length) return
    to.push(plane.slice())
    plane.set(from.pop())
    rebuildOverlay()
    commit()
    drawRef.current()
  }
  /** One whole-mask action, remembered first. */
  const whole = (fn) => {
    if (!dataRef.current) return
    remember(); fn(dataRef.current); rebuildOverlay(); commit(); draw()
  }

  const onDown = (e) => {
    // Alt is the pan modifier and outranks every tool, exactly as it does in
    // Edit Mode. Middle-drag too, because a trackpad has no comfortable Alt.
    if (e.altKey || e.button === 1) {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      dragRef.current = { tool: 'pan', sx: e.clientX, sy: e.clientY,
                          ox: viewRef.current.ox, oy: viewRef.current.oy }
      return
    }
    if (!dataRef.current || e.button !== 0 || regionTool) return
    const pt = toImage(e)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (tool === 'brush') {
      remember()
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
        // Shift makes the ellipse a circle, as it does in Edit Mode.
        d.to = e.shiftKey && d.tool === 'ellipse' ? squareFrom(d.from, pt) : pt
      }
    }
    requestDraw()
  }

  const onUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.tool === 'pan') { draw(); return }
    if (!d || !dataRef.current) { draw(); return }
    if (d.tool !== 'brush') { remember(); fillShape(dataRef.current, srcWidth, srcHeight, d, erase); rebuildOverlay() }
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

  const stepRef = useRef(step)
  stepRef.current = step

  // ── Keys ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        e.preventDefault()
        stepRef.current(e.code === 'KeyZ' && !e.shiftKey)
        return
      }
      if (e.metaKey || e.ctrlKey) return
      if (k === 'escape') { closeRef.current(); return }
      const hit = STUDIO_TOOLS.find(([, , key]) => key.toLowerCase() === k)
      if (hit) { setTool(hit[0]); e.preventDefault(); return }
      if (k === 'e') { setErase((v) => !v); e.preventDefault() }
      if (k === '[') { setBrush((b) => Math.max(MIN_BRUSH, Math.round(b * 0.8))); e.preventDefault() }
      if (k === ']') { setBrush((b) => Math.min(MAX_BRUSH, Math.round(b * 1.25) + 1)); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div ref={wrapRef} data-testid="mask-studio"
      style={{
        position: 'absolute', inset: 0, right: rightInset,
        background: DESK, overflow: 'hidden', zIndex: 20,
      }}>
      <canvas ref={canvasRef}
        onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={onUp} onPointerCancel={onUp}
        onPointerLeave={() => { hoverRef.current = null; placeRing() }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        style={{ display: 'block', touchAction: 'none',
                 cursor: tool === 'brush' ? 'none' : regionTool ? 'default' : 'crosshair' }} />
      <div ref={ringRef} aria-hidden="true" style={{
        position: 'absolute', left: 0, top: 0, display: 'none', pointerEvents: 'none',
        border: '1.5px solid #ffffff', borderRadius: '50%', boxSizing: 'border-box',
        // A dark halo either side, so the ring reads on snow and on forest alike.
        boxShadow: '0 0 0 1px rgba(0,0,0,.45), inset 0 0 0 1px rgba(0,0,0,.35)',
        willChange: 'transform',
      }} />

      {/* Hints + view controls, in the same corner and the same shape as Edit
          Mode's. The two views are the same kind of thing and now say so. */}
      <div style={{
        position: 'absolute', left: 16, bottom: 16, display: 'flex', alignItems: 'center', gap: 2,
        padding: 3, borderRadius: 10, fontFamily: FONT, fontSize: 12, color: GLASS_TEXT,
        background: GLASS_BG, border: `1px solid ${GLASS_BORDER}`,
        backdropFilter: 'blur(14px) saturate(1.4)', WebkitBackdropFilter: 'blur(14px) saturate(1.4)',
        boxShadow: '0 8px 28px rgba(0,0,0,.28)',
      }}>
        <button onClick={fit} data-testid="studio-fit" style={{
          background: VEIL, color: TEXT, border: `1px solid ${GLASS_BORDER}`,
          borderRadius: 5, padding: '3px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        }}>Fit</button>
        <span style={{ padding: '3px 9px' }}>
          {srcWidth}×{srcHeight} px
          {' · '}
          {tool === 'brush'   && 'drag to paint · [ and ] resize'}
          {tool === 'rect'    && 'drag a rectangle'}
          {tool === 'ellipse' && 'drag an ellipse · shift for a circle'}
          {tool === 'lasso'   && 'drag to trace · it closes itself'}
          {tool === 'level'   && 'set the heights in the panel'}
          {tool === 'features' && 'pick the features in the panel'}
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
        onFill={() => whole((d) => fillAll(d, 1))}
        onInvert={() => whole(invert)}
        onClear={() => whole((d) => fillAll(d, 0))}
        onUndo={() => step(true)} onRedo={() => step(false)}
        canUndo={undoRef.current.past.length > 0} canRedo={undoRef.current.future.length > 0}
        onDone={close}
        region={{
          level, setLevel, fmtLevel, combine, setCombine,
          pick, dist, setDist, fillClosed, setFillClosed, filling, featureOk,
          preview, onApply: apply,
        }}
      />
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Whether two planes hold the same bits. */
function samePlane(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** The corner opposite `from` of the square that `pt` reaches furthest along. */
function squareFrom(from, pt) {
  const dx = pt.x - from.x, dy = pt.y - from.y
  const s = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: from.x + (dx < 0 ? -s : s), y: from.y + (dy < 0 ? -s : s) }
}

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
