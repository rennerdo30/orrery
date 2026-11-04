# orrery.renner.dev

The project homepage, served by GitHub Pages from this folder. Plain static files: no build
step, no external fonts or scripts, strict Content-Security-Policy.

- **Live demo:** `demo.js` runs the hero viewer with the same three.js build the app embeds
  (`vendor/` is a copy of `assets/vendor/`, three.js r186). It mirrors the app's lighting,
  framing, overlay format and keys (`assets/viewer.js`). Keep the two in step when the viewer
  changes, and update `vendor/` together with `assets/vendor/`. `vendor/LICENSES.txt` carries
  the three.js and fflate notices (linked from the footer); keep it in step with
  `tools/gen-notices/header.txt`.
- **Demo model:** the brass orrery is built in code in `buildOrrery()`; it is not a capture of
  the app and the caption says so. Visitors can open their own GLB, glTF or FBX: files are read
  in the browser and never uploaded, and the CSP blocks any remote URL a model references.
- **Import map:** the inline `<script type="importmap">` is allowed by its SHA-256 hash in the
  CSP of `index.html`. If you change the import map, recompute the hash:
  `printf '%s' '<importmap json>' | openssl dgst -sha256 -binary | openssl base64`.
- **Releases:** `releases.js` reads the public GitHub releases API to point the download
  button at the newest `orrery-<version>-windows-x64.zip`; without it the links fall back to
  the releases page.
- **Facts on the page** (exe 3.6 MB, zip 1.2 MB, texture search depths, file rules) come from
  the root `README.md`, `src/resolve.rs` and the 0.1.0 release; update them together.
- **Page weight:** about 2.2 MB uncompressed on first load, almost all of it three.js; GitHub Pages serves it
  gzip-compressed. The glTF, FBX and TGA loaders load only when a visitor opens a model.
- `assets/og.png` is a headless render of the hero at 1200 x 630.
- Deploy: run the **Website Pages** workflow from the Actions tab (manual only, owner).
