#!/usr/bin/env node
/**
 * erzberg from the command line.
 *
 * Renders a plate without a hand on the panel: a heightmap in, a look described
 * by a preset, draw modes and parameters, and SVG, PNG or STL out.
 *
 * It does not re-implement the renderer. It opens the built app in headless
 * Chrome with `?automation` and drives it through `window.erzberg` (see
 * src/automation.js), so every mode, label, text layer and exporter is the one
 * the UI uses, and a file from here matches a file from there.
 *
 * Usage:
 *   node scripts/erzberg.js render <heightmap> -o out.svg [-o out.png] [options]
 *   node scripts/erzberg.js atlas <features.geojson> -o 'sheets/{name}.svg' [options]
 *   node scripts/erzberg.js list modes|presets|params
 *
 * See docs/CLI.md.
 */

import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const PRESETS = join(ROOT, 'public', 'presets')

export const EXIT = { ok: 0, error: 1, usage: 2, empty: 3 }

const RASTER_EXT = new Set(['.tif', '.tiff', '.png', '.jpg', '.jpeg', '.webp'])
const OUTPUT_KIND = { '.svg': 'svg', '.png': 'png', '.stl': 'stl' }

const HELP = `erzberg — render a plate from the command line

  erzberg render <heightmap> -o <file> [-o <file>…] [options]
  erzberg atlas <features.geojson> -o <dir/{name}.svg> [-o …] [options]
  erzberg list modes|presets|params

Render options:
  -o, --out <file>        .svg, .png or .stl; repeat for several files of one plate
  -p, --preset <name>     a bundled preset ("Blueprint"), or a .json/.svg/.png that carries one
  -m, --mode <ids>        switch draw modes on, by id or label; comma list, repeatable
      --only              switch every other draw mode off first
  -s, --set <key=value>   any parameter (intervalContours=6, tilt=35, bgColor=#fff); repeatable
      --size <W>x<H>      canvas pixels (default 1600x1131)
      --frame <paper>     show the paper frame (iso, letter, …); SVG cuts to it
      --pen-order         reorder strokes for less pen travel
      --alpha             PNG with a transparent background
      --stats             print the plot preflight figures as JSON
      --timeout <s>       give up after this many seconds (default 300)
      --no-build          use dist/ as it is, even if src/ is newer
      --headed            show the browser
  -q, --quiet             no progress on stderr

Atlas options (and every render option, applied to each sheet):
      --dem <file>        cut each sheet from this GeoTIFF instead of fetching Terrain Tiles
      --box <km>          the square around a point feature (default 10)
  Each -o must hold {name}, which becomes the feature's name.

Order: defaults, then --preset, then the heightmap's fit (zoom, grid stride),
then --only, --mode, --frame, --pen-order, and last --set.

Exit codes: 0 done, 1 error, 2 bad arguments, 3 nothing to draw.`

export class UsageError extends Error {}

/** argv → a plain description of the run. Throws UsageError. Pure, for the unit test. */
export function parseCli(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        out: { type: 'string', short: 'o', multiple: true },
        preset: { type: 'string', short: 'p' },
        mode: { type: 'string', short: 'm', multiple: true },
        only: { type: 'boolean' },
        set: { type: 'string', short: 's', multiple: true },
        size: { type: 'string' },
        frame: { type: 'string' },
        'pen-order': { type: 'boolean' },
        alpha: { type: 'boolean' },
        stats: { type: 'boolean' },
        timeout: { type: 'string' },
        'no-build': { type: 'boolean' },
        headed: { type: 'boolean' },
        quiet: { type: 'boolean', short: 'q' },
        dem: { type: 'string' },
        box: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    throw new UsageError(e.message)
  }
  const { values: v, positionals: [command, ...rest] } = parsed
  if (v.help || !command) return { command: 'help' }

  if (command === 'list') {
    const what = rest[0]
    if (!['modes', 'presets', 'params'].includes(what)) throw new UsageError('list takes modes, presets or params')
    return { command, what, headed: !!v.headed, build: !v['no-build'] }
  }
  if (command !== 'render' && command !== 'atlas') throw new UsageError(`unknown command "${command}"`)
  const atlas = command === 'atlas'

  const [input, ...extra] = rest
  if (!input) throw new UsageError(atlas ? 'atlas needs a GeoJSON file of features' : 'render needs a heightmap file')
  if (extra.length) throw new UsageError(`unexpected argument "${extra[0]}"`)
  if (atlas) {
    if (!/\.(geo)?json$/i.test(input)) throw new UsageError(`${input}: the features are a .geojson or .json file`)
  } else if (!RASTER_EXT.has(extname(input).toLowerCase())) {
    throw new UsageError(`${input}: a heightmap is .tif, .tiff, .png, .jpg or .webp`)
  }
  if (!atlas && (v.dem || v.box)) throw new UsageError('--dem and --box belong to atlas')

  const outputs = (v.out ?? []).map((file) => {
    const kind = OUTPUT_KIND[extname(file).toLowerCase()]
    if (!kind) throw new UsageError(`${file}: an output is .svg, .png or .stl`)
    return { file, kind: kind === 'png' && v.alpha ? 'pngAlpha' : kind }
  })
  if (!outputs.length && !v.stats) throw new UsageError('nothing to write: give -o <file> or --stats')
  if (atlas) {
    const fixed = outputs.find((o) => !o.file.includes('{name}'))
    if (fixed) throw new UsageError(`${fixed.file}: an atlas output holds {name}, or every sheet writes the same file`)
  }

  const set = {}
  for (const pair of v.set ?? []) {
    const eq = pair.indexOf('=')
    if (eq < 1) throw new UsageError(`--set takes key=value, not "${pair}"`)
    set[pair.slice(0, eq).trim()] = pair.slice(eq + 1)
  }
  // Shortcuts for two common keys. An explicit --set of the same key wins.
  if (v.frame) Object.assign(set, { showFrame: 'true', framePaper: v.frame, ...set })
  if (v['pen-order']) set.plotPenOrder ??= 'true'

  let size = { width: 1600, height: 1131 }
  if (v.size) {
    const m = /^(\d+)x(\d+)$/i.exec(v.size)
    if (!m) throw new UsageError(`--size takes WxH, not "${v.size}"`)
    size = { width: +m[1], height: +m[2] }
    if (size.width < 64 || size.height < 64 || size.width > 8192 || size.height > 8192) {
      throw new UsageError('--size takes 64 to 8192 pixels a side')
    }
  }

  const timeout = v.timeout === undefined ? 300 : Number(v.timeout)
  if (!(timeout > 0)) throw new UsageError(`--timeout takes seconds, not "${v.timeout}"`)

  let atlasRun = {}
  if (atlas) {
    if (v.dem && !/\.tiff?$/i.test(v.dem)) throw new UsageError(`${v.dem}: --dem takes a GeoTIFF`)
    const box = v.box === undefined ? 10 : Number(v.box)
    if (!(box > 0 && box <= 500)) throw new UsageError(`--box takes 0 to 500 km, not "${v.box}"`)
    atlasRun = { dem: v.dem ?? null, boxKm: box }
  }

  return {
    ...atlasRun,
    command, input, outputs, preset: v.preset ?? null,
    modes: (v.mode ?? []).flatMap((m) => m.split(',')).map((m) => m.trim()).filter(Boolean),
    only: !!v.only, set, size, stats: !!v.stats, timeoutMs: timeout * 1000,
    build: !v['no-build'], headed: !!v.headed, quiet: !!v.quiet,
  }
}

/** A bundled preset by name (any case, `.json` optional), or a file on disk. */
export function resolvePreset(name, presetsDir = PRESETS) {
  if (existsSync(name) && statSync(name).isFile()) return resolve(name)
  const want = name.replace(/\.json$/i, '').toLowerCase()
  const hit = readdirSync(presetsDir)
    .find((f) => f.endsWith('.json') && f !== 'manifest.json' && f.slice(0, -5).toLowerCase() === want)
  if (!hit) throw new UsageError(`no preset "${name}" — see: erzberg list presets`)
  return join(presetsDir, hit)
}

function bundledPresets() {
  return JSON.parse(readFileSync(join(PRESETS, 'manifest.json'), 'utf8')).map((f) => f.replace(/\.json$/, ''))
}

// ── Atlas sheets ──────────────────────────────────────────────────────────────

const KM_PER_DEG_LAT = 110.574
const KM_PER_DEG_LON = 111.320

function positions(geom, out = []) {
  if (!geom) return out
  if (geom.type === 'GeometryCollection') { for (const g of geom.geometries ?? []) positions(g, out); return out }
  const walk = (c) => { if (typeof c[0] === 'number') out.push(c); else for (const x of c) walk(x) }
  if (Array.isArray(geom.coordinates)) walk(geom.coordinates)
  return out
}

// File names lose path separators, reserved characters and control codes.
// eslint-disable-next-line no-control-regex
const safeName = (s) => String(s ?? '').replace(/[/\\:*?"<>|\u0000-\u001f]+/g, '-').trim()

/**
 * A GeoJSON FeatureCollection → one sheet per feature: `{ name, area }`, where
 * `area` is [minLon, minLat, maxLon, maxLat]. A point gets a square of `boxKm`
 * around it, and any other geometry its own extent. Throws UsageError.
 */
export function atlasSheets(geojson, boxKm = 10) {
  const features = geojson?.type === 'FeatureCollection' ? geojson.features
    : geojson?.type === 'Feature' ? [geojson] : null
  if (!Array.isArray(features)) throw new UsageError('the atlas file is not a GeoJSON FeatureCollection')
  const sheets = [], used = new Map()
  features.forEach((f, i) => {
    const pts = positions(f?.geometry)
    if (!pts.length) return
    for (const [lon, lat] of pts) {
      if (!(Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) {
        throw new UsageError('the atlas features must be in longitude and latitude (WGS84), as GeoJSON is')
      }
    }
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
    for (const [lon, lat] of pts) {
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon)
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
    }
    // A point, or features that are all one point, get the box around it.
    if (maxLon - minLon < 1e-9 && maxLat - minLat < 1e-9) {
      const dLat = boxKm / 2 / KM_PER_DEG_LAT
      const dLon = boxKm / 2 / (KM_PER_DEG_LON * Math.cos((minLat * Math.PI) / 180))
      ;[minLon, minLat, maxLon, maxLat] = [minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat]
    }
    const p = f.properties ?? {}
    let name = safeName(p.name ?? p.title ?? p.id ?? f.id) || `sheet-${String(i + 1).padStart(2, '0')}`
    const n = (used.get(name) ?? 0) + 1
    used.set(name, n)
    if (n > 1) name = `${name}-${n}`
    sheets.push({ name, area: [minLon, minLat, maxLon, maxLat] })
  })
  if (!sheets.length) throw new UsageError('the atlas file holds no feature with a geometry')
  return sheets
}

/** An output template with `{name}` filled in. */
export const sheetFile = (template, name) => template.replaceAll('{name}', name)

/** The index page: every sheet's PNG, with its name and height range. */
export function atlasIndex(title, sheets, dir) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  const cells = sheets.map((s, i) => `<figure><img src="${esc(relative(dir, s.png).split('\\').join('/'))}" alt="${esc(s.name)}" loading="lazy">
<figcaption><b>${String(i + 1).padStart(2, '0')}</b> ${esc(s.name)}<span>${s.elevMin != null ? `${Math.round(s.elevMin)}–${Math.round(s.elevMax)} m` : ''}</span></figcaption></figure>`).join('\n')
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>body{margin:0;padding:24px;font:14px/1.5 system-ui,sans-serif;background:#f4f4f1;color:#1b1b1b}
h1{font-size:22px;margin:0 0 16px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
figure{margin:0;background:#fff;border:1px solid #ddd}img{display:block;width:100%;height:auto}
figcaption{padding:8px 10px;display:flex;gap:8px;border-top:1px solid #ddd}figcaption span{margin-left:auto;color:#666}</style>
<h1>${esc(title)}</h1>
<main>
${cells}
</main>
`
}

// ── The built app ───────────────────────────────────────────────────────────

function newestMtime(path) {
  const st = statSync(path)
  if (!st.isDirectory()) return st.mtimeMs
  let t = st.mtimeMs
  for (const e of readdirSync(path)) t = Math.max(t, newestMtime(join(path, e)))
  return t
}

function ensureBuild(log) {
  const index = join(DIST, 'index.html')
  const sources = ['src', 'public', 'index.html', 'vite.config.js'].map((p) => join(ROOT, p)).filter(existsSync)
  const stale = !existsSync(index) || Math.max(...sources.map(newestMtime)) > statSync(index).mtimeMs
  if (!stale) return
  log('building the app (dist/ is missing or older than src/)…')
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'vite'), ['build', '--logLevel', 'error'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
  if (r.status !== 0) throw new Error('vite build failed')
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.txt': 'text/plain',
}

/**
 * dist/ on a free local port, plus the run's own inputs under `/__cli/<n>`.
 * Only those registered files are reachable outside dist/.
 */
function serve() {
  const inputs = []
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file
    const cli = /^\/__cli\/(\d+)$/.exec(path)
    if (cli) file = inputs[+cli[1]]
    else {
      file = join(DIST, path === '/' ? 'index.html' : path)
      if (!file.startsWith(DIST)) file = null
    }
    if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    url: `http://127.0.0.1:${server.address().port}`,
    add: (file) => `/__cli/${inputs.push(resolve(file)) - 1}`,
    close: () => server.close(),
  })))
}

async function openApp(run, log) {
  if (run.build) ensureBuild(log)
  const { chromium } = await import('playwright')
  const server = await serve()
  // The flags the heavy test project uses: WebGL through ANGLE, and no
  // throttling of a page nobody is looking at.
  const launch = {
    headless: !run.headed,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'],
  }
  const browser = await chromium.launch({ ...launch, channel: 'chrome' })
    .catch(() => chromium.launch(launch))
  const page = await browser.newPage({
    viewport: run.size ?? { width: 1600, height: 1131 }, deviceScaleFactor: 1, acceptDownloads: true,
  })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.setDefaultTimeout(run.timeoutMs ?? 300_000)
  await page.goto(`${server.url}/?automation`)
  await page.waitForFunction(() => window.erzberg?.version === 1)
  const close = async () => { await browser.close().catch(() => {}); server.close() }
  return { page, server, close, pageErrors }
}

// The page throws plain Errors; evaluate wraps them. Keep the app's own words.
const pageMessage = (e) => String(e?.message ?? e)
  .replace(/^page\.evaluate: (Error: )?/, '').split('\n')[0]

// ── Commands ────────────────────────────────────────────────────────────────

async function render(run, log) {
  if (!existsSync(run.input)) throw new UsageError(`${run.input}: no such file`)
  const presetPath = run.preset ? resolvePreset(run.preset) : null

  const app = await openApp(run, log)
  const { page, server } = app
  const call = (fn, ...args) => page.evaluate(fn, args)
  try {
    log('opening the app…')
    await call(() => window.erzberg.settle())

    if (presetPath) {
      log(`preset ${basename(presetPath)}`)
      await call(([n, u]) => window.erzberg.applyPreset(n, u), basename(presetPath), server.add(presetPath))
    }
    log(`loading ${basename(run.input)}…`)
    const dims = await call(([n, u]) => window.erzberg.loadRaster(n, u), basename(run.input), server.add(run.input))
    log(`  ${dims.width} × ${dims.height}`)

    if (run.modes.length || run.only) {
      const ids = await call(([m, o]) => window.erzberg.setModes(m, o), run.modes, run.only)
      log(`modes ${run.only ? 'only ' : ''}${ids.join(', ') || '(none)'}`)
    }
    if (Object.keys(run.set).length) await call(([s]) => window.erzberg.setParams(s), run.set)

    log('building…')
    const built = await call(() => window.erzberg.settle())
    if (built.buildMs != null) log(`  built in ${Math.round(built.buildMs)} ms`)

    if (run.stats) {
      const stats = await call(() => window.erzberg.preflight())
      process.stdout.write(JSON.stringify(stats, null, 2) + '\n')
    }

    for (const { file, kind } of run.outputs) {
      log(`writing ${file}…`)
      const download = page.waitForEvent('download')
      download.catch(() => {})
      const status = await call(([k]) => window.erzberg.export(k), kind)
      if (status === 'empty') {
        console.error(`erzberg: nothing to draw — the plate has no geometry for ${file}`)
        return EXIT.empty
      }
      if (status !== 'done') throw new Error(`export of ${file} ended "${status}"`)
      await (await download).saveAs(resolve(file))
      process.stdout.write(resolve(file) + '\n')
    }
    return EXIT.ok
  } catch (e) {
    if (app.pageErrors.length) log(`page errors:\n  ${app.pageErrors.join('\n  ')}`)
    throw new Error(pageMessage(e), { cause: e })
  } finally {
    await app.close()
  }
}

/**
 * One plate per feature, in one browser. Each sheet loads its own ground, then
 * takes the same modes and values, so a terrain setting from --set holds on
 * every sheet. A sheet that fails is reported and skipped.
 */
async function atlasRun(run, log) {
  if (!existsSync(run.input)) throw new UsageError(`${run.input}: no such file`)
  if (run.dem && !existsSync(run.dem)) throw new UsageError(`${run.dem}: no such file`)
  let geojson
  try { geojson = JSON.parse(readFileSync(run.input, 'utf8')) } catch (e) { throw new UsageError(`${run.input}: ${e.message}`) }
  const sheets = atlasSheets(geojson, run.boxKm)
  const presetPath = run.preset ? resolvePreset(run.preset) : null

  const app = await openApp(run, log)
  const { page, server } = app
  const call = (fn, ...args) => page.evaluate(fn, args)
  const demUrl = run.dem ? server.add(run.dem) : null
  const done = []
  let failed = 0, empty = 0
  try {
    await call(() => window.erzberg.settle())
    if (presetPath) {
      log(`preset ${basename(presetPath)}`)
      await call(([n, u]) => window.erzberg.applyPreset(n, u), basename(presetPath), server.add(presetPath))
    }
    for (const [i, sheet] of sheets.entries()) {
      log(`[${i + 1}/${sheets.length}] ${sheet.name}`)
      try {
        const got = demUrl
          ? await call(([n, u, a]) => window.erzberg.loadRasterArea(n, u, a), basename(run.dem), demUrl, sheet.area)
          : await call(([n, a]) => window.erzberg.fetchArea(n, a), sheet.name, sheet.area)
        log(`  ${got.width} × ${got.height}, ${Math.round(got.elevMin)}–${Math.round(got.elevMax)} m`)
        if (run.modes.length || run.only) await call(([m, o]) => window.erzberg.setModes(m, o), run.modes, run.only)
        if (Object.keys(run.set).length) await call(([s]) => window.erzberg.setParams(s), run.set)
        await call(() => window.erzberg.settle())
        if (run.stats) {
          const stats = await call(() => window.erzberg.preflight())
          process.stdout.write(JSON.stringify({ sheet: sheet.name, ...stats }) + '\n')
        }
        const entry = { name: sheet.name, elevMin: got.elevMin, elevMax: got.elevMax, png: null }
        for (const { file: tpl, kind } of run.outputs) {
          const file = resolve(sheetFile(tpl, sheet.name))
          mkdirSync(dirname(file), { recursive: true })
          const download = page.waitForEvent('download')
          download.catch(() => {})
          const status = await call(([k]) => window.erzberg.export(k), kind)
          if (status === 'empty') { console.error(`erzberg: ${sheet.name}: nothing to draw`); empty++; break }
          if (status !== 'done') throw new Error(`export of ${file} ended "${status}"`)
          await (await download).saveAs(file)
          process.stdout.write(file + '\n')
          if (kind === 'png' || kind === 'pngAlpha') entry.png ??= file
        }
        done.push(entry)
      } catch (e) {
        failed++
        console.error(`erzberg: ${sheet.name}: ${pageMessage(e)}`)
      }
    }
  } finally {
    await app.close()
  }

  const withPng = done.filter((d) => d.png)
  if (withPng.length) {
    const dir = dirname(withPng[0].png)
    const index = join(dir, 'atlas.html')
    writeFileSync(index, atlasIndex(basename(run.input).replace(/\.(geo)?json$/i, ''), withPng, dir))
    process.stdout.write(index + '\n')
  }
  if (failed) return EXIT.error
  return empty === sheets.length ? EXIT.empty : EXIT.ok
}

async function list(run, log) {
  if (run.what === 'presets') {
    process.stdout.write(bundledPresets().join('\n') + '\n')
    return EXIT.ok
  }
  const app = await openApp(run, log)
  try {
    const cat = await app.page.evaluate(() => window.erzberg.catalog())
    if (run.what === 'modes') {
      const w = Math.max(...cat.modes.map((m) => m.id.length))
      process.stdout.write(cat.modes.map((m) => `${m.id.padEnd(w)}  ${m.label}`).join('\n') + '\n')
    } else {
      const lines = []
      for (const [group, def] of Object.entries(cat.params)) {
        for (const [k, val] of Object.entries(def)) lines.push(`${k}\t${group}\t${JSON.stringify(val)}`)
      }
      process.stdout.write(lines.join('\n') + '\n')
    }
    return EXIT.ok
  } finally {
    await app.close()
  }
}

export async function main(argv = process.argv.slice(2)) {
  let run
  try {
    run = parseCli(argv)
  } catch (e) {
    console.error(`erzberg: ${e.message}\n\nerzberg --help for usage`)
    return EXIT.usage
  }
  if (run.command === 'help') { console.log(HELP); return EXIT.ok }
  const log = run.quiet ? () => {} : (m) => console.error(m)
  try {
    if (run.command === 'list') return await list(run, log)
    return run.command === 'atlas' ? await atlasRun(run, log) : await render(run, log)
  } catch (e) {
    console.error(`erzberg: ${e.message}`)
    return e instanceof UsageError || /unknown (parameter|draw mode)|takes /.test(e.message) ? EXIT.usage : EXIT.error
  }
}

// Run only when executed, not when the unit test imports the parser. Through
// realpath, because `npm link` and `bin` reach this file by a symlink.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main()
}
