/**
 * Labels are sentence case; tracked capitals were retired with the Ore palette.
 * Nineteen group headings kept them anyway ("MATERIALS", "PHYSICS") until
 * someone saw them. This catches the next one. File formats are names, not
 * shouting, and stay as they are.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FORMATS = new Set(['SVG', 'PNG', 'STL', 'GPX', 'DEM', 'OSM', 'SVF', 'TSP'])

function sources(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.jsx') ? [p] : []
  })
}

describe('label case', () => {
  it('has no label in capitals', () => {
    const off = []
    for (const p of sources('src/components')) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/\blabel="([^"]+)"/g)) {
          const t = m[1]
          if (/^[A-Z][A-Z &]{2,}$/.test(t) && !FORMATS.has(t)) off.push(`${p}:${i + 1} ${t}`)
        }
      })
    }
    expect(off).toEqual([])
  })
})
