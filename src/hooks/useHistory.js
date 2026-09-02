import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Undo and redo over a set of tracked values.
 *
 * ── Snapshots rather than commands ───────────────────────────────────────────
 * A command-pattern history wants every mutation site to describe itself, and
 * there are several hundred of them here — every slider, every colour well,
 * every toggle in a three-thousand-line panel. Nothing would keep that honest,
 * and the first control anybody forgot to annotate would be silently
 * un-undoable.
 *
 * A snapshot is taken from the state itself, so a control cannot opt out of it
 * by being written carelessly. It costs what it costs because everything here is
 * already immutable: the panel replaces `style` rather than mutating it, so a
 * snapshot is a list of references and not a copy of anything. The one entry
 * with real weight is `vectorSources`, and holding a reference to it only keeps
 * alive an array that a live fetch would have kept alive anyway — bounded by
 * `limit`, which is what stops a long session pinning every province ever
 * fetched.
 *
 * ── Coalescing ──────────────────────────────────────────────────────────────
 * A drag emits a change per frame. Recording each would make one undo step
 * worth 16 ms of a gesture, and forty presses to get back across one slider.
 * Changes arriving inside `coalesceMs` of the last are treated as the same
 * gesture and do not push again — the entry already on the stack is the state
 * from *before* the gesture began, which is the one you want back.
 *
 * A pause longer than the window inside a slow drag splits it into two steps.
 * That is the right answer rather than a compromise: a deliberate pause is where
 * somebody stopped to look.
 */
export function useHistory(tracked, restore, { limit = 60, coalesceMs = 450 } = {}) {
  const past = useRef([])
  const future = useRef([])
  // The last committed snapshot — what a *new* change should push, since the
  // effect below only ever sees the state after that change has landed.
  const prev = useRef(tracked)
  /*
   * The snapshot the last undo or redo put back, so the state change it causes
   * is not recorded as a fresh edit — which would clear the redo stack and make
   * redo permanently unavailable.
   *
   * Identity rather than a flag, and that is not a stylistic choice: a flag
   * cleared on a microtask is cleared long before React runs the effect, and a
   * flag cleared *by* the effect never clears at all when a restore happens to
   * change nothing. Comparing the values has no timing in it. The references are
   * the ones just handed to the setters, so this is a pointer compare.
   */
  const applied = useRef(null)
  const lastAt = useRef(0)
  const [depth, setDepth] = useState({ undo: 0, redo: 0 })

  useEffect(() => {
    if (applied.current && applied.current.length === tracked.length &&
        applied.current.every((v, i) => v === tracked[i])) {
      applied.current = null
      prev.current = tracked
      return
    }
    const now = Date.now()
    const sameGesture = now - lastAt.current < coalesceMs && past.current.length > 0
    if (!sameGesture) {
      past.current.push(prev.current)
      if (past.current.length > limit) past.current.shift()
      // Any new edit abandons the branch that redo was holding, which is what
      // every editor does and what stops redo replaying a look nobody asked for.
      future.current = []
      setDepth({ undo: past.current.length, redo: 0 })
    }
    lastAt.current = now
    prev.current = tracked
    // The tracked values *are* the dependency list. React compares it element by
    // element, so a fresh array carrying the same references does not re-run —
    // which is exactly the identity test a snapshot history wants. The rule
    // cannot see through the indirection; the length is fixed by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, tracked)

  const step = useCallback((from, to) => {
    if (!from.current.length) return false
    to.current.push(prev.current)
    const snap = from.current.pop()
    applied.current = snap
    restore(snap)
    // Nothing about a restore should look like the start of a gesture, or the
    // next edit would coalesce into it and be lost.
    lastAt.current = 0
    setDepth({ undo: past.current.length, redo: future.current.length })
    return true
  }, [restore])

  const undo = useCallback(() => step(past, future), [step])
  const redo = useCallback(() => step(future, past), [step])

  const clear = useCallback(() => {
    past.current = []
    future.current = []
    setDepth({ undo: 0, redo: 0 })
  }, [])

  return { undo, redo, clear, canUndo: depth.undo > 0, canRedo: depth.redo > 0 }
}
