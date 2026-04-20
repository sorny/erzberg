/**
 * Renders the ridge-line / curve / hachure / contour geometry as GPU line segments.
 *
 * Uses Three.js LineSegments2 + LineMaterial for cross-browser thick-line support.
 * Per-vertex RGB colors handle gradient, slope-opacity, and stroke-by-elevation effects.
 */
import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useThree } from '@react-three/fiber'
import { SurfaceMesh } from './SurfaceMesh'
import { DASH_CONFIGS } from '../utils/stylePresets'

export function HeightmapLines({ lineGeo, surfaceGeo, p }) {
  const { size } = useThree()

  // LineMaterial — thick lines that work in WebGL2 (created once)
  const lineMaterial = useMemo(() => new LineMaterial({
    linewidth: 1,
    vertexColors: true,
    resolution: new THREE.Vector2(size.width, size.height),
    transparent: true,
    depthWrite: false,
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep material uniforms fresh without recreating it
  useEffect(() => {
    if (!lineMaterial) return
    lineMaterial.linewidth = p.strokeWeight
    lineMaterial.opacity   = p.lineOpacity
    lineMaterial.resolution.set(size.width, size.height)
    const dash = DASH_CONFIGS[p.lineDash ?? 'solid'] ?? DASH_CONFIGS.solid
    lineMaterial.dashed   = dash.dashed
    lineMaterial.dashSize = dash.dashSize
    lineMaterial.gapSize  = dash.gapSize
    lineMaterial.needsUpdate = true
  }, [lineMaterial, p.strokeWeight, p.lineOpacity, p.lineDash, size.width, size.height])

  useEffect(() => () => lineMaterial?.dispose(), [lineMaterial])

  // Build LineSegments2 from CPU arrays; memoised so it only rebuilds when geometry changes
  const lineObject = useMemo(() => {
    if (!lineGeo || lineGeo.positions.length === 0) return null
    const geo = new LineSegmentsGeometry()
    geo.setPositions(lineGeo.positions)
    if (lineGeo.colors && lineGeo.colors.length === lineGeo.positions.length) {
      geo.setColors(lineGeo.colors)
    }
    const lines = new LineSegments2(geo, lineMaterial)
    lines.computeLineDistances()
    return lines
  }, [lineGeo, lineMaterial])

  // Dispose geometry when object changes
  useEffect(() => () => lineObject?.geometry?.dispose(), [lineObject])

  return (
    <group>
      {/* Terrain surface — writes depth buffer for ridge-line occlusion */}
      <SurfaceMesh surfaceGeo={surfaceGeo} p={p} />

      {/* Line art — drawn on top, respects depth from surface */}
      {p.showLines && lineObject && (
        <primitive object={lineObject} />
      )}
    </group>
  )
}
