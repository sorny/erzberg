/**
 * Choosing a vector layer, and which of its features you mean.
 *
 * Shared by the two places that turn map features into a region: the Masks
 * section, which rasterises them into a stencil, and Edit Mode, which clips the
 * heightmap to their outline. Those answer different questions and their
 * surrounding controls differ, but the *choosing* is identical — a layer, a
 * filterable list, all/none — and two copies of it would drift.
 *
 * A hook rather than a component because both call sites need the derived
 * values as well as the markup: which bucket is selected, which features are
 * picked, and whether the layer's lines close into an area.
 */
import { useMemo, useState } from 'react'
import { featureLabel } from '../../utils/vectorLayers'
import { enclosesRegion } from '../../utils/maskFromVector'
import { ACCENT, BORDER, DIM, MiniBtn, MUTED, SURF, TEXT } from './ui'

const MAX_ROWS = 200

export function useFeaturePick(layers = [], sources = [], prefix = 'mask-from') {
  const usable = layers.filter((l) => l.count > 0)
  const [pick, setPick] = useState('')
  const [only, setOnly] = useState(null)      // null = every drawn feature
  const [filter, setFilter] = useState('')

  // A layer removed while it was selected must not leave a dangling id, or the
  // action would report "no longer loaded" for a row that is plainly visible.
  const chosen = usable.find((l) => String(l.id) === pick) ?? usable[0] ?? null
  const bucket = chosen
    ? sources.find((s) => s.id === chosen.sourceId)?.buckets?.find((b) => b.key === chosen.bucket)
    : null

  // Named first, then by name, then by index — the same order the layer's own
  // feature list uses, so the two lists read the same way.
  const ordered = useMemo(() => {
    if (!bucket) return []
    const idx = Array.from({ length: bucket.count }, (_, i) => i)
    idx.sort((a, b) => {
      const na = bucket.names.get(a), nb = bucket.names.get(b)
      if (!!na !== !!nb) return na ? -1 : 1
      if (na && nb) return na.localeCompare(nb)
      return a - b
    })
    return idx
  }, [bucket])

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q || !bucket) return ordered
    return ordered.filter((i) => featureLabel(bucket, i).toLowerCase().includes(q))
  }, [ordered, filter, bucket])

  // Whether this layer's lines actually close. An administrative boundary is
  // drawn as a line and *is* an area, so the layer's own `geom` cannot answer
  // it — only the geometry can.
  const closes = useMemo(
    () => (chosen?.geom === 'line' ? enclosesRegion(bucket) : false),
    [bucket, chosen?.geom],
  )

  // The pick starts as whatever the layer actually draws, so the default is
  // "what I can see" rather than "everything the file happens to hold".
  const picked = only ?? new Set(ordered.filter((i) => !chosen?.hidden?.includes(i)))
  const setPicked = (next) => setOnly(new Set(next))
  const toggle = (i) => {
    const next = new Set(picked)
    if (next.has(i)) next.delete(i); else next.add(i)
    setPicked(next)
  }
  const onLayerChange = (v) => { setPick(v); setOnly(null); setFilter('') }

  /** The name to give whatever is produced — the feature's when it is the only one. */
  const label = (() => {
    const one = picked.size === 1 ? bucket?.names?.get([...picked][0]) : null
    return one ?? chosen?.name ?? ''
  })()

  const element = !usable.length ? null : (
    <>
      <select value={chosen ? String(chosen.id) : ''} data-testid={`${prefix}-layer`}
        onChange={(e) => onLayerChange(e.target.value)}
        style={{ background: SURF, color: DIM, border: `1px solid ${BORDER}`,
                 borderRadius: 5, fontSize: 10, padding: '3px 4px', cursor: 'pointer' }}>
        {usable.map((l) => (
          <option key={l.id} value={String(l.id)}>
            {l.name} · {l.count} {l.geom === 'area' ? 'area' : l.geom === 'line' ? 'line' : 'point'}
            {l.count === 1 ? '' : 's'}
          </option>
        ))}
      </select>

      {bucket && bucket.count > 1 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <span style={{ fontSize: 9.5, color: MUTED }} data-testid={`${prefix}-count`}>
              Using {picked.size} of {bucket.count}
            </span>
            <span style={{ display: 'flex', gap: 2 }}>
              <MiniBtn onClick={() => setPicked(ordered)} testId={`${prefix}-all`}>all</MiniBtn>
              <MiniBtn onClick={() => setPicked([])} testId={`${prefix}-none`}>none</MiniBtn>
            </span>
          </div>
          {bucket.count > 8 && (
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…"
              data-testid={`${prefix}-filter`}
              style={{
                width: '100%', boxSizing: 'border-box', marginBottom: 4, padding: '2px 4px',
                fontSize: 10, background: SURF, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 3,
              }} />
          )}
          <div style={{ maxHeight: 150, overflowY: 'auto' }}>
            {matches.slice(0, MAX_ROWS).map((i) => (
              <label key={i} data-testid={`${prefix}-feature-${i}`}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 2px', cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.has(i)}
                  data-testid={`${prefix}-check-${i}`}
                  onChange={() => toggle(i)}
                  style={{ width: 11, height: 11, accentColor: ACCENT, cursor: 'pointer' }} />
                <span style={{
                  flex: 1, fontSize: 10, color: picked.has(i) ? DIM : MUTED,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{featureLabel(bucket, i)}</span>
              </label>
            ))}
          </div>
          {matches.length > MAX_ROWS && (
            <div style={{ fontSize: 9.5, color: MUTED, marginTop: 3 }}>
              …and {matches.length - MAX_ROWS} more. Filter to narrow.
            </div>
          )}
        </div>
      )}
    </>
  )

  return { usable, chosen, bucket, picked, closes, label, element }
}
