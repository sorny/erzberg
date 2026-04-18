/**
 * Point markers + optional spring-physics particle animation with velocity trails.
 *
 * Rendering:
 *   - Custom ShaderMaterial with gl_PointCoord circular clip + soft falloff.
 *     PointsMaterial always renders squares — the shader is the only way to get
 *     round particles in WebGL without a texture atlas.
 *   - depthTest: false so particles render on top of the terrain surface at all
 *     times (matches the original sketch's 2D overlay behaviour).
 *
 * Animation model (per frame in useFrame):
 *   spring  → pulls each particle toward its terrain home position
 *   noise   → Brownian velocity kick per tick
 *   damping → exponential velocity decay
 *   gravity → optional downward acceleration
 */
import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cellElev } from '../utils/terrain'
import { hexToRgb } from '../utils/colorUtils'

// ── Particle shader ──────────────────────────────────────────────────────────

const PARTICLE_VERT = /* glsl */ `
  uniform float uSize;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    // Perspective-correct size: larger when close, smaller when far
    gl_PointSize = uSize * (300.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`

const PARTICLE_FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform float uOpacity;

  void main() {
    // gl_PointCoord: (0,0) bottom-left → (1,1) top-right of the point sprite
    vec2  c    = gl_PointCoord - 0.5;          // centre at (0,0)
    float dist = length(c);
    if (dist > 0.5) discard;                   // hard circular clip

    // Soft glow: full brightness at centre, fades to 0 at the edge
    float alpha = 1.0 - smoothstep(0.25, 0.5, dist);
    gl_FragColor = vec4(uColor, alpha * uOpacity);
  }
`

// ── Component ────────────────────────────────────────────────────────────────

export function ParticleSystem({ terrain, p }) {
  const ps = useRef({
    positions:     null,
    velocities:    null,
    prevPositions: null,
    home:          null,
    pointsGeo:     null,
    trailsGeo:     null,
    count:         0,
  })

  const pointsMeshRef = useRef()
  const trailsMeshRef = useRef()

  // Particle material — created once, uniforms updated reactively
  const particleMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms: {
      uSize:    { value: 4 },
      uColor:   { value: new THREE.Vector3(0, 0, 0) },
      uOpacity: { value: 1.0 },
    },
    transparent: true,
    depthTest:   false,   // always render on top — matches original 2D overlay
    depthWrite:  false,
  }), [])

  useEffect(() => () => particleMat.dispose(), [particleMat])

  // Sync material uniforms whenever relevant params change
  useEffect(() => {
    if (!particleMat) return
    const [r, g, b] = hexToRgb(p.pointColor ?? p.lineColor)
    particleMat.uniforms.uSize.value    = p.pointSize ?? 4
    particleMat.uniforms.uColor.value.set(r, g, b)
    particleMat.uniforms.uOpacity.value = 1.0
    particleMat.needsUpdate = true
  }, [particleMat, p.pointColor, p.lineColor, p.pointSize])

  // Trail material — thin lines, also on top
  const trailMat = useMemo(() => new THREE.LineBasicMaterial({
    vertexColors: false,
    transparent:  true,
    opacity:      0.4,
    depthTest:    false,
    depthWrite:   false,
  }), [])

  useEffect(() => {
    if (!trailMat) return
    const [r, g, b] = hexToRgb(p.pointColor ?? p.lineColor)
    trailMat.color.setRGB(r, g, b)
  }, [trailMat, p.pointColor, p.lineColor])

  useEffect(() => () => trailMat.dispose(), [trailMat])

  // Home positions (rest state at terrain vertices)
  const homePositions = useMemo(() => {
    if (!terrain) return null
    const { grid, rows, cols, scl, halfW, halfH } = terrain
    const n = rows * cols
    const home = new Float32Array(n * 3)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const elev = cellElev(grid, r, c, cols, p.elevScale, p.jitterAmt)
        home[i * 3]     = c * scl - halfW
        home[i * 3 + 1] = elev
        home[i * 3 + 2] = r * scl - halfH
      }
    }
    return home
  }, [terrain, p.elevScale, p.jitterAmt])

  // Rebuild physics arrays + geometries when home positions change
  useEffect(() => {
    if (!homePositions) return
    const n = homePositions.length / 3

    const positions     = homePositions.slice()
    const velocities    = new Float32Array(n * 3)
    const prevPositions = homePositions.slice()

    const pointsGeo = new THREE.BufferGeometry()
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const trailsGeo = new THREE.BufferGeometry()
    trailsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3))

    ps.current.pointsGeo?.dispose()
    ps.current.trailsGeo?.dispose()

    ps.current = { positions, velocities, prevPositions, home: homePositions, pointsGeo, trailsGeo, count: n }
  }, [homePositions])

  // Per-frame physics
  useFrame(() => {
    const { positions, velocities, prevPositions, home, pointsGeo, trailsGeo, count } = ps.current
    if (!positions || !pointsGeo) return

    if (p.animateParticles) {
      const springK  = 0.04
      const noiseAmt = (p.particleNoise ?? 1) * 0.4
      const damping  = p.particleDamping ?? 0.92

      for (let i = 0; i < count; i++) {
        const ix = i * 3, iy = ix + 1, iz = ix + 2

        prevPositions[ix] = positions[ix]
        prevPositions[iy] = positions[iy]
        prevPositions[iz] = positions[iz]

        velocities[ix] += (home[ix] - positions[ix]) * springK
        velocities[iy] += (home[iy] - positions[iy]) * springK
        velocities[iz] += (home[iz] - positions[iz]) * springK

        velocities[ix] += (Math.random() - 0.5) * noiseAmt
        velocities[iy] += (Math.random() - 0.5) * noiseAmt
        velocities[iz] += (Math.random() - 0.5) * noiseAmt

        if (p.particleGravity) velocities[iy] -= 0.25

        velocities[ix] *= damping
        velocities[iy] *= damping
        velocities[iz] *= damping

        positions[ix] += velocities[ix]
        positions[iy] += velocities[iy]
        positions[iz] += velocities[iz]
      }

      pointsGeo.attributes.position.needsUpdate = true

      if (p.showTrails && trailsGeo) {
        const ta = trailsGeo.attributes.position.array
        for (let i = 0; i < count; i++) {
          const ix = i * 3, iy = ix + 1, iz = ix + 2
          ta[i * 6]     = prevPositions[ix]; ta[i * 6 + 1] = prevPositions[iy]; ta[i * 6 + 2] = prevPositions[iz]
          ta[i * 6 + 3] = positions[ix];     ta[i * 6 + 4] = positions[iy];     ta[i * 6 + 5] = positions[iz]
        }
        trailsGeo.attributes.position.needsUpdate = true
      }
    } else {
      // Static mode — keep in sync with terrain edits
      positions.set(home)
      pointsGeo.attributes.position.needsUpdate = true
    }
  })

  if (!p.showPoints || !ps.current.pointsGeo) return null

  return (
    <group>
      <points
        ref={pointsMeshRef}
        geometry={ps.current.pointsGeo}
        material={particleMat}
      />

      {p.animateParticles && p.showTrails && ps.current.trailsGeo && (
        <lineSegments
          ref={trailsMeshRef}
          geometry={ps.current.trailsGeo}
          material={trailMat}
        />
      )}
    </group>
  )
}
