/**
 * The classes as they actually lie on the ground.
 *
 * The legend says what the classes are called and how much of the window each
 * one covers. It cannot say *where* any of them is, which is the question you
 * ask immediately afterwards and the one that decides which class you want to
 * mask a layer to. Six swatches in a column is a list of six unknowns until you
 * have seen their shapes.
 *
 * So this is the plate drawn flat, at its own grid, before any of the draw modes
 * or the camera get near it — the raw classes, in their own colours, and nothing
 * else in the picture.
 *
 * ── The hover is the whole point ─────────────────────────────────────────────
 * Pointing at the map names the class under the cursor. Pointing at a row of
 * the legend lights that class up on the map. One piece of state drives both
 * directions, so the two halves are one instrument rather than two views that
 * happen to sit near each other.
 *
 * ── Why the dimming is alpha and not a colour ────────────────────────────────
 * Everything not being pointed at drops to a low alpha and lets the panel show
 * through. Mixing toward a background colour instead would mean reading
 * `--hm-surf` out of the DOM and re-reading it whenever the theme moved;
 * transparency is the same effect with none of that, and it cannot disagree
 * with the panel it sits on.
 *
 * ── Why the pixels are not smoothed ──────────────────────────────────────────
 * `image-rendering: pixelated`, which is the honest setting for categorical
 * data. Interpolating between two class colours invents a third that stands for
 * no class at all, and at the panel's width there would be a fringe of those
 * along every boundary in the picture — precisely the boundaries this exists to
 * show.
 */
import { useEffect, useRef } from 'react'
import { hexToRgb } from '../../utils/colorUtils'
import { BORDER, DIM, MUTED } from './ui'

/** How much of the panel shows through a class that is not being pointed at. */
const DIMMED_ALPHA = 42

export function CoverMap({ cover, hovered, onHover }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !cover?.labels) return
    const { width, height, labels } = cover
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Flattened to a plain array once per draw rather than through hexToRgb per
    // pixel: the cache in colorUtils makes that cheap but not free, and this
    // runs over every pixel of the plate.
    const palette = cover.classes.map((c) => hexToRgb(c.color).map((v) => Math.round(v * 255)))
    const image = ctx.createImageData(width, height)
    const px = image.data

    for (let i = 0; i < labels.length; i++) {
      const rgb = palette[labels[i]] ?? [136, 136, 136]
      const o = i * 4
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]
      px[o + 3] = hovered == null || labels[i] === hovered ? 255 : DIMMED_ALPHA
    }
    ctx.putImageData(image, 0, 0)
  }, [cover, hovered])

  if (!cover?.labels) return null

  /** Which class is under the pointer, in the plate's own pixels. */
  const classAt = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (!box.width || !box.height) return null
    const col = Math.floor(((event.clientX - box.left) / box.width) * cover.width)
    const row = Math.floor(((event.clientY - box.top) / box.height) * cover.height)
    if (col < 0 || row < 0 || col >= cover.width || row >= cover.height) return null
    return cover.labels[row * cover.width + col] ?? null
  }

  const named = hovered != null ? cover.classes.find((c) => c.index === hovered) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <canvas
        ref={ref}
        width={cover.width}
        height={cover.height}
        // Named for a screen reader, because a canvas is otherwise a blank to
        // anything that is not a pointer. The legend below carries the same
        // information in text, which is what this is a picture of.
        role="img"
        aria-label={`Land cover classes over ${cover.name}`}
        onPointerMove={(e) => {
          const next = classAt(e)
          // Only when it changes: a pointer move fires far faster than the
          // plate redraws, and setting the same value again would redraw it
          // every time anyway.
          if (next !== hovered) onHover(next)
        }}
        onPointerLeave={() => onHover(null)}
        style={{
          width: '100%', height: 'auto', display: 'block',
          border: `1px solid ${BORDER}`, borderRadius: 4,
          imageRendering: 'pixelated', cursor: 'crosshair',
        }}
      />
      {/* Holds its height whether or not anything is under the pointer, so the
          legend below does not jump as the cursor crosses the map. */}
      <div style={{ fontSize: 9.5, lineHeight: 1.4, minHeight: 13,
                    color: named ? MUTED : DIM }}>
        {named ? `${named.name} · ${(named.share * 100).toFixed(1)}%` : 'Point at the map to name a class'}
      </div>
    </div>
  )
}
