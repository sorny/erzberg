import { test, expect } from '@playwright/test'

async function openApp(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  const t = page.locator('[data-testid="sidebar-toggle"]')
  if ((await t.innerText()) === '◀') { await t.click(); await page.waitForTimeout(400) }
  await page.waitForTimeout(1500)
  // The Camera section is closed by default.
  await page.locator('[data-testid="section-camera"]').click()
  await page.waitForTimeout(400)
}

/** The number a slider row prints to the right of its track. */
// The number beside a slider is an editable field now, not a span, so the value
// is in `.value` — `textContent` on an input is always ''.
const readout = (page, id) =>
  page.locator(`[data-testid="${id}"]`).evaluate(n => {
    const el = n.parentElement.lastElementChild
    return (el.tagName === 'INPUT' ? el.value : el.textContent).trim()
  })

/** Right-button drag across the viewport — OrbitControls' screen-space pan. */
async function dragPan(page, dx, dy) {
  await page.mouse.move(500, 380)
  await page.mouse.down({ button: 'right' })
  const steps = 12
  for (let i = 1; i <= steps; i++) await page.mouse.move(500 + (dx * i) / steps, 380 + (dy * i) / steps)
  await page.mouse.up({ button: 'right' })
  await page.waitForTimeout(1200)
}

test('a mouse pan leaves the Pan fields on their own step grid', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openApp(page)

  await dragPan(page, -150, -110)

  // The camera is continuous; these sliders step by 1. Writing the raw orbit
  // target into them printed `-247.38194837` in the panel, and — worse — left
  // `<input type=range step=1>` snapped to a different value than the state, so
  // the first click on the slider jumped the camera instead of nudging it.
  for (const id of ['pan-x', 'pan-y', 'pan-z']) {
    const shown = await readout(page, id)
    const value = await page.locator(`[data-testid="${id}"]`).inputValue()
    expect(shown, `${id} must not print a fractional pan`).toMatch(/^-?\d+$/)
    expect(value, `${id} thumb must sit exactly where the readout says`).toBe(shown)
  }

  // Something must actually have moved, or the assertions above are vacuous.
  const moved = Math.abs(Number(await readout(page, 'pan-x'))) +
                Math.abs(Number(await readout(page, 'pan-y')))
  expect(moved, 'the drag must have panned the camera').toBeGreaterThan(10)

  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
})

test('clicking a Pan slider on its own thumb does not move the camera', async ({ page }) => {
  await openApp(page)
  await dragPan(page, -150, -110)

  const slider = page.locator('[data-testid="pan-x"]')
  const before = Number(await slider.inputValue())
  const box = await slider.boundingBox()
  // Click the track at exactly the position the current value maps to.
  const frac = (before + 1000) / 2000
  await page.mouse.click(box.x + box.width * frac, box.y + box.height / 2)
  await page.waitForTimeout(600)

  const after = Number(await slider.inputValue())
  expect(Math.abs(after - before), 'a click on the live value must be a no-op').toBeLessThanOrEqual(1)
})

test('Pan Z lifts the orbit target, and survives a mouse pan', async ({ page }) => {
  await openApp(page)

  // OrbitControls pans in screen space, so a vertical drag moves the target's
  // height. That used to be discarded — updateCameraFromSliders forced the
  // target to y = 0 — so the view snapped back to ground level on the next sync.
  await dragPan(page, 0, -160)
  const fromDrag = Number(await readout(page, 'pan-z'))
  expect(Math.abs(fromDrag), 'a vertical pan must reach Pan Z').toBeGreaterThan(5)

  // And the slider drives it the other way too.
  await page.locator('[data-testid="pan-z"]').fill('250')
  await page.waitForTimeout(600)
  expect(await readout(page, 'pan-z')).toBe('250')
})

test('auto-rotate starts turning rather than jumping', async ({ page }) => {
  // The canvas runs frameloop="demand", so a still scene draws nothing while the
  // clock behind useFrame keeps running. The first frame after a quiet spell
  // therefore arrives with a delta covering the whole spell, and integrating it
  // raw spent all of it in one step: nine seconds of stillness swung the camera
  // 96° before the second frame ever ran, against a steady 7.8°/s.
  await openApp(page)

  const rotation = page.locator('input.hmr[aria-label="Rotation"]')
  // Long enough that an unclamped delta would be unmistakable.
  await page.waitForTimeout(6000)

  const before = Number(await rotation.inputValue())
  await page.locator('input[type=checkbox][aria-label="Auto-rotate"]').click()
  await page.waitForTimeout(220)
  const firstStep = Math.abs(Number(await rotation.inputValue()) - before)

  // …and the rate it settles into, to compare the first step against.
  const settled = Number(await rotation.inputValue())
  await page.waitForTimeout(1000)
  const perSecond = Math.abs(Number(await rotation.inputValue()) - settled)

  expect(perSecond, 'auto-rotate must actually be turning').toBeGreaterThan(1)
  // The first step is one frame's worth, not six seconds' worth. Generous bound:
  // it only has to be nearer a frame than a stall.
  expect(firstStep,
    `first step ${firstStep}° must be in scale with the steady ${perSecond}°/s`)
    .toBeLessThan(perSecond)
})
