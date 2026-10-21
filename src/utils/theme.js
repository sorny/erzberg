/**
 * The panel's two palettes, Ore and Paper in the dark and in the light.
 *
 * The colours come from the brand itself: the logo is ore (#E8823A) on an iron
 * black (#131210) with paper lettering (#F0EBE3). Ore means *on* — a lit
 * section, a selected choice, a switch that is on — and it is the only accent.
 * The filled part of a slider is `fill`, an iron grey: a slider's value is not
 * a state, and ore on thirty tracks made a Pan at 0 look half switched on. Text on an ore fill is ink, never white: white on ore is 2.7 : 1.
 *
 * Contrast, measured: dark text 15.5, secondary 5.8, ink on ore 6.8; light text
 * 16.8, secondary 5.5 (4.8 on a well), accent text 5.1, ore fill 3.8 against the
 * ground. The light ore is deeper than the dark one because a fill has to clear
 * 3 : 1 against near-white, which #E8823A (2.6) does not.
 *
 * The palette is published twice: as custom properties (see `PanelStyles`), and
 * as `HEX`, a plain object for the consumers a custom property cannot reach — a
 * 2D canvas resolves nothing. `HEX` is one object whose values change with the
 * theme, so a canvas that reads it at draw time follows the theme on its next
 * frame. Canvases that only draw on demand listen for `THEME_EVENT`.
 */

export const PALETTES = {
  dark: {
    bg: '#151412', surf: '#221F1C', border: '#36312C',
    text: '#F0EBE3', dim: '#D9D2C7', muted: '#9A8F85',
    accent: '#E8823A', accentDeep: '#E8823A', onAccent: '#1A120B', accentText: '#E8823A',
    on: '#E8823A', strong: '#F0EBE3', thumb: '#F0EBE3', fill: '#9A8F85',
    sunk: 'rgba(0,0,0,.25)', veil: 'rgba(255,255,255,.045)', veilStrong: 'rgba(255,255,255,.09)',
    stageBg: 'rgba(21,20,18,.88)', desk: '#0E0D0C', scrim: 'rgba(9,9,11,0.72)',
    glassBg: 'rgba(24,22,20,.82)', glassBorder: 'rgba(255,255,255,.09)', glassText: '#D9D2C7',
    danger: '#EF4444', dangerText: '#F29B8E', dangerBg: 'rgba(239,68,68,.10)', dangerBorder: 'rgba(239,68,68,.35)',
    // Brass, not orange: ore already means "on", and a warning must not read as one.
    warn: '#E2C15A', warnBg: 'rgba(226,193,90,.08)', warnBorder: 'rgba(226,193,90,.32)',
    shadow: 'rgba(0,0,0,.35)',
    // The audio meter's data hues: bass, mid and high, then the three channels
    // that have no band of their own. Data, not chrome, so they are the one
    // place the panel shows colour that is not ore — each needs 3 : 1 against
    // the surface it is drawn on, which the dark set clears at 4.5 and up.
    meterLow: '#f97316', meterMid: '#22c55e', meterHigh: '#38bdf8',
    meterPace: '#a78bfa', meterSize: '#facc15', meterBurst: '#f43f5e',
  },
  light: {
    bg: '#FBFAF7', surf: '#F0EBE3', border: '#D9D1C5',
    text: '#1C1916', dim: '#3A342E', muted: '#6E655C',
    accent: '#C8641F', accentDeep: '#C8641F', onAccent: '#1A120B', accentText: '#9C4C16',
    on: '#C8641F', strong: '#1C1916', thumb: '#FFFFFF', fill: '#6E655C',
    sunk: 'rgba(70,50,30,.06)', veil: 'rgba(40,30,20,.04)', veilStrong: 'rgba(40,30,20,.08)',
    stageBg: 'rgba(251,250,247,.9)', desk: '#E9E4DC', scrim: 'rgba(233,228,220,0.78)',
    glassBg: 'rgba(251,250,247,.86)', glassBorder: 'rgba(40,30,20,.12)', glassText: '#3A342E',
    danger: '#C0362C', dangerText: '#B42318', dangerBg: 'rgba(192,54,44,.07)', dangerBorder: 'rgba(192,54,44,.3)',
    warn: '#7A5A0C', warnBg: 'rgba(160,120,20,.08)', warnBorder: 'rgba(160,120,20,.3)',
    shadow: 'rgba(60,40,20,.14)',
    // Deeper on paper: the dark set falls to 1.3–2.4 : 1 on #F0EBE3. These clear 4.1.
    meterLow: '#C2410C', meterMid: '#15803D', meterHigh: '#0369A1',
    meterPace: '#6D28D9', meterSize: '#A16207', meterBurst: '#BE123C',
  },
}

/** The live palette. Mutated in place by `applyTheme`; read it at draw time. */
export const HEX = { ...PALETTES.dark }

/*
 * One material for everything that floats over the scene: the hint, the toast,
 * the computing pill, the loading card, the profile, the tooltip and the
 * shortcut card. Frosted rather than opaque, so the plate stays the subject,
 * and one border and shadow so they read as a set. Here rather than in
 * `panel/ui.jsx`, which may export only literal constants beside components.
 */
export const GLASS = {
  background: 'var(--hm-glass-bg)',
  backdropFilter:'blur(14px) saturate(1.4)', WebkitBackdropFilter:'blur(14px) saturate(1.4)',
  border:'1px solid var(--hm-glass-border)',
  boxShadow:'0 8px 28px var(--hm-shadow)',
  fontFamily: 'var(--hm-font)', color: 'var(--hm-glass-text)',
}

export const THEME_EVENT = 'hm-theme'
const KEY = 'erzberg.theme'

/** The stored theme, or dark: the panel has always been dark. */
export function storedTheme() {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}

/** Switch the whole app to `mode`, remember it, and tell the canvases. */
export function applyTheme(mode) {
  const m = mode === 'light' ? 'light' : 'dark'
  Object.assign(HEX, PALETTES[m])
  document.documentElement.dataset.hmTheme = m
  try { localStorage.setItem(KEY, m) } catch { /* not remembered, still applied */ }
  window.dispatchEvent(new Event(THEME_EVENT))
  return m
}
