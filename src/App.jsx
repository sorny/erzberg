/**
 * Root component — erzberg
 *
 * All tweakable params live in plain React state (no Leva).
 * The custom <Sidebar> renders the right-hand control panel.
 */
import { Canvas, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Scene } from './components/Scene'
import { Sidebar } from './components/Sidebar'
import { useHeightmap } from './hooks/useHeightmap'
import { useTerrainGeometry } from './hooks/useTerrainGeometry'
import { useStore } from './store/useStore'
import { GRADIENT_PRESETS } from './utils/gradientPresets'
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
  showTexture: false, textureScale: 1, textureShiftX: 0, textureShiftY: 0,

  // Creative 3D Symmetry
  showMirrorPlusX: true, showMirrorMinusX: false,
  showMirrorPlusY: true, showMirrorMinusY: false,
  showMirrorPlusZ: true, showMirrorMinusZ: false,

  // ── DRAW MODES ───────────────────────────────────────────────────────────
  // X Lines
  enabledX: true, spacingX: 4, shiftX: 0, colorX: '#000000', weightX: 1, opacityX: 1, dashX: 'solid',
  hypsoX: false, hypsoModeX: 'elevation', hypsoBandedX: false, hypsoIntervalX: 10,
  // Y Lines
  enabledY: false, spacingY: 4, shiftY: 0, colorY: '#000000', weightY: 1, opacityY: 1, dashY: 'solid',
  hypsoY: false, hypsoModeY: 'elevation', hypsoBandedY: false, hypsoIntervalY: 10,
  // Crosshatch
  enabledCross: false, spacingCross: 4, colorCross: '#000000', weightCross: 1, opacityCross: 1, dashCross: 'solid',
  hypsoCross: false, hypsoModeCross: 'elevation', hypsoBandedCross: false, hypsoIntervalCross: 10,
  // Pillars
  enabledPillars: false, spacingPillars: 8, colorPillars: '#000000', weightPillars: 1, opacityPillars: 1, dashPillars: 'solid',
  hypsoPillars: false, hypsoModePillars: 'elevation', hypsoBandedPillars: false, hypsoIntervalPillars: 10,
  pillarGap: 0, pillarDepth: 0, pillarStyle: 'line', pillarSize: 0.8, pillarSegments: 8, pillarLidColor: '#ffffff',
  // Contours
  enabledContours: false, intervalContours: 4, colorContours: '#000000', weightContours: 1, opacityContours: 1, dashContours: 'solid',
  hypsoContours: false, hypsoModeContours: 'elevation', hypsoBandedContours: false, hypsoIntervalContours: 10,
  majorIntervalContours: 10, majorWeightContours: 2, majorOffsetContours: 1,
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

  // Stipple
  enabledStipple: false, spacingStipple: 0.5, weightStipple: 4, opacityStipple: 0.85, colorStipple: '#1a1a1a', dashStipple: 'solid',
  stippleDensityMode: 'slope', stippleGamma: 1.2, stippleJitter: 0.8,
  hypsoStipple: false, hypsoModeStipple: 'elevation', hypsoBandedStipple: false, hypsoIntervalStipple: 10,

  // Hillshade
  showHillshade: false, hillshadeAzimuth: 315, hillshadeAltitude: 45,
  hillshadeIntensity: 1.0, hillshadeOpacity: 0.6, hillshadeExaggeration: 2.0,
  hillshadeHighlightColor: '#ffffff', hillshadeShadowColor: '#000000',

  // Slope & Aspect shading
  showSlopeShade: false, slopeShadeOpacity: 0.75, slopeColorLow: '#86efac', slopeColorHigh: '#dc2626',

  // Master visibility for all lines

  showLines: true,
  // Global Gradient Stops
  gradientStops: GRADIENT_PRESETS['Jet'],
}

const POINTS_DEF = {
  showPoints: false, pointColor: '#000000', pointSize: 4,
  particlePeaksOnly: false,
  animateParticles: false, particleNoise: 1, particleDamping: 0.92,
  particleGravity: false, particleGravityStr: 1,
}
const VIEW_DEF = {
  tilt: 40, rotation: 0, zoom: 1,
  fov: 60, orthographic: false,
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
  const { load, loadFromPicker, loadGeoTiffFromPicker, isLoading, loadingMsg } = useHeightmap()
  const heightmapPixels   = useStore((s) => s.heightmapPixels)
  const heightmapWidth    = useStore((s) => s.heightmapWidth)
  const heightmapHeight   = useStore((s) => s.heightmapHeight)
  const heightmapFilename = useStore((s) => s.heightmapFilename)
  const textureImage      = useStore((s) => s.textureImage)
  const setTextureImage   = useStore((s) => s.setTextureImage)
  const geoTiffElevMin    = useStore((s) => s.geoTiffElevMin)
  const geoTiffElevMax    = useStore((s) => s.geoTiffElevMax)

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
  const [gradientStops,   setGradientStops]   = useState(GRADIENT_PRESETS['Jet'])
  const [bgGradientStops, setBgGradientStops] = useState([{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#cccccc' }])
  const [webmDuration, setWebmDuration]   = useState(5)
  const [externalPresets, setExternalPresets] = useState({})
  // Intrinsic elevation scale derived from GeoTIFF metadata (metres / pixel ratio).
  // terrain.elevScale is a signed offset (0 = use GeoTIFF-derived scale as-is).
  const [baseElevScale, setBaseElevScale] = useState(1)
  // Zoom fit calculated on load; view.zoom is the user-facing multiplier (1 = 100%).
  const [baseZoom, setBaseZoom] = useState(1)

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
  const [pngTrigger,        setPngTrigger]         = useState(0)
  const [pngAlphaTrigger,   setPngAlphaTrigger]    = useState(0)
  const [webmActive, setWebmActive] = useState(false)
  const [cameraPreset, setCameraPreset] = useState(null)

  const orbitRef = useRef()


  // ── Preset helpers ────────────────────────────────────────────────────────
  const savePreset = useCallback(() => {
    let heightmapDataURL = null
    if (heightmapPixels && heightmapWidth && heightmapHeight) {
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
    const data = JSON.stringify({ terrain, style, points, view, gradientStops, bgGradientStops, heightmapDataURL }, null, 2)
    Object.assign(document.createElement('a'), {
      download: 'heightmap_preset.json',
      href: 'data:application/json,' + encodeURIComponent(data),
    }).click()
  }, [terrain, style, points, view, gradientStops, bgGradientStops, heightmapPixels, heightmapWidth, heightmapHeight])

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
  const levaGet = useCallback(
    () => ({ ...terrain, ...style, ...points, ...view }),
    [terrain, style, points, view]
  )
  const levaSet = useCallback((vals) => {
    const t = {}, s = {}, v = {}
    if (vals.resolution   != null) t.resolution    = vals.resolution
    if (vals.gridOffsetX  != null) t.gridOffsetX   = vals.gridOffsetX
    if (vals.gridOffsetY  != null) t.gridOffsetY   = vals.gridOffsetY
    if (vals.blackPoint   != null) t.blackPoint    = vals.blackPoint
    if (vals.whitePoint   != null) t.whitePoint    = vals.whitePoint
    
    // Line globals
    if (vals.showLines    != null) s.showLines     = vals.showLines
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
          k.startsWith('step') || k.startsWith('pillar') || k.startsWith('major')) {
        s[k] = vals[k]
      }
    })

    // Fill & Mesh
    if (vals.showFill     != null) s.showFill      = vals.showFill
    if (vals.showMesh     != null) s.showMesh      = vals.showMesh
    if (vals.showTexture    != null) s.showTexture    = vals.showTexture
    if (vals.textureScale   != null) s.textureScale   = vals.textureScale
    if (vals.textureShiftX  != null) s.textureShiftX  = vals.textureShiftX
    if (vals.textureShiftY  != null) s.textureShiftY  = vals.textureShiftY
    
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

  // ── Auto-resolution: keep the geometry grid within 1000×1000 ─────────────
  const autoResolution = useCallback((width, height) =>
    Math.min(20, Math.max(1, Math.ceil(Math.max(width, height) / 1000)))
  , [])

  // ── Export keyboard shortcuts ─────────────────────────────────────────────
  const handleWebmToggle = useCallback(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return
    if (isRecording()) stopWebM(() => setWebmActive(false))
    else startWebM(canvas, webmDuration, setWebmActive)
  }, [webmDuration])

  // ── Merged params ─────────────────────────────────────────────────────────
  // elevScale: intrinsic GeoTIFF scale + user offset. view.zoom is the raw effective zoom.
  const p = { ...terrain, ...style, ...points, ...view, gradientStops,
    elevScale: baseElevScale + terrain.elevScale }

  // ── Terrain geometry (lifted so Sidebar can read stats) ───────────────────
  const { terrain: terrainData, lineGeo, surfaceGeo, isComputing } = useTerrainGeometry(p)

  // Delay the computing overlay to avoid flickering on fast calculations
  const [showComputingOverlay, setShowComputingOverlay] = useState(false)
  useEffect(() => {
    let t
    if (isComputing) {
      t = setTimeout(() => setShowComputingOverlay(true), 1000)
    } else {
      setShowComputingOverlay(false)
    }
    return () => clearTimeout(t)
  }, [isComputing])

  // ── Export handlers ───────────────────────────────────────────────────────
  const handleStl = useCallback(() => {
    exportSTL({ surfaceGeo, terrain: terrainData })
  }, [surfaceGeo, terrainData])

  const handleHeightmapExport = useCallback(() => {
    exportHeightmap(terrainData)
  }, [terrainData])

  // ── Camera presets ────────────────────────────────────────────────────────
  const handleCameraPreset = useCallback((name) => {
    const presets = {
      top:   { tilt: 0,  rotation: 0 },
      front: { tilt: 90, rotation: 0 },
      iso:   { tilt: 45, rotation: -45 },
      reset: { tilt: 40, rotation: 0 },
    }
    const p = presets[name] || presets.reset
    setView(prev => ({ ...prev, ...p }))
    setCameraPreset({ name, ts: Date.now() })
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Digit1') setSvgTrigger(n => n + 1)
      if (e.code === 'Digit2') setPngTrigger(n => n + 1)
      if (e.code === 'Digit3') setPngAlphaTrigger(n => n + 1)
      if (e.code === 'Digit4') handleStl()
      if (e.code === 'Digit5') handleWebmToggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleWebmToggle, handleStl])

  // ── Load default heightmap on mount ───────────────────────────────────────
  useEffect(() => {
    const baseUrl = import.meta.env.BASE_URL || '/'
    load(`${baseUrl}Heightmap.png`).catch(() =>
      console.warn('[App] Default heightmap not found — use Load Heightmap.')
    )
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
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
        camera={{ position: [0, 400, 500], fov: 60, near: 1, far: 50000 }}
        style={{ width:'100%', height:'100%' }}
      >
        <BgSync color={bgColor} gradient={style.bgGradient} />
        <Scene
          terrain={terrainData}
          lineGeo={lineGeo}
          surfaceGeo={surfaceGeo}
          p={p}
          levaGet={levaGet}
          levaSet={levaSet}
          orbitRef={orbitRef}
          svgTrigger={svgTrigger}
          pngTrigger={pngTrigger}
          pngAlphaTrigger={pngAlphaTrigger}
          bgGradientStops={bgGradientStops}
          cameraPreset={cameraPreset}
          webmRecording={webmActive}
        />
      </Canvas>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
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
        loadFromPicker={() => loadFromPicker(({ width, height, dataWidth, dataHeight }) => {
          autoZoom({ width: dataWidth, height: dataHeight })
          setBaseElevScale(1)
          setTerrain(prev => ({ ...prev, resolution: autoResolution(width, height), elevScale: 0 }))
        })}
        loadGeoTiffFromPicker={() => loadGeoTiffFromPicker(({ width, height, dataWidth, dataHeight, suggestedElevScale }) => {
          autoZoom({ width: dataWidth, height: dataHeight })
          setBaseElevScale(suggestedElevScale ?? 1)
          setTerrain(prev => ({ ...prev, resolution: autoResolution(width, height), elevScale: 0 }))
        })}
        geoTiffElevMin={geoTiffElevMin}
        geoTiffElevMax={geoTiffElevMax}
        onCameraPreset={handleCameraPreset}
        onSvg={() => setSvgTrigger(n => n + 1)}
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
      />

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
