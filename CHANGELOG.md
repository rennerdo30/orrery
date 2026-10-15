# Changelog

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
