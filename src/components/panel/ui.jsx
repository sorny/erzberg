/**
 * Shared right-hand-panel primitives.
 *
 * These started out inside Sidebar.jsx and were lifted here when Edit Mode grew
 * a second panel: EditPanel has to look like it belongs to the same tool, and
 * the alternative was a second copy of every token and control that would drift
 * on the first tweak. Nothing here knows about terrain — it is the panel's
 * design system and nothing else.
 */
import { useState } from 'react'

// ── Design tokens ─────────────────────────────────────────────────────────────
export const BG     = '#18181b'
export const SURF   = '#27272a'
export const BORDER = '#3f3f46'
export const TEXT   = '#e4e4e7'
export const DIM    = '#d4d4d8'
export const MUTED  = '#71717a'
export const ACCENT = '#3b82f6'
export const GREEN  = '#22c55e'
export const W      = 272   // panel width px

// ── Injected styles (pseudo-elements can't be set inline) ─────────────────────
export function PanelStyles() {
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
      .hmnum { background:${SURF}; border:1px solid ${BORDER}; color:${DIM}; border-radius:3px;
               font-size:10px; padding:3px 5px; width:100%; outline:none;
               font-variant-numeric:tabular-nums; }
      .hmnum:focus { border-color:${ACCENT}; }

      /* Dual-handle range. Two native inputs stacked: the tracks are inert and
         only the thumbs take the pointer, which keeps keyboard control and the
         native feel that a hand-rolled two-thumb widget throws away. */
      .hmrr { -webkit-appearance:none; appearance:none; position:absolute; left:0; top:0;
        width:100%; height:13px; margin:0; background:none; pointer-events:none; outline:none; }
      .hmrr::-webkit-slider-thumb { -webkit-appearance:none; pointer-events:auto; width:11px;
        height:11px; border-radius:50%; background:${ACCENT}; border:2px solid ${BG};
        cursor:pointer; transition:transform .1s; }
      .hmrr:hover::-webkit-slider-thumb { transform:scale(1.15); }
      .hmrr::-moz-range-thumb { pointer-events:auto; width:11px; height:11px; border-radius:50%;
        background:${ACCENT}; border:2px solid ${BG}; cursor:pointer; }
      .hmrr::-webkit-slider-runnable-track { background:none; border:none; }
      .hmrr::-moz-range-track { background:none; border:none; }

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

export function HelpBox({ text }) {
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

export function HelpBtn({ active, onClick }) {
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

export function Sl({ label, hint, help, min, max, step = 1, value, onChange, fmt, col2, testId }) {
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
        <input type="range" className="hmr" data-testid={testId} min={min} max={max} step={step} value={value}
          onChange={e => onChange(parsed(e.target.value))} />
        <span style={{ minWidth: 36, textAlign:'right', fontSize: 10, color: MUTED, fontVariantNumeric:'tabular-nums' }}>
          {fmt ? fmt(value) : value}
        </span>
      </div>
    </div>
  )
}

export function Tog({ label, hint, help, checked, onChange, small }) {
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

export function Switch({ checked, onChange }) {
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

export function ColorRow({ label, help, value, onChange, testId }) {
  const [showHelp, setShowHelp] = useState(false)
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize: 12, color: DIM, display:'flex', alignItems:'center' }}>
          {label}
          {help && <HelpBtn active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <input type="color" className="hmc" data-testid={testId} value={value} onChange={e => onChange(e.target.value)} />
      </div>
      {showHelp && help && <HelpBox text={help} />}
    </div>
  )
}

export function TogColor({ label, hint, help, checked, onToggle, color, onColor }) {
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

export function InlineSl({ label, hint, help, min, max, step = 1, value, onChange, fmt, testId }) {
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

/**
 * Two-handle range, laid out like InlineSl.
 *
 * For windowing a signal: the pair says which slice of an input's 0…1 actually
 * drives something. A single "amount" cannot express that — on a track that is
 * loud all the way through, scaling a signal that never varies just scales a
 * constant, and the only way to get movement back is to say that only the top
 * of the range counts.
 *
 * The handles cannot cross: each clamps against the other with a gap, since an
 * inverted or zero-width window has no sensible reading.
 */
export function RangeSl({ label, hint, help, lo, hi, onChange, fmt, min = 0, max = 1, step = 0.01, testId }) {
  const [showHelp, setShowHelp] = useState(false)
  const GAP = step * 2
  const pct = (v) => ((v - min) / (max - min)) * 100
  const f = fmt ?? ((v) => v.toFixed(2))
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', alignItems:'center', gap: 7, marginBottom: showHelp ? 4 : 0 }}>
        <span style={{ fontSize: 11, color: MUTED, whiteSpace:'nowrap', minWidth: 52, display:'flex', alignItems:'center' }}>
          {label}{hint && <span style={{ fontSize: 9, color: MUTED, marginLeft: 3 }}>{hint}</span>}
          {help && <HelpBtn active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <div style={{ position:'relative', flex:1, height:13, minWidth:0 }}>
          <div style={{ position:'absolute', top:5, left:0, right:0, height:3, background: BORDER, borderRadius:2 }} />
          <div style={{ position:'absolute', top:5, height:3, borderRadius:2, background: ACCENT,
                        left:`${pct(lo)}%`, width:`${Math.max(0, pct(hi) - pct(lo))}%` }} />
          <input type="range" className="hmrr" data-testid={testId && `${testId}-lo`}
            min={min} max={max} step={step} value={lo}
            onChange={(e) => onChange(Math.min(parseFloat(e.target.value), hi - GAP), hi)} />
          <input type="range" className="hmrr" data-testid={testId && `${testId}-hi`}
            min={min} max={max} step={step} value={hi}
            onChange={(e) => onChange(lo, Math.max(parseFloat(e.target.value), lo + GAP))} />
        </div>
        <span style={{ minWidth: 52, textAlign:'right', fontSize: 9, color: MUTED, fontVariantNumeric:'tabular-nums' }}>
          {f(lo)}–{f(hi)}
        </span>
      </div>
      {showHelp && help && <HelpBox text={help} />}
    </div>
  )
}

/** Segmented button row — one exclusive choice, laid out like InlineSl. */
export function SegRow({ label, help, options, value, onChange, testIdPrefix }) {
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
            <button key={String(v)} onClick={() => onChange(v)}
              data-testid={testIdPrefix ? `${testIdPrefix}-${v}` : undefined}
              style={{
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

export function Section({ title, open, onToggle, enabled, children }) {
  return (
    <div style={{ borderBottom: `1px solid ${BORDER}` }}>
      {/* A collapsed section is a zero-height grid row, so nothing inside it is
          clickable until it is opened — the header needs a handle a spec can
          find without matching on its uppercase-by-CSS title text. */}
      <div onClick={onToggle} data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`} style={{
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

export function Sub({ children }) {
  return (
    <div style={{ marginLeft: 6, borderLeft: `1px solid ${BORDER}`, paddingLeft: 5, marginBottom: 12 }}>
      {children}
    </div>
  )
}

export function ExpBtn({ label, hint, onClick, active, testId }) {
  return (
    <button className="hmeb" onClick={onClick} data-testid={testId} style={{
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
