/**
 * Particle field — two of them, sharing one toggle.
 *
 * **Hologram** (`particleMode: 'hologram'`). Particles sit on the terrain surface
 * and are animated entirely on the GPU: a single `uTime` uniform drives
 * per-particle float and fractal-noise displacement (gated by a moving "scan"
 * mask). Nothing is looped or re-uploaded on the CPU per frame — the position
 * buffer is written once and only `uTime` changes. The look (bright core +
 * additive halo + scanline shimmer) is faked in the fragment shader, so no
 * global post-processing pass is needed and the export paths stay intact.
 * Adapted from the WebGPU/TSL technique in cortiz2894/hologram-particles.
 *
 * **Murmuration** (`particleMode: 'murmuration'`). A boids flock stepped on the
 * CPU in `src/utils/murmuration.js`, drawn as points with optional velocity
 * streaks. The exact opposite trade: the position buffer is rewritten every
 * frame, but the CPU knows where every bird is, so SVG export gets the live
 * flock rather than a snapshot at rest.
 *
 * The two paths share the toggle, the size, the two colours and the fragment
 * shader, and nothing else. Only one is ever allocated — in particular the
 * hologram's per-cell home buffer is not built in murmuration mode.
 */
import { useRef, useState, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cellElev } from '../utils/terrain'
import { hexToRgb } from '../utils/colorUtils'
import { makeTerrainField, createFlock, stepFlock, updateTrails, updateShadows, applyBurst, flockScales } from '../utils/murmuration'
import { makeBandPlan, createAudioState, sampleAudio, applyAudio, audioVisuals, shapeFeatures, audioRanges } from '../utils/audioFeatures'

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
  uniform float uShimmer;
  uniform float uOpacity;
  uniform float uTime;

  varying float vWorldY;
  varying float vSeed;

  void main() {
    vec2  c    = gl_PointCoord - 0.5;
    float dist = length(c);
    if (dist > 0.5) discard;

    // Bright core wrapped in a soft halo. The two coefficients are the sprite's
    // shape, not its strength — uOpacity scales the result so the falloff keeps
    // its profile as the whole thing fades.
    float core  = 1.0 - smoothstep(0.0, 0.28, dist);
    float halo  = 1.0 - smoothstep(0.10, 0.50, dist);
    float alpha = clamp(core * 0.85 + halo * 0.45, 0.0, 1.0) * uOpacity;

    // Scanline shimmer travelling up the field.
    float scan    = sin(vWorldY * 4.0 - uTime * 3.0 + vSeed * 6.2831) * 0.5 + 0.5;
    float shimmer = mix(1.0, 0.55 + 0.6 * scan, uShimmer);

    vec3 col = mix(uColor, uGlowColor, clamp(halo * 0.25, 0.0, 1.0));   // glow-tinted rim
    col *= shimmer;
    col  = mix(col, vec3(1.0), core * 0.3);   // hot whitened core

    gl_FragColor = vec4(col, alpha);
  }
`

// ── Murmuration shaders ───────────────────────────────────────────────────────

// A bird is already where it belongs — the simulation put it there — so the
// vertex shader does nothing but the point-size law. The fragment shader is
// PARTICLE_FRAG verbatim: it needs `vWorldY` and `vSeed` and asks no questions
// about how they were produced.
const BIRD_VERT = /* glsl */ `
  uniform float uSize;
  attribute float aSeed;
  varying float vWorldY;
  varying float vSeed;

  void main() {
    vSeed   = aSeed;
    vWorldY = position.y;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (300.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`

// Velocity streaks. `aHead` is 1 at the bird and 0 at the tail, which is the
// whole of the fade — no per-frame colour buffer, no sorting.
const TRAIL_VERT = /* glsl */ `
  attribute float aHead;
  varying float vHead;
  void main() {
    vHead = aHead;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const TRAIL_FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform vec3  uGlowColor;
  uniform float uOpacity;
  varying float vHead;
  void main() {
    gl_FragColor = vec4(mix(uGlowColor, uColor, vHead), vHead * 0.8 * uOpacity);
  }
`

/**
 * Where the field sits in the transparent paint order.
 *
 * Occlusion in this scene is decided by the *depth-writing* geometry — the fill
 * surface and the per-layer occlusion curtains. Everything that paints marks —
 * every line layer, and this field — draws with `depthWrite: false`, so among
 * themselves the only thing that decides who covers whom is `renderOrder`.
 *
 * The particle field used to leave that at the default 0 while every line layer
 * sets `layerIndex + 1` (HeightmapLines.jsx), so the draw modes painted over the
 * field unconditionally — a flock plainly in the air in front of the terrain came
 * out with the line pattern ruled straight across it. Depth could not save it:
 * the field writes no depth for the later layers to test against, and giving it
 * `depthWrite: true` would replace one artefact with a worse one, since each
 * sprite would stamp its whole square quad into the depth buffer and punch hard
 * edges through the soft halos behind it.
 *
 * So the field paints last. It is still depth-*tested* against the surface and
 * the curtains, which is what actually hides particles behind a mountain; this
 * only settles the order against marks that never occluded anything anyway.
 * Comfortably above the ~14 line layers and below the sun indicator's 998-1000.
 */
const SHADOW_ORDER   = 99    // on the ground, under everything of its own field…
const TRAIL_ORDER    = 100   // …then the streaks…
const PARTICLE_ORDER = 101   // …then the birds on top of their own tails

// Ground shadows. A flat soft disc — none of the fragment shader's core, halo
// or shimmer, which are lighting conceits and would read as a glowing puddle.
// `aLift` is how high the bird is (0 at the ground, 1 at the top of the flight
// envelope): the sprite grows with it and fades, which is the whole of the
// depth cue and the reason the flock reads as flying rather than pasted on.
const SHADOW_VERT = /* glsl */ `
  uniform float uSize;
  uniform float uSpread;
  attribute float aLift;
  varying float vLift;

  void main() {
    vLift = aLift;
    // Negative lift means the simulation found no ground under this shadow —
    // off the edge of the raster, or inside a hole cut out of it. Thrown outside
    // clip space so it is culled before rasterisation rather than discarded per
    // fragment, which for a sprite this size is the cheaper end to do it at.
    if (aLift < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (1.0 + aLift * uSpread) * (300.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`

const SHADOW_FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform float uOpacity;
  varying float vLift;

  void main() {
    vec2  c    = gl_PointCoord - 0.5;
    float dist = length(c);
    if (dist > 0.5) discard;
    // Softer edge than a bird: a shadow has no bright core, and the higher the
    // bird the more diffuse its shadow gets.
    float edge  = mix(0.18, 0.02, vLift);
    float alpha = (1.0 - smoothstep(edge, 0.5, dist)) * uOpacity * (1.0 - vLift * 0.55);
    gl_FragColor = vec4(uColor, alpha);
  }
`

// ── Component ────────────────────────────────────────────────────────────────

export const ParticleSystem = forwardRef(function ParticleSystem({ terrain, p, audioLive }, ref) {
  const [pointsGeo, setPointsGeo] = useState(null)
  const positionsRef = useRef(null)   // static home buffer (hologram SVG export snapshot)
  const countRef     = useRef(0)

  const flying = p.particleMode === 'murmuration'

  // Per-frame listening state. A ref, not state: these envelopes advance sixty
  // times a second and nothing in the tree should re-render for them. The band
  // plan is cached against the spectrogram object, so it is rebuilt only when
  // the analysis is (a new track, or a change to fftSize/bins/logFreq).
  const audioRef = useRef({ spec: null, plan: null, state: createAudioState() })

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
      uShimmer:       { value: 0.4 },
      uOpacity:       { value: 1 },
    },
    transparent: true,
    blending:    THREE.NormalBlending,
    depthTest:   !!p.depthOcclusion,
    depthWrite:  false,
    polygonOffset: true,
    polygonOffsetFactor: -(p.occlusionBias ?? 1),
    polygonOffsetUnits:  -(p.occlusionBias ?? 1),
  }), [])

  // Both murmuration materials, created once alongside the hologram's and kept
  // whichever mode is active — a ShaderMaterial costs nothing while unused, and
  // recreating one on every mode flip would recompile the program.
  const birdMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   BIRD_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms: {
      uTime:      { value: 0 },
      uSize:      { value: 4 },
      uColor:     { value: new THREE.Vector3(0, 0, 0) },
      uGlowColor: { value: new THREE.Vector3(0, 0.92, 1) },
      uShimmer:   { value: 0 },
      uOpacity:   { value: 1 },
    },
    transparent: true,
    blending:    THREE.NormalBlending,
    depthWrite:  false,
    // No polygonOffset: WebGL exposes only POLYGON_OFFSET_FILL, so it does
    // nothing at all for POINTS and LINES. The hologram material above carries
    // it for historical reasons and it has never had an effect there either.
  }), [])

  const shadowMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   SHADOW_VERT,
    fragmentShader: SHADOW_FRAG,
    uniforms: {
      uSize:    { value: 4 },
      uSpread:  { value: 1.5 },
      uColor:   { value: new THREE.Vector3(0, 0, 0) },
      uOpacity: { value: 0.35 },
    },
    transparent: true,
    depthWrite:  false,
    // No polygonOffset: WebGL exposes only POLYGON_OFFSET_FILL, so it does
    // nothing at all for POINTS and LINES. The hologram material above carries
    // it for historical reasons and it has never had an effect there either.
  }), [])

  const trailMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    uniforms: {
      uColor:     { value: new THREE.Vector3(0, 0, 0) },
      uGlowColor: { value: new THREE.Vector3(0, 0.92, 1) },
      uOpacity:   { value: 1 },
    },
    transparent: true,
    depthWrite:  false,
    // No polygonOffset: WebGL exposes only POLYGON_OFFSET_FILL, so it does
    // nothing at all for POINTS and LINES. The hologram material above carries
    // it for historical reasons and it has never had an effect there either.
  }), [])

  useEffect(() => () => {
    particleMat.dispose(); birdMat.dispose(); trailMat.dispose(); shadowMat.dispose()
  }, [particleMat, birdMat, trailMat, shadowMat])

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
    u.uOpacity.value      = p.pointOpacity ?? 1
    // The flock shares the size and both colours; the shimmer is a hologram
    // conceit and is pinned off, since a bird flickering in place reads as a
    // dropped frame rather than as a scanline.
    for (const m of [birdMat, trailMat]) {
      m.uniforms.uColor.value.set(r, g, b)
      m.uniforms.uGlowColor.value.set(gr, gg, gb)
      m.uniforms.uOpacity.value = p.pointOpacity ?? 1
      m.depthTest = !!p.depthOcclusion
    }
    // Both sizes are re-set every frame by the audio path when it is running;
    // this is the value they sit at when it is not.
    birdMat.uniforms.uSize.value = p.pointSize ?? 4
    const su = shadowMat.uniforms
    su.uSize.value    = (p.pointSize ?? 4) * (p.flockShadowSize ?? 1)
    su.uSpread.value  = p.flockShadowSpread ?? 1.5
    su.uOpacity.value = p.flockShadowOpacity ?? 0.35
    const [sr, sg, sb] = hexToRgb(p.flockShadowColor ?? '#000000')
    su.uColor.value.set(sr, sg, sb)
    // No needsUpdate on any of the three: everything set here is a uniform or
    // plain render state, and flagging a material rebuilds its program-cache
    // entry for nothing. Same reasoning as the lid material in HeightmapLines.
    shadowMat.depthTest = !!p.depthOcclusion
    particleMat.depthTest  = !!p.depthOcclusion
    particleMat.polygonOffsetFactor = -(p.occlusionBias ?? 1)
    particleMat.polygonOffsetUnits  = -(p.occlusionBias ?? 1)
    particleMat.needsUpdate = true
  }, [particleMat, birdMat, trailMat, shadowMat, p.pointColor, p.lineColor,
      p.holoGlowColor, p.pointSize, p.pointOpacity, p.holoFloat, p.holoNoiseAmt,
      p.holoNoiseScale, p.holoFlowSpeed, p.holoMaskContrast, p.holoShimmer,
      p.flockShadowSize, p.flockShadowSpread, p.flockShadowOpacity,
      p.flockShadowColor, p.depthOcclusion, p.occlusionBias])

  // showPoints is a dependency, not just a render-time guard. The early return
  // that hides the field sits below every hook, so without it here a hidden
  // particle system still scanned the grid twice, allocated the home buffer and
  // seeded a random per particle on every terrain rebuild — ~15-25 ms and ~25 MB
  // at a 1024² grid, in the *default* configuration (showPoints is off and
  // particleSpacing is 1, one particle per cell). Under Soundscapes streaming
  // that ran 30 times a second for a field nobody could see. `flying` is on the
  // list for the same reason and it matters more, not less: a 1200-bird flock
  // must never pay for a million-entry home buffer it will not read.
  const homePositions = useMemo(() => {
    if (!terrain || !p.showPoints || flying) return null
    const { grid, rows, cols, scl, halfW, halfH, gridMask } = terrain
    // particleSpacing = grid-cell stride between particles (1 = every cell).
    const stride = Math.max(1, Math.round(p.particleSpacing ?? 1))

    // Count valid cells first — this runs on the main thread on every terrain
    // change, so fill a pre-sized typed array instead of growing a JS array.
    let count = 0
    for (let r = 0; r < rows; r += stride) {
      for (let c = 0; c < cols; c += stride) {
        if (!gridMask || gridMask[r * cols + c]) count++
      }
    }
    const home = new Float32Array(count * 3)
    let w = 0
    for (let r = 0; r < rows; r += stride) {
      for (let c = 0; c < cols; c += stride) {
        const i = r * cols + c
        if (gridMask && !gridMask[i]) continue
        home[w]     = c * scl - halfW
        home[w + 1] = cellElev(grid, r, c, cols, p.elevScale, p.jitterAmt)
        home[w + 2] = r * scl - halfH
        w += 3
      }
    }
    return home
  }, [terrain, p.showPoints, p.elevScale, p.jitterAmt, p.particleSpacing, flying])

  useEffect(() => {
    if (!homePositions) {
      // Switching to murmuration, or hiding the field, leaves the home geometry
      // with no one to draw it — and at a 1024² grid that is ~25 MB of GPU
      // buffer held for a mode that will never read it. Returning early here
      // (as this did) kept it alive until the next rebuild or unmount.
      setPointsGeo(prev => { prev?.dispose(); return null })
      positionsRef.current = null
      countRef.current = 0
      return
    }
    const n = homePositions.length / 3
    // Used directly rather than copied: nothing writes to it. All motion is
    // computed from uTime in the vertex shader, and getPositions() only reads
    // for SVG export — so the copy was a second full-size allocation per rebuild.
    const positions = homePositions
    const seeds = new Float32Array(n)
    for (let i = 0; i < n; i++) seeds[i] = Math.random()
    const newGeo = new THREE.BufferGeometry()
    newGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    newGeo.setAttribute('aSeed',    new THREE.BufferAttribute(seeds, 1))
    setPointsGeo(prev => { prev?.dispose(); return newGeo })
    positionsRef.current = positions
    countRef.current     = n
  }, [homePositions])

  // ── Murmuration ─────────────────────────────────────────────────────────────
  //
  // Deps are the things that change *who is flying*: the terrain the flock is
  // steered by, the population, and the seed. The steering weights are read
  // fresh inside useFrame instead, so dragging Cohesion deforms the flock in
  // flight rather than teleporting a new one into the sky.
  const flock = useMemo(() => {
    if (!terrain || !p.showPoints || !flying) return null
    const field = makeTerrainField(terrain, p.elevScale, p.jitterAmt)
    const birds = createFlock(p.flockCount ?? 2000, p.flockSeed ?? 42, field, flockParams(p))

    // position aliases the simulation's own buffer — the step writes into it and
    // the draw call reads it, with no copy in between. Dynamic usage tells the
    // driver to expect exactly that.
    const geo = new THREE.BufferGeometry()
    const posAttr = new THREE.BufferAttribute(birds.pos, 3)
    posAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', posAttr)
    geo.setAttribute('aSeed', new THREE.BufferAttribute(birds.phase, 1))

    const trailGeo = new THREE.BufferGeometry()
    const segAttr = new THREE.BufferAttribute(birds.seg, 3)
    segAttr.setUsage(THREE.DynamicDrawUsage)
    trailGeo.setAttribute('position', segAttr)
    const head = new Float32Array(birds.n * 2)
    for (let i = 0; i < birds.n; i++) { head[i * 2] = 1; head[i * 2 + 1] = 0 }
    trailGeo.setAttribute('aHead', new THREE.BufferAttribute(head, 1))

    const shadowGeo = new THREE.BufferGeometry()
    const shadowAttr = new THREE.BufferAttribute(birds.shadow, 3)
    shadowAttr.setUsage(THREE.DynamicDrawUsage)
    shadowGeo.setAttribute('position', shadowAttr)
    const liftAttr = new THREE.BufferAttribute(birds.shadowLift, 1)
    liftAttr.setUsage(THREE.DynamicDrawUsage)
    shadowGeo.setAttribute('aLift', liftAttr)

    return { field, birds, geo, trailGeo, shadowGeo, posAttr, segAttr, shadowAttr, liftAttr }
  }, [terrain, p.showPoints, flying, p.flockCount, p.flockSeed, p.elevScale, p.jitterAmt])

  useEffect(() => {
    if (!flock) return
    return () => { flock.geo.dispose(); flock.trailGeo.dispose(); flock.shadowGeo.dispose() }
  }, [flock])

  // Neither trail length nor the sun is a flock dep, so a *frozen* field would
  // keep the streaks and shadows it was born with while those sliders moved.
  useEffect(() => {
    if (!flock) return
    updateTrails(flock.birds, flock.field, flockParams(p))
    flock.segAttr.needsUpdate = true
  }, [flock, p.flockTrail])

  useEffect(() => {
    if (!flock || !p.flockShadow) return
    updateShadows(flock.birds, flock.field, flockParams(p))
    flock.shadowAttr.needsUpdate = true
    flock.liftAttr.needsUpdate = true
  }, [flock, p.flockShadow, p.hillshadeAzimuth, p.hillshadeAltitude])

  useImperativeHandle(ref, () => ({
    // In murmuration mode these are the live buffers, so an SVG exported while
    // the flock is frozen is the frame on screen — not the case for the
    // hologram field, whose motion the CPU never sees.
    getPositions: () => (flock ? flock.birds.pos : positionsRef.current),
    getCount:     () => (flock ? flock.birds.n   : countRef.current),
    getSegments:  () => (flock && (p.flockTrail ?? 0) > 0 ? flock.birds.seg : null),
    getShadows:   () => (flock && p.flockShadow ? flock.birds.shadow : null),
    // Parallel to getShadows(): negative entries are shadows with no ground to
    // fall on, which the exporter must skip exactly as the shader does.
    getShadowLift: () => (flock && p.flockShadow ? flock.birds.shadowLift : null),
  }), [flock, p.flockTrail, p.flockShadow])

  useFrame(({ invalidate }, delta) => {
    // Advance time only while the field is shown AND animating. invalidate() keeps
    // the on-demand render loop alive for the next frame; gating on showPoints is
    // essential — otherwise a hidden-but-"animated" field would pin the renderer at
    // 60fps doing nothing (animateParticles defaults on).
    if (!p.showPoints || !p.animateParticles) return
    const dt = Math.min(delta, 0.05)
    if (flock) {
      const heard = listen(p, audioRef.current, audioLive, dt)
      // Onsets are applied as a velocity impulse *before* the step, so the beat
      // lands on this frame rather than being integrated in over the next few.
      if (heard.burst > 0 && flock.birds.n > 0) {
        applyBurst(flock.birds, heard.burst * flockScales(flock.field, heard.params).cruise)
      }
      // Sprite size and streak length are uniforms, so they carry no lag at all —
      // this is the half of the reaction that actually reads as being on the beat.
      birdMat.uniforms.uSize.value = (p.pointSize ?? 4) * heard.visuals.size
      shadowMat.uniforms.uSize.value =
        (p.pointSize ?? 4) * (p.flockShadowSize ?? 1) * heard.visuals.size
      heard.params.trail = (heard.params.trail ?? 0) * heard.visuals.trail
      stepFlock(flock.birds, dt, flock.field, heard.params)
      flock.posAttr.needsUpdate = true
      flock.segAttr.needsUpdate = true
      if (p.flockShadow) { flock.shadowAttr.needsUpdate = true; flock.liftAttr.needsUpdate = true }
    } else {
      particleMat.uniforms.uTime.value += dt
    }
    invalidate()
  })

  // showRawTerrain: the raw view shows the heightmap and nothing else.
  if (!p.showPoints || p.showRawTerrain) return null
  if (flying) {
    if (!flock) return null
    // frustumCulled off on both: the bounding sphere is computed once from the
    // buffer as it stood at allocation, and the flock leaves that ball within a
    // second or two — after which it vanishes whenever the camera looks away
    // from where it used to be.
    return (
      <>
        <points geometry={flock.shadowGeo} material={shadowMat} frustumCulled={false}
          renderOrder={SHADOW_ORDER} visible={!!p.flockShadow} />
        <lineSegments geometry={flock.trailGeo} material={trailMat} frustumCulled={false}
          renderOrder={TRAIL_ORDER} visible={(p.flockTrail ?? 0) > 0} />
        <points geometry={flock.geo} material={birdMat} frustumCulled={false}
          renderOrder={PARTICLE_ORDER} />
      </>
    )
  }
  if (!pointsGeo) return null
  return <points geometry={pointsGeo} material={particleMat} renderOrder={PARTICLE_ORDER} />
})

/**
 * The parameters for this frame: the sliders, then whatever the track is doing
 * to them.
 *
 * Kept out of the simulation on purpose — `stepFlock` resolves its scales from
 * params on every call, so audio reactivity is a transform on the way in and
 * `murmuration.js` never learns that audio exists.
 */
function listen(p, audio, live, dt) {
  const base = flockParams(p)
  const inert = { params: base, visuals: { size: 1, trail: 1 }, burst: 0 }
  if (!p.flockAudio || !live?.current) return inert

  const spec = live.current.getSpec()
  if (!spec) return inert
  // Rebuilding the band plan is only correct when the analysis itself changed;
  // identity of the spec object is exactly that signal.
  if (audio.spec !== spec) {
    audio.spec = spec
    audio.plan = makeBandPlan(spec)
    audio.state = createAudioState()
  }
  // Sampled slightly *ahead* of the playhead. The parameter channels are
  // steering forces and the integrator delays them by a few hundred
  // milliseconds; reading the future cancels some of that, and reading the
  // future is only possible because the whole spectrogram already exists. A
  // live AnalyserNode could not do this at any price.
  const t = live.current.getTime() + (p.flockAudioSync ?? 0.04)
  const f = sampleAudio(spec, audio.plan, audio.state, t, dt, live.current.isPlaying())
  const drive = p.flockAudioDrive ?? 1
  const ch = shapeFeatures(
    { level: f.level, bass: f.env[0], mid: f.env[1], high: f.env[2], startle: f.startle, onset: f.onset },
    audioRanges(p))
  return {
    params: applyAudio(base, ch, {
      speed:     drive * (p.flockAudioSpeed ?? 1),
      pulse:     drive * (p.flockAudioPulse ?? 1),
      shimmer:   drive * (p.flockAudioShimmer ?? 1),
      startle:   drive * (p.flockAudioStartle ?? 1),
    }),
    visuals: audioVisuals(ch, { size: drive * (p.flockAudioSize ?? 1) }),
    burst: drive * (p.flockAudioBurst ?? 1) * 1.8 * ch.burst,
  }
}

/** The sliders the simulation reads, named as `murmuration.js` expects them. */
function flockParams(p) {
  return {
    speed:        p.flockSpeed ?? 1,
    cohesion:     p.flockCohesion ?? 1,
    alignment:    p.flockAlignment ?? 1.2,
    separation:   p.flockSeparation ?? 1.5,
    perception:   p.flockPerception ?? 1,
    roost:        p.flockRoost ?? 1,
    roostHeight:  p.flockRoostHeight ?? 1,
    clearance:    p.flockClearance ?? 1,
    lift:         p.flockLift ?? 1,
    turbulence:   p.flockTurbulence ?? 0.5,
    trail:        p.flockTrail ?? 2,
    predator:     !!p.flockPredator,
    predatorFear: p.flockPredatorFear ?? 1,
    shadow:       !!p.flockShadow,
    // Deliberately the hillshade sun rather than a private one: a flock lit from
    // a different angle than the ground it flies over looks wrong immediately.
    sunAzimuth:   p.hillshadeAzimuth ?? 315,
    sunAltitude:  p.hillshadeAltitude ?? 45,
  }
}
