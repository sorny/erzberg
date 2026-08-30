/**
 * Renders the ridge-line / curve / hachure / contour geometry as GPU line segments.
 */
import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useThree } from '@react-three/fiber'
import { SurfaceMesh } from './SurfaceMesh'
import { DASH_CONFIGS } from '../utils/stylePresets'
import { layerStyle } from '../utils/geometryBuilders'
import { VectorHighlight } from './VectorHighlight'

/**
 * Where the parts of one layer sit inside its own slot in the paint order.
 *
 * Every mark in this scene draws with `depthWrite: false`, so among themselves
 * `renderOrder` is the only thing deciding who covers whom (ParticleSystem.jsx
 * has the long version). A layer is one slot — `layerIndex + 1` — and these
 * fractions keep its own parts in the right order inside it without ever
 * reaching the slot above: the fill is under its outline, and the outline is
 * over the ghost of itself.
 *
 * Fractions rather than a multiplier because the budget is not free. The
 * particle field sits at 99–101 to paint over every line layer, and a scene can
 * carry twenty-seven draw modes plus forty vector layers — spacing slots ten apart
 * would put the deepest of them on the wrong side of the flock.
 *
 * Occlusion curtains are deliberately absent: they write depth for *every*
 * layer, not just their own, so they stay at the default 0 ahead of the lot.
 */
const SUB_FILL = 0.2, SUB_LID = 0.4, SUB_GHOST = 0.6, SUB_LINE = 0.8
// A fill drawn *after* its own layer's lines and before the next layer's
// anything — which is what turns a centred stroke into an outside one.
const SUB_FILL_OVER = 0.9

/**
 * How far toward the camera a mark — an icon or a label — is biased in the
 * depth buffer.
 *
 * A mark is a flat drawing planted on a rough surface, so the terrain cuts
 * through its plane — and the two halves of the mark used to be cut in
 * different places: the fill carried a `polygonOffset` and the stroke carried
 * none, so along the intersection the fill survived where the stroke was
 * rejected. What that looked like was the mark coming apart into patches of
 * fill and patches of stroke, changing as the camera moved.
 *
 * Both take the same bias now, so they are cut in the same place and the mark is
 * cut as one drawing. It is deeper than the bias an area fill takes, and
 * deliberately: an area fill is *of* the surface and wants to hug it, while a
 * marker planted on it stands a whole glyph's worth of geometry through the
 * ground it is planted in. 64 was measured rather than guessed — at 16 the
 * terrain still chewed the mark, 64 and 128 look the same, and at every one of
 * them the half of the mark that is genuinely inside the hill stays hidden.
 * This is a bias, not an exemption from the depth test: Lift is still what stops
 * a marker being half-buried, and this only stops it being half-*eaten*.
 */
const MARK_OFFSET = 64

function LineLayer({ layer, weight, opacity, dash, color, fillColor, fillOpacity, strokeOutside, depthOcclusion, occlusionOpacity, occlusionColor, occlusionBias, resolution, tilt, layerIndex }) {
  const { positions, colors } = layer
  const base = (layerIndex ?? 0) + 1
  // A layer either carries per-vertex colour (every draw mode) or takes a flat
  // one from the live params (every vector layer). The second case is what lets
  // a vector layer be recoloured without a worker rebuild, since nothing about
  // its geometry changes.
  const flat = !colors || colors.length !== positions?.length

  /**
   * An **outside** stroke, without moving a single vertex.
   *
   * `LineMaterial` strokes a path in screen-space pixels, straddling it — half
   * the width inside the shape, half outside. There is no inside/outside knob,
   * and there cannot be a geometric one either: the width is in CSS pixels, so
   * the offset it would need is a world distance that changes with the camera
   * and, under perspective, with each mark's own depth.
   *
   * Paint order does it instead. Draw the line at *twice* the width, then draw
   * the shape's fill over its inner half, and what survives is exactly `weight`
   * of ink lying outside the edge — the edge itself staying precisely where the
   * icon or the letterform put it. `SUB_FILL_OVER` is that "after the lines"
   * slot, still inside this layer's own band of the stack, so nothing about who
   * covers whom between layers changes.
   *
   * It needs a fill to cover with, so a hollow mark stays centred — which costs
   * nothing, since a stroke with no shape behind it has no inside to sit in.
   * A part-transparent fill lets the covered half show through and lands
   * somewhere between the two, which is the honest answer for a part-
   * transparent fill.
   */
  const outside = !!strokeOutside && !!layer.fills?.positions?.length
  const drawWeight = (weight || 1) * (outside ? 2 : 1)

  // An icon or a label is a *mark*: a flat drawing in its own plane, whose fill
  // and whose stroke are two halves of one thing. An area fill is a surface, and
  // the two want opposite things from the depth buffer — see `depthWrite` below.
  const isMark = !!layer.isIcon || !!layer.isLabelText


  const geometry = useMemo(() => {
    if (!positions || positions.length === 0) return null
    const geo = new LineSegmentsGeometry()
    geo.setPositions(positions)
    if (colors && colors.length === positions.length) {
      geo.setColors(colors)
    }
    return geo
  }, [positions, colors])

  useEffect(() => () => geometry?.dispose(), [geometry])

  // ── Area fill ─────────────────────────────────────────────────────────────
  // Terrain-conforming quads under the outline. Built in the worker; see
  // utils/vectorGeometry.js for why it is a lattice rather than a triangulation.
  const fillGeo = useMemo(() => {
    if (!layer.fills || layer.fills.positions.length === 0) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(layer.fills.positions, 3))
    geo.setIndex(new THREE.BufferAttribute(layer.fills.indices, 1))
    return geo
  }, [layer.fills])

  const fillMat = useMemo(() => new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    // An area fill sits a fraction above the surface already; the offset stops
    // the two from flickering against each other at grazing angles. A mark's
    // fill takes the deeper bias its own stroke takes — see `MARK_OFFSET`.
    polygonOffset: true,
    polygonOffsetFactor: isMark ? -MARK_OFFSET : -1,
    polygonOffsetUnits: isMark ? -MARK_OFFSET : -1,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  useEffect(() => {
    fillMat.color.set(fillColor || '#1a78c2')
    const o = fillOpacity ?? 0.45
    fillMat.opacity = o

    // At full opacity a fill has to actually cover things, and what used to stop
    // it was not blending but paint order: it drew with `renderOrder` 0 while
    // every line layer drew at 1 or above, so the whole scene composited over
    // the top and 100% read as roughly half. Its slot in the stack (SUB_FILL,
    // above) is the fix; `depthWrite` is the other half, so it also occludes
    // whatever depth-tests against it.
    //
    // It deliberately stays `transparent` even at alpha 1 — blending a fragment
    // with alpha 1 writes exactly what an opaque one writes, so the only thing
    // the opaque queue would buy is drawing *earlier*, and earlier is precisely
    // wrong here: the opaque pass runs before every blended one, so a layer
    // dragged to the top of the stack would still come out behind every line in
    // the scene.
    //
    // …but a *mark* — an icon or a label — must not, and this is why: its fill
    // and its own stroke are exactly coplanar, and a wide stroke is not really
    // in that plane at all. `LineMaterial` expands a segment into a screen-space
    // quad, so the depth across its width is interpolated from the segment's
    // endpoints and lands on either side of the fill's own. With the fill
    // writing depth, the stroke is then accepted on some pixels and rejected on
    // others, and the mark comes out as a patchwork of half stroke and half
    // fill — the same edge reading differently every few pixels.
    //
    // Nothing about the fill's *place* fixes that; the fight is the depth test
    // itself. So a mark's fill does not write depth, and which of the two covers
    // the other is decided by `renderOrder` alone: the stroke over the fill when
    // it is centred, the fill over the stroke when it is outside. Deterministic,
    // and per-mark rather than per-pixel. It costs a mark's fill the ability to
    // occlude what is drawn after it, which is no loss: the stack already says
    // who covers whom, and a billboard occluding by depth was never the point.
    const solid = o >= 0.999
    fillMat.depthWrite = solid && !isMark
    fillMat.depthTest = !!depthOcclusion
  }, [fillMat, fillColor, fillOpacity, depthOcclusion, isMark])

  useEffect(() => () => fillGeo?.dispose(), [fillGeo])
  useEffect(() => () => fillMat?.dispose(), [fillMat])

  const curtainGeo = useMemo(() => {
    if (!layer.curtains || layer.curtains.positions.length === 0) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(layer.curtains.positions, 3))
    geo.setIndex(new THREE.BufferAttribute(layer.curtains.indices, 1))
    return geo
  }, [layer.curtains])

  // Depth-only occluder: writes no colour, only depth. Kept in the transparent
  // queue (despite writing no colour) so it renders *after* the transparent fill
  // surface — making it opaque would render it before the fill and can punch
  // depth holes through the fill where curtains hang in front of farther terrain.
  const curtainMat = useMemo(() => new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    transparent: true,
  }), [])

  const lidGeo = useMemo(() => {
    if (!layer.lids || layer.lids.positions.length === 0) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(layer.lids.positions, 3))
    geo.setAttribute('color',    new THREE.BufferAttribute(layer.lids.colors, 3))
    geo.setIndex(new THREE.BufferAttribute(layer.lids.indices, 1))
    return geo
  }, [layer.lids])

  const lidMat = useMemo(() => new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  }), [])

  useEffect(() => {
    if (!curtainMat) return
    // If the camera is underneath (tilt > 90), curtains would be between us and the lines.
    // So we disable them to allow the lines to be visible from below.
    curtainMat.visible = !!(depthOcclusion && (tilt == null || tilt <= 90))
    curtainMat.depthTest = !!depthOcclusion
    curtainMat.depthWrite = !!depthOcclusion
    curtainMat.polygonOffset = true
    curtainMat.polygonOffsetFactor = occlusionBias ?? 1
    curtainMat.polygonOffsetUnits = occlusionBias ?? 1
    curtainMat.needsUpdate = true
  }, [curtainMat, depthOcclusion, occlusionBias, tilt])

  useEffect(() => () => curtainMat?.dispose(), [curtainMat])
  useEffect(() => () => curtainGeo?.dispose(), [curtainGeo])
  useEffect(() => () => lidGeo?.dispose(),     [lidGeo])
  useEffect(() => () => lidMat?.dispose(),     [lidMat])

  useEffect(() => {
    if (!lidMat) return
    // opacity is a uniform and depthTest is render state — no recompile needed.
    lidMat.opacity   = opacity ?? 1
    lidMat.depthTest = !!depthOcclusion
  }, [lidMat, opacity, depthOcclusion])

  // ── Main (Visible) Pass ───────────────────────────────────────────────────
  // Built once; weight/opacity/depthOcclusion/resolution here are seed values only
  // and the effect below keeps them live. Depending on them would rebuild the
  // material on every slider tick — a new LineMaterial per frame of a drag, each
  // one a shader compile, which is exactly what the split into memo + effect buys.
  const material = useMemo(() => new LineMaterial({
    linewidth: drawWeight,
    vertexColors: !flat,
    resolution,
    transparent: true,
    depthWrite: false,
    depthTest: !!depthOcclusion,
    depthFunc: THREE.LessEqualDepth,
    opacity: opacity ?? 1,
    polygonOffset: isMark,
    polygonOffsetFactor: -MARK_OFFSET,
    polygonOffsetUnits: -MARK_OFFSET,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  const lines = useMemo(() => {
    if (!geometry) return null
    const l = new LineSegments2(geometry, material)
    // What the picker looks for. Tagging the object rather than registering it
    // somewhere keeps the picker a pure reader of the scene graph, and keeps
    // these objects out of R3F's own interaction list — which would otherwise
    // raycast every one of them on every pointer move.
    if (layer.featureOfSegment) {
      l.userData.vectorLayerId = layer.id
      l.userData.featureOfSegment = layer.featureOfSegment
      // Points are picked with a wider radius and win ties — see VectorPicker.
      // An icon inherits that: it is the same deliberate mark on the same
      // feature, only drawn properly.
      l.userData.vectorIsPoints = !!layer.isPoints || !!layer.isIcon
    }
    return l
  }, [geometry, material, layer.id, layer.featureOfSegment, layer.isPoints, layer.isIcon])

  // ── Ghost (Hidden) Pass ───────────────────────────────────────────────────
  // Same build-once-then-sync split as the visible pass above.
  const ghostMaterial = useMemo(() => new LineMaterial({
    linewidth: weight || 1,
    vertexColors: false,
    color: new THREE.Color(occlusionColor || '#000000'),
    resolution,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.GreaterDepth,
    opacity: occlusionOpacity ?? 0,
    // The same bias as the visible pass, or the ghost would start where the
    // visible stroke has not finished and the two would overlap in a band.
    polygonOffset: isMark,
    polygonOffsetFactor: -MARK_OFFSET,
    polygonOffsetUnits: -MARK_OFFSET,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  const ghostLines = useMemo(() => {
    if (!geometry || !depthOcclusion || (occlusionOpacity ?? 0) <= 0) return null
    return new LineSegments2(geometry, ghostMaterial)
  }, [geometry, depthOcclusion, occlusionOpacity, ghostMaterial])

  useEffect(() => {
    if (!lines) return
    material.linewidth = drawWeight
    material.opacity = opacity ?? 1
    material.depthTest = !!depthOcclusion
    material.resolution.copy(resolution)

    // MSAA alpha-to-coverage: smoothstep edge alpha instead of a hard discard,
    // which removes most temporal shimmer ("boiling") of dense 1px lines while
    // panning/rotating. Only for (near-)opaque lines — for translucent ones the
    // body alpha would be dithered into the coverage mask (visible stipple), so
    // those keep plain blending. The LineMaterial setter flags needsUpdate
    // itself, and only when the define actually flips.
    material.alphaToCoverage = (opacity ?? 1) >= 0.99

    // Flat layers take their one colour from the live params, which is what
    // makes recolouring a vector layer a frame rather than a worker rebuild.
    if (flat) material.color.set(color || '#000000')

    // linewidth/opacity/dashSize/gapSize map to uniforms and depthTest is plain
    // render state — none need a shader recompile, so no needsUpdate here. The
    // `dashed` setter flags needsUpdate itself when the USE_DASH define changes.
    const d = DASH_CONFIGS[dash ?? 'solid'] ?? DASH_CONFIGS.solid
    material.dashed = d.dashed
    material.dashSize = d.dashSize
    material.gapSize = d.gapSize

    // Dash rendering needs per-segment cumulative distances. Computing them is
    // O(segments) on the CPU plus a fresh GPU buffer, so do it lazily and only
    // once per geometry (lines and ghostLines share the geometry) — not on
    // every weight/opacity slider tick.
    if (d.dashed && !geometry.attributes.instanceDistanceStart) lines.computeLineDistances()
    lines.renderOrder = base + SUB_LINE

    if (ghostLines) {
      // Not `drawWeight`: the doubling only works where a fill covers the
      // inner half, and behind the terrain nothing does. A hint of a hidden
      // mark has no business being twice as fat as the mark.
      ghostMaterial.linewidth = weight || 1
      ghostMaterial.opacity = occlusionOpacity ?? 0
      ghostMaterial.color.set(occlusionColor || '#000000')
      ghostMaterial.resolution.copy(resolution)
      ghostMaterial.alphaToCoverage = (occlusionOpacity ?? 0) >= 0.99
      ghostMaterial.dashed = d.dashed
      ghostMaterial.dashSize = d.dashSize
      ghostMaterial.gapSize = d.gapSize
      ghostLines.renderOrder = base + SUB_GHOST
    }
  }, [lines, ghostLines, geometry, material, ghostMaterial, weight, drawWeight, opacity, dash, color, flat, depthOcclusion, occlusionOpacity, occlusionColor, resolution, base])

  useEffect(() => () => {
    material?.dispose()
    ghostMaterial?.dispose()
  }, [material, ghostMaterial])

  // A fill with no surviving outline is possible — every stroke can fall over
  // NoData while the interior does not — so this is not gated on `lines`.
  if (!lines && !fillGeo) return null

  return (
    <group>
      {curtainGeo && depthOcclusion && <mesh geometry={curtainGeo} material={curtainMat} />}
      {fillGeo && <mesh geometry={fillGeo} material={fillMat}
                        renderOrder={base + (outside ? SUB_FILL_OVER : SUB_FILL)} />}
      {lidGeo && <mesh geometry={lidGeo} material={lidMat} renderOrder={base + SUB_LID} />}
      {ghostLines && <primitive object={ghostLines} />}
      {lines && <primitive object={lines} />}
    </group>
  )
}

export function HeightmapLines({ lineGeo, surfaceGeo, p, profileClickRef }) {
  const { size, gl } = useThree()
  // gl.getSize() is the CSS-pixel viewport (getDrawingBufferSize() would be the
  // device-pixel one). That is deliberate: LineMaterial divides linewidth by
  // resolution.y, so a CSS-sized resolution makes `weight` mean CSS pixels and
  // keeps apparent line thickness constant across devicePixelRatio *and* across
  // the View → Supersampling multiplier. Passing the drawing-buffer size instead
  // would shrink every line by a factor of dpr × renderScale.
  // size.width/height are not read in the body and ESLint calls them unnecessary,
  // but they are the point: gl.getSize() is an imperative read with no identity of
  // its own, so the viewport dimensions are what tells this memo the answer has
  // changed. Dropping them would freeze `resolution` at its mount value and every
  // line would keep the thickness it had before the window was resized.
  const resolution = useMemo(() => {
    const s = new THREE.Vector2()
    gl.getSize(s)
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, size.width, size.height])

  return (
    <group>
      <SurfaceMesh surfaceGeo={surfaceGeo} p={p} profileClickRef={profileClickRef} />

      {/* Raw terrain view is a look at the source data, so every drawn layer —
          all the modes plus the GPX track, which is just another lineGeo entry —
          is skipped. Filtering here rather than forcing the `enabled*` flags off
          keeps it a render-side switch: no worker rebuild, and the user's
          selection is exactly as they left it when the view is turned off. */}
      {/* Above the layers, so a highlighted feature is not buried under the
          ones drawn after it. */}
      {!p.showRawTerrain && <VectorHighlight lineGeo={lineGeo} resolution={resolution} />}

      {!p.showRawTerrain && Array.isArray(lineGeo) && lineGeo.map((layer, i) => {
        const { weight, opacity, dash, color, fillColor, fillOpacity, strokeOutside } = layerStyle(layer.id, p)
        return (
        <LineLayer
          key={layer.id}
          layer={layer}
          weight={weight}
          opacity={opacity}
          dash={dash}
          color={color}
          fillColor={fillColor}
          fillOpacity={fillOpacity}
          strokeOutside={strokeOutside}
          depthOcclusion={p.depthOcclusion}
          occlusionOpacity={p.occlusionOpacity}
          occlusionColor={p.occlusionColor}
          occlusionBias={p.occlusionBias}
          resolution={resolution}
          tilt={p.tilt}
          layerIndex={i}
        />
        )
      })}
    </group>
  )
}
