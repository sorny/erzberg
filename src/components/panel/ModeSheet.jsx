/**
 * The forty-one draw modes as a sheet, and the way into one of them.
 *
 * This is `ModeIndex` grown into the whole Marks pane. The index was a 6×6 grid
 * of bare glyphs inside a section, under forty-one headers that were the real
 * way in; the sheet is the way in, and the headers are behind it. Marks goes
 * from about 1 500 px of scroll to one screen.
 *
 * ── What this is not, still ──────────────────────────────────────────────────
 * It is not a layer stack. Nothing reorders, nothing is dragged, and no mode
 * becomes a record in a store. A tile reads `style.enabled<Id>` and writes
 * `style.enabled<Id>`. That distinction is why the index could exist at all
 * after the stack was built twice and reverted twice, and the sheet inherits it
 * unchanged.
 *
 * ── A pip and a card ─────────────────────────────────────────────────────────
 * "Is this mark drawing?" and "what is it set to?" are different questions, and
 * a tile has to answer both. The first build stacked two plain buttons — the
 * glyph switched the mark on, the name opened it — and they looked identical.
 * People found the second target by accident, which is not finding it.
 *
 * The fix is shape, not labels:
 *
 *   • The **pip** switches the mark on. A 9 px ring that fills green when lit,
 *     in a 20 px target in the corner. It is the shape every switch in this
 *     panel already has, and it is the only thing on the tile that has it.
 *   • The **card** — the glyph, the name, the space around them — opens the
 *     mark. It carries a chevron, and a chevron means it goes somewhere.
 *
 * The card is about forty-five times the area of the pip, which puts the size
 * where the traffic is: tuning a mark is the frequent act, and switching one on
 * is the deliberate one. Hover separates them again — the card lifts as one
 * piece and the pip lights its own target inside it.
 *
 * The pip does the work the name row's green dot used to do, so there is one
 * lit thing on a tile rather than two.
 *
 * ── Why three columns ────────────────────────────────────────────────────────
 * The index ran six across because it carried no words. Names are the point
 * here — `Reticulation`, `Isophotes` and `Bitplane` tell a newcomer nothing, and
 * a glyph beside the word teaches what neither does alone — and a name needs
 * about 80 px to survive. Three columns of 80 px is twelve rows; four columns of
 * 59 px is nine rows and clips over half the names. The shorter pane is not
 * worth a sheet you cannot read.
 */
import { DRAW_MODES } from '../../utils/drawModes'
import { ModeMark } from './modeMarks'
import { PANEL_MODES } from './sectionSummary'
import { FAMILIES } from './markFamilies'
import { ACCENT_DEEP, ACCENT_TEXT, BORDER, DIM, GREEN, MONO, MUTED, SURF, TEXT } from './ui'

/** id → the glyph that shows what it draws. One lookup, built once. */
const MARK_FOR = Object.fromEntries(DRAW_MODES.map((m) => [m.id, m.mark]))

/** `Mode: Stipple Dots` → `Stipple Dots`. The tile needs the half that names the mark. */
const markName = (title) => title.replace(/^Mode:\s*/, '')

/** `Contours` → its `PANEL_MODES` row. One lookup, built once. */
const ROW_BY_NAME = new Map(PANEL_MODES.map((row) => [markName(row[0]), row]))

/**
 * The sheet.
 *
 * `PANEL_MODES` rather than `DRAW_MODES`: the two hold the same forty-one in
 * different orders, and the tile under the cursor has to be the section the name
 * opens. `DRAW_MODES` is in pipeline order, which is the order the geometry is
 * built in and not the order the panel lists.
 *
 * @param {object}   props
 * @param {object}   props.style     the live style params
 * @param {Function} props.onToggle  (enabledKey, next) => void
 * @param {Function} props.onOpen    (sectionTitle) => void
 */
export function ModeSheet({ style, onToggle, onOpen }) {
  return (
    <>
    <div data-testid="mode-sheet">
    {FAMILIES.map(([family, gloss, names]) => (
      <div key={family}>
        {/* A heading over its own marks, with the count that says how big the
            idea is. `title` carries the gloss, because a 272 px pane has room
            for the name and not for the sentence. */}
        <div data-testid={`family-${family.toLowerCase()}`} title={gloss} style={{
          display:'flex', alignItems:'baseline', gap:8,
          margin:'12px 0 6px', paddingBottom:3, borderBottom:`1px solid ${BORDER}`,
        }}>
          <span style={{ fontSize:11.5, fontWeight:600, color: DIM }}>{family}</span>
          <span style={{ flex:1 }} />
          <span style={{ fontSize:10, color: MUTED, fontFamily: MONO, fontVariantNumeric:'tabular-nums' }}>
            {names.length}
          </span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:4 }}>
      {names.map((name) => {
        // `name` is already the display name — the family lists carry it, and
        // `ROW_BY_NAME` turns it back into the section title and the boolean.
        const [title, key] = ROW_BY_NAME.get(name)
        const id = key.slice('enabled'.length)
        const on = !!style[key]
        return (
          /*
           * A group, not a button. A button inside a button is invalid markup
           * that browsers resolve by dropping one of them — the same reason the
           * section header's reset mark is a sibling of the header rather than a
           * child of it.
           *
           * The pip is a sibling of the card and is painted over it, so the two
           * targets nest visually without nesting in the markup.
           */
          <div key={key} role="group" aria-label={name} className="hmcard" style={{
            position:'relative', borderRadius:6,
            background: on ? 'color-mix(in srgb, var(--hm-accent) 16%, transparent)' : SURF,
            border:`1px solid ${on ? ACCENT_DEEP : BORDER}`,
          }}>
            <button
              type="button"
              className="hmcardhit"
              aria-label={`Open ${name}`}
              title={`${name} — open its controls`}
              data-testid={`mode-open-${id}`}
              onClick={() => onOpen(title)}>
              <span style={{
                display:'flex', alignItems:'center', justifyContent:'center',
                height:28, color: on ? DIM : MUTED, opacity: on ? 1 : 0.62,
              }}>
                <ModeMark kind={MARK_FOR[id]} />
              </span>
              <span style={{
                display:'flex', alignItems:'center', gap:1,
                padding:'3px 2px 4px 5px', borderTop:`1px solid ${BORDER}`,
                fontSize:9, letterSpacing:0,
                color: on ? DIM : MUTED, minWidth:0, fontWeight: on ? 600 : 500,
              }}>
                <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {name}
                </span>
                {/* The chevron is what says the card goes somewhere. It is the
                    only thing the first build was missing, and it is why the
                    second target was invisible. */}
                <span aria-hidden="true" className="hmchev"
                  style={{ flexShrink:0, fontSize:9, lineHeight:1, color: MUTED }}>›</span>
              </span>
            </button>
            {/*
              * The switch. Over the card's top-left corner, so it takes a 20 px
              * target out of a 28 px glyph row and costs the tile no height.
              *
              * It writes the same `enabled<Id>` the section's own switch writes,
              * which is the whole reason this sheet is not a layer stack: one
              * boolean, two views of it, nothing to keep in step.
              */}
            <button
              type="button"
              className="hmpip"
              aria-pressed={on}
              aria-label={`${name} — ${on ? 'switch off' : 'switch on'}`}
              title={`${name} — ${on ? 'drawing, click to switch off' : 'off, click to switch on'}`}
              data-testid={`mode-tile-${id}`}
              onClick={() => onToggle(key, !on)}
              style={{
                position:'absolute', left:0, top:0, width:20, height:20, zIndex:1,
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
              <span aria-hidden="true" className="hmpipdot" style={{
                width:9, height:9, borderRadius:'50%',
                border:`1.5px solid ${on ? GREEN : MUTED}`,
                background: on ? GREEN : 'transparent',
                boxShadow: on ? '0 0 6px var(--hm-green-glow)' : 'none',
              }} />
            </button>
          </div>
        )
      })}
        </div>
      </div>
    ))}
    </div>
    {/*
      * One line, because a tile with two targets has to say so once.
      *
      * The shapes carry it after the first read — a pip looks like a switch and
      * a chevron points somewhere — but nothing on screen taught it, and that
      * is exactly how the first build went wrong. It sits under the sheet
      * rather than over it: this is a caption for what you just looked at, and
      * a panel that explains itself before you have seen anything is a panel
      * that explains itself to people who are not reading yet.
      */}
    <div data-testid="mode-sheet-hint" style={{
      marginTop:8, fontSize:9.5, color: MUTED, lineHeight:1.5,
      paddingLeft:6, borderLeft:`2px solid ${BORDER}`,
    }}>
      The pip switches a mark on. The rest of the tile opens its settings.
    </div>
    </>
  )
}

/**
 * The way back out of a drilled-in mode.
 *
 * A back bar rather than a breadcrumb: there is exactly one level to come back
 * from, and a trail of one is furniture. It carries the mode's own name because
 * the section under it is the only thing on screen, and a pane with one header
 * on it should still say what pane it is.
 *
 * @param {object}   props
 * @param {string}   props.title   the drilled-in section's title
 * @param {Function} props.onBack  () => void
 */
export function ModeBack({ title, onBack }) {
  return (
    <button type="button" data-testid="mode-back" onClick={onBack}
      aria-label="Back to all draw modes"
      style={{
        display:'flex', alignItems:'center', gap:7, width:'100%',
        padding:'9px 12px', border:'none', borderBottom:`1px solid ${BORDER}`,
        background: SURF, color: DIM, cursor:'pointer', fontFamily:'inherit',
        fontSize:11.5, fontWeight:500,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = TEXT }}
      onMouseLeave={(e) => { e.currentTarget.style.color = DIM }}>
      <span aria-hidden="true" style={{ fontSize:13, lineHeight:1, color: ACCENT_TEXT }}>‹</span>
      <span>All 41 marks</span>
      <span style={{ flex:1 }} />
      {/* Capped and ellipsised, so the longest mark name cannot push "All 41
          marks" off the bar. The full name comes back on hover, the way a
          truncated readout on a section header does. */}
      <span title={markName(title)} style={{
        fontSize:11, color: MUTED,
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:120,
      }}>{markName(title)}</span>
    </button>
  )
}
