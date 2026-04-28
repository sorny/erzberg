/**
 * Terrain surface mesh.
 */
import { useMemo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { hexToRgb, sampleGradient } from '../utils/colorUtils'
import { useStore } from '../store/useStore'

// ── Gradient texture ──────────────────────────────────────────────────────────

const GRAD_TEX_SIZE = 256

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
  varying vec2  vUv;
  void main() {
    vBrightness = brightness;
    vNormal     = normalMatrix * normal;
    vUv         = uv;
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

  uniform sampler2D uOverlayTex;
  uniform bool      uShowTexture;
  uniform float     uTextureScale;
  uniform vec2      uTextureOffset;

  uniform float     uElevMinCut;
  uniform float     uElevMaxCut;

  uniform bool      uHillshade;
  uniform float     uHillshadeAzimuth;
  uniform float     uHillshadeAltitude;
  uniform float     uHillshadeIntensity;
  uniform float     uHillshadeOpacity;
  uniform float     uHillshadeExaggeration;
  uniform vec3      uHillshadeHighlight;
  uniform vec3      uHillshadeShadow;

  uniform bool      uSlopeShade;
  uniform float     uSlopeShadeOpacity;
  uniform vec3      uSlopeColorLow;
  uniform vec3      uSlopeColorHigh;
  varying float     vBrightness;
  varying vec3      vNormal;
  varying vec2      vUv;

  void main() {
    if (vBrightness < uElevMinCut / 100.0 || vBrightness > uElevMaxCut / 100.0) {
      discard;
    }
    if (uOcclusionOnly) {
      // Depth-only pass handled via material.colorWrite
    }
    vec3 n = normalize(vNormal);
    float b = vBrightness;

    if (uColorMode == 1) {
      b = clamp(1.0 - n.y, 0.0, 1.0);
    } else if (uColorMode == 2) {
      b = atan(n.z, n.x) / 3.14159265 * 0.5 + 0.5;
    }
    
    float lineMask = 0.0;

    if (uHypsometricBanded) {
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

    if (uShowTexture) {
      vec2 uv = vUv * uTextureScale + uTextureOffset;
      vec4 texColor = texture2D(uOverlayTex, uv);
      base = mix(base, texColor.rgb, texColor.a);
    }

    if (uHypsometricBanded && uHypsoWeight > 0.0) {
      base = mix(base, vec3(0.0), lineMask * 0.5);
    }

    if (uHillshade) {
      float az  = uHillshadeAzimuth  * 3.14159265 / 180.0;
      float alt = uHillshadeAltitude * 3.14159265 / 180.0;
      vec3 lightDir = normalize(vec3(cos(az) * cos(alt), sin(alt), sin(az) * cos(alt)));
      vec3 exagNormal = normalize(vec3(n.x * uHillshadeExaggeration, n.y, n.z * uHillshadeExaggeration));
      float shade = clamp(dot(exagNormal, lightDir), 0.0, 1.0) * uHillshadeIntensity;
      vec3 shadeColor = mix(uHillshadeShadow, uHillshadeHighlight, shade);
      base = mix(base, shadeColor, uHillshadeOpacity);
    }

    if (uSlopeShade) {
      float slope = clamp(1.0 - n.y, 0.0, 1.0);
      vec3 slopeCol = mix(uSlopeColorLow, uSlopeColorHigh, slope);
      base = mix(base, slopeCol, uSlopeShadeOpacity * slope);
    }

    gl_FragColor = vec4(base, 1.0);
  }
`

// ── Component ─────────────────────────────────────────────────────────────────
export function SurfaceMesh({ surfaceGeo, p }) {
  const textureImage = useStore(s => s.textureImage)

  useEffect(() => {
    if (p.showFill) console.log('[Benchmark] Color Updated: ' + Date.now())
  }, [p.fillColor, p.showFill])

  const geometry = useMemo(() => {
    if (!surfaceGeo) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position',   new THREE.BufferAttribute(surfaceGeo.positions,    3))
    geo.setAttribute('brightness', new THREE.BufferAttribute(surfaceGeo.brightnessBuf, 1))
    
    // Compute UVs for the grid
    const { rows, cols } = surfaceGeo.metadata || { rows: Math.sqrt(surfaceGeo.positions.length/3), cols: Math.sqrt(surfaceGeo.positions.length/3) }
    const uvs = new Float32Array((surfaceGeo.positions.length/3) * 2)
    for(let r=0; r<rows; r++) {
      for(let c=0; c<cols; c++) {
        const i = r * cols + c
        uvs[i*2] = c / (cols - 1)
        uvs[i*2+1] = 1.0 - (r / (rows - 1))
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geo.setIndex(new THREE.BufferAttribute(surfaceGeo.indices, 1))
    geo.computeVertexNormals()
    return geo
  }, [surfaceGeo])

  useEffect(() => () => geometry?.dispose(), [geometry])

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

  const overlayTex = useMemo(() => {
    if (!textureImage) return null
    const loader = new THREE.TextureLoader()
    const tex = loader.load(textureImage)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    return tex
  }, [textureImage])

  const surfMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
    side:           THREE.DoubleSide,
    depthWrite:     true,
    polygonOffset:       true,
    polygonOffsetFactor: p.occlusionBias ?? 2,
    polygonOffsetUnits:  p.occlusionBias ?? 2,
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
      uOcclusionOnly:     { value: false },
      uElevMinCut:        { value: 0.0 },
      uElevMaxCut:        { value: 100.0 },
      uOverlayTex:        { value: null },
      uShowTexture:       { value: false },
      uTextureScale:      { value: 1.0 },
      uTextureOffset:     { value: new THREE.Vector2(0, 0) },
      uHillshade:             { value: false },
      uHillshadeAzimuth:      { value: 315.0 },
      uHillshadeAltitude:     { value: 45.0 },
      uHillshadeIntensity:    { value: 1.0 },
      uHillshadeOpacity:      { value: 0.6 },
      uHillshadeExaggeration: { value: 2.0 },
      uHillshadeHighlight:    { value: new THREE.Vector3(1, 1, 1) },
      uHillshadeShadow:       { value: new THREE.Vector3(0, 0, 0) },
      uSlopeShade:            { value: false },
      uSlopeShadeOpacity:     { value: 0.75 },
      uSlopeColorLow:         { value: new THREE.Vector3(0.525, 0.937, 0.6) },
      uSlopeColorHigh:        { value: new THREE.Vector3(0.863, 0.149, 0.149) },
    },
  }), [])

  useEffect(() => {
    if (!surfMat) return
    const hasHypso = p.fillHypsometric
    const isBanded = hasHypso && p.fillBanded
    
    surfMat.uniforms.uFillColor.value.set(...hexToRgb(p.fillColor ?? '#ffffff'))
    surfMat.uniforms.uGradient.value = hasHypso && !isBanded
    surfMat.uniforms.uRawTerrain.value = p.showRawTerrain ?? false
    surfMat.uniforms.uHypsometricBanded.value = isBanded
    surfMat.uniforms.uContourInterval.value = p.fillHypsoInterval || 10.0
    surfMat.uniforms.uHypsoWeight.value = p.fillHypsoWeight || 0.0
    surfMat.uniforms.uElevScale.value = p.elevScale || 1.0
    surfMat.uniforms.uColorMode.value = { elevation: 0, slope: 1, aspect: 2 }[p.fillHypsoMode] ?? 0
    surfMat.uniforms.uElevMinCut.value = p.elevMinCut || 0.0
    surfMat.uniforms.uElevMaxCut.value = p.elevMaxCut || 100.0
    
    surfMat.uniforms.uShowTexture.value = !!(p.showTexture && overlayTex)
    surfMat.uniforms.uOverlayTex.value = overlayTex
    surfMat.uniforms.uTextureScale.value = 1.0 / (p.textureScale || 1.0)
    surfMat.uniforms.uTextureOffset.value.set(p.textureShiftX || 0, p.textureShiftY || 0)

    surfMat.uniforms.uHillshade.value             = !!(p.showHillshade)
    surfMat.uniforms.uHillshadeAzimuth.value      = p.hillshadeAzimuth      ?? 315
    surfMat.uniforms.uHillshadeAltitude.value     = p.hillshadeAltitude     ?? 45
    surfMat.uniforms.uHillshadeIntensity.value    = p.hillshadeIntensity    ?? 1.0
    surfMat.uniforms.uHillshadeOpacity.value      = p.hillshadeOpacity      ?? 0.6
    surfMat.uniforms.uHillshadeExaggeration.value = p.hillshadeExaggeration ?? 2.0
    surfMat.uniforms.uHillshadeHighlight.value.set(...hexToRgb(p.hillshadeHighlightColor ?? '#ffffff'))
    surfMat.uniforms.uHillshadeShadow.value.set(...hexToRgb(p.hillshadeShadowColor   ?? '#000000'))

    surfMat.uniforms.uSlopeShade.value        = !!(p.showSlopeShade)
    surfMat.uniforms.uSlopeShadeOpacity.value = p.slopeShadeOpacity ?? 0.75
    surfMat.uniforms.uSlopeColorLow.value.set(...hexToRgb(p.slopeColorLow   ?? '#86efac'))
    surfMat.uniforms.uSlopeColorHigh.value.set(...hexToRgb(p.slopeColorHigh ?? '#dc2626'))
    const anyFill = !!(p.showFill || p.showRawTerrain || p.showHillshade || p.showSlopeShade)
    surfMat.colorWrite = anyFill
    surfMat.depthTest  = !!p.depthOcclusion
    surfMat.depthWrite = !!(p.depthOcclusion && anyFill)
    surfMat.polygonOffsetFactor = p.occlusionBias ?? 2
    surfMat.polygonOffsetUnits  = p.occlusionBias ?? 2
    surfMat.needsUpdate = true
  }, [surfMat, p, overlayTex])

  useEffect(() => {
    if (!surfMat) return
    surfMat.uniforms.uGradientTex.value = gradientTex
    surfMat.needsUpdate = true
  }, [surfMat, gradientTex])

  useEffect(() => () => {
    surfMat?.dispose()
    overlayTex?.dispose()
  }, [surfMat, overlayTex])

  const wireMat = useMemo(() => new THREE.MeshBasicMaterial({
    color:               new THREE.Color(p.meshColor ?? '#888888'),
    wireframe:           true,
    transparent:         true,
    opacity:             0.25,
    depthWrite:          false,
    polygonOffset:       true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits:  1,
  }), [])

  useEffect(() => {
    if (wireMat) wireMat.color.set(p.meshColor ?? '#888888')
  }, [wireMat, p.meshColor])

  if (!geometry) return null

  return (
    <group>
      <mesh geometry={geometry} material={surfMat} />
      {p.showMesh && <mesh geometry={geometry} material={wireMat} />}
    </group>
  )
}
