/**
 * Naming a step from the diff.
 *
 * The whole claim of this module is that a snapshot history can name its own
 * entries without a single mutation site being annotated. These tests are that
 * claim, stated as cases: the same index that decides which section a reset
 * touches also decides what an undo step is called, so the two can never drift
 * apart in the way a hand-written label table would.
 */
import { describe, expect, it } from 'vitest'
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from '../../src/defaults'
import { GROUP_OF } from '../../src/params'
import { describeChange } from '../../src/utils/historyLabel'

const KEYS = [...GROUP_OF.keys()]

/** A snapshot in the shape App tracks: four parameter groups, then five others. */
const snap = (over = {}) => [
  { ...TERRAIN_DEF, ...over.terrain },
  { ...STYLE_DEF, ...over.style },
  { ...POINTS_DEF, ...over.points },
  { ...VIEW_DEF, ...over.view },
  over.gradientStops ?? 'g', over.bgGradientStops ?? 'bg',
  over.textLayers ?? 't', over.vectorLayers ?? 'vl', over.vectorSources ?? 'vs',
]

const label = (over) => describeChange(snap(), snap(over), KEYS)

describe('describeChange', () => {
  it('names the section a single change belongs to', () => {
    expect(label({ style: { hillshadeAzimuth: 120 } })).toBe('Hillshade')
    expect(label({ terrain: { blurRadius: 9 } })).toBe('Terrain')
    expect(label({ view: { fov: 30 } })).toBe('Camera')
  })

  it('counts several changes inside one section', () => {
    expect(label({ style: { hillshadeAzimuth: 120, hillshadeAltitude: 10 } }))
      .toBe('Hillshade · 2 changes')
  })

  it('names a mode switch as the action it was', () => {
    // The one key whose meaning needs no label, and the one most worth reading
    // back — a history of decisions rather than of adjustments.
    expect(label({ style: { enabledStipple: true } })).toBe('Stipple Dots on')
    expect(label({ style: { enabledContours: !STYLE_DEF.enabledContours } }))
      .toBe(STYLE_DEF.enabledContours ? 'Contours off' : 'Contours on')
  })

  it('drops the Mode: prefix, which every mode would otherwise carry', () => {
    const out = label({ style: { spacingStipple: 9, gammaStipple: 1.4 } })
    expect(out).not.toContain('Mode:')
    expect(out).toContain('Stipple Dots')
  })

  it('says how far a change reached when it is spread across the panel', () => {
    // A preset, a roll, a reset. The caller normally tags those by name; this
    // is the honest fallback, and it still says the change was not local.
    const out = label({
      style: { hillshadeAzimuth: 120 },
      terrain: { blurRadius: 9 },
      view: { fov: 30 },
    })
    expect(out).toBe('3 sections')
  })

  it('names the slots that are not parameter groups', () => {
    expect(label({ gradientStops: 'other' })).toBe('Gradient')
    expect(label({ bgGradientStops: 'other' })).toBe('Background gradient')
    expect(label({ textLayers: 'other' })).toBe('Text')
    // The layer records and the coordinates they point at are one thing to a
    // reader, and they always move together.
    expect(label({ vectorLayers: 'other' })).toBe('Vector layers')
    expect(label({ vectorLayers: 'other', vectorSources: 'other2' })).toBe('Vector layers')
  })

  it('returns null rather than inventing a name', () => {
    expect(describeChange(snap(), snap(), KEYS)).toBeNull()
    expect(describeChange(null, snap(), KEYS)).toBeNull()
    expect(describeChange(snap(), null, KEYS)).toBeNull()
  })

  it('names a change in every section the panel has', () => {
    /*
     * The guard that keeps this honest as the panel grows.
     *
     * A parameter whose section is missing from the index falls through to
     * `null` and appears in the list as an unnamed step. Rather than trust that
     * never happens, move one key in each of the four groups and check that all
     * of them come back named.
     */
    const unnamed = []
    for (const [group, def] of [['terrain', TERRAIN_DEF], ['style', STYLE_DEF],
      ['points', POINTS_DEF], ['view', VIEW_DEF]]) {
      for (const k of Object.keys(def)) {
        const v = def[k]
        const moved = typeof v === 'number' ? v + 1 : typeof v === 'boolean' ? !v : `${v}x`
        if (!label({ [group]: { [k]: moved } })) unnamed.push(k)
      }
    }
    expect(unnamed, `no name for: ${unnamed.join(' ')}`).toEqual([])
  })
})
