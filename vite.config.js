import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.GITHUB_PAGES ? '/erzberg/' : './',
  optimizeDeps: {
    include: ['three'],
  },
  build: {
    /*
     * The entry chunk is ~1.4 MB, and it is not going to get much smaller.
     *
     * Measured from a sourcemap build rather than assumed: of 3 493 kB of source
     * reaching the bundle, three is 2 058 kB (59%) and React's runtime — dom,
     * reconciler and fiber — is another 12%. Both are needed on first paint,
     * because the app *is* a canvas.
     *
     * three cannot be trimmed from here either. Since 0.16x it ships as two
     * prebuilt files, `three.core.js` and `three.module.js`, and its exports map
     * offers only `"."` — the 725 modules under `src/` are unreachable. Being one
     * enormous module, it barely tree-shakes: `AnimationMixer`, `AudioListener`,
     * `PositionalAudio` and `CubeCamera` are all in the output, and nothing here
     * uses any of them.
     *
     * So the ceiling on splitting app code is about 4% of the bundle. The two
     * exporters are split because they are pure opt-in paths behind an existing
     * async boundary and cost nothing to defer; the flock and the audio pipeline
     * are deliberately left eager, because a Suspense boundary inside the canvas
     * and a ref through `React.lazy` is real risk in the most timing-sensitive
     * code here, and it would buy two or three percent.
     *
     * The limit is raised to say "this is expected", not to silence a problem.
     */
    chunkSizeWarningLimit: 1500,
  },
})
