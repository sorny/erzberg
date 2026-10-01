/**
 * Every draw mode's own section, for the Marks stage.
 *
 * Moved out of Sidebar.jsx, where these forty sections were a thousand lines of
 * the component's body. They share nothing with the rest of the panel beyond
 * the values passed in here: the style and its setter, the open sections, and
 * a few readouts the Sidebar measures (the sun, the route, the view). Only one
 * section is on screen at a time; the mode sheet decides which.
 */
import { formatClock } from '../../utils/solar'
import { BORDER, Btn, ColorRow, DIM, DateRow, HelpBox, InlineSl, MUTED, Note, SURF, Section, SegGroup, SegRow, Sub, Tog, WARN } from './ui'
import { ModeStyleOverride } from './ModeStyleOverride'
import { ModeMark } from './modeMarks'

/** A walking time as `2 h 05 min`, or `45 min` under an hour. */
const formatWalk = (seconds) => {
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

export function ModeSections({ coralNote, cover, geoTiffBbox, glacierNote, gradientStops, hasGeoTiff, intervalMax, intervalMin, mPerWorld, metreInterval, onPick, pick, plateSpan = 1000, routeNote, runoutNote, sec, slopeClassNote, sg, shadowLineSun, singleLineFonts, ss, style, sunHoursGeoreferenced, sunHoursSeconds, sunHoursSweeps, terrain, tog, venationNote, viewshedNote, windNote }) {
  return (
    <>
          <Section title="Mode: Lines" icon={<ModeMark kind="lines" />} open={sec.modeLines} onToggle={() => tog('modeLines')} enabled={style.enabledLines}>
            <Tog label="Enabled" checked={style.enabledLines} onChange={v => ss({ enabledLines: v })} />
            {style.enabledLines && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingLines} onChange={v => ss({ spacingLines: v })} />
                  <InlineSl label="Shift" min={0} max={100} value={style.shiftLines} onChange={v => ss({ shiftLines: v })} />
                  <InlineSl label="Angle" help="Bearing of the parallel lines. 0° runs along the X axis, 90° along Y, anything between gives diagonal ridgelines." min={0} max={180} step={1} value={style.angleLines ?? 0} onChange={v => ss({ angleLines: v })} fmt={v => `${v}°`} />
                </Sub>
                <ModeStyleOverride prefix="Lines" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Crosshatch" icon={<ModeMark kind="crosshatch" />} open={sec.modeCross} onToggle={() => tog('modeCross')} enabled={style.enabledCross}>
            <Tog label="Enabled" checked={style.enabledCross} onChange={v => ss({ enabledCross: v })} />
            {style.enabledCross && (
              <>
                <Sub>
                  <InlineSl label="Spacing" log help="The gap between lines. It runs up to the width of the terrain, where only the lines along its edges are left: a frame." min={1} max={Math.max(100, plateSpan)} step={0.5} value={style.spacingCross} onChange={v => ss({ spacingCross: v })} fmt={v => (v >= 10 ? Math.round(v) : v.toFixed(1))} />
                  <InlineSl label="Angle" help="Bearing of the first line set; the second runs perpendicular to it." min={0} max={90} step={1} value={style.angleCross ?? 0} onChange={v => ss({ angleCross: v })} fmt={v => `${v}°`} />
                  <Tog label="Lines" help="Off leaves only the crosses at the intersections, as many maps draw a grid." checked={style.linesCross !== false} onChange={v => ss({ linesCross: v })} />
                  <Tog label="Intersections" testId="cross-marks" help="A plus sign where the lines cross, as its own pen." checked={!!style.marksCross} onChange={v => ss({ marksCross: v })} />
                  {style.marksCross && (
                    <>
                      <InlineSl label="Size" log help="The width of each cross, arm to arm." min={1} max={Math.max(50, Math.round(plateSpan / 4))} step={0.5} value={style.markSizeCross ?? 6} onChange={v => ss({ markSizeCross: v })} fmt={v => (v >= 10 ? Math.round(v) : v.toFixed(1))} />
                      <ColorRow label="Cross colour" value={style.markColorCross ?? '#c0561a'} onChange={v => ss({ markColorCross: v })} />
                      <InlineSl label="Cross weight" min={0.5} max={10} step={0.5} value={style.markWeightCross ?? 1.5} onChange={v => ss({ markWeightCross: v })} fmt={v => v.toFixed(1)} />
                      <SegGroup label="Cross dash" capitalize
                        options={[['solid', 'solid'], ['dashed', 'dashed'], ['short', 'dotted'], ['long', 'long-dash'], ['dotted', 'dots']]}
                        value={style.markDashCross ?? 'solid'} onChange={(d) => ss({ markDashCross: d })} style={{ marginBottom: 6 }} />
                    </>
                  )}
                </Sub>
                <ModeStyleOverride prefix="Cross" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Pillars" icon={<ModeMark kind="pillars" />} open={sec.modePillars} onToggle={() => tog('modePillars')} enabled={style.enabledPillars}>
            <Tog label="Enabled" checked={style.enabledPillars} onChange={v => ss({ enabledPillars: v })} />
            {style.enabledPillars && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingPillars} onChange={v => ss({ spacingPillars: v })} />
                  <InlineSl label="Gap" min={0} max={20} step={0.5} value={style.pillarGap} onChange={v => ss({ pillarGap: v })} />
                  <InlineSl label="Depth" min={0} max={100} step={1} value={style.pillarDepth} onChange={v => ss({ pillarDepth: v })} />
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: MUTED, display: 'block', marginBottom: 4 }}>Shape</span>
                    <SegGroup label="Pillar shape" options={[['Line', 'line'], ['Cuboid', 'cuboid'], ['Cylinder', 'cylinder']]}
                      value={style.pillarStyle ?? 'line'} onChange={(v) => ss({ pillarStyle: v })} />
                  </div>
                  {(style.pillarStyle === 'cuboid' || style.pillarStyle === 'cylinder') && (
                    <InlineSl label="Size" help="Cross-section as a fraction of spacing. 1.0 = pillars touch, 0.5 = half-width." min={0.05} max={1} step={0.05} value={style.pillarSize ?? 0.8} onChange={v => ss({ pillarSize: v })} fmt={v => Math.round(v * 100) + '%'} />
                  )}
                  {style.pillarStyle === 'cylinder' && (
                    <InlineSl label="Segments" help="Number of polygon sides approximating the circle." min={3} max={16} step={1} value={style.pillarSegments ?? 8} onChange={v => ss({ pillarSegments: v })} fmt={v => Math.round(v)} />
                  )}
                  {(style.pillarStyle === 'cuboid' || style.pillarStyle === 'cylinder') && (
                    <ColorRow label="Lid Color" value={style.pillarLidColor ?? '#ffffff'} onChange={v => ss({ pillarLidColor: v })} />
                  )}
                  <InlineSl label="Occlusion width" testId="pillar-solid"
                    help="How much of its cell each pillar hides behind it, with Depth occlusion on. At 0 the pillar lines hide nothing. At 1 the pillars join into a solid block and hide the ground behind them. Cuboids and cylinders hide with their own sides at any value above 0."
                    min={0} max={1} step={0.05} value={style.pillarSolid ?? 0} onChange={v => ss({ pillarSolid: v })} fmt={v => Math.round(v * 100) + '%'} />
                  <Tog label="Above the ground" testId="pillar-above"
                    help="Mirrors each pillar upwards, from the ground to a ceiling at the highest point. With both halves the pillars fill a box, and the terrain is where they meet. A Gap opens a seam along the ground."
                    checked={!!style.pillarAbove} onChange={v => ss({ pillarAbove: v })} />
                  {style.pillarAbove && (
                    <InlineSl label="Ceiling" help="Extra height of the ceiling above the highest point." min={0} max={100} step={1} value={style.pillarCeiling ?? 0} onChange={v => ss({ pillarCeiling: v })} />
                  )}
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: MUTED, display: 'block', marginBottom: 4 }}>{style.pillarAbove ? 'Ink below' : 'Ink'}</span>
                    <SegGroup label="Pillar ink" options={[['Line style', 'line'], ['Cover class', 'class'], ['Cover plate', 'plate']]}
                      value={style.pillarInk ?? 'line'} onChange={(v) => ss({ pillarInk: v })} />
                  </div>
                  {style.pillarAbove && (
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: MUTED, display: 'block', marginBottom: 4 }}>Ink above</span>
                      <SegGroup label="Pillar ink above" options={[['Line style', 'line'], ['Cover class', 'class'], ['Cover plate', 'plate']]}
                        value={style.pillarAboveInk ?? 'line'} onChange={(v) => ss({ pillarAboveInk: v })} />
                    </div>
                  )}
                  {[style.pillarInk, style.pillarAbove && style.pillarAboveInk].some((m) => m === 'class' || m === 'plate') && !cover && (
                    <Note>No cover plate loaded, so the pillars use the line style. Open one under Land Cover.</Note>
                  )}
                </Sub>
                <ModeStyleOverride prefix="Pillars" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg}
                  label={style.pillarAbove ? 'Line style below' : 'Line style'} />
                {/* The upper half is its own layer and pen, so it has its own
                    style. Land cover and painted masks stay with the mode. */}
                {style.pillarAbove && (
                  <ModeStyleOverride prefix="PillarsAbove" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg}
                    label="Line style above" showCover={false} />
                )}
              </>
            )}
          </Section>

          <Section title="Mode: Contours" icon={<ModeMark kind="contours" />} open={sec.modeContours} onToggle={() => tog('modeContours')} enabled={style.enabledContours}>
            <Tog label="Enabled" checked={style.enabledContours} onChange={v => ss({ enabledContours: v })} />
            {style.enabledContours && (
              <>
                <Sub>
                  {mPerWorld ? (
                    <InlineSl label="Interval (m)" testId="contour-interval-m"
                      help="Real ground metres, read through the raster's elevation range, the Shadows/Highlights handles and the current vertical exaggeration. The interval itself is kept in world units, so moving the exaggeration changes what it is worth on the ground — this number follows the lines rather than pinning them."
                      min={intervalMin} max={intervalMax} step={0.1} value={metreInterval}
                      onChange={v => ss({ intervalContours: v / mPerWorld })}
                      fmt={v => (v >= 100 ? String(Math.round(v)) : v.toFixed(1)) + 'm'} />
                  ) : (
                    <InlineSl label="Interval" min={0.1} max={10} step={0.1} value={style.intervalContours} onChange={v => ss({ intervalContours: v })} fmt={v => v.toFixed(1)} />
                  )}
                  <InlineSl label="Major Every" min={0} max={50} step={1} value={style.majorIntervalContours} onChange={v => ss({ majorIntervalContours: v })} fmt={v => v === 0 ? 'None' : 'Every '+v} />
                  {style.majorIntervalContours > 1 && (
                    <InlineSl label="Major Offset" min={1} max={style.majorIntervalContours} step={1} value={style.majorOffsetContours} onChange={v => ss({ majorOffsetContours: v })} />
                  )}
                  {style.majorIntervalContours > 0 && (
                    <InlineSl label="Major Weight" min={0.5} max={10} step={0.5} value={style.majorWeightContours} onChange={v => ss({ majorWeightContours: v })} />
                  )}
                  <Tog label="Close contours" checked={!!style.closeRingsContours} onChange={v => ss({ closeRingsContours: v })} />
                  {!style.tanakaContours && (
                    <InlineSl label="Smoothing" help="Chaikin corner-cutting passes. 0 = crisp marching-squares lines; higher = soft, flowing form lines." min={0} max={4} step={1} value={style.smoothingContours ?? 0} onChange={v => ss({ smoothingContours: v })} />
                  )}
                  <Tog label="Label heights" help="Prints each contour's elevation into the line itself — the contour stops, the number sits in the gap at the line's own angle, and the contour resumes. That is what makes a sheet of nested curves readable, and it is why a printed map does it this way rather than setting the number beside the line." checked={!!style.labelContours} onChange={v => ss({ labelContours: v })} />
                  {style.labelContours && (
                    <Sub>
                      <InlineSl label="Size" help="World units per em — the same measure the vector labels use, so both read against the terrain rather than against the screen." min={2} max={40} step={0.5} value={style.labelSizeContours} onChange={v => ss({ labelSizeContours: v })} />
                      <InlineSl label="Spacing" help="How far apart along a contour. A number every few hundred units reads as a map; one every few tens reads as a ticker tape." min={40} max={600} step={10} value={style.labelSpacingContours} onChange={v => ss({ labelSpacingContours: v })} />
                      <InlineSl label="Clearance" help="Blank space kept either side of the number, in the same world units as Size. Every contour at that level is erased inside the box, not just the one the label sits on — so a line that hairpins back, or a neighbouring ring on steep ground, is masked too. Raise it for a thick pen, drop it to 0 to let the line run right up to the digits." min={0} max={30} step={0.5} value={style.labelPadContours} onChange={v => ss({ labelPadContours: v })} fmt={v => v.toFixed(1)} />
                      <ColorRow label="Colour" testId="contour-label-color"
                        help="The numbers' own ink. They follow the contour colour until this is touched, after which they keep whatever it is set to — a red index elevation over grey contours is a normal thing for a sheet to do."
                        value={style.labelColorContours ?? style.colorContours}
                        onChange={v => ss({ labelColorContours: v })} />
                      <InlineSl label="Weight" min={0.5} max={6} step={0.5} value={style.labelWeightContours} onChange={v => ss({ labelWeightContours: v })} />
                      <Tog label="Major only" small help="Labelling every minor contour is a page of numbers with a drawing behind it. A printed sheet labels the index contours, which is what this does." checked={!!style.labelMajorOnlyContours} onChange={v => ss({ labelMajorOnlyContours: v })} />
                      <Tog label="Use single-line font" small help="Sets the numbers in a stroke face, so the pen draws each digit once instead of tracing its outline." checked={!!style.labelSingleLineContours} onChange={v => ss({ labelSingleLineContours: v })} />
                      {style.labelSingleLineContours && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '2px 0 8px' }}>
                          <span style={{ fontSize: 10, color: DIM, width: 54 }}>Font</span>
                          <select value={style.labelFontContours ?? 'HersheySans1'}
                            onChange={(e) => ss({ labelFontContours: e.target.value })}
                            data-testid="contour-label-font"
                            style={{ flex: 1, minWidth: 0, background: SURF, color: DIM,
                                     border: `1px solid ${BORDER}`, borderRadius: 3,
                                     fontSize: 10, padding: '4px 4px', cursor: 'pointer', fontFamily: 'inherit' }}>
                            {Object.entries(singleLineFonts.reduce((g, f) => {
                              (g[f.group] ??= []).push(f); return g
                            }, {})).map(([group, faces]) => (
                              <optgroup key={group} label={group}>
                                {faces.map((f) => <option key={f.id} value={f.id}>{f.family}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      )}
                    </Sub>
                  )}
                  <Tog label="Tanaka illumination" help="Split contours into thick-bright (illuminated side) and thin-dark (shadow side) layers." checked={!!style.tanakaContours} onChange={v => ss({ tanakaContours: v })} />
                  {style.tanakaContours && (
                    <Sub>
                      <InlineSl label="Sun Azimuth" min={0} max={360} step={5} value={style.tanakaSunAzimuth ?? 315} onChange={v => ss({ tanakaSunAzimuth: v })} fmt={v => Math.round(v) + '°'} />
                      <InlineSl label="Bright Weight" min={0.5} max={10} step={0.5} value={style.tanakaWeightBright ?? 2.5} onChange={v => ss({ tanakaWeightBright: v })} />
                      <InlineSl label="Dark Weight" min={0.5} max={10} step={0.5} value={style.tanakaWeightDark ?? 0.5} onChange={v => ss({ tanakaWeightDark: v })} />
                    </Sub>
                  )}
                </Sub>
                <ModeStyleOverride prefix="Contours" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Hachure" icon={<ModeMark kind="hachure" />} open={sec.modeHachure} onToggle={() => tog('modeHachure')} enabled={style.enabledHachure}>
            <Tog label="Enabled" checked={style.enabledHachure} onChange={v => ss({ enabledHachure: v })} />
            {style.enabledHachure && (
              <>
                <Sub>
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['tick','TICKS'],['lehmann','LEHMANN']].map(([m, lbl]) => (
                      <Btn key={m} block variant="toggle" on={(style.styleHachure ?? 'tick') === m} data-testid={`hachure-style-${m}`}
                        onClick={() => ss({ styleHachure: m })}
                        style={{ fontSize:9, padding:'3px 0', borderRadius:2 }}>{lbl}</Btn>
                    ))}
                  </div>
                  <InlineSl label="Spacing" help={style.styleHachure === 'lehmann' ? 'Gap between strokes on the steepest ground. Gentle ground gets up to four times this.' : undefined} min={1} max={100} value={style.spacingHachure} onChange={v => ss({ spacingHachure: v })} />
                  {style.styleHachure === 'lehmann' ? (
                    <>
                      <InlineSl label="Bands" help="Contour bands. Each stroke runs downhill and stops short of the next band, which leaves a thin gap along every contour." min={2} max={60} step={1} value={style.bandsHachure ?? 14} onChange={v => ss({ bandsHachure: Math.round(v) })} />
                      <InlineSl label="Gamma" help="How fast the spacing opens out as the ground gets gentler. Above 1, only the steepest ground stays dense." min={0.2} max={3} step={0.05} value={style.gammaHachure ?? 1} onChange={v => ss({ gammaHachure: v })} fmt={v => v.toFixed(2)} />
                    </>
                  ) : (
                    <InlineSl label="Length" min={0.1} max={5} step={0.1} value={style.lengthHachure} onChange={v => ss({ lengthHachure: v })} />
                  )}
                </Sub>
                <ModeStyleOverride prefix="Hachure" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Flow" icon={<ModeMark kind="flow" />} open={sec.modeFlow} onToggle={() => tog('modeFlow')} enabled={style.enabledFlow}>
            <Tog label="Enabled" checked={style.enabledFlow} onChange={v => ss({ enabledFlow: v })} />
            {style.enabledFlow && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={0.5} max={30} step={0.5} value={style.spacingFlow} onChange={v => ss({ spacingFlow: v })} />
                  <InlineSl label="Step" min={0.1} max={3} step={0.1} value={style.stepFlow} onChange={v => ss({ stepFlow: v })} />
                  <InlineSl label="Max Len" min={1} max={250} value={style.maxLenFlow} onChange={v => ss({ maxLenFlow: v })} />
                </Sub>
                <ModeStyleOverride prefix="Flow" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Network" icon={<ModeMark kind="network" />} open={sec.modeDag} onToggle={() => tog('modeDag')} enabled={style.enabledDag}>
            <Tog label="Enabled" checked={style.enabledDag} onChange={v => ss({ enabledDag: v })} />
            {style.enabledDag && (
              <>
                <Sub>
                  <InlineSl label="Threshold" min={1} max={10} step={1} value={style.thresholdDag} onChange={v => ss({ thresholdDag: v })} />
                  <Tog label="Weight by flow" testId="dag-accum" checked={!!style.accumDag} onChange={v => ss({ accumDag: v })} />
                  {style.accumDag && (
                    <>
                      <InlineSl label="Passes" help="Parallel strokes on the main channel. Each channel gets more passes as more ground drains through it, so the trunk draws heaviest." min={2} max={8} step={1} value={style.passesDag ?? 4} onChange={v => ss({ passesDag: Math.round(v) })} />
                      <InlineSl label="Pass gap" help="Distance between the passes, in cells. Match it to the pen width for a solid line." min={0.05} max={1.5} step={0.05} value={style.gapDag ?? 0.35} onChange={v => ss({ gapDag: v })} fmt={v => v.toFixed(2)} />
                    </>
                  )}
                </Sub>
                <ModeStyleOverride prefix="Dag" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Pencil" icon={<ModeMark kind="pencil" />} open={sec.modePencil} onToggle={() => tog('modePencil')} enabled={style.enabledPencil}>
            <Tog label="Enabled" checked={style.enabledPencil} onChange={v => ss({ enabledPencil: v })} />
            {style.enabledPencil && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={100} value={style.spacingPencil} onChange={v => ss({ spacingPencil: v })} />
                  <InlineSl label="Threshold" min={0.1} max={5} step={0.1} value={style.thresholdPencil} onChange={v => ss({ thresholdPencil: v })} />
                </Sub>
                <ModeStyleOverride prefix="Pencil" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Ridge" icon={<ModeMark kind="ridge" />} open={sec.modeRidge} onToggle={() => tog('modeRidge')} enabled={style.enabledRidge}>
            <Tog label="Enabled" checked={style.enabledRidge} onChange={v => ss({ enabledRidge: v })} />
            {style.enabledRidge && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={10} value={style.spacingRidge} onChange={v => ss({ spacingRidge: v })} />
                  <InlineSl label="Radius" min={0.2} max={2} step={0.1} value={style.radiusRidge} onChange={v => ss({ radiusRidge: v })} />
                  <InlineSl label="Threshold" min={0.005} max={0.5} step={0.005} value={style.thresholdRidge} onChange={v => ss({ thresholdRidge: v })} />
                </Sub>
                <ModeStyleOverride prefix="Ridge" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Valley" icon={<ModeMark kind="valley" />} open={sec.modeValley} onToggle={() => tog('modeValley')} enabled={style.enabledValley}>
            <Tog label="Enabled" checked={style.enabledValley} onChange={v => ss({ enabledValley: v })} />
            {style.enabledValley && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={1} max={10} value={style.spacingValley} onChange={v => ss({ spacingValley: v })} />
                  <InlineSl label="Radius" min={1} max={20} step={1} value={style.radiusValley} onChange={v => ss({ radiusValley: v })} />
                  <InlineSl label="Threshold" help="How far below its surroundings a cell must sit to count as valley, as a share of the whole relief. Lower finds shallower gullies." min={0.005} max={1} step={0.005} value={style.thresholdValley} onChange={v => ss({ thresholdValley: v })} />
                </Sub>
                <ModeStyleOverride prefix="Valley" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Stipple Dots" icon={<ModeMark kind="stipple" />} open={sec.modeStipple} onToggle={() => tog('modeStipple')} enabled={style.enabledStipple}>
            <Tog label="Enabled" checked={style.enabledStipple} onChange={v => ss({ enabledStipple: v })} />
            {style.enabledStipple && (
              <>
                <Sub>
                  <InlineSl label="Spacing" help="Grid pitch between candidate dots. Smaller = denser maximum." min={0.05} max={2} step={0.05} value={style.spacingStipple} onChange={v => ss({ spacingStipple: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Gamma" help="Density curve exponent. >1 pushes dots toward high-density areas; <1 spreads them more evenly." min={0.05} max={2} step={0.05} value={style.stippleGamma} onChange={v => ss({ stippleGamma: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Jitter" help="Random displacement of each dot within its grid cell. 1 = full cell, 0 = regular grid." min={0} max={1} step={0.05} value={style.stippleJitter} onChange={v => ss({ stippleJitter: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Seed" help="Randomness seed — the same seed always reproduces the identical dot pattern." min={1} max={999} step={1} value={style.seedStipple ?? 42} onChange={v => ss({ seedStipple: v })} />
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: MUTED, display: 'block', marginBottom: 4 }}>Density from</span>
                    <SegGroup label="Density from" options={[['Slope', 'slope'], ['Inv Slope', 'invSlope'], ['Elevation', 'elevation'], ['Inv Elev', 'invElev']]}
                      value={style.stippleDensityMode} onChange={(v) => ss({ stippleDensityMode: v })} />
                  </div>
                </Sub>
                <ModeStyleOverride prefix="Stipple" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} label="Dot style" showDash={false} />
              </>
            )}
          </Section>

          <Section title="Mode: Isophotes" icon={<ModeMark kind="isophotes" />} open={sec.modeIso} onToggle={() => tog('modeIso')} enabled={style.enabledIso}>
            <Tog label="Enabled" checked={style.enabledIso} onChange={v => ss({ enabledIso: v })} />
            {style.enabledIso && (
              <>
                <Sub>
                  <InlineSl label="Levels" help="How many lines of constant light to trace. A contour joins points of equal height; an isophote joins points of equal illumination, so the lines bunch where the surface turns away from the sun and open out where it faces it." min={1} max={24} step={1} value={style.levelsIso} onChange={v => ss({ levelsIso: v })} />
                  <InlineSl label="Sun" help="Light azimuth. Turning it moves every line, because the lines *are* the light — unlike contours, which stay put whatever the sun does." min={0} max={360} step={5} value={style.sunAzimuthIso} onChange={v => ss({ sunAzimuthIso: v })} fmt={v => `${v}°`} />
                  <InlineSl label="Contrast" help="Tone curve exponent. >1 pushes the lines toward the shadows; <1 spreads them onto the lit slopes." min={0.3} max={3} step={0.1} value={style.gammaIso} onChange={v => ss({ gammaIso: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Detail" help="How much the ground is smoothed before the light is measured off it. Illumination is a *slope*, not a height, so it inherits every bump the terrain has and magnifies it — at 0 the lines fracture into noise. Turn it down for crags, up for broad forms." min={0} max={12} step={0.5} value={style.radiusIso} onChange={v => ss({ radiusIso: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Smoothing" help="Chaikin passes over each finished line, rounding the staircase left by tracing a level set across grid cells. The curve converges: most of the effect lands in the first two passes and the shape stops changing after about four, so the upper end of this range costs time without changing the drawing. For a broader, rounder line reach for Detail instead — it smooths the ground before the light is measured off it, which is a different thing entirely." min={0} max={25} step={1} value={style.smoothingIso} onChange={v => ss({ smoothingIso: v })} />
                </Sub>
                <ModeStyleOverride prefix="Iso" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Engraving" icon={<ModeMark kind="engraving" />} open={sec.modeEngrave} onToggle={() => tog('modeEngrave')} enabled={style.enabledEngrave}>
            <Tog label="Enabled" checked={style.enabledEngrave} onChange={v => ss({ enabledEngrave: v })} />
            {style.enabledEngrave && (
              <>
                <Sub>
                  <InlineSl label="Spacing" help="Pitch between hatch strokes." min={1} max={20} step={0.5} value={style.spacingEngrave} onChange={v => ss({ spacingEngrave: v })} />
                  <InlineSl label="Angle" help="Base hatch direction. Additional levels add +90°, +45°, +135°." min={0} max={180} step={1} value={style.angleEngrave} onChange={v => ss({ angleEngrave: v })} fmt={v => `${v}°`} />
                  <InlineSl label="Levels" help="Cross-hatch layers: shadows accumulate up to this many stacked directions." min={1} max={4} step={1} value={style.levelsEngrave} onChange={v => ss({ levelsEngrave: v })} />
                  <InlineSl label="Sun" help="Light azimuth driving the hatching: lit slopes stay sparse, shadows hatch densely." min={0} max={360} step={5} value={style.sunAzimuthEngrave} onChange={v => ss({ sunAzimuthEngrave: v })} fmt={v => `${v}°`} />
                  <InlineSl label="Contrast" help="Tone curve exponent. >1 confines hatching to deep shadow; <1 spreads it." min={0.3} max={3} step={0.1} value={style.gammaEngrave} onChange={v => ss({ gammaEngrave: v })} fmt={v => v.toFixed(1)} />
                </Sub>
                <ModeStyleOverride prefix="Engrave" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Curvature" icon={<ModeMark kind="curvature" />} open={sec.modeCurv} onToggle={() => tog('modeCurv')} enabled={style.enabledCurv}>
            <Tog label="Enabled" checked={style.enabledCurv} onChange={v => ss({ enabledCurv: v })} />
            {style.enabledCurv && (
              <>
                <HelpBox text="Copperplate engraving that follows the form rather than the light: strokes trace the principal-curvature field, so the lines themselves wrap around ridges and hollows." />
                <Sub>
                  <SegGroup label="Stroke direction" options={[['Across form', 'max'], ['Along form', 'min']]}
                    value={style.dirModeCurv} onChange={(v) => ss({ dirModeCurv: v })}
                    style={{ marginBottom: 8 }} />
                  <InlineSl label="Spacing" help="Separation between strokes. Each line claims territory as it advances and stops on reaching another's, so strokes stay evenly spread instead of clumping." min={1} max={20} step={0.5} value={style.spacingCurv} onChange={v => ss({ spacingCurv: v })} />
                  <InlineSl label="Length" help="Maximum steps per stroke. Short values give a broken, sketched texture; long values give sweeping continuous lines." min={5} max={400} step={5} value={style.lengthCurv} onChange={v => ss({ lengthCurv: v })} />
                  <InlineSl label="Step" help="Integration step in grid cells. Smaller follows the curvature field more faithfully at more segments." min={0.25} max={3} step={0.25} value={style.stepCurv} onChange={v => ss({ stepCurv: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Smoothing" help="Pre-blur radius before differencing. Second derivatives amplify noise, so raise this on grainy terrain." min={0} max={6} step={1} value={style.radiusCurv} onChange={v => ss({ radiusCurv: v })} />
                  <InlineSl label="Threshold" help="Minimum curvature, as a fraction of the strongest present. Raise it to leave flat ground bare and engrave only where the surface actually bends." min={0} max={0.9} step={0.01} value={style.thresholdCurv} onChange={v => ss({ thresholdCurv: v })} fmt={v => Math.round(v*100)+'%'} />
                </Sub>
                <ModeStyleOverride prefix="Curv" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Rock & Scree" icon={<ModeMark kind="swiss" />} open={sec.modeSwiss} onToggle={() => tog('modeSwiss')} enabled={style.enabledSwiss}>
            <Tog label="Enabled" checked={style.enabledSwiss} onChange={v => ss({ enabledSwiss: v })} />
            {style.enabledSwiss && (
              <>
                <Sub>
                  <InlineSl label="Spacing" help="Grid pitch between strokes/dots." min={0.5} max={10} step={0.5} value={style.spacingSwiss} onChange={v => ss({ spacingSwiss: v })} />
                  <InlineSl label="Cliff" help="Normalised slope above which cells get cliff hachures." min={0.1} max={0.95} step={0.05} value={style.thresholdSwiss} onChange={v => ss({ thresholdSwiss: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Stroke len" help="Cliff hachure length multiplier." min={0.2} max={3} step={0.1} value={style.lengthSwiss} onChange={v => ss({ lengthSwiss: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Scree" help="Debris-dot density on the slope band below the cliffs." min={0} max={1} step={0.05} value={style.screeSwiss} onChange={v => ss({ screeSwiss: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Scree size" min={0.5} max={8} step={0.5} value={style.screeWeightSwiss} onChange={v => ss({ screeWeightSwiss: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Seed" help="Randomness seed — the same seed always reproduces the identical stroke wobble and scree pattern." min={1} max={999} step={1} value={style.seedSwiss ?? 42} onChange={v => ss({ seedSwiss: v })} />
                </Sub>
                <ModeStyleOverride prefix="Swiss" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Bitplane" icon={<ModeMark kind="bitplane" />} open={sec.modeBitplane} onToggle={() => tog('modeBitplane')} enabled={style.enabledBitplane}>
            <Tog label="Enabled" checked={style.enabledBitplane} onChange={v => ss({ enabledBitplane: v })} />
            {style.enabledBitplane && (
              <>
                <Sub>
                  <InlineSl label="Tiers" help="How many flat plateaus the elevation range is cut into. Anchored to the terrain, so the steps stay put when Elevation Scale moves." min={2} max={40} step={1} value={style.tiersBitplane} onChange={v => ss({ tiersBitplane: v })} />
                  <Tog label="Risers" small help="Close each step with the verticals down to the plateau below — blocks rather than a flat staircase." checked={style.risersBitplane} onChange={v => ss({ risersBitplane: v })} />
                  <InlineSl label="Dither" help="Strength of the 4×4 Bayer screen shading each band into the next. 0 leaves the plateaus bare." min={0} max={1} step={0.05} value={style.ditherBitplane} onChange={v => ss({ ditherBitplane: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Dot pitch" help="Grid spacing of the dither dots." min={0.5} max={20} step={0.5} value={style.spacingBitplane} onChange={v => ss({ spacingBitplane: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Dot size" min={0.5} max={8} step={0.5} value={style.screenWeightBitplane} onChange={v => ss({ screenWeightBitplane: v })} fmt={v => v.toFixed(1)} />
                </Sub>
                <ModeStyleOverride prefix="Bitplane" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Indexed" icon={<ModeMark kind="indexed" />} open={sec.modeIndexed} onToggle={() => tog('modeIndexed')} enabled={style.enabledIndexed}>
            <Tog label="Enabled" checked={style.enabledIndexed} onChange={v => ss({ enabledIndexed: v })} />
            {style.enabledIndexed && (
              <>
                <Sub label="PALETTE">
                  <InlineSl label="Entries" help="How many inks the shared gradient is cut into. This is the palette — 16 is what a 16-colour machine had." min={2} max={16} step={1} value={style.tiersIndexed} onChange={v => ss({ tiersIndexed: v })} />
                  <InlineSl label="Slope bands" help="The second axis of the lookup. A 1D ramp cannot tell a snowfield from the cliff beside it, because both are high." min={1} max={4} step={1} value={style.slopeBandsIndexed} onChange={v => ss({ slopeBandsIndexed: v })} />
                  <InlineSl label="Steep shift" help="How far a steep cell moves along the palette against a flat one at the same height." min={0} max={1} step={0.05} value={style.steepShiftIndexed} onChange={v => ss({ steepShiftIndexed: v })} fmt={v => v.toFixed(2)} />
                </Sub>
                <Sub label="SCREEN">
                  <InlineSl label="Dither" help="Strength of the 4×4 Bayer screen between two adjacent entries. The checkerboard reads as a colour the palette does not contain — that artefact is the point." min={0} max={1} step={0.05} value={style.ditherIndexed} onChange={v => ss({ ditherIndexed: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Cell size" help="Lattice pitch of the filled cells. Smaller is finer and much heavier." min={1} max={12} step={0.5} value={style.spacingIndexed} onChange={v => ss({ spacingIndexed: v })} fmt={v => v.toFixed(1)} />
                </Sub>
                <ModeStyleOverride prefix="Indexed" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Outrun" icon={<ModeMark kind="outrun" />} open={sec.modeOutrun} onToggle={() => tog('modeOutrun')} enabled={style.enabledOutrun}>
            <Tog label="Enabled" checked={style.enabledOutrun} onChange={v => ss({ enabledOutrun: v })} />
            {style.enabledOutrun && (
              <>
                <Sub>
                  <InlineSl label="Levels" help="How many contour rings are drawn. Where they crowd, the halos sum and the ground between them lifts." min={4} max={40} step={1} value={style.levelsOutrun} onChange={v => ss({ levelsOutrun: v })} />
                  <InlineSl label="Filament" help="How far the core is pushed toward white. The hue stays in the halo." min={0} max={1} step={0.05} value={style.whitenOutrun} onChange={v => ss({ whitenOutrun: v })} fmt={v => v.toFixed(2)} />
                </Sub>
                <Sub label="GLOW">
                  <InlineSl label="Halo width" help="The halo is a second pen over the same path — a fat halo under a thin core is impossible in one layer, because a layer has one width." min={1} max={30} step={0.5} value={style.glowWeightOutrun} onChange={v => ss({ glowWeightOutrun: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Halo opacity" help="Additive: the halo can only add light, never darken what it lies over. Low values stack better." min={0} max={1} step={0.01} value={style.glowOpacityOutrun} onChange={v => ss({ glowOpacityOutrun: v })} fmt={v => Math.round(v*100)+'%'} />
                </Sub>
                <Note>Additive blending. Wants a dark background — on paper it does nothing.</Note>
                <ModeStyleOverride prefix="Outrun" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Riso" icon={<ModeMark kind="riso" />} open={sec.modeRiso} onToggle={() => tog('modeRiso')} enabled={style.enabledRiso}>
            <Tog label="Enabled" checked={style.enabledRiso} onChange={v => ss({ enabledRiso: v })} />
            {style.enabledRiso && (
              <>
                <Sub label="INKS">
                  <ColorRow label="Ink A · elevation" value={style.colorARiso} onChange={v => ss({ colorARiso: v })} />
                  <ColorRow label="Ink B · slope" value={style.colorBRiso} onChange={v => ss({ colorBRiso: v })} />
                  <ColorRow label="Ink C · light" value={style.colorCRiso} onChange={v => ss({ colorCRiso: v })} />
                </Sub>
                <Sub label="SCREENS">
                  <InlineSl label="Pitch" help="Dot spacing. Each ink is screened at its own angle — 15°, 45°, 75° — which is what keeps three of them from moiréing." min={1} max={8} step={0.25} value={style.pitchRiso} onChange={v => ss({ pitchRiso: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Registration" help="How far the plates sit out of register. Above zero is a duplicator; at zero they line up, like a press." min={0} max={6} step={0.1} value={style.offsetRiso} onChange={v => ss({ offsetRiso: v })} fmt={v => v === 0 ? 'exact' : '±' + v.toFixed(1)} />
                  <InlineSl label="Coverage cap" help="Total area coverage. Where all three inks want the same cell and the sum passes this, the weakest is dropped — which is why an overloaded press goes flat and slightly wrong-coloured in the shadows. At 3.00 it cannot bind." min={0.3} max={3} step={0.05} value={style.limitRiso} onChange={v => ss({ limitRiso: v })} fmt={v => v >= 3 ? 'off' : v.toFixed(2)} />
                  <InlineSl label="Ink A curve" min={0.4} max={5} step={0.1} value={style.gammaARiso} onChange={v => ss({ gammaARiso: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Ink B curve" min={0.4} max={5} step={0.1} value={style.gammaBRiso} onChange={v => ss({ gammaBRiso: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Ink C curve" min={0.4} max={5} step={0.1} value={style.gammaCRiso} onChange={v => ss({ gammaCRiso: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Seed" min={1} max={999} step={1} value={style.seedRiso} onChange={v => ss({ seedRiso: v })} />
                </Sub>
                <Note>Multiply blending, so it wants paper. On a dark background three light inks go to mud.</Note>
                <ModeStyleOverride prefix="Riso" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} showHypso={false} showDash={false} showColor={false} label="Dot size" />
              </>
            )}
          </Section>

          <Section title="Mode: Mineral" icon={<ModeMark kind="mineral" />} open={sec.modeMineral} onToggle={() => tog('modeMineral')} enabled={style.enabledMineral}>
            <Tog label="Enabled" checked={style.enabledMineral} onChange={v => ss({ enabledMineral: v })} />
            {style.enabledMineral && (
              <>
                <Sub label="MATERIALS">
                  <ColorRow label="Rock face" value={style.colorAMineral} onChange={v => ss({ colorAMineral: v })} />
                  <ColorRow label="Massive rock" value={style.colorBMineral} onChange={v => ss({ colorBMineral: v })} />
                  <ColorRow label="Scree" value={style.colorCMineral} onChange={v => ss({ colorCMineral: v })} />
                  <ColorRow label="Bench" value={style.colorDMineral} onChange={v => ss({ colorDMineral: v })} />
                  <ColorRow label="Summit" value={style.colorEMineral} onChange={v => ss({ colorEMineral: v })} />
                </Sub>
                <Sub label="CLASSIFIER">
                  <InlineSl label="Steep at" help="Slope above which a cell is rock rather than ground." min={0.05} max={0.95} step={0.01} value={style.steepMineral} onChange={v => ss({ steepMineral: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Broken at" help="Curvature above which rock is a face rather than massive." min={0.05} max={0.95} step={0.01} value={style.brokenMineral} onChange={v => ss({ brokenMineral: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Smoothing" help="Curvature is a second derivative, so it is taken on a blurred grid. On a raw DEM every pixel of sensor grain becomes its own rock type." min={0} max={8} step={1} value={style.radiusMineral} onChange={v => ss({ radiusMineral: v })} />
                  <InlineSl label="Grain" help="Each material carries its own tooth, so the surfaces differ in texture as well as hue." min={0} max={1} step={0.02} value={style.grainMineral} onChange={v => ss({ grainMineral: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Cell size" min={1} max={12} step={0.5} value={style.spacingMineral} onChange={v => ss({ spacingMineral: v })} fmt={v => v.toFixed(1)} />
                </Sub>
                <ModeStyleOverride prefix="Mineral" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} showHypso={false} showDash={false} label="Outline" />
              </>
            )}
          </Section>

          <Section title="Mode: Land cover" icon={<ModeMark kind="cover" />} open={sec.modeCover} onToggle={() => tog('modeCover')} enabled={style.enabledCover}>
            <Tog label="Enabled" checked={style.enabledCover} onChange={v => ss({ enabledCover: v })} />
            {style.enabledCover && !cover && (
              <Note>No cover plate loaded, so this layer draws nothing. Open one under Land Cover.</Note>
            )}
            {style.enabledCover && cover && (
              <>
                <Sub label="Ink">
                  <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
                    {[['Plate', 'plate'], ['Class', 'class']].map(([label, val]) => (
                      <Btn key={val} block variant="toggle" on={style.sourceCover === val}
                        onClick={() => ss({ sourceCover: val })}
                        style={{ fontSize: 10, padding: '2px 0', borderRadius: 2 }}>{label}</Btn>
                    ))}
                  </div>
                  <Note>
                    {style.sourceCover === 'class'
                      ? 'One flat colour per class, as a printed land-use sheet would have it.'
                      : 'Every cell takes its own colour from the imagery the classes were cut from.'}
                  </Note>
                  <InlineSl label="Grain" help="A per-cell tooth, seeded by class, so two materials that share a tone still read as two surfaces." min={0} max={1} step={0.02} value={style.grainCover} onChange={v => ss({ grainCover: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Cell size" min={1} max={12} step={0.5} value={style.spacingCover} onChange={v => ss({ spacingCover: v })} fmt={v => v.toFixed(1)} />
                </Sub>
                <ModeStyleOverride prefix="Cover" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} showHypso={false} showDash={false} label="Outline" />
              </>
            )}
          </Section>

          <Section title="Mode: Watershed" icon={<ModeMark kind="shed" />} open={sec.modeShed} onToggle={() => tog('modeShed')} enabled={style.enabledShed}>
            <Tog label="Enabled" checked={style.enabledShed} onChange={v => ss({ enabledShed: v })} />
            {style.enabledShed && (
              <>
                <Sub>
                  <InlineSl label="Inks" help="How many colours the gradient is cut into before basins are dealt from it." min={2} max={24} step={1} value={style.inksShed} onChange={v => ss({ inksShed: v })} />
                  <InlineSl label="Min basin" help="Percentage of the raster below which a catchment is folded into its largest neighbour. A thousand one-cell basins is noise, not a map." min={0} max={5} step={0.1} value={style.minBasinShed} onChange={v => ss({ minBasinShed: v })} fmt={v => v.toFixed(1) + '%'} />
                  <InlineSl label="Cell size" min={1} max={12} step={0.5} value={style.spacingShed} onChange={v => ss({ spacingShed: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Relief" min={0} max={1} step={0.05} value={style.shadeShed} onChange={v => ss({ shadeShed: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Sun azimuth" min={0} max={360} step={5} value={style.azimuthShed} onChange={v => ss({ azimuthShed: v })} fmt={v => v + '°'} />
                  <InlineSl label="Seed" help="Which ink each basin is dealt." min={1} max={999} step={1} value={style.seedShed} onChange={v => ss({ seedShed: v })} />
                </Sub>
                <Note>The divides are ridgelines, which is why they look drawn rather than imposed.</Note>
                <ModeStyleOverride prefix="Shed" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} showHypso={false} showDash={false} label="Outline" />
              </>
            )}
          </Section>

          <Section title="Mode: Flashbulb" icon={<ModeMark kind="flashbulb" />} open={sec.modeFlashbulb} onToggle={() => tog('modeFlashbulb')} enabled={style.enabledFlashbulb}>
            <Tog label="Enabled" checked={style.enabledFlashbulb} onChange={v => ss({ enabledFlashbulb: v })} />
            {style.enabledFlashbulb && (
              <>
                <Sub label="BULB">
                  <InlineSl label="Azimuth" help="Bearing of the bulb, same convention as the hillshade sun. 315° is NW." min={0} max={360} step={5} value={style.azimuthFlashbulb} onChange={v => ss({ azimuthFlashbulb: v })} fmt={v => v + '°'} />
                  <InlineSl label="Distance" help="How far out the bulb sits, as a fraction of the terrain's half-diagonal — so one setting frames a quarry and a mountain alike." min={0.1} max={3} step={0.05} value={style.distanceFlashbulb} onChange={v => ss({ distanceFlashbulb: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Height" help="Bulb height above the terrain floor, as a fraction of the elevation range. Below 1 puts it under the summits." min={0} max={4} step={0.05} value={style.heightFlashbulb} onChange={v => ss({ heightFlashbulb: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Falloff" help="r₀ in the 1/(1+(r/r₀)²) falloff, as a fraction of the half-diagonal. Small values leave only the near flank lit." min={0.1} max={3} step={0.05} value={style.falloffFlashbulb} onChange={v => ss({ falloffFlashbulb: v })} fmt={v => v.toFixed(2)} />
                </Sub>
                <Sub label="TONE">
                  <InlineSl label="Exposure" min={0.2} max={4} step={0.05} value={style.exposureFlashbulb} onChange={v => ss({ exposureFlashbulb: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Gamma" min={0.2} max={3} step={0.05} value={style.gammaFlashbulb} onChange={v => ss({ gammaFlashbulb: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Contrast" help="Slope of the S-curve about mid-tone. High values clip to bare paper and solid black, which is the flash look." min={0.2} max={5} step={0.05} value={style.contrastFlashbulb} onChange={v => ss({ contrastFlashbulb: v })} fmt={v => v.toFixed(2)} />
                  <Tog label="Solarise" small help="Sabattier: folds the tone curve, T → |2T − 1|, so the highlights reverse and a bright rim appears at mid-tone." checked={style.foldFlashbulb} onChange={v => ss({ foldFlashbulb: v })} />
                </Sub>
                <Sub label="GRAIN">
                  <InlineSl label="Density" min={0} max={1} step={0.05} value={style.grainFlashbulb} onChange={v => ss({ grainFlashbulb: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Pitch" help="Grid spacing of the grain samples. The blue-noise tile is walked per sample, so this thins the grain without patterning it." min={0.5} max={12} step={0.5} value={style.spacingFlashbulb} onChange={v => ss({ spacingFlashbulb: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Seed" help="The same seed always reproduces the identical grain." min={1} max={999} step={1} value={style.seedFlashbulb ?? 42} onChange={v => ss({ seedFlashbulb: v })} />
                </Sub>
                <Sub label="SHADOW">
                  <Tog label="Cast shadows" small help="Marches a ray from each sample toward the bulb. The expensive part of the mode — skipped wherever it cannot change the answer." checked={style.shadowFlashbulb} onChange={v => ss({ shadowFlashbulb: v })} />
                  {style.shadowFlashbulb && <InlineSl label="Steps" min={4} max={64} step={4} value={style.shadowStepsFlashbulb} onChange={v => ss({ shadowStepsFlashbulb: v })} />}
                </Sub>
                <ModeStyleOverride prefix="Flashbulb" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} label="Dot style" showDash={false} />
              </>
            )}
          </Section>

          <Section title="Mode: Halation" icon={<ModeMark kind="halation" />} open={sec.modeHalation} onToggle={() => tog('modeHalation')} enabled={style.enabledHalation}>
            <Tog label="Enabled" checked={style.enabledHalation} onChange={v => ss({ enabledHalation: v })} />
            {style.enabledHalation && (
              <>
                <Sub label="BLOOM">
                  <InlineSl label="Radius" help="How far the glow spreads from a lit edge, in world units." min={1} max={40} step={0.5} value={style.bloomHalation} onChange={v => ss({ bloomHalation: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Bleed" help="How much the glow eats into the shadow beside it. This is the halation itself — at 0 the halo sits on top of the picture instead of consuming it." min={0} max={2} step={0.05} value={style.bleedHalation} onChange={v => ss({ bleedHalation: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Glow" help="Density of the halo's own dots. They are drawn only where the bloom is strong and the ground is dark." min={0} max={2} step={0.05} value={style.glowHalation} onChange={v => ss({ glowHalation: v })} fmt={v => v.toFixed(2)} />
                </Sub>
                <Sub label="HALO INK">
                  <ColorRow label="Colour" value={style.glowColorHalation} onChange={v => ss({ glowColorHalation: v })} />
                  <InlineSl label="Dot size" min={0.5} max={14} step={0.5} value={style.glowWeightHalation} onChange={v => ss({ glowWeightHalation: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Opacity" min={0} max={1} step={0.05} value={style.glowOpacityHalation} onChange={v => ss({ glowOpacityHalation: v })} fmt={v => Math.round(v * 100) + '%'} />
                </Sub>
                <Sub label="BULB">
                  <InlineSl label="Azimuth" min={0} max={360} step={5} value={style.azimuthHalation} onChange={v => ss({ azimuthHalation: v })} fmt={v => v + '°'} />
                  <InlineSl label="Distance" min={0.1} max={3} step={0.05} value={style.distanceHalation} onChange={v => ss({ distanceHalation: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Height" min={0} max={4} step={0.05} value={style.heightHalation} onChange={v => ss({ heightHalation: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Falloff" min={0.1} max={3} step={0.05} value={style.falloffHalation} onChange={v => ss({ falloffHalation: v })} fmt={v => v.toFixed(2)} />
                </Sub>
                <Sub label="TONE">
                  <InlineSl label="Exposure" min={0.2} max={4} step={0.05} value={style.exposureHalation} onChange={v => ss({ exposureHalation: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Contrast" min={0.2} max={5} step={0.05} value={style.contrastHalation} onChange={v => ss({ contrastHalation: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Density" min={0} max={1} step={0.05} value={style.grainHalation} onChange={v => ss({ grainHalation: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Pitch" min={0.5} max={12} step={0.5} value={style.spacingHalation} onChange={v => ss({ spacingHalation: v })} fmt={v => v.toFixed(1)} />
                  <Tog label="Cast shadows" small checked={style.shadowHalation} onChange={v => ss({ shadowHalation: v })} />
                </Sub>
                <ModeStyleOverride prefix="Halation" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} label="Grain style" showDash={false} />
              </>
            )}
          </Section>

          <Section title="Mode: Fall Line" icon={<ModeMark kind="fallline" />} open={sec.modeFallLine} onToggle={() => tog('modeFallLine')} enabled={style.enabledFallLine}>
            <Tog label="Enabled" checked={style.enabledFallLine} onChange={v => ss({ enabledFallLine: v })} />
            {style.enabledFallLine && (
              <>
                <Sub>
                  <InlineSl label="Spacing" help="Seed pitch. Tracks claim the ground they cross, so this is how far apart the runs end up." min={2} max={60} step={1} value={style.spacingFallLine} onChange={v => ss({ spacingFallLine: v })} />
                </Sub>
                <Sub label="PHYSICS">
                  <InlineSl label="Carve" help="Yaw limit, backwards: 0 welds the rider to the fall line and converges on Flow mode, 1 is a big-mountain arc that rides up the far wall of a bowl." min={0} max={1} step={0.05} value={style.carveFallLine} onChange={v => ss({ carveFallLine: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Gravity" help="Normalised by the terrain's own steepness, so one setting behaves the same on a quarry and an alp." min={0.1} max={4} step={0.05} value={style.gravityFallLine} onChange={v => ss({ gravityFallLine: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Friction" min={0} max={0.6} step={0.01} value={style.dragFallLine} onChange={v => ss({ dragFallLine: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Air drag" min={0} max={0.15} step={0.005} value={style.dragQuadFallLine} onChange={v => ss({ dragQuadFallLine: v })} fmt={v => v.toFixed(3)} />
                  <InlineSl label="Max steps" min={20} max={800} step={10} value={style.maxLenFallLine} onChange={v => ss({ maxLenFallLine: v })} />
                </Sub>
                <ModeStyleOverride prefix="FallLine" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Berms" icon={<ModeMark kind="berm" />} open={sec.modeBerm} onToggle={() => tog('modeBerm')} enabled={style.enabledBerm}>
            <Tog label="Enabled" checked={style.enabledBerm} onChange={v => ss({ enabledBerm: v })} />
            {style.enabledBerm && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={2} max={60} step={1} value={style.spacingBerm} onChange={v => ss({ spacingBerm: v })} />
                  <InlineSl label="Tick length" help="Ticks scale with the lateral load the rider is holding, so the straights draw nothing." min={0.2} max={10} step={0.1} value={style.lengthBerm} onChange={v => ss({ lengthBerm: v })} fmt={v => v.toFixed(1)} />
                </Sub>
                <Sub label="PHYSICS">
                  <InlineSl label="Carve" help="Yaw limit, backwards: 0 welds the rider to the fall line and converges on Flow mode, 1 is a big-mountain arc that rides up the far wall of a bowl." min={0} max={1} step={0.05} value={style.carveBerm} onChange={v => ss({ carveBerm: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Gravity" help="Normalised by the terrain's own steepness, so one setting behaves the same on a quarry and an alp." min={0.1} max={4} step={0.05} value={style.gravityBerm} onChange={v => ss({ gravityBerm: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Friction" min={0} max={0.6} step={0.01} value={style.dragBerm} onChange={v => ss({ dragBerm: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Air drag" min={0} max={0.15} step={0.005} value={style.dragQuadBerm} onChange={v => ss({ dragQuadBerm: v })} fmt={v => v.toFixed(3)} />
                  <InlineSl label="Max steps" min={20} max={800} step={10} value={style.maxLenBerm} onChange={v => ss({ maxLenBerm: v })} />
                </Sub>
                <ModeStyleOverride prefix="Berm" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Air" icon={<ModeMark kind="air" />} open={sec.modeAir} onToggle={() => tog('modeAir')} enabled={style.enabledAir}>
            <Tog label="Enabled" checked={style.enabledAir} onChange={v => ss({ enabledAir: v })} />
            {style.enabledAir && (
              <>
                <Sub>
                  <InlineSl label="Spacing" min={2} max={60} step={1} value={style.spacingAir} onChange={v => ss({ spacingAir: v })} />
                  <InlineSl label="Run-in" help="How many steps of approach to draw leading into each flight, so a launch can be read back to where it started." min={0} max={60} step={1} value={style.runInAir} onChange={v => ss({ runInAir: v })} />
                  <InlineSl label="Run-in weight" min={0.5} max={6} step={0.5} value={style.runInWeightAir} onChange={v => ss({ runInWeightAir: v })} fmt={v => v.toFixed(1)} />
                </Sub>
                <Sub label="PHYSICS">
                  <InlineSl label="Carve" help="Yaw limit, backwards: 0 welds the rider to the fall line and converges on Flow mode, 1 is a big-mountain arc that rides up the far wall of a bowl." min={0} max={1} step={0.05} value={style.carveAir} onChange={v => ss({ carveAir: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Gravity" help="Normalised by the terrain's own steepness, so one setting behaves the same on a quarry and an alp." min={0.1} max={4} step={0.05} value={style.gravityAir} onChange={v => ss({ gravityAir: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Friction" min={0} max={0.6} step={0.01} value={style.dragAir} onChange={v => ss({ dragAir: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Air drag" min={0} max={0.15} step={0.005} value={style.dragQuadAir} onChange={v => ss({ dragQuadAir: v })} fmt={v => v.toFixed(3)} />
                  <InlineSl label="Max steps" min={20} max={800} step={10} value={style.maxLenAir} onChange={v => ss({ maxLenAir: v })} />
                </Sub>
                <ModeStyleOverride prefix="Air" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Race Line" icon={<ModeMark kind="raceline" />} open={sec.modeRaceLine} onToggle={() => tog('modeRaceLine')} enabled={style.enabledRaceLine}>
            <Tog label="Enabled" checked={style.enabledRaceLine} onChange={v => ss({ enabledRaceLine: v })} />
            {style.enabledRaceLine && (
              <>
                <Sub>
                  <InlineSl label="Drop-ins" help="How many summits get a braid. Each one blanks a radius of Spacing around itself so the braids do not all start on one summit, so a high count needs a low Spacing to have anywhere to put them — ask for more than the terrain has room for and you get what fits." min={1} max={250} step={1} value={style.dropsRaceLine} onChange={v => ss({ dropsRaceLine: v })} />
                  <InlineSl label="Spacing" help="How far apart the drop-ins must be." min={5} max={150} step={5} value={style.spacingRaceLine} onChange={v => ss({ spacingRaceLine: v })} />
                  <InlineSl label="Lines" help="Runs per drop-in." min={2} max={41} step={1} value={style.fanRaceLine} onChange={v => ss({ fanRaceLine: v })} />
                  <InlineSl label="Fan" help="Total spread of the initial headings." min={10} max={350} step={5} value={style.spreadRaceLine} onChange={v => ss({ spreadRaceLine: v })} fmt={v => v + '°'} />
                  <InlineSl label="Entry speed" min={0} max={4} step={0.05} value={style.dropSpeedRaceLine} onChange={v => ss({ dropSpeedRaceLine: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Best weight" help="The run reaching lowest ground soonest, inked heavier in its own layer." min={0.5} max={10} step={0.5} value={style.bestWeightRaceLine} onChange={v => ss({ bestWeightRaceLine: v })} fmt={v => v.toFixed(1)} />
                </Sub>
                <Sub label="PHYSICS">
                  <InlineSl label="Carve" help="Yaw limit, backwards: 0 welds the rider to the fall line and converges on Flow mode, 1 is a big-mountain arc that rides up the far wall of a bowl." min={0} max={1} step={0.05} value={style.carveRaceLine} onChange={v => ss({ carveRaceLine: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Gravity" help="Normalised by the terrain's own steepness, so one setting behaves the same on a quarry and an alp." min={0.1} max={4} step={0.05} value={style.gravityRaceLine} onChange={v => ss({ gravityRaceLine: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Friction" min={0} max={0.6} step={0.01} value={style.dragRaceLine} onChange={v => ss({ dragRaceLine: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Air drag" min={0} max={0.15} step={0.005} value={style.dragQuadRaceLine} onChange={v => ss({ dragQuadRaceLine: v })} fmt={v => v.toFixed(3)} />
                  <InlineSl label="Max steps" min={20} max={800} step={10} value={style.maxLenRaceLine} onChange={v => ss({ maxLenRaceLine: v })} />
                </Sub>
                <ModeStyleOverride prefix="RaceLine" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          {/* ── Shadow line ──────────────────────────────────────────────
              Where the sunlight stops, at one instant. One call to the same
              shadow sweep Sun Hours sums over a year, traced at the single level
              where lit meets unlit. See utils/sunHours.js. */}
          <Section title="Mode: Shadow Line" icon={<ModeMark kind="shadowline" />} open={sec.modeShadowLine} onToggle={() => tog('modeShadowLine')} enabled={style.enabledShadowLine}>
            <Tog label="Enabled" testId="mode-shadowline" checked={style.enabledShadowLine} onChange={v => ss({ enabledShadowLine: v })} />
            {style.enabledShadowLine && (
              <>
                <Sub>
                  <DateRow label="Date" testId="shadowline-date"
                    help="A stored date, so a preset draws the same plate tomorrow. Midwinter by default, when the shadow is longest and the line has the most to say."
                    value={style.dateShadowLine} onChange={v => ss({ dateShadowLine: v })} />
                  <InlineSl label="Time" testId="shadowline-hour"
                    help="Local standard time at the zone below. No summer clock: an hour of daylight saving is a political fact about a country, not an astronomical one about the sky."
                    min={0} max={24} step={0.25} value={style.hourShadowLine ?? 12}
                    onChange={v => ss({ hourShadowLine: v })} fmt={formatClock} />
                  <InlineSl label="Zone" testId="shadowline-zone"
                    help="Hours ahead of UTC. This mode needs a clock where Sun Hours does not: a shadow edge is a fact about one moment, and the zone decides which moment a time names."
                    min={-12} max={14} step={0.5} value={style.zoneShadowLine ?? 0}
                    onChange={v => ss({ zoneShadowLine: v })}
                    fmt={v => `UTC${v >= 0 ? '+' : '−'}${Math.abs(v) % 1 ? Math.abs(v).toFixed(1) : Math.abs(v)}`} />
                  {!sunHoursGeoreferenced && (<>
                    <InlineSl label="Latitude" testId="shadowline-lat" min={-89} max={89} step={0.01}
                      value={style.latShadowLine ?? 0} onChange={v => ss({ latShadowLine: v })}
                      fmt={v => `${Math.abs(v).toFixed(2)}° ${v < 0 ? 'S' : 'N'}`} />
                    <InlineSl label="Longitude" testId="shadowline-lon" min={-180} max={180} step={0.01}
                      value={style.lonShadowLine ?? 0} onChange={v => ss({ lonShadowLine: v })}
                      fmt={v => `${Math.abs(v).toFixed(2)}° ${v < 0 ? 'W' : 'E'}`} />
                  </>)}
                  <InlineSl label="Detail" help="How much the lit/unlit field is smoothed before it is traced. A shadow edge is hard by nature — a ridge either blocks the sun or it does not — so at 0 the line follows every notch in the skyline." min={0} max={12} step={0.5} value={style.radiusShadowLine ?? 1} onChange={v => ss({ radiusShadowLine: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Smoothing" help="Chaikin passes over the finished line, rounding the staircase left by tracing a level set across grid cells." min={0} max={25} step={1} value={style.smoothingShadowLine ?? 2} onChange={v => ss({ smoothingShadowLine: Math.round(v) })} />
                  {shadowLineSun && (
                    <div data-testid="shadowline-note" style={{ fontSize:10, color: MUTED, lineHeight:1.7 }}>
                      <div style={{ color: shadowLineSun.altitude > 0 ? DIM : WARN }}>
                        {shadowLineSun.altitude > 0
                          ? `${Math.round(shadowLineSun.azimuth)}° · ${Math.round(shadowLineSun.altitude)}° above`
                          : 'Below the horizon — there is no shadow edge at night'}
                      </div>
                      <div>
                        {shadowLineSun.times?.polar === 'day' ? 'sun never sets'
                          : shadowLineSun.times?.polar === 'night' ? 'sun never rises'
                          : `rise ${formatClock(shadowLineSun.times?.rise)} · set ${formatClock(shadowLineSun.times?.set)}`}
                      </div>
                      <div>{sunHoursGeoreferenced ? 'from the raster' : 'no georeference — the position is the one above'}</div>
                    </div>
                  )}
                </Sub>
                <ModeStyleOverride prefix="ShadowLine" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          {/* ── Sun hours ────────────────────────────────────────────────
              The one field in the app that measures the ground rather than the
              picture. See utils/sunHours.js. */}
          <Section title="Mode: Sun Hours" icon={<ModeMark kind="sunhours" />} open={sec.modeSunHours} onToggle={() => tog('modeSunHours')} enabled={style.enabledSunHours}>
            <Tog label="Enabled" testId="mode-sunhours" checked={style.enabledSunHours} onChange={v => ss({ enabledSunHours: v })} />
            {style.enabledSunHours && (
              <>
                <Sub>
                  <SegRow label="Period" testIdPrefix="sunhours-period"
                    help="A whole year, or one date. A year is the figure a hut or a panel array is sited by; a single date is the one a ski line or a winter photograph is planned around, and midwinter is where the difference between two aspects is starkest."
                    options={[['Year', 'year'], ['A date', 'day']]}
                    value={style.periodSunHours ?? 'year'} onChange={v => ss({ periodSunHours: v })} />
                  {(style.periodSunHours ?? 'year') === 'day' ? (
                    <DateRow label="Date" testId="sunhours-date"
                      help="A stored date, so a preset draws the same plate tomorrow. The clock never enters into it: counting hours needs the latitude and the date and nothing else — the time zone shifts when the sun is somewhere, not how long it is up."
                      value={style.dateSunHours} onChange={v => ss({ dateSunHours: v })} />
                  ) : (
                    <InlineSl label="Days" testId="sunhours-days"
                      help="How many days across the year to sample. Each stands for a twelfth or so of the year. More is slower and barely different: the declination is a sine wave and eight evenly spaced days already trace it."
                      min={4} max={24} step={1} value={style.daysSunHours ?? 8}
                      onChange={v => ss({ daysSunHours: Math.round(v) })} />
                  )}
                  <InlineSl label="Per day" testId="sunhours-perday"
                    help="Sun positions between sunrise and sunset. This is the resolution of the answer: at 12, each sample stands for about an hour of a summer day, so a shadow that comes and goes faster than that is missed."
                    min={4} max={48} step={1} value={style.perDaySunHours ?? 12}
                    onChange={v => ss({ perDaySunHours: Math.round(v) })} />
                  <InlineSl label="Lines" testId="sunhours-levels"
                    help="Roughly how many isolines, not an interval. The range of the field is not knowable in advance — thousands of hours over a year, a handful over one winter day — so the builder fits a round step inside whatever it turned out to be. There is always one extra line just above zero: it traces the ground that never sees the sun at all."
                    min={1} max={24} step={1} value={style.levelsSunHours ?? 6}
                    onChange={v => ss({ levelsSunHours: Math.round(v) })} />
                  {!sunHoursGeoreferenced && (
                    <InlineSl label="Latitude" testId="sunhours-lat"
                      help="A plain PNG carries no location, so the mode needs one. A GeoTIFF answers it from its own bounding box and this control disappears."
                      min={-66} max={66} step={0.1} value={style.latSunHours ?? 47.53}
                      onChange={v => ss({ latSunHours: v })}
                      fmt={v => `${Math.abs(v).toFixed(1)}° ${v < 0 ? 'S' : 'N'}`} />
                  )}
                  <InlineSl label="Detail" help="How much the field is smoothed before it is traced. A shadow edge is hard by nature — a ridge either blocks the sun or it does not — so at 0 the lines follow every notch in the skyline. This is the control that makes a line broad." min={0} max={12} step={0.5} value={style.radiusSunHours ?? 1} onChange={v => ss({ radiusSunHours: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Smoothing" help="Chaikin passes over each finished line, rounding the staircase left by tracing a level set across grid cells. Most of the effect lands in the first two." min={0} max={25} step={1} value={style.smoothingSunHours ?? 1} onChange={v => ss({ smoothingSunHours: Math.round(v) })} />
                  {/* What this mode is honest about, said where it is set.
                      Two things a user has to know and could not guess: the
                      shadows are the shadows of the terrain *as exaggerated*,
                      and the sun here is a true bearing while every other sun in
                      this panel is a quarter turn off one. */}
                  <div data-testid="sunhours-note" style={{ fontSize:10, color: MUTED, lineHeight:1.7 }}>
                    {/* What this is about to cost, before it costs it. The two
                        sampling sliders multiply, and the top of both ranges is
                        a thousand shadow sweeps over the whole grid — long
                        enough on a large raster to read as a hang rather than
                        as work. The count is the honest way to say so. */}
                    <div style={{ color: sunHoursSeconds > 2 ? WARN : MUTED }}>
                      {`${sunHoursSweeps.toLocaleString()} sun positions`}
                      {sunHoursSeconds >= 0.1
                        ? ` · about ${sunHoursSeconds < 1 ? sunHoursSeconds.toFixed(1) : Math.round(sunHoursSeconds)}s a rebuild`
                        : ''}
                    </div>
                    <div>{sunHoursGeoreferenced
                      ? 'Latitude from the raster · true north from its rows'
                      : 'No georeference — the latitude is the one above'}</div>
                    <div>Shadows follow the terrain as exaggerated, not as surveyed</div>
                    <div style={{ color: (terrain.elevScale ?? 0) !== 0 ? WARN : MUTED }}>
                      {(terrain.elevScale ?? 0) !== 0
                        ? `Exaggeration is ${terrain.elevScale > 0 ? '+' : ''}${terrain.elevScale.toFixed(1)} — set it to 0 for true hours`
                        : 'Exaggeration is 0 — the hours are the ground’s own'}
                    </div>
                  </div>
                </Sub>
                <ModeStyleOverride prefix="SunHours" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Crossings" icon={<ModeMark kind="zerocross" />} open={sec.modeZeroCross} onToggle={() => tog('modeZeroCross')} enabled={style.enabledZeroCross}>
            <Tog label="Enabled" checked={style.enabledZeroCross} onChange={v => ss({ enabledZeroCross: v })} />
            {style.enabledZeroCross && (
              <>
                <Sub>
                  <InlineSl label="Detrend" help="Blur radius subtracted first. Without it a scanline crosses its own mean twice on a whole mountain and the mode draws two dots." min={1} max={40} step={1} value={style.detrendZeroCross} onChange={v => ss({ detrendZeroCross: v })} />
                  <InlineSl label="Line pitch" min={0.5} max={30} step={0.5} value={style.spacingZeroCross} onChange={v => ss({ spacingZeroCross: v })} fmt={v => v.toFixed(1)} />
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {['rows', 'both'].map(m => (
                      <Btn key={m} block variant="toggle" on={style.axesZeroCross === m}
                        onClick={() => ss({ axesZeroCross: m })}
                        style={{ fontSize:10.5, padding:'3px 0', borderRadius:4, textTransform:'capitalize' }}>{m}</Btn>
                    ))}
                  </div>
                </Sub>
                <ModeStyleOverride prefix="ZeroCross" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} label="Dot style" showDash={false} />
              </>
            )}
          </Section>

          <Section title="Mode: Sprite Blocks" icon={<ModeMark kind="sprite" />} open={sec.modeSprite} onToggle={() => tog('modeSprite')} enabled={style.enabledSprite}>
            <Tog label="Enabled" checked={style.enabledSprite} onChange={v => ss({ enabledSprite: v })} />
            {style.enabledSprite && (
              <>
                <Sub>
                  <InlineSl label="Tiers" min={2} max={40} step={1} value={style.tiersSprite} onChange={v => ss({ tiersSprite: v })} />
                  <InlineSl label="Block pitch" min={1} max={40} step={1} value={style.spacingSprite} onChange={v => ss({ spacingSprite: v })} />
                  <InlineSl label="Block size" help="Fraction of the pitch each block fills. Below 1 leaves mortar between them." min={0.1} max={1} step={0.05} value={style.sizeSprite} onChange={v => ss({ sizeSprite: v })} fmt={v => v.toFixed(2)} />
                  <Tog label="Top faces" small help="Fills each block's top so the stack self-occludes instead of reading as a wireframe." checked={style.facesSprite} onChange={v => ss({ facesSprite: v })} />
                  {style.facesSprite && <ColorRow label="Face fill" value={style.faceColorSprite} onChange={v => ss({ faceColorSprite: v })} />}
                </Sub>
                <ModeStyleOverride prefix="Sprite" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Reticulation" icon={<ModeMark kind="retic" />} open={sec.modeRetic} onToggle={() => tog('modeRetic')} enabled={style.enabledRetic}>
            <Tog label="Enabled" checked={style.enabledRetic} onChange={v => ss({ enabledRetic: v })} />
            {style.enabledRetic && (
              <>
                <Sub>
                  <InlineSl label="Cell size" help="Spacing of the feature points. The crazing is the boundary between their cells, not the cells themselves." min={2} max={80} step={1} value={style.cellRetic} onChange={v => ss({ cellRetic: v })} />
                  <InlineSl label="Crack width" min={0.05} max={2} step={0.05} value={style.widthRetic} onChange={v => ss({ widthRetic: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Dot pitch" min={0.5} max={12} step={0.5} value={style.spacingRetic} onChange={v => ss({ spacingRetic: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Gamma" min={0.2} max={3} step={0.05} value={style.gammaRetic} onChange={v => ss({ gammaRetic: v })} fmt={v => v.toFixed(2)} />
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['invElev','LOW'],['elevation','HIGH'],['slope','STEEP'],['invSlope','FLAT']].map(([m, lbl]) => (
                      <Btn key={m} block variant="toggle" on={style.densityModeRetic === m}
                        onClick={() => ss({ densityModeRetic: m })}
                        style={{ fontSize:9, padding:'3px 0', borderRadius:2 }}>{lbl}</Btn>
                    ))}
                  </div>
                  <InlineSl label="Seed" min={1} max={999} step={1} value={style.seedRetic} onChange={v => ss({ seedRetic: v })} />
                </Sub>
                <ModeStyleOverride prefix="Retic" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} label="Dot style" showDash={false} />
              </>
            )}
          </Section>

          <Section title="Mode: Single Line" icon={<ModeMark kind="tsp" />} open={sec.modeTsp} onToggle={() => tog('modeTsp')} enabled={style.enabledTsp}>
            <Tog label="Enabled" testId="mode-tsp" checked={style.enabledTsp} onChange={v => ss({ enabledTsp: v })} />
            {style.enabledTsp && (
              <>
                <Sub>
                  <InlineSl label="Points" help="Dots the line must visit. The tour gets two seconds, so very high counts can keep a few crossings." min={100} max={8000} step={100} value={style.countTsp} onChange={v => ss({ countTsp: Math.round(v) })} />
                  <InlineSl label="Gamma" help="Above 1, the dots crowd into the densest part of the field and the line coils tighter there." min={0.3} max={4} step={0.05} value={style.gammaTsp} onChange={v => ss({ gammaTsp: v })} fmt={v => v.toFixed(2)} />
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['slope','STEEP'],['shade','SHADE'],['invElev','LOW'],['elevation','HIGH']].map(([m, lbl]) => (
                      <Btn key={m} block variant="toggle" on={style.densityModeTsp === m}
                        onClick={() => ss({ densityModeTsp: m })}
                        style={{ fontSize:9, padding:'3px 0', borderRadius:2 }}>{lbl}</Btn>
                    ))}
                  </div>
                  {style.densityModeTsp === 'shade' && (
                    <InlineSl label="Sun" help="Compass bearing of the light that sets the tone." min={0} max={360} step={1} value={style.azimuthTsp} onChange={v => ss({ azimuthTsp: v })} fmt={v => `${Math.round(v)}°`} />
                  )}
                  <Tog label="Closed loop" checked={!!style.closedTsp} onChange={v => ss({ closedTsp: v })} />
                  <InlineSl label="Seed" min={1} max={999} step={1} value={style.seedTsp} onChange={v => ss({ seedTsp: v })} />
                </Sub>
                <ModeStyleOverride prefix="Tsp" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Shadow Hatch" icon={<ModeMark kind="shadowhatch" />} open={sec.modeShadowHatch} onToggle={() => tog('modeShadowHatch')} enabled={style.enabledShadowHatch}>
            <Tog label="Enabled" testId="mode-shadowhatch" checked={style.enabledShadowHatch} onChange={v => ss({ enabledShadowHatch: v })} />
            {style.enabledShadowHatch && (
              <>
                <Sub>
                  <InlineSl label="Sun bearing" min={0} max={360} step={1} value={style.azimuthShadowHatch} onChange={v => ss({ azimuthShadowHatch: v })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Sun height" help="Degrees above the horizon. A low sun throws long shadows across the valleys. At 0 or below nothing is drawn." min={-5} max={85} step={0.5} value={style.altitudeShadowHatch} onChange={v => ss({ altitudeShadowHatch: v })} fmt={v => `${v.toFixed(1)}°`} />
                  <InlineSl label="Spacing" min={0.5} max={30} step={0.5} value={style.spacingShadowHatch} onChange={v => ss({ spacingShadowHatch: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Angle" min={0} max={180} step={1} value={style.angleShadowHatch} onChange={v => ss({ angleShadowHatch: v })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Detail" help="How much the shadow mask is smoothed. At 0 the hatching stops at every notch in the skyline." min={0} max={12} step={0.5} value={style.radiusShadowHatch} onChange={v => ss({ radiusShadowHatch: v })} fmt={v => v.toFixed(1)} />
                  <Tog label="Cross-hatch" checked={!!style.crossShadowHatch} onChange={v => ss({ crossShadowHatch: v })} />
                  <Tog label="Outline" checked={!!style.outlineShadowHatch} onChange={v => ss({ outlineShadowHatch: v })} />
                </Sub>
                <ModeStyleOverride prefix="ShadowHatch" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Isochrones" icon={<ModeMark kind="isochrone" />} open={sec.modeIsochrone} onToggle={() => tog('modeIsochrone')} enabled={style.enabledIsochrone}>
            <Tog label="Enabled" testId="mode-isochrone" checked={style.enabledIsochrone} onChange={v => ss({ enabledIsochrone: v })} />
            {style.enabledIsochrone && (
              <>
                <Sub>
                  <Btn block variant="toggle" on={pick === 'Isochrone'} data-testid="isochrone-pick"
                    onClick={() => onPick?.(pick === 'Isochrone' ? null : 'Isochrone')} style={{ marginBottom:8 }}>
                    {pick === 'Isochrone' ? 'Click the start on the terrain…' : 'Pick start on terrain'}
                  </Btn>
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['out','FROM HERE'],['back','BACK HERE']].map(([m, lbl]) => (
                      <Btn key={m} block variant="toggle" on={style.directionIsochrone === m}
                        onClick={() => ss({ directionIsochrone: m })}
                        style={{ fontSize:9, padding:'3px 0', borderRadius:2 }}>{lbl}</Btn>
                    ))}
                  </div>
                  <InlineSl label="Every" help="Minutes between the rings." min={1} max={120} step={1} value={style.intervalIsochrone} onChange={v => ss({ intervalIsochrone: Math.round(v) })} fmt={v => `${Math.round(v)} min`} />
                  <InlineSl label="Up to" help="The longest walk drawn." min={0.25} max={24} step={0.25} value={style.limitIsochrone} onChange={v => ss({ limitIsochrone: v })} fmt={v => `${v} h`} />
                  <InlineSl label="Too steep" help="Ground steeper than this cannot be walked, so the rings go around it. Tobler's function already slows a walker a lot above 25°." min={10} max={80} step={1} value={style.steepIsochrone} onChange={v => ss({ steepIsochrone: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  {/* Asked only for what the file cannot say. A georeferenced
                      raster knows its pixel size, and a GeoTIFF its heights. */}
                  {!geoTiffBbox && (
                    <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale." min={0.5} max={200} step={0.5} value={style.cellMetresIsochrone} onChange={v => ss({ cellMetresIsochrone: v })} fmt={v => `${v} m`} />
                  )}
                  {!hasGeoTiff && (
                    <InlineSl label="Relief" help="Metres from black to white in the heightmap. This file carries no heights of its own." min={10} max={9000} step={10} value={style.reliefIsochrone} onChange={v => ss({ reliefIsochrone: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  )}
                  <InlineSl label="Detail" help="Blur on the time field before it is traced. At 0 the rings show the grid's steps." min={0} max={12} step={0.5} value={style.radiusIsochrone} onChange={v => ss({ radiusIsochrone: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Smoothing" min={0} max={25} step={1} value={style.smoothingIsochrone} onChange={v => ss({ smoothingIsochrone: Math.round(v) })} />
                  <Tog label="Mark the start" checked={!!style.markerIsochrone} onChange={v => ss({ markerIsochrone: v })} />
                </Sub>
                <ModeStyleOverride prefix="Isochrone" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Truchet" icon={<ModeMark kind="truchet" />} open={sec.modeTruchet} onToggle={() => tog('modeTruchet')} enabled={style.enabledTruchet}>
            <Tog label="Enabled" testId="mode-truchet" checked={style.enabledTruchet} onChange={v => ss({ enabledTruchet: v })} />
            {style.enabledTruchet && (
              <>
                <Sub>
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['fall','DOWNHILL'],['contour','ACROSS'],['random','RANDOM']].map(([m, lbl]) => (
                      <Btn key={m} block variant="toggle" on={style.alignTruchet === m}
                        onClick={() => ss({ alignTruchet: m })}
                        style={{ fontSize:9, padding:'3px 0', borderRadius:2 }}>{lbl}</Btn>
                    ))}
                  </div>
                  <InlineSl label="Tile" help="Tile size. Each tile holds two quarter circles, and the tiles link into chains." min={2} max={60} step={0.5} value={style.spacingTruchet} onChange={v => ss({ spacingTruchet: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Flat below" help="Tiles on ground flatter than this stay blank, so the landform shows as the shape of what is drawn. At 0 every tile is drawn." min={0} max={1} step={0.01} value={style.thresholdTruchet} onChange={v => ss({ thresholdTruchet: v })} fmt={v => v.toFixed(2)} />
                  {style.alignTruchet === 'random' && (
                    <InlineSl label="Seed" min={1} max={999} step={1} value={style.seedTruchet} onChange={v => ss({ seedTruchet: v })} />
                  )}
                </Sub>
                <ModeStyleOverride prefix="Truchet" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Viewshed" icon={<ModeMark kind="viewshed" />} open={sec.modeViewshed} onToggle={() => tog('modeViewshed')} enabled={style.enabledViewshed}>
            <Tog label="Enabled" testId="mode-viewshed" checked={style.enabledViewshed} onChange={v => ss({ enabledViewshed: v })} />
            {style.enabledViewshed && (
              <>
                <Sub>
                  <Btn block variant="toggle" on={pick === 'Viewshed'} data-testid="viewshed-pick"
                    onClick={() => onPick?.(pick === 'Viewshed' ? null : 'Viewshed')} style={{ marginBottom:8 }}>
                    {pick === 'Viewshed' ? 'Click where you stand…' : 'Pick eye on terrain'}
                  </Btn>
                  {viewshedNote && (
                    <div data-testid="viewshed-readout" style={{ fontSize:10.5, color: DIM, marginBottom:8 }}>
                      {`${Math.round(viewshedNote.visible * 100)}% of the ground is in view`}
                    </div>
                  )}
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['visible','HATCH SEEN'],['hidden','HATCH HIDDEN']].map(([m, lbl]) => (
                      <Btn key={m} block variant="toggle" on={style.sideViewshed === m}
                        onClick={() => ss({ sideViewshed: m })}
                        style={{ fontSize:9, padding:'3px 0', borderRadius:2 }}>{lbl}</Btn>
                    ))}
                  </div>
                  <InlineSl label="Eye height" help="Metres above the ground. A person is about 1.7 m, a tower 20 m or more. On a rounded summit a low eye sees little: the shoulder of the hill hides the slopes below it, as it does on a real one." min={0} max={200} step={0.5} value={style.eyeViewshed} onChange={v => ss({ eyeViewshed: v })} fmt={v => `${v} m`} />
                  <InlineSl label="Spacing" min={0.5} max={30} step={0.5} value={style.spacingViewshed} onChange={v => ss({ spacingViewshed: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Angle" min={0} max={180} step={1} value={style.angleViewshed} onChange={v => ss({ angleViewshed: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Detail" help="Blur on the edge of the view before it is hatched and traced. At 0 the edge follows the grid." min={0} max={12} step={0.5} value={style.radiusViewshed} onChange={v => ss({ radiusViewshed: v })} fmt={v => v.toFixed(1)} />
                  {!geoTiffBbox && (
                    <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale." min={0.5} max={200} step={0.5} value={style.cellMetresViewshed} onChange={v => ss({ cellMetresViewshed: v })} fmt={v => `${v} m`} />
                  )}
                  {!hasGeoTiff && (
                    <InlineSl label="Relief" help="Metres from black to white in the heightmap. This file carries no heights of its own." min={10} max={9000} step={10} value={style.reliefViewshed} onChange={v => ss({ reliefViewshed: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  )}
                  <Tog label="Cross-hatch" checked={!!style.crossViewshed} onChange={v => ss({ crossViewshed: v })} />
                  <Tog label="Outline" checked={!!style.outlineViewshed} onChange={v => ss({ outlineViewshed: v })} />
                  <Tog label="Mark the eye" checked={!!style.markerViewshed} onChange={v => ss({ markerViewshed: v })} />
                </Sub>
                <ModeStyleOverride prefix="Viewshed" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Route" icon={<ModeMark kind="route" />} open={sec.modeRoute} onToggle={() => tog('modeRoute')} enabled={style.enabledRoute}>
            <Tog label="Enabled" testId="mode-route" checked={style.enabledRoute} onChange={v => ss({ enabledRoute: v })} />
            {style.enabledRoute && (
              <>
                <Sub>
                  <Btn block variant="toggle" on={pick === 'RouteA' || pick === 'RouteB'} data-testid="route-pick"
                    onClick={() => onPick?.(pick === 'RouteA' || pick === 'RouteB' ? null : 'RouteA')} style={{ marginBottom:8 }}>
                    {pick === 'RouteA' ? 'Click the start…' : pick === 'RouteB' ? 'Click the end…' : 'Pick start and end'}
                  </Btn>
                  <div data-testid="route-readout" style={{ fontSize:10.5, color: DIM, marginBottom:8, fontVariantNumeric:'tabular-nums' }}>
                    {!routeNote ? 'No walkable route between the two points.'
                      : `${formatWalk(routeNote.seconds)} · ${(routeNote.metres / 1000).toFixed(1)} km · ↑ ${Math.round(routeNote.climb)} m`}
                  </div>
                  <InlineSl label="Too steep" help="Ground steeper than this cannot be walked, so the route goes around it." min={10} max={80} step={1} value={style.steepRoute} onChange={v => ss({ steepRoute: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Smoothing" help="Chaikin passes over the grid path, which otherwise turns only in fixed directions." min={0} max={8} step={1} value={style.smoothingRoute} onChange={v => ss({ smoothingRoute: Math.round(v) })} />
                  {!geoTiffBbox && (
                    <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale." min={0.5} max={200} step={0.5} value={style.cellMetresRoute} onChange={v => ss({ cellMetresRoute: v })} fmt={v => `${v} m`} />
                  )}
                  {!hasGeoTiff && (
                    <InlineSl label="Relief" help="Metres from black to white in the heightmap. This file carries no heights of its own." min={10} max={9000} step={10} value={style.reliefRoute} onChange={v => ss({ reliefRoute: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  )}
                  <Tog label="Mark the ends" checked={!!style.markerRoute} onChange={v => ss({ markerRoute: v })} />
                </Sub>
                <ModeStyleOverride prefix="Route" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Panorama" icon={<ModeMark kind="panorama" />} open={sec.modePanorama} onToggle={() => tog('modePanorama')} enabled={style.enabledPanorama}>
            <Tog label="Enabled" testId="mode-panorama" checked={style.enabledPanorama} onChange={v => ss({ enabledPanorama: v })} />
            {style.enabledPanorama && (
              <>
                <Sub>
                  <Btn block variant="toggle" on={pick === 'Panorama'} data-testid="panorama-pick"
                    onClick={() => onPick?.(pick === 'Panorama' ? null : 'Panorama')} style={{ marginBottom:8 }}>
                    {pick === 'Panorama' ? 'Click where you stand…' : 'Pick eye on terrain'}
                  </Btn>
                  <Note>Each line is a ridge that hides the ground behind it, seen from the eye. Put the camera low behind the eye and the ridges stack as on a summit board.</Note>
                  <InlineSl label="Eye height" help="Metres above the ground. A person is about 1.7 m, a tower 20 m or more." min={0} max={200} step={0.5} value={style.eyePanorama} onChange={v => ss({ eyePanorama: v })} fmt={v => `${v} m`} />
                  <InlineSl label="Min. depth" help="A ridge draws only if the ground it hides runs on for at least this far. Raise it to keep the big ridges and drop the small bumps." min={0} max={2000} step={10} value={style.depthPanorama} onChange={v => ss({ depthPanorama: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  {!geoTiffBbox && (
                    <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale." min={0.5} max={200} step={0.5} value={style.cellMetresPanorama} onChange={v => ss({ cellMetresPanorama: v })} fmt={v => `${v} m`} />
                  )}
                  {!hasGeoTiff && (
                    <InlineSl label="Relief" help="Metres from black to white in the heightmap. This file carries no heights of its own." min={10} max={9000} step={10} value={style.reliefPanorama} onChange={v => ss({ reliefPanorama: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  )}
                  <Tog label="Skyline" help="The farthest ground seen in each direction, as a second, heavier pen." checked={!!style.skylinePanorama} onChange={v => ss({ skylinePanorama: v })} />
                  {style.skylinePanorama && (
                    <InlineSl label="Skyline weight" min={0.5} max={6} step={0.1} value={style.skylineWeightPanorama} onChange={v => ss({ skylineWeightPanorama: v })} fmt={v => v.toFixed(1)} />
                  )}
                  <Tog label="Mark the eye" checked={!!style.markerPanorama} onChange={v => ss({ markerPanorama: v })} />
                </Sub>
                <ModeStyleOverride prefix="Panorama" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Bedding" icon={<ModeMark kind="bedding" />} open={sec.modeBedding} onToggle={() => tog('modeBedding')} enabled={style.enabledBedding}>
            <Tog label="Enabled" testId="mode-bedding" checked={style.enabledBedding} onChange={v => ss({ enabledBedding: v })} />
            {style.enabledBedding && (
              <>
                <Sub>
                  <InlineSl label="Dip" help="How steep the layers are. At 0 they are level and the lines are contours. Where a layer crosses a valley, its line bends into a V." min={0} max={85} step={1} value={style.dipBedding} onChange={v => ss({ dipBedding: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Dip towards" help="The bearing the layers dip towards. 0° is north, 90° is east." min={0} max={359} step={1} value={style.azimuthBedding} onChange={v => ss({ azimuthBedding: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Beds" help="How many layers across the whole sheet." min={2} max={300} step={1} value={style.bedsBedding} onChange={v => ss({ bedsBedding: Math.round(v) })} />
                  <InlineSl label="Shift" help="Moves every layer up or down by a part of one bed." min={0} max={1} step={0.01} value={style.offsetBedding} onChange={v => ss({ offsetBedding: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Smoothing" min={0} max={8} step={1} value={style.smoothingBedding} onChange={v => ss({ smoothingBedding: Math.round(v) })} />
                  <InlineSl label="Marker every" help="Every Nth bed as a second pen, as a map picks out a seam. At 0 there is none." min={0} max={20} step={1} value={style.markerBedding} onChange={v => ss({ markerBedding: Math.round(v) })} fmt={v => (v ? `${Math.round(v)}` : 'off')} />
                  {style.markerBedding > 0 && (
                    <>
                      <ColorRow label="Marker colour" value={style.markerColorBedding} onChange={v => ss({ markerColorBedding: v })} />
                      <InlineSl label="Marker weight" min={0.5} max={6} step={0.1} value={style.markerWeightBedding} onChange={v => ss({ markerWeightBedding: v })} fmt={v => v.toFixed(1)} />
                    </>
                  )}
                  {!geoTiffBbox && (
                    <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale." min={0.5} max={200} step={0.5} value={style.cellMetresBedding} onChange={v => ss({ cellMetresBedding: v })} fmt={v => `${v} m`} />
                  )}
                  {!hasGeoTiff && (
                    <InlineSl label="Relief" help="Metres from black to white in the heightmap. This file carries no heights of its own." min={10} max={9000} step={10} value={style.reliefBedding} onChange={v => ss({ reliefBedding: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  )}
                </Sub>
                <ModeStyleOverride prefix="Bedding" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Slope Classes" icon={<ModeMark kind="slopeclass" />} open={sec.modeSlopeClass} onToggle={() => tog('modeSlopeClass')} enabled={style.enabledSlopeClass}>
            <Tog label="Enabled" testId="mode-slopeclass" checked={style.enabledSlopeClass} onChange={v => ss({ enabledSlopeClass: v })} />
            {style.enabledSlopeClass && (
              <>
                <Sub>
                  {slopeClassNote && (
                    <div data-testid="slopeclass-readout" style={{ fontSize:10.5, color: DIM, marginBottom:8, fontVariantNumeric:'tabular-nums' }}>
                      {`${Math.round(slopeClassNote.low * 100)}% · ${Math.round(slopeClassNote.mid * 100)}% · ${Math.round(slopeClassNote.high * 100)}% of the ground`}
                    </div>
                  )}
                  <InlineSl label="From" help="The lowest band starts here. Avalanche maps use 30°." min={5} max={60} step={1} value={style.lowSlopeClass} onChange={v => ss({ lowSlopeClass: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Middle" min={5} max={70} step={1} value={style.midSlopeClass} onChange={v => ss({ midSlopeClass: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Steepest" help="Ground over this is cross-hatched." min={5} max={80} step={1} value={style.highSlopeClass} onChange={v => ss({ highSlopeClass: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Spacing" help="The hatch in the middle and steepest bands. The lowest band uses twice this." min={0.5} max={30} step={0.5} value={style.spacingSlopeClass} onChange={v => ss({ spacingSlopeClass: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Angle" min={0} max={180} step={1} value={style.angleSlopeClass} onChange={v => ss({ angleSlopeClass: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Detail" help="Blur on the slope before it is banded. At 0 the bands follow the grid." min={0} max={12} step={0.5} value={style.radiusSlopeClass} onChange={v => ss({ radiusSlopeClass: v })} fmt={v => v.toFixed(1)} />
                  {!geoTiffBbox && (
                    <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale." min={0.5} max={200} step={0.5} value={style.cellMetresSlopeClass} onChange={v => ss({ cellMetresSlopeClass: v })} fmt={v => `${v} m`} />
                  )}
                  {!hasGeoTiff && (
                    <InlineSl label="Relief" help="Metres from black to white in the heightmap. This file carries no heights of its own." min={10} max={9000} step={10} value={style.reliefSlopeClass} onChange={v => ss({ reliefSlopeClass: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  )}
                  <Tog label="Outline" help="The edge of the lowest band, drawn with its pen." checked={!!style.outlineSlopeClass} onChange={v => ss({ outlineSlopeClass: v })} />
                </Sub>
                <ModeStyleOverride prefix="SlopeClass" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Wind" icon={<ModeMark kind="wind" />} open={sec.modeWind} onToggle={() => tog('modeWind')} enabled={style.enabledWind}>
            <Tog label="Enabled" testId="mode-wind" checked={style.enabledWind} onChange={v => ss({ enabledWind: v })} />
            {style.enabledWind && (
              <>
                <Sub>
                  {windNote && (
                    <div data-testid="wind-readout" style={{ fontSize:10.5, color: DIM, marginBottom:8, fontVariantNumeric:'tabular-nums' }}>
                      {`${windNote.lines} lines`}
                    </div>
                  )}
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['lines','LINES'],['arrows','ARROWS'],['streaks','STREAKS']].map(([m, lbl]) => (
                      <Btn key={m} block variant="toggle" on={(style.strokeWind ?? 'lines') === m}
                        onClick={() => ss({ strokeWind: m })}
                        style={{ fontSize:9, padding:'3px 0', borderRadius:2 }}>{lbl}</Btn>
                    ))}
                  </div>
                  <InlineSl label="From" help="The bearing the wind blows from. 0° is north, 270° is west." min={0} max={359} step={1} value={style.azimuthWind} onChange={v => ss({ azimuthWind: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Spacing" help="The gap between lines on low ground." min={1} max={40} step={0.5} value={style.spacingWind} onChange={v => ss({ spacingWind: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Crowding" help="How much closer the lines run where the wind is faster, over crests and ridges. At 0 the gap is the same everywhere." min={0} max={1} step={0.05} value={style.crestWind} onChange={v => ss({ crestWind: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Turn" help="How far the air turns along a slope instead of going up it. At 0 the lines are straight." min={0} max={1} step={0.05} value={style.deflectWind} onChange={v => ss({ deflectWind: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Lee" help="Where the ground falls away along the wind more steeply than this, the air breaks away and the pen lifts. At 0 it never lifts." min={0} max={60} step={1} value={style.leeWind} onChange={v => ss({ leeWind: Math.round(v) })} fmt={v => (v ? `${Math.round(v)}°` : 'off')} />
                  {style.leeWind > 0 && (
                    <Tog label="Eddies" help="Curls in the lee, where the air breaks away. Without them the lee is left blank." checked={!!style.eddiesWind} onChange={v => ss({ eddiesWind: v })} />
                  )}
                  <InlineSl label="Detail" help="Blur on the ground before the wind reads it. Higher values let the air pass over small bumps." min={0} max={12} step={0.5} value={style.radiusWind} onChange={v => ss({ radiusWind: v })} fmt={v => v.toFixed(1)} />
                  {!geoTiffBbox && (
                    <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale." min={0.5} max={200} step={0.5} value={style.cellMetresWind} onChange={v => ss({ cellMetresWind: v })} fmt={v => `${v} m`} />
                  )}
                  {!hasGeoTiff && (
                    <InlineSl label="Relief" help="Metres from black to white in the heightmap. This file carries no heights of its own." min={10} max={9000} step={10} value={style.reliefWind} onChange={v => ss({ reliefWind: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  )}
                </Sub>
                <ModeStyleOverride prefix="Wind" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Runout" icon={<ModeMark kind="runout" />} open={sec.modeRunout} onToggle={() => tog('modeRunout')} enabled={style.enabledRunout}>
            <Tog label="Enabled" testId="mode-runout" checked={style.enabledRunout} onChange={v => ss({ enabledRunout: v })} />
            {style.enabledRunout && (
              <>
                <Sub>
                  {runoutNote && (
                    <div data-testid="runout-readout" style={{ fontSize:10.5, color: DIM, marginBottom:8, fontVariantNumeric:'tabular-nums' }}>
                      {runoutNote.paths ? `${runoutNote.paths} paths · longest ${Math.round(runoutNote.longest)} m` : 'No ground is steep enough to release'}
                    </div>
                  )}
                  <InlineSl label="Release" help="Rock falls from ground steeper than this." min={20} max={80} step={1} value={style.releaseRunout} onChange={v => ss({ releaseRunout: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Reach" help="A rock stops where the line back up to its start is flatter than this. Hazard maps use about 32° for rockfall. Lower values let it run farther." min={15} max={45} step={0.5} value={style.reachRunout} onChange={v => ss({ reachRunout: v })} fmt={v => `${v}°`} />
                  <InlineSl label="Spacing" help="The gap between the points in the release zones where paths start." min={1} max={40} step={0.5} value={style.spacingRunout} onChange={v => ss({ spacingRunout: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Detail" help="Blur on the ground before the slope is read and the paths walk it." min={0} max={12} step={0.5} value={style.radiusRunout} onChange={v => ss({ radiusRunout: v })} fmt={v => v.toFixed(1)} />
                  {!geoTiffBbox && (
                    <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale." min={0.5} max={200} step={0.5} value={style.cellMetresRunout} onChange={v => ss({ cellMetresRunout: v })} fmt={v => `${v} m`} />
                  )}
                  {!hasGeoTiff && (
                    <InlineSl label="Relief" help="Metres from black to white in the heightmap. This file carries no heights of its own." min={10} max={9000} step={10} value={style.reliefRunout} onChange={v => ss({ reliefRunout: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  )}
                  <Tog label="Release zones" help="The ground steeper than the release angle, outlined as a second pen." checked={!!style.zoneRunout} onChange={v => ss({ zoneRunout: v })} />
                  {style.zoneRunout && (
                    <>
                      <ColorRow label="Zone colour" value={style.zoneColorRunout} onChange={v => ss({ zoneColorRunout: v })} />
                      <InlineSl label="Zone weight" min={0.3} max={6} step={0.1} value={style.zoneWeightRunout} onChange={v => ss({ zoneWeightRunout: v })} fmt={v => v.toFixed(1)} />
                      <Tog label="Hatch zones" checked={!!style.hatchRunout} onChange={v => ss({ hatchRunout: v })} />
                      {style.hatchRunout && (
                        <InlineSl label="Hatch angle" min={0} max={180} step={1} value={style.angleRunout} onChange={v => ss({ angleRunout: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                      )}
                    </>
                  )}
                </Sub>
                <ModeStyleOverride prefix="Runout" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Venation" icon={<ModeMark kind="venation" />} open={sec.modeVenation} onToggle={() => tog('modeVenation')} enabled={style.enabledVenation}>
            <Tog label="Enabled" testId="mode-venation" checked={style.enabledVenation} onChange={v => ss({ enabledVenation: v })} />
            {style.enabledVenation && (
              <>
                <Sub>
                  {venationNote && (
                    <div data-testid="venation-readout" style={{ fontSize:10.5, color: DIM, marginBottom:8, fontVariantNumeric:'tabular-nums' }}>
                      {`${venationNote.nodes.toLocaleString()} vein nodes`}
                    </div>
                  )}
                  <InlineSl label="Attractors" help="Points the veins grow toward, scattered densest on wet ground. More of them fill more of the slopes." min={500} max={30000} step={100} value={style.countVenation} onChange={v => ss({ countVenation: Math.round(v) })} fmt={v => Math.round(v).toLocaleString()} />
                  <InlineSl label="Roots" help="How many outlets the veins grow from, the ones that drain the most ground." min={1} max={30} step={1} value={style.rootsVenation} onChange={v => ss({ rootsVenation: Math.round(v) })} />
                  <InlineSl label="Step" help="The length of one vein segment." min={0.5} max={20} step={0.5} value={style.spacingVenation} onChange={v => ss({ spacingVenation: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Wet bias" help="How strongly the attractors favour wet ground. At low values the veins spread evenly over the slopes." min={0.2} max={4} step={0.1} value={style.gammaVenation} onChange={v => ss({ gammaVenation: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Seed" min={1} max={999} step={1} value={style.seedVenation} onChange={v => ss({ seedVenation: Math.round(v) })} />
                </Sub>
                <ModeStyleOverride prefix="Venation" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Geodesic Fan" icon={<ModeMark kind="geodesic" />} open={sec.modeGeodesic} onToggle={() => tog('modeGeodesic')} enabled={style.enabledGeodesic}>
            <Tog label="Enabled" testId="mode-geodesic" checked={style.enabledGeodesic} onChange={v => ss({ enabledGeodesic: v })} />
            {style.enabledGeodesic && (
              <>
                <Sub>
                  <Btn block variant="toggle" on={pick === 'Geodesic'} data-testid="geodesic-pick"
                    onClick={() => onPick?.(pick === 'Geodesic' ? null : 'Geodesic')} style={{ marginBottom:8 }}>
                    {pick === 'Geodesic' ? 'Click the centre of the fan…' : 'Pick centre on terrain'}
                  </Btn>
                  <InlineSl label="Rays" min={8} max={1000} step={1} value={style.raysGeodesic} onChange={v => ss({ raysGeodesic: Math.round(v) })} />
                  <InlineSl label="Bend" help="Multiplies the heights before the rays read them. Real ground bends a straight line only a little." min={0.5} max={10} step={0.1} value={style.exaggerationGeodesic} onChange={v => ss({ exaggerationGeodesic: v })} fmt={v => `×${v.toFixed(1)}`} />
                  <InlineSl label="Detail" help="Blur on the ground before the rays read it. The rays follow the curvature, and a raw DEM curves at every cell." min={0} max={12} step={0.5} value={style.radiusGeodesic} onChange={v => ss({ radiusGeodesic: v })} fmt={v => v.toFixed(1)} />
                  {!geoTiffBbox && (
                    <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale." min={0.5} max={200} step={0.5} value={style.cellMetresGeodesic} onChange={v => ss({ cellMetresGeodesic: v })} fmt={v => `${v} m`} />
                  )}
                  {!hasGeoTiff && (
                    <InlineSl label="Relief" help="Metres from black to white in the heightmap. This file carries no heights of its own." min={10} max={9000} step={10} value={style.reliefGeodesic} onChange={v => ss({ reliefGeodesic: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  )}
                  <Tog label="Mark the centre" checked={!!style.markerGeodesic} onChange={v => ss({ markerGeodesic: v })} />
                </Sub>
                <ModeStyleOverride prefix="Geodesic" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Radar" icon={<ModeMark kind="radar" />} open={sec.modeRadar} onToggle={() => tog('modeRadar')} enabled={style.enabledRadar}>
            <Tog label="Enabled" testId="mode-radar" checked={style.enabledRadar} onChange={v => ss({ enabledRadar: v })} />
            {style.enabledRadar && (
              <>
                <Sub>
                  <InlineSl label="Looks toward" help="The bearing the radar looks toward. At 90° it sits in the west and looks east, and slopes that face west come back brightest." min={0} max={359} step={1} value={style.azimuthRadar} onChange={v => ss({ azimuthRadar: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Look angle" help="The angle of the beam from the vertical. A steep look makes more layover, a flat one more shadow." min={10} max={80} step={1} value={style.lookRadar} onChange={v => ss({ lookRadar: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Spacing" help="The gap between the lines of ticks, and between ticks on level ground." min={0.5} max={20} step={0.5} value={style.spacingRadar} onChange={v => ss({ spacingRadar: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Gain" help="More ticks for the same return." min={0.1} max={4} step={0.05} value={style.gainRadar} onChange={v => ss({ gainRadar: v })} fmt={v => v.toFixed(2)} />
                  {!geoTiffBbox && (
                    <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale." min={0.5} max={200} step={0.5} value={style.cellMetresRadar} onChange={v => ss({ cellMetresRadar: v })} fmt={v => `${v} m`} />
                  )}
                  {!hasGeoTiff && (
                    <InlineSl label="Relief" help="Metres from black to white in the heightmap. This file carries no heights of its own." min={10} max={9000} step={10} value={style.reliefRadar} onChange={v => ss({ reliefRadar: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  )}
                </Sub>
                <ModeStyleOverride prefix="Radar" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Spines" icon={<ModeMark kind="spines" />} open={sec.modeSpines} onToggle={() => tog('modeSpines')} enabled={style.enabledSpines}>
            <Tog label="Enabled" testId="mode-spines" checked={style.enabledSpines} onChange={v => ss({ enabledSpines: v })} />
            {style.enabledSpines && (
              <>
                <Sub>
                  <InlineSl label="Levels" help="How many heights get a skeleton, evenly spaced from low to high." min={1} max={80} step={1} value={style.levelsSpines} onChange={v => ss({ levelsSpines: Math.round(v) })} />
                  <InlineSl label="Min. depth" help="A spine draws only where the ground above its level is at least this far across, so thin tongues give none." min={1} max={30} step={0.5} value={style.depthSpines} onChange={v => ss({ depthSpines: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Detail" help="Blur on the ground first. Without it every bump on an edge sprouts a spine." min={0} max={12} step={0.5} value={style.radiusSpines} onChange={v => ss({ radiusSpines: v })} fmt={v => v.toFixed(1)} />
                </Sub>
                <ModeStyleOverride prefix="Spines" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Coral" icon={<ModeMark kind="coral" />} open={sec.modeCoral} onToggle={() => tog('modeCoral')} enabled={style.enabledCoral}>
            <Tog label="Enabled" testId="mode-coral" checked={style.enabledCoral} onChange={v => ss({ enabledCoral: v })} />
            {style.enabledCoral && (
              <>
                <Sub>
                  {coralNote && (
                    <div data-testid="coral-readout" style={{ fontSize:10.5, color: DIM, marginBottom:8, fontVariantNumeric:'tabular-nums' }}>
                      {`${coralNote.nodes.toLocaleString()} nodes`}
                    </div>
                  )}
                  <InlineSl label="Gap" help="The distance the folds keep apart. It halves on the steepest ground." min={1} max={30} step={0.5} value={style.spacingCoral} onChange={v => ss({ spacingCoral: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Above" help="The line grows on the ground above this share of the height range." min={0} max={0.95} step={0.01} value={style.levelCoral} onChange={v => ss({ levelCoral: v })} fmt={v => `${Math.round(v * 100)}%`} />
                  <InlineSl label="Nodes" help="The growth stops at this many points on the line. More fill more of the ground and take longer." min={500} max={60000} step={500} value={style.nodesCoral} onChange={v => ss({ nodesCoral: Math.round(v) })} fmt={v => Math.round(v).toLocaleString()} />
                  <InlineSl label="Steps" help="The growth also stops after this many steps." min={100} max={20000} step={100} value={style.stepsCoral} onChange={v => ss({ stepsCoral: Math.round(v) })} fmt={v => Math.round(v).toLocaleString()} />
                  <InlineSl label="Seed" min={1} max={999} step={1} value={style.seedCoral} onChange={v => ss({ seedCoral: Math.round(v) })} />
                </Sub>
                <ModeStyleOverride prefix="Coral" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Glacier" icon={<ModeMark kind="glacier" />} open={sec.modeGlacier} onToggle={() => tog('modeGlacier')} enabled={style.enabledGlacier}>
            <Tog label="Enabled" testId="mode-glacier" checked={style.enabledGlacier} onChange={v => ss({ enabledGlacier: v })} />
            {style.enabledGlacier && (
              <>
                <Sub>
                  {glacierNote && (
                    <div data-testid="glacier-readout" style={{ fontSize:10.5, color: DIM, marginBottom:8, fontVariantNumeric:'tabular-nums' }}>
                      {`${Math.round(glacierNote.share * 100)}% of the ground under ice · snowline ${Math.round(glacierNote.snowline)} m`}
                    </div>
                  )}
                  <InlineSl label="Snowline" help="Ice lies above this share of the height range." min={0} max={1} step={0.01} value={style.snowlineGlacier} onChange={v => ss({ snowlineGlacier: v })} fmt={v => `${Math.round(v * 100)}%`} />
                  <InlineSl label="Steepest ice" help="Ground steeper than this is rock wall and holds no ice." min={5} max={80} step={1} value={style.steepGlacier} onChange={v => ss({ steepGlacier: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Cracks from" help="Ice steeper than this gets crevasses, longer as it steepens." min={0} max={60} step={1} value={style.crackGlacier} onChange={v => ss({ crackGlacier: Math.round(v) })} fmt={v => `${Math.round(v)}°`} />
                  <InlineSl label="Interval" help="Contours on the ice, in true metres." min={5} max={500} step={5} value={style.intervalGlacier} onChange={v => ss({ intervalGlacier: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  <InlineSl label="Spacing" help="The grid the crevasses sit on. The moraine rings use half of it." min={1} max={40} step={0.5} value={style.spacingGlacier} onChange={v => ss({ spacingGlacier: v })} fmt={v => v.toFixed(1)} />
                  <InlineSl label="Detail" help="Blur on the ice before its edge is drawn." min={0} max={12} step={0.5} value={style.radiusGlacier} onChange={v => ss({ radiusGlacier: v })} fmt={v => v.toFixed(1)} />
                  <ColorRow label="Ice colour" value={style.iceColorGlacier} onChange={v => ss({ iceColorGlacier: v })} />
                  <Tog label="Moraine" help="Rings along the outside of the ice edge, in the mode's own colour." checked={!!style.moraineGlacier} onChange={v => ss({ moraineGlacier: v })} />
                  {!geoTiffBbox && (
                    <InlineSl label="Pixel size" help="Metres per pixel. This raster is not georeferenced, so the app cannot know its scale." min={0.5} max={200} step={0.5} value={style.cellMetresGlacier} onChange={v => ss({ cellMetresGlacier: v })} fmt={v => `${v} m`} />
                  )}
                  {!hasGeoTiff && (
                    <InlineSl label="Relief" help="Metres from black to white in the heightmap. This file carries no heights of its own." min={10} max={9000} step={10} value={style.reliefGlacier} onChange={v => ss({ reliefGlacier: Math.round(v) })} fmt={v => `${Math.round(v)} m`} />
                  )}
                </Sub>
                <ModeStyleOverride prefix="Glacier" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>

          <Section title="Mode: Roughness Mesh" icon={<ModeMark kind="rugged" />} open={sec.modeRugged} onToggle={() => tog('modeRugged')} enabled={style.enabledRugged}>
            <Tog label="Enabled" testId="mode-rugged" checked={style.enabledRugged} onChange={v => ss({ enabledRugged: v })} />
            {style.enabledRugged && (
              <>
                <Sub>
                  <div style={{ display:'flex', gap:2, marginBottom:8 }}>
                    {[['delaunay','DELAUNAY'],['voronoi','VORONOI'],['both','BOTH']].map(([m, lbl]) => (
                      <Btn key={m} block variant="toggle" on={style.kindRugged === m}
                        onClick={() => ss({ kindRugged: m })}
                        style={{ fontSize:9, padding:'3px 0', borderRadius:2 }}>{lbl}</Btn>
                    ))}
                  </div>
                  <InlineSl label="Points" min={50} max={12000} step={50} value={style.countRugged} onChange={v => ss({ countRugged: Math.round(v) })} />
                  <InlineSl label="Gamma" help="Above 1, only the roughest ground gets small facets." min={0.2} max={3} step={0.05} value={style.gammaRugged} onChange={v => ss({ gammaRugged: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Floor" help="Point density on smooth ground, as a fraction of the roughest. At 0 the flats get almost no points and a few long triangles span them." min={0} max={1} step={0.01} value={style.floorRugged} onChange={v => ss({ floorRugged: v })} fmt={v => v.toFixed(2)} />
                  <InlineSl label="Smoothing" help="Blur before the ruggedness is measured, so sensor grain does not count as rough ground." min={0} max={8} step={1} value={style.radiusRugged} onChange={v => ss({ radiusRugged: Math.round(v) })} />
                  <InlineSl label="Seed" min={1} max={999} step={1} value={style.seedRugged} onChange={v => ss({ seedRugged: v })} />
                </Sub>
                <ModeStyleOverride prefix="Rugged" style={style} ss={ss} gradientStops={gradientStops} setGradientStops={sg} />
              </>
            )}
          </Section>
    </>
  )
}
