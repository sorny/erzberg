/**
 * The chrome uses five font sizes, 9 to 13 px, written down in
 * `src/components/panel/ui.jsx`. Half-pixel steps crept in once, fourteen
 * sizes in all, and nothing caught them. This does.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCALE = new Set([9, 10, 11, 12, 13])
// The empty state is display type, and only it.
const DISPLAY = { 'App.jsx': new Set([14, 16, 22, 56]) }

function sources(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.jsx') ? [p] : []
  })
}

describe('type scale', () => {
  it('uses only the five sizes', () => {
    const off = []
    for (const p of [...sources('src/components'), 'src/App.jsx']) {
      const lines = readFileSync(p, 'utf8').split('\n')
      const display = DISPLAY[p.split('/').pop()] ?? new Set()
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/fontSize:\s*([0-9.]+)/g)) {
          const v = Number(m[1])
          if (!SCALE.has(v) && !display.has(v)) off.push(`${p}:${i + 1} ${v}`)
        }
      })
    }
    expect(off).toEqual([])
  })
})
