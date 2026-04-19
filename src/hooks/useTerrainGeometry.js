/**
 * Derives terrain grid and line geometry from the raw heightmap + Leva params.
 *
 * Two memoisation levels:
 *   1. buildTerrain() — only when raw pixels or sampling params change.
 *   2. buildLineGeometry() — when any visual/layout param changes.
 */
import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import { buildTerrain } from '../utils/terrain'
import { buildLineGeometry, buildSurfaceGeometry } from '../utils/geometryBuilders'

export function useTerrainGeometry(p) {
  const { heightmapPixels, heightmapWidth, heightmapHeight } = useStore()

  // Level 1: terrain grid (brightness samples on the scl-grid)
  const terrain = useMemo(() => {
    if (!heightmapPixels) return null
    return buildTerrain(heightmapPixels, heightmapWidth, heightmapHeight, p)
  }, [
    heightmapPixels, heightmapWidth, heightmapHeight,
    p.resolution, p.blurRadius, p.gridOffsetX, p.gridOffsetY,
    p.blackPoint, p.whitePoint, p.elevScale,
  ])

  // Level 2: line geometry (positions + colors for GPU upload)
  const lineGeo = useMemo(() => {
    if (!terrain) return null
    return buildLineGeometry(terrain, p)
  }, [
    terrain,
    p.drawMode, p.lineSpacing, p.hachureLength, p.contourInterval,
    p.flowStep, p.flowMaxLen,
    p.elevMinCut, p.elevMaxCut,
    p.jitterAmt,
    p.lineColor, p.lineGradient, p.gradientStops,
  ])

  // Surface mesh geometry (for fill / depth occlusion)
  const surfaceGeo = useMemo(() => {
    if (!terrain) return null
    return buildSurfaceGeometry(terrain, p.elevScale, p.jitterAmt)
  }, [terrain, p.elevScale, p.jitterAmt])

  return { terrain, lineGeo, surfaceGeo }
}
