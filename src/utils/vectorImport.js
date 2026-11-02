/**
 * Shapefile, KML and KMZ, read into the same vector source as GeoJSON.
 *
 * Official routes, borders and lakes usually come as a zipped Shapefile, and
 * Google Earth writes KML. Each is turned into a GeoJSON FeatureCollection in
 * WGS84 and handed to `parseGeoJson`, so the layers, names and checks that a
 * GeoJSON file gets apply here unchanged.
 *
 * A Shapefile is usually in a national grid. Its `.prj` is read by proj4
 * through `converterFromWkt`, which applies the same published datum shifts as
 * the rasters. `shpjs` can reproject by itself, but without those shifts, so it
 * only parses here and the coordinates are moved afterwards.
 *
 * The libraries load on first use, like proj4.
 */
import { parseGeoJson } from './geoJsonParser'
import { converterFromWkt, loadProjections } from './geoCoords'

const decoder = new TextDecoder()

async function unzipEntries(buffer) {
  const { unzip } = await import('but-unzip')
  const out = new Map()
  for (const item of unzip(new Uint8Array(buffer))) {
    // Folders inside the zip and macOS resource forks carry no data.
    if (item.filename.endsWith('/') || /(^|\/)__MACOSX\//.test(item.filename)) continue
    out.set(item.filename, item)
  }
  return out
}

/** Apply `fn([x, y]) → [x, y]` to every position of a geometry, in place. */
function mapPositions(geom, fn) {
  if (!geom) return
  if (geom.type === 'GeometryCollection') { for (const g of geom.geometries ?? []) mapPositions(g, fn); return }
  const walk = (c) => (typeof c[0] === 'number' ? fn(c) : c.map(walk))
  geom.coordinates = walk(geom.coordinates)
}

function looksLikeLonLat(features) {
  let seen = 0
  for (const f of features) {
    let ok = true
    mapPositions(structuredClone(f.geometry), (c) => {
      if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) ok = false
      return c
    })
    if (!ok) return false
    if (++seen >= 50) break
  }
  return true
}

/**
 * A zipped Shapefile → a vector source. The zip may hold several layers; their
 * features are read together. Returns { source, note }, where `note` says when
 * the placement is approximate.
 */
export async function shapefileToSource(buffer, label) {
  const entries = await unzipEntries(buffer)
  const shps = [...entries.keys()].filter((n) => /\.shp$/i.test(n))
  if (!shps.length) throw new Error(`${label} holds no .shp file. A Shapefile comes as a zip of its .shp, .dbf and .prj.`)

  const { parseShp, parseDbf, combine } = await import('shpjs')
  const features = []
  let note = null
  for (const shpName of shps) {
    const base = shpName.replace(/\.shp$/i, '')
    const sibling = (ext) => {
      for (const [n, item] of entries) if (n.toLowerCase() === `${base}.${ext}`.toLowerCase()) return item
      return null
    }
    const shpBytes = await entries.get(shpName).read()
    const dbf = sibling('dbf'), prj = sibling('prj'), cpg = sibling('cpg')
    const geoms = parseShp(shpBytes)
    const props = dbf ? parseDbf(await dbf.read(), cpg ? decoder.decode(await cpg.read()) : undefined) : null
    const fc = combine([geoms, props])
    // An empty numeric field in a .dbf reads as NaN. JSON has no NaN.
    for (const f of fc.features)
      for (const k in f.properties) if (Number.isNaN(f.properties[k])) f.properties[k] = null

    if (prj) {
      await loadProjections()
      const wkt = decoder.decode(await prj.read()).trim()
      const conv = converterFromWkt(wkt)
      if (!conv) throw new Error(`The projection in ${base}.prj could not be read. Reproject it first: ogr2ogr -t_srs EPSG:4326 out.shp in.shp`)
      for (const f of fc.features) mapPositions(f.geometry, (c) => conv.toWgs84([c[0], c[1]]))
      if (conv.accuracy === 'approx')
        note = `${label} uses a datum this tool does not shift for; features may sit up to a few hundred metres off.`
    } else if (!looksLikeLonLat(fc.features)) {
      throw new Error(`${base}.shp has no .prj, and its coordinates are not longitude and latitude, so it cannot be placed. Add the .prj to the zip.`)
    }
    features.push(...fc.features)
  }
  return { source: parseGeoJson(JSON.stringify({ type: 'FeatureCollection', features }), label), note }
}

function kmlTextToSource(text, label, kml) {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.querySelector('parsererror')) throw new Error(`${label} is not valid KML.`)
  const fc = kml(doc)
  if (!fc.features?.length) throw new Error(`${label} holds no placemarks.`)
  // KML is WGS84 by definition. Features without geometry (a folder note,
  // a tour) are dropped rather than reported, as GeoJSON does.
  fc.features = fc.features.filter((f) => f.geometry)
  return parseGeoJson(JSON.stringify(fc), label)
}

/** KML text → a vector source. */
export async function kmlToSource(text, label) {
  const { kml } = await import('@tmcw/togeojson')
  return { source: kmlTextToSource(text, label, kml), note: null }
}

/** A KMZ (zipped KML) → a vector source, from its main .kml file. */
export async function kmzToSource(buffer, label) {
  const entries = await unzipEntries(buffer)
  const names = [...entries.keys()].filter((n) => /\.kml$/i.test(n))
  // The KMZ convention is one root doc.kml, with other files beside it.
  const main = names.find((n) => /(^|\/)doc\.kml$/i.test(n)) ?? names[0]
  if (!main) throw new Error(`${label} holds no .kml file.`)
  const { kml } = await import('@tmcw/togeojson')
  return { source: kmlTextToSource(decoder.decode(await entries.get(main).read()), label, kml), note: null }
}

/** The vector importer for a file name, or null for a format read elsewhere. */
export function vectorImporterFor(name) {
  const n = String(name ?? '').toLowerCase()
  if (n.endsWith('.zip')) return async (file) => shapefileToSource(await file.arrayBuffer(), file.name)
  if (n.endsWith('.kmz')) return async (file) => kmzToSource(await file.arrayBuffer(), file.name)
  if (n.endsWith('.kml')) return async (file) => kmlToSource(await file.text(), file.name)
  return null
}
