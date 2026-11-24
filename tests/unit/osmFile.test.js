import { describe, it, expect } from 'vitest'
import { deflateSync } from 'node:zlib'
import { existsSync, readFileSync } from 'node:fs'
import { pbfElements } from '../../src/utils/osmFile'
import { OSM_CATEGORIES } from '../../src/utils/osmCategories'

const ALL = OSM_CATEGORIES.map((c) => c.id)

// ── A tiny PBF writer, for the reader to read back ───────────────────────────

const varint = (n) => {
  const out = []
  while (n >= 128) { out.push((n % 128) | 128); n = Math.floor(n / 128) }
  out.push(n)
  return out
}
const zz = (n) => (n >= 0 ? n * 2 : -n * 2 - 1)
const key = (field, wire) => varint(field * 8 + wire)
const lenField = (field, bytes) => [...key(field, 2), ...varint(bytes.length), ...bytes]
const intField = (field, n) => [...key(field, 0), ...varint(n)]
const packed = (field, nums) => lenField(field, nums.flatMap(varint))
const delta = (xs) => xs.map((x, i) => x - (i ? xs[i - 1] : 0))
const utf8 = (s) => [...new TextEncoder().encode(s)]

function block() {
  const strings = ['', 'natural', 'peak', 'name', 'Drei Schwestern', 'highway', 'primary', 'type', 'multipolygon', 'water', 'lake', 'outer']
  const S = (s) => strings.indexOf(s)
  const st = strings.flatMap((s) => lenField(1, utf8(s)))
  // Coordinates in units of 100 nanodegrees, the default granularity.
  const ids = [1, 2, 3, 4, 5, 6, 7]
  const lat = [47.1, 47.11, 47.12, 47.13, 47.13, 47.14, 47.14].map((v) => Math.round(v * 1e7))
  const lon = [9.5, 9.51, 9.52, 9.53, 9.54, 9.54, 9.53].map((v) => Math.round(v * 1e7))
  const kv = [S('natural'), S('peak'), S('name'), S('Drei Schwestern'), 0, 0, 0, 0, 0, 0, 0]
  const dense = [
    ...packed(1, delta(ids).map(zz)),
    ...packed(8, delta(lat).map(zz)),
    ...packed(9, delta(lon).map(zz)),
    ...packed(10, kv),
  ]
  const nodesGroup = lenField(2, dense)
  const road = [...intField(1, 100), ...packed(2, [S('highway')]), ...packed(3, [S('primary')]), ...packed(8, delta([2, 3, 4]).map(zz))]
  // An untagged ring, used only by the relation below.
  const ring = [...intField(1, 101), ...packed(8, delta([4, 5, 6, 7, 4]).map(zz))]
  const waysGroup = [...lenField(3, road), ...lenField(3, ring)]
  const rel = [
    ...intField(1, 200),
    ...packed(2, [S('type'), S('natural'), S('water')]),
    ...packed(3, [S('multipolygon'), S('water'), S('lake')]),
    ...packed(8, [S('outer')]),
    ...packed(9, delta([101]).map(zz)),
    ...packed(10, [1]),
  ]
  const relGroup = lenField(4, rel)
  return Uint8Array.from([
    ...lenField(1, st),
    ...lenField(2, nodesGroup),
    ...lenField(2, waysGroup),
    ...lenField(2, relGroup),
  ])
}

function blob(type, payload) {
  const z = deflateSync(payload)
  const body = Uint8Array.from([...intField(2, payload.length), ...lenField(3, [...z])])
  const header = Uint8Array.from([...lenField(1, utf8(type)), ...intField(3, body.length)])
  const len = new Uint8Array(4)
  new DataView(len.buffer).setInt32(0, header.length)
  return [...len, ...header, ...body]
}

const pbf = () => Uint8Array.from([...blob('OSMHeader', Uint8Array.from([])), ...blob('OSMData', block())])

describe('pbfElements', () => {
  it('reads tagged nodes, ways with geometry and relations with member rings', async () => {
    const els = await pbfElements(pbf(), ALL)
    const peak = els.find((e) => e.type === 'node')
    expect(peak.tags.name).toBe('Drei Schwestern')
    expect(peak.lat).toBeCloseTo(47.1, 7)
    expect(peak.lon).toBeCloseTo(9.5, 7)

    const road = els.find((e) => e.type === 'way')
    expect(road.tags.highway).toBe('primary')
    expect(road.geometry.map((g) => g.lat)).toEqual([47.11, 47.12, 47.13].map((v) => expect.closeTo(v, 7)))

    // The ring itself carries no tags, so only the relation that uses it appears.
    expect(els.filter((e) => e.type === 'way')).toHaveLength(1)
    const lake = els.find((e) => e.type === 'relation')
    expect(lake.tags.water).toBe('lake')
    expect(lake.members[0].role).toBe('outer')
    expect(lake.members[0].geometry).toHaveLength(5)
  })

  it('leaves out what lies outside the box', async () => {
    const els = await pbfElements(pbf(), ALL, [10.0, 48.0, 10.1, 48.1])
    expect(els).toHaveLength(0)
  })

  // A real extract, when one is named: OSM_PBF=path/to/file.osm.pbf
  it.skipIf(!process.env.OSM_PBF || !existsSync(process.env.OSM_PBF))('reads a real extract', async () => {
    const buf = new Uint8Array(readFileSync(process.env.OSM_PBF))
    const els = await pbfElements(buf, ALL)
    const kinds = {}
    for (const e of els) kinds[e.type] = (kinds[e.type] ?? 0) + 1
    console.log('real extract', kinds)
    expect(kinds.node).toBeGreaterThan(10)
    expect(kinds.way).toBeGreaterThan(100)
    const road = els.find((e) => e.type === 'way' && e.tags.highway)
    expect(road.geometry.every((g) => g && g.lat > 40 && g.lat < 50 && g.lon > 5 && g.lon < 15)).toBe(true)
  })
})

// The XML reader needs DOMParser, so cartography.spec.js covers it in the browser.
