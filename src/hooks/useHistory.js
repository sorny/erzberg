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
 *
 * ── Names ────────────────────────────────────────────────────────────────────
 * An entry carries a label as well as a snapshot, so the stack can be shown as
 * a list rather than pressed blindly. The label is *derived* — `describe` is
 * handed the two snapshots and works out what moved — which is what keeps the
 * argument above intact: a control still cannot opt out of the history, and now
 * it cannot opt out of being named either.
 *
 * `tag` is the exception, and a deliberate one. Applying a preset touches forty
 * parameters across nine sections, and no diff can recover the fact that it was
 * *Blueprint*. The handful of callers that know exactly what they did say so;
 * everything else is named from the diff.
 */
export function useHistory(tracked, restore, { limit = 60, coalesceMs = 450, describe } = {}) {
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
  /*
   * Set by `clear()`, and consumed by the next run of the effect.
   *
   * A caller clears the history because something just happened that was not an
   * edit — the app applying its opening preset, say. But that something is a
   * state change, and the effect below does not run until *after* it commits, so
   * a clear on its own empties the stack a moment before the entry it was meant
   * to disown gets pushed. This carries the intent across that gap.
   */
  const rebase = useRef(false)
  /**
   * A name for the next entry, set by a caller that knows better than the diff.
   *
   * Consumed by the next push and cleared, so a tag that is set and then not
   * followed by a change cannot attach itself to some unrelated edit later.
   * Cleared on the same paths as `rebase` for that reason.
   */
  const tagged = useRef(null)
  const [depth, setDepth] = useState({ undo: 0, redo: 0 })
  /**
   * The labels, newest first, for the panel to list.
   *
   * State rather than a ref because the list is rendered. It holds strings and
   * not snapshots — the snapshots stay in the refs, where a re-render cannot
   * copy them — so this is a few dozen short strings however heavy the history
   * behind it is.
   */
  const [labels, setLabels] = useState({ undo: [], redo: [] })
  const publish = useCallback(() => {
    setDepth({ undo: past.current.length, redo: future.current.length })
    setLabels({
      undo: past.current.map((e) => e.label).reverse(),
      redo: future.current.map((e) => e.label).reverse(),
    })
  }, [])

  useEffect(() => {
    if (rebase.current) {
      rebase.current = false
      past.current = []
      future.current = []
      prev.current = tracked
      tagged.current = null
      publish()
      return
    }
    if (applied.current && applied.current.length === tracked.length &&
        applied.current.every((v, i) => v === tracked[i])) {
      applied.current = null
      prev.current = tracked
      return
    }
    const now = Date.now()
    const sameGesture = now - lastAt.current < coalesceMs && past.current.length > 0
    if (!sameGesture) {
      // A tag beats the diff, and a diff that recognises nothing still pushes —
      // a step that happened belongs in the stack whether or not it can be
      // described, and an unnamed row is better than a missing one.
      const label = tagged.current ?? describe?.(prev.current, tracked) ?? 'Change'
      past.current.push({ snap: prev.current, label })
      if (past.current.length > limit) past.current.shift()
      // Any new edit abandons the branch that redo was holding, which is what
      // every editor does and what stops redo replaying a look nobody asked for.
      future.current = []
      publish()
    }
    tagged.current = null
    lastAt.current = now
    prev.current = tracked
    // The tracked values *are* the dependency list. React compares it element by
    // element, so a fresh array carrying the same references does not re-run —
    // which is exactly the identity test a snapshot history wants. The rule
    // cannot see through the indirection; the length is fixed by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, tracked)

  /**
   * Move `n` entries from one stack to the other, and restore what is there.
   *
   * `n` at once rather than calling a single step repeatedly, and that is a
   * correctness point rather than an optimisation: `prev.current` is only
   * updated by the effect, which does not run until React commits. Stepping
   * twice in one tick would therefore push the *same* snapshot into the other
   * stack both times, and the middle state would be lost. Threading `cur`
   * through the loop is what keeps the intermediate entries real.
   *
   * The label travels with the direction: an entry moved onto `future` is named
   * for the change redo would re-apply, which is the change undo just took off.
   */
  const jump = useCallback((from, to, n) => {
    if (n <= 0 || from.current.length < n) return false
    let cur = prev.current
    for (let i = 0; i < n; i++) {
      const e = from.current.pop()
      to.current.push({ snap: cur, label: e.label })
      cur = e.snap
    }
    applied.current = cur
    restore(cur)
    // Nothing about a restore should look like the start of a gesture, or the
    // next edit would coalesce into it and be lost.
    lastAt.current = 0
    publish()
    return true
  }, [restore, publish])

  const undo = useCallback(() => jump(past, future, 1), [jump])
  const redo = useCallback(() => jump(future, past, 1), [jump])
  /**
   * Back to the state before the nth-most-recent change, counting from 1.
   *
   * `undoTo(3)` is three presses of undo, in one step and with one restore —
   * so the picture is rebuilt once rather than three times, and everything
   * passed over is still on the redo stack in order.
   */
  const undoTo = useCallback((n) => jump(past, future, n), [jump])
  const redoTo = useCallback((n) => jump(future, past, n), [jump])

  const clear = useCallback(() => {
    past.current = []
    future.current = []
    tagged.current = null
    rebase.current = true
    setDepth({ undo: 0, redo: 0 })
    setLabels({ undo: [], redo: [] })
  }, [])

  /** Name the next entry, overriding the diff. Cleared by the push it names. */
  const tag = useCallback((label) => { tagged.current = label }, [])

  return { undo, redo, undoTo, redoTo, clear, tag, labels,
    canUndo: depth.undo > 0, canRedo: depth.redo > 0 }
}
