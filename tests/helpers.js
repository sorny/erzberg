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
  await page.locator('button', { hasText: /^Reset all$/ }).click()
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
