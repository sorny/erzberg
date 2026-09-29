# Masks and satellite imagery

A cover plate says what the ground *is*, for the whole window. A **mask** is a
region you choose: the far side of the ridge, or everything except one quarry.
Both go through the same stencil.

---

## The two stencils

| | Cover classes | Masks |
|---|---|---|
| Source | AlphaEarth, cut offline | Drawn, imported, or made from heights or features |
| Shape | **Partition**: each pixel in one class | **Overlap**: a pixel can be in several |
| Stored as | One `Uint8Array` of indices | One bit plane per mask |
| Two selected | Either class | Union of both regions |
| All selected | The unfiltered raster | A particular shape |

So `toggleClass` collapses to "no filter" when every class is ticked, and
`toggleMaskSelection` does not. Both collapse when the last one is unticked.

A layer can carry both. A cell must pass both to be drawn.

---

## Satellite imagery

A mask drawn over hillshade is a guess. Forest against bare rock shows in a
photograph, not in relief. The Studio's backdrop is Sentinel-2.

### Source

| Source | Resolution | Verdict |
|---|---|---|
| **Sentinel-2 L2A, AWS Open Data** | 10 m | **Chosen**: free, full and open, commercial use included |
| EOX s2cloudless | 10 m | CC BY-NC-SA would bind every exported plate |
| Esri World Imagery | sub-metre | Terms do not clearly cover a printed plate |
| NASA GIBS | 250 m | Open, but 16 px across a 4 km window |

`sentinel-cogs.s3.us-west-2.amazonaws.com` sends
`Access-Control-Allow-Origin: *`, so this is a button. AlphaEarth's bucket
sends no CORS header, so land cover needs a script.

The app reads the scene's `visual` asset (`TCI.tif`): a three-band 8-bit COG,
10 m, 1024 px blocks. A window costs a few hundred kB of a 316 MB scene.

### Scene selection

- **Readable only.** Some catalogue items point at `s3://…/TCI.jp2`, which a
  browser cannot fetch or decode. One such scene over Graz had 0% cloud and
  always sorted first. A scene is kept only if its `visual` asset is HTTPS and a
  TIFF. An asset with no stated type is kept.
- **Season, then cloud.** The clearest Erzberg scene is under snow. The default
  search takes the growing season of the last three years (May–September north,
  November–March south, from the extent latitude) and sorts that by cloud. If
  nothing is in season, it uses the full list.

### Exposure

The `visual` asset has one fixed gain for the whole planet, so ordinary ground
is dark. Over Graz on 2023-09-09:

| channel | p2 | median | p98 |
|---|---|---|---|
| R | 12 | 24 | 130 |
| G | 20 | 43 | 121 |
| B | 13 | 26 | 89 |

A 2–98% stretch alone leaves the median near 0.10. **Auto levels** adds a gamma
solved per scene so the stretched median lands at mid-grey:

    median^gamma = 0.45   ⇒   gamma = ln(0.45) / ln(median)

Graz solves to 0.556, and a well-exposed scene solves near 1.

Channels are stretched halfway between shared and per-channel ends. Full
per-channel stretch turns shadows slate, and none leaves a green cast.

`utils/imageryTone.js` holds the pipeline once: `applyTone` for the Studio's 2D
canvas and `TONE_GLSL` for the surface shader, so both show the same pixels.
Opacity, Brightness, Contrast and Saturation apply after it. With Auto levels
off, you see the raw product.

### Draping

The surface shader paints the drape, so `showImagery` appears in both gates:
`hasFillLayer` (draw the surface) and `needsSurfaceShading` (build UVs).
`imageryOpacity` is a uniform only. `showImagery` reaches the worker.

---

## The Studio

**+ Draw a mask**, or **Edit** on a mask, opens the Studio over the viewport.
Its panel replaces the sidebar.

| Tool | Key | |
|---|---|---|
| Brush | `B` | `[` and `]` resize |
| Rectangle | `R` | |
| Ellipse | `O` | Shift for a circle |
| Lasso | `L` | |
| Level | `H` | the ground between two heights |
| Features | `F` | loaded map features |
| Erase | `E` | toggles paint/erase |
| Undo, redo | `⌘Z`, `⇧⌘Z` | the last ten changes |
| Close | `Esc` | |

| Gesture | |
|---|---|
| Scroll | Zoom about the cursor |
| Alt-drag, middle-drag | Pan |
| **Fit** | Back to the opening frame |

**Backdrop.** *Show* picks Auto, Sat, Relief or Height. Auto takes the imagery
if you fetched some, else the relief. Edit Mode shares the same builder
(`utils/rasterBackdrop.js`, capped at 2048 px) and the same choice.

- The Studio shares its frame, primitives and gestures with Edit Mode. Alt pans
  in both. `MaskPanel` is a sibling of `EditPanel`, not a generalisation.
- Both views share the tool glyphs, one-letter tool keys (Edit Mode: `C` `O`
  `L` `P` `F`), a Features tool with a live preview, a panel that shows only
  the active tool's controls, undo, and the Backdrop block
  (`panel/BackdropBlock.jsx`) with its exposure controls.
- Both own the keyboard while open: the app's shortcuts, `E` and `1`–`5`
  included, do nothing.
- It stays separate from Edit Mode: a clip changes the raster for everything, a
  mask changes one layer.
- The brush is hard-edged, because a mask is one bit per pixel.
- A drag stamps every half brush radius, so fast strokes do not dot.
- The mask wash is one cached canvas. A brush stroke repaints only its bounding
  box. Redraws are batched to one per frame, and the brush ring is a DOM circle,
  so a hover costs no canvas work.
- **Undo is the Studio's own.** The app history holds no mask planes. The
  Studio copies the plane before each stroke, shape, apply or whole-mask
  action, and keeps the last ten. While it is open, the app's `⌘Z` steps aside.

### Level and Features

These two tools compute a region instead of painting one. While their controls
move, the wash shows the mask as **Apply to mask** will leave it. *Combine* sets how the
region meets the mask:

| Combine | Result |
|---|---|
| Replace | The region |
| Add | Mask or region |
| Subtract | Mask and not region |
| Intersect | Mask and region |

On Replace, a mask with its default name ("Mask 3") takes the region's name.
**Done** and `Esc` apply a preview that differs from the mask, because the wash
shows it as the mask. Switching to another tool drops it.

**Level.** *From* and *To* are fractions of the raster's range, shown in metres
when the GeoTIFF gives the range. NoData is never inside. *Smooth* blurs the
heights before the cut (NoData-aware), so the edge follows the landform and not
the sensor noise. The blur runs once per Smooth value, so a drag of From or To
is one pass over the raster (`levelSource`, `thresholdLevel`).

---

**Features.** The rules follow below. The preview waits 120 ms after the last
change, because a rasteriser is slower than a threshold.

---

## A mask from features

In the Studio's Features tool, pick a loaded OSM or GeoJSON layer, set a
distance, and press **Apply to mask**.

| Layer | The number is | |
|---|---|---|
| Area, or a closed line | **Buffer** | Grows the region. Negative shrinks it |
| Line | **Half-width** | Corridor reach to each side |
| Point | **Radius** | One disc per point |

**Boundaries are areas.** Admin boundaries are `geom: 'line'`, because they draw
as lines. The mask asks the geometry whether it closes, and fills it if so. A
**Fill the enclosed area** switch appears for closing layers. Turn it off for a
corridor along the border. The check scans at most 64 features.

**Rings are stitched.** Overpass returns a relation as member ways, and Graz's
Jakomini district arrives as seven open segments. `stitchRings` joins segments
that share an endpoint:

- In lon/lat, before projection, where shared nodes match exactly.
- Two-point segments are kept.
- Areas are stitched too.

**Picking features.** The picker lists the layer's features, ticked, sorted and
filterable, with **all** and **none**. The layer's hidden list seeds the pick,
but after that they are independent. A mask of one feature takes its name.

- **Holes are cut.** A feature's rings are filled together under even-odd, not
  one by one, and not by winding.
- **The buffer is exact.** `growMask` uses a Euclidean distance transform
  (Felzenszwalb–Huttenlocher), linear in pixels.
- **Metres come from the raster extent.** A geographic raster's degrees are
  converted.

---

## Copying, importing, storage

- **⧉** duplicates a mask under its source. Pixels are copied, not shared. The
  copy takes the next colour and a unique name (`uniqueMaskName`). It does not
  open the Studio.
- **↑ Import…** takes a PNG, JPG or WebP. Alpha counts first, then luminance
  above the midpoint is inside. The image is resampled nearest-neighbour.
- Masks live on the **source** raster. `derive()` crops them with the pixels, so
  an Edit Mode clip can change at any time.

---

## How it reaches the draw modes

`maskedTerrain` in `builders/shared.js` folds both stencils into the layer's
`gridMask`:

```js
for (let i = 0; i < src.length; i++) {
  if (!src[i]) continue
  if (byClass && !maskHasClass(classMask, cls[i])) continue
  if (byPaint && !painted[i]) continue
  out[i] = 1
}
```

Every builder already gates on `gridMask`, so no draw mode changed. The union of
a layer's masks is memoised per build. A single mask passes through with no
allocation.

A layer's mask selection is one bit per mask in a signed 32-bit integer, the
same as cover classes. It travels as one number through the parameter bus,
presets, history and the rebuild key. The limit is 32 masks.

---

## Licence

Copernicus Sentinel data is free, full and open. The credit goes into any export
that draws from it:

> Imagery: Contains modified Copernicus Sentinel data, processed by ESA

---

## Files

| File | Role |
|---|---|
| `src/utils/maskLayers.js` | Bit planes: create, stamp, stroke, combine, import, 32-bit selection |
| `src/utils/maskFromLevel.js` | `levelSource`, `thresholdLevel`, `maskFromLevel` |
| `src/utils/maskFromVector.js` | `stitchRings`, `maskFromFeatures`, `featureRings`, `growMask` |
| `src/utils/imageryTone.js` | Exposure: `applyTone` and `TONE_GLSL` |
| `src/utils/imageryFetch.js` | Scene search and windowed COG read |
| `src/components/MaskStudio.jsx` | Painting view |
| `src/components/MaskPanel.jsx` | Its panel |
| `src/components/panel/FeaturePicker.jsx` | `useFeaturePick`, shared with Edit Mode |
| `tests/masks.spec.js`, `tests/mask-from-features.spec.js` | End-to-end |
| `tests/unit/maskFromVector.test.js`, `tests/unit/maskFromLevel.test.js`, `tests/unit/imageryTone.test.js` | Unit |
