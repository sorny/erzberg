/**
 * R3F scene.
 *
 * Terrain transforms (tilt, rotation, zoom) are applied to a scene group rather
 * than the camera, matching the original sketch's transform stack:
 *   scale(zoom) → rotateX(tilt) → rotateZ(rotation) → terrain
 *
 * OrbitControls handles free camera orbit/pan on top of these transforms.
 * Auto-rotate increments the group Z rotation in useFrame without touching
 * React state (avoids a setState per frame).
 */
import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import * as THREE from 'three'
import { HeightmapLines } from './HeightmapLines'
import { ParticleSystem }  from './ParticleSystem'
import { Controls }        from './Controls'
import { exportSVG }  from '../utils/svgExport'
import { exportDXF }  from '../utils/dxfExport'
import { exportPNG }  from '../utils/pngExport'

export function Scene({
  terrain, lineGeo, surfaceGeo, p,
  levaGet, levaSet, orbitRef,
  svgTrigger, dxfTrigger, pngTrigger,
  webmRecording,
}) {
  const { camera, gl, scene } = useThree()
  const groupRef      = useRef()
  const particleRef   = useRef()
  const zRotRef    = useRef(THREE.MathUtils.degToRad(p.rotation ?? 0))
  const xRotRef    = useRef(THREE.MathUtils.degToRad(p.tilt ?? 0))
  const yRotRef    = useRef(0)
  const prevRotRef = useRef(p.rotation ?? 0)

  // Keep manual-control refs in sync when sliders change (but not while auto-rotating on that axis)
  useEffect(() => {
    if (!p.autoRotate || p.autoRotateAxis !== 'Z') {
      zRotRef.current = THREE.MathUtils.degToRad(p.rotation ?? 0)
    }
    prevRotRef.current = p.rotation ?? 0
  }, [p.rotation, p.autoRotate, p.autoRotateAxis])

  useEffect(() => {
    if (!p.autoRotate || p.autoRotateAxis !== 'X') {
      xRotRef.current = THREE.MathUtils.degToRad(p.tilt ?? 0)
    }
  }, [p.tilt, p.autoRotate, p.autoRotateAxis])

  // Reset accumulated angle when axis changes
  const prevAxisRef = useRef(p.autoRotateAxis ?? 'Z')
  useEffect(() => {
    if (p.autoRotateAxis !== prevAxisRef.current) {
      yRotRef.current = 0
      zRotRef.current = THREE.MathUtils.degToRad(p.rotation ?? 0)
      xRotRef.current = THREE.MathUtils.degToRad(p.tilt ?? 0)
      prevAxisRef.current = p.autoRotateAxis
    }
  }, [p.autoRotateAxis, p.rotation, p.tilt])

  // Per-frame: apply tilt/rotation/zoom to group; handle auto-rotate
  useFrame((_, delta) => {
    if (!groupRef.current) return

    const step = THREE.MathUtils.degToRad((p.autoRotateSpeed ?? 0.5) * delta * 40) * (p.autoRotateDir ?? 1)

    if (p.autoRotate) {
      const axis = p.autoRotateAxis ?? 'Y'
      if (axis === 'Z') zRotRef.current += step
      else if (axis === 'X') xRotRef.current += step
      else if (axis === 'Y') yRotRef.current += step
    } else {
      zRotRef.current = THREE.MathUtils.degToRad(p.rotation ?? 0)
      xRotRef.current = THREE.MathUtils.degToRad(p.tilt ?? 0)
      yRotRef.current = 0
    }

    groupRef.current.rotation.x = xRotRef.current
    groupRef.current.rotation.y = yRotRef.current
    groupRef.current.rotation.z = zRotRef.current
    groupRef.current.scale.setScalar(p.zoom ?? 1)

    if (orbitRef.current) orbitRef.current.update()
  })

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

  // DXF export
  useEffect(() => {
    if (!dxfTrigger || !lineGeo) return
    exportDXF({ positions: lineGeo.positions, camera })
  }, [dxfTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  // PNG export — trimmed to content bounding box
  useEffect(() => {
    if (!pngTrigger) return
    gl.render(scene, camera)
    exportPNG(gl.domElement, p.bgColor)
  }, [pngTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

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

function triggerDownload(dataURL, filename) {
  Object.assign(document.createElement('a'), {
    href: dataURL, download: filename,
  }).click()
}
