import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { declination, decimalYear, formatDeclination } from '../../src/utils/magnetic'

// NOAA's own WMM2025 test values: year, height (km), latitude, longitude, declination.
const rows = readFileSync(new URL('./wmm2025-test-values.csv', import.meta.url), 'utf8')
  .trim().split('\n').map((l) => l.split(',').map(Number))

describe('magnetic declination', () => {
  it('matches every WMM2025 test value to 0.01°', () => {
    expect(rows.length).toBeGreaterThan(10)
    for (const [year, alt, lat, lon, want] of rows) {
      const got = declination(lat, lon, year, alt).declination
      expect(Math.abs(got - want), `${year} ${lat},${lon}`).toBeLessThan(0.011)
    }
  })

  it('is about 5° east at the Erzberg in 2026', () => {
    const { declination: d, valid } = declination(47.52, 14.9, 2026.84)
    expect(valid).toBe(true)
    expect(d).toBeGreaterThan(4)
    expect(d).toBeLessThan(6.5)
  })

  it('flags a year outside the model', () => {
    expect(declination(47, 14, 2031).valid).toBe(false)
  })

  it('reads dates and prints the angle', () => {
    expect(decimalYear(new Date(Date.UTC(2026, 0, 1)))).toBe(2026)
    expect(formatDeclination(4.63)).toBe('4.6° E')
    expect(formatDeclination(-1.25)).toBe('1.3° W')
  })
})
