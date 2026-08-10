# Georeferencing

A PNG heightmap is just a grid of numbers. A GeoTIFF also says *where on Earth*
that grid sits and in which coordinate system, and `erzberg` uses that for three
things: laying a GPX track on the terrain, suggesting a vertical exaggeration
that is proportional rather than arbitrary, and reporting the elevation range in
real metres.

All three depend on reading the file's metadata correctly, and the failure mode
when that goes wrong is silence — a track that does not appear, a mountain that
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

## GPX tracks

With a georeferenced GeoTIFF loaded, the **GPX Track** section takes a `.gpx`
file. Track points (`<trk><trkseg><trkpt>`) are used first; route points
(`<rte><rtept>`) are a fallback. Waypoints are not collected — they are
unordered, and a track is what the overlay draws.

Each point is projected into the raster's CRS, converted to fractional pixel
coordinates, and lifted onto the terrain by bilinear elevation sampling. Points
outside the extent are dropped, which correctly produces gaps for a clipped
track. The result is an ordinary line layer: it inherits every line style,
hypsometric tint, and exporter, and it appears in STL export as a separate
ribbon solid for multicolour printing.

### When the track does not appear

Three different failures all end as "points dropped for being out of bounds",
and they need different fixes, so they are reported separately:

| Report | Cause |
|---|---|
| *…is not one this tool can project GPX into* | Untransformable CRS. Reproject the raster. |
| *This GeoTIFF carries no georeferencing* | No tie point / pixel scale / transformation in the file. |
| *None of the N track points fall inside this GeoTIFF* | The projection worked. The track is simply somewhere else. |
| *N of M track points fall inside* | Partial overlap; the rest are clipped. Not an error. |

GPX parse failures and files holding only waypoints are reported in the panel
too, rather than going to the console.

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
| `src/utils/geoCoords.js` | `classifyCRS`, forward projection, `geoToPixel` / `geoToWorld`, `trackCoverage`, `suggestElevScale` |
| `src/hooks/useHeightmap.js` | GeoTIFF decode, geokey reading, NoData, CRS detection |
| `src/utils/gpxParser.js` | GPX → `{ lat, lon, ele }[]` |
| `src/utils/geometryBuilders.js` | `buildGpxGeometry` — the track as a line layer |
| `src/utils/stlExport.js` | GPX ribbon solid |
| `tests/projection.spec.js` | CRS classification, projection maths, coverage, load path |

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
shift is unimplemented.
