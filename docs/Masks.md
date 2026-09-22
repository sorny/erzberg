# Masks and satellite imagery

A cover plate answers "what is this ground" and answers it for the whole window
at once, from a satellite. That is the right tool when the distinction you want
is one the planet already makes.

It is the wrong one when the distinction is yours: the far side of the ridge,
the part of the valley the plate is actually about, everything except that one
quarry. A **mask** is that second kind — a region you draw, spent through
exactly the same stencil.

---

## The two stencils

They look similar in the panel and they are different shapes underneath.

| | Cover classes | Masks |
|---|---|---|
| Where from | AlphaEarth, cut offline | Drawn by hand, or an image |
| Shape | **Partition** — every pixel in exactly one | **Overlap** — a pixel can be in several |
| Stored as | One `Uint8Array` of indices | One plane of bits each |
| Selecting two means | Either material | Either region — union |
| All selected means | The unfiltered raster | Some particular shape |

That last row is why `toggleClass` collapses when every class is ticked and
`toggleMaskSelection` does not. Both collapse when the *last* one is unticked,
because a layer restricted to nothing draws nothing and that is what the layer's
own Enabled switch is for.

A layer may carry both. A cell has to satisfy both to be marked — cover says
what the ground *is*, a mask says which part of the picture you meant.

---

## Satellite imagery

A mask drawn over a grey hillshade is a guess. You are trying to say "the worked
ground, not the forest", and that is a distinction you can see in a photograph
and largely cannot see in shaded relief. So the Studio's backdrop is Sentinel-2.

### Why this source

Four were reachable without a key. **Licence decided it, not resolution.**

| Source | Resolution | Verdict |
|---|---|---|
| **Sentinel-2 L2A, AWS Open Data** | 10 m | **Chosen** — free, full and open, commercial use included |
| EOX s2cloudless | 10 m | CC BY-**NC**-SA: non-commercial and ShareAlike would attach to every exported plate |
| Esri World Imagery | sub-metre | Commercial imagery; redistribution terms do not clearly cover a printed plate |
| NASA GIBS | 250 m | Unambiguously open, and sixteen pixels across a 4 km window |

Copernicus asks for one line of attribution and nothing else. That is the same
shape as the CC-BY on the embeddings and the ODbL on OpenStreetMap, so
`utils/attribution.js` already knew what to do with it.

### Why this one can be a button

The cover plates need a script because AlphaEarth's bucket serves anonymous
ranged reads to anyone and sends **no `access-control-*` header at all** — a
page is refused where a terminal is not, and only a proxy bridges that.

`sentinel-cogs.s3.us-west-2.amazonaws.com` answers `Access-Control-Allow-Origin: *`
on a ranged `GET`. Same terms as the terrain tiles and the Overpass query: no
key, no account, and nothing happens until the button is pressed.

### What is actually read

The `visual` asset of a scene — `TCI.tif`, a three-band 8-bit true-colour COG at
10 m, north-up, 1024-pixel blocks, full overview pyramid. One file rather than
three bands to combine and rescale, and the tiling means a window costs a few
hundred kilobytes of an otherwise 316 MB scene.

### Not every scene in the catalogue can be read

A handful of items were never converted to COG. The catalogue still describes
them, and every asset points at the original ESA product instead:
`s3://sentinel-s2-l2a/.../TCI.jp2`. Two separate reasons that is unusable —
the scheme is `s3:`, which no browser fetches, and the format is JPEG 2000,
which `geotiff.js` does not decode even if it arrived.

It failed in the worst available way. One scene in forty over Graz is like this,
and its cloud cover is **zero** — so the sort by cloud put the single unreadable
scene in the archive at the front of the list every time, and the feature looked
broken over that one city while working everywhere else. The console said
`URL scheme "s3" is not supported` from inside a dependency, which names the
symptom and not the scene.

So a scene is kept only when its `visual` asset is HTTPS *and* a TIFF. Both,
rather than the scheme alone: an item served over HTTPS in some other format
would otherwise reach `fromUrl` and fail deeper down, where the message is about
byte offsets. An asset stating no type at all is taken as usable, because a
missing field must not disqualify an otherwise fine COG.

### Season, not just cloud

Sorting scenes by cloud cover alone is the obvious thing and it is wrong, and
the Erzberg is the case that shows why: the clearest scene in the whole archive
is the first of March at 0% cloud, and it is under snow. A white mountain is a
beautiful photograph and useless to draw a mask around — the boundary between
worked rock and forest simply is not in it.

So the default search asks for the growing season of the last three years and
sorts *that* by cloud. May to September in the north, November to March in the
south, chosen from the latitude of the extent rather than assumed. If an extent
has no in-season scene at all, the unfiltered list is used rather than nothing.

### It arrives too dark to use, and why

The `visual` asset is not a photograph. It is a fixed-gain product: ESA maps
reflectance onto 0–255 with one constant for the whole planet, so a scene is
exposed for the brightest ground there is — cloud, snow, bare limestone — and
ordinary vegetated terrain lands near the floor. Measured over Graz,
2023-09-09, a thousand pixels square of real ground:

| channel | p2 | median | p98 |
|---|---|---|---|
| R | 12 | 24 | 130 |
| G | 20 | 43 | 121 |
| B | 13 | 26 | 89 |

The median pixel is at 9–17% brightness. Draped on terrain, then mixed with a
hillshade and multiplied by ambient occlusion, it reads as black.

**A levels stretch alone does not fix it.** That is the obvious repair and on
this data it fails: the distribution is skewed, most of the ground is dark, and
a thin bright tail drags p98 to 130. Stretching red by those ends puts the
median at (24−12)/(130−12) = **0.10** — still almost black, with the contrast
now spent on outliers. Measured end to end on the real scene: raw median
luminance 14.8%, after a 2–98% stretch 19.7%.

So the stretch is followed by a gamma, solved per scene rather than fixed, so
that the stretched median lands on mid-grey:

    median^gamma = 0.45   ⇒   gamma = ln(0.45) / ln(median)

Graz solves to 0.556 and comes out at 44.6%. A scene that is already well
exposed solves to a gamma near 1 and is left alone, which is the property that
makes this safe to leave switched on by default.

**The ends are only half white-balanced.** Stretching each channel by its own
percentiles overcorrects: blue's useful range over vegetated ground is much
narrower than red's — 13–89 against 12–130 — so blue takes about 1.55× the
gain and every shadow in the scene turns slate. Not stretching per channel at
all leaves the product's green bias on roofs and roads. Half way removes most
of the cast and keeps shadows neutral. That number was chosen by rendering all
three against the Graz scene and looking at them, which is the only honest way
to choose it.

**Where the maths lives.** Two consumers must agree pixel for pixel: the
surface shader, and the Studio backdrop, which is a 2D canvas and cannot run
GLSL. A mask painted against one exposure and checked against the other would
put its boundary in a different place, and nothing would report it. So the
pipeline is written once in `utils/imageryTone.js` — `applyTone` for the CPU,
`TONE_GLSL` directly below it for the shader.

Opacity, Brightness, Contrast and Saturation apply after the correction.
Switching **Auto levels** off shows the raw product, not a milder correction:
that is what the person who reached for the switch asked to see.

### The trap in draping it

The drape is painted by the *surface* shader, and the surface is only drawn when
a fill layer is on. Fetching imagery on bare defaults therefore put a texture on
a mesh nobody could see, which looked exactly like a broken fetch.

So `showImagery` appears in **both** gates, and the second is the one that would
have bitten next. `hasFillLayer` decides whether the surface is drawn at all;
`needsSurfaceShading` decides whether it is built with normals and UVs — and the
drape samples `uImageryTex` at `vUv`. With only the first fixed, the whole
texture would collapse to a single texel and the terrain would come out one flat
colour, which reads as a different bug entirely.

That split also decides where the two parameters live. `imageryOpacity` is a
shader uniform and nothing else, so it is render-side and dragging it costs no
rebuild. `showImagery` is deliberately not, because it changes what the geometry
is built with and has to reach the worker.

---

## The Studio

Press **Paint** on a mask, or **+ Draw a mask**. It opens over the viewport and
its panel replaces the sidebar for the duration.

| Tool | Key | |
|---|---|---|
| Brush | `B` | `[` and `]` resize |
| Rectangle | `R` | |
| Ellipse | `O` | |
| Lasso | `L` | |
| Erase | `E` | toggles paint/erase |
| Close | `Esc` | |

| Gesture | |
|---|---|
| Scroll | Zoom about the cursor |
| Alt-drag, or middle-drag | Pan |
| **Fit** | Back to the framing it opened with |

The backdrop is the imagery when some has been fetched and the hillshade when it
has not — the same view either way, with more or less to go on.

### It is the same shape as Edit Mode

Both are full-window direct-manipulation modes over the source raster, and they
were built a year apart and drifted into two different interfaces: Edit Mode put
its controls in a right-hand panel and left the picture clear, the Studio crammed
everything into one floating bar across the top of it. The Studio had no zoom at
all, which is the difference that actually stopped work — a boundary somebody is
willing to trace by hand is routinely a few raster pixels wide, and
fit-to-window is the one magnification at which that cannot be done.

They now share a frame, a set of primitives from `panel/ui`, and a set of
gestures. Alt is the pan modifier in both and outranks the active tool in both.
`MaskPanel` is deliberately a *sibling* of `EditPanel` rather than a
generalisation: the two hold different controls and will keep diverging in
content, and what has to stay identical is the frame, which `panel/ui` already
provides.

The exposure controls appear in the Studio panel as well as in the Satellite
section, against the same state. Aiming at a boundary is exactly when they are
wanted, and the sidebar that otherwise carries them is hidden while the Studio
is open — a control you cannot reach while doing the one job it exists for may
as well not be there.

**Why still a separate view from Edit Mode.** They answer different questions. A
clip changes the raster for everything; a mask changes one layer and leaves the
rest alone. Sharing a window would mean every gesture had to say which it meant.

**The brush is hard-edged on purpose.** A mask is a bit per pixel — there is no
half-selected — so a soft brush would have to dither the boundary or quantise at
some threshold, and both produce an edge that looks deliberate and is not. The
feather that matters is the one applied to the *terrain* at the edge of a
selection, and that already exists in Edit Mode where it belongs.

**A stroke is stamps, not samples.** A pointer moving quickly reports positions
tens of pixels apart. Stamping only where it was reported paints a dotted line,
so a drag steps at half the brush radius between the reported points.

---

## A mask from features you have already loaded

The shape of a forest, a lake or a quarry is something OpenStreetMap and GeoJSON
hold exactly. Tracing it by hand in the Studio is copying an outline the app has
in memory, so the Masks section offers it directly: pick a vector layer, give it
a distance, press **Make a mask**.

Every geometry kind is offered, not areas alone — a line becomes a region the
moment it has a width, and "everything within fifty metres of the stream" is a
mask people reach for constantly. The one number therefore means three things,
and is labelled for whichever layer is picked:

| Layer | The number is | |
|---|---|---|
| Area, or a line that closes | **Buffer** | Grows the filled region; negative shrinks it |
| Line | **Half-width** | The corridor's reach to each side |
| Point | **Radius** | One disc per point |

### A boundary is an area wearing a line's clothes

A mask of a municipality came back as its outline, and there were two separate
reasons for it.

**The layer's `geom` describes how it is drawn, not what it is.** Admin
boundaries are declared `geom: 'line'` because you draw a border as a line, and
a municipality is unambiguously an area. So the mask asks the *geometry*
whether it closes rather than asking the layer what it is, and fills it when it
does. A **Fill the enclosed area** switch appears only for layers whose lines
actually close, on by default — turn it off and you get the corridor along the
border instead, which is a real mask too.

**The rings arrive unstitched.** Overpass returns a relation as its member
ways, and `ringsOf` keeps one ring per member. Graz's district Jakomini comes
back as **seven open segments, not one of them closed**. Filling each
separately paints seven slivers. So `stitchRings` walks segments that share an
endpoint into the loop they actually describe, before anything is projected or
filled.

Two details there are load-bearing:

- **Stitching happens in lon/lat, before projection.** Member ways meet at a
  *shared node*, so their coordinates are bit-identical and an exact key is
  correct. After projection the match would need a tolerance, and a tolerance
  welds two districts that merely pass close to one another.
- **A two-point segment is kept.** A ring needs three points to enclose
  anything, but a border segment is routinely a straight line between two
  nodes. An early version dropped those, which left the stitcher a chain full
  of holes — it then failed to close, and silently fell back to tracing the
  outline. Real data hid this (Jakomini's ways are long); a synthetic four-
  segment box caught it.

Areas are stitched too. A `landuse=forest` multipolygon arrives the same way,
and one whose outline is split across several member ways would otherwise fill
as slivers.

Deciding whether to *offer* the switch scans at most 64 features. The answer is
the same after two as after two hundred thousand, and stitching a province of
roads to confirm that roads are not rings would stall the panel.

### Picking particular features

A layer is often not the unit you mean. "Admin boundaries · City district" over
Graz is seventeen districts, and a mask of Jakomini is one of them.

So the picker lists the layer's features, ticked, and only the ticked ones go
in. The list is sorted named-first and filterable, the same as the layer's own
feature list, and **all** / **none** are there for the common ends of the range.
When exactly one feature is picked the mask takes *its* name — "Jakomini" says
far more in a mask list than "Boundary · City district" does.

Two lists, and they are deliberately independent:

- A layer's **hidden** list is about *drawing*. It seeds the pick, so the
  default is "what I can see" rather than "everything the file happens to hold".
- The mask's **pick** is about this stencil alone. Once made it is the whole
  answer, and hiding is not consulted again — wanting a mask of one district
  should not mean hiding the other sixteen from the drawing to get it.

**Holes are cut, not filled.** A feature's rings are scanned *together* rather
than one at a time. Filling each separately and unioning the results paints the
holes solid, which looks correct until the first lake with an island in it.

**Even-odd, not winding.** Neither OpenStreetMap nor GeoJSON promises which way
round a ring is traced, so a fill that depends on winding would cut some holes
and fill others from the same file.

**The buffer is a true distance, not an iteration count.** Repeated neighbour
passes grow a square or an octagon depending on the connectivity chosen, and at
the twenty-pixel radii a buffer around a river actually wants, the difference
from a circle is plainly visible along every straight bank. `growMask` uses an
exact Euclidean distance transform instead — Felzenszwalb and Huttenlocher's
two-pass parabola envelope, linear in the number of pixels.

**Metres are read off the raster's own extent.** A projected raster states its
bounding box in metres and a geographic one in degrees. Reading a degree as a
metre does not throw; it produces a corridor a hundred thousand times too wide,
which is a filled rectangle and looks like a broken fill.

---

## Importing a mask

**↑ Import…** takes a PNG, JPG or WebP. Luminance above the midpoint is inside,
which is what a black-and-white mask painted in any other tool already means.

Alpha counts too, and counts first: a PNG cut out with transparency is the other
common way one of these arrives, and reading only luminance would take its
transparent region as black — the exact inverse of what the author drew.

The image is resampled to the raster by nearest neighbour. A mask has no
meaningful intermediate value, so there is nothing to interpolate.

---

## The grid masks live on

The **source** raster, always, never the cropped one. Edit Mode's clip can be
changed or cleared at any time, and a mask authored against a crop would be the
wrong size the moment it was. The store crops masks alongside the pixels on the
way through, exactly as it does the NoData mask — same rectangle, same
arithmetic, in `derive()`.

---

## How it reaches the draw modes

The same way the cover classes do, and that is the whole reason this feature is
small. `maskedTerrain` in `geometryBuilders.js` already thinned a layer's
`gridMask`; it now folds in two stencils instead of one:

```js
for (let i = 0; i < src.length; i++) {
  if (!src[i]) continue
  if (byClass && !maskHasClass(classMask, cls[i])) continue
  if (byPaint && !painted[i]) continue
  out[i] = 1
}
```

Every builder already gates on `gridMask`, because a GeoTIFF with a void in it
has always been possible. No draw mode changed for masks, and the next one added
will inherit them without knowing they exist.

The union of a layer's selected masks is memoised for the length of a build,
because several layers commonly share one — "everything inside the ridge" is the
sort of mask a whole plate is drawn against — and the union is a pass over every
cell. A single selected mask is handed straight through with no allocation at
all, which is by far the common case.

---

## Thirty-two, again

One bit per mask in one signed 32-bit integer, the same ceiling and the same
reason as the cover classes: it lets a layer's whole selection travel as a single
number through the parameter bus, the preset file, the history stack and the
rebuild key with no special case anywhere.

---

## Licence

Copernicus Sentinel data is free, full and open. The credit travels into any
export that actually draws from it — fetched and switched off is the same as a
hidden layer: it is not in the file.

> Imagery: Contains modified Copernicus Sentinel data, processed by ESA

---

## Files

| File | Role |
|---|---|
| `src/utils/maskLayers.js` | The plane of bits: create, stamp, stroke, import, and the 32-bit selection |
| `src/utils/maskFromVector.js` | Features to regions: `stitchRings`, `maskFromFeatures`, `featureRings`, the exact-distance `growMask` |
| `src/utils/imageryTone.js` | The exposure pipeline, once — `applyTone` for the CPU and `TONE_GLSL` for the shader |
| `src/utils/imageryFetch.js` | Scene search and the windowed COG read |
| `src/components/MaskStudio.jsx` | The painting view: tools, gestures, zoom and pan |
| `src/components/MaskPanel.jsx` | Its right-hand panel, a sibling of `EditPanel` |
| `src/components/panel/FeaturePicker.jsx` | `useFeaturePick`, shared with Edit Mode |
| `tests/masks.spec.js` | Painting, stencilling, and that the Studio matches Edit Mode |
| `tests/mask-from-features.spec.js` | Masks from layers: areas, corridors, the pick, and a boundary of open segments |
| `tests/unit/maskFromVector.test.js` | Holes, winding, metres, stitching, simplification |
| `tests/unit/imageryTone.test.js` | Auto levels against the measured Graz histogram |
