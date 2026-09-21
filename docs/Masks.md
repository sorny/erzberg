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

Press **Paint** on a mask, or **+ Draw a mask**. It opens over the viewport.

| Tool | Key | |
|---|---|---|
| Brush | `B` | `[` and `]` resize |
| Rectangle | `R` | |
| Ellipse | `O` | |
| Lasso | `L` | |
| Erase | `E` | toggles paint/erase |
| Close | `Esc` | |

The backdrop is the imagery when some has been fetched and the hillshade when it
has not — the same view either way, with more or less to go on.

**Why a separate view from Edit Mode.** They answer different questions. A clip
changes the raster for everything; a mask changes one layer and leaves the rest
alone. Sharing a window would mean every gesture had to say which it meant.

**The brush is hard-edged on purpose.** A mask is a bit per pixel — there is no
half-selected — so a soft brush would have to dither the boundary or quantise at
some threshold, and both produce an edge that looks deliberate and is not. The
feather that matters is the one applied to the *terrain* at the edge of a
selection, and that already exists in Edit Mode where it belongs.

**A stroke is stamps, not samples.** A pointer moving quickly reports positions
tens of pixels apart. Stamping only where it was reported paints a dotted line,
so a drag steps at half the brush radius between the reported points.

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
