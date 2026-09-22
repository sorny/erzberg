/**
 * The reset table, against the panel it claims to describe.
 *
 * Two checks, and both matter for the same reason: a reset that touches a key
 * the section does not own destroys work somewhere the user was not looking,
 * and one that misses a key leaves a section half-reset with no sign of it.
 *
 *  1. **Exactly one owner.** Every key in the four default objects belongs to
 *     one section and no more. Unowned keys are listed explicitly, so adding a
 *     parameter and forgetting the table is a failure rather than a silence.
 *
 *  2. **The owner is the section that draws it.** The panel source is read and
 *     each `<Section>`'s own JSX is scanned for parameter names. A control moved
 *     from one section to another is the realistic way this table goes stale,
 *     and nothing else would catch it.
 */
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from '../../src/defaults'
import { PANEL_MODES } from '../../src/components/panel/sectionSummary'
import { SECTION_TERMS } from '../../src/components/panel/sectionTerms'
import {
  ALSO_READS, MODE_ID, MODE_READS, SECTION_PARAMS, UNEXPOSED,
  paramsForSection, sectionHasParams,
} from '../../src/components/panel/sectionParams'

const ALL = [...Object.keys(TERRAIN_DEF), ...Object.keys(STYLE_DEF),
  ...Object.keys(POINTS_DEF), ...Object.keys(VIEW_DEF)]
const TITLES = Object.keys(SECTION_TERMS)

/**
 * Sections that hold no parameters at all.
 *
 * Every one is an action rather than a setting — a fetch, a run, a chart, a
 * list of files — so there is nothing a reset would put back. Stated, so that a
 * section losing its controls to a refactor shows up here instead of quietly
 * growing an inert button.
 */
const ACTIONS = [
  'Presets', 'Draw Modes', 'Analysis', 'Fetch Terrain', 'Hydraulic Erosion',
  'Soundscapes', 'Vector Layers', 'Text',
  // Land Cover holds a loaded file and the action that deals marks from it, the
  // same shape as Vector Layers. The per-layer `coverMask*` keys it gives
  // meaning to are parameters, but they belong to the mode sections that render
  // them, not to this one.
  'Land Cover',
  // Masks holds the list and the Studio that draws into it. The per-layer
  // `layerMask*` keys it gives meaning to belong to the mode sections that
  // render them, exactly as the cover classes' do.
  'Masks',
]

describe('the partition', () => {
  it('gives every parameter exactly one owner', () => {
    const owners = new Map()
    for (const title of TITLES) {
      for (const k of paramsForSection(title, ALL)) {
        owners.set(k, [...(owners.get(k) ?? []), title])
      }
    }
    const shared = [...owners].filter(([, ts]) => ts.length > 1)
      .map(([k, ts]) => `${k} → ${ts.join(' + ')}`)
    expect(shared, `owned twice:\n${shared.join('\n')}`).toEqual([])

    const orphans = ALL.filter((k) => !owners.has(k)).sort()
    expect(orphans, `owned by nothing:\n${orphans.join(' ')}`).toEqual([])
  })

  it('resolves ZeroCross to Crossings and not to Crosshatch', () => {
    /*
     * The one collision in 672 keys, and the reason the rule is longest-suffix
     * rather than first-match. Crosshatch is section 12 and Crossings is 36, so
     * a first-match rule hands twelve of Crossings' parameters to Crosshatch —
     * and a reset three sections up then flattens a mode the user never touched.
     */
    const cross = paramsForSection('Mode: Crosshatch', ALL)
    const zero = paramsForSection('Mode: Crossings', ALL)
    expect(zero).toContain('spacingZeroCross')
    expect(cross).not.toContain('spacingZeroCross')
    expect(cross).toContain('spacingCross')
    expect(cross.some((k) => k.endsWith('ZeroCross'))).toBe(false)
  })

  it('gives every draw mode its own switch back', () => {
    // The minimum a mode's reset must reach: if the `enabled…` key is missing,
    // a mode turned on stays on through a reset that claims to undo it.
    for (const [title, enabled] of PANEL_MODES) {
      expect(paramsForSection(title, ALL), title).toContain(enabled)
    }
  })

  it('says which sections hold nothing to reset', () => {
    const empty = TITLES.filter((t) => !sectionHasParams(t, ALL)).sort()
    expect(empty).toEqual([...ACTIONS].sort())
  })

  it('names a real section in every table key', () => {
    for (const t of [...Object.keys(SECTION_PARAMS), ...Object.keys(ALSO_READS)]) {
      expect(TITLES, `${t} is not a section`).toContain(t)
    }
  })
})

describe('the table against the panel source', () => {
  /** The parameter names each `<Section>`'s own JSX mentions. */
  const rendered = (() => {
    const files = ['src/components/Sidebar.jsx', 'src/components/panel/ErosionSection.jsx',
      'src/components/panel/TextSection.jsx', 'src/components/panel/ModeSheet.jsx']
    const known = new Set(ALL)
    const out = {}
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const marks = [...src.matchAll(/<Section\s+title="([^"]+)"/g)]
      for (let i = 0; i < marks.length; i++) {
        const chunk = src.slice(marks[i].index,
          i + 1 < marks.length ? marks[i + 1].index : src.length)
        const set = (out[marks[i][1]] ??= new Set())
        for (const m of chunk.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\b/g)) {
          if (known.has(m[1])) set.add(m[1])
        }
      }
    }
    return out
  })()

  it('found the sections in the source at all', () => {
    // The guard on the guard: a change to how sections are declared would
    // otherwise leave every check below passing over an empty set.
    expect(Object.keys(rendered).length).toBeGreaterThan(40)
    expect(rendered['Hillshade']?.has('hillshadeAzimuth')).toBe(true)
  })

  it('lists no parameter the section does not draw', () => {
    // A key in the table that the section's JSX never mentions is a key that
    // moved, or one that was never there. Modes are exempt: their parameters
    // are generated from the id and reach the JSX through computed names.
    const bad = []
    for (const title of Object.keys(SECTION_PARAMS)) {
      if (MODE_ID.has(title)) continue
      for (const k of paramsForSection(title, ALL)) {
        if (UNEXPOSED.includes(k)) continue
        if (!rendered[title]?.has(k)) bad.push(`${title} claims ${k}, which it does not render`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('accounts for every parameter a section draws', () => {
    // The other direction, and the one that catches a control moved *in*: a key
    // rendered by a section that neither owns it nor declares it a read.
    const bad = []
    for (const [title, keys] of Object.entries(rendered)) {
      const own = new Set(paramsForSection(title, ALL))
      const reads = new Set([...(ALSO_READS[title] ?? []), ...(MODE_ID.has(title) ? MODE_READS : [])])
      for (const k of keys) {
        if (!own.has(k) && !reads.has(k)) bad.push(`${title} renders ${k}, which it neither owns nor lists as a read`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('has a control for everything but the three that never had one', () => {
    /*
     * The inverse of `UNEXPOSED`, so the list cannot quietly grow: a parameter
     * added without a control has to be admitted here rather than just skipped.
     *
     * Mode parameters are outside this. A mode's section builds its control
     * names — `weight${id}`, `hypsoInterval${id}` — so none of them appears as
     * a literal anywhere and a source scan can never see them. That is also
     * why they need no table: the same convention that hides them from the
     * scan is what makes them derivable.
     */
    const modeOwned = new Set(TITLES.filter((t) => MODE_ID.has(t))
      .flatMap((t) => paramsForSection(t, ALL)))
    const invisible = ALL.filter((k) => !modeOwned.has(k)
      && !Object.values(rendered).some((s) => s.has(k)))
    expect(invisible.sort()).toEqual([...UNEXPOSED].sort())
  })

  it('declares no read that is not actually read', () => {
    const stale = []
    for (const [title, keys] of Object.entries(ALSO_READS)) {
      for (const k of keys) {
        if (!rendered[title]?.has(k)) stale.push(`${title} lists ${k} as a read, but does not mention it`)
      }
    }
    expect(stale, stale.join('\n')).toEqual([])
  })
})
