/**
 * What this plate is made of, in one place.
 *
 * The app fetches three things — ground, imagery, map features — and each one
 * has its own button in its own stage: terrain in Source, imagery in Surface,
 * features in Overlay. Nothing in the interface has ever said that all three
 * describe the *same patch of ground*, which is the one fact they have in
 * common and the reason any of them align.
 *
 * ── What this is, and what it is not ─────────────────────────────────────────
 * It is a readout. Every figure below is derived from state the app already
 * holds, through helpers it already has: `bboxToWgs84`, `wgs84ExtentKm`,
 * `groundPixelMetres`, `crsDisplayName`. Nothing here fetches, and nothing here
 * writes.
 *
 * It is deliberately *not* an extent you can move. Re-aiming the window and
 * having imagery and vectors follow is a real feature with real consequences —
 * a moved extent has to invalidate or re-align two datasets that are currently
 * independent of the raster — and it is a different change from saying out loud
 * what is already true. The rows name where each control lives instead.
 *
 * ── The fourth row ───────────────────────────────────────────────────────────
 * Land cover can never be a button, and the row says so rather than leaving a
 * gap where one should be. AlphaEarth's bucket serves anonymous ranged reads to
 * anyone and sends no `access-control-*` header, so a browser is refused where a
 * terminal is not. `scripts/embed-window.js` is the answer, and a user staring
 * at a missing button would never guess that.
 */
import { useStore } from '../../store/useStore'
import { bboxToWgs84, crsDisplayName, groundPixelMetres, wgs84ExtentKm } from '../../utils/geoCoords'
import { BORDER, DIM, GREEN, MUTED, SURF } from './ui'

/** A lon/lat pair, at the precision a four-kilometre window actually has. */
const deg = (v, pos, neg) => `${Math.abs(v).toFixed(3)}° ${v >= 0 ? pos : neg}`

const DOT = { ok: GREEN, busy: '#eab308', off: BORDER }

function Row({ state, name, value, detail, where }) {
  return (
    <div data-testid={`extent-layer-${name.toLowerCase().replace(/\s+/g, '-')}`}
      style={{ border:`1px solid ${BORDER}`, borderRadius:4, background:SURF,
               padding:'6px 8px', marginBottom:4 }}>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ width:6, height:6, borderRadius:'50%', flex:'none', background:DOT[state] }} />
        <span style={{ flex:1, fontSize:10.5, color:DIM }}>{name}</span>
        <span style={{ fontSize:9.5, color:MUTED, fontFamily:'monospace' }}>{value}</span>
      </div>
      <div style={{ fontSize:9, color:MUTED, lineHeight:1.5, marginTop:2 }}>
        {detail}
        {where && <span style={{ opacity:.75 }}>{` · ${where}`}</span>}
      </div>
    </div>
  )
}

export function ExtentSection() {
  const bbox       = useStore((s) => s.geoTiffBbox)
  const crs        = useStore((s) => s.geoTiffCRS)
  const crsName    = useStore((s) => s.geoTiffCRSName)
  const width      = useStore((s) => s.heightmapWidth)
  const height     = useStore((s) => s.heightmapHeight)
  const name       = useStore((s) => s.heightmapFilename)
  const provenance = useStore((s) => s.terrainProvenance)
  const imagery    = useStore((s) => s.imagery)
  const sources    = useStore((s) => s.vectorSources)
  const cover      = useStore((s) => s.cover)

  if (!width || !height) {
    return <div data-testid="extent-none" style={{ fontSize:10, color:MUTED, lineHeight:1.6 }}>
      No ground loaded. Open a GeoTIFF or a PNG above, or fetch a place under Fetch.
    </div>
  }

  // A PNG heightmap and a frozen soundscape have no place on Earth, and saying
  // "0.000° N" about one would be worse than saying nothing.
  const wgs = bbox && crs ? bboxToWgs84(bbox, crs) : null
  const km = wgs ? wgs84ExtentKm(wgs) : null
  // `groundPixelMetres` answers per axis, and the two are equal by construction
  // for a fetched DEM — Web Mercator inflates both the same way. A GeoTIFF can
  // be genuinely anisotropic, so say both when they differ enough to matter.
  const ground = bbox && crs ? groundPixelMetres(bbox, crs, width, height) : null
  const fig = (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)))
  const metres = !ground ? null
    : Math.abs(ground.y / ground.x - 1) > 0.02
      ? `${fig(ground.x)} × ${fig(ground.y)} m/px`
      : `${fig(ground.x)} m/px`

  const buckets = (sources ?? []).reduce((n, s) => n + (s.buckets?.length ?? 0), 0)

  return (
    <div data-testid="extent-section">
      <div style={{ border:`1px solid ${BORDER}`, borderRadius:4, background:SURF,
                    padding:'7px 9px', marginBottom:8 }}>
        <div style={{ fontSize:10.5, color:DIM, overflow:'hidden', textOverflow:'ellipsis',
                      whiteSpace:'nowrap' }}>{name || 'Untitled raster'}</div>
        {wgs ? (
          <div data-testid="extent-degrees" style={{ fontSize:9, color:MUTED, lineHeight:1.6, marginTop:2 }}>
            {`${deg(wgs[0], 'E', 'W')} – ${deg(wgs[2], 'E', 'W')} · ${deg(wgs[1], 'N', 'S')} – ${deg(wgs[3], 'N', 'S')}`}
          </div>
        ) : (
          <div style={{ fontSize:9, color:MUTED, lineHeight:1.6, marginTop:2 }}>
            Not georeferenced — no extent to state.
          </div>
        )}
        <div style={{ fontSize:9, color:MUTED, lineHeight:1.6 }}>
          {[
            km && `${km.w.toFixed(1)} × ${km.h.toFixed(1)} km`,
            crs && crsDisplayName(crs, crsName),
            metres,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>

      <div style={{ fontSize:11, fontWeight:600, color: DIM, marginBottom:5 }}>Layers on this extent</div>

      <Row state="ok" name="Elevation" value={`${width} × ${height}`}
        detail={provenance || 'Loaded from this machine'} />

      <Row state={imagery ? 'ok' : 'off'} name="Imagery"
        value={imagery ? `${imagery.width} px` : 'none'}
        detail={imagery
          ? `Sentinel-2 L2A · ${imagery.date}${imagery.cloud != null ? ` · ${Math.round(imagery.cloud)}% cloud` : ''}`
          : 'Not fetched'}
        where={imagery ? null : 'Surface › Imagery'} />

      <Row state={buckets ? 'ok' : 'off'} name="Map features"
        value={buckets ? `${buckets} layer${buckets === 1 ? '' : 's'}` : 'none'}
        detail={buckets ? 'OpenStreetMap via Overpass, ODbL' : 'Not fetched'}
        where={buckets ? null : 'Overlay › Vector Layers'} />

      <Row state={cover ? 'ok' : 'off'} name="Land cover"
        value={cover ? `${cover.classes?.length ?? 0} classes` : 'offline only'}
        detail={cover
          ? `${cover.name ?? 'Plate'}${cover.year ? ` · ${cover.year}` : ''}`
          : 'That bucket sends no CORS header, so a browser cannot read it. Cut a plate with scripts/embed-window.js and drop it in.'} />
    </div>
  )
}
