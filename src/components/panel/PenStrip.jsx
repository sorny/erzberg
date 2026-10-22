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
import { MAX_SWATCHES } from '../../utils/pens'
import { BORDER, DIM, MONO, MUTED, Tog } from './ui'

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

export function PenStrip({ pens, inksAsPicked, onInksAsPicked }) {
  const { rows, layers, exact, hidden } = pens
  return (
    <div data-testid="pen-strip" style={{ marginTop:8 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:4 }}>
        <span style={{ fontSize:11, color: DIM, fontWeight:600, flex:1 }}>Pen layers</span>
        <span data-testid="pen-strip-count" style={{ fontSize:10, color: MUTED, fontFamily: MONO, fontVariantNumeric:'tabular-nums' }}
          title={exact ? undefined : 'An area the frame cuts away, or a hidden pass, changes the count. Preflight counts it exactly.'}>
          {exact ? layers : `up to ${layers}${hidden ? ' + hidden' : ''}`}
        </span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize:11, color: MUTED }}>No mark is drawing, so the file holds no pen layer.</div>
      ) : (
        <ul data-testid="pen-strip-rows" style={{
          listStyle:'none', margin:0, padding:0,
          // Land cover and Landforms bring a layer per ink; past eight rows the
          // list scrolls instead of pushing the other files off the screen.
          maxHeight: 8 * 20, overflowY:'auto',
        }}>
          {rows.map((row) => (
            <li key={row.id} data-pen-kind={row.kind} style={{ display:'flex', alignItems:'center', gap:6, height:20 }}>
              <span style={{ display:'flex', gap:2, flexShrink:0 }}>
                <Swatches row={row} />
              </span>
              <span title={row.name} style={{ fontSize:11, color: DIM, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {row.name}
              </span>
              <span title={row.kind === 'mixed' ? 'One layer in many colours: one pen cannot draw it as the screen shows it. Line colour gives the mode one ink.' : undefined}
                style={{ fontSize:10, color: MUTED, fontFamily: MONO, fontVariantNumeric:'tabular-nums', flexShrink:0 }}>
                {readoutOf(row)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {hidden && rows.length > 0 && (
        <div style={{ fontSize:11, color: MUTED, marginTop:2 }}>
          Plus a hidden layer for each mark whose lines pass behind the ground.
        </div>
      )}
      {/* The same switch as in Surface › Terrain Style, mirrored: it changes
          every ink in the file, so it belongs where the file is made as well. */}
      <div style={{ marginTop:4 }}>
        <Tog label="Inks as picked" testId="export-inks-as-picked"
          help="Writes every ink exactly as you picked it, as its swatch shows it. Off, inks are written as the viewport shows them, through its filmic tone curve, lighter and softer. The same switch as in Surface › Terrain Style."
          checked={!!inksAsPicked} onChange={onInksAsPicked} />
      </div>
    </div>
  )
}
