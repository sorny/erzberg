/**
 * The card against the handlers.
 *
 * A list of shortcuts written by hand goes stale the first time somebody binds
 * a key and does not think of it — which is the whole reason the card is worth
 * having, so a stale one is worse than none. There is no runtime link between
 * the two: the handlers live in three components that each own their listener,
 * and the card reads a table. This test is the link.
 *
 * It reads the source of every file that listens for a key and collects the
 * `KeyboardEvent.code` values compared against, in the two forms the codebase
 * uses: `e.code === 'KeyE'` and `switch (e.code) { case 'KeyQ': }`.
 *
 * Deliberately only `e.code`. `e.key` is also tested in places, but those are
 * local handlers on one field — Escape clearing the preset filter, the arrows
 * stepping a number box — and they belong to the control the cursor is in, not
 * to the app. The one global handler keyed on a character is `?` itself, which
 * carries a comment in `shortcuts.js` saying why.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { CODES, SHORTCUTS } from '../../src/utils/shortcuts'

/** Every file with a `keydown` listener on `window`. */
const SOURCES = [
  'src/App.jsx',
  'src/components/Controls.jsx',
  'src/components/Sidebar.jsx',
  'src/components/HeightmapEditor.jsx',
]

/** The codes a file's handlers actually compare against. */
function boundCodes(file) {
  const src = readFileSync(path.join(process.cwd(), file), 'utf8')
  const found = new Set()
  for (const m of src.matchAll(/\be\.code\s*===\s*'(\w+)'/g)) found.add(m[1])
  // `switch (e.code)` up to its closing brace at the same indent.
  for (const sw of src.matchAll(/switch\s*\(\s*e\.code\s*\)\s*\{([\s\S]*?)\n\s*\}/g)) {
    for (const c of sw[1].matchAll(/case\s+'(\w+)'/g)) found.add(c[1])
  }
  return found
}

const bound = new Set(SOURCES.flatMap((f) => [...boundCodes(f)]))

describe('the keyboard card', () => {
  it('found the handlers at all', () => {
    // The guard on the guard: a rename that moved a listener out of these four
    // files would otherwise leave this suite passing on an empty set.
    expect(bound.size).toBeGreaterThanOrEqual(12)
    expect(bound).toContain('Digit1')
    expect(bound).toContain('KeyQ')      // the switch form
  })

  it('accounts for every key the app binds', () => {
    const missing = [...bound].filter((c) => !CODES.has(c)).sort()
    expect(missing, `bound but not on the card: ${missing.join(', ')}`).toEqual([])
  })

  it('advertises no key that nothing binds', () => {
    const phantom = [...CODES].filter((c) => !bound.has(c)).sort()
    expect(phantom, `on the card but bound nowhere: ${phantom.join(', ')}`).toEqual([])
  })

  it('gives every row something to press and something to read', () => {
    for (const g of SHORTCUTS) {
      expect(g.group).toBeTruthy()
      expect(g.rows.length).toBeGreaterThan(0)
      for (const r of g.rows) {
        expect(r.keys.length).toBeGreaterThan(0)
        expect(r.label).toBeTruthy()
      }
    }
  })
})
