/**
 * Root component — heightmap-r3f
 *
 * All tweakable params live in plain React state (no Leva).
 * The custom <Sidebar> renders the right-hand control panel.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Scene }         from './components/Scene'
import { Sidebar }       from './components/Sidebar'
import { useHeightmap }  from './hooks/useHeightmap'
import { useTerrainGeometry } from './hooks/useTerrainGeometry'
import { useStore }      from './store/useStore'
import { GRADIENT_PRESETS } from './utils/gradientPresets'
import { startWebM, stopWebM, isRecording } from './utils/webmRecorder'
import { exportSTL } from './utils/stlExport'

// ── Default param sets ────────────────────────────────────────────────────────
const TERRAIN_DEF = {
  resolution: 2, elevScale: 1.0, blurRadius: 0,
  gridOffsetX: 0, gridOffsetY: 0, elevMinCut: 0, elevMaxCut: 100,
  blackPoint: 0, whitePoint: 255, jitterAmt: 0,
}
const STYLE_DEF = {
  drawMode: 'lines-x', lineSpacing: 4, lineShift: 0, hachureSpacing: 4, hachureLength: 1, contourInterval: 5,
  flowStep: 0.5, flowMaxLen: 100,
  showLines: true, lineColor: '#000000', strokeWeight: 1,
  lineDash: 'solid',
  showFill: true, fillColor: '#ffffff', showMesh: false, meshColor: '#888888', bgColor: '#ffffff',
  bgGradient: false,
  hypsometricFill: false, hypsometricBanded: false, hypsoInterval: 10, hypsoWeight: 1.5,
}
const POINTS_DEF = {
  showPoints: false, pointColor: '#000000', pointSize: 4,
  particlePeaksOnly: false,
  animateParticles: false, particleNoise: 1, particleDamping: 0.92,
  particleGravity: false, particleGravityStr: 1,
}
const VIEW_DEF = {
  tilt: 0, rotation: 0, zoom: 1,
  autoRotate: false, autoRotateSpeed: 0.5, autoRotateAxis: 'Y', autoRotateDir: -1,
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
    <div style={{
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
  const geoTiffElevMin    = useStore((s) => s.geoTiffElevMin)
  const geoTiffElevMax    = useStore((s) => s.geoTiffElevMax)

  // ── All tweakable state ───────────────────────────────────────────────────
  const [terrain, setTerrain] = useState(TERRAIN_DEF)
  const [style,   setStyle]   = useState(STYLE_DEF)
  const [points,  setPoints]  = useState(POINTS_DEF)
  const [view,    setView]    = useState(VIEW_DEF)
  const [gradientStops,   setGradientStops]   = useState(GRADIENT_PRESETS['Jet'])
  const [bgGradientStops, setBgGradientStops] = useState([{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#cccccc' }])
  const [webmDuration, setWebmDuration]   = useState(5)

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
    const data = JSON.stringify({ terrain, style, points, view, gradientStops, heightmapDataURL }, null, 2)
    Object.assign(document.createElement('a'), {
      download: 'heightmap_preset.json',
      href: 'data:application/json,' + encodeURIComponent(data),
    }).click()
  }, [terrain, style, points, view, gradientStops, heightmapPixels, heightmapWidth, heightmapHeight])

  const loadPresetFromFile = useCallback(() => {
    const input = Object.assign(document.createElement('input'), { type:'file', accept:'.json' })
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return
      try {
        const d = JSON.parse(await file.text())
        if (d.terrain)       setTerrain(prev => ({ ...prev, ...d.terrain }))
        if (d.style)         setStyle(prev   => ({ ...prev, ...d.style }))
        if (d.points)        setPoints(prev  => ({ ...prev, ...d.points }))
        if (d.view)          setView(prev    => ({ ...prev, ...d.view }))
        if (d.gradientStops) setGradientStops(d.gradientStops)
        if (d.heightmapDataURL) load(d.heightmapDataURL)
      } catch { alert('Invalid preset file.') }
    }
    input.click()
  }, [load])

  // ── Keyboard bridge for Controls.jsx (keyboard shortcuts inside Canvas) ───
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
    if (vals.lineSpacing  != null) s.lineSpacing   = vals.lineSpacing
    if (vals.drawMode     != null) s.drawMode      = vals.drawMode
    if (vals.flowStep     != null) s.flowStep      = vals.flowStep
    if (vals.flowMaxLen   != null) s.flowMaxLen    = vals.flowMaxLen
    if (vals.strokeWeight != null) s.strokeWeight  = vals.strokeWeight
    if (vals.lineDash     != null) s.lineDash      = vals.lineDash
    if (vals.showFill     != null) s.showFill      = vals.showFill
    if (vals.showMesh     != null) s.showMesh      = vals.showMesh
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
  // zoom = 500 / max(image_width, image_height) keeps any size terrain on screen.
  const autoZoom = useCallback(({ width, height }) => {
    const zoom = Math.max(0.05, Math.min(4, 500 / Math.max(width, height)))
    setView(prev => ({ ...prev, zoom }))
  }, [])

  // ── Export keyboard shortcuts ─────────────────────────────────────────────
  const handleWebmToggle = useCallback(() => {
    const canvas = document.querySelector('canvas')
    if (!canvas) return
    if (isRecording()) stopWebM(() => setWebmActive(false))
    else startWebM(canvas, webmDuration, setWebmActive)
  }, [webmDuration])

  // ── Merged params ─────────────────────────────────────────────────────────
  const p = { ...terrain, ...style, ...points, ...view, gradientStops }

  // ── Terrain geometry (lifted so Sidebar can read stats) ───────────────────
  const { terrain: terrainData, lineGeo, surfaceGeo } = useTerrainGeometry(p)

  // ── STL export ────────────────────────────────────────────────────────────
  const handleStl = useCallback(() => {
    exportSTL({ surfaceGeo, terrain: terrainData })
  }, [surfaceGeo, terrainData])

  // ── Camera presets ────────────────────────────────────────────────────────
  const handleCameraPreset = useCallback((name) => {
    const rotations = { top: 0, front: 0, iso: 45, reset: 0 }
    const tilts     = { top: 0, front: 0, iso: 0,  reset: 0 }
    setView(prev => ({ ...prev, tilt: tilts[name] ?? 0, rotation: rotations[name] ?? 0 }))
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

  // Geometry-computing indicator: pixels loaded but geometry not ready yet
  const isComputing = !!heightmapPixels && !lineGeo

  // ── Load default heightmap on mount ───────────────────────────────────────
  useEffect(() => {
    load('/Heightmap.png').catch(() =>
      console.warn('[App] Default heightmap not found — use Load Heightmap.')
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const bgColor   = style.bgColor || '#ffffff'
  const bgCss     = style.bgGradient && bgGradientStops?.length > 1
    ? `linear-gradient(to bottom, ${bgGradientStops.map(s => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ')})`
    : bgColor
  const noHmap    = !heightmapPixels

  const DRAW_MODE_LABELS = {
    'lines-x': 'X Ridge Lines', 'lines-y': 'Y Ridge Lines',
    crosshatch: 'Cross-Hatch',
    hachure: 'Hachure', contours: 'Contours',
    flow: 'Flow Lines',
  }

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
        loadFromPicker={() => loadFromPicker(autoZoom)}
        loadGeoTiffFromPicker={() => loadGeoTiffFromPicker(({ width, height, suggestedElevScale }) => {
          autoZoom({ width, height })
          if (suggestedElevScale != null) {
            setTerrain(prev => ({ ...prev, elevScale: suggestedElevScale }))
          }
        })}
        geoTiffElevMin={geoTiffElevMin}
        geoTiffElevMax={geoTiffElevMax}
        onCameraPreset={handleCameraPreset}
        onSvg={() => setSvgTrigger(n => n + 1)}
        onPng={() => setPngTrigger(n => n + 1)}
        onPngAlpha={() => setPngAlphaTrigger(n => n + 1)}
        onStl={handleStl}
        onWebmToggle={handleWebmToggle}
        webmActive={webmActive}
        webmDuration={webmDuration}  setWebmDuration={setWebmDuration}
        onSavePreset={savePreset}
        onLoadPreset={loadPresetFromFile}
        onReset={() => {
          setTerrain(TERRAIN_DEF); setStyle(STYLE_DEF)
          setPoints(POINTS_DEF);   setView(VIEW_DEF)
          setGradientStops(GRADIENT_PRESETS['Jet'])
          setBgGradientStops([{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#cccccc' }])
        }}
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

      {/* ── Draw mode HUD ────────────────────────────────────────────────── */}
      {!noHmap && !webmActive && (
        <div style={{
          position:'fixed', top:12, left:'50%', transform:'translateX(-50%)',
          background:'rgba(20,20,24,0.65)', backdropFilter:'blur(4px)',
          color:'#ccc', borderRadius:20, padding:'3px 14px',
          fontSize:12, zIndex:1500, pointerEvents:'none',
          fontFamily:'"JetBrains Mono","Fira Code",monospace',
        }}>
          {DRAW_MODE_LABELS[style.drawMode] || style.drawMode}
        </div>
      )}

      {/* ── Loading overlays ─────────────────────────────────────────────── */}
      {isLoading  && <LoadingOverlay msg={loadingMsg} />}
      {isComputing && !isLoading && <LoadingOverlay msg="Computing geometry…" />}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {noHmap && !isLoading && <EmptyState
        onLoad={() => loadFromPicker(autoZoom)}
        onLoadGeoTiff={() => loadGeoTiffFromPicker(({ width, height, suggestedElevScale }) => {
          autoZoom({ width, height })
          if (suggestedElevScale != null) setTerrain(prev => ({ ...prev, elevScale: suggestedElevScale }))
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
