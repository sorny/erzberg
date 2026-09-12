/**
 * What changed between two snapshots, in words.
 *
 * ── Why this can exist now ───────────────────────────────────────────────────
 * `useHistory` argues at length against a command-pattern history: several
 * hundred mutation sites would each have to describe themselves, nothing would
 * keep that honest, and the first control anybody forgot to annotate would be
 * silently unnamed. All of that is still true.
 *
 * What changed is that `panel/sectionParams.js` now holds a complete map from
 * parameter to the section that owns it, checked against the panel's own source
 * in both directions. So a name can be *derived* from the diff instead of
 * declared at the mutation site: no control has to opt in, and the naming
 * cannot go stale, because it reads the same index the per-section reset does.
 *
 * ── What a name is ───────────────────────────────────────────────────────────
 * The section, because that is what a person navigates by — "the thing I did to
 * Hillshade", not "hillshadeAzimuth". Where one switch moved, the mode is named
 * outright: `Stipple Dots on` reads as the action it was.
 *
 * There is deliberately no parameter-to-English table. That would be a second
 * index over the same 672 keys, maintained by hand, to turn `hillshadeAzimuth`
 * into `Azimuth` — and the section name plus a count already tells you where to
 * look, which is the whole job of a history entry.
 */
import { PANEL_MODES } from '../components/panel/sectionSummary'
import { SECTION_TERMS } from '../components/panel/sectionTerms'
import { paramsForSection } from '../components/panel/sectionParams'

/** The four parameter slots of a snapshot, in the order App tracks them. */
const PARAM_SLOTS = 4

/** The slots that are not parameter groups, and what to call each. */
const OTHER_SLOTS = [
  [4, 'Gradient'],
  [5, 'Background gradient'],
  [6, 'Text'],
  [7, 'Vector layers'],
  [8, 'Vector layers'],
]

/** `enabledStipple` → `Stipple Dots`. */
const MODE_OF_SWITCH = new Map(
  PANEL_MODES.map(([title, enabled]) => [enabled, title.replace(/^Mode:\s*/, '')]))

/** key → owning section, built once from the same index the reset uses. */
const SECTION_OF = (() => {
  const m = new Map()
  const titles = Object.keys(SECTION_TERMS)
  return (allKeys) => {
    if (m.size) return m
    for (const title of titles) {
      for (const k of paramsForSection(title, allKeys)) if (!m.has(k)) m.set(k, title)
    }
    return m
  }
})()

/** The keys that differ between two parameter-group objects. */
function changedKeys(before, after) {
  if (before === after) return []
  const out = []
  for (const k of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (before?.[k] !== after?.[k]) out.push(k)
  }
  return out
}

/**
 * A name for the step from `before` to `after`.
 *
 * Returns null when nothing recognisable moved, which the caller treats as an
 * unnamed step rather than suppressing it — a step that happened must stay in
 * the stack whether or not this could describe it.
 */
export function describeChange(before, after, allKeys) {
  if (!before || !after) return null
  const sections = new Map()
  const keys = []
  for (let i = 0; i < PARAM_SLOTS; i++) {
    for (const k of changedKeys(before[i], after[i])) {
      keys.push(k)
      const title = SECTION_OF(allKeys).get(k)
      if (title) sections.set(title, (sections.get(title) ?? 0) + 1)
    }
  }

  // One switch, named as the action it was. `enabled…` is the only key whose
  // meaning is obvious without a label for it, and it is also the one most
  // worth reading back: a history of "Stipple Dots on / Contours off" is a
  // record of decisions rather than of adjustments.
  if (keys.length === 1 && MODE_OF_SWITCH.has(keys[0])) {
    const on = after[1]?.[keys[0]]
    return `${MODE_OF_SWITCH.get(keys[0])} ${on ? 'on' : 'off'}`
  }

  const others = OTHER_SLOTS
    .filter(([i]) => before[i] !== after[i])
    .map(([, name]) => name)
  for (const name of new Set(others)) sections.set(name, (sections.get(name) ?? 0) + 1)

  if (!sections.size) return null
  if (sections.size === 1) {
    const [title, n] = [...sections][0]
    const short = title.replace(/^Mode:\s*/, '')
    return n > 1 ? `${short} · ${n} changes` : short
  }
  // Spread across the panel: a preset, a randomised roll, a reset. The caller
  // usually knows which and tags it; this is the honest fallback when it does
  // not, and it still says how far the change reached.
  return `${sections.size} sections`
}
