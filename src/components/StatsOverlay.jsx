/** Small stats bar showing rendered geometry counts. */
export function StatsOverlay({ lineGeo, surfaceGeo, terrain }) {
  const segs  = lineGeo    ? (lineGeo.positions.length    / 6)  | 0 : 0
  const verts = lineGeo    ? (lineGeo.positions.length    / 3)  | 0 : 0
  const tris  = surfaceGeo ? (surfaceGeo.indices.length   / 3)  | 0 : 0
  const sverts= surfaceGeo ? (surfaceGeo.positions.length / 3)  | 0 : 0

  const fmt = (n) => n.toLocaleString()

  return (
    <div style={{
      position: 'fixed', bottom: 10, left: '50%', transform: 'translateX(-50%)',
      zIndex: 2000,
      display: 'flex', gap: 16,
      background: 'rgba(20,20,24,0.82)',
      backdropFilter: 'blur(6px)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 6,
      padding: '4px 14px',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 11,
      color: '#888',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    }}>
      <Stat label="Segments" value={fmt(segs)} />
      <Sep />
      <Stat label="Line verts" value={fmt(verts)} />
      <Sep />
      <Stat label="Triangles" value={fmt(tris)} />
      <Sep />
      <Stat label="Mesh verts" value={fmt(sverts)} />
      {terrain && (
        <>
          <Sep />
          <Stat label="Grid" value={`${terrain.cols}×${terrain.rows}`} />
        </>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <span>
      <span style={{ color: '#555', marginRight: 4 }}>{label}</span>
      <span style={{ color: '#ccc' }}>{value}</span>
    </span>
  )
}

function Sep() {
  return <span style={{ color: '#333' }}>·</span>
}
