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
import { MAX_SWATCHES, penLine } from '../../utils/pens'
import { BORDER, Btn, DIM, MONO, MUTED, Tog, WARN } from './ui'

/** One ink, drawn as a chip. */
function Swatch({ hex }) {
  return (
    <span aria-hidden="true" style={{
      width:10, height:10, borderRadius:3, flexShrink:0, background:hex,
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
        width:22, height:10, borderRadius:3, flexShrink:0,
        background:`linear-gradient(90deg, ${row.inks.join(', ')})`,
        boxShadow:`inset 0 0 0 1px ${BORDER}`,
      }} />
    )
  }
  return row.inks.slice(0, MAX_SWATCHES).map((hex) => <Swatch key={hex} hex={hex} />)
}

/** What a row says on its right: the hex of one ink, or why there is no one hex. */
function readoutOf(row) {
  if (row.kind === 'areas') return `${row.count} ink${row.count === 1 ? '' : 's'}`
  if (row.kind === 'mixed') return 'mixed'
  return row.inks[0]
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

export function PenStrip({ pens, style, onInksAsPicked, onOneInk }) {
  const { rows } = pens
  const mixed = mixedMarks(rows, style)
  return (
    <div data-testid="pen-strip" style={{ marginTop:8 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:4 }}>
        <span style={{ fontSize:11, color: DIM, fontWeight:600, flexShrink:0 }}>Pens</span>
        <span data-testid="pen-strip-count" style={{ flex:1, textAlign:'right', fontSize:10, color: MUTED, fontFamily: MONO, fontVariantNumeric:'tabular-nums' }}>
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
            <li key={row.id} data-pen-kind={row.kind} aria-label={spokenOf(row)}
              style={{ display:'flex', alignItems:'center', gap:6, height:20 }}>
              <span style={{ display:'flex', gap:2, flexShrink:0 }}>
                <Swatches row={row} />
              </span>
              <span aria-hidden="true" title={row.name} style={{ fontSize:11, color: DIM, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {row.name}
              </span>
              <span aria-hidden="true" style={{ fontSize:10, color: MUTED, fontFamily: MONO, fontVariantNumeric:'tabular-nums', flexShrink:0 }}>
                {readoutOf(row)}
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
