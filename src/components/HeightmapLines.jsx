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

function LineLayer({ layer, depthOcclusion, occlusionOpacity, occlusionColor, resolution }) {
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
          resolution={resolution} 
        />
      ))}
    </group>
  )
}
