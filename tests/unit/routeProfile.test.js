import { describe, expect, it } from 'vitest'
import { distanceTicks, formatKm, haversine, routeProfile } from '../../src/utils/routeProfile'

describe('the route profile', () => {
  it('measures a degree of latitude as about 111 km', () => {
    expect(haversine(47, 14, 48, 14) / 1000).toBeCloseTo(111.2, 0)
  })

  it('sums the climb and the drop over a hill', () => {
    // North along a meridian over a ridge: 0 → 1 → 0 as a raster value.
    const route = new Float64Array([14, 47.0, 14, 47.05, 14, 47.1])
    const valueAt = (lat) => 1 - Math.abs(lat - 47.05) / 0.05
    const r = routeProfile(route, valueAt, (v) => 1000 + v * 500, 101)
    expect(r.distanceM / 1000).toBeCloseTo(11.1, 0)
    expect(r.ascent).toBeCloseTo(500, 0)
    expect(r.descent).toBeCloseTo(500, 0)
    expect(r.elevMax).toBeCloseTo(1, 5)
    expect(r.off).toBe(0)
  })

  it('fills short gaps off the terrain, and gives up when most of it is off', () => {
    const route = new Float64Array([14, 47.0, 14, 47.1])
    const holey = routeProfile(route, (lat) => (lat > 47.09 ? null : 0.5), (v) => v, 50)
    expect(holey.points.every((v) => v === 0.5)).toBe(true)
    expect(routeProfile(route, () => null, (v) => v)).toBeNull()
  })

  it('ticks at round distances', () => {
    expect(distanceTicks(12400)).toEqual([0, 5000, 10000])
    expect(formatKm(850)).toBe('850 m')
    expect(formatKm(12400)).toBe('12.4 km')
  })
})
