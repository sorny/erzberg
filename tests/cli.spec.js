import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
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
