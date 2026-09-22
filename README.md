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
Thirty-four independent draw modes do the work. They range from surveyor's
marks such as hachures and form lines to a quantised tilemap. Others are a
flashbulb with a cast shadow, and tracks that something with mass laid down a
face. Six of them are about colour rather than about mark-making.

Every mode reads the shape of the ground. Load a **land cover plate** and they
can read what the ground *is* as well: each layer draws on the classes you pick
and skips the rest, so hachures stop at the treeline and scree marks stay on
scree. See [Land cover](#land-cover) below.

Contours letter their own heights. The app sets the number into a break in the
line, at the angle of the line, in the ink of the line.

Export to SVG for a pen plotter, to STL for a printer, or to 4K PNG for the wall.

**Everything runs locally in your browser.** Your files never leave your
machine. There is no server, no upload and no account. The app makes no
third-party request on load, because it serves the one webfont from its own
origin.

Three features contact a server, and only when you press their button. *Vector
Layers* asks OpenStreetMap for roads and rivers inside the raster's extent.
*Fetch Terrain* asks a geocoder for a place, then asks a tile host for the ground
under it. *Satellite* asks an open archive for a Sentinel-2 scene over that same
extent. Each sends a place name or a bounding box. None sends a file, and none
needs an account or a key. If you use none of them, the app opens no connection
at all.

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
seconds. Everything means everything: the fetched and uploaded vector layers and
any text you placed go with the sliders, and the Undo brings all of it back.

**The history is a list.** The `▾` beside Undo and Redo opens the stack, newest
first, with a `now` line between what you can undo and what you can redo. Each
step is named: *Hillshade*, *Stipple Dots on*, *Terrain Style · 3 changes*,
*Preset · Blueprint*. Click a step to jump straight back to it. The picture
rebuilds once, and everything you passed over stays on the redo side in order.

Nothing in the panel is annotated for this. The names come from comparing the
two snapshots either side of each step and looking each changed parameter up in
the same section index the reset below uses, so a control nobody thought about
is named correctly anyway. The one exception is a preset: it moves forty
parameters across nine sections, and which preset it was is the one fact a diff
cannot recover, so the loader states it.

**Reset one section.** A `↺` appears in a section's header when that section
differs from its defaults, and it puts that section alone back. So the mark is
also a map: scroll the panel and the headers carrying a `↺` are the places where
you changed something, open or shut. A section reset offers the same Undo that
*Reset all* does.

What each section owns is stated in `src/components/panel/sectionParams.js`, and
a unit suite holds it against the panel's own source in both directions. A reset
that reached one key too far would throw away work in a section you were not
looking at, which is the one failure here that must not be possible.

**What it costs.** The stats at the foot of the panel report how long the last
rebuild took. The figure is measured, not estimated from a table, so switching a
mode on and watching the number is a direct answer to *is this the slow one*.
Most modes rebuild the sample plate in well under a tenth of a second. Sun Hours
integrates a whole year of sunlight and takes about two.

While a rebuild runs, a small spinner appears at bottom right after a quarter of
a second. If nothing comes back for 1.2 seconds, the app covers the screen
instead. Two thresholds rather than one: a modal dim flashing on every slider
drag is worse than the silence it replaced.

**Find a control.** The panel has sixty sections, which is a lot to remember the
shape of. The field at the top of the panel narrows them. Type `azimuth`. Only
Hillshade then remains, open, with the sun controls in it. Sections answer to
their own vocabulary as well as to their titles, so the field also finds
sections that are switched off.

A search crosses every stage, so the rail stops being a selection and becomes a
tally: each tab says how many of its sections the query found, and the ones that
found none go quiet. Clear the field. The panel returns to exactly the pane it
was on.

**A shut section says what it holds.** Every collapsed header carries its own
setting on the right. Hillshade reads `315° · 60%`. Terrain Style reads
`hypso · mesh`. A section that is switched off reads `—`, which the eye skips, and a section
that is on carries a green dot beside its name.
Close every section in a stage and that stage states itself in one short column:
Source is about 290 px, Surface 180, Overlay 145, Frame 180, and Output is two
sections. Export, Analysis and Hydraulic Erosion stay blank on purpose. They are
actions and hold no setting, and a dash there would claim that they were
switched off. Rest the pointer on a readout to read the name of the control that
it comes from.

**The head counts what you composed.** One standing line under the wordmark:
`4 marks · 3 inks · 2 layers`. The ink count is a count of pens. Two modes in
the same black are one pen, and a separation is three or five. Thirty-four draw
modes compose freely, and this is the line that says how many are drawing
without your opening anything.

**Export says what the SVG will contain.** A line above the buttons: *SVG
writes the full canvas*, or *SVG cuts at the frame ↑*. The export cuts at the
paper frame rather than hiding what falls outside it, so a switch two stages
away in Frame decides what you get.

**The rail is the pipeline.** Six tabs run down the panel's edge — *Source,
Surface, Marks, Overlay, Frame, Output* — and the body shows one of them at a
time. Every section belongs to one stage, and the order is the order the
renderer runs. This is what makes a control findable before you know where it
is. Jitter changes the source, so jitter is in Source.

The rail exists because the six stages put the pipeline's *order* on screen but
not its *proportion*. Marks is 35 of the 60 sections, so every trip from Terrain
to Export crossed about 1 500 px of draw modes. The rail does not shorten Marks.
It stops the other five stages paying for it.

A tab carries a green count of the sections switched on inside it, because a
pane you cannot see is a pane whose green dots you cannot count. A stage doing
nothing carries no badge at all. Switching panes hides the other five rather
than unmounting them, so a running OpenStreetMap fetch, its cancel button and a
half-set feature filter all survive a click on the rail.

The panel is 312 px wide: 40 for the rail and 272 for the controls, which is the
width they have always had. The rail is navigation rather than control, so it is
paid for out of the window instead of out of the sliders.

**Thirty-four modes on one screen.** The Marks stage is a sheet of the
thirty-four marks themselves — the same glyphs the section headers carry, three
across, each with its name. It replaces the thirty-four headers that used to
stand for them, and it is the way into any one of them.

A tile carries two things, and they are shaped differently on purpose:

- **The pip**, a small ring in the corner, switches the mark on. It fills green
  while the mark is drawing. It is the only thing on the tile shaped like a
  control, and it writes the same setting the section's own switch writes, so
  the two cannot disagree.
- **The card** — the glyph, the name, the space around them — opens the mark.
  It carries a chevron, because an arrow is what says a thing goes somewhere.

Switching a mark on leaves you on the sheet, so a second and a third are one
click each. Opening one gives it the whole width of the panel, with a back bar
above it. It is not a layer stack: nothing reorders, nothing is dragged, and a
tile reads and writes one boolean and does nothing else.

---

## Input

| Source | Notes |
|---|---|
| **PNG** | 8-bit, or 16-bit. The app decodes 16-bit natively, because the canvas path truncates it to 8-bit without a word. The app reads alpha as NoData. |
| **GeoTIFF** | Real elevation. The app reports the coordinate system of the file instead of an assumption, honours the declared NoData value, and suggests a vertical exaggeration from the real ground size of a pixel. |
| **Audio** | MP3, WAV, OGG or M4A. The app analyses the file into a spectrogram that drives the terrain. |
| **GPX** | The app drapes the track line over a georeferenced raster. |
| **GeoJSON** | Points, lines and polygons, draped the same way. |
| **Fetch Terrain** | Type a place. The app resolves the name with OpenStreetMap's Nominatim geocoder, then downloads elevation tiles from Terrain Tiles on AWS Open Data. The result is a georeferenced raster with real metres, exactly like a GeoTIFF. No account, no key, and nothing happens until you press Search. |
| **OpenStreetMap** | The app queries the extent of the raster live for roads, water, rail, landuse, buildings, lifts and peaks. A fetch reports its progress, and says so honestly: the stretch where Overpass has sent nothing yet is indeterminate with an elapsed count, and the download that follows is a real percentage. |
| **Satellite** | True-colour Sentinel-2 over the extent of the raster, at 10 m, from AWS Open Data. It drapes on the terrain and backs the Mask Studio. No account, no key, and nothing happens until you press Fetch. |
| **Mask** | A PNG, JPG or WebP as a stencil: white is inside, transparent is outside. Or draw one, or cut one from loaded features. See [Masks](#masks). |
| **Cover plate** | A `.landcover.json` from `scripts/embed-window.js`: one land-cover class per pixel over the same ground as the raster. It states its own extent and projection and is refused if it does not match. See [Land cover](#land-cover). |

**Drag and drop.** Drop a file anywhere on the window and the app routes it by
what it is. A GeoTIFF becomes the terrain. A GPX or GeoJSON becomes an overlay.
A cover plate becomes the land cover. A preset — the JSON from `Preset ⬇`, or
any PNG or SVG this app exported — restores the look and leaves the ground
alone.

Two extensions are ambiguous, and both are decided from the bytes rather than
guessed. A **PNG** is both the heightmap format and an export format: every
plate the app writes carries the whole parameter set in a `tEXt` chunk, so a PNG
with that chunk is a preset and a PNG without one is terrain. A **`.json`** is
three things — a preset, GeoJSON, or a cover plate — and each answers for
itself: a cover plate declares its own `kind`, a preset holds one of the six
parameter groups, and no GeoJSON does either. Nothing is guessed and no dialog
asks.

A file with no route says where it does go. Drop an MP3 and the banner points at
Soundscapes; drop a JPEG and it points at Texture.

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

## Land cover

Every draw mode in this app reads the *shape* of the ground — slope, curvature,
aspect, how light falls on it. So two pieces of ground at the same gradient get
the same mark, whatever is standing on them. A cover plate fixes that. It gives
every pixel a class, and a class is a fact the heightmap does not contain.

**Cut a plate first.** The classes come from AlphaEarth Foundations, Google
DeepMind's satellite embedding: 64 numbers describing every 10 m of the planet,
published for each year from 2017 to 2024.

Already have a GeoTIFF? Point the script at it. The extent and the projection
come from the file, and only the plate is written:

```bash
node scripts/embed-window.js --dem my-terrain.tif --classes 6
```

Otherwise name a place, and the script writes the matching terrain too:

```bash
node scripts/embed-window.js --place "Eisenerz" --km 4 --classes 6
```

Either way the plate and the ground under it are aligned by construction. Load
`<name>.tif` as terrain if the script wrote one, then drop `<name>.landcover.json`
on the window. The Land Cover section prints the exact command for whatever is
already on screen, so the extent never has to be typed back in.

**Why a script and not a button.** The app promises that it asks no third party
for anything without a press, and asks with no key and no account. The
embeddings break the second promise on both routes that exist. Earth Engine
wants an account, an OAuth flow and a Cloud project. The public bucket is open
to anyone — a ranged read needs no credential at all — but it answers with no
CORS header, so a browser refuses it and only a proxy would help. A proxy is a
server. The reduction therefore happens on your machine, once, and the app loads
the result: one byte per pixel instead of the sixty-four it came from.

**The classes carry names, and the evidence for them.** A cluster cannot say
what it is, so the script asks OpenStreetMap which landcover polygons cover the
window and tallies what each class falls inside: *Quarry · gentle — 90% quarry*,
*Forest · steep — 54% forest, 36% quarry*. A name needs a majority to be
printed, repeated names are parted by the terrain word that distinguishes them,
and the runner-up is shown so you can see which boundary to distrust. Where
nothing is mapped, a class is described by its slope and height instead.

**You can see where they are.** The section draws the plate flat, at its own
grid, in the classes' own colours. Point at the map and it names the class under
the cursor; point at a legend row and it lights that class up on the map.

**Three things a plate buys you.**

*Masks.* Every layer takes a row of class swatches. Pick the classes it may
draw on and it skips the rest. This works for all thirty-four modes, including
the ones written years before land cover existed, because a mask thins the same
terrain grid every builder already reads.

*Ink by land class.* One press deals a mark to each class and masks each layer
to its own — broken rock at the top, tone and stipple at the bottom, ordered by
the mean slope of each class. It is a starting point. Re-point any of them
afterwards.

*The Land cover mode.* A colour plate inked from the classes themselves, either
as the continuous imagery or as one flat colour per class.

The plate states its own extent and projection, and it is refused with a reason
if it does not cover the same ground as the raster. A misaligned cover still
renders and still looks deliberate, which is exactly why it is not allowed to
load.

The dataset is CC-BY 4.0. The credit travels inside the plate file and into any
export that draws from it.
→ [Land cover](docs/Land-Cover.md)

---

## Masks

A cover plate answers *what is this ground*, for the whole window at once. A
mask answers a question only you can ask: the far side of the ridge, the part of
the valley the plate is actually about, everything except that one quarry.

Both are spent through the same stencil, so a mask restricts a layer exactly the
way a land cover class does — and a layer may carry both at once.

**Draw one.** *Masks → + Draw a mask* opens the Studio over the viewport, with
its own panel in place of the sidebar. Brush, rectangle, ellipse and lasso, with
`E` to erase and `[` `]` to resize the brush. Scroll to zoom, alt-drag to pan,
**Fit** to go back — the same view, the same gestures and the same panel layout
as Edit Mode, because they are the same kind of thing. The backdrop is satellite
imagery when you have fetched some, and the hillshade when you have not.

**Or make one from features you already have.** *Masks → From features* takes
any loaded OpenStreetMap or GeoJSON layer and rasterises it: areas fill with
their holes cut out, lines become corridors, points become discs. One distance
field means buffer, half-width or radius depending on the layer, and a negative
buffer shrinks — "the forest, but not its first twenty metres". Tick the
particular features you mean; a mask of one takes that feature's own name.

A boundary counts as an area even though it is drawn as a line: pick a
municipality or a city district and you get the ground inside it, not its
outline. Switch **Fill the enclosed area** off for the corridor along the
border instead.

**Or bring one.** *↑ Import…* takes a PNG, JPG or WebP. White is inside, black
is outside, and transparent is outside too — a cut-out PNG is the other common
way one of these arrives.

**Satellite imagery.** *Satellite → ↓ Fetch imagery* pulls true-colour
Sentinel-2 for the extent on screen, at 10 m. It drapes on the terrain and backs
the Studio. Unlike the cover plates this one is a button rather than a script,
because Sentinel-2 on AWS answers CORS where AlphaEarth's bucket does not — same
terms as Fetch Terrain: no key, no account, nothing until you press it.

The default search asks for the growing season of the last three years and sorts
*that* by cloud. Cloud alone picks a snowy winter scene, which is a beautiful
photograph and useless to draw a mask around.

It also arrives far too dark to use, and that is the product rather than a bug:
Sentinel-2's true-colour asset is exposed with one fixed gain for the whole
planet, so ordinary vegetated ground lands near the floor — over Graz the median
pixel is 9–17% brightness. **Auto levels** stretches the fetched window's own
histogram and solves a gamma per scene so its median lands on mid-grey, with
Brightness, Contrast and Saturation on top. All four sit in the Studio panel as
well, which is where you need them.

Copernicus data is free, full and open, commercial use included, against one
line of attribution — which travels into any export that draws from it.
→ [Masks and satellite imagery](docs/Masks.md)

---

## Edit Mode

<img src="docs/images/edit-mode.png" alt="Edit Mode: a lasso selection with editable points and a feathered edge over the heightmap">

Press `E`. The viewport then becomes a flat picture of the raster. Crop it with
a handled rectangle, which has aspect locks and numeric fields. Or draw an
ellipse, and hold Shift for a perfect circle. Or cut out an arbitrary region
with a lasso or a polygon.

Or clip to a place. *From features* takes any loaded OpenStreetMap or GeoJSON
layer and cuts the heightmap to a feature's own outline — a municipality, a
district, a lake — holes and disjoint pieces included. It is the same picker the
Masks section uses, spent on the raster instead of on a stencil.

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
| Shadow Line | The edge of the shadow at one instant — the terminator the terrain casts on itself. Set a date, a time and a zone; the line is longest at dawn and dusk and nearly absent at noon |
| Sun Hours | Isolines of how long the ground is in direct sun, over a year or over one date. The only field here that measures the ground rather than the picture, and the only one whose sun is a true bearing |
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
| Section | A cutting plane drawn as a drawing: heavy cut face, 45° hatch over the material below, outline beyond |
| Crossings | Sign changes of the detrended scanline — the local pitch of the terrain, which is neither slope nor curvature |
| Indexed | Colour as a lookup, not a sample: elevation tier by slope class, Bayer-dithered between adjacent palette entries |
| Outrun | An additive halo under a near-white filament — where contours crowd, the halos sum and the ground lifts |
| Riso | Three spot inks screened at 15°, 45° and 75°, multiplied together. Registration and a coverage cap decide which press you are on |
| Mineral | Five materials classified by slope and curvature, each with a flat colour and its own grain |
| Land cover | The classes of a loaded cover plate, inked either as the imagery they came from or as one flat colour each. The only mode that reads what the ground *is* rather than what shape it is |
| Watershed | Every cell labelled with the sink it drains to, one flat ink per catchment. The divides are ridgelines |

The four modes that block colour are Indexed, Mineral, Land cover and
Watershed. Each of them leaves the SVG as closed filled paths, one per ink. Each ink gets its own
Inkscape pen layer, named with its hex. Select a layer and run a hatch fill on
it. A catchment with a lake in it keeps the lake: the outer ring and its holes
are subpaths of one path under the even-odd rule. Switch **Occlusion** off to
export whole areas rather than the part the camera can see.

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

**Undo.** The buttons sit beside *Reset all*, and `⌘Z` works anywhere outside a
text box.

**Text on the plate.** A contour letters its own height and a peak letters its
own name, and both are derived: the string comes from the data. A **text layer**
is the same lettering with the derivation removed. You supply the words and the
place. Everything else is what a point label already had: the four Space Mono
faces or any of the 49 stroke faces, size, alignment, fill, and the plane that it
stands in.

Add as many as you want. Each one is a layer of its own, with its own ink. They
stack and reorder by drag, and each one leaves the SVG as real `<text>` in its
own named pen layer. Placement is a fraction of the plate rather than a world
coordinate, and the app samples the ground under it. A title placed on a summit
thus stays on that summit when the resolution or the exaggeration moves.

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
background, so nothing comes back invisible. It sometimes adds the hologram
point cloud and never a murmuration: a flock is a decision about the scene
rather than about the drawing, and it is one to ask for rather than to be
handed. The panel shows the seed, and the
arrow steps back through recent rolls. The seed *is* the look, so you can always
return to it.

**Anaglyph** is a modifier rather than a mode. Switch it on and every layer is
drawn twice — offset sideways and inked in two filter colours — so the plate
stands up off the paper through red/cyan glasses. It works on whatever is
already drawing, which makes all thirty-four modes new at once.

The depth is real parallax, not a double image: the offset is a lateral
translation in world space, and under the perspective camera a near mark moves
further across the page than a far one. Under an orthographic camera it
degenerates to a rigid shift with no depth in it, and the panel says so.

The SVG export writes the two eyes as two named pen layers, which is what makes
it native to a two-pen plotter: load red, plot the first group, load cyan, plot
the second. That export runs the whole pipeline twice, once per eye, because the
projection, the depth buffer and the paper clip all depend on where the camera
is. It costs what it says it costs.

---

## Surface overlays

- **Hillshade** with physically-based ray-marched cast shadows. Ridgelines
  occlude sunlight through a horizon-angle comparison along a progressive-step
  heightmap ray. Darkness, softness (penumbra) and quality are parameters.
  Azimuth and altitude drive both the Lambert shading and the shadows, and an
  amber sun indicator marks the light in the scene. Multi-directional mode
  blends several azimuths.
- **Sun hours** — a draw mode rather than an overlay, listed with the others
  below, and the only field in the app that measures the ground rather than the
  picture. See *Draw modes*.
- **The sun, as an almanac.** Hillshade takes the azimuth and the altitude as
  two free numbers, and the default pair — 315° and 45° — is the cartographic
  convention. It is also a position the sky never offers. At the Erzberg's
  latitude the sun never passes 307° of bearing on any day of the year.

  Switch *Sun* to **Almanac** and the two numbers come from the ground instead.
  Set a date, a time and a zone. The app computes the real solar position from
  the raster's own latitude, which a GeoTIFF already carries. A plain PNG has no
  location, so the panel asks for one.

  The panel states the bearing, the elevation, and the times of sunrise, solar
  noon and sunset. The cast shadows follow. The sliders keep the values you left
  them at: switch back to *Convention* and your hand-set light returns unchanged.
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
| **SVG** | Software Z-buffer projection with fill-based terrain occlusion. One named Inkscape or Illustrator layer per draw mode and per vector layer. Indexed, Mineral, Land cover and Watershed export as **filled polygons**, one closed path per ink in its own pen layer, ready for a hatch fill. Dash patterns are faithful. The export shows progress and you can cancel it. A dense plate takes real time, and the page stays responsive throughout |
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

**Every plate is its own project file.** A PNG carries the whole parameter set in
a `tEXt` chunk. An SVG carries it in a comment above the first mark, where an
editor shows it and a plotter never draws it. Open that file with *Preset ⬆* and
the look comes back. The terrain does not: the raster is yours and stays yours,
and the file name of the raster is never written into the plate.

**The sheet can say its scale.** Switch on *Scale bar* and *North arrow* in
*Scale and North*. The bar is measured from the raster's own bounding box, and
it is always a round distance — 200 m, 500 m, 1 km. Both marks are ink: they
appear in the viewport, in the PNG, and in the SVG as their own pen layer. A
scale bar is exact for a plan view through an orthographic camera. The panel
says the tilt out loud, because a tilted view is at a different scale front to
back. State the sheet width in millimetres and the panel also prints the map
ratio.

**Preflight, before the pen touches paper.** Press *Preflight* in the Export
section. The app builds the file a plotter would be given — after occlusion, and
after the frame has clipped it — and reports the stroke count, the pen count, the
ink laid down, the distance travelled with the pen up, and an estimate in
minutes.

Switch on *Plotter order* and the app re-orders the strokes inside each pen layer
so the carriage travels less. A stroke is drawn backwards if its far end is
nearer. On the sample plate this cuts the pen-up travel from 52.4 m to 1.4 m.
Filled areas are never re-ordered, because their paint order decides what covers
what. The switch is off by default: where two strokes of different colours cross,
the order decides which ink is on top, so the decision is yours.

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
| `Space` | Freeze the particle field, when one is drawn |
| `\` | Show or hide the control panel |
| `1` – `5` | Export SVG, PNG, PNG α, STL, WebM |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+Y` | Redo |
| `?` | Show this table in the app |

Press `?` for the same list on screen, or use the **? keys** button in the
viewport hint. The card and the handlers are kept in step by a unit test that
reads both: bind a key and forget the card, and the suite says so.

Every shortcut but undo is a bare key. A chord — `⌘1`, `⌘E`, `Ctrl+5` — belongs
to the browser or the OS and passes through untouched.

Undo is the exception, and it is the case where that reasoning runs the other
way: `⌘Z` means undo *in the application* on every platform and in every editor,
so a tool that ignored it is the thing behaving oddly. Inside a text box it still
belongs to the browser, and the app never sees it. A typo in a text layer is thus
taken back on its own, without the last slider you touched going with it.

A drag is one step. The panel emits a change per frame, and one press per frame
means forty presses to cross one slider. Undo covers everything the panel can
change, the vector layers and the text included.

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
| Labels & text | Space Mono (SIL OFL 1.1) in four faces. `npm run font` converts them to glyph outlines, flattened the same way. The wordmark of the panel uses the same face as a self-hosted woff2 of 9.6 kB, so the app contacts nobody on load |
| Single-line fonts | 49 stroke faces — Hershey (liberal, acknowledgement required) and EMS (SIL OFL 1.1) from [oskay/svg-fonts](https://gitlab.com/oskay/svg-fonts), [Relief SingleLine](https://github.com/isdat-type/Relief-SingleLine) (SIL OFL 1.1), ISO 3098 (public domain), and the Commodore 1520 (WTFPL), Apple 410 (MIT) and DearPlotter (SIL OFL 1.1) plotter faces. `npm run fonts:single-line` flattens them |
| Map data | OpenStreetMap through the Overpass API — ODbL, attributed in the panel and in every SVG |
| Place search | OpenStreetMap Nominatim — ODbL, no key, and only on submit. The usage policy of the service asks that nobody attach it to a keystroke |
| Elevation data | Terrain Tiles on AWS Open Data, in the Mapzen terrarium encoding. The sources include SRTM, GMTED2010, EU-DEM and 3DEP. Every tile names the survey it came from, and the panel prints that name |
| Solar position | The NOAA polynomials, in-house. Arithmetic only: no dependency, no table and no network |
| UI | Custom sidebar panel + Tailwind CSS |
| Geometry | Web Workers (geometry, erosion, spectrogram) |
| Audio | Web Audio `decodeAudioData` + an in-house radix-2 FFT with no dependency |
| Tests | Vitest for the pure maths. Playwright against a live dev server in headless Chrome, `HEADED=1` to watch |

---

## Documentation

- [Architecture: how a file becomes a picture](docs/Architecture.md)
- [Draw mode mathematics](docs/Draw-Modes.md)
- [Edit Mode: cropping and selections](docs/Edit-Mode.md)
- [Georeferencing: projections, vector layers, OpenStreetMap, elevation](docs/Georeferencing.md)
- [Hydraulic erosion algorithm](docs/Hydraulic-Erosion.md)
- [Land cover: classes, masks, and the AlphaEarth pipeline](docs/Land-Cover.md)
- [Masks and satellite imagery](docs/Masks.md)
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
npm run test             # Playwright end-to-end suite, headless
HEADED=1 npm run test    # …with the window, to watch it drive the app
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
that decides when a rebuild happens, the exposure curve a satellite drape runs
under, and the ring stitching that turns a relation's member ways back into the
loop they describe. The unit tests run in Node in about a third
of a second, and they assert the maths directly. A deviation bound or a
projection wants that, not an inference from a pixel eleven seconds into a spec.
They live in `tests/unit/*.test.js`. Playwright is pinned to `*.spec.js`, so
neither runner picks up the files of the other.

Everything else is end-to-end, and that is not a gap. Tests run against a live
dev server in headless Chrome with WebGL enabled. The things worth an assertion
exist only in a real renderer: what the geometry worker produced, what the SVG
exporter drew, and whether the drawing buffer was clamped. Some specs depend on
fixtures that are gitignored for size. Those specs skip with a message rather
than a failure. Read [tests/testdata/README.md](tests/testdata/README.md).

`HEADED=1 npx playwright test` puts the window back when you want to watch a
spec drive the app, which is the fastest way to understand a failure.

The suite ran headed for a long time, because Chrome throttles
`requestAnimationFrame` in a window it considers backgrounded and fifteen specs
read rendered pixels or drive rAF. That made greenness depend on which window
happened to be in front — and it took the machine hostage for the length of a
run, since a headed Chrome holds the focus and the pointer.

Headless has neither problem, and the measurement rather than the argument is
the reason: **327 passed in 30.1 minutes with retries disabled**, against 31.2
minutes headed that needed a retry and still finished red. The audio spec that
went flaky twice in one afternoon headed passes headless in 719 ms. Nothing to
drift behind is a stronger guarantee than three flags asking Chrome not to
throttle a window that has.

They still run **one at a time**, and that was re-measured after the move to
headless rather than assumed to carry over. Four workers finish in 12.5 minutes
against 30.1 serial — a real 2.4× — and finish with two failures that both pass
alone, an audio spec and an export spec starved of frames. A suite that reports
starvation as a feature regression is worth less than the eighteen minutes it
saves. `playwright.config.js` carries the figures.

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
