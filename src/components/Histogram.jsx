/**
 * Brightness histogram for the Levels panel.
 *
 * - Renders a 256-bin brightness histogram from raw heightmap pixels.
 * - Two draggable vertical handles: Shadows (blackPoint) and Highlights (whitePoint).
 * - Regions outside the handles are dimmed to show what gets clipped.
 * - Uses pointer capture so dragging outside the canvas still works.
 */
import { useRef, useMemo, useEffect, useCallback } from 'react'

const W = 256
const H = 72

export function Histogram({ pixels, blackPoint, whitePoint, onBlackChange, onWhiteChange }) {
  const canvasRef = useRef()
  const dragging  = useRef(null)   // 'black' | 'white' | null

  // Compute 256-bin histogram from raw pixel brightness
  const bins = useMemo(() => {
    const b = new Float32Array(256)
    if (!pixels) return b
    for (let i = 0; i < pixels.length; i++) {
      b[Math.min(255, pixels[i] * 255 | 0)]++
    }
    // Normalise to [0, 1] — ignore the very highest spike (often at 0 or 255)
    let max = 0
    for (let i = 1; i < 255; i++) if (b[i] > max) max = b[i]
    if (max > 0) for (let i = 0; i < 256; i++) b[i] = Math.min(1, b[i] / max)
    return b
  }, [pixels])

  // Redraw whenever bins or handles change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)

    // Background
    ctx.fillStyle = '#1a1a1e'
    ctx.fillRect(0, 0, W, H)

    // Histogram bars — colour the clipped regions darker
    for (let i = 0; i < 256; i++) {
      const barH = bins[i] * H
      const clipped = i < blackPoint || i > whitePoint
      ctx.fillStyle = clipped ? '#383840' : '#7c7caa'
      ctx.fillRect(i, H - barH, 1, barH)
    }

    // Dim overlay on clipped regions
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.fillRect(0, 0, (blackPoint / 255) * W, H)
    ctx.fillRect((whitePoint / 255) * W, 0, W - (whitePoint / 255) * W, H)

    // Shadow handle
    const bx = (blackPoint / 255) * W
    ctx.strokeStyle = '#bbbbcc'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, H); ctx.stroke()

    // Triangle marker ▼ for shadow handle
    ctx.fillStyle = '#bbbbcc'
    ctx.beginPath()
    ctx.moveTo(bx - 5, 0); ctx.lineTo(bx + 5, 0); ctx.lineTo(bx, 7); ctx.closePath()
    ctx.fill()

    // Highlight handle
    const wx = (whitePoint / 255) * W
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(wx, 0); ctx.lineTo(wx, H); ctx.stroke()

    // Triangle marker ▼ for highlight handle
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(wx - 5, 0); ctx.lineTo(wx + 5, 0); ctx.lineTo(wx, 7); ctx.closePath()
    ctx.fill()
  }, [bins, blackPoint, whitePoint])

  // Pointer event helpers
  const xToValue = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const t    = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    return Math.round(t * 255)
  }, [])

  const onPointerDown = (e) => {
    const val  = xToValue(e)
    const bDist = Math.abs(val - blackPoint)
    const wDist = Math.abs(val - whitePoint)
    dragging.current = bDist <= wDist ? 'black' : 'white'
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e) => {
    if (!dragging.current) return
    const val = xToValue(e)
    if (dragging.current === 'black') onBlackChange(Math.min(val, whitePoint - 2))
    else                              onWhiteChange(Math.max(val, blackPoint + 2))
  }

  const onPointerUp = () => { dragging.current = null }

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ width: '100%', height: `${H}px`, display: 'block', cursor: 'ew-resize', borderRadius: 4 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    />
  )
}
