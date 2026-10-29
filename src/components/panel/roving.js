/** Arrow-key focus for a grid of tiles: the Marks sheet and the preset grid. */

/**
 * The card the arrows land on next, by position on screen rather than by list
 * order, so Down from the last row of Line goes to the first row of Tone in the
 * same column. `dir` is 'left' | 'right' | 'up' | 'down'. The preset grid walks
 * its tiles with the same rule, under its own root and item selectors.
 */
export function nextCard(from, dir, root = '[data-testid="mode-sheet"]', item = '.hmcardhit') {
  const cards = [...(from.closest(root)?.querySelectorAll(item) ?? [])]
  const a = from.getBoundingClientRect()
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2
  let best = null, score = Infinity
  for (const c of cards) {
    if (c === from) continue
    const b = c.getBoundingClientRect()
    const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (along <= 1) continue
    // Same row (or column) first, then the nearest one past it.
    const s = across * 4 + along
    if (s < score) { score = s; best = c }
  }
  return best
}

export const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
