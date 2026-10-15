<p align="center"><img src="assets/icon.svg" width="128" alt="Orrery logo"></p>

# Orrery

Orrery — a fast, tiny 3D model viewer for FBX, glTF and GLB.

Double-click a model, look at it. Works offline; no server, no installer.

<!-- screenshot: viewer with a character model -->
<!-- screenshot: animation dropdown and info overlay -->

## Features

- Opens the file passed as the first argument; drag and drop another file onto the window to switch
- Auto-framing, orbit / pan / zoom
- Studio lighting with an environment map
- Info overlay: triangles, meshes, materials, textures, bounding-box size, animation clips
- Plays the first animation, with a dropdown for the others
- Clear error banner when something fails (for example missing FBX textures); the mesh is still shown

| Key | Action |
|-----|--------|
| R | Reset view |
| G | Toggle grid |
| W | Toggle wireframe |
| B | Dark / light background |

## Build

Requires a Rust toolchain and the WebView2 runtime (present on Windows 11).

```
cargo build --release
```

The exe is `target/release/orrery.exe` (about 3.5 MB, three.js is embedded).

Optional flags: `--log <file>` appends a one-line load result; `--screenshot <png>` saves the rendered view and exits (used by `scripts/smoke-test.ps1`).

## Register as a handler (current user, no admin)

```
powershell -ExecutionPolicy Bypass -File register.ps1
powershell -ExecutionPolicy Bypass -File unregister.ps1
```

`register.ps1` writes only under `HKCU\Software\Classes` (ProgID `Orrery.Model`, `Applications\orrery.exe`, and `OpenWithProgids` for `.fbx`, `.glb`, `.gltf`). Windows does not allow programs to set the default app silently, so do this once: right-click a model file, Open with, Choose another app, Orrery, Always.

## Icon

`assets/icon.svg` (48 px and up) and `assets/icon-small.svg` (16 to 32 px) are rendered into `assets/orrery.ico` by `tools/make-icon`:

```
cargo run --release --manifest-path tools/make-icon/Cargo.toml -- . 
```

## Limitations

- FBX is read by three.js `FBXLoader`: binary FBX 7.x works best; ASCII FBX and very old versions may fail or lose data.
- External textures are resolved relative to the model file's folder; a path that climbs out of it (`..`) is not served.
- No KTX2/Draco/Meshopt decoders are bundled; glTF files using those extensions will not load.

## License

MIT, see `LICENSE`. three.js (MIT) is bundled, see `THIRD_PARTY_NOTICES`.
