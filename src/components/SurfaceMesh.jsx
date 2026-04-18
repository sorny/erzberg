/**
 * Terrain surface mesh.
 *
 * Elevation is baked into positions by buildSurfaceGeometry, so the vertex
 * shader here is identity (no displacement). This means wireframe and any
 * other material overlaid on the same geometry are always at the correct
 * elevation — the previous shader-displacement approach broke wireframe.
 *
 * Roles:
 *   1. Depth-write occluder — always rendered (even when fill is off),
 *      colored bgColor so it is invisible against the background.
 *   2. Fill — when showFill is on, colored white or gradient.
 *   3. Mesh  — wireframe LineSegments overlay (separate material, same geo).
 */
import { useMemo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { hexToRgb, sampleGradient } from '../utils/colorUtils'

// ── Shaders ───────────────────────────────────────────────────────────────────
// Vertex: identity — positions already have correct Y elevation.
const SURFACE_VERT = /* glsl */ `
  attribute float brightness;
  varying   float vBrightness;
  void main() {
    vBrightness = brightness;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
// Fragment: bgColor when fill is off, fillColor/gradient when fill is on.
const SURFACE_FRAG = /* glsl */ `
  uniform vec3  uBgColor;
  uniform vec3  uFillLow;
  uniform vec3  uFillHigh;
  uniform bool  uShowFill;
  uniform bool  uGradient;
  varying float vBrightness;

  void main() {
    if (!uShowFill) {
      gl_FragColor = vec4(uBgColor, 1.0);
      return;
    }
    vec3 col = uGradient ? mix(uFillLow, uFillHigh, vBrightness) : uFillLow;
    gl_FragColor = vec4(col, 1.0);
  }
`

// ── Component ─────────────────────────────────────────────────────────────────
export function SurfaceMesh({ surfaceGeo, p }) {
  // Build Three.js geometry from CPU arrays
  const geometry = useMemo(() => {
    if (!surfaceGeo) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position',   new THREE.BufferAttribute(surfaceGeo.positions,    3))
    geo.setAttribute('brightness', new THREE.BufferAttribute(surfaceGeo.brightnessBuf, 1))
    geo.setIndex(new THREE.BufferAttribute(surfaceGeo.indices, 1))
    geo.computeVertexNormals()
    return geo
  }, [surfaceGeo])

  useEffect(() => () => geometry?.dispose(), [geometry])

  // Surface shader material — created once
  const surfMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
    side:           THREE.DoubleSide,
    depthWrite:     true,
    // Push the occluder surface slightly back in depth so coplanar line
    // segments consistently pass the depth test (prevents z-fighting flicker).
    polygonOffset:       true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits:  2,
    uniforms: {
      uBgColor:   { value: new THREE.Vector3(1, 1, 1) },
      uFillLow:   { value: new THREE.Vector3(1, 1, 1) },
      uFillHigh:  { value: new THREE.Vector3(1, 1, 1) },
      uShowFill:  { value: false },
      uGradient:  { value: false },
    },
  }), [])

  // Update uniforms reactively (no material recreation needed)
  useEffect(() => {
    if (!surfMat) return
    const bg = hexToRgb(p.bgColor)
    surfMat.uniforms.uBgColor.value.set(...bg)
    surfMat.uniforms.uShowFill.value = p.showFill
    surfMat.uniforms.uGradient.value = p.lineGradient && p.showFill

    // Fill gradient colors — low = base line color, high = lineColorHigh (or gradient sample)
    const gradStops = p.gradientStops
    if (p.lineGradient && gradStops?.length) {
      const low  = sampleGradient(gradStops, 0)
      const high = sampleGradient(gradStops, 1)
      surfMat.uniforms.uFillLow.value.set(...low)
      surfMat.uniforms.uFillHigh.value.set(...high)
    } else {
      surfMat.uniforms.uFillLow.value.set(1, 1, 1)  // plain white fill
      surfMat.uniforms.uFillHigh.value.set(1, 1, 1)
    }
    surfMat.needsUpdate = true
  }, [surfMat, p.bgColor, p.showFill, p.lineGradient, p.gradientStops])

  useEffect(() => () => surfMat?.dispose(), [surfMat])

  // Wireframe material — plain line material, recolored on change
  const wireMat = useMemo(() => new THREE.MeshBasicMaterial({
    color:               new THREE.Color(p.lineColor),
    wireframe:           true,
    transparent:         true,
    opacity:             0.25,
    depthWrite:          false,
    polygonOffset:       true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits:  1,
  }), []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!wireMat) return
    wireMat.color.set(p.lineColor)
  }, [wireMat, p.lineColor])

  useEffect(() => () => wireMat?.dispose(), [wireMat])

  if (!geometry) return null

  return (
    <group>
      {/* Occluder + optional fill */}
      <mesh geometry={geometry} material={surfMat} />
      {/* Wireframe overlay — only when showMesh is on */}
      {p.showMesh && <mesh geometry={geometry} material={wireMat} />}
    </group>
  )
}
