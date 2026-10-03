/**
 * Custom right-hand control panel — design mirrors the original p5.js tool.
 */
import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from 'react'
import { version } from '../../package.json'
import { useStore } from '../store/useStore'
import { ErosionSection } from './panel/ErosionSection'
import { SOUNDSCAPE_DEFAULTS } from '../hooks/useSoundscape'
import { HYPSO_LAYER_IDS } from '../utils/drawModes'
import { randomPreset } from '../utils/presetGenetics'
import { bboxToWgs84, classifyCRS, crsDisplayName, metresPerWorldUnit } from '../utils/geoCoords'


import { GRADIENT_PRESETS } from '../utils/gradientPresets'
import { STYLE_DEF } from '../defaults'
import { GROUP_OF, presetStyle } from '../params'
import { TRACK_PROJECTIONS, detectTrackBpm, getProjection } from '../utils/trackProjections'
import { loadSingleLineManifest } from '../utils/textGeometry'
import { GradientPicker } from './GradientPicker'
import { Histogram } from './Histogram'
import { AudioMeter } from './AudioMeter'
import { AudioTransport } from './AudioTransport'
import { PAPERS, frameRect, paperAspect, paperRatioLabel } from '../utils/frame'
import { formatClock, zoneForLongitude } from '../utils/solar'

import { formatDistance, niceDistance } from '../utils/sheetMarks'
import { shadowSun } from '../utils/sunHours'
import { isDarkBackground } from '../utils/colorUtils'
import { plotEstimate } from '../utils/penRoute'
import { DEM_CREDIT, GEOCODER_CREDIT, describeFetch, fetchDem, geocodePlace, padBbox } from '../utils/demFetch'
import { DEFAULT_SPAN, fetchPreview, windowFor } from '../utils/extentPreview'
import { ExtentMap } from './panel/ExtentMap'
import { ExtentSection } from './panel/ExtentSection'
import { SpectrogramView } from './SpectrogramView'
import { ACCENT, ACCENT_DEEP, ACCENT_TEXT, BG, BODY_W, BORDER, Btn, Chevron, ColorRow, DANGER_BG, DANGER_BORDER, DANGER_TEXT, DIM, DateRow, DISABLED_OPACITY, ExpBtn, FONT, GLASS_BG, GLASS_BORDER, HelpBtn, InlineSl, LoadBtn, MiniBtn, MONO, MUTED, Note, ON_ACCENT, PanelStyles, RangeSl, RowBtn, STRONG, SelectRow, SUNK, SURF, Section, SegGroup, SegRow, Sl, Stage, StageRail, Sub, TEXT, Tog, TogColor, VEIL, W, WARN, WARN_BG } from './panel/ui'
import { ALWAYS_VALUED, FIRST_STAGE, PRESETS_STAGE, stageOf } from './panel/stages'
import { ModeBack, ModeSheet } from './panel/ModeSheet'
import { ModeSections } from './panel/ModeSections'

import { TextSection } from './panel/TextSection'
import { CoverMap } from './panel/CoverMap'
import { paletteInks, setCoverInk } from '../utils/coverPlate'
import { CoverPlate, ModeCopiesPanel, PaintedMasks, PanelStage, SectionFilter, SectionScope, sectionMatches } from './panel/filter'
import { ModeCopies } from './panel/ModeCopies'

import { MAX_MASKS, maskCoverage } from '../utils/maskLayers'
import { modifiedSections } from './panel/sectionParams'
import { VectorLayersPanel } from './panel/VectorLayersPanel'

/** Every tweakable key, from the one index that already enumerates them. */
const PARAM_KEYS = [...GROUP_OF.keys()]
import { SECTION_TERMS } from './panel/sectionTerms'
import { buildPlateLine, buildSectionSummaries } from './panel/sectionSummary'
import { applyTheme, storedTheme } from '../utils/theme'
import { AUTOMATION } from '../automation'

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

// The preview canvas. 240 is what a 272 px panel body leaves once the section
// keeps its padding, and the height is that on a 3:2 sheet.
const MAP_W = 240, MAP_H = 156

function TerrainFetchPanel({ onFetched }) {
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState(null)
  const [busy, setBusy] = useState(null)        // 'search' | 'fetch' | null
  const [progress, setProgress] = useState(0)
  const [credit, setCredit] = useState(null)
  // Its own error, shown in its own section. The vector panel's banner would
  // have been one import away and it lives three stages down the panel — an
  // error about a fetch you just started has to appear where you started it.
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const onError = setError
  /**
   * The box being aimed, and the ground it is drawn on.
   *
   * `null` until a place is picked. Holding the place alongside the box matters
   * for the export name — a plate fetched for the Erzberg writes `Erzberg.svg`,
   * and that has to survive the box being dragged somewhere the geocoder never
   * mentioned.
   */
  const [aim, setAim] = useState(null)   // { place, box, span, preview }
  const previewAbort = useRef(null)

  /**
   * Draw the ground around a box, at `span` times its size.
   *
   * Its own AbortController: a preview that is superseded by a wider one must
   * stop, and it must not cancel the terrain fetch that shares `abortRef`.
   */
  const loadPreview = async (place, box, span) => {
    previewAbort.current?.abort()
    const ctrl = new AbortController()
    previewAbort.current = ctrl
    setAim({ place, box, span, preview: null })
    try {
      const preview = await fetchPreview(windowFor(box, span, MAP_W / MAP_H), { signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setAim((a) => (a && a.place === place ? { ...a, preview } : a))
    } catch (err) {
      if (err?.name !== 'AbortError') onError(`Could not draw that area: ${err.message}`)
    }
  }

  const search = async (e) => {
    e?.preventDefault?.()
    const q = query.trim()
    if (!q || busy) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy('search'); setPlaces(null); onError(null)
    try {
      const found = await geocodePlace(q, { signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setPlaces(found)
      if (!found.length) onError(`Nothing found for “${q}”. Try a summit, a valley or a town.`)
    } catch (err) {
      if (err?.name !== 'AbortError') onError(`Place search failed: ${err.message}`)
    } finally {
      setBusy(null)
    }
  }

  const runFetch = async (place, box) => {
    if (busy) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy('fetch'); setProgress(0); onError(null)
    try {
      const dem = await fetchDem(box, { signal: ctrl.signal, onProgress: setProgress })
      if (ctrl.signal.aborted) return
      onFetched(dem, place.name)
      setPlaces(null)
      // The credit names the surveys the tiles themselves reported, which is
      // better provenance than any fixed line — and it is what has to travel
      // with the plate.
      setCredit({ sources: dem.sources, tiles: dem.tiles, zoom: dem.zoom,
                  metres: dem.groundMetres, place: place.name })
    } catch (err) {
      if (err?.name !== 'AbortError') onError(`Terrain fetch failed: ${err.message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {error && (
        <div data-testid="fetch-error" style={{ marginBottom:6, fontSize:10, lineHeight:1.6,
             color:WARN, background:WARN_BG, border:'1px solid rgba(249,115,22,0.35)',
             borderRadius:3, padding:'5px 7px' }}>{error}</div>
      )}
      <form onSubmit={search} style={{ display:'flex', gap:4, marginBottom:6 }}>
        <input type="text" value={query} data-testid="place-query"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Erzberg, Eiger, Snowdon…" aria-label="Place name"
          style={{ flex:1, minWidth:0, background:SURF, color:DIM, fontSize:11,
                   border:`1px solid ${BORDER}`, borderRadius:3, padding:'4px 6px' }} />
        <Btn type="submit" data-testid="place-search" disabled={!!busy || !query.trim()}>
          {busy === 'search' ? '…' : 'Search'}
        </Btn>
      </form>

      {busy === 'fetch' ? (
        <div data-testid="dem-progress" style={{ fontSize:10, color:MUTED, marginBottom:6 }}>
          <div style={{ marginBottom:4 }}>{`Fetching terrain… ${Math.round(progress * 100)}%`}</div>
          <div style={{ height:3, background:BORDER, borderRadius:3, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${Math.round(progress * 100)}%`, background:ACCENT }} />
          </div>
          <Btn block onClick={() => abortRef.current?.abort()} style={{ marginTop:6 }}>Cancel</Btn>
        </div>
      ) : places?.length && !aim ? (
        <div data-testid="place-results" style={{ marginBottom:6 }}>
          {places.map((pl, i) => (
            <button key={i} type="button" data-testid={`place-result-${i}`}
              onClick={() => loadPreview(pl, padBbox(pl.bbox), DEFAULT_SPAN)}
              style={{ display:'block', width:'100%', textAlign:'left', marginBottom:3, cursor:'pointer',
                       background:SURF, color:DIM, border:`1px solid ${BORDER}`, borderRadius:3,
                       padding:'5px 7px', fontSize:11 }}>
              <span style={{ fontWeight:700 }}>{pl.name}</span>
              {pl.kind && <span style={{ color:MUTED }}>{` · ${pl.kind}`}</span>}
              <span style={{ display:'block', fontSize:10, color:MUTED, overflow:'hidden',
                             textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pl.detail}</span>
            </button>
          ))}
        </div>
      ) : null}

      {aim && busy !== 'fetch' && (() => {
        const plan = describeFetch(aim.box)
        return (
          <div data-testid="extent-panel" style={{ marginBottom:6 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline',
                 fontSize:10, color:DIM, marginBottom:4 }}>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{aim.place.name}</span>
              <button type="button" data-testid="extent-clear" onClick={() => { previewAbort.current?.abort(); setAim(null) }}
                style={{ background:'none', border:'none', color:MUTED, cursor:'pointer', fontSize:10, padding:0 }}>
                back
              </button>
            </div>

            {aim.preview
              ? <ExtentMap preview={aim.preview} box={aim.box} busy={!!busy} width={MAP_W} height={MAP_H}
                  onChange={(box) => setAim((a) => (a ? { ...a, box } : a))} />
              : <div data-testid="extent-map-loading" style={{ height:MAP_H, marginBottom:6, borderRadius:3,
                     border:`1px solid ${BORDER}`, background:SURF, display:'flex', alignItems:'center',
                     justifyContent:'center', fontSize:10, color:MUTED }}>Drawing the ground…</div>}

            {/* What this box costs and produces, before a byte of it is fetched.
                Every figure comes from `describeFetch`, which is the same
                arithmetic the fetch itself runs. */}
            <div data-testid="extent-plan" style={{ fontSize:10, color:MUTED, lineHeight:1.7,
                 border:`1px solid ${BORDER}`, borderRadius:3, padding:'5px 7px', marginBottom:6 }}>
              {plan ? (<>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span>Zoom</span><span style={{ color:DIM, fontFamily:'monospace' }}>
                    {plan.zoom}{plan.zoom === 14 ? ' · deepest' : ''}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span>Tiles</span><span style={{ color:DIM, fontFamily:'monospace' }}>
                    {`${plan.tiles} / ${plan.maxTiles}`}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span>Raster</span><span style={{ color:DIM, fontFamily:'monospace' }}>
                    {`${plan.width} × ${plan.height} px`}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span>Ground</span><span style={{ color:DIM, fontFamily:'monospace' }}>
                    {`${plan.groundMetres < 10 ? plan.groundMetres.toFixed(1) : Math.round(plan.groundMetres)} m / px`}</span></div>
              </>) : <div>That extent is larger than the tile budget allows.</div>}
            </div>

            <div style={{ display:'flex', gap:4, marginBottom:6 }}>
              <Btn data-testid="extent-wider" disabled={!aim.preview || aim.span >= 12}
                onClick={() => loadPreview(aim.place, aim.box, Math.min(12, aim.span * 2))}>Wider</Btn>
              <Btn data-testid="extent-closer" disabled={!aim.preview || aim.span <= 1.3}
                onClick={() => loadPreview(aim.place, aim.box, Math.max(1.3, aim.span / 2))}>Closer</Btn>
            </div>
            {/* `block` is `flex:1`, so it spans only inside a flex row. */}
            <div style={{ display:'flex' }}>
              <Btn block variant="primary" data-testid="extent-fetch" disabled={!plan || !aim.preview}
                onClick={() => runFetch(aim.place, aim.box)}>Fetch this ground</Btn>
            </div>
          </div>
        )
      })()}

      {credit && (
        <div data-testid="dem-credit" style={{ fontSize:10, color:MUTED, lineHeight:1.7, marginBottom:6 }}>
          <div style={{ color:DIM }}>
            {`${credit.place} · ${credit.tiles} tiles at zoom ${credit.zoom} · ${Math.round(credit.metres)} m per pixel`}
          </div>
          <div>{GEOCODER_CREDIT}</div>
          <div>{DEM_CREDIT}</div>
          {/* The tiles say which survey they came from. Printing that beats
              printing the whole list of everything the dataset might contain. */}
          {credit.sources.length > 0 && (
            <div style={{ wordBreak:'break-word' }}>{`This ground: ${credit.sources.join(', ')}`}</div>
          )}
        </div>
      )}
    </>
  )
}

/**
 * The ground's scale, for the surface layers that read true degrees.
 *
 * A GeoTIFF knows its own pixel size and its heights, and then this is not
 * shown. A plain heightmap knows neither, so the slope in degrees needs them
 * from here, as the draw modes take theirs. Shared by Slope Shading, Aspect Map
 * and Openness: it is one fact about the ground, not three settings.
 */
function GroundScale({ style, ss, geoTiffBbox, hasGeoTiff }) {
  return (
    <>
      {!geoTiffBbox && (
        <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale. Shared by every surface layer that reads degrees." min={0.5} max={200} step={0.5} value={style.groundCellMetres ?? 10} onChange={v => ss({ groundCellMetres: v })} fmt={v => `${v} m`} />
      )}
      {!hasGeoTiff && (
        <InlineSl label="Relief" help="Metres from black to white in the heightmap. Shared by every surface layer that reads degrees." min={10} max={9000} step={10} value={style.groundRelief ?? 1000} onChange={v => ss({ groundRelief: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
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
        <span style={{ color:MUTED, fontFamily:'monospace' }}>{value.toFixed(3)}</span>
      </div>
      {show && (
        <div style={{
          fontSize: 10, color: MUTED, background: SUNK,
          padding: '4px 8px', borderRadius: 5, marginBottom: 8,
          border: `1px solid ${BORDER}`, lineHeight: 1.6
        }}>
          <div style={{ marginBottom: 4 }}>HI = (mean − min) / (max − min)</div>
          <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', columnGap: 8, rowGap: 2 }}>
            <span style={{ color:MUTED }}>&gt; 0.6</span><span>young / rugged — most area is high</span>
            <span style={{ color:MUTED }}>≈ 0.5</span><span>equilibrium</span>
            <span style={{ color:MUTED }}>&lt; 0.4</span><span>mature / eroded — few peaks remain</span>
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
                  style={{ padding:'4px 0' }}>{c.label}</Btn>
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
/*
 * Undo and redo, drawn rather than typed.
 *
 * The glyphs `↶` and `↷` were the first attempt and they render as thin hooks —
 * a stray pen mark in a bordered box, at whatever size and baseline the font
 * feels like. These are the arc-and-arrowhead every editor uses, in the same
 * currentColor SVG the GitHub mark beside them already is, so both scale and
 * align the same way.
 */
const UNDO_PATHS = 'M3.2 6.6h6.3a3.6 3.6 0 0 1 0 7.2H6.4M5.9 3.8 3.2 6.6l2.7 2.8'
const REDO_PATHS = 'M12.8 6.6H6.5a3.6 3.6 0 0 0 0 7.2h3.1M10.1 3.8l2.7 2.8-2.7 2.8'

/** A header action: 16px icon in a flat hit box, dimmed rather than blanked. */
function HeaderIconBtn({ onClick, disabled, testId, title, label, icon }) {
  return (
    <button onClick={onClick} disabled={disabled} data-testid={testId}
      title={title} aria-label={label} type="button"
      style={{
        background:'none', border:'none', padding:'4px 8px', display:'flex',
        alignItems:'center', justifyContent:'center', color: MUTED,
        // A disabled control used to keep its border and lose its glyph, which
        // reads as an empty box rather than as unavailable.
        opacity: disabled ? DISABLED_OPACITY : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.color = STRONG }}
      onMouseLeave={e => { e.currentTarget.style.color = MUTED }}>
      <svg width="16" height="16" viewBox="0 0 16 17" fill="none" stroke="currentColor"
        strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={icon} />
      </svg>
    </button>
  )
}

/**
 * The undo stack, as a list you can read and jump into.
 *
 * Undo was a button that took you back one step, and after four presses you
 * were somewhere you could not name and could not tell how far you had come.
 * The stack always held the answer; nothing showed it.
 *
 * The names are derived from the diff between each pair of snapshots — see
 * `utils/historyLabel.js` — so nothing in the panel had to be annotated for
 * this to exist, and nothing in the panel can fall out of it.
 *
 * Read downward as going back in time: the row under `now` is the most recent
 * change, and clicking it undoes exactly that. Redo sits above `now`, so the
 * line reads as one timeline with the present in the middle of it.
 */
function HistoryMenu({ labels, onUndoTo, onRedoTo, onClose }) {
  const undo = labels?.undo ?? []
  const redo = labels?.redo ?? []
  const Row = ({ children, onClick, testId, dim }) => (
    <button type="button" onClick={onClick} data-testid={testId} style={{
      display:'block', width:'100%', textAlign:'left', background:'none',
      border:'none', cursor:'pointer', padding:'5px 10px',
      fontSize:11, color: dim ? DIM : MUTED, borderRadius:3,
    }}
      onMouseEnter={(e) => { e.currentTarget.style.background = VEIL }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}>
      {children}
    </button>
  )
  return (
    <>
      {/* Catches the click that closes it, under the card and over everything
          else — a menu that only closes on its own button is a menu people
          leave open. */}
      <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:900 }} />
      <div data-testid="history-menu" style={{
        position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:901,
        minWidth:210, maxWidth:260, maxHeight:320, overflowY:'auto',
        background:BG, border:`1px solid ${BORDER}`, borderRadius:5,
        boxShadow:'0 12px 32px var(--hm-shadow)', padding:4,
      }}>
        {/* Newest redo nearest `now`, so the column is chronological throughout
            rather than two lists that happen to touch. */}
        {[...redo].reverse().map((label, i) => (
          <Row key={`r${i}`} dim testId={`history-redo-${redo.length - 1 - i}`}
            onClick={() => { onRedoTo(redo.length - i); onClose() }}>
            ↷ {label}
          </Row>
        ))}
        <div style={{
          display:'flex', alignItems:'center', gap:8, padding:'4px 10px',
          fontSize:10, fontFamily: MONO, color: ACCENT_TEXT,
        }}>
          now
          <span style={{ flex:1, height:1, background: BORDER }} />
        </div>
        {undo.map((label, i) => (
          <Row key={`u${i}`} testId={`history-undo-${i}`}
            onClick={() => { onUndoTo(i + 1); onClose() }}>
            {label}
          </Row>
        ))}
        {!undo.length && !redo.length && (
          <div style={{ padding:'6px 10px', fontSize:11, color: DIM }}>Nothing yet.</div>
        )}
      </div>
    </>
  )
}

function plateCommand({ filename, bbox, crs }) {
  const base = 'node scripts/embed-window.js'
  const wgs = bboxToWgs84(bbox, crs)
  const fromFile = /\.(tif|tiff|geotiff)$/i.test(filename ?? '')
  if (fromFile) return { cmd: `${base} --dem "${filename}"`, exact: true }
  if (wgs) {
    const r = (v) => Number(v).toFixed(4)
    return { cmd: `${base} --bbox ${r(wgs[0])},${r(wgs[1])},${r(wgs[2])},${r(wgs[3])}`, exact: false }
  }
  return { cmd: `${base} --place "Eisenerz"`, exact: false }
}

/**
 * A command to run elsewhere, with the one gesture that matters on it.
 *
 * `flex-start` on the row rather than the default stretch: a two-line command
 * with a stretched button beside it turns Copy into a slab twice the height of
 * every other button in the panel. It keeps its own size and sits at the top,
 * next to the line it copies.
 *
 * The line wraps between arguments and nowhere else, which takes a span per
 * token to achieve. No wrapping mode does it alone: a hyphen is a break
 * opportunity in its own right, so `--dem` split across two lines under
 * `break-all`, under `break-word` and under `anywhere` alike. A command broken
 * mid-flag reads as a different command. `overflowX` is the safety valve for
 * the one token that genuinely cannot fit — a very long filename — which
 * scrolls rather than pushing the panel sideways.
 */
function CommandLine({ cmd }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
      <code style={{
        flex: 1, minWidth: 0, fontSize: 10, lineHeight: 1.6, color: MUTED, background: SURF,
        border: `1px solid ${BORDER}`, borderRadius: 3, padding: '5px 7px',
        fontFamily: 'ui-monospace, monospace', userSelect: 'all', overflowX: 'auto',
      }}>
        {/* The separating space sits *outside* the span. Inside it, the
            span's own `nowrap` swallows the only break opportunity in the
            line and the command stops wrapping altogether. */}
        {cmd.split(' ').map((word, i) => (
          <Fragment key={i}>
            {i ? ' ' : null}
            <span style={{ whiteSpace: 'nowrap' }}>{word}</span>
          </Fragment>
        ))}
      </code>
      <Btn size="xs" style={{ padding: '4px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}
        aria-label={copied ? 'Command copied' : 'Copy the command'}
        onClick={() => {
          navigator.clipboard?.writeText(cmd)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}>{copied ? 'Copied' : 'Copy'}</Btn>
    </div>
  )
}

function CoverFact({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 10, color: DIM, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 10, color: MUTED, textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}

/**
 * Prose inside this section, and why it is not `<Note>`.
 *
 * `Note` carries `marginTop: -4` because it is a *caption*: it hugs the control
 * directly above it and reads as that control's small print. Used as a
 * standalone paragraph it pulls into whatever precedes it — as the first child
 * of a section it clipped its own first line against the header, and under a
 * button it overlapped the button's bottom edge.
 *
 * So the rail belongs to captions only. Everything else here is a paragraph
 * with no margin of its own, spaced by the column it sits in.
 */
function CoverProse({ caption = false, children }) {
  return (
    <div style={{
      fontSize: 10, color: MUTED, lineHeight: 1.6,
      ...(caption ? { paddingLeft: 6, borderLeft: `2px solid ${BORDER}` } : null),
    }}>{children}</div>
  )
}

/** The small uppercase label the mode sections use for a group, without a rail. */
function CoverLabel({ children }) {
  return (
    <div style={{ fontSize: 11, color: DIM, fontWeight: 600 }}>{children}</div>
  )
}

/**
 * One row of buttons.
 *
 * `Btn block` is `flex: 1`, which does nothing at all outside a flex row — a
 * lone `<Btn block>` sized itself to its label and sat there half-width. Every
 * button in this section goes through here so that cannot happen again.
 */
function CoverRow({ children }) {
  return <div style={{ display: 'flex', gap: 4 }}>{children}</div>
}

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
  // Terrain by name: the panel resolves the place and pulls the tiles itself,
  // and hands over one finished raster.
  onFetchTerrain,
  soundscape, onSoundscapeFit, flockAudio,
  geoTiffElevMin, geoTiffElevMax, geoTiffCRS, geoTiffCRSName,
  geoTiffBbox,
  // Where the sun is, or null while the panel is set to the convention. Computed
  // once in App.jsx and handed to both the shader and this panel, so the plate
  // and the line that describes it read the same number.
  sun,
  textLayers, setTextLayers, textOverflow,
  onUndo, onRedo, canUndo, canRedo,
  onUndoTo, onRedoTo, historyLabels,
  loadGpxFromPicker, loadGeoJsonFromPicker,
  vectorSources, vectorLayers, vectorCoverage, vectorError,
  onPatchVectorLayer, onRemoveVectorLayer, onReorderVectorLayer, onRemoveVectorSource,
  onAdoptVectorSource, onVectorError, vectorIdentify, onVectorIdentify,
  // Land cover: the plate itself, the two ways to get one, and the action that
  // deals a mark to each of its classes.
  cover, coverError, onLoadCover, onClearCover, onInkByClass,
  // Hand-drawn masks, the Studio that paints them, and the imagery behind it.
  masks = [], onAddMask, onPatchMask, onCopyMask, onRemoveMask, onImportMask, onEditMask,
  imagery, imageryBusy, onFetchImagery, onClearImagery,
  onCustomIcon, iconOverflow, labelOverflow,
  onCameraPreset,
  onSvg, onPng, onPngAlpha, onStl, onHeightmap,
  onWebmToggle, webmActive,
  webmDuration, setWebmDuration,
  onSavePreset, onLoadPreset,
  // The plotter preflight: a run of the SVG pipeline that writes no file, and
  // the four numbers it comes back with.
  onPreflight, plotStats,
  externalPresets,
  onReset,
  onResetSection,
  paramDefaults,
  sessionRestored,
  baseZoom = 1,
  lineGeo, surfaceGeo, terrainData,
  hypsometricIntegral,
  lastBuildMs, isComputing,
  profileMode, profileClicks, onProfileMode, pick, onPick,
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
  const [theme, setTheme] = useState(storedTheme)
  const filterRef = useRef(null)
  // Which cover class the pointer is over, shared by the class map and the
  // legend so that pointing at either lights up the other.
  const [hoveredClass, setHoveredClass] = useState(null)
  // The bundled stroke faces, for the contour-label face picker. `LabelPicker`
  // fetches the same manifest for the vector labels; `loadSingleLineManifest`
  // caches at module level, so asking twice costs one request.
  const [singleLineFonts, setSingleLineFonts] = useState([])
  useEffect(() => { loadSingleLineManifest().then(setSingleLineFonts) }, [])
  const q = filter.trim().toLowerCase()
  /**
   * What every shut section says about itself.
   *
   * Rebuilt whenever the params move, which is the point — the header is reading
   * the same state its controls are bound to. It rides the filter context rather
   * than becoming a fiftieth prop: `Section` already looks its search terms up by
   * title there, so this is the same lookup with a second key and not one call
   * site in this file had to change.
   */
  /**
   * Whether the sun is being read rather than chosen.
   *
   * Multi-direction shading averages eight light directions, so it has no
   * azimuth for an ephemeris to drive — the almanac and it are mutually
   * exclusive by construction rather than by a warning, and this is the one
   * place that is decided.
   */
  const almanac = !!style.hillshadeAlmanac && !style.hillshadeMultiDir
  // Whether the raster answers the sun-hours latitude itself. The same question
  // the almanac asks, and the same answer: a GeoTIFF carries it, a PNG does not.
  const sunHoursGeoreferenced = !!bboxToWgs84(geoTiffBbox, geoTiffCRS)
  /**
   * What the sun-hours field is about to cost, in sweeps and in seconds.
   *
   * Three numbers multiply and nothing on screen said so: the two sampling
   * sliders and the size of the grid. Twenty-four days by forty-eight positions
   * over a 1024² raster is 1 152 passes and about thirteen seconds, which reads
   * as a hang rather than as work.
   *
   * The count alone would be the wrong thing to print, because the same count is
   * a fifth of a second on a small grid. The constant is measured: 80 sweeps
   * over 1024² took 934 ms, so a cell-sweep is about 11 nanoseconds. An upper
   * bound either way — a polar night contributes no positions at all.
   */
  /**
   * Where the sun stood for the Shadow Line, resolved the same way the worker
   * resolves it — one function, so the readout and the line cannot disagree
   * about which moment is being drawn.
   */
  const shadowLineSun = style.enabledShadowLine
    ? shadowSun({ ...style, geoTiffBbox, geoTiffCRS })
    : null
  const sunHoursSweeps = (style.periodSunHours === 'day' ? 1 : (style.daysSunHours ?? 8))
    * (style.perDaySunHours ?? 12)
  const sunHoursSeconds = terrainData
    ? (sunHoursSweeps * terrainData.rows * terrainData.cols * 1.11e-8)
    : 0
  /**
   * What the sheet marks measure, straight off the render loop.
   *
   * Written by `Scene` every frame the camera moves, which is the only place it
   * can be read: an orbit drag moves the camera without React hearing about it.
   * The panel subscribes to the same value the overlay draws from, so the number
   * in the header and the bar on the plate are one measurement.
   */
  const mapScale = useStore((s) => s.mapScale)
  /**
   * How wide the sheet is on screen, in the same pixels `mapScale` was measured
   * in — the paper frame when one is declared, the whole canvas otherwise.
   *
   * The same rect `sheetMarks` lays the bar inside and the same rect the SVG
   * export cuts to, so the two readouts below describe the plate somebody will
   * actually hold rather than the window it was composed in.
   */
  const sheetPx = (() => {
    const w = window.innerWidth - W, h = window.innerHeight
    if (!view.showFrame) return w
    return frameRect(w, h,
      paperAspect(view.framePaper ?? 'iso', !!view.frameLandscape, view.frameCustomRatio),
      view.frameScale ?? 0.85, view.frameOffsetX ?? 0, view.frameOffsetY ?? 0).w
  })()
  // The same 22%-of-the-sheet target the layout uses, so the readout names the
  // distance the bar will actually be drawn at rather than a second guess at it.
  const barTargetMetres = mapScale ? sheetPx * 0.22 * mapScale.metresPerPixel : 0
  /**
   * The map's ratio — the thing a scale bar cannot say on its own.
   *
   * It needs the sheet's physical size, which is why it could not ship with the
   * bar: `frame.js` is keyed by *ratio* on purpose, because an export carries
   * pixel dimensions rather than millimetres. The plotter section asks for the
   * width in millimetres for its own reasons, and once that number exists this
   * one is arithmetic.
   */
  const mapRatio = mapScale && (view.plotWidthMm ?? 0) > 0 && sheetPx > 0
    ? (mapScale.metresPerPixel * sheetPx * 1000) / view.plotWidthMm
    : null

  const summaries = useMemo(() => buildSectionSummaries({
    terrain, style, view, points,
    zoomPercent: (view.zoom / baseZoom) * 100,
    vectorLayers, textLayers, soundscape, cover, imagery, masks,
  }), [terrain, style, view, points, baseZoom, vectorLayers, textLayers, soundscape, cover, imagery, masks])
  /**
   * Which sections differ from their defaults.
   *
   * Recomputed whenever any parameter moves, which is every drag frame — so it
   * is 672 comparisons against a plain object, and nothing more. What it buys
   * is that the reset control is drawn only where there is something to reset,
   * which turns fifty-five identical icons into a map of where the work is.
   */
  const modified = useMemo(() => modifiedSections(
    { ...terrain, ...style, ...points, ...view, gradientStops },
    paramDefaults, Object.keys(SECTION_TERMS), PARAM_KEYS,
  ), [terrain, style, points, view, gradientStops, paramDefaults])
  /**
   * Which stage pane is on screen, and which mark is drilled into.
   *
   * Two pieces of navigation state and nothing else — neither one is a setting,
   * so neither belongs in the session with the parameters. A reload opens on
   * Source with the sheet up, which is where a drawing starts.
   */
  const [stage, setStage] = useState(FIRST_STAGE)
  const [drill, setDrill] = useState(null)
  /**
   * Leaving Marks closes whatever was drilled into.
   *
   * Otherwise the sheet is behind a mode nobody is looking at: come back to
   * Marks from Frame and you land in `Mode: Contours` rather than on the sheet,
   * with no memory of having opened it. The rail is the way out of a mode as
   * much as the back bar is.
   */
  const goStage = useCallback((n) => {
    setStage(n)
    if (n !== 3) setDrill(null)
    /*
     * Landing on Marks opens the sheet if it was shut.
     *
     * The sheet is the whole pane now, so a shut `Draw Modes` leaves one header
     * and nothing under it — a dead end that the old pane never had, because
     * shutting the index there still left forty section headers below it.
     * Reopening on arrival keeps the disclosure and removes the dead end.
     */
    if (n === 3) setSec(prev => (prev.modeIndex ? prev : { ...prev, modeIndex: true }))
    // A tab click while filtering is a request to go to that pane, and the panes
    // do not exist while a query is typed. Clearing the field is what makes the
    // hit counts on the rail somewhere you can actually go.
    setFilter('')
    document.getElementById('hm-panel-body')?.scrollTo({ top: 0 })
  }, [])
  const stageCtx = useMemo(() => ({ stage, setStage: goStage }), [stage, goStage])

  /**
   * What each rail tab counts.
   *
   * `live` is lit sections per stage, read off the same summaries the green dots
   * are, so the rail and the dots cannot disagree. `hits` replaces it while a
   * query is typed, because the question changes: not "what is on in there" but
   * "did my search find anything in there".
   */
  const live = useMemo(() => {
    const out = {}
    for (const [title, value] of Object.entries(summaries)) {
      // The same test the header's dot uses: a section states its setting, and
      // an em dash is how it says it is doing nothing.
      if (!value || value === '—' || value.text === '—') continue
      if (ALWAYS_VALUED.has(title)) continue
      const n = stageOf(title)
      if (n) out[n] = (out[n] || 0) + 1
    }
    return out
  }, [summaries])
  const hits = useMemo(() => {
    if (!q) return null
    const out = {}
    for (const [title, words] of Object.entries(SECTION_TERMS)) {
      if (!sectionMatches(title, words, q)) continue
      const n = stageOf(title)
      if (n) out[n] = (out[n] || 0) + 1
    }
    return out
  }, [q])

  const filterCtx = useMemo(
    () => ({ q, terms: SECTION_TERMS, summaries, modified, drill, onReset: onResetSection }),
    [q, summaries, modified, drill, onResetSection])
  /** The same reading one level up: the whole plate, for the standing line. */
  const plate = useMemo(
    () => buildPlateLine({ style, vectorLayers, textLayers, coverClasses: cover?.classes?.length ?? 0 }),
    [style, vectorLayers, textLayers, cover])
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
    // Levels open, beside Shape. Both are the raster's own conditioning and
    // they are read together — a black point means nothing without the
    // histogram beside it.
    // Presets open again. It was shut because the grid is 2 346 px of
    // thumbnails and everything after it had to be scrolled past — a real cost
    // when it was the tenth section of sixty in one column. It has a pane of
    // its own now and nothing shares it, so there is nothing left to scroll
    // past and a shut header is one click between you and the only thing there.
    shape: true, levels: true, camera: true, paper: false, presets: true, style: true,
    modeLines: true, modeCross: false, modePillars: false, modeContours: false,
    modeHachure: false, modeFlow: false, modeDag: false, modePencil: false,
    modeRidge: false, modeValley: false, modeStipple: false,
    modeIso: false, modeEngrave: false, modeCurv: false, modeSwiss: false,
    modeBitplane: false, modeFlashbulb: false, modeHalation: false,
    modeFallLine: false, modeBerm: false, modeAir: false, modeRaceLine: false,
    modeZeroCross: false,
    modeSprite: false, modeRetic: false, modeTsp: false, modeShadowHatch: false, modeRugged: false, modeIsochrone: false, modeTruchet: false, modeViewshed: false, modeRoute: false, modePanorama: false, modeBedding: false, modeSlopeClass: false, modeWind: false, modeRunout: false, modeMapGrid: false, modePrinter: false, modeStems: false, modeHair: false, modeWaveform: false, modeVenation: false, modeGeodesic: false, modeRadar: false, modeSpines: false, modeCoral: false, modeGlacier: false, modeIndex: true, modeSunHours: false,
    modeIndexed: false, modeOutrun: false, modeRiso: false,
    modeMineral: false, modeShed: false,
    hillshade: false, slopeShade: false, vectorLayers: false, text: false,
    waterFill: false, aspectMap: false, analysis: false,
    localRelief: false, curvShade: false, openness: false, texShade: false, aerial: false, wetness: false, sunTint: false,
    points: false, texture: false, mirror: false, erosion: false, export: true,
    sheetMarks: false, fetchTerrain: false, extent: false, modeShadowLine: false, anaglyph: false,
    soundscapes: false, landCover: false, modeCover: false,
    satellite: false, masks: false,
  })

  // --- Discovery State ---
  const [lastPreset,  setLastPreset]  = useState(null)   // name of the last applied preset
  // Whether anything has been changed since that preset was applied. The tile
  // stays highlighted — it is still where this look started, and that is worth
  // knowing — but it says so rather than claiming the settings still match.
  const [presetEdited, setPresetEdited] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // Every seed rolled this session, oldest first, and which one is showing.
  // Back and forward walk the list; a new roll goes on the end, so stepping
  // back never costs the rolls after it.
  const [rolls,       setRolls]       = useState([])
  const [rollAt,      setRollAt]      = useState(-1)
  const rollSeed = rolls[rollAt] ?? null
  // Presets whose thumbnail failed to load, so the tile falls back to a label.
  const [noThumb,     setNoThumb]     = useState(() => new Set())

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
      // Keyed on the character, like `?`: `/` is Shift+7 on a German layout.
      if (e.key === '/') {
        e.preventDefault()
        setOpen(true)
        requestAnimationFrame(() => filterRef.current?.focus())
      }
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

  /**
   * Whether the opening preset may still land.
   *
   * It waits on 56 preset files, so on a slow connection — a deployed build
   * rather than a dev server on localhost — it can arrive a second or more after
   * the panel is already usable. Anything that deliberately establishes a look
   * inside that window has to win, or the opening quietly lands on top of it.
   *
   * This was one flag short of that. Moving a slider set it, but the three paths
   * that set a *whole* look did not: Reset all cleared the preset tiles and left
   * this alone, so a reset inside that first second gave bare defaults and then
   * Alpine Survey a moment later; Surprise me and loading a preset file had the
   * same hole. One flag now, spent by every path that establishes a look —
   * including the opening itself, which is what makes it run once.
   */
  const openingSpent = useRef(false)
  const spendOpening = () => { openingSpent.current = true }
  // Every style or particle change that did not come from applyPreset means the
  // user has left the preset behind. applyPreset writes through setStyle/setPoints
  // directly, so it does not trip this.
  const leftPreset = () => { spendOpening(); if (lastPreset) setPresetEdited(true) }
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
    // Bare defaults are a look the user asked for, so the opening must not
    // arrive after it and overwrite it.
    spendOpening()
    setLastPreset(null)
    setPresetEdited(false)
    setRolls([])
    setRollAt(-1)
    // The disclosures follow the style back, as they follow it anywhere else.
    // applyPreset has always re-synced them; a reset did not, so a look that had
    // switched Lines off left that section collapsed — and the reset then turned
    // Lines back on behind a shut disclosure, which is the one state this panel
    // is not supposed to be able to reach.
    syncSectionsToStyle(STYLE_DEF)
    onReset?.()
  }

  const hasGeoTiff  = geoTiffElevMin != null && geoTiffElevMax != null
  // Facts the builders measured, carried on their layers as `note`. A mode with
  // several pens carries it on each, so any one of them that drew will do.
  const noteOf = (id) => (Array.isArray(lineGeo)
    ? lineGeo.find((l) => (l.id === id || l.id.startsWith(`${id}-`)) && l.note)?.note : null) ?? null
  const viewshedNote = noteOf('Viewshed')
  const routeNote = noteOf('Route')
  const slopeClassNote = noteOf('SlopeClass')
  const windNote = noteOf('Wind')
  const runoutNote = noteOf('Runout')
  const venationNote = noteOf('Venation')
  const coralNote = noteOf('Coral')
  const glacierNote = noteOf('Glacier')
  const mapGridNote = noteOf('MapGrid')
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
  // The terrain's longer side in world units: as far as a spacing can usefully
  // go, where a grid fitted to the edges is only its frame.
  const plateSpan = terrainData?.cols
    ? Math.ceil(Math.max(terrainData.cols - 1, terrainData.rows - 1) * (terrainData.scl || 1))
    : 1000
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
      modeBitplane: !!newStyle.enabledBitplane,
      modeFlashbulb: !!newStyle.enabledFlashbulb,
      modeHalation: !!newStyle.enabledHalation,
      modeFallLine: !!newStyle.enabledFallLine,
      modeBerm:     !!newStyle.enabledBerm,
      modeAir:      !!newStyle.enabledAir,
      modeRaceLine: !!newStyle.enabledRaceLine,
      modeZeroCross: !!newStyle.enabledZeroCross,
      modeSprite:   !!newStyle.enabledSprite,
      modeRetic:    !!newStyle.enabledRetic,
      modeTsp:      !!newStyle.enabledTsp,
      modeShadowHatch: !!newStyle.enabledShadowHatch,
      modeRugged:   !!newStyle.enabledRugged,
      modeIsochrone: !!newStyle.enabledIsochrone,
      modeTruchet:  !!newStyle.enabledTruchet,
      modeViewshed: !!newStyle.enabledViewshed,
      modeRoute:    !!newStyle.enabledRoute,
      modePanorama: !!newStyle.enabledPanorama,
      modeBedding:  !!newStyle.enabledBedding,
      modeSlopeClass: !!newStyle.enabledSlopeClass,
      modeWind:     !!newStyle.enabledWind,
      modeRunout:   !!newStyle.enabledRunout,
      modeMapGrid:  !!newStyle.enabledMapGrid,
      modePrinter:  !!newStyle.enabledPrinter,
      modeStems:    !!newStyle.enabledStems,
      modeHair:     !!newStyle.enabledHair,
      modeWaveform: !!newStyle.enabledWaveform,
      modeVenation: !!newStyle.enabledVenation,
      modeGeodesic: !!newStyle.enabledGeodesic,
      modeRadar:    !!newStyle.enabledRadar,
      modeSpines:   !!newStyle.enabledSpines,
      modeCoral:    !!newStyle.enabledCoral,
      modeGlacier:  !!newStyle.enabledGlacier,
      modeIndexed:  !!newStyle.enabledIndexed,
      modeOutrun:   !!newStyle.enabledOutrun,
      modeRiso:     !!newStyle.enabledRiso,
      modeMineral:  !!newStyle.enabledMineral,
      modeShed:     !!newStyle.enabledShed,
    }))
  }

  /**
   * The glyph on a tile in the sheet.
   *
   * It writes the same `enabled<Id>` the section's own switch writes, and that
   * is deliberately all it writes — the tile and the switch are two views of one
   * boolean rather than two pieces of state to keep in step.
   *
   * It used to open the mode's section and scroll to it as well, because turning
   * one on was almost always the first half of tuning it, and the index it lived
   * in sat above forty headers that were the real way in. The sheet *is*
   * the way in, and opening a mode is now its own target on the same tile — so
   * switching one on leaves you on the sheet, where switching on a second and a
   * third is one click each. The section still opens underneath, so drilling in
   * afterwards shows its controls rather than a shut header.
   */
  const handleModeTile = (key, next) => {
    ss({ [key]: next })
    if (!next) return
    setSec(prev => ({ ...prev, ['mode' + key.slice('enabled'.length)]: true }))
  }

  /**
   * The name on a tile: open that mark, alone, with the whole panel.
   *
   * The scroll goes to the top rather than to the section, because the section
   * is about to be the only thing in the pane — there is nothing to scroll past
   * and a smooth scroll to y=0 from y=0 is a no-op that costs a frame.
   */
  const openMark = useCallback((title) => {
    setDrill(title)
    document.getElementById('hm-panel-body')?.scrollTo({ top: 0 })
  }, [])

  const applyPreset = (preset, name = null) => {
    // Rolling a look or picking a tile is establishing one, so it spends the
    // opening too — otherwise a roll in the first second is overwritten by it.
    spendOpening()
    setStyle(prev => presetStyle(prev, preset.style))
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
  useEffect(() => {
    // A scripted run states its own look, so the opening must not land on it.
    if (AUTOMATION || openingSpent.current || sessionRestored) return
    const preset = externalPresets?.[OPENING_PRESET]
    if (!preset) return                       // manifest still in flight
    spendOpening()
    applyPreset(preset, OPENING_PRESET)
    // Not the user's doing, so it must not be stored as their session.
    onPristine?.()
    // applyPreset is rebuilt every render and the guard above is what makes this
    // run once; listing it would re-apply the preset over the user's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPresets, sessionRestored, onPristine])

  // ── Discovery: rolling a look ─────────────────────────────────────────────
  const presetNames = Object.keys(externalPresets || {})

  /*
   * Rolling a look must not move the button that rolled it.
   *
   * A roll is a preset, and applying one syncs every mode section open or shut
   * to match. That changes the panel's total height, and where the panel was
   * scrolled near its end the browser clamps `scrollTop` to the new maximum —
   * so the whole column slides and the dice land somewhere else. Which is fatal
   * for the one thing this button is for: pressing it over and over until
   * something looks right. You end up chasing it down the panel.
   *
   * The fix is a scroll anchor rather than a restriction on what a roll may
   * change: note where the button is before, and after the commit put the
   * scroller back by however far it drifted. The sections still track the look —
   * which is what makes the panel worth reading after a roll — and the cursor
   * stays over the dice.
   */
  const surpriseRef = useRef(null)
  const anchorTopRef = useRef(null)

  const anchorSurprise = () => {
    anchorTopRef.current = surpriseRef.current?.getBoundingClientRect().top ?? null
  }

  useLayoutEffect(() => {
    const want = anchorTopRef.current
    if (want == null) return
    anchorTopRef.current = null
    const btn = surpriseRef.current
    const body = document.getElementById('hm-panel-body')
    if (!btn || !body) return
    // Layout, not paint: this runs before the browser draws, so the correction
    // is never visible as a jump.
    const drift = btn.getBoundingClientRect().top - want
    if (drift) body.scrollTop += drift
  })

  const roll = (seed) => {
    const preset = randomPreset(seed)
    applyPreset(preset, null)
    return preset
  }

  // The seed *is* the look, so history is a list of integers rather than a
  // stack of 250-key snapshots. Fifty of them cost nothing.
  const ROLLS_KEPT = 50
  const handleSurprise = () => {
    const seed = Math.floor(Math.random() * 0xffffffff)
    anchorSurprise()
    const next = [...rolls, seed].slice(-ROLLS_KEPT)
    setRolls(next)
    setRollAt(next.length - 1)
    roll(seed)
  }

  // Step through the rolls. Read outside any updater: applying the preset is a
  // side effect, and React is free to call a state updater more than once.
  const stepRoll = (by) => {
    const at = rollAt + by
    if (at < 0 || at >= rolls.length) return
    anchorSurprise()
    setRollAt(at)
    roll(rolls[at])
  }
  const canBack = rollAt > 0
  const canForward = rollAt >= 0 && rollAt < rolls.length - 1

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


  // The mode sections, for the panel and for a mode copy's body. A copy reads
  // its own view of the style and writes to itself; see panel/ModeCopies.jsx.
  // The props the mode sections take besides the style, for the panel and for a
  // copy's body. The panel's own tag stays where it stands below, because
  // tests/unit/sectionParams.test.js reads the mode bodies in at that place.
  const modeSectionProps = { mapGridNote, cover, geoTiffBbox, gradientStops, hasGeoTiff, intervalMax, intervalMin, mPerWorld, metreInterval, onPick, pick, plateSpan, coralNote, glacierNote, routeNote, runoutNote, slopeClassNote, sec, sg, shadowLineSun, singleLineFonts, sunHoursGeoreferenced, sunHoursSeconds, sunHoursSweeps, terrain, tog, venationNote, viewshedNote, windNote }
  const renderModeSections = (st, setter) => createElement(ModeSections, { ...modeSectionProps, style: st, ss: setter })
  const modeCopiesPanel = {
    render: (title) => (
      <ModeCopies title={title} style={style} ss={ss}
        renderBody={(t, view, setter) => (
          <SectionScope.Provider value={t}>{renderModeSections(view, setter)}</SectionScope.Provider>
        )} />
    ),
  }

  return (
    <>
      <PanelStyles />

      <button type="button" data-testid="sidebar-toggle" onClick={() => setOpen(o => !o)}
        aria-expanded={open} aria-controls="hm-panel"
        title={open ? 'Hide the panel  \\' : 'Show the panel  \\'}
        aria-label={open ? 'Hide the panel' : 'Show the panel'}
        style={{
          position:'fixed', right: open ? W : 0, top:'50%', transform:'translateY(-50%)',
          width:18, height:56, background: GLASS_BG,
          backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)',
          border:`1px solid ${GLASS_BORDER}`, borderRight:'none',
          borderRadius:'8px 0 0 8px',
          cursor:'pointer', zIndex:1001, userSelect:'none',
          display:'flex', alignItems:'center', justifyContent:'center',
          color: MUTED, fontSize:9, boxShadow:'-4px 0 14px var(--hm-shadow)',
          transition:'right .26s cubic-bezier(.2,.8,.2,1), color .15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = STRONG }}
        onMouseLeave={e => { e.currentTarget.style.color = MUTED }}>{open ? '▶' : '◀'}</button>

      <aside id="hm-panel" aria-label="Controls" style={{
        position:'fixed', right:0, top:0, width:W, height:'100%',
        background: BG, color: TEXT, zIndex:1000,
        display:'flex', flexDirection:'column',
        transform: open ? 'none' : `translateX(${W}px)`,
        transition:'transform .26s cubic-bezier(.2,.8,.2,1)',
        boxShadow:'-1px 0 0 var(--hm-veil), -12px 0 32px var(--hm-shadow)',
        fontFamily: FONT,
        WebkitFontSmoothing:'antialiased', MozOsxFontSmoothing:'grayscale',
      }}>
        {/*
          * Identity on one line, actions on the next.
          *
          * All five used to share a row 248px wide inside its padding, and they
          * did not fit: "Reset all" wrapped to two lines, which is what made the
          * header 62px tall and look broken rather than tight. Adding undo and
          * redo is what tipped it over, but the row was already carrying a name,
          * a version, a link and a destructive button — identity and actions are
          * not the same kind of thing and were only ever together because there
          * was just enough room.
          *
          * Two rows cost nothing here: the split header is the same height the
          * wrapped one had reached, and every control now has space to be the
          * size it should be.
          */}
        <div style={{ padding:'11px 12px 9px', borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <h1 style={{ fontFamily:"'Space Mono', monospace", fontSize:13, fontWeight:700, letterSpacing:'-0.02em', color:STRONG, margin:0 }}>erzberg</h1>
            <span style={{ fontSize:10, color: MUTED, fontFamily: MONO }}>v{version}</span>
            <div style={{ flex:1 }} />
            {/* Dark and light. Remembered per browser; the panel has always been
                dark, so dark is where a first visit starts. */}
            <button type="button" data-testid="theme-toggle" className="hmbtn"
              onClick={() => setTheme((t) => applyTheme(t === 'light' ? 'dark' : 'light'))}
              title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
              aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
              style={{ background:'none', border:'none', padding:2, cursor:'pointer', color: MUTED,
                       display:'flex', alignItems:'center', marginRight:4 }}>
              {theme === 'light'
                ? <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M6 .3a.7.7 0 0 1 .2.8A6.3 6.3 0 0 0 14.9 9.8a.7.7 0 0 1 1 .8A8 8 0 1 1 5.3.1.7.7 0 0 1 6 .3z" /></svg>
                : <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                    <circle cx="8" cy="8" r="3" />
                    <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M3 13l1.1-1.1M11.9 4.1 13 3" /></svg>}
            </button>
            <a
              href="https://github.com/sorny/erzberg"
              target="_blank"
              rel="noopener noreferrer"
              title="View on GitHub"
              style={{ display:'flex', alignItems:'center', color: MUTED, opacity:0.75, textDecoration:'none' }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = STRONG }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.75'; e.currentTarget.style.color = MUTED }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
            </a>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:9 }}>
            {/* One control, not two. Undo and redo are a pair and read as a pair
                when they share a border — which also buys back the width that a
                second bordered box was spending on nothing. */}
            <div style={{ position:'relative', display:'flex', border:`1px solid ${BORDER}`, borderRadius:5 }}>
              <HeaderIconBtn onClick={onUndo} disabled={!canUndo} testId="undo"
                title="Undo — ⌘Z" label="Undo" icon={UNDO_PATHS} />
              <div style={{ width:1, background: BORDER }} aria-hidden="true" />
              <HeaderIconBtn onClick={onRedo} disabled={!canRedo} testId="redo"
                title="Redo — ⌘⇧Z" label="Redo" icon={REDO_PATHS} />
              {/* The list the two buttons were always stepping through. Beside
                  them rather than anywhere else in the panel, because it is the
                  same mechanism and not a new one. */}
              <div style={{ width:1, background: BORDER }} aria-hidden="true" />
              <button type="button" data-testid="history-open"
                onClick={() => setHistoryOpen((v) => !v)}
                disabled={!canUndo && !canRedo}
                title="History" aria-label="Show the history"
                aria-expanded={historyOpen}
                style={{
                  background:'none', border:'none', padding:'4px 6px', cursor: (canUndo || canRedo) ? 'pointer' : 'default',
                  color: historyOpen ? STRONG : MUTED, lineHeight:1, display:'flex', alignItems:'center',
                  opacity: (canUndo || canRedo) ? 1 : DISABLED_OPACITY,
                }}><Chevron dir={historyOpen ? 'up' : 'down'} /></button>
              {historyOpen && (
                <HistoryMenu labels={historyLabels} onUndoTo={onUndoTo} onRedoTo={onRedoTo}
                  onClose={() => setHistoryOpen(false)} />
              )}
            </div>
            <div style={{ flex:1 }} />
            {/* "Reset" alone taught the wrong lesson: the camera preset row and
                the mirror block both use the word for something harmless, and
                this one throws away every setting in the app. `nowrap` is what
                stops it breaking across two lines again if the row ever tightens.
                It sits apart from undo because it is a different magnitude of
                undoing — one step back against everything at once. */}
            <button onClick={handleResetAll} title="Return every setting to its default" className="hmbtn"
              style={{ background:'none', border:`1px solid ${BORDER}`, borderRadius:5,
                       color: MUTED, fontSize:10, lineHeight:1, padding:'5px 9px',
                       whiteSpace:'nowrap', cursor:'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.color = STRONG }}
              onMouseLeave={e => { e.currentTarget.style.color = MUTED }}>Reset all</button>
          </div>

          {/*
            * The standing line — what you are looking at, in one row.
            *
            * The section headers say what each control is set to. This says what
            * they add up to, which nothing on screen ever did: forty draw
            * modes compose freely, and counting the lit ones meant scrolling
            * 2 282 px past the thirty-two that were off.
            *
            * It is a readout and not a set of links. Every token here would want
            * a different target and "3 inks" has no single one — the panel
            * already has a filter for going somewhere, and this is for knowing
            * where you are.
            */}
          <div data-testid="standing-line" style={{
            marginTop:8, fontSize:10, color: MUTED, fontFamily: MONO, fontVariantNumeric:'tabular-nums',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
          }}>
            {[
              `${plate.marks} mark${plate.marks === 1 ? '' : 's'}`,
              `${plate.inks} ink${plate.inks === 1 ? '' : 's'}`,
              plate.layers && `${plate.layers} layer${plate.layers === 1 ? '' : 's'}`,
              plate.text && `${plate.text} text`,
            ].filter(Boolean).join(', ')}
          </div>
        </div>

        {/* Thirty-one sections over 2 700 px of scroll: without this the only way
            to reach a control is to remember which header it lives under. The
            list, its order and its behaviour are untouched — clearing the field
            puts the panel back exactly as it was. */}
        <div style={{ padding:'8px 12px', borderBottom:`1px solid ${BORDER}`, flexShrink:0, position:'relative' }}>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none"
            stroke={MUTED} strokeWidth="1.5" strokeLinecap="round"
            style={{ position:'absolute', left:21, top:16, pointerEvents:'none' }}>
            <circle cx="5.2" cy="5.2" r="3.7" /><path d="M8 8l2.6 2.6" />
          </svg>
          <input
            ref={filterRef}
            type="search" value={filter} data-testid="panel-filter" className="hmfind"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); if (filter) setFilter(''); else e.currentTarget.blur() }
            }}
            placeholder="Find a control…" aria-label="Find a control" aria-keyshortcuts="/"
            style={{
              width:'100%', background: SURF, border:`1px solid ${BORDER}`, borderRadius:5,
              color: TEXT, fontSize:12, padding:'6px 28px 6px 26px', outline:'none',
              fontFamily:'inherit',
            }}
          />
          {/* The shortcut, shown where it applies and only while it would help. */}
          {!filter && (
            <kbd aria-hidden="true" className="hmfindkbd" style={{
              position:'absolute', right:20, top:14, pointerEvents:'none',
              minWidth:15, padding:'0 4px', borderRadius:3, textAlign:'center',
              border:`1px solid ${BORDER}`, borderBottomWidth:2, color: MUTED,
              fontFamily:'inherit', fontSize:10, lineHeight:'13px',
            }}>/</kbd>
          )}
          <style>{`.hmfind { transition:border-color .15s, box-shadow .15s, background .15s }
            .hmfind:hover { border-color:${MUTED} }
            .hmfind:focus { border-color:${ACCENT}; box-shadow:0 0 0 3px var(--hm-accent-ring); background:${BG} }
            .hmfind:focus + .hmfindkbd { opacity:0 }
            .hmfind::-webkit-search-cancel-button { -webkit-appearance:none }`}</style>
          {q && (
            <div style={{ fontSize:10, color: MUTED, marginTop:4, display:'flex', justifyContent:'space-between' }}>
              <span data-testid="filter-count">{matchCount === 0 ? 'No section matches' : `${matchCount} section${matchCount === 1 ? '' : 's'}`}</span>
              <MiniBtn testId="filter-clear" onClick={() => setFilter('')}>Clear</MiniBtn>
            </div>
          )}
        </div>

        {/*
          * The rail and the body are one row, below the head.
          *
          * The rail runs beside the sections and not beside the head: the head
          * carries the wordmark, undo, Reset all and the standing line, and it
          * was already the tightest row in the panel — "Reset all" wrapped to two
          * lines once before. Letting the head keep the full 312 px gives it
          * 40 px more than it has ever had, and the rail costs it nothing.
          */}
        <div style={{ flex:1, display:'flex', minHeight:0 }}>
        <StageRail stage={stage} onStage={goStage} live={live} hits={hits} />
        <div id="hm-panel-body" style={{ flex:1, minWidth:0, width: BODY_W, overflowX:'hidden', overflowY:'auto', scrollbarWidth:'thin', scrollbarColor:`${BORDER} transparent` }}>
          <PanelStage.Provider value={stageCtx}>
          <SectionFilter.Provider value={filterCtx}>
          <CoverPlate.Provider value={cover}>
          <ModeCopiesPanel.Provider value={modeCopiesPanel}>
          <PaintedMasks.Provider value={masks}>
          {/*
            * Source holds the load block and Presets now.
            *
            * Neither moved relative to anything else: they were the top of the
            * body, and with one pane on screen at a time "the top of the body"
            * had to become the top of *some* pane. Source is the one a drawing
            * starts in and the one the panel opens on, so a first visit sees the
            * same order it always saw — load, style, then the ground.
            */}
          <Stage n={0} title="Presets">

          {/* A whole configuration, applied at once — style, particles and
              view together. That is why it belongs to every pane downstream
              and to none of them, and why it is a destination rather than a
              step in the pipeline. */}

          <Section title="Presets" open={sec.presets} onToggle={() => tog('presets')}>
            {/* Roll a look. The seed is shown because it *is* the look — note it
                down and the same roll comes back. */}
            <div style={{ display:'flex', gap:4, marginBottom:4 }}>
              <Btn size="lg" variant="primary" block data-testid="surprise-me" ref={surpriseRef} onClick={handleSurprise}>Surprise me</Btn>
              <Btn size="md" data-testid="surprise-back" onClick={() => stepRoll(-1)} disabled={!canBack}
                title="Back to the previous roll" aria-label="Previous roll" style={{ padding:'8px 8px' }}>↩</Btn>
              <Btn size="md" data-testid="surprise-forward" onClick={() => stepRoll(1)} disabled={!canForward}
                title="Forward to the next roll" aria-label="Next roll" style={{ padding:'8px 8px' }}>↪</Btn>
            </div>
            {rollSeed != null && (
              <div data-testid="roll-seed" style={{ fontSize:10, color: MUTED, marginBottom:8, textAlign:'center', fontVariantNumeric:'tabular-nums' }}>
                seed {rollSeed}
              </div>
            )}

            <div style={{ fontSize:11, color: DIM, fontWeight:600, margin:'8px 0 4px' }}>
              Styles <span style={{ color: MUTED, fontWeight:400, fontFamily: MONO }}>{presetNames.length}</span>
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
                        padding:'2px 4px', borderRadius:3, background: GLASS_BG,
                        color: STRONG,
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

          </Stage>

          <Stage n={1} title="Terrain">

          <div style={{ padding:'12px 12px', borderBottom:`1px solid ${BORDER}`, display: q ? 'none' : undefined }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
              <LoadBtn data-testid="load-png" onClick={loadFromPicker}>PNG</LoadBtn>
              <LoadBtn data-testid="load-geotiff" onClick={loadGeoTiffFromPicker}>GeoTIFF</LoadBtn>
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
                    // Presets has a destination of its own, so the jump has to
                    // land there — from any other pane the scroll would aim at
                    // a section that is not on screen.
                    goStage(PRESETS_STAGE)
                    setSec(prev => ({ ...prev, presets: true }))
                    requestAnimationFrame(() => {
                      document.querySelector('[data-testid="section-presets"]')
                        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                    })
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
            <Btn size="lg" block data-testid="edit-heightmap" onClick={onEditHeightmap} disabled={!heightmapPixels}
              style={{ width:'100%', marginTop:4, fontWeight:400,
                ...(editSummary && { color: ACCENT_TEXT, borderColor: ACCENT_DEEP }) }}>
              ✂ Edit heightmap <span style={{ color: MUTED, fontSize:10 }}>E</span>
            </Btn>
            {editSummary && (
              <div style={{ marginTop:4, display:'flex', alignItems:'center', justifyContent:'center', gap:4, fontSize:10, color: MUTED }}>
                <span data-testid="edit-summary" style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{editSummary}</span>
                <MiniBtn testId="edit-clear" onClick={onClearEdit}>Clear</MiniBtn>
              </div>
            )}
          </div>

          {/* ── Terrain by name ───────────────────────────────────────────
              The front door for anyone who does not already own a GeoTIFF,
              which until now was everyone on their first visit. It is the one
              part of this app that talks to a server, so it says so, it does
              nothing until pressed, and it credits what it got. See
              utils/demFetch.js. */}
          <Section title="Fetch" open={sec.fetchTerrain} onToggle={() => tog('fetchTerrain')}>
            <TerrainFetchPanel onFetched={onFetchTerrain} />
          </Section>

          {/* A readout, not a control. Three fetches live in three stages and
              nothing said they describe the same ground — see panel/ExtentSection.jsx. */}
          <Section title="Extent" open={sec.extent} onToggle={() => tog('extent')}>
            <ExtentSection />
          </Section>

          <Section title="Shape" open={sec.shape} onToggle={() => tog('shape')}>
            {hypsometricIntegral != null && (
              <HypsometricRow value={hypsometricIntegral} />
            )}
            <Tog label="Raw terrain view"
              help="Shows the loaded heightmap itself: a flat greyscale plane with everything else hidden, lowest point black and highest white, stretched to fill the range. It reflects Resolution, Blur, Levels and the elevation cuts, so it doubles as a preview while tuning them. Exports are unaffected — this is a way of looking, not a change to the terrain."
              checked={view.showRawTerrain ?? false} onChange={v => sv({ showRawTerrain: v })} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 8px' }}>
              <Sl label="Resolution" min={1} max={20} value={terrain.resolution} onChange={v => st({ resolution: v })} />
              <Sl label="Height scale" min={-10} max={10} step={0.1} value={terrain.elevScale} onChange={v => st({ elevScale: v })} fmt={v => (v >= 0 ? '+' : '') + v.toFixed(1)} />
              <Sl label="Blur" min={0} max={10} step={0.1} value={terrain.blurRadius} onChange={v => st({ blurRadius: v })} fmt={v => v % 1 ? v.toFixed(1) : v} />
              <Sl label="Jitter" min={0} max={20} step={0.1} value={terrain.jitterAmt} onChange={v => st({ jitterAmt: v })} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 8px' }}>
              <Sl label="Low cut" min={0} max={100} step={0.1} value={terrain.elevMinCut} onChange={v => st({ elevMinCut: v })} fmt={v => v.toFixed(1)+'%'} />
              <Sl label="High cut" min={0} max={100} step={0.1} value={terrain.elevMaxCut} onChange={v => st({ elevMaxCut: v })} fmt={v => v.toFixed(1)+'%'} />
            </div>
          </Section>

          {/* ── Levels ────────────────────────────────────────────────────
              Shadows and Highlights are the two ends of one range, and they may
              not cross. `buildTerrain` already survives a crossed pair — it
              divides by `max(1e-6, wp - bp)` — but surviving is not the same as
              being usable: past the crossing every cell clamps to one end and
              the plate goes flat with no control saying why.

              Held two ways on purpose. The sliders' own bounds move, so the
              constraint is something you feel at the end of the track rather
              than a value that snaps back under the thumb; and both writes
              clamp, because the histogram's handles are a second way in and a
              restored session is a third. */}
          <Section title="Levels" open={sec.levels} onToggle={() => tog('levels')}>
            <Histogram pixels={heightmapPixels} blackPoint={terrain.blackPoint} whitePoint={terrain.whitePoint}
              onBlackChange={v => st({ blackPoint: Math.min(v, terrain.whitePoint - 1) })}
              onWhiteChange={v => st({ whitePoint: Math.max(v, terrain.blackPoint + 1) })} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 8px', marginTop:4 }}>
              <Sl label="Shadows" min={0} max={terrain.whitePoint - 1} value={terrain.blackPoint}
                onChange={v => st({ blackPoint: Math.min(v, terrain.whitePoint - 1) })} />
              <Sl label="Highlights" min={terrain.blackPoint + 1} max={255} value={terrain.whitePoint}
                onChange={v => st({ whitePoint: Math.max(v, terrain.blackPoint + 1) })} />
            </div>
          </Section>

          {/* ── Masks ─────────────────────────────────────────────────────
              Land cover answers "what is this ground" for the whole window at
              once. A mask answers a question only you can ask: the far side of
              the ridge, the part the plate is actually about. Both are spent
              through the same stencil. */}
          <Section title="Masks" open={sec.masks} onToggle={() => tog('masks')} enabled={masks.length > 0}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 2 }}>
              {!masks.length && (
                <CoverProse>
                  A mask is a region you draw. Any layer can be restricted to one,
                  the same way it can be restricted to a land cover class — and a
                  layer may carry both at once.
                </CoverProse>
              )}
              {masks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {masks.map((m) => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 13, height: 13, borderRadius: 3, background: m.color,
                                     border: `1px solid ${BORDER}`, flex: '0 0 auto' }} />
                      <input value={m.name} aria-label={`Name of ${m.name}`}
                        onChange={(e) => onPatchMask(m.id, { name: e.target.value.slice(0, 32) })}
                        style={{ flex: 1, minWidth: 0, background: SURF, color: MUTED, fontSize: 10,
                                 border: `1px solid ${BORDER}`, borderRadius: 3, padding: '2px 5px' }} />
                      <span style={{ fontSize: 10, color: DIM, fontVariantNumeric: 'tabular-nums',
                                     minWidth: 30, textAlign: 'right' }}>
                        {(maskCoverage(m) * 100).toFixed(0)}%
                      </span>
                      {/* "Edit", not "Paint". The Studio does more than a brush —
                          it erases, fills, inverts, imports and crops — so naming
                          it after one of its tools undersold it and misdescribed
                          what the button does to a mask that already has pixels. */}
                      <Btn size="xs" onClick={() => onEditMask(m.id)} data-testid={`mask-edit-${m.id}`}
                        style={{ padding: '0 6px', fontSize: 10 }}>Edit</Btn>
                      {/* A glyph rather than a word: the row already carries a
                          swatch, a name field, a coverage figure and two buttons
                          in 272 px, and `Copy` would squeeze the name it is
                          named after. */}
                      <RowBtn onClick={() => onCopyMask?.(m.id)} data-testid={`copy-${m.id}`}
                        label={`Duplicate ${m.name}`} title="Duplicate" disabled={masks.length >= MAX_MASKS}>⧉</RowBtn>
                      <RowBtn onClick={() => onRemoveMask(m.id)} label={`Remove ${m.name}`} title="Remove">✕</RowBtn>
                    </div>
                  ))}
                </div>
              )}
              <CoverRow>
                <Btn block data-testid="add-mask" disabled={masks.length >= MAX_MASKS}
                  onClick={() => { const m = onAddMask?.(); if (m) onEditMask(m.id) }}>
                  + Draw a mask
                </Btn>
                <Btn block onClick={onImportMask} disabled={masks.length >= MAX_MASKS}>↑ Mask image</Btn>
              </CoverRow>
              <CoverProse caption>
                Drawing opens the Studio over the viewport, with the satellite
                imagery behind it when there is some. Its Level and Features tools
                make a mask from heights or from loaded map features. Import takes
                a black-and-white PNG or JPG — white is inside, and transparent is
                outside.
              </CoverProse>
            </div>
          </Section>

          {/* ── Land cover ────────────────────────────────────────────────
              The one fact in this app that the heightmap does not contain.
              Everything else here is derived from elevation; a plate says what
              the ground *is*, which is what lets a mark follow material rather
              than gradient. Cut one with scripts/embed-window.js — the fetch
              cannot happen in the browser, and the section says why. */}
          <Section title="Land Cover" open={sec.landCover} onToggle={() => tog('landCover')} enabled={Boolean(cover)}>
            {/* One column, one gap, and nothing carrying a margin of its own.
                The section body has no top padding — the first child sits
                against the header — so anything with a negative top margin
                clips itself on the way in. */}
            {!cover && (() => {
              const { cmd, exact } = plateCommand({
                filename: heightmapFilename, bbox: geoTiffBbox, crs: geoTiffCRS,
              })
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 2 }}>
                  <CoverProse>
                    A cover plate gives every pixel a class — worked rock, conifer, water —
                    so a layer can draw on one material and skip the rest. Nothing here
                    contacts a server: cut a plate first, then load it.
                  </CoverProse>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <CoverLabel>Cut one</CoverLabel>
                    <CommandLine cmd={cmd} />
                    <CoverProse caption>
                      {exact
                        ? 'Cut for this raster exactly — the extent and the projection both come from the file.'
                        : 'The extent of what is on screen, in the lon/lat the flag wants.'}
                    </CoverProse>
                  </div>
                  <CoverRow><Btn block onClick={onLoadCover}>↑ Cover plate</Btn></CoverRow>
                </div>
              )
            })()}
            {cover && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 2 }}>
                {coverError && (
                  <div style={{ fontSize: 10, color: DANGER_TEXT, lineHeight: 1.5 }}>{coverError}</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {/* The file keeps the geocoder's full answer — "Erzberg,
                      Eisenerz, Bezirk Leoben, Steiermark, Österreich" — because
                      that is what identifies the window. The panel has one column
                      and needs the first two parts of it. */}
                  <CoverFact label="Plate" value={cover.name.split(',').slice(0, 2).join(',').trim()} />
                  {cover.year != null && <CoverFact label="Year" value={String(cover.year)} />}
                  {cover.variance != null && (
                    <CoverFact label="Colour axes" value={`${Math.round(cover.variance * 100)}% of variance`} />
                  )}
                </div>

                {/* The class list is a different kind of thing from the facts
                    above it — a legend rather than a readout — and ran straight
                    on from them at the same rhythm, so the two read as one list.
                    The label is what parts them; the count lives here rather
                    than as a fact of its own, beside what it counts. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <CoverLabel>Classes</CoverLabel>
                    <span style={{ fontSize: 10, color: DIM }}>{cover.classes.length}</span>
                  </div>
                  {/* The legend says what the classes are; this says where they
                      are, which is the question you ask next and the one that
                      decides what to mask a layer to. */}
                  <CoverMap cover={cover} hovered={hoveredClass} onHover={setHoveredClass} />
                  {/* The plate's own class colours are the imagery's means:
                      true to the ground, often close to each other as pens.
                      A palette deals a set of distinct inks in class order;
                      each swatch below can still be changed on its own. */}
                  <SegGroup label="Class ink palette" testIdOf={(name) => `cover-palette-${name || 'plate'}`}
                    options={[['Plate', ''], ['Distinct', 'distinct'], ['Earth', 'earth'], ['Riso', 'riso']]}
                    value={!style.coverInks ? '' : ['distinct', 'earth', 'riso'].find((n) => style.coverInks === paletteInks(n, cover.classes.length)) ?? null}
                    onChange={(name) => ss({ coverInks: name ? paletteInks(name, cover.classes.length) : '' })} />
                  {/* Two lines per class, because one was not enough to be
                      useful. A cluster cannot say what it is, so the script
                      asks OpenStreetMap what covers it and the second line is
                      that answer with its percentage still attached — a name
                      you can weigh rather than a word you have to trust. */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {cover.classes.map((c) => (
                      <div key={c.index}
                        onPointerEnter={() => setHoveredClass(c.index)}
                        onPointerLeave={() => setHoveredClass(null)}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: 7, cursor: 'default',
                                 // Lit rather than outlined: a border would move
                                 // the row by a pixel as the pointer crossed it.
                                 background: hoveredClass === c.index ? 'var(--hm-surf)' : 'transparent',
                                 borderRadius: 3, margin: '0 -4px', padding: '1px 4px',
                                 opacity: hoveredClass == null || hoveredClass === c.index ? 1 : 0.45,
                                 transition: 'opacity .12s, background .12s' }}>
                        {/* The class's ink, editable: every mode and the SVG
                            read the colour from here. */}
                        <input type="color" className="hmc" value={c.color} aria-label={`Ink of ${c.name}`}
                          data-testid={`cover-ink-${c.index}`}
                          onChange={(e) => ss({ coverInks: setCoverInk(style.coverInks, c.index, e.target.value, cover.classes.length) })}
                          style={{ width: 18, height: 14, flex: '0 0 auto', marginTop: 1 }} />
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                            <span style={{ fontSize: 10, color: MUTED, flex: 1, minWidth: 0,
                                           overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                            <span style={{ fontSize: 10, color: DIM, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                              {(c.share * 100).toFixed(1)}%
                            </span>
                          </div>
                          {c.note && (
                            <span style={{ fontSize: 9, color: DIM, lineHeight: 1.45 }}>{c.note}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <CoverRow><Btn block onClick={onInkByClass}>Ink by land class</Btn></CoverRow>
                  <CoverProse caption>
                    Deals one draw mode to each class, steepest ground first, and masks each
                    layer to its own class. Re-point any of them afterwards.
                  </CoverProse>
                </div>

                <CoverRow>
                  <Btn block onClick={onLoadCover}>Replace…</Btn>
                  <Btn block onClick={onClearCover}>Clear</Btn>
                </CoverRow>

                {(cover.attribution || cover.osmCredit) && (
                  <div style={{ fontSize: 10, color: DIM, lineHeight: 1.7 }}>
                    {cover.attribution && <div>{cover.attribution}</div>}
                    {/* ODbL travels with the work too: a class named from
                        OpenStreetMap is derived from OpenStreetMap. */}
                    {cover.osmCredit && <div>{cover.osmCredit}</div>}
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ── Global Style ───────────────────────────────────────────────── */}

          <ErosionSection open={sec.erosion} onToggle={() => tog('erosion')} />

          <Section title="Soundscapes" open={sec.soundscapes} onToggle={() => tog('soundscapes')} enabled={snd.active}>
            <LoadBtn onClick={() => snd.loadFromPicker(onSoundscapeFit)} style={{ marginBottom:8 }}>
              Audio (MP3 / WAV / OGG / M4A)
            </LoadBtn>

            {snd.error && (
              <div style={{ fontSize:10, color:DANGER_TEXT, background:DANGER_BG, border:`1px solid ${DANGER_BORDER}`, borderRadius:5, padding:'4px 8px', marginBottom:8 }}>
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
                <div style={{ height:3, background: BORDER, borderRadius:3, overflow:'hidden' }}>
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
                    style={{ flex:1, padding:'8px 0', background: snd.isPlaying ? SURF : ACCENT, color: snd.isPlaying ? DIM : ON_ACCENT, border:`1px solid ${snd.isPlaying ? BORDER : ACCENT}`, borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:600 }}
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
                  <div style={{ fontSize: 11, color: DIM, fontWeight:600, marginBottom:4 }}>Analysis</div>
                  <SegGroup label="FFT size" options={[[1024, 1024], [2048, 2048], [4096, 4096]]}
                    value={snd.opts.fftSize} onChange={(n) => snd.setOpts({ fftSize: n })}
                    style={{ marginBottom: 8 }} />
                  <SegGroup label="Frequency axis" options={[['Log freq', true], ['Linear freq', false]]}
                    value={snd.opts.logFreq} onChange={(v) => snd.setOpts({ logFreq: v })}
                    style={{ marginBottom: 8 }} />
                  <InlineSl label="Bins" hint="↕" help="Frequency rows — also the height of the generated heightmap. Changing this re-runs the analysis."
                    min={32} max={512} step={32} value={snd.opts.bins} onChange={v => snd.setOpts({ bins: v })} />

                  <div style={{ fontSize: 11, color: DIM, fontWeight:600, margin:'8px 0 4px' }}>Stream</div>
                  <InlineSl label="Window" hint="↔" help="Time columns held on screen — the width of the generated heightmap. Wider means more history but a heavier rebuild."
                    min={64} max={768} step={32} value={snd.opts.windowFrames} onChange={v => snd.setOpts({ windowFrames: v })} />
                  <InlineSl label="Rate" help="Heightmap pushes per second. Each one is a full geometry rebuild, so lower this if playback stutters on dense draw modes. Above ~30/s the ceiling is usually the rebuild itself rather than this setting."
                    min={2} max={60} value={snd.opts.fps} onChange={v => snd.setOpts({ fps: v })} fmt={v => v + '/s'} />
                  <InlineSl label="dB floor" help="Noise gate. Raise it to drop quiet detail into flat ground and leave only the loud structure standing."
                    min={0} max={0.9} step={0.01} value={snd.opts.dbFloor} onChange={v => snd.setOpts({ dbFloor: v })} fmt={v => Math.round(v*100)+'%'} />
                  <InlineSl label="Contrast" help="Gamma applied after the gate. Above 1 sharpens peaks into ridges; below 1 flattens them into plateaus."
                    min={0.3} max={3} step={0.1} value={snd.opts.contrast} onChange={v => snd.setOpts({ contrast: v })} fmt={v => v.toFixed(1)} />
                </Sub>

                {/* Which shape the whole track takes when frozen. A stretched
                    spectrogram is only one answer; the others fold the track so
                    its structure — repeats, sections, groove — becomes relief. */}
                <Sub>
                  <div style={{ fontSize: 11, color: DIM, fontWeight:600, marginBottom:4 }}>Whole track</div>
                  <SegGroup label="Projection" columns={3}
                    options={TRACK_PROJECTIONS.map((pj) => [pj.label, pj.id])}
                    value={projection.id} onChange={(id) => snd.setOpts({ projection: id })}
                    testIdOf={(id) => `projection-${id}`} style={{ marginBottom: 4 }} />
                  <div style={{ fontSize:10, color: MUTED, lineHeight:1.4, marginBottom:8 }}>{projection.blurb}</div>

                  {projection.id === 'weave' && (
                    <div style={{ fontSize:10, color: MUTED, marginBottom:8 }}>
                      Detected tempo: <span style={{ color:MUTED, fontVariantNumeric:'tabular-nums' }}>
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
                  style={{ width:'100%', padding:'8px 0', background: snd.frozen ? ACCENT_DEEP : SURF, color: snd.frozen ? ON_ACCENT : DIM, border:`1px solid ${snd.frozen ? ACCENT_DEEP : BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:600 }}
                >{snd.frozen ? '❄ Whole Track Frozen' : 'Freeze Whole Track'}</button>
                <div style={{ fontSize:10, color: MUTED, marginTop:4, lineHeight:1.4 }}>
                  {snd.frozen
                    ? 'The whole track is the heightmap. Play or scrub to go back to streaming a moving window.'
                    : `Pauses playback and writes the entire track as one static heightmap — the ${projection.label} projection above. Useful for erosion, STL and SVG, which need a terrain that holds still.`}
                </div>
              </>
            )}
          </Section>

          </Stage>

          <Stage n={2} title="Surface">

          {/* The dot is lit by the section's own readout rather than by a second
              expression beside it: `enabled` and the summary answered the same
              question separately, and three sections that could be switched on
              had a value in the header and no dot to the left of it. */}
          <Section title="Terrain Style" open={sec.style} onToggle={() => tog('style')}
                   enabled={summaries['Terrain Style'] !== '—'}>
            <TogColor label="Fill" checked={style.showFill} onToggle={v => ss({ showFill: v })} color={style.fillColor} onColor={v => ss({ fillColor: v })} />
            {style.showFill && (
              <Sub>
                <Tog label="Hypsometric fill" small checked={style.fillHypsometric} onChange={v => ss({ fillHypsometric: v })} />
                {style.fillHypsometric && (
                  <Sub>
                    <SegGroup label="Fill source" options={[['Elevation', 'elevation'], ['Slope', 'slope'], ['Aspect', 'aspect']]}
                      value={style.fillHypsoMode} onChange={(m) => ss({ fillHypsoMode: m })}
                      style={{ marginBottom: 4 }} />
                    <Tog label="Banded" small checked={style.fillBanded} onChange={v => ss({ fillBanded: v })} />
                    {style.fillBanded && <><InlineSl label="Band interval" min={0.5} max={50} value={style.fillHypsoInterval} onChange={v => ss({ fillHypsoInterval: v })} /><InlineSl label="Band weight" min={0} max={5} step={0.5} value={style.fillHypsoWeight} onChange={v => ss({ fillHypsoWeight: v })} /></>}
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
                <InlineSl label="Depth tolerance" help="Depth tolerance. Higher values allow lines to peek through the surface, by pushing the terrain surface further back in the depth buffer." min={0} max={200} step={0.1} value={style.occlusionBias} onChange={v => ss({ occlusionBias: v })} fmt={v => v.toFixed(1)} />
                <InlineSl label="Hidden opacity" help="Opacity of lines hidden behind mountains. 0% = hidden, 100% = fully visible." min={0} max={1} step={0.01} value={style.occlusionOpacity} onChange={v => ss({ occlusionOpacity: v })} fmt={v => Math.round(v*100)+'%'} />
              </Sub>
            )}
            
            <Tog label="Inks as picked" testId="inks-as-picked"
              help="Draws every line and area in exactly the colour you picked, as its swatch shows it. Off, colours pass through the viewport's filmic tone curve and come out lighter and softer. Also sets the colours written to the SVG."
              checked={!!style.inksAsPicked} onChange={v => ss({ inksAsPicked: v })} />

            <ColorRow label="Background" testId="bg-color" value={style.bgColor} onChange={v => ss({ bgColor: v })} />
            <Sub>
              <Tog label="Gradient" small checked={style.bgGradient} onChange={v => ss({ bgGradient: v })} />
              {style.bgGradient && <GradientPicker stops={bgGradientStops} onChange={sbg} isSimple />}
            </Sub>
          </Section>

          {/* ── Satellite ─────────────────────────────────────────────────
              Unlike the cover plates, this one can be a button: Sentinel-2 on
              AWS answers CORS where AlphaEarth's bucket does not. Same terms as
              Fetch — no key, no account, nothing until it is pressed. */}
          <Section title="Satellite" open={sec.satellite} onToggle={() => tog('satellite')} enabled={Boolean(imagery)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 2 }}>
              {!imagery && (
                <CoverProse>
                  True-colour Sentinel-2 over this extent, at 10 m. It drapes on the
                  terrain and backs the Mask Studio, where you are drawing around
                  ground you need to be able to see.
                </CoverProse>
              )}
              {imagery && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <CoverFact label="Scene" value={imagery.date} />
                  <CoverFact label="Cloud" value={`${Math.round(imagery.cloud)}%`} />
                  <CoverFact label="Size" value={`${imagery.width} × ${imagery.height}`} />
                </div>
              )}
              {imageryBusy && (
                <div style={{ fontSize: 10, color: MUTED }}>
                  <div style={{ marginBottom: 4 }}>
                    {imageryBusy.phase === 'search' ? 'Finding a clear scene…'
                      : `Fetching imagery… ${Math.round((imageryBusy.progress ?? 0) * 100)}%`}
                  </div>
                  <div style={{ height: 3, background: BORDER, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: ACCENT,
                                  width: `${Math.round((imageryBusy.progress ?? 0) * 100)}%` }} />
                  </div>
                </div>
              )}
              {imagery && (
                <>
                  <Tog label="Drape on terrain" checked={style.showImagery}
                    onChange={(v) => ss({ showImagery: v })} />
                  {style.showImagery && (
                    <Sub>
                      <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style.imageryOpacity}
                        onChange={(v) => ss({ imageryOpacity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
                      {/* Sentinel-2's `visual` asset is exposed for cloud and
                          snow, so ordinary ground sits near the floor — over
                          Graz the median pixel is 9–17% brightness. Auto levels
                          stretches this window's own histogram and solves a
                          gamma that puts its median on mid-grey. The three
                          below are taste, applied after it. */}
                      <Tog label="Auto levels" checked={style.imageryAutoLevels}
                        onChange={(v) => ss({ imageryAutoLevels: v })} />
                      <InlineSl label="Brightness" min={0.2} max={2.5} step={0.01} value={style.imageryBrightness}
                        onChange={(v) => ss({ imageryBrightness: v })} fmt={(v) => `${v.toFixed(2)}×`} />
                      <InlineSl label="Contrast" min={0.4} max={2.2} step={0.01} value={style.imageryContrast}
                        onChange={(v) => ss({ imageryContrast: v })} fmt={(v) => `${v.toFixed(2)}×`} />
                      <InlineSl label="Saturation" min={0} max={2} step={0.01} value={style.imagerySaturation}
                        onChange={(v) => ss({ imagerySaturation: v })} fmt={(v) => `${v.toFixed(2)}×`} />
                      {imagery?.tone && style.imageryAutoLevels && (
                        <div style={{ fontSize: 10, color: DIM, lineHeight: 1.7 }}>
                          Levels {imagery.tone.lo.join('/')} → {imagery.tone.hi.join('/')}
                          {' · '}gamma {imagery.tone.gamma.toFixed(2)}
                        </div>
                      )}
                    </Sub>
                  )}
                </>
              )}
              <CoverRow>
                <Btn block onClick={onFetchImagery} disabled={!!imageryBusy} data-testid="fetch-imagery">
                  {imagery ? 'Fetch again' : '↓ Fetch imagery'}
                </Btn>
                {imagery && <Btn block onClick={onClearImagery}>Clear</Btn>}
              </CoverRow>
              {imagery?.credit && (
                <div style={{ fontSize: 10, color: DIM, lineHeight: 1.7 }}>{imagery.credit}</div>
              )}
            </div>
          </Section>

          <Section title="Texture" open={sec.texture} onToggle={() => tog('texture')}
                   enabled={summaries['Texture'] !== '—'}>
            <Tog label="Enabled" checked={style.showTexture} onChange={v => ss({ showTexture: v })} />
            {style.showTexture && !style.showFill && (
              <div style={{ fontSize: 10, color: WARN, background: WARN_BG, border: '1px solid rgba(245,158,11,0.3)', borderRadius: 5, padding: '4px 8px', marginBottom: 4 }}>
                Fill is disabled — texture will not appear until Fill is enabled.
              </div>
            )}
            {style.showTexture && (
              <Sub>
                <LoadBtn onClick={handleTexturePicker} style={{ marginBottom:8 }}>
                  {textureImage ? 'Other image' : 'Image'}
                </LoadBtn>
                {textureImage && (
                  <>
                    <InlineSl label="Scale" min={0.01} max={10} step={0.01} value={style.textureScale} onChange={v => ss({ textureScale: v })} />
                    <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style.textureOpacity} onChange={v => ss({ textureOpacity: v })} fmt={v => Math.round(v*100)+'%'} />
                    <SegRow label="Blend" columns={3} value={style.textureBlendMode} onChange={v => ss({ textureBlendMode: v })}
                      options={[['Normal', 'normal'], ['Multiply', 'multiply'], ['Screen', 'screen'],
                                ['Overlay', 'overlay'], ['Soft light', 'softlight'], ['Add', 'add']]} />
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                      <Sl label="Offset X" min={-1} max={1} step={0.01} value={style.textureShiftX} onChange={v => ss({ textureShiftX: v })} />
                      <Sl label="Offset Y" min={-1} max={1} step={0.01} value={style.textureShiftY} onChange={v => ss({ textureShiftY: v })} />
                    </div>
                    <Btn size="md" onClick={() => setTextureImage(null)} style={{ width:'100%' }}>Clear texture</Btn>
                  </>
                )}
              </Sub>
            )}
          </Section>

          {/* ── Soundscapes ─────────────────────────────────────────────────
              Streams an audio spectrogram into the heightmap slot, so every
              draw mode / overlay / export works on it like any other terrain. */}

          {/* ── Hillshade ──────────────────────────────────────────────────── */}

          <Section title="Hillshade" open={sec.hillshade} onToggle={() => tog('hillshade')} enabled={style.showHillshade}>
            <Tog label="Enabled" checked={style.showHillshade} onChange={v => ss({ showHillshade: v })} />
            {style.showHillshade && (
              <Sub>
                <Tog label="Multi-direction" help="Average 8 light directions — eliminates directional bias (Swiss-style shading). Hides azimuth and cast shadows." checked={!!style.hillshadeMultiDir} onChange={v => ss({ hillshadeMultiDir: v })} />
                {/* ── Where the light comes from ─────────────────────────
                    Two answers, and the convention is not the lesser one.
                    315°/45° is a bearing the sun never reaches at any latitude
                    this tool gets pointed at, and it is still what every relief
                    map uses, because light from the upper left is what stops a
                    ridge from reading as a gully. The almanac is the setting for
                    the other question — what the ground really looked like at an
                    hour — and it drives the same two numbers from the raster's
                    own latitude. See utils/solar.js. */}
                {!style.hillshadeMultiDir && (
                  <SegRow label="Sun" testIdPrefix="sun-mode"
                    help="Convention: pick the light by hand — 315°/45° is the cartographic standard and no real sun ever sits there. Almanac: the sun where it actually was, from this raster's own latitude, on a date and at an hour you set."
                    options={[['Convention', 'convention'], ['Almanac', 'almanac']]}
                    value={style.hillshadeAlmanac ? 'almanac' : 'convention'}
                    onChange={v => ss({ hillshadeAlmanac: v === 'almanac' })} />
                )}
                {!style.hillshadeMultiDir && !almanac && (
                  <InlineSl label="Sun azimuth" help="Where the light comes from, as a compass bearing: 0°=N, 90°=E, 315°=NW. The default is the classic north-west, because light from the upper left is what stops a ridge from reading as a gully." min={0} max={360} step={5} value={style.hillshadeAzimuth} onChange={v => ss({ hillshadeAzimuth: v })} fmt={v => Math.round(v) + '°'} />
                )}
                {!almanac && (
                  <InlineSl label="Sun altitude" help="Sun angle above the horizon. 45° is classic; 90° is directly overhead." min={0} max={90} step={1} value={style.hillshadeAltitude} onChange={v => ss({ hillshadeAltitude: v })} fmt={v => Math.round(v) + '°'} />
                )}
                {almanac && (<>
                  <DateRow label="Date" testId="sun-date"
                    help="A stored date, not today's. A preset has to draw the same plate tomorrow as it does now, which a moving date could not promise."
                    value={style.hillshadeDate} onChange={v => ss({ hillshadeDate: v })} />
                  <InlineSl label="Time" testId="sun-hour"
                    help="Local standard time at the zone below. No summer clock: an hour of daylight saving is a political fact about a country, not an astronomical one about the sky."
                    min={0} max={24} step={0.25} value={style.hillshadeHour ?? 12}
                    onChange={v => ss({ hillshadeHour: v })} fmt={formatClock} />
                  <InlineSl label="Zone" testId="sun-zone"
                    help="Hours ahead of UTC. The button below sets the zone whose standard meridian is nearest this raster — a guess about geometry, since real zones follow borders."
                    min={-12} max={14} step={0.5} value={style.hillshadeZone ?? 0}
                    onChange={v => ss({ hillshadeZone: v })}
                    fmt={v => `UTC${v >= 0 ? '+' : '−'}${Math.abs(v) % 1 ? Math.abs(v).toFixed(1) : Math.abs(v)}`} />
                  {/* A plain PNG has no location to read, so the latitude becomes
                      a control rather than a fact. A GeoTIFF answers it from its
                      own bounding box and these never appear. */}
                  {sun && !sun.fromRaster && (<>
                    <InlineSl label="Latitude" min={-89} max={89} step={0.01} value={style.hillshadeLat ?? 0}
                      onChange={v => ss({ hillshadeLat: v })} fmt={v => `${Math.abs(v).toFixed(2)}° ${v < 0 ? 'S' : 'N'}`} />
                    <InlineSl label="Longitude" min={-180} max={180} step={0.01} value={style.hillshadeLon ?? 0}
                      onChange={v => ss({ hillshadeLon: v })} fmt={v => `${Math.abs(v).toFixed(2)}° ${v < 0 ? 'W' : 'E'}`} />
                  </>)}
                  {sun && (
                    <div data-testid="sun-readout" style={{ fontSize:10, color: MUTED, lineHeight:1.7, marginBottom:6 }}>
                      <div style={{ color: sun.altitude > 0 ? DIM : WARN }}>
                        {sun.altitude > 0
                          ? `${Math.round(sun.azimuth)}° · ${Math.round(sun.altitude)}° above`
                          : `${Math.round(sun.azimuth)}° · below the horizon`}
                      </div>
                      <div>
                        {sun.times.polar === 'day' ? 'sun never sets'
                          : sun.times.polar === 'night' ? 'sun never rises'
                          : `rise ${formatClock(sun.times.rise)} · noon ${formatClock(sun.times.noon)} · set ${formatClock(sun.times.set)}`}
                      </div>
                      <div>
                        {sun.fromRaster ? 'from the raster: ' : 'no georeference: '}
                        {`${Math.abs(sun.lat).toFixed(2)}° ${sun.lat < 0 ? 'S' : 'N'}, ${Math.abs(sun.lon).toFixed(2)}° ${sun.lon < 0 ? 'W' : 'E'}`}
                      </div>
                      {Math.abs((style.hillshadeZone ?? 0) - zoneForLongitude(sun.lon)) > 0.01 && (
                        <button type="button" data-testid="sun-zone-suggest"
                          onClick={() => ss({ hillshadeZone: zoneForLongitude(sun.lon) })}
                          style={{ marginTop:2, padding:'2px 6px', fontSize:10, borderRadius:3, cursor:'pointer',
                                   background: SURF, color: DIM, border:`1px solid ${BORDER}` }}>
                          use UTC{zoneForLongitude(sun.lon) >= 0 ? '+' : '−'}{Math.abs(zoneForLongitude(sun.lon))} for this longitude
                        </button>
                      )}
                    </div>
                  )}
                </>)}
                <InlineSl label="Intensity" min={0} max={3} step={0.05} value={style.hillshadeIntensity} onChange={v => ss({ hillshadeIntensity: v })} fmt={v => v.toFixed(2)} />
                <InlineSl label="Opacity" help="Blend strength over the fill colour." min={0} max={1} step={0.01} value={style.hillshadeOpacity} onChange={v => ss({ hillshadeOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
                <InlineSl label="Exaggeration" help="Amplifies normals for dramatic relief at low elevation scales." min={0.1} max={10} step={0.1} value={style.hillshadeExaggeration} onChange={v => ss({ hillshadeExaggeration: v })} fmt={v => v.toFixed(1)} />
                <ColorRow label="Highlight" value={style.hillshadeHighlightColor} onChange={v => ss({ hillshadeHighlightColor: v })} />
                <ColorRow label="Shadow" value={style.hillshadeShadowColor} onChange={v => ss({ hillshadeShadowColor: v })} />
                <Tog label="Show sun" help="Display a sun orb in the scene at the light source position." checked={style.showSun} onChange={v => ss({ showSun: v })} />
                {!style.hillshadeMultiDir && (<>
                  <Tog label="Cast shadows" help="Ray-march cast shadows: ridges block sunlight." checked={style.hillshadeCastShadows} onChange={v => ss({ hillshadeCastShadows: v })} />
                  {style.hillshadeCastShadows && (<>
                    <InlineSl label="Darkness" help="How dark cast shadows are (0 = no effect, 100% = pitch black)." min={0} max={1} step={0.05} value={style.hillshadeShadowDarkness} onChange={v => ss({ hillshadeShadowDarkness: v })} fmt={v => Math.round(v * 100) + '%'} />
                    <InlineSl label="Softness" help="Penumbra width — 0 for crisp edges, higher for soft gradual shadows." min={0} max={5} step={0.1} value={style.hillshadeShadowSoftness} onChange={v => ss({ hillshadeShadowSoftness: v })} fmt={v => v.toFixed(1)} />
                    <InlineSl label="Quality" help="Shadow ray steps — more steps = longer shadows but higher GPU cost." min={16} max={128} step={8} value={style.hillshadeShadowSteps} onChange={v => ss({ hillshadeShadowSteps: Math.round(v) })} fmt={v => Math.round(v) + '×'} />
                  </>)}
                </>)}
                <Tog label="Sky-view factor" help="Ray-marches the sky hemisphere to darken valleys and concavities. GPU-intensive; keep Rays ≤ 16 for real-time editing." checked={!!style.showAO} onChange={v => ss({ showAO: v })} />
                {style.showAO && (<>
                  <InlineSl label="Strength" min={0} max={1} step={0.05} value={style.aoStrength ?? 0.7} onChange={v => ss({ aoStrength: v })} fmt={v => Math.round(v * 100) + '%'} />
                  <InlineSl label="Rays" help="More rays = smoother result at higher GPU cost." min={4} max={32} step={4} value={style.aoRays ?? 8} onChange={v => ss({ aoRays: Math.round(v) })} fmt={v => Math.round(v) + '×'} />
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
                <Tog label="True degrees" help="Colour by the slope on the ground, in degrees. Off is the old reading, from the normal as drawn, which moves with the height slider; plates made before v1.39.0 open with it off, so they look as they did." checked={style.slopeShadeTrue !== false} onChange={v => ss({ slopeShadeTrue: v })} />
                <ColorRow label="Flat colour" value={style.slopeColorLow} onChange={v => ss({ slopeColorLow: v })} />
                <ColorRow label="Steep colour" value={style.slopeColorHigh} onChange={v => ss({ slopeColorHigh: v })} />
                {style.slopeShadeTrue !== false && (<>
                <InlineSl label="Full at" help="The slope, in true degrees, that gets the full steep colour. Flatter ground fades toward the fill." min={5} max={89} step={1} value={style.slopeShadeMax ?? 45} onChange={v => ss({ slopeShadeMax: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                <InlineSl label="Bands" help="Steps of this many degrees instead of a smooth ramp. At 0 the colour is smooth." min={0} max={20} step={1} value={style.slopeShadeBand ?? 0} onChange={v => ss({ slopeShadeBand: Math.round(v) })} fmt={v => (v ? `${Math.round(v)}°` : 'smooth')} />
                {/* Written out here rather than through GroundScale: this section
                    owns the two keys, and the others borrow them. */}
                {!geoTiffBbox && (
                  <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale. Shared by every surface layer that reads degrees." min={0.5} max={200} step={0.5} value={style.groundCellMetres ?? 10} onChange={v => ss({ groundCellMetres: v })} fmt={v => `${v} m`} />
                )}
                {!hasGeoTiff && (
                  <InlineSl label="Relief" help="Metres from black to white in the heightmap. Shared by every surface layer that reads degrees." min={10} max={9000} step={10} value={style.groundRelief ?? 1000} onChange={v => ss({ groundRelief: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                )}
                </>)}
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
                <ColorRow label="Colour" value={style.waterColor ?? '#1a78c2'} onChange={v => ss({ waterColor: v })} />
              </Sub>
            )}
          </Section>

          {/* ── Aspect Map ──────────────────────────────────────────────────── */}
          <Section title="Aspect Map" open={sec.aspectMap} onToggle={() => tog('aspectMap')} enabled={style.showAspectMap}>
            <Tog label="Enabled" checked={!!style.showAspectMap} onChange={v => ss({ showAspectMap: v })} />
            {style.showAspectMap && (
              <Sub>
                <InlineSl label="Opacity" help="Blend strength of the aspect hue-wheel over the fill." min={0} max={1} step={0.01} value={style.aspectMapOpacity ?? 0.8} onChange={v => ss({ aspectMapOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
                <Tog label="Fade on flat ground" help="A bivariate map: the hue fades to grey as the ground flattens, because level ground faces no direction." checked={style.aspectMapBivariate !== false} onChange={v => ss({ aspectMapBivariate: v })} />
                {style.aspectMapBivariate !== false && (
                  <InlineSl label="Full at" help="The slope, in true degrees, that gets the full hue." min={2} max={89} step={1} value={style.aspectMapFull ?? 30} onChange={v => ss({ aspectMapFull: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                )}
                {style.aspectMapBivariate !== false && (!geoTiffBbox || !hasGeoTiff) && (
                  <GroundScale style={style} ss={ss} geoTiffBbox={geoTiffBbox} hasGeoTiff={hasGeoTiff} />
                )}
              </Sub>
            )}
          </Section>


          {/* ── Local Relief ────────────────────────────────────────────────── */}
          <Section title="Local Relief" open={sec.localRelief} onToggle={() => tog('localRelief')} enabled={style.showLocalRelief}>
            <Tog label="Enabled" checked={!!style.showLocalRelief} onChange={v => ss({ showLocalRelief: v })} />
            {style.showLocalRelief && (
              <Sub>
                <Note>The ground minus a blur of itself. The mountain goes, and what sits on it stays: terraces, benches, paths, walls.</Note>
                <InlineSl label="Radius" help="The largest feature kept. Anything wider is part of the mountain and is taken away." min={4} max={400} step={1} value={style.localReliefRadius ?? 40} onChange={v => ss({ localReliefRadius: Math.round(v) })} />
                <InlineSl label="Gain" min={0.2} max={5} step={0.1} value={style.localReliefGain ?? 1} onChange={v => ss({ localReliefGain: v })} fmt={v => `×${v.toFixed(1)}`} />
                <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style.localReliefOpacity ?? 0.8} onChange={v => ss({ localReliefOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
                <ColorRow label="Below" value={style.localReliefLow ?? '#2f5d8a'} onChange={v => ss({ localReliefLow: v })} />
                <ColorRow label="Above" value={style.localReliefHigh ?? '#b5472d'} onChange={v => ss({ localReliefHigh: v })} />
              </Sub>
            )}
          </Section>

          {/* ── Curvature Shading ───────────────────────────────────────────── */}
          <Section title="Curvature Shading" open={sec.curvShade} onToggle={() => tog('curvShade')} enabled={style.showCurvShade}>
            <Tog label="Enabled" checked={!!style.showCurvShade} onChange={v => ss({ showCurvShade: v })} />
            {style.showCurvShade && (
              <Sub>
                <Note>Convex ground in one colour and hollows in the other. The form with no light direction at all.</Note>
                <InlineSl label="Scale" help="The size of the forms it reads. Small values show the grain of the ground, large ones its main ridges and valleys." min={1} max={100} step={1} value={style.curvShadeRadius ?? 8} onChange={v => ss({ curvShadeRadius: Math.round(v) })} />
                <InlineSl label="Gain" min={0.2} max={5} step={0.1} value={style.curvShadeGain ?? 1} onChange={v => ss({ curvShadeGain: v })} fmt={v => `×${v.toFixed(1)}`} />
                <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style.curvShadeOpacity ?? 0.8} onChange={v => ss({ curvShadeOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
                <ColorRow label="Convex" value={style.curvShadeConvex ?? '#c0561a'} onChange={v => ss({ curvShadeConvex: v })} />
                <ColorRow label="Concave" value={style.curvShadeConcave ?? '#2f6690'} onChange={v => ss({ curvShadeConcave: v })} />
              </Sub>
            )}
          </Section>

          {/* ── Openness ────────────────────────────────────────────────────── */}
          <Section title="Openness" open={sec.openness} onToggle={() => tog('openness')} enabled={style.showOpenness}>
            <Tog label="Enabled" checked={!!style.showOpenness} onChange={v => ss({ showOpenness: v })} />
            {style.showOpenness && (
              <Sub>
                <Note>Bright where the ground is open to the sky, dark where it is enclosed, with no light direction. With red, steep ground reads red: the Red Relief Image Map of Japanese LiDAR surveys.</Note>
                <Tog label="Red relief" help="Red in proportion to the slope, over the grey." checked={style.opennessRed !== false} onChange={v => ss({ opennessRed: v })} />
                {style.opennessRed !== false && (
                  <InlineSl label="Full red at" help="The slope, in true degrees, that is fully red." min={5} max={89} step={1} value={style.opennessRedFull ?? 45} onChange={v => ss({ opennessRedFull: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                )}
                <InlineSl label="Reach" help="How far each ray looks, in steps. Longer reaches see bigger valleys and cost more GPU time." min={4} max={64} step={1} value={style.opennessReach ?? 32} onChange={v => ss({ opennessReach: Math.round(v) })} />
                <InlineSl label="Gain" min={0.2} max={6} step={0.1} value={style.opennessGain ?? 1.5} onChange={v => ss({ opennessGain: v })} fmt={v => `×${v.toFixed(1)}`} />
                <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style.opennessOpacity ?? 0.85} onChange={v => ss({ opennessOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
                {style.opennessRed !== false && (!geoTiffBbox || !hasGeoTiff) && (
                  <GroundScale style={style} ss={ss} geoTiffBbox={geoTiffBbox} hasGeoTiff={hasGeoTiff} />
                )}
              </Sub>
            )}
          </Section>

          {/* ── Texture Shading ─────────────────────────────────────────────── */}
          <Section title="Texture Shading" open={sec.texShade} onToggle={() => tog('texShade')} enabled={style.showTexShade}>
            <Tog label="Enabled" checked={!!style.showTexShade} onChange={v => ss({ showTexShade: v })} />
            {style.showTexShade && (
              <Sub>
                <Note>Leland Brown's texture shading: the ridges and canyons at every scale at once, from a fractional Laplacian of the ground.</Note>
                <InlineSl label="Detail" help="The order of the Laplacian. Low values keep the big forms, high values the fine grain. On a mountain range 0.7 to 1 shows the ridge network best." min={0.1} max={1.5} step={0.05} value={style.texShadeDetail ?? 0.8} onChange={v => ss({ texShadeDetail: v })} fmt={v => v.toFixed(2)} />
                <InlineSl label="Contrast" min={0.2} max={4} step={0.1} value={style.texShadeContrast ?? 1.2} onChange={v => ss({ texShadeContrast: v })} fmt={v => `×${v.toFixed(1)}`} />
                <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style.texShadeOpacity ?? 0.8} onChange={v => ss({ texShadeOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
              </Sub>
            )}
          </Section>

          {/* ── Aerial Perspective ──────────────────────────────────────────── */}
          <Section title="Aerial Perspective" open={sec.aerial} onToggle={() => tog('aerial')} enabled={style.showAerial}>
            <Tog label="Enabled" checked={!!style.showAerial} onChange={v => ss({ showAerial: v })} />
            {style.showAerial && (
              <Sub>
                <Note>Low ground fades into haze, so the summits stand in front, as in Imhof's Swiss relief maps.</Note>
                <InlineSl label="Strength" help="How far the lowest ground fades." min={0} max={1} step={0.01} value={style.aerialStrength ?? 0.6} onChange={v => ss({ aerialStrength: v })} fmt={v => Math.round(v * 100) + '%'} />
                <InlineSl label="Falloff" help="How fast the haze thins with height. Higher values keep it in the valleys." min={0.3} max={5} step={0.1} value={style.aerialGamma ?? 1.6} onChange={v => ss({ aerialGamma: v })} fmt={v => v.toFixed(1)} />
                <ColorRow label="Haze" value={style.aerialColor ?? '#6f8fb0'} onChange={v => ss({ aerialColor: v })} />
              </Sub>
            )}
          </Section>

          {/* ── Wetness ─────────────────────────────────────────────────────── */}
          <Section title="Wetness" open={sec.wetness} onToggle={() => tog('wetness')} enabled={style.showWetness}>
            <Tog label="Enabled" checked={!!style.showWetness} onChange={v => ss({ showWetness: v })} />
            {style.showWetness && (
              <Sub>
                <Note>Where water gathers: a large catchment on flat ground. The topographic wetness index, ln(a / tan β).</Note>
                <InlineSl label="From" help="Only the wettest ground is tinted. Lower this to spread the tint up the valleys." min={0} max={0.95} step={0.01} value={style.wetnessFrom ?? 0.45} onChange={v => ss({ wetnessFrom: v })} fmt={v => Math.round(v * 100) + '%'} />
                <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style.wetnessOpacity ?? 0.8} onChange={v => ss({ wetnessOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
                <ColorRow label="Colour" value={style.wetnessColor ?? '#1f6fb5'} onChange={v => ss({ wetnessColor: v })} />
              </Sub>
            )}
          </Section>

          {/* ── Sunlight ────────────────────────────────────────────────────── */}
          <Section title="Sunlight" open={sec.sunTint} onToggle={() => tog('sunTint')} enabled={style.showSunTint}>
            <Tog label="Enabled" checked={!!style.showSunTint} onChange={v => ss({ showSunTint: v })} />
            {style.showSunTint && (
              <Sub>
                <Note>Hours of direct sun, with the shadows of the ridges, from the shaded colour to the sunny one. At the latitude of a GeoTIFF, or the Hillshade's for a plain heightmap.</Note>
                <SegGroup label="Over" options={[['A year', 'year'], ["The Hillshade's date", 'day']]}
                  value={style.sunTintPeriod ?? 'year'} onChange={(m) => ss({ sunTintPeriod: m })} style={{ marginBottom: 6 }} />
                <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style.sunTintOpacity ?? 0.7} onChange={v => ss({ sunTintOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
                <ColorRow label="Shaded" value={style.sunTintShade ?? '#2d4a7a'} onChange={v => ss({ sunTintShade: v })} />
                <ColorRow label="Sunny" value={style.sunTintSun ?? '#f0c24b'} onChange={v => ss({ sunTintSun: v })} />
              </Sub>
            )}
          </Section>

          {/* ── Presets ────────────────────────────────────────────────────── */}

          </Stage>

          <Stage n={3} title="Marks">

          {/* ── DRAW MODES ─────────────────────────────────────────────────── */}

          {/* The sheet, standing in for the forty sections below it.
              It is still a Section so that it can be closed by anyone who does
              not want it, found by the filter, and given the same shut-state
              readout every other header carries — and so that the panel's four
              indexes still describe every one of its sixty sections.

              While a mark is drilled into, this goes with the rest of them: the
              mode has the pane to itself, which is the point of opening it. See
              the sheet rule in `Section`. */}
          <Section title="Draw Modes" open={sec.modeIndex} onToggle={() => tog('modeIndex')}>
            <ModeSheet style={style} onToggle={handleModeTile} onOpen={openMark} />
          </Section>

          {/* The way back, above the one section that is on screen. Rendered
              only while drilled in, because there is nothing to come back from
              otherwise. */}
          {drill && <ModeBack title={drill} onBack={() => setDrill(null)} />}

          <ModeSections mapGridNote={mapGridNote} cover={cover} geoTiffBbox={geoTiffBbox} gradientStops={gradientStops} hasGeoTiff={hasGeoTiff} intervalMax={intervalMax} intervalMin={intervalMin} mPerWorld={mPerWorld} metreInterval={metreInterval} onPick={onPick} pick={pick} plateSpan={plateSpan} coralNote={coralNote} glacierNote={glacierNote} routeNote={routeNote} runoutNote={runoutNote} slopeClassNote={slopeClassNote} sec={sec} sg={sg} shadowLineSun={shadowLineSun} singleLineFonts={singleLineFonts}  sunHoursGeoreferenced={sunHoursGeoreferenced} sunHoursSeconds={sunHoursSeconds} sunHoursSweeps={sunHoursSweeps} terrain={terrain} tog={tog} venationNote={venationNote} viewshedNote={viewshedNote} windNote={windNote} ss={ss} style={style} />

          {/* Always here, even with nothing to put in it. Hiding the section
              behind a georeferenced raster meant the app's largest feature —
              OpenStreetMap, GPX, GeoJSON, labels, icons — was simply absent from
              the default session, which reads as "this tool doesn't do that"
              rather than "this tool needs a different file first". */}

          </Stage>

          <Stage n={4} title="Overlay">

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
                <LoadBtn data-testid="vector-load-geotiff" onClick={loadGeoTiffFromPicker}>GeoTIFF</LoadBtn>
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

          <TextSection
            open={sec.text} onToggle={() => tog('text')}
            layers={textLayers} setLayers={setTextLayers} overflowed={textOverflow}
            singleLineFonts={singleLineFonts}
            viewTilt={view.tilt} viewSpin={view.rotation}
          />

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
                <InlineSl label="Opacity" min={0} max={1} step={0.05} value={points.pointOpacity ?? 1} onChange={v => sp({ pointOpacity: v })} fmt={v => Math.round(v * 100) + '%'} testId="particle-opacity"
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
                          <div style={{ fontSize:10, color:DANGER_TEXT, background:DANGER_BG, border:'1px solid rgba(248,113,113,0.3)', borderRadius:5, padding:'4px 8px', marginBottom:4 }}>
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
                              <div style={{ fontSize:10, color:WARN, background:WARN_BG, border:'1px solid rgba(245,158,11,0.3)', borderRadius:5, padding:'4px 8px', marginBottom:4 }}>
                                No track loaded — the flock has nothing to listen to.
                              </div>
                            )}
                            <LoadBtn data-testid="flock-audio-load" onClick={fa.loadFromPicker} disabled={fa.isAnalyzing} style={{ marginBottom:8 }}>
                              Audio
                            </LoadBtn>
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
                        <InlineSl label="Sync" min={-0.15} max={0.3} step={0.01} value={points.flockAudioSync ?? 0.04} onChange={v => sp({ flockAudioSync: v })} fmt={v => `${Math.round(v * 1000)} ms`} testId="flock-audio-sync"
                          help="How far ahead of the playhead the flock reads. Steering forces take a few hundred milliseconds to become visible motion, so a little lookahead cancels that and puts the reaction back on the beat. Reading the future is only possible because the whole track is analysed before it plays — raise it if the flock still feels behind, lower it if it anticipates." />
                      </Sub>
                    )}
                    <Tog label="Shadow" small checked={points.flockShadow !== false} onChange={v => sp({ flockShadow: v })}
                      help="Drops each bird's shadow onto the terrain. The direction is the Hillshade sun — azimuth and altitude in the Hillshade section — so the flock is lit the same way the ground under it is, and the shadows swing when you move the sun. A low sun throws them long across the valley." />
                    {points.flockShadow !== false && (
                      <Sub>
                        <InlineSl label="Strength" min={0} max={1} step={0.05} value={points.flockShadowOpacity ?? 0.35} onChange={v => sp({ flockShadowOpacity: v })} fmt={v => v.toFixed(2)} testId="flock-shadow-opacity"
                          help="How dark the shadows are where the bird is lowest. They always fade further as it climbs — this sets the near end of that range." />
                        <InlineSl label="Shadow size" min={0.2} max={6} step={0.1} value={points.flockShadowSize ?? 1} onChange={v => sp({ flockShadowSize: v })} fmt={v => v.toFixed(1)} testId="flock-shadow-size"
                          help="Shadow diameter as a multiple of the bird's own Size. Above 1 the shadows read as a soft moving stain on the landscape rather than as countable dots." />
                        <InlineSl label="Shadow spread" min={0} max={5} step={0.1} value={points.flockShadowSpread ?? 1.5} onChange={v => sp({ flockShadowSpread: v })} fmt={v => v.toFixed(1)} testId="flock-shadow-spread"
                          help="How much a shadow grows as its bird climbs — the depth cue that makes the flock read as flying rather than pasted onto the terrain. At 0 every shadow is the same size whatever the altitude." />
                        {/* The same two style params the Hillshade section owns, surfaced
                            here because that section hides them unless Hillshade is
                            enabled — and the flock's shadows do not require it. One
                            value, two places to reach it, so they cannot disagree. */}
                        <InlineSl label="Sun azimuth" min={0} max={360} step={5} value={style.hillshadeAzimuth ?? 315} onChange={v => ss({ hillshadeAzimuth: v })} fmt={v => Math.round(v) + '°'} testId="flock-sun-azimuth"
                          help="Which way the shadows fall: 0°=N, 90°=E, 315°=NW. This is the Hillshade sun — the same slider, shown here too because Hillshade hides it when it is switched off. Moving it here moves the terrain's shading as well." />
                        <InlineSl label="Sun altitude" min={0} max={90} step={1} value={style.hillshadeAltitude ?? 45} onChange={v => ss({ hillshadeAltitude: v })} fmt={v => Math.round(v) + '°'} testId="flock-sun-altitude"
                          help="Sun height above the horizon. Overhead drops each shadow straight under its bird; low sun throws the whole flock's shadow long across the valley. Clamped at 5° for the shadow maths, since a sun on the horizon casts to infinity." />
                        <ColorRow label="Shadow colour" value={points.flockShadowColor ?? '#000000'} onChange={v => sp({ flockShadowColor: v })}
                          help="Black reads as shadow; a dark tint of the background reads as haze. It is a flat colour with a soft edge, not a darkening of what is underneath, so on a dark background a shadow lighter than the terrain will look like glow." />
                      </Sub>
                    )}
                    {/* A transport button rather than a toggle: freezing the flock is
                        something you reach for constantly — to look at a shape, or to
                        export the frame you are looking at — and it deserves to be
                        the most obvious control in the block rather than one switch
                        among many. Same `animateParticles` param either way. */}
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
          </Stage>

          <Stage n={5} title="Frame">

          {/* ── The camera ────────────────────────────────────────────────
              `View` and `Camera` were two sections holding one subject: aiming
              the camera was in the first, choosing its lens and sliding its
              target were in the second, four rows below. Framing a shot meant
              working in two places that were never adjacent.

              Keep parameter names out of a comment that sits *above* a section
              header. `sectionParams.test.js` scopes a section from its own
              `<Section>` tag to the next one, so anything written here is
              credited to the section before it — this comment named two and
              failed the drift check for Texture, four hundred lines away. */}
          <Section title="Camera" open={sec.camera} onToggle={() => tog('camera')}>
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
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <span style={{ fontSize:10, color:MUTED, flex:1 }}>Direction</span>
                  <SegGroup label="Direction" options={[['CW', 1], ['CCW', -1]]}
                    value={view.autoRotateDir ?? 1} onChange={(dir) => sv({ autoRotateDir: dir })} />
                </div>
              </Sub>
            )}
            <Tog label="Centre guides" checked={view.showGuides} onChange={v => sv({ showGuides: v })} />
            <Sub>
              <Tog label="Orthographic" help="Architectural projection with no perspective distortion." checked={view.orthographic} onChange={v => sv({ orthographic: v })} />
              {!view.orthographic && (
                <InlineSl label="Focal length" min={10} max={120} value={view.fov} onChange={v => sv({ fov: v })} fmt={v => Math.round(v)} />
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

          <Section title="Mirror" open={sec.mirror} onToggle={() => tog('mirror')}
                   enabled={summaries['Mirror'] !== '—'}>
            <div style={{ fontSize:11, color:DIM, fontWeight:600, marginBottom:12, textAlign:'center' }}>3D symmetry, six ways</div>
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
            <Btn size="md" onClick={() => ss({ 
              showMirrorPlusX:true, showMirrorMinusX:false,
              showMirrorPlusY:true, showMirrorMinusY:false,
              showMirrorPlusZ:true, showMirrorMinusZ:false
            })} style={{ width:'100%' }}>Reset symmetry</Btn>
          </Section>

          {/* ── Anaglyph ─────────────────────────────────────────────────
              A modifier, not a mode: it takes whatever the fifty-six modes
              are drawing and makes it stereo. See defaults.js. */}
          <Section title="Anaglyph" open={sec.anaglyph} onToggle={() => tog('anaglyph')}
                   enabled={summaries['Anaglyph'] !== '—'}>
            <Tog label="Enabled" testId="anaglyph-on"
                 help="Draws every layer twice, offset sideways and inked in the two filter colours. Through red/cyan glasses the plate stands up off the paper. It is a modifier rather than a mode, so it works on whatever is already drawing."
                 checked={!!view.anaglyph} onChange={v => sv({ anaglyph: v })} />
            {view.anaglyph && (
              <Sub>
                <InlineSl label="Separation" testId="anaglyph-eye"
                  help="How far the two eyes sit apart, as a fraction of the plate's own size. Too little and there is no depth; too much and the two images refuse to fuse and you see double."
                  min={0.5} max={20} step={0.5} value={view.anaglyphEye ?? 2}
                  onChange={v => sv({ anaglyphEye: v })} fmt={v => v.toFixed(1)} />
                <ColorRow label="Left" value={view.anaglyphLeft ?? '#ff2020'}
                  onChange={v => sv({ anaglyphLeft: v })} testId="anaglyph-left" />
                <ColorRow label="Right" value={view.anaglyphRight ?? '#20e0ff'}
                  onChange={v => sv({ anaglyphRight: v })} testId="anaglyph-right" />
                {/* What it is and is not, said where it is switched on. The
                    depth comes from the perspective divide — a near mark shifts
                    further across the screen than a far one — so an orthographic
                    camera gives a rigid double image with no depth in it. */}
                <div data-testid="anaglyph-note" style={{ fontSize:10, color: MUTED, lineHeight:1.7 }}>
                  <div style={{ color: view.orthographic ? WARN : MUTED }}>
                    {view.orthographic
                      ? 'Orthographic — no depth. Switch the camera to perspective.'
                      : 'Depth comes from the perspective camera'}
                  </div>
                  <div>Per-layer colour is replaced by the two filters</div>
                  <div>
                    {isDarkBackground(style.bgColor)
                      ? 'Dark ground — the filters add, so their overlap goes white'
                      : 'Paper — the filters multiply, so their overlap goes dark'}
                  </div>
                  <div>SVG runs the whole export twice — once per eye</div>
                </div>
              </Sub>
            )}
          </Section>

          {/* ── The page ──────────────────────────────────────────────────
              The other half of what `View` carried. A sheet is not a camera: it
              has a shape, a scale and a margin, and none of them move the eye.
              It takes a dot, because it is off until the frame is drawn. */}
          <Section title="Paper" open={sec.paper} onToggle={() => tog('paper')} enabled={!!view.showFrame}>
            <Tog label="Paper frame" checked={!!view.showFrame} onChange={v => sv({ showFrame: v })}
              help="Shows where a sheet of paper falls over the scene, and makes SVG export emit only what lands inside it — cut at the boundary rather than hidden behind a clip path, so there is nothing left to delete afterwards. The frame is an overlay: it never appears in an export, and it does not affect PNG or STL." />
            {view.showFrame && (
              <Sub>
                <SelectRow label="Paper" testId="frame-paper" value={view.framePaper ?? 'iso'}
                  onChange={v => sv({ framePaper: v })}>
                  {['ISO','US','Ratio'].map(group => (
                    <optgroup key={group} label={group}>
                      {Object.entries(PAPERS).filter(([, v]) => v.group === group).map(([id, v]) => (
                        <option key={id} value={id}>
                          {v.label}{v.custom ? '' : ` — ${paperRatioLabel(id)}`}{v.note ? ` (${v.note})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </SelectRow>
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

          {/* ── Scale and North ────────────────────────────────────────────
              The two marks that make a plate a document. Both are ink: they are
              drawn over the viewport, composited into the PNG and written into
              the SVG as their own Inkscape layer, so a plotter can put them in a
              different pen. See utils/sheetMarks.js. */}
          <Section title="Scale and North" open={sec.sheetMarks} onToggle={() => tog('sheetMarks')}
                   enabled={summaries['Scale and North'] !== '—'}>
            <Tog label="Scale bar" testId="mark-bar"
                 help="A bar of round length — 200 m, 500 m, 1 km — measured from this raster's own bounding box. Needs a georeferenced GeoTIFF: a PNG heightmap has no ground to measure."
                 checked={!!view.frameScaleBar} onChange={v => sv({ frameScaleBar: v })} />
            <Tog label="North arrow" testId="mark-north"
                 help="Points along the raster's own rows, and turns with the camera. It is grid north, which is not true north away from a projection's central meridian."
                 checked={!!view.frameNorth} onChange={v => sv({ frameNorth: v })} />
            {(view.frameScaleBar || view.frameNorth) && (
              <Sub>
                <InlineSl label="Size" min={0.4} max={3} step={0.05} value={view.frameMarkScale ?? 1}
                  onChange={v => sv({ frameMarkScale: v })} fmt={v => v.toFixed(2) + '×'} testId="mark-size" />
                <ColorRow label="Ink" value={view.frameMarkColor ?? '#000000'}
                  onChange={v => sv({ frameMarkColor: v })} testId="mark-color" />
                {/* What the marks are, and what they are not. The bar is exact
                    only for a plan view through an orthographic camera: tilt it
                    and the far edge of the plate is at a different scale from
                    the near one, so the figure is measured at the centre of the
                    scene and the tilt is said out loud. Same register the panel
                    already uses for `assumed UTM`. */}
                <div data-testid="mark-readout" style={{ fontSize:10, color: MUTED, lineHeight:1.7 }}>
                  {!mapScale ? (
                    <span style={{ color:WARN }}>
                      No georeference — load a GeoTIFF and the bar can be measured.
                    </span>
                  ) : (<>
                    <div>{`${formatDistance(niceDistance(barTargetMetres) ?? 0)} bar · ${mapScale.metresPerPixel.toFixed(2)} m per pixel`}</div>
                    <div style={{ color: (view.tilt ?? 0) < 6 ? MUTED : WARN }}>
                      {(view.tilt ?? 0) < 6
                        ? 'plan view — the bar is exact'
                        : `tilted ${Math.round(view.tilt)}° — measured at the centre, approximate elsewhere`}
                    </div>
                    {!view.orthographic && (
                      <div>perspective — tilt to 0° and switch to orthographic for a true plan</div>
                    )}
                    {mapRatio && (
                      <div data-testid="map-ratio">
                        {`1 : ${Math.round(mapRatio).toLocaleString()} on a ${view.plotWidthMm} mm sheet`}
                      </div>
                    )}
                  </>)}
                </div>
              </Sub>
            )}
          </Section>

          </Stage>

          <Stage n={6} title="Output">

          <Section title="Export" open={sec.export} onToggle={() => tog('export')}>
            {/* What the SVG will contain, said as a sentence.
                It *cuts* at the paper frame rather than hiding what falls outside
                it, so a switch two stages away in Frame decides what you get —
                and nothing else in the panel says so. It carries no count: the
                stats block below prints the segment total already, and one
                number in two places is one number that can look like two. */}
            <div data-testid="export-extent" style={{ marginBottom:4, fontSize:10, color: MUTED }}>
              {view.showFrame
                ? `SVG cuts at the frame ${view.frameLandscape ? '→' : '↑'}`
                : 'SVG writes the full canvas'}
            </div>
            {/* The second thing a plate carries, and the one nobody would guess
                at: every PNG and SVG holds the whole parameter set, so the
                picture opens again through Preset ⬆. Said here because a file
                that is quietly also a project file is worth exactly nothing if
                you never learn that it is one. */}
            <div data-testid="export-carries" style={{ marginBottom:6, fontSize:10, color: MUTED }}>
              PNG and SVG carry the preset
            </div>
            <div style={{ display:'flex', gap:4, marginBottom:4 }}>
              <ExpBtn label="SVG" hint="1" onClick={onSvg} testId="export-svg" />
              <ExpBtn label="PNG" hint="2" onClick={onPng} testId="export-png" />
              <ExpBtn label="PNG α" hint="3" onClick={onPngAlpha} testId="export-png-alpha" />
              <ExpBtn label="STL" hint="4" onClick={onStl} testId="export-stl" />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:4, marginBottom:4 }}>
              <ExpBtn label={webmActive ? '⏹ Stop' : 'WebM'} hint={webmActive ? '' : '5'} onClick={onWebmToggle} active={webmActive} />
              <ExpBtn label="Heightmap" hint="save" onClick={onHeightmap} />
              <ExpBtn label="Preset ⬇" hint="save" onClick={onSavePreset} testId="preset-save" />
              {/* Spends the opening on the *click*, not on the file landing: the
                  picker is a dialog the user sits in front of, and the opening
                  arriving behind it would be overwritten by the load anyway —
                  or worse, land after it. */}
              <ExpBtn label="Preset ⬆" hint="open" onClick={() => { spendOpening(); onLoadPreset?.() }} testId="preset-load" />
            </div>
            <InlineSl label="WebM length" min={1} max={60} value={webmDuration} onChange={setWebmDuration} fmt={v => v + ' s'} />

            {/* ── The plot ─────────────────────────────────────────────────
                The stated audience of this whole tool is a pen plotter, and
                until now nothing here said what a plot would cost. Two numbers
                decide whether it takes twenty minutes or ninety: the ink laid
                down, which the drawing fixes, and the distance the carriage
                covers between strokes with the pen in the air, which is an
                ordering problem nobody had looked at. See utils/penRoute.js. */}
            <div style={{ marginTop:10, paddingTop:8, borderTop:`1px solid ${BORDER}` }}>
              <InlineSl label="Sheet" testId="plot-width"
                help="How wide the plot is on paper. The exporter writes pixels rather than millimetres — deliberately, so one file suits any sheet — so this is the one fact it cannot know. Everything physical needs it: the time below, and the map ratio in Scale and North."
                min={50} max={1200} step={1} value={view.plotWidthMm ?? 297}
                onChange={v => sv({ plotWidthMm: Math.round(v) })} fmt={v => Math.round(v) + ' mm'} />
              <Tog label="Plotter order" testId="plot-order" small
                help="Re-orders the strokes inside each pen layer so the carriage travels less, drawing any stroke backwards if its far end is nearer. Off by default: where two strokes of different colours cross, the order decides which ink is on top — on screen and on paper alike — so it is your call, not the exporter's. Filled areas are never reordered."
                checked={!!view.plotPenOrder} onChange={v => sv({ plotPenOrder: v })} />
              {/* Only while a mode that exports filled areas is drawing. It is an
                  SVG-only choice, so the viewport looks the same either way. */}
              {(style.enabledIndexed || style.enabledMineral || style.enabledCover || style.enabledShed) && (
                <div data-testid="plot-area-fill" style={{ marginBottom:6 }}>
                  <div style={{ fontSize:11, color: DIM, margin:'2px 0 5px' }}>Filled areas in the SVG</div>
                  <SegGroup label="Filled areas in the SVG" options={[['Fill', 'solid'], ['Hatch', 'hatch']]}
                    testIdOf={(m) => `plot-fill-${m}`} value={view.plotAreaFill ?? 'solid'}
                    onChange={(m) => sv({ plotAreaFill: m })} style={{ marginBottom: 8 }} />
                  {view.plotAreaFill === 'hatch' && (
                    <>
                      <InlineSl label="Pitch" testId="plot-hatch-pitch"
                        help="Distance between hatch lines on paper, for an ink at full contrast with the paper. A lighter ink is hatched more openly, and the darkest inks are cross-hatched. Set it near your pen width for a solid tone."
                        min={0.2} max={5} step={0.05} value={view.plotHatchPitch ?? 0.8}
                        onChange={v => sv({ plotHatchPitch: v })} fmt={v => v.toFixed(2) + ' mm'} />
                      <InlineSl label="Angle" min={0} max={180} step={1} value={view.plotHatchAngle ?? 45}
                        onChange={v => sv({ plotHatchAngle: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                    </>
                  )}
                </div>
              )}
              <Btn block onClick={onPreflight} data-testid="preflight">Preflight</Btn>
              <div data-testid="preflight-readout" style={{ marginTop:6, fontSize:10, color: MUTED, lineHeight:1.8 }}>
                {!plotStats ? (
                  'Measures the file a plotter would be given — after occlusion and the frame.'
                ) : (() => {
                  const width = view.plotWidthMm ?? 297
                  const now = plotEstimate({
                    ink: plotStats.ink,
                    travel: view.plotPenOrder ? plotStats.travelOrdered : plotStats.travelAsBuilt,
                    widthPx: plotStats.width, widthMm: width,
                    strokes: plotStats.strokes, penChanges: Math.max(0, plotStats.pens - 1),
                  })
                  const mm = (px) => (px * width) / Math.max(1, plotStats.width)
                  const metres = (px) => `${(mm(px) / 1000).toFixed(1)} m`
                  const saved = plotStats.travelAsBuilt > 0
                    ? 1 - plotStats.travelOrdered / plotStats.travelAsBuilt : 0
                  return (<>
                    <div>{`${plotStats.strokes.toLocaleString()} strokes · ${plotStats.pens} pen${plotStats.pens === 1 ? '' : 's'}`}</div>
                    <div>{`ink ${metres(plotStats.ink)} · pen up ${metres(view.plotPenOrder ? plotStats.travelOrdered : plotStats.travelAsBuilt)}`}</div>
                    <div style={{ color: DIM }}>
                      {now ? `about ${now.minutes < 1 ? '<1' : Math.round(now.minutes)} min at 120 mm/s` : ''}
                    </div>
                    {/* The saving, said only while it is still on the table. */}
                    {!view.plotPenOrder && saved > 0.02 && (
                      <div style={{ color: ACCENT }}>
                        {`Plotter order would cut the pen-up travel by ${Math.round(saved * 100)}%`}
                      </div>
                    )}
                    {plotStats.dashed && <div>a dashed layer is counted as solid</div>}
                  </>)
                })()}
              </div>
            </div>
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
                background: profileMode ? ACCENT_DEEP : SURF,
                color: profileMode ? ON_ACCENT : MUTED,
                border: `1px solid ${profileMode ? ACCENT : BORDER}`,
              }}
            >
              {profileMode
                ? (profileClicks?.length === 0 ? 'Click point A…' : 'Click point B…')
                : 'Elevation Profile'}
            </button>
          </Section>

          </Stage>

          {/* ── Stats ─────────────────────────────────────────────────────── */}
          <div style={{ padding:'8px 12px 4px', fontSize:10, color: MUTED, fontVariantNumeric:'tabular-nums', lineHeight:1.9 }}>
            <div>Segments: {segs} · Verts: {verts}</div>
            <div>Triangles: {tris} · Grid: {grid}</div>
            {/* Measured, not estimated. `drawModes.js` carries a cost per mode,
                but a cost times a grid size is a guess about a machine it has
                never run on — and the real figure was already being computed
                for the benchmark log and thrown away. It answers the question
                the panel could not: is this slow because of what I just
                switched on. Switch a mode, watch the number. */}
            {lastBuildMs != null && (
              <div data-testid="build-time" style={{ color: isComputing ? DIM : MUTED }}>
                Rebuild: {lastBuildMs < 1000
                  ? `${Math.round(lastBuildMs)} ms`
                  : `${(lastBuildMs / 1000).toFixed(1)} s`}
              </div>
            )}
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
              <div style={{ marginTop:2, color: crsInfo.supported ? MUTED : WARN, wordBreak:'break-word' }}>
                Projection: {crsDisplayName(geoTiffCRS, geoTiffCRSName)}
                {crsInfo.accuracy === 'guess'   && ' · assumed UTM'}
                {crsInfo.accuracy === 'approx'  && ' · datum shift not applied'}
                {!crsInfo.supported             && ' · vector overlay unsupported'}
              </div>
            )}
          </div>
          </PaintedMasks.Provider>
          </ModeCopiesPanel.Provider>
          </CoverPlate.Provider>
          </SectionFilter.Provider>
          </PanelStage.Provider>
        </div>
        </div>

      </aside>
    </>
  )
}
