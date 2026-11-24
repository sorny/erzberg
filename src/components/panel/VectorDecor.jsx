/**
 * Hatch and line decorations for one vector layer.
 *
 * Both are geometry: the worker draws them in the raster's pixel grid and
 * drapes them, so every slider here is a rebuild of this layer only. Their ink
 * is their own pen layer, `#hatch` and `#deco`, and falls back to the layer's.
 */
import { BORDER, ColorRow, Heading, InlineSl, SegRow, Sub, Tog } from './ui'

/** Colour, width and opacity of a stroke drawn from the layer. */
function StrokeInk({ layer, set, prefix, what }) {
  const id = layer.id
  return (
    <>
      <ColorRow label="Colour" value={layer[`${prefix}Color`] ?? layer.color} testId={`${prefix}-color-${id}`}
        onChange={(v) => set({ [`${prefix}Color`]: v })} />
      <InlineSl label="Width" min={0.25} max={8} step={0.25} value={layer[`${prefix}Weight`] ?? layer.weight}
        testId={`${prefix}-weight-${id}`} onChange={(v) => set({ [`${prefix}Weight`]: v })}
        help={`The ${what}'s own line width. It starts at the layer's.`} />
      <InlineSl label="Opacity" min={0} max={1} step={0.01} value={layer[`${prefix}Opacity`] ?? layer.opacity}
        fmt={(v) => Math.round(v * 100) + '%'} testId={`${prefix}-opacity-${id}`}
        onChange={(v) => set({ [`${prefix}Opacity`]: v })} />
    </>
  )
}

const metres = (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)} m`

/** Strokes across the inside of an area, so a pen can draw its tone. */
export function HatchControls({ layer, onPatch }) {
  const set = (patch) => onPatch(layer.id, patch)
  return (
    <div style={{ marginTop: 8 }} data-testid={`vector-hatch-${layer.id}`}>
      <Tog label="Hatch" small checked={!!layer.hatch} onChange={(v) => set({ hatch: v })}
        help="Fills each area with parallel strokes, as survey sheets draw woods, water and glaciers. The strokes are their own pen layer in the SVG, which the solid fill is not: a pen cannot draw a fill." />
      {layer.hatch && (
        <Sub>
          <InlineSl label="Pitch" min={2} max={200} step={1} value={layer.hatchPitch ?? 25} fmt={metres}
            testId={`hatch-pitch-${layer.id}`} onChange={(v) => set({ hatchPitch: v })}
            help="The distance between two strokes, in metres on the ground." />
          <InlineSl label="Angle" min={0} max={180} step={1} value={layer.hatchAngle ?? 45}
            fmt={(v) => `${Math.round(v)}°`} testId={`hatch-angle-${layer.id}`}
            onChange={(v) => set({ hatchAngle: v })}
            help="The direction of the strokes, in degrees anticlockwise from east. 0° runs east to west, 90° north to south." />
          <Tog label="Cross" small checked={!!layer.hatchCross} onChange={(v) => set({ hatchCross: v })}
            help="Adds a second set of strokes at right angles to the first." />
          <StrokeInk layer={layer} set={set} prefix="hatch" what="hatch" />
        </Sub>
      )}
    </div>
  )
}

/**
 * Parallels, ticks and marks along a line or round an area.
 *
 * On an area the sides read Outside and Inside, because the worker turns each
 * ring so that its right side is the area.
 */
export function DecorControls({ layer, onPatch }) {
  const set = (patch) => onPatch(layer.id, patch)
  const area = layer.geom === 'area'
  const sides = area
    ? [['off', 'off'], ['out', 'left'], ['in', 'right'], ['both', 'both']]
    : [['off', 'off'], ['left', 'left'], ['right', 'right'], ['both', 'both']]
  const any = (layer.parallel ?? 'off') !== 'off' || (layer.ticks ?? 'off') !== 'off' || (layer.marks ?? 'off') !== 'off'
  return (
    <div style={{ marginTop: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 8 }} data-testid={`vector-deco-${layer.id}`}>
      <Heading>Decoration</Heading>

      <SegRow label="Parallel" options={sides} value={layer.parallel ?? 'off'}
        help="Draws a line beside the line, at a set offset. Left and right are as seen along the way's direction. On an area, In runs inside the outline and Out outside it." 
        onChange={(v) => set({ parallel: v })} testIdOf={(v) => `deco-parallel-${v}-${layer.id}`} />
      {(layer.parallel ?? 'off') !== 'off' && (
        <Sub>
          <InlineSl label="Offset" min={0.5} max={200} step={0.5} value={layer.parallelGap ?? 6} fmt={metres}
            testId={`deco-gap-${layer.id}`} onChange={(v) => set({ parallelGap: v })}
            help={area
              ? 'How far the parallel line runs from the outline, in metres on the ground. A band just inside a boundary is drawn this way.'
              : 'How far each parallel line runs from the centre line, in metres on the ground. Both sides at half the road width, with the centre line off, draws a cased road as a pen draws it: two edges.'} />
        </Sub>
      )}

      <SegRow label="Ticks" options={sides} value={layer.ticks ?? 'off'}
        help="Short strokes across the line at a set spacing: the ties of a railway, the teeth of an embankment or the hachures along a cliff edge." 
        onChange={(v) => set({ ticks: v })} testIdOf={(v) => `deco-ticks-${v}-${layer.id}`} />
      {(layer.ticks ?? 'off') !== 'off' && (
        <Sub>
          <InlineSl label="Spacing" min={2} max={500} step={1} value={layer.tickSpacing ?? 40} fmt={metres}
            testId={`deco-tick-spacing-${layer.id}`} onChange={(v) => set({ tickSpacing: v })}
            help="The distance between two ticks along the line, in metres on the ground." />
          <InlineSl label="Length" min={0.5} max={200} step={0.5} value={layer.tickLength ?? 12} fmt={metres}
            testId={`deco-tick-length-${layer.id}`} onChange={(v) => set({ tickLength: v })}
            help="How long each tick is, in metres on the ground. Ticks on both sides are centred on the line. OpenStreetMap draws a cliff with its drop on the right, so right ticks hang down the face." />
        </Sub>
      )}

      <SegRow label="Marks" columns={3} options={[['off', 'off'], ['›', 'chevron'], ['▲', 'triangle'], ['○', 'circle'], ['×', 'cross'], ['|', 'bar']]}
        help="A symbol repeated along the line: an arrow for the flow of a stream or a one-way road, a tooth for a cliff, a ring, a cross or a bar." 
        value={layer.marks ?? 'off'} onChange={(v) => set({ marks: v })}
        testIdOf={(v) => `deco-marks-${v}-${layer.id}`} />
      {(layer.marks ?? 'off') !== 'off' && (
        <Sub>
          <InlineSl label="Spacing" min={2} max={2000} step={1} value={layer.markSpacing ?? 80} fmt={metres}
            testId={`deco-mark-spacing-${layer.id}`} onChange={(v) => set({ markSpacing: v })}
            help="The distance between two marks along the line, in metres on the ground." />
          <InlineSl label="Size" min={0.5} max={500} step={0.5} value={layer.markSize ?? 20} fmt={metres}
            testId={`deco-mark-size-${layer.id}`} onChange={(v) => set({ markSize: v })}
            help="How wide each mark is, in metres on the ground." />
          {layer.marks === 'triangle' && (
            <SegRow label="Side" options={area ? [['out', 'left'], ['in', 'right']] : [['left', 'left'], ['right', 'right']]}
              value={layer.markSide ?? 'right'} onChange={(v) => set({ markSide: v })}
              testIdOf={(v) => `deco-mark-side-${v}-${layer.id}`} />
          )}
          <Tog label="Fixed orientation" small checked={!!layer.markFixed} onChange={(v) => set({ markFixed: v })}
            help="Keeps every mark square to the sheet instead of turning it with the line." />
        </Sub>
      )}

      {any && (
        <>
          <Tog label="Centre line" small checked={layer.centreLine !== false} onChange={(v) => set({ centreLine: v })}
            help="Draws the line itself. Switch it off to keep only the decoration, for example the two edges of a cased road." />
          <StrokeInk layer={layer} set={set} prefix="deco" what="decoration" />
        </>
      )}
    </div>
  )
}
