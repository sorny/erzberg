# Images

This directory holds the gallery stills for the root README. Each still comes
from the bundled sample heightmap (`public/Heightmap.png`) at the Iso camera
preset. There is one still per style preset.

The app's own 4K PNG exporter makes them. Press `2`, or use Export → PNG. The
exporter renders the scene into an offscreen target, so the sidebar and the
orientation gizmo are absent. The exporter also trims the result to the art and
leaves a margin of 16 px. A screenshot of the page cannot do either of these.
The stills then go down to a long side of 1200 px with `sips -Z 1200`, which
keeps the repository small.

`edit-mode.png` and `fetch-window.png` are page screenshots, on purpose. The
panel is the subject of both — the selection overlay in one, the extent map and
its readout in the other — and the PNG exporter deliberately renders without the
sidebar, so it cannot photograph them.

They are sized differently from each other, and from the gallery. `edit-mode.png`
is the whole page at 1200 px, because Edit Mode replaces the sidebar with a panel
wide enough to read at that scale. `fetch-window.png` is cropped to the 312 px
panel and left at its native 624 px — captured at device pixel ratio 2 — because
`sips -Z 1200` would upscale it into a blur. The rule the gallery stills follow is
"keep the repository small", not "make everything 1200".

The preset thumbnails in the sidebar are a different set. `npm run thumbs`
writes them to `public/presets/thumbs/` as WebP files of 320×200 px. They are
separate because they ship with the app and not with the documentation. The idea
and the exporter are the same. See `scripts/generate-thumbs.js`.
