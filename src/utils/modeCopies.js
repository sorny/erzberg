/**
 * Copies of a draw mode: the data half. The panel half is ModeCopies.jsx.
 *
 * A copy is `{ uid, mode, name, values }`, kept in `style.modeCopies`. `values`
 * is a snapshot of every key the mode's section owns (`paramsForSection`),
 * taken when the copy is made. From then on the copy and the original change
 * independently: the dispatcher builds the copy against `values` over the bus,
 * and `layerStyle` resolves its layers the same way.
 *
 * The section index is the right list of keys because it is the one already
 * held to the panel's JSX by its unit test, and it includes the older keys
 * without the mode suffix (`styleHachure`, `pillarStyle`).
 */
import { MODE_LABEL } from './drawModes'
import { STYLE_DEF } from '../defaults'
import { paramsForSection } from '../components/panel/sectionParams'
import { PANEL_MODES } from '../components/panel/sectionSummary'

const STYLE_KEYS = Object.keys(STYLE_DEF)
const TITLE_OF = new Map(PANEL_MODES.map(([title, enabled]) => [enabled.slice(7), title]))

/** The section title of a mode id: `Contours` → `Mode: Contours`. */
export const modeTitle = (mode) => TITLE_OF.get(mode) ?? null

/** Every style key a copy of `mode` carries. */
export function ownedKeys(mode) {
  const title = modeTitle(mode)
  return title ? paramsForSection(title, STYLE_KEYS).filter((k) => k !== 'modeCopies') : []
}

/** The next free uid, counted from the list so a restored session cannot collide. */
export function nextUid(copies) {
  let n = 0
  for (const c of copies ?? []) {
    const m = /^c(\d+)$/.exec(c.uid ?? '')
    if (m) n = Math.max(n, Number(m[1]))
  }
  return `c${n + 1}`
}

/** `Contours 2`, `Contours 3`, … — the first number no copy of the mode uses. */
function nextName(mode, copies) {
  const label = MODE_LABEL[mode] ?? mode
  const used = new Set((copies ?? []).filter((c) => c.mode === mode).map((c) => c.name))
  let n = 2
  while (used.has(`${label} ${n}`)) n++
  return `${label} ${n}`
}

/**
 * A new copy of `mode`, from `source` (the live style, or another copy's
 * merged view). It starts on, whatever the source was: you asked for it.
 */
export function makeCopy(mode, source, copies) {
  const values = {}
  for (const k of ownedKeys(mode)) if (source[k] !== undefined) values[k] = source[k]
  values[`enabled${mode}`] = true
  return { uid: nextUid(copies), mode, name: nextName(mode, copies), values }
}

/** The style a copy's controls read: the live style with the copy's values over it. */
export const copyView = (style, copy) => ({ ...style, ...copy.values })

/** A patch from the copy's controls, kept to the keys the copy owns. */
export function patchCopy(copies, uid, patch) {
  return copies.map((c) => {
    if (c.uid !== uid) return c
    const own = new Set(ownedKeys(c.mode))
    const values = { ...c.values }
    for (const [k, v] of Object.entries(patch)) if (own.has(k)) values[k] = v
    return { ...c, values }
  })
}
