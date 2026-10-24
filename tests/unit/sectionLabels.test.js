import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { buildModule, labelsIn, OUT } from '../../scripts/build-section-labels.js'
import { SECTION_LABELS } from '../../src/components/panel/sectionLabels.js'
import { SECTION_TERMS } from '../../src/components/panel/sectionTerms.js'

describe('section labels', () => {
  it('match the panel source — run `npm run section-labels` if this fails', () => {
    expect(readFileSync(OUT, 'utf8')).toBe(buildModule())
  })

  it('name only sections the stated index knows', () => {
    const orphans = Object.keys(SECTION_LABELS).filter((t) => !(t in SECTION_TERMS))
    expect(orphans).toEqual([])
  })

  it('find a control by its label, which the stated terms alone did not', () => {
    const azimuth = Object.keys(SECTION_LABELS).filter((t) => SECTION_LABELS[t].includes('azimuth'))
    expect(azimuth).toEqual(expect.arrayContaining(['Hillshade', 'Mode: Isophotes', 'Mode: Engraving']))
  })

  it('reads only the literal labels between a section and its close', () => {
    const src = `<Section title="A"><InlineSl label="Sun azimuth" /></Section>
      <Tog label="Outside" />
      <Section title="B"><SegGroup label="Dash" /><X label={dyn} /></Section>`
    expect(labelsIn(src)).toEqual({ A: 'sun azimuth', B: 'dash' })
  })
})
