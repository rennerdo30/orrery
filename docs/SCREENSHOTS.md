# Screenshots

The images in `docs/images/` (and their copies in `website/assets/shots/`) are captures of the
real `orrery.exe` window, taken on 2026-11-04 at its default size (1650 x 1140 pixels at 150 %
display scaling) and converted to WebP (quality 88).

| File | What it shows | Command |
|---|---|---|
| `viewer.webp` | A GLB with two clips: overlay, grid, control bar | `orrery.exe orrery.glb` |
| `missing-texture.webp` | A glTF whose Jupiter texture file is missing: the banner lists it, the mesh is still drawn | `orrery.exe orrery.gltf` |
| `add-animations.webp` | Clips added from a second file: the binding summary in the top right | `orrery.exe orrery.glb --lib orrery.glb` |

## The model

The brass orrery is our own: `buildOrrery()` in `website/demo.js` builds it in code, the same
model the website demo shows. It was written to GLB with three.js r186 `GLTFExporter` in a
headless browser (the exporter is not part of this repository). The missing-texture variant is
the same file as `.gltf` + `.bin`, with Jupiter's image pointed at `textures/jupiter_bands.png`,
which does not exist. No third-party assets are used.

## How

`scripts/capture-window.ps1` starts one `orrery.exe`, waits for its window, captures the client
area with `PrintWindow(PW_CLIENTONLY | PW_RENDERFULLCONTENT)` so the WebView2 overlay and controls
are included, saves a PNG and closes only the process it started. Run it from a DPI-aware
PowerShell 7 process, for example:

```
pwsh -NoProfile -File scripts\capture-window.ps1 -Exe target\release\orrery.exe -ArgList '"C:\models\orrery.glb"' -Out viewer.png
ffmpeg -i viewer.png -c:v libwebp -quality 88 -compression_level 6 viewer.webp
```

The window is visible while the script runs. `--screenshot <png>` (used by
`scripts/smoke-test.ps1`) only captures the WebGL canvas, without the overlay and controls.

The numbers in the overlay use the PC's number format, so the triangle count reads `32.556`
on a German-format system.
