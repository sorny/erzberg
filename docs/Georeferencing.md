# Georeferencing

A PNG heightmap is just a grid of numbers. A GeoTIFF also says *where on Earth*
that grid sits and in which coordinate system, and `erzberg` uses that for four
things: draping vector features on the terrain, asking OpenStreetMap what is
inside the extent, suggesting a vertical exaggeration that is proportional rather
than arbitrary, and reporting the elevation range in real metres.

All four depend on reading the file's metadata correctly, and the failure mode
when that goes wrong is silence — features that do not appear, a mountain that
renders flat. So the sidebar states what it found rather than leaving you to
infer it.

---

## The projection readout

Under the mesh statistics at the bottom of the sidebar, a GeoTIFF reports its
coordinate reference system:

```
Elevation: 641 – 2350 m  (Δ 1708 m)
Projection: WGS 84 / UTM zone 33N (EPSG:32633)
```

The name comes from the file's own citation geokey where it has one, otherwise
from a built-in table; the EPSG code is always shown. The line appears **only**
for a GeoTIFF — a PNG heightmap and a frozen soundscape have no projection to
report, and both clear the field rather than inheriting a stale one.

Where the reading rests on an assumption, the line says so instead of implying a
precision it does not have:

| Suffix | Meaning |
|---|---|
| `· assumed UTM` | The file is projected but records no EPSG code. The UTM zone is inferred from the track's own longitude, which is right for a UTM tile and wrong for anything else. |
| `· datum shift not applied` | A geographic CRS on an older datum (NAD27, ED50, MGI, DHDN). Usable, but ignoring the shift costs 100–400 m. |
| `· GPX overlay unsupported` | The grid cannot be projected into at all. The raster still renders normally; only the track overlay is affected. |
| `Not georeferenced` | The file carries no tie point, pixel scale or transformation. Its "bounding box" is only the pixel grid. |

---

## Coordinate systems

A GPX file has no projection to declare — the format defines its coordinates as
WGS84 lon/lat, full stop. All the variety is on the GeoTIFF side, so placing a
track means projecting WGS84 *forward* into whatever grid the raster's bounding
box is stated in. `classifyCRS` in `src/utils/geoCoords.js` decides whether that
step can be made.

### Transformable

| Family | Codes | Accuracy |
|---|---|---|
| Geographic (lon/lat) | 4326 WGS84, 4258 ETRS89, 4269 NAD83, 4283 GDA94, 7844 GDA2020, … | exact |
| Geographic, older datums | 4267 NAD27, 4230 ED50, 4312 MGI, 4314 DHDN, … | flagged, 100–400 m |
| Web Mercator | 3857 and its aliases 3785, 900913, 102100, 102113 | exact |
| UTM — WGS84 | 326xx north, 327xx south, zones 1–60 | exact |
| UTM — ETRS89 | 258xx, zones 28–38 | exact |
| UTM — NAD83 | 269xx, zones 1–23 | exact |
| UTM — NAD27 | 267xx, zones 3–22 | flagged, datum shift |

Modern datums sit within a metre or two of each other, so no datum shift is
applied to them. The older ones are accepted but flagged, because ignoring their
shift is a visible error at raster resolution and that is worth saying rather
than hiding.

UTM uses the standard Transverse Mercator series on the WGS84 ellipsoid,
accurate to sub-metre within a zone. Zone ranges are bounded per family, so a
neighbouring code such as EPSG:32661 (UPS North) is not read as "zone 61".

The longitude difference feeding that series is wrapped into ±180° first. Two
longitudes subtract to a number, and that number is only an angular separation
once it is wrapped: zone 1's central meridian is −177°, so a point at +179° — 4°
to its *west* — subtracts to +356°. The series is a small-angle expansion, and A⁵
of 6.2 radians is not small, so the easting came back as −9.7 × 10⁸, the point
landed outside every raster, and it was dropped as ordinary out-of-bounds
clipping. The wrap is a no-op for every zone that does not meet the dateline.

### Not transformable

National grids — Austria Lambert (31287), the Austrian Gauss-Krüger meridian
strips (31254–31259), Swiss LV95 (2056), OSGB (27700), Lambert-93 (2154), LAEA
Europe (3035), World Mercator (3395) — are identified by name and declined.

This is deliberate. Placing them correctly needs Lambert or Gauss-Krüger maths
*plus* a datum shift, and for the MGI-based Austrian grids an unshifted overlay
would sit a few hundred metres off while looking entirely plausible. A wrong
overlay that looks right is worse than a message saying what to do:

```sh
gdalwarp -t_srs EPSG:4326 in.tif out.tif
```

Reprojecting does not change how the terrain renders — see *Vertical
exaggeration* below.

---

## Vector layers

With a georeferenced GeoTIFF loaded, the **Vector Layers** section drapes WGS84
features on the terrain from three sources:

| Source | What arrives |
|---|---|
| **OpenStreetMap** | A checklist of categories, then one Overpass query over the raster's own extent. |
| **GeoJSON** | One file, bucketed by geometry class. RFC 7946 fixes the coordinates as WGS84 lon/lat. |
| **GPX** | Track points (`<trk><trkseg><trkpt>`) first, route points (`<rte><rtept>`) as a fallback. Waypoints are not collected — they are unordered, and a track is what the overlay draws. |

Every source normalises to the same packed form (`utils/vectorLayers.js`), and
every bucket becomes one **layer** with its own colour, weight, opacity, dash,
visibility and — for areas — an optional fill. Layers are `lineGeo` entries in
every respect, so they inherit the live renderer, ghost occlusion, hidden-line
removal and the SVG, PNG and video exporters without any of those knowing that
OpenStreetMap exists.

### The stack

The list is a stack, read the way every other layer list is read: **the top row
is the front of the scene**. Drag a row by its grip to move it — or focus the
grip and use ↑/↓ — and what it covers changes with it. In the SVG that is which
pen draws last; on screen it is which ink is on top of which.

A fetch arrives already stacked the way a map wants to be read, because OSM's
own catalogue is ordered ground-cover-first and the panel shows it upside down:
peaks and roads at the top, water and landuse at the bottom. An upload lands on
top of whatever is already there, which is where you were looking when you
loaded it.

Moving a layer is *not* a rebuild. The worker's build key for the stack is
sorted (`vectorBuildSignature`), so the same coordinates draped on the same
terrain are still a cache hit whichever end of the list they sit at; order is
resolved on the main thread, once, where a stack is reversed into paint order
(`merged` in `hooks/useTerrainGeometry.js`) and then into `renderOrder`. That is
what lets a drag across forty layers of a dense alpine fetch follow the cursor
instead of re-draping a valley of roads per step.

Inside a layer's own slot the parts keep their order too — fill under outline,
outline over its own ghost — which is what makes a filled area cover the layers
below it rather than just tinting them. A fill at 100 % is genuinely opaque and
still obeys the stack: it stays in the blended pass, where `renderOrder` decides,
rather than in the opaque one, which would draw it before every line in the
scene no matter where you dragged it.

Order travels with a preset, since the saved styles are written in stack order.
Buckets a preset has never seen keep their order relative to each other and
settle underneath the ones it names.

### Asking OpenStreetMap

The extent has to leave the raster's grid before it can be a query, so this is
the one feature that needs the **inverse** projection, and the inverse is
narrower than the forward one. `EPSG:projected-unknown` is the interesting case:
the forward path guesses a UTM zone from the point's own longitude, and a
coordinate already in that grid has no longitude to guess from. Uploads still
work for such a raster; the OSM query is refused rather than aimed at the wrong
hemisphere.

`bboxToWgs84` samples nine points, not four corners. A projected extent is not a
rectangle in WGS84 — a line of constant northing peaks in latitude at the central
meridian — so an extent straddling its own CM has all four corners *below* its
true top edge, by a few kilometres on a wide tile.

Overpass is a volunteer service. One query per fetch, `out geom` so no second
pass is needed to resolve node references, identical queries answered from an
in-memory cache, and the next mirror tried on a 429 or 504.

#### How much to ask for

"Everything OSM has for this extent" stops being answerable long before a user
stops asking for it. Measured against the live API: 1 250 km² around Graz holds
97 092 road ways — 6 152 of them motorway…tertiary — and 13 828 waterways, of
which 162 are rivers or canals. Over the whole of Styria the default tick boxes
come to roughly 1.2 million elements and a gigabyte of inlined geometry: past the
server's 180 s budget, past `MAX_ELEMENTS`, and past what a tab can hold. The
same extent asked for coarsely is 56 000 elements and 72 MB, in under a minute.

So the **extent picks a detail tier** — by area, not by the longer side, since a
200 × 5 km valley is a small fetch:

| Tier | Extent | What narrows |
|---|---|---|
| `full` | under 2 500 km² | nothing — every class, as before |
| `mid` | 2 500 – 22 500 km² | no footways, tracks, ditches or drains; woods and lakes above 1 km of perimeter |
| `broad` | over 22 500 km² | trunk network only, rivers and canals, woods and lakes above 3 km, no trams or pistes |

Two levers, both server-side, because what matters is what is never sent: fewer
tag values, and `(if:length() > n)` to drop small polygons and stubs by
perimeter — 43 048 forest ways over Styria become 342 at a 10 km perimeter, and
the ones that survive are the forests you would draw. Relations are never
length-filtered; they are the few hundred large multipolygons that the coarse
tiers exist to keep. The tier is shown in the panel and can be overridden to
`full` in one click, because a user who wanted every footpath and got the trunk
roads needs to know which happened.

Above 2 500 km² the fetch also **counts before it downloads**: `out count;` runs
the same search and answers with a number instead of a gigabyte, so an extent
that cannot be draped is refused in seconds rather than after four minutes of
downloading. Only when the answer is no does a second, per-category count run —
it costs the server one search per category, and it buys a refusal that names the
offender. Which is rarely the one a user would guess: over Styria the heaviest
category is not Buildings (already off by default) but Landuse & natural, at
317 758 elements.

Each attempt also carries its own **deadline**, covering headers and body, set
above the server's own `[timeout:180]`. One budget rather than a short connect
timeout and a long transfer one, because Overpass withholds response headers
until the query has finished running — so "time to first byte" and "time the
server spent thinking" are the same number, and a tight header deadline would
kill the legitimate slow queries rather than catch a dead socket any sooner.
Without it a stalled endpoint parked the panel indefinitely *and* defeated the
mirror fallback, since the loop only advanced on a rejection or a bad status. OSM data is ODbL:
`© OpenStreetMap contributors` appears in the panel whenever OSM layers are
loaded, and as a comment in every SVG export that carries them.

### Draping

Each vertex is projected into the raster's CRS, converted to fractional pixel
coordinates, and lifted onto the terrain by bilinear elevation sampling. Two
steps sit either side of that, and both exist because OSM data is *drawn* rather
than *recorded*:

- **Simplify** — Douglas–Peucker at half a pixel, before anything else. A
  digitised riverbank carries far more detail than a 30 m DEM can express.
- **Densify** — every edge is cut down to one grid step afterwards. A GPX track
  is sampled every few seconds and needs none of this; a straight motorway can
  run 400 m between nodes, and joining those two nodes with a single 3D segment
  puts the road through the ridge between them.

A vertex outside the extent, or over NoData, *breaks* the run rather than ending
it, so a road crossing a clipped corner reappears on the far side instead of
diving to the base plate.

A vector layer is drawn in **one colour**, with no per-vertex colour buffer, which
is what keeps recolouring one a frame rather than a worker rebuild. There is no
hypsometric tint: a feature has no elevation of its own — OSM carries none and a
GPX `<ele>` would disagree with the raster it is drawn on — so the tint could
only read the ground underneath, which is a different thing from what the
the draw modes mean by it.

### Individual features

A layer is not the smallest thing. Expanding one reveals its features, each with
a checkbox, so five peaks can be kept out of twenty-nine. Named features sort
first; the rest get a stable `Track #118`, because a real alpine fetch names 52
of 621 tracks and none of 245 scrub polygons, and a blank row is nothing to point
at. A filter box and a cap on rendered rows keep a 621-feature layer from
becoming 621 DOM nodes inside a scrolling panel.

**Identifying one on the terrain.** Resting the pointer over a feature names it
in a tooltip and lights it up; clicking selects it, opens its layer, and scrolls
its row into view. Hovering a row does the same thing from the other end — both
write one piece of state, so neither knows about the other.

Three things make that work:

- `packBucket` keeps each feature's `name`, a short `note` (a peak's height, a
  road's route number) and its OSM id. The tags used to be read to choose a
  bucket and then dropped, which is what made a feature impossible to name.
- `buildVectorGeometry` emits `featureOfSegment`, one entry per drawn segment.
  `LineSegments2.raycast` reports the segment index it hit, and this turns that
  into a feature — the single link between a pixel and a row.
- The picker owns its raycaster rather than using R3F's event system, which would
  raycast every line layer on every pointer move. Raycasting a `LineSegments2` is
  O(segments) and the bounding-sphere early-out never helps here, since every
  layer's sphere covers the whole raster. So hovering is debounced to
  pointer-rest, a click picks immediately, and a drag stays an orbit because the
  click path measures how far the pointer travelled. **Identify on hover** turns
  the whole thing off for a fetch dense enough to make even that too expensive —
  and takes both highlights with it. It has to: the only way out of a selection
  is a click on empty terrain, and that listener goes with the picker, so a
  selection left behind would stay lit for the rest of the session with nothing
  able to dismiss it. Clicking an already-selected row in the feature list clears
  it too, which is the same escape from the panel end — the list is how a
  selection is made while Identify is off, so it is how one is undone.

**Pick radius.** Three does not take one: it tests
`distance < (material.linewidth + threshold) / 2` in CSS pixels, so the threshold
is worked backwards from the radius wanted and depends on how thick each layer is
drawn — which means setting it *per layer* rather than once for the raycaster. A
point gets the larger radius, because a peak is a single dot with no length to
catch a passing cursor: at a fixed threshold of 6 a weight-5 peak had a 5 px
target, measured at a 0.5% hit rate across a sweep of the viewport against 9.5%
at the current 20 px. Points also win ties, so a summit sitting near a road it
does not belong to is still what you get when you point at the summit.

Hiding a feature never renumbers the rest — `hidden` names indices in the source,
not in whatever is currently drawn — so the checkbox under the cursor stays the
one that moves.

**Area fills** are rasterised into a lattice in pixel space rather than
triangulated. Every lattice corner takes its own elevation sample, so the fill
follows the slope instead of hanging over it as a flat lid, and holes and
multi-part polygons come free from the even-odd rule instead of needing a
triangulator. The step is chosen per layer from the area its polygons cover, so
a valley full of forest coarsens rather than truncating.

### Point features as icons

A point layer draws a dot: one degenerate segment per feature, rendered with a round
cap and exported as a `<circle>`. Twenty-nine summits look like twenty-nine identical
dots. Choosing an icon replaces that dot — in the viewport and in every export at once,
since the icon layer *substitutes* for the dot layer rather than being drawn over it.

The set is **sixteen marks**, all from [Maki](https://labs.mapbox.com/maki-icons)
(CC0) — summit, mountain, volcano, viewpoint, refuge, campsite, tree, water, map pin,
waypoint, danger, cross, star, circle, square, x. Maki is Mapbox's own POI set, so these
are the names a Mapbox style addresses: `danger` is the skull and crossbones a style calls
`danger-15`. Every icon is normalised into a unit box and drawn at the layer's own weight,
so Maki's 15 × 15 grid and its stroke widths never enter into it.

They live in `public/icons/` alongside the licence, arranged the way `public/presets/`
is: real SVG files, replaceable without a rebuild, and previewed in the picker by an
ordinary `<img>`.

Sixteen is the whole picker: one grid, no search, with the category's own suggestion
first. The bundle was briefly all 1,383 icons of a UI set behind a search box, which is
5.5 MB of repository for a drawer nobody opens — a terrain plot wants a handful of marks,
and anything past them is an upload of the exact glyph you had in mind rather than a hunt
through a catalogue.

**Fill is on by default**, because these are silhouettes: a solid mountain is the mark
Maki drew, and the hollow outline of one is a wireframe of it. Choosing an icon takes the
layer's own colour for the fill and sets it opaque — a summit going solid should go solid
in its own colour rather than in the blue a lake uses, and the 45% an area fill starts at
is right for a lake seen through contour lines and wrong for a 25-pixel glyph. Both only
on the *first* pick, so neither overrides a choice already made. Switching Fill off leaves
the outline, which is what a pen plotter draws. The fill reaches the viewport and the PNG
and video captures — **not the SVG**, which is a line-art format.

**Holes are cut.** What the flattener returns for a filled icon is a set of fill
*boundaries* — the skull's outline, and separately its eye sockets and its teeth — so
triangulating them blindly fills the sockets in, and a solid oval is not a skull. The
rings are sorted first, by containment rather than by winding: a ring inside an odd number
of other rings is a hole, and it belongs to the *smallest* ring containing it, which is
what makes a window inside a tower inside a castle come out right. Winding is deliberately
not consulted — it only says what an SVG's `fill-rule` means, and the files that get it
wrong are exactly the ones where reading it would mislead.

The triangulation itself is three's `ShapeUtils.triangulateShape` — earcut, with hole
bridging — which ships with three and is far better tested than the hand-rolled ear
clipper it replaced. That clipper had no hole support at all, which was tolerable when the
set was stroke art with almost nothing to cut and is not now: eleven of the sixteen marks
have something that must stay open.

**Why a filled map set, when this app draws lines.** The first version of this feature
took the opposite view, and the reasoning is worth keeping because it turned out to be
half right. This app draws line segments and exports SVG for a plotter, so a *stroke* set
flattens straight into polylines and becomes an ordinary line layer — it inherits the
layer's colour, weight, opacity and dash, the ghost occlusion, the hidden-line removal and
every exporter, with no new render path anywhere. A *filled* glyph, the argument went,
would arrive as a hollow outline of itself.

It does arrive as a hollow outline of itself. That is the part that was wrong: for a map
symbol, the outline of the silhouette *is* the line drawing. The fill boundary of a skull
and crossbones is a skull and crossbones; its eye sockets and teeth are holes in the fill
and come out as their own closed marks. A stroke set buys a lighter line and pays in
vocabulary — the UI set used before this has no mountain, no volcano, no shelter, no
viewpoint, which is precisely the vocabulary a terrain plot needs, and it has fifteen
kinds of arrow instead. Maki is 215 marks drawn for maps.

The cost is real and bounded: tracing both sides of every limb roughly doubles the
segments against the same shape drawn as a stroke — `danger` is 111 segments where a
stroke skull was 52. Across the whole set the range is 10 (`star`) to 111 (`danger`), against
a per-layer budget of 60,000, so a layer keeps its icons up to ~540 features either way.

One consequence worth knowing: **prefer Maki's solid variants over its `-stroked` ones.**
`circle` flattens to one ring at 32 segments; `circle-stroked` draws its ring as a filled
band, so flattening traces *both* edges — two concentric rings, 64 segments, for a mark
that reads as one. Everything in `public/icons/` is a solid.

**The files are upstream's, byte for byte.** They were briefly repainted to
`fill="none" stroke="currentColor"` so the picker's thumbnails would match a hollow
rendering; with fills on and holes cut, the drawn mark matches Maki's own artwork, so the
thumbnails do too and there is nothing left to edit. The flattener never cared either way
— it samples geometry, not paint — though it does require that an element paint
*something*, which is what makes a `fill="none"` file with no stroke invisible to it.

### Labels: a point's name and its height

A peak fetched from OpenStreetMap arrives with everything a label needs: its `name` tag,
and from its `ele` tag the note the feature list already shows — "1910m". Switching
**Name** or **Height** on draws them on the terrain.

They are drawn as *geometry*, not as an overlay or a sprite: the lettering is flattened
into the same `positions` array a contour uses, so it takes the layer's colour, weight,
opacity and dash, the ghost occlusion, the hidden-line removal, and every exporter. In the
SVG it arrives as strokes in a pen layer of its own, `Peaks · labels`, which is what lets
the lettering be a different pen from the marks it labels.

**A feature with nothing to say is not labelled.** No name means no name line, no `ele`
means no height line, and neither means nothing at all — there is no "(unnamed)" and no
"#12". A plot of twenty-nine summits with nine of them numbered is worse than one with
nine unlabelled summits, and the panel prints the counts ("18 of 29 named") so the gap
reads as data rather than as a bug.

**The font is Space Mono**, the face the erzberg logo is set in, so a plot is labelled in
the same voice the tool speaks in. It is [SIL OFL 1.1](https://openfontlicense.org), and
`public/fonts/` carries the licence. **Bold** and **Italic** are two switches: regular is
neither, and bold-italic falls out of both. Each is a separate file — a real italic
redraws the letters, where slanting the roman in the geometry would be cheaper and would
look like exactly what it is — and a face is fetched only when a layer asks for it, so a
session that letters in one downloads one.

Getting outlines out of a font is the whole difficulty. A browser will happily *render*
text and will not tell you where the curves went — there is no API that hands back the
outline of a glyph, so the trick the icons use (`getPointAtLength` on a real element) has
nothing to bite on. `scripts/build-font.js` therefore converts the TTF ahead of time with
`opentype.js`, a devDependency, into `public/fonts/space-mono-700.json`: 213 glyphs of
path data, 68 kB, covering ASCII, Latin-1 and the Latin Extended-A letters that Austrian,
Slovene, Czech and Hungarian place names need. Shipping path `d` strings rather than
pre-flattened polylines keeps the file a fraction of the size and lets the app's own
sampler and simplifier — the ones the icons go through — do the rest at runtime, cached
per glyph and then per string.

`npm run font path/to/SpaceMono-Bold.ttf` regenerates it. The script refuses a
proportional font, because the layout in `utils/textGeometry.js` is a cursor and an
addition: Space Mono is monospaced, so there is no kerning table and no per-glyph advance
to carry.

**Placement** is in world units on the label's own plane: **Size** is units per em,
**Offset ↔** and **Offset ↕** move it across and up that plane, and **Align** sets which
edge of the text the point sits under.

**The type is inked apart from the marks it labels** — see *Ink*, below, which is the same
block on both. The plane is the icon's — the same *Face camera*,
Tilt and Spin — because a name lying flat beside an upright summit triangle reads as a
bug. A second line sits 1.25 em under the first.

**Fill** draws the type solid with the counters of the letters cut out, through the same
hole-aware triangulation the icons use; switching it off leaves outlined type, which is
what the SVG carries either way.

### Ink: what a mark is drawn with

An icon and a label each carry a full set of their own — **Colour**, **Stroke** and
**Opacity**, then **Fill** with its own **Fill Colour** and **Fill Op.** — and the two sets
are independent of each other and of the layer's. The panel renders one component twice,
and `layerStyle` resolves `vec:7#icons` and `vec:7#labels` through the same cascade with a
different prefix, so the two can never drift apart in behaviour.

Why not simply use the layer's? Because a mark drawn *from* a layer is not the layer. A
point layer's `weight` is its dot's **diameter** — 5 for a peak — and five units of stroke
on a 25-unit mountain is a blob; the weight that draws that mountain well then closes up
the counters of nine-point type. Colour and opacity go the same way: amber summits under
grey lettering is an ordinary thing to want from one layer.

**Stroke** says where that width sits: **Outside** (the default) or **Centred**. A line
renderer only knows centred — `LineMaterial` strokes a path in screen-space pixels,
straddling it — and there cannot be a geometric fix either, because the width is in CSS
pixels and the offset it would need is a world distance that changes with the camera and,
under perspective, with each mark's own depth. Paint order does it instead: the line is
drawn at *twice* the width and the mark's fill is drawn over its inner half, from a
`renderOrder` slot that sits after this layer's lines and before the next layer's anything.
What survives is exactly the requested width lying outside the edge, with the edge itself
where the icon or the letterform put it. It needs a fill to cover with, so the control only
appears with one — a stroke with no shape behind it has no inside to sit in — and a
part-transparent fill lands somewhere between the two, which is the honest answer for a
part-transparent fill. Inside is not offered: hiding the outer half would need a stencil
mask, and nothing else in this renderer works that way.

Two things had to be settled before any of that was stable, and they are worth knowing
about because the symptom was a mess rather than an error. A mark's fill and its stroke are
*exactly* coplanar, and a wide stroke is not really in that plane at all — `LineMaterial`
expands a segment into a screen-space quad whose depth is interpolated across its width. So
a fill that writes depth accepts its own stroke on some pixels and rejects it on others: a
patchwork, changing as the camera moves. A mark's fill therefore does not write depth, and
the order is `renderOrder`'s to decide. Separately, the mark is a flat drawing planted on a
rough surface, so the terrain genuinely cuts through its plane — and it was being cut in two
different places, because the fill carried a `polygonOffset` toward the camera and the
stroke carried none. Both now take the same bias, and a deeper one than an area fill uses:
an area fill is *of* the surface and hugs it, while a marker stands a whole glyph through
the ground it is planted in. Lift stops a marker being half-buried; the bias stops it being
half-eaten.

The SVG export ignores all of it and writes the width the slider says. A plotter draws one
pass along the outline whichever side of it the screen puts the ink on, and doubling the
pen would be a lie about the drawing.

Everything but the stroke width starts as `null`, meaning "the layer's own", so a mark
matches its layer until it is told otherwise and **Match layer** puts it back. The width is
a real number from the start, because inheriting a dot's diameter is the one thing it must
not do. A mark's **fill** falls back through that mark's *own* stroke colour before
reaching the layer's, so colouring an icon colours the whole icon, while parting its fill
from its outline stays possible and stays deliberate.

This replaced a pair of hacks worth naming, since the shape of the bug they papered over
recurs: choosing an icon used to *write into the layer* — thinning its weight to 1.5 and
claiming its `fillColor` and `fillOpacity` — because the glyph had no ink of its own and
the layer's was a dot's diameter and an area fill's lake blue. Both are gone. Picking an
icon now changes the icon.

Text is not cheap — "Polster" is 266 segments and its height another 222 — so a layer
whose labels would cost more than 80,000 segments draws none of them and says so, rather
than lettering an arbitrary half of a valley.

**Flattening.** `utils/svgFlatten.js` contains no path parser. Every drawable SVG element
is an `SVGGeometryElement`, so `<path>`, `<circle>`, `<rect>`, `<ellipse>`, `<line>`,
`<polyline>` and `<polygon>` are all handled by `getTotalLength()` + `getPointAtLength()`
— arcs and béziers come out exact, and `getCTM()` folds in whatever nesting and
`transform` an uploaded file carries. The samples then go through the same `simplifyFlat`
the draping uses, so straight runs collapse back to their endpoints. A Maki icon lands at
10–111 segments once flattened.

Two things that are not obvious:

- **Subpaths must be split, and not by parsing.** `getPointAtLength` walks a multi-subpath
  `<path>` as one continuous parameterisation, and a move between subpaths has no length —
  so walking it end to end draws a segment from where one subpath stopped to where the
  next began. Splitting the `d` attribute is the obvious fix and is wrong: a subpath
  starting with a relative `m` is relative to the previous subpath's end. Detecting the
  spatial discontinuity needs no parsing and cannot be fooled, because a genuine segment
  sampled at step `s` never advances more than `s`.
- **These APIs only answer inside a rendered document**, which is why icon geometry is
  built on the main thread rather than in the geometry worker. That turns out to be where
  it belongs anyway: size, lift and orientation become render-side like colour and weight,
  so dragging them is a frame rather than a rebuild — and it is what lets the icons follow
  the camera at all.

**Orientation.** The icon plane's basis comes from an azimuth θ and an elevation φ:

$$R = (\cos θ,\; 0,\; -\sin θ) \qquad
  U = (-\cos φ \sin θ,\; \sin φ,\; -\cos φ \cos θ)$$

With **Face camera** on, θ and φ *are* the camera's own angles — `Scene` places the camera
with `setFromSphericalCoords(dist, phi, theta)` from `tilt` and `rotation`, so feeding
those two in makes the plane perpendicular to the view. At φ = 90° the icon stands upright
facing the camera; at φ = 0° it lies flat on the ground with its top pointing away, which
is how a symbol on a map should read from above. Switching the toggle off exposes the two
angles as sliders, and **Match view** copies the camera's onto them — the same drawing,
now pinned for a frame you are composing. Billboarding costs nothing extra: both values
already live in React state, synced from OrbitControls on the existing throttled 150 ms
tick.

**Lift** raises the icon off its point and draws a leader line down to it, which is what
stops a summit marker being half-buried in the slope behind it.

Picking and highlighting survive the substitution: the icon layer carries a rebuilt
`featureOfSegment` mapping every segment of a glyph to the feature its dot stood for, and
it keeps a point's wider pick radius. The geometry record itself is `isPoints: false`,
which is what makes the SVG exporter write strokes rather than a circle per feature.

Past `MAX_ICON_SEGMENTS` a layer keeps its dots and says so in its row, rather than
drawing a fraction of its icons and looking like missing data.

### What a preset carries

A preset is a look, not a data set: `vectorStyles` holds each layer's style keyed by its
`bucket`, so last week's palette lands on today's fresh fetch of the same valley. Three
things are deliberately left out, and each for the same reason — they are data, not look.

`hidden` holds feature *indices*, which mean nothing against a different fetch. `iconCustom`
holds an uploaded SVG's flattened geometry, whose polylines are typed arrays: `JSON` writes
those as `{"0":…}` objects with no `length`, so a preset that carried one came back with a
glyph that drew nothing — and, because `icon` still said `custom`, a layer that drew nothing
at all. It is dropped, and `icon` falls back with it.

The third is the stack order, which is carried but only where it is meant: `vectorStyles` is
written top-of-stack first and the payload says so with `vectorStackOrder: true`. Before the
stack existed the same array was written in *paint* order, ground cover first, and the two
are indistinguishable by inspection — so a preset without the flag has its styles applied and
its arrangement ignored, rather than being read backwards into landuse drawn over roads.

### When the features do not appear

Different failures all end as "points dropped for being out of bounds", and they
need different fixes, so they are reported separately:

| Report | Cause |
|---|---|
| *…is not one this tool can place WGS84 features in* | Untransformable CRS. Reproject the raster. |
| *This GeoTIFF carries no georeferencing* | No tie point / pixel scale / transformation in the file. |
| *…its extent cannot be turned into an OpenStreetMap query* | Forward-only CRS. Uploads still work. |
| *None of the N loaded vertices fall inside this GeoTIFF* | The projection worked. The features are simply somewhere else. |
| *N of M vertices fall inside* | Partial overlap; the rest are clipped. Not an error. |

A GPX point needs its `lat` and `lon` attributes to be *present*, not merely
numeric. `getAttribute` returns null for a missing one and `+null` is 0, so a
numeric test alone accepted a malformed `<trkpt>` as a point at (0, 0) — which is
not a sentinel but a real place in the Gulf of Guinea. Such a point counted in
the coverage report's total and never in its inside count, so a track that landed
perfectly on the raster reported back as only *partially* covered, blaming a
raster that was fine. An `<ele>` of exactly 0 m is likewise kept rather than read
as absent: sea level is data. Track segments are kept apart, because a `<trkseg>`
boundary is the recording pausing and joining two of them draws a line through
whatever lies between.

A GeoJSON carrying the old spec's top-level `crs` member naming anything other
than WGS84 is refused with the `ogr2ogr` command that fixes it, rather than drawn
in the wrong place.

### Exports

| Export | Vector layers |
|---|---|
| SVG | Yes — one Inkscape layer per vector layer, named, so a plot is separable by pen. Icons export as strokes, in their own `· icons` pen layer. Area *fills* are omitted: correct output would need painter-order depth sorting of thousands of triangles against the software Z-buffer, and this is a line-art format. Every filled area's outline is still there. |
| PNG / PNG α / WebM | Yes — they capture the rendered scene. |
| STL | Only for layers with **STL ribbon** on, written as `<base>-vectors.stl`. Default on for GPX layers, off for OSM and GeoJSON. |
| Heightmap PNG | No. It writes the elevation raster, not a picture. |

---

## Vertical exaggeration

On load, a GeoTIFF gets a suggested `elevScale` so the terrain starts at roughly
true proportions instead of an arbitrary height. The mesh lays one grid step per
pixel *column* and spans `100 × elevScale` world units vertically, so the figure
that has to be right is the **east–west ground size of one pixel**:

$$\text{elevScale} = \frac{\text{elevation range}}{100 \cdot \text{ground pixel width}}$$

clamped to 0.1 … 50.

A projected CRS already reports pixel size in linear units, converted to metres
via `ProjLinearUnitsGeoKey` (the international and US survey foot are handled).
A geographic CRS reports **degrees**, and converting those needs the latitude:
a degree of longitude is 111 320 m at the equator but only ~75 km at 47°N.

This is why reprojecting is safe. Measured on a 10 m UTM raster against
`gdalwarp -t_srs EPSG:4326` of itself — same terrain, same elevation range:

| | CRS | columns | elevScale | relief |
|---|---|---|---|---|
| original | EPSG:32633 | 1200 | 1.71 | 1.4250 |
| reprojected | EPSG:4326 | 1297 | 1.84 | 1.4187 |

Relief is `elevScale / columns`, the two agreeing to 0.4%.

The classification is by **CRS, never by magnitude**. A "value < 1 must be
degrees" test would mis-scale sub-metre lidar — legitimately < 1 in metres — by
~111320× and flatten it to the clamp floor.

---

## NoData

Voids are common in real elevation data: clipped catchments, SRTM holes, the
border a rotated footprint leaves after reprojection. A GeoTIFF declares its
void value in `GDAL_NODATA`, and that value is read from the file rather than
guessed. A small sentinel set — −9999, −32767, −32768 and the *positive* float
maximum — is a fallback for rasters that declare nothing.

That set is deliberately not a substitute for reading the tag. It does not
contain the **negative** float maximum, which is exactly what GDAL writes into
float DEMs (`-3.4028235e+38`), so a raster whose declared value went unread had
its voids treated as real ground 3.4e38 metres down. Masked pixels set the
min/max that normalises the heightmap, so a single unmasked void drags the floor
down and collapses the whole terrain into a plateau.

Masked pixels are also excluded from the rendered surface, the auto-zoom
framing, and the STL base plate.

---

## Implementation

| File | Role |
|---|---|
| `src/utils/geoCoords.js` | `classifyCRS`, forward and inverse projection, `bboxToWgs84`, `geoToPixel` / `geoToWorld`, `featureCoverage`, `suggestElevScale` |
| `src/hooks/useHeightmap.js` | GeoTIFF decode, geokey reading, NoData, CRS detection |
| `src/utils/vectorLayers.js` | The packed source / layer-record model shared by all three sources |
| `src/utils/gpxParser.js` | GPX → segments → a vector source |
| `src/utils/geoJsonParser.js` | GeoJSON → a vector source |
| `src/utils/osmCategories.js` | The OSM catalogue: selectors, buckets, default styles |
| `src/utils/osmFetch.js` | Overpass query, fetch, cache, bucketing |
| `src/utils/vectorGeometry.js` | Draping, simplification, densification, area fills, `featureOfSegment` |
| `src/components/VectorPicker.jsx` | Pointing at the terrain to identify a feature |
| `src/components/VectorHighlight.jsx` | Lighting up the hovered / selected feature |
| `src/utils/svgFlatten.js` | SVG → polylines, via the browser's own geometry API |
| `src/utils/textGeometry.js` | Label text → polylines: outline faces sampled, stroke faces read straight |
| `scripts/build-single-line-fonts.js` | The 49 single-line faces, flattened from oskay/svg-fonts, Relief SingleLine, ISO 3098 and three plotter ROM faces |
| `src/utils/iconCatalogue.js` | The bundled set in `public/icons/`, and its flattened cache |
| `src/hooks/useVectorIcons.js` | Placing, sizing, lifting and orienting the icons |
| `src/utils/stlExport.js` | Ribbon solids for layers that ask for one |
| `tests/projection.spec.js` | CRS classification, projection maths, round-trips, coverage, load path |
| `tests/vector.spec.js` | Fetch → layers, hide/remove, fills, uploads, SVG export |
| `tests/osm-detail.spec.js` | Detail tiers by extent, and the pre-flight count that refuses a province by name |

### A note on geotiff.js

`image.fileDirectory` is a **lazy object**: its own enumerable keys are
bookkeeping, and tags are reachable only through `hasTag()` / `getValue()`.
Reading a tag as a plain property returns `undefined` *without throwing*, so
every unit test passes while a georeferenced file reads as unreferenced and a
declared NoData value reads as absent. All tag access goes through one accessor
that handles both that shape and the older plain-object one.

### Adding a CRS

Add the code to the relevant table in `classifyCRS` — `GEOGRAPHIC_EXACT`,
`GEOGRAPHIC_APPROX`, `MERCATOR`, or a `UTM_FAMILIES` block — and it is picked up
by the renderer, the STL exporter and the sidebar readout together, since all
three ask the same classifier. A projection needing new maths also needs a
branch in `projectWgs84`, and should carry an honest `accuracy` if its datum
shift is unimplemented. Add the matching branch to `unprojectWgs84` too, or the
raster will drape uploads correctly and still refuse the OpenStreetMap query.
