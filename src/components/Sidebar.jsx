/**
 * Custom right-hand control panel — design mirrors the original p5.js tool.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { version } from '../../package.json'
import { useStore } from '../store/useStore'
import { SOUNDSCAPE_DEFAULTS } from '../hooks/useSoundscape'
import ErosionWorker from '../utils/erosion.worker?worker'
import { HYPSO_LAYER_IDS } from '../utils/drawModes'
import { randomPreset } from '../utils/presetGenetics'
import { bboxToWgs84, classifyCRS, crsDisplayName, isInvertible, metresPerWorldUnit, wgs84ExtentKm } from '../utils/geoCoords'
import { DEFAULT_OSM_CATEGORIES, OSM_CATEGORIES, OSM_DETAIL_LABEL, detailTierFor } from '../utils/osmCategories'
import { OSM_ATTRIBUTION, fetchOsm } from '../utils/osmFetch'
import { featureLabel, toggleHidden } from '../utils/vectorLayers'
import { CANCELLED } from '../utils/pacing'
import { iconUrl, loadIconManifest } from '../utils/iconCatalogue'
import { GRADIENT_PRESETS } from '../utils/gradientPresets'
import { STYLE_DEF } from '../defaults'
import { TRACK_PROJECTIONS, detectTrackBpm, getProjection } from '../utils/trackProjections'
import { loadSingleLineManifest } from '../utils/textGeometry'
import { GradientPicker } from './GradientPicker'
import { Histogram } from './Histogram'
import { AudioMeter } from './AudioMeter'
import { AudioTransport } from './AudioTransport'
import { PAPERS, paperRatioLabel } from '../utils/frame'
import { SpectrogramView } from './SpectrogramView'
import {
  ACCENT, ACCENT_DEEP, BG, BORDER, DIM, MUTED, SURF, TEXT, W,
  ColorRow, ExpBtn, HelpBox, HelpBtn, InlineSl, PanelStyles, Section, SegRow,
  RangeSl, Sl, Sub, Tog, TogColor, Btn,
} from './panel/ui'
import { SectionFilter, sectionMatches } from './panel/filter'
import { ModeMark } from './panel/modeMarks'

/**
 * Square-law mapping for the flock-size slider.
 *
 * The range is 100 to 100 000 birds — 1000×. Linear, that puts everything anyone
 * normally wants inside the first 2% of the track, where 1 500 and 3 000 are one
 * pixel apart. Squaring the handle position spends half the track below 25 000
 * and keeps the steps at the top (~630 birds) far finer than the eye can tell.
 *
 * The round-trip has to be exact or the readout lies: the panel shows
 * `birdCount(birdSlider(count))`, so any position that does not map back to
 * itself displays a number the flock does not have. 317² is 100 489, which the
 * cap trims to 100 000 — and `round(√100000)` is 316, which reads back as
 * 99 900. Hence the explicit top case: only the last position means "all of
 * them", and every position below it is its own exact inverse.
 */
const BIRD_MAX = 100000
const birdCount  = (v) => Math.min(BIRD_MAX, Math.round(v * v / 100) * 100)
const birdSlider = (n) =>
  n >= BIRD_MAX ? 317 : Math.max(10, Math.min(316, Math.round(Math.sqrt(n))))

/**
 * What each section answers to beyond its own title.
 *
 * Stated rather than scraped: a mode's parameters are only mounted once the mode
 * is switched on, so a filter built from what happens to be rendered could never
 * find "azimuth" while Hillshade is off — which is exactly when someone is
 * looking for it. Keep a section's own words here when you add controls to it.
 */
const SECTION_TERMS = {
  'Terrain':          'resolution elevation scale blur jitter min max cut hypsometric integral raw greyscale heightmap',
  'Levels':           'shadows highlights histogram black white point contrast',
  'View':             'tilt zoom rotation supersampling auto-rotate spin guides paper frame page sheet margin aspect portrait landscape a4 letter',
  'Camera':           'orthographic perspective focal length lens pan dolly',
  'Terrain Style':    'fill mesh occlusion ghost x-ray background gradient sky paper colour color',
  'Hillshade':        'sun azimuth altitude shadows relief lambert penumbra softness multidirectional light',
  'Slope Shading':    'steepness gradient two-colour incline',
  'Water Fill':       'flood level sea lake opacity',
  'Aspect Map':       'slope direction hue wheel compass facing',
  'Presets':          'styles looks surprise me random roll seed thumbnails',
  'Mode: Lines':      'ridgelines parallel spacing shift angle bearing unknown pleasures dash weight opacity',
  'Mode: Crosshatch': 'hatch two directions perpendicular angle spacing',
  'Mode: Pillars':    'extrusion cuboid cylinder columns pins bars',
  'Mode: Contours':   'isolines marching squares interval chaikin smoothing form lines closing metres labels heights elevation numbers annotate',
  'Mode: Hachure':    'slope strokes ticks direction swiss',
  'Mode: Flow':       'drainage euler streamlines water paths',
  'Mode: Network':    'strahler stream order flow accumulation rivers',
  'Mode: Pencil':     'laplacian curvature shading sketch graphite',
  'Mode: Ridge':      'hessian crest eigenvalue peaks arete',
  'Mode: Valley':     'topographic position index tpi troughs gully',
  'Mode: Stipple Dots': 'dots density stochastic seed slope elevation pointillism',
  'Mode: Isophotes':  'illumination contours constant light reflection lines sun isophote',
  'Mode: Engraving':  'copperplate illumination cross-hatch shadows stacked directions',
  'Mode: Curvature':  'streamlines principal direction field wrap shape',
  'Mode: Rock & Scree': 'swisstopo cliff hachures debris dots talus seed',
  'Vector Layers':    'openstreetmap osm overpass roads water rail landuse buildings lifts peaks gpx geojson track labels icons names heights stacking order dash ribbon',
  'Particles':        'hologram point cloud murmurations boids flock birds predator roost scan noise audio',
  'Texture':          'image overlay blend mode scale offset',
  'Mirror':           'symmetry kaleidoscope reflect octants axis',
  'Soundscapes':      'audio mp3 wav spectrogram fft playback freeze disc similarity weave strata noise gate music',
  'Hydraulic Erosion':'droplets rain simulation inertia capacity deposition evaporation weathering',
  'Export':           'svg png stl webm plotter print heightmap preset save load download video recording',
  'Analysis':         'elevation profile cross-section transect chart a b pins',
}

/**
 * The preset the app opens on for a visitor with no stored session.
 *
 * Chosen for what it shows rather than what it costs: hypsometric fill, contours
 * and crosshatch over a warm paper ground, which is four of the tool's ideas at
 * once. Checked at full size rather than by its thumbnail — several presets that
 * read beautifully at 190 px are a thin scatter across a 1168 px plate.
 */
const OPENING_PRESET = 'Alpine Survey'

/** m:ss for the Soundscapes transport readout. */
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
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
      background: 'rgba(0,0,0,0.2)', border: `1px solid ${BORDER}`,
      borderRadius: 5, padding: '4px 8px',
    }}>{children}</div>
  )
  const warn = '#f97316'
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

function GripIcon() {
  return (
    <svg width="10" height="13" viewBox="0 0 10 13" fill="currentColor" aria-hidden="true">
      {[2, 6.5, 11].map((cy) => (
        <g key={cy}><circle cx="2" cy={cy} r="1.1" /><circle cx="8" cy={cy} r="1.1" /></g>
      ))}
    </svg>
  )
}

/**
 * Drag-to-reorder for the layer stack.
 *
 * Pointer events with capture rather than HTML5 drag-and-drop: the sidebar is a
 * scrolling panel inside a WebGL page, and the native drag image, drop targets
 * and `dragover` bookkeeping buy nothing here that `setPointerCapture` does not
 * do in a third of the code. It also keeps the drag working with a pen or a
 * finger, which HTML5 dragging does not.
 *
 * Rows are measured live rather than at drag start. They have to be: the list
 * reflows the instant a move is committed, and an expanded layer is several
 * times the height of a collapsed one, so a cached set of boxes is wrong from
 * the first swap onwards.
 */
function useStackDrag(layers, onReorder) {
  const rows = useRef(new Map())
  const [dragging, setDragging] = useState(null)

  const bindRow = useCallback((id) => (el) => {
    if (el) rows.current.set(id, el)
    else rows.current.delete(id)
  }, [])

  const start = (e, id) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(id)
  }

  const move = (e) => {
    if (!dragging) return
    const from = layers.findIndex((l) => l.id === dragging)
    if (from < 0) return
    const y = e.clientY

    // A row is crossed at its midpoint, not at its edge. Swapping on entry
    // reads fine while every row is the same height and falls apart as soon as
    // one is expanded: the shorter row lands back under the cursor and the list
    // oscillates between two orders for as long as you hold still.
    let target = from
    for (let i = 0; i < layers.length; i++) {
      if (i === from) continue
      const r = rows.current.get(layers[i].id)?.getBoundingClientRect()
      if (!r) continue
      if (i < from) {
        // Going up, the topmost row whose upper half we have reached wins…
        if (target === from && y < r.bottom - r.height / 2) target = i
      } else if (y > r.top + r.height / 2) {
        // …going down, the lowest one.
        target = i
      }
    }
    if (target !== from) onReorder(dragging, target)
  }

  const end = (e) => {
    if (!dragging) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDragging(null)
  }

  return { dragging, bindRow, start, move, end }
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
      <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, marginBottom: 4, letterSpacing: 1 }}>ICON</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 2, marginBottom: 8 }}>
        {/* Back to a plain dot. */}
        <button onClick={() => set({ icon: null })} title="No icon — draw a dot"
          data-testid={`icon-none-${layer.id}`}
          style={{
            aspectRatio: '1/1', display: 'grid', placeItems: 'center', borderRadius: 3, cursor: 'pointer',
            fontSize: 11, background: layer.icon ? SURF : ACCENT, color: layer.icon ? MUTED : '#fff',
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
              color: layer.icon === 'custom' ? '#fff' : MUTED,
              border: `1px solid ${layer.icon === 'custom' ? ACCENT_DEEP : BORDER}`,
            }}>SVG</button>
        )}
      </div>

      <div style={{ fontSize: 10, color: MUTED, marginBottom: 8, lineHeight: 1.5 }}>
        Map &amp; terrain marks. Anything else is an SVG away.
      </div>

      <button className="hmload" onClick={() => onCustom(layer.id)} data-testid={`icon-upload-${layer.id}`}
        style={{
          width: '100%', padding: 4, marginBottom: 8, background: SURF, color: '#a1a1aa',
          border: `1px dashed ${BORDER}`, borderRadius: 5, cursor: 'pointer', fontSize: 10,
        }}>↑ Custom SVG</button>

      {overflowed && (
        <div style={{ fontSize: 10, color: '#f97316', marginBottom: 4, lineHeight: 1.5 }}>
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
        color: active ? '#fff' : DIM,
        border: `1px solid ${active ? ACCENT_DEEP : BORDER}`,
      }}>{label}</button>
  )

  const align = (value, label) => (
    <button key={value} onClick={() => set({ labelAlign: value })}
      data-testid={`label-align-${value}-${layer.id}`}
      style={{
        flex: 1, padding: '4px 0', fontSize: 10, cursor: 'pointer', borderRadius: 3,
        background: layer.labelAlign === value ? ACCENT_DEEP : SURF,
        color: layer.labelAlign === value ? '#fff' : DIM,
        border: `1px solid ${layer.labelAlign === value ? ACCENT_DEEP : BORDER}`,
      }}>{label}</button>
  )

  return (
    <div style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
      <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, marginBottom: 4, letterSpacing: 1 }}>LABELS</div>

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
              <select value={layer.labelFont ?? 'HersheySans1'}
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
            <div style={{ fontSize: 10, color: '#f97316', marginTop: 4, lineHeight: 1.5 }}>
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
const MAX_FEATURE_ROWS = 200

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
                background: isSel ? 'rgba(249,115,22,0.18)' : isHover ? 'rgba(59,130,246,0.18)' : 'transparent',
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
 * The Vector Layers panel — sources at the top, one editable row per layer below.
 *
 * Deliberately additive: it replaces the old GPX Track section in place and
 * leaves the fourteen draw-mode sections exactly as they are. The rows here are
 * a list of *data* layers, which is a different thing from the draw modes and is
 * why it does not try to be a unified layer stack.
 */
function VectorLayersPanel({
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
    setStatus('Querying OpenStreetMap…')
    onError(null)
    try {
      const { source, cached } = await fetchOsm(wgs, picked, {
        detail,
        signal: ctrl.signal,
        onProgress: (_f, label) => label && setStatus(label),
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
      if (!fetching) setStatus(null)
    }
  }

  const btn = {
    padding: 8, background: SURF, color: '#a1a1aa', border: `1px dashed ${BORDER}`,
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
                  background: on ? ACCENT_DEEP : SURF, color: on ? '#fff' : MUTED,
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
            background: fetching ? SURF : ACCENT, color: fetching ? MUTED : '#fff',
            border: `1px solid ${fetching ? BORDER : ACCENT}`, opacity: canQuery && picked.length ? 1 : 0.4,
          }}>
          {fetching ? '✕ Cancel' : 'Fetch from OpenStreetMap'}
        </button>

        {fetching && status && (
          <div style={{ fontSize: 10, color: MUTED, marginTop: 4, textAlign: 'center' }}>{status}</div>
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
                {/* The very same control block the fourteen draw modes use. A
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

function HypsometricRow({ value }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:10, color:MUTED }}>
        <span style={{ display:'flex', alignItems:'center' }}>
          Hypso. Integral
          <HelpBtn active={show} onClick={() => setShow(s => !s)} />
        </span>
        <span style={{ color:'#a1a1aa', fontFamily:'monospace' }}>{value.toFixed(3)}</span>
      </div>
      {show && (
        <div style={{
          fontSize: 10, color: MUTED, background: 'rgba(0,0,0,0.2)',
          padding: '4px 8px', borderRadius: 5, marginBottom: 8,
          border: `1px solid ${BORDER}`, lineHeight: 1.6
        }}>
          <div style={{ marginBottom: 4 }}>HI = (mean − min) / (max − min)</div>
          <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', columnGap: 8, rowGap: 2 }}>
            <span style={{ color:'#a1a1aa' }}>&gt; 0.6</span><span>young / rugged — most area is high</span>
            <span style={{ color:'#a1a1aa' }}>≈ 0.5</span><span>equilibrium</span>
            <span style={{ color:'#a1a1aa' }}>&lt; 0.4</span><span>mature / eroded — few peaks remain</span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Renders a whole-track projection's parameter schema.
 *
 * Five projections carrying up to ten settings each would be several hundred
 * lines of near-identical JSX written out by hand, and every new projection
 * would mean writing more of it. The descriptors map onto the control atoms
 * above; anything carrying a `group` is drawn as a chip grid instead, because a
 * column of ten labelled switches is a wall the strata list would otherwise be.
 */
function ProjectionParams({ params, values, onChange }) {
  const get = (p) => values?.[p.key] ?? p.value
  const out = []

  for (let i = 0; i < params.length; i++) {
    const p = params[i]
    if (p.group) {
      const chips = []
      while (i < params.length && params[i].group === p.group) chips.push(params[i++])
      i--
      out.push(
        <div key={p.group} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>{p.group}</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 2 }}>
            {chips.map((c) => {
              const on = !!get(c)
              return (
                <Btn key={c.key} variant="toggle" on={on} title={c.help} data-testid={`proj-${c.key}`}
                  onClick={() => onChange(c.key, !on)}
                  style={{ padding:'4px 0', textTransform:'uppercase' }}>{c.label}</Btn>
              )
            })}
          </div>
        </div>
      )
      continue
    }
    if (p.type === 'tog') {
      out.push(<Tog key={p.key} small label={p.label} help={p.help} checked={!!get(p)}
        onChange={(v) => onChange(p.key, v)} />)
    } else if (p.type === 'seg') {
      out.push(<SegRow key={p.key} label={p.label} help={p.help} options={p.options} value={get(p)}
        onChange={(v) => onChange(p.key, v)} />)
    } else {
      out.push(<InlineSl key={p.key} testId={`proj-${p.key}`} label={p.label} help={p.help}
        min={p.min} max={p.max} step={p.step} value={get(p)} fmt={p.fmt} onChange={(v) => onChange(p.key, v)} />)
    }
  }
  return out
}

// ── Helper for per-mode styling ───────────────────────────────────────────────
function ModeStyleOverride({ prefix, style, ss, label = 'LINE STYLE', showDash = true, showHypso = true, gradientStops, setGradientStops }) {
  const isHypso = style[`hypso${prefix}`]
  return (
    <div style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
      <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, marginBottom: 4, letterSpacing: 1 }}>{label}</div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: DIM }}>Base Color</span>
        <input type="color" className="hmc" value={style[`color${prefix}`]} onChange={e => ss({ [`color${prefix}`]: e.target.value })} />
      </div>
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

      {/* Hypsometric is off the table for vector layers: a road has no elevation
          of its own, so the tint would have to read the ground under it, which
          is a different thing from what the draw modes mean by it. */}
      {showHypso && <div style={{ marginTop: 8 }}>
        <Tog label="Hypsometric" small checked={isHypso} onChange={v => ss({ [`hypso${prefix}`]: v })} />
        {isHypso && (
          <Sub>
            <div style={{ display:'flex', gap:2, marginBottom:4 }}>
              {['Elevation', 'Slope', 'Aspect'].map(m => (
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
export function Sidebar({
  terrain, setTerrain,
  style,   setStyle,
  points,  setPoints,
  view,    setView,
  gradientStops, setGradientStops,
  bgGradientStops, setBgGradientStops,
  heightmapPixels, heightmapFilename,
  textureImage, setTextureImage,
  loadFromPicker, loadGeoTiffFromPicker,
  soundscape, onSoundscapeFit, flockAudio,
  geoTiffElevMin, geoTiffElevMax, geoTiffCRS, geoTiffCRSName,
  geoTiffBbox,
  loadGpxFromPicker, loadGeoJsonFromPicker,
  vectorSources, vectorLayers, vectorCoverage, vectorError,
  onPatchVectorLayer, onRemoveVectorLayer, onReorderVectorLayer, onRemoveVectorSource,
  onAdoptVectorSource, onVectorError, vectorIdentify, onVectorIdentify,
  onCustomIcon, iconOverflow, labelOverflow,
  onCameraPreset,
  onSvg, onPng, onPngAlpha, onStl, onHeightmap,
  onWebmToggle, webmActive,
  webmDuration, setWebmDuration,
  onSavePreset, onLoadPreset,
  externalPresets,
  onReset,
  sessionRestored,
  baseZoom = 1,
  lineGeo, surfaceGeo, terrainData,
  hypsometricIntegral,
  profileMode, profileClicks, onProfileMode,
  onEditHeightmap, editSummary, onClearEdit,
  open: openProp, onOpenChange, onPristine,
}) {
  // Owned by App, because the canvas is inset to whatever this is. Falls back to
  // local state so the panel still works if the props are ever left off.
  const [openLocal, setOpenLocal] = useState(true)
  const open = openProp ?? openLocal
  // Read through a ref so the setter can stay stable: the backslash shortcut
  // binds a window listener once, and a setter with a fresh identity every
  // render would tear the listener down and rebuild it just as often.
  const openRef = useRef(open)
  openRef.current = open
  const setOpen = useCallback((next) => {
    const value = typeof next === 'function' ? next(openRef.current) : next
    setOpenLocal(value)
    onOpenChange?.(value)
  }, [onOpenChange])
  const [filter, setFilter] = useState('')
  // The bundled stroke faces, for the contour-label face picker. `LabelPicker`
  // fetches the same manifest for the vector labels; `loadSingleLineManifest`
  // caches at module level, so asking twice costs one request.
  const [singleLineFonts, setSingleLineFonts] = useState([])
  useEffect(() => { loadSingleLineManifest().then(setSingleLineFonts) }, [])
  const q = filter.trim().toLowerCase()
  const filterCtx = useMemo(() => ({ q, terms: SECTION_TERMS }), [q])
  // Counted with the same predicate each Section uses, over the same index it
  // reads — so the number and the list cannot disagree. A section whose title is
  // missing from SECTION_TERMS would still slip past this, which is what the
  // development warning in `Section` is for.
  const matchCount = useMemo(
    () => (q ? Object.entries(SECTION_TERMS).filter(([t, w]) => sectionMatches(t, w, q)).length : 0),
    [q]
  )
  const [sec, setSec]       = useState({
    // Presets open, Levels closed: the grid of 56 looks is the most persuasive
    // thing in the panel and it used to be the tenth section down, collapsed,
    // below four surface overlays. A histogram is not what anyone needs first.
    terrain: true, levels: false, view: true, camera: false, presets: true, style: true,
    modeLines: true, modeCross: false, modePillars: false, modeContours: false,
    modeHachure: false, modeFlow: false, modeDag: false, modePencil: false,
    modeRidge: false, modeValley: false, modeStipple: false,
    modeIso: false, modeEngrave: false, modeCurv: false, modeSwiss: false,
    hillshade: false, slopeShade: false, vectorLayers: false,
    waterFill: false, aspectMap: false, analysis: false,
    points: false, texture: false, mirror: false, erosion: false, export: true,
    soundscapes: false,
  })

  // --- Erosion State ---
  const [eIters,     setEIters]     = useState(50000)
  const [eRadius,    setERadius]    = useState(3)
  const [eInertia,   setEInertia]   = useState(0.1)
  const [eCapacity,  setECapacity]  = useState(4)
  const [eErode,     setEErode]     = useState(0.3)
  const [eDeposit,   setEDeposit]   = useState(0.3)
  const [eEvap,      setEEvap]      = useState(0.01)
  const [isEroding,       setIsEroding]       = useState(false)
  const [erosionProgress, setErosionProgress] = useState(0)
  const [lastPixels,      setLastPixels]      = useState(null)
  // Erosion's own failure line. A run that dies used to clear its progress bar
  // and say nothing, which is indistinguishable from a run that did nothing —
  // and erosion is subtle enough that "nothing happened" is a plausible result.
  const [erosionError,    setErosionError]    = useState(null)
  const erosionWorkerRef = useRef(null)

  // --- Discovery State ---
  const [lastPreset,  setLastPreset]  = useState(null)   // name of the last applied preset
  // Whether anything has been changed since that preset was applied. The tile
  // stays highlighted — it is still where this look started, and that is worth
  // knowing — but it says so rather than claiming the settings still match.
  const [presetEdited, setPresetEdited] = useState(false)
  const [rollSeed,    setRollSeed]    = useState(null)   // seed behind the current roll
  const [rollHistory, setRollHistory] = useState([])
  // Presets whose thumbnail failed to load, so the tile falls back to a label.
  const [noThumb,     setNoThumb]     = useState(() => new Set())
  
  const setPixels = useStore(s => s.setPixels)
  const heightmapWidth = useStore(s => s.heightmapWidth)
  const heightmapHeight = useStore(s => s.heightmapHeight)

  const handleRunErosion = () => {
    if (!heightmapPixels || isEroding) return
    setLastPixels(new Float32Array(heightmapPixels))
    setIsEroding(true)
    setErosionProgress(0)
    setErosionError(null)

    const worker = new ErosionWorker()
    erosionWorkerRef.current = worker

    worker.onmessage = (e) => {
      const { progress, result, error } = e.data
      if (progress !== undefined) { setErosionProgress(progress); return }
      if (result) setPixels(result)
      if (error) {
        console.error('[ErosionWorker]', error)
        setErosionError(error)
      }
      setIsEroding(false)
      setErosionProgress(0)
      worker.terminate()
      erosionWorkerRef.current = null
    }

    // A droplet simulation that throws out — an allocation the raster is too
    // large for, most likely — never reaches onmessage, so without this the
    // button stayed stuck on "Eroding… 0%" with no way back but a reload.
    const die = (msg) => {
      console.error('[ErosionWorker]', msg)
      setErosionError(msg)
      setIsEroding(false)
      setErosionProgress(0)
      worker.terminate()
      if (erosionWorkerRef.current === worker) erosionWorkerRef.current = null
    }
    worker.onerror = (ev) => die(ev.message || 'the worker stopped.')
    worker.onmessageerror = () => die('the result could not be read.')

    worker.postMessage({
      pixels: heightmapPixels,
      width: heightmapWidth,
      height: heightmapHeight,
      iterations: eIters,
      params: {
        erosionRadius: eRadius,
        inertia: eInertia,
        sedimentCapacityFactor: eCapacity,
        erodeSpeed: eErode,
        depositSpeed: eDeposit,
        evaporateSpeed: eEvap
      }
    })
  }

  /**
   * Abandon a run in progress.
   *
   * Terminating is safe here in a way it is not for the geometry worker: the
   * droplet simulation posts progress and then one final result, and `setPixels`
   * is only ever called with that result — so a run killed part-way has written
   * nothing, and the raster is exactly as it was. There is no partial state to
   * roll back and no cached raster to lose.
   *
   * Erosion is the third operation long enough to need a progress bar (50 000
   * droplets by default) and was the only one of the three with no way out. SVG
   * and STL have shared an overlay, a progress channel and a Cancel all along.
   */
  const handleCancelErosion = () => {
    if (!erosionWorkerRef.current) return
    erosionWorkerRef.current.terminate()
    erosionWorkerRef.current = null
    setIsEroding(false)
    setErosionProgress(0)
    // No error line: abandoning a run is the user's own decision, and the
    // "Erosion failed" box would be reporting their click back to them.
    setErosionError(null)
    // The pre-run snapshot is dropped too. Undo means "put back what erosion
    // changed", and nothing changed — leaving it armed would offer to restore a
    // raster identical to the one on screen.
    setLastPixels(null)
  }

  const handleUndoErosion = () => {
    if (!lastPixels) return
    setPixels(lastPixels)
    setLastPixels(null)
  }

  useEffect(() => () => { erosionWorkerRef.current?.terminate() }, [])

  const handleTexturePicker = () => {
    // Restrict to formats THREE.TextureLoader (an <img> under the hood) can decode.
    // 'image/*' let users pick TIFFs, which browsers can't decode and fail to load.
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif' })
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (re) => setTextureImage(re.target.result)
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const tog = (name) => setSec(s => ({ ...s, [name]: !s[name] }))

  // "Show me the plate with nothing over it" is the most-wanted action in a tool
  // that makes pictures, and it used to mean aiming at an unlabelled 22 px glyph.
  // Backslash is unclaimed by the rest of the app and by the browser.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = e.target.tagName
      // Fields only. Excluding BUTTON as well — which Controls.jsx does, because
      // Space activates a focused button — killed this shortcut outright once
      // section headers became buttons: clicking one left it focused, and `\`
      // stayed dead until focus moved. Backslash activates nothing.
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.code === 'Backslash') { e.preventDefault(); setOpen(o => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  // Soundscapes controller. Aliased because `ss` is already the style setter,
  // and defaulted so the section degrades to an inert upload button if the
  // prop is ever omitted rather than throwing on first render.
  // The Particles section drives playback too now, so the no-soundscape
  // fallback has to answer for the transport as well as the options — a missing
  // prop would otherwise crash on the first click of the audio block's play
  // button rather than degrading to an inert control.
  const snd = soundscape ?? {
    opts: SOUNDSCAPE_DEFAULTS, loadFromPicker: () => {}, setOpts: () => {}, setProjParam: () => {},
    toggle: () => {}, isPlaying: false, fileName: '',
  }
  const fa = flockAudio ?? {
    loadFromPicker: () => {}, toggle: () => {}, release: () => {},
    isPlaying: false, isAnalyzing: false, ready: false, fileName: '', progress: 0, error: null,
    liveRef: { current: null }, duration: 0, loop: true,
    seek: () => {}, restart: () => {}, skip: () => {}, setLoop: () => {},
  }

  // Whole-track projection the freeze button will render.
  const projection = getProjection(snd.opts?.projection)
  // Only the weave shows a tempo, and detecting one is a full pass over the
  // spectrogram — not something to run on every unrelated re-render.
  const detectedBpm = useMemo(
    () => (projection.id === 'weave' && snd.spec ? detectTrackBpm(snd.spec) : 0),
    [projection.id, snd.spec]
  )

  // Every style or particle change that did not come from applyPreset means the
  // user has left the preset behind. applyPreset writes through setStyle/setPoints
  // directly, so it does not trip this.
  // Has the user changed anything yet? The opening preset waits on 56 preset
  // files, so it can arrive a second or more after the panel is usable — and
  // applying it then would overwrite whatever had already been touched. Set by
  // every parameter setter below, and read by the effect that would apply it.
  const userTouched = useRef(false)
  const leftPreset = () => { userTouched.current = true; if (lastPreset) setPresetEdited(true) }
  // applyPreset writes both gradients, so changing one by hand is as much a
  // departure from the preset as moving a slider. These wrap the setters for
  // the panel; applyPreset keeps using the raw props, which is what stops it
  // marking its own work as an edit.
  const sg  = (v) => { leftPreset(); setGradientStops(v) }
  const sbg = (v) => { leftPreset(); setBgGradientStops(v) }
  const st = (v) => { leftPreset(); setTerrain(p => ({ ...p, ...v })) }
  const ss = (v) => { leftPreset(); setStyle(p => ({ ...p, ...v })) }
  const sp = (v) => { leftPreset(); setPoints(p => ({ ...p, ...v })) }
  const sv = (v) => { leftPreset(); setView(p => ({ ...p, ...v })) }

  // The panel's own share of a reset: the preset tiles have to stop pointing at
  // a look the settings no longer hold.
  const handleResetAll = () => {
    setLastPreset(null)
    setPresetEdited(false)
    setRollSeed(null)
    setRollHistory([])
    // The disclosures follow the style back, as they follow it anywhere else.
    // applyPreset has always re-synced them; a reset did not, so a look that had
    // switched Lines off left that section collapsed — and the reset then turned
    // Lines back on behind a shut disclosure, which is the one state this panel
    // is not supposed to be able to reach.
    syncSectionsToStyle(STYLE_DEF)
    onReset?.()
  }

  const hasGeoTiff  = geoTiffElevMin != null && geoTiffElevMax != null
  const crsInfo     = classifyCRS(geoTiffCRS)

  /*
   * THE CONTOUR INTERVAL IN REAL METRES.
   *
   * The stored interval is in world units, because that is what the marching
   * squares in the worker threshold against and what a preset written on a PNG
   * means. But a slider labelled "(m)" has to be metres, and a world unit is
   * only worth a metre by coincidence: it is the raster's elevation range,
   * clipped by Shadows/Highlights, spread over 100 × the exaggeration.
   *
   * So the metres are *derived*, both ways — displayed from the stored value,
   * and divided back out of whatever the user types. Nothing new is stored,
   * which is what keeps presets, sessions and the worker out of it.
   *
   * The consequence, and it is a real one: the exaggeration slider is part of
   * the conversion, so moving it re-reads this number (and moves the contours
   * with it, exactly as it always has). The readout is never stale — it says
   * what the lines on screen are actually worth — but it is not a setting that
   * pins itself. The help text says so.
   *
   * `terrainData` is the built terrain rather than the panel's own state: its
   * `elevScale` is the effective one (intrinsic + the user's offset), and its
   * elevation range is what the raster actually holds after a crop, so the
   * bounds below track the ground rather than a nominal full-range raster.
   */
  const mPerWorld = hasGeoTiff && terrainData
    ? metresPerWorldUnit(geoTiffElevMin, geoTiffElevMax, terrainData.elevScale,
                         terrain.blackPoint, terrain.whitePoint)
    : null
  const reliefM = mPerWorld ? (terrainData.maxElev - terrainData.minElev) * mPerWorld : 0
  // Bounds from the relief, not fixed. A flat 0.1 m floor is a reasonable finest
  // line on a quarry wall and 17 000 contours on an alpine sheet, so what the
  // ends are pinned to is a *count* — about a thousand lines at one end, two at
  // the other — which stays sensible on both.
  const roundUp = (v) => Math.max(0.1, Math.ceil(v * 10) / 10)
  const intervalMin = reliefM > 0 ? roundUp(reliefM / 1000) : 0.1
  const intervalMax = reliefM > 0 ? Math.max(intervalMin + 0.1, Math.floor(reliefM * 5) / 10) : 100
  const metreInterval = mPerWorld ? style.intervalContours * mPerWorld : 0

  const syncSectionsToStyle = (newStyle) => {
    setSec(prev => ({
      ...prev,
      modeLines:    !!newStyle.enabledLines,
      modeCross:    !!newStyle.enabledCross,
      modePillars:  !!newStyle.enabledPillars,
      modeContours: !!newStyle.enabledContours,
      modeHachure:  !!newStyle.enabledHachure,
      modeFlow:     !!newStyle.enabledFlow,
      modeDag:      !!newStyle.enabledDag,
      modePencil:   !!newStyle.enabledPencil,
      modeRidge:    !!newStyle.enabledRidge,
      modeValley:   !!newStyle.enabledValley,
      modeStipple:  !!newStyle.enabledStipple,
      modeIso:      !!newStyle.enabledIso,
      modeEngrave:  !!newStyle.enabledEngrave,
      modeCurv:     !!newStyle.enabledCurv,
      modeSwiss:    !!newStyle.enabledSwiss,
    }))
  }

  const applyPreset = (preset, name = null) => {
    setStyle(prev => ({ ...prev, ...preset.style }))
    // Particle params live in the points state, not style — without this a
    // preset can never drive the hologram field. All presets carry a points
    // block with showPoints, so switching presets also turns particles off.
    if (preset.points) setPoints(prev => ({ ...prev, ...preset.points }))
    if (preset.gradientStops) setGradientStops(preset.gradientStops)
    if (preset.bgGradientStops) setBgGradientStops(preset.bgGradientStops)
    syncSectionsToStyle(preset.style)
    setLastPreset(name)
    setPresetEdited(false)
  }

  /**
   * A restored session arrives with modes already on — open their sections.
   *
   * `applyPreset` has always done this, because a look that switches four modes
   * on and leaves their controls behind collapsed disclosures is a look you
   * cannot adjust. Seeding the same style straight into React state at mount
   * skipped it, so a reload left the terrain drawing Rock & Scree with nothing
   * on screen to say where its parameters were. Mount only: after that the
   * sections are the user's to open and close.
   */
  useEffect(() => {
    if (sessionRestored) syncSectionsToStyle(style)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * The look the app opens on.
   *
   * Bare defaults are a monochrome line drawing on white: correct, and the least
   * interesting thing this tool can do. A first-time visitor decides in about two
   * seconds, and the picture they landed on was the one picture that shows none
   * of the range. Opening on a real preset costs nothing — this one carries no
   * particles, no ray-marched shadows and no sky-view pass, so it is the same
   * work the default was already doing — and it puts the Presets grid's selected
   * tile on screen, which is how anyone learns the grid is there.
   *
   * The *defaults* are untouched: Reset all still goes to them, and so does the
   * randomiser's starting point. This is an opening state, not a new baseline.
   * A restored session wins, because that is somebody's actual work.
   */
  const openingApplied = useRef(false)
  useEffect(() => {
    if (openingApplied.current || sessionRestored) return
    if (userTouched.current) { openingApplied.current = true; return }   // too late to be an opening
    const preset = externalPresets?.[OPENING_PRESET]
    if (!preset) return                       // manifest still in flight
    openingApplied.current = true
    applyPreset(preset, OPENING_PRESET)
    // Not the user's doing, so it must not be stored as their session.
    onPristine?.()
    // applyPreset is rebuilt every render and the guard above is what makes this
    // run once; listing it would re-apply the preset over the user's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPresets, sessionRestored, onPristine])

  // ── Discovery: rolling a look ─────────────────────────────────────────────
  const presetNames = Object.keys(externalPresets || {})

  const roll = (seed) => {
    const preset = randomPreset(seed)
    applyPreset(preset, null)
    return preset
  }

  const handleSurprise = () => {
    const seed = Math.floor(Math.random() * 0xffffffff)
    if (rollSeed != null) setRollHistory(h => [...h.slice(-9), rollSeed])
    setRollSeed(seed)
    roll(seed)
  }

  // Step back through recent rolls. The seed *is* the look, so history is a
  // list of integers rather than a stack of 250-key snapshots.
  //
  // Read outside the updater rather than inside it: applying the preset is a
  // side effect, and React is free to call a state updater more than once.
  const handleUnroll = () => {
    if (!rollHistory.length) return
    const prev = rollHistory[rollHistory.length - 1]
    setRollHistory(h => h.slice(0, -1))
    setRollSeed(prev)
    roll(prev)
  }

  // Stats
  let totalLinePos = 0
  let totalFillIdx = 0
  if (Array.isArray(lineGeo)) {
    for (const L of lineGeo) {
      if (L.positions) totalLinePos += L.positions.length
      // Area fills are drawn triangles like the surface is, so they belong in
      // the triangle count rather than in a number nothing reports.
      if (L.fills) totalFillIdx += L.fills.indices.length
    }
  }

  const segs  = lineGeo    ? (totalLinePos / 6).toLocaleString()     : '–'
  const verts = lineGeo    ? (totalLinePos / 3).toLocaleString()     : '–'
  const tris  = surfaceGeo ? ((surfaceGeo.indices.length + totalFillIdx) / 3).toLocaleString() : '–'
  const grid  = terrainData ? `${terrainData.cols}×${terrainData.rows}` : '–'

  return (
    <>
      <PanelStyles />

      <button type="button" data-testid="sidebar-toggle" onClick={() => setOpen(o => !o)}
        aria-expanded={open} aria-controls="hm-panel"
        title={open ? 'Hide the panel  \\' : 'Show the panel  \\'}
        aria-label={open ? 'Hide the panel' : 'Show the panel'}
        style={{
          position:'fixed', right: open ? W : 0, top:'50%', transform:'translateY(-50%)',
          width:22, height:64, background: BG, border:`1px solid ${BORDER}`, borderRight:'none',
          borderRadius:'6px 0 0 6px',
          cursor:'pointer', zIndex:1001, userSelect:'none',
          display:'flex', alignItems:'center', justifyContent:'center',
          color: MUTED, fontSize:11, boxShadow:'-2px 0 8px rgba(0,0,0,.35)',
          transition:'right .22s cubic-bezier(.4,0,.2,1)',
        }}>{open ? '▶' : '◀'}</button>

      <aside id="hm-panel" aria-label="Controls" style={{
        position:'fixed', right:0, top:0, width:W, height:'100%',
        background: BG, color: TEXT, zIndex:1000,
        display:'flex', flexDirection:'column',
        transform: open ? 'none' : `translateX(${W}px)`,
        transition:'transform .22s cubic-bezier(.4,0,.2,1)',
        boxShadow:'-3px 0 16px rgba(0,0,0,.4)',
        fontFamily:'system-ui,-apple-system,sans-serif',
      }}>
        <div style={{ padding:'12px 12px 12px', borderBottom:`1px solid ${BORDER}`, flexShrink:0, display:'flex', alignItems:'baseline', gap:8 }}>
          <h1 style={{ fontFamily:"'Space Mono', monospace", fontSize:13, fontWeight:700, letterSpacing:'-0.02em', color:'#F0EBE3', margin:0 }}>erzberg</h1>
          <span style={{ fontSize:10, color: MUTED, fontWeight:600, opacity: 0.8 }}>v{version}</span>
          <a
            href="https://github.com/sorny/erzberg"
            target="_blank"
            rel="noopener noreferrer"
            title="View on GitHub"
            style={{ display:'flex', alignItems:'center', color: MUTED, opacity:0.8, alignSelf:'center', textDecoration:'none' }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#F0EBE3' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.color = MUTED }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          <div style={{ flex: 1 }} />
          {/* "Reset" alone taught the wrong lesson: the camera preset row and the
              mirror block both use the word for something harmless, and this one
              throws away every setting in the app. */}
          <button onClick={handleResetAll} title="Return every setting to its default"
            style={{ background:'none', border:`1px solid #52525b`, borderRadius:5, color:'#a1a1aa', fontSize:10, padding:'2px 8px', cursor:'pointer' }}>Reset all</button>
        </div>

        {/* Thirty-one sections over 2 700 px of scroll: without this the only way
            to reach a control is to remember which header it lives under. The
            list, its order and its behaviour are untouched — clearing the field
            puts the panel back exactly as it was. */}
        <div style={{ padding:'8px 12px', borderBottom:`1px solid ${BORDER}`, flexShrink:0, position:'relative' }}>
          <input
            type="search" value={filter} data-testid="panel-filter"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setFilter('') } }}
            placeholder="Find a control…" aria-label="Find a control"
            style={{
              width:'100%', background: SURF, border:`1px solid ${BORDER}`, borderRadius:5,
              color: TEXT, fontSize:11, padding:'4px 8px', outline:'none',
              fontFamily:'inherit',
            }}
          />
          {q && (
            <div style={{ fontSize:10, color: MUTED, marginTop:4, display:'flex', justifyContent:'space-between' }}>
              <span data-testid="filter-count">{matchCount === 0 ? 'No section matches' : `${matchCount} section${matchCount === 1 ? '' : 's'}`}</span>
              <button onClick={() => setFilter('')} style={{ background:'none', border:'none', color: MUTED, cursor:'pointer', fontSize:10, padding:0 }}>clear</button>
            </div>
          )}
        </div>

        <div id="hm-panel-body" style={{ flex:1, overflowX:'hidden', overflowY:'auto', scrollbarWidth:'thin', scrollbarColor:`${BORDER} transparent` }}>
          <SectionFilter.Provider value={filterCtx}>
          <div style={{ padding:'12px 12px', borderBottom:`1px solid ${BORDER}`, display: q ? 'none' : undefined }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
              <button className="hmload" data-testid="load-png" onClick={loadFromPicker} style={{ padding:8, background: SURF, color:'#a1a1aa', border:`1px dashed ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11 }}>↑ PNG</button>
              <button className="hmload" data-testid="load-geotiff" onClick={loadGeoTiffFromPicker} style={{ padding:8, background: SURF, color:'#a1a1aa', border:`1px dashed ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11 }}>↑ GeoTIFF</button>
            </div>
            {heightmapFilename && (
              <div style={{ marginTop:4, fontSize:10, color: MUTED, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {heightmapFilename}
              </div>
            )}

            {/* Which look is on, and a way to the other 55.
                Opening the Presets section is not enough on its own: it is the
                tenth section down, so the grid is still a scroll away from the
                thing it is meant to be discovered from. This is the one line in
                the panel that always says what you are looking at. */}
            {lastPreset && (
              <div style={{ marginTop:4, display:'flex', alignItems:'baseline', justifyContent:'center', gap:4, fontSize:10, color: MUTED }}>
                <span>Style</span>
                <button data-testid="jump-to-presets"
                  onClick={() => {
                    setSec(prev => ({ ...prev, presets: true }))
                    document.querySelector('[data-testid="section-presets"]')
                      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                  }}
                  title="Show all 56 styles"
                  style={{ background:'none', border:'none', padding:0, cursor:'pointer',
                           color: DIM, fontSize:10, fontFamily:'inherit',
                           borderBottom:`1px solid ${BORDER}` }}>
                  {lastPreset}{presetEdited ? ' · edited' : ''}
                </button>
              </div>
            )}

            {/* Settings now survive a reload, which is only reassuring if it is
                said out loud — otherwise the app looks like it opened on someone
                else's defaults. */}
            {sessionRestored && (
              <div data-testid="session-restored" style={{ marginTop:4, fontSize:10, color: MUTED, textAlign:'center', lineHeight:1.5 }}>
                Settings restored from your last session.
              </div>
            )}

            {/* Edit Mode: clip the loaded raster before it becomes terrain. */}
            <button className="hmload" data-testid="edit-heightmap" onClick={onEditHeightmap}
              disabled={!heightmapPixels}
              style={{ width:'100%', marginTop:4, padding:8, background: SURF, color: editSummary ? ACCENT : '#a1a1aa',
                border:`1px solid ${editSummary ? ACCENT_DEEP : BORDER}`, borderRadius:5,
                cursor: heightmapPixels ? 'pointer' : 'default', fontSize:11, opacity: heightmapPixels ? 1 : 0.5 }}>
              ✂ Edit heightmap <span style={{ color: MUTED, fontSize:10 }}>E</span>
            </button>
            {editSummary && (
              <div style={{ marginTop:4, display:'flex', alignItems:'center', justifyContent:'center', gap:4, fontSize:10, color: MUTED }}>
                <span data-testid="edit-summary" style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{editSummary}</span>
                <button data-testid="edit-clear" onClick={onClearEdit} style={{
                  background:'none', border:`1px solid ${BORDER}`, borderRadius:3, color: MUTED,
                  fontSize:10, padding:'2px 4px', cursor:'pointer', flexShrink:0,
                }}>clear</button>
              </div>
            )}
          </div>

          <Section title="Terrain" open={sec.terrain} onToggle={() => tog('terrain')}>
            {hypsometricIntegral != null && (
              <HypsometricRow value={hypsometricIntegral} />
            )}
            <Tog label="Raw terrain view"
              help="Shows the loaded heightmap itself: a flat greyscale plane with everything else hidden, lowest point black and highest white, stretched to fill the range. It reflects Resolution, Blur, Levels and the elevation cuts, so it doubles as a preview while tuning them. Exports are unaffected — this is a way of looking, not a change to the terrain."
              checked={view.showRawTerrain ?? false} onChange={v => sv({ showRawTerrain: v })} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 8px' }}>
              <Sl label="Resolution" min={1} max={20} value={terrain.resolution} onChange={v => st({ resolution: v })} />
              <Sl label="Elev scale" min={-10} max={10} step={0.1} value={terrain.elevScale} onChange={v => st({ elevScale: v })} fmt={v => (v >= 0 ? '+' : '') + v.toFixed(1)} />
              <Sl label="Blur" min={0} max={10} step={0.1} value={terrain.blurRadius} onChange={v => st({ blurRadius: v })} fmt={v => v % 1 ? v.toFixed(1) : v} />
              <Sl label="Jitter" min={0} max={20} step={0.1} value={terrain.jitterAmt} onChange={v => st({ jitterAmt: v })} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 8px' }}>
              <Sl label="Elev min cut" min={0} max={100} step={0.1} value={terrain.elevMinCut} onChange={v => st({ elevMinCut: v })} fmt={v => v.toFixed(1)+'%'} />
              <Sl label="Elev max cut" min={0} max={100} step={0.1} value={terrain.elevMaxCut} onChange={v => st({ elevMaxCut: v })} fmt={v => v.toFixed(1)+'%'} />
            </div>
          </Section>

          <Section title="Levels" open={sec.levels} onToggle={() => tog('levels')}>
            <Histogram pixels={heightmapPixels} blackPoint={terrain.blackPoint} whitePoint={terrain.whitePoint} onBlackChange={v => st({ blackPoint: v })} onWhiteChange={v => st({ whitePoint: v })} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 8px', marginTop:4 }}>
              <Sl label="Shadows" min={0} max={254} value={terrain.blackPoint} onChange={v => st({ blackPoint: v })} />
              <Sl label="Highlights" min={1} max={255} value={terrain.whitePoint} onChange={v => st({ whitePoint: v })} />
            </div>
          </Section>

          <Section title="View" open={sec.view} onToggle={() => tog('view')}>
            <div style={{ display:'flex', gap:4, marginBottom:4 }}>
              {/* Four camera presets. The last one is the *view* Reset, which is
                  not the panel header's "Reset all" — the label is short because
                  the row is, so the scope lives in the title and the name. */}
              {[['Top', 'top', 'Look straight down'], ['Front', 'front', 'Look from the front'],
                ['Iso', 'iso', 'Isometric three-quarter view'], ['Reset', 'reset', 'Reset the view only']]
                .map(([label, name, hint]) => (
                <Btn key={name} block onClick={() => onCameraPreset(name)}
                  title={hint} aria-label={name === 'reset' ? 'Reset view' : hint}
                  style={{ padding:'2px 0' }}>{label}</Btn>
              ))}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 8px' }}>
              <Sl label="Tilt" min={0} max={180} step={0.1} value={view.tilt} onChange={v => sv({ tilt: v })} fmt={v => v.toFixed(1)+'°'} />
              <Sl label="Zoom" min={10} max={400} value={Math.round((view.zoom / baseZoom) * 100)} onChange={v => sv({ zoom: (v / 100) * baseZoom })} fmt={v => v+'%'} />
            </div>
            <Sl label="Rotation" min={-180} max={180} step={0.1} value={view.rotation} onChange={v => sv({ rotation: v })} fmt={v => v.toFixed(1)+'°'} />
            <Sl label="Supersampling" help="Renders internally at a higher resolution to calm the shimmering of dense lines while panning/rotating. 2× costs roughly 4× GPU fill rate." min={1} max={2} step={0.5} value={view.renderScale ?? 1} onChange={v => sv({ renderScale: v })} fmt={v => v.toFixed(1)+'×'} />
            <Tog label="Auto-rotate" hint="q" checked={view.autoRotate} onChange={v => sv({ autoRotate: v })} />
            {view.autoRotate && (
              <Sub>
                <InlineSl label="Speed" min={0.01} max={2} step={0.01} value={view.autoRotateSpeed} onChange={v => sv({ autoRotateSpeed: v })} />
                <div style={{ display:'flex', gap:4 }}>
                  <span style={{ fontSize:10, color:MUTED, flex:1 }}>Direction</span>
                  {[['CW', 1],['CCW', -1]].map(([label, dir]) => (
                    <button key={label} onClick={() => sv({ autoRotateDir: dir })} 
                      style={{ 
                        fontSize:10, padding:'2px 8px', border:`1px solid ${BORDER}`, borderRadius:3, 
                        background: (view.autoRotateDir ?? 1) === dir ? ACCENT_DEEP : SURF, 
                        color: (view.autoRotateDir ?? 1) === dir ? '#fff' : MUTED 
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </Sub>
            )}
            <Tog label="Center guides" checked={view.showGuides} onChange={v => sv({ showGuides: v })} />
            <Tog label="Paper frame" checked={!!view.showFrame} onChange={v => sv({ showFrame: v })}
              help="Shows where a sheet of paper falls over the scene, and makes SVG export emit only what lands inside it — cut at the boundary rather than hidden behind a clip path, so there is nothing left to delete afterwards. The frame is an overlay: it never appears in an export, and it does not affect PNG or STL." />
            {view.showFrame && (
              <Sub>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <span style={{ fontSize:11, color:MUTED, whiteSpace:'nowrap', minWidth:52 }}>Paper</span>
                  <select data-testid="frame-paper" value={view.framePaper ?? 'iso'}
                    onChange={e => sv({ framePaper: e.target.value })}
                    style={{ flex:1, minWidth:0, background:SURF, color:DIM, border:`1px solid ${BORDER}`, borderRadius:5, fontSize:10, padding:'2px 4px', cursor:'pointer' }}>
                    {['ISO','US','Ratio'].map(group => (
                      <optgroup key={group} label={group}>
                        {Object.entries(PAPERS).filter(([, v]) => v.group === group).map(([id, v]) => (
                          <option key={id} value={id}>
                            {v.label}{v.custom ? '' : ` — ${paperRatioLabel(id)}`}{v.note ? ` (${v.note})` : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                {(view.framePaper ?? 'iso') === 'custom' && (
                  <InlineSl label="Ratio" min={1} max={4} step={0.001} value={view.frameCustomRatio ?? 1.414} onChange={v => sv({ frameCustomRatio: v })} fmt={v => `1:${v.toFixed(3)}`} testId="frame-ratio"
                    help="Long side ÷ short side. 1.414 is ISO, 1.294 US Letter, 1.618 the golden ratio." />
                )}
                <SegRow label="Format" testIdPrefix="frame-orient"
                  options={[['Portrait', false],['Landscape', true]]}
                  value={!!view.frameLandscape} onChange={v => sv({ frameLandscape: v })}
                  help="Only the shape is used — the export carries pixel dimensions, so scale it to the sheet in your plotting software. That is also why the list is by ratio: every ISO A size is the same 1:√2 rectangle, so A3 and A4 would have drawn an identical frame." />
                <InlineSl label="Scale" min={0.1} max={1} step={0.01} value={view.frameScale ?? 0.85} onChange={v => sv({ frameScale: v })} fmt={v => Math.round(v * 100) + '%'} testId="frame-scale"
                  help="How much of the viewport the sheet covers. Smaller crops tighter; at 100% the sheet touches whichever pair of edges its shape reaches first." />
                <InlineSl label="Offset X" min={-0.5} max={0.5} step={0.005} value={view.frameOffsetX ?? 0} onChange={v => sv({ frameOffsetX: v })} fmt={v => Math.round(v * 100) + '%'} testId="frame-offset-x"
                  help="Slides the sheet across the viewport, as a fraction of its width. The canvas fills the window and this panel floats over it, so a centred frame sits a little left of the free space — nudge it right to compose against what you can actually see." />
                <InlineSl label="Offset Y" min={-0.5} max={0.5} step={0.005} value={view.frameOffsetY ?? 0} onChange={v => sv({ frameOffsetY: v })} fmt={v => Math.round(v * 100) + '%'} testId="frame-offset-y" />
                <InlineSl label="Margin" min={0} max={0.25} step={0.005} value={view.frameMargin ?? 0} onChange={v => sv({ frameMargin: v })} fmt={v => Math.round(v * 100) + '%'} testId="frame-margin"
                  help="An unprinted border inside the sheet, as a fraction of its shorter side. Geometry is cut to the inner edge while the page stays the full sheet, so the export comes out already mounted." />
              </Sub>
            )}
          </Section>

          <Section title="Camera" open={sec.camera} onToggle={() => tog('camera')}>
            <Sub>
              <Tog label="Orthographic" help="Architectural projection with no perspective distortion." checked={view.orthographic} onChange={v => sv({ orthographic: v })} />
              {!view.orthographic && (
                <InlineSl label="Focal Len" min={10} max={120} value={view.fov} onChange={v => sv({ fov: v })} fmt={v => Math.round(v)} />
              )}
              {/* fmt is not decoration: these mirror the orbit target, which a
                  mouse pan moves continuously, and without it a drag left the
                  field reading `-247.38194837`. Scene.jsx rounds at the source
                  now; this keeps any stray float legible if one ever arrives. */}
              <InlineSl label="Pan X" min={-1000} max={1000} value={Math.round(view.panX ?? 0)} onChange={v => sv({ panX: v })} fmt={v => Math.round(v)} testId="pan-x" />
              <InlineSl label="Pan Y" min={-1000} max={1000} value={Math.round(view.panY ?? 0)} onChange={v => sv({ panY: v })} fmt={v => Math.round(v)} testId="pan-y" />
              <InlineSl label="Pan Z" min={-1000} max={1000} value={Math.round(view.panZ ?? 0)} onChange={v => sv({ panZ: v })} fmt={v => Math.round(v)} testId="pan-z"
                help="Raises or lowers the point the camera orbits. Pan X and Y slide it across the ground; this one lifts it into the air — useful for framing something above the terrain, such as a murmuration, without tilting the horizon." />
            </Sub>
          </Section>

          {/* ── Global Style ───────────────────────────────────────────────── */}

          <Section title="Terrain Style" open={sec.style} onToggle={() => tog('style')}>
            <TogColor label="Fill" checked={style.showFill} onToggle={v => ss({ showFill: v })} color={style.fillColor} onColor={v => ss({ fillColor: v })} />
            {style.showFill && (
              <Sub>
                <Tog label="Hypsometric fill" small checked={style.fillHypsometric} onChange={v => ss({ fillHypsometric: v })} />
                {style.fillHypsometric && (
                  <Sub>
                    <div style={{ display:'flex', gap:2, marginBottom:4 }}>
                      {['Elevation', 'Slope', 'Aspect'].map(m => <button key={m} onClick={() => ss({ fillHypsoMode: m.toLowerCase() })} style={{ flex:1, fontSize:10, padding:'2px 0', borderRadius:2, background: style.fillHypsoMode === m.toLowerCase() ? ACCENT_DEEP : SURF, color: style.fillHypsoMode === m.toLowerCase() ? '#fff' : MUTED, border:`1px solid ${style.fillHypsoMode === m.toLowerCase() ? ACCENT_DEEP : BORDER}` }}>{m}</button>)}
                    </div>
                    <Tog label="Banded" small checked={style.fillBanded} onChange={v => ss({ fillBanded: v })} />
                    {style.fillBanded && <><InlineSl label="Band Dist" min={0.5} max={50} value={style.fillHypsoInterval} onChange={v => ss({ fillHypsoInterval: v })} /><InlineSl label="Band Weight" min={0} max={5} step={0.5} value={style.fillHypsoWeight} onChange={v => ss({ fillHypsoWeight: v })} /></>}
                  </Sub>
                )}
              </Sub>
            )}

            {/* Shared gradient editor: visible whenever ANY hypsometric consumer is
                active — fill or any draw mode. (The old `style.lineHypsometric`
                check was a dead legacy key, so this only ever showed for fill.) */}
            {style.fillHypsometric || HYPSO_LAYER_IDS.some(id => style[`hypso${id}`]) ? (
              <div style={{ marginBottom: 8, marginTop: 8 }}>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4, marginBottom:8 }}>
                  {Object.keys(GRADIENT_PRESETS).map(name => <Btn key={name} size="xs" onClick={() => sg(GRADIENT_PRESETS[name])} style={{ padding:'2px 0' }}>{name}</Btn>)}
                </div>
                <GradientPicker stops={gradientStops} onChange={sg} />
              </div>
            ) : null}

            <TogColor label="Mesh" checked={style.showMesh} onToggle={v => ss({ showMesh: v })} color={style.meshColor} onColor={v => ss({ meshColor: v })} />
            <TogColor label="Occlusion" help="Hide or ghost lines behind terrain. Set opacity to 0% to hide completely." checked={style.depthOcclusion} onToggle={v => ss({ depthOcclusion: v })} color={style.occlusionColor} onColor={v => ss({ occlusionColor: v })} />
            {style.depthOcclusion && (
              <Sub>
                <InlineSl label="Occ. Dist" help="Depth tolerance. Higher values allow lines to peek through the surface." min={0} max={25} step={0.1} value={style.occlusionBias} onChange={v => ss({ occlusionBias: v })} fmt={v => v.toFixed(1)} />
                <InlineSl label="Ghost Opac" help="Opacity of lines hidden behind mountains. 0% = hidden, 100% = fully visible." min={0} max={1} step={0.01} value={style.occlusionOpacity} onChange={v => ss({ occlusionOpacity: v })} fmt={v => Math.round(v*100)+'%'} />
              </Sub>
            )}
            
            <ColorRow label="Background" testId="bg-color" value={style.bgColor} onChange={v => ss({ bgColor: v })} />
            <Sub>
              <Tog label="Gradient" small checked={style.bgGradient} onChange={v => ss({ bgGradient: v })} />
              {style.bgGradient && <GradientPicker stops={bgGradientStops} onChange={sbg} isSimple />}
            </Sub>
          </Section>

          {/* ── Hillshade ──────────────────────────────────────────────────── */}

          <Section title="Hillshade" open={sec.hillshade} onToggle={() => tog('hillshade')} enabled={style.showHillshade}>
            <Tog label="Enabled" checked={style.showHillshade} onChange={v => ss({ showHillshade: v })} />
            {style.showHillshade && (
              <Sub>
                <Tog label="Multi-direction" help="Average 8 light directions — eliminates directional bias (Swiss-style shading). Hides azimuth and cast shadows." checked={!!style.hillshadeMultiDir} onChange={v => ss({ hillshadeMultiDir: v })} />
                {!style.hillshadeMultiDir && (
                  <InlineSl label="Azimuth" help="Light direction: 0°=N, 90°=E, 315°=NW (classic)." min={0} max={360} step={5} value={style.hillshadeAzimuth} onChange={v => ss({ hillshadeAzimuth: v })} fmt={v => Math.round(v) + '°'} />
                )}
                <InlineSl label="Altitude" help="Sun angle above the horizon. 45° is classic; 90° is directly overhead." min={0} max={90} step={1} value={style.hillshadeAltitude} onChange={v => ss({ hillshadeAltitude: v })} fmt={v => Math.round(v) + '°'} />
                <InlineSl label="Intensity" min={0} max={3} step={0.05} value={style.hillshadeIntensity} onChange={v => ss({ hillshadeIntensity: v })} fmt={v => v.toFixed(2)} />
                <InlineSl label="Opacity" help="Blend strength over the fill colour." min={0} max={1} step={0.01} value={style.hillshadeOpacity} onChange={v => ss({ hillshadeOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
                <InlineSl label="Exaggeration" help="Amplifies normals for dramatic relief at low elevation scales." min={0.1} max={10} step={0.1} value={style.hillshadeExaggeration} onChange={v => ss({ hillshadeExaggeration: v })} fmt={v => v.toFixed(1)} />
                <ColorRow label="Highlight" value={style.hillshadeHighlightColor} onChange={v => ss({ hillshadeHighlightColor: v })} />
                <ColorRow label="Shadow" value={style.hillshadeShadowColor} onChange={v => ss({ hillshadeShadowColor: v })} />
                <Tog label="Show Sun" help="Display a sun orb in the scene at the light source position." checked={style.showSun} onChange={v => ss({ showSun: v })} />
                {!style.hillshadeMultiDir && (<>
                  <Tog label="Cast Shadows" help="Ray-march cast shadows: ridges block sunlight." checked={style.hillshadeCastShadows} onChange={v => ss({ hillshadeCastShadows: v })} />
                  {style.hillshadeCastShadows && (<>
                    <InlineSl label="Darkness" help="How dark cast shadows are (0 = no effect, 100% = pitch black)." min={0} max={1} step={0.05} value={style.hillshadeShadowDarkness} onChange={v => ss({ hillshadeShadowDarkness: v })} fmt={v => Math.round(v * 100) + '%'} />
                    <InlineSl label="Softness" help="Penumbra width — 0 for crisp edges, higher for soft gradual shadows." min={0} max={5} step={0.1} value={style.hillshadeShadowSoftness} onChange={v => ss({ hillshadeShadowSoftness: v })} fmt={v => v.toFixed(1)} />
                    <InlineSl label="Quality" help="Shadow ray steps — more steps = longer shadows but higher GPU cost." min={16} max={128} step={8} value={style.hillshadeShadowSteps} onChange={v => ss({ hillshadeShadowSteps: Math.round(v) })} fmt={v => Math.round(v) + '×'} />
                  </>)}
                </>)}
                <Tog label="Sky View Factor" help="Ray-marches the sky hemisphere to darken valleys and concavities. GPU-intensive; keep Rays ≤ 16 for real-time editing." checked={!!style.showAO} onChange={v => ss({ showAO: v })} />
                {style.showAO && (<>
                  <InlineSl label="SVF Strength" min={0} max={1} step={0.05} value={style.aoStrength ?? 0.7} onChange={v => ss({ aoStrength: v })} fmt={v => Math.round(v * 100) + '%'} />
                  <InlineSl label="SVF Rays" help="More rays = smoother result at higher GPU cost." min={4} max={32} step={4} value={style.aoRays ?? 8} onChange={v => ss({ aoRays: Math.round(v) })} fmt={v => Math.round(v) + '×'} />
                </>)}
              </Sub>
            )}
          </Section>

          {/* ── Slope Shading ──────────────────────────────────────────────── */}
          <Section title="Slope Shading" open={sec.slopeShade} onToggle={() => tog('slopeShade')} enabled={style.showSlopeShade}>
            <Tog label="Enabled" checked={style.showSlopeShade} onChange={v => ss({ showSlopeShade: v })} />
            {style.showSlopeShade && (
              <Sub>
                <InlineSl label="Opacity" help="Blend strength of slope colours over the fill." min={0} max={1} step={0.01} value={style.slopeShadeOpacity} onChange={v => ss({ slopeShadeOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
                <ColorRow label="Flat colour" value={style.slopeColorLow} onChange={v => ss({ slopeColorLow: v })} />
                <ColorRow label="Steep colour" value={style.slopeColorHigh} onChange={v => ss({ slopeColorHigh: v })} />
              </Sub>
            )}
          </Section>

          {/* ── Water Fill ─────────────────────────────────────────────────── */}
          <Section title="Water Fill" open={sec.waterFill} onToggle={() => tog('waterFill')} enabled={style.showWaterFill}>
            <Tog label="Enabled" checked={!!style.showWaterFill} onChange={v => ss({ showWaterFill: v })} />
            {style.showWaterFill && (
              <Sub>
                <InlineSl label="Level" help="Flood threshold — percentage of terrain height." min={0} max={1} step={0.01} value={style.waterLevel ?? 0.3} onChange={v => ss({ waterLevel: v })} fmt={v => Math.round(v * 100) + '%'} />
                <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style.waterOpacity ?? 0.82} onChange={v => ss({ waterOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
                <ColorRow label="Color" value={style.waterColor ?? '#1a78c2'} onChange={v => ss({ waterColor: v })} />
              </Sub>
            )}
          </Section>

          {/* ── Aspect Map ──────────────────────────────────────────────────── */}
          <Section title="Aspect Map" open={sec.aspectMap} onToggle={() => tog('aspectMap')} enabled={style.showAspectMap}>
            <Tog label="Enabled" checked={!!style.showAspectMap} onChange={v => ss({ showAspectMap: v })} />
            {style.showAspectMap && (
              <Sub>
                <InlineSl label="Opacity" help="Blend strength of the aspect hue-wheel over the fill." min={0} max={1} step={0.01} value={style.aspectMapOpacity ?? 0.8} onChange={v => ss({ aspectMapOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
              </Sub>
            )}
          </Section>

          {/* ── Presets ────────────────────────────────────────────────────── */}

          <Section title="Presets" open={sec.presets} onToggle={() => tog('presets')}>
            {/* Roll a look. The seed is shown because it *is* the look — note it
                down and the same roll comes back. */}
            <div style={{ display:'flex', gap:4, marginBottom:4 }}>
              <button data-testid="surprise-me" onClick={handleSurprise} style={{
                flex:1, padding:'8px 0', background: ACCENT, color:'#fff', border:`1px solid ${ACCENT}`,
                borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:600,
              }}>🎲 Surprise me</button>
              <button data-testid="surprise-back" onClick={handleUnroll} disabled={!rollHistory.length} title="Back to the previous roll"
                style={{
                  padding:'8px 8px', background: SURF, color: rollHistory.length ? DIM : MUTED,
                  border:`1px solid ${BORDER}`, borderRadius:5,
                  cursor: rollHistory.length ? 'pointer' : 'default', fontSize:11,
                  opacity: rollHistory.length ? 1 : 0.5,
                }}>↩</button>
            </div>
            {rollSeed != null && (
              <div data-testid="roll-seed" style={{ fontSize:10, color: MUTED, marginBottom:8, textAlign:'center', fontVariantNumeric:'tabular-nums' }}>
                seed {rollSeed}
              </div>
            )}

            <div style={{ fontSize:10, color: MUTED, fontWeight:700, margin:'8px 0 4px', letterSpacing:1 }}>
              STYLES <span style={{ opacity:0.7, fontWeight:400 }}>({presetNames.length})</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
              {Object.entries(externalPresets || {}).map(([name, preset]) => {
                const showThumb = !noThumb.has(name)
                return (
                  <button key={name} data-testid={`preset-${name}`} title={name}
                    onClick={() => applyPreset(preset, name)}
                    style={{
                      position:'relative', padding: showThumb ? 0 : '6px 4px', fontSize:10,
                      background: SURF, color: DIM, border:`1px solid ${lastPreset === name ? ACCENT_DEEP : BORDER}`,
                      borderRadius:5, cursor:'pointer', overflow:'hidden', lineHeight:0,
                    }}>
                    {showThumb && (
                      <img
                        src={`${import.meta.env.BASE_URL || '/'}presets/thumbs/${encodeURIComponent(name)}.webp`}
                        alt=""
                        loading="lazy"
                        onError={() => setNoThumb(s => new Set(s).add(name))}
                        style={{ display:'block', width:'100%', aspectRatio:'16/10', objectFit:'cover' }}
                      />
                    )}
                    {lastPreset === name && presetEdited && (
                      <span data-testid="preset-edited" style={{
                        position:'absolute', top:3, right:3, fontSize:10, lineHeight:1,
                        padding:'2px 4px', borderRadius:2, background:'rgba(0,0,0,.72)',
                        color:'#f4f4f5', letterSpacing:'0.06em', textTransform:'uppercase',
                      }}>edited</span>
                    )}
                    <span style={{
                      display:'block', lineHeight:1.2,
                      ...(showThumb ? {
                        position:'absolute', left:0, right:0, bottom:0, padding:'8px 4px 2px',
                        background:'linear-gradient(to top, rgba(0,0,0,.85), rgba(0,0,0,0))',
                        color:'#f4f4f5', fontSize:10, textShadow:'0 1px 2px rgba(0,0,0,.9)',
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                      } : {}),
                    }}>{name}</span>
                  </button>
                )
              })}
            </div>
          </Section>

          {/* ── DRAW MODES ─────────────────────────────────────────────────── */}

          <Section title="Mode: Lines" icon={<ModeMark kind="lines" />} open={sec.modeLines} onToggle={() => tog('modeLines')} enabled={style.enabledLines}>
            <Tog label="Enabled" checked={style.enabledLines} onChange={v => ss({ enabledLines: v })} />
            {style.enabledLines && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingLines} onChange={v => ss({ spacingLines: v })} />
                  <InlineSl label="Shift" min={0} max={100} value={style.shiftLines} onChange={v => ss({ shiftLines: v })} />
                  <InlineSl label="Angle" help="Bearing of the parallel lines. 0° runs along the X axis, 90° along Y, anything between gives diagonal ridgelines." min={0} max={180} step={1} value={style.angleLines ?? 0} onChange={v => ss({ angleLines: v })} fmt={v => `${v}°`} />
                </Sub>
                <ModeStyleOverride prefix="Lines" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Crosshatch" icon={<ModeMark kind="crosshatch" />} open={sec.modeCross} onToggle={() => tog('modeCross')} enabled={style.enabledCross}>
            <Tog label="Enabled" checked={style.enabledCross} onChange={v => ss({ enabledCross: v })} />
            {style.enabledCross && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingCross} onChange={v => ss({ spacingCross: v })} />
                  <InlineSl label="Angle" help="Bearing of the first line set; the second runs perpendicular to it." min={0} max={90} step={1} value={style.angleCross ?? 0} onChange={v => ss({ angleCross: v })} fmt={v => `${v}°`} />
                </Sub>
                <ModeStyleOverride prefix="Cross" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Pillars" icon={<ModeMark kind="pillars" />} open={sec.modePillars} onToggle={() => tog('modePillars')} enabled={style.enabledPillars}>
            <Tog label="Enabled" checked={style.enabledPillars} onChange={v => ss({ enabledPillars: v })} />
            {style.enabledPillars && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingPillars} onChange={v => ss({ spacingPillars: v })} />
                  <InlineSl label="Gap" min={0} max={20} step={0.5} value={style.pillarGap} onChange={v => ss({ pillarGap: v })} />
                  <InlineSl label="Depth" min={0} max={100} step={1} value={style.pillarDepth} onChange={v => ss({ pillarDepth: v })} />
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: MUTED, display: 'block', marginBottom: 4 }}>Shape</span>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {[['Line', 'line'], ['Cuboid', 'cuboid'], ['Cylinder', 'cylinder']].map(([label, val]) => (
                        <button key={val} onClick={() => ss({ pillarStyle: val })} style={{
                          flex: 1, fontSize: 10, padding: '2px 0', borderRadius: 2,
                          background: (style.pillarStyle ?? 'line') === val ? ACCENT_DEEP : SURF,
                          color: (style.pillarStyle ?? 'line') === val ? '#fff' : MUTED,
                          border: `1px solid ${(style.pillarStyle ?? 'line') === val ? ACCENT_DEEP : BORDER}`,
                          cursor: 'pointer',
                        }}>{label}</button>
                      ))}
                    </div>
                  </div>
                  {(style.pillarStyle === 'cuboid' || style.pillarStyle === 'cylinder') && (
                    <InlineSl label="Size" help="Cross-section as a fraction of spacing. 1.0 = pillars touch, 0.5 = half-width." min={0.05} max={1} step={0.05} value={style.pillarSize ?? 0.8} onChange={v => ss({ pillarSize: v })} fmt={v => Math.round(v * 100) + '%'} />
                  )}
                  {style.pillarStyle === 'cylinder' && (
                    <InlineSl label="Segments" help="Number of polygon sides approximating the circle." min={3} max={16} step={1} value={style.pillarSegments ?? 8} onChange={v => ss({ pillarSegments: v })} fmt={v => Math.round(v)} />
                  )}
                  {(style.pillarStyle === 'cuboid' || style.pillarStyle === 'cylinder') && (
                    <ColorRow label="Lid Color" value={style.pillarLidColor ?? '#ffffff'} onChange={v => ss({ pillarLidColor: v })} />
                  )}
                </Sub>
                <ModeStyleOverride prefix="Pillars" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Contours" icon={<ModeMark kind="contours" />} open={sec.modeContours} onToggle={() => tog('modeContours')} enabled={style.enabledContours}>
            <Tog label="Enabled" checked={style.enabledContours} onChange={v => ss({ enabledContours: v })} />
            {style.enabledContours && (
              <>
                <Sub>
                  {mPerWorld ? (
                    <InlineSl label="Interval (m)" testId="contour-interval-m"
                      help="Real ground metres, read through the raster's elevation range, the Shadows/Highlights handles and the current vertical exaggeration. The interval itself is kept in world units, so moving the exaggeration changes what it is worth on the ground — this number follows the lines rather than pinning them."
                      min={intervalMin} max={intervalMax} step={0.1} value={metreInterval}
                      onChange={v => ss({ intervalContours: v / mPerWorld })}
                      fmt={v => (v >= 100 ? String(Math.round(v)) : v.toFixed(1)) + 'm'} />
                  ) : (
                    <InlineSl label="Interval" min={0.1} max={10} step={0.1} value={style.intervalContours} onChange={v => ss({ intervalContours: v })} fmt={v => v.toFixed(1)} />
                  )}
                  <InlineSl label="Major Every" min={0} max={50} step={1} value={style.majorIntervalContours} onChange={v => ss({ majorIntervalContours: v })} fmt={v => v === 0 ? 'None' : 'Every '+v} />
                  {style.majorIntervalContours > 1 && (
                    <InlineSl label="Major Offset" min={1} max={style.majorIntervalContours} step={1} value={style.majorOffsetContours} onChange={v => ss({ majorOffsetContours: v })} />
                  )}
                  {style.majorIntervalContours > 0 && (
                    <InlineSl label="Major Weight" min={0.5} max={10} step={0.5} value={style.majorWeightContours} onChange={v => ss({ majorWeightContours: v })} />
                  )}
                  <Tog label="Close contours" checked={!!style.closeRingsContours} onChange={v => ss({ closeRingsContours: v })} />
                  {!style.tanakaContours && (
                    <InlineSl label="Smoothing" help="Chaikin corner-cutting passes. 0 = crisp marching-squares lines; higher = soft, flowing form lines." min={0} max={4} step={1} value={style.smoothingContours ?? 0} onChange={v => ss({ smoothingContours: v })} />
                  )}
                  <Tog label="Label heights" help="Prints each contour's elevation into the line itself — the contour stops, the number sits in the gap at the line's own angle, and the contour resumes. That is what makes a sheet of nested curves readable, and it is why a printed map does it this way rather than setting the number beside the line." checked={!!style.labelContours} onChange={v => ss({ labelContours: v })} />
                  {style.labelContours && (
                    <Sub>
                      <InlineSl label="Size" help="World units per em — the same measure the vector labels use, so both read against the terrain rather than against the screen." min={2} max={40} step={0.5} value={style.labelSizeContours} onChange={v => ss({ labelSizeContours: v })} />
                      <InlineSl label="Spacing" help="How far apart along a contour. A number every few hundred units reads as a map; one every few tens reads as a ticker tape." min={40} max={600} step={10} value={style.labelSpacingContours} onChange={v => ss({ labelSpacingContours: v })} />
                      <InlineSl label="Clearance" help="Blank space kept either side of the number, in the same world units as Size. Every contour at that level is erased inside the box, not just the one the label sits on — so a line that hairpins back, or a neighbouring ring on steep ground, is masked too. Raise it for a thick pen, drop it to 0 to let the line run right up to the digits." min={0} max={30} step={0.5} value={style.labelPadContours} onChange={v => ss({ labelPadContours: v })} fmt={v => v.toFixed(1)} />
                      <ColorRow label="Colour" testId="contour-label-color"
                        help="The numbers' own ink. They follow the contour colour until this is touched, after which they keep whatever it is set to — a red index elevation over grey contours is a normal thing for a sheet to do."
                        value={style.labelColorContours ?? style.colorContours}
                        onChange={v => ss({ labelColorContours: v })} />
                      <InlineSl label="Weight" min={0.5} max={6} step={0.5} value={style.labelWeightContours} onChange={v => ss({ labelWeightContours: v })} />
                      <Tog label="Major only" small help="Labelling every minor contour is a page of numbers with a drawing behind it. A printed sheet labels the index contours, which is what this does." checked={!!style.labelMajorOnlyContours} onChange={v => ss({ labelMajorOnlyContours: v })} />
                      <Tog label="Use single-line font" small help="Sets the numbers in a stroke face, so the pen draws each digit once instead of tracing its outline." checked={!!style.labelSingleLineContours} onChange={v => ss({ labelSingleLineContours: v })} />
                      {style.labelSingleLineContours && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '2px 0 8px' }}>
                          <span style={{ fontSize: 10, color: DIM, width: 54 }}>Font</span>
                          <select value={style.labelFontContours ?? 'HersheySans1'}
                            onChange={(e) => ss({ labelFontContours: e.target.value })}
                            data-testid="contour-label-font"
                            style={{ flex: 1, minWidth: 0, background: SURF, color: DIM,
                                     border: `1px solid ${BORDER}`, borderRadius: 3,
                                     fontSize: 10, padding: '4px 4px', cursor: 'pointer', fontFamily: 'inherit' }}>
                            {Object.entries(singleLineFonts.reduce((g, f) => {
                              (g[f.group] ??= []).push(f); return g
                            }, {})).map(([group, faces]) => (
                              <optgroup key={group} label={group}>
                                {faces.map((f) => <option key={f.id} value={f.id}>{f.family}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      )}
                    </Sub>
                  )}
                  <Tog label="Tanaka illumination" help="Split contours into thick-bright (illuminated side) and thin-dark (shadow side) layers." checked={!!style.tanakaContours} onChange={v => ss({ tanakaContours: v })} />
                  {style.tanakaContours && (
                    <Sub>
                      <InlineSl label="Sun Azimuth" min={0} max={360} step={5} value={style.tanakaSunAzimuth ?? 315} onChange={v => ss({ tanakaSunAzimuth: v })} fmt={v => Math.round(v) + '°'} />
                      <InlineSl label="Bright Weight" min={0.5} max={10} step={0.5} value={style.tanakaWeightBright ?? 2.5} onChange={v => ss({ tanakaWeightBright: v })} />
                      <InlineSl label="Dark Weight" min={0.5} max={10} step={0.5} value={style.tanakaWeightDark ?? 0.5} onChange={v => ss({ tanakaWeightDark: v })} />
                    </Sub>
                  )}
                </Sub>
                <ModeStyleOverride prefix="Contours" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Hachure" icon={<ModeMark kind="hachure" />} open={sec.modeHachure} onToggle={() => tog('modeHachure')} enabled={style.enabledHachure}>
            <Tog label="Enabled" checked={style.enabledHachure} onChange={v => ss({ enabledHachure: v })} />
            {style.enabledHachure && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingHachure} onChange={v => ss({ spacingHachure: v })} />
                  <InlineSl label="Length" min={0.1} max={5} step={0.1} value={style.lengthHachure} onChange={v => ss({ lengthHachure: v })} />
                </Sub>
                <ModeStyleOverride prefix="Hachure" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Flow" icon={<ModeMark kind="flow" />} open={sec.modeFlow} onToggle={() => tog('modeFlow')} enabled={style.enabledFlow}>
            <Tog label="Enabled" checked={style.enabledFlow} onChange={v => ss({ enabledFlow: v })} />
            {style.enabledFlow && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={0.5} max={30} step={0.5} value={style.spacingFlow} onChange={v => ss({ spacingFlow: v })} />
                  <InlineSl label="Step" min={0.1} max={3} step={0.1} value={style.stepFlow} onChange={v => ss({ stepFlow: v })} />
                  <InlineSl label="Max Len" min={1} max={250} value={style.maxLenFlow} onChange={v => ss({ maxLenFlow: v })} />
                </Sub>
                <ModeStyleOverride prefix="Flow" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Network" icon={<ModeMark kind="network" />} open={sec.modeDag} onToggle={() => tog('modeDag')} enabled={style.enabledDag}>
            <Tog label="Enabled" checked={style.enabledDag} onChange={v => ss({ enabledDag: v })} />
            {style.enabledDag && (
              <>
                <Sub>
                  <InlineSl label="Threshold" min={1} max={10} step={1} value={style.thresholdDag} onChange={v => ss({ thresholdDag: v })} />
                </Sub>
                <ModeStyleOverride prefix="Dag" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Pencil" icon={<ModeMark kind="pencil" />} open={sec.modePencil} onToggle={() => tog('modePencil')} enabled={style.enabledPencil}>
            <Tog label="Enabled" checked={style.enabledPencil} onChange={v => ss({ enabledPencil: v })} />
            {style.enabledPencil && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingPencil} onChange={v => ss({ spacingPencil: v })} />
                  <InlineSl label="Threshold" min={0.1} max={5} step={0.1} value={style.thresholdPencil} onChange={v => ss({ thresholdPencil: v })} />
                </Sub>
                <ModeStyleOverride prefix="Pencil" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Ridge" icon={<ModeMark kind="ridge" />} open={sec.modeRidge} onToggle={() => tog('modeRidge')} enabled={style.enabledRidge}>
            <Tog label="Enabled" checked={style.enabledRidge} onChange={v => ss({ enabledRidge: v })} />
            {style.enabledRidge && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={10} value={style.spacingRidge} onChange={v => ss({ spacingRidge: v })} />
                  <InlineSl label="Radius" min={0.2} max={2} step={0.1} value={style.radiusRidge} onChange={v => ss({ radiusRidge: v })} />
                  <InlineSl label="Threshold" min={0.005} max={0.5} step={0.005} value={style.thresholdRidge} onChange={v => ss({ thresholdRidge: v })} />
                </Sub>
                <ModeStyleOverride prefix="Ridge" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Valley" icon={<ModeMark kind="valley" />} open={sec.modeValley} onToggle={() => tog('modeValley')} enabled={style.enabledValley}>
            <Tog label="Enabled" checked={style.enabledValley} onChange={v => ss({ enabledValley: v })} />
            {style.enabledValley && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={10} value={style.spacingValley} onChange={v => ss({ spacingValley: v })} />
                  <InlineSl label="Radius" min={1} max={20} step={1} value={style.radiusValley} onChange={v => ss({ radiusValley: v })} />
                  <InlineSl label="Threshold" min={0.005} max={5} step={0.005} value={style.thresholdValley} onChange={v => ss({ thresholdValley: v })} />
                </Sub>
                <ModeStyleOverride prefix="Valley" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Stipple Dots" icon={<ModeMark kind="stipple" />} open={sec.modeStipple} onToggle={() => tog('modeStipple')} enabled={style.enabledStipple}>
            <Tog label="Enabled" checked={style.enabledStipple} onChange={v => ss({ enabledStipple: v })} />
            {style.enabledStipple && (
              <>
                <Sub>
                  <InlineSl label="Spacing" help="Grid pitch between candidate dots. Smaller = denser maximum." min={0.05} max={2} step={0.05} value={style.spacingStipple} onChange={v => ss({ spacingStipple: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Gamma" help="Density curve exponent. >1 pushes dots toward high-density areas; <1 spreads them more evenly." min={0.05} max={2} step={0.05} value={style.stippleGamma} onChange={v => ss({ stippleGamma: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Jitter" help="Random displacement of each dot within its grid cell. 1 = full cell, 0 = regular grid." min={0} max={1} step={0.05} value={style.stippleJitter} onChange={v => ss({ stippleJitter: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Seed" help="Randomness seed — the same seed always reproduces the identical dot pattern." min={1} max={999} step={1} value={style.seedStipple ?? 42} onChange={v => ss({ seedStipple: v })} />
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: MUTED, display: 'block', marginBottom: 4 }}>Density from</span>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {[['Slope', 'slope'], ['Inv Slope', 'invSlope'], ['Elevation', 'elevation'], ['Inv Elev', 'invElev']].map(([label, val]) => (
                        <button key={val} onClick={() => ss({ stippleDensityMode: val })} style={{
                          flex: 1, fontSize: 10, padding: '2px 0', borderRadius: 2,
                          background: style.stippleDensityMode === val ? ACCENT_DEEP : SURF,
                          color: style.stippleDensityMode === val ? '#fff' : MUTED,
                          border: `1px solid ${style.stippleDensityMode === val ? ACCENT_DEEP : BORDER}`,
                          cursor: 'pointer',
                        }}>{label}</button>
                      ))}
                    </div>
                  </div>
                </Sub>
                <ModeStyleOverride prefix="Stipple" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} label="DOT STYLE" showDash={false} />
              </>
            )}
          </Section>

          <Section title="Mode: Isophotes" icon={<ModeMark kind="isophotes" />} open={sec.modeIso} onToggle={() => tog('modeIso')} enabled={style.enabledIso}>
            <Tog label="Enabled" checked={style.enabledIso} onChange={v => ss({ enabledIso: v })} />
            {style.enabledIso && (
              <>
                <Sub>
                  <InlineSl label="Levels" help="How many lines of constant light to trace. A contour joins points of equal height; an isophote joins points of equal illumination, so the lines bunch where the surface turns away from the sun and open out where it faces it." min={1} max={24} step={1} value={style.levelsIso} onChange={v => ss({ levelsIso: v })} />
                  <InlineSl label="Sun" help="Light azimuth. Turning it moves every line, because the lines *are* the light — unlike contours, which stay put whatever the sun does." min={0} max={360} step={5} value={style.sunAzimuthIso} onChange={v => ss({ sunAzimuthIso: v })} fmt={v => `${v}°`} />
                  <InlineSl label="Contrast" help="Tone curve exponent. >1 pushes the lines toward the shadows; <1 spreads them onto the lit slopes." min={0.3} max={3} step={0.1} value={style.gammaIso} onChange={v => ss({ gammaIso: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Detail" help="How much the ground is smoothed before the light is measured off it. Illumination is a *slope*, not a height, so it inherits every bump the terrain has and magnifies it — at 0 the lines fracture into noise. Turn it down for crags, up for broad forms." min={0} max={12} step={0.5} value={style.radiusIso} onChange={v => ss({ radiusIso: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Smoothing" help="Chaikin passes over each finished line, rounding the staircase left by tracing a level set across grid cells. The curve converges: most of the effect lands in the first two passes and the shape stops changing after about four, so the upper end of this range costs time without changing the drawing. For a broader, rounder line reach for Detail instead — it smooths the ground before the light is measured off it, which is a different thing entirely." min={0} max={25} step={1} value={style.smoothingIso} onChange={v => ss({ smoothingIso: v })} />
                </Sub>
                <ModeStyleOverride prefix="Iso" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Engraving" icon={<ModeMark kind="engraving" />} open={sec.modeEngrave} onToggle={() => tog('modeEngrave')} enabled={style.enabledEngrave}>
            <Tog label="Enabled" checked={style.enabledEngrave} onChange={v => ss({ enabledEngrave: v })} />
            {style.enabledEngrave && (
              <>
                <Sub>
                  <InlineSl label="Spacing" help="Pitch between hatch strokes." min={1} max={20} step={0.5} value={style.spacingEngrave} onChange={v => ss({ spacingEngrave: v })} />
                  <InlineSl label="Angle" help="Base hatch direction. Additional levels add +90°, +45°, +135°." min={0} max={180} step={1} value={style.angleEngrave} onChange={v => ss({ angleEngrave: v })} fmt={v => `${v}°`} />
                  <InlineSl label="Levels" help="Cross-hatch layers: shadows accumulate up to this many stacked directions." min={1} max={4} step={1} value={style.levelsEngrave} onChange={v => ss({ levelsEngrave: v })} />
                  <InlineSl label="Sun" help="Light azimuth driving the hatching: lit slopes stay sparse, shadows hatch densely." min={0} max={360} step={5} value={style.sunAzimuthEngrave} onChange={v => ss({ sunAzimuthEngrave: v })} fmt={v => `${v}°`} />
                  <InlineSl label="Contrast" help="Tone curve exponent. >1 confines hatching to deep shadow; <1 spreads it." min={0.3} max={3} step={0.1} value={style.gammaEngrave} onChange={v => ss({ gammaEngrave: v })} fmt={v => v.toFixed(1)} />
                </Sub>
                <ModeStyleOverride prefix="Engrave" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Curvature" icon={<ModeMark kind="curvature" />} open={sec.modeCurv} onToggle={() => tog('modeCurv')} enabled={style.enabledCurv}>
            <Tog label="Enabled" checked={style.enabledCurv} onChange={v => ss({ enabledCurv: v })} />
            {style.enabledCurv && (
              <>
                <HelpBox text="Copperplate engraving that follows the form rather than the light: strokes trace the principal-curvature field, so the lines themselves wrap around ridges and hollows." />
                <Sub>
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['Across form', 'max'], ['Along form', 'min']].map(([lbl, v]) => (
                      <button key={v} onClick={() => ss({ dirModeCurv: v })}
                        style={{
                          flex:1, fontSize:10, padding:'4px 0', borderRadius:2, textTransform:'uppercase', cursor:'pointer',
                          background: style.dirModeCurv === v ? ACCENT_DEEP : SURF,
                          color: style.dirModeCurv === v ? '#fff' : MUTED,
                          border:`1px solid ${style.dirModeCurv === v ? ACCENT_DEEP : BORDER}`,
                        }}>{lbl}</button>
                    ))}
                  </div>
                  <InlineSl label="Spacing" help="Separation between strokes. Each line claims territory as it advances and stops on reaching another's, so strokes stay evenly spread instead of clumping." min={1} max={20} step={0.5} value={style.spacingCurv} onChange={v => ss({ spacingCurv: v })} />
                  <InlineSl label="Length" help="Maximum steps per stroke. Short values give a broken, sketched texture; long values give sweeping continuous lines." min={5} max={400} step={5} value={style.lengthCurv} onChange={v => ss({ lengthCurv: v })} />
                  <InlineSl label="Step" help="Integration step in grid cells. Smaller follows the curvature field more faithfully at more segments." min={0.25} max={3} step={0.25} value={style.stepCurv} onChange={v => ss({ stepCurv: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Smoothing" help="Pre-blur radius before differencing. Second derivatives amplify noise, so raise this on grainy terrain." min={0} max={6} step={1} value={style.radiusCurv} onChange={v => ss({ radiusCurv: v })} />
                  <InlineSl label="Threshold" help="Minimum curvature, as a fraction of the strongest present. Raise it to leave flat ground bare and engrave only where the surface actually bends." min={0} max={0.9} step={0.01} value={style.thresholdCurv} onChange={v => ss({ thresholdCurv: v })} fmt={v => Math.round(v*100)+'%'} />
                </Sub>
                <ModeStyleOverride prefix="Curv" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Rock & Scree" icon={<ModeMark kind="swiss" />} open={sec.modeSwiss} onToggle={() => tog('modeSwiss')} enabled={style.enabledSwiss}>
            <Tog label="Enabled" checked={style.enabledSwiss} onChange={v => ss({ enabledSwiss: v })} />
            {style.enabledSwiss && (
              <>
                <Sub>
                  <InlineSl label="Spacing" help="Grid pitch between strokes/dots." min={0.5} max={10} step={0.5} value={style.spacingSwiss} onChange={v => ss({ spacingSwiss: v })} />
                  <InlineSl label="Cliff" help="Normalised slope above which cells get cliff hachures." min={0.1} max={0.95} step={0.05} value={style.thresholdSwiss} onChange={v => ss({ thresholdSwiss: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Stroke len" help="Cliff hachure length multiplier." min={0.2} max={3} step={0.1} value={style.lengthSwiss} onChange={v => ss({ lengthSwiss: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Scree" help="Debris-dot density on the slope band below the cliffs." min={0} max={1} step={0.05} value={style.screeSwiss} onChange={v => ss({ screeSwiss: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Scree size" min={0.5} max={8} step={0.5} value={style.screeWeightSwiss} onChange={v => ss({ screeWeightSwiss: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Seed" help="Randomness seed — the same seed always reproduces the identical stroke wobble and scree pattern." min={1} max={999} step={1} value={style.seedSwiss ?? 42} onChange={v => ss({ seedSwiss: v })} />
                </Sub>
                <ModeStyleOverride prefix="Swiss" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          {/* Always here, even with nothing to put in it. Hiding the section
              behind a georeferenced raster meant the app's largest feature —
              OpenStreetMap, GPX, GeoJSON, labels, icons — was simply absent from
              the default session, which reads as "this tool doesn't do that"
              rather than "this tool needs a different file first". */}
          <Section title="Vector Layers" open={sec.vectorLayers} onToggle={() => tog('vectorLayers')}
                   enabled={vectorLayers?.length > 0}>
            {geoTiffElevMin == null ? (
              <div data-testid="vector-needs-geotiff">
                <div style={{ fontSize:11, color: MUTED, lineHeight:1.55, marginBottom:8 }}>
                  Roads, water, rail, landuse, buildings, lifts and peaks are queried
                  from OpenStreetMap for the raster&rsquo;s own extent, and GPX tracks
                  and GeoJSON are draped over it. All of that needs to know where on
                  earth the terrain is — so it needs a georeferenced raster.
                </div>
                <button className="hmload" data-testid="vector-load-geotiff" onClick={loadGeoTiffFromPicker}
                  style={{ width:'100%', padding:8, background: SURF, color:'#a1a1aa',
                           border:`1px dashed ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11 }}>
                  ↑ GeoTIFF
                </button>
                <div style={{ fontSize:10, color: MUTED, marginTop:4, lineHeight:1.5 }}>
                  A PNG heightmap has no coordinates to hang them on.
                </div>
              </div>
            ) : (
              <VectorLayersPanel
                crs={geoTiffCRS} crsName={geoTiffCRSName}
                bbox={geoTiffBbox}
                coverage={vectorCoverage} error={vectorError}
                sources={vectorSources} layers={vectorLayers}
                onLoadGpx={loadGpxFromPicker} onLoadGeoJson={loadGeoJsonFromPicker}
                onPatch={onPatchVectorLayer} onRemove={onRemoveVectorLayer}
                onReorder={onReorderVectorLayer}
                onRemoveSource={onRemoveVectorSource}
                onAdopt={onAdoptVectorSource} onError={onVectorError}
                identify={vectorIdentify} onIdentify={onVectorIdentify}
                onCustomIcon={onCustomIcon} iconOverflow={iconOverflow}
                labelOverflow={labelOverflow}
                viewTilt={view.tilt} viewSpin={view.rotation}
              />
            )}
          </Section>

          <Section title="Particles" open={sec.points} onToggle={() => tog('points')} enabled={points.showPoints}>
            <TogColor label="Particles" checked={points.showPoints} onToggle={v => sp({ showPoints: v })} color={points.pointColor} onColor={v => sp({ pointColor: v })} />
            {points.showPoints && (
              <Sub>
                <SegRow label="Field" testIdPrefix="particle-mode"
                  options={[['Hologram', 'hologram'], ['Murmuration', 'murmuration']]}
                  value={points.particleMode ?? 'hologram'} onChange={v => sp({ particleMode: v })}
                  help="Hologram pins a particle to every terrain cell and shimmers them in place. Murmuration flies a boids flock over the relief: it avoids the ground, orbits a roost on the summit and rides the updraft on steep slopes." />
                <InlineSl label="Size" min={0.5} max={250} step={0.5} value={points.pointSize} onChange={v => sp({ pointSize: v })} testId="particle-size"
                  help="Sprite diameter in pixels at 300 units from the camera — points shrink with distance like anything else in the scene, so this is a reference size, not the size on screen. Your GPU caps how large a single point may be drawn (commonly 511 px, sometimes as little as 63), and a big sprite close to the camera hits that ceiling and stops growing; SVG export inherits the same cap so the two agree. Birds want to be small: past about 4 a flock reads as confetti rather than as a flock." />
                <InlineSl label="Opacity" min={0} max={1} step={0.05} value={points.pointOpacity ?? 1} onChange={v => sp({ pointOpacity: v })} fmt={v => v.toFixed(2)} testId="particle-opacity"
                  help="Strength of the whole sprite — core, halo and, in murmuration mode, the velocity streaks. The radial falloff keeps its shape as this drops, so particles thin out rather than hard-edging. Below about 0.3 a dense field reads as a wash of colour instead of as countable marks, which is usually what you want when there are tens of thousands of them. It carries into SVG export as the fill opacity." />
                <ColorRow label="Glow" value={points.holoGlowColor ?? '#00eaff'} onChange={v => sp({ holoGlowColor: v })}
                  help="The rim colour blended into the outside of each sprite, against the main colour in its core. In murmuration mode it is also the far end of each velocity streak, which fades from this colour at the tail to the main colour at the bird." />

                {(points.particleMode ?? 'hologram') === 'hologram' ? (
                  <>
                    <InlineSl label="Spacing" min={1} max={16} step={1} value={points.particleSpacing ?? 1} onChange={v => sp({ particleSpacing: v })} fmt={v => `${v}`} testId="particle-spacing" />
                    <InlineSl label="Shimmer" min={0} max={1} step={0.05} value={points.holoShimmer ?? 0.4} onChange={v => sp({ holoShimmer: v })} fmt={v => v.toFixed(2)} testId="holo-shimmer" />
                    <Tog label="Animate" small checked={points.animateParticles} onChange={v => sp({ animateParticles: v })} />
                    {points.animateParticles && (
                      <Sub>
                        <InlineSl label="Float"      min={0} max={5}  step={0.1} value={points.holoFloat ?? 1}       onChange={v => sp({ holoFloat: v })}       fmt={v => v.toFixed(1)} testId="holo-float" />
                        <InlineSl label="Noise"      min={0} max={5}  step={0.1} value={points.holoNoiseAmt ?? 1}    onChange={v => sp({ holoNoiseAmt: v })}    fmt={v => v.toFixed(1)} testId="holo-noise" />
                        <InlineSl label="Noise scale" min={0.1} max={5} step={0.1} value={points.holoNoiseScale ?? 1} onChange={v => sp({ holoNoiseScale: v })} fmt={v => v.toFixed(1)} testId="holo-noise-scale" />
                        <InlineSl label="Flow speed" min={0} max={4}  step={0.1} value={points.holoFlowSpeed ?? 1}   onChange={v => sp({ holoFlowSpeed: v })}   fmt={v => v.toFixed(1)} testId="holo-flow" />
                        <InlineSl label="Reveal"     min={0.5} max={6} step={0.1} value={points.holoMaskContrast ?? 1.5} onChange={v => sp({ holoMaskContrast: v })} fmt={v => v.toFixed(1)} testId="holo-reveal" />
                      </Sub>
                    )}
                  </>
                ) : (
                  <>
                    <InlineSl label="Birds" min={10} max={317} step={1}
                      value={birdSlider(points.flockCount ?? 2000)}
                      onChange={v => sp({ flockCount: birdCount(v) })}
                      fmt={v => `${birdCount(v)}`} testId="flock-count"
                      help="Cost is linear: about 0.15 ms of simulation per 1000 birds per step, so the full 100 000 is roughly a whole 60 fps frame on its own — and Shadow adds a third again on top, which takes 100 000 down to about 18 fps. Both together are comfortable to around 50 000. Past the budget the flock moves in slow motion rather than stuttering. Shapes read best somewhere between 2 000 and 20 000; past that it fills in to a solid mass." />
                    <InlineSl label="Seed" min={1} max={999} step={1} value={points.flockSeed ?? 42} onChange={v => sp({ flockSeed: v })} fmt={v => `${v}`} testId="flock-seed"
                      help="Same seed, same flock. The simulation runs on a fixed timestep, so a given seed produces the same shapes on any machine." />
                    <InlineSl label="Trail" min={0} max={4} step={0.1} value={points.flockTrail ?? 2} onChange={v => sp({ flockTrail: v })} fmt={v => v.toFixed(1)} testId="flock-trail"
                      help="Length of the velocity streak behind each bird. 0 draws dots only. Streaks export to SVG as their own plotter layer." />
                    {/* Audio reactivity. Its own track, not a Soundscape: that
                        hook exists to *replace the terrain* with a spectrogram, and
                        wanting the birds to react to music is not wanting your
                        raster overwritten. Nothing here touches the heightmap. */}
                    <Tog label="React to audio" small checked={!!points.flockAudio} onChange={v => sp({ flockAudio: v })}
                      help="Flies the flock to a track. The audio is analysed for the birds alone — the terrain is left exactly as it is, unlike Soundscapes, which turns the track itself into the landscape. If a Soundscape does happen to be playing, the flock listens to that rather than making you load the same file twice. Note it reads the file's own content, so the volume slider does not reach it." />
                    {points.flockAudio && (
                      <Sub>
                        {fa.isAnalyzing ? (
                          <div style={{ fontSize:10, color:MUTED, marginBottom:8 }}>Analysing… {fa.progress}%</div>
                        ) : fa.error ? (
                          <div style={{ fontSize:10, color:'#f87171', background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.3)', borderRadius:5, padding:'4px 8px', marginBottom:4 }}>
                            {fa.error}
                          </div>
                        ) : null}
                        {fa.ready ? (
                          <AudioTransport fa={fa} />
                        ) : (
                          <>
                            {snd.fileName ? (
                              <div style={{ fontSize:10, color:MUTED, marginBottom:4 }}>
                                Following the Soundscape ({snd.fileName}). Load a track here to use a different one.
                              </div>
                            ) : (
                              <div style={{ fontSize:10, color:'#f59e0b', background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.3)', borderRadius:5, padding:'4px 8px', marginBottom:4 }}>
                                No track loaded — the flock has nothing to listen to.
                              </div>
                            )}
                            <button className="hmload" onClick={fa.loadFromPicker} disabled={fa.isAnalyzing}
                              style={{ width:'100%', padding:8, background: SURF, color:'#a1a1aa', border:`1px dashed ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11, marginBottom:8 }}>
                              ↑ Load audio
                            </button>
                          </>
                        )}
                        {/* The meter goes above the sliders on purpose: it is the
                            thing you watch while you move them. */}
                        <AudioMeter liveRef={fa.liveRef} points={points} />
                        <InlineSl label="Drive" min={0} max={2} step={0.05} value={points.flockAudioDrive ?? 1} onChange={v => sp({ flockAudioDrive: v })} fmt={v => v.toFixed(2)} testId="flock-audio-drive"
                          help="Master amount for everything below. 0 is silence to the flock however loud the track; past 1 the reaction is exaggerated beyond what the music is doing." />
                        <InlineSl label="Pace" min={0} max={2} step={0.05} value={points.flockAudioSpeed ?? 1} onChange={v => sp({ flockAudioSpeed: v })} fmt={v => v.toFixed(2)} testId="flock-audio-speed"
                          help="Loudness drives flight speed, centred so an averagely loud passage flies at the speed you dialled — quiet passages genuinely slow down rather than the flock only ever accelerating." />
                        <RangeSl label="↳ range" lo={points.flockAudioPaceLo ?? 0} hi={points.flockAudioPaceHi ?? 1}
                          onChange={(lo, hi) => sp({ flockAudioPaceLo: lo, flockAudioPaceHi: hi })} testId="flock-range-speed"
                          help="Which slice of the loudness envelope drives the pace. A track that is loud from end to end sits pinned near the top, where an amount slider can only scale something that never varies — cut the floor away and what is left stretches across the whole response." />
                        <InlineSl label="Pulse" min={0} max={2} step={0.05} value={points.flockAudioPulse ?? 1} onChange={v => sp({ flockAudioPulse: v })} fmt={v => v.toFixed(2)} testId="flock-audio-pulse"
                          help="Bass opens the flock out: separation rises on the kick while cohesion eases, so it breathes on the beat. Pulling both the same way instead just makes it vibrate." />
                        <RangeSl label="↳ range" lo={points.flockAudioPulseLo ?? 0} hi={points.flockAudioPulseHi ?? 1}
                          onChange={(lo, hi) => sp({ flockAudioPulseLo: lo, flockAudioPulseHi: hi })} testId="flock-range-pulse"
                          help="Which slice of the bass envelope counts as a kick. Raise the low handle until the constant bassline stops registering and only the hits do — this is the control for a busy drum and bass track." />
                        <InlineSl label="Shimmer" min={0} max={2} step={0.05} value={points.flockAudioShimmer ?? 1} onChange={v => sp({ flockAudioShimmer: v })} fmt={v => v.toFixed(2)} testId="flock-audio-shimmer"
                          help="Hats, cymbals and air add turbulence on top of whatever is dialled in — the flock gets restless through the busy parts." />
                        <RangeSl label="↳ range" lo={points.flockAudioShimmerLo ?? 0} hi={points.flockAudioShimmerHi ?? 1}
                          onChange={(lo, hi) => sp({ flockAudioShimmerLo: lo, flockAudioShimmerHi: hi })} testId="flock-range-shimmer"
                          help="Which slice of the high band drives the restlessness. Narrow it to separate a ride cymbal from the wash of everything else above 2 kHz." />
                        <InlineSl label="Size" min={0} max={2} step={0.05} value={points.flockAudioSize ?? 1} onChange={v => sp({ flockAudioSize: v })} fmt={v => v.toFixed(2)} testId="flock-audio-size"
                          help="Bass swells the birds themselves, and loudness lengthens their streaks. These are shader uniforms, so unlike every force below they land on the exact frame the beat does — this is the control that makes the flock read as being *on* the music rather than responding to it." />
                        <RangeSl label="↳ range" lo={points.flockAudioSizeLo ?? 0} hi={points.flockAudioSizeHi ?? 1}
                          onChange={(lo, hi) => sp({ flockAudioSizeLo: lo, flockAudioSizeHi: hi })} testId="flock-range-size"
                          help="Which slice of the bass envelope swells the birds. Usually wanted lower than Pulse: a visible swell reads well before the flock has moved at all." />
                        <InlineSl label="Burst" min={0} max={2} step={0.05} value={points.flockAudioBurst ?? 1} onChange={v => sp({ flockAudioBurst: v })} fmt={v => v.toFixed(2)} testId="flock-audio-burst"
                          help="An onset throws the flock outward from its own centre, written straight into the birds' velocity rather than applied as a force — so it happens immediately instead of being integrated in over the following half-second. The flock re-forms on its own, because none of the flocking rules have changed. Past about 1.5 the bursts arrive faster than it can re-form and it disperses into fragments, which is a look but not a flock." />
                        <RangeSl label="↳ range" lo={points.flockAudioBurstLo ?? 0.15} hi={points.flockAudioBurstHi ?? 0.9}
                          onChange={(lo, hi) => sp({ flockAudioBurstLo: lo, flockAudioBurstHi: hi })} testId="flock-range-burst"
                          help="Which onsets count. Raw onset values sit low and dense music produces a wall of small ones, so this starts windowed — raise the low handle until only the accents fire, lower it to catch every hi-hat." />
                        <InlineSl label="Startle" min={0} max={2} step={0.05} value={points.flockAudioStartle ?? 1} onChange={v => sp({ flockAudioStartle: v })} fmt={v => v.toFixed(2)} testId="flock-audio-startle"
                          help="On top of Burst, onsets widen the hawk's fear radius so an accented beat tears the same hole a strike does. Shares Burst's range. Needs Predator on; Burst does not." />
                        <InlineSl label="Sync" min={-0.15} max={0.3} step={0.01} value={points.flockAudioSync ?? 0.04} onChange={v => sp({ flockAudioSync: v })} fmt={v => `${Math.round(v * 1000)}ms`} testId="flock-audio-sync"
                          help="How far ahead of the playhead the flock reads. Steering forces take a few hundred milliseconds to become visible motion, so a little lookahead cancels that and puts the reaction back on the beat. Reading the future is only possible because the whole track is analysed before it plays — raise it if the flock still feels behind, lower it if it anticipates." />
                      </Sub>
                    )}
                    <Tog label="Shadow" small checked={points.flockShadow !== false} onChange={v => sp({ flockShadow: v })}
                      help="Drops each bird's shadow onto the terrain. The direction is the Hillshade sun — azimuth and altitude in the Hillshade section — so the flock is lit the same way the ground under it is, and the shadows swing when you move the sun. A low sun throws them long across the valley." />
                    {points.flockShadow !== false && (
                      <Sub>
                        <InlineSl label="Strength" min={0} max={1} step={0.05} value={points.flockShadowOpacity ?? 0.35} onChange={v => sp({ flockShadowOpacity: v })} fmt={v => v.toFixed(2)} testId="flock-shadow-opacity"
                          help="How dark the shadows are where the bird is lowest. They always fade further as it climbs — this sets the near end of that range." />
                        <InlineSl label="Sh. size" min={0.2} max={6} step={0.1} value={points.flockShadowSize ?? 1} onChange={v => sp({ flockShadowSize: v })} fmt={v => v.toFixed(1)} testId="flock-shadow-size"
                          help="Shadow diameter as a multiple of the bird's own Size. Above 1 the shadows read as a soft moving stain on the landscape rather than as countable dots." />
                        <InlineSl label="Sh. spread" min={0} max={5} step={0.1} value={points.flockShadowSpread ?? 1.5} onChange={v => sp({ flockShadowSpread: v })} fmt={v => v.toFixed(1)} testId="flock-shadow-spread"
                          help="How much a shadow grows as its bird climbs — the depth cue that makes the flock read as flying rather than pasted onto the terrain. At 0 every shadow is the same size whatever the altitude." />
                        {/* The same two style params the Hillshade section owns, surfaced
                            here because that section hides them unless Hillshade is
                            enabled — and the flock's shadows do not require it. One
                            value, two places to reach it, so they cannot disagree. */}
                        <InlineSl label="Sun az." min={0} max={360} step={5} value={style.hillshadeAzimuth ?? 315} onChange={v => ss({ hillshadeAzimuth: v })} fmt={v => Math.round(v) + '°'} testId="flock-sun-azimuth"
                          help="Which way the shadows fall: 0°=N, 90°=E, 315°=NW. This is the Hillshade sun — the same slider, shown here too because Hillshade hides it when it is switched off. Moving it here moves the terrain's shading as well." />
                        <InlineSl label="Sun alt." min={0} max={90} step={1} value={style.hillshadeAltitude ?? 45} onChange={v => ss({ hillshadeAltitude: v })} fmt={v => Math.round(v) + '°'} testId="flock-sun-altitude"
                          help="Sun height above the horizon. Overhead drops each shadow straight under its bird; low sun throws the whole flock's shadow long across the valley. Clamped at 5° for the shadow maths, since a sun on the horizon casts to infinity." />
                        <ColorRow label="Sh. colour" value={points.flockShadowColor ?? '#000000'} onChange={v => sp({ flockShadowColor: v })}
                          help="Black reads as shadow; a dark tint of the background reads as haze. It is a flat colour with a soft edge, not a darkening of what is underneath, so on a dark background a shadow lighter than the terrain will look like glow." />
                      </Sub>
                    )}
                    {/* A transport button rather than a toggle: freezing the flock is
                        something you reach for constantly — to look at a shape, or to
                        export the frame you are looking at — and it deserves to be
                        the most obvious control in the block rather than one switch
                        among fifteen. Same `animateParticles` param either way. */}
                    <div style={{ display: 'flex', marginBottom: 8 }}>
                      <ExpBtn
                        label={points.animateParticles ? '❚❚  Pause' : '▶  Resume'}
                        hint={points.animateParticles ? 'space — freeze the flock' : 'space — frozen'}
                        active={!points.animateParticles}
                        testId="flock-pause"
                        onClick={() => sp({ animateParticles: !points.animateParticles })} />
                    </div>
                    {/* Not gated on the pause state, unlike the hologram's block: a
                        pause you cannot adjust anything during is a worse pause, and
                        the flock picks these up the moment it resumes. */}
                    <Sub>
                        <InlineSl label="Speed"      min={0.1} max={4} step={0.1} value={points.flockSpeed ?? 1}      onChange={v => sp({ flockSpeed: v })}      fmt={v => v.toFixed(1)} testId="flock-speed"
                          help="Cruise speed, as a fraction of the terrain's width per second — 1 crosses the map in about eleven seconds. Everything else is measured against it: birds never fly slower than 0.65× or faster than 1.35× this, and every force below is a multiple of it, so a faster flock also pushes harder off the ground and away from the hawk." />
                        <InlineSl label="Cohesion"   min={0} max={4} step={0.1} value={points.flockCohesion ?? 1}     onChange={v => sp({ flockCohesion: v })}   fmt={v => v.toFixed(1)} testId="flock-cohesion"
                          help="Pull toward the centre of the neighbours a bird can see. High values ball the flock up tight; at 0 it disperses into a drifting haze and only the roost holds it on the map." />
                        <InlineSl label="Alignment"  min={0} max={4} step={0.1} value={points.flockAlignment ?? 1.2}  onChange={v => sp({ flockAlignment: v })}  fmt={v => v.toFixed(1)} testId="flock-alignment"
                          help="How strongly a bird matches its neighbours' heading. This is what makes a murmuration a single moving sheet rather than a swarm — and what lets a turn started at one edge travel across the whole flock." />
                        <InlineSl label="Separation" min={0} max={4} step={0.1} value={points.flockSeparation ?? 1.5} onChange={v => sp({ flockSeparation: v })} fmt={v => v.toFixed(1)} testId="flock-separation"
                          help="Push away from birds that get too close, weighted so an imminent collision outranks mere proximity. It sets the flock's texture: low values clump into blobs, high values open it into an even lattice." />
                        <InlineSl label="Neighbours" min={0.2} max={3} step={0.1} value={points.flockPerception ?? 1} onChange={v => sp({ flockPerception: v })} fmt={v => v.toFixed(1)} testId="flock-perception"
                          help="How far a bird looks for company. Each one flies with the eight nearest it finds — the topological rule real starlings follow — so this sets how far apart they can drift before losing touch. Small values shatter the flock into independent knots; large ones make it move as one sheet." />
                        <InlineSl label="Turbulence" min={0} max={2} step={0.1} value={points.flockTurbulence ?? 0.5} onChange={v => sp({ flockTurbulence: v })} fmt={v => v.toFixed(1)} testId="flock-turbulence"
                          help="A slow-drifting noise field nudging every bird. At 0 the flock is eerily smooth and settles into a steady orbit; a little roughness is what keeps it restless and stops the shape repeating." />
                        <InlineSl label="Roost"      min={0} max={3} step={0.1} value={points.flockRoost ?? 1}        onChange={v => sp({ flockRoost: v })}      fmt={v => v.toFixed(1)} testId="flock-roost"
                          help="Pull toward a roost above the highest ground. Nothing inside a free radius and ramping up beyond it, so the flock orbits the summit instead of collapsing onto it. At 0 it wanders until the map edges turn it back." />
                        <InlineSl label="Height"     min={0} max={4} step={0.1} value={points.flockRoostHeight ?? 1}  onChange={v => sp({ flockRoostHeight: v })} fmt={v => v.toFixed(1)} testId="flock-roost-height"
                          help="How high the roost sits above the summit, measured against the terrain's own relief rather than in scene units. It sets the altitude the whole flock centres on: low keeps it down among the ridges, high lifts it clear into the sky." />
                        <InlineSl label="Clearance"  min={0.1} max={4} step={0.1} value={points.flockClearance ?? 1}  onChange={v => sp({ flockClearance: v })}  fmt={v => v.toFixed(1)} testId="flock-clearance"
                          help="Minimum height above the terrain. The flock drapes over ridges rather than passing through them. No bird is ever drawn underground whatever this is set to — the low end just lets them skim closer." />
                        <InlineSl label="Ridge lift" min={0} max={4} step={0.1} value={points.flockLift ?? 1}         onChange={v => sp({ flockLift: v })}       fmt={v => v.toFixed(1)} testId="flock-lift"
                          help="Updraft over steep ground and sink over the flats, read from the terrain's own slope field and fading with height — the flock finds the ridgelines and traces them. At 0 the relief underneath stops influencing where it flies." />
                        <Tog label="Predator" small checked={!!points.flockPredator} onChange={v => sp({ flockPredator: v })}
                          help="A hawk that runs the flock down, circling past the centre so it keeps coming back rather than parking in the middle. The waves and holes that tear through real murmurations are a reaction to one." />
                      {points.flockPredator && (
                        <InlineSl label="Fear" min={0.2} max={4} step={0.1} value={points.flockPredatorFear ?? 1} onChange={v => sp({ flockPredatorFear: v })} fmt={v => v.toFixed(1)} testId="flock-fear"
                          help="How close the hawk gets before birds break. A small radius punches a clean hole through the flock; a large one scatters the whole thing at once and it takes several seconds to re-form." />
                      )}
                    </Sub>
                  </>
                )}
              </Sub>
            )}
          </Section>

          <Section title="Texture" open={sec.texture} onToggle={() => tog('texture')}>
            <Tog label="Texture overlay" checked={style.showTexture} onChange={v => ss({ showTexture: v })} />
            {style.showTexture && !style.showFill && (
              <div style={{ fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 5, padding: '4px 8px', marginBottom: 4 }}>
                Fill is disabled — texture will not appear until Fill is enabled.
              </div>
            )}
            {style.showTexture && (
              <Sub>
                <button className="hmload" onClick={handleTexturePicker} style={{ 
                  width:'100%', padding:8, marginBottom:8, background: SURF, color: DIM, 
                  border:`1px dashed ${BORDER}`, borderRadius:5, fontSize:11, cursor:'pointer' 
                }}>
                  {textureImage ? 'Change Texture' : '↑ Load Image'}
                </button>
                {textureImage && (
                  <>
                    <InlineSl label="Scale" min={0.01} max={10} step={0.01} value={style.textureScale} onChange={v => ss({ textureScale: v })} />
                    <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style.textureOpacity} onChange={v => ss({ textureOpacity: v })} fmt={v => Math.round(v*100)+'%'} />
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                      <span style={{ fontSize:10, color:MUTED, minWidth:50 }}>Blend</span>
                      <select value={style.textureBlendMode} onChange={e => ss({ textureBlendMode: e.target.value })} style={{ flex:1, background:SURF, color:DIM, border:`1px solid ${BORDER}`, borderRadius:5, fontSize:10, padding:'2px 4px', cursor:'pointer' }}>
                        <option value="normal">Normal</option>
                        <option value="multiply">Multiply</option>
                        <option value="screen">Screen</option>
                        <option value="overlay">Overlay</option>
                        <option value="softlight">Soft Light</option>
                        <option value="add">Add</option>
                      </select>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                      <Sl label="Shift X" min={-1} max={1} step={0.01} value={style.textureShiftX} onChange={v => ss({ textureShiftX: v })} />
                      <Sl label="Shift Y" min={-1} max={1} step={0.01} value={style.textureShiftY} onChange={v => ss({ textureShiftY: v })} />
                    </div>
                    <button onClick={() => setTextureImage(null)} style={{ 
                      width:'100%', padding:'8px 0', background: SURF, color: DIM, 
                      border:`1px solid ${BORDER}`, borderRadius:5, fontSize:11, fontWeight:600, cursor:'pointer'
                    }}>Clear Texture</button>
                  </>
                )}
              </Sub>
            )}
          </Section>

          <Section title="Mirror" open={sec.mirror} onToggle={() => tog('mirror')}>
            <div style={{ fontSize:10, color:MUTED, fontWeight:700, marginBottom:12, letterSpacing:1, textAlign:'center' }}>3D SYMMETRY (6-WAY)</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, maxWidth:180, margin:'0 auto' }}>
              <div />
              <button title="Mirror Up (+Y)" className={`sym-btn${style.showMirrorPlusY ? ' on' : ''}`} onClick={() => ss({ showMirrorPlusY: !style.showMirrorPlusY })}>▲<div className="sym-label">+Y</div></button>
              <div />

              <button title="Mirror Left (-X)" className={`sym-btn${style.showMirrorMinusX ? ' on' : ''}`} onClick={() => ss({ showMirrorMinusX: !style.showMirrorMinusX })}>◀<div className="sym-label">-X</div></button>
              <button title="Mirror Back (-Z)" className={`sym-btn${style.showMirrorMinusZ ? ' on' : ''}`} onClick={() => ss({ showMirrorMinusZ: !style.showMirrorMinusZ })}>↗<div className="sym-label">-Z</div></button>
              <button title="Mirror Right (+X)" className={`sym-btn${style.showMirrorPlusX ? ' on' : ''}`} onClick={() => ss({ showMirrorPlusX: !style.showMirrorPlusX })}>▶<div className="sym-label">+X</div></button>

              <div />
              <button title="Mirror Down (-Y)" className={`sym-btn${style.showMirrorMinusY ? ' on' : ''}`} onClick={() => ss({ showMirrorMinusY: !style.showMirrorMinusY })}>▼<div className="sym-label">-Y</div></button>
              <div />

              <div />
              <button title="Mirror Front (+Z)" className={`sym-btn${style.showMirrorPlusZ ? ' on' : ''}`} onClick={() => ss({ showMirrorPlusZ: !style.showMirrorPlusZ })}>↙<div className="sym-label">+Z</div></button>
              <div />
            </div>
            <div style={{ fontSize:10, color:MUTED, textAlign:'center', marginTop:12, opacity:0.7, lineHeight:1.4, marginBottom:8 }}>
              Click arrows to toggle symmetry.<br/>Combine directions for kaleidoscopic effects.
            </div>
            <button onClick={() => ss({ 
              showMirrorPlusX:true, showMirrorMinusX:false,
              showMirrorPlusY:true, showMirrorMinusY:false,
              showMirrorPlusZ:true, showMirrorMinusZ:false
            })} style={{ 
              width:'100%', padding:'4px 0', background: SURF, color: DIM, 
              border:`1px solid ${BORDER}`, borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer'
            }}>Reset Symmetry</button>
          </Section>

          {/* ── Soundscapes ─────────────────────────────────────────────────
              Streams an audio spectrogram into the heightmap slot, so every
              draw mode / overlay / export works on it like any other terrain. */}
          <Section title="Soundscapes" open={sec.soundscapes} onToggle={() => tog('soundscapes')} enabled={snd.active}>
            <button
              className="hmload"
              onClick={() => snd.loadFromPicker(onSoundscapeFit)}
              style={{ width:'100%', padding:8, background: SURF, color:'#a1a1aa', border:`1px dashed ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11, marginBottom:8 }}
            >↑ Audio (MP3 / WAV / OGG / M4A)</button>

            {snd.error && (
              <div style={{ fontSize:10, color:'#fca5a5', background:'rgba(153,27,27,.18)', border:'1px solid #7f1d1d', borderRadius:5, padding:'4px 8px', marginBottom:8 }}>
                {snd.error}
              </div>
            )}

            {snd.fileName && (
              <div style={{ fontSize:10, color: MUTED, marginBottom:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {snd.fileName}
              </div>
            )}

            {snd.isAnalyzing && (
              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:10, color: MUTED, marginBottom:4 }}>Analysing spectrogram… {snd.progress}%</div>
                <div style={{ height:3, background: BORDER, borderRadius:2, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${snd.progress}%`, background: ACCENT, transition:'width .1s' }} />
                </div>
              </div>
            )}

            {snd.spec && (
              <>
                <SpectrogramView
                  spec={snd.spec}
                  currentTime={snd.currentTime}
                  duration={snd.duration}
                  windowFrames={snd.opts.windowFrames}
                  dbFloor={snd.opts.dbFloor}
                  contrast={snd.opts.contrast}
                  frozen={snd.frozen}
                  onSeek={snd.seek}
                />

                <div style={{ display:'flex', gap:4, alignItems:'center', marginBottom:8 }}>
                  <button
                    data-testid="soundscape-play"
                    onClick={snd.toggle}
                    style={{ flex:1, padding:'8px 0', background: snd.isPlaying ? SURF : ACCENT, color: snd.isPlaying ? DIM : '#fff', border:`1px solid ${snd.isPlaying ? BORDER : ACCENT}`, borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:600 }}
                  >{snd.isPlaying ? '❙❙ Pause' : '▶ Play'}</button>
                  <button
                    onClick={snd.stop}
                    style={{ padding:'8px 12px', background: SURF, color: DIM, border:`1px solid ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:600 }}
                  >■</button>
                  <span style={{ fontSize:10, color: MUTED, fontVariantNumeric:'tabular-nums', minWidth:74, textAlign:'right' }}>
                    {fmtTime(snd.currentTime)} / {fmtTime(snd.duration)}
                  </span>
                </div>

                <Sub>
                  <div style={{ fontSize:10, color: MUTED, fontWeight:700, marginBottom:4, letterSpacing:1 }}>ANALYSIS</div>
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[1024, 2048, 4096].map(n => (
                      <button key={n} onClick={() => snd.setOpts({ fftSize: n })}
                        style={{ flex:1, fontSize:10, padding:'4px 0', borderRadius:2,
                          background: snd.opts.fftSize === n ? ACCENT_DEEP : SURF,
                          color: snd.opts.fftSize === n ? '#fff' : MUTED,
                          border:`1px solid ${snd.opts.fftSize === n ? ACCENT_DEEP : BORDER}`, cursor:'pointer' }}>{n}</button>
                    ))}
                  </div>
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['Log', true], ['Linear', false]].map(([lbl, v]) => (
                      <button key={lbl} onClick={() => snd.setOpts({ logFreq: v })}
                        style={{ flex:1, fontSize:10, padding:'4px 0', borderRadius:2, textTransform:'uppercase',
                          background: snd.opts.logFreq === v ? ACCENT_DEEP : SURF,
                          color: snd.opts.logFreq === v ? '#fff' : MUTED,
                          border:`1px solid ${snd.opts.logFreq === v ? ACCENT_DEEP : BORDER}`, cursor:'pointer' }}>{lbl} freq</button>
                    ))}
                  </div>
                  <InlineSl label="Bins" hint="↕" help="Frequency rows — also the height of the generated heightmap. Changing this re-runs the analysis."
                    min={32} max={512} step={32} value={snd.opts.bins} onChange={v => snd.setOpts({ bins: v })} />

                  <div style={{ fontSize:10, color: MUTED, fontWeight:700, margin:'8px 0 4px', letterSpacing:1 }}>STREAM</div>
                  <InlineSl label="Window" hint="↔" help="Time columns held on screen — the width of the generated heightmap. Wider means more history but a heavier rebuild."
                    min={64} max={768} step={32} value={snd.opts.windowFrames} onChange={v => snd.setOpts({ windowFrames: v })} />
                  <InlineSl label="Rate" help="Heightmap pushes per second. Each one is a full geometry rebuild, so lower this if playback stutters on dense draw modes. Above ~30/s the ceiling is usually the rebuild itself rather than this setting."
                    min={2} max={60} value={snd.opts.fps} onChange={v => snd.setOpts({ fps: v })} fmt={v => v + '/s'} />
                  <InlineSl label="dB Floor" help="Noise gate. Raise it to drop quiet detail into flat ground and leave only the loud structure standing."
                    min={0} max={0.9} step={0.01} value={snd.opts.dbFloor} onChange={v => snd.setOpts({ dbFloor: v })} fmt={v => Math.round(v*100)+'%'} />
                  <InlineSl label="Contrast" help="Gamma applied after the gate. Above 1 sharpens peaks into ridges; below 1 flattens them into plateaus."
                    min={0.3} max={3} step={0.1} value={snd.opts.contrast} onChange={v => snd.setOpts({ contrast: v })} fmt={v => v.toFixed(1)} />
                </Sub>

                {/* Which shape the whole track takes when frozen. A stretched
                    spectrogram is only one answer; the others fold the track so
                    its structure — repeats, sections, groove — becomes relief. */}
                <Sub>
                  <div style={{ fontSize:10, color: MUTED, fontWeight:700, marginBottom:4, letterSpacing:1 }}>WHOLE TRACK</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:2, marginBottom:4 }}>
                    {TRACK_PROJECTIONS.map(pj => (
                      <button key={pj.id} data-testid={`projection-${pj.id}`}
                        onClick={() => snd.setOpts({ projection: pj.id })}
                        style={{ fontSize:10, padding:'4px 0', borderRadius:2, textTransform:'uppercase', cursor:'pointer',
                          background: projection.id === pj.id ? ACCENT_DEEP : SURF,
                          color: projection.id === pj.id ? '#fff' : MUTED,
                          border:`1px solid ${projection.id === pj.id ? ACCENT_DEEP : BORDER}` }}>{pj.label}</button>
                    ))}
                  </div>
                  <div style={{ fontSize:10, color: MUTED, lineHeight:1.4, marginBottom:8 }}>{projection.blurb}</div>

                  {projection.id === 'weave' && (
                    <div style={{ fontSize:10, color: MUTED, marginBottom:8 }}>
                      Detected tempo: <span style={{ color:'#a1a1aa', fontVariantNumeric:'tabular-nums' }}>
                        {detectedBpm ? `${Math.round(detectedBpm)} BPM` : '—'}
                      </span>
                    </div>
                  )}

                  <ProjectionParams
                    params={projection.params}
                    values={snd.opts?.proj?.[projection.id]}
                    onChange={(k, v) => snd.setProjParam(projection.id, k, v)}
                  />
                </Sub>

                <button
                  data-testid="soundscape-freeze"
                  onClick={() => { const r = snd.freezeFullTrack(); if (r) onSoundscapeFit?.(r) }}
                  style={{ width:'100%', padding:'8px 0', background: snd.frozen ? ACCENT_DEEP : SURF, color: snd.frozen ? '#fff' : DIM, border:`1px solid ${snd.frozen ? ACCENT_DEEP : BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:600 }}
                >{snd.frozen ? '❄ Whole Track Frozen' : 'Freeze Whole Track'}</button>
                <div style={{ fontSize:10, color: MUTED, marginTop:4, lineHeight:1.4 }}>
                  {snd.frozen
                    ? 'The whole track is the heightmap. Play or scrub to go back to streaming a moving window.'
                    : `Pauses playback and writes the entire track as one static heightmap — the ${projection.label} projection above. Useful for erosion, STL and SVG, which need a terrain that holds still.`}
                </div>
              </>
            )}
          </Section>

          <Section title="Hydraulic Erosion" open={sec.erosion} onToggle={() => tog('erosion')}>
            <Sub>
              <InlineSl label="Iterations" help="Total number of raindrops to simulate." min={1000} max={2000000} step={1000} value={eIters} onChange={v => setEIters(v)} fmt={v => (v/1000).toFixed(0)+'k'} />
              <InlineSl label="Radius" help="The width of the erosion brush." min={2} max={10} value={eRadius} onChange={v => setERadius(v)} />
              <InlineSl label="Inertia" help="Droplet momentum." min={0.01} max={0.5} step={0.01} value={eInertia} onChange={v => setEInertia(v)} fmt={v => v.toFixed(2)} />
              <InlineSl label="Capacity" help="Multiplier for sediment carry speed." min={1} max={20} step={0.5} value={eCapacity} onChange={v => setECapacity(v)} />
              <InlineSl label="Erosion" help="Aggressiveness of soil removal." min={0.01} max={1} step={0.01} value={eErode} onChange={v => setEErode(v)} fmt={v => v.toFixed(2)} />
              <InlineSl label="Deposition" help="Speed of sediment drop." min={0.01} max={1} step={0.01} value={eDeposit} onChange={v => setEDeposit(v)} fmt={v => v.toFixed(2)} />
              <InlineSl label="Evaporation" help="Droplet shrinkage rate." min={0.001} max={0.1} step={0.001} value={eEvap} onChange={v => setEEvap(v)} fmt={v => v.toFixed(3)} />
            </Sub>
            <div style={{ display:'flex', gap:4 }}>
              <button onClick={handleRunErosion} disabled={!heightmapPixels || isEroding} style={{ flex:2, padding:'8px 0', background: ACCENT, color:'#fff', border:'none', borderRadius:5, cursor: (heightmapPixels && !isEroding) ? 'pointer' : 'default', fontSize:11, fontWeight:600, opacity: (heightmapPixels && !isEroding) ? 1 : 0.5 }}>{isEroding ? `Eroding… ${erosionProgress}%` : 'Run Erosion'}</button>
              {/* Cancel takes Undo's place while a run is live — the two are
                  never useful at the same moment, and the row keeps its shape. */}
              {isEroding ? (
                <button onClick={handleCancelErosion} data-testid="erosion-cancel"
                  style={{ flex:1, padding:'8px 0', background: SURF, color: DIM, border:`1px solid ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:600 }}>Cancel</button>
              ) : (
                <button onClick={handleUndoErosion} disabled={!lastPixels} style={{ flex:1, padding:'8px 0', background: SURF, color: DIM, border:`1px solid ${BORDER}`, borderRadius:5, cursor: lastPixels ? 'pointer' : 'default', fontSize:11, fontWeight:600, opacity: lastPixels ? 1 : 0.5 }}>Undo</button>
              )}
            </div>
            {erosionError && (
              <div data-testid="erosion-error" role="status" style={{
                marginTop: 6, fontSize: 10, lineHeight: 1.45, color: '#fca5a5',
                background: 'rgba(153,27,27,0.18)', border: '1px solid #7f1d1d',
                borderRadius: 4, padding: '5px 7px',
              }}>Erosion failed — {erosionError}</div>
            )}
          </Section>

          <Section title="Export" open={sec.export} onToggle={() => tog('export')}>
            <div style={{ display:'flex', gap:4, marginBottom:4 }}>
              <ExpBtn label="SVG" hint="1" onClick={onSvg} /><ExpBtn label="PNG" hint="2" onClick={onPng} /><ExpBtn label="PNG α" hint="3" onClick={onPngAlpha} /><ExpBtn label="STL" hint="4" onClick={onStl} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:4, marginBottom:4 }}>
              <ExpBtn label={webmActive ? '⏹ Stop' : 'WebM'} hint={webmActive ? '' : '5'} onClick={onWebmToggle} active={webmActive} />
              <ExpBtn label="Hmap" hint="save" onClick={onHeightmap} />
              <ExpBtn label="Preset ⬇" hint="save" onClick={onSavePreset} />
              <ExpBtn label="Preset ⬆" hint="load" onClick={onLoadPreset} />
            </div>
            <InlineSl label="WebM dur." min={1} max={60} value={webmDuration} onChange={setWebmDuration} fmt={v => v+'s'} />
          </Section>

          {/* ── Analysis ───────────────────────────────────────────────────── */}
          <Section title="Analysis" open={sec.analysis} onToggle={() => tog('analysis')}>
            <div style={{ fontSize:10, color:MUTED, marginBottom:4 }}>
              Click two points on the terrain to sample a cross-section.
            </div>
            <button
              onClick={() => onProfileMode?.(!profileMode)}
              style={{
                width:'100%', padding:'8px 0', borderRadius:5, cursor:'pointer', fontSize:11,
                background: profileMode ? '#1d4ed8' : SURF,
                color: profileMode ? '#fff' : '#a1a1aa',
                border: `1px solid ${profileMode ? '#3b82f6' : BORDER}`,
              }}
            >
              {profileMode
                ? (profileClicks?.length === 0 ? 'Click point A…' : 'Click point B…')
                : 'Elevation Profile'}
            </button>
          </Section>

          {/* ── Stats ─────────────────────────────────────────────────────── */}
          <div style={{ padding:'8px 12px 4px', fontSize:10, color: MUTED, fontVariantNumeric:'tabular-nums', lineHeight:1.9 }}>
            <div>Segments: {segs} · Verts: {verts}</div>
            <div>Triangles: {tris} · Grid: {grid}</div>
            {geoTiffElevMin != null && geoTiffElevMax != null && (
              <div style={{ marginTop:2, color: MUTED }}>
                Elevation: {Math.round(geoTiffElevMin)} – {Math.round(geoTiffElevMax)} m
                &nbsp;(Δ {Math.round(geoTiffElevMax - geoTiffElevMin)} m)
              </div>
            )}
            {/* Only a GeoTIFF has a projection to report — a PNG heightmap and a
                frozen soundscape both clear geoTiffCRS, so this line stays absent
                for them rather than claiming a CRS they do not have. */}
            {geoTiffCRS && (
              <div style={{ marginTop:2, color: crsInfo.supported ? MUTED : '#f97316', wordBreak:'break-word' }}>
                Projection: {crsDisplayName(geoTiffCRS, geoTiffCRSName)}
                {crsInfo.accuracy === 'guess'   && ' · assumed UTM'}
                {crsInfo.accuracy === 'approx'  && ' · datum shift not applied'}
                {!crsInfo.supported             && ' · vector overlay unsupported'}
              </div>
            )}
          </div>
          </SectionFilter.Provider>
        </div>
      </aside>
    </>
  )
}
