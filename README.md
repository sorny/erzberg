<p align="center">
  <img src="public/logo.svg" alt="erzberg" width="420" height="160">
</p>

<p align="center">
  <a href="https://github.com/sorny/erzberg/actions/workflows/deploy.yml"><img src="https://github.com/sorny/erzberg/actions/workflows/deploy.yml/badge.svg" alt="Deploy to GitHub Pages"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

<p align="center">
  Turn elevation data into line art. A topographic visualisation tool built on React Three Fiber.
</p>

<p align="center">
  <b><a href="https://sorny.github.io/erzberg/">sorny.github.io/erzberg</a></b>
</p>

---

Load a greyscale heightmap (8-bit or 16-bit PNG), a GeoTIFF, or an audio file.
The app renders it as 3D line art, structural relief or an architectural sketch.
Thirty-two independent draw modes do the work. They range from surveyor's
marks such as hachures and form lines to a quantised tilemap. Others are a
flashbulb with a cast shadow, and tracks that something with mass laid down a
face. Five of them are about colour rather than about mark-making.

Contours letter their own heights. The app sets the number into a break in the
line, at the angle of the line, in the ink of the line.

Export to SVG for a pen plotter, to STL for a printer, or to 4K PNG for the wall.

**Everything runs locally in your browser.** Your files never leave your
machine. There is no server, no upload and no account. The app makes no
third-party request on load, because it serves the one webfont from its own
origin.

<table>
  <tr>
    <td width="33%"><img src="docs/images/preset-unknown-pleasures.png" alt="Unknown Pleasures preset"></td>
    <td width="33%"><img src="docs/images/preset-alpine-survey.png" alt="Alpine Survey preset"></td>
    <td width="33%"><img src="docs/images/preset-static.png" alt="Static preset"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Unknown Pleasures</b> — stacked ridgelines</sub></td>
    <td align="center"><sub><b>Alpine Survey</b> — hypsometric fill, hillshade, contours</sub></td>
    <td align="center"><sub><b>Static</b> — slope-inverted stipple dots</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/preset-thermal-camera.png" alt="Thermal Camera preset"></td>
    <td><img src="docs/images/preset-copper-plate.png" alt="Copper Plate preset"></td>
    <td><img src="docs/images/preset-x-ray.png" alt="X-Ray preset"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Thermal Camera</b> — hypsometric fill + sky-view AO</sub></td>
    <td align="center"><sub><b>Copper Plate</b> — curvature engraving</sub></td>
    <td align="center"><sub><b>X-Ray</b> — lines and crosshatch, ghost-occluded</sub></td>
  </tr>
</table>

<sub>Six of the 56 bundled presets. The app rendered all six from the same sample
heightmap through its own PNG exporter.</sub>

---

## Quick start

Use the [hosted version](https://sorny.github.io/erzberg/), or run it yourself:

```bash
npm install
npm run dev              # http://localhost:5173
```

The app opens on a bundled sample heightmap under a style preset. Thus there is
something worth a look before you load a file. The picture is the landing page.
Pick a different style from the grid. Then tune it. *Reset all* returns the app
to bare defaults, which are not the same as the look that it opens on.

**The panel remembers.** The app writes terrain, style, particles, view and both
gradients to the browser as you work, and restores them on your next visit. A
reload thus does not cost you the look that you built. The app does not store
the raster. It opens on its sample plate and puts your parameters back onto it.
*Reset all* returns everything to defaults and offers an Undo for the next eight
seconds.

**Find a control.** The panel has more than thirty sections, which is a lot to
remember the shape of. The field at the top of the panel narrows them. Type
`azimuth`. Only Hillshade then remains, open, with the sun controls in it.
Sections answer to their own vocabulary as well as to their titles, so the field
also finds sections that are switched off. Clear the field. The panel then
returns to exactly its previous state.

---

## Input

| Source | Notes |
|---|---|
| **PNG** | 8-bit, or 16-bit. The app decodes 16-bit natively, because the canvas path truncates it to 8-bit without a word. The app reads alpha as NoData. |
| **GeoTIFF** | Real elevation. The app reports the coordinate system of the file instead of an assumption, honours the declared NoData value, and suggests a vertical exaggeration from the real ground size of a pixel. |
| **Audio** | MP3, WAV, OGG or M4A. The app analyses the file into a spectrogram that drives the terrain. |
| **GPX** | The app drapes the track line over a georeferenced raster. |
| **GeoJSON** | Points, lines and polygons, draped the same way. |
| **OpenStreetMap** | The app queries the extent of the raster live for roads, water, rail, landuse, buildings, lifts and peaks. |

**Vector layers.** The section is always in the panel. If the section has
nothing to work with, it says what it needs. With a georeferenced raster loaded,
tick what you want from OpenStreetMap. The data arrives as named layers —
*Roads · Motorway*, *Water · Stream*, *Landuse · Forest* — one layer per tag
class. The app makes a layer only for the classes that are in the data.

Each layer has its own colour, weight, opacity and dash. You can hide a layer or
remove it. An area can carry a fill that follows the slope instead of a flat lid
over it. The list is a stack, and the top row is the front of the scene. Drag a
row by its grip to change what covers what, on screen and in the plot.

Inside a layer, the panel lists the features individually with a checkbox. You
can keep five peaks out of twenty-nine. Rest the pointer on a feature. The panel
then names it and lights it up, so a dot on the terrain becomes
*Polster · 1910 m*.

A point feature can carry its **name and height as labels**. The labels use the
same Space Mono as the logo, in regular, bold or italic. The app draws them as
real geometry, so they plot as strokes in their own pen layer. The SVG export
writes real `<text>` that you can retype in Inkscape, not paths that you can
only redraw.

You can also set the labels in a **single-line font**. There are 49 stroke
faces. They are the Hershey originals, the EMS conversions from Evil Mad
Scientist, and the Relief SingleLine family. The set also holds ISO 3098 (the
lettering standard for technical drawings) and three fonts that were born on a
plotter. In a stroke face, a
letter is the centre line of each stem rather than its outline. An outlined 'A'
plots as two closed contours, and the pen goes round it twice. The Hershey 'A'
is three strokes. Measured on the same pair of labels, the label layer of the
SVG is a quarter of the size.

The icon and the lettering each carry their own ink: colour, stroke width,
opacity, and a fill with its own colour and opacity. The stroke sits outside the
shape or centred on its edge. These parameters are independent of each other and
of the layer. If a summit has no name in the data, the app leaves it unlabelled
rather than numbered.

A point feature can also drop the dot for an **SVG icon**. Pick one of sixteen
map-and-terrain marks drawn solid, or upload your own file. The app lifts the
icon off the ground on a leader line and turns it in 3D to match the view.
GeoJSON and GPX uploads join the same list.

The app drapes every layer. It simplifies each feature to what the DEM can
express, then cuts it down to the grid step. A motorway thus follows the ground
over a ridge instead of a tunnel through it. A recolour or a restack costs a
frame, not a rebuild. Layers carry into the SVG, PNG and video exports. Each
layer becomes one Inkscape layer in the SVG, so you can separate a plot by pen.
→ [Georeferencing](docs/Georeferencing.md)

**Georeferenced input, stated rather than assumed.** A GeoTIFF reports its
coordinate system in the sidebar — `WGS 84 / UTM zone 33N (EPSG:32633)`. If a
reading rests on an assumption, the panel says so. It does not imply a precision
that it lacks. The app projects features from WGS84 into the grid of the raster.
It supports a geographic CRS, Web Mercator, and the WGS84, ETRS89, NAD83 and
NAD27 UTM zone blocks. The app names and declines the national grids that need
Lambert or Gauss-Krüger maths plus a datum shift, rather than an
approximation of them. An overlay 400 m out in silence is worse than one that
tells you to run `gdalwarp` first.

If features do not appear, the panel gives the reason. Four cases otherwise look
the same: not projectable, not georeferenced, projected but somewhere else, and
drawable but not queryable. The last case applies to the OSM query alone,
because that query needs the *inverse* projection.

---

## Edit Mode

<img src="docs/images/edit-mode.png" alt="Edit Mode: a lasso selection with editable points and a feathered edge over the heightmap">

Press `E`. The viewport then becomes a flat picture of the raster. Crop it with
a handled rectangle, which has aspect locks and numeric fields. Or draw an
ellipse, and hold Shift for a perfect circle. Or cut out an arbitrary region
with a lasso or a polygon.

A lasso or a polygon stays editable after you close it. Drag a point to move it.
Drag an edge to add a point. Right-click a point to remove it. Before you press,
the cursor names the handle that it is over, so you can find the small ones. The
app centres the result automatically. Feather ramps the clipped edge down to the
base level of the terrain instead of an end in a cliff.

The clip is non-destructive. The app keeps the original raster. You can enter Edit Mode
again to adjust the clip, or clear the clip to get the whole heightmap back.
Edit Mode works the same way on a PNG, a GeoTIFF and a Soundscape. The app
re-derives the bounding box of a GeoTIFF over the crop, so vector layers stay
where they belong. Every draw mode stops cleanly at the cut and does not read
the empty ground beyond it. Read
[NoData and clipped edges](docs/Draw-Modes.md#nodata-and-clipped-edges).
→ [Edit Mode](docs/Edit-Mode.md)

---

## Draw modes

Every mode runs independently. Each one has its own colour, weight, dash pattern
and hypsometric tinting. → [Draw mode mathematics](docs/Draw-Modes.md)

| Mode | Technique |
|---|---|
| Lines | Parallel terrain ridgelines at any bearing angle |
| Crosshatch | Two perpendicular line sets at an angle that you set |
| Pillars | Vertical extrusion per cell (line, cuboid or cylinder) |
| Contours | Marching Squares isolines, GIS-unit-aware, with optional ring closing and Chaikin smoothing for soft "form lines" |
| Hachure | Slope-directed short strokes |
| Flow Lines | Euler-integrated drainage paths |
| Stream Network | Strahler-order flow accumulation |
| Pencil Shading | Laplacian curvature detection |
| Ridge Detection | Hessian eigenvalue crest extraction |
| Valley Detection | Topographic Position Index troughs |
| Stipple Dots | Stochastic dot density driven by slope or elevation |
| Isophotes | Lines of constant illumination — light drawn, not hatched by |
| Engraving | Copperplate illumination cross-hatch — shadows accumulate over up to 4 stacked stroke directions |
| Curvature | Evenly spaced streamlines through the principal-curvature direction field — strokes wrap the shape rather than the light |
| Rock & Scree | Swisstopo-style cliff hachures plus slope-graded debris dots |
| Bitplane | Marching squares with the interpolation removed: flat plateaus, hard lattice staircases, a Bayer screen between them |
| Sprite Blocks | The same quantiser drawn as blocks — one riser per step, top faces filled |
| Flashbulb | A point light *inside* the scene with 1/r² falloff and a marched cast shadow, grained with a void-and-cluster blue-noise tile |
| Halation | Blown highlights bleed into the shadow beside them — the overexposure blurred, then subtracted from the grain |
| Reticulation | Worley cell walls thinned by tone: crazed emulsion, found without a Voronoi |
| Fall Line | Descent with mass. A velocity, not a position — it overshoots, banks, and runs out onto the flat where Flow stops |
| Berms | The same tracks drawn as lateral load: a tick on the outside of every turn, nothing on the straights |
| Air | The jumps, found rather than drawn — spans where the ballistic path clears the surface, on their true parabola |
| Race Line | Every line that one drop-in could take, with the one that reaches lowest ground soonest inked heavier |
| Exploded Frame | A braced space frame pulled apart along Y — the diagonal placed and oriented by the twist of the terrain |
| Section | A cutting plane drawn as a drawing: heavy cut face, 45° hatch over the material below, outline beyond |
| Zero Crossings | Sign changes of the detrended scanline — the local pitch of the terrain, which is neither slope nor curvature |
| Indexed | Colour as a lookup, not a sample: elevation tier by slope class, Bayer-dithered between adjacent palette entries |
| Outrun | An additive halo under a near-white filament — where contours crowd, the halos sum and the ground lifts |
| Riso | Three spot inks screened at 15°, 45° and 75°, multiplied together. Registration and a coverage cap decide which press you are on |
| Mineral | Five materials classified by slope and curvature, each with a flat colour and its own grain |
| Watershed | Every cell labelled with the sink it drains to, one flat ink per catchment. The divides are ridgelines |

**Layered ghost occlusion.** Each line segment makes an invisible 3D curtain
mesh that acts as a depth buffer. Lines then occlude other lines, and the
terrain surface does not swallow them. Hidden segments can take their own colour
and opacity for an X-ray effect.

**Paper frame.** Turn on a frame. The viewport then shows where a sheet falls
over the scene. The choices are ISO A, US Letter, US Legal, US Tabloid, square,
4:3, 3:2, golden, 16:9, or a ratio of your own. A frame can be portrait or
landscape, and it can have an inner margin. The SVG export then emits only what
lands inside the frame, *cut at the boundary* rather than hidden behind a clip
path. The app splits lines at the page edge and drops the dots outside it, so
the file holds nothing for you to delete afterwards. The page becomes the shape
that you chose, not the bounding box that the geometry happened to occupy.

**Sections that you can see.** Click two points. The elevation profile then
draws the cut that it sampled: a pin at each end, and a line draped over the
surface between them. The chart on screen is thus anchored to a place on the
terrain, not a curve with no address. The section exports as its own SVG — ink
on paper, with its axis, its elevation range and both ends labelled. It can sit
beside a plotted plate or in a document. Both are viewport aids. The app draws
them over the scene, but flags them out of the PNG capture and hides them during
a recording. Nothing that you composed for the screen thus lands in a print.

**Colour as the subject.** Five modes treat colour as the thing drawn rather
than as a property of a mark. They are the only layers in the tool that do not
composite normally. Outrun adds light, which is why it wants a dark ground. Riso
multiplies ink, which is why it wants paper. Three of them draw area rather than
line, and export the boundary between regions so a plotter still gets a map.

**Reproducible randomness.** The stochastic modes are Stipple, Rock & Scree,
Flashbulb, Halation and Reticulation. Each one carries a seed. The same seed
always reproduces the identical pattern, so you can regenerate a piece exactly.

Every mode carries a small sample of its own marks in its panel header. The list
thus reads as ways to draw, not as a column of cartographic nouns.

**56 style presets** ship with the app. Each preset is a complete look: draw
modes, colours, gradients and particle parameters. The app shows them as
thumbnails, not as a wall of identical buttons. The tile that you started from
stays marked, and says *edited* after you tune away from it.

**Surprise me.** A seeded randomiser rolls a look. It does not shuffle 250
sliders. It picks paper or ink, one to three draw modes against a cost budget, a
palette, and at most one surface overlay. Then it compares the ink against the
background, so nothing comes back invisible. The panel shows the seed, and the
arrow steps back through recent rolls. The seed *is* the look, so you can always
return to it.

---

## Surface overlays

- **Hillshade** with physically-based ray-marched cast shadows. Ridgelines
  occlude sunlight through a horizon-angle comparison along a progressive-step
  heightmap ray. Darkness, softness (penumbra) and quality are parameters.
  Azimuth and altitude drive both the Lambert shading and the shadows, and an
  amber sun indicator marks the light in the scene. Multi-directional mode
  blends several azimuths.
- **Slope shading** — a two-colour steepness gradient blended over the fill.
- **Aspect map** — slope direction as a hue wheel.
- **Sky View Factor** ambient occlusion, ray-marched over the sky hemisphere.
- **Water fill** at a level that you choose, and **Tanaka illumination** that
  splits contours into thick-bright and thin-dark halves.
- **Hypsometric tinting** per layer, driven by a shared editable gradient.
- **Texture overlay** with blend modes, scale and offset.

---

## Terrain tools

- **Raw terrain view** — one toggle shows the data behind the art. The heightmap
  becomes a flat greyscale plane, with the lowest point black and the highest
  white. The app stretches the range, so a raster that occupies only part of it
  still reads at full contrast. The view reflects resolution, blur, Levels and
  the elevation cuts, so it also works as a live preview while you tune them.
  The shader does the flattening, so the toggle costs no rebuild. Every exporter
  still sees the real terrain.
- **Levels** — black and white points over a live histogram, plus elevation
  cuts.
- **Hydraulic erosion** — a droplet simulation off the main thread. It follows
  [Hans Beyer's method](https://ardordeosis.github.io/implementation-of-a-method-for-hydraulic-erosion/thesis-beyer.pdf).
  → [Hydraulic erosion](docs/Hydraulic-Erosion.md)
- **Mirror** — reflect the raster on X or Y for kaleidoscopic terrain, and
  render octants selectively.
- **Analysis** — click two points for an elevation cross-section. The app marks
  the cut on the terrain with a green pin at A, a red pin at B and a draped line
  between them. The chart exports as a standalone SVG. The app reports the
  hypsometric integral continuously.
- **Hologram particles** — an optional GPU-animated point cloud. A single time
  uniform drives per-particle float and two-octave fractal-noise displacement,
  gated by a moving scan mask. All animation lives in the vertex shader, so the
  app loops nothing and re-uploads nothing per frame. The fragment shader fakes
  the glowing sprites with no post-processing pass.
- **Murmurations** — the same field, in flight. The landscape steers up to
  100 000 boids. They keep their distance from the ground, orbit a roost on the
  highest peak, and ride the updraft on steep slopes. When the optional predator
  gives chase, they scatter into waves. Each bird flies with its eight nearest
  neighbours rather than with everything within a radius. That is the
  topological rule that real starlings obey, and it keeps the flock cohesive at
  any density and the cost linear in population. The app draws the birds with
  velocity streaks. Each bird casts a shadow onto the terrain that grows and
  fades with its height, lit by the same sun as the hillshade. Press `Space` to
  pause. Unlike the hologram, the positions live on the CPU, so an export of a
  frozen flock gives an SVG of exactly what is on screen. Drop an MP3 on the
  Particles panel and the flock flies to it: bass opens it out, highs make it
  restless, and onsets scatter it. The terrain stays exactly the landscape that
  you loaded. → [Murmurations](docs/Murmurations.md)

---

## Soundscapes

Upload a track. It becomes terrain. The app decodes and analyses the audio once,
off-thread, into a full spectrogram. It uses a radix-2 FFT and a Hann-windowed
STFT at 75% overlap, with log or linear frequency bins. Playback then *streams* a
scrolling window of that spectrogram into the same slot that a raster occupies.
Every draw mode, overlay and exporter thus works on it unchanged.

The sidebar draws the spectrogram with a playhead and a highlight. The highlight
marks the slice that currently feeds the terrain. Click or drag to seek. The app
stores the analysis as dB over a fixed range. The noise gate and contrast
controls thus re-slice the stored result instead of a new FFT run.

*Freeze Whole Track* writes the entire track as one static heightmap, for the
tools that need a terrain that holds still. It can take five shapes. The first
is a stretched spectrogram. The second is a **Disc**, wound like a record: match
the turn count to the bar count, and repeats line up radially. The third is a
**Similarity** matrix, where repeated choruses become diagonal stripes. The
fourth is a **Weave**, folded onto the detected bar grid, so the groove stacks
into ridges. The fifth is **Strata**, which stacks loudness, brightness, onset
density and harmony as layers over one timeline.
→ [Soundscapes](docs/Soundscapes.md)

---

## Export

| Format | Notes |
|---|---|
| **SVG** | Software Z-buffer projection with fill-based terrain occlusion. One named Inkscape or Illustrator layer per draw mode and per vector layer. Dash patterns are faithful. The export shows progress and you can cancel it. A dense plate takes real time, and the page stays responsive throughout |
| **PNG** | 4K with MSAA, trimmed to content |
| **PNG α** | Transparent background |
| **STL** | Watertight mesh for 3D printing. The export shows progress and you can cancel it, like the SVG export. A vector layer with **STL ribbon** on gets a second solid for multicolour printing. The default is on for GPX and off for OSM |
| **Heightmap PNG** | The processed greyscale raster |
| **WebM** | Screen recording of the live canvas |
| **Profile SVG** | The elevation cross-section as a standalone chart, ink on paper |

The app names exports after the source file. `graz.tif` produces `graz.svg`,
`graz.png`, `graz-alpha.png`, `graz.stl`, `graz-heightmap.png`,
`graz-profile.svg`, `graz-vectors.stl` and `graz.webm`. Each export says which
name it wrote when it finishes, so the download shelf is not the only evidence.
Presets save and load as JSON, and they can carry the heightmap with them.

---

## Keyboard

| Key | Action |
|---|---|
| `E` | Enter Edit Mode |
| `Esc` | Cancel the current shape, leave Edit Mode, or cancel an elevation-profile pick |
| `Enter` | Close the current shape, or apply the clip |
| `Backspace` | Remove the last polygon vertex |
| `Shift` | While you draw or resize an ellipse, constrain it to a circle |
| Right-click | Remove a point from a committed lasso or polygon |
| `Q` | Toggle auto-rotate |
| `\` | Show or hide the control panel |
| `1` – `5` | Export SVG, PNG, PNG α, STL, WebM |

Every shortcut is a bare key. A chord — `⌘1`, `⌘E`, `Ctrl+5` — belongs to the
browser or the OS and passes through untouched.

---

## Reach

The panel runs on four type roles, three radii and one palette, published as CSS
custom properties. A retune is thus a token edit, not four hundred inline ones.
Every control that fills with the accent under white text uses the deeper
`#2f6fe0`, which reads 4.7:1. The lighter accent works behind a 34 px toggle,
but not behind a 10 px uppercase label.

Nobody will use a 3D terrain tool without sight, and a claim to the contrary is
worse than the plain statement. The controls owe the part that plenty of sighted
people depend on. Every slider, toggle, colour well and segmented choice carries
its own name. Voice control thus has something to say, and a screen reader has
something to read.

Section headers are buttons with `aria-expanded`. That is what lets the keyboard
open one, and everything inside a collapsed section was unreachable before. A
focused slider shows a ring. Its arrow keys were always the only way to set an
exact value from the keyboard. Panel text is at or above 4.5:1 at the size that
it is set, and the smallest control sits in a 20 px hit box.

---

## Performance

The app idles quietly and stays responsive under load.

- **On-demand rendering.** The canvas draws a frame only when something changes.
  A static scene thus leaves the GPU near-idle. Continuous animations keep the
  loop alive only while they run.
- **60 fps camera.** Orbit, pan and zoom move the camera on the fast path. React
  state follows on a throttled tick, so the sidebar never re-renders per frame.
- **Off-thread geometry.** Rebuilds run in a long-lived worker over growable
  typed-array writers. The results come back zero-copy, and they include surface
  normals. Single-pass marching-squares contours are about 18 times faster than
  per-level scanning. The worker caches the source raster. A slider move thus
  sends parameters instead of a copy of a 256 MB raster.
- **Coalesced rebuilds.** Requests that arrive faster than builds complete go
  into a queue on a newest-wins rule. The app does not cancel each one, because
  cancellation meant that nothing ever finished under a continuous stream. The
  app kills a build only when it is a genuine outlier against the current
  cadence.
- **The app computes only what something will look at.** Purely visual controls
  never trigger a rebuild. The app skips surface normals and UVs when no fill
  layer draws them. It builds the particle field, the occlusion curtains and the
  268 MB ray-marching texture only when something needs them. It caches the
  full-resolution blur against the raster and the radius. Douglas–Peucker
  decimates smoothed contours between Chaikin passes, which keeps 40 times the
  geometry off the GPU for a deviation well under a pixel. SVG export scales
  occlusion sampling to the screen length of each segment instead of a flat 64
  samples (1042 ms → 265 ms).
- **Supersampling.** Hairline art is finer than the pixel grid and can shimmer
  in motion. An optional slider renders internally at up to 2 times the device
  pixel ratio. Measured: about 93% fewer hard pixel flips during a slow rotate.
  The slider trades fill rate for a calm, print-like image.

---

## Tech stack

| Layer | Library |
|---|---|
| 3D engine | React Three Fiber + Three.js |
| State | Zustand (raster data) + React state (all UI parameters), persisted to `localStorage` between visits |
| GIS parsing | GeoTIFF.js, plus in-house GeoJSON, GPX and Overpass readers with no dependency |
| Icons | Maki (CC0), flattened to polylines through the SVG geometry API of the browser |
| Labels | Space Mono (SIL OFL 1.1) in four faces. `npm run font` converts them to glyph outlines, flattened the same way. The wordmark of the panel uses the same face as a self-hosted woff2 of 9.6 kB, so the app contacts nobody on load |
| Single-line fonts | 49 stroke faces — Hershey (liberal, acknowledgement required) and EMS (SIL OFL 1.1) from [oskay/svg-fonts](https://gitlab.com/oskay/svg-fonts), [Relief SingleLine](https://github.com/isdat-type/Relief-SingleLine) (SIL OFL 1.1), ISO 3098 (public domain), and the Commodore 1520 (WTFPL), Apple 410 (MIT) and DearPlotter (SIL OFL 1.1) plotter faces. `npm run fonts:single-line` flattens them |
| Map data | OpenStreetMap through the Overpass API — ODbL, attributed in the panel and in every SVG |
| UI | Custom sidebar panel + Tailwind CSS |
| Geometry | Web Workers (geometry, erosion, spectrogram) |
| Audio | Web Audio `decodeAudioData` + an in-house radix-2 FFT with no dependency |
| Tests | Vitest for the pure maths. Playwright against a live dev server in real Chrome |

---

## Documentation

- [Architecture: how a file becomes a picture](docs/Architecture.md)
- [Draw mode mathematics](docs/Draw-Modes.md)
- [Edit Mode: cropping and selections](docs/Edit-Mode.md)
- [Georeferencing: projections, vector layers, OpenStreetMap, elevation](docs/Georeferencing.md)
- [Hydraulic erosion algorithm](docs/Hydraulic-Erosion.md)
- [Murmurations: boids over the terrain](docs/Murmurations.md)
- [Soundscapes: audio → terrain](docs/Soundscapes.md)
- [Changelog](CHANGELOG.md)

---

## Development

```bash
npm install
npm run dev              # dev server at http://localhost:5173
npm run build            # production build
npm run lint             # ESLint — correctness rules only, no formatting
npm run test:unit        # Vitest — the pure maths, ~0.3s
npm run test             # Playwright end-to-end suite
npm run test:ui          # Playwright interactive UI
npx playwright test tests/lines.spec.js   # a single spec
npm run update-presets   # round-trip all presets through the live app
npm run thumbs           # regenerate the preset thumbnails
npm run fonts:single-line # refetch and reflatten the 49 stroke faces
npm run licenses         # regenerate dist/THIRD-PARTY-NOTICES.txt
npm run logo             # flatten any <text> in the brand SVGs to outlines
```

`logo` exists because an SVG used as an `<img>` cannot load anything external,
fonts included. The README embeds the logo that way. Measured: as a document,
`logo.svg` made two requests to Google and rendered in Space Mono. Inside an
`<img>` it made none and fell back to Courier New. The wordmark thus never
rendered in its own typeface where it is actually in use. Outlines have nothing
to fetch and nothing to fall back to. They come from the same
`space-mono-*.json` files that the 3D labels use, and they are *more* faithful
than the text was: the browser hinted the `b` ascender down to 0.639 em, where
the font draws it at 0.700.

`licenses` runs as part of `build`, so nobody can produce a `dist/` without its
notices by accident. Every permissive licence in the tree asks for the same
small thing. MIT wants its notice "included in all copies". BSD and ISC say it
in their own words. Apache-2.0 §4 wants a copy of the licence. Minification
strips all of them out of the bundle. To collect them beside it is the standard
remedy: the notice still travels with the distribution, but it is not inside the
JavaScript. The scope is the production dependency closure. The dev tooling is
not distributed and is not listed.

`update-presets` and `thumbs` both drive the running dev server with Playwright.
Start `npm run dev` first. `thumbs` renders each preset through the PNG exporter
of the app and scales it down in the browser. It thus needs no image tooling on
the host.

`lint` carries correctness rules only. There are no stylistic rules, and none
are planned. The house style is settled. A formatter produces a diff across the
whole tree that buries the findings that a linter exists to surface.
`eslint.config.js` records why the project declines the React Compiler rules
that ship with `eslint-plugin-react-hooks` v7. To drive three.js *is* to mutate
material uniforms in an effect, so three of those rules flag working code in
every r3f app.

There are two suites, and they do not overlap. `test:unit` is Vitest over the
modules that are pure arithmetic: the box blur, area resampling, the bilinear
tap, Douglas–Peucker and the projections. It also covers the parameter registry
that decides when a rebuild happens. The unit tests run in Node in about a third
of a second, and they assert the maths directly. A deviation bound or a
projection wants that, not an inference from a pixel eleven seconds into a spec.
They live in `tests/unit/*.test.js`. Playwright is pinned to `*.spec.js`, so
neither runner picks up the files of the other.

Everything else is end-to-end, and that is not a gap. Tests run against a live
dev server in non-headless Chrome with WebGL enabled. The things worth an
assertion exist only in a real renderer: what the geometry worker produced, what
the SVG exporter drew, and whether the drawing buffer was clamped. Some specs
depend on fixtures that are gitignored for size. Those specs skip with a message
rather than a failure. Read
[tests/testdata/README.md](tests/testdata/README.md).

They also run **one at a time**, and that is not a compromise for a slow
machine. Headed Chrome foregrounds one window only. An occluded window has its
`requestAnimationFrame` throttled and can stop the composite. A parallel run of
a suite that mostly reads rendered pixels thus reports starvation as feature
failure. The cost is about six seconds: 14 workers on one GPU spent their time
in a queue rather than added throughput. `playwright.config.js` carries the
measurements.

---

## License

MIT — Copyright (c) 2026 sorny.

The code is MIT. The things that it ships alongside are not, and each one keeps
its own:

| | |
|---|---|
| Sample plate, logo, presets | Original work, MIT with the rest — read [`public/PROVENANCE.md`](public/PROVENANCE.md) |
| Bundled npm packages | MIT, Apache-2.0, ISC and BSD. The build collects them verbatim into `dist/THIRD-PARTY-NOTICES.txt`, because minification strips them from the bundle |
| Maki icons | [Maki](https://labs.mapbox.com/maki-icons) 8.2.0, unmodified — CC0 1.0, public domain, no attribution required. [`public/icons/LICENSE`](public/icons/LICENSE) records the provenance anyway |
| Space Mono | SIL OFL 1.1 — `public/fonts/OFL.txt` |
| Single-line faces | SIL OFL 1.1, the Hershey licence, public domain, WTFPL and MIT, per face — `public/fonts/single-line/LICENSE.txt`, which carries the full OFL text as the OFL requires |
| OpenStreetMap data | ODbL 1.0 — a data licence, independent of this one. The app credits OSM in the panel whenever OSM data is loaded, and writes the credit into every export that can carry it: an XML comment in the SVG, a `tEXt` chunk in the PNG, the header of the STL, and a Matroska tag in the WebM |

No software licence reaches what you *make* with erzberg. A plate that you plot
is derived from your raster and your composition, not from this program.
erzberg copies no part of itself into its output. The OFL explicitly exempts a
document made with a font from the terms of the font. The work is yours. If you
plot something that you like, I want to see it.
