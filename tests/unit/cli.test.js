/**
 * The command line, up to the point where a browser is needed.
 *
 * Argument parsing and value typing are pure, and a mistake in either is a
 * script that silently renders the wrong plate: a `--set` read as a string
 * where the worker expects a number, or a `--frame` that overrides the paper
 * the author set by hand. The render itself is covered by tests/cli.spec.js.
 */
import { describe, expect, it } from 'vitest'
import { parseCli, resolvePreset, UsageError } from '../../scripts/erzberg.js'
import { coerceParams, coerceValue, modePatch, resolveModes } from '../../src/utils/paramCoerce'
import { DRAW_MODES } from '../../src/utils/drawModes'
import { STYLE_DEF } from '../../src/defaults'

describe('parseCli', () => {
  it('reads a render with several outputs, modes and values', () => {
    const r = parseCli(['render', 'a.tif', '-o', 'x.svg', '-o', 'x.png', '-m', 'Contours,hachure',
      '-m', 'Lines', '--only', '-s', 'tilt=35', '-s', 'bgColor=#fff=x', '--size', '800x600'])
    expect(r.command).toBe('render')
    expect(r.outputs).toEqual([{ file: 'x.svg', kind: 'svg' }, { file: 'x.png', kind: 'png' }])
    expect(r.modes).toEqual(['Contours', 'hachure', 'Lines'])
    expect(r.only).toBe(true)
    // Split at the first `=` only, so a value may carry one.
    expect(r.set).toEqual({ tilt: '35', bgColor: '#fff=x' })
    expect(r.size).toEqual({ width: 800, height: 600 })
  })

  it('makes every PNG transparent under --alpha', () => {
    expect(parseCli(['render', 'a.png', '-o', 'b.png', '--alpha']).outputs[0].kind).toBe('pngAlpha')
  })

  it('lets an explicit --set win over the --frame and --pen-order shortcuts', () => {
    const r = parseCli(['render', 'a.png', '-o', 'b.svg', '--frame', 'iso', '--pen-order',
      '-s', 'showFrame=false', '-s', 'plotPenOrder=false'])
    expect(r.set).toEqual({ showFrame: 'false', framePaper: 'iso', plotPenOrder: 'false' })
  })

  it('refuses what it cannot do, as a usage error', () => {
    const bad = [
      ['render'],
      ['render', 'notes.txt', '-o', 'a.svg'],
      ['render', 'a.png'],
      ['render', 'a.png', '-o', 'a.pdf'],
      ['render', 'a.png', '-o', 'a.svg', '-s', 'tilt'],
      ['render', 'a.png', '-o', 'a.svg', '--size', '10x10'],
      ['render', 'a.png', '-o', 'a.svg', '--bogus'],
      ['list', 'things'],
      ['draw', 'a.png'],
    ]
    for (const argv of bad) expect(() => parseCli(argv), argv.join(' ')).toThrow(UsageError)
  })

  it('accepts --stats as the only output', () => {
    expect(parseCli(['render', 'a.png', '--stats']).stats).toBe(true)
  })
})

describe('resolvePreset', () => {
  it('finds a bundled preset in any case, with or without .json', () => {
    expect(resolvePreset('blueprint')).toMatch(/Blueprint\.json$/)
    expect(resolvePreset('Alpine Survey.json')).toMatch(/Alpine Survey\.json$/)
  })
  it('says so when there is none', () => {
    expect(() => resolvePreset('No Such Look')).toThrow(UsageError)
  })
})

describe('coerceValue', () => {
  it('types a value by its default', () => {
    expect(coerceValue('tilt', '35')).toEqual({ value: 35 })
    expect(coerceValue('labelContours', 'on')).toEqual({ value: true })
    expect(coerceValue('labelContours', 'false')).toEqual({ value: false })
    expect(coerceValue('bgColor', '#fff')).toEqual({ value: '#fff' })
  })
  it('names the key and the value that did not fit', () => {
    expect(coerceValue('tilt', 'steep').error).toMatch(/tilt takes a number/)
    expect(coerceValue('tilt', '').error).toMatch(/tilt takes a number/)
    expect(coerceValue('labelContours', 'maybe').error).toMatch(/true or false/)
    expect(coerceValue('nope', '1').error).toMatch(/unknown parameter "nope"/)
  })
  it('collects every error at once', () => {
    expect(coerceParams({ nope: '1', tilt: 'x', zoom: '2' }).errors).toHaveLength(2)
  })
})

describe('modes', () => {
  it('resolves an id or a label in any case', () => {
    expect(resolveModes(['contours', 'Stream network', 'LINES']).ids).toEqual(['Contours', 'Dag', 'Lines'])
    expect(resolveModes(['Bogus']).errors).toEqual(['unknown draw mode "Bogus"'])
  })
  it('switches every other mode off under only', () => {
    const p = modePatch(['Contours'], true)
    expect(p.enabledContours).toBe(true)
    expect(Object.values(p).filter(Boolean)).toHaveLength(1)
    expect(Object.keys(p)).toHaveLength(DRAW_MODES.length)
  })
  it('has a switch in the defaults for every mode it can name', () => {
    for (const m of DRAW_MODES) expect(STYLE_DEF, m.id).toHaveProperty(`enabled${m.id}`)
  })
})
