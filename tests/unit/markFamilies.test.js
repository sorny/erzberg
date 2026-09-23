/**
 * The families against the panel's own list of marks.
 *
 * `markFamilies.js` is a judgement and not a derivation — nothing in the code
 * knows that Berms and Air are the same idea — so the one thing that *can* be
 * checked is that the judgement covers every mark exactly once. A mode added to
 * `PANEL_MODES` and forgotten here would otherwise vanish from the sheet in
 * silence, which is the whole Marks pane losing a control.
 */
import { describe, expect, it } from 'vitest'
import { FAMILIES } from '../../src/components/panel/markFamilies.js'
import { PANEL_MODES } from '../../src/components/panel/sectionSummary.js'

const listed = FAMILIES.flatMap(([, , names]) => names)
const panel = PANEL_MODES.map(([title]) => title.replace(/^Mode:\s*/, ''))

describe('the mark families', () => {
  it('covers every mark the panel lists', () => {
    const missing = panel.filter((m) => !listed.includes(m))
    expect(missing, `marks with no family: ${missing.join(', ')}`).toEqual([])
  })

  it('names no mark the panel does not have', () => {
    const unknown = listed.filter((m) => !panel.includes(m))
    expect(unknown, `families name marks that do not exist: ${unknown.join(', ')}`).toEqual([])
  })

  it('puts each mark in exactly one family', () => {
    const seen = new Map()
    for (const [family, , names] of FAMILIES) {
      for (const n of names) seen.set(n, (seen.get(n) ?? []).concat(family))
    }
    const twice = [...seen].filter(([, fams]) => fams.length > 1)
    expect(twice.map(([n, f]) => `${n} in ${f.join(' and ')}`)).toEqual([])
    expect(listed.length).toBe(panel.length)
  })

  it('gives every family a name and a gloss', () => {
    for (const [name, gloss, names] of FAMILIES) {
      expect(name, 'a family needs a name').toBeTruthy()
      expect(gloss, `${name} needs a gloss`).toBeTruthy()
      expect(names.length, `${name} is empty`).toBeGreaterThan(0)
    }
  })
})
