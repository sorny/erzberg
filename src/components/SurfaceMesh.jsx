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

// ── Gradient texture ──────────────────────────────────────────────────────────

const GRAD_TEX_SIZE = 256

/** Build a 256×1 RGBA DataTexture from gradient stops. */
function buildGradientTexture(gradientStops) {
  const data = new Uint8Array(GRAD_TEX_SIZE * 4)
  for (let i = 0; i < GRAD_TEX_SIZE; i++) {
    const t = i / (GRAD_TEX_SIZE - 1)
    const [r, g, b] = sampleGradient(gradientStops, t)
    data[i * 4]     = Math.round(r * 255)
    data[i * 4 + 1] = Math.round(g * 255)
    data[i * 4 + 2] = Math.round(b * 255)
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, GRAD_TEX_SIZE, 1, THREE.RGBAFormat)
  tex.needsUpdate = true
  return tex
}

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
// Fragment: bgColor when fill is off; white or full-gradient when fill is on.
const SURFACE_FRAG = /* glsl */ `
  uniform vec3      uBgColor;
  uniform bool      uShowFill;
  uniform bool      uGradient;
  uniform sampler2D uGradientTex;
  varying float     vBrightness;

  void main() {
    if (!uShowFill) {
      gl_FragColor = vec4(uBgColor, 1.0);
      return;
    }
    vec3 col = uGradient
      ? texture2D(uGradientTex, vec2(vBrightness, 0.5)).rgb
      : vec3(1.0);
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

  // Gradient texture — rebuilt whenever gradient stops change
  const gradTexRef = useRef(null)
  const gradientTex = useMemo(() => {
    gradTexRef.current?.dispose()
    const tex = buildGradientTexture(
      p.lineGradient && p.gradientStops?.length > 1
        ? p.gradientStops
        : [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#ffffff' }]
    )
    gradTexRef.current = tex
    return tex
  }, [p.lineGradient, p.gradientStops])

  useEffect(() => () => gradTexRef.current?.dispose(), [])

  // Surface shader material — created once, uniforms updated reactively
  const surfMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
    side:           THREE.DoubleSide,
    depthWrite:     true,
    polygonOffset:       true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits:  2,
    uniforms: {
      uBgColor:     { value: new THREE.Vector3(1, 1, 1) },
      uShowFill:    { value: false },
      uGradient:    { value: false },
      uGradientTex: { value: null },
    },
  }), [])

  // Update uniforms reactively (no material recreation needed)
  useEffect(() => {
    if (!surfMat) return
    const bg = hexToRgb(p.bgColor)
    surfMat.uniforms.uBgColor.value.set(...bg)
    surfMat.uniforms.uShowFill.value = p.showFill
    surfMat.uniforms.uGradient.value = p.lineGradient && p.showFill
    surfMat.needsUpdate = true
  }, [surfMat, p.bgColor, p.showFill, p.lineGradient])

  useEffect(() => {
    if (!surfMat) return
    surfMat.uniforms.uGradientTex.value = gradientTex
    surfMat.needsUpdate = true
  }, [surfMat, gradientTex])

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
