/**
 * Names the vector feature under the cursor.
 *
 * DOM rather than anything in the scene graph. drei's `<Html>` and `<Text>` are
 * used nowhere in this app, `<Text>` would need a font asset, and a label that
 * answers "what is that" is an affordance rather than part of the picture — it
 * has no business in an export, which is exactly what staying out of the canvas
 * guarantees.
 *
 * Subscribed to `vectorHover` alone, so the pointer moving re-renders this and
 * the highlight and nothing else. Putting it on App's `p` bus would re-render
 * the whole sidebar on every pick.
 */
import { useStore } from '../store/useStore'
import { featureLabel } from '../utils/vectorLayers'

// Enough for a long name to wrap into two or three lines rather than be cut.
// `Steinfeldspitze-Südwest-Gipfel` is a real peak in the test extent and does
// not fit on one line at any sensible width, so wrapping is the only honest
// option — a truncated name identifies nothing.
const MAX_W = 320
const CURSOR_GAP = 16

export function FeatureTooltip({ layers, rightInset = 0 }) {
  const hover = useStore((s) => s.vectorHover)
  const sources = useStore((s) => s.vectorSources)
  // A hover with no position came from a panel row, which is already showing the
  // name — the highlight is the useful half there, not a second label.
  if (!hover || hover.x == null) return null

  const layer = layers?.find((l) => l.id === hover.layerId)
  const bucket = sources
    .find((s) => s.id === layer?.sourceId)
    ?.buckets.find((b) => b.key === layer?.bucket)
  if (!bucket) return null

  const name = featureLabel(bucket, hover.feature)
  const note = bucket.notes.get(hover.feature)

  // Flip to the other side of the cursor near an edge rather than running off
  // it. The right edge matters most: the sidebar lives there, and a tooltip
  // that opens rightward from a feature near it would be half off-screen or
  // over the panel.
  // Against the canvas's right edge, not the window's: past it lies the control
  // panel, and a tooltip that declines to flip there slides underneath it.
  const flipX = hover.x + CURSOR_GAP + MAX_W > window.innerWidth - rightInset
  const flipY = hover.y + CURSOR_GAP + 90 > window.innerHeight

  return (
    <div
      data-testid="feature-tooltip"
      data-feature-name={name}
      style={{
        position: 'fixed',
        left: flipX ? hover.x - CURSOR_GAP : hover.x + CURSOR_GAP,
        top: flipY ? hover.y - CURSOR_GAP : hover.y + CURSOR_GAP,
        transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`,
        pointerEvents: 'none',
        zIndex: 3500,
        background: 'rgba(24,24,27,0.96)',
        border: '1px solid #3f3f46',
        borderRadius: 5,
        padding: '7px 11px',
        maxWidth: MAX_W,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        lineHeight: 1.4,
        color: '#e4e4e7',
        // Wrap, never truncate. A name is the whole reason this exists.
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ fontWeight: 600 }}>{name}</div>
      {(note || layer?.name) && (
        <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>
          {[note, layer?.name].filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  )
}
