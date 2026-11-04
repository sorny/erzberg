/**
 * Which band of a multi-band GeoTIFF is the ground.
 *
 * The loader opens band 1. A file that keeps the surface model on band 2, or
 * stacks several epochs, draws the wrong data until someone says which band is
 * elevation. Each tile shows the band's value range and a small preview, so the
 * elevation band is the one with a range in metres and a picture of relief.
 * The previews arrive after the load, because each one reads a whole band.
 *
 * Under each tile, Image and Mask send that band somewhere else instead: to the
 * imagery drape, or to a new mask (see utils/bandUse.js).
 */
import { useStore } from '../../store/useStore'
import { ACCENT, BORDER, MONO, MUTED, SUNK, SURF, TEXT } from './ui'

const fmt = (v) => (v == null ? '–' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : +v.toFixed(2))

export function BandPicker({ onPick, onSend }) {
  const bands = useStore((s) => s.geoTiffBands)
  if (!bands || bands.count < 2) return null
  const { count, band, summaries } = bands
  return (
    <div data-testid="band-picker" style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>
        This file has {count} bands. Click the one that holds elevation. Image lays a band on the terrain as a picture, and Mask makes a mask from it.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
        {Array.from({ length: count }, (_, i) => {
          const s = summaries?.[i]
          const on = i === band
          return (
            <div key={i} style={{ display: 'grid', gap: 2, minWidth: 0 }}>
            <button type="button" data-testid={`band-${i + 1}`} aria-pressed={on}
              title={s ? `Band ${i + 1}: ${fmt(s.min)} to ${fmt(s.max)}` : `Band ${i + 1}`}
              onClick={() => { if (!on) onPick?.(i) }}
              style={{
                display: 'grid', gap: 2, padding: 3, borderRadius: 5, cursor: on ? 'default' : 'pointer',
                background: on ? SUNK : SURF, border: `1px solid ${on ? ACCENT : BORDER}`, color: TEXT,
                minWidth: 0,
              }}>
              <div style={{ aspectRatio: '1', background: SUNK, borderRadius: 3, overflow: 'hidden',
                            display: 'grid', placeItems: 'center' }}>
                {s?.thumb
                  ? <img src={s.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }} />
                  : <span style={{ fontSize: 10, color: MUTED }}>{summaries ? '' : '…'}</span>}
              </div>
              <div style={{ fontSize: 10, fontWeight: 600 }}>{i + 1}</div>
              <div style={{ fontSize: 9, fontFamily: MONO, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s ? `${fmt(s.min)}–${fmt(s.max)}` : ''}
              </div>
            </button>
            {onSend && (
              <div style={{ display: 'flex', gap: 2 }}>
                {[['Image', 'imagery'], ['Mask', 'mask']].map(([label, target]) => (
                  <button key={target} type="button" data-testid={`band-${i + 1}-${target}`}
                    title={target === 'imagery' ? `Band ${i + 1} as the imagery drape` : `Band ${i + 1} as a mask`}
                    onClick={() => onSend(i, target)}
                    style={{ flex: 1, minWidth: 0, padding: '1px 0', fontSize: 9, borderRadius: 3, cursor: 'pointer',
                             background: SURF, border: `1px solid ${BORDER}`, color: MUTED }}>{label}</button>
                ))}
              </div>
            )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
