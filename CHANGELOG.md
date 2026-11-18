# Changelog

## Unreleased

## 0.1.1

- Published on crates.io as `orrery-viewer` (`cargo install --locked orrery-viewer` installs `orrery.exe`); the name `orrery` was already taken there
- Building on anything but Windows stops with a clear message (Orrery uses WebView2)
- Release pipeline: `scripts/release.ps1`, a tag-triggered `release.yml` that builds the zip on GitHub, adds build provenance and `SHA256SUMS.txt` and prepares a draft release, a manual `publish-crate.yml`, `ci.yml` (fmt, clippy, tests, cargo-deny) and `docs/RELEASING.md`
- Fixed: a glTF with a missing external image also listed the internal placeholder image ("png;base64,...") as a missing texture; the placeholder PNG had a broken checksum and failed to decode
- Control bar stays on one line at the default window size (it was limited to half the window width and wrapped its labels); the key help moves to the top while the bar is shown, and the error banner sits above the bar
- README and website show real captures of the app (docs/SCREENSHOTS.md, scripts/capture-window.ps1)
- THIRD_PARTY_NOTICES: licence texts are read as UTF-8 (no more garbled characters), fflate gets its full MIT text, TGALoader is listed, and the Microsoft WebView2 SDK loader (statically linked through webview2-com-sys) and the webview2-rs MIT licence are now included
- Website at orrery.renner.dev, with its own three.js notices in website/vendor/LICENSES.txt

## 0.1.0

First release.

- Viewer for FBX, glTF and GLB on Windows (WebView2 + three.js r186, bundled; works offline, no network access)
- Opens a file given on the command line; drag and drop to switch models
- Auto-framing, orbit / pan / zoom, studio lighting with environment map
- Keys: R reset view, G grid, W wireframe, B background, Space play/pause
- Info overlay: triangles, meshes, materials, textures, size, animation clips
- Animation playback controls (scrubber, speed, loop, clip list, lock root) and adding clips from another FBX/GLB by bone name
- Texture lookup for embedded and external textures (relative paths, absolute paths, TGA, search by file name near the model); missing textures are listed
- Loading screen, dark window from the first frame, clear error banner
- Read-only file access limited to the open model, images and glTF `.bin` files; remote URLs blocked; strict Content-Security-Policy
- `register.ps1` / `unregister.ps1`: per-user file association entries (HKCU), no admin
