/**
 * A mode has one name. The Marks sheet shows the `label` in drawModes.js and
 * The Marks sheet and the section header show the `Mode: …` title; copies,
 * pen layers and the command line use the `label` in drawModes.js. They drifted
 * apart once (Ridges / Ridge, Flow lines / Flow) and nothing noticed. The title is in
 * title case as every section header is, so the comparison ignores case.
 */
import { describe, expect, it } from 'vitest'
import { DRAW_MODES } from '../../src/utils/drawModes'
import { PANEL_MODES } from '../../src/components/panel/sectionSummary'

describe('mode names', () => {
  it('match between the sheet and the section', () => {
    const off = []
    for (const [title, key] of PANEL_MODES) {
      const mode = DRAW_MODES.find((m) => `enabled${m.id}` === key)
      if (!mode) continue
      if (title.toLowerCase() !== `mode: ${mode.label}`.toLowerCase()) off.push(`${title} ≠ ${mode.label}`)
    }
    expect(off).toEqual([])
  })
})
