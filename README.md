<p align="center">
  <img src="public/logo.svg" alt="erzberg" width="420" height="160">
</p>

[![Deploy to GitHub Pages](https://github.com/sorny/erzberg/actions/workflows/deploy.yml/badge.svg)](https://github.com/sorny/erzberg/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A topographic visualisation tool built on React Three Fiber. Load a greyscale heightmap (8-bit or 16-bit PNG) or GeoTIFF — or an audio file — and render it as 3D line art, structural relief, or architectural sketch using one or more of the fourteen independent draw modes.

**Everything runs locally in your browser.** Your files never leave your machine — no server, no upload, no account.

**Live version:** [sorny.github.io/erzberg](https://sorny.github.io/erzberg/)

---

## Features

**Layered ghost occlusion.** Each line segment generates an invisible 3D curtain mesh that acts as a depth buffer. Lines occlude other lines rather than being swallowed by the terrain surface, and hidden segments can be rendered with a custom colour and opacity for an X-ray effect.

**Fourteen draw modes.** Every mode runs independently with its own colour, weight, dash pattern, and hypsometric tinting:

| Mode | Technique |
|---|---|
| Lines | Parallel terrain ridgelines at any bearing angle |
| Crosshatch | Two perpendicular line sets at a configurable angle |
| Pillars | Vertical extrusion per cell (line, cuboid, or cylinder shapes) |
| Contours | Marching Squares isolines, GIS-unit-aware, with optional ring closing and Chaikin smoothing for soft "form lines" |
| Hachure | Slope-directed short strokes |
| Flow Lines | Euler-integrated drainage paths |
| Stream Network | Strahler-order flow accumulation |
| Pencil Shading | Laplacian curvature detection |
| Ridge Detection | Hessian eigenvalue crest extraction |
| Valley Detection | Topographic Position Index troughs |
| Stipple Dots | Stochastic dot-density driven by slope or elevation |
| Engraving | Copperplate illumination cross-hatch — shadows accumulate up to 4 stacked stroke directions |
| Curvature | Streamlines traced through the principal-curvature direction field, evenly spaced — strokes wrap the shape rather than the light |
| Rock & Scree | Swisstopo-style cliff hachures + slope-graded debris dots |

**Surface overlays.** Hillshade with physically-based ray-march cast shadows: ridgelines occlude sunlight using a horizon-angle comparison across a progressive-step heightmap ray, with configurable darkness, softness (penumbra), and quality. An amber sun indicator sphere with starburst ray lines marks the light source position in the 3D scene. Azimuth and altitude drive both the Lambert shading and the cast shadows. Slope shading adds a two-colour steepness gradient blended over the fill.

**Soundscapes.** Upload an MP3 (or WAV / OGG / M4A) and the track becomes terrain. It is decoded and analysed once into a full spectrogram off-thread — radix-2 FFT, Hann-windowed STFT at 75% overlap, log or linear frequency binning — and playback then *streams* a scrolling window of that spectrogram into the heightmap slot a raster would occupy, so every draw mode, overlay and exporter works on it unchanged. The raw spectrogram is drawn in the sidebar with a playhead and a highlight marking the slice currently feeding the terrain; click or drag it to seek. Because the analysis is stored as dB over a fixed range, the noise gate and contrast controls re-slice the existing result instead of re-running the FFT. *Freeze Whole Track* writes the entire track as one static heightmap for the tools that need a terrain that holds still (erosion, STL, SVG).

**Hydraulic erosion.** Droplet-based simulation following [Hans Beyer's method](https://ardordeosis.github.io/implementation-of-a-method-for-hydraulic-erosion/thesis-beyer.pdf), running off the main thread in a Web Worker.

**Hologram particles.** Optional GPU-animated holographic point cloud over the terrain. A single time uniform drives per-particle float and two-octave fractal-noise displacement gated by a moving "scan" mask — all animation lives in the vertex shader, so nothing is looped or re-uploaded on the CPU per frame. Soft glowing sprites (bright core, glow-tinted halo, travelling scanline shimmer) are faked in the fragment shader, needing no post-processing pass and leaving the export paths intact. Configurable colour, size, glow, shimmer, float, noise amount/scale, flow speed, and reveal contrast.

**Exporters.** SVG (software Z-buffer projection with fill-based terrain occlusion, per-mode Inkscape/Illustrator layers, dash/dotted/long-dash patterns faithfully reproduced), 4K PNG with MSAA (WebGLRenderTarget, trimmed to content), PNG α (transparent background), STL (watertight mesh for 3D printing), greyscale heightmap PNG, and WebM screen recording. All exported files are named after the uploaded source file (e.g. uploading `graz.tif` produces `graz.svg`, `graz.png`, `graz-alpha.png`, `graz.stl`, `graz.webm`, `graz-heightmap.png`).

**Reproducible randomness.** The stochastic modes (Stipple, Rock & Scree) each have a seed slider — the same seed always reproduces the identical pattern, so a piece can be regenerated exactly.

**Built to idle, built to fly.** Rendering is on-demand — the canvas only draws a frame when something actually changes, so a static scene leaves the GPU near-idle (and the fan quiet). Continuous animations (auto-rotate, the hologram field, WebM capture) keep the loop alive only while they run. Camera interaction (orbit, pan, zoom) holds a locked 60 fps even zoomed-in at Retina resolution: the camera moves on the fast path while React state follows on a throttled tick, occlusion curtains extend only as deep as the terrain actually needs, and inactive render passes are skipped entirely. Geometry rebuilds run off-thread on growable typed-array writers with single-pass marching-squares contours (~18× faster than per-level scanning) and come back zero-copy — including the surface normals, so the main thread never stalls on a rebuild — and purely visual controls (line style, fill colour) never trigger a rebuild at all. The worker is long-lived and caches the source raster, so moving a slider sends only the parameters instead of re-copying the heightmap (256 MB for an 8k GeoTIFF) on every rebuild. Rebuild requests that arrive faster than builds complete are coalesced — newest wins, queued rather than cancelled — because cancelling each one meant nothing ever finished under a continuous stream; the worker is torn down only for a build that is a genuine outlier against the current cadence. Smoothed contours are decimated with Douglas–Peucker between Chaikin passes, which keeps 40× the geometry off the GPU for a deviation of ~0.05 grid units (well under a pixel), and surface normals and UVs are skipped entirely when no fill layer is drawing them.

**Supersampling.** Dense hairline art is finer than the pixel grid, so it can shimmer while the camera moves. An optional View → Supersampling slider renders the canvas internally at up to 2× the device pixel ratio (measured: ~93% fewer hard pixel flips during a slow rotate), trading GPU fill rate for a calm, print-like image in motion.

---

## Tech stack

| Layer | Library |
|---|---|
| 3D engine | React Three Fiber + Three.js |
| State | Zustand (heightmap data) + React state (all UI params) |
| GIS parsing | GeoTIFF.js |
| UI | Custom sidebar panel + Tailwind CSS |
| Geometry | Web Workers (geometry, erosion and spectrogram off-thread) |
| Audio | Web Audio `decodeAudioData` + in-house radix-2 FFT (no dependency) |

---

## Documentation

- [Draw mode mathematics](docs/Draw-Modes.md)
- [Hydraulic erosion algorithm](docs/Hydraulic-Erosion.md)
- [Soundscapes: audio → terrain](docs/Soundscapes.md)

---

## Development

```bash
npm install
npm run dev              # dev server at http://localhost:5173
npm run build            # production build
npm run test             # Playwright end-to-end suite
npm run test:ui          # Playwright interactive UI
npx playwright test tests/lines.spec.js   # single spec
npm run update-presets   # round-trip all presets through the live app
```

Tests run against a live dev server in non-headless Chrome with WebGL enabled.

---

## License

MIT — Copyright (c) 2026 sorny.
