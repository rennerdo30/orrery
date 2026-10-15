//! Read-only file resolution for the viewer page.
//!
//! The page may only read: the opened model file, image files and glTF `.bin` sidecars. Every
//! served file must, after resolving links and junctions, live under the model folder or its
//! parent folder, except an image whose exact absolute path is written in the model itself.
//! Nothing else (text files, other models, UNC paths, drive-relative paths) is ever served.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Which URL prefix the request came in on.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// `/m/`: files next to the model (model itself, images, `.bin`); no `..` allowed.
    Model,
    /// `/t/`: texture paths written inside a model; images only; may be absolute or use `..`.
    Texture,
}

pub fn ext_lower(p: &Path) -> Option<String> {
    p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase())
}

pub fn is_model(p: &Path) -> bool {
    matches!(ext_lower(p).as_deref(), Some("fbx") | Some("glb") | Some("gltf"))
}

pub fn is_image(p: &Path) -> bool {
    matches!(
        ext_lower(p).as_deref(),
        Some("png") | Some("jpg") | Some("jpeg") | Some("tga") | Some("bmp") | Some("webp") | Some("gif") | Some("ktx2")
    )
}

fn is_sidecar(p: &Path) -> bool {
    ext_lower(p).as_deref() == Some("bin")
}

/// Index of image files below the model folder and its parent, used to find textures whose recorded
/// path no longer exists (moved asset, other machine, Unity layout).
#[derive(Default)]
pub struct Index {
    for_dir: PathBuf,
    by_name: HashMap<String, Vec<PathBuf>>,
    by_stem: HashMap<String, Vec<PathBuf>>,
}

fn walk(dir: &Path, depth: u32, budget: &mut u32, out: &mut Vec<PathBuf>) {
    if depth == 0 || *budget == 0 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if *budget == 0 {
            return;
        }
        *budget -= 1;
        let p = e.path();
        match e.file_type() {
            // links and junctions are not followed while indexing
            Ok(t) if t.is_symlink() => {}
            Ok(t) if t.is_dir() => walk(&p, depth - 1, budget, out),
            Ok(_) if is_image(&p) => out.push(p),
            _ => {}
        }
    }
}

impl Index {
    fn build(dir: &Path) -> Index {
        let mut files = Vec::new();
        let mut budget = 30000u32;
        walk(dir, 5, &mut budget, &mut files);
        if let Some(parent) = dir.parent() {
            if parent.parent().is_some() {
                walk(parent, 4, &mut budget, &mut files);
            }
        }
        let mut idx = Index { for_dir: dir.to_path_buf(), ..Default::default() };
        for f in files {
            let name = f.file_name().unwrap().to_string_lossy().to_lowercase();
            let stem = f.file_stem().unwrap().to_string_lossy().to_lowercase();
            idx.by_name.entry(name).or_default().push(f.clone());
            idx.by_stem.entry(stem).or_default().push(f);
        }
        idx
    }

    fn find(&self, base: &str) -> Option<PathBuf> {
        let b = base.to_lowercase();
        if let Some(v) = self.by_name.get(&b) {
            return v.first().cloned();
        }
        let stem = Path::new(&b).file_stem()?.to_string_lossy().into_owned();
        self.by_stem.get(&stem).and_then(|v| v.first().cloned())
    }
}

fn canon(p: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(p).ok()
}

/// `X:/...` with a drive letter and a separator.
fn is_drive_absolute(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'/'
}

/// Resolves a path requested by the page; returns the canonical file to serve, or None.
/// `opened` is the file name of the model that is open (the only model-type file served).
pub fn resolve(dir: &Path, opened: Option<&str>, req: &str, index: &Mutex<Index>, kind: Kind) -> Option<PathBuf> {
    if req.contains('\0') {
        return None;
    }
    let norm = req.replace('\\', "/");
    // UNC / device paths, drive-relative ("C:x") and rooted-without-drive ("/x") paths are refused.
    if norm.starts_with('/') {
        return None;
    }
    let bytes = norm.as_bytes();
    let has_drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    if has_drive && !is_drive_absolute(&norm) {
        return None;
    }
    if norm.contains(':') && !has_drive {
        return None; // alternate data streams and the like
    }

    let root_dir = canon(dir)?;
    let mut roots = vec![root_dir.clone()];
    if let Some(parent) = root_dir.parent() {
        if parent.parent().is_some() {
            roots.push(parent.to_path_buf());
        }
    }
    let inside = |c: &Path| roots.iter().any(|r| c.starts_with(r));
    let type_ok = |c: &Path| match kind {
        Kind::Texture => is_image(c),
        Kind::Model => {
            is_image(c)
                || is_sidecar(c)
                || (is_model(c)
                    && opened.is_some_and(|o| {
                        c.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(o)) && c.parent() == Some(root_dir.as_path())
                    }))
        }
    };

    if is_drive_absolute(&norm) {
        // exact absolute path written in the model: images only, link targets checked too
        if kind != Kind::Texture {
            return None;
        }
        if let Some(c) = canon(Path::new(&norm)) {
            if c.is_file() && is_image(&c) {
                return Some(c);
            }
        }
    } else {
        if kind == Kind::Model && Path::new(&norm).components().any(|c| matches!(c, Component::ParentDir)) {
            return None;
        }
        if let Some(c) = canon(&root_dir.join(norm.replace('/', std::path::MAIN_SEPARATOR_STR))) {
            if c.is_file() && inside(&c) && type_ok(&c) {
                return Some(c);
            }
        }
    }

    // fallback: same file name (or stem with another image extension) near the model
    let base = norm.rsplit('/').next().unwrap_or("");
    let texture_like = is_image(Path::new(base)) || matches!(ext_lower(Path::new(base)).as_deref(), Some("psd") | Some("tif") | Some("tiff") | Some("dds"));
    if base.is_empty() || !texture_like {
        return None;
    }
    let mut idx = index.lock().unwrap();
    if idx.for_dir != root_dir {
        *idx = Index::build(&root_dir);
    }
    let hit = idx.find(base)?;
    let c = canon(&hit)?;
    (c.is_file() && inside(&c) && is_image(&c)).then_some(c)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Fixture {
        base: PathBuf,
        dir: PathBuf,
        outside: PathBuf,
    }

    impl Fixture {
        fn new(tag: &str) -> Fixture {
            let base = std::env::temp_dir().join(format!("orrery-test-{}-{}", tag, std::process::id()));
            let _ = fs::remove_dir_all(&base);
            let dir = base.join("proj").join("models");
            let outside = base.join("outside");
            fs::create_dir_all(&dir).unwrap();
            fs::create_dir_all(base.join("proj").join("textures")).unwrap();
            fs::create_dir_all(&outside).unwrap();
            fs::write(dir.join("hero.fbx"), b"fbx").unwrap();
            fs::write(dir.join("other.fbx"), b"fbx").unwrap();
            fs::write(dir.join("notes.txt"), b"secret").unwrap();
            fs::write(dir.join("data.bin"), b"bin").unwrap();
            fs::write(dir.join("a.png"), b"png").unwrap();
            fs::write(base.join("proj").join("textures").join("b.png"), b"png").unwrap();
            fs::write(outside.join("secret.png"), b"png").unwrap();
            fs::write(outside.join("secret.txt"), b"txt").unwrap();
            Fixture { base, dir, outside }
        }
        fn get(&self, req: &str, kind: Kind) -> Option<PathBuf> {
            resolve(&self.dir, Some("hero.fbx"), req, &Mutex::new(Index::default()), kind)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    #[test]
    fn serves_model_images_and_bin() {
        let f = Fixture::new("ok");
        assert!(f.get("hero.fbx", Kind::Model).is_some());
        assert!(f.get("a.png", Kind::Model).is_some());
        assert!(f.get("data.bin", Kind::Model).is_some());
        assert!(f.get("a.png", Kind::Texture).is_some());
        assert!(f.get("..\\textures\\b.png", Kind::Texture).is_some());
    }

    #[test]
    fn rejects_other_extensions() {
        let f = Fixture::new("ext");
        assert!(f.get("notes.txt", Kind::Model).is_none());
        assert!(f.get("notes.txt", Kind::Texture).is_none());
        assert!(f.get("other.fbx", Kind::Model).is_none(), "only the opened model is served");
        assert!(f.get("data.bin", Kind::Texture).is_none());
    }

    #[test]
    fn rejects_parent_escapes() {
        let f = Fixture::new("dotdot");
        assert!(f.get("../../outside/secret.png", Kind::Texture).is_none());
        assert!(f.get("..\\..\\outside\\secret.png", Kind::Texture).is_none());
        assert!(f.get("../textures/b.png", Kind::Model).is_none());
        assert!(f.get("../../outside/secret.txt", Kind::Texture).is_none());
    }

    #[test]
    fn rejects_drive_relative_unc_and_rooted() {
        let f = Fixture::new("drive");
        assert!(f.get("C:secret.png", Kind::Texture).is_none());
        assert!(f.get("C:hero.fbx", Kind::Model).is_none());
        assert!(f.get("//server/share/x.png", Kind::Texture).is_none());
        assert!(f.get("\\\\server\\share\\x.png", Kind::Texture).is_none());
        assert!(f.get("\\\\?\\C:\\Windows\\win.ini", Kind::Texture).is_none());
        assert!(f.get("/a.png", Kind::Texture).is_none());
        assert!(f.get("a.png:stream", Kind::Texture).is_none());
    }

    #[test]
    fn absolute_path_must_be_an_image() {
        let f = Fixture::new("abs");
        let png = f.outside.join("secret.png");
        let txt = f.outside.join("secret.txt");
        assert!(f.get(&png.to_string_lossy(), Kind::Texture).is_some(), "exact absolute image path is allowed");
        assert!(f.get(&txt.to_string_lossy(), Kind::Texture).is_none());
        assert!(f.get(&png.to_string_lossy(), Kind::Model).is_none(), "/m/ never takes absolute paths");
    }

    #[test]
    fn rejects_junction_escape() {
        let f = Fixture::new("junction");
        let link = f.dir.join("link");
        let ok = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&f.outside)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !ok {
            eprintln!("junction could not be created; skipping");
            return;
        }
        assert!(link.join("secret.png").is_file(), "junction works");
        assert!(f.get("link/secret.png", Kind::Model).is_none());
        assert!(f.get("link/secret.png", Kind::Texture).is_none());
        // fallback search must not follow it either
        assert!(f.get("secret.png", Kind::Texture).is_none());
        let _ = fs::remove_dir(&link);
    }

    #[test]
    fn fallback_finds_texture_by_name_or_stem() {
        let f = Fixture::new("fallback");
        assert!(f.get("D:/old/place/b.png", Kind::Texture).is_some(), "same name in the parent folder tree");
        assert!(f.get("x/y/b.psd", Kind::Texture).is_some(), "same stem, other extension");
        assert!(f.get("missing.png", Kind::Texture).is_none());
    }
}
