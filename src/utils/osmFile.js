/**
 * A local OpenStreetMap file as a vector source: `.osm` XML or `.osm.pbf`.
 *
 * Both are turned into the elements an Overpass `out geom` reply holds, with
 * each way's node positions resolved, and then go through the same bucketing as
 * a fetch. So a Geofabrik extract cut to a valley gives the same layers as a
 * fetch of that valley, without a request to anybody's server.
 *
 * ── The PBF reader ───────────────────────────────────────────────────────────
 * A PBF file is a run of blobs, each a length, a header and a zlib-packed
 * block of protocol buffers. The reader decodes only what it needs, in three
 * passes over the unpacked blocks: relations first, to learn which ways they
 * use; then ways, to learn which nodes they use; then nodes. An element is kept
 * only when a category takes it or a kept element needs it, so the memory
 * follows what the plate draws and not the size of the extract.
 */
import { OSM_CATEGORIES, osmCategory } from './osmCategories'
import { bucketOsmElements } from './osmFetch'
import { makePacer, makeReporter } from './pacing'

/** Larger extracts are refused: the unpacked blocks are held in memory. */
export const MAX_PBF_BYTES = 150 * 1024 * 1024

// ── Protocol buffers ──────────────────────────────────────────────────────────

/**
 * A minimal protocol-buffer reader. Numbers are read into doubles, which hold
 * every OSM id and coordinate exactly: both stay far below 2^53.
 */
class Pbf {
  constructor(buf, from = 0, to = buf.length) { this.b = buf; this.p = from; this.end = to }
  more() { return this.p < this.end }
  varint() {
    let r = 0, s = 1, b
    do { b = this.b[this.p++]; r += (b & 0x7f) * s; s *= 128 } while (b & 0x80)
    return r
  }
  /** A zigzag-coded signed varint. */
  svarint() { const n = this.varint(); return n % 2 === 1 ? -(n + 1) / 2 : n / 2 }
  /** A signed int64 written as a plain varint: negative values use ten bytes. */
  int64() { const n = this.varint(); return n >= 2 ** 63 ? n - 2 ** 64 : n }
  bytes() { const n = this.varint(); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v }
  sub() { const n = this.varint(); const r = new Pbf(this.b, this.p, this.p + n); this.p += n; return r }
  skip(wire) {
    if (wire === 0) this.varint()
    else if (wire === 1) this.p += 8
    // Not `this.p += this.varint()`: that reads p before the length is consumed.
    else if (wire === 2) { const n = this.varint(); this.p += n }
    else if (wire === 5) this.p += 4
    else throw new Error('The PBF file holds a field this reader does not know.')
  }
  /** Reads a packed run of varints with `read`. */
  packed(read) {
    const r = this.sub(), out = []
    while (r.more()) out.push(read.call(r))
    return out
  }
}

/** Calls `fn(field, wire, reader)` for each field of a message. */
function fields(r, fn) {
  while (r.more()) {
    const tag = r.varint()
    const field = Math.floor(tag / 8), wire = tag & 7
    if (fn(field, wire, r) === false) r.skip(wire)
  }
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Every data block of a PBF file, unpacked. */
async function pbfBlocks(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const blocks = []
  let p = 0
  while (p + 4 <= buf.length) {
    const hlen = view.getInt32(p); p += 4
    let type = '', size = 0
    fields(new Pbf(buf, p, p + hlen), (f, w, r) => {
      if (f === 1) type = new TextDecoder().decode(r.bytes())
      else if (f === 3) size = r.varint()
      else return false
    })
    p += hlen
    let raw = null, zlib = null, other = false
    fields(new Pbf(buf, p, p + size), (f, w, r) => {
      if (f === 1) raw = r.bytes()
      else if (f === 3) zlib = r.bytes()
      else if (f === 4 || f === 6 || f === 7) { other = true; return false }
      else return false
    })
    p += size
    if (type !== 'OSMData') continue
    if (other && !raw && !zlib) throw new Error('This PBF file uses a compression the browser cannot unpack. Re-pack it with osmium cat.')
    blocks.push(raw ?? await inflate(zlib))
  }
  return blocks
}

/**
 * One primitive block: its strings, its coordinate scale and its groups.
 * Groups are kept as byte ranges, because the scale is written after them.
 */
function readBlock(buf) {
  const strings = []
  const groups = []
  let gran = 100, latOff = 0, lonOff = 0
  const dec = new TextDecoder()
  fields(new Pbf(buf), (f, w, r) => {
    if (f === 1) fields(r.sub(), (g, w2, s) => { if (g === 1) strings.push(dec.decode(s.bytes())); else return false })
    else if (f === 2) { const n = r.varint(); groups.push([r.p, r.p + n]); r.p += n }
    else if (f === 17) gran = r.varint()
    else if (f === 19) latOff = r.int64()
    else if (f === 20) lonOff = r.int64()
    else return false
  })
  return { buf, strings, groups, gran, latOff, lonOff }
}

const tagsFrom = (keys, vals, strings) => {
  if (!keys.length) return null
  const t = {}
  for (let i = 0; i < keys.length; i++) t[strings[keys[i]]] = strings[vals[i]]
  return t
}

/** Calls `on.way`, `on.relation` and `on.node` for the elements of one block. */
function walkBlock(block, on) {
  const { buf, strings, gran, latOff, lonOff } = block
  const deg = (v, off) => 1e-9 * (off + gran * v)
  for (const [from, to] of block.groups) {
    fields(new Pbf(buf, from, to), (f, w, r) => {
      if (f === 3 && on.way) {
        let id = 0, keys = [], vals = [], refs = []
        fields(r.sub(), (g, w2, s) => {
          if (g === 1) id = s.varint()
          else if (g === 2) keys = s.packed(s.varint)
          else if (g === 3) vals = s.packed(s.varint)
          else if (g === 8) { let acc = 0; refs = s.packed(s.svarint).map((d) => (acc += d)) }
          else return false
        })
        on.way(id, tagsFrom(keys, vals, strings), refs)
      } else if (f === 4 && on.relation) {
        let id = 0, keys = [], vals = [], roles = [], mems = [], types = []
        fields(r.sub(), (g, w2, s) => {
          if (g === 1) id = s.varint()
          else if (g === 2) keys = s.packed(s.varint)
          else if (g === 3) vals = s.packed(s.varint)
          else if (g === 8) roles = s.packed(s.varint)
          else if (g === 9) { let acc = 0; mems = s.packed(s.svarint).map((d) => (acc += d)) }
          else if (g === 10) types = s.packed(s.varint)
          else return false
        })
        const members = mems.map((ref, i) => ({
          type: types[i] === 0 ? 'node' : types[i] === 1 ? 'way' : 'relation',
          ref, role: strings[roles[i]] ?? '',
        }))
        on.relation(id, tagsFrom(keys, vals, strings), members)
      } else if (f === 2 && on.node) {
        let ids = [], lats = [], lons = [], kv = []
        fields(r.sub(), (g, w2, s) => {
          if (g === 1) { let a = 0; ids = s.packed(s.svarint).map((d) => (a += d)) }
          else if (g === 8) { let a = 0; lats = s.packed(s.svarint).map((d) => (a += d)) }
          else if (g === 9) { let a = 0; lons = s.packed(s.svarint).map((d) => (a += d)) }
          else if (g === 10) kv = s.packed(s.varint)
          else return false
        })
        let k = 0
        for (let i = 0; i < ids.length; i++) {
          let tags = null
          while (k < kv.length && kv[k] !== 0) {
            tags ??= {}
            tags[strings[kv[k]]] = strings[kv[k + 1]]
            k += 2
          }
          k++
          on.node(ids[i], deg(lats[i], latOff), deg(lons[i], lonOff), tags)
        }
      } else if (f === 1 && on.node) {
        let id = 0, keys = [], vals = [], lat = 0, lon = 0
        fields(r.sub(), (g, w2, s) => {
          if (g === 1) id = s.svarint()
          else if (g === 2) keys = s.packed(s.varint)
          else if (g === 3) vals = s.packed(s.varint)
          else if (g === 8) lat = s.svarint()
          else if (g === 9) lon = s.svarint()
          else return false
        })
        on.node(id, deg(lat, latOff), deg(lon, lonOff), tagsFrom(keys, vals, strings))
      } else return false
    })
  }
}

// ── Elements ──────────────────────────────────────────────────────────────────

/** A test of whether any category, or one of the queries, takes a tag set. */
function wantedBy(categoryIds) {
  const cats = categoryIds.map(osmCategory).filter(Boolean)
  return (tags) => !!tags && cats.some((c) => c.bucketOf(tags))
}

/** Is a point inside the box, grown by a tenth on every side? */
function boxTest(bbox) {
  if (!bbox) return () => true
  const [w, s, e, n] = bbox
  const dx = (e - w) * 0.1, dy = (n - s) * 0.1
  return (lon, lat) => lon >= w - dx && lon <= e + dx && lat >= s - dy && lat <= n + dy
}

/**
 * Overpass-shaped elements from the three kinds of record. `coords` maps a
 * node id to [lon, lat].
 */
function assemble(nodes, ways, relations, coords, inBox) {
  const geometryOf = (refs) => refs.map((id) => {
    const c = coords.get(id)
    return c ? { lon: c[0], lat: c[1] } : null
  })
  const touches = (g) => g.some((pt) => pt && inBox(pt.lon, pt.lat))
  const wayGeom = new Map()
  const out = []
  for (const [id, way] of ways) {
    const g = geometryOf(way.refs)
    wayGeom.set(id, g)
    if (way.tags && way.own && touches(g)) out.push({ type: 'way', id, tags: way.tags, geometry: g })
  }
  for (const n of nodes) if (inBox(n.lon, n.lat)) out.push(n)
  for (const r of relations) {
    const members = r.members
      .filter((m) => m.type === 'way' && wayGeom.has(m.ref))
      .map((m) => ({ type: 'way', ref: m.ref, role: m.role, geometry: wayGeom.get(m.ref) }))
    if (members.some((m) => touches(m.geometry))) out.push({ type: 'relation', id: r.id, tags: r.tags, members })
  }
  return out
}

/** The elements of a PBF file that the categories take. */
export async function pbfElements(buf, categoryIds, bboxWgs84 = null) {
  if (buf.byteLength > MAX_PBF_BYTES) {
    throw new Error(`This PBF file is ${Math.round(buf.byteLength / 1e6)} MB. Cut it to the plate first, for example with osmium extract, to under ${MAX_PBF_BYTES / 1024 / 1024} MB.`)
  }
  const wanted = wantedBy(categoryIds)
  const blocks = (await pbfBlocks(buf)).map(readBlock)

  const relations = []
  const neededWays = new Set()
  for (const b of blocks) walkBlock(b, { relation: (id, tags, members) => {
    if (!wanted(tags)) return
    relations.push({ id, tags, members })
    for (const m of members) if (m.type === 'way') neededWays.add(m.ref)
  } })

  const ways = new Map()
  const neededNodes = new Set()
  for (const b of blocks) walkBlock(b, { way: (id, tags, refs) => {
    const own = wanted(tags)
    if (!own && !neededWays.has(id)) return
    ways.set(id, { tags, refs, own })
    for (const r of refs) neededNodes.add(r)
  } })

  const nodes = []
  const coords = new Map()
  for (const b of blocks) walkBlock(b, { node: (id, lat, lon, tags) => {
    if (neededNodes.has(id)) coords.set(id, [lon, lat])
    if (tags && wanted(tags)) nodes.push({ type: 'node', id, lat, lon, tags })
  } })

  return assemble(nodes, ways, relations, coords, boxTest(bboxWgs84))
}

/** The elements of an `.osm` XML file that the categories take. */
export function osmXmlElements(text, categoryIds, bboxWgs84 = null) {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.querySelector('parsererror') || doc.documentElement.nodeName !== 'osm') {
    throw new Error('This is not an OpenStreetMap XML file.')
  }
  const wanted = wantedBy(categoryIds)
  const tagsOf = (el) => {
    let t = null
    for (const tag of el.children) {
      if (tag.nodeName !== 'tag') continue
      t ??= {}
      t[tag.getAttribute('k')] = tag.getAttribute('v')
    }
    return t
  }
  const coords = new Map()
  const nodes = []
  for (const n of doc.getElementsByTagName('node')) {
    const id = Number(n.getAttribute('id'))
    const lat = Number(n.getAttribute('lat')), lon = Number(n.getAttribute('lon'))
    coords.set(id, [lon, lat])
    const tags = tagsOf(n)
    if (tags && wanted(tags)) nodes.push({ type: 'node', id, lat, lon, tags })
  }
  const relations = []
  const neededWays = new Set()
  for (const r of doc.getElementsByTagName('relation')) {
    const tags = tagsOf(r)
    if (!wanted(tags)) continue
    const members = [...r.getElementsByTagName('member')].map((m) => ({
      type: m.getAttribute('type'), ref: Number(m.getAttribute('ref')), role: m.getAttribute('role') ?? '',
    }))
    relations.push({ id: Number(r.getAttribute('id')), tags, members })
    for (const m of members) if (m.type === 'way') neededWays.add(m.ref)
  }
  const ways = new Map()
  for (const w of doc.getElementsByTagName('way')) {
    const id = Number(w.getAttribute('id'))
    const tags = tagsOf(w)
    const own = wanted(tags)
    if (!own && !neededWays.has(id)) continue
    const refs = [...w.getElementsByTagName('nd')].map((nd) => Number(nd.getAttribute('ref')))
    ways.set(id, { tags, refs, own })
  }
  return assemble(nodes, ways, relations, coords, boxTest(bboxWgs84))
}

/**
 * A local OSM file → a vector source, bucketed by every catalogue category and
 * by the queries in `extraIds`.
 */
export async function osmFileToSource(file, bboxWgs84 = null, extraIds = []) {
  const ids = [...OSM_CATEGORIES.map((c) => c.id), ...extraIds]
  const name = file.name
  let elements
  if (/\.pbf$/i.test(name)) {
    elements = await pbfElements(new Uint8Array(await file.arrayBuffer()), ids, bboxWgs84)
  } else if (/\.bz2$/i.test(name)) {
    throw new Error(`${name} is compressed with bzip2. Unpack it first, for example with bunzip2.`)
  } else {
    elements = osmXmlElements(await file.text(), ids, bboxWgs84)
  }
  if (!elements.length) {
    throw new Error(bboxWgs84
      ? `${name} holds nothing this app draws inside the terrain's extent.`
      : `${name} holds nothing this app draws.`)
  }
  const source = await bucketOsmElements(elements, ids, bboxWgs84, makePacer(() => false), makeReporter(null))
  source.label = name
  return { source, note: null }
}
