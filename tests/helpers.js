/**
 * Shared test preconditions.
 *
 * The app opens on a style preset, which is what a visitor should meet and what
 * `discovery.spec.js` asserts. Every *other* spec wants a known, neutral
 * baseline — white paper, Lines on, nothing else — and used to get one only
 * because that happened to be what the app opened with. Depending on it was
 * invisible until the opening look changed; declaring it is the fix.
 */

/** Returns the app to bare defaults and clears the toast that offers an undo. */
export async function resetToDefaults(page) {
  // Wait for the opening preset to land first. It is gated on 56 preset files
  // downloading, so resetting before it arrives resets nothing — the preset then
  // applies on top and the baseline is silently the opening look after all.
  await page.waitForSelector('[data-testid="jump-to-presets"]', { timeout: 20000 })
    .catch(() => {})   // a restored session means no opening preset is coming

  /*
   * Wait for the control before pressing it, rather than letting `click()`
   * auto-wait against whatever is left of the test budget.
   *
   * This has twice ended a run with `Test timeout of 60000ms exceeded — waiting
   * for locator('button')…`, in different specs, which reads as though the app
   * failed to render. It is worth knowing what that log did *not* say: there was
   * no `locator resolved to` line and no `attempting click action`. A button
   * covered by the computing overlay produces both of those, so the panel was
   * genuinely not in the DOM yet — the app was still booting, twenty seconds
   * after the preset wait above had already given up on it.
   *
   * Waiting here buys no extra budget; it makes the failure say which precondition
   * was not met instead of blaming the click, and it fails fifteen seconds sooner.
   */
  const reset = page.locator('button', { hasText: /^Reset all$/ })
  await reset.waitFor({ state: 'visible', timeout: 45_000 })
  await reset.click()
  // The toast sits bottom-centre at a high z-index for nine seconds and would
  // swallow clicks aimed at anything under it.
  await page.locator('[data-testid="toast"] button[aria-label="Dismiss"]')
    .click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(900)

  // And collapse the Presets grid. Specs reach controls with force-clicks at
  // measured coordinates, and 56 tiles add roughly 3 000 px to the panel — enough
  // that a section which used to sit at y≈1000 is at y≈3800 and the click lands
  // on whatever is at the old spot. Closing it restores the geometry these specs
  // were written against, which is the rest of the baseline they assume.
  const presets = page.locator('[data-testid="section-presets"]')
  if ((await presets.getAttribute('aria-expanded')) === 'true') {
    await presets.click()
    await page.waitForTimeout(400)
  }
  await page.locator('#hm-panel-body').evaluate((el) => { el.scrollTop = 0 })
}
