/**
 * The panel filter, kept out of ui.jsx so that file exports components only and
 * fast refresh keeps working.
 *
 * `SectionFilter` carries `{ q, terms }`: what is typed (lowercased) and a map
 * from section title to the extra words that section should answer to. A context
 * rather than props on all thirty-odd sections — it is one value the whole panel
 * reads and nothing writes back.
 */
import { createContext } from 'react'

export const SectionFilter = createContext(null)

/** Does a section survive the current filter? Exported so the panel can count. */
export function sectionMatches(title, terms, q) {
  return !q || `${title} ${terms || ''}`.toLowerCase().includes(q)
}
