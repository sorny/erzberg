/**
 * The style block every mark shares, and the vector layers borrow.
 *
 * Thirty-four mode sections render it, and so does each vector layer — the ink,
 * the dash, the hypsometric ramp and the class mask are the same questions
 * wherever a line is drawn. It lived in `Sidebar.jsx` because that is where its
 * first caller was; it is here because it has thirty-five.
 */
import { ALL_CLASSES, describeMask, maskHasClass, toggleClass } from '../../utils/coverPlate'
import { NO_MASKS, describeSelection, selectionHasMask, toggleMaskSelection } from '../../utils/maskLayers'
import { CoverPlate, PaintedMasks } from './filter'
import { useContext } from 'react'
import { GRADIENT_PRESETS } from '../../utils/gradientPresets'
import { GradientPicker } from '../GradientPicker'
import { ACCENT_DEEP, BORDER, Btn, DIM, InlineSl, MUTED, SURF, Sub, Tog } from './ui'

/**
 * Which land-cover classes this layer is allowed to mark.
 *
 * Absent entirely until a plate is loaded, rather than present and disabled: a
 * control that cannot do anything is worse than no control, and the Land Cover
 * section three rows up is where the app explains what a plate is.
 *
 * The swatches are the classes' own colours, taken from the imagery rather than
 * from a palette, so the row reads as the ground it stands for — which is the
 * only way to tell six unnamed classes apart at a glance.
 */
function CoverMaskRow({ prefix, style, ss }) {
  const cover = useContext(CoverPlate)
  if (!cover?.classes?.length) return null
  const key = `coverMask${prefix}`
  const mask = style[key] ?? ALL_CLASSES
  const classes = cover.classes

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: 1 }}>LAND COVER</span>
        <span style={{ fontSize: 10, color: mask === ALL_CLASSES ? DIM : ACCENT_DEEP }}>
          {describeMask(mask, classes)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {classes.map((c) => {
          const on = maskHasClass(mask, c.index)
          return (
            <button key={c.index} type="button"
              title={`${c.name} · ${Math.round(c.share * 100)}%`}
              aria-label={`${c.name}, ${on ? 'drawn' : 'skipped'}`}
              aria-pressed={on}
              onClick={() => ss({ [key]: toggleClass(mask, c.index, classes.length) })}
              style={{
                // The same chip as the legend in the Land Cover section, because
                // it stands for the same thing — 3 px, not the 2 px the dash row
                // beside it uses, which is a button rather than a swatch.
                width: 22, height: 20, borderRadius: 3, padding: 0, cursor: 'pointer',
                background: c.color,
                opacity: on ? 1 : 0.25,
                border: `1px solid ${on ? ACCENT_DEEP : BORDER}`,
              }} />
          )
        })}
        {mask !== ALL_CLASSES && (
          <Btn size="xs" onClick={() => ss({ [key]: ALL_CLASSES })}
            style={{ padding: '0 6px', fontSize: 10 }}>All</Btn>
        )}
      </div>
    </div>
  )
}

/**
 * The command that would cut a plate for what is on screen.
 *
 * The extent is already stated — in the loaded file, or in the bounding box a
 * fetch came back with — so asking the reader to type a place name back in is
 * asking them to restate something the app knows, and to get it slightly wrong.
 * A plate cut for ground a few hundred metres off still renders and still looks
 * deliberate, which is the failure this exists to avoid.
 *
 * Three cases, narrowing to the most precise one available:
 *
 *  · a georeferenced file on disk → `--dem`, which takes the extent *and* the
 *    projection from the file, so the plate comes back over exactly this
 *    ground;
 *  · georeferenced but not from a file the reader can name — a fetched
 *    terrain — → `--bbox`, in the lon/lat the flag wants;
 *  · no coordinates at all → the generic form, because there is nothing
 *    truthful to fill in.
 */

/**
 * Which hand-drawn masks this layer is restricted to.
 *
 * The same shape as the cover row above it and a separate control, because the
 * two stencils answer different questions and a layer may carry both: cover
 * says what the ground *is*, a mask says which part of the picture you meant.
 * A cell has to satisfy both to be marked.
 */
function PaintedMaskRow({ prefix, style, ss }) {
  const masks = useContext(PaintedMasks)
  if (!masks?.length) return null
  const key = `layerMask${prefix}`
  const selection = style[key] ?? NO_MASKS

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: 1 }}>MASKS</span>
        <span style={{ fontSize: 10, color: selection ? ACCENT_DEEP : DIM }}>
          {describeSelection(selection, masks)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {masks.map((m, i) => {
          const on = selectionHasMask(selection, i)
          return (
            <button key={m.id} type="button"
              title={m.name}
              aria-label={`${m.name}, ${on ? 'drawn' : 'skipped'}`}
              aria-pressed={on}
              onClick={() => ss({ [key]: toggleMaskSelection(selection, i) })}
              style={{
                width: 22, height: 20, borderRadius: 3, padding: 0, cursor: 'pointer',
                background: m.color,
                opacity: on ? 1 : 0.25,
                border: `1px solid ${on ? ACCENT_DEEP : BORDER}`,
              }} />
          )
        })}
        {selection !== NO_MASKS && (
          <Btn size="xs" onClick={() => ss({ [key]: NO_MASKS })}
            style={{ padding: '0 6px', fontSize: 10 }}>All</Btn>
        )}
      </div>
    </div>
  )
}

/** One stated fact about the loaded plate. Label left, value right. */


// `showCover` keys off the prefix rather than off `showHypso`: several draw
// modes switch hypsometric off because they ink from their own table, and every
// one of them is still a draw mode built from the terrain grid and so still
// maskable. The empty prefix is the vector-layer call, and only that one.
export function ModeStyleOverride({ prefix, style, ss, label = 'LINE STYLE', showDash = true, showHypso = true, showColor = true, showCover = prefix !== '', gradientStops, setGradientStops }) {
  const isHypso = style[`hypso${prefix}`]
  return (
    <div style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
      <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, marginBottom: 4, letterSpacing: 1 }}>{label}</div>
      {/* A mode that inks every mark from its own table has no base colour to
          show: Riso's three separations each carry their own, and a swatch here
          would be a control that changes nothing. */}
      {showColor && (
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: DIM }}>Base Color</span>
          <input type="color" className="hmc" value={style[`color${prefix}`]} onChange={e => ss({ [`color${prefix}`]: e.target.value })} />
        </div>
      )}
      <InlineSl label="Weight" min={0.5} max={10} step={0.5} value={style[`weight${prefix}`]} onChange={v => ss({ [`weight${prefix}`]: v })} />
      <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style[`opacity${prefix}`]} onChange={v => ss({ [`opacity${prefix}`]: v })} fmt={v => Math.round(v*100)+'%'} />

      {showDash && (
        <div style={{ marginTop: 8, display:'flex', gap:2 }}>
          {['solid', 'dashed', 'dotted', 'long-dash'].map(d => (
            <Btn key={d} block variant="toggle" on={style[`dash${prefix}`] === d}
              onClick={() => ss({ [`dash${prefix}`]: d })}
              style={{ fontSize:10, padding:'2px 0', borderRadius:2, textTransform:'uppercase' }}>
              {d.replace('-dash','')}</Btn>
          ))}
        </div>
      )}

      {/* Off the table for vector layers for a sharper version of the same
          reason hypsometric is: masking works by thinning the terrain grid the
          layer is built from, and a road is not built from that grid. */}
      {showCover && <CoverMaskRow prefix={prefix} style={style} ss={ss} />}
      {showCover && <PaintedMaskRow prefix={prefix} style={style} ss={ss} />}

      {/* Hypsometric is off the table for vector layers: a road has no elevation
          of its own, so the tint would have to read the ground under it, which
          is a different thing from what the draw modes mean by it. */}
      {showHypso && <div style={{ marginTop: 8 }}>
        <Tog label="Hypsometric" small checked={isHypso} onChange={v => ss({ [`hypso${prefix}`]: v })} />
        {isHypso && (
          <Sub>
            <div style={{ display:'flex', gap:2, marginBottom:4 }}>
              {['Elevation', 'Slope', 'Aspect', 'Speed'].map(m => (
                <button key={m} onClick={() => ss({ [`hypsoMode${prefix}`]: m.toLowerCase() })} 
                  style={{ 
                    flex:1, fontSize:10, padding:'2px 0', borderRadius:2, 
                    background: style[`hypsoMode${prefix}`] === m.toLowerCase() ? ACCENT_DEEP : SURF, 
                    color: style[`hypsoMode${prefix}`] === m.toLowerCase() ? '#fff' : MUTED, 
                    border:`1px solid ${style[`hypsoMode${prefix}`] === m.toLowerCase() ? ACCENT_DEEP : BORDER}` 
                  }}>{m}</button>
              ))}
            </div>
            <Tog label="Banded" small checked={style[`hypsoBanded${prefix}`]} onChange={v => ss({ [`hypsoBanded${prefix}`]: v })} />
            {style[`hypsoBanded${prefix}`] && <InlineSl label="Band Dist" min={0.5} max={50} value={style[`hypsoInterval${prefix}`]} onChange={v => ss({ [`hypsoInterval${prefix}`]: v })} />}
            {/* The gradient is global (shared by every hypsometric layer + fill),
                but it must be editable right where hypso is switched on — not
                hidden behind enabling fill in Terrain Style. */}
            {gradientStops && setGradientStops && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, marginBottom: 4, letterSpacing: 1 }}>GRADIENT · SHARED BY ALL HYPSO LAYERS</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4, marginBottom:8 }}>
                  {Object.keys(GRADIENT_PRESETS).map(name => <Btn key={name} size="xs" onClick={() => setGradientStops(GRADIENT_PRESETS[name])} style={{ padding:'2px 0' }}>{name}</Btn>)}
                </div>
                <GradientPicker stops={gradientStops} onChange={setGradientStops} />
              </div>
            )}
          </Sub>
        )}
      </div>}
    </div>
  )
}

// ── Main Sidebar component ────────────────────────────────────────────────────
