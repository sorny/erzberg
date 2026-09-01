# Georeferencing

A PNG heightmap is only a grid of numbers. A GeoTIFF also says *where on Earth*
that grid sits, and in which coordinate system. `erzberg` uses that for four
things. It drapes vector features on the terrain. It asks OpenStreetMap what is
inside the extent. It suggests a vertical exaggeration that is proportional
rather than arbitrary. And it reports the elevation range in real metres.

All four depend on a correct read of the metadata of the file. When that read
goes wrong, the failure is silent: features do not appear, or a mountain renders
flat. The sidebar thus states what it found, and does not leave you to infer it.

---

## The projection readout

Under the mesh statistics at the bottom of the sidebar, a GeoTIFF reports its
coordinate reference system:

```
Elevation: 641 – 2350 m  (Δ 1708 m)
Projection: WGS 84 / UTM zone 33N (EPSG:32633)
```

The name comes from the own citation geokey of the file where it has one, and
otherwise from a built-in table. The app always shows the EPSG code. The line
appears **only** for a GeoTIFF. A PNG heightmap and a frozen soundscape have no
projection to report, and both clear the field rather than a keep of a stale one.

Where the reading rests on an assumption, the line says so. It does not imply a
precision that it does not have:

| Suffix | Meaning |
|---|---|
| `· assumed UTM` | The file is projected but records no EPSG code. The app infers the UTM zone from the longitude of the track itself. That is right for a UTM tile and wrong for anything else. |
| `· datum shift not applied` | A geographic CRS on an older datum (NAD27, ED50, MGI, DHDN). It is usable, but the unapplied shift costs 100–400 m. |
| `· GPX overlay unsupported` | The app cannot project into the grid at all. The raster still renders normally. Only the track overlay is affected. |
| `Not georeferenced` | The file carries no tie point, pixel scale or transformation. Its "bounding box" is only the pixel grid. |

---

## Coordinate systems

A GPX file has no projection to declare. The format defines its coordinates as
WGS84 lon/lat, full stop. All the variety is on the GeoTIFF side. To place a
track, the app projects WGS84 *forward* into whatever grid the bounding box of
the raster is stated in. `classifyCRS` in `src/utils/geoCoords.js` decides
whether that step is possible.

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

Modern datums sit within a metre or two of each other, so the app applies no
datum shift to them. It accepts the older ones but flags them, because an
unapplied shift is a visible error at raster resolution. That is worth a
statement rather than silence.

UTM uses the standard Transverse Mercator series on the WGS84 ellipsoid,
accurate to sub-metre within a zone. Zone ranges are bounded per family, so the
app does not read a neighbouring code such as EPSG:32661 (UPS North) as "zone
61".

The app wraps the longitude difference that feeds that series into ±180° first.
Two longitudes subtract to a number, and that number is an angular separation
only after the wrap. The central meridian of zone 1 is −177°, so a point at
+179°, which is 4° to its *west*, subtracts to +356°. The series is a small-angle
expansion, and A⁵ of 6.2 radians is not small. The easting thus came back as
−9.7 × 10⁸, the point landed outside every raster, and the app dropped it as
ordinary out-of-bounds clipping. The wrap does nothing for every zone that does
not meet the dateline.

### Not transformable

The app identifies the national grids by name and declines them: Austria Lambert
(31287), the Austrian Gauss-Krüger meridian strips (31254–31259), Swiss LV95
(2056), OSGB (27700), Lambert-93 (2154), LAEA Europe (3035) and World Mercator
(3395).

This is deliberate. To place them correctly needs Lambert or Gauss-Krüger maths
*plus* a datum shift. For the MGI-based Austrian grids, an unshifted overlay sits
a few hundred metres off and still looks entirely plausible. A wrong overlay that
looks right is worse than a message that says what to do:

```sh
gdalwarp -t_srs EPSG:4326 in.tif out.tif
```

A reprojection does not change how the terrain renders. Read *Vertical
exaggeration*, further down.

---

## Vector layers

With a georeferenced GeoTIFF loaded, the **Vector Layers** section drapes WGS84
features on the terrain from three sources:

| Source | What arrives |
|---|---|
| **OpenStreetMap** | A checklist of categories, then one Overpass query over the extent of the raster. |
| **GeoJSON** | One file, bucketed by geometry class. RFC 7946 fixes the coordinates as WGS84 lon/lat. |
| **GPX** | Track points (`<trk><trkseg><trkpt>`) first, and route points (`<rte><rtept>`) as a fallback. The app does not collect waypoints. They are unordered, and a track is what the overlay draws. |

Every source normalises to the same packed form (`utils/vectorLayers.js`). Every
bucket becomes one **layer** with its own colour, weight, opacity, dash and
visibility. An area layer also gets an optional fill. Layers are `lineGeo`
entries in every respect, so they inherit the live renderer, ghost occlusion,
hidden-line removal and the SVG, PNG and video exporters. None of those parts
knows that OpenStreetMap exists.

### The stack

The list is a stack, read the way every other layer list is read: **the top row
is the front of the scene**. Drag a row by its grip to move it, or focus the grip
and press ↑ or ↓. What the row covers changes with it. In the SVG that is which
pen draws last. On screen it is which ink is on top of which.

A fetch arrives already stacked the way a map wants to be read. The own catalogue
of OSM is ordered ground-cover-first, and the panel shows it upside down: peaks
and roads at the top, water and landuse at the bottom. An upload lands on top of
whatever is already there, which is where you were looking when you loaded it.

A move of a layer is *not* a rebuild. The build key of the worker for the stack
is sorted (`vectorBuildSignature`). The same coordinates draped on the same
terrain are thus still a cache hit at either end of the list. The main thread
resolves the order once. It reverses a stack into paint order (`merged` in
`hooks/useTerrainGeometry.js`) and then into `renderOrder`. That is what lets a
drag across forty layers of a dense alpine fetch follow the cursor. It does not
re-drape a valley of roads per step.

Inside the slot of a layer, the parts keep their order too: fill under outline,
and outline over its own ghost. That is what makes a filled area cover the layers
below it rather than a tint of them. A fill at 100 % is genuinely opaque and
still obeys the stack. It stays in the blended pass, where `renderOrder` decides.
The opaque pass instead draws it before every line in the scene, no matter where
you dragged it.

Order travels with a preset, because the app writes the saved styles in stack
order. Buckets that a preset never saw keep their order relative to each other
and settle underneath the ones that it names.

### Asking OpenStreetMap

The extent has to leave the grid of the raster before it can be a query. This is
thus the one feature that needs the **inverse** projection, and the inverse is
narrower than the forward one. `EPSG:projected-unknown` is the interesting case.
The forward path guesses a UTM zone from the own longitude of the point. A
coordinate already in that grid has no longitude to guess from. Uploads still
work for such a raster. The app refuses the OSM query rather than an aim at the
wrong hemisphere.

`bboxToWgs84` samples nine points, not four corners. A projected extent is not a
rectangle in WGS84. A line of constant northing peaks in latitude at the central
meridian. An extent that straddles its own CM thus has all four corners *below*
its true top edge, by a few kilometres on a wide tile.

Overpass is a volunteer service. The app sends one query per fetch and uses
`out geom`, so it needs no second pass to resolve node references. It answers
identical queries from an in-memory cache, and tries the next mirror on a 429 or
a 504.

#### How much to ask for

"Everything that OSM has for this extent" has an answer only up to a size. A user
asks past that size long before they stop asking. Measured against the live
API: 1 250 km² around Graz holds 97 092 road ways, and 6 152 of them are motorway
to tertiary. The same extent holds 13 828 waterways, of which 162 are rivers or
canals. Over the whole of Styria the default tick boxes come to roughly 1.2
million elements and a gigabyte of inlined geometry. That is past the 180 s
budget of the server, past `MAX_ELEMENTS`, and past what a tab can hold. The same
extent asked for coarsely is 56 000 elements and 72 MB, in under a minute.

The **extent thus picks a detail tier**. It picks by area, not by the longer
side, because a 200 × 5 km valley is a small fetch:

| Tier | Extent | What narrows |
|---|---|---|
| `full` | under 2 500 km² | nothing — every class, as before |
| `mid` | 2 500 – 22 500 km² | no footways, tracks, ditches or drains; woods and lakes above 1 km of perimeter |
| `broad` | over 22 500 km² | trunk network only, rivers and canals, woods and lakes above 3 km, no trams or pistes |

Two levers do the work, and both are server-side, because what matters is what
the server never sends. The first lever is fewer tag values. The second is
`(if:length() > n)`, which drops small polygons and stubs by perimeter. Over
Styria, 43 048 forest ways become 342 at a 10 km perimeter. The ones that survive
are the forests that you want to draw. The app never length-filters
relations. They are the few hundred large multipolygons that the coarse tiers
exist to keep. The panel shows the tier, and one click overrides it to `full`. A
user who wanted every footpath and got the trunk roads needs to know which
happened.

Above 2 500 km² the fetch also **counts before it downloads**. `out count;` runs
the same search and answers with a number instead of a gigabyte. An extent that
the app cannot drape is thus refused in seconds rather than after four minutes of
download. Only when the answer is no does a second, per-category count run. It
costs the server one search per category, and it buys a refusal that names the
offender. That is rarely the one a user expects. Over Styria the heaviest
category is not Buildings, which is already off by default, but Landuse &
natural, at 317 758 elements.

Each attempt also carries its own **deadline**, over headers and body together,
set above the own `[timeout:180]` of the server. It is one budget rather than a
short connect timeout and a long transfer one. Overpass withholds response
headers until the query finishes, so "time to first byte" and "time the server
spent thinking" are the same number. A tight header deadline thus kills the
legitimate slow queries and catches a dead socket no sooner. Without the
deadline, a stalled endpoint parked the panel indefinitely *and* defeated the
mirror fallback. The loop advanced only on a rejection or a bad status.

OSM data is ODbL. `© OpenStreetMap contributors` appears in the panel whenever
OSM layers are loaded, and as a comment in every SVG export that carries them.

### Draping

The app projects each vertex into the CRS of the raster and converts it to
fractional pixel coordinates. Bilinear elevation sampling then lifts it onto the
terrain. Two steps sit either side of that. Both exist because OSM data is
*drawn* rather than *recorded*:

- **Simplify** — Douglas–Peucker at half a pixel, before anything else. A
  digitised riverbank carries far more detail than a 30 m DEM can express.
- **Densify** — the app cuts every edge down to one grid step afterwards. A GPX
  track is sampled every few seconds and needs none of this. A straight motorway
  can run 400 m between nodes, and one 3D segment between those two nodes puts
  the road through the ridge between them.

A vertex outside the extent, or over NoData, *breaks* the run rather than an end
to it. A road that crosses a clipped corner thus reappears on the far side
instead of a dive to the base plate.

The app draws a vector layer in **one colour**, with no per-vertex colour buffer.
That is what keeps a recolour of one a frame rather than a worker rebuild. There
is no hypsometric tint. A feature has no elevation of its own: OSM carries none,
and a GPX `<ele>` disagrees with the raster that it is drawn on. The tint reads
only the ground underneath, which is a different thing from what the draw modes
mean by it.

### Individual features

A layer is not the smallest thing. Expand one and it reveals its features, each
with a checkbox, so you can keep five peaks out of twenty-nine. Named features
sort first. The rest get a stable `Track #118`. A real alpine fetch names 52 of
621 tracks and none of 245 scrub polygons, and a blank row is nothing to point
at. A filter box and a cap on rendered rows keep a 621-feature layer from
621 DOM nodes inside a scrolling panel.

**Identifying one on the terrain.** Rest the pointer over a feature. The app
names it in a tooltip and lights it up. A click selects it, opens its layer, and
scrolls its row into view. A hover over a row does the same thing from the other
end. Both write one piece of state, so neither knows about the other.

Three things make that work:

- `packBucket` keeps the `name` of each feature, a short `note` (the height of a
  peak, the route number of a road) and its OSM id. The app used to read the tags
  to choose a bucket and then drop them, which is what made a feature impossible
  to name.
- `buildVectorGeometry` emits `featureOfSegment`, one entry per drawn segment.
  `LineSegments2.raycast` reports the segment index that it hit, and this turns
  that index into a feature. It is the single link between a pixel and a row.
- The picker owns its raycaster rather than the event system of R3F, which
  raycasts every line layer on every pointer move. A raycast of a `LineSegments2`
  is O(segments), and the bounding-sphere early-out never helps here, because the
  sphere of every layer covers the whole raster. The app thus debounces a hover
  to pointer-rest, and a click picks immediately. A drag stays an orbit, because
  the click path measures how far the pointer travelled. **Identify on hover**
  turns the whole thing off for a fetch dense enough to make even that too
  expensive. It takes both highlights with it. It has to. The only way out of
  a selection is a click on empty terrain, and that listener goes with the
  picker. A selection left behind thus stays lit for the rest of the session,
  with nothing able to dismiss it. A click on an already-selected row in the
  feature list clears it too, which is the same escape from the panel end. The
  list is how you make a selection while Identify is off, so it is how you undo
  one.

**Pick radius.** Three.js does not take one. It tests
`distance < (material.linewidth + threshold) / 2` in CSS pixels. The threshold
thus works backwards from the radius that you want, and depends on how thick each
layer is drawn. That means the app sets it *per layer* rather than once for the
raycaster. A point gets the larger radius, because a peak is a single dot with no
length to catch a passing cursor. At a fixed threshold of 6, a weight-5 peak had
a 5 px target. Measured across a sweep of the viewport, that gave a 0.5% hit rate
against 9.5% at the current 20 px. Points also win ties. A summit near a road that it
does not belong to is still what you get when you point at the summit.

A hidden feature never renumbers the rest. `hidden` names indices in the source,
not in whatever is currently drawn, so the checkbox under the cursor stays the
one that moves.

**Area fills** are rasterised into a lattice in pixel space rather than
triangulated. Every lattice corner takes its own elevation sample, so the fill
follows the slope instead of a flat lid over it. Holes and multi-part polygons
come free from the even-odd rule and need no triangulator. The app chooses the
step per layer from the area that the polygons cover, so a valley full of forest
coarsens rather than truncates.

### Point features as icons

A point layer draws a dot: one degenerate segment per feature, rendered with a
round cap and exported as a `<circle>`. Twenty-nine summits look like twenty-nine
identical dots. An icon replaces that dot, in the viewport and in every export at
once. The icon layer *substitutes* for the dot layer rather than a draw over it.

The set is **sixteen marks**, all from [Maki](https://labs.mapbox.com/maki-icons)
(CC0): summit, mountain, volcano, viewpoint, refuge, campsite, tree, water, map
pin, waypoint, danger, cross, star, circle, square and x. Maki is the own POI set
of Mapbox, so these are the names that a Mapbox style addresses. `danger` is the
skull and crossbones that a style calls `danger-15`. The app normalises every
icon into a unit box and draws it at the own weight of the layer. The 15 × 15
grid of Maki and its stroke widths thus never enter into it.

They live in `public/icons/` alongside the licence, arranged the way
`public/presets/` is: real SVG files, replaceable without a rebuild, and
previewed in the picker by an ordinary `<img>`.

Sixteen is the whole picker: one grid, no search, with the own suggestion of the
category first. The bundle was briefly all 1,383 icons of a UI set behind a
search box. That is 5.5 MB of repository for a drawer that nobody opens. A
terrain plot wants a handful of marks. Anything past them is an upload of the
exact glyph that you had in mind rather than a hunt through a catalogue.

**Fill is on by default**, because these are silhouettes. A solid mountain is the
mark that Maki drew, and the hollow outline of one is a wireframe of it. An icon
pick takes the own colour of the layer for the fill and sets it opaque. A summit
that goes solid must go solid in its own colour rather than in the blue that a
lake uses. And the 45% that an area fill starts at is right for a lake seen
through contour lines and wrong for a 25-pixel glyph. Both happen only on the
*first* pick, so neither overrides a choice that you already made. Switch Fill
off and the outline stays, which is what a pen plotter draws. The fill reaches
the viewport and the PNG and video captures. It does **not** reach the SVG, which
is a line-art format.

**Holes are cut.** What the flattener returns for a filled icon is a set of fill
*boundaries*: the outline of the skull, and separately its eye sockets and its
teeth. A blind triangulation thus fills the sockets in, and a solid oval is not a
skull. The app sorts the rings first, by containment rather than by winding. A
ring inside an odd number of other rings is a hole, and it belongs to the
*smallest* ring that contains it. That is what makes a window inside a tower
inside a castle come out right. The app deliberately does not consult the
winding. Winding only says what the `fill-rule` of an SVG means. The files
that get it wrong are exactly the ones where a read of it misleads.

The triangulation itself is `ShapeUtils.triangulateShape` from three.js, which is
earcut with hole bridging. It ships with three.js and is far better tested than
the hand-rolled ear clipper that it replaced. That clipper had no hole support at
all. That was tolerable when the set was stroke art with almost nothing to cut,
and it is not now: eleven of the sixteen marks have something that must stay
open.

**Why a filled map set, when this app draws lines.** The first version of this
feature took the opposite view, and the reasoning is worth a record because it
turned out to be half right. This app draws line segments and exports SVG for a
plotter. A *stroke* set thus flattens straight into polylines and becomes an
ordinary line layer. It inherits the colour, weight, opacity and dash of the
layer, the ghost occlusion, the hidden-line removal and every exporter. It needs
no new render path anywhere. A *filled* glyph, the argument went, arrives as a
hollow outline of itself.

It does arrive as a hollow outline of itself. That is the part that was wrong.
For a map symbol, the outline of the silhouette *is* the line drawing. The fill
boundary of a skull and crossbones is a skull and crossbones. Its eye sockets and
teeth are holes in the fill and come out as their own closed marks. A stroke set
buys a lighter line and pays in vocabulary. The UI set used before this has no
mountain, no volcano, no shelter and no viewpoint. That is precisely the
vocabulary that a terrain plot needs. It has fifteen kinds of arrow instead.
Maki is 215 marks drawn for maps.

The cost is real and bounded. A trace of both sides of every limb roughly doubles
the segments against the same shape drawn as a stroke: `danger` is 111 segments
where a stroke skull was 52. Across the whole set the range is 10 (`star`) to 111
(`danger`), against a per-layer budget of 60,000. A layer thus keeps its icons up
to about 540 features either way.

One consequence is worth knowing: **prefer the solid variants of Maki over its
`-stroked` ones.** `circle` flattens to one ring at 32 segments. `circle-stroked`
draws its ring as a filled band, so the flattener traces *both* edges: two
concentric rings, 64 segments, for a mark that reads as one. Everything in
`public/icons/` is a solid.

**The files are upstream's, byte for byte.** They were briefly repainted to
`fill="none" stroke="currentColor"`, so that the thumbnails of the picker matched
a hollow rendering. With fills on and holes cut, the drawn mark matches the own
artwork of Maki. The thumbnails thus do too, and there is nothing left to edit. The
flattener never cared either way, because it samples geometry, not paint. It does
require that an element paint *something*, which is what makes a `fill="none"`
file with no stroke invisible to it.

### Labels: a point's name and its height

A peak fetched from OpenStreetMap arrives with everything that a label needs: its
`name` tag, and from its `ele` tag the note that the feature list already shows,
"1910m". Switch **Name** or **Height** on and the app draws them on the terrain.

The app draws them as *geometry*, not as an overlay or a sprite. It flattens the
lettering into the same `positions` array that a contour uses. The lettering thus
takes the colour, weight, opacity and dash of the layer. It also takes the ghost
occlusion, the hidden-line removal, and every exporter. In the SVG it arrives as strokes in a
pen layer of its own, `Peaks · labels`. That is what lets the lettering be a
different pen from the marks that it labels.

**A feature with nothing to say is not labelled.** No name means no name line. No
`ele` means no height line. Neither means nothing at all: there is no
"(unnamed)" and no "#12". A plot of twenty-nine summits with nine of them
numbered is worse than one with nine unlabelled summits. The panel prints the
counts ("18 of 29 named"), so the gap reads as data rather than as a bug.

**The font is Space Mono**, the face that the erzberg logo is set in. A plot is
thus labelled in the same voice that the tool speaks in. It is
[SIL OFL 1.1](https://openfontlicense.org), and `public/fonts/` carries the
licence. **Bold** and **Italic** are two switches. Regular is neither, and
bold-italic falls out of both. Each face is a separate file, because a real
italic redraws the letters. A slant of the roman in the geometry is cheaper and
looks like exactly what it is. The app fetches a face only when a layer asks for
it, so a session that letters in one downloads one.

To get outlines out of a font is the whole difficulty. A browser renders text and
does not tell you where the curves went. There is no API that hands back the
outline of a glyph. The trick that the icons use, `getPointAtLength` on a real
element, thus has nothing to bite on. `scripts/build-font.js` thus converts the TTF
ahead of time with `opentype.js`, a devDependency, into
`public/fonts/space-mono-700.json`. That file is 213 glyphs of path data, 68 kB.
It covers ASCII, Latin-1 and the Latin Extended-A letters that Austrian,
Slovene, Czech and Hungarian place names need. Path `d` strings rather than
pre-flattened polylines keep the file a fraction of the size. The own sampler and
simplifier of the app then do the rest at runtime, cached per glyph and then per
string. Those are the ones that the icons go through.

`npm run font path/to/SpaceMono-Bold.ttf` regenerates it. The script refuses a
proportional font, because the layout in `utils/textGeometry.js` is a cursor and
an addition. Space Mono is monospaced, so there is no kerning table and no
per-glyph advance to carry.

**Placement** is in world units on the own plane of the label. **Size** is units
per em. **Offset ↔** and **Offset ↕** move the label across and up that plane.
**Align** sets which edge of the text the point sits under.

**The type is inked apart from the marks that it labels.** Read *Ink*, further
down, which is the same block on both. The plane is the plane of the icon, with
the same *Face camera*, Tilt and Spin. A name that lies flat beside an upright
summit triangle reads as a bug. A second line sits 1.25 em under the
first.

**Fill** draws the type solid with the counters of the letters cut out, through
the same hole-aware triangulation that the icons use. Switch it off and outlined
type stays, which is what the SVG carries either way.

**Text the data does not supply** is a *text layer* instead. It is this same
lettering with the derivation removed: you give it the words and the place, and
it offers the same faces, the same fill and the same plane. A title, a note or a
signature is not a property of a feature, so it is not a label.

### Ink: what a mark is drawn with

An icon and a label each carry a full set of their own: **Colour**, **Stroke**
and **Opacity**, then **Fill** with its own **Fill Colour** and **Fill Op.** The
two sets are independent of each other and of the layer. The panel renders one
component twice, and `layerStyle` resolves `vec:7#icons` and `vec:7#labels`
through the same cascade with a different prefix. The two thus can never drift
apart in behaviour.

Why not use the values of the layer? Because a mark drawn *from* a layer is not
the layer. The `weight` of a point layer is the **diameter** of its dot, 5 for a
peak. Five units of stroke on a 25-unit mountain is a blob. The weight that
draws that mountain well then closes up the counters of nine-point type. Colour
and opacity go the same way: amber summits under grey lettering is an ordinary
thing to want from one layer.

**Stroke** says where that width sits: **Outside**, which is the default, or
**Centred**. A line renderer only knows centred. `LineMaterial` strokes a path in
screen-space pixels and straddles it. There cannot be a geometric fix either. The
width is in CSS pixels. The offset that it needs is a world distance. That
distance changes with the camera and, under perspective, with the own depth of
each mark.
Paint order does it instead. The app draws the line at *twice* the width. It then
draws the fill of the mark over the inner half of that line. The fill takes a
`renderOrder` slot after the lines of this layer and before anything in the next
layer. What
survives is exactly the requested width outside the edge, with the edge itself
where the icon or the letterform put it. It needs a fill to cover with, so the
control appears only with one. A stroke with no shape behind it has no inside to
sit in. A part-transparent fill lands somewhere between the two, which is the
honest answer for a part-transparent fill. The app does not offer Inside. To hide
the outer half needs a stencil mask, and nothing else in this renderer works that
way.

Two things had to be settled before any of that was stable, and they are worth
knowing about. The symptom was a mess rather than an error. The fill of a
mark and its stroke are *exactly* coplanar, and a wide stroke is not really in
that plane at all: `LineMaterial` expands a segment into a screen-space quad
whose depth is interpolated across its width. A fill that writes depth thus
accepts its own stroke on some pixels and rejects it on others. The result is a
patchwork that changes as the camera moves. The fill of a mark thus does not
write depth, and `renderOrder` decides the order. Separately, the mark is a flat
drawing planted on a rough surface, so the terrain genuinely cuts through its
plane. The app cut it in two different places, because the fill carried a
`polygonOffset` toward the camera and the stroke carried none. Both now take the
same bias, and a deeper one than an area fill uses. An area fill is *of* the
surface and hugs it, while a marker stands a whole glyph through the ground that
it is planted in. Lift stops a marker from a half-burial. The bias stops it from
a half-eaten look.

The SVG export ignores all of it and writes the width that the slider says. A
plotter draws one pass along the outline, whichever side of it the screen puts
the ink on. A double pen is a lie about the drawing.

Everything but the stroke width starts as `null`, which means "the own value of
the layer". A mark thus matches its layer until you tell it otherwise, and
**Match layer** puts it back. The width is a real number from the start.
Inheritance of the diameter of a dot is the one thing that it must not do. The
**fill** of a mark falls back through the *own* stroke colour of that mark before
it reaches the colour of the layer. A colour on an icon thus colours the whole
icon, and a part of its fill from its outline stays possible and stays
deliberate.

This replaced a pair of hacks worth a name, because the shape of the bug that
they papered over recurs. An icon pick used to *write into the layer*. It thinned
the weight of the layer to 1.5 and claimed its `fillColor` and `fillOpacity`. The
glyph had no ink of its own. The ink of the layer was the diameter of a dot and
the lake blue of an area fill. Both hacks are gone. An icon pick now changes
the icon.

Text is not cheap. "Polster" is 266 segments and its height another 222. A layer
whose labels cost more than 80,000 segments thus draws none of them and says so.
It does not label an arbitrary half of a valley.

**Flattening.** `utils/svgFlatten.js` contains no path parser. Every drawable SVG
element is an `SVGGeometryElement`, so `getTotalLength()` and
`getPointAtLength()` handle `<path>`, `<circle>`, `<rect>`, `<ellipse>`,
`<line>`, `<polyline>` and `<polygon>` alike. Arcs and béziers come out exact,
and `getCTM()` folds in whatever nesting and `transform` an uploaded file
carries. The samples then go through the same `simplifyFlat` that the draping
uses, so straight runs collapse back to their endpoints. A Maki icon lands at
10–111 segments once flattened.

Two things are not obvious:

- **Subpaths must be split, and not by a parse.** `getPointAtLength` walks a
  multi-subpath `<path>` as one continuous parameterisation, and a move between
  subpaths has no length. A walk from end to end thus draws a segment from where
  one subpath stopped to where the next began. A split of the `d` attribute is
  the obvious fix and is wrong: a subpath that starts with a relative `m` is
  relative to the end of the previous subpath. Detection of the spatial
  discontinuity needs no parse and cannot be fooled, because a genuine segment
  sampled at step `s` never advances more than `s`.
- **These APIs answer only inside a rendered document.** That is why the app
  builds icon geometry on the main thread rather than in the geometry worker.
  That turns out to be where it belongs anyway. Size, lift and orientation become
  render-side like colour and weight, so a drag of them is a frame rather than a
  rebuild. It is also what lets the icons follow the camera at all.

**Orientation.** The basis of the icon plane comes from an azimuth θ and an
elevation φ:

$$R = (\cos θ,\; 0,\; -\sin θ) \qquad
  U = (-\cos φ \sin θ,\; \sin φ,\; -\cos φ \cos θ)$$

With **Face camera** on, θ and φ *are* the own angles of the camera. `Scene`
places the camera with `setFromSphericalCoords(dist, phi, theta)` from `tilt` and
`rotation`, so those two values make the plane perpendicular to the view. At
φ = 90° the icon stands upright and faces the camera. At φ = 0° it lies flat on
the ground with its top away from you, which is how a symbol on a map reads from
above. Switch the toggle off and the two angles appear as sliders. **Match view**
copies the angles of the camera onto them, which gives the same drawing, now
pinned for a frame that you are composing. Billboarding costs nothing extra. Both
values already live in React state, synced from OrbitControls on the existing
throttled 150 ms tick.

**Lift** raises the icon off its point and draws a leader line down to it. That
is what stops a summit marker from a half-burial in the slope behind it.

Picking and highlighting survive the substitution. The icon layer carries a
rebuilt `featureOfSegment`. It maps every segment of a glyph to the feature that
its dot stood for. The layer also keeps the wider pick radius of a point. The geometry
record itself is `isPoints: false`, which is what makes the SVG exporter write
strokes rather than one circle per feature.

Past `MAX_ICON_SEGMENTS` a layer keeps its dots and says so in its row. It does
not draw a fraction of its icons, which looks like missing data.

### What a preset carries

A preset is a look, not a data set. `vectorStyles` holds the style of each layer
keyed by its `bucket`. The palette of last week thus lands on a fresh fetch of
the same valley today. Three things are deliberately left out, each for the same
reason: they are data, not look.

`hidden` holds feature *indices*, which mean nothing against a different fetch.

`iconCustom` holds the flattened geometry of an uploaded SVG, whose polylines are
typed arrays. `JSON` writes those as `{"0":…}` objects with no `length`, so a
preset that carried one came back with a glyph that drew nothing. And because
`icon` still said `custom`, the layer drew nothing at all. The app drops it, and
`icon` falls back with it.

The third is the stack order, which the app carries but only where it is meant.
It writes `vectorStyles` top-of-stack first, and the payload says so with
`vectorStackOrder: true`. Before the stack existed, the app wrote the same array
in *paint* order, ground cover first, and the two are indistinguishable by
inspection. A preset without the flag thus has its styles applied and its
arrangement ignored, rather than a read backwards into landuse drawn over roads.

### When the features do not appear

Different failures all end as "points dropped for being out of bounds", and they
need different fixes. The panel thus reports them separately:

| Report | Cause |
|---|---|
| *…is not one this tool can place WGS84 features in* | Untransformable CRS. Reproject the raster. |
| *This GeoTIFF carries no georeferencing* | No tie point, pixel scale or transformation in the file. |
| *…its extent cannot be turned into an OpenStreetMap query* | Forward-only CRS. Uploads still work. |
| *None of the N loaded vertices fall inside this GeoTIFF* | The projection worked. The features are somewhere else. |
| *N of M vertices fall inside* | Partial overlap. The rest are clipped. This is not an error. |

A GPX point needs its `lat` and `lon` attributes to be *present*, not merely
numeric. `getAttribute` returns null for a missing one, and `+null` is 0. A
numeric test alone thus accepted a malformed `<trkpt>` as a point at (0, 0). That
is not a sentinel but a real place in the Gulf of Guinea. Such a point
counted in the total of the coverage report and never in its inside count. A
track that landed perfectly on the raster thus reported back as only *partially*
covered, and blamed a raster that was fine. An `<ele>` of exactly 0 m is likewise
kept rather than read as absent: sea level is data. Track segments are kept
apart. A `<trkseg>` boundary is a pause in the recording, and a join of two of
them draws a line through whatever lies between.

The old spec has a top-level `crs` member. If a GeoJSON carries one that names
anything other than WGS84, the app refuses the file. It gives the `ogr2ogr`
command that fixes it, and does not draw the file in the wrong place.

### Exports

| Export | Vector layers |
|---|---|
| SVG | Yes — one Inkscape layer per vector layer, named, so a plot is separable by pen. Icons export as strokes, in their own `· icons` pen layer. Area *fills* are omitted: correct output needs painter-order depth sorting of thousands of triangles against the software Z-buffer, and this is a line-art format. The outline of every filled area is still there. |
| PNG / PNG α / WebM | Yes — they capture the rendered scene. |
| STL | Only for layers with **STL ribbon** on, written as `<base>-vectors.stl`. The default is on for GPX layers and off for OSM and GeoJSON. |
| Heightmap PNG | No. It writes the elevation raster, not a picture. |

---

## Vertical exaggeration

On load, a GeoTIFF gets a suggested `elevScale`, so the terrain starts at roughly
true proportions instead of an arbitrary height. The mesh lays one grid step per
pixel *column* and spans `100 × elevScale` world units vertically. The figure
that has to be right is thus the **east–west ground size of one pixel**:

$$\text{elevScale} = \frac{\text{elevation range}}{100 \cdot \text{ground pixel width}}$$

clamped to 0.1 … 50.

A projected CRS already reports pixel size in linear units.
`ProjLinearUnitsGeoKey` converts them to metres, and the app handles the
international foot and the US survey foot. A geographic CRS reports **degrees**,
and a conversion of those needs the latitude. A degree of longitude is 111 320 m
at the equator and only about 75 km at 47°N.

This is why a reprojection is safe. Measured on a 10 m UTM raster against
`gdalwarp -t_srs EPSG:4326` of itself, with the same terrain and the same
elevation range:

| | CRS | columns | elevScale | relief |
|---|---|---|---|---|
| original | EPSG:32633 | 1200 | 1.71 | 1.4250 |
| reprojected | EPSG:4326 | 1297 | 1.84 | 1.4187 |

Relief is `elevScale / columns`. The two agree to 0.4%.

The classification is by **CRS, never by magnitude**. Sub-metre lidar is legitimately below 1
in metres. A test of "a value below 1 must be degrees" mis-scales it by about
111320 times and flattens it to the clamp floor.

---

## NoData

Voids are common in real elevation data: clipped catchments, SRTM holes, and the
border that a rotated footprint leaves after a reprojection. A GeoTIFF declares
its void value in `GDAL_NODATA`, and the app reads that value from the file
rather than a guess at it. A small sentinel set is a fallback for rasters that
declare nothing: −9999, −32767, −32768 and the *positive* float maximum.

That set is deliberately not a substitute for a read of the tag. It does not
contain the **negative** float maximum, which is exactly what GDAL writes into
float DEMs (`-3.4028235e+38`). A raster whose declared value went unread thus had
its voids treated as real ground 3.4e38 metres down. Masked pixels set the
minimum and maximum that normalise the heightmap. A single unmasked void thus
drags the floor down and collapses the whole terrain into a plateau.

The app also excludes masked pixels from the rendered surface, the auto-zoom
framing, and the STL base plate.

---

## Implementation

| File | Role |
|---|---|
| `src/utils/geoCoords.js` | `classifyCRS`, forward and inverse projection, `bboxToWgs84`, `geoToPixel` / `geoToWorld`, `featureCoverage`, `suggestElevScale` |
| `src/hooks/useHeightmap.js` | GeoTIFF decode, geokey reading, NoData, CRS detection |
| `src/utils/vectorLayers.js` | The packed source and layer-record model shared by all three sources |
| `src/utils/gpxParser.js` | GPX → segments → a vector source |
| `src/utils/geoJsonParser.js` | GeoJSON → a vector source |
| `src/utils/osmCategories.js` | The OSM catalogue: selectors, buckets, default styles |
| `src/utils/osmFetch.js` | Overpass query, fetch, cache, bucketing |
| `src/utils/vectorGeometry.js` | Draping, simplification, densification, area fills, `featureOfSegment` |
| `src/components/VectorPicker.jsx` | Pointing at the terrain to identify a feature |
| `src/components/VectorHighlight.jsx` | Lighting up the hovered or selected feature |
| `src/utils/svgFlatten.js` | SVG → polylines, through the own geometry API of the browser |
| `src/utils/textGeometry.js` | Label text → polylines: outline faces sampled, stroke faces read straight |
| `scripts/build-single-line-fonts.js` | The 49 single-line faces, flattened from oskay/svg-fonts, Relief SingleLine, ISO 3098 and three plotter ROM faces |
| `src/utils/iconCatalogue.js` | The bundled set in `public/icons/`, and its flattened cache |
| `src/hooks/useVectorIcons.js` | Placing, sizing, lifting and orienting the icons |
| `src/utils/stlExport.js` | Ribbon solids for layers that ask for one |
| `tests/projection.spec.js` | CRS classification, projection maths, round-trips, coverage, load path |
| `tests/vector.spec.js` | Fetch → layers, hide and remove, fills, uploads, SVG export |
| `tests/osm-detail.spec.js` | Detail tiers by extent, and the pre-flight count that refuses a province by name |

### A note on geotiff.js

`image.fileDirectory` is a **lazy object**. Its own enumerable keys are
bookkeeping, and tags are reachable only through `hasTag()` and `getValue()`. A
read of a tag as a plain property returns `undefined` and throws nothing. Every
unit test thus passes while a georeferenced file reads as unreferenced and a
declared NoData value reads as absent. All tag access goes through one accessor
that handles both that shape and the older plain-object one.

### Adding a CRS

Add the code to the relevant table in `classifyCRS`: `GEOGRAPHIC_EXACT`,
`GEOGRAPHIC_APPROX`, `MERCATOR`, or a `UTM_FAMILIES` block. The renderer, the STL
exporter and the sidebar readout then pick it up together, because all three ask
the same classifier. A projection that needs new maths also needs a branch in
`projectWgs84`. Give that branch an honest `accuracy` if its datum shift is not
implemented. Add the matching branch to `unprojectWgs84` too, or the raster
drapes uploads correctly and still refuses the OpenStreetMap query.
