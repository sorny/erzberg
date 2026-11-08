import { describe, expect, it } from 'vitest'
import { legendEntries, legendShapes, markFont } from '../../src/utils/legend'
import { marksFor, strokeTexts } from '../../src/utils/sheetFacts'
import { presetSheet } from '../../src/utils/presetFile'
import { STYLE_DEF, VIEW_DEF } from '../../src/defaults'

const STOPS = [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }]
const plate = (over = {}) => ({ ...STYLE_DEF, ...VIEW_DEF, gradientStops: STOPS, enabledLines: false, ...over })

describe('legendEntries', () => {
  it('lists nothing for a plate that draws no colour source and no layer', () => {
    expect(legendEntries(plate())).toEqual([])
  })

  it('gives the height ramp in metres on a georeferenced raster, highest step last', () => {
    const [ramp] = legendEntries(plate({ showFill: true, fillHypsometric: true, geoTiffElevMin: 4200, geoTiffElevMax: 6800 }), {}, { steps: 7 })
    expect(ramp.kind).toBe('ramp')
    expect(ramp.title).toBe('Elevation')
    expect(ramp.range).toBe('4 200 – 6 800 m')
    expect(ramp.colors).toHaveLength(7)
    expect(ramp.colors[0] < ramp.colors[6]).toBe(true)
  })

  it('draws a banded ramp in its own bands', () => {
    const [ramp] = legendEntries(plate({ showFill: true, fillHypsometric: true, fillBanded: true, fillHypsoInterval: 20 }))
    expect(ramp.colors).toHaveLength(5)
    expect(ramp.range).toBe('Low – high')
  })

  it('lists the ten landform inks when a layer is coloured by form', () => {
    const e = legendEntries(plate({ enabledContours: true, hypsoContours: true, hypsoModeContours: 'form', colorBLandform: '#123456' }))
    const forms = e.find((x) => x.title === 'Landforms')
    expect(forms.items).toHaveLength(10)
    expect(forms.items[1]).toEqual({ color: '#123456', name: 'Peak' })
    // A layer coloured by form has no line ink to sample.
    expect(e.find((x) => x.kind === 'line')).toBeUndefined()
  })

  it('samples each line layer in its ink, with the contour interval in metres', () => {
    const e = legendEntries(plate({
      enabledContours: true, colorContours: '#3d5a2a', intervalContours: 4, elevScale: 1,
      geoTiffElevMin: 0, geoTiffElevMax: 1000, enabledValley: true, colorValley: '#4f8fb8', dashValley: 'dashed',
    }), { vectorLayers: [{ name: 'Rivers', color: '#0000ff', dash: 'solid' }, { name: 'Hidden', visible: false }] })
    const lines = e.find((x) => x.kind === 'line')
    expect(lines.items.map((i) => i.name)).toEqual(['Contours, 40 m', 'Valleys', 'Rivers'])
    expect(lines.items[1]).toMatchObject({ color: '#4f8fb8', dash: 'dashed' })
  })

  it('lists a mode copy under its own name', () => {
    const e = legendEntries(plate({ modeCopies: [{ uid: 'c1', mode: 'Contours', name: 'Contours 2', values: { enabledContours: true, colorContours: '#ff0000' } }] }))
    expect(e[0].items).toEqual([{ key: 'copy:c1', color: '#ff0000', dash: 'solid', name: 'Contours 2', base: 'Contours 2' }])
  })

  it('names a sample by what was typed for it, and keeps the generated name', () => {
    const copies = [{ uid: 'c1', mode: 'Contours', name: 'Contours 2', values: { enabledContours: true } }]
    const [it0] = legendEntries(plate({ modeCopies: copies, legendNames: JSON.stringify({ 'copy:c1': 'Index lines' }) }))[0].items
    expect(it0).toMatchObject({ name: 'Index lines', base: 'Contours 2' })
    // A broken value names nothing rather than throwing.
    expect(legendEntries(plate({ modeCopies: copies, legendNames: '{oops' }))[0].items[0].name).toBe('Contours 2')
  })

  it('shows only the groups that are picked', () => {
    const p = plate({ showFill: true, fillHypsometric: true, enabledContours: true, legendParts: 'line' })
    expect(legendEntries(p).map((x) => x.kind)).toEqual(['line'])
  })

  it('leaves out a tint at 0% opacity', () => {
    expect(legendEntries(plate({ showWaterFill: true, waterOpacity: 0 }))).toEqual([])
    expect(legendEntries(plate({ showWaterFill: true }))[0].items).toEqual([{ color: STYLE_DEF.waterColor, name: 'Water' }])
  })
})

describe('legendShapes', () => {
  const box = { x: 0, y: 0, w: 1000, h: 800 }
  const entries = legendEntries(plate({ showFill: true, fillHypsometric: true, enabledContours: true }))

  it('sits inside its corner and carries each swatch colour', () => {
    const s = legendShapes(entries, { box, corner: 'bl' })
    expect(s.bounds.x).toBeGreaterThanOrEqual(0)
    expect(s.bounds.y + s.bounds.h).toBeLessThanOrEqual(800)
    expect(s.bounds.y).toBeGreaterThan(400)
    expect(s.rects.every((r) => /^#[0-9a-f]{6}$/.test(r[4]))).toBe(true)
    const tr = legendShapes(entries, { box, corner: 'tr' })
    expect(tr.bounds.x + tr.bounds.w).toBeLessThanOrEqual(1000)
    expect(tr.bounds.y).toBeLessThan(100)
  })

  it('moves clear of a mark that holds the same corner', () => {
    const free = legendShapes(entries, { box, corner: 'bl' })
    const bar = { x: 0, y: 700, w: 300, h: 100 }
    const moved = legendShapes(entries, { box, corner: 'bl', avoid: [bar] })
    expect(moved.bounds.y + moved.bounds.h).toBeLessThanOrEqual(700)
    expect(moved.bounds.y).toBeLessThan(free.bounds.y)
  })

  it('letters titles in capitals unless told not to', () => {
    expect(legendShapes(entries, { box }).texts.map((t) => t.text)).toContain('ELEVATION')
    expect(legendShapes(entries, { box, upper: false }).texts.map((t) => t.text)).toContain('Elevation')
  })
})

describe('marksFor with a legend', () => {
  it('draws the legend on a plain heightmap, with no scale to measure', () => {
    const p = plate({ legendOn: true, legendInk: '#224422' })
    const sheet = { legend: legendEntries(plate({ showFill: true, fillHypsometric: true })) }
    const m = marksFor({ p, sheet, width: 800, height: 600, frame: null, scale: null })
    expect(m.rects.length).toBeGreaterThan(0)
    expect(m.texts.every((t) => t.color === '#224422')).toBe(true)
    expect(m.font).toBe('sans-serif')
  })

  it('letters every mark in the chosen font', () => {
    expect(markFont('mono')).toMatch(/monospace$/)
    const m = marksFor({ p: plate({ frameTitle: true, frameMarkFont: 'serif' }), sheet: { title: ['A'] }, width: 800, height: 600, frame: null, scale: null })
    expect(m.font).toMatch(/serif$/)
  })
})

describe('presetSheet', () => {
  it('keeps the map elements and the legend, and nothing else', () => {
    expect(presetSheet({ legendOn: true, frameMarkFont: 'mono', frameTitleText: 'X', tilt: 0, bgColor: '#fff', showFrame: true }))
      .toEqual({ legendOn: true, frameMarkFont: 'mono', frameTitleText: 'X' })
    expect(presetSheet(null)).toBeNull()
    expect(presetSheet({ tilt: 0 })).toBeNull()
  })
})

describe('the Layers group', () => {
  const two = () => plate({
    enabledContours: true,
    modeCopies: [{ uid: 'c1', mode: 'Contours', name: 'Contours 2', values: { enabledContours: true, colorContours: '#ff0000' } }],
  })
  const lineOf = (p) => legendEntries(p).find((e) => e.kind === 'line')

  it('keys each sample by mode, copy or vector layer', () => {
    const e = legendEntries(two(), { vectorLayers: [{ id: 'v7', name: 'Roads', color: '#333333' }] }).find((x) => x.kind === 'line')
    expect(e.items.map((it) => it.key)).toEqual(['mode:Contours', 'copy:c1', 'vector:v7'])
  })

  it('marks a sample switched off, and the layout leaves it out', () => {
    const p = { ...two(), legendHide: 'copy:c1' }
    const e = lineOf(p)
    expect(e.items.map((it) => !!it.hidden)).toEqual([false, true])
    const box = { x: 0, y: 0, w: 800, h: 600 }
    const shown = legendShapes([e], { box }).texts.map((t) => t.text)
    expect(shown.some((t) => t.startsWith('Contours 2'))).toBe(false)
    expect(shown.some((t) => t.startsWith('Contours'))).toBe(true)
  })

  it('lists the samples in the order set in the panel, and an unnamed one after them', () => {
    const facts = { vectorLayers: [{ id: 'v7', name: 'Roads', color: '#333333' }] }
    const e = legendEntries({ ...two(), legendOrder: 'vector:v7,copy:c1' }, facts).find((x) => x.kind === 'line')
    expect(e.items.map((it) => it.key)).toEqual(['vector:v7', 'copy:c1', 'mode:Contours'])
    const shown = legendShapes([e], { box: { x: 0, y: 0, w: 800, h: 600 }, upper: false }).texts.map((t) => t.text)
    expect(shown.slice(1, 3)).toEqual(['Roads', 'Contours 2'])
  })

  it('drops the group when every sample is off', () => {
    const e = lineOf({ ...two(), legendHide: 'mode:Contours,copy:c1' })
    expect(legendShapes([e], { box: { x: 0, y: 0, w: 800, h: 600 } })).toBeNull()
  })

  it('takes its title from the panel, and draws none when it is empty', () => {
    const box = { x: 0, y: 0, w: 800, h: 600 }
    const titled = legendShapes([lineOf({ ...two(), legendLineTitle: 'Pens' })], { box, upper: false })
    expect(titled.texts[0].text).toBe('Pens')
    const bare = legendShapes([lineOf({ ...two(), legendLineTitle: '' })], { box, upper: false })
    expect(bare.texts.map((t) => t.text).some((t) => t === '' || t === 'Layers')).toBe(false)
    expect(bare.texts).toHaveLength(2)
  })
})

describe('marks in a single-line face', () => {
  // Two glyphs: 'A' a single stroke, ' ' a blank advance.
  const font = { key: 'sl:Test', stroke: true, unitsPerEm: 1000, glyphs: { A: [600, [[0, 0, 300, 700, 600, 0]]], ' ': [400, []] } }

  it('sets each run as strokes in screen pixels, on its baseline', () => {
    const [s] = strokeTexts([{ x: 100, y: 50, text: 'A', size: 10, anchor: 'start' }], font)
    expect(s.pts).toEqual([100, 50, 103, 43, 106, 50])
  })

  it('honours the anchor', () => {
    const [s] = strokeTexts([{ x: 100, y: 50, text: 'A', size: 10, anchor: 'end' }], font)
    expect(s.pts[4]).toBeCloseTo(100)
  })

  it('replaces the text of every mark once the face is loaded', () => {
    const p = plate({ frameTitle: true, frameMarkFont: 'line' })
    const waiting = marksFor({ p, sheet: { title: ['A'] }, width: 800, height: 600, frame: null, scale: null })
    expect(waiting.texts.length).toBeGreaterThan(0)
    const m = marksFor({ p, sheet: { title: ['A'], strokeFont: font }, width: 800, height: 600, frame: null, scale: null })
    expect(m.texts).toEqual([])
    expect(m.strokes.length).toBeGreaterThan(0)
    expect(m.textSize).toBe(waiting.texts[0].size)
  })
})
