/**
 * Letting a long export breathe.
 *
 * Both the SVG and STL writers are CPU work with no natural pause in them — a
 * software Z-buffer and an occlusion walk in one case, a few hundred thousand
 * triangles in the other. Run as a single block that is a tab the browser offers
 * to kill, and an overlay that cannot paint. Handing the main thread back on a
 * time budget fixes both: the page stays alive, the overlay animates, and there
 * is somewhere for the user to press Cancel.
 *
 * Measured on the default plate: the SVG export's longest unbroken stretch fell
 * from 242 ms to 39 ms, with no change in wall time.
 */

/**
 * A macrotask boundary the browser may paint across.
 *
 * MessageChannel rather than `setTimeout(0)`: once timers nest more than five
 * deep — which a loop yielding through its own timer callback does immediately —
 * the spec clamps them to 4 ms. At one yield per 24 ms of work that is a sixth of
 * the export spent waiting on the clock. A channel message has no such floor.
 *
 * And rather than `scheduler.yield()`, which looks like the right answer and is
 * not. It resumes the caller as a *continuation*, ahead of rendering, so the work
 * does interleave but the frame never lands: measured, an export paced entirely
 * through it still froze the page for 121 ms at a stretch, against 39 ms through
 * a channel message. What is wanted here is not a prompt resumption, it is a
 * repaint — the whole point is that the overlay keeps moving.
 */
export function macrotask() {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => { ch.port1.close(); resolve() }
    ch.port2.postMessage(null)
  })
}

/** Thrown by a pacer to unwind an export the user abandoned. */
export const CANCELLED = Symbol('export-cancelled')

/**
 * Consult the clock every 16th iteration.
 *
 * Fine enough that a run of expensive items cannot overshoot the budget, coarse
 * enough that the check disappears into the work. Exported so the loops that use
 * it read the same way in both exporters: `if ((i & STRIDE) === 0 && pacer.due())`.
 */
export const STRIDE = 15

/**
 * Time-budgeted pacer: hands the main thread back roughly every `budget` ms.
 *
 * Budgeted by *time* rather than by item count on purpose. The work per item
 * swings by more than an order of magnitude — a segment may take 2 occlusion
 * samples or 64, a triangle may cover one pixel or ten thousand — so any fixed
 * "yield every N items" is either far too coarse on a dense scene or pure
 * overhead on a sparse one. Asking the clock instead makes the cadence the same
 * whatever is being drawn.
 *
 * 24 ms is under a 60 Hz frame, so the overlay keeps painting and the browser
 * never sees an unresponsive page, while the yields themselves stay near a
 * thousandth of the total.
 */
export function makePacer(shouldCancel, budget = 24) {
  let last = performance.now()
  return {
    /**
     * Sync, so callers can ask on nearly every iteration without paying for a
     * promise. An `async` predicate allocates one per call whether or not it
     * yields, which is why this is split in two: an earlier version checked the
     * clock only every 256th item, and 256 segments carrying 64 occlusion samples
     * each is 100 ms — the budget was being honoured at a granularity far coarser
     * than the budget itself, leaving 122 ms stalls in a run meant to breathe
     * every 24.
     */
    due: () => performance.now() - last >= budget,
    async yield() {
      await macrotask()
      last = performance.now()
      if (shouldCancel?.()) throw CANCELLED
    },
  }
}

/**
 * Report progress as whole percentage points.
 *
 * Every call re-renders the app, so reporting each yield would redraw the entire
 * tree hundreds of times during an export and cost more than the work it is
 * describing. A bar cannot show more than a hundred positions anyway.
 */
export function makeReporter(onProgress) {
  let lastPct = -1
  return (frac, label) => {
    if (!onProgress) return
    const f = frac < 0 ? 0 : frac > 1 ? 1 : frac
    const pct = Math.round(f * 100)
    if (pct === lastPct) return
    lastPct = pct
    onProgress(f, label)
  }
}
