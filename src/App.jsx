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
import { useTerrainGeometry } from './hooks/useTerrainGeometry'
import { useStore } from './store/useStore'
import { trackCoverage } from './utils/geoCoords'
import { needsSurfaceShading } from './utils/geometryBuilders'
import { parseGpx } from './utils/gpxParser'
import { GRADIENT_PRESETS } from './utils/gradientPresets'
import { describeEdit, effectiveBounds } from './utils/heightmapEdit'
import { exportHeightmap } from './utils/heightmapExport'
import { exportSTL } from './utils/stlExport'
import { isRecording, startWebM, stopWebM } from './utils/webmRecorder'

// ── Default param sets ────────────────────────────────────────────────────────
const TERRAIN_DEF = {
  resolution: 2, elevScale: 0, blurRadius: 0,
  gridOffsetX: 0, gridOffsetY: 0, elevMinCut: 0, elevMaxCut: 100,
  blackPoint: 0, whitePoint: 255, jitterAmt: 0,
}

const STYLE_DEF = {
  showFill: false, fillColor: '#ffffff',
  fillHypsometric: false, fillBanded: false, fillHypsoInterval: 10, fillHypsoWeight: 1.5, fillHypsoMode: 'elevation',
  showMesh: false, meshColor: '#888888', bgColor: '#ffffff',
  bgGradient: false,
  depthOcclusion: true,
  occlusionBias: 1.0,
  occlusionColor: '#a80000',
  occlusionOpacity: 0.0,

  // Texture overlay
  showTexture: false, textureScale: 1, textureShiftX: 0, textureShiftY: 0, textureBlendMode: 'normal', textureOpacity: 1,

  // Creative 3D Symmetry
  showMirrorPlusX: true, showMirrorMinusX: false,
  showMirrorPlusY: true, showMirrorMinusY: false,
  showMirrorPlusZ: true, showMirrorMinusZ: false,

  // ── DRAW MODES ───────────────────────────────────────────────────────────
  // Lines (arbitrary bearing — 0° is the old X Lines, 90° the old Y Lines)
  enabledLines: true, spacingLines: 4, shiftLines: 0, angleLines: 0, colorLines: '#000000', weightLines: 1, opacityLines: 1, dashLines: 'solid',
  hypsoLines: false, hypsoModeLines: 'elevation', hypsoBandedLines: false, hypsoIntervalLines: 10,
  // Crosshatch (two perpendicular line sets at angleCross / angleCross+90)
  enabledCross: false, spacingCross: 4, angleCross: 0, colorCross: '#000000', weightCross: 1, opacityCross: 1, dashCross: 'solid',
  hypsoCross: false, hypsoModeCross: 'elevation', hypsoBandedCross: false, hypsoIntervalCross: 10,
  // Pillars
  enabledPillars: false, spacingPillars: 8, colorPillars: '#000000', weightPillars: 1, opacityPillars: 1, dashPillars: 'solid',
  hypsoPillars: false, hypsoModePillars: 'elevation', hypsoBandedPillars: false, hypsoIntervalPillars: 10,
  pillarGap: 0, pillarDepth: 0, pillarStyle: 'line', pillarSize: 0.8, pillarSegments: 8, pillarLidColor: '#ffffff',
  // Contours
  enabledContours: false, intervalContours: 4, colorContours: '#000000', weightContours: 1, opacityContours: 1, dashContours: 'solid',
  hypsoContours: false, hypsoModeContours: 'elevation', hypsoBandedContours: false, hypsoIntervalContours: 10,
  majorIntervalContours: 10, majorWeightContours: 2, majorOffsetContours: 1, closeRingsContours: false, smoothingContours: 0,
  // Hachure
  enabledHachure: false, spacingHachure: 4, lengthHachure: 1, colorHachure: '#000000', weightHachure: 1, opacityHachure: 1, dashHachure: 'solid',
  hypsoHachure: false, hypsoModeHachure: 'elevation', hypsoBandedHachure: false, hypsoIntervalHachure: 10,
  // Flow
  enabledFlow: false, spacingFlow: 10, stepFlow: 1, maxLenFlow: 100, colorFlow: '#000000', weightFlow: 1, opacityFlow: 1, dashFlow: 'solid',
  hypsoFlow: false, hypsoModeFlow: 'elevation', hypsoBandedFlow: false, hypsoIntervalFlow: 10,
  // Stream Network (DAG)
  enabledDag: false, thresholdDag: 2, colorDag: '#000000', weightDag: 1, opacityDag: 1, dashDag: 'solid',
  hypsoDag: false, hypsoModeDag: 'elevation', hypsoBandedDag: false, hypsoIntervalDag: 10,
  // Pencil Shading
  enabledPencil: false, spacingPencil: 4, thresholdPencil: 0.5, colorPencil: '#000000', weightPencil: 1, opacityPencil: 1, dashPencil: 'solid',
  hypsoPencil: false, hypsoModePencil: 'elevation', hypsoBandedPencil: false, hypsoIntervalPencil: 10,

  // Ridge
  enabledRidge: false, spacingRidge: 1, radiusRidge: 1, thresholdRidge: 0.1, colorRidge: '#000000', weightRidge: 1, opacityRidge: 1, dashRidge: 'solid',
  hypsoRidge: false, hypsoModeRidge: 'elevation', hypsoBandedRidge: false, hypsoIntervalRidge: 10,
  // Valley
  enabledValley: false, spacingValley: 2, radiusValley: 2, thresholdValley: 0.5, colorValley: '#000000', weightValley: 1, opacityValley: 1, dashValley: 'solid',
  hypsoValley: false, hypsoModeValley: 'elevation', hypsoBandedValley: false, hypsoIntervalValley: 10,

  // Stipple — seedStipple: same seed, same dot pattern (reproducible prints)
  enabledStipple: false, spacingStipple: 0.5, weightStipple: 4, opacityStipple: 0.85, colorStipple: '#1a1a1a', dashStipple: 'solid',
  stippleDensityMode: 'slope', stippleGamma: 1.2, stippleJitter: 0.8, seedStipple: 42,
  hypsoStipple: false, hypsoModeStipple: 'elevation', hypsoBandedStipple: false, hypsoIntervalStipple: 10,
  // Engraving (illumination cross-hatch)
  enabledEngrave: false, spacingEngrave: 3, angleEngrave: 45, levelsEngrave: 3, sunAzimuthEngrave: 315, gammaEngrave: 1.5,
  colorEngrave: '#000000', weightEngrave: 1, opacityEngrave: 1, dashEngrave: 'solid',
  hypsoEngrave: false, hypsoModeEngrave: 'elevation', hypsoBandedEngrave: false, hypsoIntervalEngrave: 10,
  // Curvature engraving — strokes trace the principal-curvature direction field
  enabledCurv: false, spacingCurv: 4, lengthCurv: 60, thresholdCurv: 0.15, radiusCurv: 1,
  dirModeCurv: 'max', stepCurv: 1,
  colorCurv: '#000000', weightCurv: 1, opacityCurv: 1, dashCurv: 'solid',
  hypsoCurv: false, hypsoModeCurv: 'elevation', hypsoBandedCurv: false, hypsoIntervalCurv: 10,
  // Swiss rock & scree — seedSwiss: same seed, same stroke wobble + scree pattern
  enabledSwiss: false, spacingSwiss: 2, thresholdSwiss: 0.45, lengthSwiss: 1, screeSwiss: 0.5, screeWeightSwiss: 2.5, seedSwiss: 42,
  colorSwiss: '#000000', weightSwiss: 1, opacitySwiss: 1, dashSwiss: 'solid',
  hypsoSwiss: false, hypsoModeSwiss: 'elevation', hypsoBandedSwiss: false, hypsoIntervalSwiss: 10,

  // GPX Track
  colorGpx: '#a80000', weightGpx: 2, opacityGpx: 1, dashGpx: 'solid',
  hypsoGpx: false, hypsoModeGpx: 'elevation', hypsoBandedGpx: false, hypsoIntervalGpx: 10,

  // Hillshade
  showHillshade: false, hillshadeAzimuth: 315, hillshadeAltitude: 45,
  hillshadeIntensity: 1.0, hillshadeOpacity: 0.6, hillshadeExaggeration: 2.0,
  hillshadeHighlightColor: '#ffffff', hillshadeShadowColor: '#000000',
  hillshadeCastShadows: false, hillshadeShadowSteps: 64,
  hillshadeShadowSoftness: 1.5, hillshadeShadowDarkness: 0.85,
  showSun: false,

  // Multi-directional hillshade
  hillshadeMultiDir: false,

  // Slope & Aspect shading
  showSlopeShade: false, slopeShadeOpacity: 0.75, slopeColorLow: '#86efac', slopeColorHigh: '#dc2626',

  // Aspect map overlay
  showAspectMap: false, aspectMapOpacity: 0.8,

  // Ambient occlusion (Sky View Factor)
  showAO: false, aoStrength: 0.7, aoRays: 8,

  // Water fill
  showWaterFill: false, waterLevel: 0.3, waterColor: '#1a78c2', waterOpacity: 0.82,

  // Tanaka contours
  tanakaContours: false, tanakaSunAzimuth: 315, tanakaWeightBright: 2.5, tanakaWeightDark: 0.5,

  // Global Gradient Stops
  gradientStops: GRADIENT_PRESETS['Jet'],
}

const POINTS_DEF = {
  showPoints: false, pointColor: '#2e7bff', pointSize: 4,
  // Grid-cell stride between particles: 1 = one per cell (dense carpet),
  // higher = sparse field. The only density control — the home buffer is
  // otherwise one particle per valid terrain cell.
  particleSpacing: 1,
  // Hologram field (GPU-animated). `animateParticles` toggles the motion.
  animateParticles: true,
  holoGlowColor: '#7df9ff', holoFloat: 1, holoNoiseAmt: 1, holoNoiseScale: 1,
  holoFlowSpeed: 1, holoMaskContrast: 1.5, holoShimmer: 0.4,
}
const VIEW_DEF = {
  tilt: 50, rotation: 0, zoom: 0.75,
  fov: 60, orthographic: false,
  // Supersampling multiplier on top of the device pixel ratio. Dense 1px line
  // fields are undersampled and "boil" during pan/rotate; 2× rendering cuts
  // hard pixel flips by ~97% (measured) at 4× fragment cost. Render-side only.
  renderScale: 1,
  panX: 0, panY: 0,
  autoRotate: false, autoRotateSpeed: 0.2, autoRotateAxis: 'Y', autoRotateDir: 1,
  showGuides: false, showRawTerrain: false,
}


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
function LoadingOverlay({ msg }) {
  return (
    <div data-testid="loading-overlay" style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.6)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:4000,
    }}>
      <div style={{
        display:'flex', flexDirection:'column', alignItems:'center', gap:14,
        background:'#18181b', border:'1px solid #3f3f46', borderRadius:10, padding:'28px 40px',
      }}>
        <div style={{
          width:32, height:32, border:'3px solid rgba(255,255,255,.12)',
          borderTopColor:'#3b82f6', borderRadius:'50%',
          animation:'hm-spin .7s linear infinite',
        }} />
        <span style={{ fontSize:14, color:'#e4e4e7', fontFamily:'system-ui,sans-serif' }}>{msg}</span>
      </div>
      <style>{`@keyframes hm-spin { to { transform:rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const { load, loadFromPicker, loadGeoTiffFromPicker, isLoading, loadingMsg, loadError, clearError } = useHeightmap()
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

  const [gpxPoints, setGpxPoints] = useState([])
  const [gpxError,  setGpxError]  = useState(null)

  const exportBaseName = heightmapFilename
    ? heightmapFilename.replace(/\.[^.]+$/, '')
    : 'heightmap'

  // ── Update document title ─────────────────────────────────────────────────
  useEffect(() => {
    const isDefault = heightmapFilename === 'Heightmap.png'
    document.title = (heightmapFilename && !isDefault) ? `erzberg - ${heightmapFilename}` : 'erzberg'
  }, [heightmapFilename])

  // ── All tweakable state ───────────────────────────────────────────────────
  const [terrain, setTerrain] = useState(TERRAIN_DEF)
  const [style,   setStyle]   = useState(STYLE_DEF)
  const [points,  setPoints]  = useState(POINTS_DEF)
  const [view,    setView]    = useState(VIEW_DEF)
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
  const [gradientStops,   setGradientStops]   = useState(GRADIENT_PRESETS['Jet'])
  const [bgGradientStops, setBgGradientStops] = useState([{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#cccccc' }])
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
    setProfileMode(false)
    setProfileClicks([])
  }, [heightmapPixels, heightmapWidth, heightmapHeight])

  const handleProfileClick = useCallback((uv) => {
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
  const [svgTrigger,        setSvgTrigger]        = useState(0)
  const [isSvgExporting,    setIsSvgExporting]    = useState(false)
  const [pngTrigger,        setPngTrigger]         = useState(0)
  const [pngAlphaTrigger,   setPngAlphaTrigger]    = useState(0)
  const [webmActive, setWebmActive] = useState(false)
  const [cameraPreset, setCameraPreset] = useState(null)

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
    if (heightmapDataURL) payload.heightmapDataURL = heightmapDataURL
    const data = JSON.stringify(payload, null, 2) + '\n'
    Object.assign(document.createElement('a'), {
      download: 'heightmap_preset.json',
      href: 'data:application/json,' + encodeURIComponent(data),
    }).click()
  }, [terrain, style, points, view, gradientStops, bgGradientStops, heightmapPixels, heightmapWidth, heightmapHeight, heightmapFilename])

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
        if (d.heightmapDataURL) load(d.heightmapDataURL)
      } catch { alert('Invalid preset file.') }
    }
    input.click()
  }, [load])

  // ── Keyboard bridge for Controls.jsx ───
  const getParams = useCallback(
    () => ({ ...terrain, ...style, ...points, ...view }),
    [terrain, style, points, view]
  )
  const setParams = useCallback((vals) => {
    const t = {}, s = {}, v = {}
    if (vals.resolution   != null) t.resolution    = vals.resolution
    if (vals.gridOffsetX  != null) t.gridOffsetX   = vals.gridOffsetX
    if (vals.gridOffsetY  != null) t.gridOffsetY   = vals.gridOffsetY
    if (vals.blackPoint   != null) t.blackPoint    = vals.blackPoint
    if (vals.whitePoint   != null) t.whitePoint    = vals.whitePoint
    
    // Line globals
    if (vals.depthOcclusion != null) s.depthOcclusion = vals.depthOcclusion
    if (vals.occlusionBias  != null) s.occlusionBias  = vals.occlusionBias
    if (vals.occlusionColor != null) s.occlusionColor = vals.occlusionColor
    if (vals.occlusionOpacity != null) s.occlusionOpacity = vals.occlusionOpacity
    
    // Support massive sync of all per-mode params
    Object.keys(vals).forEach(k => {
      if (k.startsWith('enabled') || k.startsWith('spacing') || k.startsWith('shift') || 
          k.startsWith('color') || k.startsWith('weight') || k.startsWith('opacity') || 
          k.startsWith('dash') || k.startsWith('hypso') || k.startsWith('interval') ||
          k.startsWith('threshold') || k.startsWith('length') || k.startsWith('maxLen') || 
          k.startsWith('step') || k.startsWith('pillar') || k.startsWith('major') || k.startsWith('closeRings')) {
        s[k] = vals[k]
      }
    })

    // Fill & Mesh
    if (vals.showFill     != null) s.showFill      = vals.showFill
    if (vals.showMesh     != null) s.showMesh      = vals.showMesh
    if (vals.showTexture       != null) s.showTexture       = vals.showTexture
    if (vals.textureScale      != null) s.textureScale      = vals.textureScale
    if (vals.textureShiftX     != null) s.textureShiftX     = vals.textureShiftX
    if (vals.textureShiftY     != null) s.textureShiftY     = vals.textureShiftY
    if (vals.textureBlendMode  != null) s.textureBlendMode  = vals.textureBlendMode
    if (vals.textureOpacity    != null) s.textureOpacity    = vals.textureOpacity
    
    // Creative
    if (vals.showMirrorPlusX  != null) s.showMirrorPlusX  = vals.showMirrorPlusX
    if (vals.showMirrorMinusX != null) s.showMirrorMinusX = vals.showMirrorMinusX
    if (vals.showMirrorPlusY  != null) s.showMirrorPlusY  = vals.showMirrorPlusY
    if (vals.showMirrorMinusY != null) s.showMirrorMinusY = vals.showMirrorMinusY
    if (vals.showMirrorPlusZ  != null) s.showMirrorPlusZ  = vals.showMirrorPlusZ
    if (vals.showMirrorMinusZ != null) s.showMirrorMinusZ = vals.showMirrorMinusZ

    if (vals.tilt         != null) v.tilt          = vals.tilt
    if (vals.rotation     != null) v.rotation      = vals.rotation
    if (vals.zoom         != null) v.zoom          = vals.zoom
    // panX/panY must round-trip: the orbit controls sync them after a pan, and
    // dropping them here leaves state permanently behind the camera (which both
    // re-fires the sync on every orbit event and snaps the pan back on the next
    // tilt/rotation/zoom change).
    if (vals.panX         != null) v.panX          = vals.panX
    if (vals.panY         != null) v.panY          = vals.panY
    if (vals.autoRotate     != null) v.autoRotate     = vals.autoRotate
    if (vals.autoRotateAxis != null) v.autoRotateAxis = vals.autoRotateAxis
    if (vals.autoRotateDir  != null) v.autoRotateDir  = vals.autoRotateDir
    if (vals.showGuides   != null) v.showGuides    = vals.showGuides
    
    if (Object.keys(t).length) setTerrain(prev => ({ ...prev, ...t }))
    if (Object.keys(s).length) setStyle(prev   => ({ ...prev, ...s }))
    if (Object.keys(v).length) setView(prev    => ({ ...prev, ...v }))
  }, [setTerrain, setStyle, setView])

  // ── Auto-zoom to fit terrain on load ─────────────────────────────────────
  const autoZoom = useCallback(({ width, height }) => {
    const zoom = Math.max(0.05, Math.min(4, 500 / Math.max(width, height)))
    setBaseZoom(zoom)
    setView(prev => ({ ...prev, zoom }))
  }, [])

  // ── Auto-resolution: keep the geometry grid within 1024×1024 ─────────────
  const autoResolution = useCallback((width, height) =>
    Math.min(20, Math.max(1, Math.ceil(Math.max(width, height) / 1024)))
  , [])

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
  }, [autoZoom, autoResolution])

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
    setGpxPoints([]); setGpxError(null)
  }, [autoZoom])

  // Loading a raster takes the heightmap slot, so stop any audio still driving it.
  const loadPngAndFit = useCallback(() => {
    soundscape.release()
    loadFromPicker(({ width, height, dataWidth, dataHeight }) => {
      autoZoom({ width: dataWidth, height: dataHeight })
      setBaseElevScale(1)
      setTerrain(prev => ({ ...prev, resolution: autoResolution(width, height), elevScale: 0 }))
      setGpxPoints([]); setGpxError(null)
    })
  }, [soundscape, loadFromPicker, autoZoom, autoResolution])

  const loadGeoTiffAndFit = useCallback(() => {
    soundscape.release()
    loadGeoTiffFromPicker(({ width, height, dataWidth, dataHeight, suggestedElevScale }) => {
      autoZoom({ width: dataWidth, height: dataHeight })
      setBaseElevScale(suggestedElevScale ?? 1)
      setTerrain(prev => ({ ...prev, resolution: autoResolution(width, height), elevScale: 0 }))
    })
  }, [soundscape, loadGeoTiffFromPicker, autoZoom, autoResolution])

  // ── Export keyboard shortcuts ─────────────────────────────────────────────
  const handleWebmToggle = useCallback(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return
    if (isRecording()) stopWebM(() => setWebmActive(false))
    else startWebM(canvas, webmDuration, setWebmActive, exportBaseName)
  }, [webmDuration, exportBaseName])

  // ── Canvas pixel ratio ────────────────────────────────────────────────────
  // The canvas fills the window, so its CSS size is the window size. Supersampling
  // multiplies the device ratio, capped to whatever buffer DprGuard has found this
  // context will actually hand back — asking for more than that renders off-centre.
  const canvasDpr = useMemo(() => {
    const desired = Math.min(window.devicePixelRatio || 1, 2) * (view.renderScale ?? 1)
    const area = winSize.w * winSize.h
    if (!Number.isFinite(maxBufferPx) || !area) return desired
    return Math.min(desired, Math.sqrt(maxBufferPx / area))
  }, [view.renderScale, maxBufferPx, winSize])

  // ── Merged params ─────────────────────────────────────────────────────────
  // elevScale: intrinsic GeoTIFF scale + user offset. view.zoom is the raw effective zoom.
  const p = { ...terrain, ...style, ...points, ...view, gradientStops,
    elevScale: baseElevScale + terrain.elevScale,
    gpxPoints, geoTiffBbox, geoTiffCRS,
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
  const { terrain: terrainData, lineGeo, surfaceGeo, isComputing, resultCount } = useTerrainGeometry(p)

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

  // ── GPX upload handler ────────────────────────────────────────────────────
  const loadGpxFromPicker = useCallback(() => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.gpx' })
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return
      setGpxError(null)
      try {
        const pts = parseGpx(await file.text())
        setGpxPoints(pts)
        // A GPX holding only waypoints parses cleanly and yields nothing; without
        // this the upload looks like it worked and drew an empty track.
        if (!pts.length) setGpxError('No track or route points found in this GPX file.')
      } catch (err) {
        console.error('[GPX] Parse error:', err)
        setGpxPoints([])
        setGpxError(err?.message || 'Could not read this GPX file.')
      }
    }
    input.click()
  }, [])

  // Whether the loaded track and the loaded raster actually describe the same
  // place. GPX is WGS84 by definition, so a mismatch is always the GeoTIFF's
  // projection or its extent — and both fail the same silent way, by dropping
  // every point as out-of-bounds. Cheap enough to redo whenever either changes:
  // one forward projection per point, and only on load, not per frame.
  const gpxCoverage = useMemo(
    () => trackCoverage(gpxPoints, geoTiffBbox, geoTiffCRS, heightmapWidth, heightmapHeight),
    [gpxPoints, geoTiffBbox, geoTiffCRS, heightmapWidth, heightmapHeight],
  )

  // ── Export handlers ───────────────────────────────────────────────────────
  const handleStl = useCallback(() => {
    exportSTL({ surfaceGeo, terrain: terrainData, gpxPoints, geoTiffBbox, geoTiffCRS, p, baseName: exportBaseName })
  }, [surfaceGeo, terrainData, gpxPoints, geoTiffBbox, geoTiffCRS, p, exportBaseName])

  const handleHeightmapExport = useCallback(() => {
    exportHeightmap(terrainData, exportBaseName)
  }, [terrainData, exportBaseName])

  // ── Camera presets ────────────────────────────────────────────────────────
  const handleCameraPreset = useCallback((name) => {
    const presets = {
      top:   { tilt: 0,  rotation: 0 },
      front: { tilt: 90, rotation: 0 },
      iso:   { tilt: 45, rotation: -45 },
      reset: { tilt: 50, rotation: 0, zoom: 0.75, fov: 60, panX: 0, panY: 0 },
    }
    const p = presets[name] || presets.reset
    setView(prev => ({ ...prev, ...p }))
    setCameraPreset({ name, ts: Date.now() })
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
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
      if (e.code === 'Digit1') { setIsSvgExporting(true); setSvgTrigger(n => n + 1) }
      if (e.code === 'Digit2') setPngTrigger(n => n + 1)
      if (e.code === 'Digit3') setPngAlphaTrigger(n => n + 1)
      if (e.code === 'Digit4') handleStl()
      if (e.code === 'Digit5') handleWebmToggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleWebmToggle, handleStl, editMode, applyEditDraft, openEditor])

  // ── Load default heightmap on mount ───────────────────────────────────────
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

  return (
    <div className="w-full h-full" style={{ background: bgCss }}>

      {/* ── Canvas ──────────────────────────────────────────────────────── */}
      <Canvas
        frameloop="demand"
        dpr={canvasDpr}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
        camera={{ position: [0, 400, 500], fov: 60, near: 5, far: 50000 }}
        style={{ width:'100%', height:'100%' }}
      >
        <BgSync color={bgColor} gradient={style.bgGradient} />
        <DprGuard onClamp={handleBufferClamp} />
        <Scene
          terrain={terrainData}
          lineGeo={lineGeo}
          surfaceGeo={surfaceGeo}
          p={p}
          profileClickRef={profileClickRef}
          getParams={getParams}
          setParams={setParams}
          orbitRef={orbitRef}
          svgTrigger={svgTrigger}
          onSvgDone={() => setIsSvgExporting(false)}
          pngTrigger={pngTrigger}
          pngAlphaTrigger={pngAlphaTrigger}
          bgGradientStops={bgGradientStops}
          cameraPreset={cameraPreset}
          webmRecording={webmActive}
          exportBaseName={exportBaseName}
        />
      </Canvas>

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
        onSoundscapeFit={fitSoundscape}
        geoTiffElevMin={geoTiffElevMin}
        geoTiffElevMax={geoTiffElevMax}
        geoTiffCRS={geoTiffCRS}
        geoTiffCRSName={geoTiffCRSName}
        loadGpxFromPicker={loadGpxFromPicker}
        gpxPoints={gpxPoints}
        gpxCoverage={gpxCoverage}
        gpxError={gpxError}
        onClearGpx={() => { setGpxPoints([]); setGpxError(null) }}
        onCameraPreset={handleCameraPreset}
        onSvg={() => { setIsSvgExporting(true); setSvgTrigger(n => n + 1) }}
        onPng={() => setPngTrigger(n => n + 1)}
        onPngAlpha={() => setPngAlphaTrigger(n => n + 1)}
        onStl={handleStl}
        onHeightmap={handleHeightmapExport}
        onWebmToggle={handleWebmToggle}
        webmActive={webmActive}
        webmDuration={webmDuration}  setWebmDuration={setWebmDuration}
        onSavePreset={savePreset}
        onLoadPreset={loadPresetFromFile}
        externalPresets={externalPresets}
        onReset={() => {
          setTerrain({ ...TERRAIN_DEF, resolution: autoResolution(heightmapWidth, heightmapHeight) })
          setStyle(STYLE_DEF)
          setPoints(POINTS_DEF)
          setView({ ...VIEW_DEF, zoom: baseZoom })
          setGradientStops(GRADIENT_PRESETS['Jet'])
          setBgGradientStops([{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#cccccc' }])
        }}
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
      {isSvgExporting && !isLoading && <LoadingOverlay msg="Exporting SVG…" />}

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
          onClose={() => setProfileData(null)}
          geoTiffElevMin={geoTiffElevMin}
          geoTiffElevMax={geoTiffElevMax}
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
