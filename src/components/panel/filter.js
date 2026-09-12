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

/** Does a section survive the current filter? Exported so the panel can count. */
export function sectionMatches(title, terms, q) {
  return !q || `${title} ${terms || ''}`.toLowerCase().includes(q)
}
