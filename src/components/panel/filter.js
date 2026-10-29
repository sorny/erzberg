/**
 * The panel filter, kept out of ui.jsx so that file exports components only and
 * fast refresh keeps working.
 *
 * `SectionFilter` carries `{ q, terms, summaries, modified, onReset }`: what is
 * typed (lowercased), a map from section title to the extra words that section
 * should answer to, each section's shut-state readout, the set of sections that
 * differ from their defaults, and the callback that puts one back.
 *
 * A context rather than props on all fifty-five sections. Every one of these is
 * a single value the whole panel reads, and threading five of them through
 * `<Section>` at every call site is fifty-five edits for each one added.
 */
import { createContext } from 'react'

export const SectionFilter = createContext(null)

/**
 * Which of the six stage panes is on screen, on the same terms.
 *
 * Carries `{ stage, setStage }`. A context rather than a prop, because the
 * reader is `<Stage>` — six call sites — and the writers are the rail, the
 * filter's jump links and the Presets shortcut, which sit in three different
 * parts of the panel and share no parent below the `<aside>`.
 *
 * `null` means no rail is mounted, and every stage then renders at once. That is
 * the old panel exactly, and it is what the specs that predate the rail see if
 * they mount a `<Stage>` on its own.
 */
export const PanelStage = createContext(null)

/**
 * The loaded land-cover plate, for the same reason and on the same terms.
 *
 * Every draw mode carries a class mask, and the control for it lives in the one
 * shared `ModeStyleOverride` that all forty mode sections render. The
 * plate is a single value that control needs and no call site has, so threading
 * it as a prop would be forty edits to hand every section the same object.
 *
 * `null` is the ordinary state — no plate loaded — and the control renders
 * nothing at all in that case, so a panel that has never seen a cover file looks
 * exactly as it always did.
 */
export const CoverPlate = createContext(null)

/**
 * Does a section survive the current filter? Exported so the panel can count.
 *
 * The query has to start a word. Anywhere in a word, "pen" found "open" and
 * "OpenStreetMap" and put Fetch and Land Cover above the pen strip.
 */
export function sectionMatches(title, terms, q) {
  if (!q) return true
  const text = `${title} ${terms || ''}`.toLowerCase()
  const starts = (w) => {
    for (let at = text.indexOf(w); at !== -1; at = text.indexOf(w, at + 1)) {
      if (at === 0 || !/[a-z0-9]/.test(text[at - 1])) return true
    }
    return false
  }
  // Each word on its own, in any order. The label index is a bag of words, so
  // "sun altitude" as one string found nothing where both words were there.
  return q.trim().split(/\s+/).every(starts)
}

/**
 * Up to `n` words from the index close to a query that found nothing: the ones
 * it starts, then the ones a typo or two away. A miss used to leave a blank pane
 * and "No section matches", with nowhere to go from there.
 */
export function suggestTerms(q, index, n = 3) {
  if (!q || q.length < 2) return []
  const words = new Set()
  for (const [title, terms] of Object.entries(index)) {
    for (const w of `${title.replace(/^Mode:\s*/, '')} ${terms || ''}`.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length > 2) words.add(w)
    }
  }
  const dist = (a, b) => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]; row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const t = row[j]
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
        prev = t
      }
    }
    return row[b.length]
  }
  // The word to repair is the first one that finds nothing; the rest stand.
  const all = Object.entries(index).map(([t, w]) => `${t} ${w || ''}`).join(' ')
  const head = q.trim().split(/\s+/).find((w) => !sectionMatches(all, '', w)) ?? q.trim().split(/\s+/)[0]
  const limit = head.length < 5 ? 1 : 2
  // A plural rides on its singular: "contour" and "contours" are one offer.
  for (const w of [...words]) if (w.endsWith('s') && words.has(w.slice(0, -1))) words.delete(w)
  // Against the whole word, or its start at the typed length give or take one,
  // so a dropped letter ("contur") costs one edit and not two.
  const cost = (w) => Math.min(dist(head, w),
    ...[-1, 0, 1].map((k) => (w.length > head.length + k ? dist(head, w.slice(0, head.length + k)) : Infinity)))
  return [...words]
    .map((w) => [w, cost(w)])
    .filter(([, d]) => d <= limit)
    .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .slice(0, n)
    // The whole query back, with only the failing word swapped, so "sun altitdue"
    // offers "sun altitude" and not "altitude" alone.
    .map(([w]) => q.trim().split(/\s+/).map((t) => (t === head ? w : t)).join(' '))
}

/**
 * The hand-drawn masks, on the same terms as `CoverPlate` above.
 *
 * A second context rather than one carrying both, because the two are loaded
 * and cleared independently — a plate arrives from a file, masks are drawn —
 * and a component that needs only one should not re-render when the other moves.
 */
export const PaintedMasks = createContext(null)

/**
 * Mode copies: one mode section's controls, shown for a copy of the mode.
 *
 * `SectionScope` holds a section title while a copy's body renders. Every
 * `Section` then renders nothing but the one with that title, and that one as
 * a bare body. So a copy shows the mode's own controls, read from and written
 * to the copy, with no change to the fifty-six mode bodies.
 *
 * `ModeCopiesPanel` is `{ render(title) }`, which draws the copies block under
 * a mode's body. Null outside the Sidebar. See ModeCopies.jsx.
 */
export const SectionScope = createContext(null)
export const ModeCopiesPanel = createContext(null)
