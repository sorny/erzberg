# Images

Gallery stills for the root README, all rendered from the bundled sample
heightmap (`public/Heightmap.png`) at the Iso camera preset, one per style
preset.

They are produced by the app's **own 4K PNG exporter** (`2`, or Export → PNG)
rather than by screenshotting the page: the exporter renders the scene into an
offscreen target, so the sidebar and the orientation gizmo are absent and the
result is trimmed to the art with a 16 px margin. They are then downscaled to a
1200 px long side (`sips -Z 1200`) to keep the repository small.

`edit-mode.png` is deliberately a page screenshot — the panel and the selection
overlay are the subject there.
