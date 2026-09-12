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

const CARD   = 'rgba(20,20,24,0.94)'
const BORDER = 'rgba(255,255,255,0.10)'

/** One key, drawn as a key. */
function Cap({ children }) {
  // The mouse rows are words rather than keys — "right-drag" in a keycap would
  // be claiming there is a button on the keyboard with that written on it.
  const isWord = /[a-z]{3,}/.test(children) && children !== 'Enter' && children !== 'Space'
  if (isWord) return <span style={{ color: '#8f8f99', fontStyle: 'italic' }}>{children}</span>
  return (
    <kbd style={{
      display: 'inline-block', minWidth: 20, textAlign: 'center',
      background: 'rgba(255,255,255,0.07)', border: `1px solid ${BORDER}`,
      borderRadius: 4, padding: '2px 6px',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 11, lineHeight: 1.4, color: '#e4e4e7',
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
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Stops the click that would dismiss it, so text inside stays selectable. */}
      <div onClick={(e) => e.stopPropagation()} style={{
        background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8,
        padding: '18px 22px 20px', maxHeight: '86vh', overflowY: 'auto',
        boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 24, marginBottom: 14,
        }}>
          <span style={{ fontSize: 13, color: '#e4e4e7', letterSpacing: 0.3 }}>Keyboard</span>
          <button onClick={onDismiss} data-testid="shortcuts-close" aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#8f8f99', fontSize: 13, lineHeight: 1, padding: 2,
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
                fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8,
                color: '#5a5a63', marginBottom: 7,
              }}>{g.group}</div>
              <table style={{ borderCollapse: 'separate', borderSpacing: '0 4px' }}>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.label + r.keys.join()}>
                      <td style={{ paddingRight: 12, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                        {r.keys.map((k) => <Cap key={k}>{k}</Cap>)}
                      </td>
                      <td style={{ fontSize: 11.5, color: '#c4c4cc', lineHeight: 1.5 }}>
                        {r.label}
                        {r.note && (
                          <span style={{ color: '#6f6f78' }}>{` — ${r.note}`}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, fontSize: 10.5, color: '#5a5a63' }}>
          Keys are ignored while the cursor is in a text field.
        </div>
      </div>
    </div>
  )
}
