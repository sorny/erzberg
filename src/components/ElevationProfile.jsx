import { useMemo } from 'react'

export function ElevationProfile({ points, elevMin, elevMax, onClose, geoTiffElevMin, geoTiffElevMax }) {
  const W = 480, H = 160, PAD = { top: 16, right: 16, bottom: 28, left: 48 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const hasReal = geoTiffElevMin != null && geoTiffElevMax != null
  const realMin = hasReal ? geoTiffElevMin + (geoTiffElevMax - geoTiffElevMin) * elevMin : 0
  const realMax = hasReal ? geoTiffElevMin + (geoTiffElevMax - geoTiffElevMin) * elevMax : 100

  const { pathD, fillD, ticks } = useMemo(() => {
    if (!points?.length) return { pathD: '', fillD: '', ticks: [] }
    const n = points.length
    const pts = points.map((v, i) => {
      const x = PAD.left + (i / (n - 1)) * innerW
      const y = PAD.top + (1 - (v - elevMin) / Math.max(elevMax - elevMin, 1e-6)) * innerH
      return [x, y]
    })
    const pathD = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    const fillD = pathD +
      ` L${(PAD.left + innerW).toFixed(1)},${(PAD.top + innerH).toFixed(1)}` +
      ` L${PAD.left.toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`

    const numTicks = 4
    const ticks = Array.from({ length: numTicks + 1 }, (_, i) => {
      const frac = i / numTicks
      const val = hasReal ? realMin + frac * (realMax - realMin) : frac * 100
      const y = PAD.top + (1 - frac) * innerH
      return { y, label: hasReal ? `${Math.round(val)}m` : `${Math.round(val)}%` }
    })
    return { pathD, fillD, ticks }
  }, [points, elevMin, elevMax, innerW, innerH, hasReal, realMin, realMax])

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(10,10,14,0.92)', borderRadius: 10, padding: '10px 12px 6px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.6)', zIndex: 100, userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 8 }}>
        <span style={{ color: '#aaa', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>Elevation Profile</span>
        <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>✕</button>
      </div>
      <svg width={W} height={H}>
        {/* Grid lines */}
        {ticks.map(({ y }, i) => (
          <line key={i} x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y}
            stroke="#333" strokeWidth={0.5} />
        ))}
        {/* Fill area */}
        <path d={fillD} fill="rgba(59,130,246,0.18)" />
        {/* Profile line */}
        <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
        {/* Y-axis labels */}
        {ticks.map(({ y, label }, i) => (
          <text key={i} x={PAD.left - 6} y={y + 4} textAnchor="end"
            style={{ fill: '#888', fontSize: 9, fontFamily: 'monospace' }}>{label}</text>
        ))}
        {/* X-axis labels */}
        <text x={PAD.left} y={H - 6} textAnchor="middle"
          style={{ fill: '#555', fontSize: 9, fontFamily: 'monospace' }}>A</text>
        <text x={PAD.left + innerW} y={H - 6} textAnchor="middle"
          style={{ fill: '#555', fontSize: 9, fontFamily: 'monospace' }}>B</text>
      </svg>
    </div>
  )
}
