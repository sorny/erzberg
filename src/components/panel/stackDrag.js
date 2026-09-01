import { useCallback, useRef, useState } from 'react'

/**
 * Drag-to-reorder for the layer stack.
 *
 * Pointer events with capture rather than HTML5 drag-and-drop: the sidebar is a
 * scrolling panel inside a WebGL page, and the native drag image, drop targets
 * and `dragover` bookkeeping buy nothing here that `setPointerCapture` does not
 * do in a third of the code. It also keeps the drag working with a pen or a
 * finger, which HTML5 dragging does not.
 *
 * Rows are measured live rather than at drag start. They have to be: the list
 * reflows the instant a move is committed, and an expanded layer is several
 * times the height of a collapsed one, so a cached set of boxes is wrong from
 * the first swap onwards.
 */
export function useStackDrag(layers, onReorder) {
  const rows = useRef(new Map())
  const [dragging, setDragging] = useState(null)

  const bindRow = useCallback((id) => (el) => {
    if (el) rows.current.set(id, el)
    else rows.current.delete(id)
  }, [])

  const start = (e, id) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(id)
  }

  const move = (e) => {
    if (!dragging) return
    const from = layers.findIndex((l) => l.id === dragging)
    if (from < 0) return
    const y = e.clientY

    // A row is crossed at its midpoint, not at its edge. Swapping on entry
    // reads fine while every row is the same height and falls apart as soon as
    // one is expanded: the shorter row lands back under the cursor and the list
    // oscillates between two orders for as long as you hold still.
    let target = from
    for (let i = 0; i < layers.length; i++) {
      if (i === from) continue
      const r = rows.current.get(layers[i].id)?.getBoundingClientRect()
      if (!r) continue
      if (i < from) {
        // Going up, the topmost row whose upper half we have reached wins…
        if (target === from && y < r.bottom - r.height / 2) target = i
      } else if (y > r.top + r.height / 2) {
        // …going down, the lowest one.
        target = i
      }
    }
    if (target !== from) onReorder(dragging, target)
  }

  const end = (e) => {
    if (!dragging) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDragging(null)
  }

  return { dragging, bindRow, start, move, end }
}
