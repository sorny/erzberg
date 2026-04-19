/**
 * Custom right-hand control panel — design mirrors the original p5.js tool.
 *
 * Layout:
 *   Fixed right-side panel (272 px), dark theme, collapsible via a tab handle.
 *   Sections are individually collapsible using the CSS grid-template-rows trick
 *   so height animates smoothly without JS measurement.
 *
 * Styling injected via <PanelStyles> so range thumb / color swatch pseudo-elements
 * can be targeted (impossible with inline styles alone).
 */
import { useState } from 'react'
import { Histogram }      from './Histogram'
import { GradientPicker } from './GradientPicker'
import { GRADIENT_PRESETS } from '../utils/gradientPresets'
import { STYLE_PRESETS } from '../utils/stylePresets'

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
    `}</style>
  )
}

// ── Slider ────────────────────────────────────────────────────────────────────
function Sl({ label, hint, min, max, step = 1, value, onChange, fmt, col2 }) {
  const parsed = (v) => step < 1 ? parseFloat(v) : parseInt(v)
  return (
    <div style={{ marginBottom: 8, ...(col2 && { gridColumn: '1/-1' }) }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: DIM }}>{label}</span>
        {hint && <span style={{ fontSize: 9, color: MUTED }}>{hint}</span>}
      </div>
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

// ── Toggle switch ──────────────────────────────────────────────────────────────
function Tog({ label, hint, checked, onChange, small }) {
  const fs = small ? 11 : 12
  const tc = small ? MUTED : DIM
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8 }}>
      <span style={{ fontSize: fs, color: tc }}>
        {label}{hint && <span style={{ fontSize: fs - 1, color: MUTED }}> {hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} />
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

// ── Color row ─────────────────────────────────────────────────────────────────
function ColorRow({ label, value, onChange }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: DIM }}>{label}</span>
      <input type="color" className="hmc" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

// ── Lines / Points row (toggle + color on same line) ──────────────────────────
function TogColor({ label, hint, checked, onToggle, color, onColor }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: DIM }}>
        {label}{hint && <span style={{ fontSize: 10, color: MUTED }}> {hint}</span>}
      </span>
      <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
        <input type="color" className="hmc" value={color} onChange={e => onColor(e.target.value)} />
        <Switch checked={checked} onChange={onToggle} />
      </div>
    </div>
  )
}

// ── Inline slider row (label left, range + val right, no ctrl-head) ───────────
function InlineSl({ label, min, max, step = 1, value, onChange, fmt }) {
  const parsed = (v) => step < 1 ? parseFloat(v) : parseInt(v)
  return (
    <div style={{ display:'flex', alignItems:'center', gap: 7, marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: MUTED, whiteSpace:'nowrap', minWidth: 52 }}>{label}</span>
      <input type="range" className="hmr" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parsed(e.target.value))} />
      <span style={{ minWidth: 32, textAlign:'right', fontSize: 10, color: MUTED, fontVariantNumeric:'tabular-nums' }}>
        {fmt ? fmt(value) : value}
      </span>
    </div>
  )
}

// ── Collapsible section ────────────────────────────────────────────────────────
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
        <span style={{ fontSize:13, color: MUTED, lineHeight:1, display:'inline-block',
          transform: open ? 'none' : 'rotate(-90deg)', transition:'transform .18s' }}>▾</span>
      </div>
      <div style={{ display:'grid', gridTemplateRows: open ? '1fr' : '0fr', overflow:'hidden', transition:'grid-template-rows .2s ease' }}>
        <div style={{ minHeight:0, overflow:'hidden', padding: open ? '0 14px 12px' : '0 14px' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Export button ─────────────────────────────────────────────────────────────
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
  heightmapPixels, heightmapFilename,
  loadFromPicker, loadGeoTiffFromPicker,
  geoTiffElevMin, geoTiffElevMax,
  onSvg, onPng, onStl,
  onWebmToggle, webmActive,
  webmDuration, setWebmDuration,
  onSavePreset, onLoadPreset,
  onReset,
  lineGeo, surfaceGeo, terrainData,
}) {
  const [open, setOpen]     = useState(true)
  const [sec, setSec]       = useState({
    terrain: true, levels: true, view: true, style: true, points: true, export: true,
  })

  const tog = (name) => setSec(s => ({ ...s, [name]: !s[name] }))

  // Partial-update helpers
  const st = (v) => setTerrain(p => ({ ...p, ...v }))
  const ss = (v) => setStyle(p => ({ ...p, ...v }))
  const sp = (v) => setPoints(p => ({ ...p, ...v }))
  const sv = (v) => setView(p => ({ ...p, ...v }))

  // GeoTIFF elevation cut helpers (convert % ↔ metres)
  const hasGeoTiff  = geoTiffElevMin != null && geoTiffElevMax != null
  const elevRange   = hasGeoTiff ? geoTiffElevMax - geoTiffElevMin : 0
  const elevCutToM  = (pct) => Math.round(geoTiffElevMin + (pct / 100) * elevRange)
  const mToElevCut  = (m)   => Math.round(((m - geoTiffElevMin) / elevRange) * 100)

  // Apply a style preset
  const applyPreset = (preset) => {
    setStyle(prev => ({ ...prev, ...preset.style }))
    if (preset.gradientStops) setGradientStops(preset.gradientStops)
  }

  // Draw modes
  const MODES = [
    { id:'lines-x',    label:'X' },
    { id:'lines-y',    label:'Y' },
    { id:'crosshatch', label:'Cross' },
    { id:'hachure',    label:'Hachure' },
    { id:'contours',   label:'Contours' },
    { id:'flow',       label:'Flow' },
  ]

  // Stats
  const segs  = lineGeo    ? (lineGeo.positions.length / 6).toLocaleString()     : '–'
  const verts = lineGeo    ? (lineGeo.positions.length / 3).toLocaleString()     : '–'
  const tris  = surfaceGeo ? (surfaceGeo.indices.length  / 3).toLocaleString()   : '–'
  const grid  = terrainData ? `${terrainData.cols}×${terrainData.rows}` : '–'

  return (
    <>
      <PanelStyles />

      {/* ── Collapse tab ────────────────────────────────────────────────────── */}
      <div onClick={() => setOpen(o => !o)} style={{
        position:'fixed', right: open ? W : 0, top:'50%', transform:'translateY(-50%)',
        width:22, height:64, background: BG, borderRadius:'6px 0 0 6px',
        cursor:'pointer', zIndex:1001, userSelect:'none',
        display:'flex', alignItems:'center', justifyContent:'center',
        color: MUTED, fontSize:11, boxShadow:'-2px 0 8px rgba(0,0,0,.35)',
        transition:'right .22s cubic-bezier(.4,0,.2,1)',
      }}>
        {open ? '▶' : '◀'}
      </div>

      {/* ── Panel shell ─────────────────────────────────────────────────────── */}
      <div style={{
        position:'fixed', right:0, top:0, width:W, height:'100%',
        background: BG, color: TEXT, zIndex:1000,
        display:'flex', flexDirection:'column',
        transform: open ? 'none' : `translateX(${W}px)`,
        transition:'transform .22s cubic-bezier(.4,0,.2,1)',
        boxShadow:'-3px 0 16px rgba(0,0,0,.4)',
        fontFamily:'system-ui,-apple-system,sans-serif',
      }}>

        {/* Header */}
        <div style={{ padding:'12px 14px 11px', borderBottom:`1px solid ${BORDER}`, flexShrink:0, display:'flex', alignItems:'center' }}>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:'2px', textTransform:'uppercase', color: MUTED, flex:1 }}>
            Heightmap Lines
          </span>
          <button onClick={onReset} style={{
            background:'none', border:`1px solid #52525b`, borderRadius:4,
            color:'#a1a1aa', fontSize:10, padding:'3px 7px', cursor:'pointer',
            transition:'color .1s, border-color .1s',
          }}>Reset</button>
        </div>

        {/* Scrollable body */}
        <div id="hm-panel-body" style={{ flex:1, overflowX:'hidden', overflowY:'auto', scrollbarWidth:'thin', scrollbarColor:`${BORDER} transparent` }}>

          {/* ── Load ──────────────────────────────────────────────────────── */}
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${BORDER}` }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
              <button className="hmload" onClick={loadFromPicker} style={{
                padding:8, textAlign:'center',
                background: SURF, color:'#a1a1aa', border:`1px dashed ${BORDER}`,
                borderRadius:5, cursor:'pointer', fontSize:11,
              }}>
                ↑ &nbsp;PNG / Image
              </button>
              <button className="hmload" onClick={loadGeoTiffFromPicker} style={{
                padding:8, textAlign:'center',
                background: SURF, color:'#a1a1aa', border:`1px dashed ${BORDER}`,
                borderRadius:5, cursor:'pointer', fontSize:11,
              }}>
                ↑ &nbsp;GeoTIFF
              </button>
            </div>
            {heightmapFilename && (
              <div style={{ marginTop:5, fontSize:10, color: MUTED, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {heightmapFilename}
              </div>
            )}
          </div>

          {/* ── Terrain ───────────────────────────────────────────────────── */}
          <Section title="Terrain" open={sec.terrain} onToggle={() => tog('terrain')}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 10px' }}>
              <Sl label="Resolution"   hint="i/k" min={1}  max={20}  value={terrain.resolution}   onChange={v => st({ resolution: v })} />
              <Sl label="Line spacing" hint="j/l" min={1}  max={100} value={terrain.lineSpacing}   onChange={v => st({ lineSpacing: v })} />
              <Sl label="Elev scale"              min={0}  max={5}   step={0.1} value={terrain.elevScale} onChange={v => st({ elevScale: v })}  fmt={v => v.toFixed(1)+'×'} />
              <Sl label="Blur"                    min={0}  max={10}  value={terrain.blurRadius}    onChange={v => st({ blurRadius: v })} />
              <Sl label="Shift lines"  hint="↑↓"  min={0}  max={19}  value={terrain.shiftLines}    onChange={v => st({ shiftLines: v })} />
              <Sl label="Shift peaks"  hint="←→"  min={0}  max={19}  value={terrain.shiftPeaks}    onChange={v => st({ shiftPeaks: v })} />
              {hasGeoTiff ? (<>
                <Sl label="Elev min" min={Math.round(geoTiffElevMin)} max={Math.round(geoTiffElevMax)} step={1}
                  value={elevCutToM(terrain.elevMinCut)} onChange={v => st({ elevMinCut: mToElevCut(v) })} fmt={v => v+'m'} />
                <Sl label="Elev max" min={Math.round(geoTiffElevMin)} max={Math.round(geoTiffElevMax)} step={1}
                  value={elevCutToM(terrain.elevMaxCut)} onChange={v => st({ elevMaxCut: mToElevCut(v) })} fmt={v => v+'m'} />
              </>) : (<>
                <Sl label="Elev min cut" min={0} max={100} value={terrain.elevMinCut} onChange={v => st({ elevMinCut: v })} fmt={v => v+'%'} />
                <Sl label="Elev max cut" min={0} max={100} value={terrain.elevMaxCut} onChange={v => st({ elevMaxCut: v })} fmt={v => v+'%'} />
              </>)}
              <Sl label="Jitter"                  min={0}  max={20}  step={0.5} value={terrain.jitterAmt} onChange={v => st({ jitterAmt: v })} col2 />
            </div>
          </Section>

          {/* ── Levels ────────────────────────────────────────────────────── */}
          <Section title="Levels" open={sec.levels} onToggle={() => tog('levels')}>
            <Histogram
              pixels={heightmapPixels}
              blackPoint={terrain.blackPoint}
              whitePoint={terrain.whitePoint}
              onBlackChange={v => st({ blackPoint: v })}
              onWhiteChange={v => st({ whitePoint: v })}
            />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 10px', marginTop:6 }}>
              <Sl label="Shadows"    min={0}   max={254} value={terrain.blackPoint} onChange={v => st({ blackPoint: v })} />
              <Sl label="Highlights" min={1}   max={255} value={terrain.whitePoint} onChange={v => st({ whitePoint: v })} />
            </div>
          </Section>

          {/* ── View ──────────────────────────────────────────────────────── */}
          <Section title="View" open={sec.view} onToggle={() => tog('view')}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 10px' }}>
              <Sl label="Tilt" hint="y/x" min={-90} max={90} value={view.tilt}
                onChange={v => sv({ tilt: v })} fmt={v => v+'°'} />
              <Sl label="Zoom" min={10} max={400}
                value={Math.round(view.zoom * 100)}
                onChange={v => sv({ zoom: v / 100 })} fmt={v => v+'%'} />
            </div>
            <Sl label="Rotation" hint="e/r" min={-180} max={180} value={view.rotation}
              onChange={v => sv({ rotation: v })} fmt={v => v+'°'} />
            <Tog label="Auto-rotate" hint="q" checked={view.autoRotate} onChange={v => sv({ autoRotate: v })} />
            {view.autoRotate && (<>
              <InlineSl label="Speed" min={0.1} max={10} step={0.1} value={view.autoRotateSpeed}
                onChange={v => sv({ autoRotateSpeed: v })} fmt={v => v.toFixed(1)} />
              <div style={{ display:'flex', alignItems:'center', padding:'3px 0', gap:4 }}>
                <span style={{ fontSize:10, color:MUTED, flex:1 }}>Axis</span>
                {['X','Y','Z'].map(ax => (
                  <button key={ax} onClick={() => sv({ autoRotateAxis: ax })}
                    style={{
                      fontSize:10, padding:'2px 10px', border:`1px solid ${BORDER}`,
                      borderRadius:3, cursor:'pointer',
                      background: (view.autoRotateAxis ?? 'Y') === ax ? ACCENT : SURF,
                      color: (view.autoRotateAxis ?? 'Y') === ax ? '#fff' : MUTED,
                    }}>
                    {ax}
                  </button>
                ))}
              </div>
              <div style={{ display:'flex', alignItems:'center', padding:'3px 0', gap:4 }}>
                <span style={{ fontSize:10, color:MUTED, flex:1 }}>Direction</span>
                {[['CW', -1],['CCW', 1]].map(([label, dir]) => (
                  <button key={label} onClick={() => sv({ autoRotateDir: dir })}
                    style={{
                      fontSize:10, padding:'2px 10px', border:`1px solid ${BORDER}`,
                      borderRadius:3, cursor:'pointer',
                      background: (view.autoRotateDir ?? -1) === dir ? ACCENT : SURF,
                      color: (view.autoRotateDir ?? -1) === dir ? '#fff' : MUTED,
                    }}>
                    {label}
                  </button>
                ))}
              </div>
            </>)}
            <Tog label="Center guides" hint="g" checked={view.showGuides} onChange={v => sv({ showGuides: v })} />
          </Section>

          {/* ── Style ─────────────────────────────────────────────────────── */}
          <Section title="Style" open={sec.style} onToggle={() => tog('style')}>
            {/* Style presets */}
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize:10, color: DIM, display:'block', marginBottom:5 }}>Style presets</span>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
                {Object.entries(STYLE_PRESETS).map(([name, preset]) => (
                  <button key={name} onClick={() => applyPreset(preset)}
                    style={{
                      padding:'6px 4px', fontSize:10, fontWeight:500, textAlign:'center',
                      background: SURF, color: DIM, border:`1px solid ${BORDER}`,
                      borderRadius:4, cursor:'pointer',
                    }}>
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* Draw mode segmented buttons */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                <span style={{ fontSize:10, color: DIM }}>Draw mode</span>
                <span style={{ fontSize:9, color: MUTED }}>f</span>
              </div>
              <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                {MODES.map(m => (
                  <button key={m.id} className={`hmsb${style.drawMode === m.id ? ' on' : ''}`}
                    onClick={() => ss({ drawMode: m.id })}
                    style={{
                      flex:1, padding:'5px 0', fontSize:11, fontWeight:500,
                      background: style.drawMode === m.id ? ACCENT : SURF,
                      color:      style.drawMode === m.id ? '#fff' : MUTED,
                      border:`1px solid ${style.drawMode === m.id ? ACCENT : BORDER}`,
                      borderRadius:4, cursor:'pointer',
                    }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {style.drawMode === 'hachure'  && <InlineSl label="Length"     min={0.1} max={5}   step={0.1}  value={style.hachureLength}   onChange={v => ss({ hachureLength: v })}   fmt={v => v.toFixed(1)} />}
            {style.drawMode === 'contours' && <InlineSl label="Interval"   min={0.5} max={30}  step={0.5}  value={style.contourInterval} onChange={v => ss({ contourInterval: v })} fmt={v => v} />}
            {style.drawMode === 'flow' && (<>
              <InlineSl label="Step"     min={0.1} max={3}   step={0.1} value={style.flowStep ?? 0.5}    onChange={v => ss({ flowStep: v })}    fmt={v => v.toFixed(1)} />
              <InlineSl label="Max len"  min={10}  max={500} step={10}  value={style.flowMaxLen ?? 100}   onChange={v => ss({ flowMaxLen: v })} />
            </>)}

            {/* Lines row: label + color + toggle */}
            <TogColor label="Lines" hint="p" checked={style.showLines} onToggle={v => ss({ showLines: v })} color={style.lineColor} onColor={v => ss({ lineColor: v })} />
            {style.showLines && (<>
              <InlineSl label="Weight  b/n" min={0.5} max={10} step={0.5} value={style.strokeWeight} onChange={v => ss({ strokeWeight: v })} />
              <div style={{ display:'flex', alignItems:'center', padding:'0 0 8px', gap:4 }}>
                <span style={{ fontSize:10, color:MUTED, flex:1 }}>Dash</span>
                {[['solid', 'solid'], ['dash', 'dashed'], ['dot', 'dotted'], ['long', 'long-dash']].map(([lbl, val]) => (
                  <button key={val} onClick={() => ss({ lineDash: val })}
                    style={{
                      fontSize:10, padding:'2px 7px', border:`1px solid ${BORDER}`,
                      borderRadius:3, cursor:'pointer',
                      background: (style.lineDash ?? 'solid') === val ? ACCENT : SURF,
                      color:      (style.lineDash ?? 'solid') === val ? '#fff'  : MUTED,
                    }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </>)}

            {/* Fill + Mesh */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 8px' }}>
              <Tog label="Fill"  hint="p" checked={style.showFill} onChange={v => ss({ showFill: v })} />
              <Tog label="Mesh"  hint="m" checked={style.showMesh} onChange={v => ss({ showMesh: v })} />
            </div>

            <ColorRow label="Background" value={style.bgColor} onChange={v => ss({ bgColor: v })} />

            {/* Elevation gradient */}
            <Tog label="Elevation gradient" checked={style.lineGradient} onChange={v => ss({ lineGradient: v })} />
            {style.lineGradient && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4, marginBottom:8 }}>
                  {Object.keys(GRADIENT_PRESETS).map(name => (
                    <button key={name} onClick={() => setGradientStops(GRADIENT_PRESETS[name])}
                      style={{ fontSize:9, padding:'3px 0', background: SURF, color: MUTED, border:`1px solid ${BORDER}`, borderRadius:3, cursor:'pointer' }}>
                      {name}
                    </button>
                  ))}
                </div>
                <GradientPicker stops={gradientStops} onChange={setGradientStops} />
              </div>
            )}

          </Section>

          {/* ── Particles ─────────────────────────────────────────────────── */}
          <Section title="Particles" open={sec.points} onToggle={() => tog('points')}>
            <TogColor label="Particles" checked={points.showPoints} onToggle={v => sp({ showPoints: v })} color={points.pointColor} onColor={v => sp({ pointColor: v })} />
            {points.showPoints && (
              <>
                <InlineSl label="Size" min={0.5} max={20} step={0.5} value={points.pointSize} onChange={v => sp({ pointSize: v })} />
                <Tog label="Animate" small checked={points.animateParticles} onChange={v => sp({ animateParticles: v })} />
                {points.animateParticles && (
                  <>
                    <InlineSl label="Noise"   min={0}   max={5}    step={0.1} value={points.particleNoise}   onChange={v => sp({ particleNoise: v })}   fmt={v => v.toFixed(1)} />
                    <InlineSl label="Damping" min={0.5} max={0.99} step={0.01} value={points.particleDamping} onChange={v => sp({ particleDamping: v })} fmt={v => v.toFixed(2)} />
                    <Tog label="Gravity" small checked={points.particleGravity} onChange={v => sp({ particleGravity: v })} />
                    {points.particleGravity && (
                      <InlineSl label="Strength" min={0.1} max={10} step={0.1} value={points.particleGravityStr} onChange={v => sp({ particleGravityStr: v })} fmt={v => v.toFixed(1)} />
                    )}
                  </>
                )}
              </>
            )}
          </Section>

          {/* ── Export ────────────────────────────────────────────────────── */}
          <Section title="Export" open={sec.export} onToggle={() => tog('export')}>
            <div style={{ display:'flex', gap:5, marginBottom:6 }}>
              <ExpBtn label="SVG"  hint="key 1" onClick={onSvg} />
              <ExpBtn label="PNG"  hint="key 2" onClick={onPng} />
              <ExpBtn label="STL"  hint="key 4" onClick={onStl} />
            </div>
            <div style={{ display:'flex', gap:5, marginBottom:6 }}>
              <ExpBtn label={webmActive ? '⏹ Stop' : 'WebM'} hint={webmActive ? 'recording' : 'key 3'} onClick={onWebmToggle} active={webmActive} />
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
