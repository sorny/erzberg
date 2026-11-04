import { describe, expect, it } from 'vitest'
import { crsAffine, formatDegrees, sheetMarks } from '../../src/utils/sheetMarks'
import { magneticNorth, titleLines } from '../../src/utils/sheetFacts'

// A plan view: one world unit is one screen pixel, the plate centred at (500, 400).
const project = (x, _y, z) => [500 + x, 400 + z]
const place = { bbox: [419000, 5259000, 431000, 5266000], width: 1200, height: 700, halfW: 600, halfH: 350 }

describe('the map grid', () => {
  it('maps the raster corners to the screen', () => {
    const a = crsAffine(project, place)
    const at = (X, Y) => [a[0] * X + a[1] * Y + a[2], a[3] * X + a[4] * Y + a[5]]
    expect(at(419000, 5266000).map(Math.round)).toEqual([-100, 50])
    expect(at(431000, 5259000).map(Math.round)).toEqual([1100, 750])
  })

  it('letters round figures where the lines meet the sheet', () => {
    const affine = crsAffine(project, place)
    const m = sheetMarks({ width: 1000, height: 800, metresPerPixel: 10, bar: false, north: false,
      grid: { affine, mode: 'ticks' } })
    const figures = m.texts.map((t) => t.text)
    expect(figures).toContain('420 000')
    expect(figures.every((t) => /^\d{3} \d{3}$|^\d \d{3} \d{3}$/.test(t))).toBe(true)
    expect(m.lines.length).toBe(m.texts.length)
  })

  it('letters degrees as a sheet edge does', () => {
    expect(formatDegrees(14.0833, 'E', 'W')).toBe('14°05′E')
    expect(formatDegrees(-3, 'E', 'W')).toBe('3°W')
  })
})

describe('the title block', () => {
  it('lists the facts the plate has, and leaves out the rest', () => {
    const lines = titleLines(
      { frameTitleText: '', frameTitleFacts: 'projection,interval,range,source,date',
        geoTiffElevMin: 640, geoTiffElevMax: 2351, enabledContours: false },
      { filename: 'grimming.tif', crs: 'EPSG:32633', crsName: null, provenance: 'BEV ALS DTM' },
      new Date(Date.UTC(2026, 10, 4)))
    expect(lines[0]).toBe('grimming')
    expect(lines).toContain('Heights 640 m to 2 351 m')
    expect(lines).toContain('BEV ALS DTM')
    expect(lines).toContain('2026-11-04')
    expect(lines.some((l) => l.startsWith('Contour interval'))).toBe(false)
  })

  it('draws without a georeference', () => {
    const m = sheetMarks({ width: 800, height: 600, title: ['Untitled', 'Source'] })
    expect(m.texts.map((t) => t.text)).toEqual(['Untitled', 'Source'])
  })
})

describe('magnetic north', () => {
  it('turns east of grid north in Styria, and turns the one arrow to it', () => {
    const mn = magneticNorth([419000, 5259000, 431000, 5266000], 'EPSG:32633', new Date(Date.UTC(2026, 10, 4)))
    expect(mn.valid).toBe(true)
    expect(mn.declination).toBeGreaterThan(4)
    expect(mn.label).toMatch(/° E$/)
    const plain = sheetMarks({ width: 800, height: 600, metresPerPixel: 5, bar: false })
    const both = sheetMarks({ width: 800, height: 600, metresPerPixel: 5, bar: false, magnetic: mn })
    // Still one arrow: a shaft and two barbs, now labelled MN, with the angle under it.
    expect(both.lines.length).toBe(plain.lines.length)
    expect(both.texts.map((t) => t.text)).toEqual(['MN', mn.label])
    expect(both.lines[0]).not.toEqual(plain.lines[0])
  })
})
