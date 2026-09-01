/**
 * What a roll is allowed to hand you.
 *
 * The randomiser is deliberately not a shuffle of 250 sliders — it makes a small
 * number of decisions and each one is a claim about what a good roll contains.
 * These pin the two that are easy to break silently: that a roll always draws
 * *something*, and that it never turns on the one part of the app nobody wants
 * arrived at by dice.
 */
import { describe, expect, it } from 'vitest'
import { randomPreset } from '../../src/utils/presetGenetics'
import { POINTS_DEF } from '../../src/defaults'

const SEEDS = Array.from({ length: 600 }, (_, i) => i + 1)
const rolls = SEEDS.map((s) => randomPreset(s))

describe('the randomiser', () => {
  it('never rolls a murmuration', () => {
    /*
     * A flock is a decision about the scene rather than about the drawing: a
     * hundred thousand animated boids with a roost, an updraft and an optional
     * predator is not a look you arrive at by dice. Rolled at random it was the
     * one thing people switched off again.
     */
    for (const p of rolls) {
      if (!p.points.showPoints) continue
      expect(p.points.particleMode).toBe('hologram')
    }
  })

  it('still rolls the hologram, so the field is not quietly dead', () => {
    // The rule above is satisfiable by never rolling particles at all, which
    // would be a different change from the one that was asked for.
    const withPoints = rolls.filter((p) => p.points.showPoints)
    expect(withPoints.length).toBeGreaterThan(3)
  })

  it('describes the particle field completely, every time', () => {
    // `applyPreset` merges over the previous state, so a partial block lets a key
    // the roll did not set survive from the roll before it — and the seed stops
    // being the look.
    for (const p of rolls.slice(0, 40)) {
      for (const k of Object.keys(POINTS_DEF)) expect(p.points).toHaveProperty(k)
    }
  })

  it('always draws something', () => {
    for (const p of rolls) {
      const modes = Object.keys(p.style).filter((k) => k.startsWith('enabled') && p.style[k])
      expect(modes.length > 0 || p.style.showFill || p.points.showPoints).toBe(true)
    }
  })

  it('is reproducible: the seed is the look', () => {
    for (const seed of [1, 7, 99, 4242]) {
      expect(JSON.stringify(randomPreset(seed))).toBe(JSON.stringify(randomPreset(seed)))
    }
  })
})
