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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { stamp, stroke } from '../utils/maskLayers'

/** Tools, and the one letter each answers to. */
export const STUDIO_TOOLS = [
  ['brush', 'Brush', 'B'],
  ['rect', 'Rectangle', 'R'],
  ['ellipse', 'Ellipse', 'O'],
  ['lasso', 'Lasso', 'L'],
]

const MIN_BRUSH = 1
const MAX_BRUSH = 400

/** The hillshade shown when there is no imagery to show instead. */
function buildRelief(pixels, nodata, width, height) {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c
      const o = i * 4
      if (nodata && !nodata[i]) { out[o + 3] = 0; continue }
      const l = c > 0 ? pixels[i - 1] : pixels[i]
      const u = r > 0 ? pixels[i - width] : pixels[i]
      // A plain north-west lamp on the normalised raster. This is a backdrop to
      // aim at, not a render — the app has a real hillshade for that.
      const shade = Math.max(0, Math.min(1, 0.5 + (pixels[i] - l) * 6 + (pixels[i] - u) * 6))
      const v = Math.round(40 + 150 * pixels[i] * 0.55 + 60 * shade)
      out[o] = out[o + 1] = out[o + 2] = Math.min(255, v)
      out[o + 3] = 255
    }
  }
  return new ImageData(out, width, height)
}

export function MaskStudio({
  srcPixels, srcMask, srcWidth, srcHeight,
  imagery, mask, onCommit, onClose, rightInset = 0,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 })
  const dragRef = useRef(null)
  const hoverRef = useRef(null)
  const drawRef = useRef(() => {})
  const dataRef = useRef(mask?.data ?? null)

  const [tool, setTool] = useState('brush')
  const [brush, setBrush] = useState(24)
  const [erase, setErase] = useState(false)
  const [backdrop, setBackdrop] = useState('auto')
  const [, bump] = useState(0)

  dataRef.current = mask?.data ?? null

  // The two possible backdrops, each built once for the raster it belongs to.
  const relief = useMemo(
    () => (srcPixels ? buildRelief(srcPixels, srcMask, srcWidth, srcHeight) : null),
    [srcPixels, srcMask, srcWidth, srcHeight],
  )
  const photo = useMemo(() => {
    if (!imagery?.rgba) return null
    return new ImageData(new Uint8ClampedArray(imagery.rgba), imagery.width, imagery.height)
  }, [imagery])

  const showPhoto = backdrop === 'imagery' || (backdrop === 'auto' && !!photo)

  // Offscreen canvases, so the per-frame draw is three blits rather than three
  // full raster loops. Rebuilt only when their source does.
  const reliefCanvas = useMemo(() => canvasOf(relief), [relief])
  const photoCanvas = useMemo(() => canvasOf(photo), [photo])

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

    const bg = showPhoto ? photoCanvas : reliefCanvas
    if (bg) ctx.drawImage(bg, 0, 0, srcWidth, srcHeight)

    // The mask itself, as a wash in its own colour. Composited rather than
    // drawn opaque so the ground stays readable underneath it — you are aiming
    // at what is in the picture, not at the paint.
    const plane = dataRef.current
    if (plane) {
      const overlay = maskCanvas(plane, srcWidth, srcHeight, mask.color)
      ctx.globalAlpha = 0.45
      ctx.drawImage(overlay, 0, 0, srcWidth, srcHeight)
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

    // The brush, where the pointer is. Drawn at the size it will actually
    // paint, which is the only honest way to show a radius.
    if (tool === 'brush' && hoverRef.current) {
      const s = toScreen(hoverRef.current)
      ctx.beginPath()
      ctx.arc(s.x, s.y, brush * scale, 0, Math.PI * 2)
      ctx.strokeStyle = erase ? '#ff6b6b' : '#ffffff'
      ctx.lineWidth = 1.2
      ctx.stroke()
    }

    function toScreen(pt) {
      const v = viewRef.current
      return { x: pt.x * v.scale + v.ox, y: pt.y * v.scale + v.oy }
    }
  }, [srcWidth, srcHeight, showPhoto, photoCanvas, reliefCanvas, mask, tool, brush, erase])

  drawRef.current = draw

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
    if (!dataRef.current || e.button !== 0) return
    const pt = toImage(e)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (tool === 'brush') {
      dragRef.current = { tool, last: pt }
      stamp(dataRef.current, srcWidth, srcHeight, pt.x, pt.y, brush, erase)
      draw()
    } else if (tool === 'lasso') {
      dragRef.current = { tool, points: [pt], preview: true }
    } else {
      dragRef.current = { tool, from: pt, to: pt, preview: true }
    }
  }

  const onMove = (e) => {
    const pt = toImage(e)
    hoverRef.current = pt
    const d = dragRef.current
    if (d && dataRef.current) {
      if (d.tool === 'brush') {
        stroke(dataRef.current, srcWidth, srcHeight, d.last.x, d.last.y, pt.x, pt.y, brush, erase)
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
    draw()
  }

  const onUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || !dataRef.current) { draw(); return }
    if (d.tool !== 'brush') fillShape(dataRef.current, srcWidth, srcHeight, d, erase)
    commit()
    draw()
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
        onPointerLeave={() => { hoverRef.current = null; draw() }}
        style={{ display: 'block', cursor: tool === 'brush' ? 'none' : 'crosshair', touchAction: 'none' }} />

      <StudioBar
        tool={tool} setTool={setTool}
        brush={brush} setBrush={setBrush}
        erase={erase} setErase={setErase}
        backdrop={backdrop} setBackdrop={setBackdrop}
        hasPhoto={!!photo} mask={mask} imagery={imagery}
        onClose={onClose} onFit={fit}
      />
    </div>
  )
}

/** The floating bar. Kept out of the canvas so a stroke never lands on it. */
function StudioBar({ tool, setTool, brush, setBrush, erase, setErase,
                     backdrop, setBackdrop, hasPhoto, mask, imagery, onClose, onFit }) {
  const chip = (on) => ({
    padding: '4px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
    background: on ? '#3b82f6' : 'rgba(255,255,255,0.06)',
    color: on ? '#fff' : '#c8ced6',
    border: `1px solid ${on ? '#3b82f6' : 'rgba(255,255,255,0.14)'}`,
  })
  return (
    <div style={{
      position: 'absolute', top: 12, left: 12, right: 12,
      display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
      background: 'rgba(14,17,20,0.92)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 6, padding: '8px 10px', backdropFilter: 'blur(6px)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e8ebed' }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: mask?.color ?? '#888',
                       border: '1px solid rgba(255,255,255,0.3)' }} />
        {mask?.name ?? 'No mask'}
      </span>

      <span style={{ display: 'flex', gap: 3 }}>
        {STUDIO_TOOLS.map(([id, label, key]) => (
          <button key={id} type="button" onClick={() => setTool(id)}
            title={`${label} (${key})`} data-testid={`studio-tool-${id}`}
            style={chip(tool === id)}>{label}</button>
        ))}
      </span>

      <button type="button" onClick={() => setErase(!erase)} data-testid="studio-erase"
        title="Erase (E)" style={chip(erase)}>{erase ? 'Erasing' : 'Painting'}</button>

      {tool === 'brush' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#c8ced6' }}>
          Size
          <input type="range" min={MIN_BRUSH} max={MAX_BRUSH} value={brush}
            aria-label="Brush size"
            onChange={(e) => setBrush(Number(e.target.value))} style={{ width: 110 }} />
          <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 28 }}>{brush}</span>
        </label>
      )}

      <span style={{ display: 'flex', gap: 3 }}>
        {[['auto', 'Auto'], ['imagery', 'Satellite'], ['relief', 'Relief']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setBackdrop(id)}
            disabled={id === 'imagery' && !hasPhoto}
            title={id === 'imagery' && !hasPhoto ? 'Fetch satellite imagery first' : `Backdrop: ${label}`}
            style={{ ...chip(backdrop === id), opacity: id === 'imagery' && !hasPhoto ? 0.4 : 1 }}>
            {label}
          </button>
        ))}
      </span>

      <span style={{ flex: 1 }} />

      {imagery && (
        <span style={{ fontSize: 10, color: '#8b949c' }}>
          {imagery.date} · {Math.round(imagery.cloud)}% cloud
        </span>
      )}
      <button type="button" onClick={onFit} style={chip(false)}>Fit</button>
      <button type="button" onClick={onClose} data-testid="studio-done" style={chip(false)}>Done</button>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function canvasOf(imageData) {
  if (!imageData) return null
  const c = document.createElement('canvas')
  c.width = imageData.width
  c.height = imageData.height
  c.getContext('2d').putImageData(imageData, 0, 0)
  return c
}

/** The mask as a flat wash of its own colour, transparent where it is off. */
function maskCanvas(plane, width, height, color) {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(width, height)
  const n = parseInt((color ?? '#ffffff').slice(1), 16)
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff
  for (let i = 0; i < plane.length; i++) {
    const o = i * 4
    if (!plane[i]) continue
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
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
