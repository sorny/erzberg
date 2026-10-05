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
import { ALL_FORMS, LANDFORMS, formMaskHas, formReadout } from '../../utils/landforms'
import { colourOptions } from './colourSource'
import { GradientPicker } from '../GradientPicker'
import { ACCENT_DEEP, BORDER, Btn, ColorRow, DIM, Heading, InlineSl, MUTED, Note, SegGroup, Sub, Tog } from './ui'

/**
 * One row of the Masks block: a name with where it comes from, what it keeps
 * on the right, and the chips. Three rows share it, so the three kinds of mask
 * read as three of one thing.
 */
function MaskRow({ title, source, readout, active, testId, children, onAll }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: DIM, whiteSpace: 'nowrap' }}>
          {title}{source && <span style={{ fontSize: 10, color: MUTED }}> · {source}</span>}
        </span>
        <span data-testid={testId} title={readout} style={{ flex: 1, fontSize: 10, color: active ? ACCENT_DEEP : MUTED,
          textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{readout}</span>
        {active && (
          <Btn size="xs" onClick={onAll} style={{ padding: '0 6px', fontSize: 10, flexShrink: 0 }}>All</Btn>
        )}
      </div>
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {children}
      </div>
    </div>
  )
}

/** A mask chip: a swatch that is drawn or skipped. */
const chipStyle = (color, on) => ({
  width: 22, height: 20, borderRadius: 3, padding: 0, cursor: 'pointer',
  background: color, opacity: on ? 1 : 0.25,
  border: `1px solid ${on ? ACCENT_DEEP : BORDER}`,
})

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
    <MaskRow title="Land cover" source="plate" readout={describeMask(mask, classes)}
      active={mask !== ALL_CLASSES} onAll={() => ss({ [key]: ALL_CLASSES })}>
      {classes.map((c) => {
        const on = maskHasClass(mask, c.index)
        return (
          <button key={c.index} type="button"
            title={`${c.name} · ${Math.round(c.share * 100)}%`}
            aria-label={`${c.name}, ${on ? 'drawn' : 'skipped'}`}
            aria-pressed={on}
            onClick={() => ss({ [key]: toggleClass(mask, c.index, classes.length) })}
            style={chipStyle(c.color, on)} />
        )
      })}
    </MaskRow>
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
    <MaskRow title="Painted" source="Mask Studio" readout={describeSelection(selection, masks)}
      active={selection !== NO_MASKS} onAll={() => ss({ [key]: NO_MASKS })}>
      {masks.map((m, i) => {
        const on = selectionHasMask(selection, i)
        return (
          <button key={m.id} type="button"
            title={m.name}
            aria-label={`${m.name}, ${on ? 'drawn' : 'skipped'}`}
            aria-pressed={on}
            onClick={() => ss({ [key]: toggleMaskSelection(selection, i) })}
            style={chipStyle(m.color, on)} />
        )
      })}
    </MaskRow>
  )
}

/**
 * Which landforms this layer marks: hachures only on ridges, contours only in
 * the valleys. The chips are the Landforms mode's own inks, so the row is also
 * its legend. Unlike the two rows above it, it needs no loaded data: every
 * raster has landforms. 0 is every landform.
 */
function FormMaskRow({ prefix, style, ss }) {
  const key = `formMask${prefix}`
  const mask = style[key] || 0
  const on = (k) => formMaskHas(mask, k)
  const toggle = (k) => {
    const next = (mask || ALL_FORMS) ^ (1 << k)
    ss({ [key]: next === ALL_FORMS ? 0 : next })
  }
  return (
    <MaskRow title="Landforms" testId={`form-mask-${prefix}`} readout={formReadout(mask)}
      active={mask !== 0} onAll={() => ss({ [key]: 0 })}>
      {LANDFORMS.map((f, k) => (
        <button key={f.id} type="button" title={f.name}
          data-testid={`form-chip-${prefix}-${f.id}`}
          aria-label={`${f.name}, ${on(k) ? 'drawn' : 'skipped'}`} aria-pressed={on(k)}
          onClick={() => toggle(k)}
          style={chipStyle(style[`color${'ABCDEFGHIJ'[k]}Landform`] ?? f.color, on(k))} />
      ))}
    </MaskRow>
  )
}

/**
 * Where a mode draws: three stencils in one block, apart from how it draws.
 *
 * They used to sit inside "Line style" between Dash and Colour, unnamed as
 * masks, so a row of coloured chips read as a palette. Here they are one block
 * with one sentence on what it does. A cell has to pass every row that is set.
 * A row whose data is not there yet says where it comes from instead of hiding.
 */
function MaskBlock({ prefix, style, ss }) {
  const cover = useContext(CoverPlate)
  const masks = useContext(PaintedMasks)
  const hasPlate = !!cover?.classes?.length, hasPainted = !!masks?.length
  const active = [
    hasPlate && (style[`coverMask${prefix}`] ?? ALL_CLASSES) !== ALL_CLASSES,
    hasPainted && (style[`layerMask${prefix}`] ?? NO_MASKS) !== NO_MASKS,
    prefix !== 'Landform' && !!style[`formMask${prefix}`],
  ].filter(Boolean).length
  const missing = [!hasPainted && 'painted masks (Terrain › Masks)', !hasPlate && 'land cover (Terrain › Land Cover)'].filter(Boolean)
  return (
    <div data-testid={`masks-${prefix}`} style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Heading style={{ margin: '0 0 2px' }}>Masks</Heading>
        <span style={{ fontSize: 10, color: active ? ACCENT_DEEP : MUTED }}>{active ? `${active} on` : 'none'}</span>
      </div>
      <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45, marginBottom: 8 }}>
        Draw this mode only where the ground passes every mask set here.
      </div>
      {prefix !== 'Landform' && <FormMaskRow prefix={prefix} style={style} ss={ss} />}
      <CoverMaskRow prefix={prefix} style={style} ss={ss} />
      <PaintedMaskRow prefix={prefix} style={style} ss={ss} />
      {missing.length > 0 && (
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45 }}>
          Also from {missing.join(' and ')}, once there is one.
        </div>
      )}
    </div>
  )
}

/** One stated fact about the loaded plate. Label left, value right. */


// `showCover` keys off the prefix rather than off `showHypso`: several draw
// modes switch hypsometric off because they ink from their own table, and every
// one of them is still a draw mode built from the terrain grid and so still
// maskable. The empty prefix is the vector-layer call, and only that one.
export function ModeStyleOverride({ prefix, style, ss, label = 'Line style', showDash = true, showHypso = true, showColor = true, showCover = prefix !== '', classSource = prefix !== '' && prefix !== 'Cover', gradientStops, setGradientStops }) {
  const isHypso = style[`hypso${prefix}`]
  const cover = useContext(CoverPlate)
  const hasPlate = !!cover?.classes?.length
  const source = isHypso ? style[`hypsoMode${prefix}`] : 'line'
  const ramp = source === 'elevation' || source === 'slope' || source === 'aspect' || source === 'speed'
  // A plain line colour is in play for Line, and for Form, Class and Plate,
  // which ink only where they know the ground and fall back to it elsewhere.
  // A gradient source never reads it, so it is not offered beside one.
  const usesBase = !showHypso || !ramp
  const fieldLabel = (text) => (
    <div style={{ fontSize: 11, color: MUTED, margin: '4px 0 4px' }}>{text}</div>
  )
  return (<>
    <div style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
      <Heading>{label}</Heading>
      {/* Colour first, because it decides what the rows under it mean: a
          gradient source has no base colour, and Line has no gradient. */}
      {showHypso && (<>
        {fieldLabel('Colour')}
        <SegGroup label="Colour" testIdOf={(v) => `colour-${prefix}-${v}`} columns={4}
          options={colourOptions({ prefix, current: source, classSource, hasPlate })}
          value={source}
          onChange={(m) => ss(m === 'line' ? { [`hypso${prefix}`]: false } : { [`hypso${prefix}`]: true, [`hypsoMode${prefix}`]: m })}
          style={{ marginBottom: 8 }} />
        {/* A source picked while a plate was open, now without one: say why the
            layer draws in its line colour. */}
        {(source === 'class' || source === 'plate') && !hasPlate && (
          <Note>No cover plate loaded, so this layer uses its line colour. Open one under Land Cover.</Note>
        )}
        {(source === 'class' || source === 'plate') && hasPlate && (
          <div style={{ fontSize: 10, color: DIM, marginBottom: 8 }}>One pen layer for each class.</div>
        )}
        {source === 'form' && (
          <div style={{ fontSize: 10, color: DIM, marginBottom: 8 }}>One pen layer for each landform, in the inks of the Landforms mode.</div>
        )}
        {ramp && (
          <Sub>
            <Tog label="Banded" small help="Steps the gradient into flat bands, as on a printed hypsometric map, rather than a smooth ramp." checked={style[`hypsoBanded${prefix}`]} onChange={v => ss({ [`hypsoBanded${prefix}`]: v })} />
            {style[`hypsoBanded${prefix}`] && <InlineSl label="Band interval" help="The width of one band, as a percentage of the gradient. 10 gives ten bands." min={0.5} max={50} value={style[`hypsoInterval${prefix}`]} onChange={v => ss({ [`hypsoInterval${prefix}`]: v })} />}
            {/* The gradient is global (shared by every gradient source and the
                fill), but it must be editable right where a source picks it —
                not hidden behind enabling fill in Terrain Style. */}
            {gradientStops && setGradientStops && (
              <div style={{ marginTop: 8 }}>
                <Heading>Gradient, shared by every layer that uses one</Heading>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4, marginBottom:8 }}>
                  {Object.keys(GRADIENT_PRESETS).map(name => <Btn key={name} size="xs" onClick={() => setGradientStops(GRADIENT_PRESETS[name])} style={{ padding:'2px 0' }}>{name}</Btn>)}
                </div>
                <GradientPicker stops={gradientStops} onChange={setGradientStops} />
              </div>
            )}
          </Sub>
        )}
      </>)}
      {/* A mode that inks every mark from its own table has no base colour to
          show: Riso's three separations each carry their own, and a swatch here
          would be a control that changes nothing. */}
      {showColor && usesBase && (
        <ColorRow label="Base colour" testId={`base-colour-${prefix || 'vector'}`}
          help="The pen colour. With Form, Class or Plate it is the colour where the ground has no landform or class."
          value={style[`color${prefix}`]} onChange={(v) => ss({ [`color${prefix}`]: v })} />
      )}
      <InlineSl label="Weight" help="Line width in screen pixels." min={0.5} max={10} step={0.5} value={style[`weight${prefix}`]} onChange={v => ss({ [`weight${prefix}`]: v })} />
      <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style[`opacity${prefix}`]} onChange={v => ss({ [`opacity${prefix}`]: v })} fmt={v => Math.round(v*100)+'%'} />
      {showDash && (<>
        {fieldLabel('Dash')}
        <SegGroup label="Dash" capitalize
          options={[['solid', 'solid'], ['dashed', 'dashed'], ['short', 'dotted'], ['long', 'long-dash'], ['dotted', 'dots']]}
          value={style[`dash${prefix}`]} onChange={(d) => ss({ [`dash${prefix}`]: d })} />
      </>)}
    </div>
    {/* Off the table for vector layers: masking thins the terrain grid a layer
        is built from, and a road is not built from that grid. */}
    {showCover && <MaskBlock prefix={prefix} style={style} ss={ss} />}
  </>)
}

// ── Main Sidebar component ────────────────────────────────────────────────────
