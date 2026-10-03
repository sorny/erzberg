/**
 * The keyboard, on screen.
 *
 * Opened with `?`, dismissed with `?`, Escape or a click anywhere. Modal in
 * appearance only: it takes no focus and holds no state, because there is
 * nothing in it to do — it is a page of the manual that happens to be inside
 * the app instead of beside it.
 *
 * The list comes from `utils/shortcuts.js`, which a unit test keeps in step
 * with the handlers.
 */
import { SHORTCUTS } from '../utils/shortcuts'
import { BG, DIM, FONT, GLASS_BORDER, MONO, MUTED, SCRIM, TEXT } from './panel/ui'

/** One key, drawn as a key. */
function Cap({ children }) {
  // The mouse rows are words rather than keys — "right-drag" in a keycap would
  // be claiming there is a button on the keyboard with that written on it.
  const isWord = /[a-z]{3,}/.test(children) && children !== 'Enter' && children !== 'Space'
  if (isWord) return <span style={{ color: MUTED, fontStyle: 'italic' }}>{children}</span>
  return (
    <kbd style={{
      display: 'inline-block', minWidth: 20, textAlign: 'center',
      background: 'var(--hm-veil-strong)', border: `1px solid ${GLASS_BORDER}`,
      borderRadius: 3, padding: '2px 6px',
      fontFamily: MONO,
      fontSize: 11, lineHeight: 1.4, color: TEXT,
    }}>{children}</kbd>
  )
}

export function ShortcutsOverlay({ onDismiss }) {
  return (
    <div
      data-testid="shortcuts-overlay"
      onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: SCRIM, backdropFilter: 'blur(3px)',
        fontFamily: FONT,
      }}
    >
      {/* Stops the click that would dismiss it, so text inside stays selectable. */}
      <div onClick={(e) => e.stopPropagation()} style={{
        background: BG, border: `1px solid ${GLASS_BORDER}`, borderRadius: 10,
        padding: '18px 22px 20px', maxHeight: '86vh', overflowY: 'auto',
        boxShadow: '0 18px 50px var(--hm-shadow)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 24, marginBottom: 14,
        }}>
          <span style={{ fontSize: 13, color: TEXT }}>Keyboard</span>
          <button onClick={onDismiss} data-testid="shortcuts-close" aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: MUTED, fontSize: 13, lineHeight: 1, padding: 2,
            }}>✕</button>
        </div>

        {/* Two columns on purpose. Four groups stacked is a card taller than a
            laptop viewport, and this is a thing to glance at rather than read. */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, auto)',
          columnGap: 34, rowGap: 16, alignItems: 'start',
        }}>
          {SHORTCUTS.map((g) => (
            <div key={g.group}>
              <div style={{
                fontSize: 12, fontWeight: 600,
                color: DIM, marginBottom: 7,
              }}>{g.group}</div>
              <table style={{ borderCollapse: 'separate', borderSpacing: '0 4px' }}>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.label + r.keys.join()}>
                      <td style={{ paddingRight: 12, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                        {r.keys.map((k) => <Cap key={k}>{k}</Cap>)}
                      </td>
                      <td style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
                        {r.label}
                        {r.note && (
                          <span style={{ color: MUTED, opacity: 0.75 }}>{` — ${r.note}`}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: MUTED }}>
          Keys are ignored while the cursor is in a text field.
        </div>
      </div>
    </div>
  )
}
