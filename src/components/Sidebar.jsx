/**
 * Custom right-hand control panel — design mirrors the original p5.js tool.
 */
import { useState } from 'react'
import { Histogram }      from './Histogram'
import { GradientPicker } from './GradientPicker'
import { GRADIENT_PRESETS } from '../utils/gradientPresets'
import { STYLE_PRESETS } from '../utils/stylePresets'
import { simulateErosion } from '../utils/erosion'
import { useStore } from '../store/useStore'

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG     = '#18181b'
const SURF   = '#27272a'
const BORDER = '#3f3f46'
const TEXT   = '#e4e4e7'
const DIM    = '#d4d4d8'
const MUTED  = '#71717a'
const ACCENT = '#3b82f6'
const W      = 272   // panel width px

// ── Injected styles (pseudo-elements can't be set inline) ─────────────────────
function PanelStyles() {
  return (
    <style>{`
      .hmr { -webkit-appearance:none; appearance:none; flex:1; min-width:0; width:0;
        height:3px; background:${BORDER}; border-radius:2px; outline:none; cursor:pointer; }
      .hmr::-webkit-slider-thumb { -webkit-appearance:none; width:13px; height:13px;
        border-radius:50%; background:${ACCENT}; cursor:pointer; transition:transform .1s; }
      .hmr:hover::-webkit-slider-thumb { transform:scale(1.2); }
      .hmr::-moz-range-thumb { width:13px; height:13px; border-radius:50%;
        background:${ACCENT}; border:none; }
      .hmc { -webkit-appearance:none; appearance:none; width:32px; height:20px;
        border:1px solid ${BORDER}; border-radius:3px; cursor:pointer;
        padding:2px; background:${SURF}; }
      .hmc::-webkit-color-swatch-wrapper { padding:0; }
      .hmc::-webkit-color-swatch { border:none; border-radius:2px; }
      .hmeb:hover { background:${ACCENT} !important; border-color:${ACCENT} !important; color:#fff !important; }
      .hmeb:hover .hmeh { color:rgba(255,255,255,.5) !important; }
      .hmsb.on { background:${ACCENT} !important; color:#fff !important; border-color:${ACCENT} !important; }
      .hmsb:hover:not(.on) { background:${BORDER} !important; color:${DIM} !important; }
      .hmload:hover { background:${SURF} !important; color:${TEXT} !important; }
      #hm-panel-body::-webkit-scrollbar { width:4px; }
      #hm-panel-body::-webkit-scrollbar-thumb { background:${BORDER}; border-radius:2px; }
      .hmi:hover { color:${TEXT} !important; border-color:${MUTED} !important; }
      
      .sym-btn { background:${SURF}; border:1px solid ${BORDER}; color:${MUTED}; border-radius:6px; 
                 cursor:pointer; display:flex; flex-direction:column; align-items:center; 
                 justify-content:center; font-size:12px; font-weight:700; transition:all 0.1s; aspect-ratio:1/1; }
      .sym-btn.on { background:${ACCENT}; color:#fff; border-color:${ACCENT}; }
      .sym-btn:hover:not(.on) { border-color:${MUTED}; color:${DIM}; }
      .sym-label { font-size:8px; margin-top:2px; opacity:0.8; }
    `}</style>
  )
}

// ── UI Atomic Components ───────────────────────────────────────────────────────

function HelpBox({ text }) {
  return (
    <div style={{
      fontSize: 9, color: MUTED, background: 'rgba(0,0,0,0.2)',
      padding: '6px 8px', borderRadius: 4, marginBottom: 8,
      border: `1px solid ${BORDER}`, lineHeight: 1.4
    }}>
      {text}
    </div>
  )
}

function HelpBtn({ active, onClick }) {
  return (
    <span onClick={onClick} className="hmi" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 12, height: 12, borderRadius: '50%', border: `1px solid ${BORDER}`,
      fontSize: 8, color: MUTED, cursor: 'pointer', marginLeft: 4,
      background: active ? BORDER : 'transparent',
      transition: 'all 0.1s'
    }}>?</span>
  )
}

function Sl({ label, hint, help, min, max, step = 1, value, onChange, fmt, col2 }) {
  const [showHelp, setShowHelp] = useState(false)
  const parsed = (v) => step < 1 ? parseFloat(v) : parseInt(v)
  return (
    <div style={{ marginBottom: 8, ...(col2 && { gridColumn: '1/-1' }) }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: DIM, display: 'flex', alignItems: 'center' }}>
          {label}
          {help && <HelpBtn active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        {hint && <span style={{ fontSize: 9, color: MUTED }}>{hint}</span>}
      </div>
      {showHelp && help && <HelpBox text={help} />}
      <div style={{ display:'flex', alignItems:'center', gap: 7 }}>
        <input type="range" className="hmr" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parsed(e.target.value))} />
        <span style={{ minWidth: 36, textAlign:'right', fontSize: 10, color: MUTED, fontVariantNumeric:'tabular-nums' }}>
          {fmt ? fmt(value) : value}
        </span>
      </div>
    </div>
  )
}

function Tog({ label, hint, help, checked, onChange, small }) {
  const [showHelp, setShowHelp] = useState(false)
  const fs = small ? 11 : 12
  const tc = small ? MUTED : DIM
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: showHelp ? 4 : 0 }}>
        <span style={{ fontSize: fs, color: tc, display: 'flex', alignItems: 'center' }}>
          {label}{hint && <span style={{ fontSize: fs - 1, color: MUTED }}> {hint}</span>}
          {help && <HelpBtn active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <Switch checked={checked} onChange={onChange} />
      </div>
      {showHelp && help && <HelpBox text={help} />}
    </div>
  )
}

function Switch({ checked, onChange }) {
  return (
    <label style={{ position:'relative', display:'inline-block', width:34, height:18, flexShrink:0, cursor:'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ display:'none' }} />
      <span style={{ position:'absolute', inset:0, background: checked ? ACCENT : BORDER, borderRadius:9, transition:'background .15s' }}>
        <span style={{
          position:'absolute', width:14, height:14, borderRadius:'50%', background:'#fff',
          top: 2, left: checked ? 18 : 2, transition:'left .15s', boxShadow:'0 1px 3px rgba(0,0,0,.4)',
        }} />
      </span>
    </label>
  )
}

function ColorRow({ label, value, onChange }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: DIM }}>{label}</span>
      <input type="color" className="hmc" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

function TogColor({ label, hint, help, checked, onToggle, color, onColor }) {
  const [showHelp, setShowHelp] = useState(false)
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: showHelp ? 4 : 0 }}>
        <span style={{ fontSize: 12, color: DIM, display: 'flex', alignItems: 'center' }}>
          {label}{hint && <span style={{ fontSize: 10, color: MUTED }}> {hint}</span>}
          {help && <HelpBtn active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          {onColor && <input type="color" className="hmc" value={color} onChange={e => onColor(e.target.value)} />}
          <Switch checked={checked} onChange={onToggle} />
        </div>
      </div>
      {showHelp && help && <HelpBox text={help} />}
    </div>
  )
}

function InlineSl({ label, hint, help, min, max, step = 1, value, onChange, fmt }) {
  const [showHelp, setShowHelp] = useState(false)
  const parsed = (v) => step < 1 ? parseFloat(v) : parseInt(v)
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', alignItems:'center', gap: 7, marginBottom: showHelp ? 4 : 0 }}>
        <span style={{ fontSize: 11, color: MUTED, whiteSpace:'nowrap', minWidth: 52, display: 'flex', alignItems: 'center' }}>
          {label}{hint && <span style={{ fontSize: 9, color: MUTED, marginLeft: 3 }}>{hint}</span>}
          {help && <HelpBtn active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <input type="range" className="hmr" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parsed(e.target.value))} />
        <span style={{ minWidth: 32, textAlign:'right', fontSize: 10, color: MUTED, fontVariantNumeric:'tabular-nums' }}>
          {fmt ? fmt(value) : value}
        </span>
      </div>
      {showHelp && help && <HelpBox text={help} />}
    </div>
  )
}

function Section({ title, open, onToggle, children }) {
  return (
    <div style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div onClick={onToggle} style={{
        display:'flex', justifyContent:'space-between', alignItems:'center',
        padding:'10px 14px', cursor:'pointer', userSelect:'none',
      }}>
        <span style={{ fontSize:9, fontWeight:700, letterSpacing:'1.8px', textTransform:'uppercase', color: MUTED }}>
          {title}
        </span>
        <span style={{ 
          fontSize:22, fontWeight:700, color: MUTED, lineHeight:1, display:'inline-block',
          transform: open ? 'none' : 'rotate(-90deg)', transition:'transform .18s' 
        }}>▾</span>
      </div>
      <div style={{ display:'grid', gridTemplateRows: open ? '1fr' : '0fr', overflow:'hidden', transition:'grid-template-rows .2s ease' }}>
        <div style={{ minHeight:0, overflow:'hidden', padding: open ? '0 14px 12px' : '0 14px' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function Sub({ children }) {
  return (
    <div style={{ marginLeft: 6, borderLeft: `1px solid ${BORDER}`, paddingLeft: 5, marginBottom: 12 }}>
      {children}
    </div>
  )
}

function ExpBtn({ label, hint, onClick, active }) {
  return (
    <button className="hmeb" onClick={onClick} style={{
      flex:1, padding:'8px 0', textAlign:'center',
      background: active ? ACCENT : SURF,
      color: active ? '#fff' : DIM,
      border:`1px solid ${active ? ACCENT : BORDER}`, borderRadius:5,
      cursor:'pointer', fontSize:11, fontWeight:600,
    }}>
      {label}
      {hint && <span className="hmeh" style={{ display:'block', fontSize:9, color: MUTED, fontWeight:400, marginTop:2 }}>{hint}</span>}
    </button>
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
  geoTiffElevMin, geoTiffElevMax,
  onCameraPreset,
  onSvg, onPng, onPngAlpha, onStl, onHeightmap,
  onWebmToggle, webmActive,
  webmDuration, setWebmDuration,
  onSavePreset, onLoadPreset,
  onReset,
  lineGeo, surfaceGeo, terrainData,
}) {
  const [open, setOpen]     = useState(true)
  const [sec, setSec]       = useState({
    terrain: true, levels: true, view: true, style: true, texture: true, creative: true, points: true, erosion: false, export: true,
  })

  // --- Erosion State ---
  const [eIters,     setEIters]     = useState(50000)
  const [eRadius,    setERadius]    = useState(3)
  const [eInertia,   setEInertia]   = useState(0.1)
  const [eCapacity,  setECapacity]  = useState(4)
  const [eErode,     setEErode]     = useState(0.3)
  const [eDeposit,   setEDeposit]   = useState(0.3)
  const [eEvap,      setEEvap]      = useState(0.01)
  const [isEroding,  setIsEroding]  = useState(false)
  const [lastPixels, setLastPixels] = useState(null)
  
  const setPixels = useStore(s => s.setPixels)
  const heightmapWidth = useStore(s => s.heightmapWidth)
  const heightmapHeight = useStore(s => s.heightmapHeight)

  const handleRunErosion = () => {
    if (!heightmapPixels || isEroding) return
    setLastPixels(new Float32Array(heightmapPixels))
    setIsEroding(true)
    setTimeout(() => {
      try {
        const next = simulateErosion(heightmapPixels, heightmapWidth, heightmapHeight, eIters, {
          erosionRadius: eRadius,
          inertia: eInertia,
          sedimentCapacityFactor: eCapacity,
          erodeSpeed: eErode,
          depositSpeed: eDeposit,
          evaporateSpeed: eEvap
        })
        setPixels(next)
      } finally {
        setIsEroding(false)
      }
    }, 50)
  }

  const handleUndoErosion = () => {
    if (!lastPixels) return
    setPixels(lastPixels)
    setLastPixels(null)
  }

  const handleTexturePicker = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' })
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

  const st = (v) => setTerrain(p => ({ ...p, ...v }))
  const ss = (v) => setStyle(p => ({ ...p, ...v }))
  const sp = (v) => setPoints(p => ({ ...p, ...v }))
  const sv = (v) => setView(p => ({ ...p, ...v }))

  const hasGeoTiff  = geoTiffElevMin != null && geoTiffElevMax != null
  const elevRange   = hasGeoTiff ? geoTiffElevMax - geoTiffElevMin : 0
  const elevCutToM  = (pct) => Math.round(geoTiffElevMin + (pct / 100) * elevRange)
  const mToElevCut  = (m)   => Math.round(((m - geoTiffElevMin) / elevRange) * 100)

  const applyPreset = (preset) => {
    setStyle(prev => ({ ...prev, ...preset.style }))
    if (preset.gradientStops) setGradientStops(preset.gradientStops)
  }

  const MODES = [
    { id:'lines-x',    label:'X' },
    { id:'lines-y',    label:'Y' },
    { id:'crosshatch', label:'Cross' },
    { id:'z',          label:'Z' },
    { id:'contours',   label:'Contours' },
    { id:'hachure',    label:'Hachure' },
    { id:'flow',       label:'Flow' },
    { id:'dag',        label:'Network' },
    { id:'pencil',     label:'Pencil' },
  ]

  const activeModes = Array.isArray(style.drawMode) ? style.drawMode : [style.drawMode]
  const hasMode = (id) => activeModes.includes(id)
  const toggleMode = (id) => {
    let next = hasMode(id) ? activeModes.filter(m => m !== id) : [...activeModes, id]
    ss({ drawMode: next })
  }

  const lineStep = terrainData ? Math.max(1, Math.round((style.lineSpacing ?? 4) / terrainData.scl)) : 1

  // Stats
  const segs  = lineGeo    ? (lineGeo.positions.length / 6).toLocaleString()     : '–'
  const verts = lineGeo    ? (lineGeo.positions.length / 3).toLocaleString()     : '–'
  const tris  = surfaceGeo ? (surfaceGeo.indices.length  / 3).toLocaleString()   : '–'
  const grid  = terrainData ? `${terrainData.cols}×${terrainData.rows}` : '–'

  return (
    <>
      <PanelStyles />

      <div onClick={() => setOpen(o => !o)} style={{
        position:'fixed', right: open ? W : 0, top:'50%', transform:'translateY(-50%)',
        width:22, height:64, background: BG, borderRadius:'6px 0 0 6px',
        cursor:'pointer', zIndex:1001, userSelect:'none',
        display:'flex', alignItems:'center', justifyContent:'center',
        color: MUTED, fontSize:11, boxShadow:'-2px 0 8px rgba(0,0,0,.35)',
        transition:'right .22s cubic-bezier(.4,0,.2,1)',
      }}>{open ? '▶' : '◀'}</div>

      <div style={{
        position:'fixed', right:0, top:0, width:W, height:'100%',
        background: BG, color: TEXT, zIndex:1000,
        display:'flex', flexDirection:'column',
        transform: open ? 'none' : `translateX(${W}px)`,
        transition:'transform .22s cubic-bezier(.4,0,.2,1)',
        boxShadow:'-3px 0 16px rgba(0,0,0,.4)',
        fontFamily:'system-ui,-apple-system,sans-serif',
      }}>
        <div style={{ padding:'12px 14px 11px', borderBottom:`1px solid ${BORDER}`, flexShrink:0, display:'flex', alignItems:'center' }}>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:'2px', textTransform:'uppercase', color: MUTED, flex:1 }}>Heightmap Lines</span>
          <button onClick={onReset} style={{ background:'none', border:`1px solid #52525b`, borderRadius:4, color:'#a1a1aa', fontSize:10, padding:'3px 7px', cursor:'pointer' }}>Reset</button>
        </div>

        <div id="hm-panel-body" style={{ flex:1, overflowX:'hidden', overflowY:'auto', scrollbarWidth:'thin', scrollbarColor:`${BORDER} transparent` }}>
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${BORDER}` }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
              <button className="hmload" onClick={loadFromPicker} style={{ padding:8, background: SURF, color:'#a1a1aa', border:`1px dashed ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11 }}>↑ PNG</button>
              <button className="hmload" onClick={loadGeoTiffFromPicker} style={{ padding:8, background: SURF, color:'#a1a1aa', border:`1px dashed ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11 }}>↑ GeoTIFF</button>
            </div>
            {heightmapFilename && (
              <div style={{ marginTop:5, fontSize:10, color: MUTED, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {heightmapFilename}
              </div>
            )}
          </div>

          <Section title="Terrain" open={sec.terrain} onToggle={() => tog('terrain')}>
            <Tog label="Raw terrain view" checked={view.showRawTerrain ?? false} onChange={v => sv({ showRawTerrain: v })} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 10px' }}>
              <Sl label="Resolution" min={1} max={20} value={terrain.resolution} onChange={v => st({ resolution: v })} />
              <Sl label="Elev scale" min={0} max={5} step={0.1} value={terrain.elevScale} onChange={v => st({ elevScale: v })} fmt={v => v.toFixed(1)+'×'} />
              <Sl label="Blur" min={0} max={10} step={0.5} value={terrain.blurRadius} onChange={v => st({ blurRadius: v })} fmt={v => v % 1 ? v.toFixed(1) : v} />
              <Sl label="Jitter" min={0} max={20} step={0.5} value={terrain.jitterAmt} onChange={v => st({ jitterAmt: v })} />
            </div>
            {terrain.resolution > 1 && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 10px' }}>
                <Sl label="Grid offset X" min={0} max={terrain.resolution - 1} value={Math.min(terrain.gridOffsetX ?? 0, terrain.resolution - 1)} onChange={v => st({ gridOffsetX: v })} />
                <Sl label="Grid offset Y" min={0} max={terrain.resolution - 1} value={Math.min(terrain.gridOffsetY ?? 0, terrain.resolution - 1)} onChange={v => st({ gridOffsetY: v })} />
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 10px' }}>
              <Sl label="Elev min cut" min={0} max={100} value={terrain.elevMinCut} onChange={v => st({ elevMinCut: v })} fmt={v => v+'%'} />
              <Sl label="Elev max cut" min={0} max={100} value={terrain.elevMaxCut} onChange={v => st({ elevMaxCut: v })} fmt={v => v+'%'} />
            </div>
          </Section>

          <Section title="Levels" open={sec.levels} onToggle={() => tog('levels')}>
            <Histogram pixels={heightmapPixels} blackPoint={terrain.blackPoint} whitePoint={terrain.whitePoint} onBlackChange={v => st({ blackPoint: v })} onWhiteChange={v => st({ whitePoint: v })} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 10px', marginTop:6 }}>
              <Sl label="Shadows" min={0} max={254} value={terrain.blackPoint} onChange={v => st({ blackPoint: v })} />
              <Sl label="Highlights" min={1} max={255} value={terrain.whitePoint} onChange={v => st({ whitePoint: v })} />
            </div>
          </Section>

          <Section title="View" open={sec.view} onToggle={() => tog('view')}>
            <div style={{ display:'flex', gap:4, marginBottom:6 }}>
              {[['Top', 'top'], ['Front', 'front'], ['Iso', 'iso'], ['Reset', 'reset']].map(([label, name]) => (
                <button key={name} onClick={() => onCameraPreset(name)} style={{ flex:1, fontSize:10, padding:'3px 0', border:`1px solid ${BORDER}`, borderRadius:3, cursor:'pointer', background: SURF, color: MUTED }}>{label}</button>
              ))}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 10px' }}>
              <Sl label="Tilt" hint="y/x" min={0} max={180} step={0.1} value={view.tilt} onChange={v => sv({ tilt: v })} fmt={v => v.toFixed(1)+'°'} />
              <Sl label="Zoom" min={10} max={400} value={Math.round(view.zoom * 100)} onChange={v => sv({ zoom: v / 100 })} fmt={v => v+'%'} />
            </div>
            <Sl label="Rotation" hint="e/r" min={-180} max={180} step={0.1} value={view.rotation} onChange={v => sv({ rotation: v })} fmt={v => v.toFixed(1)+'°'} />
            <Tog label="Auto-rotate" hint="q" checked={view.autoRotate} onChange={v => sv({ autoRotate: v })} />
            {view.autoRotate && (
              <Sub>
                <InlineSl label="Speed" min={0.1} max={10} step={0.1} value={view.autoRotateSpeed} onChange={v => sv({ autoRotateSpeed: v })} />
                <div style={{ display:'flex', gap:4 }}>
                  <span style={{ fontSize:10, color:MUTED, flex:1 }}>Direction</span>
                  {[['CW', 1],['CCW', -1]].map(([label, dir]) => (
                    <button key={label} onClick={() => sv({ autoRotateDir: dir })} 
                      style={{ 
                        fontSize:10, padding:'2px 10px', border:`1px solid ${BORDER}`, borderRadius:3, 
                        background: (view.autoRotateDir ?? 1) === dir ? ACCENT : SURF, 
                        color: (view.autoRotateDir ?? 1) === dir ? '#fff' : MUTED 
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </Sub>
            )}
            <Tog label="Center guides" hint="g" checked={view.showGuides} onChange={v => sv({ showGuides: v })} />
          </Section>

          <Section title="Style" open={sec.style} onToggle={() => tog('style')}>
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize:10, color: DIM, display:'block', marginBottom:5 }}>Style presets</span>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
                {Object.entries(STYLE_PRESETS).map(([name, preset]) => <button key={name} onClick={() => applyPreset(preset)} style={{ padding:'6px 4px', fontSize:10, background: SURF, color: DIM, border:`1px solid ${BORDER}`, borderRadius:4, cursor:'pointer' }}>{name}</button>)}
              </div>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                <span style={{ fontSize:10, color: DIM }}>Draw mode</span>
                <span style={{ fontSize:9, color: MUTED }}>f</span>
              </div>
              <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                {MODES.map(m => <button key={m.id} className={`hmsb${hasMode(m.id) ? ' on' : ''}`} onClick={() => toggleMode(m.id)} style={{ flex:1, padding:'5px 0', fontSize:11, background: hasMode(m.id) ? ACCENT : SURF, color: hasMode(m.id) ? '#fff' : MUTED, border:`1px solid ${hasMode(m.id) ? ACCENT : BORDER}`, borderRadius:4, cursor:'pointer' }}>{m.label}</button>)}
              </div>
            </div>

            <Sub>
              {(hasMode('lines-x') || hasMode('lines-y') || hasMode('crosshatch') || hasMode('pencil') || hasMode('z')) && <InlineSl label="Spacing" min={1} max={100} value={style.lineSpacing} onChange={v => ss({ lineSpacing: v })} />}
              {hasMode('flow') && <InlineSl label="Spacing" min={0.5} max={30} step={0.5} value={style.lineSpacing} onChange={v => ss({ lineSpacing: v })} />}
              {hasMode('hachure') && <><InlineSl label="T-Spacing" min={1} max={100} value={style.hachureSpacing} onChange={v => ss({ hachureSpacing: v })} /><InlineSl label="T-Length" min={0.1} max={5} step={0.1} value={style.hachureLength} onChange={v => ss({ hachureLength: v })} /></>}
              {hasMode('contours') && <InlineSl label="Interval" min={0.1} max={10} step={0.1} value={style.contourInterval} onChange={v => ss({ contourInterval: v })} fmt={v => v.toFixed(1)} />}
              {hasMode('flow') && <><InlineSl label="F-Step" min={0.1} max={3} step={0.1} value={style.flowStep} onChange={v => ss({ flowStep: v })} /><InlineSl label="F-Max" min={1} max={250} value={style.flowMaxLen} onChange={v => ss({ flowMaxLen: v })} /></>}
              {hasMode('dag') && <InlineSl label="Threshold" min={0.5} max={5} step={0.5} value={style.strahlerThreshold} onChange={v => ss({ strahlerThreshold: v })} />}
              {hasMode('pencil') && <InlineSl label="P-Threshold" min={0.1} max={5} step={0.1} value={style.curvatureThreshold} onChange={v => ss({ curvatureThreshold: v })} />}
            </Sub>

            <TogColor label="Lines" checked={style.showLines} onToggle={v => ss({ showLines: v })} color={style.lineColor} onColor={v => ss({ lineColor: v })} />
            {style.showLines && (
              <Sub>
                <InlineSl label="Weight" min={0.5} max={10} step={0.5} value={style.strokeWeight} onChange={v => ss({ strokeWeight: v })} />
                <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style.lineOpacity ?? 1} onChange={v => ss({ lineOpacity: v })} fmt={v => Math.round(v*100)+'%'} />
                <Tog label="Occlusion" help="When ON, lines hidden behind mountains are invisible. When OFF, all lines are visible (wireframe look)." checked={style.depthOcclusion} onChange={v => ss({ depthOcclusion: v })} small />
                <Tog label="Hypsometric color" small checked={style.lineHypsometric} onChange={v => ss({ lineHypsometric: v })} />
                {style.lineHypsometric && (
                  <Sub>
                    <div style={{ display:'flex', gap:2, marginBottom:6 }}>
                      {['Elevation', 'Slope', 'Aspect'].map(m => <button key={m} onClick={() => ss({ lineHypsoMode: m.toLowerCase() })} style={{ flex:1, fontSize:8, padding:'2px 0', borderRadius:2, background: style.lineHypsoMode === m.toLowerCase() ? ACCENT : SURF, color: style.lineHypsoMode === m.toLowerCase() ? '#fff' : MUTED, border:`1px solid ${style.lineHypsoMode === m.toLowerCase() ? ACCENT : BORDER}` }}>{m}</button>)}
                    </div>
                    <Tog label="Banded" small checked={style.lineBanded} onChange={v => ss({ lineBanded: v })} />
                    {style.lineBanded && <InlineSl label="Band Dist" min={0.5} max={50} value={style.lineHypsoInterval} onChange={v => ss({ lineHypsoInterval: v })} />}
                  </Sub>
                )}
              </Sub>
            )}

            <TogColor label="Fill" checked={style.showFill} onToggle={v => ss({ showFill: v })} color={style.fillColor} onColor={v => ss({ fillColor: v })} />
            {style.showFill && (
              <Sub>
                <Tog label="Hypsometric fill" small checked={style.fillHypsometric} onChange={v => ss({ fillHypsometric: v })} />
                {style.fillHypsometric && (
                  <Sub>
                    <div style={{ display:'flex', gap:2, marginBottom:6 }}>
                      {['Elevation', 'Slope', 'Aspect'].map(m => <button key={m} onClick={() => ss({ fillHypsoMode: m.toLowerCase() })} style={{ flex:1, fontSize:8, padding:'2px 0', borderRadius:2, background: style.fillHypsoMode === m.toLowerCase() ? ACCENT : SURF, color: style.fillHypsoMode === m.toLowerCase() ? '#fff' : MUTED, border:`1px solid ${style.fillHypsoMode === m.toLowerCase() ? ACCENT : BORDER}` }}>{m}</button>)}
                    </div>
                    <Tog label="Banded" small checked={style.fillBanded} onChange={v => ss({ fillBanded: v })} />
                    {style.fillBanded && <><InlineSl label="Band Dist" min={0.5} max={50} value={style.fillHypsoInterval} onChange={v => ss({ fillHypsoInterval: v })} /><InlineSl label="Band Weight" min={0} max={5} step={0.5} value={style.fillHypsoWeight} onChange={v => ss({ fillHypsoWeight: v })} /></>}
                  </Sub>
                )}
              </Sub>
            )}

            {style.fillHypsometric || style.lineHypsometric ? (
              <div style={{ marginBottom: 10, marginTop: 10 }}>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4, marginBottom:8 }}>
                  {Object.keys(GRADIENT_PRESETS).map(name => <button key={name} onClick={() => setGradientStops(GRADIENT_PRESETS[name])} style={{ fontSize:9, padding:'3px 0', background: SURF, color: MUTED, border:`1px solid ${BORDER}`, borderRadius:3, cursor:'pointer' }}>{name}</button>)}
                </div>
                <GradientPicker stops={gradientStops} onChange={setGradientStops} />
              </div>
            ) : null}

            <TogColor label="Mesh" checked={style.showMesh} onToggle={v => ss({ showMesh: v })} color={style.meshColor} onColor={v => ss({ meshColor: v })} />
            
            <ColorRow label="Background" value={style.bgColor} onChange={v => ss({ bgColor: v })} />
            <Sub>
              <Tog label="Gradient" small checked={style.bgGradient} onChange={v => ss({ bgGradient: v })} />
              {style.bgGradient && <GradientPicker stops={bgGradientStops} onChange={setBgGradientStops} />}
            </Sub>
          </Section>

          <Section title="Texture" open={sec.texture} onToggle={() => tog('texture')}>
            <Tog label="Texture overlay" checked={style.showTexture} onChange={v => ss({ showTexture: v })} />
            {style.showTexture && (
              <Sub>
                <button className="hmload" onClick={handleTexturePicker} style={{ 
                  width:'100%', padding:8, marginBottom:10, background: SURF, color: DIM, 
                  border:`1px dashed ${BORDER}`, borderRadius:5, fontSize:11, cursor:'pointer' 
                }}>
                  {textureImage ? 'Change Texture' : '↑ Upload Image'}
                </button>
                {textureImage && (
                  <>
                    <InlineSl label="Scale" min={0.1} max={10} step={0.1} value={style.textureScale} onChange={v => ss({ textureScale: v })} />
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
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

          <Section title="Creative" open={sec.creative} onToggle={() => tog('creative')}>
            <div style={{ fontSize:9, color:MUTED, fontWeight:700, marginBottom:12, letterSpacing:1, textAlign:'center' }}>3D SYMMETRY (6-WAY)</div>
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
            <div style={{ fontSize:9, color:MUTED, textAlign:'center', marginTop:14, opacity:0.7, lineHeight:1.4 }}>
              Click arrows to toggle symmetry.<br/>Combine directions for kaleidoscopic effects.
            </div>
          </Section>

          <Section title="Particles" open={sec.points} onToggle={() => tog('points')}>
            <TogColor label="Particles" checked={points.showPoints} onToggle={v => sp({ showPoints: v })} color={points.pointColor} onColor={v => sp({ pointColor: v })} />
            {points.showPoints && (
              <Sub>
                <InlineSl label="Size" min={0.5} max={20} step={0.5} value={points.pointSize} onChange={v => sp({ pointSize: v })} />
                <Tog label="Peaks & valleys only" small checked={points.particlePeaksOnly ?? false} onChange={v => sp({ particlePeaksOnly: v })} />
                <Tog label="Animate" small checked={points.animateParticles} onChange={v => sp({ animateParticles: v })} />
                {points.animateParticles && (
                  <Sub>
                    <InlineSl label="Noise"   min={0}   max={5}    step={0.1} value={points.particleNoise}   onChange={v => sp({ particleNoise: v })}   fmt={v => v.toFixed(1)} />
                    <InlineSl label="Damping" min={0.5} max={0.99} step={0.01} value={points.particleDamping} onChange={v => sp({ particleDamping: v })} fmt={v => v.toFixed(2)} />
                    <Tog label="Gravity" small checked={points.particleGravity} onChange={v => sp({ particleGravity: v })} />
                    {points.particleGravity && (
                      <Sub>
                        <InlineSl label="Strength" min={0.1} max={10} step={0.1} value={points.particleGravityStr} onChange={v => sp({ particleGravityStr: v })} fmt={v => v.toFixed(1)} />
                      </Sub>
                    )}
                  </Sub>
                )}
              </Sub>
            )}
          </Section>

          <Section title="Hydraulic Erosion" open={sec.erosion} onToggle={() => tog('erosion')}>
            <Sub>
              <InlineSl label="Iterations" help="Total number of raindrops to simulate. More iterations = more detailed drainage." min={1000} max={200000} step={1000} value={eIters} onChange={v => setEIters(v)} fmt={v => (v/1000).toFixed(0)+'k'} />
              <InlineSl label="Radius" help="The width of the erosion brush. Large values create smooth valleys; small values create sharp ravines." min={2} max={10} value={eRadius} onChange={v => setERadius(v)} />
              <InlineSl label="Inertia" help="Droplet momentum. High values make water prefer its current direction (smooth curves); low values follow the gradient strictly (jittery)." min={0.01} max={0.5} step={0.01} value={eInertia} onChange={v => setEInertia(v)} fmt={v => v.toFixed(2)} />
              <InlineSl label="Capacity" help="Multiplier for how much sediment a droplet can carry based on its speed and slope." min={1} max={20} step={0.5} value={eCapacity} onChange={v => setECapacity(v)} />
              <InlineSl label="Erosion" help="How aggressively the droplet removes soil from the terrain." min={0.01} max={1} step={0.01} value={eErode} onChange={v => setEErode(v)} fmt={v => v.toFixed(2)} />
              <InlineSl label="Deposition" help="How fast the droplet drops its sediment when it slows down or enters a basin." min={0.01} max={1} step={0.01} value={eDeposit} onChange={v => setEDeposit(v)} fmt={v => v.toFixed(2)} />
              <InlineSl label="Evaporation" help="The rate at which the droplet shrinks. Smaller droplets carry less sediment." min={0.001} max={0.1} step={0.001} value={eEvap} onChange={v => setEEvap(v)} fmt={v => v.toFixed(3)} />
            </Sub>
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={handleRunErosion} disabled={!heightmapPixels || isEroding} style={{ flex:2, padding:'8px 0', background: ACCENT, color:'#fff', border:'none', borderRadius:5, cursor: (heightmapPixels && !isEroding) ? 'pointer' : 'default', fontSize:11, fontWeight:600, opacity: (heightmapPixels && !isEroding) ? 1 : 0.5 }}>{isEroding ? 'Eroding...' : 'Run Erosion'}</button>
              <button onClick={handleUndoErosion} disabled={!lastPixels || isEroding} style={{ flex:1, padding:'8px 0', background: SURF, color: DIM, border:`1px solid ${BORDER}`, borderRadius:5, cursor: (lastPixels && !isEroding) ? 'pointer' : 'default', fontSize:11, fontWeight:600, opacity: (lastPixels && !isEroding) ? 1 : 0.5 }}>Undo</button>
            </div>
          </Section>

          <Section title="Export" open={sec.export} onToggle={() => tog('export')}>
            <div style={{ display:'flex', gap:5, marginBottom:6 }}>
              <ExpBtn label="SVG" hint="1" onClick={onSvg} /><ExpBtn label="PNG" hint="2" onClick={onPng} /><ExpBtn label="PNG α" hint="3" onClick={onPngAlpha} /><ExpBtn label="STL" hint="4" onClick={onStl} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:5, marginBottom:6 }}>
              <ExpBtn label={webmActive ? '⏹ Stop' : 'WebM'} hint={webmActive ? '' : '5'} onClick={onWebmToggle} active={webmActive} />
              <ExpBtn label="Hmap" hint="save" onClick={onHeightmap} />
              <ExpBtn label="Preset ⬇" hint="save" onClick={onSavePreset} />
              <ExpBtn label="Preset ⬆" hint="load" onClick={onLoadPreset} />
            </div>
            <InlineSl label="WebM dur." min={1} max={60} value={webmDuration} onChange={setWebmDuration} fmt={v => v+'s'} />
          </Section>

          {/* ── Stats ─────────────────────────────────────────────────────── */}
          <div style={{ padding:'10px 14px 4px', fontSize:10, color: MUTED, fontVariantNumeric:'tabular-nums', lineHeight:1.9 }}>
            <div>Segments: {segs} · Verts: {verts}</div>
            <div>Triangles: {tris} · Grid: {grid}</div>
            {geoTiffElevMin != null && geoTiffElevMax != null && (
              <div style={{ marginTop:3, color: MUTED }}>
                Elevation: {Math.round(geoTiffElevMin)} – {Math.round(geoTiffElevMax)} m
                &nbsp;(Δ {Math.round(geoTiffElevMax - geoTiffElevMin)} m)
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
