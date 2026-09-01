/**
 * A sample of what each draw mode puts on paper, small enough to sit in a
 * section header.
 *
 * Twenty-seven rows reading MODE: ⟨noun⟩ are interchangeable to anyone
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
  // Quantised tiers: a hard lattice staircase, dithered between the steps.
  bitplane: (
    <g stroke="currentColor" fill="currentColor" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
      <g fill="none" strokeWidth="1.1">
        <path d="M1 11.5 L5 11.5 L5 8.5 L9 8.5 L9 5.5 L13 5.5 L13 2.5 L17 2.5 L17 5.5 L21 5.5" />
      </g>
      <g stroke="none">
        {[[2.5,9.5],[6.5,6.5],[10.5,3.5],[18.5,3.5],[4,10.5],[8,7.5],[12,4.5],[20,4.5]].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width={i % 2 ? 0.9 : 1.3} height={i % 2 ? 0.9 : 1.3} />
        ))}
      </g>
    </g>
  ),
  // One hard light: blown to paper at the near edge, crushed to solid at the far.
  flashbulb: (
    <g stroke="none" fill="currentColor">
      {[[19,2,1.5],[20.5,4.5,1.5],[17.5,4.5,1.5],[19,7,1.4],[21,9,1.3],[16,7,1.2],
        [17.5,9.5,1.2],[14,9,1],[19.5,11.5,1.1],[15,11.5,0.9],[11,11,0.75],[12,8,0.6],
        [8,11.5,0.5],[9,9,0.4],[5,11,0.32],[6,8.5,0.26]].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} />
      ))}
    </g>
  ),
  // A lit edge bleeding into the dark beside it.
  halation: (
    <g stroke="none" fill="currentColor">
      <g opacity="0.28">
        {[[7,2.5,1.7],[6,5,1.9],[7,7.5,1.8],[8.5,10,1.6],[9.5,4,1.5],[10,8,1.4]].map(([x,y,r],i) => (
          <circle key={'g'+i} cx={x} cy={y} r={r} />
        ))}
      </g>
      {[[13,2,1.1],[15,4,1],[14,6.5,0.95],[16.5,8,0.85],[15.5,11,0.8],[18,5.5,0.75],
        [19,9,0.65],[20.5,3,0.6],[20,12,0.55],[11,11.5,0.5]].map(([x,y,r],i) => (
        <circle key={'d'+i} cx={x} cy={y} r={r} />
      ))}
      <g opacity="0.9">
        {[[2,3,0.5],[3,6,0.42],[2.5,9,0.36],[4,11.5,0.3]].map(([x,y,r],i) => (
          <circle key={'p'+i} cx={x} cy={y} r={r} />
        ))}
      </g>
    </g>
  ),
  // A carved arc that overshoots rather than a dendritic drainage line.
  fallline: (
    <g {...BASE}>
      <path d="M3 1.5 C3 5, 8 4.5, 9 7.5 C10 10.5, 15 10, 16 7 C17 4, 20 4.5, 21 7.5" strokeWidth="1.4" />
      <path d="M1.5 4 C2 7, 5 7, 6 9.5 C7 11.5, 9.5 12, 11 11" opacity="0.45" />
    </g>
  ),
  // Lateral load: ticks on the outside of the turns, nothing on the straights.
  berm: (
    <g {...BASE}>
      <path d="M2 2 C2 6, 7 5, 8.5 8 C10 11, 15 10.5, 16 7 C17 3.5, 20 4, 21 6" strokeWidth="1.1" />
      <path d="M2.6 4 L0.9 4.4 M3.6 6 L2 6.8 M5.6 7.2 L4.6 8.9 M9.4 9.6 L9 11.4
               M12 10.6 L12.2 12.4 M15.3 9.6 L16.6 10.9 M16.6 6 L18.3 6.2" strokeWidth="0.85" opacity="0.85" />
    </g>
  ),
  // The flight, dashed, off the ground; the run-in dotted behind it.
  air: (
    <g {...BASE}>
      <path d="M1 10.5 L4 9.5 L6.5 6.5" strokeDasharray="1 1.6" opacity="0.6" />
      <path d="M6.5 6.5 C9 1.5, 13 1, 16 6.5" strokeDasharray="2.4 1.8" strokeWidth="1.3" />
      <path d="M16 6.5 L18 9.5 L21 10.5" opacity="0.6" />
      <path d="M6.5 6.5 L6.5 8" strokeWidth="0.7" opacity="0.4" />
    </g>
  ),
  // A braid from one drop-in, with the fastest line picked out.
  raceline: (
    <g {...BASE}>
      <circle cx="4" cy="2" r="1.2" fill="currentColor" stroke="none" />
      <path d="M4 3.2 C4 6, 2 8, 1.5 11.5" opacity="0.4" />
      <path d="M4 3.2 C5 6, 4 8.5, 4.5 11.5" opacity="0.4" />
      <path d="M4 3.2 C7 6, 9 8, 13 11.5" opacity="0.4" />
      <path d="M4 3.2 C8 5.5, 12 7, 20.5 11.5" opacity="0.4" />
      <path d="M4 3.2 C6 6.5, 6.5 9, 8.5 11.5" strokeWidth="1.9" />
    </g>
  ),
  // The same frame pulled apart along Y, with leaders back to place.
  exploded: (
    <g stroke="currentColor" fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke">
      <path d="M2 2.5 L11 1.5 L20 3" strokeWidth="1.6" />
      <path d="M2 6.5 L11.5 6 M11.5 6 L20 7" strokeWidth="0.8" />
      <path d="M2 11 L11 10.5 L20 11.5" strokeWidth="1.2" strokeDasharray="2 1.5" />
      <path d="M6 2.2 L6 11 M15.5 2.3 L15.5 11.2" strokeWidth="0.5" strokeDasharray="1 1.4" />
    </g>
  ),
  // A cutting plane: hatched below, outline beyond.
  section: (
    <g stroke="currentColor" fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke">
      <path d="M1 3 L6 1.5 L10 3.5 L14 1 L18 3 L21 2" strokeWidth="0.7" opacity="0.5" />
      <path d="M1 6.5 L21 6.5" strokeWidth="1.8" />
      <path d="M2 12 L7.5 6.5 M5.5 12 L11 6.5 M9 12 L14.5 6.5 M12.5 12 L18 6.5 M16 12 L21 7"
            strokeWidth="0.7" />
    </g>
  ),
  // Dots at every sign change: dense where the ground is busy.
  zerocross: (
    <g stroke="none" fill="currentColor">
      <path d="M1 6.5 L21 6.5" stroke="currentColor" strokeWidth="0.4" fill="none" opacity="0.45" />
      {[1.5,2.6,3.4,4.7,5.3,6.6,8.4,10.8,13.6,14.4,15.6,17.4,18.2,19.6,20.5].map((x, i) => (
        <circle key={i} cx={x} cy={i % 3 === 0 ? 4 : i % 3 === 1 ? 6.5 : 9} r={0.8} />
      ))}
    </g>
  ),
  // Isometric blocks stepping up a slope.
  sprite: (
    <g stroke="currentColor" strokeLinejoin="miter" vectorEffect="non-scaling-stroke" strokeWidth="1">
      <g fill="none">
        <path d="M2 9 L5.5 7.5 L9 9 L5.5 10.5 Z M2 9 L2 11 L5.5 12.5 L9 11 L9 9 M5.5 10.5 L5.5 12.5" />
        <path d="M8 5.5 L11.5 4 L15 5.5 L11.5 7 Z M8 5.5 L8 7.5 L11.5 9 L15 7.5 L15 5.5 M11.5 7 L11.5 9" />
        <path d="M14 2 L17.5 0.5 L21 2 L17.5 3.5 Z M14 2 L14 4 L17.5 5.5 L21 4 L21 2 M17.5 3.5 L17.5 5.5" />
      </g>
    </g>
  ),
  // Cell walls, not cells: a crazed network.
  retic: (
    <g stroke="none" fill="currentColor">
      {[[2,2],[3.4,3.2],[5,4],[6.8,4.4],[8.6,4],[10,3],[11,1.8],
        [5.2,5.8],[5.6,7.6],[6.4,9.4],[7.6,11],
        [10.6,4.6],[12.2,5.8],[13.4,7.4],[14,9.2],[14.2,11],
        [12.4,4.4],[14,3.4],[15.8,3],[17.6,3.4],[19.2,4.4],[20.4,5.8],
        [16.6,5.2],[17.2,7],[18.2,8.6],[19.6,9.8],
        [2.6,5.6],[2,7.4],[1.6,9.2],[2.2,11]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={0.75} />
      ))}
    </g>
  ),
  // A palette read as a lookup: flat blocks, dithered along one seam.
  indexed: (
    <g stroke="none" fill="currentColor">
      <rect x="1" y="1.5" width="6" height="4.5" opacity="0.35" />
      <rect x="7.5" y="1.5" width="6" height="4.5" opacity="0.65" />
      <rect x="14" y="1.5" width="7" height="4.5" opacity="1" />
      <rect x="1" y="7" width="6" height="4.5" opacity="0.8" />
      <rect x="7.5" y="7" width="6" height="4.5" opacity="0.25" />
      {[[14,7],[16,7],[18,7],[20,7],[15,8.5],[17,8.5],[19,8.5],
        [14,10],[16,10],[18,10],[20,10]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="1.1" height="1.1" opacity="0.7" />
      ))}
    </g>
  ),
  // A stroke with a halo: the same path twice, wide and dim under thin and hot.
  outrun: (
    <g fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke">
      <path d={RIDGE} stroke="currentColor" strokeWidth="5" opacity="0.16" />
      <path d={RIDGE} stroke="currentColor" strokeWidth="2.4" opacity="0.3" />
      <path d={RIDGE} stroke="currentColor" strokeWidth="0.9" opacity="1" />
    </g>
  ),
  // Three screens at three angles, overprinted.
  riso: (
    <g stroke="none" fill="currentColor">
      {[[2,3],[5,2],[8,3.4],[11,2.4],[14,3.6],[17,2.6],[20,3.8]].map(([x, y], i) => (
        <circle key={'a'+i} cx={x} cy={y} r="1.1" opacity="0.85" />
      ))}
      {[[3,6.6],[6,7.4],[9,6.4],[12,7.2],[15,6.2],[18,7]].map(([x, y], i) => (
        <circle key={'b'+i} cx={x} cy={y} r="1.1" opacity="0.5" />
      ))}
      {[[2,10.4],[5.5,10],[9,10.8],[12.5,10.2],[16,10.9],[19.5,10.3]].map(([x, y], i) => (
        <circle key={'c'+i} cx={x} cy={y} r="1.1" opacity="0.3" />
      ))}
    </g>
  ),
  // Patches of material, each with its own tooth.
  mineral: (
    <g>
      <g stroke="none" fill="currentColor">
        <path d="M1 1.5 L9 1.5 L11 5 L4 7 L1 5 Z" opacity="0.85" />
        <path d="M9 1.5 L21 1.5 L21 6 L11 5 Z" opacity="0.4" />
        <path d="M1 5 L4 7 L3 11.5 L1 11.5 Z" opacity="0.6" />
        <path d="M4 7 L11 5 L21 6 L21 11.5 L3 11.5 Z" opacity="0.2" />
      </g>
      <g stroke="none" fill="currentColor" opacity="0.55">
        {[[6,9],[9,10.5],[13,9],[16,10.6],[19,9.2],[7.5,11],[11,8.4],[17,8.2]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="0.5" />
        ))}
      </g>
    </g>
  ),
  // Catchments: flat areas of colour, divided along the ridges.
  shed: (
    <g>
      <g stroke="none" fill="currentColor">
        <path d="M1 1.5 L8 1.5 L6 6.5 L1 8 Z" opacity="0.85" />
        <path d="M8 1.5 L15 1.5 L14 7 L6 6.5 Z" opacity="0.35" />
        <path d="M15 1.5 L21 1.5 L21 7.5 L14 7 Z" opacity="0.62" />
        <path d="M1 8 L6 6.5 L14 7 L21 7.5 L21 11.5 L1 11.5 Z" opacity="0.15" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="0.8" vectorEffect="non-scaling-stroke">
        <path d="M8 1.5 L6 6.5 M15 1.5 L14 7 M1 8 L6 6.5 L14 7 L21 7.5" />
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
