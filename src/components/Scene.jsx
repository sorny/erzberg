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
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { captureAndExportPNG } from '../utils/pngExport'
import { exportSVG } from '../utils/svgExport'
import { hasFillLayer, layerStyle } from '../utils/geometryBuilders'
import { frameRect, insetRect, paperAspect } from '../utils/frame'
import { Controls } from './Controls'
import { HeightmapLines } from './HeightmapLines'
import { ParticleSystem } from './ParticleSystem'

/**
 * The largest point sprite this GPU will draw, from ALIASED_POINT_SIZE_RANGE.
 * Infinity if the context cannot be reached, which leaves the exporter
 * unclamped — the behaviour before this was known about, and the safe fallback.
 */
function maxPointSize(renderer) {
  try {
    const ctx = renderer?.getContext?.()
    const range = ctx?.getParameter?.(ctx.ALIASED_POINT_SIZE_RANGE)
    return range?.[1] ?? Infinity
  } catch { return Infinity }
}

export function Scene({
  terrain, lineGeo, surfaceGeo, p,
  getParams, setParams, orbitRef,
  svgTrigger, onSvgDone, pngTrigger, pngAlphaTrigger,
  bgGradientStops,
  cameraPreset,
  webmRecording,
  exportBaseName,
  profileClickRef,
  audioLive,
}) {
  const { camera: currentCamera, gl, scene, size, invalidate } = useThree()
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
  
  // px/py are the two ground-plane axes (world X and Z — the panel calls them
  // Pan X and Pan Y); pz raises the orbit target off the ground (world Y).
  const updateCameraFromSliders = (tiltDeg, rotationDeg, zoom, px, py, pz) => {
    if (!activeCamera) return
    
    // For Perspective, distance changes. 
    // For Orthographic, distance should be constant to avoid clipping/z-issues, 
    // but the .zoom property is what actually scales the view.
    const dist = p.orthographic ? BASE_DIST : (BASE_DIST / zoom)
    // Clamp phi away from 0 to avoid spherical coord singularity at top-down view
    // (setFromSphericalCoords collapses theta when phi=0, making rotation invisible)
    const phi = THREE.MathUtils.degToRad(Math.max(tiltDeg, 0.001))
    const theta = THREE.MathUtils.degToRad(rotationDeg)

    const target = new THREE.Vector3(px || 0, pz || 0, py || 0)
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

  // ── Camera ⇄ React-state sync ────────────────────────────────────────────
  // OrbitControls moves the camera directly (the fast path). Mirroring camera
  // values into React state re-renders the entire app (Sidebar included), so:
  //  • the orbit → state sync is throttled to a trailing tick during gestures
  //    (plus an immediate sync on gesture end), instead of firing per frame;
  //  • state → camera updates that are pure echoes of an orbit sync are
  //    detected via orbitEchoRef and skipped, so the camera is never snapped
  //    back to slightly stale values mid-gesture.
  const ORBIT_SYNC_MS = 150
  const orbitEchoRef   = useRef(null)
  const orbitSyncTimer = useRef(0)
  const autoRotRef     = useRef(p.rotation)
  const pRef = useRef(p)
  pRef.current = p

  useEffect(() => {
    const echo = orbitEchoRef.current
    orbitEchoRef.current = null // single-use: only the commit it announced may skip
    if (echo && echo.cam === activeCamera &&
        echo.tilt === p.tilt && echo.rotation === p.rotation && echo.zoom === p.zoom &&
        echo.panX === (p.panX ?? 0) && echo.panY === (p.panY ?? 0) &&
        echo.panZ === (p.panZ ?? 0)) {
      return // echo of an orbit-driven sync — the camera is already there
    }
    autoRotRef.current = p.rotation
    updateCameraFromSliders(p.tilt, p.rotation, p.zoom, p.panX, p.panY, p.panZ)
  }, [p.tilt, p.rotation, p.zoom, p.panX, p.panY, p.panZ, p.orthographic, activeCamera])

  useFrame(({ invalidate }, delta) => {
    if (!p.autoRotate) return
    // Drive the camera directly — routing the rotation through setParams would
    // re-render the whole app every frame. The orbit controls' change event
    // (fired by updateCameraFromSliders → orbit.update()) keeps React state
    // following at the throttled sync rate.
    autoRotRef.current += (p.autoRotateSpeed ?? 0.5) * delta * 40 * (p.autoRotateDir ?? 1)
    updateCameraFromSliders(p.tilt, autoRotRef.current, p.zoom, p.panX, p.panY, p.panZ)
    invalidate()  // keep the on-demand loop running while auto-rotating
  })

  // WebM capture reads the live canvas via captureStream; under on-demand
  // rendering we must keep drawing frames for the whole recording, even if no
  // other animation is active.
  useEffect(() => {
    if (!webmRecording) return
    let raf
    const loop = () => { invalidate(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [webmRecording, invalidate])

  useEffect(() => {
    if (!cameraPreset?.name) return
    if (orbitRef?.current) {
      orbitRef.current.target.set(p.panX || 0, p.panZ || 0, p.panY || 0)
      orbitRef.current.update()
    }
  }, [cameraPreset, p.panX, p.panY, p.panZ])

  const syncOrbitToState = () => {
    if (!orbitRef.current || !activeCamera) return
    const pc = pRef.current
    const target = orbitRef.current.target
    const relativePos = activeCamera.position.clone().sub(target)
    const sph = new THREE.Spherical().setFromVector3(relativePos)

    // Quantised to the granularity the sidebar controls actually have — tilt and
    // rotation step by 0.1°, the pans by 1 unit.
    //
    // The camera is continuous and these sliders are not, and writing a raw
    // float into a control that cannot represent it breaks twice over. It
    // *reads* wrong: the pan fields have no `fmt`, so a drag left them showing
    // `-247.38194837`. And it *behaves* wrong: `<input type=range step=1>` snaps
    // its value to the step grid, so the thumb sat somewhere the state was not,
    // and the first click on the slider jumped the camera to the snapped value
    // rather than nudging it. Rounding here means state, thumb and camera always
    // agree, and a click moves exactly one step.
    const tilt = Math.round(THREE.MathUtils.radToDeg(sph.phi) * 10) / 10
    const rotation = Math.round(THREE.MathUtils.radToDeg(sph.theta) * 10) / 10

    // Calculate zoom based on camera type. Not quantised: the Zoom slider is a
    // derived percentage of a base this component does not know.
    const zoom = pc.orthographic
      ? (activeCamera.zoom / 2)
      : (BASE_DIST / sph.radius)

    const panX = Math.round(target.x)
    const panY = Math.round(target.z)
    // Read back too, not just written: OrbitControls pans in screen space, so a
    // mouse drag moves the target vertically as well. Before panZ existed that
    // movement was thrown away on the next sync, which snapped the view back to
    // ground level mid-gesture.
    const panZ = Math.round(target.y)

    // Half a step, so a genuine one-step move registers rather than being eaten
    // by the comparison it just became exactly equal to.
    if (Math.abs(tilt - pc.tilt) > 0.05 || Math.abs(rotation - pc.rotation) > 0.05 ||
        Math.abs(zoom - pc.zoom) > 0.001 || Math.abs(panX - (pc.panX || 0)) > 0.5 ||
        Math.abs(panY - (pc.panY || 0)) > 0.5 || Math.abs(panZ - (pc.panZ || 0)) > 0.5) {
      orbitEchoRef.current = { cam: activeCamera, tilt, rotation, zoom, panX, panY, panZ }
      autoRotRef.current = rotation
      setParams({ tilt, rotation, zoom, panX, panY, panZ })
    }
  }

  // change fires every frame during a drag (and during the damping tail) —
  // schedule a trailing sync instead of pushing state per event.
  const handleOrbitChange = () => {
    if (orbitSyncTimer.current) return
    orbitSyncTimer.current = setTimeout(() => {
      orbitSyncTimer.current = 0
      syncOrbitToState()
    }, ORBIT_SYNC_MS)
  }
  const handleOrbitEnd = () => {
    clearTimeout(orbitSyncTimer.current)
    orbitSyncTimer.current = 0
    syncOrbitToState()
  }
  useEffect(() => () => clearTimeout(orbitSyncTimer.current), [])


  // ── High-Res Offscreen Render Pass ──────────────────────────────────────────
  // Uses a WebGLRenderTarget instead of resizing the main GL context, which
  // avoids pixel-ratio / framebuffer-clamping issues that cut off the top of
  // the scene when exporting from a retina display.
  const performHighResCapture = (isAlpha) => {
    const cam = activeCamera || currentCamera
    const vpSize = new THREE.Vector2()
    gl.getSize(vpSize)
    // 4× capture, clamped so the render target never exceeds the GPU's texture
    // limit (large windows would otherwise fail the export silently).
    const maxTex = gl.capabilities.maxTextureSize || 8192
    const captureScale = Math.min(4.0, maxTex / Math.max(vpSize.x, vpSize.y))
    const targetW = Math.round(vpSize.x * captureScale)
    const targetH = Math.round(vpSize.y * captureScale)

    // Offscreen render target — never touches the main framebuffer.
    // samples: 4 enables WebGL2 MSAA so edges are smooth like the main canvas
    // (antialias: true). Three.js resolves the MSAA buffer to the texture
    // automatically at the end of gl.render(), before readRenderTargetPixels.
    const rt = new THREE.WebGLRenderTarget(targetW, targetH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      samples: 4,
      colorSpace: THREE.SRGBColorSpace,
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

    captureAndExportPNG(offscreen, p.bgColor, p.bgGradient ? bgGradientStops : null, isAlpha, exportBaseName)

    // Restore materials and camera
    lineMaterials.forEach(({ mat, oldRes }) => { mat.resolution.copy(oldRes) })
    if (cam.isPerspectiveCamera && oldAspect !== null) {
      cam.aspect = oldAspect
      cam.updateProjectionMatrix()
    }
  }

  // SVG export — setTimeout yields to the browser so the loading overlay can
  // paint before the synchronous exportSVG call blocks the main thread.
  useEffect(() => {
    if (!svgTrigger) return
    const { width, height } = gl.domElement
    const groupMatrix = groupRef.current ? groupRef.current.matrixWorld.clone() : null
    // weight/opacity/dash live in params (not the worker geometry) — resolve per layer id.
    const lineStyles = Array.isArray(lineGeo)
      ? Object.fromEntries(lineGeo.map(l => [l.id, layerStyle(l.id, p)]))
      : {}
    setTimeout(() => {
      exportSVG({
        lineGeo, lineStyles, camera: activeCamera || currentCamera, width, height,
        bgColor: p.bgColor, bgGradient: p.bgGradient, bgGradientStops,
        surfaceGeo, groupMatrix,
        // hasFillLayer, not showFill: the viewport makes the surface a depth
        // occluder for any fill layer — hillshade, AO, water, slope, raw view —
        // and Fill itself is off by default, so gating the export on it alone
        // shipped SVGs whose lines were not hidden behind the terrain.
        surfaceOccludes: hasFillLayer(p),
        depthOcclusion: p.depthOcclusion,
        occlusionBias: p.occlusionBias, occlusionOpacity: p.occlusionOpacity, occlusionColor: p.occlusionColor,
        elevMinCut: p.elevMinCut, elevMaxCut: p.elevMaxCut,
        // Buffer pixels, not CSS — `width`/`height` above come from
        // gl.domElement. The overlay computes the same rect from the CSS size
        // through the same function, which is what keeps the two agreeing
        // across device pixel ratios and supersampling.
        ...(p.showFrame ? (() => {
          const f = frameRect(width, height,
            paperAspect(p.framePaper ?? 'iso', !!p.frameLandscape, p.frameCustomRatio),
            p.frameScale ?? 0.85, p.frameOffsetX ?? 0, p.frameOffsetY ?? 0)
          return { frame: f, frameClip: insetRect(f, p.frameMargin ?? 0) }
        })() : {}),
        particlePositions: p.showPoints && particleRef.current ? particleRef.current.getPositions() : null,
        particleCount:     p.showPoints && particleRef.current ? particleRef.current.getCount()     : 0,
        particleColor:     p.pointColor ?? '#000000',
        particleSize:      p.pointSize ?? 4,
        // The GPU will not draw a point sprite larger than this, so neither may
        // the exporter — see the note in svgExport. `gl` here is three's
        // renderer, so the raw context has to be asked for the limit.
        particleSizeMax:   maxPointSize(gl),
        particleOpacity:   p.pointOpacity ?? 1,
        particleShadows:   p.showPoints && p.flockShadow && particleRef.current ? particleRef.current.getShadows() : null,
        particleShadowLift:    p.showPoints && p.flockShadow && particleRef.current ? particleRef.current.getShadowLift() : null,
        particleShadowColor:   p.flockShadowColor ?? '#000000',
        particleShadowOpacity: p.flockShadowOpacity ?? 0.35,
        particleShadowSize:    (p.pointSize ?? 4) * (p.flockShadowSize ?? 1),
        // Murmuration streaks. Null in hologram mode, and null when the trail
        // length is zero — the flock is dots then, and the circles above are it.
        particleSegments:  p.showPoints && particleRef.current ? particleRef.current.getSegments() : null,
        baseName:          exportBaseName,
      })
      onSvgDone?.()
    }, 0)
  }, [svgTrigger])

  // PNG exports — activeCamera is intentionally excluded from deps. It is a plain
  // local variable (not state) so it changes reference on every render. Including it
  // would re-fire the export whenever any setting causes a re-render after a trigger
  // has been set. The closure already captures the current camera from the same render
  // that incremented the trigger counter, so no staleness risk.
  useEffect(() => { if (pngTrigger)      performHighResCapture(false) }, [pngTrigger])
  useEffect(() => { if (pngAlphaTrigger) performHighResCapture(true)  }, [pngAlphaTrigger])

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
          near={5}
          far={50000}
          position={[0, 400, 500]}
        />
      )}

      {/* near=5 (not 1): with near=1/far=50000 the depth buffer resolves only
          ~0.04 world units at typical viewing distance, so lines vs. their
          occlusion curtains z-fight (sparkle at crossings while orbiting).
          near=5 is 5× finer; the zoom slider bottoms out at ~50 units distance
          and minDistance keeps free scroll-zoom clear of the near plane. */}
      <OrbitControls ref={orbitRef} camera={activeCamera || currentCamera} enableDamping dampingFactor={0.08} minDistance={15} makeDefault onChange={handleOrbitChange} onEnd={handleOrbitEnd} />
      <Controls getParams={getParams} setParams={setParams} orbitRef={orbitRef} />
      {!webmRecording && (
        <GizmoHelper alignment="bottom-left" margin={[72, 72]}>
          <GizmoViewport axisColors={['#e05555', '#55bb55', '#5588dd']} labelColor="#ffffff" />
        </GizmoHelper>
      )}
      <group ref={groupRef}>
        <HeightmapLines lineGeo={lineGeo} surfaceGeo={surfaceGeo} p={p} profileClickRef={profileClickRef} />
        <ParticleSystem ref={particleRef} terrain={terrain} p={p} audioLive={audioLive} />
      </group>
      {/* The sun marks where hillshade is lit from, and raw view is unlit. */}
      {p.showHillshade && p.showSun && !p.showRawTerrain && <SunIndicator p={p} terrain={terrain} />}
    </>
  )
}

// ── Sun orb ───────────────────────────────────────────────────────────────────
function SunIndicator({ p, terrain }) {
  const az  = (p.hillshadeAzimuth  ?? 315) * Math.PI / 180
  const alt = (p.hillshadeAltitude ?? 45)  * Math.PI / 180

  // Keep the sun at ~1.1× halfExtent so it stays within the camera's FOV
  // for all reasonable azimuth/altitude combinations at the default view angle.
  // depthTest: false ensures it's never occluded by terrain geometry.
  const halfExtent = terrain
    ? Math.max(terrain.halfW ?? 100, terrain.halfH ?? 100)
    : 100
  const dist = halfExtent * 1.1

  const pos = useMemo(() => new THREE.Vector3(
    Math.cos(az) * Math.cos(alt) * dist,
    Math.sin(alt) * dist,
    Math.sin(az) * Math.cos(alt) * dist,
  ), [az, alt, dist])

  const r = Math.max(halfExtent * 0.07, 6)

  // Core: saturated amber so it reads against both light and dark backgrounds.
  // Normal blending (no transparency) keeps it fully opaque.
  const coreMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffcc00', depthTest: false, depthWrite: false,
  }), [])
  // Halo: larger, orange-warm, additive blending for glow on dark backgrounds.
  // On light backgrounds the halo is invisible but the core is still clear.
  const haloMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ff8800', transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }), [])
  const rayMat = useMemo(() => new THREE.LineBasicMaterial({
    color: '#ffcc00', depthTest: false, depthWrite: false,
    transparent: true, opacity: 0.7,
  }), [])

  // R3F only auto-disposes objects it created from JSX; materials handed in via
  // the `material` prop are ours to release. The sun toggles on and off freely,
  // so without this each toggle strands three GPU materials.
  useEffect(() => () => {
    coreMat.dispose(); haloMat.dispose(); rayMat.dispose()
  }, [coreMat, haloMat, rayMat])
  // 6 axis-aligned + 8 cube-corner diagonals; each direction emits one segment
  const rayPositions = useMemo(() => {
    const dirs = [
      [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
      [1,1,1],[-1,1,1],[1,-1,1],[-1,-1,1],[1,1,-1],[-1,1,-1],[1,-1,-1],[-1,-1,-1],
    ]
    const inner = r * 1.4, outer = r * 4.5
    const pts = []
    for (const [x, y, z] of dirs) {
      const len = Math.sqrt(x*x + y*y + z*z)
      pts.push(x/len*inner, y/len*inner, z/len*inner, x/len*outer, y/len*outer, z/len*outer)
    }
    return new Float32Array(pts)
  }, [r])

  return (
    <group position={pos}>
      <lineSegments renderOrder={998} material={rayMat}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" array={rayPositions} itemSize={3} count={rayPositions.length / 3} />
        </bufferGeometry>
      </lineSegments>
      <mesh renderOrder={999} material={haloMat}>
        <sphereGeometry args={[r * 2.6, 18, 12]} />
      </mesh>
      <mesh renderOrder={1000} material={coreMat}>
        <sphereGeometry args={[r, 18, 12]} />
      </mesh>
    </group>
  )
}
