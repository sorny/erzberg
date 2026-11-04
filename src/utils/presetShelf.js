/**
 * The preset shelf: looks kept in the browser beside the bundled ones.
 *
 * Saving a look used to download a file, and using it again meant finding that
 * file. The shelf keeps each look with a thumbnail in localStorage, and shows it
 * as its own group in Presets. Each entry stores the preset as the same text a
 * plate carries (`presetToText`), so loading it goes through `parsePreset` and
 * an older entry is migrated like any older file. The shelf as a whole can be
 * written to one file and read back, on this browser or another.
 */
import { parsePreset } from './presetFile'

export const SHELF_KEY = 'erzberg.shelf.v1'
export const SHELF_FORMAT = 1

/** The shelf as stored, or [] when there is none or it cannot be read. */
export function readShelf(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage?.getItem(SHELF_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter(validEntry) : []
  } catch { return [] }
}

/** Store the shelf. False when the browser refuses, for example when it is full. */
export function writeShelf(list, storage = globalThis.localStorage) {
  try { storage.setItem(SHELF_KEY, JSON.stringify(list)); return true } catch { return false }
}

function validEntry(e) {
  return !!e && typeof e.name === 'string' && e.name.trim() !== '' && typeof e.text === 'string'
}

/** `base`, or `base 2`, `base 3`… whichever is not on the shelf yet. */
export function freeName(list, base) {
  const taken = new Set(list.map((e) => e.name))
  const b = (base || 'My preset').trim() || 'My preset'
  if (!taken.has(b)) return b
  for (let i = 2; ; i++) if (!taken.has(`${b} ${i}`)) return `${b} ${i}`
}

/** The shelf with `entry` added first. An entry of the same name is replaced. */
export function addToShelf(list, entry) {
  return [entry, ...list.filter((e) => e.name !== entry.name)]
}

export function removeFromShelf(list, name) {
  return list.filter((e) => e.name !== name)
}

/** The preset an entry holds, migrated to the current format, or null. */
export function shelfPreset(entry) {
  return parsePreset(entry?.text)
}

/** The whole shelf as one file. */
export function shelfToText(list) {
  return JSON.stringify({ app: 'erzberg', shelf: SHELF_FORMAT, presets: list }, null, 1) + '\n'
}

/**
 * The entries a shelf file holds, or null when it is not one. An entry whose
 * preset does not parse is left out, so one bad entry cannot block the rest.
 */
export function shelfFromText(text) {
  try {
    const d = JSON.parse(text)
    if (!d || d.app !== 'erzberg' || !Array.isArray(d.presets)) return null
    return d.presets.filter((e) => validEntry(e) && shelfPreset(e))
  } catch { return null }
}

/** The shelf with `incoming` merged in. A name already there gets a free name. */
export function mergeShelf(list, incoming) {
  let out = list
  for (const e of incoming) {
    const same = out.find((o) => o.name === e.name)
    if (same && same.text === e.text) continue
    out = [...out, { ...e, name: same ? freeName(out, e.name) : e.name }]
  }
  return out
}

/**
 * A 320 × 200 WebP of the canvas, cut to fill the tile as the bundled
 * thumbnails are, on the paper colour because the canvas is transparent.
 */
export function thumbnailOf(canvas, paper = '#ffffff', w = 320, h = 200) {
  try {
    const out = document.createElement('canvas')
    out.width = w; out.height = h
    const ctx = out.getContext('2d')
    ctx.fillStyle = paper
    ctx.fillRect(0, 0, w, h)
    const s = Math.max(w / canvas.width, h / canvas.height)
    const sw = w / s, sh = h / s
    ctx.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, w, h)
    return out.toDataURL('image/webp', 0.8)
  } catch { return null }
}
