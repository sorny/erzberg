#!/usr/bin/env node
/**
 * Land cover for a window, from AlphaEarth Foundations.
 *
 * The app draws what the ground is *shaped* like. It has never known what the
 * ground *is*, so a mark can follow slope and curvature and nothing else.
 * AlphaEarth's Satellite Embedding gives every 10 m of the planet a 64-number
 * description of its cover, and this script turns a window of that into the one
 * thing the app can use: a class per pixel, plus the plate that colours them.
 *
 * ── Why this is a script and not a button ────────────────────────────────────
 * The README promises that the app asks no third party for anything without a
 * press, and asks with no key and no account. The embeddings break the second
 * promise on both routes that exist:
 *
 *  1. **Earth Engine** wants an account, an OAuth flow and a Cloud project.
 *  2. **The public bucket** is open — a ranged GET needs no credential at all —
 *     but it answers with no `access-control-*` header of any kind. A browser
 *     therefore refuses the read. Only a proxy fixes that, and a proxy is a
 *     server.
 *
 * So the fetch happens here, once, on a machine that has no origin to be
 * checked against. What the app loads is the *reduction*: one byte per pixel
 * instead of sixty-four, which is also the difference between a 64 MB download
 * and a 40 KB file.
 *
 * ── What it writes ───────────────────────────────────────────────────────────
 * With `--dem`, one file:
 *   <name>.cover.json  The plate, on the supplied raster's own grid.
 *
 * Otherwise two, because there is no raster yet:
 *   <name>.tif         Elevation for the window. Float32, north-up, EPSG:326xx.
 *   <name>.cover.json  The land cover plate for that same window.
 *
 * Either way the plate and the ground under it are aligned by construction —
 * cut against the supplied raster, or cut from one grid in the same run. That
 * is the whole reason this is not a matter of typing the same extent twice: a
 * cover plate that does not line up with the ground under it is worse than no
 * cover plate, because the error looks like a style choice.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   node scripts/embed-window.js --dem my-terrain.tif
 *   node scripts/embed-window.js --place "Eisenerz, Austria"
 *   node scripts/embed-window.js --place "Erzberg" --km 6 --classes 8
 *   node scripts/embed-window.js --bbox 14.88,47.50,14.95,47.55 --year 2021
 *
 * Attribution is not optional. The dataset is CC-BY 4.0 and the required credit
 * line travels inside the written file, so the app can show it without knowing
 * where the file came from.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import path from 'node:path'
import { fromArrayBuffer, fromUrl, writeArrayBuffer } from 'geotiff'

import { classifyCRS, projectWgs84, unprojectWgs84 } from '../src/utils/geoCoords.js'
import { fillPolygon } from '../src/utils/heightmapEdit.js'
import { MAX_CLASSES } from '../src/utils/coverPlate.js'

// ── Where the data comes from ────────────────────────────────────────────────

/** The embeddings. Open, anonymous, and CORS-less — see the header. */
const BUCKET = 'https://storage.googleapis.com/alphaearth_foundations'
const PREFIX = 'satellite_embedding/v1/annual'

/** Place search and ground, both already used by the app itself. */
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'

/** Required by the dataset licence, and carried into every file written. */
export const EMBEDDING_CREDIT =
  'Land cover: The AlphaEarth Foundations Satellite Embedding dataset is produced ' +
  'by Google and Google DeepMind. Licensed CC-BY 4.0.'

/**
 * One tile, in pixels. Every object in the bucket is this square or smaller.
 *
 * There is deliberately no constant for the size of an *export*. Most are a
 * 2 × 2 grid of these and plenty are not — in zone 33N alone, 151 exports of
 * four tiles, 50 of two, six of one and one of three — so an export's extent is
 * the union of the tiles it actually has, which the bucket listing states
 * outright. A constant here would be a guess that reads like a fact.
 */
const TILE_PX = 8192
const PIXEL_M = 10

/** The embedding dimension. Fixed by the model, not by anything here. */
const DIMS = 64

/** Deepest terrarium zoom carrying real survey detail — the app's own cap. */
const MAX_ZOOM = 14
const TILE = 256

// ── Arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { km: 4, year: 2024, classes: 6, out: '.', zoom: MAX_ZOOM }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const val = argv[i + 1]
    if (key === 'place' || key === 'bbox' || key === 'out' || key === 'name' || key === 'dem') { out[key] = val; i++ }
    else if (key === 'km' || key === 'year' || key === 'classes' || key === 'zoom') { out[key] = Number(val); i++ }
    else if (key === 'no-osm') out.noOsm = true
    else if (key === 'help') out.help = true
  }
  return out
}

const USAGE = `
Land cover for a window, from AlphaEarth Foundations.

  --dem   <file.tif>  Cut the plate to match a GeoTIFF you already have. The
                      extent and the projection come from the file, so the
                      plate covers the same ground and no terrain is fetched.
                      The plate is cut at the embeddings' own 10 m, which is
                      the file's grid unless the file is finer than that.
  --place "<name>"    Or a place to centre on, resolved by OpenStreetMap.
  --bbox  a,b,c,d     Or an explicit lon,lat,lon,lat box.
  --km    <n>         Window side in kilometres. Default 4.
  --year  <yyyy>      Embedding year, 2017 to 2024. Default 2024.
  --classes <n>       How many cover classes to cut, 2 to 32. Default 6.
  --out   <dir>       Where to write. Default the current directory.
  --name  <stem>      Output file stem. Default comes from the place.
  --no-osm            Skip the OpenStreetMap lookup that names the classes.
                      They are then described by their terrain alone.

With --dem, writes <stem>.cover.json alone — you already have the terrain.
Otherwise writes <stem>.tif and <stem>.cover.json: load the first as terrain,
then drop the second on top.
`

// ── Small helpers ────────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'erzberg/embed-window' } })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return res.json()
}

/** Run `work` over `items`, `limit` at a time. Order of results is preserved. */
async function pooled(items, limit, work) {
  const out = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await work(items[i], i)
    }
  })
  await Promise.all(runners)
  return out
}

// ── Where on Earth ───────────────────────────────────────────────────────────

/**
 * A place name to a centre, using the geocoder the app already uses.
 *
 * Nominatim's usage policy asks for one request a second and no automation on
 * keystroke. A script that runs once per window is well inside that; the
 * User-Agent is set because the policy asks for that too.
 */
async function geocode(place) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(place)}&format=json&limit=1`
  const hits = await getJson(url)
  if (!hits.length) throw new Error(`No place found for "${place}".`)
  return { lat: Number(hits[0].lat), lon: Number(hits[0].lon), label: hits[0].display_name }
}

/** The UTM CRS for a zone number and a hemisphere. */
function utmCrsForZone(zone, isSouth) {
  const code = (isSouth ? 32700 : 32600) + zone
  return { zone, code, crs: `EPSG:${code}`, name: `${zone}${isSouth ? 'S' : 'N'}` }
}

/**
 * The zones worth asking, best first.
 *
 * A point does not always have its data in the zone its longitude names, and a
 * raster near a zone boundary is the case that proves it. Tre Cime sits at
 * 12.28°E — eight hundredths of a degree inside zone 33's band — and is stored
 * in ETRS89 / UTM 32N, which is what a surveyor working in the Alps uses for
 * the whole region. AlphaEarth publishes it in 32N too: at that latitude zone
 * 33 simply has no export in its westernmost column, so asking 33 because the
 * longitude said so came back with nothing at all and a message about the
 * dataset rather than about the seam.
 *
 * So: the raster's own zone first when it has one, because a file georeferenced
 * in a zone is evidence about where its data lives and it needs no reprojection
 * either. Then the zone the longitude names. Then the neighbours, because a
 * window can straddle a seam from either side.
 */
function candidateZones(centre, demCrs) {
  const isSouth = centre.lat < 0
  const byLon = Math.floor((centre.lon + 180) / 6) + 1
  const order = []

  const own = demCrs ? classifyCRS(demCrs) : null
  if (own?.kind === 'utm' && own.zone) order.push(own.zone)
  order.push(byLon, byLon - 1, byLon + 1)

  const seen = new Set()
  return order
    .filter((z) => z >= 1 && z <= 60 && !seen.has(z) && seen.add(z))
    .map((z) => utmCrsForZone(z, isSouth))
}

/**
 * The window to cut, in UTM metres, snapped to the embedding's own grid.
 *
 * Snapping matters more than it looks: an unsnapped window forces every read to
 * straddle a source pixel, and the nearest-neighbour sampling that follows would
 * then shift the cover half a pixel against the terrain. On the grid, a read is
 * an exact copy.
 */
function windowFor(centre, km, crs) {
  const [cx, cy] = projectWgs84(centre.lat, centre.lon, crs)
  const half = (km * 1000) / 2
  const snap = (v) => Math.round(v / PIXEL_M) * PIXEL_M
  const minX = snap(cx - half), minY = snap(cy - half)
  const size = Math.round((km * 1000) / PIXEL_M)
  return { minX, minY, maxX: minX + size * PIXEL_M, maxY: minY + size * PIXEL_M, width: size, height: size }
}

// ── Finding the tiles ────────────────────────────────────────────────────────

/**
 * Every object under a prefix, following the continuation token.
 *
 * The XML listing is used rather than the JSON one because it needs no key and
 * no project, which is the whole reason this route exists at all.
 */
async function listPrefix(prefix) {
  const keys = []
  let marker = ''
  while (true) {
    const url = `${BUCKET}?prefix=${encodeURIComponent(prefix)}&max-keys=1000` +
                (marker ? `&marker=${encodeURIComponent(marker)}` : '')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Bucket listing answered ${res.status}`)
    const xml = await res.text()
    const page = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1])
    keys.push(...page)
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break
    const nm = xml.match(/<NextMarker>([^<]+)<\/NextMarker>/)
    marker = nm ? nm[1] : page[page.length - 1]
    if (!marker) break
  }
  return keys
}

/**
 * The affine of a source tile, read honestly.
 *
 * `getResolution()` cannot be used here, and this is the trap that cost the most
 * time. These files are **south-up**: their `ModelTransformation` carries a
 * *positive* north-south step, so raster row 0 is the tile's southern edge and
 * the row index climbs northward. geotiff.js hardcodes the usual negation into
 * `getResolution()`, so it reports −10 for a file whose real step is +10, and
 * every pixel computed from it lands in the wrong hemisphere of the tile.
 *
 * `getBoundingBox()` is not affected — it takes the corners from the matrix —
 * which is exactly why the disagreement is so quiet. Read the matrix.
 */
function affineOf(image) {
  const m = image.fileDirectory.getValue('ModelTransformation')
  if (m) return { a: m[0], b: m[1], d: m[3], e: m[4], f: m[5], h: m[7] }
  const scale = image.fileDirectory.getValue('ModelPixelScale')
  const tie = image.fileDirectory.getValue('ModelTiepoint')
  if (!scale || !tie) throw new Error('Source tile carries no affine transformation.')
  // The ordinary north-up case, stated the same way so callers need one path.
  return { a: scale[0], b: 0, d: tie[3], e: 0, f: -scale[1], h: tie[4] }
}

/** World metres to the fractional pixel of a tile, through its own affine. */
function worldToPixel(af, x, y) {
  return { col: (x - af.d) / af.a, row: (y - af.h) / af.f }
}

/**
 * Which export covers which ground, cached on disk.
 *
 * The object names carry an export-task hash and a pixel offset, and nothing
 * about where on Earth they sit. The only way to know is to open a tile and
 * read its affine — a few hundred of them in a busy UTM zone, which is a minute
 * of HTTP the first time and nothing at all after that.
 *
 * ── Two things the naïve version got wrong ───────────────────────────────────
 * It probed `<hash>-0000000000-0000000000.tiff` and skipped the export when
 * that 404'd. **Thirty-one of 208 exports in zone 33N have no such tile**, so
 * fifteen per cent of the archive was invisible — and invisible in the way that
 * matters, since a window over one of them reported that the dataset does not
 * cover that ground.
 *
 * It also took every export to be a 2 × 2 grid of 8192-pixel tiles. The real
 * distribution in 33N is 151 exports of four tiles, 50 of two, six of one and
 * one of three. An export credited with ground it does not have is the same
 * failure wearing the opposite face: the window is selected, the read comes
 * back empty, and the zone that really holds the data is never tried.
 *
 * Both are answered by the listing, which states exactly which tiles exist. So
 * the probe targets a tile that is *there*, and the extent is the union of the
 * tiles an export actually has.
 */
async function exportIndex(year, zoneName, cacheDir) {
  // v2: the cached shape changed when tile lists arrived. A stale v1 file is
  // ignored rather than migrated — it is a cache, and re-probing costs a minute.
  const cacheFile = path.join(cacheDir, `${year}-${zoneName}-v2.json`)
  let cache = {}
  if (existsSync(cacheFile)) {
    try { cache = JSON.parse(await readFile(cacheFile, 'utf8')) } catch { cache = {} }
  }

  const keys = await listPrefix(`${PREFIX}/${year}/${zoneName}/`)
  const tilesOf = new Map()
  for (const key of keys) {
    if (!key.endsWith('.tiff')) continue
    const m = path.basename(key).match(/^(.+)-(\d{10})-(\d{10})\.tiff$/)
    if (!m) continue
    if (!tilesOf.has(m[1])) tilesOf.set(m[1], [])
    tilesOf.get(m[1]).push([Number(m[2]), Number(m[3])])
  }

  const unknown = [...tilesOf.keys()].filter((hash) => !(hash in cache))
  let probed = 0
  await pooled(unknown, 16, async (hash) => {
    // A tile that exists, preferring the corner when there is one so the
    // arithmetic below is a no-op in the common case.
    const tiles = tilesOf.get(hash)
    const pick = tiles.find(([r, c]) => r === 0 && c === 0) ?? tiles[0]
    const [row, col] = pick
    const name = `${hash}-${String(row).padStart(10, '0')}-${String(col).padStart(10, '0')}.tiff`
    try {
      const image = await (await fromUrl(`${BUCKET}/${PREFIX}/${year}/${zoneName}/${name}`)).getImage()
      const af = affineOf(image)
      // The affine names the corner raster row 0 sits on. These tiles are
      // south-up, so that is the south-west corner — and the export's own
      // corner is that, less the tile's offset within the export.
      cache[hash] = { o: [af.d - col * PIXEL_M, af.h - row * PIXEL_M], t: tiles }
      probed++
    } catch {
      // One export out of hundreds, and the window probably does not want it.
      // Left unmapped so a later run tries again rather than caching a guess.
    }
  })

  if (probed) {
    await mkdir(cacheDir, { recursive: true })
    await writeFile(cacheFile, JSON.stringify(cache), 'utf8')
  }
  return { cache, cacheFile, probed, total: tilesOf.size }
}

/** Every tile an export holds, as world boxes. */
function tileBoxes(entry) {
  const [ox, oy] = entry.o
  const side = TILE_PX * PIXEL_M
  return entry.t.map(([row, col]) => {
    const x = ox + col * PIXEL_M
    const y = oy + row * PIXEL_M
    return [x, y, x + side, y + side]
  })
}

/**
 * The exports a window actually touches.
 *
 * Intersected against the tiles each export really has, rather than against a
 * lattice cell it is assumed to fill. Selected by real extents rather than by
 * computing which cell the window falls in, and that difference is not
 * academic either: the exports sit on a grid anchored at the UTM *false
 * easting* of 500 000 rather than at zero, so every arithmetic shortcut that
 * assumes a zero anchor picks the tile one column to the west.
 */
function selectExports(index, win) {
  const out = []
  for (const [hash, entry] of Object.entries(index.cache)) {
    if (!entry?.o || !entry?.t) continue
    const hit = tileBoxes(entry).some(([x0, y0, x1, y1]) =>
      !(win.maxX <= x0 || win.minX >= x1 || win.maxY <= y0 || win.minY >= y1))
    if (hit) out.push({ hash, tiles: entry.t })
  }
  return out
}

/**
 * Read the window's embeddings, whatever seams it crosses.
 *
 * A window near an export edge is split across up to four exports and, inside
 * each, up to four 8192-pixel sub-tiles. Rather than reason about which of the
 * sixteen it needs, this walks every candidate, intersects it with the window in
 * *world* coordinates, and copies whatever overlap it finds. A tile that does
 * not overlap costs one header read and contributes nothing.
 *
 * Output is north-up, because everything downstream — the written GeoTIFF, the
 * cover plate, the app — assumes row 0 is north. The flip happens here, once.
 */
async function readEmbeddings(year, zoneName, win, exports) {
  const out = new Int8Array(DIMS * win.width * win.height)
  const covered = new Uint8Array(win.width * win.height)
  const samples = Array.from({ length: DIMS }, (_, i) => i)

  for (const { hash, tiles } of exports) {
    // Only the tiles that exist. The listing already said which those are, so
    // nothing here asks for a file it has been told is absent — the old version
    // walked a 2 × 2 grid on faith and spent most of its requests on 404s.
    {
      for (const [rowOff, colOff] of tiles) {
        const name = `${hash}-${String(rowOff).padStart(10, '0')}-${String(colOff).padStart(10, '0')}.tiff`
        const url = `${BUCKET}/${PREFIX}/${year}/${zoneName}/${name}`
        let image
        try { image = await (await fromUrl(url)).getImage() } catch { continue }
        const af = affineOf(image)
        const w = image.getWidth(), h = image.getHeight()

        // The tile's own extent, as a world box, from its two opposite corners.
        const c0 = { x: af.d, y: af.h }
        const c1 = { x: af.d + af.a * w, y: af.h + af.f * h }
        const tMinX = Math.min(c0.x, c1.x), tMaxX = Math.max(c0.x, c1.x)
        const tMinY = Math.min(c0.y, c1.y), tMaxY = Math.max(c0.y, c1.y)

        const ixMin = Math.max(win.minX, tMinX), ixMax = Math.min(win.maxX, tMaxX)
        const iyMin = Math.max(win.minY, tMinY), iyMax = Math.min(win.maxY, tMaxY)
        if (ixMax <= ixMin || iyMax <= iyMin) continue

        // The overlap in the tile's pixels. `f` is positive on these files, so
        // the *low* northing is the low row — the opposite of a normal raster.
        const pA = worldToPixel(af, ixMin, iyMin)
        const pB = worldToPixel(af, ixMax, iyMax)
        const left = clamp(Math.round(Math.min(pA.col, pB.col)), 0, w)
        const right = clamp(Math.round(Math.max(pA.col, pB.col)), 0, w)
        const top = clamp(Math.round(Math.min(pA.row, pB.row)), 0, h)
        const bottom = clamp(Math.round(Math.max(pA.row, pB.row)), 0, h)
        if (right <= left || bottom <= top) continue

        const bands = await image.readRasters({ window: [left, top, right, bottom], samples })
        const rw = right - left, rh = bottom - top

        for (let ry = 0; ry < rh; ry++) {
          // Source row to world northing, then to the output's north-up row.
          const northing = af.h + af.f * (top + ry + 0.5)
          const outRow = Math.floor((win.maxY - northing) / PIXEL_M)
          if (outRow < 0 || outRow >= win.height) continue
          for (let rx = 0; rx < rw; rx++) {
            const easting = af.d + af.a * (left + rx + 0.5)
            const outCol = Math.floor((easting - win.minX) / PIXEL_M)
            if (outCol < 0 || outCol >= win.width) continue
            const dst = outRow * win.width + outCol
            const src = ry * rw + rx
            for (let b = 0; b < DIMS; b++) out[b * win.width * win.height + dst] = bands[b][src]
            covered[dst] = 1
          }
        }
      }
    }
  }

  let missing = 0
  for (let i = 0; i < covered.length; i++) if (!covered[i]) missing++
  return { data: out, covered, missing }
}

// ── Matching a raster you already have ───────────────────────────────────────

/**
 * The EPSG code a GeoTIFF states about itself.
 *
 * Narrow on purpose. The app can *place* features in a handful of projections
 * and says so where it cannot; this only has to answer "which grid is this in"
 * well enough to invert it, and a file that will not say is better refused than
 * guessed at — a plate cut against a guessed projection lands hundreds of
 * metres out and still looks like a considered drawing.
 */
function crsOfGeoTiff(image) {
  const keys = image.getGeoKeys?.() ?? {}
  const projected = keys.ProjectedCSTypeGeoKey
  const geographic = keys.GeographicTypeGeoKey
  if (projected && projected !== 32767) return `EPSG:${projected}`
  if (geographic && geographic !== 32767) return `EPSG:${geographic}`
  throw new Error(
    'That GeoTIFF does not state its projection, so there is no way to line a plate up with it. ' +
    'Run it through `gdalwarp -t_srs EPSG:4326` first, or cut the plate with --place instead.')
}

/**
 * Everything about a raster that a plate has to match.
 *
 * Read straight from the file rather than asked for on the command line, which
 * is the whole point of `--dem`: the extent is already stated, in the one place
 * that cannot disagree with the pixels.
 */
async function readDemGrid(file) {
  const buf = await readFile(file)
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const image = await tiff.getImage()
  const af = affineOf(image)
  const width = image.getWidth(), height = image.getHeight()
  const crs = crsOfGeoTiff(image)
  const corners = [[0, 0], [width, 0], [0, height], [width, height]]
    .map(([c, r]) => [af.d + af.a * c + af.b * r, af.h + af.e * c + af.f * r])
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1])
  return {
    width, height, crs, af,
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  }
}

/**
 * The grid a plate should be cut on for a given raster.
 *
 * Not the raster's own grid, which is the obvious choice and usually the wrong
 * one. The embeddings are 10 m; a raster finer than that — the Graz plate is
 * about 4 m — would have every embedding pixel copied across several plate
 * pixels, which is upsampling dressed as detail. It costs the reduction 64
 * bands over nine million cells to say nothing a quarter of that could not.
 *
 * So the plate is cut at the data's own resolution, or the raster's where the
 * raster is coarser, and `MAX_PLATE_PIXELS` is a backstop rather than the rule.
 * `alignCover` in the app resamples a plate onto whatever raster it is laid
 * over, so a coarser plate loses nothing but bytes.
 */
const MAX_PLATE_PIXELS = 4e6

function plateGridFor(dem) {
  // Ground metres per raster pixel, per axis. A geographic raster states its
  // pixel in degrees, which is a different number on each axis and neither of
  // them metres.
  const [, midLat] = (() => {
    const ll = unprojectWgs84(...demPixelToWorld(dem.af, dem.width / 2, dem.height / 2), dem.crs)
    return ll ? [ll[1], ll[0]] : [0, 0]
  })()
  const geographic = classifyCRS(dem.crs).kind === 'geographic'
  const spanX = Math.abs(dem.bbox[2] - dem.bbox[0]) / dem.width
  const spanY = Math.abs(dem.bbox[3] - dem.bbox[1]) / dem.height
  const groundX = geographic ? spanX * 111320 * Math.cos((midLat * Math.PI) / 180) : spanX
  const groundY = geographic ? spanY * 110574 : spanY

  let sx = Math.max(1, Math.round(PIXEL_M / Math.max(0.01, groundX)))
  let sy = Math.max(1, Math.round(PIXEL_M / Math.max(0.01, groundY)))
  let width = Math.max(1, Math.round(dem.width / sx))
  let height = Math.max(1, Math.round(dem.height / sy))

  // The backstop: a raster coarser than 10 m over a very large extent can still
  // ask for more cells than the reduction will hold.
  if (width * height > MAX_PLATE_PIXELS) {
    const k = Math.sqrt((width * height) / MAX_PLATE_PIXELS)
    sx *= k; sy *= k
    width = Math.max(1, Math.round(dem.width / sx))
    height = Math.max(1, Math.round(dem.height / sy))
  }
  return { width, height, groundX, groundY }
}

/** A DEM pixel centre, in the DEM's own world coordinates. */
const demPixelToWorld = (af, col, row) => [
  af.d + af.a * (col + 0.5) + af.b * (row + 0.5),
  af.h + af.e * (col + 0.5) + af.f * (row + 0.5),
]

/**
 * The UTM window that covers a raster's extent, whatever grid the raster is in.
 *
 * Sampled around the boundary rather than at the four corners, because a
 * projected extent is not a rectangle once reprojected: a wide box's edges bow
 * away from the central meridian, and the sag at the middle of an edge is
 * outside the hull of the corners. `bboxToWgs84` in the app takes nine samples
 * for exactly this reason, and this takes more because the cost is nothing.
 */
function utmWindowCovering(dem, utmCrs) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const N = 16
  for (let i = 0; i <= N; i++) {
    for (const [c, r] of [[i / N, 0], [i / N, 1], [0, i / N], [1, i / N]]) {
      const [wx, wy] = demPixelToWorld(dem.af, c * (dem.width - 1), r * (dem.height - 1))
      const ll = unprojectWgs84(wx, wy, dem.crs)
      if (!ll) {
        throw new Error(
          `${dem.crs} cannot be turned back into longitude and latitude, so the embeddings ` +
          'cannot be matched to it. Reproject the file, or cut the plate with --place instead.')
      }
      const xy = projectWgs84(ll[0], ll[1], utmCrs)
      if (!xy) throw new Error(`Could not project into ${utmCrs}.`)
      if (xy[0] < minX) minX = xy[0]
      if (xy[0] > maxX) maxX = xy[0]
      if (xy[1] < minY) minY = xy[1]
      if (xy[1] > maxY) maxY = xy[1]
    }
  }
  // Snap outward to the embedding lattice, with a pixel of margin so the
  // nearest-neighbour sampling below never reaches past the edge.
  const lo = (v) => Math.floor(v / PIXEL_M) * PIXEL_M - PIXEL_M * 2
  const hi = (v) => Math.ceil(v / PIXEL_M) * PIXEL_M + PIXEL_M * 2
  const x0 = lo(minX), y0 = lo(minY), x1 = hi(maxX), y1 = hi(maxY)
  return {
    minX: x0, minY: y0, maxX: x1, maxY: y1,
    width: Math.round((x1 - x0) / PIXEL_M), height: Math.round((y1 - y0) / PIXEL_M),
  }
}

/**
 * The embeddings, resampled from their UTM window onto the raster's own grid.
 *
 * Backwards, per output pixel, for the reason every resampler runs backwards:
 * pushing source pixels forward leaves holes wherever the two grids diverge,
 * and they diverge most at the edges of a UTM zone. Nearest rather than
 * bilinear because the vectors are about to be classified — an interpolated
 * embedding is a point between two materials, which is not a third material.
 */
function resampleToDem(cube, win, dem, utmCrs, plate) {
  const n = plate.width * plate.height
  const out = new Int8Array(DIMS * n)
  const srcN = win.width * win.height
  const sx = dem.width / plate.width, sy = dem.height / plate.height
  let outside = 0

  for (let r = 0; r < plate.height; r++) {
    for (let c = 0; c < plate.width; c++) {
      // Plate cell to the raster pixel at its centre, then out to the world.
      const [wx, wy] = demPixelToWorld(dem.af, (c + 0.5) * sx - 0.5, (r + 0.5) * sy - 0.5)
      const ll = unprojectWgs84(wx, wy, dem.crs)
      const xy = ll && projectWgs84(ll[0], ll[1], utmCrs)
      if (!xy) { outside++; continue }
      const sc = Math.floor((xy[0] - win.minX) / PIXEL_M)
      const sr = Math.floor((win.maxY - xy[1]) / PIXEL_M)
      if (sc < 0 || sc >= win.width || sr < 0 || sr >= win.height) { outside++; continue }
      const src = sr * win.width + sc
      const dst = r * plate.width + c
      for (let b = 0; b < DIMS; b++) out[b * n + dst] = cube[b * srcN + src]
    }
  }
  return { data: out, outside }
}

// ── The reduction ────────────────────────────────────────────────────────────

/**
 * The vectors, normalised.
 *
 * The published values are quantised to Int8 on a scale the dataset does not
 * state, so the stored norm is a constant well away from 1. Every use here is
 * angular — cosine similarity, spherical k-means, a covariance of centred unit
 * vectors — so normalising is both the correct reading of the model and the
 * thing that makes the scale irrelevant.
 */
function unitVectors(raw, n) {
  const v = new Float32Array(DIMS * n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let b = 0; b < DIMS; b++) { const x = raw[b * n + i]; sum += x * x }
    const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0
    for (let b = 0; b < DIMS; b++) v[b * n + i] = raw[b * n + i] * inv
  }
  return v
}

/**
 * Spherical k-means over the unit vectors.
 *
 * Cosine, not Euclidean, because the embedding is defined on a sphere: two
 * vectors mean the same cover when they point the same way, whatever the
 * quantiser did to their length. On the sphere the nearest centroid by angle is
 * the largest dot product, so the assignment step is a matrix product and the
 * update step is a sum followed by a renormalisation.
 *
 * The seeding is deterministic. A cover plate that reshuffles its classes
 * between two runs of the same window would make every preset built on it a
 * one-off, so the generator is seeded from a constant rather than from the clock.
 */
function kmeans(v, n, k, iters = 40) {
  let seed = 0x9e3779b9
  const rand = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return ((seed >>> 0) % 0xffffffff) / 0xffffffff
  }

  const cent = new Float32Array(DIMS * k)
  const picked = new Set()
  for (let j = 0; j < k; j++) {
    let idx = Math.floor(rand() * n)
    while (picked.has(idx) && picked.size < n) idx = Math.floor(rand() * n)
    picked.add(idx)
    for (let b = 0; b < DIMS; b++) cent[b * k + j] = v[b * n + idx]
  }

  const labels = new Uint8Array(n)
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let best = -Infinity, bestJ = 0
      for (let j = 0; j < k; j++) {
        let dot = 0
        for (let b = 0; b < DIMS; b++) dot += v[b * n + i] * cent[b * k + j]
        if (dot > best) { best = dot; bestJ = j }
      }
      labels[i] = bestJ
    }
    const acc = new Float64Array(DIMS * k)
    const count = new Int32Array(k)
    for (let i = 0; i < n; i++) {
      const j = labels[i]
      count[j]++
      for (let b = 0; b < DIMS; b++) acc[b * k + j] += v[b * n + i]
    }
    for (let j = 0; j < k; j++) {
      if (!count[j]) continue
      let sum = 0
      for (let b = 0; b < DIMS; b++) { const x = acc[b * k + j]; sum += x * x }
      const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0
      for (let b = 0; b < DIMS; b++) cent[b * k + j] = acc[b * k + j] * inv
    }
  }
  return { labels, centroids: cent }
}

/**
 * Eigenvectors of a small symmetric matrix, by cyclic Jacobi rotation.
 *
 * The covariance here is 64 × 64, which is small enough that the simplest
 * dependable method wins outright. Jacobi needs no pivoting strategy, no
 * tolerance tuning and no library, and it returns the eigenvectors already
 * orthonormal — which is what the projection below relies on.
 */
function jacobiEigen(matrix, n, sweeps = 60) {
  const a = Float64Array.from(matrix)
  const v = new Float64Array(n * n)
  for (let i = 0; i < n; i++) v[i * n + i] = 1

  for (let s = 0; s < sweeps; s++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2
    if (off < 1e-16) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]
        if (Math.abs(apq) < 1e-18) continue
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1), sn = t * c
        for (let i = 0; i < n; i++) {
          const aip = a[i * n + p], aiq = a[i * n + q]
          a[i * n + p] = c * aip - sn * aiq
          a[i * n + q] = sn * aip + c * aiq
        }
        for (let i = 0; i < n; i++) {
          const api = a[p * n + i], aqi = a[q * n + i]
          a[p * n + i] = c * api - sn * aqi
          a[q * n + i] = sn * api + c * aqi
        }
        for (let i = 0; i < n; i++) {
          const vip = v[i * n + p], viq = v[i * n + q]
          v[i * n + p] = c * vip - sn * viq
          v[i * n + q] = sn * vip + c * viq
        }
      }
    }
  }
  const values = new Float64Array(n)
  for (let i = 0; i < n; i++) values[i] = a[i * n + i]
  return { values, vectors: v }
}

/**
 * The window's own three strongest axes, inked as red, green and blue.
 *
 * Fixed axes would be comparable between windows and useless inside one: the
 * variance that separates a quarry from a spruce stand is not the variance that
 * separates open ocean from ice. Taking the axes from the window means the plate
 * always spends its whole colour range on the distinctions that are actually
 * present here.
 *
 * The 2nd and 98th percentiles set the ends of the ramp rather than the extremes,
 * so one glinting roof cannot compress everything else into a narrow band.
 */
function principalPlate(v, n) {
  const mean = new Float64Array(DIMS)
  for (let b = 0; b < DIMS; b++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += v[b * n + i]
    mean[b] = sum / n
  }
  const cov = new Float64Array(DIMS * DIMS)
  for (let p = 0; p < DIMS; p++) {
    for (let q = p; q < DIMS; q++) {
      let sum = 0
      for (let i = 0; i < n; i++) sum += (v[p * n + i] - mean[p]) * (v[q * n + i] - mean[q])
      const c = sum / n
      cov[p * DIMS + q] = c
      cov[q * DIMS + p] = c
    }
  }
  const { values, vectors } = jacobiEigen(cov, DIMS)
  const order = [...values.keys()].sort((x, y) => values[y] - values[x])
  const total = values.reduce((s, x) => s + Math.max(0, x), 0) || 1
  const variance = order.slice(0, 3).reduce((s, i) => s + Math.max(0, values[i]), 0) / total

  const proj = new Float32Array(3 * n)
  for (let axis = 0; axis < 3; axis++) {
    const col = order[axis]
    for (let i = 0; i < n; i++) {
      let sum = 0
      for (let b = 0; b < DIMS; b++) sum += (v[b * n + i] - mean[b]) * vectors[b * DIMS + col]
      proj[axis * n + i] = sum
    }
  }

  const rgb = new Uint8Array(3 * n)
  for (let axis = 0; axis < 3; axis++) {
    const slice = Array.from(proj.subarray(axis * n, axis * n + n)).sort((x, y) => x - y)
    const lo = slice[Math.floor(0.02 * (n - 1))]
    const hi = slice[Math.floor(0.98 * (n - 1))]
    const span = hi - lo || 1
    for (let i = 0; i < n; i++) {
      rgb[i * 3 + axis] = Math.round(clamp((proj[axis * n + i] - lo) / span, 0, 1) * 255)
    }
  }
  return { rgb, variance }
}

/**
 * A class's colour, taken from the plate rather than from a fixed table.
 *
 * A palette invented here would be arbitrary, and worse, would be the *same*
 * arbitrary six whatever the window held. Averaging each class's own plate
 * colour means the swatch in the panel already looks like the ground it stands
 * for — water reads blue, conifer reads dark green, worked rock reads pale — and
 * it costs one pass.
 */
function classColours(labels, rgb, k, n) {
  const acc = new Float64Array(k * 3)
  const count = new Int32Array(k)
  for (let i = 0; i < n; i++) {
    const j = labels[i]
    count[j]++
    acc[j * 3] += rgb[i * 3]
    acc[j * 3 + 1] += rgb[i * 3 + 1]
    acc[j * 3 + 2] += rgb[i * 3 + 2]
  }
  const hex = (x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')
  return Array.from({ length: k }, (_, j) => {
    const c = count[j] || 1
    return {
      index: j,
      name: `Class ${String.fromCharCode(65 + j)}`,
      color: `#${hex(acc[j * 3] / c)}${hex(acc[j * 3 + 1] / c)}${hex(acc[j * 3 + 2] / c)}`,
      share: Number((count[j] / n).toFixed(4)),
    }
  })
}

/** The supplied raster's own elevation band, for describing classes by terrain. */
async function readDemBand(file, dem, grid) {
  const buf = await readFile(file)
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const image = await tiff.getImage()
  const band = (await image.readRasters({ samples: [0] }))[0]
  if (!grid || (grid.width === dem.width && grid.height === dem.height)) return Float32Array.from(band)

  // Nearest, onto the plate's grid. This feeds a mean slope per class, which a
  // sample per cell answers as well as an average would.
  const out = new Float32Array(grid.width * grid.height)
  const sx = dem.width / grid.width, sy = dem.height / grid.height
  for (let r = 0; r < grid.height; r++) {
    const sr = Math.min(dem.height - 1, Math.floor((r + 0.5) * sy))
    for (let c = 0; c < grid.width; c++) {
      out[r * grid.width + c] = band[sr * dem.width + Math.min(dem.width - 1, Math.floor((c + 0.5) * sx))]
    }
  }
  return out
}

/** A grid's extent as [minLon, minLat, maxLon, maxLat], or null if it cannot be. */
function gridToWgs84Bbox(grid) {
  const [x0, y0, x1, y1] = grid.bbox
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
  // The edges, not just the corners: a projected extent bows, and a query box
  // taken from the corners alone clips whatever sags outside them.
  const N = 8
  for (let i = 0; i <= N; i++) {
    const t = i / N
    for (const [x, y] of [[x0 + t * (x1 - x0), y0], [x0 + t * (x1 - x0), y1],
                          [x0, y0 + t * (y1 - y0)], [x1, y0 + t * (y1 - y0)]]) {
      const ll = unprojectWgs84(x, y, grid.crs)
      if (!ll) return null
      if (ll[1] < minLon) minLon = ll[1]; if (ll[1] > maxLon) maxLon = ll[1]
      if (ll[0] < minLat) minLat = ll[0]; if (ll[0] > maxLat) maxLat = ll[0]
    }
  }
  return [minLon, minLat, maxLon, maxLat]
}

/**
 * WGS84 to a pixel of the output grid.
 *
 * Through the raster's own affine when one was supplied, because a GeoTIFF is
 * entitled to a rotation and a bounding box cannot express one. Otherwise
 * through the extent, which is exact for the north-up grid this script writes.
 */
function wgs84ToGridPixel(grid, dem) {
  if (dem) {
    const { a, b, d, e, f, h } = dem.af
    const det = a * f - b * e
    // The affine answers in the *raster's* pixels, and the plate is cut on its
    // own grid — coarser whenever the raster is finer than 10 m. Painting the
    // polygons at raster scale onto a plate half its width put every one of
    // them in the top-left quadrant, and the tally that came out of it was the
    // same for every class, which is what a uniform answer usually means.
    const sx = grid.width / dem.width, sy = grid.height / dem.height
    return (lat, lon) => {
      const xy = projectWgs84(lat, lon, grid.crs)
      if (!xy || !det) return null
      const dx = xy[0] - d, dy = xy[1] - h
      return [((f * dx - b * dy) / det) * sx, ((a * dy - e * dx) / det) * sy]
    }
  }
  const [x0, y0, x1, y1] = grid.bbox
  return (lat, lon) => {
    const xy = projectWgs84(lat, lon, grid.crs)
    if (!xy) return null
    return [((xy[0] - x0) / (x1 - x0)) * grid.width,
            ((y1 - xy[1]) / (y1 - y0)) * grid.height]
  }
}

// ── What the classes actually sit on ─────────────────────────────────────────

/**
 * Overpass, for the one question a cluster cannot answer about itself.
 *
 * k-means returns six groups of pixels and no idea what any of them *is*. The
 * embedding will not say either: its axes are unsigned and unnamed, so "the
 * green one" means nothing, and a label invented from the colour would be a
 * guess wearing the clothes of a fact.
 *
 * OpenStreetMap has been answering this question for twenty years. Asking it
 * which polygons cover the window, and then which polygon each class mostly
 * falls inside, turns "Class B" into "wood, 71% of it" — a name with a source
 * and a number attached, so a reader can see how much to trust it.
 *
 * Same endpoints and the same selectors the app's own Vector Layers use. One
 * query per run, `out geom` so the ways arrive with their coordinates already
 * on them rather than needing a second round trip for nodes.
 */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

/**
 * The tags worth naming a class after, in the app's own category list.
 *
 * Relations as well as ways, and that is not belt-and-braces. The Erzberg
 * itself — the single most obvious feature in the window this was built for —
 * is a `type=multipolygon` relation, so a way-only query came back with 93
 * polygons and not one of them the mine.
 */
const LANDUSE_RE = '^(forest|meadow|farmland|orchard|vineyard|quarry|residential|industrial|cemetery)$'
const NATURAL_RE = '^(wood|scrub|grassland|heath|glacier|scree|bare_rock|sand|wetland|water)$'
const LANDCOVER_SELECTORS = [
  `way["landuse"~"${LANDUSE_RE}"]`,
  `relation["landuse"~"${LANDUSE_RE}"]`,
  `way["natural"~"${NATURAL_RE}"]`,
  `relation["natural"~"${NATURAL_RE}"]`,
  'way["waterway"="riverbank"]',
]

/** How a tag value reads once it is a label rather than a key. */
const TAG_LABEL = {
  bare_rock: 'bare rock', scree: 'scree', wood: 'woodland', forest: 'forest',
  scrub: 'scrub', grassland: 'grassland', heath: 'heath', glacier: 'glacier',
  sand: 'sand', wetland: 'wetland', water: 'water', riverbank: 'water',
  meadow: 'meadow', farmland: 'farmland', orchard: 'orchard', vineyard: 'vineyard',
  quarry: 'quarry', residential: 'built-up', industrial: 'industrial', cemetery: 'cemetery',
}

async function overpassLandcover(bboxWgs84) {
  const [minLon, minLat, maxLon, maxLat] = bboxWgs84
  const bbox = `${minLat},${minLon},${maxLat},${maxLon}`
  const query = `[out:json][timeout:90];(${LANDCOVER_SELECTORS.map((sel) => `${sel}(${bbox});`).join('')});out geom;`

  /*
   * Two passes over three mirrors, with a pause between them.
   *
   * The failures this survives are not about the query. Measured against the
   * main instance the whole thing answers in under four seconds — and answers
   * `504` or `429` when it is busy or when it has seen too much of you lately,
   * which a script cutting several plates in a row certainly has. Both are
   * worth waiting out rather than giving up on, because the alternative is a
   * plate whose classes come back unnamed for a reason that had nothing to do
   * with the ground.
   */
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await new Promise((r) => setTimeout(r, 4000))
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                     'User-Agent': 'erzberg/embed-window' },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(120_000),
        })
        if (!res.ok) {
          if (process.env.AE_DEBUG) console.error(`         [${url}] HTTP ${res.status}`)
          continue
        }
        const json = await res.json()
        return json.elements ?? []
      } catch (err) {
        if (process.env.AE_DEBUG) console.error(`         [${url}] ${err.message}`)
      }
    }
  }
  return null
}

/**
 * A multipolygon's member ways, joined back into closed rings.
 *
 * Overpass hands a relation's geometry back one member way at a time, and a
 * ring of any size is usually several of them: the Erzberg's outline arrives as
 * a dozen segments in no particular order and with no consistent direction.
 * Filling each segment as though it were a closed ring paints a dozen slivers
 * where one crater belongs.
 *
 * So segments are walked end to end, either way round, until the ends meet.
 * Coordinates are compared at seven decimal places — about a centimetre, which
 * is finer than OSM records and coarser than float noise.
 */
function stitchRings(members) {
  const segs = members
    .filter((m) => m.geometry?.length >= 2)
    .map((m) => m.geometry.map((g) => [g.lon, g.lat]))
  const key = (pt) => `${pt[0].toFixed(7)},${pt[1].toFixed(7)}`
  const rings = []

  while (segs.length) {
    let ring = segs.pop()
    let joined = true
    while (joined && key(ring[0]) !== key(ring[ring.length - 1])) {
      joined = false
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]
        const head = key(ring[0]), tail = key(ring[ring.length - 1])
        if (tail === key(seg[0]))                    ring = ring.concat(seg.slice(1))
        else if (tail === key(seg[seg.length - 1]))  ring = ring.concat(seg.slice(0, -1).reverse())
        else if (head === key(seg[seg.length - 1]))  ring = seg.slice(0, -1).concat(ring)
        else if (head === key(seg[0]))               ring = seg.slice(1).reverse().concat(ring)
        else continue
        segs.splice(i, 1)
        joined = true
        break
      }
    }
    // An unclosed run is a relation that reaches outside the query box. Its
    // ends are the box, so closing it implicitly is right rather than sloppy.
    if (ring.length >= 4) rings.push(ring)
  }
  return rings
}

/** The rings an element contributes, as [outer[], inner[]] in lon/lat. */
function ringsOf(el) {
  if (el.type === 'way') return [el.geometry?.length >= 3 ? [el.geometry.map((g) => [g.lon, g.lat])] : [], []]
  const members = el.members ?? []
  return [
    stitchRings(members.filter((m) => m.role !== 'inner')),
    stitchRings(members.filter((m) => m.role === 'inner')),
  ]
}

/**
 * Which landcover tag each pixel of the grid falls inside.
 *
 * Painted largest polygon first, so a quarry inside a forest keeps the quarry:
 * later paint wins, and the later ones are the smaller, more specific ones.
 * That is the same convention a paper map uses and it is why the order matters
 * more than any per-tag priority table would.
 *
 * A relation's holes are punched immediately after its own outline rather than
 * in a pass of their own, so a hole never reaches through a polygon that was
 * painted after it. A hole therefore reads as untagged rather than as whatever
 * lies beneath, which is the right answer often enough and an honest one always
 * — an untagged pixel simply does not vote.
 */
function paintLandcover(elements, grid, toPixel) {
  const tags = ['']
  const idOf = new Map()
  const painted = new Uint8Array(grid.width * grid.height)
  const bounds = { x: 0, y: 0, w: grid.width, h: grid.height }

  const project = (ring) => {
    const pts = new Float64Array(ring.length * 2)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < ring.length; i++) {
      const xy = toPixel(ring[i][1], ring[i][0])
      if (!xy) return null
      pts[i * 2] = xy[0]; pts[i * 2 + 1] = xy[1]
      if (xy[0] < minX) minX = xy[0]
      if (xy[0] > maxX) maxX = xy[0]
      if (xy[1] < minY) minY = xy[1]
      if (xy[1] > maxY) maxY = xy[1]
    }
    return { pts, area: (maxX - minX) * (maxY - minY) }
  }

  const polys = []
  for (const el of elements) {
    const value = el.tags?.natural ?? el.tags?.landuse ?? el.tags?.waterway
    if (!value || !TAG_LABEL[value]) continue
    const [outers, inners] = ringsOf(el)
    if (!outers.length) continue
    const outer = outers.map(project).filter(Boolean)
    if (!outer.length) continue
    if (!idOf.has(value)) { idOf.set(value, tags.length); tags.push(value) }
    polys.push({
      outer, inner: inners.map(project).filter(Boolean),
      id: idOf.get(value),
      area: Math.max(...outer.map((o) => o.area)),
    })
  }

  polys.sort((a, b) => b.area - a.area)
  for (const poly of polys) {
    for (const ring of poly.outer) fillPolygon(painted, ring.pts, bounds, poly.id)
    for (const ring of poly.inner) fillPolygon(painted, ring.pts, bounds, 0)
  }
  return { painted, tags, polygons: polys.length }
}

/**
 * A name for each class, and the evidence for it.
 *
 * Three rules, and the second is the one that earns its keep.
 *
 * **Name it after what it mostly sits on.** Below `NAMED_AT` there is no
 * dominant anything, and printing a word anyway would make the panel
 * confidently wrong exactly where a reader most needs to doubt it. Such a class
 * keeps its letter.
 *
 * **Part the ones that collide.** Over a mine, three of six classes come back
 * "Quarry" — all true, and useless in a legend where the whole job is telling
 * them apart. A repeated name takes the terrain word that distinguishes it, so
 * the list reads Quarry · steep, Quarry · gentle, and stays honest while
 * becoming usable.
 *
 * **Show the runner-up.** A class that is 54% forest and 36% quarry is a real
 * mixture and saying so is more use than a single word, because it tells the
 * reader which boundary to distrust.
 */
const NAMED_AT = 0.3

const titleCase = (t) => t.replace(/^./, (ch) => ch.toUpperCase())

function nameClasses(classes, labels, painted, tags, terrain) {
  const named = classes.map((c) => {
    let total = 0
    const hits = new Int32Array(tags.length)
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] !== c.index) continue
      total++
      if (painted) hits[painted[i]]++
    }
    // Index 0 is "no tag here", and over an unmapped window it is the biggest
    // bucket of the lot. It does not get a vote.
    const ranked = []
    for (let t = 1; t < tags.length; t++) if (hits[t]) ranked.push([t, hits[t] / (total || 1)])
    ranked.sort((a, b) => b[1] - a[1])

    const ground = terrain?.[c.index]
    if (painted && ranked.length && ranked[0][1] >= NAMED_AT) {
      const parts = ranked.slice(0, 2)
        .filter(([, share], i) => i === 0 || share >= 0.15)
        .map(([t, share]) => `${Math.round(share * 100)}% ${TAG_LABEL[tags[t]]}`)
      return { ...c,
        name: titleCase(TAG_LABEL[tags[ranked[0][0]]]),
        qualifier: ground?.slope.toLowerCase() ?? null,
        height: ground?.height ?? null,
        note: `OpenStreetMap: ${parts.join(', ')}` }
    }
    return { ...c,
      name: c.name,
      qualifier: null,
      height: null,
      note: ground ? `${ground.slope} ground, ${ground.height} in the window · ${ground.degrees}°` : null }
  })

  /*
   * Two rows a reader cannot tell apart are the one thing a legend must not
   * have, so collisions are broken in widening steps and the last one always
   * works.
   *
   * Over the Dolomites the first step is not enough on its own: four of six
   * classes come back "Bare rock" and two of those are both steep, so the slope
   * word parts them into two pairs and leaves one pair standing. Height parts
   * that. Where even height ties — two classes genuinely alike in cover, slope
   * and elevation, differing only in the embedding — the letter is what is left,
   * and an honest "A" beats a duplicate.
   */
  const widen = [
    (c) => c.name,
    (c) => (c.qualifier ? `${c.name} · ${c.qualifier}` : c.name),
    (c) => (c.height ? `${c.name} · ${c.qualifier ?? ''} ${c.height}`.replace(/ +/g, ' ').replace('· ', '· ') : c.name),
    (c) => `${c.name} ${String.fromCharCode(65 + c.index)}`,
  ]

  let labelled = named.map((c) => ({ ...c, name: widen[0](c) }))
  for (let step = 1; step < widen.length; step++) {
    const count = new Map()
    for (const c of labelled) count.set(c.name, (count.get(c.name) ?? 0) + 1)
    if (![...count.values()].some((n) => n > 1)) break
    labelled = labelled.map((c, i) =>
      (count.get(c.name) > 1 ? { ...c, name: widen[step](named[i]) } : c))
  }
  return labelled
}

/**
 * What the app can say about a class with no help from anybody.
 *
 * Mean slope and mean height, stated as a rank among the classes rather than in
 * metres and degrees, because the useful question is never "how steep" but
 * "which of these six is the steep one". Always available, since the terrain is
 * in hand either way. It is what a class falls back to when OpenStreetMap has
 * never been over this ground, and what parts two classes that share a name.
 */
function terrainNotes(classes, labels, elev, width, height) {
  const n = classes.length
  const slopeSum = new Float64Array(n), elevSum = new Float64Array(n), count = new Int32Array(n)
  for (let r = 1; r < height - 1; r++) {
    for (let c = 1; c < width - 1; c++) {
      const i = r * width + c
      const k = labels[i]
      if (k >= n) continue
      const dzdx = (elev[i + 1] - elev[i - 1]) / (2 * PIXEL_M)
      const dzdy = (elev[i + width] - elev[i - width]) / (2 * PIXEL_M)
      slopeSum[k] += Math.hypot(dzdx, dzdy)
      elevSum[k] += elev[i]
      count[k]++
    }
  }
  const slope = classes.map((c) => (count[c.index] ? slopeSum[c.index] / count[c.index] : 0))
  const high = classes.map((c) => (count[c.index] ? elevSum[c.index] / count[c.index] : 0))
  const rank = (arr, i) => arr.filter((v) => v > arr[i]).length / Math.max(1, arr.length - 1)
  const word = (r, lo, mid, hi) => (r < 0.34 ? hi : r < 0.67 ? mid : lo)

  const out = {}
  classes.forEach((c, i) => {
    out[c.index] = {
      slope: word(rank(slope, i), 'Gentle', 'Moderate', 'Steep'),
      height: word(rank(high, i), 'low', 'mid', 'high'),
      degrees: Math.round((Math.atan(slope[i]) * 180) / Math.PI),
    }
  })
  return out
}

// ── The ground ───────────────────────────────────────────────────────────────

const lonToTileX = (lon, z) => ((lon + 180) / 360) * 2 ** z
const latToTileY = (lat, z) => {
  const r = (clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}

/**
 * Elevation for the window, resampled into the embedding's grid.
 *
 * The terrain arrives as Mapzen terrarium tiles in Web Mercator and has to end
 * up in UTM on the embedding's 10 m lattice, so the resampling runs backwards:
 * each output pixel is unprojected to longitude and latitude, turned into a
 * fractional terrarium pixel, and read bilinearly. Going the other way — pushing
 * source pixels forward — leaves holes wherever the two grids diverge, and they
 * diverge most at the edges of a UTM zone.
 */
async function fetchElevation(win, crs, zoom) {
  // `unprojectWgs84` answers [lat, lon] — latitude first, as the app's own
  // callers read it.
  const corners = [
    unprojectWgs84(win.minX, win.minY, crs), unprojectWgs84(win.maxX, win.minY, crs),
    unprojectWgs84(win.minX, win.maxY, crs), unprojectWgs84(win.maxX, win.maxY, crs),
  ]
  if (corners.some((c) => !c)) throw new Error(`${crs} cannot be inverted, so the ground cannot be placed.`)
  const lats = corners.map((c) => c[0]), lons = corners.map((c) => c[1])
  const x0 = Math.floor(lonToTileX(Math.min(...lons), zoom))
  const x1 = Math.floor(lonToTileX(Math.max(...lons), zoom))
  const y0 = Math.floor(latToTileY(Math.max(...lats), zoom))
  const y1 = Math.floor(latToTileY(Math.min(...lats), zoom))

  const cols = x1 - x0 + 1, rows = y1 - y0 + 1
  const mosaic = new Float32Array(cols * TILE * rows * TILE)
  const mw = cols * TILE

  const jobs = []
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty])

  let credit = null
  await pooled(jobs, 8, async ([tx, ty]) => {
    const res = await fetch(`${TERRARIUM}/${zoom}/${tx}/${ty}.png`)
    if (!res.ok) return
    credit = credit ?? res.headers.get('x-amz-meta-source-dataset')
    const png = decodePng(Buffer.from(await res.arrayBuffer()))
    const bx = (tx - x0) * TILE, by = (ty - y0) * TILE
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const s = (y * TILE + x) * png.channels
        // Terrarium packs metres into RGB: (R * 256 + G + B / 256) − 32768.
        mosaic[(by + y) * mw + bx + x] =
          png.data[s] * 256 + png.data[s + 1] + png.data[s + 2] / 256 - 32768
      }
    }
  })

  const out = new Float32Array(win.width * win.height)
  let min = Infinity, max = -Infinity
  for (let r = 0; r < win.height; r++) {
    const northing = win.maxY - (r + 0.5) * PIXEL_M
    for (let c = 0; c < win.width; c++) {
      const easting = win.minX + (c + 0.5) * PIXEL_M
      const [lat, lon] = unprojectWgs84(easting, northing, crs)
      const fx = (lonToTileX(lon, zoom) - x0) * TILE
      const fy = (latToTileY(lat, zoom) - y0) * TILE
      const ix = clamp(Math.floor(fx), 0, mw - 2)
      const iy = clamp(Math.floor(fy), 0, rows * TILE - 2)
      const tx = fx - ix, ty = fy - iy
      const v00 = mosaic[iy * mw + ix], v10 = mosaic[iy * mw + ix + 1]
      const v01 = mosaic[(iy + 1) * mw + ix], v11 = mosaic[(iy + 1) * mw + ix + 1]
      const v = v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) +
                v01 * (1 - tx) * ty + v11 * tx * ty
      out[r * win.width + c] = v
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return { elev: out, min, max, credit }
}

/**
 * Just enough PNG to read a terrarium tile.
 *
 * The tiles are 8-bit RGB or RGBA with the standard filters, which is a small
 * enough corner of the format to decode directly and not worth a dependency.
 * The same five filters are reconstructed here as in the app's own loader.
 */
function decodePng(buf) {
  let pos = 8
  let width = 0, height = 0, channels = 3, bitDepth = 8
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body[8]
      const colorType = body[9]
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`Terrain tile has bit depth ${bitDepth}; expected 8.`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    const prev = dst - stride
    for (let x = 0; x < stride; x++) {
      const f = raw[src + x]
      const a = x >= channels ? out[dst + x - channels] : 0
      const b = y > 0 ? out[prev + x] : 0
      const c = x >= channels && y > 0 ? out[prev + x - channels] : 0
      let v
      switch (filter) {
        case 1: v = f + a; break
        case 2: v = f + b; break
        case 3: v = f + ((a + b) >> 1); break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          v = f + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: v = f
      }
      out[dst + x] = v & 0xff
    }
  }
  return { width, height, channels, data: out }
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * The window's elevation, as a GeoTIFF the app already knows how to open.
 *
 * Written north-up with an ordinary tiepoint and pixel scale — the opposite of
 * the south-up source tiles — so that nothing downstream has to know this
 * pipeline existed. The projection key is the UTM code, which is inside the
 * family `geoCoords.js` can transform, so a GPX track or an OSM overlay lands on
 * this raster correctly with no further work.
 */
function writeGeoTiff(elev, win, crsCode) {
  return Buffer.from(writeArrayBuffer(elev, {
    width: win.width,
    height: win.height,
    ModelPixelScale: [PIXEL_M, PIXEL_M, 0],
    ModelTiepoint: [0, 0, 0, win.minX, win.maxY, 0],
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: 1,
    ProjectedCSTypeGeoKey: crsCode,
    ProjLinearUnitsGeoKey: 9001,
  }))
}

/**
 * Bytes into the cover file.
 *
 * Deflate then base64, rather than a PNG: the payload is a plain byte per pixel
 * with no image semantics worth preserving, both sides of the wire already have
 * a deflate implementation, and skipping the container removes the only part of
 * this format that could disagree about row order.
 */
const packBytes = (bytes) => deflateSync(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).toString('base64')

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || (!args.place && !args.bbox && !args.dem)) {
    console.log(USAGE)
    process.exit(args.help ? 0 : 1)
  }
  if (!(args.year >= 2017 && args.year <= 2024)) {
    throw new Error(`--year must be between 2017 and 2024; got ${args.year}.`)
  }
  // The ceiling is the app's, not this script's: a layer's class selection
  // travels as one signed 32-bit integer, one bit per class.
  if (!(args.classes >= 2 && args.classes <= MAX_CLASSES)) {
    throw new Error(`--classes must be between 2 and ${MAX_CLASSES}; got ${args.classes}.`)
  }

  /*
   * Three ways to say where, and one of them is the file itself.
   *
   * `--dem` is the path to reach for when a raster already exists, because the
   * extent is stated in it and typing a place back in by hand is how a plate
   * ends up describing ground a few hundred metres from the ground it is laid
   * over. The plate then comes out on the raster's own grid, pixel for pixel,
   * which is the one alignment that cannot be slightly wrong.
   */
  let dem = null
  if (args.dem) {
    if (!existsSync(args.dem)) throw new Error(`No such file: ${args.dem}`)
    dem = await readDemGrid(args.dem)
    console.log(`Raster   ${args.dem}`)
    // Degrees rounded to whole numbers read as a raster of zero height, which
    // is how `15 47 16 47` came to describe a 16 km window over Graz.
    const dp = classifyCRS(dem.crs).kind === 'geographic' ? 4 : 0
    console.log(`         ${dem.width} × ${dem.height} px · ${dem.crs} · ` +
                `${dem.bbox.map((v) => v.toFixed(dp)).join(' ')}`)
  }

  let centre, label, km = args.km
  if (dem) {
    const mid = demPixelToWorld(dem.af, (dem.width - 1) / 2, (dem.height - 1) / 2)
    const ll = unprojectWgs84(mid[0], mid[1], dem.crs)
    if (!ll) {
      throw new Error(
        `${dem.crs} cannot be turned back into longitude and latitude, so the embeddings ` +
        'cannot be matched to it. Reproject the file, or cut the plate with --place instead.')
    }
    centre = { lat: ll[0], lon: ll[1] }
    label = path.basename(args.dem)
  } else if (args.bbox) {
    const [a, b, c, d] = args.bbox.split(',').map(Number)
    if ([a, b, c, d].some((v) => !Number.isFinite(v))) throw new Error('--bbox wants lon,lat,lon,lat.')
    centre = { lat: (b + d) / 2, lon: (a + c) / 2 }
    label = `${centre.lat.toFixed(4)}, ${centre.lon.toFixed(4)}`
    // The longer side decides, so the requested box always fits inside the square.
    const midLat = (b + d) * 0.5
    km = Math.max(Math.abs(c - a) * 111.32 * Math.cos((midLat * Math.PI) / 180), Math.abs(d - b) * 110.57)
  } else {
    const hit = await geocode(args.place)
    centre = { lat: hit.lat, lon: hit.lon }
    label = hit.label
    console.log(`Place    ${label}`)
  }

  const cacheDir = path.join(path.dirname(new URL(import.meta.url).pathname), '.ae-index')
  const zones = candidateZones(centre, dem?.crs)

  /*
   * Each candidate is a whole question: its own window, its own index, its own
   * coverage. The first that answers wins, and the rest are never asked — so
   * the usual case still probes exactly one zone.
   */
  let utm = null, win = null, hashes = [], read = null
  const tried = []
  for (const candidate of zones) {
    const w = dem ? utmWindowCovering(dem, candidate.crs) : windowFor(centre, km, candidate.crs)
    // Only the *read* is capped here. A raster larger than this is not refused
    // — `plateGridFor` cuts its plate coarser instead — but a window that needs
    // more than this many embedding pixels is asking for more ground than one
    // run should pull.
    const count = w.width * w.height
    if (count > MAX_PLATE_PIXELS) {
      throw new Error(
        dem
          ? `That raster spans ${Math.round(Math.sqrt(count) * PIXEL_M / 1000)} km of ground, which ` +
            `needs ${count.toLocaleString()} embedding pixels to cover. Crop it first.`
          : `That window is ${count.toLocaleString()} pixels. Keep --km under ` +
            `${Math.floor(Math.sqrt(MAX_PLATE_PIXELS) * PIXEL_M / 1000)} so the read stays reasonable.`)
    }

    console.log(`Index    locating exports for ${args.year} zone ${candidate.name}…`)
    const idx = await exportIndex(args.year, candidate.name, cacheDir)
    const found = selectExports(idx, w)
    console.log(`         ${idx.total} export(s) in zone, ${idx.probed} newly probed, ` +
                `${found.length} may cover this window`)
    if (!found.length) { tried.push(`${candidate.name}: none on the lattice`); continue }

    /*
     * The read is the verification.
     *
     * `selectExports` only knows where an export *starts* — its extent comes
     * from an upper bound, and not every export fills it. So the honest test of
     * a zone is whether any pixel actually comes back, and a zone that fails it
     * costs four header reads that mostly 404 immediately.
     */
    console.log(`Cover    reading 64 bands from ${candidate.name}…`)
    const attempt = await readEmbeddings(args.year, candidate.name, w, found)
    if (attempt.missing === count) {
      console.log('         nothing in those exports reaches this window')
      tried.push(`${candidate.name}: on the lattice, no pixels`)
      continue
    }
    utm = candidate; win = w; hashes = found; read = attempt
    break
  }

  if (!read) {
    throw new Error(
      `No AlphaEarth export covers ${centre.lat.toFixed(4)}, ${centre.lon.toFixed(4)} for ${args.year}.\n` +
      tried.map((t) => `  ${t}`).join('\n') +
      '\nThe ground may sit outside the dataset, or that year may not be published for it.')
  }
  void hashes

  console.log(`Window   ${win.width} × ${win.height} px at ${PIXEL_M} m · ${utm.crs} · ` +
              `${win.minX} ${win.minY} ${win.maxX} ${win.maxY}`)

  if (read.missing) console.log(`         ${read.missing} pixel(s) had no embedding and fall in class 0`)

  // With a raster to match, the cube is carried onto its grid before anything
  // is classified, so the classes are cut from the pixels the app will draw.
  let data = read.data
  let grid = { width: win.width, height: win.height, crs: utm.crs,
               bbox: [win.minX, win.minY, win.maxX, win.maxY] }
  if (dem) {
    const plate = plateGridFor(dem)
    const put = resampleToDem(read.data, win, dem, utm.crs, plate)
    data = put.data
    grid = { width: plate.width, height: plate.height, crs: dem.crs, bbox: dem.bbox }
    const coarser = plate.width !== dem.width || plate.height !== dem.height
    console.log(`         resampled onto ${plate.width} × ${plate.height}` +
      (coarser
        ? ` — the raster is ${plate.groundX.toFixed(1)} m a pixel and the embeddings are ` +
          `${PIXEL_M} m, so the plate is cut at the data's own resolution`
        : " at the raster's own grid"))
    if (put.outside) {
      console.log(`         ${put.outside} pixel(s) of the raster fall outside the embedding window`)
    }
  }

  const count = grid.width * grid.height
  const v = unitVectors(data, count)
  const { labels } = kmeans(v, count, args.classes)
  const { rgb, variance } = principalPlate(v, count)
  let classes = classColours(labels, rgb, args.classes, count)
  console.log(`         ${args.classes} classes · top 3 axes hold ${(variance * 100).toFixed(1)}% of variance`)

  const slug = (args.dem ? path.basename(args.dem).replace(/\.[^.]+$/, '') : (args.place ?? 'window'))
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
  const stem = args.name ?? (slug || 'window')
  await mkdir(args.out, { recursive: true })

  // The ground, either fetched for a window of our own or read back out of the
  // raster we were handed. Wanted either way now: the terrain is what describes
  // a class that OpenStreetMap has never been over.
  let tifPath = null
  let terrainCredit = null
  let elev
  if (dem) {
    // Subsampled to the plate's grid, because `terrainNotes` walks it cell for
    // cell against the class labels.
    elev = await readDemBand(args.dem, dem, grid)
  } else {
    console.log('Terrain  fetching ground…')
    const got = await fetchElevation(win, utm.crs, clamp(args.zoom, 1, MAX_ZOOM))
    elev = got.elev
    console.log(`         ${got.min.toFixed(0)} m to ${got.max.toFixed(0)} m`)
    tifPath = path.join(args.out, `${stem}.tif`)
    await writeFile(tifPath, writeGeoTiff(elev, win, utm.code))
    terrainCredit = got.credit
      ? `Elevation: Terrain Tiles on AWS Open Data — ${got.credit}`
      : 'Elevation: Terrain Tiles on AWS Open Data'
  }

  /*
   * Names, and where they come from.
   *
   * A cluster cannot say what it is. The terrain can always say how steep and
   * how high it sits relative to the others, which is a description rather than
   * a name. OpenStreetMap can often say the name outright, and when it does it
   * says so with a percentage attached so the reader can weigh it.
   */
  const notes = terrainNotes(classes, labels, elev, grid.width, grid.height)
  let osmCredit = null
  if (!args.noOsm) {
    console.log('Naming   asking OpenStreetMap what is down there…')
    const wgs = gridToWgs84Bbox(grid)
    const elements = wgs ? await overpassLandcover(wgs) : null
    if (elements?.length) {
      const painted = paintLandcover(elements, grid, wgs84ToGridPixel(grid, dem))
      classes = nameClasses(classes, labels, painted.painted, painted.tags, notes)
      osmCredit = 'Land cover names: © OpenStreetMap contributors, ODbL'
      console.log(`         ${painted.polygons} landcover polygon(s) over this window`)
    } else {
      classes = nameClasses(classes, labels, null, [''], notes)
      console.log(elements ? '         nothing mapped here — naming from the terrain' :
                             '         OpenStreetMap did not answer — naming from the terrain')
    }
  } else {
    classes = nameClasses(classes, labels, null, [''], notes)
  }
  for (const c of classes) {
    console.log(`         ${c.color}  ${String(Math.round(c.share * 100)).padStart(3)}%  ${c.name}` +
                (c.note ? `  — ${c.note}` : ''))
  }

  const cover = {
    kind: 'erzberg.landcover/1',
    name: label,
    year: args.year,
    crs: grid.crs,
    bbox: grid.bbox,
    width: grid.width,
    height: grid.height,
    classes,
    variance: Number(variance.toFixed(4)),
    labels: packBytes(labels),
    plate: packBytes(rgb),
    attribution: EMBEDDING_CREDIT,
    ...(terrainCredit ? { terrainCredit } : null),
    // ODbL binds to the produced work, and a class carrying a name taken from
    // OpenStreetMap is derived from it — so the credit travels with the plate
    // exactly as the embedding's does.
    ...(osmCredit ? { osmCredit } : null),
  }
  const coverPath = path.join(args.out, `${stem}.cover.json`)
  await writeFile(coverPath, JSON.stringify(cover), 'utf8')

  console.log('')
  if (tifPath) console.log(`Wrote    ${tifPath}`)
  console.log(`${tifPath ? '         ' : 'Wrote    '}${coverPath}`)
  console.log('')
  console.log(tifPath
    ? `Load ${path.basename(tifPath)} as terrain, then drop ${path.basename(coverPath)} on the window.`
    : `Your raster is already loaded — drop ${path.basename(coverPath)} on the window.`)
}

main().catch((err) => {
  console.error(`\n${err.message}`)
  process.exit(1)
})
