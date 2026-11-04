import { describe, expect, it } from 'vitest'
import { buildPreset, presetToText } from '../../src/utils/presetFile'
import {
  SHELF_KEY, addToShelf, freeName, mergeShelf, readShelf, removeFromShelf,
  shelfFromText, shelfPreset, shelfToText, writeShelf,
} from '../../src/utils/presetShelf'
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from '../../src/defaults'

const text = presetToText(buildPreset({
  terrain: TERRAIN_DEF, style: { ...STYLE_DEF, bgColor: '#123456' }, points: POINTS_DEF, view: VIEW_DEF,
  gradientStops: [], bgGradientStops: [],
}))
const entry = (name, t = text) => ({ name, text: t, thumb: null, saved: '2026-11-04T00:00:00Z' })

function memoryStorage() {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }
}

describe('the preset shelf', () => {
  it('stores and reads back, and drops broken entries', () => {
    const st = memoryStorage()
    expect(readShelf(st)).toEqual([])
    expect(writeShelf([entry('A'), { name: '' }], st)).toBe(true)
    expect(readShelf(st).map((e) => e.name)).toEqual(['A'])
    st.setItem(SHELF_KEY, 'not json')
    expect(readShelf(st)).toEqual([])
  })

  it('says false when the browser refuses', () => {
    expect(writeShelf([entry('A')], { setItem: () => { throw new Error('full') } })).toBe(false)
  })

  it('puts a new look first and replaces one of the same name', () => {
    const list = addToShelf(addToShelf([], entry('A')), entry('B'))
    expect(list.map((e) => e.name)).toEqual(['B', 'A'])
    expect(addToShelf(list, entry('A')).map((e) => e.name)).toEqual(['A', 'B'])
    expect(removeFromShelf(list, 'B').map((e) => e.name)).toEqual(['A'])
  })

  it('finds a free name', () => {
    expect(freeName([], 'Dusk')).toBe('Dusk')
    expect(freeName([entry('Dusk'), entry('Dusk 2')], 'Dusk')).toBe('Dusk 3')
  })

  it('reads its preset back', () => {
    expect(shelfPreset(entry('A')).style.bgColor).toBe('#123456')
  })

  it('round-trips as a file and merges without losing a name', () => {
    const file = shelfToText([entry('A'), entry('B', '{"bad":')])
    const incoming = shelfFromText(file)
    expect(incoming.map((e) => e.name)).toEqual(['A'])
    expect(shelfFromText('{"app":"other"}')).toBeNull()
    const other = entry('A', text.replace('#123456', '#654321'))
    expect(mergeShelf([entry('A')], [entry('A')]).length).toBe(1)
    expect(mergeShelf([entry('A')], [other]).map((e) => e.name)).toEqual(['A', 'A 2'])
  })
})
