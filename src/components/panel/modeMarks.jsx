/**
 * A sample of what each draw mode puts on paper, small enough to sit in a
 * section header.
 *
 * Fifteen rows reading MODE: ⟨cartographic noun⟩ are interchangeable to anyone
 * who does not already know what a Strahler-order stream network looks like —
 * which is most people, and exactly the people browsing. Seeing the mark is the
 * whole point of the section, so the mark goes in the row rather than three
 * clicks inside it.
 *
 * Drawn rather than rendered: these are 22×13 and want to read at that size, so
 * a shrunk screenshot of the real output would be mud. Each one is the mode's
 * defining gesture — the direction, rhythm and density of its strokes — not a
 * picture of terrain.
 */

const W = 22
const H = 13
const BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  vectorEffect: 'non-scaling-stroke',
}

/** A ridgeline, reused by the modes whose gesture follows the ground. */
const RIDGE = 'M1 11 L4 9 L7 4 L9 7 L12 2 L15 6 L18 4 L21 9'

const MARKS = {
  // Parallel terrain ridgelines — the stacked-plot look.
  lines: (
    <g {...BASE}>
      <path d="M1 3 L5 2 L8 4 L12 1.5 L16 3.5 L21 2.5" />
      <path d="M1 6.5 L5 5.5 L8 7.5 L12 5 L16 7 L21 6" />
      <path d="M1 10 L5 9 L8 11 L12 8.5 L16 10.5 L21 9.5" />
    </g>
  ),
  // Two perpendicular sets.
  crosshatch: (
    <g {...BASE} opacity="0.95">
      <path d="M2 12 L11 1 M8 12 L17 1 M14 12 L21 3" />
      <path d="M2 4 L10 12 M2 1 L13 12 M9 1 L20 12" opacity="0.55" />
    </g>
  ),
  // One vertical extrusion per cell.
  pillars: (
    <g {...BASE}>
      <path d="M2 12 L2 8 M5.5 12 L5.5 5 M9 12 L9 9 M12.5 12 L12.5 3 M16 12 L16 7 M19.5 12 L19.5 10" />
    </g>
  ),
  // Nested isolines.
  contours: (
    <g {...BASE}>
      <path d="M2 11.5 C6 6, 16 6, 20 11.5" />
      <path d="M5 11.5 C7.5 8, 14.5 8, 17 11.5" />
      <path d="M8 11.5 C9.5 10, 12.5 10, 14 11.5" />
    </g>
  ),
  // Short slope-directed strokes, longest where it is steepest.
  hachure: (
    <g {...BASE}>
      <path d="M2 4 L3 9 M5.5 3 L6.5 10 M9 2.5 L10 10.5 M12.5 3 L13.5 10 M16 4 L17 9 M19.5 5.5 L20.5 8" />
    </g>
  ),
  // Drainage paths converging downhill.
  flow: (
    <g {...BASE}>
      <path d="M2 1.5 C4 5, 3 8, 6 11.5" />
      <path d="M9 1.5 C11 5.5, 9.5 8.5, 12 11.5" />
      <path d="M16 1.5 C18.5 5, 17 8, 20 11.5" />
    </g>
  ),
  // Strahler order: tributaries thickening into a trunk.
  network: (
    <g {...BASE}>
      <path d="M11 12 L11 8" strokeWidth="1.8" />
      <path d="M11 8 L6 4 M11 8 L16 4" strokeWidth="1.2" />
      <path d="M6 4 L3 1.5 M6 4 L7.5 1 M16 4 L14.5 1 M16 4 L19 1.5" strokeWidth="0.8" />
    </g>
  ),
  // Curvature picked out as loose graphite.
  pencil: (
    <g {...BASE} strokeWidth="0.85">
      <path d="M2 9.5 C5 6.5, 4 4.5, 7 2.5" />
      <path d="M5 11 C8 8, 7 6, 10 3" />
      <path d="M9 11.5 C12 8.5, 11 6.5, 14 3.5" />
      <path d="M13 11.5 C16 9, 15.5 7, 18.5 4.5" />
    </g>
  ),
  // Crest lines.
  ridge: (
    <g {...BASE}>
      <path d={RIDGE} strokeWidth="1.4" />
      <path d="M1 12.5 L21 12.5" opacity="0.35" strokeWidth="0.7" />
    </g>
  ),
  // Troughs — the same line read the other way up.
  valley: (
    <g {...BASE}>
      <path d="M1 2 L4 4 L7 9 L9 6 L12 11 L15 7 L18 9 L21 4" strokeWidth="1.4" />
      <path d="M1 0.5 L21 0.5" opacity="0.35" strokeWidth="0.7" />
    </g>
  ),
  // Density, not direction.
  stipple: (
    <g fill="currentColor" stroke="none">
      {[[3,3],[7,2],[11,3.5],[15,2.5],[19,4],[2,7],[5.5,6],[9,7],[13,6],[17,7.5],[20.5,6.5],
        [4,10.5],[8,10],[12,11],[16,10],[19.5,10.5]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.1 : 0.75} />
      ))}
    </g>
  ),
  // Copperplate: parallel rules that thicken into the shadow.
  // Lines of constant light. Nested like contours, but deliberately uneven:
  // they crowd where the surface turns away from the sun and open out where it
  // faces the sun, which is the whole difference from a level set of height.
  isophotes: (
    <g {...BASE}>
      <path d="M2 1.5 C3.5 4.5, 3.5 8.5, 2 11.5" />
      <path d="M4 1.5 C6 4.5, 6 8.5, 4 11.5" />
      <path d="M6.5 1.5 C9 4.5, 9 8.5, 6.5 11.5" />
      <path d="M10 1.5 C13 4.5, 13 8.5, 10 11.5" />
      <path d="M15 1.5 C18.5 4.5, 18.5 8.5, 15 11.5" />
    </g>
  ),
  engraving: (
    <g {...BASE}>
      <path d="M1 2 L21 2"   strokeWidth="0.6" />
      <path d="M1 4.5 L21 4.5" strokeWidth="0.9" />
      <path d="M1 7 L21 7"   strokeWidth="1.3" />
      <path d="M1 9.5 L21 9.5" strokeWidth="1.8" />
      <path d="M1 12 L21 12" strokeWidth="2.2" />
    </g>
  ),
  // Streamlines that wrap the shape rather than the light.
  curvature: (
    <g {...BASE}>
      <path d="M2 2 C7 2, 7 11, 12 11 C17 11, 17 2, 21 2" />
      <path d="M2 5 C7 5, 7 8, 12 8 C17 8, 17 5, 21 5" opacity="0.75" />
      <path d="M2 11 C6 11, 6.5 2, 11 2" opacity="0.5" />
    </g>
  ),
  // Cliff hachures above, scree below.
  swiss: (
    <g stroke="currentColor" fill="currentColor" strokeLinecap="round" vectorEffect="non-scaling-stroke">
      <g fill="none" strokeWidth="1">
        <path d="M3 1.5 L4 6 M6 1 L7 6 M9 1.5 L10 6 M12 1 L13 6 M15 1.5 L16 6 M18 2 L19 6" />
      </g>
      <g stroke="none">
        {[[3,8.5],[7,9],[11,8.5],[15,9],[19,8.5],[5,11],[9,11.5],[13,11],[17,11.5]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 2 ? 0.7 : 1} />
        ))}
      </g>
    </g>
  ),
}

export function ModeMark({ kind }) {
  const mark = MARKS[kind]
  if (!mark) return null
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}>
      {mark}
    </svg>
  )
}
