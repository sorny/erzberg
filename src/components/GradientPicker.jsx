/**
 * Multi-stop gradient editor.
 *
 * - Gradient bar shows the current colour distribution.
 * - Draggable stop handles on the bar (drag to reposition).
 * - Click on an empty spot on the bar to add a new stop.
 * - Click on a handle to open a native colour picker.
 * - ✕ button removes non-anchor stops (stops at pos=0 and pos=1 are protected).
 */
import { useRef, useCallback } from 'react'

function cssGradient(stops) {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos)
  const parts  = sorted.map(s => `${s.color} ${(s.pos * 100).toFixed(1)}%`)
  return `linear-gradient(to right, ${parts.join(', ')})`
}

export function GradientPicker({ stops, onChange, isSimple = false }) {
  const barRef     = useRef()
  const dragging   = useRef(null)  // { index, startX, startPos }
  const colorInputRef = useRef()
  const editingIdx    = useRef(null)

  const sorted = [...stops].sort((a, b) => a.pos - b.pos)

  // Convert client X → 0–1 position on the bar
  const xToPos = useCallback((clientX) => {
    const rect = barRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  const updateStop = useCallback((index, patch) => {
    const next = stops.map((s, i) => i === index ? { ...s, ...patch } : s)
    onChange(next)
  }, [stops, onChange])

  // Bar: click on empty area → add stop
  const onBarClick = (e) => {
    if (isSimple) return // No intermediate stops allowed in simple mode
    // Ignore if a drag just happened
    if (dragging.current !== null) return
    const pos = xToPos(e.clientX)
    // Ignore if too close to an existing stop (within 3px of the bar width)
    const rect = barRef.current.getBoundingClientRect()
    const tooClose = stops.some(s => Math.abs((s.pos - pos) * rect.width) < 8)
    if (tooClose) return
    // Interpolate colour at click position
    const s = [...stops].sort((a, b) => a.pos - b.pos)
    let col = s[0].color
    for (let i = 1; i < s.length; i++) {
      if (pos <= s[i].pos) {
        const t = (pos - s[i - 1].pos) / (s[i].pos - s[i - 1].pos)
        // simple hex average for the default colour
        col = s[i - 1].color  // close enough — user will adjust
        break
      }
    }
    onChange([...stops, { pos, color: col }])
  }

  // Stop handle: pointer down → start drag
  const onHandlePointerDown = (e, idx) => {
    e.stopPropagation()
    dragging.current = { index: idx, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onHandlePointerMove = (e, idx) => {
    if (!dragging.current || dragging.current.index !== idx) return
    const anchor = stops[idx].pos === 0 || stops[idx].pos === 1
    if (anchor || isSimple) return         // anchor stops can't be moved
    const pos = xToPos(e.clientX)
    const clamped = Math.max(0.01, Math.min(0.99, pos))
    dragging.current.moved = true
    updateStop(idx, { pos: clamped })
  }

  const onHandlePointerUp = (e, idx) => {
    const d = dragging.current
    dragging.current = null
    if (!d?.moved) {
      // Treat as click → open colour picker
      editingIdx.current = idx
      colorInputRef.current.value = stops[idx].color
      colorInputRef.current.click()
    }
  }

  const onColorChange = (e) => {
    if (editingIdx.current === null) return
    updateStop(editingIdx.current, { color: e.target.value })
  }

  const removeStop = (e, idx) => {
    e.stopPropagation()
    if (stops[idx].pos === 0 || stops[idx].pos === 1) return  // protect anchors
    onChange(stops.filter((_, i) => i !== idx))
  }

  return (
    <div style={{ userSelect: 'none' }}>
      {/* Hidden colour input */}
      <input
        ref={colorInputRef}
        type="color"
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
        onChange={onColorChange}
      />

      {/* Gradient bar + handles */}
      <div
        ref={barRef}
        onClick={onBarClick}
        style={{
          position: 'relative',
          height: 18,
          borderRadius: 4,
          background: cssGradient(stops),
          cursor: isSimple ? 'default' : 'crosshair',
          marginBottom: 10,
          border: '1px solid #333',
        }}
      >
        {stops.map((stop, idx) => {
          const isAnchor = stop.pos === 0 || stop.pos === 1
          if (isSimple && !isAnchor) return null // Hide non-anchor stops in simple mode
          return (
            <div
              key={idx}
              title={isAnchor ? 'Anchor stop · Click to change colour' : 'Drag to move · Click to change colour'}
              onPointerDown={(e) => onHandlePointerDown(e, idx)}
              onPointerMove={(e) => onHandlePointerMove(e, idx)}
              onPointerUp={(e) => onHandlePointerUp(e, idx)}
              style={{
                position: 'absolute',
                left:  `${stop.pos * 100}%`,
                bottom: 0,
                transform: 'translateX(-50%)',
                width: 12,
                height: 18,
                cursor: (isAnchor || isSimple) ? 'pointer' : 'ew-resize',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              {/* Triangle handle */}
              <div style={{
                width: 0, height: 0,
                borderLeft:  '6px solid transparent',
                borderRight: '6px solid transparent',
                borderBottom: `10px solid ${stop.color}`,
                filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))',
              }} />
              <div style={{
                width: 2, height: 8,
                background: stop.color,
                boxShadow: '0 0 2px rgba(0,0,0,0.8)',
              }} />
            </div>
          )
        })}
      </div>

      {/* Stop list with colour swatches and delete buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {[...stops].sort((a, b) => a.pos - b.pos).map((stop, sortedIdx) => {
          const origIdx = stops.indexOf(stop)
          const isAnchor = stop.pos === 0 || stop.pos === 1
          if (isSimple && !isAnchor) return null
          
          let label = `${(stop.pos * 100).toFixed(0)}%`
          if (isSimple) {
            if (stop.pos === 0) label = 'Top'
            if (stop.pos === 1) label = 'Bottom'
          }

          return (
            <div
              key={sortedIdx}
              style={{
                display: 'flex', alignItems: 'center', gap: 3,
                background: '#2a2a30', borderRadius: 3, padding: '2px 4px',
                fontSize: 10, color: '#aaa',
              }}
            >
              <div
                title="Click to change"
                onClick={() => {
                  editingIdx.current = origIdx
                  colorInputRef.current.value = stop.color
                  colorInputRef.current.click()
                }}
                style={{
                  width: 12, height: 12,
                  background: stop.color,
                  borderRadius: 2,
                  border: '1px solid #555',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              />
              <span>{label}</span>
              {!isAnchor && !isSimple && (
                <span
                  onClick={(e) => removeStop(e, origIdx)}
                  style={{ cursor: 'pointer', color: '#666', lineHeight: 1 }}
                  title="Remove stop"
                >✕</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
