/**
 * R3F scene.
 *
 * Terrain transforms (tilt, rotation, zoom) are applied to a scene group rather
 * than the camera, matching the original sketch's transform stack:
 *   scale(zoom) → rotateX(tilt) → rotateY(rotation) → terrain
 *
 * OrbitControls handles free camera orbit/pan on top of these transforms.
 * Auto-rotate increments the group rotation in useFrame without touching
 * React state (avoids a setState per frame).
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

  // Rotation refs — driven by sliders when not auto-rotating,
  // accumulated by auto-rotate when active on that axis.
  const xRotRef = useRef(THREE.MathUtils.degToRad(p.tilt     ?? 0))
  const yRotRef = useRef(THREE.MathUtils.degToRad(p.rotation ?? 0))  // rotation slider → Y
  const zRotRef = useRef(0)                                            // auto-rotate Z only

  // Keep manual slider refs in sync (skip if auto-rotating on that axis)
  useEffect(() => {
    if (!p.autoRotate || p.autoRotateAxis !== 'Y') {
      yRotRef.current = THREE.MathUtils.degToRad(p.rotation ?? 0)
    }
  }, [p.rotation, p.autoRotate, p.autoRotateAxis])

  useEffect(() => {
    if (!p.autoRotate || p.autoRotateAxis !== 'X') {
      xRotRef.current = THREE.MathUtils.degToRad(p.tilt ?? 0)
    }
  }, [p.tilt, p.autoRotate, p.autoRotateAxis])

  // Reset accumulated angle when auto-rotate axis changes
  const prevAxisRef = useRef(p.autoRotateAxis ?? 'Y')
  useEffect(() => {
    if (p.autoRotateAxis !== prevAxisRef.current) {
      xRotRef.current = THREE.MathUtils.degToRad(p.tilt     ?? 0)
      yRotRef.current = THREE.MathUtils.degToRad(p.rotation ?? 0)
      zRotRef.current = 0
      prevAxisRef.current = p.autoRotateAxis
    }
  }, [p.autoRotateAxis, p.rotation, p.tilt])

  // Per-frame: apply tilt/rotation/zoom to group; handle auto-rotate
  useFrame((_, delta) => {
    if (!groupRef.current) return

    const step = THREE.MathUtils.degToRad((p.autoRotateSpeed ?? 0.5) * delta * 40) * (p.autoRotateDir ?? 1)

    if (p.autoRotate) {
      const axis = p.autoRotateAxis ?? 'Y'
      if (axis === 'X') xRotRef.current += step
      else if (axis === 'Y') yRotRef.current += step
      else if (axis === 'Z') zRotRef.current += step
    } else {
      xRotRef.current = THREE.MathUtils.degToRad(p.tilt     ?? 0)
      yRotRef.current = THREE.MathUtils.degToRad(p.rotation ?? 0)
      zRotRef.current = 0
    }

    groupRef.current.rotation.x = xRotRef.current
    groupRef.current.rotation.y = yRotRef.current
    groupRef.current.rotation.z = zRotRef.current
    groupRef.current.scale.setScalar(p.zoom ?? 1)

    if (orbitRef.current) orbitRef.current.update()
  })

  // Camera presets
  useEffect(() => {
    if (!cameraPreset?.name) return
    const positions = {
      top:   [0, 1800, 5],
      front: [0, 0,    800],
      iso:   [550, 550, 550],
      reset: [0, 400,  500],
    }
    const [x, y, z] = positions[cameraPreset.name] ?? positions.reset
    camera.position.set(x, y, z)
    camera.lookAt(0, 0, 0)
    if (orbitRef?.current) {
      orbitRef.current.target.set(0, 0, 0)
      orbitRef.current.update()
    }
  }, [cameraPreset]) // eslint-disable-line react-hooks/exhaustive-deps

  // SVG export — software z-buffer occlusion, no GPU readback required
  useEffect(() => {
    if (!svgTrigger) return
    const { width, height } = gl.domElement
    const groupMatrix = groupRef.current ? groupRef.current.matrixWorld.clone() : null
    exportSVG({
      positions: lineGeo.positions,
      colors: lineGeo.colors,
      camera, width, height,
      bgColor: p.bgColor,
      bgGradient: p.bgGradient,
      bgGradientStops,
      lineColor: p.lineColor,
      strokeWeight: p.strokeWeight,
      lineDash: p.lineDash,
      surfaceGeo,
      groupMatrix,
      showLines: p.showLines,
      showFill: p.showFill,
      lineGradient: p.lineGradient,
      gradientStops: p.gradientStops,
      particlePositions: p.showPoints && particleRef.current ? particleRef.current.getPositions() : null,
      particleCount:     p.showPoints && particleRef.current ? particleRef.current.getCount()     : 0,
      particleColor:     p.pointColor ?? p.lineColor,
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
