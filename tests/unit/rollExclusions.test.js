/**
 * Surprise me never switches on a mode that needs something a seed cannot
 * hold: a loaded file (`needsData`), or a picked point, a date or a
 * georeference (`roll: false`). See drawModes.js.
 */
import { describe, expect, it } from 'vitest'
import { DRAW_MODES } from '../../src/utils/drawModes'
import { randomPreset } from '../../src/utils/presetGenetics'

const EXCLUDED = DRAW_MODES.filter((m) => m.needsData || m.roll === false).map((m) => m.id)

describe('rolled modes', () => {
  it('excludes the eight input modes and the cover plate', () => {
    expect(EXCLUDED.sort()).toEqual(
      ['Cover', 'Geodesic', 'Isochrone', 'MapGrid', 'Panorama', 'Route', 'SunHours', 'Viewshed', 'Waveform'])
  })

  it('never rolls an excluded mode', () => {
    const hits = []
    for (let seed = 1; seed <= 3000; seed++) {
      const { style } = randomPreset(seed)
      for (const id of EXCLUDED) if (style[`enabled${id}`]) hits.push(`${seed}:${id}`)
    }
    expect(hits).toEqual([])
  })
})
