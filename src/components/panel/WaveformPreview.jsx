/**
 * Waveform's profile beside its drawing, in the panel.
 *
 * The mode turns a section of the ground into scanline widths in four steps
 * (`waveformProfile`), and on the plate only the result shows. This lays the
 * two side by side along the line, start on the left: the ground's height in
 * the accent colour, and the scanlines the mode will draw in grey. With Detail
 * at 0 and Gamma at 1 the bars' ends follow the line exactly; whatever moves
 * them off it is one of those two controls.
 */
import { useMemo } from 'react'
import { readingEnds, waveformProfile } from '../../utils/builders/signal'
import { ACCENT, BORDER, DIM, MUTED, MONO } from './ui'

const VW = 240, VH = 76, PAD = 4
const BARS = 120

function length(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`
}

export function WaveformPreview({ terrain, style, mPerWorld }) {
  const o = {
    line: style.lineWaveform, originX: style.originXWaveform, originY: style.originYWaveform,
    angle: style.angleWaveform, from: style.fromWaveform, to: style.toWaveform, spacing: style.spacingWaveform, detail: style.detailWaveform,
    smooth: style.smoothWaveform, gamma: style.gammaWaveform, clip: style.clipWaveform,
  }
  const one = style.sidesWaveform === 'one'
  const shape = useMemo(() => {
    if (!terrain?.grid) return null
    const prof = waveformProfile(terrain, o)
    if (!prof) return null
    const { n, ok, h, lo, hi, w, line } = prof
    const x = (k) => PAD + (VW - 2 * PAD) * k / (n - 1)
    const half = (VH - 2 * PAD) / 2
    const mid = PAD + half
    const bot = VH - PAD
    // The bars, thinned to what the panel can show.
    const bars = []
    const every = Math.max(1, Math.round(n / BARS))
    for (let k = 0; k < n; k += every) {
      if (!ok[k] || !(w[k] > 0)) continue
      bars.push(one ? [x(k), bot, bot - w[k] * 2 * half] : [x(k), mid - w[k] * half, mid + w[k] * half])
    }
    // The ground, on the same scale: 0 at the line's lowest point, 1 at its highest.
    const g = (k) => (h[k] - lo) / (hi - lo)
    const runs = []
    let run = null
    for (let k = 0; k < n; k++) {
      if (!ok[k]) { run = null; continue }
      if (!run) runs.push(run = [])
      run.push(k)
    }
    const top = runs.map((r) => r.map((k) => `${x(k).toFixed(1)},${(one ? bot - g(k) * 2 * half : mid - g(k) * half).toFixed(1)}`).join(' '))
    const low = one ? [] : runs.map((r) => r.map((k) => `${x(k).toFixed(1)},${(mid + g(k) * half).toFixed(1)}`).join(' '))
    return { bars, top, low, metres: (line.t1 - line.t0) * terrain.scl * (mPerWorld || 0), mid, bot }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, one, mPerWorld, o.line, o.originX, o.originY, o.angle, o.from, o.to, o.spacing, o.detail, o.smooth, o.gamma, o.clip])

  if (!shape) return null
  const [from, to] = readingEnds(style.angleWaveform ?? 0)
  return (
    <figure style={{ margin: '2px 0 10px' }} data-testid="waveform-preview">
      <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" role="img"
        aria-label={`The ground along the line, ${from} to ${to}, and the scanlines drawn from it`}
        style={{ display: 'block', border: `1px solid ${BORDER}`, borderRadius: 3 }}>
        {!one && <line x1={PAD} x2={VW - PAD} y1={shape.mid} y2={shape.mid} stroke={DIM} strokeWidth={0.5} />}
        {shape.bars.map(([bx, y0, y1], i) => (
          <line key={i} x1={bx} x2={bx} y1={y0} y2={y1} stroke={MUTED} strokeWidth={1.1} />
        ))}
        {[...shape.top, ...shape.low].map((pts, i) => (
          <polyline key={i} points={pts} fill="none" stroke={ACCENT} strokeWidth={1.4} strokeLinejoin="round" />
        ))}
      </svg>
      <figcaption style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: MUTED, fontFamily: MONO, marginTop: 3 }}>
        <span>{from}</span>
        <span>
          <span style={{ color: ACCENT }}>━</span> ground
          {'  '}<span style={{ color: MUTED }}>┃</span> drawn
          {shape.metres > 0 ? `  · ${length(shape.metres)}` : ''}
        </span>
        <span>{to}</span>
      </figcaption>
    </figure>
  )
}
