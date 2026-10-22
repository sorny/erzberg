import { describe, expect, it } from 'vitest'
import { penLine, pensOf } from '../../src/utils/pens'

const seg = [0, 0, 0, 1, 1, 1]
const rgb = (...hexes) => hexes.flatMap((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255))

describe('pensOf', () => {
  it('lists nothing without geometry', () => {
    expect(pensOf(null, {})).toMatchObject({ rows: [], layers: 0, exact: true })
  })

  it('counts a flat line layer as one pen, in its own ink', () => {
    // A draw mode's ink arrives in its vertex colours, as the exporter reads it.
    const out = pensOf([{ id: 'Contours', positions: seg, colors: rgb('#123456', '#123456') }], { inksAsPicked: true })
    expect(out.rows).toEqual([{ id: 'Contours', name: 'Contours', kind: 'line', inks: ['#123456'], count: 1 }])
    expect(out).toMatchObject({ layers: 1, exact: true })
  })

  it('shows inks through the tone curve unless they are taken as picked', () => {
    const geo = [{ id: 'Contours', positions: seg, colors: rgb('#ffffff', '#ffffff') }]
    expect(pensOf(geo, {}).rows[0].inks).toEqual(['#e2e2e2'])
    expect(pensOf(geo, { inksAsPicked: true }).rows[0].inks).toEqual(['#ffffff'])
  })

  it('calls a layer coloured per vertex one layer of many colours', () => {
    const geo = [{ id: 'Contours', positions: [...seg, ...seg], colors: rgb('#ff0000', '#ff0000', '#0000ff', '#0000ff') }]
    const [row] = pensOf(geo, { inksAsPicked: true }).rows
    expect(row).toMatchObject({ kind: 'mixed', count: 1, inks: ['#ff0000', '#0000ff'], mode: 'Contours', copy: false })
    const copy = pensOf([{ ...geo[0], id: 'Contours-Minor@c3' }], { inksAsPicked: true }).rows[0]
    expect(copy).toMatchObject({ mode: 'Contours', copy: true })
  })

  it('falls back to the layer style for a layer with no vertex colours', () => {
    expect(pensOf([{ id: 'Contours', positions: seg }], { inksAsPicked: true }).rows[0])
      .toMatchObject({ kind: 'line', inks: ['#000000'] })
  })

  it('gives a filled-area layer one pen per ink, and leaves the count to Preflight', () => {
    const geo = [{ id: 'Indexed', positions: [], areas: { inks: new Float32Array(rgb('#ff0000', '#0000ff', '#ff0000')) } }]
    const out = pensOf(geo, { inksAsPicked: true })
    expect(out.rows[0]).toMatchObject({ kind: 'areas', count: 2, inks: ['#ff0000', '#0000ff'] })
    expect(out).toMatchObject({ layers: 2, exact: false })
  })

  it('is not exact while hidden lines are drawn', () => {
    const geo = [{ id: 'Contours', positions: seg }]
    expect(pensOf(geo, { depthOcclusion: true, occlusionOpacity: 0.3 })).toMatchObject({ exact: false, hidden: true })
    expect(pensOf(geo, { depthOcclusion: true, occlusionOpacity: 0 })).toMatchObject({ exact: true, hidden: false })
  })

  it('skips a layer with nothing to draw', () => {
    expect(pensOf([{ id: 'Contours', positions: [] }], {}).rows).toEqual([])
  })
})

describe('penLine', () => {
  const rows = (...r) => ({ rows: r, layers: r.reduce((n, x) => n + x.count, 0), hidden: false })
  it('counts layers and inks, and two layers in one ink as one ink', () => {
    expect(penLine(rows({ kind: 'line', inks: ['#000000'], count: 1 }, { kind: 'line', inks: ['#000000'], count: 1 })))
      .toBe('2 layers · 1 ink')
  })
  it('counts a mixed layer apart, since it has no one ink', () => {
    expect(penLine(rows({ kind: 'line', inks: ['#c0d5db'], count: 1 }, { kind: 'mixed', inks: ['#a', '#b'], count: 1 })))
      .toBe('2 layers · 1 ink · 1 mixed')
  })
  it('says up to while an area layer draws, and + hidden while hidden lines do', () => {
    expect(penLine(rows({ kind: 'areas', inks: ['#a', '#b'], count: 2 }))).toBe('up to 2 layers · 2 inks')
    expect(penLine({ ...rows({ kind: 'line', inks: ['#a'], count: 1 }), hidden: true })).toBe('1 layer + hidden · 1 ink')
  })
  it('reads cleanly with nothing drawing', () => {
    expect(penLine(rows())).toBe('0 layers · 0 inks')
  })
})
