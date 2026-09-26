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
 * shared `ModeStyleOverride` that all thirty-seven mode sections render. The
 * plate is a single value that control needs and no call site has, so threading
 * it as a prop would be thirty-seven edits to hand every section the same object.
 *
 * `null` is the ordinary state — no plate loaded — and the control renders
 * nothing at all in that case, so a panel that has never seen a cover file looks
 * exactly as it always did.
 */
export const CoverPlate = createContext(null)

/** Does a section survive the current filter? Exported so the panel can count. */
export function sectionMatches(title, terms, q) {
  return !q || `${title} ${terms || ''}`.toLowerCase().includes(q)
}

/**
 * The hand-drawn masks, on the same terms as `CoverPlate` above.
 *
 * A second context rather than one carrying both, because the two are loaded
 * and cleared independently — a plate arrives from a file, masks are drawn —
 * and a component that needs only one should not re-render when the other moves.
 */
export const PaintedMasks = createContext(null)
