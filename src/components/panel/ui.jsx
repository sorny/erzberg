/**
 * Shared right-hand-panel primitives.
 *
 * These started out inside Sidebar.jsx and were lifted here when Edit Mode grew
 * a second panel: EditPanel has to look like it belongs to the same tool, and
 * the alternative was a second copy of every token and control that would drift
 * on the first tweak. Nothing here knows about terrain — it is the panel's
 * design system and nothing else.
 */
import { useContext, useEffect, useId, useRef, useState } from 'react'
import { PanelStage, SectionFilter, sectionMatches } from './filter'
import { PRESETS_STAGE, STAGES } from './stages'
import { HEX, PALETTES } from '../../utils/theme'

// ── Design tokens ─────────────────────────────────────────────────────────────
/**
 * Ore and Paper, published twice.
 *
 * The palettes live in `utils/theme.js`, which is the only place a panel colour
 * is written down. `PanelStyles` publishes the active one as custom properties,
 * and the exports below are `var()` references — so every inline
 * `style={{ background: SURF }}` follows the theme without knowing there is one.
 *
 * `HEX` is the live palette as literal colours, for a 2D canvas, which resolves
 * nothing. It changes in place with the theme; read it at draw time.
 */
export { HEX }

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
/** Text on an accent fill. Ink, not white: white on ore is 2.7 : 1. */
export const ON_ACCENT   = 'var(--hm-on-accent)'
/** The accent as a text colour, which on light paper has to be deeper than the fill. */
export const ACCENT_TEXT = 'var(--hm-accent-text)'
/** "Switched on". Ore, like every other on-state: one colour means on. */
export const GREEN       = 'var(--hm-on)'
/** The wordmark and anything else set in the strongest ink. */
export const STRONG      = 'var(--hm-strong)'
/** A well sunk into the panel: segmented choices, the rail, help boxes. */
export const SUNK        = 'var(--hm-sunk)'
/** A hover wash over whatever is underneath. */
export const VEIL        = 'var(--hm-veil)'
export const DESK        = 'var(--hm-desk)'
export const DANGER      = 'var(--hm-danger)'
export const DANGER_TEXT = 'var(--hm-danger-text)'
export const DANGER_BG   = 'var(--hm-danger-bg)'
export const DANGER_BORDER = 'var(--hm-danger-border)'
export const WARN        = 'var(--hm-warn)'
export const WARN_BG     = 'var(--hm-warn-bg)'
export const WARN_BORDER = 'var(--hm-warn-border)'
export const GLASS_BG    = 'var(--hm-glass-bg)'
export const GLASS_BORDER = 'var(--hm-glass-border)'
export const GLASS_TEXT  = 'var(--hm-glass-text)'
export const FONT        = 'var(--hm-font)'
export const MONO        = 'var(--hm-mono)'
/*
 * A number, not a colour — it is arithmetic (`right: open ? W : 0`).
 *
 * `W` is what the panel costs the drawing, and every consumer reads it: the
 * canvas inset in App.jsx, the paper overlay's geometry, the collapse handle,
 * the Edit panel that stands in the sidebar's place.
 *
 * It was 272 for the whole life of the panel, and 272 is still the width the
 * *controls* get — `BODY_W` below. The extra 40 is the stage rail, which is
 * navigation rather than control and so is paid for out of the window instead of
 * out of the sliders. Taking it out of the body would have cost every slider in
 * the panel 28% of its travel, across some 350 of them, to save 40 px of a
 * roughly 1 900 px canvas.
 */
export const W      = 312   // panel width px, rail included
export const RAIL_W = 40    // the stage rail
export const BODY_W = 272   // what the controls get, unchanged

// ── Injected styles (pseudo-elements can't be set inline) ─────────────────────
/** One palette as custom-property declarations. */
function themeVars(P) {
  const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  return Object.entries(P).map(([k, v]) => `--hm-${kebab(k)}: ${v};`).join(' ') +
    ` --hm-accent-ring: ${P.accent}80; --hm-green-glow: ${P.on}88;`
}

export function PanelStyles() {
  return (
    <style>{`
      /* The indeterminate fetch bar. A query Overpass has not answered yet has
         nothing to measure, so the stripe travels rather than fills. */
      @keyframes hm-indet { from { transform: translateX(-40%) } to { transform: translateX(240%) } }
      .hm-indet { animation: hm-indet 1.15s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) { .hm-indet { animation: none; opacity: 0.5; } }
      /*
       * Space Mono Bold, self-hosted.
       *
       * It sets two words — the erzberg wordmark and Edit Mode's "edit" — and it
       * used to cost a request to fonts.googleapis.com on every load, which
       * revealed each visitor's IP to a third party. That sat badly beside the
       * promise at the top of the README that everything runs locally: the claim
       * is about the user's *files* and stayed true, but "no server" reads more
       * broadly than that, and 9.6 kB of woff2 is a cheap way to mean it.
       *
       * The Latin subset, as Google Fonts serves it — the full weight rather
       * than the eight glyphs actually set, so adding a word to the header
       * cannot silently produce tofu. SIL OFL 1.1, which expressly permits
       * bundling; the licence ships beside it at public/fonts/OFL.txt.
       *
       * BASE_URL rather than a rooted path: this deploys to a project page under
       * /erzberg/, where /fonts/… would be a 404.
       */
      @font-face {
        font-family: 'Space Mono';
        font-style: normal;
        font-weight: 700;
        font-display: swap;
        src: url('${import.meta.env.BASE_URL}fonts/space-mono-700-latin.woff2') format('woff2');
      }

      ${['dark', 'light'].map((m) => `${m === 'dark' ? ':root' : ':root[data-hm-theme="light"]'} {
        color-scheme: ${m};
        ${themeVars(PALETTES[m])}
      }`).join('\n')}
      :root {
        /* Overpass carries the lettering of road signs, so the vernacular of maps;
           Overpass Mono sets every number, so digits hold their width while a
           slider moves. Both self-hosted, like Space Mono: no request on load. */
        --hm-font: 'Overpass', system-ui, -apple-system, sans-serif;
        --hm-mono: 'Overpass Mono', ui-monospace, 'SF Mono', Menlo, monospace;
        --hm-ease: cubic-bezier(.2,.8,.2,1);
      }
      @font-face { font-family:'Overpass'; font-style:normal; font-weight:300 800; font-display:swap;
        src:url('${import.meta.env.BASE_URL}fonts/overpass-latin.woff2') format('woff2'); }
      @font-face { font-family:'Overpass Mono'; font-style:normal; font-weight:300 700; font-display:swap;
        src:url('${import.meta.env.BASE_URL}fonts/overpass-mono-latin.woff2') format('woff2'); }

      /* A focus ring on everything the keyboard can reach, at zero specificity
         so a control with its own ring keeps it. */
      :where(#hm-panel, [data-testid="edit-panel"], [data-testid="mask-panel"]) :is(button, a, input[type=search], input[type=text], select):focus-visible {
        outline:2px solid var(--hm-accent); outline-offset:1px; }

      /* The element is 19 px tall and transparent; the 3 px track is drawn by the
         track pseudo-element inside it. Same hairline as before, in a band a
         pointer can actually land on — the old 3 px box left the thumb's 13 px
         of overflow as the entire target. */
      /* The filled part of the track is the value, readable at a glance down a
         column of sliders. \`--p\` is set per slider (0–100%); the thumb is a
         white disc on a hairline shadow, which reads on any accent. */
      .hmr { --p:0%; -webkit-appearance:none; appearance:none; flex:1; min-width:0; width:0;
        height:20px; padding:0; background:none; outline:none; cursor:pointer; }
      .hmr::-webkit-slider-runnable-track { height:4px; border-radius:999px;
        background:linear-gradient(to right, var(--hm-accent) 0 var(--p), var(--hm-border) var(--p) 100%); }
      .hmr::-moz-range-track { height:4px; background:${BORDER}; border-radius:999px; }
      .hmr::-moz-range-progress { height:4px; background:${ACCENT}; border-radius:999px; }
      .hmr::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px;
        margin-top:-5px; border-radius:50%; background:var(--hm-thumb); border:none; cursor:grab;
        box-shadow:0 0 0 1px var(--hm-shadow), 0 1px 3px var(--hm-shadow);
        transition:transform .15s var(--hm-ease), box-shadow .15s var(--hm-ease); }
      .hmr:hover::-webkit-slider-thumb { transform:scale(1.12); }
      .hmr:active::-webkit-slider-thumb { transform:scale(1.2); cursor:grabbing; }
      .hmr::-moz-range-thumb { width:14px; height:14px; border-radius:50%;
        background:var(--hm-thumb); border:none; box-shadow:0 0 0 1px var(--hm-shadow), 0 1px 3px var(--hm-shadow); }
      /* :focus, not :focus-visible.
         Clicking a slider arms it for the arrow keys, so the state is real from
         the click — and :focus-visible withholds the ring until the first
         keypress, which hides it for exactly as long as it is the only thing
         telling you which of thirty-one sliders an arrow key will move. */
      .hmr:focus::-webkit-slider-thumb { box-shadow:0 0 0 1px var(--hm-shadow), 0 0 0 4px var(--hm-accent-ring); }
      .hmr:focus::-moz-range-thumb     { box-shadow:0 0 0 1px var(--hm-shadow), 0 0 0 4px var(--hm-accent-ring); }
      .hmc { -webkit-appearance:none; appearance:none; width:32px; height:20px;
        border:1px solid ${BORDER}; border-radius:5px; cursor:pointer;
        padding:2px; background:${SURF}; transition:border-color .15s var(--hm-ease); }
      .hmc:hover { border-color:${MUTED}; }
      .hmc::-webkit-color-swatch-wrapper { padding:0; }
      .hmc::-webkit-color-swatch { border:none; border-radius:3px; }
      .hmc:focus-visible { outline:2px solid ${ACCENT}; outline-offset:1px; }
      .hmeb:hover { background:${ACCENT_DEEP} !important; border-color:${ACCENT_DEEP} !important; color:${ON_ACCENT} !important; }
      .hmeb:hover .hmeh { color:${ON_ACCENT} !important; opacity:.75; }
      .hmsb.on { background:${ACCENT_DEEP} !important; color:${ON_ACCENT} !important; border-color:${ACCENT_DEEP} !important; }
      .hmsb:hover:not(.on) { background:${BORDER} !important; color:${DIM} !important; }
      .hmload:hover { background:${SURF} !important; color:${TEXT} !important; }
      /* A 10 px gutter a pointer can find, drawing a 4 px thumb inside it. */
      #hm-panel-body::-webkit-scrollbar { width:10px; }
      #hm-panel-body::-webkit-scrollbar-thumb { background:${BORDER}; border-radius:999px;
        border:3px solid transparent; background-clip:content-box; }
      #hm-panel-body::-webkit-scrollbar-thumb:hover { background-color:${MUTED}; }
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
               font-family:var(--hm-mono); font-variant-numeric:tabular-nums; }
      .hmnum:focus { border-color:${ACCENT}; }
      /* The readout beside a slider, once it accepts a typed value. Reads as a
         label until it is hovered or focused — the panel would be a wall of
         boxes otherwise. */
      .hmval { -webkit-appearance:none; appearance:none; background:none;
        border:1px solid transparent; border-radius:3px; padding:1px 3px; margin:-1px -3px;
        color:${MUTED}; cursor:text; text-align:right;
        font:inherit; font-family:var(--hm-mono); font-variant-numeric:tabular-nums; outline:none; }
      .hmval:hover { border-color:${BORDER}; }
      .hmval:focus { border-color:${ACCENT}; color:${TEXT}; background:${SURF}; }
      /* Disclosure header. A button, so the keyboard can open a section — every
         control in a collapsed one is otherwise unreachable. */
      .hmsec { -webkit-appearance:none; appearance:none; background:none; border:none;
        font:inherit; color:inherit; text-align:left; }
      .hmsec { transition:background .15s var(--hm-ease); }
      .hmsec:hover { background:${VEIL}; }
      .hmsec .hmsectitle, .hmsec .hmchevron { transition:color .15s var(--hm-ease), transform .2s var(--hm-ease); }
      .hmsec:hover .hmsectitle, .hmsec:hover .hmchevron { color:${DIM}; }

      /* Stage tabs: a quiet hover, and the selected tab joined to its pane. */
      .hmtab { transition:background .15s var(--hm-ease), color .15s var(--hm-ease); }
      .hmtab:hover:not([aria-pressed="true"]) { background:${VEIL}; color:${DIM} !important; }

      /* Switch: the input is the hit target, the two spans are the picture. */
      .hmsw .hmswtrack { transition:background .2s var(--hm-ease), box-shadow .2s var(--hm-ease); }
      .hmsw .hmswknob { transition:transform .22s var(--hm-ease); }
      .hmsw:hover .hmswtrack { filter:brightness(1.12); }
      .hmsw input:focus-visible + .hmswtrack { box-shadow:0 0 0 3px var(--hm-accent-ring); }

      /* Segmented control: one well, the choice a raised pill inside it. */
      .hmseg { transition:background .15s var(--hm-ease), color .15s var(--hm-ease), box-shadow .15s var(--hm-ease); }
      .hmseg:hover:not([aria-pressed="true"]) { color:${DIM} !important; background:${VEIL} !important; }
      .hmseg:focus-visible { outline:2px solid ${ACCENT}; outline-offset:-1px; }

      /* Buttons: one response to hover and press, whatever their colours. */
      .hmbtn { transition:filter .12s var(--hm-ease), transform .08s var(--hm-ease), border-color .15s, color .15s; }
      .hmbtn:not(:disabled):hover { filter:brightness(1.2); }
      .hmbtn:not(:disabled):active { transform:translateY(.5px) scale(.985); }
      .hmeb, .hmsb, .sym-btn, .hmload { transition:background .15s var(--hm-ease), border-color .15s var(--hm-ease), color .15s var(--hm-ease), transform .08s; }
      .hmeb:active, .hmsb:active, .sym-btn:active { transform:scale(.97); }

      @media (prefers-reduced-motion: reduce) {
        .hmsec, .hmtab, .hmsw *, .hmseg, .hmbtn, .hmeb, .hmsb, .hmr::-webkit-slider-thumb { transition:none !important; }
      }
      .hmsec:focus-visible { outline:2px solid ${ACCENT}; outline-offset:-2px; }
      /* The per-section reset. Revealed on hover rather than drawn outright,
         and that is a width decision rather than a taste one: a header is at
         its tightest when its mode is on and the section is shut, and reserving
         room for this clipped ten of them by up to 25 px. It costs no layout at
         all — the mark beside it is what says a section has something to reset
         while the pointer is elsewhere. */
      .hmreset { opacity:0; transition:opacity .12s; }
      [data-section]:hover .hmreset, .hmreset:focus-visible { opacity:1; }

      /*
       * A tile on the mark sheet: a pip and a card.
       *
       * The tile carries two actions — switch the mark on, open its settings —
       * and the first build gave them one look. People found the second by
       * accident, which is not finding it.
       *
       * The fix is shape. The pip is round, small and lights green, which is
       * what every other switch in this panel looks like. Everything else is a
       * card with a chevron on it, and a chevron means it goes somewhere. Hover
       * separates them again: the card lifts as one piece, and the pip lights
       * its own 20 px target inside it. Nobody has to be told which is which,
       * because they no longer look alike.
       *
       * Styles rather than inline hover handlers: this is thirty-eight tiles with
       * two targets each, so handlers would be sixty-eight closures rebuilt on
       * every render of the sheet. A backtick in this comment would also end the
       * template literal the whole stylesheet is written in.
       */
      .hmcard { transition:border-color .15s var(--hm-ease), background .15s var(--hm-ease), transform .15s var(--hm-ease), box-shadow .15s var(--hm-ease); }
      .hmcard:hover { border-color:${MUTED}; }
      .hmcard:hover .hmchev { color:${TEXT}; }
      .hmcardhit { -webkit-appearance:none; appearance:none; background:none;
        border:none; font:inherit; color:inherit; text-align:left; width:100%;
        display:block; padding:0; cursor:pointer; }
      .hmcardhit:focus-visible { outline:2px solid ${ACCENT}; outline-offset:-2px; }
      .hmpip { -webkit-appearance:none; appearance:none; background:none; border:none;
        padding:0; cursor:pointer; border-radius:4px; transition:background .12s; }
      .hmpip:hover { background:var(--hm-veil-strong); }
      .hmpip:hover .hmpipdot { border-color:${TEXT}; }
      .hmpip:focus-visible { outline:2px solid ${ACCENT}; outline-offset:-1px; }
      .hmpipdot { transition:background .12s, border-color .12s, box-shadow .12s; }

      /* Dual-handle range. Two native inputs stacked: the tracks are inert and
         only the thumbs take the pointer, which keeps keyboard control and the
         native feel that a hand-rolled two-thumb widget throws away. */
      .hmrr { -webkit-appearance:none; appearance:none; position:absolute; left:0; top:0;
        width:100%; height:13px; margin:0; background:none; pointer-events:none; outline:none; }
      .hmrr::-webkit-slider-thumb { -webkit-appearance:none; pointer-events:auto; width:13px;
        height:13px; border-radius:50%; background:var(--hm-thumb); border:none; cursor:grab;
        box-shadow:0 0 0 1px var(--hm-shadow), 0 1px 3px var(--hm-shadow);
        transition:transform .15s var(--hm-ease); }
      .hmrr:hover::-webkit-slider-thumb { transform:scale(1.12); }
      .hmrr::-moz-range-thumb { pointer-events:auto; width:13px; height:13px; border-radius:50%;
        background:#fafafa; border:none; cursor:grab; box-shadow:0 0 0 1px rgba(0,0,0,.35), 0 1px 3px rgba(0,0,0,.5); }
      .hmrr:focus::-webkit-slider-thumb { box-shadow:0 0 0 3px var(--hm-accent-ring); }
      .hmrr:focus::-moz-range-thumb     { box-shadow:0 0 0 3px var(--hm-accent-ring); }
      .hmrr::-webkit-slider-runnable-track { background:none; border:none; }
      .hmrr::-moz-range-track { background:none; border:none; }

      .sym-btn { background:${SURF}; border:1px solid ${BORDER}; color:${MUTED}; border-radius:5px;
                 cursor:pointer; display:flex; flex-direction:column; align-items:center;
                 justify-content:center; font-size:12px; font-weight:700; transition:all 0.1s; aspect-ratio:1/1; }
      .sym-btn.on { background:${ACCENT_DEEP}; color:${ON_ACCENT}; border-color:${ACCENT_DEEP}; }
      .sym-btn:hover:not(.on) { border-color:${MUTED}; color:${DIM}; }
      .sym-label { font-size:9px; margin-top:2px; opacity:0.9; }
    `}</style>
  )
}

// ── UI Atomic Components ───────────────────────────────────────────────────────

export function HelpBox({ text }) {
  return (
    <div style={{
      fontSize: 10, color: MUTED, background: SUNK,
      padding: '6px 8px', borderRadius: 5, marginBottom: 8,
      border: `1px solid ${BORDER}`, lineHeight: 1.45
    }}>
      {text}
    </div>
  )
}

/**
 * A standing caveat about a mode, always visible.
 *
 * `HelpBox` is the body of a help toggle: it appears when someone asks a
 * question. This is the answer to a question they have not asked yet — that
 * Outrun does nothing on white paper, that Riso does nothing on a black one.
 * A control whose result depends on a setting in a different section has to say
 * so where it is, or the first thing it does is look broken.
 */
export function Note({ children }) {
  return (
    <div style={{
      fontSize: 9.5, color: MUTED, lineHeight: 1.5, marginTop: -4, marginBottom: 10,
      paddingLeft: 6, borderLeft: `2px solid ${BORDER}`,
    }}>
      {children}
    </div>
  )
}

/**
 * The smallest button the panel has: a bare word, used in a row of two or three.
 *
 * It lives here rather than beside its one caller because `FeaturePicker` is a
 * hook, and a file that exports a hook and declares a component cannot be
 * hot-reloaded — Fast Refresh needs a module whose exports are all components or
 * none. Its siblings are here anyway.
 */
export function MiniBtn({ onClick, testId, children }) {
  return (
    <button onClick={onClick} data-testid={testId} style={{
      padding: '2px 4px', fontSize: 10, borderRadius: 3, cursor: 'pointer',
      background: SURF, color: MUTED, border: `1px solid ${BORDER}`,
    }}>{children}</button>
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

/** How far along its track a slider sits, for the filled part of the track. */
function fillOf(value, min, max) {
  const p = max > min ? ((value - min) / (max - min)) * 100 : 0
  return { '--p': `${Math.max(0, Math.min(100, p))}%` }
}

export function Sl({ label, hint, help, min, max, step = 1, value, onChange, fmt, col2, testId }) {
  const [showHelp, setShowHelp] = useState(false)
  const id = useId()
  const parsed = (v) => step < 1 ? parseFloat(v) : parseInt(v)
  return (
    <div style={{ marginBottom: 8, ...(col2 && { gridColumn: '1/-1' }) }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: DIM, display: 'flex', alignItems: 'center' }}>
          {/* The label wraps the text and NOT the help button: a `?` inside a
              `<label>` would toggle the control it explains on every click. */}
          <label htmlFor={id} style={{ cursor: 'pointer' }}>{label}</label>
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        {hint && <span style={{ fontSize: 10, color: MUTED }}>{hint}</span>}
      </div>
      {showHelp && help && <HelpBox text={help} />}
      <div style={{ display:'flex', alignItems:'center', gap: 7 }}>
        {/* aria-valuetext: what the panel prints, not the raw number. A slider
            reading "50.0°" or "100%" was announced as "50" or "1" — the value a
            screen reader heard and the one beside it disagreed, and `fmt` was
            already in scope. */}
        <input type="range" className="hmr" id={id} data-testid={testId} aria-label={label}
          aria-valuetext={fmt ? String(fmt(value)) : undefined}
          min={min} max={max} step={step} value={value} style={fillOf(value, min, max)}
          onChange={e => onChange(parsed(e.target.value))} />
        <ValueField label={label} value={value} onChange={onChange} fmt={fmt}
          min={min} max={max} step={step} width={36} />
      </div>
    </div>
  )
}

export function Tog({ label, hint, help, checked, onChange, small, testId }) {
  const [showHelp, setShowHelp] = useState(false)
  const id = useId()
  const fs = small ? 11 : 12
  const tc = small ? MUTED : DIM
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: showHelp ? 4 : 0 }}>
        <span style={{ fontSize: fs, color: tc, display: 'flex', alignItems: 'center' }}>
          <label htmlFor={id} style={{ cursor: 'pointer' }}>{label}</label>
          {hint && <span style={{ fontSize: fs - 1, color: MUTED, marginLeft: 6 }}> {hint}</span>}
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <Switch id={id} label={label} checked={checked} onChange={onChange} testId={testId} />
      </div>
      {showHelp && help && <HelpBox text={help} />}
    </div>
  )
}

export function Switch({ id, label, checked, onChange, testId }) {
  return (
    <label className="hmsw" style={{ position:'relative', display:'inline-block', width:34, height:18, flexShrink:0, cursor:'pointer' }}>
      <input type="checkbox" id={id} checked={checked} aria-label={label} data-testid={testId}
        onChange={e => onChange(e.target.checked)}
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', opacity:0, margin:0, cursor:'pointer', zIndex:1 }} />
      <span className="hmswtrack" style={{
        position:'absolute', inset:0, borderRadius:9, pointerEvents:'none',
        background: checked ? ACCENT : BORDER,
        boxShadow: checked ? 'none' : 'inset 0 1px 2px var(--hm-shadow)',
      }}>
        <span className="hmswknob" style={{
          position:'absolute', width:14, height:14, borderRadius:7, background: checked ? ON_ACCENT : 'var(--hm-thumb)',
          top: 2, left: 2, transform: checked ? 'translateX(16px)' : 'none',
          boxShadow:'0 1px 2px var(--hm-shadow)',
        }} />
      </span>
    </label>
  )
}

export function ColorRow({ label, help, value, onChange, testId }) {
  const [showHelp, setShowHelp] = useState(false)
  const id = useId()
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize: 12, color: DIM, display:'flex', alignItems:'center' }}>
          <label htmlFor={id} style={{ cursor: 'pointer' }}>{label}</label>
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <input type="color" className="hmc" id={id} data-testid={testId} aria-label={label}
          value={value} onChange={e => onChange(e.target.value)} />
      </div>
      {showHelp && help && <HelpBox text={help} />}
    </div>
  )
}

/**
 * A calendar field.
 *
 * The panel is otherwise sliders and switches, and a date is neither: there is
 * no useful continuum between 21 June and 22 June that a drag along a track
 * would express, and the one thing a user wants to type is a solstice. So this
 * is the browser's own date control, which brings a picker and a keyboard entry
 * path with it and needs no calendar of ours.
 *
 * `colorScheme: dark` is not decoration — without it Chrome draws its calendar
 * glyph in near-black on the panel's near-black surface, and the control looks
 * like an empty box.
 */
export function DateRow({ label, help, value, onChange, testId }) {
  const [showHelp, setShowHelp] = useState(false)
  const id = useId()
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap: 7 }}>
        <span style={{ fontSize: 11, color: MUTED, display:'flex', alignItems:'center', whiteSpace:'nowrap' }}>
          <label htmlFor={id} style={{ cursor: 'pointer' }}>{label}</label>
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        <input type="date" id={id} data-testid={testId} aria-label={label}
          value={value ?? ''} onChange={e => onChange(e.target.value)}
          style={{
            flex: 1, minWidth: 0, fontSize: 11, padding:'3px 5px', borderRadius: 3,
            background: SURF, color: DIM, border: `1px solid ${BORDER}`,
            fontFamily: 'inherit',
          }} />
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
  const id = useId()
  const parsed = (v) => step < 1 ? parseFloat(v) : parseInt(v)
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display:'flex', alignItems:'center', gap: 7, marginBottom: showHelp ? 4 : 0 }}>
        <span style={{ fontSize: 11, color: MUTED, whiteSpace:'nowrap', minWidth: 52, display: 'flex', alignItems: 'center' }}>
          <label htmlFor={id} style={{ cursor: 'pointer' }}>{label}</label>
          {hint && <span style={{ fontSize: 10, color: MUTED, marginLeft: 3 }}>{hint}</span>}
          {help && <HelpBtn label={label} active={showHelp} onClick={() => setShowHelp(!showHelp)} />}
        </span>
        {/* aria-valuetext: what the panel prints, not the raw number. A slider
            reading "50.0°" or "100%" was announced as "50" or "1" — the value a
            screen reader heard and the one beside it disagreed, and `fmt` was
            already in scope. */}
        <input type="range" className="hmr" id={id} data-testid={testId} aria-label={label}
          aria-valuetext={fmt ? String(fmt(value)) : undefined}
          min={min} max={max} step={step} value={value} style={fillOf(value, min, max)}
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
          <div style={{ position:'absolute', top:4.5, left:0, right:0, height:4, background: BORDER, borderRadius:999 }} />
          <div style={{ position:'absolute', top:4.5, height:4, borderRadius:999, background: ACCENT,
                        left:`${pct(lo)}%`, width:`${Math.max(0, pct(hi) - pct(lo))}%` }} />
          <input type="range" className="hmrr" data-testid={testId && `${testId}-lo`}
            aria-label={`${label} lower bound`} aria-valuetext={String(f(lo))}
            min={min} max={max} step={step} value={lo}
            onChange={(e) => onChange(Math.min(parseFloat(e.target.value), hi - GAP), hi)} />
          <input type="range" className="hmrr" data-testid={testId && `${testId}-hi`}
            aria-label={`${label} upper bound`} aria-valuetext={String(f(hi))}
            min={min} max={max} step={step} value={hi}
            onChange={(e) => onChange(lo, Math.max(parseFloat(e.target.value), lo + GAP))} />
        </div>
        <span style={{ minWidth: 52, textAlign:'right', fontSize: 10, color: MUTED, fontFamily: MONO, fontVariantNumeric:'tabular-nums' }}>
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
        <SegGroup label={label} options={options} value={value} onChange={onChange}
          nameButtons testIdOf={testIdPrefix ? (v) => `${testIdPrefix}-${v}` : undefined}
          style={{ flex: 1 }} />
      </div>
      {showHelp && help && <HelpBox text={help} />}
    </div>
  )
}

/**
 * One exclusive choice, drawn as a well with the chosen option raised in it.
 *
 * The panel had sixteen hand-built rows of this, each with its own padding,
 * radius and border. This is the one shape they share. `columns` lays the
 * options out as a grid instead of one row, for sets too long to fit.
 */
export function SegGroup({ options, value, onChange, label, capitalize = false, columns, testIdOf, style, nameButtons = false }) {
  return (
    <div role="group" aria-label={label} style={{
      display: columns ? 'grid' : 'flex',
      ...(columns && { gridTemplateColumns: `repeat(${columns}, 1fr)` }),
      gap: 2, padding: 2, borderRadius: 6,
      background: SUNK, border:`1px solid ${BORDER}`,
      ...style,
    }}>
      {options.map(([lbl, v]) => {
        const on = value === v
        return (
          <button key={String(v)} onClick={() => onChange(v)} type="button" className="hmseg"
            data-testid={testIdOf ? testIdOf(v) : undefined}
            aria-label={nameButtons && label ? `${label}: ${lbl}` : undefined} aria-pressed={on}
            style={{
              flex: 1, fontSize: 10, padding:'3px 2px', borderRadius: 4, border:'none',
              cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap',
              ...(capitalize && { textTransform:'capitalize' }),
              fontWeight: on ? 600 : 500,
              background: on ? ACCENT_DEEP : 'transparent',
              color: on ? ON_ACCENT : MUTED,
              boxShadow: on ? '0 1px 2px var(--hm-shadow)' : 'none',
            }}>{lbl}</button>
        )
      })}
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
 *
 * `summary` is what the header says while the section is shut — see
 * `sectionSummary.js`. Like `terms` it arrives through the context rather than
 * as a prop, so the fifty call sites in Sidebar.jsx are untouched; passing it
 * directly still works, for a section whose state the panel cannot see.
 */
export function Section({ title, terms, summary, open, onToggle, enabled, icon, children }) {
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
  /*
   * Marks is a sheet, so its thirty-five headers are behind it.
   *
   * The sheet stands in for the whole stage: with nothing drilled into, the only
   * Marks section on screen is `Draw Modes`, which is what holds the sheet.
   * Open one mode and the sheet's own section goes too, so the mode has the
   * pane to itself — which is the point of drilling in at all.
   *
   * Hidden on the same terms as a filtered-out section, and for the same reason:
   * these sections own local state and a click on a tile must not throw it away.
   * One rule here rather than a prop on thirty-five call sites, and the rule is
   * written from the titles because that is what the sheet is built from too.
   */
  const inMarks  = title === 'Draw Modes' || title.startsWith('Mode: ')
  const drill    = ctx?.drill ?? null
  // A search is flat and crosses every pane, so it outranks the sheet.
  const sheetOut = !q && inMarks && (drill ? title !== drill : title !== 'Draw Modes')
  // While filtering, a surviving section is open: the point of finding it is to
  // reach the control inside, and a hit that still needs a click is half an answer.
  // A drilled-in mode is open for the same reason — you asked for its controls.
  const isOpen = q || (drill && title === drill) ? true : open
  /**
   * The readout, and only while the section is shut.
   *
   * An open section has its controls on screen saying the same thing in full, so
   * a summary beside the title would be a second, shorter copy of what is
   * already there — and it would move under the cursor on the way to the header,
   * which is the one place it must not.
   */
  const raw = isOpen ? null : (summary ?? ctx?.summaries?.[title])
  // A summary is a string, or `{ text, hint }` where the hint names the
  // parameter the number came from — a bare `10` is short enough to fit beside
  // MODE: CROSSHATCH, and the label it lost comes back on hover.
  const readout = typeof raw === 'string' ? { text: raw } : raw
  /*
   * The reset, and why it is not on every header.
   *
   * Fifty-five identical icons down the panel would be chrome. Drawn only where
   * a section differs from its defaults, the same control is information: shut
   * or open, the mark says *this is one of the places you changed something*,
   * which is the question a panel this size cannot otherwise answer.
   *
   * `modified` is computed in the Sidebar from `sectionParams.js` and arrives
   * through the context, so a section that holds no settings never has one.
   */
  const canReset = !q && !!ctx?.onReset && !!ctx?.modified?.has(title)
  return (
    /*
     * `data-section` is a handle, and it exists because the specs had to reach a
     * section without one. They matched `#hm-panel-body > div` on its text,
     * which is a bet on how deep in the tree a section happens to sit — and the
     * stage wrappers moved every section down one level and collected that bet:
     * seven specs went red on a change that altered nothing they were testing.
     */
    <div data-section={title}
         style={{ position: 'relative', borderBottom: `1px solid ${BORDER}`,
                  ...(matches && !sheetOut ? null : { display: 'none' }) }}
         data-filtered-out={matches ? undefined : 'true'}
         data-sheet-out={sheetOut ? 'true' : undefined}>
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
        data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`} style={{
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:10,
          padding:'10px 14px', userSelect:'none', width:'100%',
          // One `style`, not two. This element used to carry the prop twice —
          // a filtering-only `{ cursor: 'default' }` and then this object — and
          // JSX keeps the last one, so the override above it never applied and
          // the header went on showing a pointer over a control the filter had
          // already made inert.
          cursor: q ? 'default' : 'pointer',
        }}>
        <span className="hmsectitle" style={{ fontSize:12, fontWeight:600, color: DIM, display:'flex', alignItems:'center', minWidth:0 }}>
          {enabled && <span style={{ width:6, height:6, borderRadius:'50%', background: GREEN, marginRight:8, flexShrink:0, boxShadow:'0 0 6px var(--hm-green-glow)' }} />}
          {icon && <span aria-hidden="true" style={{ display:'flex', marginRight:8, flexShrink:0, opacity: enabled ? 1 : 0.75 }}>{icon}</span>}
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{title}</span>
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, minWidth:0 }}>
          {/* The same role a slider's own readout uses — 10 px, MUTED, tabular
              — because it is the same thing one level up, and the panel runs on
              four type roles rather than five. Capped so a long line truncates
              rather than pushing a section's name off its header; with the
              readouts as short as they are, nothing reaches the cap. */}
          {readout && (
            <span data-testid={`summary-${title.toLowerCase().replace(/\s+/g, '-')}`}
              title={readout.hint} style={{
                fontSize:10, fontWeight:400, color: MUTED, fontFamily: MONO, fontVariantNumeric:'tabular-nums',
                maxWidth:104, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
              }}>{readout.text}</span>
          )}
          {/* A drawn chevron in a 22 px box: the header's height and the reset
              button beside it are both measured from that box. */}
          <span aria-hidden="true" className="hmchevron" style={{
            width:14, height:22, display:'inline-flex', alignItems:'center', justifyContent:'center',
            color: MUTED, flexShrink:0, transform: isOpen ? 'none' : 'rotate(-90deg)',
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3.5 5 6.5 8 3.5" /></svg>
          </span>
        </span>
      </button>
      {/* Two marks, both siblings of the header rather than children of it. The
          header is a button — it has to be, or a collapsed section is
          unreachable from the keyboard — and a button inside a button is
          invalid markup that browsers resolve by dropping one of them.

          Both are pinned to the top of the section and given the header's own
          box: `10px` of padding either side of a `22px` line, which is exactly
          what the header's padding and its chevron come to. So they stay
          centred on the header without anything here knowing its height, and
          they move with it if that padding ever changes. */}
      {canReset && (<>
        {/* The mark. Zero width, so no header loses a pixel to it, and visible
            whether or not the pointer is anywhere near — which is what lets a
            scroll down the panel show where the work is. */}
        <span aria-hidden="true"
          data-testid={`modified-${title.toLowerCase().replace(/\s+/g, '-')}`}
          style={{
            position:'absolute', left:0, top:0, width:2, height:42,
            background: ACCENT, opacity:0.55, pointerEvents:'none',
          }} />
        <button type="button" className="hmreset"
          data-testid={`reset-${title.toLowerCase().replace(/\s+/g, '-')}`}
          onClick={() => ctx.onReset(title)}
          title={`Reset ${title} to its defaults`}
          aria-label={`Reset ${title} to its defaults`}
          style={{
            position:'absolute', right:30, top:0,
            background:'none', border:'none', cursor:'pointer',
            padding:'10px 4px', lineHeight:'22px',
            color: MUTED, fontSize:12, borderRadius:4,
          }}>↺</button>
      </>)}
      <div style={{ display:'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', overflow:'hidden', transition:'grid-template-rows .2s ease' }}>
        <div style={{ minHeight:0, overflow:'hidden', padding: isOpen ? '0 14px 12px' : '0 14px' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * One stage of the pipeline: a heavy sticky line, and the sections under it.
 *
 * The panel's fifty-four sections are the render pipeline written out, and they
 * used to be in the order they were written rather than the order they run:
 * View and Camera between Levels and Terrain Style, Hydraulic Erosion at 48
 * immediately before Export. Nothing was wrong with any one of them, and there
 * was no way to predict where the next one would be.
 *
 * Six rules put that order on screen. `Where is jitter` becomes `jitter changes
 * the source, so it is in Source`, and that reasoning works for a control you
 * have never opened — which is the thing a search box cannot give you.
 *
 * It names the stage and nothing else. A count here would be the third counter
 * in the panel: a shut section already states its own setting, the Draw Modes
 * header already counts the modes, and the standing line already counts the
 * plate. This one is about *order*.
 *
 * Sticky, so the stage you are inside is always named at the top of the panel.
 * It sits directly inside `#hm-panel-body`, which is the scroll container, and
 * carries an opaque background because it passes over content rather than
 * pushing it. Hidden while filtering: the filter is a flat list of hits, and a
 * stage heading over none of its own sections is furniture pointing nowhere.
 *
 * ── One pane at a time ───────────────────────────────────────────────────────
 * The rail selects a stage and the other five hide. The rule they hide by is the
 * filter's rule and not a new one: `display: none`, never an unmount. A
 * collapsed section has always kept its children mounted so that a running
 * Overpass fetch, its cancel controller and a half-set feature filter survive
 * being shut, and a stage is five of those at once. Returning `null` here would
 * throw all of it away on a click of the rail.
 *
 * The rule stays on screen above the sections even though the rail already names
 * the stage. The rail has 40 px and carries `Mark`; this carries `MARKS`, and it
 * is the only place the whole word appears.
 */
export function Stage({ n, title, children }) {
  const q = useContext(SectionFilter)?.q ?? ''
  const sel = useContext(PanelStage)
  // A fragment, not the bare children: the caller renders this among siblings.
  // A search crosses all six panes, so while one is typed there are no panes.
  if (q) return <>{children}</>
  // No rail mounted is the old panel: every stage at once, in pipeline order.
  const shown = !sel || sel.stage === n
  return (
    /*
     * The wrapper is not decoration — it is the mechanism.
     *
     * Six `position: sticky` siblings sharing one scroll container do not hand
     * over to each other. Each one sticks from the moment it reaches the top
     * until its *containing block* leaves, and with a single container that is
     * the whole panel, so all six pile up at the top: measured, Source, Surface
     * and Marks were pinned at y=0 together. Giving each stage its own block is
     * what makes the sixth push the fifth out of the way.
     */
    <div data-stage={n} data-stage-hidden={shown ? undefined : 'true'}
         style={shown ? undefined : { display:'none' }}>
      <div data-testid={`stage-${title.toLowerCase()}`} style={{
        position:'sticky', top:0, zIndex:2,
        display:'flex', alignItems:'center', gap:10, padding:'9px 14px',
        background:'var(--hm-stage-bg)', backdropFilter:'blur(10px) saturate(1.2)',
        WebkitBackdropFilter:'blur(10px) saturate(1.2)',
        borderTop:`1px solid ${BORDER}`, borderBottom:`1px solid ${BORDER}`,
      }}>
        {/* The lozenge again, for the reason the rail carries one: Presets is a
            destination and not a step, and `00` in the pipeline's own column
            would say it was the step before Ground. */}
        <span style={{ fontSize:10, fontWeight:600, color: ACCENT_TEXT, fontFamily: MONO, fontVariantNumeric:'tabular-nums' }}>
          {n === PRESETS_STAGE ? '◇' : String(n).padStart(2, '0')}
        </span>
        <span style={{ fontSize:13, fontWeight:600, color: TEXT }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  )
}

/**
 * The stage rail: six tabs down the panel's edge, one pane on screen.
 *
 * The six stages put the pipeline's *order* on screen and that worked. What they
 * could not fix is its *proportion*. Marks is 35 of the 60 sections, so every
 * trip from Terrain to Export crossed 1 500 px of draw modes, and the other five
 * stages paid for a stage they were not using. The rail does not shorten Marks.
 * It stops the rest of the panel paying for it: Source is 290 px, Surface 180,
 * Overlay 145, Frame 180 and Output two sections.
 *
 * ── Why the badge is a count of lit sections ─────────────────────────────────
 * A pane you cannot see is a pane whose green dots you cannot count, and
 * "something is switched on somewhere I am not looking" is the one thing hiding
 * five sixths of the panel could genuinely cost. The badge is that cost paid
 * back: it reads the same `enabled` the dots read, so the rail and the dots
 * cannot disagree, and a stage doing nothing carries no badge at all rather than
 * a zero — for the reason a shut section says `—` and not the word.
 *
 * ── While the filter is typed ────────────────────────────────────────────────
 * A search crosses all six panes, so the tabs stop being a selection and become
 * a tally: each one says how many of its sections the query found, and the ones
 * that found none go quiet. The pane selection is untouched underneath, so
 * clearing the field puts the panel back exactly where it was.
 *
 * @param {object}   props
 * @param {number}   props.stage    the selected stage number
 * @param {Function} props.onStage  (n) => void
 * @param {object}   props.live     stage number → count of lit sections
 * @param {object}   [props.hits]   stage number → filter hits, while filtering
 */
export function StageRail({ stage, onStage, live, hits }) {
  const filtering = !!hits
  return (
    <nav data-testid="stage-rail" aria-label="Pipeline stage"
      style={{
        width: RAIL_W, flexShrink:0, display:'flex', flexDirection:'column',
        background: SUNK, borderRight:`1px solid ${BORDER}`,
        overflow:'hidden',
      }}>
      {STAGES.map(([n, title, short]) => {
        const sel   = !filtering && stage === n
        const count = filtering ? (hits[n] || 0) : (live[n] || 0)
        // Two different numbers wear two different colours, because they answer
        // two different questions. Lit sections are the panel's green, the same
        // green as the dots they are counting. Filter hits are the accent, which
        // is what every other "this is what you searched for" wears.
        const badge = count > 0
        return (
          <button key={n} type="button" className="hmtab"
            data-testid={`stage-tab-${title.toLowerCase()}`}
            onClick={() => onStage(n)}
            aria-pressed={sel}
            aria-label={`${title}${count > 0 ? `, ${count} ${filtering ? 'found' : 'on'}` : ''}`}
            title={filtering
              ? `${title} — ${count} match${count === 1 ? '' : 'es'}`
              : `${title}${count > 0 ? ` — ${count} on` : ''}`}
            style={{
              position:'relative', padding:'11px 0 12px', border:'none',
              // The heavier rule under Presets is the one piece of furniture
              // that says the pipeline starts below it.
              borderBottom: n === PRESETS_STAGE ? `2px solid ${BORDER}` : `1px solid ${BORDER}`,
              background: sel ? SURF : 'none',
              // The selected tab is marked on the edge it shares with the body,
              // so the rail reads as a set of tabs handing over to one pane
              // rather than six buttons one of which is highlighted.
              boxShadow: sel ? `inset -2px 0 0 ${ACCENT}` : 'none',
              color: sel ? TEXT : MUTED,
              cursor:'pointer', textAlign:'center', fontFamily:'inherit',
              // A pane with nothing on, while the query found nothing in it, is
              // not a place this search can take you.
              opacity: filtering && !badge ? 0.35 : 1,
            }}>
            {/* The badge gets its own lane on the right, and the number and the
                name centre in what is left. Centred across the whole 40 px they
                ran under the badge — `02` and a green `2` on top of each other,
                which is two counts pretending to be one. */}
            <span style={{ display:'block', paddingRight:11 }}>
              {/* A lozenge, not `00`. Presets is a destination and not a step
                  the renderer runs, and a digit in the pipeline's own column
                  would claim it was one. */}
              <span style={{ display:'block', fontSize:9.5, fontWeight:600, fontFamily: MONO, fontVariantNumeric:'tabular-nums', color: sel ? ACCENT_TEXT : undefined }}>
                {n === PRESETS_STAGE ? '◇' : String(n).padStart(2, '0')}
              </span>
              <span style={{ display:'block', fontSize:8.5, fontWeight:600, marginTop:3 }}>
                {short}
              </span>
            </span>
            {badge && (
              <span aria-hidden="true" style={{
                position:'absolute', top:6, right:4,
                minWidth:13, height:13, borderRadius:7, padding:'0 3px',
                background: filtering ? ACCENT : GREEN,
                color: ON_ACCENT,
                fontSize:8, fontWeight:700, lineHeight:'13px', fontFamily: MONO,
                fontVariantNumeric:'tabular-nums',
              }}>{count}</span>
            )}
          </button>
        )
      })}
    </nav>
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
  // ACCENT_DEEP, not ACCENT: white on ACCENT is 3.68:1 and these labels are 10 px
  // uppercase. The deeper fill reads 4.7:1 under white and still 3.77:1 against
  // the panel, so the button's own edge stays visible.
  const look = variant === 'toggle'
    ? (on ? { background: ACCENT_DEEP, color: ON_ACCENT, border: `1px solid ${ACCENT_DEEP}` }
          : { background: SURF, color: MUTED, border: `1px solid ${BORDER}` })
    : variant === 'primary'
      ? { background: ACCENT_DEEP, color: ON_ACCENT, border: `1px solid ${ACCENT_DEEP}` }
      : variant === 'ghost'
        ? { background: 'none', color: MUTED, border: 'none' }
        : { background: SURF, color: MUTED, border: `1px solid ${BORDER}` }

  return (
    <button type="button" {...rest} className={`hmbtn${rest.className ? ` ${rest.className}` : ''}`} style={{
      ...BTN_SIZES[size], ...look,
      cursor: rest.disabled ? 'default' : 'pointer',
      fontFamily: 'inherit',
      ...(block && { flex: 1 }),
      ...(rest.disabled && { opacity: 0.5 }),
      ...style,
    }}>{children}</button>
  )
}

/**
 * An indented group of controls under a section.
 *
 * `label` is optional and older call sites pass none, which renders exactly what
 * they rendered before. It earns its place on the modes carrying a dozen
 * parameters — Flashbulb's bulb, tone, grain and shadow are four different
 * questions, and an unbroken run of thirteen sliders reads as one.
 */
/**
 * The grip a stack row is dragged by.
 *
 * Lives here rather than in the sidebar because two different stacks use it
 * now — the vector layers and the free text — and a shared control imported
 * from the file that renders both would be a cycle.
 */
export function GripIcon() {
  return (
    <svg width="10" height="13" viewBox="0 0 10 13" fill="currentColor" aria-hidden="true">
      {[2, 6.5, 11].map((cy) => (
        <g key={cy}><circle cx="2" cy={cy} r="1.1" /><circle cx="8" cy={cy} r="1.1" /></g>
      ))}
    </svg>
  )
}


export function Sub({ label, children }) {
  return (
    <div style={{ marginLeft: 6, borderLeft: `1px solid ${BORDER}`, paddingLeft: 5, marginBottom: 12 }}>
      {label && (
        <div style={{ fontSize: 11, color: DIM, fontWeight: 600, marginBottom: 5 }}>
          {label}
        </div>
      )}
      {children}
    </div>
  )
}

export function ExpBtn({ label, hint, onClick, active, testId }) {
  return (
    <button className="hmeb" onClick={onClick} data-testid={testId} type="button" style={{
      flex:1, padding:'8px 0', textAlign:'center',
      background: active ? ACCENT_DEEP : SURF,
      color: active ? ON_ACCENT : DIM,
      border:`1px solid ${active ? ACCENT_DEEP : BORDER}`, borderRadius:5,
      cursor:'pointer', fontSize:11, fontWeight:600,
    }}>
      {label}
      {hint && <span className="hmeh" style={{ display:'block', fontSize:10, color: active ? ON_ACCENT : MUTED, opacity: active ? .75 : 1, fontWeight:400, marginTop:2, fontFamily: MONO }}>{hint}</span>}
    </button>
  )
}
