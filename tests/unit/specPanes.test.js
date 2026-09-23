/**
 * Every spec must reach only the panes it actually selects.
 *
 * The panel shows one of seven destinations at a time, so a control outside the
 * opening pane is in the DOM and hidden. `toHaveCount` and `toHaveAttribute`
 * still see it. `click` and `fill` do not.
 *
 * ── Why this is a test and not a grep ────────────────────────────────────────
 * The stage rail shipped in v1.20.0 with five spec files left red, and they
 * stayed red through a release. The migration was scoped by grepping the specs
 * for `section-…` handles, which finds only the specs that navigate *by
 * section*. A spec that reaches a control by its own handle — `export-svg`,
 * `surprise-me` — is invisible to that search, and those five reach the export
 * buttons exactly that way. Each failed on a download that never came, three
 * hundred lines from the cause.
 *
 * So the question is asked of the source instead of a search pattern: which
 * section owns each handle, which pane owns that section, and does the spec
 * ever go there. It runs in milliseconds and it cannot go stale, because both
 * halves are read from the files that define them.
 *
 * ── Belonging to a stage without belonging to a section ──────────────────────
 * The load block — the two upload buttons, the filename, Edit heightmap, the
 * style link — sits inside `<Stage n={1}>` but above its first `<Section>`. It
 * is not always on screen: it is Terrain's, and it is hidden in every other
 * pane. Treating it as loose chrome is what let `clip-to-feature.spec.js` click
 * Edit heightmap from Overlay and wait three minutes for it.
 *
 * Only the stats line, below the last `</Stage>`, is genuinely always visible.
 *
 * And a spec can reach a pane through the app rather than through a helper —
 * the style link under the load block carries you to Looks and opens the grid.
 * Those routes are listed in `IN_APP_ROUTES`, because a rule that cannot see
 * them would fail an honest spec and teach everyone to ignore it.
 */
import { readFileSync, readdirSync } from 'fs'
import { describe, expect, it } from 'vitest'

const SIDEBAR = 'src/components/Sidebar.jsx'
/**
 * Sections that live in their own file, and the section they are.
 *
 * Their labels have to be counted or the uniqueness rule lies: `Use single-line
 * font` is in Contours *and* in Text, and reading only `Sidebar.jsx` makes it
 * look unique to Marks — which then blames any spec that touches Text.
 */
const OUTBOARD = {
  'src/components/panel/TextSection.jsx': 'Text',
  'src/components/panel/ErosionSection.jsx': 'Hydraulic Erosion',
}
const STAGES  = 'src/components/panel/stages.js'
const PANE    = { 0: 'presets', 1: 'terrain', 2: 'surface', 3: 'marks', 4: 'overlay', 5: 'frame', 6: 'output' }

/** The pane a spec lands in by clicking something the app itself navigates with. */
const IN_APP_ROUTES = { 'jump-to-presets': 'presets' }

/** Section title → stage number, read from the index that states it. */
function stageOfSection() {
  const body = readFileSync(STAGES, 'utf8').split('const STATED')[1].split('\n}')[0]
  const out = {}
  for (const m of body.matchAll(/'([^']+)':\s*(\d)/g)) out[m[1]] = Number(m[2])
  return out
}

/**
 * Handle → the stage that holds it.
 *
 * A section owns a handle only between its own tag and its own `</Section>`.
 * Everything after that and before the next section belongs to the stage rather
 * than to any section in it, and is on screen whichever pane is selected.
 */
function stageOfHandle() {
  const src = readFileSync(SIDEBAR, 'utf8')
  const stated = stageOfSection()
  const marks = [...src.matchAll(/<Section\s+title="([^"]+)"/g)].map((m) => [m.index, m[1]])
  const lastClose = src.lastIndexOf('</Stage>')
  // Each stage's opening tag, so the run before its first section can be
  // credited to the stage that holds it.
  const stageTags = [...src.matchAll(/<Stage n=\{(\d)\}/g)].map((m) => [m.index, Number(m[1])])
  const owned = {}
  const loose = new Set()
  const labelSeen = {}
  /*
   * Both spellings. Most handles are written as the attribute, but the panel's
   * shared controls take one as a prop — `<ExpBtn testId="export-svg">` — and a
   * scanner that reads only the attribute misses every export button. That is
   * the same blind spot, one level down, as the grep this test replaces.
   */
  const handles = (t) =>
    [...t.matchAll(/(?:data-testid|testId)="([a-z0-9:&-]+)"/g)].map((m) => m[1])
  /*
   * Controls reached by their visible name.
   *
   * `Sl`, `InlineSl` and `Tog` publish their `label` as the `aria-label`, so a
   * spec can select on that instead of a handle. `benchmark.spec.js` reaches
   * the rotation slider that way, and it broke on the rail without this test
   * noticing — handles alone were a floor, just a much higher one than a grep.
   *
   * Only labels unique to one section are usable: `Opacity`, `Colour` and
   * `Size` appear in a dozen places, so a spec naming one of those could mean
   * any pane. The uniqueness filter runs after the whole file is scanned.
   */
  const labels = (t) => [...t.matchAll(/\blabel="([^"]{1,34})"/g)].map((m) => m[1])
  /*
   * Sliders reached by their numeric range.
   *
   * `input[type="range"][min="-180"]` is how four specs found Rotation, and
   * `[min="0"][max="180"][step="0.1"]` is how five found Tilt. No handle, no
   * label — just the shape of the control. Each `Sl` and `InlineSl` declares
   * those numbers, so the same range read out of the panel names the pane.
   *
   * Keyed `range:min:max`, and unique ranges only. Most are not: `0:180` is
   * Camera's tilt *and* three hatch angles, and `-180` is Rotation and two
   * longitudes. Those stay unmapped, which is honest — the selector is just as
   * ambiguous in the DOM, and the specs that use it work only because the other
   * matches belong to sections that are switched off. `10:400` (Zoom) and `1:2`
   * (Supersampling) are unique, and those two are covered.
   */
  const ranges = (t) =>
    [...t.matchAll(/\bmin=\{(-?[\d.]+)\}\s+max=\{(-?[\d.]+)\}/g)]
      .map((m) => `range:${m[1]}:${m[2]}`)

  marks.forEach(([pos, title], i) => {
    const end = i + 1 < marks.length ? marks[i + 1][0] : lastClose
    const stage = stated[title] ?? (title.startsWith('Mode:') ? 3 : null)
    const chunk = src.slice(pos, end)
    const c = chunk.lastIndexOf('</Section>')
    const own = c > 0 ? chunk.slice(0, c) : chunk
    const rest = c > 0 ? chunk.slice(c) : ''
    for (const h of handles(own)) {
      if (/^(section-|mode-|stage|group-)/.test(h)) continue
      if (stage != null && !(h in owned)) owned[h] = stage
    }
    for (const h of handles(rest)) loose.add(h)
    for (const l of [...labels(own), ...ranges(own)]) {
      if (stage == null) continue
      ;(labelSeen[l] ??= new Set()).add(stage)
    }
  })
  // The run from each `<Stage>` tag to the next section belongs to that stage.
  stageTags.forEach(([pos, stage]) => {
    const firstSection = marks.find(([p]) => p > pos)
    const end = firstSection ? firstSection[0] : lastClose
    for (const h of handles(src.slice(pos, end))) {
      if (/^(section-|mode-|stage|group-)/.test(h)) continue
      if (!(h in owned)) owned[h] = stage
    }
  })
  for (const h of handles(src.slice(lastClose))) loose.add(h)
  for (const [file, title] of Object.entries(OUTBOARD)) {
    const stage = stated[title]
    for (const l of labels(readFileSync(file, 'utf8'))) {
      if (stage != null) (labelSeen[l] ??= new Set()).add(stage)
    }
  }
  for (const h of loose) delete owned[h]
  // A label that two sections share names no single pane, so it teaches nothing.
  for (const [l, stages] of Object.entries(labelSeen)) {
    if (stages.size === 1 && !(l in owned)) owned[l] = [...stages][0]
  }
  return owned
}

describe('specs and the panes they reach', () => {
  const owned = stageOfHandle()
  const stated = stageOfSection()

  it('maps a useful number of handles', () => {
    // The guard on the guard: a change to how sections are declared would
    // otherwise leave the check below passing over an empty map.
    expect(Object.keys(owned).length).toBeGreaterThan(15)
    expect(owned['export-svg']).toBe(6)
    expect(owned['surprise-me']).toBe(0)
  })

  /**
   * The ordering case, which the check above cannot see.
   *
   * Terrain is the opening pane, so a spec that only ever works there selects
   * nothing and is right not to. But a spec that goes to another pane and then
   * touches a Terrain control has to come back, and whether it does is a
   * question about *sequence* — invisible to a scan that only asks which panes
   * a file names. `clip-to-feature.spec.js` fetched boundaries in Overlay and
   * then clicked Edit heightmap, which is at the top of Terrain, and waited
   * three minutes for a button in a hidden pane.
   *
   * So this one reads positions: for each Terrain handle, is there an
   * `openStage` to somewhere else before it, with no return to Terrain in
   * between. It is a line-order approximation and not a control-flow analysis —
   * a helper called from the top of a file lands wherever it is defined — so it
   * reports only what it can see plainly, and the check is deliberately narrow.
   */
  it('returns to Terrain before touching a Terrain control', () => {
    const terrainHandles = Object.entries(owned)
      .filter(([, stage]) => stage === 1).map(([h]) => h)
    const bad = []
    for (const f of ['helpers.js', ...readdirSync('tests').filter((n) => n.endsWith('.spec.js'))]) {
      const src = readFileSync(`tests/${f}`, 'utf8')
      /*
       * Typing in the filter is a route to anywhere.
       *
       * A query crosses every pane and forces each survivor open, so a spec
       * that filters for a section reaches it wherever it lives. `masks.spec.js`
       * does exactly that, and counting it as a move is what keeps this check
       * from crying wolf at an honest spec.
       *
       * One level of local helper is resolved with it: a spec that wraps the
       * filter in `filter(page, term)` — or the rail in a helper of its own —
       * is doing the same thing one call deep, and the wrapper is usually
       * defined above the tests that use it, which is precisely where a
       * line-order scan would otherwise lose it.
       */
      const routed = [...src.matchAll(/(?:async )?function (\w+)\s*\([\s\S]{0,400}?\n\}/g)]
        .filter((m) => /panel-filter|openStage\(/.test(m[0]))
        .map((m) => m[1])
      const moves = [
        ...[...src.matchAll(/openStage\([^)]*?'(\w+)'/g)].map((m) => [m.index, m[1]]),
        ...[...src.matchAll(/panel-filter/g)].map((m) => [m.index, 'terrain']),
        ...routed.flatMap((fn) =>
          [...src.matchAll(new RegExp(`\\b${fn}\\(page`, 'g'))].map((m) => [m.index, 'terrain'])),
      ].sort((a, b) => a[0] - b[0])
      if (!moves.some(([, pane]) => pane !== 'terrain')) continue
      for (const h of terrainHandles) {
        for (const m of src.matchAll(new RegExp(`data-testid="${h}"`, 'g'))) {
          const before = moves.filter(([i]) => i < m.index)
          if (before.length && before[before.length - 1][1] !== 'terrain') {
            bad.push(`${f}: ${h} after openStage('${before[before.length - 1][1]}')`)
          }
        }
      }
    }
    expect(bad, `Terrain controls touched from another pane:\n  ${bad.join('\n  ')}`).toEqual([])
  })

  it('never reaches a control in a pane it does not select', () => {
    const bad = []
    /*
     * `helpers.js` is scanned with the specs, and it is the one that matters
     * most: every spec calls `resetToDefaults`, so a control it reaches in an
     * unselected pane fails the whole suite rather than one test. That is
     * exactly what happened — the helper collapsed the Presets grid, Presets
     * moved to a pane of its own, and sixty seconds of timeout landed on every
     * spec in the project. A shared helper must open what it touches.
     */
    for (const f of ['helpers.js', ...readdirSync('tests').filter((n) => n.endsWith('.spec.js'))]) {
      const src = readFileSync(`tests/${f}`, 'utf8')
      // Any string literal inside an `openStage(...)` call counts, so a helper
      // that defaults its pane — `openStage(page, stage ?? 'surface')` — is seen.
      const opened = new Set([...src.matchAll(/openStage\([^)]*?'(\w+)'/g)].map((m) => m[1]))
      if (/openMark\(|setMark\(|switchMarkOn\(/.test(src)) opened.add('marks')
      /*
       * A spec that types in the filter can reach anything.
       *
       * A query crosses every pane and forces each survivor open, so once a
       * file uses the filter this check cannot say where a control was reached
       * from. That is a real limit and the exemption is deliberately whole-file:
       * a narrower guess would fail honest specs, and a check people learn to
       * ignore is worse than no check. The ordering test below still applies.
       */
      if (src.includes('panel-filter')) continue
      for (const [handle, pane] of Object.entries(IN_APP_ROUTES)) {
        if (src.includes(`"${handle}"`)) opened.add(pane)
      }
      /*
       * Three ways a spec names a control, and it has to be all three.
       *
       * Handles and labels were covered. `data-section="Mode: Lines"` was not,
       * and `export.spec.js`, `curvature.spec.js` and `contour-labels.spec.js`
       * all reached into a mark's section that way — behind the sheet, in a
       * pane they never opened.
       */
      const touched = new Set([
        ...[...src.matchAll(/data-testid="([a-z0-9:&-]+)"/g)].map((x) => x[1]),
        ...[...src.matchAll(/aria-label="([^"]{1,34})"/g)].map((x) => x[1]),
        ...[...src.matchAll(/data-section="([^"]+)"/g)].map((x) => x[1]),
        ...[...src.matchAll(/\[min="(-?[\d.]+)"\]\[max="(-?[\d.]+)"\]/g)]
          .map((x) => `range:${x[1]}:${x[2]}`),
        ...[...src.matchAll(/\[type="range"\]\[min="(-?[\d.]+)"\](?!\[max)/g)]
          .map((x) => `range:${x[1]}:180`),
      ])
      for (const m of touched) {
        // A `data-section` names a section directly, so the stage index answers
        // for it without going through the handle map.
        const stage = owned[m] ?? stated[m] ?? (m.startsWith('Mode: ') ? 3 : undefined)
        // Terrain is the opening pane, so nothing there needs selecting.
        if (stage == null || stage === 1) continue
        if (!opened.has(PANE[stage])) bad.push(`${f}: ${m} is in ${PANE[stage]}`)
      }
    }
    expect(bad, `specs reaching a hidden pane:\n  ${bad.join('\n  ')}`).toEqual([])
  })
})
