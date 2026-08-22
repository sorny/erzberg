/**
 * Shared right-hand-panel primitives.
 *
 * These started out inside Sidebar.jsx and were lifted here when Edit Mode grew
 * a second panel: EditPanel has to look like it belongs to the same tool, and
 * the alternative was a second copy of every token and control that would drift
 * on the first tweak. Nothing here knows about terrain — it is the panel's
 * design system and nothing else.
 */
import { useContext, useEffect, useRef, useState } from 'react'
import { SectionFilter, sectionMatches } from './filter'

// ── Design tokens ─────────────────────────────────────────────────────────────
/**
 * One palette, published twice.
 *
 * `RAW` is the source of truth and the only place a colour is written down.
 * `PanelStyles` publishes it as custom properties on `:root`, and the exports
 * below are `var()` references — so every existing `style={{ background: SURF }}`
 * keeps working unchanged while the values become editable from CSS, which is
 * what makes a retune a token edit rather than four hundred inline ones.
 *
 * `HEX` is the same palette as literal colours, for the few consumers a custom
 * property cannot reach: a 2D canvas resolves nothing, and hex-alpha suffixes
 * (`#22c55e` + `88`) are string surgery. Six sites in the app, all marked.
 */
const RAW = {
  bg:     '#18181b',
  surf:   '#27272a',
  border: '#3f3f46',
  text:   '#e4e4e7',
  dim:    '#d4d4d8',
  /**
   * Secondary text. This carries section titles, every hint and every slider
   * readout, at 9–11 px — so it is a text colour before it is anything else, and
   * the old #71717a measured 3.67:1 on BG and 3.08:1 on SURF, both under AA at
   * those sizes. #8f8f99 reads 5.53 and 4.65 and is still clearly secondary
   * against DIM. Structural work (borders, tracks) belongs to BORDER, not here.
   */
  muted:  '#8f8f99',
  accent: '#3b82f6',
  /**
   * The accent as a *fill under white text*. White on ACCENT is 3.68:1, which is
   * fine for a 34 px toggle and not fine for a 10 px uppercase label. This is the
   * same hue two steps down: 4.7:1 under white, and still 3.77:1 against the panel
   * so the button's own edge stays visible.
   */
  accentDeep: '#2f6fe0',
  green:  '#22c55e',
}

/** The palette as literal colours, for canvas contexts and colour arithmetic. */
export const HEX = RAW

// Written out rather than generated: fast refresh only carries a module whose
// non-component exports are literal constants, and `v('bg')` is a call.
export const BG          = 'var(--hm-bg)'
export const SURF        = 'var(--hm-surf)'
export const BORDER      = 'var(--hm-border)'
export const TEXT        = 'var(--hm-text)'
export const DIM         = 'var(--hm-dim)'
export const MUTED       = 'var(--hm-muted)'
export const ACCENT      = 'var(--hm-accent)'
export const ACCENT_DEEP = 'var(--hm-accent-deep)'
export const GREEN       = 'var(--hm-green)'
/** A number, not a colour — it is arithmetic (`right: open ? W : 0`). */
export const W      = 272   // panel width px

// ── Injected styles (pseudo-elements can't be set inline) ─────────────────────
export function PanelStyles() {
  return (
    <style>{`
      :root {
        --hm-bg: ${RAW.bg};
        --hm-surf: ${RAW.surf};
        --hm-border: ${RAW.border};
        --hm-text: ${RAW.text};
        --hm-dim: ${RAW.dim};
        --hm-muted: ${RAW.muted};
        --hm-accent: ${RAW.accent};
        --hm-accent-deep: ${RAW.accentDeep};
        --hm-green: ${RAW.green};
        /* Derived, because a custom property cannot carry a hex-alpha suffix. */
        --hm-accent-ring: ${RAW.accent}80;
        --hm-green-glow: ${RAW.green}88;
      }

      /* The element is 19 px tall and transparent; the 3 px track is drawn by the
         track pseudo-element inside it. Same hairline as before, in a band a
         pointer can actually land on — the old 3 px box left the thumb's 13 px
         of overflow as the entire target. */
      .hmr { -webkit-appearance:none; appearance:none; flex:1; min-width:0; width:0;
        height:19px; padding:0; background:none; outline:none; cursor:pointer; }
      .hmr::-webkit-slider-runnable-track { height:3px; background:${BORDER}; border-radius:2px; }
      .hmr::-moz-range-track { height:3px; background:${BORDER}; border-radius:2px; }
      .hmr::-webkit-slider-thumb { -webkit-appearance:none; width:13px; height:13px;
        margin-top:-5px; border-radius:50%; background:${ACCENT}; cursor:pointer;
        transition:transform .1s; }
      .hmr:hover::-webkit-slider-thumb { transform:scale(1.2); }
      .hmr::-moz-range-thumb { width:13px; height:13px; border-radius:50%;
        background:${ACCENT}; border:none; }
      /* Arrow keys drive these, so which one has the keyboard has to be visible.
         :focus-visible keeps the ring off during a pointer drag. */
      .hmr:focus-visible::-webkit-slider-thumb { box-shadow:0 0 0 3px var(--hm-accent-ring); }
      .hmr:focus-visible::-moz-range-thumb     { box-shadow:0 0 0 3px var(--hm-accent-ring); }
      .hmc { -webkit-appearance:none; appearance:none; width:32px; height:20px;
        border:1px solid ${BORDER}; border-radius:3px; cursor:pointer;
        padding:2px; background:${SURF}; }
      .hmc::-webkit-color-swatch-wrapper { padding:0; }
      .hmc::-webkit-color-swatch { border:none; border-radius:2px; }
      .hmc:focus-visible { outline:2px solid ${ACCENT}; outline-offset:1px; }
      .hmeb:hover { background:${ACCENT_DEEP} !important; border-color:${ACCENT_DEEP} !important; color:#fff !important; }
      .hmeb:hover .hmeh { color:rgba(255,255,255,.75) !important; }
      .hmsb.on { background:${ACCENT_DEEP} !important; color:#fff !important; border-color:${ACCENT_DEEP} !important; }
      .hmsb:hover:not(.on) { background:${BORDER} !important; color:${DIM} !important; }
      .hmload:hover { background:${SURF} !important; color:${TEXT} !important; }
      #hm-panel-body::-webkit-scrollbar { width:4px; }
      #hm-panel-body::-webkit-scrollbar-thumb { background:${BORDER}; border-radius:2px; }
      /* A 20 px hit box around a 12 px ring: the padding is transparent, so the
         mark keeps its size and only the target grows. */
      .hmi { -webkit-appearance:none; appearance:none; background:none; border:none;
        padding:0; width:20px; height:20px; margin-left:2px; cursor:pointer; flex-shrink:0;
        display:inline-flex; align-items:center; justify-content:center; }
      .hmi > span { display:inline-flex; align-items:center; justify-content:center;
        width:12px; height:12px; border-radius:50%; border:1px solid ${BORDER};
        font-size:8px; line-height:1; color:${MUTED}; transition:all .1s; }
      .hmi:hover > span { color:${TEXT}; border-color:${MUTED}; }
      .hmi.on > span { background:${BORDER}; color:${TEXT}; }
      .hmnum { background:${SURF}; border:1px solid ${BORDER}; color:${DIM}; border-radius:3px;
               font-size:10px; padding:3px 5px; width:100%; outline:none;
               font-variant-numeric:tabular-nums; }
      .hmnum:focus { border-color:${ACCENT}; }
      /* The readout beside a slider, once it accepts a typed value. Reads as a
         label until it is hovered or focused — the panel would be a wall of
         boxes otherwise. */
      .hmval { -webkit-appearance:none; appearance:none; background:none;
        border:1px solid transparent; border-radius:3px; padding:1px 3px; margin:-1px -3px;
        color:${MUTED}; cursor:text; text-align:right;
        font:inherit; font-variant-numeric:tabular-nums; outline:none; }
      .hmval:hover { border-color:${BORDER}; }
      .hmval:focus { border-color:${ACCENT}; color:${TEXT}; background:${SURF}; }
      /* Disclosure header. A button, so the keyboard can open a section — every
         control in a collapsed one is otherwise unreachable. */
      .hmsec { -webkit-appearance:none; appearance:none; background:none; border:none;
        font:inherit; color:inherit; text-align:left; }
      .hmsec:hover { background:rgba(255,255,255,.03); }
      .hmsec:focus-visible { outline:2px solid ${ACCENT}; outline-offset:-2px; }

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
      .hmrr:focus-visible::-webkit-slider-thumb { box-shadow:0 0 0 3px var(--hm-accent-ring); }
      .hmrr:focus-visible::-moz-range-thumb     { box-shadow:0 0 0 3px var(--hm-accent-ring); }
      .hmrr::-webkit-slider-runnable-track { background:none; border:none; }
      .hmrr::-moz-range-track { background:none; border:none; }

      .sym-btn { background:${SURF}; border:1px solid ${BORDER}; color:${MUTED}; border-radius:6px;
                 cursor:pointer; display:flex; flex-direction:column; align-items:center;
                 justify-content:center; font-size:12px; font-weight:700; transition:all 0.1s; aspect-ratio:1/1; }
      .sym-btn.on { background:${ACCENT_DEEP}; color:#fff; border-color:${ACCENT_DEEP}; }
      .sym-btn:hover:not(.on) { border-color:${MUTED}; color:${DIM}; }
      .sym-label { font-size:9px; margin-top:2px; opacity:0.9; }
    `}</style>
  )
}

// ── UI Atomic Components ───────────────────────────────────────────────────────

export function HelpBox({ text }) {
  return (
    <div style={{
      fontSize: 10, color: MUTED, background: 'rgba(0,0,0,0.2)',
      padding: '6px 8px', borderRadius: 4, marginBottom: 8,
      border: `1px solid ${BORDER}`, lineHeight: 1.45
    }}>
      {text}
    </div>
  )
}

export function HelpBtn({ label, active, onClick }) {
  return (
    <button type="button" className={`hmi${active ? ' on' : ''}`} onClick={onClick}
      aria-expanded={!!active} aria-label={label ? `What ${label} does` : 'What this does'}>
      <span aria-hidden="true">?</span>
    </button>
  )
}

/**
 * The number beside a slider, typed rather than dragged.
 *
 * A 69 px track spends about 1.4 units of a 0–100 range on every pixel, and the
 * output is a plot — spacing 4, angle 30°, weight 1 are values you set, not
 * values you approach. Editing shows the raw number rather than `fmt`'s "100%"
 * or "50.0°": a formatted string has no reliable inverse, and a field that
 * cannot read back what it prints is worse than one that prints plainly.
 */
function ValueField({ value, onChange, fmt, min, max, step, width, label }) {
  const [draft, setDraft] = useState(null)
  const ref = useRef(null)
  // Escape clears the draft and blurs, and the blur handler runs before React
  // re-renders — so without this it would still see the abandoned draft and
  // commit the value the user just backed out of.
  const abandoned = useRef(false)
  const editing = draft != null

  useEffect(() => { if (editing) ref.current?.select() }, [editing])

  const commit = () => {
    const n = parseFloat(draft)
    setDraft(null)
    if (!isFinite(n)) return
    // Snapped to the slider's own grid, counted from `min` the way an
    // `<input type=range>` counts. Only sub-1 steps used to snap, so typing 37
    // into a step-5 Azimuth stored 37 while the thumb — which cannot represent
    // it — sat at 35: two controls for one value, disagreeing on screen.
    const grid = step || 1
    const snapped = Math.round((n - min) / grid) * grid + min
    const clamped = Math.min(max, Math.max(min, snapped))
    // Float steps land on 0.30000000000000004 without this.
    onChange(Number.isInteger(grid) ? Math.round(clamped) : parseFloat(clamped.toPrecision(12)))
  }

  const shown = editing ? draft : (fmt ? String(fmt(value)) : String(value))
  return (
    <input
      ref={ref}
      className="hmval"
      type="text"
      inputMode="decimal"
      aria-label={label ? `${label} value` : 'Value'}
      // Sized to what it prints, floored at the old fixed width: "100.0%" is
      // wider than "0", and an input does not grow to its content the way the
      // span this replaced did.
      style={{
        minWidth: width, width: `calc(${Math.max(3, shown.length)}ch + 10px)`,
        fontSize: 10, color: editing ? TEXT : MUTED,
      }}
      value={shown}
      onFocus={() => setDraft(String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (abandoned.current) { abandoned.current = false; setDraft(null); return }
        if (editing) commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); e.currentTarget.blur() }
        if (e.key === 'Escape') { abandoned.current = true; setDraft(null); e.currentTarget.blur() }
      }}
    />
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
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        {hint && <span style={{ fontSize: 10, color: MUTED }}>{hint}</span>}
      </div>
      {showHelp && help && <HelpBox text={help} />}
      <div style={{ display:'flex', alignItems:'center', gap: 7 }}>
        <input type="range" className="hmr" data-testid={testId} aria-label={label}
          min={min} max={max} step={step} value={value}
          onChange={e => onChange(parsed(e.target.value))} />
        <ValueField label={label} value={value} onChange={onChange} fmt={fmt}
          min={min} max={max} step={step} width={36} />
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
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <Switch label={label} checked={checked} onChange={onChange} />
      </div>
      {showHelp && help && <HelpBox text={help} />}
    </div>
  )
}

export function Switch({ label, checked, onChange }) {
  return (
    <label style={{ position:'relative', display:'inline-block', width:34, height:18, flexShrink:0, cursor:'pointer' }}>
      <input type="checkbox" checked={checked} aria-label={label}
        onChange={e => onChange(e.target.checked)}
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', opacity:0, margin:0, cursor:'pointer' }} />
      <span style={{ position:'absolute', inset:0, background: checked ? ACCENT : BORDER, borderRadius:9, transition:'background .15s', pointerEvents:'none' }}>
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
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <input type="color" className="hmc" data-testid={testId} aria-label={label}
          value={value} onChange={e => onChange(e.target.value)} />
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
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          {onColor && <input type="color" className="hmc" aria-label={`${label} colour`}
            value={color} onChange={e => onColor(e.target.value)} />}
          <Switch label={label} checked={checked} onChange={onToggle} />
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
          {label}{hint && <span style={{ fontSize: 10, color: MUTED, marginLeft: 3 }}>{hint}</span>}
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <input type="range" className="hmr" data-testid={testId} aria-label={label}
          min={min} max={max} step={step} value={value}
          onChange={e => onChange(parsed(e.target.value))} />
        <ValueField label={label} value={value} onChange={onChange} fmt={fmt}
          min={min} max={max} step={step} width={32} />
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
          {label}{hint && <span style={{ fontSize: 10, color: MUTED, marginLeft: 3 }}>{hint}</span>}
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <div style={{ position:'relative', flex:1, height:13, minWidth:0 }}>
          <div style={{ position:'absolute', top:5, left:0, right:0, height:3, background: BORDER, borderRadius:2 }} />
          <div style={{ position:'absolute', top:5, height:3, borderRadius:2, background: ACCENT,
                        left:`${pct(lo)}%`, width:`${Math.max(0, pct(hi) - pct(lo))}%` }} />
          <input type="range" className="hmrr" data-testid={testId && `${testId}-lo`}
            aria-label={`${label} lower bound`}
            min={min} max={max} step={step} value={lo}
            onChange={(e) => onChange(Math.min(parseFloat(e.target.value), hi - GAP), hi)} />
          <input type="range" className="hmrr" data-testid={testId && `${testId}-hi`}
            aria-label={`${label} upper bound`}
            min={min} max={max} step={step} value={hi}
            onChange={(e) => onChange(lo, Math.max(parseFloat(e.target.value), lo + GAP))} />
        </div>
        <span style={{ minWidth: 52, textAlign:'right', fontSize: 10, color: MUTED, fontVariantNumeric:'tabular-nums' }}>
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
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <div style={{ display:'flex', gap: 2, flex: 1 }} role="group" aria-label={label}>
          {options.map(([lbl, v]) => (
            <button key={String(v)} onClick={() => onChange(v)} type="button"
              data-testid={testIdPrefix ? `${testIdPrefix}-${v}` : undefined}
              aria-label={`${label}: ${lbl}`} aria-pressed={value === v}
              style={{
                flex: 1, fontSize: 10, padding:'4px 0', borderRadius: 2, textTransform:'uppercase', cursor:'pointer',
                background: value === v ? ACCENT_DEEP : SURF,
                color: value === v ? '#fff' : MUTED,
                border: `1px solid ${value === v ? ACCENT_DEEP : BORDER}`,
              }}>{lbl}</button>
          ))}
        </div>
      </div>
      {showHelp && help && <HelpBox text={help} />}
    </div>
  )
}

/**
 * A collapsible block of the panel.
 *
 * `icon` is an optional mark drawn left of the title — the draw modes use it to
 * show what they actually put on paper, since thirteen rows reading MODE: ⟨noun⟩
 * are otherwise interchangeable.
 *
 * `terms` are the words this section should answer to beyond its own title:
 * "azimuth" has to find Hillshade even while Hillshade is switched off and its
 * controls are not rendered, so the index is stated rather than scraped from
 * whatever happens to be mounted.
 */
export function Section({ title, terms, open, onToggle, enabled, icon, children }) {
  const ctx = useContext(SectionFilter)
  const q = ctx?.q ?? ''
  /**
   * A filtered-out section is *hidden*, never unmounted.
   *
   * Returning null looked equivalent and was not: a collapsed section has always
   * kept its children mounted behind a zero-height grid row, so the panel's local
   * state — a running Overpass fetch and the AbortController that could cancel
   * it, the OSM category ticks, a layer's feature filter — survived being closed.
   * Unmounting on a keystroke threw all of it away, and orphaned the request.
   */
  const ownTerms = terms ?? ctx?.terms?.[title]
  // The panel counts matches from its own index, so a section missing from it
  // would render while the counter said "No section matches". Cheap to notice
  // here and invisible in a build.
  if (import.meta.env.DEV && ctx && terms === undefined && ctx.terms?.[title] === undefined) {
    console.warn(`[panel] Section "${title}" has no SECTION_TERMS entry — the filter will only match its title.`)
  }
  const matches = sectionMatches(title, ownTerms, q)
  // While filtering, a surviving section is open: the point of finding it is to
  // reach the control inside, and a hit that still needs a click is half an answer.
  const isOpen = q ? true : open
  return (
    <div style={{ borderBottom: `1px solid ${BORDER}`, ...(matches ? null : { display: 'none' }) }}
         data-filtered-out={matches ? undefined : 'true'}>
      {/* A collapsed section is a zero-height grid row, so nothing inside it is
          clickable until it is opened — the header needs a handle a spec can
          find without matching on its uppercase-by-CSS title text. It is a
          button because the keyboard needs a way in: everything inside a
          collapsed section is unreachable otherwise. */}
      {/* Inert while filtering: the filter already forces every survivor open, so
          a click here changed only the state behind it — and the section it had
          silently collapsed reappeared that way once the field was cleared. */}
      <button type="button" onClick={q ? undefined : onToggle} className="hmsec"
        aria-expanded={!!isOpen} aria-disabled={q ? true : undefined}
        style={q ? { cursor: 'default' } : undefined}
        data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`} style={{
          display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'10px 14px', cursor:'pointer', userSelect:'none', width:'100%',
        }}>
        <span style={{ fontSize:10, fontWeight:700, letterSpacing:'1.8px', textTransform:'uppercase', color: MUTED, display:'flex', alignItems:'center', minWidth:0 }}>
          {enabled && <span style={{ width:6, height:6, borderRadius:'50%', background: GREEN, marginRight:8, flexShrink:0, boxShadow:'0 0 6px var(--hm-green-glow)' }} />}
          {icon && <span aria-hidden="true" style={{ display:'flex', marginRight:8, flexShrink:0, opacity: enabled ? 1 : 0.75 }}>{icon}</span>}
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{title}</span>
        </span>
        <span aria-hidden="true" style={{
          fontSize:22, fontWeight:700, color: MUTED, lineHeight:1, display:'inline-block', flexShrink:0,
          transform: isOpen ? 'none' : 'rotate(-90deg)', transition:'transform .18s'
        }}>▾</span>
      </button>
      <div style={{ display:'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', overflow:'hidden', transition:'grid-template-rows .2s ease' }}>
        <div style={{ minHeight:0, overflow:'hidden', padding: isOpen ? '0 14px 12px' : '0 14px' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * The panel's button.
 *
 * Fifty-seven of the sixty-three buttons in the panel carried their own inline
 * font size, padding, radius, border, colour, background and cursor — the same
 * element, seven decisions, fifty-seven times, which is how one panel ended up
 * with four button font sizes and four button radii.
 *
 * What this owns is *appearance by state*: the four looks a button can have and
 * what each does when it is hovered, pressed or disabled. Geometry stays
 * overridable through `style`, because these sit in rows of genuinely different
 * shapes — a full-width export tile and a two-character `all` are not the same
 * button wearing different padding.
 *
 *   quiet    the default — a surface with an edge
 *   ghost    no ground of its own; for dismissers and inline actions
 *   primary  the accent, under white text
 *   toggle   `on` decides which of the two it is
 */
const BTN_SIZES = {
  xs: { fontSize: 10,  padding: '2px 6px', borderRadius: 3 },
  sm: { fontSize: 10, padding: '3px 6px', borderRadius: 3 },
  md: { fontSize: 11, padding: '5px 7px', borderRadius: 5 },
}

export function Btn({
  variant = 'quiet', size = 'sm', on = false, block = false,
  style, children, ...rest
}) {
  // ACCENT rather than ACCENT_DEEP, because that is what the twenty toggle
  // buttons in the panel are today and this migration is meant to be invisible.
  // White on ACCENT is 3.68:1 and fails AA at these sizes — changing this one
  // line lifts every toggle at once, which is the whole point of the primitive.
  const look = variant === 'toggle'
    ? (on ? { background: ACCENT, color: '#fff', border: `1px solid ${ACCENT}` }
          : { background: SURF, color: MUTED, border: `1px solid ${BORDER}` })
    : variant === 'primary'
      ? { background: ACCENT_DEEP, color: '#fff', border: `1px solid ${ACCENT_DEEP}` }
      : variant === 'ghost'
        ? { background: 'none', color: MUTED, border: 'none' }
        : { background: SURF, color: MUTED, border: `1px solid ${BORDER}` }

  return (
    <button type="button" {...rest} style={{
      ...BTN_SIZES[size], ...look,
      cursor: rest.disabled ? 'default' : 'pointer',
      fontFamily: 'inherit',
      ...(block && { flex: 1 }),
      ...(rest.disabled && { opacity: 0.5 }),
      ...style,
    }}>{children}</button>
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
    <button className="hmeb" onClick={onClick} data-testid={testId} type="button" style={{
      flex:1, padding:'8px 0', textAlign:'center',
      background: active ? ACCENT_DEEP : SURF,
      color: active ? '#fff' : DIM,
      border:`1px solid ${active ? ACCENT_DEEP : BORDER}`, borderRadius:5,
      cursor:'pointer', fontSize:11, fontWeight:600,
    }}>
      {label}
      {hint && <span className="hmeh" style={{ display:'block', fontSize:10, color: active ? 'rgba(255,255,255,.75)' : MUTED, fontWeight:400, marginTop:2 }}>{hint}</span>}
    </button>
  )
}
