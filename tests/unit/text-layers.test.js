/**
 * Free text layers: the model, and how `layerStyle` reads one back.
 *
 * The lettering itself lives in a React hook and is covered end to end by
 * `tests/text.spec.js`. What is arithmetic — the id counter, the derived row
 * name, and the ink cascade — belongs here.
 */
import { describe, it, expect } from 'vitest'
import { makeTextLayer, textLayerName, adoptTextLayers, isTextLayerId, TEXT_LAYER_DEF }
  from '../../src/utils/textLayers'
import { layerStyle } from '../../src/utils/geometryBuilders'

describe('text layers', () => {
  it('hands out distinct ids', () => {
    const a = makeTextLayer(), b = makeTextLayer()
    expect(a.id).not.toBe(b.id)
    expect(isTextLayerId(a.id)).toBe(true)
    expect(isTextLayerId('vec:3')).toBe(false)
  })

  it('never reissues an id a restored session is already using', () => {
    // Two layers sharing an id collide in `layerStyle` and in React's keys at
    // once, so the counter has to be re-seeded from whatever came back.
    adoptTextLayers([{ id: 'txt:900' }, { id: 'txt:12' }])
    expect(Number(makeTextLayer().id.slice(4))).toBeGreaterThan(900)
  })

  it('survives a session that stored nonsense', () => {
    expect(() => adoptTextLayers([{ id: 'txt:banana' }, {}, { id: null }])).not.toThrow()
    expect(adoptTextLayers(undefined)).toEqual([])
  })

  it('names the row from what the text says, not from what it said once', () => {
    const l = makeTextLayer({ text: 'ERZBERG' })
    expect(textLayerName(l)).toBe('ERZBERG')
    // The row and the SVG pen layer both read this, so it has to follow edits.
    expect(textLayerName({ ...l, text: 'NORTH FACE' })).toBe('NORTH FACE')
    expect(textLayerName({ ...l, text: '  ' })).toBe('Empty')
    // Multi-line text is one row, named by its first line.
    expect(textLayerName({ ...l, text: 'ERZBERG\n1466 m' })).toBe('ERZBERG')
    expect(textLayerName({ ...l, text: 'x'.repeat(60) }).length).toBeLessThanOrEqual(22)
  })

  it('is legible the moment it is added', () => {
    // A text that needs two sliders moved before it can be seen reads as broken.
    expect(TEXT_LAYER_DEF.size).toBeGreaterThanOrEqual(20)
    expect(TEXT_LAYER_DEF.lift).toBeGreaterThan(0)
    expect(TEXT_LAYER_DEF.visible).toBe(true)
    expect(TEXT_LAYER_DEF.faceCamera).toBe(true)
  })

  it('resolves its ink through layerStyle, and its pen name from its text', () => {
    const l = makeTextLayer({ text: 'ERZBERG', color: '#ff0000', weight: 3, opacity: 0.5 })
    const st = layerStyle(l.id, { textLayers: [l] })
    expect(st.color).toBe('#ff0000')
    expect(st.weight).toBe(3)
    expect(st.opacity).toBe(0.5)
    expect(st.name).toBe('ERZBERG')
    // Fill falls back through the stroke, so colouring a text colours all of it.
    expect(st.fillColor).toBe('#ff0000')
    expect(st.fillOpacity).toBe(0.5)
  })

  it('does not throw for a text layer that is no longer in the list', () => {
    // A removal and a render can cross; the style lookup has to survive it.
    expect(() => layerStyle('txt:999', { textLayers: [] })).not.toThrow()
    expect(layerStyle('txt:999', {}).weight).toBe(1)
  })
})
