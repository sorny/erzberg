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
const SURFACE_VERT = /* glsl */ `
  attribute float brightness;
  varying float vBrightness;
  varying vec3  vNormal;
  void main() {
    vBrightness = brightness;
    vNormal     = normalMatrix * normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const SURFACE_FRAG = /* glsl */ `
  uniform vec3      uFillColor;
  uniform bool      uGradient;
  uniform bool      uRawTerrain;
  uniform sampler2D uGradientTex;
  uniform bool      uHypsometricBanded;
  uniform float     uContourInterval;
  uniform float     uHypsoWeight;
  uniform float     uElevScale;
  uniform int       uColorMode; // 0=Elevation, 1=Slope, 2=Aspect
  uniform bool      uOcclusionOnly;
  varying float     vBrightness;
  varying vec3      vNormal;

  void main() {
    if (uOcclusionOnly) {
      // Discarding fragments still writes to the depth buffer if depthWrite is true.
      // Wait, discarding fragments might skip depth write on some GPUs. 
      // Better way: use colorWrite = false on the material level.
    }
    vec3 n = normalize(vNormal);
    float b = vBrightness;

    if (uColorMode == 1) {
      // Slope: 0 (flat) to 1 (vertical)
      b = clamp(1.0 - n.y, 0.0, 1.0);
    } else if (uColorMode == 2) {
      // Aspect: 0 to 1 based on compass direction
      b = atan(n.z, n.x) / 3.14159265 * 0.5 + 0.5;
    }
    
    float lineMask = 0.0;

    if (uHypsometricBanded) {
      // For Slope/Aspect, we quantize the value directly 0..1
      // For Elevation, we use the real-world units
      if (uColorMode == 0) {
        float elev = (vBrightness - 0.5) * 100.0 * uElevScale;
        if (uHypsoWeight > 0.0) {
          float fw = fwidth(elev);
          float dist = mod(elev + uContourInterval * 0.5, uContourInterval) - uContourInterval * 0.5;
          lineMask = 1.0 - smoothstep(uHypsoWeight * fw * 0.5, uHypsoWeight * fw * 1.5, abs(dist));
        }
        float quantizedElev = floor(elev / uContourInterval) * uContourInterval;
        b = (quantizedElev / (100.0 * uElevScale)) + 0.5;
      } else {
        // Simple 0..1 quantization for Slope/Aspect
        float steps = 100.0 / uContourInterval; 
        if (uHypsoWeight > 0.0) {
          float fw = fwidth(b * steps);
          float dist = mod(b * (steps + 1e-5), 1.0) - 0.5;
          lineMask = 1.0 - smoothstep(uHypsoWeight * fw * 0.5, uHypsoWeight * fw * 1.5, abs(dist));
        }
        b = floor(b * steps) / steps;
      }
      b = clamp(b, 0.0, 1.0);
    }

    vec3 base;
    if (uRawTerrain) {
      vec3 light1 = normalize(vec3(1.0,  2.0, 1.5));
      vec3 light2 = normalize(vec3(-0.5, 0.5, -1.0));
      float diff  = max(dot(n, light1), 0.0) * 0.7
                  + max(dot(n, light2), 0.0) * 0.15;
      base = (uGradient || uHypsometricBanded)
        ? texture2D(uGradientTex, vec2(b, 0.5)).rgb
        : uFillColor;
      base *= (0.2 + diff);
    } else {
      base = (uGradient || uHypsometricBanded)
        ? texture2D(uGradientTex, vec2(b, 0.5)).rgb
        : uFillColor;
    }

    // Apply dark contour lines
    if (uHypsometricBanded && uHypsoWeight > 0.0) {
      base = mix(base, vec3(0.0), lineMask * 0.5);
    }

    gl_FragColor = vec4(base, 1.0);
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
      p.fillHypsometric && p.gradientStops?.length > 1
        ? p.gradientStops
        : [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#ffffff' }]
    )
    gradTexRef.current = tex
    return tex
  }, [p.fillHypsometric, p.gradientStops])

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
      uFillColor:         { value: new THREE.Vector3(1, 1, 1) },
      uGradient:          { value: false },
      uRawTerrain:        { value: false },
      uGradientTex:       { value: null },
      uHypsometricBanded: { value: false },
      uContourInterval:   { value: 1.0 },
      uHypsoWeight:       { value: 0.0 },
      uElevScale:         { value: 1.0 },
      uColorMode:         { value: 0 },
    },
  }), [])

  // Update uniforms reactively (no material recreation needed)
  useEffect(() => {
    if (!surfMat) return
    const hasHypso = p.fillHypsometric
    const isBanded = hasHypso && p.fillBanded
    
    surfMat.uniforms.uFillColor.value.set(...hexToRgb(p.fillColor ?? '#ffffff'))
    // uGradient handles the "Smooth" look when not banded
    surfMat.uniforms.uGradient.value = hasHypso && !isBanded
    surfMat.uniforms.uRawTerrain.value = p.showRawTerrain ?? false
    surfMat.uniforms.uHypsometricBanded.value = isBanded
    surfMat.uniforms.uContourInterval.value = p.fillHypsoInterval || 10.0
    surfMat.uniforms.uHypsoWeight.value = p.fillHypsoWeight || 0.0
    surfMat.uniforms.uElevScale.value = p.elevScale || 1.0

    const modeMap = { elevation: 0, slope: 1, aspect: 2 }
    surfMat.uniforms.uColorMode.value = modeMap[p.fillHypsoMode] ?? 0
    
    // Always write color if either fill or raw terrain is on
    surfMat.colorWrite = !!(p.showFill || p.showRawTerrain)
    
    // Manage depth behavior: 
    // We only want the surface to act as an occluder if depthOcclusion is ON.
    surfMat.depthTest  = !!p.depthOcclusion
    surfMat.depthWrite = !!p.depthOcclusion

    surfMat.needsUpdate = true
  }, [surfMat, p.fillColor, p.showFill, p.fillHypsometric, p.fillBanded, p.showRawTerrain, p.fillHypsoInterval, p.fillHypsoWeight, p.elevScale, p.fillHypsoMode, p.depthOcclusion])

  useEffect(() => {
    if (!surfMat) return
    surfMat.uniforms.uGradientTex.value = gradientTex
    surfMat.needsUpdate = true
  }, [surfMat, gradientTex])

  useEffect(() => () => surfMat?.dispose(), [surfMat])

  // Wireframe material — plain line material, recolored on change
  const wireMat = useMemo(() => new THREE.MeshBasicMaterial({
    color:               new THREE.Color(p.meshColor ?? '#888888'),
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
    wireMat.color.set(p.meshColor ?? '#888888')
  }, [wireMat, p.meshColor])

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
