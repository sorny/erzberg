/**
 * The legend's line samples, one row each: a grip to reorder, the name, and a
 * switch.
 *
 * `keys.order` names the view key that holds the order (`legendOrder`),
 * `keys.hide` the samples switched off (`legendHide`), both as lists of sample
 * keys (`mode:<id>`, `copy:<uid>`, `vector:<id>`), and `keys.names` the names
 * typed over the generated ones (`legendNames`, a JSON object by sample key).
 * Reordering uses the same pointer drag as the Text and Vector layer stacks,
 * and the arrow keys on a focused grip.
 */
import { BORDER, FONT, GripIcon, SUNK, SURF, Switch, TEXT } from './ui'
import { legendNames } from '../../utils/legend'
import { useStackDrag } from './stackDrag'

export function LegendItems({ items, view, sv, keys }) {
  const rows = items.map((it) => ({ ...it, id: it.key }))
  const reorder = (key, to) => {
    const order = rows.map((r) => r.id)
    const from = order.indexOf(key)
    if (from < 0 || to < 0 || to >= order.length || to === from) return
    order.splice(to, 0, order.splice(from, 1)[0])
    sv({ [keys.order]: order.join(',') })
  }
  const drag = useStackDrag(rows, reorder)
  const hide = new Set(String(view[keys.hide] ?? '').split(',').filter(Boolean))
  const setShown = (key, on) => {
    if (on) hide.delete(key); else hide.add(key)
    sv({ [keys.hide]: [...hide].join(',') })
  }
  const names = legendNames({ legendNames: view[keys.names] })
  const setName = (key, text) => {
    const next = { ...names }
    if (text.trim()) next[key] = text; else delete next[key]
    sv({ [keys.names]: Object.keys(next).length ? JSON.stringify(next) : '' })
  }

  return rows.map((it, i) => {
    const held = drag.dragging === it.id
    return (
      <div key={it.id} ref={drag.bindRow(it.id)} data-testid={`legend-row-${it.id}`}
        style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4,
                 opacity: held ? 0.55 : 1, background: held ? SURF : 'transparent' }}>
        <button data-testid={`legend-grip-${it.id}`}
          title={`Drag to reorder: #${i + 1} of ${rows.length}`}
          aria-label={`Reorder ${it.name}`}
          onPointerDown={(e) => drag.start(e, it.id)}
          onPointerMove={drag.move}
          onPointerUp={drag.end}
          onPointerCancel={drag.end}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
            if (!step) return
            e.preventDefault()
            reorder(it.id, i + step)
          }}
          style={{ background: 'none', border: 'none', padding: '1px 0 0', display: 'flex',
                   color: held ? TEXT : BORDER, cursor: held ? 'grabbing' : 'grab',
                   touchAction: 'none', flexShrink: 0 }}><GripIcon /></button>
        <input data-testid={`legend-name-${it.id}`} value={names[it.id] ?? ''} maxLength={60}
          onChange={(e) => setName(it.id, e.target.value)}
          placeholder={it.base ?? it.name} aria-label={`Legend name for ${it.base ?? it.name}`}
          title={it.base ?? it.name}
          style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', fontSize: 11, padding: '3px 6px',
                   background: SUNK, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 3,
                   fontFamily: FONT, opacity: it.hidden ? 0.5 : 1 }} />
        <Switch label={`Show ${it.base ?? it.name}`} testId={`legend-item-${it.id}`}
          checked={!it.hidden} onChange={(v) => setShown(it.id, v)} />
      </div>
    )
  })
}
