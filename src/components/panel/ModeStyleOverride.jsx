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
import { DRAW_MODES } from '../../utils/drawModes'
import { colourOptions } from './colourSource'
import { GradientPicker } from '../GradientPicker'
import { ACCENT_DEEP, ACCENT_TEXT, BORDER, Btn, ColorRow, DIM, Fold, InlineSl, MUTED, Note, SegGroup, Sub, Tog } from './ui'

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
        <span data-testid={testId} title={readout} style={{ flex: 1, fontSize: 10, color: active ? ACCENT_TEXT : MUTED,
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
/**
 * The plumb lines' own style, under the switch that turns them on. Ink, weight
 * and opacity are resolved render-side; the rest is geometry (builders/lift.js).
 */
function PlumbStyle({ prefix, style, ss, plumb }) {
  const k = (name) => `${name}${prefix}`
  const own = !!style[k('plumbColor')]
  const pct = (v) => (v > 0 ? `${v.toFixed(1)}%` : 'off')
  return (
    <Sub>
      <ColorRow label="Ink" testId={`plumb-colour-${prefix}`}
        help="The pen colour of the plumb lines and the footprint. Until you set one, they use the mode's base colour."
        value={style[k('plumbColor')] || style[k('color')] || '#1a1a1a'} onChange={(v) => ss({ [k('plumbColor')]: v })} />
      {own && (
        <Btn size="xs" data-testid={`plumb-colour-reset-${prefix}`} onClick={() => ss({ [k('plumbColor')]: '' })} style={{ marginTop: -4, marginBottom: 8 }}>
          Use base colour
        </Btn>
      )}
      <InlineSl label="Weight" testId={`plumb-weight-${prefix}`} help="Line width of the plumb lines and the footprint, as a share of the mode's own weight."
        min={0.1} max={2} step={0.05} value={style[k('plumbWeight')]} onChange={(v) => ss({ [k('plumbWeight')]: v })}
        fmt={(v) => `${v.toFixed(2)} × line`} />
      <InlineSl label="Opacity" testId={`plumb-opacity-${prefix}`} help="Opacity, as a share of the mode's own opacity."
        min={0} max={1} step={0.01} value={style[k('plumbOpacity')]} onChange={(v) => ss({ [k('plumbOpacity')]: v })}
        fmt={(v) => `${Math.round(v * 100)}%`} />
      {plumb && (<>
      <InlineSl label="Dash" testId={`plumb-dash-${prefix}`} help="The length of one dash, in percent of the terrain's relief. The app stretches dashes a little, so each line starts and ends on a dash."
        min={0.5} max={20} step={0.5} value={style[k('plumbDash')]} onChange={(v) => ss({ [k('plumbDash')]: v })} fmt={pct} />
      <InlineSl label="Gap" testId={`plumb-gap-${prefix}`} help="The space between dashes, in percent of the terrain's relief. At 0 the line is solid."
        min={0} max={20} step={0.5} value={style[k('plumbGap')]} onChange={(v) => ss({ [k('plumbGap')]: v })} fmt={(v) => (v > 0 ? `${v.toFixed(1)}%` : 'solid')} />
      <SegGroup label="Marker" testIdOf={(v) => `plumb-mark-${prefix}-${v}`}
        options={[['Ring', 'ring'], ['X', 'cross']]}
        value={style[k('plumbMark')]} onChange={(v) => ss({ [k('plumbMark')]: v })} style={{ marginBottom: 8 }} />
      <InlineSl label="Marker size" testId={`plumb-size-${prefix}`} help="The marker's radius, in percent of the plate's larger half width. At 0 there is no marker."
        min={0} max={3} step={0.05} value={style[k('plumbSize')]} onChange={(v) => ss({ [k('plumbSize')]: v })} fmt={pct} />
      <SegGroup label="Marker ends" testIdOf={(v) => `plumb-ends-${prefix}-${v}`}
        options={[['Both', 'both'], ['Ground', 'ground'], ['Top', 'top']]}
        value={style[k('plumbEnds')]} onChange={(v) => ss({ [k('plumbEnds')]: v })} style={{ marginBottom: 8 }} />
      <SegGroup label="Points" testIdOf={(v) => `plumb-points-${prefix}-${v}`}
        options={[['Summit + edges', 'all'], ['Summit', 'summit'], ['Fence', 'edge']]}
        value={style[k('plumbPoints')]} onChange={(v) => ss({ [k('plumbPoints')]: v })} style={{ marginBottom: 8 }} />
      {style[k('plumbPoints')] === 'edge' && (
        <InlineSl label="Spacing" testId={`plumb-spacing-${prefix}`} help="Fence sets plumb lines along each region's outline. This is the distance between two of them, in grid cells. A region gets at most 400."
          min={2} max={60} step={1} value={style[k('plumbSpacing')] ?? 12} onChange={(v) => ss({ [k('plumbSpacing')]: v })} fmt={(v) => `${Math.round(v)} cells`} />
      )}
      </>)}
    </Sub>
  )
}

function MaskBlock({ prefix, style, ss }) {
  const cover = useContext(CoverPlate)
  const masks = useContext(PaintedMasks)
  const hasPlate = !!cover?.classes?.length, hasPainted = !!masks?.length
  const active = [
    hasPlate && (style[`coverMask${prefix}`] ?? ALL_CLASSES) !== ALL_CLASSES,
    hasPainted && (style[`layerMask${prefix}`] ?? NO_MASKS) !== NO_MASKS,
    prefix !== 'Landform' && !!style[`formMask${prefix}`],
  ].filter(Boolean).length
  const missing = [!hasPainted && 'painted masks (Terrain › Masks)', !hasPlate && 'land cover (Terrain › Land Cover Data)'].filter(Boolean)
  const zOffset = Number(style[`zOffset${prefix}`]) || 0
  const readout = [active && `${active} on`, zOffset > 0 && 'raised'].filter(Boolean).join(' · ') || 'none'
  return (
    <Fold testId={`masks-${prefix}`} title="Masks" readout={readout} active={!!active || zOffset > 0}>
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
      <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 8, paddingTop: 8 }}>
        <InlineSl label="Z offset" testId={`z-offset-${prefix}`}
          help="Raises this mode's marks above the ground by this many times the terrain's relief, as an exploded view. Set a mask above to raise one region. To stack regions, give each copy of the mode its own mask and Z offset."
          min={0} max={5} step={0.05} value={zOffset} onChange={(v) => ss({ [`zOffset${prefix}`]: v })}
          fmt={(v) => (v > 0 ? `${v.toFixed(2)} × relief` : 'off')} />
        {zOffset > 0 && (<>
          <SegGroup label="Stack" testIdOf={(v) => `z-stack-${prefix}-${v}`}
            options={[['Off', 'off'], ['By landform', 'form']]}
            value={style[`zStack${prefix}`] ?? 'off'} onChange={(v) => ss({ [`zStack${prefix}`]: v })} style={{ marginBottom: 4 }} />
          <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45, marginBottom: 8 }}>
            {style[`zStack${prefix}`] === 'form'
              ? 'Each landform floats at its own tier: pit lowest, then valley, footslope and hollow, flat and slope, spur and shoulder, ridge, and peak highest. Z offset is the step between tiers.'
              : 'By landform floats each landform at its own tier, Z offset apart.'}
          </div>
          <SegGroup label="Footprint" testIdOf={(v) => `footprint-${prefix}-${v}`}
            options={[['No footprint', 'off'], ['Solid', 'solid'], ['Dashed', 'dashed']]}
            value={style[`footprint${prefix}`] ?? 'off'} onChange={(v) => ss({ [`footprint${prefix}`]: v })} style={{ marginBottom: 8 }} />
        </>)}
        {zOffset > 0 && (
          <Tog label="Plumb lines" testId={`plumb-${prefix}`}
            help="Dashed verticals from the raised marks down to the ground, with a ring or an X at their ends. Each masked region gets them at its highest point and its four outermost points, at its highest point only, or as a fence along its outline (Points). The dashes are lines, so a plotter draws them dashed. They go to their own pen layer."
            checked={!!style[`plumb${prefix}`]} onChange={(v) => ss({ [`plumb${prefix}`]: v })} />
        )}
        {zOffset > 0 && (style[`plumb${prefix}`] || (style[`footprint${prefix}`] ?? 'off') !== 'off') && (
          <PlumbStyle prefix={prefix} style={style} ss={ss} plumb={!!style[`plumb${prefix}`]} />
        )}
      </div>
    </Fold>
  )
}

/**
 * What hides this mode, and what it hides: the per-mode half of occlusion.
 *
 * *Halo* works under both models: lines farther away break around this mode's
 * strokes, the haloed-line effect of Appel, Rohlf and Stein (1979). *Occluder*
 * belongs to the classic model (*Occluder: Lines*), where a mode hangs walls
 * under its strokes, and to a solid mode under both; under the Ground model the
 * terrain does the hiding and there is nothing else to choose.
 */
function OcclusionBlock({ prefix, style, ss }) {
  const on = !!style.depthOcclusion
  const classic = style.occludeBy !== 'ground'
  // A solid mode's walls are its bodies' sides, so it has them under both models.
  const solid = !!DRAW_MODES.find((m) => m.id === prefix)?.solid
  const hasWalls = classic || solid
  const halo = style[`halo${prefix}`] ?? 0
  const walls = style[`walls${prefix}`] !== false
  const readout = !on ? 'off' : [hasWalls && walls && 'occluder', halo > 0 && `halo ${halo} px`].filter(Boolean).join(' · ') || 'none'
  return (
    <Fold testId={`occlusion-${prefix}`} title="Occlusion" readout={readout} active={on && readout !== 'none'}>
      {!on ? (
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45 }}>
          Occlusion is off in Surface › Terrain Style.
        </div>
      ) : (<>
        {hasWalls && (
          <Tog label="Occluder" testId={`walls-${prefix}`}
            help={solid
              ? "The columns get solid sides, so each one hides the lines and columns behind it. This applies with either occluder in Surface › Terrain Style, because the ground cannot stand in for a column."
              : "Each stroke hangs an invisible wall down to the base, so the lines behind it are hidden: the classic ridgeline look. Off by default for marks such as hachures and ticks, whose walls would cut notches into the lines behind them. Used when the occluder in Surface › Terrain Style is Lines."}
            checked={walls} onChange={(v) => ss({ [`walls${prefix}`]: v })} />
        )}
        <InlineSl label="Halo" testId={`halo-${prefix}`}
          help="Lines farther away break where they pass behind this mode's strokes, by this many pixels, as on an engraved map. Lines on the same patch of ground never break. 0 is off."
          min={0} max={6} step={0.5} value={halo} onChange={(v) => ss({ [`halo${prefix}`]: v })}
          fmt={(v) => (v > 0 ? `${v} px` : 'off')} />
      </>)}
    </Fold>
  )
}

/**
 * The landforms, where a mode picks Form as its colour.
 *
 * The inks and the classification are the Landforms mode's own keys, so a mode
 * inked by landform and the Landforms mode itself always agree, and every
 * layer shares one pen per landform. They used to be set only in Mode:
 * Landforms, which locks its controls while it is off, so Form colour could
 * not be changed without drawing a second mode.
 */
function FormInks({ prefix, style, ss }) {
  return (<>
    <div style={{ fontSize: 10, color: DIM, marginBottom: 8 }}>One pen layer for each landform.</div>
    <Fold title="Landforms" readout="shared" testId={prefix ? `form-inks-${prefix}` : undefined}>
      <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45, marginBottom: 6 }}>
        Shared by every layer that uses them, and by Mode: Landforms.
      </div>
      <InlineSl label="Search" testId={prefix ? `form-search-${prefix}` : undefined}
        help="How far each cell looks along the eight compass lines, in metres. Short finds every spur on a slope; long finds the ridge the spurs belong to."
        min={30} max={3000} step={10} log value={style.searchLandform} onChange={v => ss({ searchLandform: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
      <InlineSl label="Flat below"
        help="A line that rises or falls less steeply than this counts as level. Raise it and gentle ground becomes flat; lower it and every swell becomes a shape."
        min={0} max={10} step={0.1} value={style.flatLandform} onChange={v => ss({ flatLandform: v })} fmt={v => `${v.toFixed(1)}°`} />
      <InlineSl label="Blur"
        help="Blur on the heights before they are classified. At 0 every grain in the data becomes its own small peak or pit."
        min={0} max={12} step={1} value={style.radiusLandform ?? 2} onChange={v => ss({ radiusLandform: Math.round(v) })} />
      {LANDFORMS.map((f, k) => {
        const key = `color${'ABCDEFGHIJ'[k]}Landform`
        return <ColorRow key={f.id} label={f.name} testId={prefix ? `form-ink-${prefix}-${f.id}` : undefined}
          value={style[key] ?? f.color} onChange={(v) => ss({ [key]: v })} />
      })}
      <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45 }}>
        A heightmap without georeference takes its pixel size and relief from Mode: Landforms.
      </div>
    </Fold>
  </>)
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
  // Shut, the block says what the pen is: where its colour comes from and how wide.
  const sourceName = showHypso
    ? (colourOptions({ prefix, current: source, classSource, hasPlate }).find(([, v]) => v === source)?.[0] ?? 'Line')
    : null
  const weight = style[`weight${prefix}`]
  const lineReadout = [sourceName, weight != null && `${weight} px`].filter(Boolean).join(' · ')
  const gradientName = gradientStops
    ? (Object.keys(GRADIENT_PRESETS).find((k) => JSON.stringify(GRADIENT_PRESETS[k]) === JSON.stringify(gradientStops)) ?? 'custom')
    : null
  return (<>
    <Fold title={label} readout={lineReadout} defaultOpen testId={prefix ? `line-style-${prefix}` : undefined}>
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
        {source === 'form' && <FormInks prefix={prefix} style={style} ss={ss} />}
        {ramp && (
          <Sub>
            <Tog label="Banded" small help="Steps the gradient into flat bands, as on a printed hypsometric map, rather than a smooth ramp." checked={style[`hypsoBanded${prefix}`]} onChange={v => ss({ [`hypsoBanded${prefix}`]: v })} />
            {style[`hypsoBanded${prefix}`] && <InlineSl label="Band interval" help="The width of one band, as a percentage of the gradient. 10 gives ten bands." min={0.5} max={50} value={style[`hypsoInterval${prefix}`]} onChange={v => ss({ [`hypsoInterval${prefix}`]: v })} />}
            <Tog label="Soft" small testId={prefix ? `hypso-soft-${prefix}` : undefined}
              help="Draws the gradient through a film tone curve, which makes its colours lighter and paler. Lines then stand out over a height fill that uses the same gradient."
              checked={!!style[`hypsoSoft${prefix}`]} onChange={v => ss({ [`hypsoSoft${prefix}`]: v })} />
            {/* The gradient is global (shared by every gradient source and the
                fill), but it must be editable right where a source picks it —
                not hidden behind enabling fill in Terrain Style. */}
            {gradientStops && setGradientStops && (
              <Fold title="Gradient" readout={gradientName} testId={prefix ? `gradient-${prefix}` : undefined}>
                <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45, marginBottom: 6 }}>
                  Shared by every layer that uses one.
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4, marginBottom:8 }}>
                  {Object.keys(GRADIENT_PRESETS).map(name => <Btn key={name} size="xs" onClick={() => setGradientStops(GRADIENT_PRESETS[name])} style={{ padding:'2px 0' }}>{name}</Btn>)}
                </div>
                <GradientPicker stops={gradientStops} onChange={setGradientStops} />
              </Fold>
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
    </Fold>
    {/* Off the table for vector layers: masking thins the terrain grid a layer
        is built from, and a road is not built from that grid. */}
    {showCover && <MaskBlock prefix={prefix} style={style} ss={ss} />}
    {showCover && <OcclusionBlock prefix={prefix} style={style} ss={ss} />}
  </>)
}

// ── Main Sidebar component ────────────────────────────────────────────────────
