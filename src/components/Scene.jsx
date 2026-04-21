/**
 * R3F scene.
 *
 * Rotation logic:
 * To keep the XYZ orientation gizmo in sync with the terrain, we manipulate the
 * CAMERA position/rotation rather than the terrain group.
 * Tilt and Rotation sliders drive the camera's spherical coordinates around [0,0,0].
 */
import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import * as THREE from 'three'
import { HeightmapLines } from './HeightmapLines'
import { ParticleSystem }  from './ParticleSystem'
import { Controls }        from './Controls'
import { exportSVG }              from '../utils/svgExport'
import { exportPNG, exportPNGAlpha } from '../utils/pngExport'

export function Scene({
  terrain, lineGeo, surfaceGeo, p,
  levaGet, levaSet, orbitRef,
  svgTrigger, pngTrigger, pngAlphaTrigger,
  bgGradientStops,
  cameraPreset,
  webmRecording,
}) {
  const { camera, gl, scene } = useThree()
  const groupRef    = useRef()
  const particleRef = useRef()

  // We use a spherical coordinate system for the camera to keep it "orbiting" the center
  // distance is derived from p.zoom
  const BASE_DIST = 800
  
  const updateCameraFromSliders = (tiltDeg, rotationDeg, zoom) => {
    const dist = (BASE_DIST / zoom)
    const phi = THREE.MathUtils.degToRad(tiltDeg)       // polar angle (0 = top)
    const theta = THREE.MathUtils.degToRad(rotationDeg) // azimuthal angle

    // Spherical to Cartesian (Y is UP)
    // We want tilt=0 to be Y-up, looking down.
    // In Three.js Spherical: phi=0 is +Y axis.
    camera.position.setFromSphericalCoords(dist, phi, theta)
    camera.lookAt(0, 0, 0)
    if (orbitRef.current) orbitRef.current.update()
  }

  // Sync camera when Tilt, Rotation, or Zoom changes (manually or via auto-rotate)
  useEffect(() => {
    updateCameraFromSliders(p.tilt, p.rotation, p.zoom)
  }, [p.tilt, p.rotation, p.zoom])

  // Handle auto-rotate (Y-axis only)
  useFrame((_, delta) => {
    if (!p.autoRotate) return
    const step = (p.autoRotateSpeed ?? 0.5) * delta * 40 * (p.autoRotateDir ?? 1)
    levaSet({ rotation: p.rotation + step })
  })

  // Camera presets
  useEffect(() => {
    if (!cameraPreset?.name) return
    // App.jsx already updated the p.tilt and p.rotation state, 
    // which triggers the useEffect above to position the camera.
    if (orbitRef?.current) {
      orbitRef.current.target.set(0, 0, 0)
      orbitRef.current.update()
    }
  }, [cameraPreset])

  // Sync state back from OrbitControls when user drags
  const handleOrbitChange = () => {
    if (!orbitRef.current) return
    const sph = new THREE.Spherical().setFromVector3(camera.position)
    
    // Convert back to degrees for the sliders
    const tilt = THREE.MathUtils.radToDeg(sph.phi)
    const rotation = THREE.MathUtils.radToDeg(sph.theta)
    const zoom = BASE_DIST / sph.radius

    // We only update if the difference is significant to avoid feedback loops
    if (Math.abs(tilt - p.tilt) > 0.1 || Math.abs(rotation - p.rotation) > 0.1 || Math.abs(zoom - p.zoom) > 0.01) {
      levaSet({ tilt, rotation, zoom })
    }
  }

  // SVG export — software z-buffer occlusion, no GPU readback required
  useEffect(() => {
    if (!svgTrigger) return
    const { width, height } = gl.domElement
    const groupMatrix = groupRef.current ? groupRef.current.matrixWorld.clone() : null
    exportSVG({
      lineGeo,
      camera, width, height,
      bgColor: p.bgColor,
      bgGradient: p.bgGradient,
      bgGradientStops,
      surfaceGeo,
      groupMatrix,
      showFill: p.showFill,
      fillHypsometric: p.fillHypsometric,
      gradientStops: p.gradientStops,
      showLines: p.showLines,
      depthOcclusion: p.depthOcclusion,
      occlusionBias: p.occlusionBias,
      occlusionOpacity: p.occlusionOpacity,
      occlusionColor: p.occlusionColor,
      elevMinCut: p.elevMinCut,
      elevMaxCut: p.elevMaxCut,
      particlePositions: p.showPoints && particleRef.current ? particleRef.current.getPositions() : null,
      particleCount:     p.showPoints && particleRef.current ? particleRef.current.getCount()     : 0,
      particleColor:     p.pointColor ?? '#000000',
      particleSize:      p.pointSize ?? 4,
    })
  }, [svgTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  // PNG export — trimmed to content bounding box
  useEffect(() => {
    if (!pngTrigger) return
    gl.render(scene, camera)
    exportPNG(gl.domElement, p.bgColor, p.bgGradient ? bgGradientStops : null)
  }, [pngTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  // PNG alpha export — transparent background
  useEffect(() => {
    if (!pngAlphaTrigger) return
    gl.render(scene, camera)
    exportPNGAlpha(gl.domElement, p.bgColor, p.bgGradient)
  }, [pngAlphaTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <OrbitControls
        ref={orbitRef}
        enableDamping
        dampingFactor={0.08}
        makeDefault
        onChange={handleOrbitChange}
      />

      <Controls levaGet={levaGet} levaSet={levaSet} orbitRef={orbitRef} />

      {/* 3-D orientation gizmo — bottom-left, hidden during WebM recording */}
      {!webmRecording && (
        <GizmoHelper alignment="bottom-left" margin={[72, 72]}>
          <GizmoViewport
            axisColors={['#e05555', '#55bb55', '#5588dd']}
            labelColor="#ffffff"
          />
        </GizmoHelper>
      )}

      <group ref={groupRef}>
        <HeightmapLines lineGeo={lineGeo} surfaceGeo={surfaceGeo} p={p} />
        <ParticleSystem ref={particleRef} terrain={terrain} p={p} />
      </group>
    </>
  )
}
