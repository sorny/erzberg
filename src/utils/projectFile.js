/**
 * The project file: one `.erzberg` zip that reopens a plate exactly.
 *
 * A preset carries the look only. A project carries the look and everything it
 * is drawn over: the source raster as loaded, the Edit Mode clip, its
 * georeference, the vector sources and their layers, the text, the masks, the
 * land cover and the imagery. Opening it puts all of that back.
 *
 * `project.json` holds the plain data. Every typed array in it (the raster, the
 * masks, the packed vector coordinates) is written as its own binary entry and
 * named in the JSON as `{ "$bin": "bin/3", "type": "Float32Array" }`, so a
 * 50 MB raster is not turned into text. A Map is written as `{ "$map": [...] }`.
 */
import { zip } from './zipWrite'

export const PROJECT_FORMAT = 1
export const PROJECT_EXT = '.erzberg'

const TYPED = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array,
}

/**
 * `value` as JSON-safe data, with each typed array moved into `bins`. Things
 * that cannot be written (functions, DOM objects, class instances) are left
 * out, as JSON would leave out a function.
 */
export function pack(value, bins) {
  if (value == null || typeof value !== 'object') return typeof value === 'function' ? undefined : value
  if (ArrayBuffer.isView(value) && TYPED[value.constructor.name]) {
    const name = `bin/${bins.length}`
    bins.push({ name, data: new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice() })
    return { $bin: name, type: value.constructor.name }
  }
  if (Array.isArray(value)) return value.map((v) => { const p = pack(v, bins); return p === undefined ? null : p })
  // A vector bucket keeps its feature names and notes in Maps.
  if (value instanceof Map) return { $map: pack([...value.entries()], bins) }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return undefined
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    const p = pack(v, bins)
    if (p !== undefined) out[k] = p
  }
  return out
}

/** The inverse of `pack`, with `read(name)` giving each binary entry's bytes. */
export function unpack(value, read) {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => unpack(v, read))
  if (Array.isArray(value.$map)) return new Map(unpack(value.$map, read))
  if (typeof value.$bin === 'string' && TYPED[value.type]) {
    const bytes = read(value.$bin)
    if (!bytes) throw new Error(`the project is missing ${value.$bin}`)
    const T = TYPED[value.type]
    // Copied, so the array starts on its own aligned buffer.
    return new T(new Uint8Array(bytes).buffer)
  }
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = unpack(v, read)
  return out
}

/**
 * The project as zip bytes. `state` is what `saveProject` in App.jsx gathers.
 * `options` are `zip`'s: progress and a cancel check.
 */
export async function writeProject(state, options = {}) {
  const bins = []
  const body = pack({ app: 'erzberg', project: PROJECT_FORMAT, ...state }, bins)
  return zip([{ name: 'project.json', data: JSON.stringify(body) }, ...bins], options)
}

/** True for a project file, by its name. */
export function isProjectFile(name) {
  return /\.erzberg$/i.test(name ?? '')
}

/**
 * The state a project file holds, or null when it is not a project. Throws
 * when it is one but is damaged, so the caller can say which.
 */
export async function readProject(buffer, { onProgress } = {}) {
  const { unzip } = await import('but-unzip')
  const entries = new Map()
  for (const item of unzip(new Uint8Array(buffer))) entries.set(item.filename, item)
  const head = entries.get('project.json')
  if (!head) return null
  const json = JSON.parse(new TextDecoder().decode(await head.read()))
  if (json?.app !== 'erzberg' || typeof json.project !== 'number') return null
  if (json.project > PROJECT_FORMAT) throw new Error('this project was saved by a newer erzberg')
  const bins = new Map()
  const names = [...entries.keys()].filter((n) => n.startsWith('bin/'))
  for (const [i, name] of names.entries()) {
    bins.set(name, await entries.get(name).read())
    onProgress?.((i + 1) / names.length)
  }
  return unpack(json, (name) => bins.get(name))
}
