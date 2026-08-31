import { test, expect } from '@playwright/test'

/**
 * No third party is contacted to draw the panel.
 *
 * Space Mono sets the wordmark and Edit Mode's label, and it used to come from
 * fonts.googleapis.com — a request on every load that handed a visitor's IP to
 * Google. The README promises everything runs locally; that promise is about the
 * user's files and stayed true either way, but "no server" reads more broadly,
 * and this is what makes it mean what it says.
 */
test('the app loads without contacting anyone', async ({ page }) => {
  const external = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.hostname !== 'localhost' && u.protocol !== 'data:' && u.protocol !== 'blob:') {
      external.push(r.url())
    }
  })
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30000 })
  await page.waitForTimeout(2500)
  expect(external, `contacted: ${external.join(', ')}`).toEqual([])
})

test('the self-hosted face is the one that renders', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30000 })
  const r = await page.evaluate(async () => {
    await document.fonts.ready
    const loaded = [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`)
    const h1 = document.querySelector('h1')
    return {
      loaded,
      // Space Mono is monospaced; the platform fallback may not be, so the
      // widths of an i and an m are what actually prove which face is in use.
      family: h1 && getComputedStyle(h1).fontFamily,
      mono: await (async () => {
        const c = document.createElement('canvas').getContext('2d')
        c.font = "700 13px 'Space Mono', monospace"
        return c.measureText('i').width === c.measureText('m').width
      })(),
    }
  })
  expect(r.loaded.some((f) => f.includes('Space Mono') && f.includes('loaded'))).toBe(true)
  expect(r.family).toContain('Space Mono')
  expect(r.mono).toBe(true)
})
