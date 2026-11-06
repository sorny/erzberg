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
  const layers = [...svg.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1])
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
  expect(west).toContain('data-name="Contours')
  expect(west).not.toBe(east)
  expect(readFileSync(join(dir, 'sheets', 'atlas.html'), 'utf8')).toContain('src="East.png"')
})

test('day writes one plate per hour, and tiles a folder of web tiles', async () => {
  test.skip(!existsSync('tests/testdata/geotiff.tif'), 'tests/testdata/geotiff.tif not present (gitignored)')
  test.setTimeout(300_000)
  const dir = mkdtempSync(join(tmpdir(), 'erzberg-day-'))
  // First Light hatches the shade: Shadow Hatch, which the run turns with the sun.
  const day = cli('day', 'tests/testdata/geotiff.tif', '-p', 'First Light', '--size', '480x340',
    '--date', '2026-12-21', '--hours', '9-15', '--step', '3', '-o', join(dir, 'f', '{hour}.png'))
  expect(day.status, day.stderr).toBe(0)
  expect(day.stdout.trim().split('\n').map((f) => f.slice(dir.length + 1)))
    .toEqual(['f/09-00.png', 'f/12-00.png', 'f/15-00.png', 'f/day.html'])
  // The sun moved, so the frames differ.
  expect(readFileSync(join(dir, 'f', '09-00.png')).equals(readFileSync(join(dir, 'f', '15-00.png')))).toBe(false)

  const tiles = cli('tiles', 'tests/testdata/geotiff.tif', '-m', 'Contours', '--only', '--zoom', '11-12', '-o', join(dir, 't'))
  expect(tiles.status, tiles.stderr).toBe(0)
  expect(existsSync(join(dir, 't', 'index.html'))).toBe(true)
  // Zoom 11 at 13.9–14.1°E, 47.48–47.54°N: column 1103, rows 715 and 716.
  expect(existsSync(join(dir, 't', '11', '1103', '715.png')) || existsSync(join(dir, 't', '11', '1103', '716.png'))).toBe(true)
})

test('render writes glTF, 3MF and GeoJSON', async () => {
  test.skip(!existsSync('tests/testdata/geotiff.tif'), 'tests/testdata/geotiff.tif not present (gitignored)')
  test.setTimeout(300_000)
  const dir = mkdtempSync(join(tmpdir(), 'erzberg-models-'))
  const r = cli('render', 'tests/testdata/geotiff.tif', '-m', 'Contours', '--only', '--size', '480x340',
    '-o', join(dir, 'p.glb'), '-o', join(dir, 'p.3mf'), '-o', join(dir, 'p.geojson'))
  expect(r.status, r.stderr).toBe(0)
  expect(readFileSync(join(dir, 'p.glb')).subarray(0, 4).toString('ascii')).toBe('glTF')
  expect(readFileSync(join(dir, 'p.3mf')).subarray(0, 2).toString('ascii')).toBe('PK')
  expect(JSON.parse(readFileSync(join(dir, 'p.geojson'), 'utf8')).features.length).toBeGreaterThan(10)
})
