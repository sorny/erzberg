/**
 * Custom right-hand control panel — design mirrors the original p5.js tool.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { version } from '../../package.json'
import { useStore } from '../store/useStore'
import { SOUNDSCAPE_DEFAULTS } from '../hooks/useSoundscape'
import ErosionWorker from '../utils/erosion.worker?worker'
import { GRADIENT_PRESETS } from '../utils/gradientPresets'
import { TRACK_PROJECTIONS, detectTrackBpm, getProjection } from '../utils/trackProjections'
import { GradientPicker } from './GradientPicker'
import { Histogram } from './Histogram'
import { SpectrogramView } from './SpectrogramView'

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

/** m:ss for the Soundscapes transport readout. */
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// Every layer with a per-mode `hypso<Id>` toggle (draw modes + GPX track).
const MODE_HYPSO_IDS = ['Lines', 'Cross', 'Pillars', 'Contours', 'Hachure', 'Flow', 'Dag', 'Pencil', 'Ridge', 'Valley', 'Stipple', 'Engrave', 'Curv', 'Swiss', 'Gpx']

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

function HypsometricRow({ value }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:9, color:MUTED }}>
        <span style={{ display:'flex', alignItems:'center' }}>
          Hypso. Integral
          <HelpBtn active={show} onClick={() => setShow(s => !s)} />
        </span>
        <span style={{ color:'#a1a1aa', fontFamily:'monospace' }}>{value.toFixed(3)}</span>
      </div>
      {show && (
        <div style={{
          fontSize: 9, color: MUTED, background: 'rgba(0,0,0,0.2)',
          padding: '6px 8px', borderRadius: 4, marginBottom: 8,
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

function InlineSl({ label, hint, help, min, max, step = 1, value, onChange, fmt, testId }) {
  const [showHelp, setShowHelp] = useState(false)
  const parsed = (v) => step < 1 ? parseFloat(v) : parseInt(v)
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', alignItems:'center', gap: 7, marginBottom: showHelp ? 4 : 0 }}>
        <span style={{ fontSize: 11, color: MUTED, whiteSpace:'nowrap', minWidth: 52, display: 'flex', alignItems: 'center' }}>
          {label}{hint && <span style={{ fontSize: 9, color: MUTED, marginLeft: 3 }}>{hint}</span>}
          {help && <HelpBtn active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <input type="range" className="hmr" data-testid={testId} min={min} max={max} step={step} value={value}
          onChange={e => onChange(parsed(e.target.value))} />
        <span style={{ minWidth: 32, textAlign:'right', fontSize: 10, color: MUTED, fontVariantNumeric:'tabular-nums' }}>
          {fmt ? fmt(value) : value}
        </span>
      </div>
      {showHelp && help && <HelpBox text={help} />}
    </div>
  )
}

/** Segmented button row — one exclusive choice, laid out like InlineSl. */
function SegRow({ label, help, options, value, onChange }) {
  const [showHelp, setShowHelp] = useState(false)
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', alignItems:'center', gap: 7 }}>
        <span style={{ fontSize: 11, color: MUTED, whiteSpace:'nowrap', minWidth: 52, display:'flex', alignItems:'center' }}>
          {label}
          {help && <HelpBtn active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <div style={{ display:'flex', gap: 2, flex: 1 }}>
          {options.map(([lbl, v]) => (
            <button key={String(v)} onClick={() => onChange(v)} style={{
              flex: 1, fontSize: 8, padding:'4px 0', borderRadius: 2, textTransform:'uppercase', cursor:'pointer',
              background: value === v ? ACCENT : SURF,
              color: value === v ? '#fff' : MUTED,
              border: `1px solid ${value === v ? ACCENT : BORDER}`,
            }}>{lbl}</button>
          ))}
        </div>
      </div>
      {showHelp && help && <HelpBox text={help} />}
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
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 3 }}>
            {chips.map((c) => {
              const on = !!get(c)
              return (
                <button key={c.key} title={c.help} data-testid={`proj-${c.key}`} onClick={() => onChange(c.key, !on)} style={{
                  fontSize: 8, padding:'5px 0', borderRadius: 3, textTransform:'uppercase', cursor:'pointer',
                  background: on ? ACCENT : SURF, color: on ? '#fff' : MUTED,
                  border: `1px solid ${on ? ACCENT : BORDER}`,
                }}>{c.label}</button>
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
function ModeStyleOverride({ prefix, style, ss, label = 'LINE STYLE', showDash = true, gradientStops, setGradientStops }) {
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
            {/* The gradient is global (shared by every hypsometric layer + fill),
                but it must be editable right where hypso is switched on — not
                hidden behind enabling fill in Terrain Style. */}
            {gradientStops && setGradientStops && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 8, color: MUTED, fontWeight: 700, marginBottom: 5, letterSpacing: 1 }}>GRADIENT · SHARED BY ALL HYPSO LAYERS</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4, marginBottom:8 }}>
                  {Object.keys(GRADIENT_PRESETS).map(name => <button key={name} onClick={() => setGradientStops(GRADIENT_PRESETS[name])} style={{ fontSize:9, padding:'3px 0', background: SURF, color: MUTED, border:`1px solid ${BORDER}`, borderRadius:3, cursor:'pointer' }}>{name}</button>)}
                </div>
                <GradientPicker stops={gradientStops} onChange={setGradientStops} />
              </div>
            )}
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
  soundscape, onSoundscapeFit,
  geoTiffElevMin, geoTiffElevMax, geoTiffCRS,
  loadGpxFromPicker, gpxPoints, onClearGpx,
  onCameraPreset,
  onSvg, onPng, onPngAlpha, onStl, onHeightmap,
  onWebmToggle, webmActive,
  webmDuration, setWebmDuration,
  onSavePreset, onLoadPreset,
  externalPresets,
  onReset,
  baseZoom = 1,
  lineGeo, surfaceGeo, terrainData,
  hypsometricIntegral,
  profileMode, profileClicks, onProfileMode,
}) {
  const [open, setOpen]     = useState(true)
  const [sec, setSec]       = useState({
    terrain: true, levels: true, view: true, camera: false, presets: true, style: true,
    modeLines: true, modeCross: false, modePillars: false, modeContours: false,
    modeHachure: false, modeFlow: false, modeDag: false, modePencil: false,
    modeRidge: false, modeValley: false, modeStipple: false,
    modeEngrave: false, modeCurv: false, modeSwiss: false,
    hillshade: false, slopeShade: false, gpxTrack: false,
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

  // Soundscapes controller. Aliased because `ss` is already the style setter,
  // and defaulted so the section degrades to an inert upload button if the
  // prop is ever omitted rather than throwing on first render.
  const snd = soundscape ?? { opts: SOUNDSCAPE_DEFAULTS, loadFromPicker: () => {}, setOpts: () => {}, setProjParam: () => {} }

  // Whole-track projection the freeze button will render.
  const projection = getProjection(snd.opts?.projection)
  // Only the weave shows a tempo, and detecting one is a full pass over the
  // spectrogram — not something to run on every unrelated re-render.
  const detectedBpm = useMemo(
    () => (projection.id === 'weave' && snd.spec ? detectTrackBpm(snd.spec) : 0),
    [projection.id, snd.spec]
  )

  const st = (v) => setTerrain(p => ({ ...p, ...v }))
  const ss = (v) => setStyle(p => ({ ...p, ...v }))
  const sp = (v) => setPoints(p => ({ ...p, ...v }))
  const sv = (v) => setView(p => ({ ...p, ...v }))

  const hasGeoTiff  = geoTiffElevMin != null && geoTiffElevMax != null
  const elevRange   = hasGeoTiff ? geoTiffElevMax - geoTiffElevMin : 0
  const elevCutToM  = (pct) => +(geoTiffElevMin + (pct / 100) * elevRange).toFixed(1)
  const mToElevCut  = (m)   => +(((m - geoTiffElevMin) / elevRange) * 100).toFixed(1)

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
      modeEngrave:  !!newStyle.enabledEngrave,
      modeCurv:     !!newStyle.enabledCurv,
      modeSwiss:    !!newStyle.enabledSwiss,
    }))
  }

  const applyPreset = (preset) => {
    setStyle(prev => ({ ...prev, ...preset.style }))
    // Particle params live in the points state, not style — without this a
    // preset can never drive the hologram field. All presets carry a points
    // block with showPoints, so switching presets also turns particles off.
    if (preset.points) setPoints(prev => ({ ...prev, ...preset.points }))
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
            {hypsometricIntegral != null && (
              <HypsometricRow value={hypsometricIntegral} />
            )}
            <Tog label="Raw terrain view"
              help="Shows the loaded heightmap itself: a flat greyscale plane with everything else hidden, lowest point black and highest white, stretched to fill the range. It reflects Resolution, Blur, Levels and the elevation cuts, so it doubles as a preview while tuning them. Exports are unaffected — this is a way of looking, not a change to the terrain."
              checked={view.showRawTerrain ?? false} onChange={v => sv({ showRawTerrain: v })} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 10px' }}>
              <Sl label="Resolution" min={1} max={20} value={terrain.resolution} onChange={v => st({ resolution: v })} />
              <Sl label="Elev scale" min={-10} max={10} step={0.1} value={terrain.elevScale} onChange={v => st({ elevScale: v })} fmt={v => (v >= 0 ? '+' : '') + v.toFixed(1)} />
              <Sl label="Blur" min={0} max={10} step={0.1} value={terrain.blurRadius} onChange={v => st({ blurRadius: v })} fmt={v => v % 1 ? v.toFixed(1) : v} />
              <Sl label="Jitter" min={0} max={20} step={0.1} value={terrain.jitterAmt} onChange={v => st({ jitterAmt: v })} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 10px' }}>
              <Sl label="Elev min cut" min={0} max={100} step={0.1} value={terrain.elevMinCut} onChange={v => st({ elevMinCut: v })} fmt={v => v.toFixed(1)+'%'} />
              <Sl label="Elev max cut" min={0} max={100} step={0.1} value={terrain.elevMaxCut} onChange={v => st({ elevMaxCut: v })} fmt={v => v.toFixed(1)+'%'} />
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
            <Tog label="Center guides" checked={view.showGuides} onChange={v => sv({ showGuides: v })} />
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

            {/* Shared gradient editor: visible whenever ANY hypsometric consumer is
                active — fill or any draw mode. (The old `style.lineHypsometric`
                check was a dead legacy key, so this only ever showed for fill.) */}
            {style.fillHypsometric || MODE_HYPSO_IDS.some(id => style[`hypso${id}`]) ? (
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

          {/* ── DRAW MODES ─────────────────────────────────────────────────── */}

          <Section title="Mode: Lines" open={sec.modeLines} onToggle={() => tog('modeLines')} enabled={style.enabledLines}>
            <Tog label="Enabled" checked={style.enabledLines} onChange={v => ss({ enabledLines: v })} />
            {style.enabledLines && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingLines} onChange={v => ss({ spacingLines: v })} />
                  <InlineSl label="Shift" min={0} max={100} value={style.shiftLines} onChange={v => ss({ shiftLines: v })} />
                  <InlineSl label="Angle" help="Bearing of the parallel lines. 0° runs along the X axis, 90° along Y, anything between gives diagonal ridgelines." min={0} max={180} step={1} value={style.angleLines ?? 0} onChange={v => ss({ angleLines: v })} fmt={v => `${v}°`} />
                </Sub>
                <ModeStyleOverride prefix="Lines" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
              </>
            )}
          </Section>

          <Section title="Mode: Crosshatch" open={sec.modeCross} onToggle={() => tog('modeCross')} enabled={style.enabledCross}>
            <Tog label="Enabled" checked={style.enabledCross} onChange={v => ss({ enabledCross: v })} />
            {style.enabledCross && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingCross} onChange={v => ss({ spacingCross: v })} />
                  <InlineSl label="Angle" help="Bearing of the first line set; the second runs perpendicular to it." min={0} max={90} step={1} value={style.angleCross ?? 0} onChange={v => ss({ angleCross: v })} fmt={v => `${v}°`} />
                </Sub>
                <ModeStyleOverride prefix="Cross" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
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
                <ModeStyleOverride prefix="Pillars" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
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
                  {style.majorIntervalContours > 0 && (
                    <InlineSl label="Major Weight" min={0.5} max={10} step={0.5} value={style.majorWeightContours} onChange={v => ss({ majorWeightContours: v })} />
                  )}
                  <Tog label="Close contours" checked={!!style.closeRingsContours} onChange={v => ss({ closeRingsContours: v })} />
                  {!style.tanakaContours && (
                    <InlineSl label="Smoothing" help="Chaikin corner-cutting passes. 0 = crisp marching-squares lines; higher = soft, flowing form lines." min={0} max={4} step={1} value={style.smoothingContours ?? 0} onChange={v => ss({ smoothingContours: v })} />
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
                <ModeStyleOverride prefix="Contours" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
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
                <ModeStyleOverride prefix="Hachure" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
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
                <ModeStyleOverride prefix="Flow" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
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
                <ModeStyleOverride prefix="Dag" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
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
                <ModeStyleOverride prefix="Pencil" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
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
                <ModeStyleOverride prefix="Ridge" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
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
                <ModeStyleOverride prefix="Valley" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
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
                  <InlineSl label="Seed" help="Randomness seed — the same seed always reproduces the identical dot pattern." min={1} max={999} step={1} value={style.seedStipple ?? 42} onChange={v => ss({ seedStipple: v })} />
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
                <ModeStyleOverride prefix="Stipple" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} label="DOT STYLE" showDash={false} />
              </>
            )}
          </Section>

          <Section title="Mode: Engraving" open={sec.modeEngrave} onToggle={() => tog('modeEngrave')} enabled={style.enabledEngrave}>
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
                <ModeStyleOverride prefix="Engrave" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
              </>
            )}
          </Section>

          <Section title="Mode: Curvature" open={sec.modeCurv} onToggle={() => tog('modeCurv')} enabled={style.enabledCurv}>
            <Tog label="Enabled" checked={style.enabledCurv} onChange={v => ss({ enabledCurv: v })} />
            {style.enabledCurv && (
              <>
                <HelpBox text="Copperplate engraving that follows the form rather than the light: strokes trace the principal-curvature field, so the lines themselves wrap around ridges and hollows." />
                <Sub>
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['Across form', 'max'], ['Along form', 'min']].map(([lbl, v]) => (
                      <button key={v} onClick={() => ss({ dirModeCurv: v })}
                        style={{
                          flex:1, fontSize:8, padding:'4px 0', borderRadius:2, textTransform:'uppercase', cursor:'pointer',
                          background: style.dirModeCurv === v ? ACCENT : SURF,
                          color: style.dirModeCurv === v ? '#fff' : MUTED,
                          border:`1px solid ${style.dirModeCurv === v ? ACCENT : BORDER}`,
                        }}>{lbl}</button>
                    ))}
                  </div>
                  <InlineSl label="Spacing" help="Separation between strokes. Each line claims territory as it advances and stops on reaching another's, so strokes stay evenly spread instead of clumping." min={1} max={20} step={0.5} value={style.spacingCurv} onChange={v => ss({ spacingCurv: v })} />
                  <InlineSl label="Length" help="Maximum steps per stroke. Short values give a broken, sketched texture; long values give sweeping continuous lines." min={5} max={400} step={5} value={style.lengthCurv} onChange={v => ss({ lengthCurv: v })} />
                  <InlineSl label="Step" help="Integration step in grid cells. Smaller follows the curvature field more faithfully at more segments." min={0.25} max={3} step={0.25} value={style.stepCurv} onChange={v => ss({ stepCurv: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Smoothing" help="Pre-blur radius before differencing. Second derivatives amplify noise, so raise this on grainy terrain." min={0} max={6} step={1} value={style.radiusCurv} onChange={v => ss({ radiusCurv: v })} />
                  <InlineSl label="Threshold" help="Minimum curvature, as a fraction of the strongest present. Raise it to leave flat ground bare and engrave only where the surface actually bends." min={0} max={0.9} step={0.01} value={style.thresholdCurv} onChange={v => ss({ thresholdCurv: v })} fmt={v => Math.round(v*100)+'%'} />
                </Sub>
                <ModeStyleOverride prefix="Curv" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
              </>
            )}
          </Section>

          <Section title="Mode: Rock & Scree" open={sec.modeSwiss} onToggle={() => tog('modeSwiss')} enabled={style.enabledSwiss}>
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
                <ModeStyleOverride prefix="Swiss" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
              </>
            )}
          </Section>

          {geoTiffElevMin != null && (
            <Section title="GPX Track" open={sec.gpxTrack} onToggle={() => tog('gpxTrack')} enabled={gpxPoints?.length > 0}>
              {geoTiffCRS?.startsWith('unsupported') && (
                <div style={{ fontSize:9, color:'#f97316', marginBottom:6 }}>
                  GPX requires EPSG:4326 or EPSG:3857 GeoTIFF.
                </div>
              )}
              <div style={{ display:'flex', gap:6, marginBottom:6 }}>
                <button className="hmload" onClick={loadGpxFromPicker}
                  style={{ flex:1, padding:8, background:SURF, color:'#a1a1aa', border:`1px dashed ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11 }}>
                  {gpxPoints?.length > 0 ? '↑ Replace GPX' : '↑ Load GPX (.gpx)'}
                </button>
                {gpxPoints?.length > 0 && (
                  <button onClick={onClearGpx}
                    style={{ padding:'8px 12px', background:SURF, color:MUTED, border:`1px solid ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11 }}>
                    ✕
                  </button>
                )}
              </div>
              {gpxPoints?.length > 0 && (
                <>
                  <div style={{ fontSize:9, color:MUTED, marginBottom:6 }}>{gpxPoints.length} track points</div>
                  <ModeStyleOverride prefix="Gpx" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={setGradientStops} />
                </>
              )}
            </Section>
          )}

          <Section title="Particles" open={sec.points} onToggle={() => tog('points')} enabled={points.showPoints}>
            <TogColor label="Hologram" checked={points.showPoints} onToggle={v => sp({ showPoints: v })} color={points.pointColor} onColor={v => sp({ pointColor: v })} />
            {points.showPoints && (
              <Sub>
                <InlineSl label="Size" min={0.5} max={100} step={0.5} value={points.pointSize} onChange={v => sp({ pointSize: v })} />
                <InlineSl label="Spacing" min={1} max={16} step={1} value={points.particleSpacing ?? 1} onChange={v => sp({ particleSpacing: v })} fmt={v => `${v}`} />
                <ColorRow label="Glow" value={points.holoGlowColor ?? '#00eaff'} onChange={v => sp({ holoGlowColor: v })} />
                <InlineSl label="Shimmer" min={0} max={1} step={0.05} value={points.holoShimmer ?? 0.4} onChange={v => sp({ holoShimmer: v })} fmt={v => v.toFixed(2)} />
                <Tog label="Animate" small checked={points.animateParticles} onChange={v => sp({ animateParticles: v })} />
                {points.animateParticles && (
                  <Sub>
                    <InlineSl label="Float"      min={0} max={5}  step={0.1} value={points.holoFloat ?? 1}       onChange={v => sp({ holoFloat: v })}       fmt={v => v.toFixed(1)} />
                    <InlineSl label="Noise"      min={0} max={5}  step={0.1} value={points.holoNoiseAmt ?? 1}    onChange={v => sp({ holoNoiseAmt: v })}    fmt={v => v.toFixed(1)} />
                    <InlineSl label="Noise scale" min={0.1} max={5} step={0.1} value={points.holoNoiseScale ?? 1} onChange={v => sp({ holoNoiseScale: v })} fmt={v => v.toFixed(1)} />
                    <InlineSl label="Flow speed" min={0} max={4}  step={0.1} value={points.holoFlowSpeed ?? 1}   onChange={v => sp({ holoFlowSpeed: v })}   fmt={v => v.toFixed(1)} />
                    <InlineSl label="Reveal"     min={0.5} max={6} step={0.1} value={points.holoMaskContrast ?? 1.5} onChange={v => sp({ holoMaskContrast: v })} fmt={v => v.toFixed(1)} />
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
              <div style={{ fontSize:10, color:'#fca5a5', background:'rgba(153,27,27,.18)', border:'1px solid #7f1d1d', borderRadius:4, padding:'6px 8px', marginBottom:8 }}>
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

                <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:8 }}>
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
                  <div style={{ fontSize:8, color: MUTED, fontWeight:700, marginBottom:6, letterSpacing:1 }}>ANALYSIS</div>
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[1024, 2048, 4096].map(n => (
                      <button key={n} onClick={() => snd.setOpts({ fftSize: n })}
                        style={{ flex:1, fontSize:8, padding:'4px 0', borderRadius:2,
                          background: snd.opts.fftSize === n ? ACCENT : SURF,
                          color: snd.opts.fftSize === n ? '#fff' : MUTED,
                          border:`1px solid ${snd.opts.fftSize === n ? ACCENT : BORDER}`, cursor:'pointer' }}>{n}</button>
                    ))}
                  </div>
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['Log', true], ['Linear', false]].map(([lbl, v]) => (
                      <button key={lbl} onClick={() => snd.setOpts({ logFreq: v })}
                        style={{ flex:1, fontSize:8, padding:'4px 0', borderRadius:2, textTransform:'uppercase',
                          background: snd.opts.logFreq === v ? ACCENT : SURF,
                          color: snd.opts.logFreq === v ? '#fff' : MUTED,
                          border:`1px solid ${snd.opts.logFreq === v ? ACCENT : BORDER}`, cursor:'pointer' }}>{lbl} freq</button>
                    ))}
                  </div>
                  <InlineSl label="Bins" hint="↕" help="Frequency rows — also the height of the generated heightmap. Changing this re-runs the analysis."
                    min={32} max={512} step={32} value={snd.opts.bins} onChange={v => snd.setOpts({ bins: v })} />

                  <div style={{ fontSize:8, color: MUTED, fontWeight:700, margin:'10px 0 6px', letterSpacing:1 }}>STREAM</div>
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
                  <div style={{ fontSize:8, color: MUTED, fontWeight:700, marginBottom:6, letterSpacing:1 }}>WHOLE TRACK</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:2, marginBottom:6 }}>
                    {TRACK_PROJECTIONS.map(pj => (
                      <button key={pj.id} data-testid={`projection-${pj.id}`}
                        onClick={() => snd.setOpts({ projection: pj.id })}
                        style={{ fontSize:8, padding:'5px 0', borderRadius:2, textTransform:'uppercase', cursor:'pointer',
                          background: projection.id === pj.id ? ACCENT : SURF,
                          color: projection.id === pj.id ? '#fff' : MUTED,
                          border:`1px solid ${projection.id === pj.id ? ACCENT : BORDER}` }}>{pj.label}</button>
                    ))}
                  </div>
                  <div style={{ fontSize:9, color: MUTED, lineHeight:1.4, marginBottom:8 }}>{projection.blurb}</div>

                  {projection.id === 'weave' && (
                    <div style={{ fontSize:9, color: MUTED, marginBottom:8 }}>
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
                  style={{ width:'100%', padding:'8px 0', background: snd.frozen ? ACCENT : SURF, color: snd.frozen ? '#fff' : DIM, border:`1px solid ${snd.frozen ? ACCENT : BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:600 }}
                >{snd.frozen ? '❄ Whole Track Frozen' : 'Freeze Whole Track'}</button>
                <div style={{ fontSize:9, color: MUTED, marginTop:6, lineHeight:1.4 }}>
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

          {/* ── Analysis ───────────────────────────────────────────────────── */}
          <Section title="Analysis" open={sec.analysis} onToggle={() => tog('analysis')}>
            <div style={{ fontSize:9, color:MUTED, marginBottom:6 }}>
              Click two points on the terrain to sample a cross-section.
            </div>
            <button
              onClick={() => onProfileMode?.(!profileMode)}
              style={{
                width:'100%', padding:'7px 0', borderRadius:5, cursor:'pointer', fontSize:11,
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
