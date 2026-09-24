/**
 * The box you are about to download, drawn on the ground it covers.
 *
 * Two jobs, and the second is the one that was missing. It shows the extent —
 * which the panel has never done, so a search for "Erzberg" handed you whatever
 * envelope Nominatim had for that name and you found out what you got after the
 * download. And it lets you *change* it: drag the middle to move, drag a corner
 * to resize.
 *
 * ── Why the box is in degrees and the handles are in pixels ──────────────────
 * Everything downstream — `zoomForExtent`, `tileRange`, `fetchDem` — takes a
 * WGS84 bounding box, so that is what this owns and emits. The canvas is only a
 * projection of it, and a thin one: the preview covers a few kilometres, where
 * Web Mercator and a plain linear stretch of the window differ by far less than
 * a pixel. Doing the full spherical projection per pointer move would be exact
 * to a precision the selection does not have.
 *
 * ── The minimum box ──────────────────────────────────────────────────────────
 * A box can be dragged to nothing, and a zero-area extent reaches `tileRange` as
 * a single tile and `fetchDem` as a one-pixel raster. It is clamped to a tenth
 * of the window instead, which is always at least a few hundred metres across.
 */
import { useEffect, useRef, useState } from 'react'
import { BORDER, MUTED, SURF } from './ui'

const HANDLE = 9          // corner hit box, in canvas pixels
const MIN_FRAC = 0.1      // smallest box, as a fraction of the window

/** Where a WGS84 point falls on the canvas, and back. */
const toX = (lon, win, w) => ((lon - win[0]) / (win[2] - win[0])) * w
const toY = (lat, win, h) => ((win[3] - lat) / (win[3] - win[1])) * h
const toLon = (x, win, w) => win[0] + (x / w) * (win[2] - win[0])
const toLat = (y, win, h) => win[3] - (y / h) * (win[3] - win[1])

/**
 * Which part of the box a point is on.
 *
 * Corners win over the body, and they are tested in a fixed order so a tiny box
 * whose handles overlap still resolves to exactly one of them rather than
 * flickering between two.
 */
function hitTest(px, py, r) {
  const near = (x, y) => Math.abs(px - x) <= HANDLE && Math.abs(py - y) <= HANDLE
  if (near(r.x0, r.y0)) return 'nw'
  if (near(r.x1, r.y0)) return 'ne'
  if (near(r.x0, r.y1)) return 'sw'
  if (near(r.x1, r.y1)) return 'se'
  if (px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1) return 'move'
  return null
}

const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', move: 'move' }

export function ExtentMap({ preview, box, onChange, width = 240, height = 156, busy }) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const [hover, setHover] = useState(null)

  // The shaded relief, drawn once per preview. The sheet is a 512 or 768 px
  // square of tiles and the panel gives it 240, so it is scaled rather than
  // blitted — `putImageData` ignores transforms, hence the offscreen hop.
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, width, height)
    if (!preview) return
    const img = new ImageData(preview.rgba, preview.width, preview.height)
    // Through an offscreen canvas because putImageData ignores transforms, and
    // the sheet is square while the panel's window is not.
    const off = document.createElement('canvas')
    off.width = preview.width; off.height = preview.height
    off.getContext('2d').putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(off, 0, 0, preview.width, preview.height, 0, 0, width, height)
  }, [preview, width, height])

  if (!preview) return null
  const win = preview.bbox
  const rect = {
    x0: toX(box[0], win, width), y0: toY(box[3], win, height),
    x1: toX(box[2], win, width), y1: toY(box[1], win, height),
  }

  /**
   * A pointer position in the box's own units.
   *
   * The overlay is an SVG with a `width × height` viewBox stretched to whatever
   * the panel gives it, which is close to 240 but never exactly — so a raw
   * `clientX - left` is in CSS pixels while `rect` is in viewBox units, and the
   * two drift apart by however much the element was scaled. Left unscaled, the
   * corner handles were reachable but a drag moved the box by the wrong amount,
   * which is the worst kind of wrong: it looks like it works.
   */
  const pointFrom = (e) => {
    const b = e.currentTarget.getBoundingClientRect()
    return {
      px: ((e.clientX - b.left) / (b.width || width)) * width,
      py: ((e.clientY - b.top) / (b.height || height)) * height,
    }
  }

  const onDown = (e) => {
    if (busy) return
    const { px, py } = pointFrom(e)
    const mode = hitTest(px, py, rect)
    if (!mode) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { mode, px, py, box: [...box] }
  }

  const onMove = (e) => {
    const { px, py } = pointFrom(e)
    const d = dragRef.current
    if (!d) { setHover(hitTest(px, py, rect)); return }

    const dLon = toLon(px, win, width) - toLon(d.px, win, width)
    const dLat = toLat(py, win, height) - toLat(d.py, win, height)
    const [w0, s0, e0, n0] = d.box
    let next
    if (d.mode === 'move') {
      next = [w0 + dLon, s0 + dLat, e0 + dLon, n0 + dLat]
    } else {
      const west  = d.mode === 'nw' || d.mode === 'sw'
      const north = d.mode === 'nw' || d.mode === 'ne'
      next = [west ? w0 + dLon : w0, north ? s0 : s0 + dLat,
              west ? e0 : e0 + dLon, north ? n0 + dLat : n0]
      // A corner dragged past its opposite would invert the box, and an
      // inverted bbox reaches tileRange as an empty range.
      const minLon = (win[2] - win[0]) * MIN_FRAC, minLat = (win[3] - win[1]) * MIN_FRAC
      if (next[2] - next[0] < minLon) { if (west) next[0] = next[2] - minLon; else next[2] = next[0] + minLon }
      if (next[3] - next[1] < minLat) { if (north) next[3] = next[1] + minLat; else next[1] = next[3] - minLat }
    }
    // Never outside the ground that is actually drawn — a box over blank canvas
    // would fetch tiles the preview never showed.
    const w = Math.min(next[2] - next[0], win[2] - win[0])
    const h = Math.min(next[3] - next[1], win[3] - win[1])
    const west = Math.min(Math.max(next[0], win[0]), win[2] - w)
    const south = Math.min(Math.max(next[1], win[1]), win[3] - h)
    onChange([west, south, west + w, south + h])
  }

  const onUp = (e) => {
    if (dragRef.current) e.currentTarget.releasePointerCapture?.(e.pointerId)
    dragRef.current = null
  }

  const cursor = busy ? 'progress' : CURSOR[hover] ?? 'default'

  return (
    <div data-testid="extent-map" style={{ position:'relative', marginBottom:6, borderRadius:4,
         overflow:'hidden', border:`1px solid ${BORDER}`, background:SURF, lineHeight:0 }}>
      <canvas ref={canvasRef} width={width} height={height}
        style={{ display:'block', width:'100%', height:'auto' }} />
      <svg viewBox={`0 0 ${width} ${height}`} onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)}
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', cursor,
                 touchAction:'none' }}>
        {/* Everything outside the box, dimmed — four bands rather than a mask,
            which keeps this to plain shapes an SVG can hit-test. */}
        <g fill="rgba(9,9,11,0.5)">
          <rect x="0" y="0" width={width} height={Math.max(0, rect.y0)} />
          <rect x="0" y={rect.y1} width={width} height={Math.max(0, height - rect.y1)} />
          <rect x="0" y={rect.y0} width={Math.max(0, rect.x0)} height={Math.max(0, rect.y1 - rect.y0)} />
          <rect x={rect.x1} y={rect.y0} width={Math.max(0, width - rect.x1)} height={Math.max(0, rect.y1 - rect.y0)} />
        </g>
        <rect x={rect.x0} y={rect.y0} width={Math.max(0, rect.x1 - rect.x0)}
          height={Math.max(0, rect.y1 - rect.y0)} fill="none" stroke="#60a5fa" strokeWidth="1.5" />
        {[['nw', rect.x0, rect.y0], ['ne', rect.x1, rect.y0],
          ['sw', rect.x0, rect.y1], ['se', rect.x1, rect.y1]].map(([k, x, y]) => (
          <rect key={k} data-testid={`extent-handle-${k}`} x={x - 3.5} y={y - 3.5} width="7" height="7"
            fill={hover === k ? '#bfdbfe' : '#60a5fa'} />
        ))}
      </svg>
      <div style={{ position:'absolute', left:5, bottom:4, fontSize:8, letterSpacing:'.06em',
           color:MUTED, textTransform:'uppercase', pointerEvents:'none' }}>
        Terrain Tiles · AWS Open Data
      </div>
    </div>
  )
}
