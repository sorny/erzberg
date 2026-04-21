/**
 * Renders the ridge-line / curve / hachure / contour geometry as GPU line segments.
 */
import { useMemo, useEffect, useState } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useThree } from '@react-three/fiber'
import { SurfaceMesh } from './SurfaceMesh'
import { DASH_CONFIGS } from '../utils/stylePresets'

function LineLayer({ layer, depthOcclusion, resolution }) {
  const { positions, colors, weight, opacity, dash } = layer
  
  const geometry = useMemo(() => {
    const geo = new LineSegmentsGeometry()
    geo.setPositions(positions)
    if (colors && colors.length === positions.length) {
      geo.setColors(colors)
    }
    return geo
  }, [positions, colors])

  useEffect(() => () => geometry?.dispose(), [geometry])

  const material = useMemo(() => new LineMaterial({
    linewidth: weight,
    vertexColors: true,
    resolution,
    transparent: true,
    depthWrite: false,
    depthTest: !!depthOcclusion,
    opacity,
  }), []) // Created once

  useEffect(() => {
    material.linewidth = weight
    material.opacity = opacity
    material.depthTest = !!depthOcclusion
    material.resolution.copy(resolution)
    const d = DASH_CONFIGS[dash ?? 'solid'] ?? DASH_CONFIGS.solid
    material.dashed = d.dashed
    material.dashSize = d.dashSize
    material.gapSize = d.gapSize
    material.needsUpdate = true
  }, [material, weight, opacity, dash, depthOcclusion, resolution])

  useEffect(() => () => material?.dispose(), [material])

  const lines = useMemo(() => {
    const l = new LineSegments2(geometry, material)
    l.computeLineDistances()
    return l
  }, [geometry, material])

  return <primitive object={lines} />
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
          resolution={resolution} 
        />
      ))}
    </group>
  )
}
