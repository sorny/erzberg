import { useMemo } from 'react'
import { PROFILE_A, PROFILE_B } from './ProfileOverlay'

/**
 * Chart geometry for a sampled section.
 *
 * Pure, and parameterised by size, because the same numbers are drawn twice: on
 * screen at popup scale in the app's dark palette, and into the exported file at
 * a larger size in ink on paper. Two copies of this arithmetic would be two
 * charts that disagree about where the line goes.
 */
function chartGeometry({ points, elevMin, elevMax, W, H, PAD, hasReal, realMin, realMax }) {
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  if (!points?.length) return { pathD: '', fillD: '', ticks: [], innerW, innerH }

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
  return { pathD, fillD, ticks, innerW, innerH }
}

/**
 * The same section as a standalone SVG file.
 *
 * Ink on paper rather than the popup's dark card: the export exists to sit
 * beside a plotted plate or inside a document, and both of those are white. It
 * carries its own background rect so it does not composite onto whatever is
 * behind it, and the axis it was read off — A on the left, B on the right, in
 * the colours the pins wear in the scene.
 */
function buildProfileSvg({ points, elevMin, elevMax, hasReal, realMin, realMax }) {
  const W = 760, H = 300
  const PAD = { top: 34, right: 24, bottom: 44, left: 74 }
  const g = chartGeometry({ points, elevMin, elevMax, W, H, PAD, hasReal, realMin, realMax })
  const INK = '#14181a', GRID = '#c9cfcc', MUTED = '#6b7472'
  const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
  const sans = "system-ui, -apple-system, 'Segoe UI', sans-serif"
  const range = hasReal
    ? `${Math.round(realMin)} – ${Math.round(realMax)} m  ·  relief ${Math.round(realMax - realMin)} m`
    : `${Math.round(elevMin * 100)} – ${Math.round(elevMax * 100)} % of range`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <title>Elevation profile</title>
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${PAD.left}" y="22" font-family="${sans}" font-size="13" font-weight="600" fill="${INK}">Elevation profile</text>
  <text x="${W - PAD.right}" y="22" text-anchor="end" font-family="${mono}" font-size="10" fill="${MUTED}">${range}</text>
${g.ticks.map(({ y }) => `  <line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${(PAD.left + g.innerW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${GRID}" stroke-width="0.5"/>`).join('\n')}
  <path d="${g.fillD}" fill="${INK}" fill-opacity="0.08"/>
  <path d="${g.pathD}" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
  <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${(PAD.top + g.innerH).toFixed(1)}" stroke="${INK}" stroke-width="0.8"/>
  <line x1="${PAD.left}" y1="${(PAD.top + g.innerH).toFixed(1)}" x2="${(PAD.left + g.innerW).toFixed(1)}" y2="${(PAD.top + g.innerH).toFixed(1)}" stroke="${INK}" stroke-width="0.8"/>
${g.ticks.map(({ y, label }) => `  <text x="${PAD.left - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-family="${mono}" font-size="10" fill="${MUTED}">${label}</text>`).join('\n')}
  <circle cx="${PAD.left}" cy="${(PAD.top + g.innerH + 14).toFixed(1)}" r="3.5" fill="${PROFILE_A}"/>
  <text x="${PAD.left + 9}" y="${(PAD.top + g.innerH + 18).toFixed(1)}" font-family="${mono}" font-size="11" fill="${INK}">A</text>
  <circle cx="${(PAD.left + g.innerW - 9).toFixed(1)}" cy="${(PAD.top + g.innerH + 14).toFixed(1)}" r="3.5" fill="${PROFILE_B}"/>
  <text x="${(PAD.left + g.innerW).toFixed(1)}" y="${(PAD.top + g.innerH + 18).toFixed(1)}" font-family="${mono}" font-size="11" fill="${INK}">B</text>
  <text x="${(PAD.left + g.innerW / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-family="${mono}" font-size="9" fill="${MUTED}">${points.length} samples · erzberg</text>
</svg>
`
}

export function ElevationProfile({ points, elevMin, elevMax, onClose, geoTiffElevMin, geoTiffElevMax, baseName = 'heightmap' }) {
  const W = 480, H = 160, PAD = { top: 16, right: 16, bottom: 28, left: 48 }

  const hasReal = geoTiffElevMin != null && geoTiffElevMax != null
  const realMin = hasReal ? geoTiffElevMin + (geoTiffElevMax - geoTiffElevMin) * elevMin : 0
  const realMax = hasReal ? geoTiffElevMin + (geoTiffElevMax - geoTiffElevMin) * elevMax : 100

  const { pathD, fillD, ticks, innerW, innerH } = useMemo(
    () => chartGeometry({ points, elevMin, elevMax, W, H, PAD, hasReal, realMin, realMax }),
    [points, elevMin, elevMax, hasReal, realMin, realMax],
  )

  const exportSvg = () => {
    const svg = buildProfileSvg({ points, elevMin, elevMax, hasReal, realMin, realMax })
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    Object.assign(document.createElement('a'), { href: url, download: `${baseName}-profile.svg` }).click()
    // Revoked on the next tick rather than immediately: Safari has not started
    // reading the blob when click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(10,10,14,0.92)', borderRadius: 10, padding: '10px 12px 6px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.6)', zIndex: 100, userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 8 }}>
        <span style={{ color: '#aaa', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>Elevation Profile</span>
        <button onClick={exportSvg} data-testid="profile-export-svg" title="Save this section as an SVG file"
          style={{
            marginLeft: 'auto', background: 'none', border: '1px solid #3f3f46', borderRadius: 4,
            color: '#a1a1aa', cursor: 'pointer', fontSize: 10, padding: '3px 8px', letterSpacing: 0.5,
          }}>SVG</button>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>✕</button>
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
        {/* X-axis ends, carrying the pin colours from the scene so the chart says
            which end of the line on the terrain it started from. */}
        <circle cx={PAD.left} cy={H - 9} r={3} fill={PROFILE_A} />
        <text x={PAD.left + 8} y={H - 6} textAnchor="start"
          style={{ fill: '#888', fontSize: 9, fontFamily: 'monospace' }}>A</text>
        <circle cx={PAD.left + innerW - 8} cy={H - 9} r={3} fill={PROFILE_B} />
        <text x={PAD.left + innerW} y={H - 6} textAnchor="start"
          style={{ fill: '#888', fontSize: 9, fontFamily: 'monospace' }}>B</text>
      </svg>
    </div>
  )
}
