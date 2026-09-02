/**
 * The names that reach an SVG's layer list.
 *
 * A pen layer carries two names and they do different jobs. The `id` is a slug a
 * script matches on and has to be a valid XML id. The `inkscape:label` is what a
 * person sorting a plot by pen actually reads.
 *
 * Nothing pinned the second one, and that cost a red test: when the pen layers
 * gained human names, `contour-labels.spec.js` was still looking for "Labels" in
 * the display name of a layer now shown as "Contours · Heights". It read as a
 * missing layer for two releases while the export was correct the whole time.
 *
 * So the names are pinned here — in one small unit test that says which name
 * changed, rather than in a distant end-to-end regex that says a layer vanished.
 */
import { describe, expect, it } from 'vitest'
import { layerDisplayName, MODE_LABEL, SUB_LAYER_LABEL, DRAW_MODE_IDS } from '../../src/utils/drawModes'

describe('layerDisplayName', () => {
  it('names a whole mode after the mode', () => {
    expect(layerDisplayName('Lines')).toBe('Lines')
    expect(layerDisplayName('Shed')).toBe('Watershed')
  })

  it('names a sub-layer as mode then part', () => {
    expect(layerDisplayName('Contours-Labels')).toBe('Contours · Heights')
    expect(layerDisplayName('Contours-Major')).toBe('Contours · Major')
    expect(layerDisplayName('Swiss-Scree')).toBe('Rock & scree · Scree')
    expect(layerDisplayName('Riso-A')).toBe('Riso · Ink A')
  })

  it('falls back to the id rather than to nothing', () => {
    // A sub-layer added without a `SUB_LAYER_LABEL` entry still gets a readable
    // name, so forgetting the table is a shabby name and not a blank one.
    expect(layerDisplayName('Contours-SomethingNew')).toBe('Contours · Something New')
  })

  it('never leaves a layer nameless', () => {
    for (const id of DRAW_MODE_IDS) {
      const n = layerDisplayName(id)
      expect(n, id).toBeTruthy()
      expect(n.trim(), id).toBe(n)
    }
    for (const id of Object.keys(SUB_LAYER_LABEL)) {
      expect(layerDisplayName(id), id).toContain(' · ')
    }
  })

  it('keys every sub-layer label off a mode it can name', () => {
    // `Contours-Labels` splits at the first dash, so a sub-layer whose prefix is
    // not a mode would be named after a mode that does not exist.
    for (const id of Object.keys(SUB_LAYER_LABEL)) {
      const mode = id.slice(0, id.indexOf('-'))
      expect(MODE_LABEL[mode] ?? DRAW_MODE_IDS.includes(mode), id).toBeTruthy()
    }
  })
})
