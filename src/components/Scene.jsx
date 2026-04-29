/**
 * R3F scene.
 *
 * Rotation logic:
 * To keep the XYZ orientation gizmo in sync with the terrain, we manipulate the
 * CAMERA position/rotation rather than the terrain group.
 * Tilt and Rotation sliders drive the camera's spherical coordinates around [0,0,0].
 */
import { GizmoHelper, GizmoViewport, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { captureAndExportPNG } from '../utils/pngExport'
import { exportSVG } from '../utils/svgExport'
import { Controls } from './Controls'
import { HeightmapLines } from './HeightmapLines'
import { ParticleSystem } from './ParticleSystem'

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
    // Clamp phi away from 0 to avoid spherical coord singularity at top-down view
    // (setFromSphericalCoords collapses theta when phi=0, making rotation invisible)
    const phi = THREE.MathUtils.degToRad(Math.max(tiltDeg, 0.001))
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
  // Uses a WebGLRenderTarget instead of resizing the main GL context, which
  // avoids pixel-ratio / framebuffer-clamping issues that cut off the top of
  // the scene when exporting from a retina display.
  const performHighResCapture = (isAlpha) => {
    const cam = activeCamera || currentCamera
    const captureScale = 4.0
    const vpSize = new THREE.Vector2()
    gl.getSize(vpSize)
    const targetW = Math.round(vpSize.x * captureScale)
    const targetH = Math.round(vpSize.y * captureScale)

    // Offscreen render target — never touches the main framebuffer
    const rt = new THREE.WebGLRenderTarget(targetW, targetH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    })

    // Only update LineMaterial resolution to match the render target dimensions.
    // linewidth is intentionally NOT scaled: the shader formula
    //   pixels_wide = linewidth × renderTargetHeight / resolution.y
    // gives the same on-screen pixel width as the live viewport when resolution
    // is set to (targetW, targetH), because the render target has no implicit DPR.
    // Scaling uSize for particles is also skipped — the point-size shader already
    // handles depth-based scaling, and mutating the shared material reference
    // causes visible bleed into the live viewport after restore.
    const lineMaterials = []
    scene.traverse(obj => {
      if (obj.material?.isLineMaterial) {
        lineMaterials.push({ mat: obj.material, oldRes: obj.material.resolution.clone() })
        obj.material.resolution.set(targetW, targetH)
      }
    })

    // Update camera for the capture aspect ratio
    const oldAspect = cam.isPerspectiveCamera ? cam.aspect : null
    if (cam.isPerspectiveCamera) {
      cam.aspect = targetW / targetH
      cam.updateProjectionMatrix()
    }

    // Render into the offscreen target
    const oldClearColor = new THREE.Color()
    gl.getClearColor(oldClearColor)
    const oldAlpha = gl.getClearAlpha()
    gl.setRenderTarget(rt)
    gl.setClearColor(0x000000, 0)
    gl.clear()
    gl.render(scene, cam)
    gl.setRenderTarget(null)
    gl.setClearColor(oldClearColor, oldAlpha)

    // Read pixels from the render target.
    // WebGL origin is bottom-left; flip vertically so (0,0) is top-left.
    const raw = new Uint8Array(targetW * targetH * 4)
    gl.readRenderTargetPixels(rt, 0, 0, targetW, targetH, raw)
    rt.dispose()

    const flipped = new Uint8Array(targetW * targetH * 4)
    const rowBytes = targetW * 4
    for (let y = 0; y < targetH; y++) {
      flipped.set(raw.subarray((targetH - 1 - y) * rowBytes, (targetH - y) * rowBytes), y * rowBytes)
    }

    // Write into a plain 2D canvas for the export utility
    const offscreen = document.createElement('canvas')
    offscreen.width = targetW
    offscreen.height = targetH
    const offCtx = offscreen.getContext('2d')
    const imgData = offCtx.createImageData(targetW, targetH)
    imgData.data.set(flipped)
    offCtx.putImageData(imgData, 0, 0)

    captureAndExportPNG(offscreen, p.bgColor, p.bgGradient ? bgGradientStops : null, isAlpha)

    // Restore materials and camera
    lineMaterials.forEach(({ mat, oldRes }) => { mat.resolution.copy(oldRes) })
    if (cam.isPerspectiveCamera && oldAspect !== null) {
      cam.aspect = oldAspect
      cam.updateProjectionMatrix()
    }
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
