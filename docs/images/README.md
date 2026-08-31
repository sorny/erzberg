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

`edit-mode.png` is a page screenshot, on purpose. The panel and the selection
overlay are the subject of that image.

The preset thumbnails in the sidebar are a different set. `npm run thumbs`
writes them to `public/presets/thumbs/` as WebP files of 320×200 px. They are
separate because they ship with the app and not with the documentation. The idea
and the exporter are the same. See `scripts/generate-thumbs.js`.
