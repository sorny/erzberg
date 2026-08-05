/**
 * Raw spectrogram readout for the Soundscapes panel.
 *
 * Draws the whole analysed track once into an offscreen canvas, then blits that
 * cached image each frame and overlays the playhead plus the slice currently
 * being streamed to the terrain. Redrawing the full STFT per frame would be
 * thousands of columns of work at the tick rate; the cache makes the per-frame
 * cost a single drawImage.
 */
import { useEffect, useMemo, useRef } from 'react'

const VIEW_H = 96
// The panel is ~244px wide, so more columns than this cannot be resolved.
const MAX_COLS = 512

// Classic "heat" spectrogram ramp: black → indigo → magenta → orange → white.
// Perceptually increasing in lightness so quiet detail stays visible without
// the mid-range banding a pure hue rotation gives.
const RAMP = [
  [0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99],
  [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164],
]

function rampColor(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  const f = x - i
  const a = RAMP[i], b = RAMP[i + 1]
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ]
}

/**
 * @param {object}   spec         result from computeSpectrogram, or null
 * @param {number}   currentTime  playhead position in seconds
 * @param {number}   duration     track length in seconds
 * @param {number}   windowFrames width of the slice being streamed
 * @param {number}   dbFloor      noise gate, 0–1 of the stored dB range
 * @param {number}   contrast     gamma applied after gating
 * @param {boolean}  frozen       whole track is the heightmap, not a window
 * @param {Function} onSeek       called with a time in seconds on click/drag
 */
export function SpectrogramView({ spec, currentTime, duration, windowFrames, dbFloor, contrast, frozen, onSeek }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)

  // Cached full-track image. Rebuilt only when the analysis or the tone mapping
  // changes — not on playhead movement.
  const cached = useMemo(() => {
    if (!spec) return null
    const { data, frames, bins } = spec
    const cols = Math.max(1, Math.min(MAX_COLS, frames))
    const cv = document.createElement('canvas')
    cv.width = cols
    cv.height = bins
    const ctx = cv.getContext('2d')
    const img = ctx.createImageData(cols, bins)
    const inv = 1 / Math.max(1e-6, 1 - dbFloor)

    for (let x = 0; x < cols; x++) {
      const f0 = Math.floor((x / cols) * frames)
      const f1 = Math.max(f0 + 1, Math.floor(((x + 1) / cols) * frames))
      for (let b = 0; b < bins; b++) {
        let peak = 0
        for (let f = f0; f < f1 && f < frames; f++) {
          const v = data[f * bins + b]
          if (v > peak) peak = v
        }
        let v = (peak - dbFloor) * inv
        v = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, contrast)
        const [r, g, bl] = rampColor(v)
        // Low frequencies at the bottom, matching the streamed heightmap.
        const o = ((bins - 1 - b) * cols + x) * 4
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl; img.data[o + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return cv
  }, [spec, dbFloor, contrast])

  // Overlay pass — cheap, runs on every playhead update.
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    const w = cv.width, h = cv.height

    ctx.clearRect(0, 0, w, h)
    if (!cached) {
      ctx.fillStyle = '#111114'
      ctx.fillRect(0, 0, w, h)
      return
    }

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(cached, 0, 0, w, h)

    // Frozen: the whole track is the heightmap, so the selection covers
    // everything and there is no playhead to follow — drawing the moving window
    // here would describe streaming behaviour the terrain is no longer doing.
    if (frozen) {
      ctx.fillStyle = 'rgba(255,255,255,0.16)'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 2
      ctx.strokeRect(1, 1, w - 2, h - 2)
      return
    }

    if (!duration) return
    const px = (currentTime / duration) * w

    // Shade the slice currently feeding the terrain, so the relationship
    // between this readout and the 3D view is legible at a glance.
    if (spec && windowFrames) {
      const winSec = (windowFrames * spec.hop) / spec.sampleRate
      const x0 = Math.max(0, ((currentTime - winSec) / duration) * w)
      ctx.fillStyle = 'rgba(255,255,255,0.16)'
      ctx.fillRect(x0, 0, Math.max(1, px - x0), h)
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 1
      ctx.strokeRect(x0 + 0.5, 0.5, Math.max(1, px - x0) - 1, h - 1)
    }

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(Math.min(w - 1, Math.max(0, px - 0.5)), 0, 1.5, h)
  }, [cached, currentTime, duration, windowFrames, spec, frozen])

  // Keep the backing store matched to the laid-out width so the image is crisp.
  useEffect(() => {
    const cv = canvasRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(wrap.clientWidth * dpr))
      const h = Math.round(VIEW_H * dpr)
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  const seekFromEvent = (e) => {
    if (!onSeek || !duration) return
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(((e.clientX - r.left) / r.width) * duration)
  }

  return (
    <div
      ref={wrapRef}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFromEvent(e) }}
      onPointerMove={(e) => { if (e.buttons === 1) seekFromEvent(e) }}
      style={{
        width: '100%', height: VIEW_H, borderRadius: 4, overflow: 'hidden',
        border: '1px solid #3f3f46', background: '#111114',
        cursor: duration ? 'ew-resize' : 'default', marginBottom: 8,
        touchAction: 'none',
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  )
}
