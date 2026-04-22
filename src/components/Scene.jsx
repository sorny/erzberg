/**
 * R3F scene.
 *
 * Rotation logic:
 * To keep the XYZ orientation gizmo in sync with the terrain, we manipulate the
 * CAMERA position/rotation rather than the terrain group.
 * Tilt and Rotation sliders drive the camera's spherical coordinates around [0,0,0].
 */
import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport, PerspectiveCamera, OrthographicCamera } from '@react-three/drei'
import * as THREE from 'three'
import { HeightmapLines } from './HeightmapLines'
import { ParticleSystem }  from './ParticleSystem'
import { Controls }        from './Controls'
import { exportSVG }              from '../utils/svgExport'
import { captureAndExportPNG } from '../utils/pngExport'

export function Scene({
  terrain, lineGeo, surfaceGeo, p,
  levaGet, levaSet, orbitRef,
  svgTrigger, pngTrigger, pngAlphaTrigger,
  bgGradientStops,
  cameraPreset,
  webmRecording,
}) {
  const { camera: currentCamera, gl, scene, size } = useThree()
  const groupRef    = useRef()
  const particleRef = useRef()
  const persRef     = useRef()
  const orthoRef    = useRef()

  const activeCamera = p.orthographic ? orthoRef.current : persRef.current
  const set = useThree((s) => s.set)

  useEffect(() => {
    if (activeCamera) {
      set({ camera: activeCamera })
    }
  }, [p.orthographic, activeCamera, set])

  // We use a spherical coordinate system for the camera to keep it "orbiting" the center
  const BASE_DIST = 800
  
  const updateCameraFromSliders = (tiltDeg, rotationDeg, zoom, px, py) => {
    if (!activeCamera) return
    
    // For Perspective, distance changes. 
    // For Orthographic, distance should be constant to avoid clipping/z-issues, 
    // but the .zoom property is what actually scales the view.
    const dist = p.orthographic ? BASE_DIST : (BASE_DIST / zoom)
    const phi = THREE.MathUtils.degToRad(tiltDeg)
    const theta = THREE.MathUtils.degToRad(rotationDeg)

    const target = new THREE.Vector3(px || 0, 0, py || 0)
    activeCamera.position.setFromSphericalCoords(dist, phi, theta).add(target)
    activeCamera.lookAt(target)

    if (p.orthographic) {
      activeCamera.zoom = zoom * 2
      activeCamera.updateProjectionMatrix()
    }

    if (orbitRef.current) {
      orbitRef.current.target.copy(target)
      orbitRef.current.update()
    }
  }

  useEffect(() => {
    updateCameraFromSliders(p.tilt, p.rotation, p.zoom, p.panX, p.panY)
  }, [p.tilt, p.rotation, p.zoom, p.orthographic, activeCamera])

  useFrame((_, delta) => {
    if (!p.autoRotate) return
    const step = (p.autoRotateSpeed ?? 0.5) * delta * 40 * (p.autoRotateDir ?? 1)
    levaSet({ rotation: p.rotation + step })
  })

  useEffect(() => {
    if (!cameraPreset?.name) return
    if (orbitRef?.current) {
      orbitRef.current.target.set(p.panX || 0, 0, p.panY || 0)
      orbitRef.current.update()
    }
  }, [cameraPreset, p.panX, p.panY])

  const handleOrbitChange = () => {
    if (!orbitRef.current || !activeCamera) return
    const target = orbitRef.current.target
    const relativePos = activeCamera.position.clone().sub(target)
    const sph = new THREE.Spherical().setFromVector3(relativePos)
    
    const tilt = THREE.MathUtils.radToDeg(sph.phi)
    const rotation = THREE.MathUtils.radToDeg(sph.theta)
    
    // Calculate zoom based on camera type
    const zoom = p.orthographic 
      ? (activeCamera.zoom / 2) 
      : (BASE_DIST / sph.radius)

    const panX = target.x
    const panY = target.z

    if (Math.abs(tilt - p.tilt) > 0.1 || Math.abs(rotation - p.rotation) > 0.1 || 
        Math.abs(zoom - p.zoom) > 0.001 || Math.abs(panX - (p.panX || 0)) > 1 || Math.abs(panY - (p.panY || 0)) > 1) {
      levaSet({ tilt, rotation, zoom, panX, panY })
    }
  }


  // ── High-Res Offscreen Render Pass ──────────────────────────────────────────
  const performHighResCapture = (isAlpha) => {
    const cam = activeCamera || currentCamera
    // 1. Store current GL state
    const oldClearColor = new THREE.Color()
    gl.getClearColor(oldClearColor)
    const oldAlpha = gl.getClearAlpha()
    const oldPixelRatio = gl.getPixelRatio()
    const oldSize = new THREE.Vector2()
    gl.getSize(oldSize)

    // 2. Scale up for capture (e.g. 4x viewport or fixed 4k)
    const captureScale = 4.0
    const targetW = oldSize.x * captureScale
    const targetH = oldSize.y * captureScale
    
    gl.setSize(targetW, targetH, false)
    gl.setPixelRatio(1)

    // 3. Set transparent background for native alpha capture
    gl.setClearColor(0x000000, 0) 
    
    // 4. Force a render pass
    gl.render(scene, cam)

    // 5. Send the rendered buffer to our export utility
    captureAndExportPNG(gl.domElement, p.bgColor, p.bgGradient ? bgGradientStops : null, isAlpha)

    // 6. Restore original state
    gl.setClearColor(oldClearColor, oldAlpha)
    gl.setPixelRatio(oldPixelRatio)
    gl.setSize(oldSize.x, oldSize.y, true)
  }

  // SVG export
  useEffect(() => {
    if (!svgTrigger) return
    const { width, height } = gl.domElement
    const groupMatrix = groupRef.current ? groupRef.current.matrixWorld.clone() : null
    exportSVG({
      lineGeo, camera: activeCamera || currentCamera, width, height,
      bgColor: p.bgColor, bgGradient: p.bgGradient, bgGradientStops,
      surfaceGeo, groupMatrix,
      showFill: p.showFill, fillHypsometric: p.fillHypsometric, gradientStops: p.gradientStops,
      showLines: p.showLines, depthOcclusion: p.depthOcclusion,
      occlusionBias: p.occlusionBias, occlusionOpacity: p.occlusionOpacity, occlusionColor: p.occlusionColor,
      elevMinCut: p.elevMinCut, elevMaxCut: p.elevMaxCut,
      particlePositions: p.showPoints && particleRef.current ? particleRef.current.getPositions() : null,
      particleCount:     p.showPoints && particleRef.current ? particleRef.current.getCount()     : 0,
      particleColor:     p.pointColor ?? '#000000',
      particleSize:      p.pointSize ?? 4,
    })
  }, [svgTrigger, activeCamera])

  // PNG exports
  useEffect(() => { if (pngTrigger) performHighResCapture(false) }, [pngTrigger, activeCamera])
  useEffect(() => { if (pngAlphaTrigger) performHighResCapture(true) }, [pngAlphaTrigger, activeCamera])

  return (
    <>
      {p.orthographic ? (
        <OrthographicCamera 
          ref={orthoRef} 
          makeDefault 
          zoom={p.zoom * 2} 
          near={1} 
          far={50000} 
          position={[0, 400, 500]} 
        />
      ) : (
        <PerspectiveCamera 
          ref={persRef} 
          makeDefault 
          fov={p.fov} 
          near={1} 
          far={50000} 
          position={[0, 400, 500]} 
        />
      )}

      <OrbitControls ref={orbitRef} camera={activeCamera || currentCamera} enableDamping dampingFactor={0.08} makeDefault onChange={handleOrbitChange} />
      <Controls levaGet={levaGet} levaSet={levaSet} orbitRef={orbitRef} />
      {!webmRecording && (
        <GizmoHelper alignment="bottom-left" margin={[72, 72]}>
          <GizmoViewport axisColors={['#e05555', '#55bb55', '#5588dd']} labelColor="#ffffff" />
        </GizmoHelper>
      )}
      <group ref={groupRef}>
        <HeightmapLines lineGeo={lineGeo} surfaceGeo={surfaceGeo} p={p} />
        <ParticleSystem ref={particleRef} terrain={terrain} p={p} />
      </group>
    </>
  )
}
