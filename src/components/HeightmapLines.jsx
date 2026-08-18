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

function LineLayer({ layer, weight, opacity, dash, color, fillColor, fillOpacity, depthOcclusion, occlusionOpacity, occlusionColor, occlusionBias, resolution, tilt, layerIndex }) {
  const { positions, colors } = layer
  // A layer either carries per-vertex colour (every draw mode) or takes a flat
  // one from the live params (every vector layer). The second case is what lets
  // a vector layer be recoloured without a worker rebuild, since nothing about
  // its geometry changes.
  const flat = !colors || colors.length !== positions?.length

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
    // The fill sits a fraction above the surface already; the offset stops the
    // two from flickering against each other at grazing angles.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }), [])

  useEffect(() => {
    fillMat.color.set(fillColor || '#1a78c2')
    fillMat.opacity = fillOpacity ?? 0.45
    fillMat.depthTest = !!depthOcclusion
  }, [fillMat, fillColor, fillOpacity, depthOcclusion])

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
    linewidth: weight || 1,
    vertexColors: !flat,
    resolution,
    transparent: true,
    depthWrite: false,
    depthTest: !!depthOcclusion,
    depthFunc: THREE.LessEqualDepth,
    opacity: opacity ?? 1,
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
      l.userData.vectorIsPoints = !!layer.isPoints
    }
    return l
  }, [geometry, material, layer.id, layer.featureOfSegment, layer.isPoints])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  const ghostLines = useMemo(() => {
    if (!geometry || !depthOcclusion || (occlusionOpacity ?? 0) <= 0) return null
    return new LineSegments2(geometry, ghostMaterial)
  }, [geometry, depthOcclusion, occlusionOpacity, ghostMaterial])

  useEffect(() => {
    if (!lines) return
    material.linewidth = weight || 1
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
    lines.renderOrder = (layerIndex ?? 0) + 1

    if (ghostLines) {
      ghostMaterial.linewidth = weight || 1
      ghostMaterial.opacity = occlusionOpacity ?? 0
      ghostMaterial.color.set(occlusionColor || '#000000')
      ghostMaterial.resolution.copy(resolution)
      ghostMaterial.alphaToCoverage = (occlusionOpacity ?? 0) >= 0.99
      ghostMaterial.dashed = d.dashed
      ghostMaterial.dashSize = d.dashSize
      ghostMaterial.gapSize = d.gapSize
      ghostLines.renderOrder = (layerIndex ?? 0) + 1
    }
  }, [lines, ghostLines, geometry, material, ghostMaterial, weight, opacity, dash, color, flat, depthOcclusion, occlusionOpacity, occlusionColor, resolution, layerIndex])

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
      {fillGeo && <mesh geometry={fillGeo} material={fillMat} />}
      {lidGeo && <mesh geometry={lidGeo} material={lidMat} />}
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
        const { weight, opacity, dash, color, fillColor, fillOpacity } = layerStyle(layer.id, p)
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
