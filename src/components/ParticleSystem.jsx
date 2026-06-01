/**
 * Hologram particle field.
 *
 * Particles sit on the terrain surface and are animated entirely on the GPU:
 * a single `uTime` uniform drives per-particle float and fractal-noise
 * displacement (gated by a moving "scan" mask). Nothing is looped or re-uploaded
 * on the CPU per frame — the position buffer is written once and only `uTime`
 * changes. The look (bright core + additive halo + scanline shimmer) is faked in
 * the fragment shader, so no global post-processing pass is needed and the export
 * paths stay intact.
 *
 * Adapted from the WebGPU/TSL technique in cortiz2894/hologram-particles.
 */
import { useRef, useState, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cellElev } from '../utils/terrain'
import { hexToRgb } from '../utils/colorUtils'
import { useStore } from '../store/useStore'

// ── GLSL: 3D simplex noise (Ashima / Stefan Gustavson, public domain) ─────────

const SNOISE = /* glsl */ `
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
`

// ── Particle shaders ──────────────────────────────────────────────────────────

const PARTICLE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uFloat;
  uniform float uNoiseAmt;
  uniform float uNoiseScale;
  uniform float uFlow;
  uniform float uMaskContrast;

  attribute float aSeed;

  varying float vWorldY;
  varying float vSeed;

  ${SNOISE}

  void main() {
    vSeed = aSeed;
    vec3 pos = position;
    float phase = aSeed * 6.2831853;

    // Per-particle float: gentle hovering shimmer.
    vec3 floatD = vec3(
      cos(uTime * 1.3 + phase) * 0.6,
      sin(uTime * 1.6 + phase),
      sin(uTime * 1.1 + phase + 1.0) * 0.6
    ) * uFloat;

    // Moving "scan" mask gates where the flow noise shows — the holographic reveal.
    float ns = uNoiseScale * 0.05;
    vec3 maskCoord = pos * ns + vec3(uTime * uFlow * 0.3);
    float mask = pow(clamp(snoise(maskCoord) * 0.5 + 0.5, 0.0, 1.0), uMaskContrast);

    // Two-octave fractal noise displacement.
    vec3 nc = pos * ns + vec3(uTime * uFlow * 0.5, 0.0, uTime * uFlow * 0.35);
    vec3 noiseD = vec3(
      snoise(nc),
      snoise(nc + vec3(31.4, 0.0, 12.7)),
      snoise(nc + vec3(0.0, 47.1, 22.3))
    );
    noiseD += 0.5 * vec3(
      snoise(nc * 2.0),
      snoise(nc * 2.0 + vec3(11.1, 5.3, 9.7)),
      snoise(nc * 2.0 + vec3(0.0, 7.7, 3.3))
    );
    noiseD *= uNoiseAmt * mask;

    vec3 disp = pos + floatD + noiseD;
    vWorldY = disp.y;

    vec4 mvPos = modelViewMatrix * vec4(disp, 1.0);
    gl_PointSize = uSize * (300.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`

const PARTICLE_FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform vec3  uGlowColor;
  uniform float uOpacity;
  uniform float uShimmer;
  uniform float uTime;

  varying float vWorldY;
  varying float vSeed;

  void main() {
    vec2  c    = gl_PointCoord - 0.5;
    float dist = length(c);
    if (dist > 0.5) discard;

    // Bright core wrapped in a soft halo.
    float core  = 1.0 - smoothstep(0.0, 0.28, dist);
    float halo  = 1.0 - smoothstep(0.10, 0.50, dist);
    float alpha = clamp(core * 0.85 + halo * 0.45, 0.0, 1.0);

    // Scanline shimmer travelling up the field.
    float scan    = sin(vWorldY * 4.0 - uTime * 3.0 + vSeed * 6.2831) * 0.5 + 0.5;
    float shimmer = mix(1.0, 0.55 + 0.6 * scan, uShimmer);

    vec3 col = mix(uColor, uGlowColor, clamp(halo * 0.25, 0.0, 1.0));   // glow-tinted rim
    col *= shimmer;
    col  = mix(col, vec3(1.0), core * 0.3);   // hot whitened core

    gl_FragColor = vec4(col, alpha * uOpacity);
  }
`

// ── Component ────────────────────────────────────────────────────────────────

export const ParticleSystem = forwardRef(function ParticleSystem({ terrain, p }, ref) {
  const nodataMask = useStore(s => s.nodataMask)
  const [pointsGeo, setPointsGeo] = useState(null)
  const positionsRef = useRef(null)   // static home buffer (for SVG/STL export snapshot)
  const countRef     = useRef(0)

  const particleMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms: {
      uTime:          { value: 0 },
      uSize:          { value: 4 },
      uFloat:         { value: 1 },
      uNoiseAmt:      { value: 1 },
      uNoiseScale:    { value: 1 },
      uFlow:          { value: 1 },
      uMaskContrast:  { value: 1.5 },
      uColor:         { value: new THREE.Vector3(0, 0, 0) },
      uGlowColor:     { value: new THREE.Vector3(0, 0.92, 1) },
      uOpacity:       { value: 1.0 },
      uShimmer:       { value: 0.4 },
    },
    transparent: true,
    blending:    THREE.NormalBlending,
    depthTest:   !!p.depthOcclusion,
    depthWrite:  false,
    polygonOffset: true,
    polygonOffsetFactor: -(p.occlusionBias ?? 1),
    polygonOffsetUnits:  -(p.occlusionBias ?? 1),
  }), [])

  useEffect(() => () => particleMat.dispose(), [particleMat])

  // Sync render params → uniforms / material flags.
  useEffect(() => {
    const u = particleMat.uniforms
    const [r, g, b]    = hexToRgb(p.pointColor ?? p.lineColor)
    const [gr, gg, gb] = hexToRgb(p.holoGlowColor ?? '#00eaff')
    u.uColor.value.set(r, g, b)
    u.uGlowColor.value.set(gr, gg, gb)
    u.uSize.value         = p.pointSize ?? 4
    u.uFloat.value        = p.holoFloat ?? 1
    u.uNoiseAmt.value     = p.holoNoiseAmt ?? 1
    u.uNoiseScale.value   = p.holoNoiseScale ?? 1
    u.uFlow.value         = p.holoFlowSpeed ?? 1
    u.uMaskContrast.value = p.holoMaskContrast ?? 1.5
    u.uShimmer.value      = p.holoShimmer ?? 0.4
    particleMat.depthTest  = !!p.depthOcclusion
    particleMat.polygonOffsetFactor = -(p.occlusionBias ?? 1)
    particleMat.polygonOffsetUnits  = -(p.occlusionBias ?? 1)
    particleMat.needsUpdate = true
  }, [particleMat, p.pointColor, p.lineColor, p.holoGlowColor, p.pointSize, p.holoFloat,
      p.holoNoiseAmt, p.holoNoiseScale, p.holoFlowSpeed, p.holoMaskContrast, p.holoShimmer,
      p.depthOcclusion, p.occlusionBias])

  const homePositions = useMemo(() => {
    if (!terrain) return null
    const { grid, rows, cols, scl, halfW, halfH, gridMask } = terrain

    const home = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        if (gridMask && !gridMask[i]) continue
        const elev = cellElev(grid, r, c, cols, p.elevScale, p.jitterAmt)
        home.push(c * scl - halfW, elev, r * scl - halfH)
      }
    }
    return new Float32Array(home)
  }, [terrain, p.elevScale, p.jitterAmt])

  useEffect(() => {
    if (!homePositions) return
    const n = homePositions.length / 3
    const positions = homePositions.slice()
    const seeds = new Float32Array(n)
    for (let i = 0; i < n; i++) seeds[i] = Math.random()
    const newGeo = new THREE.BufferGeometry()
    newGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    newGeo.setAttribute('aSeed',    new THREE.BufferAttribute(seeds, 1))
    setPointsGeo(prev => { prev?.dispose(); return newGeo })
    positionsRef.current = positions
    countRef.current     = n
  }, [homePositions])

  useImperativeHandle(ref, () => ({
    getPositions: () => positionsRef.current,
    getCount:     () => countRef.current,
  }))

  useFrame((_, delta) => {
    // Advance time only while animating (frozen field still renders, hologram-shaded).
    if (p.animateParticles) particleMat.uniforms.uTime.value += Math.min(delta, 0.05)
  })

  if (!p.showPoints || !pointsGeo) return null
  return <points geometry={pointsGeo} material={particleMat} />
})
