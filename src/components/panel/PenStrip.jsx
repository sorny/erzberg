/**
 * The pens, under the SVG button: one row per Inkscape layer the file will
 * hold, with its ink.
 *
 * The plot's two deciding facts — how many pens, and which colours — used to
 * appear only after Preflight, and the switch that changes every ink in the
 * file sat four stages away in Surface. Both are here now, where the file is
 * made. Read-only: an ink is changed in its own mode, and two marks in one
 * colour stay two layers, because the file writes two. The rows come from
 * `pensOf`, which reads the geometry the exporter is handed.
 */
import { MODE_LABEL } from '../../utils/drawModes'
import { MAX_SWATCHES, modeOf, penLine } from '../../utils/pens'
import { BORDER, Btn, DIM, MONO, MUTED, Tog, WARN } from './ui'

/** One ink, drawn as a chip. */
function Swatch({ hex }) {
  return (
    <span aria-hidden="true" style={{
      width:12, height:12, borderRadius:3, flexShrink:0, background:hex,
      boxShadow:`inset 0 0 0 1px ${BORDER}`,
    }} />
  )
}

/**
 * The chips a row draws. A mixed layer is one pen, so it is one chip, a ramp
 * through its inks — six chips side by side read as six pens. An area layer
 * is a pen per ink, so it gets a chip per ink.
 */
function Swatches({ row }) {
  if (row.kind === 'mixed') {
    return (
      <span aria-hidden="true" style={{
        width:24, height:12, borderRadius:3, flexShrink:0,
        background:`linear-gradient(90deg, ${row.inks.join(', ')})`,
        boxShadow:`inset 0 0 0 1px ${BORDER}`,
      }} />
    )
  }
  return row.inks.slice(0, MAX_SWATCHES).map((hex) => <Swatch key={hex} hex={hex} />)
}

/**
 * Each one-ink layer's ink, numbered in the order the list meets it. Layers in
 * one colour share a number, so "3 layers · 2 inks" can be read off the rows:
 * three black rows were three identical hex strings to compare by eye.
 */
function inkNumbers(rows) {
  const n = new Map()
  for (const r of rows) if (r.kind === 'line' && !n.has(r.inks[0])) n.set(r.inks[0], n.size + 1)
  return n
}

/** What a row says on its right: the ink of one-ink layer, or why there is no one ink. */
function readoutOf(row, inks) {
  if (row.kind === 'areas') return `${row.count} ink${row.count === 1 ? '' : 's'}`
  if (row.kind === 'mixed') return 'multicolour'
  return `ink ${inks.get(row.inks[0])} · ${row.inks[0]}`
}

/**
 * The row as a screen reader says it. The chips are drawn for the eye, so the
 * colours they carry are said here: "Crosshatch, ink #c0d5db".
 */
function spokenOf(row) {
  if (row.kind === 'areas') return `${row.name}, ${row.count} inks: ${row.inks.join(', ')}`
  if (row.kind === 'mixed') return `${row.name}, one layer in many colours`
  return `${row.name}, ink ${row.inks[0]}`
}

/**
 * The marks with a layer in many colours, once each. A copy's layer is named
 * but gets no button: its colour lives in the copy, under the mode.
 */
function mixedMarks(rows, style) {
  const out = new Map()
  for (const r of rows) {
    if (r.kind !== 'mixed') continue
    const m = out.get(r.mode) ?? { mode: r.mode, label: MODE_LABEL[r.mode] ?? r.mode, layers: 0, fixable: false }
    m.layers++
    if (!r.copy && style[`hypso${r.mode}`]) m.fixable = true
    out.set(r.mode, m)
  }
  return [...out.values()]
}

/** WCAG relative luminance of a `#rrggbb`, for the paper check below. */
function luminance(hex) {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')?.[1]
  if (!v) return null
  const c = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/**
 * The one-ink layers whose ink is close to the paper, by contrast ratio. A pale
 * pen on cream paper is a plot that looks blank, and the hex alone did not say so.
 */
function faintOnPaper(rows, paper) {
  const lp = luminance(paper)
  if (lp == null) return []
  return rows.filter((r) => {
    if (r.kind !== 'line') return false
    const li = luminance(r.inks[0])
    if (li == null) return false
    const [a, b] = li > lp ? [li, lp] : [lp, li]
    // 2:1 and under reads as faint on paper; #c2b2a3 on #f4f1ea is 1.8.
    return (a + 0.05) / (b + 0.05) < 2
  })
}

export function PenStrip({ pens, style, onInksAsPicked, onOneInk, onOpenMark }) {
  const { rows } = pens
  const mixed = mixedMarks(rows, style)
  // Against the base colour, gradient or not: a gradient starts from it.
  const faint = faintOnPaper(rows, style.bgColor)
  const inks = inkNumbers(rows)
  return (
    <div data-testid="pen-strip" style={{ marginTop:8 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:4 }}>
        <span style={{ fontSize:11, color: DIM, fontWeight:600, flexShrink:0 }}>Pens</span>
        <span data-testid="pen-strip-count" style={{ flex:1, textAlign:'right', fontSize:11, color: MUTED, fontFamily: MONO, fontVariantNumeric:'tabular-nums' }}>
          {penLine(pens)}
        </span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize:11, color: MUTED }}>No mark is drawing, so the file holds no pen layer.</div>
      ) : (
        <ul data-testid="pen-strip-rows" aria-label="Pen layers in the SVG" style={{
          listStyle:'none', margin:0, padding:0,
          // Land cover and Landforms bring a layer per ink; past eight rows the
          // list scrolls instead of pushing the other files off the screen.
          maxHeight: 8 * 20, overflowY:'auto',
        }}>
          {rows.map((row) => (
            <li key={row.id} data-pen-kind={row.kind} aria-label={row.kind === "line" ? `${row.name}, ink ${inks.get(row.inks[0])}, ${row.inks[0]}` : spokenOf(row)}
              style={{ display:'flex', alignItems:'center', gap:6, height:20 }}
              title={row.kind === 'line' ? `Ink ${inks.get(row.inks[0])} · ${row.inks[0]}` : undefined}>
              <span style={{ display:'flex', gap:2, flexShrink:0 }}>
                <Swatches row={row} />
              </span>
              <span aria-hidden="true" title={row.name} style={{ fontSize:11, color: DIM, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {row.name}
              </span>
              <span aria-hidden="true" style={{ fontSize:10, color: MUTED, fontFamily: MONO, fontVariantNumeric:'tabular-nums', flexShrink:0 }}>
                {readoutOf(row, inks)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* Said, not hovered. A layer in many colours is the one way the opening
          plate fails a plotter, and its only warning was a tooltip on "mixed". */}
      {mixed.map((m) => (
        <div key={m.mode} data-testid={`pen-mixed-${m.mode}`} role="note" style={{
          display:'flex', alignItems:'center', gap:8, marginTop:4,
          fontSize:11, color: WARN, lineHeight:1.4,
        }}>
          <span style={{ flex:1 }}>
            {m.layers === 1
              ? `${m.label} is one layer in many colours. One pen cannot draw it.`
              : `${m.label} has ${m.layers} layers in many colours. One pen cannot draw them.`}
          </span>
          {m.fixable && (
            <Btn size="xs" data-testid={`pen-one-ink-${m.mode}`} onClick={() => onOneInk(m.mode)}
              title={`Set ${m.label} › Colour to Line, so it draws in one ink`}
              style={{ flexShrink:0, color: WARN, borderColor: WARN }}>One ink</Btn>
          )}
        </div>
      ))}
      {/* A note, not a warning: a pale ink on tinted paper can be the look
          (First Light draws its flow lines that way). It says what the sheet
          will show, and each name opens the mark where its colour is set. */}
      {faint.length > 0 && (
        <div data-testid="pen-faint" role="note" style={{ marginTop:4, fontSize:11, color: MUTED, lineHeight:1.5 }}>
          {faint.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ', '}
              {onOpenMark && !modeOf(r.id).copy ? (
                <button type="button" data-testid={`pen-faint-open-${modeOf(r.id).mode}`} onClick={() => onOpenMark(modeOf(r.id).mode)}
                  style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontFamily:'inherit', fontSize:11,
                    color: DIM, textDecoration:'underline', textUnderlineOffset:3, textDecorationColor: MUTED }}>{r.name}</button>
              ) : r.name}
            </span>
          ))}
          {` ${faint.length === 1 ? 'is' : 'are'} close to the paper colour and will plot faint.`}
        </div>
      )}
      {pens.hidden && rows.length > 0 && (
        <div style={{ fontSize:11, color: MUTED, marginTop:2 }}>
          Plus a hidden layer for each mark whose lines pass behind the ground.
        </div>
      )}
      {/* The same switch as in Surface › Terrain Style, mirrored: it changes
          every ink in the file, so it belongs where the file is made as well.
          Its label says so, so nobody wonders which of the two wins. */}
      <div style={{ marginTop:4 }}>
        <Tog label="Inks as picked" testId="export-inks-as-picked"
          help="Writes every ink exactly as you picked it, as its swatch shows it. Off, inks are written as the viewport shows them, through its filmic tone curve, lighter and softer. This is the same switch as Surface › Terrain Style › Inks as picked: changing one changes both."
          checked={!!style.inksAsPicked} onChange={onInksAsPicked} />
        <div style={{ fontSize:11, color: MUTED, marginTop:-2 }}>The same switch as in Surface › Terrain Style.</div>
      </div>
    </div>
  )
}
