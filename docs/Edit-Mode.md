# Edit Mode

Edit Mode clips the loaded raster before the raster becomes terrain. You can
clip with a crop rectangle, a free-hand lasso, a polygon or an ellipse.

Edit Mode applies to every source: PNG, GeoTIFF and Soundscapes. All three write
the same store slot. Edit Mode is also non-destructive. The app keeps the raster
as loaded, so you can change the clip or remove it at any time.

To open Edit Mode, press `E`. You can also use the ✂ button under the loader.

---

## Source and derived

The store holds the raster twice.

```
  loader ──> srcPixels / srcMask / srcWidth / srcHeight     (exactly as loaded)
                        │
                        ├── edit === null ──> the same arrays, untouched
                        │
                        └── applyEdit() ──> heightmapPixels / nodataMask
                                            heightmapWidth / heightmapHeight
                                            geoTiffBbox
                                                    │
                                                    └──> useTerrainGeometry ──> worker
```

Everything downstream reads only the derived names and knows nothing about a
clip. This is true of the geometry worker, every draw mode, hillshade, erosion,
the exporters and the elevation profile. With no clip, the derived fields *are*
the source arrays. Thus the feature costs nothing until a selection exists.

The app keeps the source, and that makes three things work:

- You can open Edit Mode again. It shows the full raster with the selection
  still live.
- **Clear** restores the whole heightmap. It needs no reload.
- A **streaming Soundscape** keeps its clip. Each pushed frame is a new
  *source*, and the app clips it again on the way through.

An `edit` uses source pixel coordinates and nothing else. Thus it does not
depend on the zoom, the window size or the device pixel ratio:

```js
{ rect: {x, y, w, h}, shape: Shape | null, feather: px }

// a Shape is a ring of points, or an ellipse:
{ type: 'lasso'|'polygon', points: [x0,y0,x1,y1,…] }
{ type: 'ellipse', cx, cy, rx, ry }
```

### When the app drops the clip

`setHeightmap` clears the edit whenever the source changes. A rectangle in the
coordinates of the old raster means nothing in a new raster.

There is one exception: `opts.keepEdit` at *unchanged dimensions*. Only
`pushFrame` in `useSoundscape` passes it. Consecutive windows are the same
picture at the same size.

A freeze of a whole track changes the dimensions. A change of the window width
does the same. Both drop the clip through the same rule. Thus the store needs no
knowledge of soundscapes to get this right.

---

## The centring comes for free

`buildTerrain` already takes the origin of the mesh from the bounding box of the
*valid* cells. It does not take the origin from the dimensions of the raster:

$$\text{halfW} = \frac{(c_{\min} + c_{\max}) \cdot \text{scl}}{2}, \qquad
  \text{halfH} = \frac{(r_{\min} + r_{\max}) \cdot \text{scl}}{2}$$

$c_{\min} \ldots r_{\max}$ span the cells whose mask value is 1. A selection
that becomes a NoData mask is thus centred by code that already exists. Every
draw mode also skips masked cells already. This is the same machinery that the
voids of a GeoTIFF have always used.

The names of those two values invite the wrong reading, so note what they are.
They are the **midpoint** of the valid range. They are an offset that puts the
centre of that range at the origin, through
$x = c \cdot \text{scl} - \text{halfW}$. They are not half-extents.

On the full grid you cannot see the difference. $c_{\min} + c_{\max}$ and
$c_{\max} - c_{\min}$ both come to $\text{cols} - 1$. This is exactly why only a
crop can expose code that confuses the two.

`buildTerrain` also returns the true half-extents as `spanHalfW` and
`spanHalfH`:

$$\text{spanHalfW} = \frac{(c_{\max} - c_{\min}) \cdot \text{scl}}{2}, \qquad
  \text{spanHalfH} = \frac{(r_{\max} - r_{\min}) \cdot \text{scl}}{2}$$

Anything that wants a *size* wants these two values. A radius wants them. A
containment bound wants them. The murmuration read `halfW` as a size, and on an
off-centre crop the flock flew off the data. See
[Murmurations.md § Two scales](Murmurations.md).

A skip of the masked cells is not the whole story. The raster stores $0$ in a
masked cell, and $0$ is the *darkest* ground rather than absent ground. Thus
anything that read a masked cell without intent pulled the terrain toward the
bottom of the scene. It then drew the border of the selection and not the
landscape. Three things read such a cell:

- A bilinear tap across the edge.
- A blur window over the edge.
- A finite-difference stencil that reaches into the hole.

The builders themselves correct this. See
[Draw-Modes.md § NoData and clipped edges](Draw-Modes.md#nodata-and-clipped-edges).

The app also **crops the output raster to the bounding box of the selection**.
That box is the crop rectangle, narrowed to the extent of the shape. Thus the
geometry grid shrinks with the selection and does not carry a mostly empty
raster. A clip to a quarter of the image gives a quarter of the cells, and the
rebuilds get faster in proportion.

After you press Apply, the view refits exactly as it does for a fresh load, with
`autoZoom` and `autoResolution`. A crop is a different picture.

---

## How a selection becomes a mask

### Rings

A lasso and a polygon differ only in how the app collects their vertices. Both
end as a closed ring, filled with the even-odd rule. For each row, the app
intersects the edges of the ring with the centre line of that row,
$y_c = y + \tfrac{1}{2}$:

$$x = x_i + \frac{y_c - y_i}{y_j - y_i}\,(x_j - x_i) \quad \text{for every edge across } y_c$$

The app sorts the crossings and fills them in pairs. It samples at the *centre*
of a pixel and not at a corner. Thus a rectangle drawn by hand gains no fringe
of half a pixel. The fill in pairs also handles a concave shape or a horseshoe
shape, which give four or more crossings on one row. It needs no special case
for them.

A lasso emits one vertex per pointer move. While you draw, the app thins these
to about one vertex per 3 screen pixels. When you release the stroke, it runs
Douglas–Peucker over them at about 1.5 screen pixels. `simplifyFlat` does this
work, and the contour smoother shares it.

You cannot see the decimation on screen. It usually cuts the vertex count by 5
to 10 times, and that matters twice over. The scanline fill has fewer edges to
cross. What comes back also has few enough vertices to edit by hand.

### Ellipses

The app stores an ellipse as an ellipse, `{cx, cy, rx, ry}`. It does not store a
ring of sampled points. A 128-gon shows flats that you can see once the raster
is a few thousand pixels wide. The implicit form is exact and also cheaper:

$$\left(\frac{x - c_x}{r_x}\right)^2 + \left(\frac{y - c_y}{r_y}\right)^2 \le 1$$

A solve of that inequality for $x$ gives the filled span of each row directly.
Thus the fill touches only the pixels that it sets. It does not test the
$4/\pi$ of the bounding box that it leaves empty.

The voids of the raster go into the same mask. A GeoTIFF NoData value makes such
a void, and so does a transparent PNG pixel. Thus the edge of a void feathers
like any other edge.

---

## Feather as an elevation ramp

The mask of the geometry pipeline is binary. A cell is ground, or it is not.
Thus a partial selection weight has nowhere to live in the mask. The feather
acts on the *value* instead:

$$d = \text{distance to the nearest unselected cell}, \qquad
  t = \min\!\left(1, \frac{d}{f}\right), \qquad
  w = t^2(3 - 2t)$$

$$v' = v_{\text{floor}} + (v - v_{\text{floor}})\, w$$

$v_{\text{floor}}$ is the lowest value inside the selection. The clipped edge
melts down to the base level of the terrain and does not end in a cliff. This is
what a feathered cut must look like. It also keeps a clipped STL flat on its
base.

$d$ comes from a chamfer distance transform in two passes. A straight step costs
1 and a diagonal step costs $\sqrt{2}$. Everything past the edge of the crop
counts as unselected, so a plain crop feathers against its own border. The error
of the approximation is well under one pixel, which you cannot see in a gradient
of a few pixels or more. At `feather: 0` the app skips the transform.

### Caching

`buildEditMask` returns the rasterized ring, the distance field and the derived
weights. It depends only on the *shape* of the edit and on the dimensions of the
raster. It never depends on the pixel values.

The store memoises the result. Thus a Soundscape that streams 30 new rasters a
second under one unchanged selection pays only the per-pixel copy.

---

## Georeferencing

A crop moves the corners of the raster, and `geoToPixel` reads the bounding box
as the extent of the *whole* raster. Thus the derived bbox is the source bbox,
interpolated linearly over the crop rectangle. North is up, which matches the
mapping that `geoToPixel` already assumes:

$$x'_{\min} = x_{\min} + \frac{r_x}{W}\,\Delta x, \qquad
  y'_{\max} = y_{\max} - \frac{r_y}{H}\,\Delta y$$

Without this step, the app projects vector layers against an extent that no
longer exists. They then land in the wrong part of the terrain. They also do it
in silence, because the app drops a point outside the raster as ordinary
clipping.

A crop does **not** renormalise the pixel values. The app normalised them
against the own minimum and maximum of the file at load time. Thus the elevation
readout, the elevation cuts and the vertical scale of the STL all stay true to
the file. They do not drift with each selection.

---

## Erosion under a clip

Hydraulic erosion runs on what is on screen, which is the derived and clipped
raster. The app then scatters the result back into the source, at the position
of the clip. Thus the clip stays live and you can still edit it afterwards.

The app skips the cells inside the feather ramp. Thus it does not bake the ramp
into the source and ramp it again on the next run.

---

## Interaction notes

- **Crop.** Drag to draw a rectangle. Drag inside it to move it. Use the eight
  handles to resize it. The aspect locks are Free, 1:1, 4:3, 16:9 and source.
  There are also numeric fields for X, Y, W and H. While the rectangle still
  covers the whole raster, a drag inside it draws a new rectangle. There is no
  outside to start from, and a move can go nowhere. Hold Shift to force a new
  rectangle at any size.
- **Ellipse.** Drag out its bounding box. Hold **Shift** for a circle. Shift
  works while you draw and also while you resize, because the app reads the
  modifier on every pointer move. It does not latch the modifier at the start of
  the drag. Drag inside the ellipse to move it. The eight handles of the crop
  work here too.
- **Polygon.** Click to place each vertex. To close the ring, click the first
  vertex, press `Enter`, or double-click. Press `Backspace` to remove the last
  vertex.
- **Editing a committed ring.** A lasso or a polygon stays editable after you
  close it. Thus you need not redraw a selection that came out nearly right.
  Drag a vertex to move it. Drag an *edge* to split it and pull the new vertex
  out in one gesture. Right-click a vertex to remove it. The ring keeps at least
  the three vertices that still enclose an area. The app draws the vertex
  handles whenever a ring exists and a ring tool is active. The crop tool and
  the ellipse tool have their own handles in the same places, so they take the
  pointer instead.
- **The cursor names the grab.** A handle is 7 to 8 screen pixels on a busy
  greyscale raster, which is not much to aim at. Thus the pointer says what a
  press will do before you commit to it. It shows `grab` over a ring vertex, and
  `grabbing` while that vertex moves. It shows `copy` over an edge, where a
  press *adds* a vertex. It shows a directional `↖↘`, `↕` or `↔` resize over
  each of the eight box grips. It shows `move` inside a selection that you can
  move, and `pointer` over the vertex that will close a polygon. It shows
  `crosshair` everywhere that a press starts something new.

  This is one hit test and not two. `pick()` returns the gesture that a press
  will start. Both `onPointerDown` and the cursor read that one answer. Two
  copies of the decision tree drift apart. A cursor that promises a grab where
  the press draws a new shape is worse than no cursor at all.

  The app writes the cursor straight to `canvas.style`, because a hover must not
  re-render the panel. It leaves the cursor alone during a gesture. Pointer
  capture lets the pointer wander off the handle that it grabbed, and a new pick
  under it makes the cursor flicker.
- **View.** Scroll to zoom about the cursor. Alt-drag or middle-drag to pan.
  Press `Fit` to reset. While you hold alt, the cursor shows `grab`, because a
  press does that whatever lies underneath.
- **Keys.** `Esc` cancels a half-drawn shape. With no shape in progress, `Esc`
  leaves Edit Mode and commits nothing. `Enter` closes a shape. With no shape in
  progress, `Enter` applies the edit.

The app downscales the preview bitmap so that its long side is 2048 px at most.
An 8k DEM held as full-resolution RGBA is 256 MB, for a picture that no screen
can resolve.

The app draws a drag imperatively from a ref. It commits to React state only on
release. A lasso emits one point per pointer move, and a re-render of the panel
60 times a second shows a half-finished path that nobody sees.

---

## Files

| File | Role |
|---|---|
| `src/utils/heightmapEdit.js` | Pure maths: bounds, scanline fill, distance-transform feather, `applyEdit`, `cropBbox` |
| `src/store/useStore.js` | Source and derived split, mask memo, `setEdit`, the `keepEdit` rule, erosion scatter-back |
| `src/components/HeightmapEditor.jsx` | The 2D canvas: preview, overlays, pointer tools |
| `src/components/EditPanel.jsx` | The right-hand panel during an edit |
| `tests/edit.spec.js` | End-to-end clip, clear, cancel, lasso, polygon, ellipse, ring editing, soundscape and GeoTIFF coverage |
