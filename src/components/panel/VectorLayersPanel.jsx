/**
 * The Vector Layers section: its panel, its pickers and its diagnostics.
 *
 * Seven components, 996 lines, lifted whole out of `Sidebar.jsx`. Nothing was
 * rewritten — every one of them already took props and closed over nothing, so
 * this is a move and not a refactor. `VectorLayersPanel` is the only one the
 * panel itself names; the other six exist to build it.
 *
 * They came out because a third of `Sidebar.jsx` was components that were not
 * sections, sitting above the one function that renders them. The `panel/`
 * directory already held exactly this kind of thing — `TextSection`,
 * `ErosionSection`, `FeaturePicker`, `CoverMap` — and this is the largest
 * cluster that had not joined them.
 */
import { ModeStyleOverride } from './ModeStyleOverride'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useStore } from '../../store/useStore'

import { bboxToWgs84, classifyCRS, crsDisplayName, isInvertible, wgs84ExtentKm } from '../../utils/geoCoords'
import { DEFAULT_OSM_CATEGORIES, OSM_CATEGORIES, OSM_DETAIL_LABEL, detailTierFor } from '../../utils/osmCategories'
import { OSM_ATTRIBUTION, fetchOsm } from '../../utils/osmFetch'
import { featureLabel, toggleHidden } from '../../utils/vectorLayers'

import { CANCELLED } from '../../utils/pacing'
import { iconUrl, loadIconManifest } from '../../utils/iconCatalogue'

import { loadSingleLineManifest } from '../../utils/textGeometry'

import { ACCENT, ACCENT_DEEP, BORDER, Btn, ColorRow, DIM, GripIcon, InlineSl, MUTED, ON_ACCENT, SUNK, SURF, Sub, TEXT, Tog, WARN } from './ui'

import { useStackDrag } from './stackDrag'

const MAX_FEATURE_ROWS = 200

function Orientation({ layer, set, viewTilt, viewSpin }) {
  return (
    <>
      <Tog label="Face camera" small checked={layer.iconFaceCamera}
        onChange={(v) => set({ iconFaceCamera: v })}
        help="Keeps the icon and its labels square to the view as you orbit. Switch it off to aim them by hand — useful when you are composing one particular frame to export." />
      {!layer.iconFaceCamera && (
        <Sub>
          <InlineSl label="Tilt" min={0} max={90} step={1} value={layer.iconTilt}
            fmt={(v) => `${Math.round(v)}°`} onChange={(v) => set({ iconTilt: v })}
            testId={`icon-tilt-${layer.id}`} />
          <InlineSl label="Spin" min={-180} max={180} step={1} value={layer.iconSpin}
            fmt={(v) => `${Math.round(v)}°`} onChange={(v) => set({ iconSpin: v })}
            testId={`icon-spin-${layer.id}`} />
          <Btn size="xs" onClick={() => set({ iconTilt: viewTilt, iconSpin: viewSpin })}
            data-testid={`icon-match-${layer.id}`}
            style={{ width: '100%', padding: 4, marginTop: 2, color: DIM }}>Match view</Btn>
        </Sub>
      )}
    </>
  )
}

/**
 * Why the vector layers are not on the terrain, when they are not.
 *
 * Everything this reports used to look identical on screen: an unsupported
 * projection, a track from another valley and a raster with no georeferencing at
 * all each ended as points silently dropped for being out of bounds. They need
 * different fixes, so they get different sentences — and the ones the user can
 * fix by reprojecting get the command that does it.
 */
function VectorDiagnostics({ crs, crsName, coverage, error, hasFeatures, uploadsOnly }) {
  const c = classifyCRS(crs)
  const status = coverage?.status ?? 'empty'

  const note = (color, children) => (
    <div style={{
      fontSize: 10, color, lineHeight: 1.5, marginBottom: 4,
      background: SUNK, border: `1px solid ${BORDER}`,
      borderRadius: 5, padding: '4px 8px',
    }}>{children}</div>
  )
  const warn = WARN
  const fix = <><br />Reproject it first: <code style={{ color: DIM }}>gdalwarp -t_srs EPSG:4326 in.tif out.tif</code></>

  if (error) return note('#ef4444', error)

  if (c.kind === 'none')
    return note(warn, <>This GeoTIFF carries no georeferencing, so features cannot be placed on it.</>)

  if (!c.supported)
    return note(warn, <>
      Projection <b>{crsDisplayName(crs, crsName)}</b> is not one this tool can place WGS84 features in.{fix}
    </>)

  // The asymmetry worth stating: uploads only need the forward projection, but
  // asking OpenStreetMap what is inside the extent needs the inverse, and the
  // inverse is the narrower of the two.
  if (!isInvertible(crs))
    return note(MUTED, <>
      This GeoTIFF does not record its projection, so its extent cannot be turned into an
      OpenStreetMap query. GeoJSON and GPX uploads still work.
    </>)

  if (!hasFeatures) return null

  if (status === 'outside')
    return note(warn, <>
      None of the {coverage.total.toLocaleString()} loaded vertices fall inside this GeoTIFF — the
      features and the raster cover different areas{c.accuracy === 'guess' ? ', or the assumed UTM zone is wrong' : ''}.
    </>)

  // Partial coverage means something different depending on where the features
  // came from. An upload landing half off the raster is a mismatch worth
  // flagging. An OSM fetch is *defined* by the raster's extent, and Overpass
  // returns whole ways that cross its edge — so partial is the normal outcome
  // there, and warning about it would cry wolf on every single fetch.
  if (status === 'partial' && uploadsOnly)
    return note(warn, <>
      {coverage.inside.toLocaleString()} of {coverage.total.toLocaleString()} vertices fall inside
      the GeoTIFF; the rest are clipped.
    </>)

  // Placed, but on an assumption worth stating — an inferred zone or an
  // unapplied datum shift both put the lines tens to hundreds of metres out.
  if (status === 'ok' && c.accuracy === 'guess')
    return note(MUTED, <>This GeoTIFF does not record its projection. The UTM zone is inferred, so alignment is approximate.</>)
  if (status === 'ok' && c.accuracy === 'approx')
    return note(MUTED, <>{crsDisplayName(crs, crsName)} uses a datum this tool does not shift for; features may sit up to a few hundred metres off.</>)

  return null
}

/**
 * Choosing an SVG icon for a point layer, and orienting it in 3D.
 *
 * The picker previews each icon with an ordinary `<img>` pointed at the file in
 * `public/icons/` — the same trick the preset tiles use for their thumbnails,
 * and the reason the icons are shipped as files rather than generated into a
 * module.
 *
 * Everything here is render-side: the worker never learns that icons exist, so
 * dragging Size or Tilt is a frame, not a rebuild.
 */
/**
 * Open eye, or struck through when the layer is hidden.
 *
 * Inline rather than one of the files in `public/icons/` — those are data the
 * user draws *with*, fetched at runtime and flattened into terrain geometry.
 * A control in the panel is not that, and routing it through the icon catalogue
 * would make the chrome depend on the content.
 */

/**
 * Choosing an SVG icon for a point layer, and orienting it in 3D.
 *
 * The picker previews each icon with an ordinary `<img>` pointed at the file in
 * `public/icons/` — the same trick the preset tiles use for their thumbnails,
 * and the reason the icons are shipped as files rather than generated into a
 * module.
 *
 * Everything here is render-side: the worker never learns that icons exist, so
 * dragging Size or Tilt is a frame, not a rebuild.
 */
/**
 * Open eye, or struck through when the layer is hidden.
 *
 * Inline rather than one of the files in `public/icons/` — those are data the
 * user draws *with*, fetched at runtime and flattened into terrain geometry.
 * A control in the panel is not that, and routing it through the icon catalogue
 * would make the chrome depend on the content.
 */
function EyeIcon({ off }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.6" />
      {off && <path d="M3.5 3.5 20.5 20.5" />}
    </svg>
  )
}

/**
 * One mark's ink: stroke colour, width and opacity, then fill colour and
 * opacity behind its own switch.
 *
 * The same block serves the icon and the labels, because they want the same six
 * numbers and want them *separately* — a summit triangle is not the road that
 * shares its colour, and lettering is neither. `prefix` picks which set of
 * fields it writes; `layerStyle` reads them back with the matching cascade.
 *
 * Everything but the width shows the value in force rather than the value
 * stored: a colour left at `null` displays the layer's, so the swatch is never
 * blank and never lies. Touching it writes the field and parts company, which
 * is what **Match layer** undoes.
 */
/**
 * `noFill` is the single-line label case. A stroke face has no interior — its
 * glyphs are centre lines, not contours — so a fill would triangulate an open
 * path into a smear. The setting is kept on the layer rather than cleared, so
 * switching back to an outline face restores what it was.
 */

/**
 * One mark's ink: stroke colour, width and opacity, then fill colour and
 * opacity behind its own switch.
 *
 * The same block serves the icon and the labels, because they want the same six
 * numbers and want them *separately* — a summit triangle is not the road that
 * shares its colour, and lettering is neither. `prefix` picks which set of
 * fields it writes; `layerStyle` reads them back with the matching cascade.
 *
 * Everything but the width shows the value in force rather than the value
 * stored: a colour left at `null` displays the layer's, so the swatch is never
 * blank and never lies. Touching it writes the field and parts company, which
 * is what **Match layer** undoes.
 */
/**
 * `noFill` is the single-line label case. A stroke face has no interior — its
 * glyphs are centre lines, not contours — so a fill would triangulate an open
 * path into a smear. The setting is kept on the layer rather than cleared, so
 * switching back to an outline face restores what it was.
 */
function Ink({ layer, set, prefix, help = {}, noFill = false }) {
  const id = layer.id
  const F = (k) => layer[prefix + k]
  const color = F('Color') ?? layer.color
  const opacity = F('Opacity') ?? layer.opacity
  const inherited = ['Color', 'Opacity', 'FillColor', 'FillOpacity'].every((k) => F(k) == null)

  return (
    <>
      <ColorRow label="Colour" value={color} testId={`${prefix}-color-${id}`}
                onChange={(v) => set({ [`${prefix}Color`]: v })} />
      <InlineSl label="Width" min={0.25} max={8} step={0.25} value={F('Weight')}
        onChange={(v) => set({ [`${prefix}Weight`]: v })} testId={`${prefix}-weight-${id}`}
        help={help.weight} />
      <InlineSl label="Opacity" min={0} max={1} step={0.01} value={opacity}
        fmt={(v) => Math.round(v * 100) + '%'} testId={`${prefix}-opacity-${id}`}
        onChange={(v) => set({ [`${prefix}Opacity`]: v })} help={help.opacity} />

      {!noFill && (
        <div data-testid={`${prefix}-fill-${id}`}>
          <Tog label="Fill" small checked={F('Fill')}
            onChange={(v) => set({ [`${prefix}Fill`]: v })} help={help.fill} />
        </div>
      )}
      {F('Fill') && !noFill && (
        <Sub>
          {/* Falls back through this mark's *own* stroke colour before the
              layer's, so colouring the mark colours all of it. */}
          <ColorRow label="Fill Colour" value={F('FillColor') ?? color}
                    testId={`${prefix}-fill-color-${id}`}
                    onChange={(v) => set({ [`${prefix}FillColor`]: v })} />
          <InlineSl label="Fill Op." min={0} max={1} step={0.01}
            value={F('FillOpacity') ?? opacity} fmt={(v) => Math.round(v * 100) + '%'}
            testId={`${prefix}-fill-opacity-${id}`}
            onChange={(v) => set({ [`${prefix}FillOpacity`]: v })} />

          {/* Only offered with a fill, because that is what makes the
              difference: a stroke with no shape behind it has no inside to
              sit in. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '2px 0 4px' }}>
            <span style={{ fontSize: 10, color: DIM, width: 54 }}>Stroke</span>
            <div style={{ display: 'flex', gap: 2, flex: 1 }}>
              {[[true, 'Outside'], [false, 'Centred']].map(([v, text]) => (
                <Btn key={text} block variant="toggle" on={!!F('StrokeOutside') === v}
                  onClick={() => set({ [`${prefix}StrokeOutside`]: v })}
                  data-testid={`${prefix}-stroke-${v ? 'outside' : 'centred'}-${id}`}
                  style={{ padding: '4px 0', fontSize: 10 }}>{text}</Btn>
              ))}
            </div>
          </div>
        </Sub>
      )}

      {!inherited && (
        <button data-testid={`${prefix}-match-${id}`}
          onClick={() => set({
            [`${prefix}Color`]: null, [`${prefix}Opacity`]: null,
            [`${prefix}FillColor`]: null, [`${prefix}FillOpacity`]: null,
          })}
          style={{
            width: '100%', padding: 4, margin: '2px 0 4px', fontSize: 10, borderRadius: 3,
            cursor: 'pointer', background: SURF, color: DIM, border: `1px solid ${BORDER}`,
          }}>Match layer</button>
      )}
    </>
  )
}

/**
 * Which way a layer's icon and its labels face.
 *
 * One block for both, because they are one mark: a name lying flat beside an
 * upright summit triangle reads as a bug. It appears under whichever of the two
 * is switched on, and only once.
 */

function IconPicker({ layer, onPatch, onCustom, overflowed, viewTilt, viewSpin }) {
  const [manifest, setManifest] = useState(null)

  useEffect(() => { loadIconManifest().then(setManifest) }, [])

  // Stable identity, or the `useMemo` below it re-runs on every render.
  const icons = useMemo(() => manifest?.icons ?? [], [manifest])

  /**
   * The whole set, with the category's own suggestion first — a peak layer
   * should be one click from a triangle rather than a hunt across the grid.
   */
  const shown = useMemo(() => {
    const want = layer.suggestedIcon
    const head = want ? icons.filter((i) => i.id === want) : []
    return head.length ? [...head, ...icons.filter((i) => i.id !== want)] : icons
  }, [icons, layer.suggestedIcon])

  const set = (patch) => onPatch(layer.id, patch)

  /**
   * Choosing an icon changes nothing but the icon.
   *
   * It used to thin the layer's weight and claim its fill colour and opacity on
   * the first pick, because the glyph was drawn with the *layer's* ink and that
   * ink is a dot's diameter and a lake's blue. The icon now carries its own —
   * see `Ink` — so there is nothing left to borrow and nothing to overwrite.
   */
  const choose = (id) => set({ icon: id })

  const custom = layer.iconCustom

  return (
    <div style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
      <div style={{ fontSize: 11, color: DIM, fontWeight: 600, marginBottom: 4 }}>Icon</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 2, marginBottom: 8 }}>
        {/* Back to a plain dot. */}
        <button onClick={() => set({ icon: null })} title="No icon — draw a dot"
          data-testid={`icon-none-${layer.id}`}
          style={{
            aspectRatio: '1/1', display: 'grid', placeItems: 'center', borderRadius: 3, cursor: 'pointer',
            fontSize: 11, background: layer.icon ? SURF : ACCENT, color: layer.icon ? MUTED : ON_ACCENT,
            border: `1px solid ${layer.icon ? BORDER : ACCENT}`,
          }}>•</button>

        {shown.map((ic) => {
          const on = layer.icon === ic.id
          return (
            <button key={ic.id} onClick={() => choose(ic.id)} title={`${ic.label} — ${ic.id}`}
              data-testid={`icon-${layer.id}-${ic.id}`}
              style={{
                aspectRatio: '1/1', display: 'grid', placeItems: 'center', borderRadius: 3, cursor: 'pointer',
                background: on ? ACCENT_DEEP : SURF, border: `1px solid ${on ? ACCENT_DEEP : BORDER}`, padding: 2,
              }}>
              <img src={iconUrl(ic.id)} alt={ic.label} loading="lazy"
                style={{ width: '100%', height: '100%', filter: on ? 'invert(1)' : 'invert(0.72)' }} />
            </button>
          )
        })}

        {custom && (
          <button onClick={() => set({ icon: 'custom' })} title={custom.name}
            data-testid={`icon-${layer.id}-custom`}
            style={{
              aspectRatio: '1/1', display: 'grid', placeItems: 'center', borderRadius: 3, cursor: 'pointer',
              fontSize: 10, background: layer.icon === 'custom' ? ACCENT_DEEP : SURF,
              color: layer.icon === 'custom' ? ON_ACCENT : MUTED,
              border: `1px solid ${layer.icon === 'custom' ? ACCENT_DEEP : BORDER}`,
            }}>SVG</button>
        )}
      </div>

      <div style={{ fontSize: 10, color: MUTED, marginBottom: 8, lineHeight: 1.5 }}>
        Map &amp; terrain marks. Anything else is an SVG away.
      </div>

      <button className="hmload" onClick={() => onCustom(layer.id)} data-testid={`icon-upload-${layer.id}`}
        style={{
          width: '100%', padding: 4, marginBottom: 8, background: SURF, color: MUTED,
          border: `1px dashed ${BORDER}`, borderRadius: 5, cursor: 'pointer', fontSize: 10,
        }}>↑ Custom SVG</button>

      {overflowed && (
        <div style={{ fontSize: 10, color: WARN, marginBottom: 4, lineHeight: 1.5 }}>
          Too many features to draw as icons — this layer is still showing dots.
        </div>
      )}

      {layer.icon && (
        <>
          <InlineSl label="Size" min={2} max={80} step={1} value={layer.iconSize}
            onChange={(v) => set({ iconSize: v })} testId={`icon-size-${layer.id}`} />
          <InlineSl label="Lift" min={0} max={120} step={1} value={layer.iconLift}
            onChange={(v) => set({ iconLift: v })} testId={`icon-lift-${layer.id}`}
            help="Raises the icon off the ground and draws a thin leader line down to the exact point. On steep relief it is what stops a summit marker being half-buried in the slope behind it." />
          <Ink layer={layer} set={set} prefix="icon" help={{
            weight: "The icon's own line width. It is not the layer's, because a point layer's weight is its dot's *diameter* — five for a peak — and five pixels of stroke on a 25-pixel mountain is a blob.",
            opacity: "The icon's own opacity, so a marker can sit back from the lines it shares a layer with, or stand out from them.",
            fill: "Draws the glyph solid, the way the icon was designed, with its holes cut out — the skull's eye sockets and the pin's dot stay open. Switch it off for the hollow outline, which is what a pen plotter draws. It shows in the viewport and in the PNG and video exports, but not in the SVG: that is a line-art format and a fill is triangles.",
          }} />
          <Orientation layer={layer} set={set} viewTilt={viewTilt} viewSpin={viewSpin} />
        </>
      )}
    </div>
  )
}

/**
 * A point layer's features labelled with their own name and height.
 *
 * Both lines come from what the fetch already parsed — a peak's `name` tag and
 * its `ele`, the same two strings the feature list below shows — so a label is
 * never invented. A feature with no name simply goes unlabelled, which is why
 * the counts are on screen: "18 of 29 named" is the difference between a plot
 * that is missing labels and one whose data never had them.
 *
 * The text is Space Mono Bold, the face the erzberg logo is set in, flattened
 * to line geometry like everything else here — so it takes the layer's colour
 * and weight, and lands in the SVG as strokes a plotter can draw.
 */

/**
 * A point layer's features labelled with their own name and height.
 *
 * Both lines come from what the fetch already parsed — a peak's `name` tag and
 * its `ele`, the same two strings the feature list below shows — so a label is
 * never invented. A feature with no name simply goes unlabelled, which is why
 * the counts are on screen: "18 of 29 named" is the difference between a plot
 * that is missing labels and one whose data never had them.
 *
 * The text is Space Mono Bold, the face the erzberg logo is set in, flattened
 * to line geometry like everything else here — so it takes the layer's colour
 * and weight, and lands in the SVG as strokes a plotter can draw.
 */
function LabelPicker({ layer, bucket, onPatch, overflowed, viewTilt, viewSpin }) {
  const set = (patch) => onPatch(layer.id, patch)
  // The bundled stroke faces, fetched once for the whole app and only when a
  // label section is open — the manifest is names, not glyphs.
  const [singleLineFonts, setSingleLineFonts] = useState([])
  useEffect(() => { loadSingleLineManifest().then(setSingleLineFonts) }, [])
  const on = layer.labelName || layer.labelHeight

  const named = bucket?.names.size ?? 0
  const noted = bucket?.notes.size ?? 0
  const total = bucket?.count ?? 0

  /**
   * Bold and italic as two switches rather than a list of four faces: regular
   * is neither, and bold-italic — which is a real file, not a slanted bold —
   * falls out of both without a fourth button.
   */
  const face = (which, label, active) => (
    <button key={which}
      onClick={() => set(which === 'bold' ? { labelBold: !active } : { labelItalic: !active })}
      data-testid={`label-${which}-${layer.id}`}
      style={{
        flex: 1, padding: '4px 0', fontSize: 10, cursor: 'pointer', borderRadius: 3,
        fontWeight: which === 'bold' ? 700 : 400,
        fontStyle: which === 'italic' ? 'italic' : 'normal',
        background: active ? ACCENT_DEEP : SURF,
        color: active ? ON_ACCENT : DIM,
        border: `1px solid ${active ? ACCENT_DEEP : BORDER}`,
      }}>{label}</button>
  )

  const align = (value, label) => (
    <button key={value} onClick={() => set({ labelAlign: value })}
      data-testid={`label-align-${value}-${layer.id}`}
      style={{
        flex: 1, padding: '4px 0', fontSize: 10, cursor: 'pointer', borderRadius: 3,
        background: layer.labelAlign === value ? ACCENT_DEEP : SURF,
        color: layer.labelAlign === value ? ON_ACCENT : DIM,
        border: `1px solid ${layer.labelAlign === value ? ACCENT_DEEP : BORDER}`,
      }}>{label}</button>
  )

  return (
    <div style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
      <div style={{ fontSize: 11, color: DIM, fontWeight: 600, marginBottom: 4 }}>Labels</div>

      <div data-testid={`label-name-${layer.id}`}>
        <Tog label="Name" small checked={layer.labelName}
          onChange={(v) => set({ labelName: v })}
          help="Draws each feature's name beside it. A feature with no name in the data is left unlabelled rather than given a number — a plot of twenty-nine summits with nine of them called “#12” is worse than nine unlabelled ones." />
      </div>
      <div data-testid={`label-height-${layer.id}`}>
        <Tog label="Height" small checked={layer.labelHeight}
          onChange={(v) => set({ labelHeight: v })}
          help="Draws the feature's elevation, as OpenStreetMap has it — the same “1910m” the feature list shows. It goes on its own line under the name, or on its own if the name is off." />
      </div>

      <div style={{ fontSize: 10, color: MUTED, margin: '4px 0 8px', lineHeight: 1.5 }}>
        {total ? `${named} of ${total} named · ${noted} with a height` : 'Nothing to label here.'}
      </div>

      {on && (
        <>
          <Tog label="Use single-line font" small checked={!!layer.labelSingleLine}
            onChange={(v) => set({ labelSingleLine: v })}
            help="Letters drawn as a single stroke down the middle of each stem, the way plotter fonts have worked since the 1960s. The faces the app otherwise letters in are outline fonts, so a plotted letter is the *edge* of the letter and the pen goes round every glyph twice. A single-line face is the skeleton instead: one pass, half the pen-down distance, and no double line where two strokes meet. It looks thinner on screen for the same reason it plots better." />

          {layer.labelSingleLine ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '2px 0 8px' }}>
              <span style={{ fontSize: 10, color: DIM, width: 54 }}>Font</span>
              <select value={layer.labelFont ?? 'ReliefPendot'}
                onChange={(e) => set({ labelFont: e.target.value })}
                data-testid={`label-font-${layer.id}`}
                style={{
                  flex: 1, minWidth: 0, background: SURF, color: DIM,
                  border: `1px solid ${BORDER}`, borderRadius: 3,
                  fontSize: 10, padding: '4px 4px', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {Object.entries(singleLineFonts.reduce((g, f) => {
                  (g[f.group] ??= []).push(f); return g
                }, {})).map(([group, faces]) => (
                  <optgroup key={group} label={group}>
                    {faces.map((f) => <option key={f.id} value={f.id}>{f.family}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          ) : (
            /* Bold and italic as two switches rather than a list of four faces:
               regular is neither, and bold-italic — a real file, not a slanted
               bold — falls out of both without a fourth button. They are hidden
               for a stroke face because that is a different typeface with no
               bold to offer; showing them would mean inventing one. */
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '2px 0 4px' }}>
              <span style={{ fontSize: 10, color: DIM, width: 54 }}>Face</span>
              <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                {face('bold', 'Bold', layer.labelBold)}
                {face('italic', 'Italic', layer.labelItalic)}
              </div>
            </div>
          )}

          <InlineSl label="Size" min={2} max={40} step={0.5} value={layer.labelSize}
            onChange={(v) => set({ labelSize: v })} testId={`label-size-${layer.id}`} />
          <InlineSl label="Offset ↔" min={-120} max={120} step={1} value={layer.labelDx}
            onChange={(v) => set({ labelDx: v })} testId={`label-dx-${layer.id}`}
            help="Moves the label across its own plane, so it can sit beside a marker rather than on it." />
          <InlineSl label="Offset ↕" min={-120} max={200} step={1} value={layer.labelDy}
            onChange={(v) => set({ labelDy: v })} testId={`label-dy-${layer.id}`}
            help="Moves the label up its own plane. Raise it past the icon's Lift to sit above a marker; take it negative to hang the name below the point." />

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '4px 0 4px' }}>
            <span style={{ fontSize: 10, color: DIM, width: 54 }}>Align</span>
            <div style={{ display: 'flex', gap: 2, flex: 1 }}>
              {align('left', 'Left')}{align('center', 'Centre')}{align('right', 'Right')}
            </div>
          </div>

          <Ink layer={layer} set={set} prefix="label" noFill={!!layer.labelSingleLine} help={{
            weight: "The lettering's own line width — the stroke that draws a summit triangle well is the stroke that closes up the counters of small type.",
            opacity: "The lettering's own opacity. Type sitting on a dense contour field often wants to be quieter than the mark it labels — or louder than a layer you have faded back.",
            fill: "Draws the lettering solid, with the counters of the letters cut out. Switch it off for outlined type, which is what a pen plotter draws and what the SVG export carries either way.",
          }} />

          {/* Orientation lives with the icon when there is one; a layer that
              labels without a marker still needs to aim its text. */}
          {!layer.icon && (
            <Orientation layer={layer} set={set} viewTilt={viewTilt} viewSpin={viewSpin} />
          )}

          {overflowed && (
            <div style={{ fontSize: 10, color: WARN, marginTop: 4, lineHeight: 1.5 }}>
              Too many features to letter — this layer is drawing no labels. Hide
              some features, or label fewer layers.
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The features inside one layer, with a checkbox each.
 *
 * A layer used to be the smallest thing that existed: you could hide all 29
 * peaks or none. Per-feature visibility is the same concept one level down, live
 * and with no apply step, which is why the checkbox *is* the state rather than a
 * selection waiting to be committed.
 *
 * Two facts about real data shape this list. Most features are unnamed — a live
 * alpine fetch had names on 52 of 621 tracks and on none of 245 scrub polygons —
 * so named ones sort first and the rest get a stable `Track #118` to point at.
 * And a layer can hold hundreds, so there is a filter box and a hard cap on
 * rendered rows: 621 DOM rows inside a scrolling panel is a jank nobody asked
 * for, and a virtualisation library would be a dependency for one list.
 */

function FeatureList({ layer, bucket, onPatch }) {
  const [filter, setFilter] = useState('')
  const hover = useStore((s) => s.vectorHover)
  const selected = useStore((s) => s.vectorSelected)
  const setHover = useStore((s) => s.setVectorHover)
  const setSelected = useStore((s) => s.setVectorSelected)
  const rowRef = useRef(null)

  const hidden = useMemo(() => new Set(layer.hidden ?? []), [layer.hidden])

  // Sorted named-first once per bucket, then filtered per keystroke — the sort
  // is over every feature and has no business re-running as you type.
  const ordered = useMemo(() => {
    const idx = Array.from({ length: bucket.count }, (_, i) => i)
    idx.sort((a, b) => {
      const na = bucket.names.get(a), nb = bucket.names.get(b)
      if (!!na !== !!nb) return na ? -1 : 1
      if (na && nb) return na.localeCompare(nb)
      return a - b
    })
    return idx
  }, [bucket])

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return ordered
    return ordered.filter((i) => featureLabel(bucket, i).toLowerCase().includes(q))
  }, [ordered, filter, bucket])

  // A feature picked on the terrain has to be findable in a list of hundreds.
  useEffect(() => {
    if (selected?.layerId === layer.id) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, layer.id])

  const shown = matches.slice(0, MAX_FEATURE_ROWS)
  const visible = bucket.count - hidden.size

  const bulk = (label, next, testId) => (
    <Btn onClick={() => onPatch(layer.id, { hidden: next() })} data-testid={testId}
      style={{ padding: '2px 4px' }}>{label}</Btn>
  )

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: MUTED }} data-testid={`feature-count-${layer.id}`}>
          Showing {visible} of {bucket.count}
        </span>
        <span style={{ display: 'flex', gap: 2 }}>
          {bulk('all', () => [], `feature-all-${layer.id}`)}
          {bulk('none', () => Array.from({ length: bucket.count }, (_, i) => i), `feature-none-${layer.id}`)}
        </span>
      </div>

      {bucket.count > 8 && (
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…"
          data-testid={`feature-filter-${layer.id}`}
          style={{
            width: '100%', boxSizing: 'border-box', marginBottom: 4, padding: '2px 4px',
            fontSize: 10, background: SURF, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 3,
          }} />
      )}

      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {shown.map((i) => {
          const isHover = hover?.layerId === layer.id && hover.feature === i
          const isSel = selected?.layerId === layer.id && selected.feature === i
          const note = bucket.notes.get(i)
          return (
            <div key={i} ref={isSel ? rowRef : null}
              data-testid={`feature-${layer.id}-${i}`}
              data-selected={isSel ? 'true' : undefined}
              // Hovering a row is the other direction of the same question the
              // picker answers: it writes the very same state, so the feature
              // lights up on the terrain without this knowing how.
              // No x/y: the highlight wants the hover, the tooltip does not —
              // the row already says the name, and a floating label over the
              // panel would just cover the next row.
              onMouseEnter={() => setHover({ layerId: layer.id, feature: i, x: null, y: null })}
              onMouseLeave={() => setHover(null)}
              // Clicking the selected row again clears it. The terrain's own way
              // out of a selection is a click on empty ground, which is not
              // available while Identify on hover is off — and a row click is
              // how you make one in that state, so it has to be how you undo one.
              onClick={() => setSelected(isSel ? null : { layerId: layer.id, feature: i })}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '2px 2px', borderRadius: 3,
                cursor: 'pointer',
                background: isSel ? 'color-mix(in srgb, var(--hm-accent) 16%, transparent)' : isHover ? 'var(--hm-veil-strong)' : 'transparent',
              }}>
              <input type="checkbox" checked={!hidden.has(i)}
                data-testid={`feature-check-${layer.id}-${i}`}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onPatch(layer.id, { hidden: toggleHidden(layer.hidden, i) })}
                style={{ width: 11, height: 11, accentColor: ACCENT, cursor: 'pointer' }} />
              <span style={{
                flex: 1, fontSize: 10, color: hidden.has(i) ? MUTED : DIM,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{featureLabel(bucket, i)}</span>
              {note && <span style={{ fontSize: 10, color: MUTED, fontFamily: 'monospace' }}>{note}</span>}
            </div>
          )
        })}
      </div>

      {matches.length > shown.length && (
        <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
          …and {matches.length - shown.length} more. Filter to narrow.
        </div>
      )}
      {filter && matches.length === 0 && (
        <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>Nothing matches “{filter}”.</div>
      )}
    </div>
  )
}

/**
 * Terrain by name.
 *
 * Modelled on `VectorLayersPanel` below, and deliberately: it is the same shape
 * of thing — a request to somebody else's server, on demand, with a cancel and a
 * credit — so it owns its own query, its own candidates and its own progress
 * rather than putting seven more fields into App state. The app hears about it
 * once, when a raster is ready.
 *
 * Nothing is sent until Search is pressed. Not a prefetch, not an autocomplete:
 * Nominatim's usage policy asks that nobody attach it to a keystroke, and this
 * app has no business sending one request per letter either way.
 */

/**
 * The Vector Layers panel — sources at the top, one editable row per layer below.
 *
 * Deliberately additive: it replaces the old GPX Track section in place and
 * leaves the draw-mode sections exactly as they are. The rows here are
 * a list of *data* layers, which is a different thing from the draw modes and is
 * why it does not try to be a unified layer stack.
 */
export function VectorLayersPanel({
  crs, crsName, bbox, coverage, error,
  sources, layers,
  onLoadGpx, onLoadGeoJson, onPatch, onRemove, onReorder, onRemoveSource, onAdopt, onError,
  identify, onIdentify, onCustomIcon, iconOverflow, labelOverflow, viewTilt, viewSpin,
}) {
  const [expanded, setExpanded] = useState(null)
  const [featuresOpen, setFeaturesOpen] = useState(null)
  const pickedFeature = useStore((s) => s.vectorSelected)
  const drag = useStackDrag(layers ?? [], onReorder)

  // Picking a feature on the terrain has to *show* you the feature. Without
  // this the click sets the selection and lights the line up, but its row lives
  // behind two collapsed disclosures — you would have to guess which of forty
  // layers owns it and open them by hand, which is the work the click was
  // supposed to save.
  useEffect(() => {
    if (!pickedFeature) return
    setExpanded(pickedFeature.layerId)
    setFeaturesOpen(pickedFeature.layerId)
  }, [pickedFeature])
  const [picked, setPicked] = useState(DEFAULT_OSM_CATEGORIES)
  const [fetching, setFetching] = useState(false)
  const [status, setStatus] = useState(null)
  // `null` while a phase has no percentage to report — see makeReporter.
  const [progress, setProgress] = useState(null)
  const abortRef = useRef(null)

  const wgs = useMemo(() => bboxToWgs84(bbox, crs), [bbox, crs])
  const size = useMemo(() => wgs84ExtentKm(wgs), [wgs])
  const canQuery = !!wgs
  const hasOsm = sources?.some((s) => s.kind === 'osm')

  /*
   * HOW MUCH OF OPENSTREETMAP TO ASK FOR.
   *
   * The extent decides, because it is the thing that makes the answer
   * unmanageable: a province asked for at full detail is over a million
   * elements and a gigabyte of geometry, and no timeout is long enough for
   * that. The same extent asked for at its own tier arrives in under a minute
   * and draws a better sheet — see `OSM_DETAIL_TIERS`.
   *
   * The tier is shown rather than applied silently, because a user who wanted
   * every footpath and got the trunk roads needs to know which happened, and
   * the override is one click away when the extent really is worth the wait.
   */
  const autoTier = detailTierFor(size ? size.w * size.h : 0)
  const [fullDetail, setFullDetail] = useState(false)
  const detail = fullDetail ? 'full' : autoTier

  const toggleCat = (id) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))

  const runFetch = async () => {
    if (!wgs || !picked.length) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setFetching(true)
    setProgress(null)
    setStatus('Querying OpenStreetMap…')
    onError(null)
    try {
      const { source, cached } = await fetchOsm(wgs, picked, {
        detail,
        signal: ctrl.signal,
        onProgress: (f, label) => { setProgress(f); if (label) setStatus(label) },
        shouldCancel: () => ctrl.signal.aborted,
      })
      if (ctrl.signal.aborted) return
      if (!source.buckets.length) {
        onError('OpenStreetMap has nothing of the selected kinds inside this extent.')
      } else {
        onAdopt(source)
        setStatus(cached ? 'From cache.' : null)
      }
    } catch (err) {
      // An abort is the user's own decision and needs no error box.
      if (err?.name !== 'AbortError' && err !== CANCELLED) {
        console.error('[OSM] Fetch failed:', err)
        onError(err?.message || 'Could not reach OpenStreetMap.')
      }
    } finally {
      abortRef.current = null
      setFetching(false)
      setProgress(null)
      if (!fetching) setStatus(null)
    }
  }

  const btn = {
    padding: 8, background: SURF, color: MUTED, border: `1px dashed ${BORDER}`,
    borderRadius: 5, cursor: 'pointer', fontSize: 11,
  }

  return (
    <>
      {layers?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Tog label="Identify on hover" small checked={identify} onChange={onIdentify}
               help="Rest the pointer on a feature to see its name and light it up; click to select it in the list. Each pick walks every drawn segment, so on a very dense fetch this is the switch to reach for." />
        </div>
      )}

      <VectorDiagnostics crs={crs} crsName={crsName} coverage={coverage} error={error}
                         hasFeatures={layers?.length > 0}
                         uploadsOnly={sources?.some((s) => s.kind !== 'osm')} />

      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button className="hmload" onClick={onLoadGeoJson} style={{ ...btn, flex: 1 }}
                data-testid="load-geojson">↑ GeoJSON</button>
        <button className="hmload" onClick={onLoadGpx} style={{ ...btn, flex: 1 }}
                data-testid="load-gpx">↑ GPX</button>
      </div>

      {/* ── OpenStreetMap ───────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 5, padding: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: DIM, fontWeight: 600 }}>OpenStreetMap</span>
          {size && (
            <span style={{ fontSize: 10, color: MUTED, fontFamily: 'monospace' }} data-testid="osm-extent">
              {size.w.toFixed(1)} × {size.h.toFixed(1)} km
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, marginBottom: 8 }}>
          {OSM_CATEGORIES.map((c) => {
            const on = picked.includes(c.id)
            return (
              <button key={c.id} onClick={() => toggleCat(c.id)} disabled={!canQuery || fetching}
                data-testid={`osm-cat-${c.id}`}
                title={c.heavy ? 'Large in a populated extent' : undefined}
                style={{
                  fontSize: 10, padding: '4px 2px', borderRadius: 3, textAlign: 'left',
                  cursor: canQuery && !fetching ? 'pointer' : 'default',
                  opacity: canQuery ? 1 : 0.4,
                  background: on ? ACCENT_DEEP : SURF, color: on ? ON_ACCENT : MUTED,
                  border: `1px solid ${on ? ACCENT_DEEP : BORDER}`,
                }}>
                {c.label}{c.heavy ? ' ⚠' : ''}
              </button>
            )
          })}
        </div>

        {autoTier !== 'full' && (
          <div style={{ marginBottom: 8 }} data-testid="osm-detail">
            <Tog label={`Detail: ${OSM_DETAIL_LABEL[detail]}`} small checked={fullDetail}
                 onChange={setFullDetail}
                 help={`An extent this size holds more than a browser can hold, so it is asked for at a coarser detail: fewer road and water classes, and only the larger woods and lakes. Switch this on to ask for everything anyway — on a province that is upwards of a million features, and the fetch will say so before it tries.`} />
          </div>
        )}

        <button onClick={fetching ? () => abortRef.current?.abort() : runFetch}
          disabled={!canQuery || !picked.length}
          data-testid="osm-fetch"
          style={{
            width: '100%', padding: 8, borderRadius: 5, fontSize: 10, cursor: canQuery ? 'pointer' : 'default',
            background: fetching ? SURF : ACCENT, color: fetching ? MUTED : ON_ACCENT,
            border: `1px solid ${fetching ? BORDER : ACCENT}`, opacity: canQuery && picked.length ? 1 : 0.4,
          }}>
          {fetching ? '✕ Cancel' : 'Fetch from OpenStreetMap'}
        </button>

        {fetching && (
          <>
            {/* Determinate only where there is something to be determinate
                about. Overpass sends no headers until the query has finished
                running, so the stripe travels during that wait rather than
                filling — a bar stuck at 0% for ninety seconds and then racing to
                the end says the wrong thing about which part is slow. */}
            <div data-testid="osm-progress" data-pct={progress == null ? '' : Math.round(progress * 100)}
              style={{
                height: 3, marginTop: 6, borderRadius: 2, background: SURF,
                overflow: 'hidden', position: 'relative',
              }}>
              {progress == null ? (
                <div className="hm-indet" style={{
                  position: 'absolute', inset: 0, width: '40%',
                  background: ACCENT, borderRadius: 2,
                }} />
              ) : (
                <div style={{
                  height: '100%', width: `${Math.round(progress * 100)}%`,
                  background: ACCENT, borderRadius: 2, transition: 'width 120ms linear',
                }} />
              )}
            </div>
            {status && (
              <div style={{ fontSize: 10, color: MUTED, marginTop: 4, textAlign: 'center' }}>{status}</div>
            )}
          </>
        )}
        {hasOsm && (
          <div style={{ fontSize: 10, color: MUTED, marginTop: 4, textAlign: 'center' }}>{OSM_ATTRIBUTION}</div>
        )}
      </div>

      {/* ── Layers ──────────────────────────────────────────────────────── */}
      {!layers?.length && (
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
          Nothing loaded yet. Fetch the extent from OpenStreetMap, or upload a GeoJSON or GPX file —
          features are draped on the terrain and carried into the SVG, PNG and video exports.
        </div>
      )}

      {layers?.map((l, i) => {
        const isOpen = expanded === l.id
        const held = drag.dragging === l.id
        return (
          <div key={l.id} data-testid={`vector-layer-${l.id}`} ref={drag.bindRow(l.id)}
               style={{
                 borderTop: `1px solid ${BORDER}`, paddingTop: 4, marginBottom: 4,
                 // The row being dragged is dimmed rather than lifted out of the
                 // list: the reorder is committed as the cursor crosses, so what
                 // you are dragging is the real row in its real new place, and a
                 // floating copy of it would be a second, lying one.
                 opacity: held ? 0.55 : 1,
                 background: held ? SURF : 'transparent',
               }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* Top of the list is the front of the scene, so this is also the
                  control for what covers what. Arrow keys move it one step,
                  which is the only way to do this without a pointer. */}
              <button data-testid={`vector-grip-${l.id}`}
                title={`Drag to reorder — ${i === 0 ? 'top of the stack, drawn in front' : `#${i + 1} of ${layers.length}`}`}
                aria-label={`Reorder ${l.name}`}
                onPointerDown={(e) => drag.start(e, l.id)}
                onPointerMove={drag.move}
                onPointerUp={drag.end}
                onPointerCancel={drag.end}
                onKeyDown={(e) => {
                  const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
                  if (!step) return
                  e.preventDefault()
                  onReorder(l.id, i + step)
                }}
                style={{
                  background: 'none', border: 'none', padding: 0, display: 'flex',
                  color: held ? TEXT : BORDER, cursor: held ? 'grabbing' : 'grab',
                  touchAction: 'none', flexShrink: 0,
                }}><GripIcon /></button>
              {/* A colour chip, not a control. It used to double as the
                  visibility toggle, which put "hide" and "delete" at opposite
                  ends of the row and left the swatch doing two jobs — the eye
                  below is the one that says what it does. */}
              <span data-testid={`vector-swatch-${l.id}`} aria-hidden="true"
                style={{
                  width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                  background: l.color, opacity: l.visible ? 1 : 0.35,
                  border: `1px solid ${BORDER}`,
                }} />
              <button onClick={() => setExpanded(isOpen ? null : l.id)}
                data-testid={`vector-name-${l.id}`}
                style={{
                  flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                  color: l.visible ? TEXT : MUTED, fontSize: 10, padding: 0,
                }}>
                {isOpen ? '▾' : '▸'} {l.name}
              </button>
              <span style={{ fontSize: 10, color: MUTED, fontFamily: 'monospace' }}>{l.count}</span>
              <button onClick={() => onPatch(l.id, { visible: !l.visible })}
                title={l.visible ? 'Hide this layer' : 'Show this layer'}
                aria-pressed={!l.visible} data-testid={`vector-vis-${l.id}`}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex',
                  color: l.visible ? DIM : MUTED,
                }}><EyeIcon off={!l.visible} /></button>
              <button onClick={() => onRemove(l.id)} title="Remove this layer"
                data-testid={`vector-remove-${l.id}`}
                style={{ background: 'none', border: 'none', color: MUTED, cursor: 'pointer', fontSize: 10, padding: 0 }}>✕</button>
            </div>

            {isOpen && (
              <Sub>
                {/* The very same control block every draw mode uses. A
                    layer record's field names are the mode params minus their
                    suffix, so an empty prefix addresses them unchanged. */}
                <ModeStyleOverride prefix="" style={l} ss={(patch) => onPatch(l.id, patch)} showHypso={false} />
                {l.geom === 'area' && (
                  <div style={{ marginTop: 8 }} data-testid={`vector-fill-${l.id}`}>
                    <Tog label="Fill" small checked={l.fill} onChange={(v) => onPatch(l.id, { fill: v })} />
                    {l.fill && (
                      <Sub>
                        <ColorRow label="Fill Colour" value={l.fillColor}
                                  onChange={(v) => onPatch(l.id, { fillColor: v })} />
                        <InlineSl label="Fill Op." min={0} max={1} step={0.01} value={l.fillOpacity}
                                  fmt={(v) => Math.round(v * 100) + '%'}
                                  onChange={(v) => onPatch(l.id, { fillOpacity: v })} />
                      </Sub>
                    )}
                  </div>
                )}
                {l.geom !== 'point' && (
                  <div style={{ marginTop: 8 }}>
                    <Tog label="STL ribbon" small checked={l.stlRibbon}
                         onChange={(v) => onPatch(l.id, { stlRibbon: v })} />
                  </div>
                )}

                {l.geom === 'point' && (
                  <IconPicker layer={l} onPatch={onPatch} onCustom={onCustomIcon}
                              overflowed={iconOverflow?.has(l.id)}
                              viewTilt={viewTilt} viewSpin={viewSpin} />
                )}

                {(() => {
                  const bucket = sources
                    ?.find((src) => src.id === l.sourceId)
                    ?.buckets.find((b) => b.key === l.bucket)
                  if (!bucket) return null
                  return l.geom === 'point' ? (
                    <LabelPicker layer={l} bucket={bucket} onPatch={onPatch}
                                 overflowed={labelOverflow?.has(l.id)}
                                 viewTilt={viewTilt} viewSpin={viewSpin} />
                  ) : null
                })()}

                {(() => {
                  const bucket = sources
                    ?.find((src) => src.id === l.sourceId)
                    ?.buckets.find((b) => b.key === l.bucket)
                  if (!bucket) return null
                  const open = featuresOpen === l.id
                  return (
                    <div style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
                      <button onClick={() => setFeaturesOpen(open ? null : l.id)}
                        data-testid={`features-toggle-${l.id}`}
                        style={{
                          width: '100%', textAlign: 'left', background: 'none', border: 'none',
                          cursor: 'pointer', color: MUTED, fontSize: 10, fontWeight: 700,
                          letterSpacing: 1, padding: 0,
                        }}>
                        {open ? '▾' : '▸'} FEATURES ({bucket.count})
                      </button>
                      {open && <FeatureList layer={l} bucket={bucket} onPatch={onPatch} />}
                    </div>
                  )
                })()}
              </Sub>
            )}
          </div>
        )
      })}

      {sources?.length > 1 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {sources.map((src) => (
            <Btn key={src.id} onClick={() => onRemoveSource(src.id)}
              title={`Remove every layer from ${src.label}`}>✕ {src.label}</Btn>
          ))}
        </div>
      )}
    </>
  )
}
