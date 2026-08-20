/**
 * Minimal GeoJSON reader — no external dependencies.
 *
 * RFC 7946 settles the thing that would otherwise be ambiguous: GeoJSON
 * coordinates are WGS84 lon/lat, in that order, full stop. So this file has no
 * projection logic at all; it hands flat [lon, lat, …] rings to the same
 * forward path the GPX track already uses.
 *
 * The one trap is the *old* spec's top-level `crs` member, removed in RFC 7946
 * but still emitted by older exports. A file stating a projected CRS holds
 * metres, and metres read as degrees land in the Gulf of Guinea — the same
 * silent-vanish failure `projectWgs84` returns null to avoid. So a `crs` naming
 * anything other than WGS84 is refused with a message rather than drawn in the
 * wrong place.
 *
 * Features are bucketed by geometry class, not by any property: a file's own
 * attribute schema is its author's business and guessing at it produces layer
 * names nobody recognises. Lines, areas and points are three genuinely different
 * things to style, and that is a split the user can predict.
 */

import { makeSource, nextFallbackColor, packFeatures } from './vectorLayers'

// Names the old `crs` member used for plain WGS84. Anything else is refused.
const WGS84_CRS_NAMES = new Set([
  'urn:ogc:def:crs:ogc:1.3:crs84',
  'urn:ogc:def:crs:ogc::crs84',
  'urn:ogc:def:crs:epsg::4326',
  'epsg:4326',
  'crs84',
])

const GEOM_BUCKETS = [
  { key: 'lines',  geom: 'line',  suffix: 'Lines'  },
  { key: 'areas',  geom: 'area',  suffix: 'Areas'  },
  { key: 'points', geom: 'point', suffix: 'Points' },
]

/** A flat [lon, lat, …] ring from GeoJSON's nested position array. */
function flatten(positions) {
  const out = new Float64Array(positions.length * 2)
  let n = 0
  for (const pos of positions) {
    const lon = +pos[0], lat = +pos[1]
    // A position with a non-finite ordinate is not a point at (0, 0); it is a
    // hole in the file. Dropping it breaks the ring rather than pinching it
    // through the Atlantic.
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    out[n++] = lon
    out[n++] = lat
  }
  return n === out.length ? out : out.subarray(0, n)
}

/**
 * One geometry → zero or more normalised features.
 *
 * MultiPolygon is the case worth naming: each of its polygons becomes its own
 * feature, because a polygon's rings are outer-then-holes and flattening two
 * polygons into one ring list would make the second one's outer ring read as a
 * hole in the first.
 */
function readGeometry(geom, out, meta = {}) {
  if (!geom) return
  const c = geom.coordinates
  // Spread onto every feature the geometry produces, so both halves of a
  // MultiPolygon carry the name the file gave the whole thing.
  const m = meta

  switch (geom.type) {
    case 'Point':
      if (Array.isArray(c)) out.push({ ...m, bucket: 'points', geom: 'point', rings: [flatten([c])] })
      break
    case 'MultiPoint':
      // One feature holding every point: they share a style and a bucket, and a
      // feature apiece would multiply the poly index for no gain.
      if (c?.length) out.push({ ...m, bucket: 'points', geom: 'point', rings: [flatten(c)] })
      break
    case 'LineString':
      if (c?.length > 1) out.push({ ...m, bucket: 'lines', geom: 'line', rings: [flatten(c)] })
      break
    case 'MultiLineString':
      for (const line of c ?? []) {
        if (line?.length > 1) out.push({ ...m, bucket: 'lines', geom: 'line', rings: [flatten(line)] })
      }
      break
    case 'Polygon':
      if (c?.length) out.push({ ...m, bucket: 'areas', geom: 'area', rings: c.map(flatten).filter(r => r.length >= 6) })
      break
    case 'MultiPolygon':
      for (const poly of c ?? []) {
        if (poly?.length) out.push({ ...m, bucket: 'areas', geom: 'area', rings: poly.map(flatten).filter(r => r.length >= 6) })
      }
      break
    case 'GeometryCollection':
      for (const g of geom.geometries ?? []) readGeometry(g, out, m)
      break
    default:
      break
  }
}

/**
 * GeoJSON text → a vector source, or throws with a message the panel shows.
 *
 * `label` is the file name; it becomes the layer name, suffixed by geometry
 * class only when the file actually mixes them — a file of nothing but roads
 * should not be called "roads.geojson · Lines".
 */
export function parseGeoJson(text, label) {
  let doc
  try {
    doc = JSON.parse(text)
  } catch (err) {
    throw new Error(`Not valid JSON: ${err.message}`, { cause: err })
  }
  if (!doc || typeof doc !== 'object') throw new Error('Not a GeoJSON document.')

  const crsName = doc.crs?.properties?.name
  if (crsName && !WGS84_CRS_NAMES.has(String(crsName).toLowerCase())) {
    throw new Error(
      `This file states it is in ${crsName}, not WGS84. Reproject it first: ` +
      `ogr2ogr -t_srs EPSG:4326 out.geojson in.geojson`
    )
  }

  // No convention says which property holds a display name, so try the three
  // that most exports actually use and give up rather than guessing further.
  const nameOf = (props) =>
    props?.name ?? props?.Name ?? props?.NAME ?? props?.title ?? null

  const features = []
  if (doc.type === 'FeatureCollection') {
    for (const f of doc.features ?? []) readGeometry(f?.geometry, features, { name: nameOf(f?.properties) })
  } else if (doc.type === 'Feature') {
    readGeometry(doc.geometry, features, { name: nameOf(doc.properties) })
  } else {
    readGeometry(doc, features)
  }

  if (!features.length) throw new Error('No point, line or polygon geometry found in this file.')

  const present = GEOM_BUCKETS.filter((b) => features.some((f) => f.bucket === b.key))
  const mixed = present.length > 1
  const bucketMeta = {}
  for (const b of present) {
    bucketMeta[b.key] = {
      label: mixed ? `${label} · ${b.suffix}` : label,
      geom: b.geom,
      style: {
        color: nextFallbackColor(),
        weight: b.geom === 'point' ? 4 : 2,
        // Sorted to the front of the icon picker; nothing is applied until the
        // user picks it. A file's points could be anything, so the neutral one.
        ...(b.geom === 'point' ? { suggestedIcon: 'marker' } : null),
      },
    }
  }

  return makeSource({
    kind: 'geojson',
    label,
    buckets: packFeatures(features, bucketMeta, present.map((b) => b.key)),
  })
}
