/**
 * Undo and redo over one draft value: Edit Mode's clip.
 *
 * The app's history tracks settings, and the draft is not one of them. It is
 * scratch state until Apply, and Cancel throws it away. Inside Edit Mode it
 * still needs a way back from a wrong drag short of throwing everything away,
 * which is what the Mask Studio's own undo gives a mask.
 *
 * Changes within `quietMs` of the last one join its step. A Feather drag or a
 * typed width sends a change per movement or keystroke, and one step per drag
 * is what a person expects to undo.
 */
import { useCallback, useRef, useState } from 'react'

export function useDraftHistory(draft, setDraft, { depth = 50, quietMs = 400 } = {}) {
  const h = useRef({ past: [], future: [], at: 0 })
  const current = useRef(draft)
  current.current = draft
  const [, bump] = useState(0)

  /** Set the draft, remembering what it was. */
  const change = useCallback((next) => {
    const s = h.current, now = Date.now()
    if (current.current && now - s.at > quietMs) {
      s.past.push(current.current)
      if (s.past.length > depth) s.past.shift()
    }
    s.at = now
    s.future = []
    current.current = next
    setDraft(next)
    bump((n) => n + 1)
  }, [setDraft, depth, quietMs])

  const step = useCallback((back) => {
    const s = h.current
    const from = back ? s.past : s.future, to = back ? s.future : s.past
    if (!from.length) return
    to.push(current.current)
    const next = from.pop()
    s.at = 0
    current.current = next
    setDraft(next)
    bump((n) => n + 1)
  }, [setDraft])

  /** Forget everything: a new Edit Mode session starts a new history. */
  const clear = useCallback(() => { h.current = { past: [], future: [], at: 0 }; bump((n) => n + 1) }, [])

  return {
    change,
    undo: useCallback(() => step(true), [step]),
    redo: useCallback(() => step(false), [step]),
    clear,
    canUndo: h.current.past.length > 0,
    canRedo: h.current.future.length > 0,
  }
}
