/**
 * Point markers + optional spring-physics particle animation.
 *
 * Two animation modes (requires animateParticles = true):
 *
 *   Spring (gravity off) — each particle oscillates around its terrain home
 *   position driven by spring force + Brownian noise + damping.
 *
 *   Gravity (gravity on) — spring is disabled; particles slowly sink under a
 *   constant downward acceleration with air-resistance damping. When a particle
 *   falls below the terrain floor it resets to its home position and begins
 *   sinking again (staggered by initial per-particle delay so the fall looks
 *   continuous rather than a mass-reset).
 *
 * Rendering:
 *   Custom ShaderMaterial with gl_PointCoord circular clip + soft falloff.
 *   depthTest: false so particles always render on top of the terrain surface.
 */
import { useRef, useState, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cellElev } from '../utils/terrain'
import { hexToRgb } from '../utils/colorUtils'

// ── Particle shader ──────────────────────────────────────────────────────────

const PARTICLE_VERT = /* glsl */ `
  uniform float uSize;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (300.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
  }
`

const PARTICLE_FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform float uOpacity;

  void main() {
    vec2  c    = gl_PointCoord - 0.5;
    float dist = length(c);
    if (dist > 0.5) discard;
    float alpha = 1.0 - smoothstep(0.25, 0.5, dist);
    gl_FragColor = vec4(uColor, alpha * uOpacity);
  }
`

// ── Component ────────────────────────────────────────────────────────────────

export const ParticleSystem = forwardRef(function ParticleSystem({ terrain, p }, ref) {
  const ps = useRef({
    positions:  null,
    velocities: null,
    home:       null,
    floor:      -Infinity,
    count:      0,
  })
  const [pointsGeo, setPointsGeo] = useState(null)

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
    depthTest:   false,
    depthWrite:  false,
  }), [])

  useEffect(() => () => particleMat.dispose(), [particleMat])

  useEffect(() => {
    if (!particleMat) return
    const [r, g, b] = hexToRgb(p.pointColor ?? p.lineColor)
    particleMat.uniforms.uSize.value  = p.pointSize ?? 4
    particleMat.uniforms.uColor.value.set(r, g, b)
    particleMat.needsUpdate = true
  }, [particleMat, p.pointColor, p.lineColor, p.pointSize])

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

  // Rebuild physics arrays + geometry when home positions change
  useEffect(() => {
    if (!homePositions) return
    const n = homePositions.length / 3

    // Floor: the lowest terrain elevation
    let minY = Infinity
    for (let i = 0; i < n; i++) minY = Math.min(minY, homePositions[i * 3 + 1])
    const floor = minY

    const positions  = homePositions.slice()
    const velocities = new Float32Array(n * 3)

    const newGeo = new THREE.BufferGeometry()
    newGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    setPointsGeo(prev => { prev?.dispose(); return newGeo })
    ps.current = { positions, velocities, home: homePositions, floor, count: n }
  }, [homePositions])

  // Keep a ref to the current geo so useFrame always sees the latest
  const pointsGeoRef = useRef(null)
  useEffect(() => { pointsGeoRef.current = pointsGeo }, [pointsGeo])

  // Expose current particle positions for SVG export
  useImperativeHandle(ref, () => ({
    getPositions: () => ps.current.positions,
    getCount:     () => ps.current.count,
  }))

  // Per-frame physics
  useFrame(() => {
    const { positions, velocities, home, floor, count } = ps.current
    const pointsGeo = pointsGeoRef.current
    if (!positions || !pointsGeo) return

    if (p.animateParticles) {
      if (p.particleGravity) {
        // ── Gravity mode ─────────────────────────────────────────────────────
        // Constant downward pull, air-resistance damping, hard floor (particles
        // settle and stay — no respawn).
        const GRAVITY = 0.04 * (p.particleGravityStr ?? 1)
        const DAMPING = 0.97

        for (let i = 0; i < count; i++) {
          const ix = i * 3, iy = ix + 1, iz = ix + 2

          // Already resting on the floor — skip
          if (positions[iy] <= floor && velocities[iy] <= 0) {
            velocities[ix] = 0; velocities[iy] = 0; velocities[iz] = 0
            continue
          }

          velocities[iy] -= GRAVITY
          velocities[ix] *= DAMPING
          velocities[iy] *= DAMPING
          velocities[iz] *= DAMPING

          positions[ix] += velocities[ix]
          positions[iy] += velocities[iy]
          positions[iz] += velocities[iz]

          // Clamp to floor
          if (positions[iy] < floor) {
            positions[iy] = floor
            velocities[iy] = 0
          }
        }
      } else {
        // ── Spring-return mode ────────────────────────────────────────────────
        // Pulls every particle back to its home position (handles both the
        // normal animated-noise case and returning from gravity).
        const SPRING   = 0.04
        const noiseAmt = (p.particleNoise ?? 1) * 0.4
        const damping  = p.particleDamping ?? 0.92

        for (let i = 0; i < count; i++) {
          const ix = i * 3, iy = ix + 1, iz = ix + 2

          velocities[ix] += (home[ix] - positions[ix]) * SPRING
          velocities[iy] += (home[iy] - positions[iy]) * SPRING
          velocities[iz] += (home[iz] - positions[iz]) * SPRING

          velocities[ix] += (Math.random() - 0.5) * noiseAmt
          velocities[iy] += (Math.random() - 0.5) * noiseAmt
          velocities[iz] += (Math.random() - 0.5) * noiseAmt

          velocities[ix] *= damping
          velocities[iy] *= damping
          velocities[iz] *= damping

          positions[ix] += velocities[ix]
          positions[iy] += velocities[iy]
          positions[iz] += velocities[iz]
        }
      }

      pointsGeo.attributes.position.needsUpdate = true
    } else {
      // Static mode — keep in sync with terrain edits
      positions.set(home)
      pointsGeo.attributes.position.needsUpdate = true
    }
  })

  if (!p.showPoints || !pointsGeo) return null

  return (
    <points geometry={pointsGeo} material={particleMat} />
  )
})
