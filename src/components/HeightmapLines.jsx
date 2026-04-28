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

function LineLayer({ layer, depthOcclusion, occlusionOpacity, occlusionColor, occlusionBias, resolution, tilt }) {
  const { positions, colors, weight, opacity, dash } = layer
  
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

  const curtainGeo = useMemo(() => {
    if (!layer.curtains || layer.curtains.positions.length === 0) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(layer.curtains.positions, 3))
    geo.setIndex(new THREE.BufferAttribute(layer.curtains.indices, 1))
    return geo
  }, [layer.curtains])

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
    lidMat.opacity   = opacity ?? 1
    lidMat.depthTest = !!depthOcclusion
    lidMat.needsUpdate = true
  }, [lidMat, opacity, depthOcclusion])

  // ── Main (Visible) Pass ───────────────────────────────────────────────────
  const material = useMemo(() => new LineMaterial({
    linewidth: weight || 1,
    vertexColors: true,
    resolution,
    transparent: true,
    depthWrite: false,
    depthTest: !!depthOcclusion,
    depthFunc: THREE.LessEqualDepth,
    opacity: opacity ?? 1,
  }), [])

  const lines = useMemo(() => {
    if (!geometry) return null
    return new LineSegments2(geometry, material)
  }, [geometry, material])

  // ── Ghost (Hidden) Pass ───────────────────────────────────────────────────
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
    
    const d = DASH_CONFIGS[dash ?? 'solid'] ?? DASH_CONFIGS.solid
    material.dashed = d.dashed
    material.dashSize = d.dashSize
    material.gapSize = d.gapSize
    material.needsUpdate = true

    lines.computeLineDistances()

    if (ghostLines) {
      ghostMaterial.linewidth = weight || 1
      ghostMaterial.opacity = occlusionOpacity ?? 0
      ghostMaterial.color.set(occlusionColor || '#000000')
      ghostMaterial.resolution.copy(resolution)
      ghostMaterial.dashed = d.dashed
      ghostMaterial.dashSize = d.dashSize
      ghostMaterial.gapSize = d.gapSize
      ghostMaterial.needsUpdate = true
      ghostLines.computeLineDistances()
    }
  }, [lines, ghostLines, material, ghostMaterial, weight, opacity, dash, depthOcclusion, occlusionOpacity, occlusionColor, resolution])

  useEffect(() => () => {
    material?.dispose()
    ghostMaterial?.dispose()
  }, [material, ghostMaterial])

  if (!lines) return null

  return (
    <group>
      {curtainGeo && depthOcclusion && <mesh geometry={curtainGeo} material={curtainMat} />}
      {lidGeo && <mesh geometry={lidGeo} material={lidMat} />}
      {ghostLines && <primitive object={ghostLines} />}
      <primitive object={lines} />
    </group>
  )
}

export function HeightmapLines({ lineGeo, surfaceGeo, p }) {
  const { size } = useThree()
  const resolution = useMemo(() => new THREE.Vector2(size.width, size.height), [size.width, size.height])

  return (
    <group>
      <SurfaceMesh surfaceGeo={surfaceGeo} p={p} />

      {p.showLines && Array.isArray(lineGeo) && lineGeo.map(layer => (
        <LineLayer 
          key={layer.id} 
          layer={layer} 
          depthOcclusion={p.depthOcclusion} 
          occlusionOpacity={p.occlusionOpacity}
          occlusionColor={p.occlusionColor}
          occlusionBias={p.occlusionBias}
          resolution={resolution} 
          tilt={p.tilt}
        />
      ))}
    </group>
  )
}
