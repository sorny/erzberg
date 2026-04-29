/**
 * Custom right-hand control panel — design mirrors the original p5.js tool.
 */
import { useEffect, useRef, useState } from 'react'
import { version } from '../../package.json'
import { useStore } from '../store/useStore'
import ErosionWorker from '../utils/erosion.worker?worker'
import { GRADIENT_PRESETS } from '../utils/gradientPresets'
import { GradientPicker } from './GradientPicker'
import { Histogram } from './Histogram'

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG     = '#18181b'
const SURF   = '#27272a'
const BORDER = '#3f3f46'
const TEXT   = '#e4e4e7'
const DIM    = '#d4d4d8'
const MUTED  = '#71717a'
const ACCENT = '#3b82f6'
const GREEN  = '#22c55e'
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
          {label}{hint && <span style={{ fontSize: fs - 1, color: MUTED, marginLeft: 6 }}> {hint}</span>}
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

function Section({ title, open, onToggle, enabled, children }) {
  return (
    <div style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div onClick={onToggle} style={{
        display:'flex', justifyContent:'space-between', alignItems:'center',
        padding:'10px 14px', cursor:'pointer', userSelect:'none',
      }}>
        <span style={{ fontSize:9, fontWeight:700, letterSpacing:'1.8px', textTransform:'uppercase', color: MUTED, display:'flex', alignItems:'center' }}>
          {enabled && <span style={{ width:6, height:6, borderRadius:'50%', background: GREEN, marginRight:8, boxShadow:`0 0 6px ${GREEN}88` }} />}
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

// ── Helper for per-mode styling ───────────────────────────────────────────────
function ModeStyleOverride({ prefix, style, ss, label = 'LINE STYLE', showDash = true }) {
  const isHypso = style[`hypso${prefix}`]
  return (
    <div style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
      <div style={{ fontSize: 8, color: MUTED, fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>{label}</div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: DIM }}>Base Color</span>
        <input type="color" className="hmc" value={style[`color${prefix}`]} onChange={e => ss({ [`color${prefix}`]: e.target.value })} />
      </div>
      <InlineSl label="Weight" min={0.5} max={10} step={0.5} value={style[`weight${prefix}`]} onChange={v => ss({ [`weight${prefix}`]: v })} />
      <InlineSl label="Opacity" min={0} max={1} step={0.01} value={style[`opacity${prefix}`]} onChange={v => ss({ [`opacity${prefix}`]: v })} fmt={v => Math.round(v*100)+'%'} />

      {showDash && (
        <div style={{ marginTop: 8, display:'flex', gap:2 }}>
          {['solid', 'dashed', 'dotted', 'long-dash'].map(d => (
            <button key={d} onClick={() => ss({ [`dash${prefix}`]: d })}
              style={{
                flex:1, fontSize:7, padding:'3px 0', borderRadius:2, textTransform:'uppercase',
                background: style[`dash${prefix}`] === d ? ACCENT : SURF,
                color: style[`dash${prefix}`] === d ? '#fff' : MUTED,
                border:`1px solid ${style[`dash${prefix}`] === d ? ACCENT : BORDER}`
              }}>{d.replace('-dash','')}</button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <Tog label="Hypsometric" small checked={isHypso} onChange={v => ss({ [`hypso${prefix}`]: v })} />
        {isHypso && (
          <Sub>
            <div style={{ display:'flex', gap:2, marginBottom:6 }}>
              {['Elevation', 'Slope', 'Aspect'].map(m => (
                <button key={m} onClick={() => ss({ [`hypsoMode${prefix}`]: m.toLowerCase() })} 
                  style={{ 
                    flex:1, fontSize:8, padding:'2px 0', borderRadius:2, 
                    background: style[`hypsoMode${prefix}`] === m.toLowerCase() ? ACCENT : SURF, 
                    color: style[`hypsoMode${prefix}`] === m.toLowerCase() ? '#fff' : MUTED, 
                    border:`1px solid ${style[`hypsoMode${prefix}`] === m.toLowerCase() ? ACCENT : BORDER}` 
                  }}>{m}</button>
              ))}
            </div>
            <Tog label="Banded" small checked={style[`hypsoBanded${prefix}`]} onChange={v => ss({ [`hypsoBanded${prefix}`]: v })} />
            {style[`hypsoBanded${prefix}`] && <InlineSl label="Band Dist" min={0.5} max={50} value={style[`hypsoInterval${prefix}`]} onChange={v => ss({ [`hypsoInterval${prefix}`]: v })} />}
          </Sub>
        )}
      </div>
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
  geoTiffElevMin, geoTiffElevMax,
  onCameraPreset,
  onSvg, onPng, onPngAlpha, onStl, onHeightmap,
  onWebmToggle, webmActive,
  webmDuration, setWebmDuration,
  onSavePreset, onLoadPreset,
  externalPresets,
  onReset,
  baseZoom = 1,
  lineGeo, surfaceGeo, terrainData,
}) {
  const [open, setOpen]     = useState(true)
  const [sec, setSec]       = useState({
    terrain: true, levels: true, view: true, camera: false, presets: true, style: true,
    modeX: true, modeY: false, modeCross: false, modePillars: false, modeContours: false,
    modeHachure: false, modeFlow: false, modeDag: false, modePencil: false,
    modeRidge: false, modeValley: false, modeStipple: false,
    hillshade: false, slopeShade: false,
    points: false, texture: false, mirror: false, erosion: false, export: true,
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
  const erosionWorkerRef = useRef(null)
  
  const setPixels = useStore(s => s.setPixels)
  const setHeightmap = useStore(s => s.setHeightmap)
  const heightmapWidth = useStore(s => s.heightmapWidth)
  const heightmapHeight = useStore(s => s.heightmapHeight)
  const nodataMask = useStore(s => s.nodataMask)

  const handleRunErosion = () => {
    if (!heightmapPixels || isEroding) return
    setLastPixels(new Float32Array(heightmapPixels))
    setIsEroding(true)
    setErosionProgress(0)

    const worker = new ErosionWorker()
    erosionWorkerRef.current = worker

    worker.onmessage = (e) => {
      const { progress, result, error } = e.data
      if (progress !== undefined) { setErosionProgress(progress); return }
      if (result) setPixels(result)
      if (error) console.error('[ErosionWorker]', error)
      setIsEroding(false)
      setErosionProgress(0)
      worker.terminate()
      erosionWorkerRef.current = null
    }

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

  const handleUndoErosion = () => {
    if (!lastPixels) return
    setPixels(lastPixels)
    setLastPixels(null)
  }

  useEffect(() => () => { erosionWorkerRef.current?.terminate() }, [])

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

  const handleMirrorX = () => {
    if (!heightmapPixels) return
    const W = heightmapWidth
    const H = heightmapHeight
    const newW = W * 2
    const nextPixels = new Float32Array(newW * H)
    const nextMask = nodataMask ? new Uint8Array(newW * H) : null

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sourceIdx = y * W + x
        const destIdxL = y * newW + (W - 1 - x)
        nextPixels[destIdxL] = heightmapPixels[sourceIdx]
        if (nextMask) nextMask[destIdxL] = nodataMask[sourceIdx]
        const destIdxR = y * newW + (W + x)
        nextPixels[destIdxR] = heightmapPixels[sourceIdx]
        if (nextMask) nextMask[destIdxR] = nodataMask[sourceIdx]
      }
    }
    setHeightmap(nextPixels, nextMask, newW, H, heightmapFilename + ' (mirrored X)')
  }

  const handleMirrorY = () => {
    if (!heightmapPixels) return
    const W = heightmapWidth
    const H = heightmapHeight
    const newH = H * 2
    const nextPixels = new Float32Array(W * newH)
    const nextMask = nodataMask ? new Uint8Array(W * newH) : null

    for (let y = 0; y < H; y++) {
      const sourceRowOff = y * W
      const destRowOffT = (H - 1 - y) * W
      for (let x = 0; x < W; x++) {
        nextPixels[destRowOffT + x] = heightmapPixels[sourceRowOff + x]
        if (nextMask) nextMask[destRowOffT + x] = nodataMask[sourceRowOff + x]
      }
      const destRowOffB = (H + y) * W
      for (let x = 0; x < W; x++) {
        nextPixels[destRowOffB + x] = heightmapPixels[sourceRowOff + x]
        if (nextMask) nextMask[destRowOffB + x] = nodataMask[sourceRowOff + x]
      }
    }
    setHeightmap(nextPixels, nextMask, W, newH, heightmapFilename + ' (mirrored Y)')
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

  const syncSectionsToStyle = (newStyle) => {
    setSec(prev => ({
      ...prev,
      modeX:        !!newStyle.enabledX,
      modeY:        !!newStyle.enabledY,
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
    }))
  }

  const applyPreset = (preset) => {
    setStyle(prev => ({ ...prev, ...preset.style }))
    if (preset.gradientStops) setGradientStops(preset.gradientStops)
    if (preset.bgGradientStops) setBgGradientStops(preset.bgGradientStops)
    syncSectionsToStyle(preset.style)
  }

  // Stats
  let totalLinePos = 0
  if (Array.isArray(lineGeo)) {
    for (const L of lineGeo) {
      if (L.positions) totalLinePos += L.positions.length
    }
  }

  const segs  = lineGeo    ? (totalLinePos / 6).toLocaleString()     : '–'
  const verts = lineGeo    ? (totalLinePos / 3).toLocaleString()     : '–'
  const tris  = surfaceGeo ? (surfaceGeo.indices.length  / 3).toLocaleString()   : '–'
  const grid  = terrainData ? `${terrainData.cols}×${terrainData.rows}` : '–'

  return (
    <>
      <PanelStyles />

      <div data-testid="sidebar-toggle" onClick={() => setOpen(o => !o)} style={{
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
        <div style={{ padding:'12px 14px 11px', borderBottom:`1px solid ${BORDER}`, flexShrink:0, display:'flex', alignItems:'baseline', gap:8 }}>
          <span style={{ fontFamily:"'Space Mono', monospace", fontSize:13, fontWeight:700, letterSpacing:'-0.02em', color:'#F0EBE3' }}>erzberg</span>
          <span style={{ fontSize:9, color: MUTED, fontWeight:600, opacity: 0.8 }}>v{version}</span>
          <div style={{ flex: 1 }} />
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
              <Sl label="Elev scale" min={-5} max={5} step={0.1} value={terrain.elevScale} onChange={v => st({ elevScale: v })} fmt={v => (v >= 0 ? '+' : '') + v.toFixed(1)} />
              <Sl label="Blur" min={0} max={10} step={0.5} value={terrain.blurRadius} onChange={v => st({ blurRadius: v })} fmt={v => v % 1 ? v.toFixed(1) : v} />
              <Sl label="Jitter" min={0} max={20} step={0.5} value={terrain.jitterAmt} onChange={v => st({ jitterAmt: v })} />
            </div>
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
              <Sl label="Zoom" min={10} max={400} value={Math.round((view.zoom / baseZoom) * 100)} onChange={v => sv({ zoom: (v / 100) * baseZoom })} fmt={v => v+'%'} />
            </div>
            <Sl label="Rotation" hint="e/r" min={-180} max={180} step={0.1} value={view.rotation} onChange={v => sv({ rotation: v })} fmt={v => v.toFixed(1)+'°'} />
            <Tog label="Auto-rotate" hint="q" checked={view.autoRotate} onChange={v => sv({ autoRotate: v })} />
            {view.autoRotate && (
              <Sub>
                <InlineSl label="Speed" min={0.01} max={2} step={0.01} value={view.autoRotateSpeed} onChange={v => sv({ autoRotateSpeed: v })} />
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

          <Section title="Camera" open={sec.camera} onToggle={() => tog('camera')}>
            <Sub>
              <Tog label="Orthographic" help="Architectural projection with no perspective distortion." checked={view.orthographic} onChange={v => sv({ orthographic: v })} />
              {!view.orthographic && (
                <InlineSl label="Focal Len" min={10} max={120} value={view.fov} onChange={v => sv({ fov: v })} fmt={v => Math.round(v)} />
              )}
              <InlineSl label="Pan X" min={-1000} max={1000} value={view.panX ?? 0} onChange={v => sv({ panX: v })} />
              <InlineSl label="Pan Y" min={-1000} max={1000} value={view.panY ?? 0} onChange={v => sv({ panY: v })} />
            </Sub>
          </Section>

          {/* ── Presets ────────────────────────────────────────────────────── */}

          <Section title="Presets" open={sec.presets} onToggle={() => tog('presets')}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
              {Object.entries(externalPresets || {}).map(([name, preset]) => <button key={name} onClick={() => applyPreset(preset)} style={{ padding:'6px 4px', fontSize:10, background: SURF, color: DIM, border:`1px solid ${BORDER}`, borderRadius:4, cursor:'pointer' }}>{name}</button>)}
            </div>
          </Section>

          {/* ── Global Style ───────────────────────────────────────────────── */}

          <Section title="Terrain Style" open={sec.style} onToggle={() => tog('style')}>
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
            <TogColor label="Occlusion" help="Hide or ghost lines behind terrain. Set opacity to 0% to hide completely." checked={style.depthOcclusion} onToggle={v => ss({ depthOcclusion: v })} color={style.occlusionColor} onColor={v => ss({ occlusionColor: v })} />
            {style.depthOcclusion && (
              <Sub>
                <InlineSl label="Occ. Dist" help="Depth tolerance. Higher values allow lines to peek through the surface." min={0} max={25} step={0.1} value={style.occlusionBias} onChange={v => ss({ occlusionBias: v })} fmt={v => v.toFixed(1)} />
                <InlineSl label="Ghost Opac" help="Opacity of lines hidden behind mountains. 0% = hidden, 100% = fully visible." min={0} max={1} step={0.01} value={style.occlusionOpacity} onChange={v => ss({ occlusionOpacity: v })} fmt={v => Math.round(v*100)+'%'} />
              </Sub>
            )}
            
            <ColorRow label="Background" value={style.bgColor} onChange={v => ss({ bgColor: v })} />
            <Sub>
              <Tog label="Gradient" small checked={style.bgGradient} onChange={v => ss({ bgGradient: v })} />
              {style.bgGradient && <GradientPicker stops={bgGradientStops} onChange={setBgGradientStops} isSimple />}
            </Sub>
          </Section>

          {/* ── Hillshade ──────────────────────────────────────────────────── */}

          <Section title="Hillshade" open={sec.hillshade} onToggle={() => tog('hillshade')} enabled={style.showHillshade}>
            <Tog label="Enabled" checked={style.showHillshade} onChange={v => ss({ showHillshade: v })} />
            {style.showHillshade && (
              <Sub>
                <InlineSl label="Azimuth" help="Light direction: 0°=N, 90°=E, 315°=NW (classic)." min={0} max={360} step={5} value={style.hillshadeAzimuth} onChange={v => ss({ hillshadeAzimuth: v })} fmt={v => Math.round(v) + '°'} />
                <InlineSl label="Altitude" help="Sun angle above the horizon. 45° is classic; 90° is directly overhead." min={0} max={90} step={1} value={style.hillshadeAltitude} onChange={v => ss({ hillshadeAltitude: v })} fmt={v => Math.round(v) + '°'} />
                <InlineSl label="Intensity" min={0} max={3} step={0.05} value={style.hillshadeIntensity} onChange={v => ss({ hillshadeIntensity: v })} fmt={v => v.toFixed(2)} />
                <InlineSl label="Opacity" help="Blend strength over the fill colour." min={0} max={1} step={0.01} value={style.hillshadeOpacity} onChange={v => ss({ hillshadeOpacity: v })} fmt={v => Math.round(v * 100) + '%'} />
                <InlineSl label="Exaggeration" help="Amplifies normals for dramatic relief at low elevation scales." min={0.1} max={10} step={0.1} value={style.hillshadeExaggeration} onChange={v => ss({ hillshadeExaggeration: v })} fmt={v => v.toFixed(1)} />
                <ColorRow label="Highlight" value={style.hillshadeHighlightColor} onChange={v => ss({ hillshadeHighlightColor: v })} />
                <ColorRow label="Shadow" value={style.hillshadeShadowColor} onChange={v => ss({ hillshadeShadowColor: v })} />
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

          {/* ── DRAW MODES ─────────────────────────────────────────────────── */}

          <Section title="Mode: X Lines" open={sec.modeX} onToggle={() => tog('modeX')} enabled={style.enabledX}>
            <Tog label="Enabled" checked={style.enabledX} onChange={v => ss({ enabledX: v })} />
            {style.enabledX && (
              <>
                <Sub>
                  <InlineSl label="X-Spacing" min={1} max={100} value={style.spacingX} onChange={v => ss({ spacingX: v })} />
                  <InlineSl label="X-Shift" min={0} max={100} value={style.shiftX} onChange={v => ss({ shiftX: v })} />
                </Sub>
                <ModeStyleOverride prefix="X" style={style} ss={ss} />
              </>
            )}
          </Section>

          <Section title="Mode: Y Lines" open={sec.modeY} onToggle={() => tog('modeY')} enabled={style.enabledY}>
            <Tog label="Enabled" checked={style.enabledY} onChange={v => ss({ enabledY: v })} />
            {style.enabledY && (
              <>
                <Sub>
                  <InlineSl label="Y-Spacing" min={1} max={100} value={style.spacingY} onChange={v => ss({ spacingY: v })} />
                  <InlineSl label="Y-Shift" min={0} max={100} value={style.shiftY} onChange={v => ss({ shiftY: v })} />
                </Sub>
                <ModeStyleOverride prefix="Y" style={style} ss={ss} />
              </>
            )}
          </Section>

          <Section title="Mode: Crosshatch" open={sec.modeCross} onToggle={() => tog('modeCross')} enabled={style.enabledCross}>
            <Tog label="Enabled" checked={style.enabledCross} onChange={v => ss({ enabledCross: v })} />
            {style.enabledCross && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingCross} onChange={v => ss({ spacingCross: v })} />
                </Sub>
                <ModeStyleOverride prefix="Cross" style={style} ss={ss} />
              </>
            )}
          </Section>

          <Section title="Mode: Pillars" open={sec.modePillars} onToggle={() => tog('modePillars')} enabled={style.enabledPillars}>
            <Tog label="Enabled" checked={style.enabledPillars} onChange={v => ss({ enabledPillars: v })} />
            {style.enabledPillars && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingPillars} onChange={v => ss({ spacingPillars: v })} />
                  <InlineSl label="Gap" min={0} max={20} step={0.5} value={style.pillarGap} onChange={v => ss({ pillarGap: v })} />
                  <InlineSl label="Depth" min={0} max={100} step={1} value={style.pillarDepth} onChange={v => ss({ pillarDepth: v })} />
                  <div style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: MUTED, display: 'block', marginBottom: 4 }}>Shape</span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {[['Line', 'line'], ['Cuboid', 'cuboid'], ['Cylinder', 'cylinder']].map(([label, val]) => (
                        <button key={val} onClick={() => ss({ pillarStyle: val })} style={{
                          flex: 1, fontSize: 9, padding: '3px 0', borderRadius: 2,
                          background: (style.pillarStyle ?? 'line') === val ? ACCENT : SURF,
                          color: (style.pillarStyle ?? 'line') === val ? '#fff' : MUTED,
                          border: `1px solid ${(style.pillarStyle ?? 'line') === val ? ACCENT : BORDER}`,
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
                <ModeStyleOverride prefix="Pillars" style={style} ss={ss} />
              </>
            )}
          </Section>

          <Section title="Mode: Contours" open={sec.modeContours} onToggle={() => tog('modeContours')} enabled={style.enabledContours}>
            <Tog label="Enabled" checked={style.enabledContours} onChange={v => ss({ enabledContours: v })} />
            {style.enabledContours && (
              <>
                <Sub>
                  {hasGeoTiff ? (
                    <InlineSl label="Interval (m)" min={0.1} max={100} step={0.1} value={style.intervalContours} onChange={v => ss({ intervalContours: v })} fmt={v => v.toFixed(1)+'m'} />
                  ) : (
                    <InlineSl label="Interval" min={0.1} max={10} step={0.1} value={style.intervalContours} onChange={v => ss({ intervalContours: v })} fmt={v => v.toFixed(1)} />
                  )}
                  <InlineSl label="Major Every" min={0} max={50} step={1} value={style.majorIntervalContours} onChange={v => ss({ majorIntervalContours: v })} fmt={v => v === 0 ? 'None' : 'Every '+v} />
                  {style.majorIntervalContours > 1 && (
                    <InlineSl label="Major Offset" min={1} max={style.majorIntervalContours} step={1} value={style.majorOffsetContours} onChange={v => ss({ majorOffsetContours: v })} />
                  )}
                  <InlineSl label="Major Weight" min={0.5} max={10} step={0.5} value={style.majorWeightContours} onChange={v => ss({ majorWeightContours: v })} />
                </Sub>
                <ModeStyleOverride prefix="Contours" style={style} ss={ss} />
              </>
            )}
          </Section>

          <Section title="Mode: Hachure" open={sec.modeHachure} onToggle={() => tog('modeHachure')} enabled={style.enabledHachure}>
            <Tog label="Enabled" checked={style.enabledHachure} onChange={v => ss({ enabledHachure: v })} />
            {style.enabledHachure && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingHachure} onChange={v => ss({ spacingHachure: v })} />
                  <InlineSl label="Length" min={0.1} max={5} step={0.1} value={style.lengthHachure} onChange={v => ss({ lengthHachure: v })} />
                </Sub>
                <ModeStyleOverride prefix="Hachure" style={style} ss={ss} />
              </>
            )}
          </Section>

          <Section title="Mode: Flow" open={sec.modeFlow} onToggle={() => tog('modeFlow')} enabled={style.enabledFlow}>
            <Tog label="Enabled" checked={style.enabledFlow} onChange={v => ss({ enabledFlow: v })} />
            {style.enabledFlow && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={0.5} max={30} step={0.5} value={style.spacingFlow} onChange={v => ss({ spacingFlow: v })} />
                  <InlineSl label="Step" min={0.1} max={3} step={0.1} value={style.stepFlow} onChange={v => ss({ stepFlow: v })} />
                  <InlineSl label="Max Len" min={1} max={250} value={style.maxLenFlow} onChange={v => ss({ maxLenFlow: v })} />
                </Sub>
                <ModeStyleOverride prefix="Flow" style={style} ss={ss} />
              </>
            )}
          </Section>

          <Section title="Mode: Network" open={sec.modeDag} onToggle={() => tog('modeDag')} enabled={style.enabledDag}>
            <Tog label="Enabled" checked={style.enabledDag} onChange={v => ss({ enabledDag: v })} />
            {style.enabledDag && (
              <>
                <Sub>
                  <InlineSl label="Threshold" min={1} max={10} step={1} value={style.thresholdDag} onChange={v => ss({ thresholdDag: v })} />
                </Sub>
                <ModeStyleOverride prefix="Dag" style={style} ss={ss} />
              </>
            )}
          </Section>

          <Section title="Mode: Pencil" open={sec.modePencil} onToggle={() => tog('modePencil')} enabled={style.enabledPencil}>
            <Tog label="Enabled" checked={style.enabledPencil} onChange={v => ss({ enabledPencil: v })} />
            {style.enabledPencil && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingPencil} onChange={v => ss({ spacingPencil: v })} />
                  <InlineSl label="Threshold" min={0.1} max={5} step={0.1} value={style.thresholdPencil} onChange={v => ss({ thresholdPencil: v })} />
                </Sub>
                <ModeStyleOverride prefix="Pencil" style={style} ss={ss} />
              </>
            )}
          </Section>

          <Section title="Mode: Ridge" open={sec.modeRidge} onToggle={() => tog('modeRidge')} enabled={style.enabledRidge}>
            <Tog label="Enabled" checked={style.enabledRidge} onChange={v => ss({ enabledRidge: v })} />
            {style.enabledRidge && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={10} value={style.spacingRidge} onChange={v => ss({ spacingRidge: v })} />
                  <InlineSl label="Radius" min={0.2} max={2} step={0.1} value={style.radiusRidge} onChange={v => ss({ radiusRidge: v })} />
                  <InlineSl label="Threshold" min={0.005} max={0.5} step={0.005} value={style.thresholdRidge} onChange={v => ss({ thresholdRidge: v })} />
                </Sub>
                <ModeStyleOverride prefix="Ridge" style={style} ss={ss} />
              </>
            )}
          </Section>

          <Section title="Mode: Valley" open={sec.modeValley} onToggle={() => tog('modeValley')} enabled={style.enabledValley}>
            <Tog label="Enabled" checked={style.enabledValley} onChange={v => ss({ enabledValley: v })} />
            {style.enabledValley && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={10} value={style.spacingValley} onChange={v => ss({ spacingValley: v })} />
                  <InlineSl label="Radius" min={1} max={20} step={1} value={style.radiusValley} onChange={v => ss({ radiusValley: v })} />
                  <InlineSl label="Threshold" min={0.005} max={5} step={0.005} value={style.thresholdValley} onChange={v => ss({ thresholdValley: v })} />
                </Sub>
                <ModeStyleOverride prefix="Valley" style={style} ss={ss} />
              </>
            )}
          </Section>

          <Section title="Mode: Stipple Dots" open={sec.modeStipple} onToggle={() => tog('modeStipple')} enabled={style.enabledStipple}>
            <Tog label="Enabled" checked={style.enabledStipple} onChange={v => ss({ enabledStipple: v })} />
            {style.enabledStipple && (
              <>
                <Sub>
                  <InlineSl label="Spacing" help="Grid pitch between candidate dots. Smaller = denser maximum." min={0.05} max={2} step={0.05} value={style.spacingStipple} onChange={v => ss({ spacingStipple: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Gamma" help="Density curve exponent. >1 pushes dots toward high-density areas; <1 spreads them more evenly." min={0.05} max={2} step={0.05} value={style.stippleGamma} onChange={v => ss({ stippleGamma: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Jitter" help="Random displacement of each dot within its grid cell. 1 = full cell, 0 = regular grid." min={0} max={1} step={0.05} value={style.stippleJitter} onChange={v => ss({ stippleJitter: v })} fmt={v => v.toFixed(2)} />
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: MUTED, display: 'block', marginBottom: 4 }}>Density from</span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {[['Slope', 'slope'], ['Inv Slope', 'invSlope'], ['Elevation', 'elevation'], ['Inv Elev', 'invElev']].map(([label, val]) => (
                        <button key={val} onClick={() => ss({ stippleDensityMode: val })} style={{
                          flex: 1, fontSize: 8, padding: '3px 0', borderRadius: 2,
                          background: style.stippleDensityMode === val ? ACCENT : SURF,
                          color: style.stippleDensityMode === val ? '#fff' : MUTED,
                          border: `1px solid ${style.stippleDensityMode === val ? ACCENT : BORDER}`,
                          cursor: 'pointer',
                        }}>{label}</button>
                      ))}
                    </div>
                  </div>
                </Sub>
                <ModeStyleOverride prefix="Stipple" style={style} ss={ss} label="DOT STYLE" showDash={false} />
              </>
            )}
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

          <Section title="Texture" open={sec.texture} onToggle={() => tog('texture')}>
            <Tog label="Texture overlay" checked={style.showTexture} onChange={v => ss({ showTexture: v })} />
            {style.showTexture && !style.showFill && (
              <div style={{ fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, padding: '5px 7px', marginBottom: 6 }}>
                Fill is disabled — texture will not appear until Fill is enabled.
              </div>
            )}
            {style.showTexture && (
              <Sub>
                <button className="hmload" onClick={handleTexturePicker} style={{ 
                  width:'100%', padding:8, marginBottom:10, background: SURF, color: DIM, 
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
                      <select value={style.textureBlendMode} onChange={e => ss({ textureBlendMode: e.target.value })} style={{ flex:1, background:SURF, color:DIM, border:`1px solid ${BORDER}`, borderRadius:4, fontSize:10, padding:'3px 6px', cursor:'pointer' }}>
                        <option value="normal">Normal</option>
                        <option value="multiply">Multiply</option>
                        <option value="screen">Screen</option>
                        <option value="overlay">Overlay</option>
                        <option value="softlight">Soft Light</option>
                        <option value="add">Add</option>
                      </select>
                    </div>
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

          <Section title="Mirror" open={sec.mirror} onToggle={() => tog('mirror')}>
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
            <div style={{ fontSize:9, color:MUTED, textAlign:'center', marginTop:14, opacity:0.7, lineHeight:1.4, marginBottom:10 }}>
              Click arrows to toggle symmetry.<br/>Combine directions for kaleidoscopic effects.
            </div>
            <button onClick={() => ss({ 
              showMirrorPlusX:true, showMirrorMinusX:false,
              showMirrorPlusY:true, showMirrorMinusY:false,
              showMirrorPlusZ:true, showMirrorMinusZ:false
            })} style={{ 
              width:'100%', padding:'6px 0', background: SURF, color: DIM, 
              border:`1px solid ${BORDER}`, borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer'
            }}>Reset Symmetry</button>
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
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={handleRunErosion} disabled={!heightmapPixels || isEroding} style={{ flex:2, padding:'8px 0', background: ACCENT, color:'#fff', border:'none', borderRadius:5, cursor: (heightmapPixels && !isEroding) ? 'pointer' : 'default', fontSize:11, fontWeight:600, opacity: (heightmapPixels && !isEroding) ? 1 : 0.5 }}>{isEroding ? `Eroding… ${erosionProgress}%` : 'Run Erosion'}</button>
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
