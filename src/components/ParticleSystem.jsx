/**
 * Point markers + optional spring-physics particle animation.
 */
import { useRef, useState, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { cellElev } from '../utils/terrain'
import { hexToRgb } from '../utils/colorUtils'
import { useStore } from '../store/useStore'

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
  const nodataMask = useStore(s => s.nodataMask)
  const ps = useRef({
    positions:  null,
    velocities: null,
    home:       null,
    floor:      -Infinity,
    count:      0,
  })
  const [pointsGeo, setPointsGeo] = useState(null)

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

  const homePositions = useMemo(() => {
    if (!terrain) return null
    const { grid, rows, cols, scl, halfW, halfH, gridMask } = terrain

    if (p.particlePeaksOnly) {
      const lineStep = Math.max(1, Math.round((p.lineSpacing ?? 4) / scl))
      const pts = []
      const drawMode = Array.isArray(p.drawMode) ? p.drawMode : [p.drawMode]
      const byCol = drawMode.includes('lines-y')

      if (byCol) {
        for (let c = 0; c < cols; c++) {
          if (c % lineStep !== 0) continue
          let maxR = 0, minR = 0, maxElev = -Infinity, minElev = Infinity, hasAny = false
          for (let r = 0; r < rows; r++) {
            if (gridMask && !gridMask[r * cols + c]) continue
            const elev = cellElev(grid, r, c, cols, p.elevScale, p.jitterAmt)
            if (elev > maxElev) { maxElev = elev; maxR = r }
            if (elev < minElev) { minElev = elev; minR = r }
            hasAny = true
          }
          if (!hasAny) continue
          pts.push(c * scl - halfW, maxElev, maxR * scl - halfH)
          if (maxR !== minR) pts.push(c * scl - halfW, minElev, minR * scl - halfH)
        }
      } else {
        for (let r = 0; r < rows; r++) {
          if (r % lineStep !== 0) continue
          let maxC = 0, minC = 0, maxElev = -Infinity, minElev = Infinity, hasAny = false
          for (let c = 0; c < cols; c++) {
            if (gridMask && !gridMask[r * cols + c]) continue
            const elev = cellElev(grid, r, c, cols, p.elevScale, p.jitterAmt)
            if (elev > maxElev) { maxElev = elev; maxC = c }
            if (elev < minElev) { minElev = elev; minC = c }
            hasAny = true
          }
          if (!hasAny) continue
          pts.push(maxC * scl - halfW, maxElev, r * scl - halfH)
          if (maxC !== minC) pts.push(minC * scl - halfW, minElev, r * scl - halfH)
        }
      }
      return new Float32Array(pts)
    }

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
  }, [terrain, p.elevScale, p.jitterAmt, p.particlePeaksOnly, p.lineSpacing, p.drawMode])

  useEffect(() => {
    if (!homePositions) return
    const n = homePositions.length / 3
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

  const pointsGeoRef = useRef(null)
  useEffect(() => { pointsGeoRef.current = pointsGeo }, [pointsGeo])

  useImperativeHandle(ref, () => ({
    getPositions: () => ps.current.positions,
    getCount:     () => ps.current.count,
  }))

  useFrame(() => {
    const { positions, velocities, home, floor, count } = ps.current
    const pointsGeo = pointsGeoRef.current
    if (!positions || !pointsGeo) return

    if (p.animateParticles) {
      if (p.particleGravity) {
        const GRAVITY = 0.04 * (p.particleGravityStr ?? 1)
        const DAMPING = 0.97
        for (let i = 0; i < count; i++) {
          const ix = i * 3, iy = ix + 1, iz = ix + 2
          if (positions[iy] <= floor && velocities[iy] <= 0) {
            velocities[ix] = 0; velocities[iy] = 0; velocities[iz] = 0
            continue
          }
          velocities[iy] -= GRAVITY
          velocities[ix] *= DAMPING; velocities[iy] *= DAMPING; velocities[iz] *= DAMPING
          positions[ix] += velocities[ix]; positions[iy] += velocities[iy]; positions[iz] += velocities[iz]
          if (positions[iy] < floor) { positions[iy] = floor; velocities[iy] = 0 }
        }
      } else {
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
          velocities[ix] *= damping; velocities[iy] *= damping; velocities[iz] *= damping
          positions[ix] += velocities[ix]; positions[iy] += velocities[iy]; positions[iz] += velocities[iz]
        }
      }
      pointsGeo.attributes.position.needsUpdate = true
    } else {
      positions.set(home)
      pointsGeo.attributes.position.needsUpdate = true
    }
  })

  if (!p.showPoints || !pointsGeo) return null
  return <points geometry={pointsGeo} material={particleMat} />
})
