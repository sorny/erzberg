/**
 * Strings from a command line, turned into the values the panel would have set.
 *
 * The CLI hands the page `key=value` pairs as text, and the type each value must
 * become is already stated once: it is the type of the key's default in
 * `defaults.js`. So `intervalContours=6` is a number because its default is,
 * `labelContours=on` is a boolean, and `bgColor=#fff` stays a string. Nothing
 * here lists a key by hand, which is what keeps it from falling behind a new
 * parameter.
 *
 * Unknown keys and values that do not parse are collected rather than thrown
 * one at a time, so a script with three typos hears about all three at once.
 */
import { DRAW_MODES } from './drawModes'
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from '../defaults'

const DEFAULTS = { ...TERRAIN_DEF, ...STYLE_DEF, ...POINTS_DEF, ...VIEW_DEF }

const TRUE = new Set(['true', '1', 'on', 'yes'])
const FALSE = new Set(['false', '0', 'off', 'no'])

/** One value against its default's type. Returns `{ value }` or `{ error }`. */
export function coerceValue(key, raw) {
  if (!Object.hasOwn(DEFAULTS, key)) return { error: `unknown parameter "${key}"` }
  const def = DEFAULTS[key]
  const text = String(raw).trim()
  if (typeof def === 'boolean') {
    const t = text.toLowerCase()
    if (TRUE.has(t)) return { value: true }
    if (FALSE.has(t)) return { value: false }
    return { error: `${key} takes true or false, not "${raw}"` }
  }
  if (typeof def === 'number') {
    const n = Number(text)
    return text !== '' && Number.isFinite(n) ? { value: n } : { error: `${key} takes a number, not "${raw}"` }
  }
  if (typeof def === 'string') return { value: String(raw) }
  // Arrays, objects and null defaults: JSON, or the bare string for a null whose
  // value is plainly not JSON (a colour, a name).
  try {
    return { value: JSON.parse(text) }
  } catch {
    return def === null ? { value: String(raw) } : { error: `${key} takes JSON, not "${raw}"` }
  }
}

/** A flat `{ key: text }` → `{ values, errors }`. */
export function coerceParams(raw) {
  const values = {}, errors = []
  for (const [k, v] of Object.entries(raw ?? {})) {
    const r = coerceValue(k, v)
    if (r.error) errors.push(r.error)
    else values[k] = r.value
  }
  return { values, errors }
}

/**
 * Mode names as a person types them → mode ids.
 *
 * The id (`Contours`), its label (`Network`), an older label (`Stream network`) and either one in any case
 * all name the same mode, because a script author reads labels in the panel and
 * ids in the docs.
 */
export function resolveModes(names) {
  const byName = new Map()
  for (const m of DRAW_MODES) {
    byName.set(m.id.toLowerCase(), m.id)
    byName.set(m.label.toLowerCase(), m.id)
    for (const a of m.aliases ?? []) byName.set(a.toLowerCase(), m.id)
  }
  const ids = [], errors = []
  for (const n of names ?? []) {
    const id = byName.get(String(n).trim().toLowerCase())
    if (id) ids.push(id)
    else errors.push(`unknown draw mode "${n}"`)
  }
  return { ids, errors }
}

/** The style patch that switches `ids` on, and with `only`, every other mode off. */
export function modePatch(ids, only = false) {
  const patch = {}
  if (only) for (const m of DRAW_MODES) patch[`enabled${m.id}`] = false
  for (const id of ids) patch[`enabled${id}`] = true
  return patch
}
