/**
 * Every key the app answers to, written down once.
 *
 * Fourteen of them, and until now four were discoverable: the export buttons
 * print `1`–`5` beside themselves and the undo arrows carry ⌘Z in a tooltip.
 * The rest — the panel toggle, auto-rotate, the particle pause, Edit Mode —
 * were in a comment at the top of `Controls.jsx` and nowhere a user could see.
 *
 * This module is the list the `?` card renders. It is *not* wired to the
 * handlers: those live in three components that each own their own listener for
 * good reasons, and routing them through a table here would be a refactor in
 * service of a card. What keeps the two honest instead is `shortcuts.test.js`,
 * which reads the source of all three, collects every `KeyboardEvent.code` any
 * of them compares against, and fails if one is missing from `codes` below.
 * Bind a new key and forget the card, and the unit suite says so.
 */

/**
 * The groups, in the order the card shows them.
 *
 * `codes` is what the drift test checks against — the literal `e.code` values a
 * handler tests for. It is deliberately separate from `keys`, which is what a
 * person reads: `Digit1` is the code and `1` is the key, `⌘Z` is two of them,
 * and the mouse rows have no code at all.
 */
export const SHORTCUTS = [
  {
    group: 'The viewport',
    rows: [
      { keys: ['drag'],       label: 'Orbit' },
      { keys: ['scroll'],     label: 'Zoom' },
      { keys: ['right-drag'], label: 'Pan' },
      { keys: ['Q'],   codes: ['KeyQ'],      label: 'Auto-rotate', note: 'on and off' },
      { keys: ['Space'], codes: ['Space'],   label: 'Freeze the particles',
        note: 'only while a field is drawn' },
    ],
  },
  {
    group: 'The panel',
    rows: [
      { keys: ['\\'], codes: ['Backslash'], label: 'Show or hide the panel' },
      /* No `codes`, for the reason `?` has none: keyed on the character. */
      { keys: ['/'],  label: 'Find a control' },
      { keys: ['⌘Z'], codes: ['KeyZ'],      label: 'Undo' },
      { keys: ['⌘⇧Z'], codes: ['KeyY'],     label: 'Redo', note: '⌘Y as well' },
      /* No `codes`: this one is keyed on the character rather than the physical
         key, because `?` is Shift+/ here and Shift+ß on a German layout. */
      { keys: ['?'],  label: 'This card' },
    ],
  },
  {
    group: 'Export',
    rows: [
      { keys: ['1'], codes: ['Digit1'], label: 'SVG' },
      { keys: ['2'], codes: ['Digit2'], label: 'PNG' },
      { keys: ['3'], codes: ['Digit3'], label: 'PNG with transparency' },
      { keys: ['4'], codes: ['Digit4'], label: 'STL' },
      { keys: ['5'], codes: ['Digit5'], label: 'WebM', note: 'again to stop' },
    ],
  },
  {
    group: 'Edit Mode',
    rows: [
      { keys: ['E'],   codes: ['KeyE'],      label: 'Open the heightmap editor' },
      { keys: ['Enter'], codes: ['Enter'],   label: 'Close the shape, then apply' },
      { keys: ['⌫'],   codes: ['Backspace'], label: 'Undo the last point' },
      { keys: ['Esc'], codes: ['Escape'],    label: 'Abandon the shape, then leave',
        note: 'also leaves the profile tool' },
    ],
  },
]

/** Every `e.code` the card accounts for. The drift test compares against this. */
export const CODES = new Set(SHORTCUTS.flatMap((g) => g.rows.flatMap((r) => r.codes ?? [])))
