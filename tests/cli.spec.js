import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The CLI end to end: a child process, a real headless app, a real file.
 *
 * Driven as a user drives it rather than through its functions, because what
 * this asserts is the contract a script depends on — the layers that land in
 * the file, the look written into it, and the exit code. The pure half is in
 * tests/unit/cli.test.js.
 *
 * In the heavy project: it renders through WebGL and waits on a download.
 */
const cli = (...args) => spawnSync('node', ['scripts/erzberg.js', ...args, '-q'],
  { encoding: 'utf8', timeout: 180_000 })

test('renders only the asked-for modes, with the look embedded', async () => {
  test.setTimeout(240_000)
  const dir = mkdtempSync(join(tmpdir(), 'erzberg-cli-'))
  const out = join(dir, 'plate.svg')
  const r = cli('render', 'public/Heightmap.png', '-o', out, '-p', 'Blueprint',
    '-m', 'Contours', '--only', '-s', 'intervalContours=6')
  expect(r.stderr).toBe('')
  expect(r.status).toBe(0)
  expect(r.stdout.trim()).toBe(out)

  const svg = readFileSync(out, 'utf8')
  const layers = [...svg.matchAll(/inkscape:label="([^"]+)"/g)].map((m) => m[1])
  expect(layers.length).toBeGreaterThan(0)
  expect(layers.every((l) => l.startsWith('Contours'))).toBe(true)
  // The preset comment carries the values the run set, over Blueprint's.
  const look = JSON.parse(/<!-- erzberg:preset (.*?) -->/.exec(svg)[1])
  expect(look.style.intervalContours).toBe(6)
  expect(look.style.enabledLines).toBe(false)
  expect(look.style.bgColor).toBe('#0d2b4e')
})

test('a bad value is a usage error, named, and no file', async () => {
  test.setTimeout(240_000)
  const dir = mkdtempSync(join(tmpdir(), 'erzberg-cli-'))
  const r = cli('render', 'public/Heightmap.png', '-o', join(dir, 'x.svg'), '-s', 'tilt=steep')
  expect(r.status).toBe(2)
  expect(r.stderr).toMatch(/tilt takes a number/)
  expect(r.stdout).toBe('')
})

// The atlas, cut from the gitignored fixture so the test needs no network:
// tests/testdata/geotiff.tif, UTM 33N, 10 m, around 14.0° E 47.5° N.
test('atlas cuts one sheet per feature from a GeoTIFF, and skips one outside it', async () => {
  test.skip(!existsSync('tests/testdata/geotiff.tif'), 'tests/testdata/geotiff.tif not present (gitignored)')
  test.setTimeout(300_000)
  const dir = mkdtempSync(join(tmpdir(), 'erzberg-atlas-'))
  const features = join(dir, 'peaks.geojson')
  const pt = (name, lon, lat) => ({ type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: [lon, lat] } })
  writeFileSync(features, JSON.stringify({ type: 'FeatureCollection',
    features: [pt('West', 13.99, 47.5), pt('East', 14.05, 47.5), pt('Vienna', 16.37, 48.21)] }))
  const r = cli('atlas', features, '--dem', 'tests/testdata/geotiff.tif', '--box', '3',
    '-m', 'Contours', '--only', '-o', join(dir, 'sheets', '{name}.svg'), '-o', join(dir, 'sheets', '{name}.png'))

  // Vienna is outside the file: named, skipped, and the run says so by its code.
  expect(r.status).toBe(1)
  expect(r.stderr).toMatch(/Vienna: .*outside this GeoTIFF/)
  const written = r.stdout.trim().split('\n')
  expect(written.map((f) => f.slice(dir.length + 1))).toEqual([
    'sheets/West.svg', 'sheets/West.png', 'sheets/East.svg', 'sheets/East.png', 'sheets/atlas.html'])

  // Two different pieces of ground, each 3 km wide at 10 m.
  const west = readFileSync(join(dir, 'sheets', 'West.svg'), 'utf8')
  const east = readFileSync(join(dir, 'sheets', 'East.svg'), 'utf8')
  expect(west).toContain('inkscape:label="Contours')
  expect(west).not.toBe(east)
  expect(readFileSync(join(dir, 'sheets', 'atlas.html'), 'utf8')).toContain('src="East.png"')
})
