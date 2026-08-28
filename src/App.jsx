/**
 * Root component — erzberg
 *
 * All tweakable params live in plain React state (no Leva).
 * The custom <Sidebar> renders the right-hand control panel.
 */
import { Canvas, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditPanel } from './components/EditPanel'
import { ElevationProfile } from './components/ElevationProfile'
import { HeightmapEditor } from './components/HeightmapEditor'
import { Scene } from './components/Scene'
import { Sidebar } from './components/Sidebar'
import { W as PANEL_W } from './components/panel/ui'
import { useHeightmap } from './hooks/useHeightmap'
import { useSoundscape } from './hooks/useSoundscape'
import { useFlockAudio } from './hooks/useFlockAudio'
import { FrameOverlay } from './components/FrameOverlay'
import { FeatureTooltip } from './components/FeatureTooltip'
import { useTerrainGeometry } from './hooks/useTerrainGeometry'
import { useVectorIcons } from './hooks/useVectorIcons'
import { useVectorLabels } from './hooks/useVectorLabels'
import { useContourLabels } from './hooks/useContourLabels'
import { flattenSvg } from './utils/svgFlatten'
import { useStore } from './store/useStore'
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from './defaults'
import { clearSession, loadSession, saveSession, withDefaults } from './utils/session'
import { featureCoverage } from './utils/geoCoords'
import { needsSurfaceShading } from './utils/geometryBuilders'
import { gpxToSource } from './utils/gpxParser'
import { parseGeoJson } from './utils/geoJsonParser'
import { layersFromSource, moveLayer, sourceRings } from './utils/vectorLayers'
import { GRADIENT_PRESETS } from './utils/gradientPresets'
import { describeEdit, effectiveBounds } from './utils/heightmapEdit'
import { exportHeightmap } from './utils/heightmapExport'
import { isRecording, startWebM, stopWebM } from './utils/webmRecorder'
import { clearOsmCache } from './utils/osmFetch'
import { GROUP_OF } from './params'

// ── BgSync: keeps WebGL clear colour in sync; transparent when gradient is on ─
function BgSync({ color, gradient }) {
  const { gl } = useThree()
  useEffect(() => {
    if (gradient) gl.setClearColor(0, 0)
    else          gl.setClearColor(color, 1)
  }, [gl, color, gradient])
  return null
}

// ── DprGuard: keeps the drawing buffer within what the GPU will actually give ─
// A browser that cannot afford the requested WebGL drawing buffer clamps it
// silently: canvas.width keeps reporting the requested size while the real
// framebuffer is smaller, and Three goes on setting a viewport for the size it
// asked for. The scene is then drawn past the edge of the buffer that exists and
// lands off-centre and cropped — which is what Supersampling 2× did on a large
// Retina display (10240×5760 requested, 7680×4320 delivered).
//
// The ceiling is not a constant that can be hardcoded: it depends on the live
// context's own state, and an offscreen canvas with identical attributes probes
// clean well past where the displayed one clamps. So measure it the moment it
// bites and report the usable pixel budget upward, which caps Supersampling to
// whatever the display can honestly deliver instead of breaking the view.
function DprGuard({ onClamp }) {
  const gl   = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const dpr  = useThree((s) => s.viewport.dpr)
  useEffect(() => {
    const canvas = gl.domElement
    const ctx = gl.getContext()
    if (!ctx || !canvas.width || !canvas.height) return
    if (ctx.drawingBufferWidth < canvas.width || ctx.drawingBufferHeight < canvas.height) {
      onClamp(ctx.drawingBufferWidth * ctx.drawingBufferHeight)
    }
  }, [gl, size.width, size.height, dpr, onClamp])
  return null
}

// ── Loading overlay ───────────────────────────────────────────────────────────
/**
 * `progress` and `onCancel` are optional: without them this renders exactly as it
 * always did, so the loading and computing overlays are unchanged. The SVG and
 * STL exports pass both — they are the two that run long enough to be worth
 * reporting on, or abandoning.
 */
function LoadingOverlay({ msg, progress = null, onCancel = null }) {
  const pct = progress == null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100)
  return (
    <div data-testid="loading-overlay" style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.6)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:4000,
    }}>
      <div style={{
        display:'flex', flexDirection:'column', alignItems:'center', gap:14,
        background:'#18181b', border:'1px solid #3f3f46', borderRadius:10, padding:'28px 40px',
        minWidth: pct == null ? 0 : 260,
      }}>
        <div style={{
          width:32, height:32, border:'3px solid rgba(255,255,255,.12)',
          borderTopColor:'#3b82f6', borderRadius:'50%',
          animation:'hm-spin .7s linear infinite',
        }} />
        <span style={{ fontSize:14, color:'#e4e4e7', fontFamily:'system-ui,sans-serif' }}>{msg}</span>
        {pct != null && (
          <>
            {/* Same shape as the spectrogram analyser's bar in the panel. */}
            <div style={{ width:'100%', height:4, background:'#3f3f46', borderRadius:2, overflow:'hidden' }}>
              <div data-testid="export-progress-fill"
                   style={{ height:'100%', width:`${pct}%`, background:'#3b82f6', transition:'width .1s' }} />
            </div>
            <span data-testid="export-progress" data-pct={pct}
                  style={{ fontSize:11, color:'#71717a', fontFamily:'system-ui,sans-serif' }}>{pct}%</span>
          </>
        )}
        {onCancel && (
          <button data-testid="export-cancel" onClick={onCancel} style={{
            background:'none', border:'1px solid #3f3f46', borderRadius:5, cursor:'pointer',
            color:'#d4d4d8', fontSize:11, padding:'4px 14px', fontFamily:'system-ui,sans-serif',
          }}>Cancel</button>
        )}
      </div>
      <style>{`@keyframes hm-spin { to { transform:rotate(360deg) } }`}</style>
    </div>
  )
}

// How long the settings must hold still before they are written, and the longest
// a stream of changes may postpone that write. See the effect that uses them.
const SAVE_DEBOUNCE_MS = 400
const SAVE_MAX_WAIT_MS = 2000

/** Extension and human name per export kind, for the line that reports one. */
const EXPORT_KINDS = {
  svg:      ['svg', 'SVG'],
  stl:      ['stl', 'STL'],
  png:      ['png', 'PNG'],
  // `-alpha.png`, not `.alpha.png`: this string is joined to the base name and
  // has to match what pngExport.js actually writes, or the one message whose
  // whole job is to name the file names a file that is not there.
  pngAlpha: ['-alpha.png', 'Transparent PNG'],
}

// ── Auto-resolution: keep the geometry grid within 1024×1024 ─────────────────
// A pure function of its arguments, so it lives out here rather than in a
// useCallback — as a hook it had to be declared before its callers could list it
// as a dependency, which is a layout constraint with nothing behind it.
function autoResolution(width, height) {
  return Math.min(20, Math.max(1, Math.ceil(Math.max(width, height) / 1024)))
}

// ── Toast ─────────────────────────────────────────────────────────────────────
/**
 * One line at the foot of the screen, optionally with something to click.
 *
 * Two jobs, and they are the same shape. Exports used to end with the overlay
 * simply vanishing — the app renames every file after the source raster, which
 * is a genuinely careful touch it never got to mention. And a reset used to be
 * unrecoverable, which an offered Undo fixes better than a confirm dialog: a
 * dialog taxes the deliberate case to protect the accidental one.
 */
function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onDismiss, toast.action ? 9000 : 4500)
    return () => clearTimeout(t)
  }, [toast, onDismiss])
  if (!toast) return null
  return (
    <div data-testid="toast" role="status" aria-live="polite" style={{
      position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
      background:'#27272a', border:'1px solid #52525b', borderRadius:8,
      padding:'10px 14px', zIndex:4500, display:'flex', alignItems:'center', gap:14,
      maxWidth:460, boxShadow:'0 4px 24px rgba(0,0,0,0.5)',
      fontFamily:'system-ui,sans-serif', fontSize:13, color:'#e4e4e7',
    }}>
      <span style={{ flex:1 }}>{toast.msg}</span>
      {toast.action && (
        <button data-testid="toast-action" onClick={() => { toast.onAction?.(); onDismiss() }} style={{
          background:'none', border:'1px solid #71717a', borderRadius:5, cursor:'pointer',
          color:'#e4e4e7', fontSize:12, padding:'3px 10px', fontFamily:'system-ui,sans-serif',
          whiteSpace:'nowrap',
        }}>{toast.action}</button>
      )}
      <button onClick={onDismiss} aria-label="Dismiss" style={{
        background:'none', border:'none', color:'#8f8f99', cursor:'pointer',
        fontSize:15, lineHeight:1, padding:'0 2px',
      }}>✕</button>
    </div>
  )
}

// ── Viewport hint ─────────────────────────────────────────────────────────────
const HINT_KEY = 'erzberg.viewportHint.seen'

/**
 * What the 3D view can be done to, said once.
 *
 * Two thirds of the screen is a live scene that presents itself as a picture,
 * and orbit/pan/zoom are the primary interaction of the whole tool. Edit Mode
 * has had a bar like this all along — the main view is being held to the
 * standard the app already set for itself.
 *
 * It goes away for good the first time someone orbits, because at that point it
 * has been read; the dismiss button is for people who would rather not.
 */
function ViewportHint({ onDismiss }) {
  return (
    <div data-testid="viewport-hint" style={{
      // Top-left, not bottom-left where Edit Mode puts its bar: the axis gizmo
      // lives down there, and the toast and the error banner both come up the
      // middle. Nothing else claims this corner.
      position:'fixed', left:14, top:14, zIndex:600,
      display:'flex', alignItems:'center', gap:8,
      fontFamily:'system-ui,sans-serif', fontSize:11, color:'#e4e4e7',
    }}>
      <span style={{ background:'rgba(0,0,0,.55)', padding:'5px 9px', borderRadius:5 }}>
        drag to orbit · scroll to zoom · right-drag to pan
      </span>
      <button onClick={onDismiss} aria-label="Dismiss the viewport hint" style={{
        background:'rgba(0,0,0,.55)', border:'none', borderRadius:5, cursor:'pointer',
        color:'#8f8f99', fontSize:12, lineHeight:1, padding:'6px 8px',
      }}>✕</button>
    </div>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const { load, loadFromPicker, loadGeoTiffFromPicker, isLoading, loadingMsg, loadError, clearError, showError } = useHeightmap()
  const heightmapPixels   = useStore((s) => s.heightmapPixels)
  const heightmapWidth    = useStore((s) => s.heightmapWidth)
  const heightmapHeight   = useStore((s) => s.heightmapHeight)
  const heightmapFilename = useStore((s) => s.heightmapFilename)
  const srcPixels         = useStore((s) => s.srcPixels)
  const srcMask           = useStore((s) => s.srcMask)
  const srcWidth          = useStore((s) => s.srcWidth)
  const srcHeight         = useStore((s) => s.srcHeight)
  const edit              = useStore((s) => s.edit)
  const setEdit           = useStore((s) => s.setEdit)
  const textureImage      = useStore((s) => s.textureImage)
  const setTextureImage   = useStore((s) => s.setTextureImage)
  const geoTiffElevMin    = useStore((s) => s.geoTiffElevMin)
  const geoTiffElevMax    = useStore((s) => s.geoTiffElevMax)
  const geoTiffBbox       = useStore((s) => s.geoTiffBbox)
  const geoTiffCRS        = useStore((s) => s.geoTiffCRS)
  const geoTiffCRSName    = useStore((s) => s.geoTiffCRSName)

  const soundscape = useSoundscape()
  // The flock's own track. Separate from Soundscapes on purpose: that hook's job
  // is to *become* the terrain, and wanting the birds to react to music is not
  // wanting the raster replaced by a spectrogram. Falls back to a playing
  // Soundscape so the same file never has to be loaded twice.
  const flockAudio = useFlockAudio(soundscape.liveRef)

  const vectorSources      = useStore((s) => s.vectorSources)
  const addVectorSource    = useStore((s) => s.addVectorSource)
  const removeVectorSource = useStore((s) => s.removeVectorSource)
  const clearVectorSources = useStore((s) => s.clearVectorSources)

  // The style half of the vector layers. Coordinates live in the store; these
  // are params like any other, which is what keeps recolouring one off the
  // worker's rebuild path entirely.
  const [vectorLayers, setVectorLayers] = useState([])
  const [vectorError,  setVectorError]  = useState(null)
  // Pointing at the terrain to name what is under the cursor. On by default;
  // the escape hatch matters because a pick is O(segments) and a dense fetch is
  // hundreds of thousands of them.
  const [vectorIdentify, setVectorIdentify] = useState(true)

  /**
   * Adds an imported source and the layer records that go with it, on top of the
   * stack — the newest thing loaded is the thing you want to see, and index 0 is
   * the front of the scene.
   */
  const adoptVectorSource = useCallback((source) => {
    addVectorSource(source)
    setVectorLayers((prev) => [...layersFromSource(source), ...prev])
    setVectorError(null)
  }, [addVectorSource])

  /** Drops a whole source — its layers go with it, since nothing else uses it. */
  const dropVectorSource = useCallback((sourceId) => {
    removeVectorSource(sourceId)
    setVectorLayers((prev) => prev.filter((l) => l.sourceId !== sourceId))
  }, [removeVectorSource])

  /**
   * Removes one layer, and the source too once its last layer is gone —
   * otherwise a fetch's coordinates would stay resident and keep being posted to
   * the worker with nothing left to draw from them.
   */
  const removeVectorLayer = useCallback((id) => {
    // Computed outside the updater rather than inside it: a state updater has to
    // stay pure, and React is entitled to run it twice.
    const gone = vectorLayers.find((l) => l.id === id)
    const next = vectorLayers.filter((l) => l.id !== id)
    setVectorLayers(next)
    if (gone && !next.some((l) => l.sourceId === gone.sourceId)) removeVectorSource(gone.sourceId)
  }, [vectorLayers, removeVectorSource])

  const patchVectorLayer = useCallback((id, patch) => {
    setVectorLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }, [])

  /**
   * Moves a layer within the stack. Pure state: the geometry the worker holds is
   * the same geometry at either end of the list, so this never reaches it — see
   * `vectorBuildSignature`.
   */
  const reorderVectorLayer = useCallback((id, toIndex) => {
    setVectorLayers((prev) => moveLayer(prev, id, toIndex))
  }, [])

  /** Everything vector goes away — a new raster is a different place. */
  const dropVectors = useCallback(() => {
    clearVectorSources()
    setVectorLayers([])
    setVectorError(null)
    // Including the Overpass responses those layers came from. They are keyed on
    // the old raster's extent, so they can never be hit again from here — and an
    // entry is the raw JSON of a whole valley, which is not something to hold on
    // to for a place that is no longer open.
    clearOsmCache()
  }, [clearVectorSources])

  /**
   * Re-applies a preset's saved vector styling to whatever is currently loaded.
   *
   * Matched on `bucket`, so a preset made against one OSM fetch styles the next
   * fetch of the same area; layers the preset does not mention are left alone.
   * A preset written before vector layers existed carries the old flat `*Gpx`
   * params instead, and those are honoured for GPX layers so old preset files
   * keep doing what they did.
   */
  const applyVectorStyles = useCallback((preset) => {
    const byBucket = new Map((preset.vectorStyles ?? []).map((v) => [v.bucket, v]))
    const legacy = preset.style?.colorGpx != null ? {
      color:   preset.style.colorGpx,
      weight:  preset.style.weightGpx,
      opacity: preset.style.opacityGpx,
      dash:    preset.style.dashGpx,
    } : null
    if (!byBucket.size && !legacy) return

    setVectorLayers((prev) => {
      const styled = prev.map((l) => {
        const saved = byBucket.get(l.bucket)
        if (saved) return { ...l, ...saved, id: l.id, sourceId: l.sourceId, count: l.count }
        if (legacy && l.sourceKind === 'gpx') return { ...l, ...legacy }
        return l
      })
      if (!byBucket.size) return styled

      // Order is part of the look, and it travels for free: `vectorStyles` is
      // written in stack order, so a preset made after arranging the stack puts
      // it back. Buckets the preset never saw keep their order relative to each
      // other and settle underneath — a preset that knows about three of forty
      // layers has nothing to say about where the other thirty-seven go.
      //
      // Only for presets that say so. Before the stack existed the same array
      // was written in *paint* order, ground cover first, and reading one of
      // those as a stack order turns the picture inside out — landuse in front,
      // roads behind. An old preset never meant anything by its order, so the
      // honest thing is to take its styles and leave the arrangement alone.
      if (!preset.vectorStackOrder) return styled

      const rank = new Map([...byBucket.keys()].map((b, i) => [b, i]))
      return styled
        .map((l, i) => [l, rank.get(l.bucket) ?? rank.size + i])
        .sort((a, b) => a[1] - b[1])
        .map(([l]) => l)
    })
  }, [])

  const loadVectorFile = useCallback((accept, parse) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept })
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return
      setVectorError(null)
      try {
        adoptVectorSource(parse(await file.text(), file.name))
      } catch (err) {
        console.error('[Vector] Parse error:', err)
        setVectorError(err?.message || `Could not read ${file.name}.`)
      }
    }
    input.click()
  }, [adoptVectorSource])

  /**
   * Replaces one layer's icon with an uploaded SVG.
   *
   * Flattened at import rather than at draw time, so a file that cannot be read
   * says so here — while the user is looking at the file picker — instead of
   * becoming a layer that silently draws nothing.
   */
  const loadIconSvg = useCallback((layerId) => {
    const input = Object.assign(document.createElement('input'),
      { type: 'file', accept: '.svg,image/svg+xml' })
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return
      setVectorError(null)
      try {
        const geo = flattenSvg(await file.text())
        // Only the icon: the glyph is drawn with the icon's own stroke width,
        // so there is no longer a dot's diameter to thin out of the way. This
        // used to reach into the layer and set `weight` to 1.5, which is the
        // same hack the picker carried and is gone for the same reason.
        patchVectorLayer(layerId, { icon: 'custom', iconCustom: { name: file.name, geo } })
      } catch (err) {
        console.error('[icons] Could not read', file.name, err)
        setVectorError(`${file.name}: ${err?.message || 'could not be read as an icon.'}`)
      }
    }
    input.click()
  }, [patchVectorLayer])

  const loadGpxFromPicker = useCallback(
    () => loadVectorFile('.gpx', gpxToSource), [loadVectorFile])
  const loadGeoJsonFromPicker = useCallback(
    () => loadVectorFile('.geojson,.json,application/geo+json', parseGeoJson), [loadVectorFile])

  const exportBaseName = heightmapFilename
    ? heightmapFilename.replace(/\.[^.]+$/, '')
    : 'heightmap'

  // ── Update document title ─────────────────────────────────────────────────
  useEffect(() => {
    const isDefault = heightmapFilename === 'Heightmap.png'
    document.title = (heightmapFilename && !isDefault) ? `erzberg - ${heightmapFilename}` : 'erzberg'
  }, [heightmapFilename])

  // ── All tweakable state ───────────────────────────────────────────────────
  /**
   * Read once, at mount, before the first render.
   *
   * A ref rather than state because nothing re-reads it: it seeds the initial
   * values below and then only answers "was there a session?" for the note in
   * the panel. Re-reading storage later would fight the effect that writes it.
   */
  const restored = useRef(loadSession({
    terrain: TERRAIN_DEF, style: STYLE_DEF, points: POINTS_DEF, view: VIEW_DEF,
    gradientStops: GRADIENT_PRESETS['Jet'],
    bgGradientStops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#cccccc' }],
  }))
  const [terrain, setTerrain] = useState(() => withDefaults(TERRAIN_DEF, restored.current?.terrain))
  const [style,   setStyle]   = useState(() => withDefaults(STYLE_DEF,   restored.current?.style))
  const [points,  setPoints]  = useState(() => withDefaults(POINTS_DEF,  restored.current?.points))
  const [view,    setView]    = useState(() => withDefaults(VIEW_DEF,    restored.current?.view))
  // Cleared by the first Reset all, so the note stops claiming a session that
  // is no longer what is on screen.
  const [sessionRestored, setSessionRestored] = useState(() => restored.current != null)
  // Largest drawing buffer this context has been observed to actually deliver.
  // Infinity until DprGuard catches a clamp; only ever ratchets downward.
  const [maxBufferPx, setMaxBufferPx] = useState(Infinity)
  const handleBufferClamp = useCallback((px) => {
    setMaxBufferPx((prev) => Math.min(prev, px))
  }, [])
  // The affordable pixel ratio depends on the window size, so it has to be
  // reactive — shrinking the window can make a previously clamped setting fit.
  const [winSize, setWinSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [gradientStops,   setGradientStops]   = useState(() => restored.current?.gradientStops ?? GRADIENT_PRESETS['Jet'])
  const [bgGradientStops, setBgGradientStops] = useState(() => restored.current?.bgGradientStops
    ?? [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#cccccc' }])

  // ── Keep the session ──────────────────────────────────────────────────────
  /**
   * Debounced, with a ceiling, and not on the way in.
   *
   * Debounced because a slider drag is a stream of state changes and this is a
   * synchronous write: at 400 ms it lands once the hand stops.
   *
   * The ceiling is what a plain debounce got wrong. Auto-rotate syncs the camera
   * into `view` every 150 ms, and 150 < 400, so every re-run cleared the pending
   * timer and set a new one — the write was rescheduled forever and nothing was
   * ever stored while the plate was spinning, which is exactly the unattended
   * hour this feature exists to protect. `SAVE_MAX_WAIT_MS` bounds how long a
   * continuous stream can hold the write off.
   *
   * And the mount pass is skipped, or opening the app would store a session
   * nobody made — so the *next* visit would announce that settings had been
   * restored when all that came back were the defaults it would have used anyway.
   */
  const savePendingSince = useRef(0)
  const skipNextSave = useRef(true)   // the mount pass
  useEffect(() => {
    if (skipNextSave.current) { skipNextSave.current = false; return }
    if (!savePendingSince.current) savePendingSince.current = Date.now()
    const waited = Date.now() - savePendingSince.current
    const delay = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS - waited))
    const t = setTimeout(() => {
      savePendingSince.current = 0
      saveSession({ terrain, style, points, view, gradientStops, bgGradientStops })
    }, delay)
    return () => clearTimeout(t)
  }, [terrain, style, points, view, gradientStops, bgGradientStops])
  const [webmDuration, setWebmDuration]   = useState(5)
  const [externalPresets, setExternalPresets] = useState({})
  // Intrinsic elevation scale derived from GeoTIFF metadata (metres / pixel ratio).
  // terrain.elevScale is a signed offset (0 = use GeoTIFF-derived scale as-is).
  const [baseElevScale, setBaseElevScale] = useState(1)
  // Zoom fit calculated on load; view.zoom is the user-facing multiplier (1 = 100%).
  const [baseZoom, setBaseZoom] = useState(1)

  // ── Elevation profile ─────────────────────────────────────────────────────
  const [profileMode,   setProfileMode]   = useState(false)
  const [profileClicks, setProfileClicks] = useState([])
  const [profileData,   setProfileData]   = useState(null)
  // Where the section was taken, kept for as long as the chart is up so the
  // scene can show the line it describes. Cleared with the chart, not with the
  // mode — leaving profile mode is not the same as being done with the result.
  const [profileAnchors, setProfileAnchors] = useState(null)

  const sampleProfile = useCallback((uv0, uv1) => {
    if (!heightmapPixels || !heightmapWidth || !heightmapHeight) return
    const N = 200
    const pts = []
    let minV = Infinity, maxV = -Infinity
    for (let i = 0; i < N; i++) {
      const t  = i / (N - 1)
      const u  = uv0.x + (uv1.x - uv0.x) * t
      const v  = uv0.y + (uv1.y - uv0.y) * t
      const px = u * (heightmapWidth - 1)
      const py = (1 - v) * (heightmapHeight - 1)
      const x0 = Math.floor(px), y0 = Math.floor(py)
      const x1 = Math.min(x0 + 1, heightmapWidth - 1)
      const y1 = Math.min(y0 + 1, heightmapHeight - 1)
      const dx = px - x0, dy = py - y0
      const val = heightmapPixels[y0 * heightmapWidth + x0] * (1 - dx) * (1 - dy)
                + heightmapPixels[y0 * heightmapWidth + x1] * dx       * (1 - dy)
                + heightmapPixels[y1 * heightmapWidth + x0] * (1 - dx) * dy
                + heightmapPixels[y1 * heightmapWidth + x1] * dx       * dy
      pts.push(val)
      if (val < minV) minV = val
      if (val > maxV) maxV = val
    }
    setProfileData({ points: pts, elevMin: minV, elevMax: maxV })
    setProfileAnchors([uv0, uv1])
    setProfileMode(false)
    setProfileClicks([])
  }, [heightmapPixels, heightmapWidth, heightmapHeight])

  const handleProfileClick = useCallback((uv) => {
    setProfileAnchors(null)
    setProfileClicks(prev => {
      const next = [...prev, uv]
      if (next.length === 2) {
        sampleProfile(next[0], next[1])
        return []
      }
      return next
    })
  }, [sampleProfile])

  // ── Hypsometric integral ──────────────────────────────────────────────────
  const hypsometricIntegral = useMemo(() => {
    if (!heightmapPixels?.length) return null
    let sum = 0, min = Infinity, max = -Infinity
    for (let i = 0; i < heightmapPixels.length; i++) {
      const v = heightmapPixels[i]
      if (v < min) min = v
      if (v > max) max = v
      sum += v
    }
    return max > min ? (sum / heightmapPixels.length - min) / (max - min) : 0.5
  }, [heightmapPixels])

  // ── Load external presets on mount ────────────────────────────────────────
  useEffect(() => {
    const loadPresets = async () => {
      try {
        const baseUrl = import.meta.env.BASE_URL || '/'
        const res = await fetch(`${baseUrl}presets/manifest.json`)
        const manifest = await res.json()
        const loaded = {}
        for (const file of manifest) {
          const presRes = await fetch(`${baseUrl}presets/${file}`)
          const presData = await presRes.json()
          const name = file.replace('.json', '')
          loaded[name] = presData
        }
        setExternalPresets(loaded)
      } catch (e) {
        console.warn('[App] Could not load external presets:', e)
      }
    }
    loadPresets()
  }, [])

  // ── Export triggers ───────────────────────────────────────────────────────
  const [svgTrigger, setSvgTrigger] = useState(0)

  // ── Saying what happened ──────────────────────────────────────────────────
  // A counter in the key so two identical messages in a row still read as two
  // events: exporting the same file twice should restart the toast, not look
  // like nothing happened the second time.
  const [toast, setToast] = useState(null)
  const toastSeq = useRef(0)
  const notify = useCallback((msg, opts = {}) => {
    setToast({ msg, seq: ++toastSeq.current, ...opts })
  }, [])
  const dismissToast = useCallback(() => setToast(null), [])

  /**
   * "Nothing here came from the user" — hold the next session write.
   *
   * The opening preset is applied by the panel as ordinary state changes, which
   * the save effect cannot tell from somebody moving a slider. Without this a
   * visitor who touched nothing would have a session written for them, and the
   * *next* visit would announce a restore that returned only what the app would
   * have opened with anyway — the exact fault v1.0.1 fixed.
   */
  const markPristine = useCallback(() => {
    skipNextSave.current = true
    savePendingSince.current = 0
  }, [])

  /**
   * One export job at a time, whichever writer is running.
   *
   * SVG and STL are the two exports slow enough to need saying something about —
   * both are CPU work over hundreds of thousands of primitives — so they share a
   * single overlay, a single progress channel and a single cancel, rather than
   * each growing its own copy. `kind` is only used to word the overlay.
   */
  const [exportJob, setExportJob] = useState(null)   // { kind, pct, label }

  /**
   * Cancellation travels by ref, not state: the exporter asks on every yield, and
   * a state read would hand it whatever value was captured when the run started.
   */
  const exportCancelRef = useRef(() => false)

  // Held in state only so the overlay's button has something to call.
  const [exportCancel, setExportCancel] = useState(null)

  // Both writers throttle to whole percentage points before calling this (see
  // makeReporter in utils/pacing), so each call here is a bar position that
  // actually changed.
  const handleExportProgress = useCallback((frac, label) => {
    setExportJob((j) => (j ? { ...j, pct: Math.round(frac * 100), label } : j))
  }, [])

  /**
   * Whether the slot is taken, held in a ref because the answer is needed *now*.
   *
   * Reading it from state would not do: a state updater runs during the next
   * render, not at the moment it is called, so two triggers in the same tick
   * would both see an empty slot and both start.
   */
  const exportBusyRef = useRef(false)
  // Which writer holds it, for the same reason: the message at the end names a
  // file, and by then the job state has already been cleared.
  const exportKindRef = useRef(null)

  const finishExport = useCallback((status = 'done') => {
    const [ext, name] = EXPORT_KINDS[exportKindRef.current] ?? ['file', 'Export']
    exportBusyRef.current = false
    exportKindRef.current = null
    setExportJob(null)
    setExportCancel(null)
    exportCancelRef.current = () => false
    // The app names every export after the source raster, which is worth saying
    // once it has: the overlay used to just vanish and leave the download shelf
    // as the only evidence anything happened.
    if (status === 'cancelled')   notify(`${name} export cancelled.`)
    else if (status === 'failed')  notify(`${name} export failed — see the console.`)
    else if (status === 'empty')  notify(`Nothing to write — the scene has no geometry for ${name}.`)
    else                          notify(`Wrote ${exportBaseName}${ext.startsWith('-') ? '' : '.'}${ext}`)
  }, [notify, exportBaseName])

  /**
   * Claim the single export slot, or refuse.
   *
   * The re-entry guard matters now in a way it did not before: a synchronous
   * export could not overlap itself, and one that yields can.
   */
  const beginExport = useCallback((kind) => {
    if (exportBusyRef.current) return false
    exportBusyRef.current = true
    exportKindRef.current = kind
    let cancelled = false
    exportCancelRef.current = () => cancelled
    setExportCancel(() => () => { cancelled = true })
    setExportJob({ kind, pct: 0, label: 'Preparing…' })
    return true
  }, [])

  const beginSvgExport = useCallback(() => {
    if (beginExport('svg')) setSvgTrigger(n => n + 1)
  }, [beginExport])
  const [pngTrigger,        setPngTrigger]         = useState(0)
  const [pngAlphaTrigger,   setPngAlphaTrigger]    = useState(0)
  /**
   * The 4K capture is a synchronous render, a pixel read and a trim — long
   * enough to feel like nothing happened, which is how a user ends up clicking
   * PNG three times and queueing three captures. It now claims the same export
   * slot as SVG and STL and puts up the same overlay; there is no Cancel because
   * there is nothing to interrupt.
   */
  const beginPngExport = useCallback((alpha) => {
    if (!beginExport(alpha ? 'pngAlpha' : 'png')) return
    if (alpha) setPngAlphaTrigger(n => n + 1)
    else       setPngTrigger(n => n + 1)
  }, [beginExport])
  const [webmActive, setWebmActive] = useState(false)
  const [cameraPreset, setCameraPreset] = useState(null)

  // ── What the viewport says it can do ──────────────────────────────────────
  // `grab` is the resting state, `grabbing` while a drag is live, `crosshair`
  // while the app is waiting to be told where to cut a section. Before this the
  // canvas was the default arrow in every one of those states, which is the same
  // cursor a picture has.
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!dragging) return
    const end = () => setDragging(false)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging])

  /**
   * Whether the control panel is showing — App's business now, because it
   * decides how wide the picture is.
   *
   * The canvas used to span the whole window with the panel floating over its
   * right-hand 272 px, so the scene was centred in 1440 while only 1168 of it
   * could be seen: every composition sat off-centre and ran under the panel.
   * Insetting the canvas instead of offsetting the camera keeps the projection
   * untouched, which is what lets every exporter keep reading its dimensions
   * from `gl.domElement` and get the framing the user actually composed.
   */
  const [panelOpen, setPanelOpen] = useState(true)
  const viewInset = panelOpen ? PANEL_W : 0

  const [showHint, setShowHint] = useState(() => {
    try { return !localStorage.getItem(HINT_KEY) } catch { return true }
  })
  const dismissHint = useCallback(() => {
    setShowHint(false)
    try { localStorage.setItem(HINT_KEY, '1') } catch { /* it just shows again */ }
  }, [])

  /**
   * Every setting back to its default — and a way back from that.
   *
   * The whole previous state is captured before anything moves, so Undo is a
   * restore rather than a re-derivation. Cheap: these are five small plain
   * objects, and the alternative was a control that threw away an hour of work
   * on one click with nothing offered afterwards.
   */
  const handleResetAll = useCallback(() => {
    const before = { terrain, style, points, view, gradientStops, bgGradientStops }
    setTerrain({ ...TERRAIN_DEF, resolution: autoResolution(heightmapWidth, heightmapHeight) })
    setStyle(STYLE_DEF)
    setPoints(POINTS_DEF)
    setView({ ...VIEW_DEF, zoom: baseZoom })
    setGradientStops(GRADIENT_PRESETS['Jet'])
    setBgGradientStops([{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#cccccc' }])
    // Clearing alone did nothing: the six setState calls above re-run the save
    // effect, which wrote the defaults straight back 400 ms later. The skip is
    // what makes the clear real.
    clearSession()
    skipNextSave.current = true
    savePendingSince.current = 0
    setSessionRestored(false)
    notify('All settings reset.', {
      action: 'Undo',
      onAction: () => {
        setTerrain(before.terrain)
        setStyle(before.style)
        setPoints(before.points)
        setView(before.view)
        setGradientStops(before.gradientStops)
        setBgGradientStops(before.bgGradientStops)
      },
    })
  }, [terrain, style, points, view, gradientStops, bgGradientStops,
      heightmapWidth, heightmapHeight, baseZoom, notify])

  const orbitRef = useRef()


  // ── Preset helpers ────────────────────────────────────────────────────────
  const savePreset = useCallback(() => {
    let heightmapDataURL = null
    const isDefaultHeightmap = heightmapFilename === 'Heightmap.png'
    if (heightmapPixels && heightmapWidth && heightmapHeight && !isDefaultHeightmap) {
      const c = document.createElement('canvas')
      c.width = heightmapWidth; c.height = heightmapHeight
      const ctx = c.getContext('2d')
      const img = ctx.createImageData(heightmapWidth, heightmapHeight)
      for (let i = 0; i < heightmapPixels.length; i++) {
        const v = Math.round(heightmapPixels[i] * 255)
        img.data[i*4]=v; img.data[i*4+1]=v; img.data[i*4+2]=v; img.data[i*4+3]=255
      }
      ctx.putImageData(img, 0, 0)
      heightmapDataURL = c.toDataURL('image/png')
    }
    const payload = { terrain, style, points, view, gradientStops, bgGradientStops }
    // Vector layer *style* travels with a preset; the coordinates do not. A
    // preset is a look, not a data set — and matching on `bucket` rather than on
    // layer id is what lets last week's palette land on today's fresh fetch of
    // the same valley.
    if (vectorLayers.length) {
      // `hidden` is stripped along with the identity fields: it holds feature
      // *indices*, which mean nothing against a different fetch of the same
      // area. Re-applying them would hide five arbitrary peaks rather than the
      // five that were chosen. A preset is a look; a selection is data.
      //
      // `iconCustom` goes too, and it is the same rule one level down: it holds
      // an uploaded file's flattened geometry, whose `polylines` are typed
      // arrays. `JSON.stringify` writes those as `{"0":…,"1":…}` objects, which
      // come back with no `length` — so every loop over them runs zero times and
      // the layer draws neither its icon nor its dots, having been told it has
      // an icon. Rather than teach the format to rehydrate a glyph, the preset
      // simply does not carry one: `icon` falls back with it.
      payload.vectorStyles = vectorLayers.map(
        ({ id: _id, sourceId: _s, count: _c, hidden: _h, iconCustom: _ic, ...rest }) =>
          (rest.icon === 'custom' ? { ...rest, icon: null } : rest))
      // Says that `vectorStyles` is in *stack* order, top of the list first.
      // Presets written before the stack existed hold the same array in paint
      // order, and there is no way to tell the two apart by looking — so the
      // flag is what `applyVectorStyles` waits for before reordering anything.
      payload.vectorStackOrder = true
    }
    if (heightmapDataURL) payload.heightmapDataURL = heightmapDataURL
    const data = JSON.stringify(payload, null, 2) + '\n'
    /*
     * A Blob URL, not a data: URI.
     *
     * `heightmapDataURL` is already a base64 PNG of the whole raster, and the
     * previous line ran `encodeURIComponent` over the JSON holding it — percent-
     * encoding a payload that was expanded by a third by base64 already, as one
     * JS string, with the browser then parsing that string as a URL. On a
     * carry-the-heightmap preset from a large raster that is a real allocation
     * spike for nothing, and data: URI length limits vary between browsers.
     *
     * A Blob is handed to the download as bytes. Same three lines, and it is
     * what svgExport's own `download()` has always done.
     */
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'),
      { href: url, download: 'heightmap_preset.json' })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [terrain, style, points, view, gradientStops, bgGradientStops, vectorLayers,
      heightmapPixels, heightmapWidth, heightmapHeight, heightmapFilename])

  const loadPresetFromFile = useCallback(() => {
    const input = Object.assign(document.createElement('input'), { type:'file', accept:'.json' })
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return
      try {
        const d = JSON.parse(await file.text())
        if (d.terrain)         setTerrain(prev => ({ ...prev, ...d.terrain }))
        if (d.style)           setStyle(prev   => ({ ...prev, ...d.style }))
        if (d.points)          setPoints(prev  => ({ ...prev, ...d.points }))
        if (d.view)            setView(prev    => ({ ...prev, ...d.view }))
        if (d.gradientStops)   setGradientStops(d.gradientStops)
        if (d.bgGradientStops) setBgGradientStops(d.bgGradientStops)
        applyVectorStyles(d)
        if (d.heightmapDataURL) load(d.heightmapDataURL)
      } catch {
        // Everything else that fails to load says so in the banner at the foot
        // of the screen; a system dialog on top of a dark tool broke the frame
        // and said nothing about what to check.
        showError('That file isn’t an erzberg preset. Presets are the JSON written by Preset ⬇ in the Export section.')
      }
    }
    input.click()
  }, [load, applyVectorStyles, showError])

  // ── Keyboard bridge for Controls.jsx ───
  const getParams = useCallback(
    () => ({ ...terrain, ...style, ...points, ...view }),
    [terrain, style, points, view]
  )
  /**
   * Write parameters back into whichever group owns them.
   *
   * Routed by ownership, from the registry in src/params.js — not, as before, by
   * a `startsWith` filter over sixteen name prefixes plus forty explicit
   * branches. That heuristic misrouted nothing, but 73 of the 262 style keys
   * matched no prefix and no branch and were simply undeliverable through here:
   * angleLines, angleCross, every hillshade*, every label*Contours, the seeds,
   * and all six surface-overlay switches. Nothing writes those today, which is
   * the only reason it never showed.
   *
   * One updater per group, so a call carrying keys from three groups is three
   * state updates rather than one per key.
   */
  const setParams = useCallback((vals) => {
    const patches = {}
    for (const [k, value] of Object.entries(vals)) {
      const group = GROUP_OF.get(k)
      if (!group) { console.warn('[setParams] no group owns', k); continue }
      ;(patches[group] ??= {})[k] = value
    }
    const setters = { terrain: setTerrain, style: setStyle, points: setPoints, view: setView }
    for (const [group, patch] of Object.entries(patches)) {
      setters[group]((prev) => ({ ...prev, ...patch }))
    }
  }, [setTerrain, setStyle, setView, setPoints])

  // ── Auto-zoom to fit terrain on load ─────────────────────────────────────
  const autoZoom = useCallback(({ width, height }) => {
    const zoom = Math.max(0.05, Math.min(4, 500 / Math.max(width, height)))
    setBaseZoom(zoom)
    setView(prev => ({ ...prev, zoom }))
  }, [])

  // ── Edit Mode ─────────────────────────────────────────────────────────────
  // The draft lives here rather than in the store so Cancel is free: nothing
  // downstream sees a selection until Apply commits it.
  const [editMode,  setEditMode]  = useState(false)
  const [editDraft, setEditDraft] = useState(null)
  const [editTool,  setEditTool]  = useState('crop')
  const [aspectKey, setAspectKey] = useState('free')
  // The editor publishes its key handling here: Escape and Enter mean "cancel
  // the half-drawn shape" / "close it" while one is in progress, and only
  // otherwise mean "leave Edit Mode" / "apply".
  const editKeysRef = useRef(null)

  const aspect = useMemo(() => {
    if (aspectKey === '1:1')  return 1
    if (aspectKey === '4:3')  return 4 / 3
    if (aspectKey === '16:9') return 16 / 9
    if (aspectKey === 'src')  return srcHeight ? srcWidth / srcHeight : null
    return null
  }, [aspectKey, srcWidth, srcHeight])

  const fitToRaster = useCallback((width, height) => {
    autoZoom({ width, height })
    setTerrain(prev => ({ ...prev, resolution: autoResolution(width, height) }))
  }, [autoZoom])

  const openEditor = useCallback(() => {
    if (!srcPixels) return
    // A streamed soundscape would redraw the picture under the cursor 30×/s.
    soundscape.pause()
    setEditDraft(edit ?? { rect: { x: 0, y: 0, w: srcWidth, h: srcHeight }, shape: null, feather: 0 })
    setEditMode(true)
  }, [srcPixels, srcWidth, srcHeight, edit, soundscape])

  const applyEditDraft = useCallback(() => {
    const b = effectiveBounds(editDraft, srcWidth, srcHeight)
    if (!b) return   // an empty selection would leave nothing on screen
    // A full-extent rect with no shape and no feather is not a clip; storing it
    // as one would copy the whole raster on every soundscape frame for nothing.
    const isNoop = !editDraft?.shape && !(editDraft?.feather > 0)
      && b.x === 0 && b.y === 0 && b.w === srcWidth && b.h === srcHeight
    setEdit(isNoop ? null : editDraft)
    setEditMode(false)
    // Refit exactly as a fresh load does: a crop is a different picture, and
    // keeping the old zoom shows a quarter-sized terrain a quarter of the size.
    fitToRaster(b.w, b.h)
  }, [editDraft, srcWidth, srcHeight, setEdit, fitToRaster])

  const clearEdit = useCallback(() => {
    setEdit(null)
    setEditDraft({ rect: { x: 0, y: 0, w: srcWidth, h: srcHeight }, shape: null, feather: 0 })
    if (srcWidth && srcHeight) fitToRaster(srcWidth, srcHeight)
  }, [setEdit, srcWidth, srcHeight, fitToRaster])

  // ── Soundscapes ───────────────────────────────────────────────────────────
  // A streamed spectrogram window is small (512×512) and must render at
  // resolution 1 — decimating it further would throw away frequency rows. The
  // whole-track projections reach further: a 1024² disc is twice the cell count
  // of the widest frozen spectrogram, and at resolution 1 the line modes grind
  // through it slowly enough to look like a hang.
  //
  // Cell count, not the longest side, is what costs: 1024×512 and 768×768 are
  // the same amount of work despite looking very different. The budget is set
  // just above the frozen spectrogram, which has always rendered undecimated, so
  // only the genuinely larger projections step up.
  const fitSoundscape = useCallback(({ width, height }) => {
    autoZoom({ width, height })
    setBaseElevScale(1)
    setTerrain(prev => ({
      ...prev,
      resolution: Math.max(1, Math.ceil(Math.sqrt((width * height) / 600000))),
      elevScale: 0,
    }))
    dropVectors()
  }, [autoZoom, dropVectors])

  // Loading a raster takes the heightmap slot, so stop any audio still driving it.
  const loadPngAndFit = useCallback(() => {
    soundscape.release()
    loadFromPicker(({ width, height, dataWidth, dataHeight }) => {
      autoZoom({ width: dataWidth, height: dataHeight })
      setBaseElevScale(1)
      setTerrain(prev => ({ ...prev, resolution: autoResolution(width, height), elevScale: 0 }))
      dropVectors()
    })
  }, [soundscape, loadFromPicker, autoZoom, dropVectors])

  const loadGeoTiffAndFit = useCallback(() => {
    soundscape.release()
    loadGeoTiffFromPicker(({ width, height, dataWidth, dataHeight, suggestedElevScale }) => {
      autoZoom({ width: dataWidth, height: dataHeight })
      setBaseElevScale(suggestedElevScale ?? 1)
      setTerrain(prev => ({ ...prev, resolution: autoResolution(width, height), elevScale: 0 }))
    })
  }, [soundscape, loadGeoTiffFromPicker, autoZoom])

  // ── Export keyboard shortcuts ─────────────────────────────────────────────
  /**
   * One callback for both ways a recording ends.
   *
   * The duration timer lives inside the recorder and calls `stopWebM` with
   * whatever callback it was handed at the start — so wrapping the notification
   * around the *manual* stop meant the ordinary case, letting it run out, wrote
   * a file and said nothing at all.
   */
  const handleWebmState = useCallback((active) => {
    setWebmActive(active)
    if (!active) notify(`Wrote ${exportBaseName}.webm`)
  }, [exportBaseName, notify])

  const handleWebmToggle = useCallback(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return
    if (isRecording()) {
      stopWebM(handleWebmState)
    } else if (startWebM(canvas, webmDuration, handleWebmState, exportBaseName)) {
      notify(`Recording — ${webmDuration}s, or press 5 to stop.`)
    } else {
      notify('Could not start recording — this browser refused the canvas stream.')
    }
  }, [webmDuration, exportBaseName, notify, handleWebmState])

  // ── Canvas pixel ratio ────────────────────────────────────────────────────
  // The canvas fills the window, so its CSS size is the window size. Supersampling
  // multiplies the device ratio, capped to whatever buffer DprGuard has found this
  // context will actually hand back — asking for more than that renders off-centre.
  const canvasDpr = useMemo(() => {
    const desired = Math.min(window.devicePixelRatio || 1, 2) * (view.renderScale ?? 1)
    const area = (winSize.w - viewInset) * winSize.h
    if (!Number.isFinite(maxBufferPx) || !area) return desired
    /*
     * Quantised, not just clamped.
     *
     * √(budget / area) is an irrational number, and a fractional ratio times a
     * CSS width leaves three and the GL viewport rounding the same buffer to
     * different integers — a one-pixel disagreement that means the scene is
     * drawn through a viewport its framebuffer does not cover. Snapping the
     * clamped ratio down to quarter steps lands the buffer on whole pixels for
     * any sane canvas size, and costs a few percent of linear resolution in the
     * rare case where the clamp engages at all.
     */
    const fitted = Math.sqrt(maxBufferPx / area)
    return Math.min(desired, Math.max(0.5, Math.floor(fitted * 4) / 4))
  }, [view.renderScale, maxBufferPx, winSize, viewInset])

  // ── Merged params ─────────────────────────────────────────────────────────
  // elevScale: intrinsic GeoTIFF scale + user offset. view.zoom is the raw effective zoom.
  //
  // A fresh object every render, deliberately: it is the app's param bus, and
  // every consumer reads fields off it rather than holding it. The cost is that
  // useCallbacks listing `p` (handleStl below) cannot actually memoize — they
  // degrade to plain functions, which for an export handler is harmless. Wrapping
  // this in useMemo would mean memoizing the whole state merge to stabilise an
  // identity nothing compares, so the lint rule is answered rather than obeyed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const p = { ...terrain, ...style, ...points, ...view, gradientStops,
    elevScale: baseElevScale + terrain.elevScale,
    vectorLayers, vectorIdentify, geoTiffBbox, geoTiffCRS,
    imageWidth: heightmapWidth, imageHeight: heightmapHeight,
    profileMode,
  }

  // Surface normals and UVs exist only for the terrain shader. STL export
  // computes its own facet normals and SVG only needs positions/indices, so
  // when no fill layer is on they are pure waste — ~8 ms of every rebuild.
  //
  // Read off the merged `p`, not the individual state blocks: the fill flags are
  // split across style and view, and sourcing them by hand silently yields
  // undefined for any that move between the two.
  p.needsSurfaceShading = needsSurfaceShading(p)

  // Keep the click handler in a ref so SurfaceMesh can read it without it
  // entering the postMessage-serialized p object sent to the Web Worker.
  const profileClickRef = useRef(handleProfileClick)
  profileClickRef.current = handleProfileClick

  // ── Terrain geometry (lifted so Sidebar can read stats) ───────────────────
  const { terrain: terrainData, lineGeo: workerGeo, surfaceGeo, isComputing, resultCount,
          error: geometryError } = useTerrainGeometry(p)

  // A failed rebuild leaves the previous picture on screen, which is exactly what
  // a successful-but-subtle one looks like. Eight other failure paths already say
  // something here; this was the one that went to the console alone.
  useEffect(() => {
    if (geometryError) notify(geometryError.msg)
  }, [geometryError, notify])

  // Point layers that asked for an icon get one here, in place of their dots.
  // Downstream of the worker on purpose: flattening an SVG needs the DOM, and
  // building it on this side is what makes size, lift and orientation a frame
  // rather than a rebuild — and what lets the icons follow the camera at all.
  const { lineGeo: iconGeo, overflowed: iconOverflow } =
    useVectorIcons(workerGeo, vectorLayers, view.tilt, view.rotation)

  // …and their names and heights go on top of that. Appended rather than
  // substituted, and anchored on the worker's own dots rather than on whatever
  // the icon pass left behind, which is the only place one segment per feature
  // still exists.
  const { lineGeo: vectorLabelled, overflowed: labelOverflow } =
    useVectorLabels(iconGeo, workerGeo, vectorLayers, vectorSources, view.tilt, view.rotation)

  // Contour labels are lettered here for the same reason the vector ones are:
  // the worker reserved the gaps and knows where the numbers go, but it has no
  // fonts and no idea what the raster's brightness means in metres.
  const lineGeo = useContourLabels(vectorLabelled, style, geoTiffElevMin, geoTiffElevMax,
                                   terrain.blackPoint, terrain.whitePoint)

  // The overlay means "nothing has come back for a while", not "a build is in
  // flight". Keying it on isComputing alone breaks under a continuous stream:
  // rebuild requests queue back to back, isComputing never falls, and the
  // overlay latches on permanently even though frames are arriving 30× a second.
  // Including resultCount restarts the timer on every delivered frame, so the
  // overlay appears only when the terrain genuinely stops updating.
  const [showComputingOverlay, setShowComputingOverlay] = useState(false)
  useEffect(() => {
    if (!isComputing) { setShowComputingOverlay(false); return }
    setShowComputingOverlay(false)
    const t = setTimeout(() => setShowComputingOverlay(true), 1000)
    return () => clearTimeout(t)
  }, [isComputing, resultCount])

  // ── Vector layer coverage ─────────────────────────────────────────────────
  // Whether the loaded features and the loaded raster actually describe the same
  // place. GPX and GeoJSON are WGS84 by definition and OSM was queried for this
  // very extent, so a mismatch is always the GeoTIFF's projection or its extent —
  // and both fail the same silent way, by dropping every point as out-of-bounds.
  // Cheap enough to redo whenever either changes: one forward projection per
  // vertex, and only on load, not per frame.
  const vectorCoverage = useMemo(() => {
    const rings = vectorSources.flatMap(sourceRings)
    return featureCoverage(rings, geoTiffBbox, geoTiffCRS, heightmapWidth, heightmapHeight)
  }, [vectorSources, geoTiffBbox, geoTiffCRS, heightmapWidth, heightmapHeight])

  // ── Export handlers ───────────────────────────────────────────────────────
  const handleStl = useCallback(() => {
    if (!beginExport('stl')) return
    // A tick before the work starts, so the overlay is on screen rather than
    // queued behind it — the same reason the SVG trigger defers.
    setTimeout(async () => {
      let status = 'done'
      try {
        // On demand, for the same reason as the SVG exporter above it.
        const { exportSTL } = await import('./utils/stlExport')
        status = await exportSTL({
          surfaceGeo, terrain: terrainData, vectorSources, geoTiffBbox, geoTiffCRS, p,
          baseName: exportBaseName,
          onProgress: handleExportProgress,
          shouldCancel: exportCancelRef.current,
        })
      } finally {
        // finally, not after: a throw here would otherwise leave the overlay up
        // with no way to dismiss it.
        finishExport(status)
      }
    }, 0)
  }, [surfaceGeo, terrainData, vectorSources, geoTiffBbox, geoTiffCRS, p, exportBaseName,
      beginExport, finishExport, handleExportProgress])

  const handleHeightmapExport = useCallback(() => {
    const written = exportHeightmap(terrainData, exportBaseName)
    if (written) notify(`Wrote ${written}`)
    else notify('Nothing to write — no terrain is loaded.')
  }, [terrainData, exportBaseName, notify])

  // ── Camera presets ────────────────────────────────────────────────────────
  const handleCameraPreset = useCallback((name) => {
    const presets = {
      top:   { tilt: 0,  rotation: 0 },
      front: { tilt: 90, rotation: 0 },
      iso:   { tilt: 45, rotation: -45 },
      reset: { tilt: 50, rotation: 0, zoom: 0.75, fov: 60, panX: 0, panY: 0, panZ: 0 },
    }
    const p = presets[name] || presets.reset
    setView(prev => ({ ...prev, ...p }))
    setCameraPreset({ name, ts: Date.now() })
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      // Bare keys only. Every shortcut below is a single unmodified key, so a
      // chord belongs to the browser or the OS: on macOS Cmd+1 switches tab and
      // would otherwise also write an SVG, and Cmd+5 would start a recording the
      // user cannot see beginning.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // Edit Mode owns the keyboard while it is open — the export shortcuts
      // would otherwise fire on a terrain the user cannot currently see.
      if (editMode) {
        if (e.code === 'Escape' && !editKeysRef.current?.escape?.()) setEditMode(false)
        if (e.code === 'Enter') {
          // Mid-shape, Enter closes the ring; otherwise it applies the clip.
          if (editKeysRef.current?.drawing?.()) editKeysRef.current.closeShape()
          else applyEditDraft()
        }
        return
      }
      if (e.code === 'Escape') { setProfileMode(false); setProfileClicks([]) }
      if (e.code === 'KeyE')   openEditor()
      if (e.code === 'Digit1') beginSvgExport()
      if (e.code === 'Digit2') beginPngExport(false)
      if (e.code === 'Digit3') beginPngExport(true)
      if (e.code === 'Digit4') handleStl()
      if (e.code === 'Digit5') handleWebmToggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // beginSvgExport belongs here for the same reason handleStl does: both claim
    // the single export slot, and a stale copy would not see it taken.
  }, [handleWebmToggle, handleStl, editMode, applyEditDraft, openEditor, beginSvgExport, beginPngExport])

  // ── Load default heightmap on mount ───────────────────────────────────────
  // Mount-only by intent, and the empty dep array is the whole mechanism: this is
  // the sample plate the app opens with, so it must load exactly once. `load` is a
  // useCallback whose identity tracks the store setters, and listing it would
  // re-fetch the default over whatever the user had opened in the meantime.
  useEffect(() => {
    const baseUrl = import.meta.env.BASE_URL || '/'
    load(`${baseUrl}Heightmap.png`)
      .then((r) => {
        // load() resolves null when it failed (the error banner is already shown).
        if (!r) { console.warn('[App] Default heightmap not found — use Load Heightmap.'); return }
        setTerrain(prev => ({ ...prev, resolution: autoResolution(r.width, r.height) }))
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const bgColor   = style.bgColor || '#ffffff'
  const bgCss     = style.bgGradient && bgGradientStops?.length > 1
    ? `linear-gradient(to bottom, ${bgGradientStops.map(s => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ')})`
    : bgColor
  const noHmap    = !heightmapPixels

  // Picking a section is a click, not a drag, and it wants the cursor that says so.
  const canvasCursor = profileMode ? 'crosshair' : (dragging ? 'grabbing' : 'grab')

  return (
    <div className="w-full h-full" style={{ background: bgCss, position: 'relative' }}>

      {/* ── Canvas ──────────────────────────────────────────────────────────
          Inset to the panel rather than sliding under it. Snapped rather than
          transitioned: animating the width would reallocate the drawing buffer
          every frame of the 220 ms slide, and the strip it briefly uncovers is
          the same background the scene sits on. */}
      <div style={{ position:'absolute', top:0, left:0, bottom:0, right: viewInset }}>
      <Canvas
        frameloop="demand"
        dpr={canvasDpr}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
        camera={{ position: [0, 400, 500], fov: 60, near: 5, far: 50000 }}
        style={{ width:'100%', height:'100%', cursor: canvasCursor }}
        onPointerDown={() => { setDragging(true); dismissHint() }}
        // The picture is the app's output; naming it is the difference between
        // "canvas" and knowing what is on screen without seeing it.
        aria-label={`3D view of ${heightmapFilename || 'the terrain'} — drag to orbit, scroll to zoom`}
        role="application"
      >
        <BgSync color={bgColor} gradient={style.bgGradient} />
        <DprGuard onClamp={handleBufferClamp} />
        <Scene
          terrain={terrainData}
          lineGeo={lineGeo}
          surfaceGeo={surfaceGeo}
          p={p}
          profileClickRef={profileClickRef}
          profileAnchors={profileAnchors ?? (profileClicks.length ? profileClicks : null)}
          getParams={getParams}
          setParams={setParams}
          orbitRef={orbitRef}
          svgTrigger={svgTrigger}
          onSvgDone={finishExport}
          onSvgProgress={handleExportProgress}
          svgCancelRef={exportCancelRef}
          pngTrigger={pngTrigger}
          pngAlphaTrigger={pngAlphaTrigger}
          onPngDone={finishExport}
          bgGradientStops={bgGradientStops}
          cameraPreset={cameraPreset}
          webmRecording={webmActive}
          exportBaseName={exportBaseName}
          audioLive={flockAudio.liveRef}
        />
      </Canvas>
      </div>

      {/* ── Edit Mode ────────────────────────────────────────────────────── */}
      {editMode && (
        <HeightmapEditor
          srcPixels={srcPixels} srcMask={srcMask}
          srcWidth={srcWidth}   srcHeight={srcHeight}
          edit={editDraft}      onChange={setEditDraft}
          tool={editTool}       aspect={aspect}
          rightInset={PANEL_W}  keysRef={editKeysRef}
        />
      )}

      {editMode && (
        <EditPanel
          filename={heightmapFilename}
          srcWidth={srcWidth} srcHeight={srcHeight}
          edit={editDraft}    onChange={setEditDraft}
          tool={editTool}     setTool={setEditTool}
          aspect={aspectKey}  setAspect={setAspectKey}
          onApply={applyEditDraft}
          onCancel={() => setEditMode(false)}
          onReset={() => setEditDraft({ rect: { x: 0, y: 0, w: srcWidth, h: srcHeight }, shape: null, feather: 0 })}
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      {/* Hidden rather than unmounted while editing: every section's open/closed
          state and the erosion settings live in Sidebar's own state, and
          unmounting silently reset all of them on the way back. `contents` keeps
          the wrapper out of the layout — the panel positions itself. */}
      <div style={{ display: editMode ? 'none' : 'contents' }}>
      <Sidebar
        open={panelOpen} onOpenChange={setPanelOpen}
        onPristine={markPristine}
        terrain={terrain}   setTerrain={setTerrain}
        style={style}       setStyle={setStyle}
        points={points}     setPoints={setPoints}
        view={view}         setView={setView}
        gradientStops={gradientStops}         setGradientStops={setGradientStops}
        bgGradientStops={bgGradientStops}     setBgGradientStops={setBgGradientStops}
        heightmapPixels={heightmapPixels}
        heightmapFilename={heightmapFilename}
        textureImage={textureImage}
        setTextureImage={setTextureImage}
        loadFromPicker={loadPngAndFit}
        loadGeoTiffFromPicker={loadGeoTiffAndFit}
        soundscape={soundscape}
        flockAudio={flockAudio}
        onSoundscapeFit={fitSoundscape}
        geoTiffElevMin={geoTiffElevMin}
        geoTiffElevMax={geoTiffElevMax}
        geoTiffCRS={geoTiffCRS}
        geoTiffCRSName={geoTiffCRSName}
        geoTiffBbox={geoTiffBbox}
        loadGpxFromPicker={loadGpxFromPicker}
        loadGeoJsonFromPicker={loadGeoJsonFromPicker}
        vectorSources={vectorSources}
        vectorLayers={vectorLayers}
        vectorCoverage={vectorCoverage}
        vectorError={vectorError}
        onPatchVectorLayer={patchVectorLayer}
        onReorderVectorLayer={reorderVectorLayer}
        onRemoveVectorLayer={removeVectorLayer}
        onRemoveVectorSource={dropVectorSource}
        onAdoptVectorSource={adoptVectorSource}
        onVectorError={setVectorError}
        vectorIdentify={vectorIdentify}
        onVectorIdentify={setVectorIdentify}
        onCustomIcon={loadIconSvg}
        iconOverflow={iconOverflow}
        labelOverflow={labelOverflow}
        onCameraPreset={handleCameraPreset}
        onSvg={beginSvgExport}
        onPng={() => beginPngExport(false)}
        onPngAlpha={() => beginPngExport(true)}
        onStl={handleStl}
        onHeightmap={handleHeightmapExport}
        onWebmToggle={handleWebmToggle}
        webmActive={webmActive}
        webmDuration={webmDuration}  setWebmDuration={setWebmDuration}
        onSavePreset={savePreset}
        onLoadPreset={loadPresetFromFile}
        externalPresets={externalPresets}
        onReset={handleResetAll}
        sessionRestored={sessionRestored}
        baseZoom={baseZoom}
        lineGeo={lineGeo}
        surfaceGeo={surfaceGeo}
        terrainData={terrainData}
        hypsometricIntegral={hypsometricIntegral}
        profileMode={profileMode}
        profileClicks={profileClicks}
        onProfileMode={(v) => { setProfileMode(v); setProfileClicks([]) }}
        onEditHeightmap={openEditor}
        editSummary={describeEdit(edit, srcWidth, srcHeight)}
        onClearEdit={clearEdit}
      />
      </div>

      {/* ── Center guides ────────────────────────────────────────────────── */}
      {view.showGuides && <CenterGuides bgColor={bgColor} />}
      {view.showFrame && !webmActive && <FrameOverlay view={view} bgColor={bgColor} rightInset={viewInset} />}
      {!webmActive && <FeatureTooltip layers={vectorLayers} rightInset={viewInset} />}

      {/* ── WebM REC badge ───────────────────────────────────────────────── */}
      {webmActive && (
        <div style={{
          position:'fixed', top:12, left:'50%', transform:'translateX(-50%)',
          background:'rgba(200,0,0,0.85)', color:'#fff',
          borderRadius:20, padding:'4px 14px', fontSize:13, fontWeight:700,
          zIndex:2000, pointerEvents:'none', display:'flex', alignItems:'center', gap:6,
        }}>
          <span style={{ width:8, height:8, borderRadius:'50%', background:'#fff', display:'inline-block' }} />
          REC
        </div>
      )}

      {/* ── Loading overlays ─────────────────────────────────────────────── */}
      {isLoading  && <LoadingOverlay msg={loadingMsg} />}
      {showComputingOverlay && !isLoading && <LoadingOverlay msg="Computing geometry…" />}
      {exportJob && !isLoading && (() => {
        // The PNG capture is one synchronous pass: there is no progress to
        // report and nothing to interrupt, so it gets the plain spinner the
        // overlay renders when neither is passed.
        const isPng = exportJob.kind === 'png' || exportJob.kind === 'pngAlpha'
        const msg = isPng
          ? (exportJob.kind === 'pngAlpha' ? 'Capturing transparent PNG…' : 'Capturing PNG…')
          : (exportJob.label ?? (exportJob.kind === 'stl' ? 'Exporting STL…' : 'Exporting SVG…'))
        return (
          <LoadingOverlay
            msg={msg}
            progress={isPng ? null : exportJob.pct / 100}
            onCancel={isPng ? undefined : (exportCancel ?? undefined)}
          />
        )
      })()}

      {/* ── What the viewport can do ─────────────────────────────────────── */}
      {showHint && !editMode && !webmActive && !noHmap && <ViewportHint onDismiss={dismissHint} />}

      {/* ── What just happened ───────────────────────────────────────────── */}
      <Toast key={toast?.seq} toast={toast} onDismiss={dismissToast} />

      {/* ── Load error banner ────────────────────────────────────────────── */}
      {loadError && (
        <div style={{
          position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          background:'#450a0a', border:'1px solid #991b1b', borderRadius:8,
          padding:'12px 16px', zIndex:5000, display:'flex', alignItems:'center', gap:12,
          maxWidth:480, boxShadow:'0 4px 24px rgba(0,0,0,0.5)',
          fontFamily:'system-ui,sans-serif', fontSize:13, color:'#fca5a5',
        }}>
          <span style={{ fontSize:16 }}>⚠</span>
          <span style={{ flex:1 }}>{loadError}</span>
          <button onClick={clearError} style={{
            background:'none', border:'none', color:'#fca5a5', cursor:'pointer',
            fontSize:16, lineHeight:1, padding:'0 2px', opacity:0.7,
          }}>✕</button>
        </div>
      )}

      {/* ── Elevation profile chart ──────────────────────────────────────── */}
      {profileData && (
        <ElevationProfile
          points={profileData.points}
          elevMin={profileData.elevMin}
          elevMax={profileData.elevMax}
          onClose={() => { setProfileData(null); setProfileAnchors(null) }}
          geoTiffElevMin={geoTiffElevMin}
          geoTiffElevMax={geoTiffElevMax}
          baseName={exportBaseName}
        />
      )}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {noHmap && !isLoading && <EmptyState
        onLoad={() => loadFromPicker(({ width, height }) => {
          autoZoom({ width, height })
          setBaseElevScale(1)
          setTerrain(prev => ({ ...prev, resolution: autoResolution(width, height), elevScale: 0 }))
        })}
        onLoadGeoTiff={() => loadGeoTiffFromPicker(({ width, height, suggestedElevScale }) => {
          autoZoom({ width, height })
          setBaseElevScale(suggestedElevScale ?? 1)
          setTerrain(prev => ({ ...prev, resolution: autoResolution(width, height), elevScale: 0 }))
        })} />}
    </div>
  )
}

// ── UI helper components ──────────────────────────────────────────────────────

function CenterGuides({ bgColor }) {
  const rgb = bgColor.match(/\w\w/g)?.map(h => parseInt(h, 16)) ?? [255,255,255]
  const brightness = (rgb[0]*299 + rgb[1]*587 + rgb[2]*114) / 1000
  const lc = brightness > 128 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.25)'
  return (
    <div style={{ position:'fixed', inset:0, pointerEvents:'none', zIndex:500 }}>
      <div style={{ position:'absolute', left:'50%', top:0, bottom:0, width:1, background:lc }} />
      <div style={{ position:'absolute', top:'50%', left:0, right:0, height:1, background:lc }} />
    </div>
  )
}

function EmptyState({ onLoad, onLoadGeoTiff }) {
  return (
    <div style={{
      position:'fixed', inset:0, zIndex:3000,
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      background:'rgba(255,255,255,0.92)', backdropFilter:'blur(8px)',
    }}>
      <div style={{ fontSize:56, marginBottom:16, lineHeight:1 }}>⛰</div>
      <div style={{ fontSize:22, fontWeight:700, color:'#111', marginBottom:8 }}>No heightmap loaded</div>
      <div style={{ fontSize:14, color:'#666', marginBottom:28, textAlign:'center', maxWidth:340 }}>
        Load a greyscale PNG or a GeoTIFF with real elevation data.<br/>
        <a href="https://tangrams.github.io/heightmapper" target="_blank" rel="noreferrer"
          style={{ color:'#444' }}>Tangrams Heightmapper</a> exports OSM-based heightmaps.
      </div>
      <div style={{ display:'flex', gap:12 }}>
        <button onClick={onLoad} style={{
          background:'#111', color:'#fff', border:'none', borderRadius:10,
          padding:'13px 32px', fontSize:16, cursor:'pointer', fontWeight:700,
        }}>
          PNG / Image
        </button>
        <button onClick={onLoadGeoTiff} style={{
          background:'#2563eb', color:'#fff', border:'none', borderRadius:10,
          padding:'13px 32px', fontSize:16, cursor:'pointer', fontWeight:700,
        }}>
          GeoTIFF
        </button>
      </div>
    </div>
  )
}
