/**
 * The copies of one draw mode, under that mode's own controls.
 *
 * Each copy is the same mode with its own settings, for example dense contours
 * on one mask and sparse ones on another. Opened, a copy shows the mode's own
 * controls: `renderBody` draws `ModeSections` scoped to this one section
 * (`SectionScope` in filter.js), reading from the copy and writing to it. So
 * every control a mode has, its masks included, works on a copy with no change
 * to the mode bodies. Data and rules: utils/modeCopies.js.
 */
import { useState } from 'react'
import { copyView, makeCopy, patchCopy } from '../../utils/modeCopies'
import { MODE_ID } from './sectionParams'
import { ACCENT_DEEP, BORDER, Btn, Chevron, Heading, MUTED, SURF, Switch, TEXT } from './ui'

export function ModeCopies({ title, style, ss, renderBody }) {
  const mode = MODE_ID.get(title)
  const all = style.modeCopies ?? []
  const mine = all.filter((c) => c.mode === mode)
  const [open, setOpen] = useState(() => new Set())
  if (!mode) return null

  const write = (next) => ss({ modeCopies: next })
  const add = (source) => {
    const copy = makeCopy(mode, source, all)
    write([...all, copy])
    setOpen((s) => new Set(s).add(copy.uid))
  }
  const toggleOpen = (uid) => setOpen((s) => {
    const n = new Set(s)
    if (n.has(uid)) n.delete(uid)
    else n.add(uid)
    return n
  })
  const slug = mode.toLowerCase()

  return (
    <div data-testid={`mode-copies-block-${slug}`} style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
      {/* Its own block, like Line style and Masks: the button used to follow the
          mask rows with no heading, and read as one of them. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Heading style={{ margin: '0 0 2px' }}>Copies</Heading>
        <span style={{ fontSize: 10, color: mine.length ? ACCENT_DEEP : MUTED }}>{mine.length || 'none'}</span>
      </div>
      <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45, marginBottom: 8 }}>
        The same mode again, with its own settings, masks and pen layers: dense
        contours on rock and sparse ones on forest.
      </div>
      {mine.map((copy) => {
        const view = copyView(style, copy)
        const on = !!view[`enabled${mode}`]
        const isOpen = open.has(copy.uid)
        return (
          <div key={copy.uid} data-testid={`mode-copy-${copy.uid}`}
            style={{ border: `1px solid ${BORDER}`, borderRadius: 5, background: SURF, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px' }}>
              <button type="button" onClick={() => toggleOpen(copy.uid)}
                aria-expanded={isOpen} aria-label={`Open ${copy.name}`}
                data-testid={`mode-copy-open-${copy.uid}`}
                style={{ background: 'none', border: 'none', color: MUTED, cursor: 'pointer', padding: 0, width: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Chevron dir={isOpen ? 'down' : 'right'} /></button>
              <input value={copy.name} aria-label="Copy name" data-testid={`mode-copy-name-${copy.uid}`}
                onChange={(e) => write(all.map((c) => (c.uid === copy.uid ? { ...c, name: e.target.value } : c)))}
                style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', color: on ? TEXT : MUTED,
                  fontSize: 11, fontWeight: 600, padding: 0 }} />
              <Switch label={`${copy.name} on`} checked={on} testId={`mode-copy-on-${copy.uid}`}
                onChange={(v) => write(patchCopy(all, copy.uid, { [`enabled${mode}`]: v }))} />
            </div>
            {isOpen && (
              <div style={{ padding: '0 8px 8px', borderTop: `1px solid ${BORDER}` }}>
                {renderBody(title, view, (patch) => write(patchCopy(all, copy.uid, patch)))}
                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  <Btn size="xs" onClick={() => add(view)} data-testid={`mode-copy-duplicate-${copy.uid}`}>Duplicate</Btn>
                  <Btn size="xs" onClick={() => write(all.filter((c) => c.uid !== copy.uid))}
                    data-testid={`mode-copy-delete-${copy.uid}`}>Remove</Btn>
                </div>
              </div>
            )}
          </div>
        )
      })}
      <Btn size="md" onClick={() => add(style)} data-testid={`mode-duplicate-${slug}`}
        title="Add a copy of this mode with its own settings" style={{ width: '100%' }}>
        + Duplicate this mode
      </Btn>
    </div>
  )
}
