/**
 * Where a dropped file goes.
 *
 * The routing is a pure function of the name and it is worth pinning here,
 * because the two ambiguous extensions are ambiguous in *opposite* directions
 * and getting either backwards is a silent wrong action rather than an error: a
 * dropped plate that replaces the terrain instead of restoring the look, or a
 * GeoJSON quietly refused as a bad preset.
 */
import { describe, expect, it } from 'vitest'
import { classifyDrop, dragHasFiles, explainDrop } from '../../src/utils/dropRoute'

describe('classifyDrop', () => {
  it('sends a GeoTIFF straight to the terrain', () => {
    for (const n of ['a.tif', 'a.tiff', 'A.GeoTIFF']) expect(classifyDrop(n)).toEqual(['geotiff'])
  })

  it('tries a PNG as a preset first, then as terrain', () => {
    // This order, and not the other one. Every plate the app exports is a PNG
    // carrying its own settings, and reading one back is the common case —
    // whereas a heightmap PNG fails the preset read in microseconds and falls
    // through. The reverse order would load an exported plate *as terrain*,
    // which is a picture of a mountain used as a mountain.
    expect(classifyDrop('plate.png')).toEqual(['preset', 'raster'])
  })

  it('tries .json as a preset and .geojson as geometry', () => {
    // Same routes, opposite order, decided by what the extension says the
    // author meant. `Preset ⬇` writes `.json`; nobody names a preset `.geojson`.
    // A cover plate is tried first on `.json` because it is the only one of the
    // three that declares its own `kind`, so it answers for itself outright.
    expect(classifyDrop('look.json')).toEqual(['cover', 'preset', 'geojson'])
    expect(classifyDrop('trails.geojson')).toEqual(['geojson', 'preset'])
  })

  it('routes a cover plate by its bytes, whatever it is called', () => {
    // The script writes `.landcover.json` and used to write `.cover.json`.
    // Neither name is load-bearing: a plate declares its own `kind`, so every
    // `.json` is offered to the cover reader first and a file cut by an older
    // version keeps working with no migration at all.
    for (const n of ['erz.landcover.json', 'erz.cover.json', 'anything.json']) {
      expect(classifyDrop(n)).toEqual(['cover', 'preset', 'geojson'])
    }
  })

  it('names the plate in its hint under either spelling', () => {
    // The one place the name *is* read: telling someone their file is called
    // like a plate but does not parse as one.
    for (const n of ['erz.landcover.json', 'erz.cover.json']) {
      expect(explainDrop(n, ['cover', 'preset', 'geojson']))
        .toMatch(/named like a cover plate/)
    }
  })

  it('takes an SVG only as a preset', () => {
    // An icon needs a layer to belong to, and a drop on the viewport names no
    // layer. `explainDrop` says so rather than the drop doing nothing.
    expect(classifyDrop('plate.svg')).toEqual(['preset'])
  })

  it('names audio rather than refusing it', () => {
    expect(classifyDrop('track.mp3')).toEqual(['audio'])
    expect(classifyDrop('track.M4A')).toEqual(['audio'])
  })

  it('takes nothing it has no loader for', () => {
    for (const n of ['notes.txt', 'photo.jpg', 'archive.zip', '', null]) {
      expect(classifyDrop(n)).toEqual([])
    }
  })
})

describe('explainDrop', () => {
  it('points audio at the section that wants it', () => {
    expect(explainDrop('track.mp3', ['audio'])).toContain('Soundscapes')
  })

  it('points a plain SVG at the icon picker', () => {
    expect(explainDrop('skull.svg', ['preset'])).toContain('Custom SVG')
  })

  it('points a photograph at the texture slot rather than calling it unsupported', () => {
    expect(explainDrop('valley.jpg', [])).toContain('Texture')
  })

  it('truncates a long name instead of filling the banner with it', () => {
    const msg = explainDrop(`${'x'.repeat(200)}.zip`, [])
    expect(msg).toContain('…')
    expect(msg.length).toBeLessThan(240)
  })
})

describe('dragHasFiles', () => {
  it('is true only for a drag carrying files', () => {
    expect(dragHasFiles({ types: ['Files'] })).toBe(true)
    expect(dragHasFiles({ types: ['text/plain'] })).toBe(false)
    // A DOMStringList, which is what a real event carries — not an Array.
    expect(dragHasFiles({ types: { length: 1, 0: 'Files', [Symbol.iterator]: Array.prototype[Symbol.iterator] } })).toBe(true)
    expect(dragHasFiles({})).toBe(false)
    expect(dragHasFiles(null)).toBe(false)
  })
})
