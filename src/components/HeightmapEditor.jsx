/**
 * Edit Mode canvas — clipping the heightmap the way you would clip a picture.
 *
 * Deliberately 2D: the terrain is a raster, a crop is a rectangle in that
 * raster, and doing it flat means pointer positions *are* pixel coordinates
 * rather than the output of a raycast against a surface whose own height keeps
 * moving the answer.
 *
 * All selection state lives in source pixel coordinates, so it is independent of
 * zoom, window size and device pixel ratio. Drags are drawn imperatively from a
 * ref and only committed to React state on release: a lasso emits a point every
 * pointermove, and re-rendering the panel 60×/s to show a half-finished path is
 * work nobody sees.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { simplifyFlat } from '../utils/geometryBuilders'
import { effectiveBounds, isUsableShape } from '../utils/heightmapEdit'
import { ACCENT, BORDER, MUTED, SURF } from './panel/ui'

// Cap on the cached preview bitmap's long side. An 8k DEM downscaled to this is
// still far past what any screen shows, and holding the full raster as RGBA
// would be 256 MB for a picture nothing can resolve.
const MAX_PREVIEW = 2048
const HANDLE = 8          // handle hit radius / half-size, screen px
const MIN_RECT = 4        // smallest crop, source px
const VERTEX = 7          // vertex handle size, screen px
const TAU = Math.PI * 2

/** A ring of points, as opposed to an ellipse — the shapes whose vertices edit. */
const isPointShape = (s) => !!s && s.type !== 'ellipse' && s.points?.length >= 6

/** Tools that draw and edit rings of points. */
const POINT_TOOLS = new Set(['lasso', 'polygon'])

const HANDLES = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
  ['w', 0, 0.5],               ['e', 1, 0.5],
  ['sw', 0, 1], ['s', 0.5, 1], ['se', 1, 1],
]

/** The axis a box handle resizes along, as a cursor. */
const RESIZE_CURSOR = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n:  'ns-resize',   s:  'ns-resize',
  w:  'ew-resize',   e:  'ew-resize',
}

/**
 * The cursor for what a press would do — the whole point of `pick` returning a
 * named gesture rather than the drag state directly.
 *
 * A handle is only as discoverable as it is visible, and at 7–8 screen pixels
 * these are small targets sitting on a busy greyscale raster. The cursor is what
 * says "you have it" before the press, and which axis it will move along.
 * `grabbing` while the gesture runs is the usual grab/grabbing pair.
 */
function cursorFor(hit, dragging) {
  switch (hit.kind) {
    case 'vertex':                     return dragging ? 'grabbing' : 'grab'
    case 'edge':                       return 'copy'        // a press adds a vertex here
    case 'resize': case 'ellipse-resize': return RESIZE_CURSOR[hit.handle]
    case 'move':   case 'ellipse-move':   return dragging ? 'grabbing' : 'move'
    case 'close':                      return 'pointer'     // clicking closes the ring
    default:                           return 'crosshair'
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

/** Greyscale preview bitmap of the source raster, stretched to its own range. */
function buildPreview(pixels, mask, w, h) {
  if (!pixels || !w || !h) return null
  const step = Math.max(1, Math.ceil(Math.max(w, h) / MAX_PREVIEW))
  const pw = Math.max(1, Math.floor(w / step))
  const ph = Math.max(1, Math.floor(h / step))

  let min = Infinity, max = -Infinity
  for (let i = 0; i < pixels.length; i++) {
    if (mask && !mask[i]) continue
    const v = pixels[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!isFinite(min) || max <= min) { min = 0; max = 1 }
  const inv = 255 / (max - min)

  const cv = document.createElement('canvas')
  cv.width = pw; cv.height = ph
  const ctx = cv.getContext('2d')
  const img = ctx.createImageData(pw, ph)
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(h - 1, y * step)
    for (let x = 0; x < pw; x++) {
      const si = sy * w + Math.min(w - 1, x * step)
      const o = (y * pw + x) * 4
      if (mask && !mask[si]) { img.data[o + 3] = 0; continue }
      const g = clamp(Math.round((pixels[si] - min) * inv), 0, 255)
      img.data[o] = g; img.data[o + 1] = g; img.data[o + 2] = g; img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

export function HeightmapEditor({
  srcPixels, srcMask, srcWidth, srcHeight,
  edit, onChange,
  tool, aspect,
  rightInset = 0,
  keysRef,
}) {
  const wrapRef   = useRef(null)
  const canvasRef = useRef(null)
  const viewRef   = useRef({ scale: 1, ox: 0, oy: 0 })
  const editRef   = useRef(edit)
  const dragRef   = useRef(null)     // { mode, … } while a gesture is running
  const polyRef   = useRef(null)     // in-progress polygon vertices
  const hoverRef  = useRef(null)     // cursor position in source px
  const drawRef   = useRef(() => {})

  editRef.current = edit

  const preview = useMemo(
    () => buildPreview(srcPixels, srcMask, srcWidth, srcHeight),
    [srcPixels, srcMask, srcWidth, srcHeight],
  )

  // ── View transform ─────────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap || !srcWidth || !srcHeight) return
    const { width, height } = wrap.getBoundingClientRect()
    const scale = Math.min(width / srcWidth, height / srcHeight) * 0.88
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
    const canvas = canvasRef.current, wrap = wrapRef.current
    if (!canvas || !wrap) return
    const { width, height } = wrap.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const { scale, ox, oy } = viewRef.current
    const sx = (ix) => ox + ix * scale
    const sy = (iy) => oy + iy * scale

    // Raster
    ctx.fillStyle = '#0b0b0d'
    ctx.fillRect(sx(0), sy(0), srcWidth * scale, srcHeight * scale)
    if (preview) {
      ctx.imageSmoothingEnabled = scale < 1
      ctx.drawImage(preview, sx(0), sy(0), srcWidth * scale, srcHeight * scale)
    }

    const ed = editRef.current
    const rect = ed?.rect ?? { x: 0, y: 0, w: srcWidth, h: srcHeight }
    const drawingPts = polyRef.current
    const drawingPoly = !!drawingPts
    const shape = !drawingPoly && isUsableShape(ed?.shape) ? ed.shape : null
    const ellipse = shape?.type === 'ellipse' ? shape : null
    const ring = shape && !ellipse ? shape.points : null
    // The path being drawn right now, whichever kind it is.
    const poly = drawingPts ?? ring

    // Sub-path builders, deliberately *without* beginPath: the dim passes below
    // need the selection and a full-canvas rectangle in one path to fill the
    // ring between them with the even-odd rule.
    const addPoly = (pts) => {
      ctx.moveTo(sx(pts[0]), sy(pts[1]))
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(sx(pts[i]), sy(pts[i + 1]))
      ctx.closePath()
    }
    const addRect = () => ctx.rect(sx(rect.x), sy(rect.y), rect.w * scale, rect.h * scale)
    const addEllipse = (el) => ctx.ellipse(sx(el.cx), sy(el.cy), el.rx * scale, el.ry * scale, 0, 0, TAU)
    /** The committed shape if there is one, otherwise the crop rectangle. */
    const addSelection = () => {
      if (ellipse)   addEllipse(ellipse)
      else if (ring) addPoly(ring)
      else           addRect()
    }

    // Everything the clip throws away, dimmed. Two even-odd fills rather than a
    // real intersection: outside the crop first, then — inside the crop only —
    // outside the shape.
    const dim = 'rgba(9,9,11,0.72)'
    const hasShape = !!shape
    ctx.fillStyle = dim
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    addRect()
    ctx.fill('evenodd')

    if (hasShape) {
      ctx.save()
      ctx.beginPath(); addRect(); ctx.clip()
      ctx.fillStyle = dim
      ctx.beginPath()
      ctx.rect(0, 0, width, height)
      if (ellipse) addEllipse(ellipse); else addPoly(ring)
      ctx.fill('evenodd')
      ctx.restore()
    }

    // Feather band — a soft inner glow whose width is the feather radius.
    const feather = ed?.feather ?? 0
    if (feather > 0) {
      ctx.save()
      ctx.beginPath(); addSelection(); ctx.clip()
      ctx.strokeStyle = 'rgba(59,130,246,0.30)'
      ctx.lineWidth = feather * 2 * scale
      ctx.beginPath(); addSelection()
      ctx.stroke()
      ctx.restore()
    }

    // Crop frame + handles
    ctx.strokeStyle = tool === 'crop' ? '#ffffff' : 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 1.5
    ctx.beginPath(); addRect(); ctx.stroke()

    if (tool === 'crop') {
      // Thirds guides, the usual crop affordance.
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(sx(rect.x + (rect.w * i) / 3), sy(rect.y))
        ctx.lineTo(sx(rect.x + (rect.w * i) / 3), sy(rect.y + rect.h))
        ctx.moveTo(sx(rect.x), sy(rect.y + (rect.h * i) / 3))
        ctx.lineTo(sx(rect.x + rect.w), sy(rect.y + (rect.h * i) / 3))
      }
      ctx.stroke()

      ctx.fillStyle = '#ffffff'
      for (const [, fx, fy] of HANDLES) {
        const hx = sx(rect.x + rect.w * fx), hy = sy(rect.y + rect.h * fy)
        ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE)
      }
    }

    // Selection outline
    if (ellipse) {
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 1.5
      ctx.beginPath(); addEllipse(ellipse); ctx.stroke()
    } else if (poly && poly.length >= 4) {
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(sx(poly[0]), sy(poly[1]))
      for (let i = 2; i < poly.length; i += 2) ctx.lineTo(sx(poly[i]), sy(poly[i + 1]))
      if (drawingPoly && hoverRef.current) ctx.lineTo(sx(hoverRef.current.x), sy(hoverRef.current.y))
      if (!drawingPoly) ctx.closePath()
      ctx.stroke()

      if (drawingPoly) {
        ctx.fillStyle = ACCENT
        for (let i = 0; i < poly.length; i += 2) {
          ctx.fillRect(sx(poly[i]) - 2.5, sy(poly[i + 1]) - 2.5, 5, 5)
        }
        // The vertex that closes the ring, made obvious.
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(sx(poly[0]), sy(poly[1]), 6, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // Vertex handles — a committed ring stays editable, so a selection that came
    // out nearly right can be nudged instead of redrawn from scratch.
    if (ring && POINT_TOOLS.has(tool)) {
      const active = dragRef.current?.mode === 'vertex' ? dragRef.current.index : -1
      for (let i = 0; i < ring.length; i += 2) {
        const hx = sx(ring[i]), hy = sy(ring[i + 1])
        ctx.fillStyle = (i / 2) === active ? ACCENT : '#ffffff'
        ctx.fillRect(hx - VERTEX / 2, hy - VERTEX / 2, VERTEX, VERTEX)
        ctx.strokeStyle = 'rgba(0,0,0,.55)'
        ctx.lineWidth = 1
        ctx.strokeRect(hx - VERTEX / 2, hy - VERTEX / 2, VERTEX, VERTEX)
      }
    }

    // Ellipse handles — the bounding box, same eight grips as the crop.
    if (ellipse && tool === 'ellipse') {
      const bx = ellipse.cx - ellipse.rx, by = ellipse.cy - ellipse.ry
      const bw = ellipse.rx * 2, bh = ellipse.ry * 2
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.strokeRect(sx(bx), sy(by), bw * scale, bh * scale)
      ctx.setLineDash([])
      ctx.fillStyle = '#ffffff'
      for (const [, fx, fy] of HANDLES) {
        const hx = sx(bx + bw * fx), hy = sy(by + bh * fy)
        ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE)
      }
    }
  }, [preview, srcWidth, srcHeight, tool])

  drawRef.current = draw

  // Redraw whenever anything React-side changes.
  useEffect(() => { draw() }, [draw, edit])

  useEffect(() => {
    fit()
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { fit() })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [fit, rightInset])

  // Starting a new shape tool drops any half-finished one.
  useEffect(() => { polyRef.current = null; draw() }, [tool, draw])

  // ── Edit updates ───────────────────────────────────────────────────────────
  const commit = (patch) => {
    const base = editRef.current ?? { rect: { x: 0, y: 0, w: srcWidth, h: srcHeight }, shape: null, feather: 0 }
    const next = { ...base, ...patch }
    editRef.current = next
    onChange(next)
  }

  /**
   * Keeps a rect inside the raster, above the minimum size, and on-aspect.
   *
   * `fixRight`/`fixBottom` name the edge the gesture is *not* moving, so
   * dragging the west handle grows the rect leftwards instead of pushing the
   * whole thing east once the aspect lock resizes it.
   */
  const normalize = (r) => {
    let w = Math.max(MIN_RECT, r.w)
    let h = Math.max(MIN_RECT, r.h)
    if (aspect) {
      // Grow into whichever axis has room, so a locked drag never silently
      // shrinks the side the user is pulling.
      if (w / h > aspect) h = w / aspect
      else w = h * aspect
    }
    w = Math.min(w, srcWidth); h = Math.min(h, srcHeight)
    let x = r.fixRight  ? r.x + r.w - w : r.x
    let y = r.fixBottom ? r.y + r.h - h : r.y
    x = clamp(x, 0, srcWidth - w)
    y = clamp(y, 0, srcHeight - h)
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
  }

  /** Index of the vertex under the pointer, or -1. */
  const hitVertex = (p, pts) => {
    const tol = (VERTEX + 4) / viewRef.current.scale
    for (let i = 0; i < pts.length; i += 2) {
      if (Math.abs(p.x - pts[i]) <= tol && Math.abs(p.y - pts[i + 1]) <= tol) return i / 2
    }
    return -1
  }

  /**
   * Where on the ring the pointer is, for inserting a vertex: the closest point
   * on any edge, and the index it would be inserted before. The closing edge is
   * included, which is why the loop wraps.
   */
  const hitEdge = (p, pts) => {
    const tol = (VERTEX + 4) / viewRef.current.scale
    const n = pts.length / 2
    let best = null, bestD = tol
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const ax = pts[i * 2], ay = pts[i * 2 + 1]
      const bx = pts[j * 2], by = pts[j * 2 + 1]
      const dx = bx - ax, dy = by - ay
      const len2 = dx * dx + dy * dy
      if (len2 < 1e-9) continue
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2))
      const qx = ax + dx * t, qy = ay + dy * t
      const d = Math.hypot(p.x - qx, p.y - qy)
      if (d < bestD) { bestD = d; best = { after: i, x: qx, y: qy } }
    }
    return best
  }

  /** Replace the shape imperatively; commit happens on pointer-up. */
  const setShapeLive = (shape) => {
    editRef.current = { ...(editRef.current ?? { rect: { x: 0, y: 0, w: srcWidth, h: srcHeight }, feather: 0 }), shape }
    draw()
  }

  /** The ellipse a drag is building, from two corners of its bounding box. */
  const ellipseFromDrag = (a, b, circle) => {
    let w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
    if (circle) { const r = Math.max(w, h); w = r; h = r }
    const sxg = b.x < a.x ? -1 : 1
    const syg = b.y < a.y ? -1 : 1
    return { type: 'ellipse', cx: a.x + sxg * w / 2, cy: a.y + syg * h / 2, rx: w / 2, ry: h / 2 }
  }

  const hitHandle = (p, rect) => {
    const { scale } = viewRef.current
    const tol = (HANDLE + 3) / scale
    for (const [id, fx, fy] of HANDLES) {
      const hx = rect.x + rect.w * fx, hy = rect.y + rect.h * fy
      if (Math.abs(p.x - hx) <= tol && Math.abs(p.y - hy) <= tol) return id
    }
    return null
  }

  /**
   * What a left-press at `p` would start, as a named gesture plus whatever that
   * gesture needs to begin.
   *
   * Split out of `onPointerDown` because the cursor has to answer the same
   * question on every hover: two copies of this tree would drift, and a cursor
   * promising a grab where the press actually draws a new shape is worse than no
   * cursor at all. Shift is a parameter rather than read from a ref because it
   * changes the answer — inside an existing selection it forces a new one — and
   * must be re-read per event, not latched.
   */
  const pick = (p, shiftKey) => {
    const ed = editRef.current
    const shape = ed?.shape ?? null
    const rect = ed?.rect ?? { x: 0, y: 0, w: srcWidth, h: srcHeight }

    // An existing ring takes precedence over starting a new shape, so a selection
    // that came out nearly right can be adjusted in place rather than redrawn.
    if (POINT_TOOLS.has(tool) && !polyRef.current && isPointShape(shape)) {
      const index = hitVertex(p, shape.points)
      if (index >= 0) return { kind: 'vertex', index }
      const edge = hitEdge(p, shape.points)
      if (edge) return { kind: 'edge', edge }
    }

    if (tool === 'ellipse') {
      const el = shape?.type === 'ellipse' ? shape : null
      if (el) {
        const box = { x: el.cx - el.rx, y: el.cy - el.ry, w: el.rx * 2, h: el.ry * 2 }
        const handle = hitHandle(p, box)
        if (handle) return { kind: 'ellipse-resize', handle, box }
        const inside = ((p.x - el.cx) / el.rx) ** 2 + ((p.y - el.cy) / el.ry) ** 2 <= 1
        if (inside && !shiftKey) return { kind: 'ellipse-move', el }
      }
      return { kind: 'ellipse-new' }
    }

    if (tool === 'crop') {
      const handle = hitHandle(p, rect)
      if (handle) return { kind: 'resize', handle, rect }
      const inside = p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h
      // A rect still covering the whole raster has no "outside" to start a new
      // one from, so dragging inside it draws rather than moves — moving it
      // could not go anywhere anyway. Shift forces a new one at any size.
      const fullExtent = rect.x === 0 && rect.y === 0 && rect.w === srcWidth && rect.h === srcHeight
      if (inside && !fullExtent && !shiftKey) return { kind: 'move', rect }
      return { kind: 'new' }
    }

    if (tool === 'polygon') {
      const pts = polyRef.current
      if (pts && pts.length >= 6) {
        const d = Math.hypot(p.x - pts[0], p.y - pts[1]) * viewRef.current.scale
        if (d <= HANDLE + 4) return { kind: 'close' }
      }
      return { kind: 'polygon' }
    }

    return { kind: 'lasso' }
  }

  /** Cursor is written straight to the node: a hover must not re-render. */
  const setCursor = (c) => { if (canvasRef.current) canvasRef.current.style.cursor = c }

  // ── Pointer ────────────────────────────────────────────────────────────────
  const onPointerDown = (e) => {
    const shape = editRef.current?.shape ?? null

    // Right-click drops a vertex. Alt is already the pan modifier, so it cannot
    // also be the delete modifier.
    if (e.button === 2) {
      if (!polyRef.current && POINT_TOOLS.has(tool) && isPointShape(shape)) {
        const i = hitVertex(toImage(e), shape.points)
        // Three vertices are the fewest that still enclose anything.
        if (i >= 0 && shape.points.length > 6) {
          const points = [...shape.points]
          points.splice(i * 2, 2)
          commit({ shape: { ...shape, points } })
        }
      }
      return
    }
    if (e.button === 1 || e.altKey) {
      dragRef.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: viewRef.current.ox, oy: viewRef.current.oy }
      e.currentTarget.setPointerCapture(e.pointerId)
      setCursor('grabbing')
      return
    }
    if (e.button !== 0) return
    const p = toImage(e)
    e.currentTarget.setPointerCapture(e.pointerId)

    const hit = pick(p, e.shiftKey)
    setCursor(cursorFor(hit, true))

    switch (hit.kind) {
      // Grabbing a vertex moves it; grabbing an edge splits it and hands back
      // the new vertex already under the cursor — one gesture instead of two.
      case 'vertex':
        dragRef.current = { mode: 'vertex', index: hit.index, points: [...shape.points] }
        draw()
        return

      case 'edge': {
        const points = [...shape.points]
        points.splice((hit.edge.after + 1) * 2, 0, hit.edge.x, hit.edge.y)
        dragRef.current = { mode: 'vertex', index: hit.edge.after + 1, points }
        setShapeLive({ ...shape, points })
        return
      }

      case 'ellipse-resize': dragRef.current = { mode: 'ellipse-resize', handle: hit.handle, box: hit.box }; return
      case 'ellipse-move':   dragRef.current = { mode: 'ellipse-move', start: p, el: hit.el };               return
      case 'ellipse-new':    dragRef.current = { mode: 'ellipse-new', start: p };                            return
      case 'resize':         dragRef.current = { mode: 'resize', handle: hit.handle, start: p, rect: hit.rect }; return
      case 'move':           dragRef.current = { mode: 'move', start: p, rect: hit.rect };                   return
      case 'new':            dragRef.current = { mode: 'new', start: p };                                    return

      case 'lasso':
        polyRef.current = [clamp(p.x, 0, srcWidth), clamp(p.y, 0, srcHeight)]
        dragRef.current = { mode: 'lasso' }
        draw()
        return

      case 'close':
        closePolygon()
        return

      case 'polygon':
        polyRef.current = [...(polyRef.current ?? []), clamp(p.x, 0, srcWidth), clamp(p.y, 0, srcHeight)]
        draw()
        return
    }
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    const hover = toImage(e)
    hoverRef.current = hover

    if (!d) {
      // Hovering: say what a press would do. Alt is the pan modifier and outranks
      // whatever is underneath, since that is what the press would actually do.
      setCursor(e.altKey ? 'grab' : cursorFor(pick(hover, e.shiftKey), false))
      if (tool === 'polygon' && polyRef.current) draw()
      return
    }

    // Mid-gesture the cursor was set on press and stays put: pointer capture
    // means the pointer can wander off the handle it grabbed, and re-picking
    // under it would flicker the cursor through whatever it passes over.

    if (d.mode === 'pan') {
      viewRef.current = { ...viewRef.current, ox: d.ox + (e.clientX - d.sx), oy: d.oy + (e.clientY - d.sy) }
      draw(); return
    }

    const p = toImage(e)

    if (d.mode === 'lasso') {
      const pts = polyRef.current
      const lx = pts[pts.length - 2], ly = pts[pts.length - 1]
      // Thin the path: a pointermove every pixel of screen travel makes a
      // polygon with thousands of near-duplicate vertices to scanline-fill.
      if (Math.hypot(p.x - lx, p.y - ly) * viewRef.current.scale >= 3) {
        pts.push(clamp(p.x, 0, srcWidth), clamp(p.y, 0, srcHeight))
        draw()
      }
      return
    }

    if (d.mode === 'vertex') {
      const points = d.points
      points[d.index * 2]     = clamp(p.x, 0, srcWidth)
      points[d.index * 2 + 1] = clamp(p.y, 0, srcHeight)
      setShapeLive({ ...editRef.current.shape, points })
      return
    }

    if (d.mode === 'ellipse-new') {
      // Shift is read per move, so it can be pressed or released mid-drag.
      setShapeLive(ellipseFromDrag(d.start, p, e.shiftKey))
      return
    }

    if (d.mode === 'ellipse-move') {
      const el = d.el
      setShapeLive({ ...el, cx: el.cx + (p.x - d.start.x), cy: el.cy + (p.y - d.start.y) })
      return
    }

    if (d.mode === 'ellipse-resize') {
      const b = d.box
      let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h
      const h = d.handle
      if (h.includes('w')) x0 = Math.min(p.x, x1 - MIN_RECT)
      if (h.includes('e')) x1 = Math.max(p.x, x0 + MIN_RECT)
      if (h.includes('n')) y0 = Math.min(p.y, y1 - MIN_RECT)
      if (h.includes('s')) y1 = Math.max(p.y, y0 + MIN_RECT)
      if (e.shiftKey) {
        // Grow the short axis to match the long one, anchored on whichever edge
        // is *not* being dragged; an edge handle keeps the other axis centred.
        const r = Math.max(x1 - x0, y1 - y0)
        if (h.includes('w')) x0 = x1 - r
        else if (h.includes('e')) x1 = x0 + r
        else { const cx = (x0 + x1) / 2; x0 = cx - r / 2; x1 = cx + r / 2 }
        if (h.includes('n')) y0 = y1 - r
        else if (h.includes('s')) y1 = y0 + r
        else { const cy = (y0 + y1) / 2; y0 = cy - r / 2; y1 = cy + r / 2 }
      }
      setShapeLive({ type: 'ellipse', cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 })
      return
    }

    if (d.mode === 'new') {
      const r = {
        x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y),
        w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y),
        fixRight: p.x < d.start.x, fixBottom: p.y < d.start.y,
      }
      editRef.current = { ...(editRef.current ?? { shape: null, feather: 0 }), rect: normalize(r) }
      draw(); return
    }

    if (d.mode === 'move') {
      const r = d.rect
      editRef.current = {
        ...editRef.current,
        rect: {
          x: Math.round(clamp(r.x + (p.x - d.start.x), 0, srcWidth - r.w)),
          y: Math.round(clamp(r.y + (p.y - d.start.y), 0, srcHeight - r.h)),
          w: r.w, h: r.h,
        },
      }
      draw(); return
    }

    if (d.mode === 'resize') {
      const r = d.rect
      let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h
      const h = d.handle
      if (h.includes('w')) x0 = clamp(p.x, 0, x1 - MIN_RECT)
      if (h.includes('e')) x1 = clamp(p.x, x0 + MIN_RECT, srcWidth)
      if (h.includes('n')) y0 = clamp(p.y, 0, y1 - MIN_RECT)
      if (h.includes('s')) y1 = clamp(p.y, y0 + MIN_RECT, srcHeight)
      editRef.current = {
        ...editRef.current,
        rect: normalize({
          x: x0, y: y0, w: x1 - x0, h: y1 - y0,
          fixRight: h.includes('w'), fixBottom: h.includes('n'),
        }),
      }
      draw()
    }
  }

  const onPointerUp = (e) => {
    const d = dragRef.current
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    // Back to the hover cursor. Read against the shape the gesture just left
    // behind, so releasing a vertex still reads as grabbable.
    setCursor(e.altKey ? 'grab' : cursorFor(pick(toImage(e), e.shiftKey), false))
    if (!d || d.mode === 'pan') return

    if (d.mode === 'lasso') {
      const pts = polyRef.current
      polyRef.current = null
      // A click rather than a drag: no area, nothing to select.
      if (!pts || pts.length < 6) { draw(); return }
      // Decimate before committing. A drag emits a vertex every few screen
      // pixels, and several hundred of them are both slow to scanline-fill and
      // impossible to edit by hand afterwards. Douglas–Peucker at ~1.5 screen
      // pixels is invisible on screen and typically cuts the count by 5–10×.
      const eps = 1.5 / viewRef.current.scale
      commit({ shape: { type: 'lasso', points: Array.from(simplifyFlat(pts, eps)) } })
      return
    }

    if (d.mode === 'ellipse-new' && !isUsableShape(editRef.current?.shape)) {
      // A click, not a drag — leave whatever was there alone.
      draw(); return
    }
    // Crop gestures already mutated editRef imperatively; publish the result.
    commit({})
  }

  const closePolygon = () => {
    const pts = polyRef.current
    polyRef.current = null
    if (!pts || pts.length < 6) { draw(); return }
    commit({ shape: { type: 'polygon', points: pts } })
  }

  const onWheel = (e) => {
    e.preventDefault()
    const r = canvasRef.current.getBoundingClientRect()
    const v = viewRef.current
    const k = Math.exp(-e.deltaY * 0.0015)
    const scale = clamp(v.scale * k, 0.02, 64)
    const cx = e.clientX - r.left, cy = e.clientY - r.top
    // Zoom about the cursor: the image point under it must not move.
    viewRef.current = {
      scale,
      ox: cx - (cx - v.ox) * (scale / v.scale),
      oy: cy - (cy - v.oy) * (scale / v.scale),
    }
    draw()
  }

  // ── Keys ───────────────────────────────────────────────────────────────────
  // Escape and Enter already mean something to App (leave Edit Mode / apply), so
  // they are not claimed here. Both listeners would be on `window`, and which
  // one ran first would depend on whether this component happened to have
  // re-rendered since it mounted — Enter could then close the polygon *and*
  // apply. Instead App asks whether a shape is being drawn and, if so, calls
  // back in. Backspace is ours alone and stays local.
  useEffect(() => {
    if (!keysRef) return
    keysRef.current = {
      escape: () => {
        if (!polyRef.current) return false
        polyRef.current = null
        draw()
        return true
      },
      drawing: () => !!polyRef.current,
      closeShape: () => closePolygon(),
    }
    return () => { keysRef.current = null }
  })

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (!polyRef.current) return
      if (e.code === 'Backspace') {
        e.preventDefault()
        const pts = polyRef.current
        pts.length = Math.max(0, pts.length - 2)
        if (!pts.length) polyRef.current = null
        draw()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draw])

  const bounds = effectiveBounds(edit, srcWidth, srcHeight)

  return (
    <div
      ref={wrapRef}
      data-testid="heightmap-editor"
      style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, right: rightInset,
        background: '#101013', zIndex: 900, overflow: 'hidden', touchAction: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        // `cursor` is the resting value only — the pointer handlers write
        // canvas.style.cursor directly, because a hover must not re-render the
        // panel. React leaves that write alone as long as the literal here never
        // changes between renders; making it conditional would fight them.
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => { if (polyRef.current) closePolygon() }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Hints + view controls */}
      <div style={{
        position: 'absolute', left: 14, bottom: 14, display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: 'system-ui,sans-serif', fontSize: 11, color: MUTED,
      }}>
        <button onClick={fit} style={{
          background: SURF, color: '#d4d4d8', border: `1px solid ${BORDER}`,
          borderRadius: 5, padding: '5px 10px', fontSize: 11, cursor: 'pointer',
        }}>Fit</button>
        <span style={{ background: 'rgba(0,0,0,.45)', padding: '5px 9px', borderRadius: 5 }}>
          {bounds ? `${bounds.w}×${bounds.h} px` : 'empty selection'}
          {' · '}
          {tool === 'crop'    && 'drag to crop · handles to resize'}
          {tool === 'ellipse' && 'drag to draw · hold shift for a circle'}
          {tool === 'lasso'   && 'drag to draw · then drag the points to adjust'}
          {tool === 'polygon' && 'click to add points · Enter or first point to close'}
          {POINT_TOOLS.has(tool) && ' · drag a point to move it · drag an edge to add one · right-click to remove'}
          {' · alt-drag to pan · scroll to zoom'}
        </span>
      </div>
    </div>
  )
}
