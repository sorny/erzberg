/**
 * Root component — heightmap-r3f
 *
 * Features:
 *   • All original p5 controls ported to Leva
 *   • View: explicit Tilt / Rotation / Zoom sliders (terrain group transforms)
 *   • Export: SVG (A4), DXF (A4), PNG 1×/2×/4×, WebM recording
 *   • Keyboard shortcuts 1–4 for exports, G for guides
 *   • Preset save/load with embedded heightmap
 *   • Levels histogram with drag handles
 *   • Multi-stop gradient picker
 *   • Center guides crosshair overlay
 *   • Draw mode indicator HUD
 *   • Empty-state prompt when no heightmap is loaded
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { useControls, button, Leva } from 'leva'
import { Scene }           from './components/Scene'
import { Histogram }       from './components/Histogram'
import { GradientPicker }  from './components/GradientPicker'
import { StatsOverlay }    from './components/StatsOverlay'
import { useHeightmap }    from './hooks/useHeightmap'
import { useTerrainGeometry } from './hooks/useTerrainGeometry'
import { useStore }        from './store/useStore'
import { startWebM, stopWebM, isRecording } from './utils/webmRecorder'

// ── Gradient presets ──────────────────────────────────────────────────────────
export const GRADIENT_PRESETS = {
  Mono:    [{ pos: 0, color: '#000000' }, { pos: 1, color: '#000000' }],
  Classic: [{ pos: 0, color: '#1a1a2e' }, { pos: 0.5, color: '#888888' }, { pos: 1, color: '#ffffff' }],
  Fire:    [{ pos: 0, color: '#1a0000' }, { pos: 0.4, color: '#ff4400' }, { pos: 0.7, color: '#ffaa00' }, { pos: 1, color: '#ffffff' }],
  Ocean:   [{ pos: 0, color: '#001433' }, { pos: 0.5, color: '#0066cc' }, { pos: 1, color: '#00eeff' }],
  Topo:    [{ pos: 0, color: '#0d3b00' }, { pos: 0.3, color: '#5a8c00' }, { pos: 0.6, color: '#c8a800' }, { pos: 0.85, color: '#8b4513' }, { pos: 1, color: '#ffffff' }],
  Jet:     [{ pos: 0, color: '#000080' }, { pos: 0.25, color: '#00ffff' }, { pos: 0.5, color: '#00ff00' }, { pos: 0.75, color: '#ff8800' }, { pos: 1, color: '#800000' }],
  Cyber:   [{ pos: 0, color: '#0d0221' }, { pos: 0.5, color: '#b000ff' }, { pos: 1, color: '#00ffe7' }],
  Sunset:  [{ pos: 0, color: '#0a0020' }, { pos: 0.4, color: '#c62a6b' }, { pos: 0.7, color: '#ff7b3a' }, { pos: 1, color: '#ffe066' }],
}

// ── Default param sets ────────────────────────────────────────────────────────
const TERRAIN_DEF = {
  resolution: 4, lineSpacing: 8, elevScale: 1.5, blurRadius: 0,
  shiftLines: 0, shiftPeaks: 0, elevMinCut: 0, elevMaxCut: 100,
  blackPoint: 0, whitePoint: 255, jitterAmt: 0, slopeSpacing: false, slopeSpacingStr: 5,
}
const STYLE_DEF = {
  drawMode: 'lines-x', tightness: 0, hachureLength: 1, contourInterval: 5,
  showLines: true, lineColor: '#000000', strokeWeight: 1,
  showFill: false, showMesh: false, bgColor: '#ffffff',
  lineGradient: false, lineColorHigh: '#ff6b6b',
  strokeByElev: false, strokeElevLow: 0, strokeElevHigh: 1, slopeOpacity: false,
}
const POINTS_DEF = {
  showPoints: false, pointColor: '#000000', pointSize: 4,
  animateParticles: false, particleNoise: 1, particleDamping: 0.92,
  particleGravity: false, showTrails: false,
}
const VIEW_DEF = {
  tilt: 60, rotation: 0, zoom: 1,
  autoRotate: false, autoRotateSpeed: 1,
  showGuides: false,
}

// ── BgSync: clears the WebGL canvas to match bgColor ─────────────────────────
function BgSync({ color }) {
  const { gl } = useThree()
  useEffect(() => { gl.setClearColor(color, 1) }, [gl, color])
  return null
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const { load, loadFromPicker } = useHeightmap()
  const heightmapPixels  = useStore((s) => s.heightmapPixels)
  const heightmapWidth   = useStore((s) => s.heightmapWidth)
  const heightmapHeight  = useStore((s) => s.heightmapHeight)
  const heightmapFilename = useStore((s) => s.heightmapFilename)

  // gradientStops live outside Leva (array-of-objects unsupported)
  const [gradientStops, setGradientStops] = useState(GRADIENT_PRESETS['Mono'])

  // Export triggers
  const [svgTrigger,  setSvgTrigger]  = useState(0)
  const [dxfTrigger,  setDxfTrigger]  = useState(0)
  const [pngTrigger,  setPngTrigger]  = useState(0)
  const [pngScale,    setPngScale]    = useState(1)
  const [webmActive,  setWebmActive]  = useState(false)

  const orbitRef = useRef()

  // ── Terrain ───────────────────────────────────────────────────────────────
  const [terrain, setTerrain] = useControls('Terrain', () => ({
    resolution:      { value: TERRAIN_DEF.resolution,      min: 1,   max: 20,  step: 1,   label: 'Resolution' },
    lineSpacing:     { value: TERRAIN_DEF.lineSpacing,      min: 1,   max: 100, step: 1,   label: 'Line spacing' },
    elevScale:       { value: TERRAIN_DEF.elevScale,        min: 0,   max: 5,   step: 0.1, label: 'Elev scale' },
    blurRadius:      { value: TERRAIN_DEF.blurRadius,       min: 0,   max: 10,  step: 1,   label: 'Blur' },
    shiftLines:      { value: TERRAIN_DEF.shiftLines,       min: 0,   max: 19,  step: 1,   label: 'Shift lines' },
    shiftPeaks:      { value: TERRAIN_DEF.shiftPeaks,       min: 0,   max: 19,  step: 1,   label: 'Shift peaks' },
    elevMinCut:      { value: TERRAIN_DEF.elevMinCut,       min: 0,   max: 100, step: 1,   label: 'Elev min cut' },
    elevMaxCut:      { value: TERRAIN_DEF.elevMaxCut,       min: 0,   max: 100, step: 1,   label: 'Elev max cut' },
    blackPoint:      { value: TERRAIN_DEF.blackPoint,       min: 0,   max: 255, step: 1,   label: 'Shadows' },
    whitePoint:      { value: TERRAIN_DEF.whitePoint,       min: 0,   max: 255, step: 1,   label: 'Highlights' },
    jitterAmt:       { value: TERRAIN_DEF.jitterAmt,        min: 0,   max: 20,  step: 0.5, label: 'Jitter' },
    slopeSpacing:    { value: TERRAIN_DEF.slopeSpacing,     label: 'Slope spacing' },
    slopeSpacingStr: { value: TERRAIN_DEF.slopeSpacingStr,  min: 1, max: 10, step: 1,
      label: 'Spacing strength', render: (get) => get('Terrain.slopeSpacing') },
  }))

  // ── Style ─────────────────────────────────────────────────────────────────
  const [style, setStyle] = useControls('Style', () => ({
    drawMode: {
      value: STYLE_DEF.drawMode,
      options: ['lines-x', 'lines-y', 'curves', 'crosshatch', 'hachure', 'contours'],
      label: 'Draw mode',
    },
    tightness:       { value: STYLE_DEF.tightness,       min: -5, max: 5,  step: 0.1,
      label: 'Curve tightness', render: (get) => get('Style.drawMode') === 'curves' },
    hachureLength:   { value: STYLE_DEF.hachureLength,   min: 0.1, max: 5, step: 0.1,
      label: 'Hachure length',  render: (get) => get('Style.drawMode') === 'hachure' },
    contourInterval: { value: STYLE_DEF.contourInterval, min: 0.5, max: 30, step: 0.5,
      label: 'Contour interval',render: (get) => get('Style.drawMode') === 'contours' },
    showLines:    { value: STYLE_DEF.showLines,    label: 'Lines' },
    lineColor:    { value: STYLE_DEF.lineColor,    label: 'Line color' },
    strokeWeight: { value: STYLE_DEF.strokeWeight, min: 0.5, max: 10, step: 0.5, label: 'Stroke weight' },
    showFill:     { value: STYLE_DEF.showFill,     label: 'Fill' },
    showMesh:     { value: STYLE_DEF.showMesh,     label: 'Mesh' },
    bgColor:      { value: STYLE_DEF.bgColor,      label: 'Background' },
    lineGradient: { value: STYLE_DEF.lineGradient, label: 'Elev gradient' },
    lineColorHigh:{ value: STYLE_DEF.lineColorHigh, label: 'High color',
      render: (get) => get('Style.lineGradient') },
    strokeByElev: { value: STYLE_DEF.strokeByElev, label: 'Wt by elev' },
    strokeElevLow: { value: STYLE_DEF.strokeElevLow, min: 0, max: 1, step: 0.01,
      label: 'Wt low',  render: (get) => get('Style.strokeByElev') },
    strokeElevHigh:{ value: STYLE_DEF.strokeElevHigh, min: 0, max: 1, step: 0.01,
      label: 'Wt high', render: (get) => get('Style.strokeByElev') },
    slopeOpacity: { value: STYLE_DEF.slopeOpacity, label: 'Opacity/slope' },
  }))

  // ── Points & Particles ────────────────────────────────────────────────────
  const [points, setPoints] = useControls('Points', () => ({
    showPoints:       { value: POINTS_DEF.showPoints,       label: 'Show points' },
    pointColor:       { value: POINTS_DEF.pointColor,       label: 'Point color',
      render: (get) => get('Points.showPoints') },
    pointSize:        { value: POINTS_DEF.pointSize,        min: 0.5, max: 20, step: 0.5,
      label: 'Point size', render: (get) => get('Points.showPoints') },
    animateParticles: { value: POINTS_DEF.animateParticles, label: 'Animate',
      render: (get) => get('Points.showPoints') },
    particleNoise:    { value: POINTS_DEF.particleNoise,    min: 0, max: 5, step: 0.1,
      label: 'Noise',   render: (get) => get('Points.showPoints') && get('Points.animateParticles') },
    particleDamping:  { value: POINTS_DEF.particleDamping,  min: 0.5, max: 0.99, step: 0.01,
      label: 'Damping', render: (get) => get('Points.showPoints') && get('Points.animateParticles') },
    particleGravity:  { value: POINTS_DEF.particleGravity,  label: 'Gravity',
      render: (get) => get('Points.showPoints') && get('Points.animateParticles') },
    showTrails:       { value: POINTS_DEF.showTrails,        label: 'Trails',
      render: (get) => get('Points.showPoints') && get('Points.animateParticles') },
  }))

  // ── View ──────────────────────────────────────────────────────────────────
  const [view, setView] = useControls('View', () => ({
    tilt:       { value: VIEW_DEF.tilt,   min: 0, max: 180, step: 1, label: 'Tilt' },
    rotation:   { value: VIEW_DEF.rotation, min: -180, max: 180, step: 1, label: 'Rotation' },
    zoom:       { value: VIEW_DEF.zoom,   min: 0.1, max: 4, step: 0.05, label: 'Zoom' },
    autoRotate:      { value: VIEW_DEF.autoRotate,      label: 'Auto-rotate' },
    autoRotateSpeed: { value: VIEW_DEF.autoRotateSpeed, min: 0.1, max: 10, step: 0.1,
      label: 'Rotate speed', render: (get) => get('View.autoRotate') },
    showGuides: { value: VIEW_DEF.showGuides, label: 'Center guides' },
  }))

  // ── Gradient preset selector ───────────────────────────────────────────────
  useControls('Gradient', () => ({
    preset: {
      options: Object.keys(GRADIENT_PRESETS),
      value: 'Mono',
      label: 'Preset',
      onChange: (v) => { if (GRADIENT_PRESETS[v]) setGradientStops(GRADIENT_PRESETS[v]) },
    },
  }))

  // ── Heightmap ─────────────────────────────────────────────────────────────
  useControls('Heightmap', () => ({
    'Load image': button(() => loadFromPicker()),
  }))

  // ── Export ────────────────────────────────────────────────────────────────
  const [webmDuration] = useControls('Export', () => ({
    'SVG — A4 (1)':   button(() => setSvgTrigger((n) => n + 1)),
    'DXF — A4 (2)':   button(() => setDxfTrigger((n) => n + 1)),
    'PNG 1× (3)':     button(() => { setPngScale(1); setPngTrigger((n) => n + 1) }),
    'PNG 2×':         button(() => { setPngScale(2); setPngTrigger((n) => n + 1) }),
    'PNG 4×':         button(() => { setPngScale(4); setPngTrigger((n) => n + 1) }),
    webmDuration:     { value: 5, min: 1, max: 60, step: 1, label: 'WebM duration (s)' },
    'WebM record (4)': button((get) => {
      const canvas = document.querySelector('canvas')
      if (!canvas) return
      const dur = get('Export.webmDuration')
      if (isRecording()) {
        stopWebM(() => setWebmActive(false))
      } else {
        startWebM(canvas, dur, setWebmActive)
      }
    }),
    'Save preset':    button(() => savePreset()),
    'Load preset':    button(() => loadPresetFromFile()),
  }))

  // ── Reset ─────────────────────────────────────────────────────────────────
  useControls('Settings', () => ({
    'Reset all': button(() => {
      setTerrain(TERRAIN_DEF)
      setStyle(STYLE_DEF)
      setPoints(POINTS_DEF)
      setView(VIEW_DEF)
      setGradientStops(GRADIENT_PRESETS['Mono'])
    }),
  }))

  // ── Preset helpers ────────────────────────────────────────────────────────
  const savePreset = useCallback(() => {
    // Re-encode the heightmap pixels as base64 PNG for self-contained preset
    let heightmapDataURL = null
    if (heightmapPixels && heightmapWidth && heightmapHeight) {
      const c = document.createElement('canvas')
      c.width = heightmapWidth; c.height = heightmapHeight
      const ctx = c.getContext('2d')
      const img = ctx.createImageData(heightmapWidth, heightmapHeight)
      for (let i = 0; i < heightmapPixels.length; i++) {
        const v = Math.round(heightmapPixels[i] * 255)
        img.data[i * 4] = v; img.data[i * 4 + 1] = v
        img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255
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
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' })
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return
      try {
        const d = JSON.parse(await file.text())
        if (d.terrain)       setTerrain(d.terrain)
        if (d.style)         setStyle(d.style)
        if (d.points)        setPoints(d.points)
        if (d.view)          setView(d.view)
        if (d.gradientStops) setGradientStops(d.gradientStops)
        if (d.heightmapDataURL) load(d.heightmapDataURL)
      } catch { alert('Invalid preset file.') }
    }
    input.click()
  }, [setTerrain, setStyle, setPoints, setView, load])

  // ── Keyboard shortcuts for exports & guides ───────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Digit1') setSvgTrigger((n) => n + 1)
      if (e.code === 'Digit2') setDxfTrigger((n) => n + 1)
      if (e.code === 'Digit3') { setPngScale(1); setPngTrigger((n) => n + 1) }
      if (e.code === 'Digit4') {
        const canvas = document.querySelector('canvas')
        if (!canvas) return
        if (isRecording()) stopWebM(() => setWebmActive(false))
        else startWebM(canvas, webmDuration ?? 5, setWebmActive)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [webmDuration])

  // ── Keyboard bridge for Controls.jsx ─────────────────────────────────────
  const levaGet = useCallback(
    () => ({ ...terrain, ...style, ...points, ...view }),
    [terrain, style, points, view]
  )
  const levaSet = useCallback((vals) => {
    const t = {}, s = {}, v = {}
    if (vals.resolution   != null) t.resolution   = vals.resolution
    if (vals.lineSpacing  != null) t.lineSpacing   = vals.lineSpacing
    if (vals.shiftLines   != null) t.shiftLines    = vals.shiftLines
    if (vals.shiftPeaks   != null) t.shiftPeaks    = vals.shiftPeaks
    if (vals.blackPoint   != null) t.blackPoint    = vals.blackPoint
    if (vals.whitePoint   != null) t.whitePoint    = vals.whitePoint
    if (vals.drawMode     != null) s.drawMode      = vals.drawMode
    if (vals.strokeWeight != null) s.strokeWeight  = vals.strokeWeight
    if (vals.showFill     != null) s.showFill      = vals.showFill
    if (vals.showMesh     != null) s.showMesh      = vals.showMesh
    if (vals.tilt         != null) v.tilt          = vals.tilt
    if (vals.rotation     != null) v.rotation      = vals.rotation
    if (vals.zoom         != null) v.zoom          = vals.zoom
    if (vals.autoRotate   != null) v.autoRotate    = vals.autoRotate
    if (vals.showGuides   != null) v.showGuides    = vals.showGuides
    if (Object.keys(t).length) setTerrain(t)
    if (Object.keys(s).length) setStyle(s)
    if (Object.keys(v).length) setView(v)
  }, [setTerrain, setStyle, setView])

  // ── Merged params ─────────────────────────────────────────────────────────
  const p = { ...terrain, ...style, ...points, ...view, gradientStops }

  // ── Terrain geometry (lifted so StatsOverlay can read it) ─────────────────
  const { terrain: terrainData, lineGeo, surfaceGeo } = useTerrainGeometry(p)

  // ── Load default heightmap ────────────────────────────────────────────────
  useEffect(() => {
    load('/Heightmap.png').catch(() =>
      console.warn('[App] Default heightmap not found — use Load image.')
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const bgColor = style.bgColor || '#ffffff'
  const noHeightmap = !heightmapPixels

  const DRAW_MODE_LABELS = {
    'lines-x': 'X Ridge Lines', 'lines-y': 'Y Ridge Lines',
    curves: 'Curves', crosshatch: 'Cross-Hatch',
    hachure: 'Hachure', contours: 'Contours',
  }

  return (
    <div className="w-full h-full" style={{ background: bgColor }}>
      <Leva collapsed={false} theme={{ sizes: { rootWidth: '310px' } }} />

      {/* ── Left sidebar: Levels + Gradient picker ──────────────────────── */}
      <div style={{
        position: 'fixed', top: 8, left: 8, zIndex: 1000,
        width: 264, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <Panel title="Levels">
          <Histogram
            pixels={heightmapPixels}
            blackPoint={terrain.blackPoint}
            whitePoint={terrain.whitePoint}
            onBlackChange={(v) => setTerrain({ blackPoint: v })}
            onWhiteChange={(v) => setTerrain({ whitePoint: v })}
          />
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:5, fontSize:11, color:'#666' }}>
            <span>Shadows: {terrain.blackPoint}</span>
            <span>Highlights: {terrain.whitePoint}</span>
          </div>
        </Panel>

        {style.lineGradient && (
          <Panel title="Gradient editor">
            <GradientPicker stops={gradientStops} onChange={setGradientStops} />
          </Panel>
        )}
      </div>

      {/* ── Canvas ──────────────────────────────────────────────────────── */}
      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ position: [0, 400, 500], fov: 60, near: 1, far: 50000 }}
        style={{ width: '100%', height: '100%' }}
      >
        <BgSync color={bgColor} />
        <Scene
          terrain={terrainData}
          lineGeo={lineGeo}
          surfaceGeo={surfaceGeo}
          p={p}
          levaGet={levaGet}
          levaSet={levaSet}
          orbitRef={orbitRef}
          svgTrigger={svgTrigger}
          dxfTrigger={dxfTrigger}
          pngTrigger={pngTrigger}
          pngScale={pngScale}
          webmRecording={webmActive}
        />
      </Canvas>

      {/* ── Center guides ───────────────────────────────────────────────── */}
      {view.showGuides && <CenterGuides bgColor={bgColor} />}

      {/* ── WebM recording indicator ────────────────────────────────────── */}
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

      {/* ── Draw mode indicator ─────────────────────────────────────────── */}
      {!noHeightmap && !webmActive && (
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

      {/* ── Stats bar ───────────────────────────────────────────────────── */}
      <StatsOverlay lineGeo={lineGeo} surfaceGeo={surfaceGeo} terrain={terrainData} />

      {/* ── Filename ────────────────────────────────────────────────────── */}
      {heightmapFilename && (
        <div style={{
          position:'fixed', bottom:36, left:'50%', transform:'translateX(-50%)',
          fontSize:11, color:'#999', pointerEvents:'none', zIndex:999,
        }}>
          {heightmapFilename}
        </div>
      )}

      {/* ── Keyboard hints ──────────────────────────────────────────────── */}
      <div style={{
        position:'fixed', bottom:8, right:8,
        fontSize:10, color:'#aaa', pointerEvents:'none', zIndex:999,
        lineHeight:1.7, textAlign:'right',
        fontFamily:'"JetBrains Mono","Fira Code",monospace',
      }}>
        WASD pan · YX tilt · ER rotate · Q auto · T reset<br/>
        F mode · IK res · JL spacing · BN weight · P fill · O mesh · G guides<br/>
        1 SVG · 2 DXF · 3 PNG · 4 WebM
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {noHeightmap && <EmptyState onLoad={loadFromPicker} />}
    </div>
  )
}

// ── UI helper components ──────────────────────────────────────────────────────

function Panel({ title, children }) {
  return (
    <div style={{
      background:'#1b1b1f', border:'1px solid rgba(255,255,255,0.08)',
      borderRadius:8, padding:'8px 10px',
      fontFamily:'"JetBrains Mono","Fira Code",monospace',
      fontSize:11, color:'#aaa',
    }}>
      <div style={{ marginBottom:6, fontWeight:700, color:'#ddd', letterSpacing:'0.05em', fontSize:10 }}>
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  )
}

function CenterGuides({ bgColor }) {
  // Adapt guide colour to background brightness
  const rgb = bgColor.match(/\w\w/g)?.map(h => parseInt(h, 16)) ?? [255,255,255]
  const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000
  const lineColor = brightness > 128
    ? 'rgba(0,0,0,0.25)'
    : 'rgba(255,255,255,0.25)'

  return (
    <div style={{ position:'fixed', inset:0, pointerEvents:'none', zIndex:500 }}>
      <div style={{ position:'absolute', left:'50%', top:0, bottom:0, width:1, background:lineColor }} />
      <div style={{ position:'absolute', top:'50%', left:0, right:0, height:1, background:lineColor }} />
    </div>
  )
}

function EmptyState({ onLoad }) {
  return (
    <div style={{
      position:'fixed', inset:0, zIndex:3000,
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      background:'rgba(255,255,255,0.9)', backdropFilter:'blur(8px)',
    }}>
      <div style={{ fontSize:56, marginBottom:16, lineHeight:1 }}>⛰</div>
      <div style={{ fontSize:22, fontWeight:700, color:'#111', marginBottom:8 }}>
        No heightmap loaded
      </div>
      <div style={{ fontSize:14, color:'#666', marginBottom:28, textAlign:'center', maxWidth:320 }}>
        Load any greyscale PNG.<br/>
        <a href="https://tangrams.github.io/heightmapper" target="_blank" rel="noreferrer"
          style={{ color:'#444' }}>Tangrams Heightmapper</a> exports OSM-based heightmaps.
      </div>
      <button
        onClick={onLoad}
        style={{
          background:'#111', color:'#fff', border:'none', borderRadius:10,
          padding:'13px 32px', fontSize:16, cursor:'pointer', fontWeight:700,
          letterSpacing:'0.02em',
        }}
      >
        Load Heightmap
      </button>
    </div>
  )
}
