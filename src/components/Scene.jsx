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
  const zRotRef       = useRef(THREE.MathUtils.degToRad(p.rotation ?? 0))
  const prevRotRef    = useRef(p.rotation ?? 0)

  // Keep zRotRef in sync when the Leva rotation slider changes (but not from auto-rotate drift)
  useEffect(() => {
    if (!p.autoRotate) {
      zRotRef.current = THREE.MathUtils.degToRad(p.rotation ?? 0)
    }
    prevRotRef.current = p.rotation ?? 0
  }, [p.rotation, p.autoRotate])

  // Per-frame: apply tilt/rotation/zoom to group; handle auto-rotate
  useFrame((_, delta) => {
    if (!groupRef.current) return

    if (p.autoRotate) {
      zRotRef.current += THREE.MathUtils.degToRad((p.autoRotateSpeed ?? 1) * delta * 40)
    } else {
      zRotRef.current = THREE.MathUtils.degToRad(p.rotation ?? 0)
    }

    groupRef.current.rotation.x = THREE.MathUtils.degToRad(p.tilt ?? 0)
    groupRef.current.rotation.z = zRotRef.current
    groupRef.current.scale.setScalar(p.zoom ?? 1)

    if (orbitRef.current) orbitRef.current.update()
  })

  // SVG export
  useEffect(() => {
    if (!svgTrigger || !lineGeo) return
    const { width, height } = gl.domElement
    exportSVG({ positions: lineGeo.positions, colors: lineGeo.colors, camera, width, height,
      bgColor: p.bgColor, lineColor: p.lineColor, strokeWeight: p.strokeWeight })
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
            axisColors={['#ff4444', '#44dd44', '#4488ff']}
            labelColor="#ffffff"
          />
        </GizmoHelper>
      )}

      <group ref={groupRef}>
        <HeightmapLines lineGeo={lineGeo} surfaceGeo={surfaceGeo} p={p} />
        <ParticleSystem terrain={terrain} p={p} />
      </group>
    </>
  )
}

function triggerDownload(dataURL, filename) {
  Object.assign(document.createElement('a'), {
    href: dataURL, download: filename,
  }).click()
}
