/**
 * Thirty-one draw modes, on one screen.
 *
 * The modes are the largest thing in the panel and the least visible: thirty-one
 * sections over 2 239 px, each a header that says a noun. Which four were
 * drawing was a question you answered by scrolling past the twenty-seven that
 * were not, counting green dots. The grid answers it in one look, and lets you
 * switch one on from wherever you are.
 *
 * ── What this is not ─────────────────────────────────────────────────────────
 * It is not a layer stack. Nothing here reorders, nothing is dragged, and no
 * mode becomes a record in a store: a tile reads `style.enabled<Id>` and writes
 * `style.enabled<Id>` and does nothing else. That distinction is the whole
 * reason this can exist at all — the stack was built twice and reverted twice,
 * because it arrived beside the thirty-one sections as a second way of working
 * rather than a shorter way to the same one.
 *
 * The tile and the section's own Enabled switch are two views of one boolean, so
 * they cannot disagree. There is no second piece of state to keep in step, which
 * is what separates this from a duplicate control.
 *
 * ── Why the glyphs ───────────────────────────────────────────────────────────
 * Thirty-one names in a 248 px column would be a list, and the panel already has
 * that list. The marks are what a mode actually puts on paper, they already
 * exist in `modeMarks.jsx` — one per section header, where only one is ever on
 * screen at a time — and side by side they are the only form in which
 * thirty-one modes fit above the fold. Every tile carries its name as a tooltip
 * and as its accessible name, because a glyph teaches less than a word.
 */
import { DRAW_MODES } from '../../utils/drawModes'
import { ModeMark } from './modeMarks'
import { PANEL_MODES } from './sectionSummary'
import { ACCENT_DEEP, BORDER, DIM, MUTED, SURF } from './ui'

/** id → the glyph that shows what it draws. One lookup, built once. */
const MARK_FOR = Object.fromEntries(DRAW_MODES.map((m) => [m.id, m.mark]))

/**
 * The grid, in the panel's own mode order.
 *
 * `PANEL_MODES` rather than `DRAW_MODES`: the two hold the same thirty-one in
 * different orders, and the tile under the cursor has to be the section the
 * click scrolls to. `DRAW_MODES` is in pipeline order, which is the order the
 * geometry is built in and not the order the panel lists.
 *
 * @param {object}   props
 * @param {object}   props.style     the live style params
 * @param {Function} props.onToggle  (enabledKey, next, sectionId) => void
 */
export function ModeIndex({ style, onToggle }) {
  return (
    <div data-testid="mode-index" style={{
      display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:4,
    }}>
      {PANEL_MODES.map(([title, key]) => {
        const id   = key.slice('enabled'.length)
        const on   = !!style[key]
        // `Mode: Stipple Dots` is the section's title; the tile only needs the
        // half that names the mark.
        const name = title.replace(/^Mode:\s*/, '')
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            aria-label={name}
            title={`${name} — ${on ? 'drawing' : 'off'}`}
            data-testid={`mode-tile-${id}`}
            onClick={() => onToggle(key, !on, `section-${title.toLowerCase().replace(/\s+/g, '-')}`)}
            style={{
              display:'flex', alignItems:'center', justifyContent:'center',
              height:28, padding:0, cursor:'pointer', borderRadius:4,
              // The lit state is the accent as a *fill under* the mark, which is
              // the one place the deeper accent is not needed: this is a 22 px
              // glyph and not a 10 px label.
              background: on ? 'rgba(59,130,246,0.16)' : SURF,
              border: `1px solid ${on ? ACCENT_DEEP : BORDER}`,
              color: on ? DIM : MUTED,
              opacity: on ? 1 : 0.62,
            }}
          >
            <ModeMark kind={MARK_FOR[id]} />
          </button>
        )
      })}
    </div>
  )
}
