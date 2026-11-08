/**
 * The SVG's layers grouped by ink: one top layer per ink, the pen layers of that
 * ink inside it, and a last group for layers of several inks.
 */
import { describe, expect, it } from 'vitest'
import { inkTree } from '../../src/utils/svgExport'

const layer = (no, name, ink) =>
  `<g id="layer-${name}" inkscape:groupmode="layer" inkscape:label="${no} · ${name}${ink ? ` · ${ink}` : ''}"` +
  `${ink ? ` data-ink="${ink}"` : ''} data-name="${name}"><title>${no} · ${name}</title><path d="M0 0L1 1"/></g>`

describe('inkTree', () => {
  const tree = inkTree([layer('01', 'Lines', '#000000'), layer('02', 'Contours', '#ff0000'),
    layer('03', 'Ramp', null), layer('04', 'Rivers', '#000000')])

  it('makes one top layer per ink, in the order each ink first plots, and the mixed last', () => {
    expect(tree.map((g) => g.match(/inkscape:label="([^"]+)"/)[1]))
      .toEqual(['01 · #000000', '02 · #ff0000', '03 · Several inks'])
  })
  it('puts the layers of an ink inside it, without their own plot numbers', () => {
    expect(tree[0]).toContain('inkscape:label="Lines · #000000"')
    expect(tree[0]).toContain('inkscape:label="Rivers · #000000"')
    expect(tree[0]).toContain('<title>Rivers</title>')
    expect(tree[0]).not.toContain('Contours')
  })
})
