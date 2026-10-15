#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use percent_encoding::percent_decode_str;
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Icon, WindowBuilder};
use wry::http::{Response, StatusCode};
use wry::{DragDropEvent, WebContext, WebViewBuilder};

const BG: (u8, u8, u8, u8) = (30, 31, 36, 255);

enum UserEvent {
    Dropped(PathBuf),
    Open(PathBuf),
    Title(String),
    Ready(u128),
    Quit,
}

macro_rules! v {
    ($p:literal) => {
        include_bytes!(concat!("../assets/vendor/", $p))
    };
}

fn embedded(path: &str) -> Option<(&'static str, &'static [u8])> {
    const JS: &str = "text/javascript";
    let j = "/vendor/examples/jsm/";
    Some(match path {
        "/" | "/index.html" => ("text/html", include_bytes!("../assets/index.html")),
        "/viewer.js" => (JS, include_bytes!("../assets/viewer.js")),
        "/icon.svg" => ("image/svg+xml", include_bytes!("../assets/icon.svg")),
        "/vendor/three.module.js" => (JS, v!("three.module.js")),
        "/vendor/three.core.js" => (JS, v!("three.core.js")),
        p if p.starts_with(j) => match &p[j.len()..] {
            "loaders/GLTFLoader.js" => (JS, v!("examples/jsm/loaders/GLTFLoader.js")),
            "loaders/FBXLoader.js" => (JS, v!("examples/jsm/loaders/FBXLoader.js")),
            "loaders/TGALoader.js" => (JS, v!("examples/jsm/loaders/TGALoader.js")),
            "controls/OrbitControls.js" => (JS, v!("examples/jsm/controls/OrbitControls.js")),
            "environments/RoomEnvironment.js" => (JS, v!("examples/jsm/environments/RoomEnvironment.js")),
            "utils/BufferGeometryUtils.js" => (JS, v!("examples/jsm/utils/BufferGeometryUtils.js")),
            "utils/SkeletonUtils.js" => (JS, v!("examples/jsm/utils/SkeletonUtils.js")),
            "curves/NURBSCurve.js" => (JS, v!("examples/jsm/curves/NURBSCurve.js")),
            "curves/NURBSUtils.js" => (JS, v!("examples/jsm/curves/NURBSUtils.js")),
            "libs/fflate.module.js" => (JS, v!("examples/jsm/libs/fflate.module.js")),
            _ => return None,
        },
        _ => return None,
    })
}

fn ext_lower(p: &Path) -> Option<String> {
    p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase())
}

fn mime_for(p: &Path) -> &'static str {
    match ext_lower(p).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("gltf") => "model/gltf+json",
        _ => "application/octet-stream",
    }
}

fn is_model(p: &Path) -> bool {
    matches!(ext_lower(p).as_deref(), Some("fbx") | Some("glb") | Some("gltf"))
}

fn is_image(p: &Path) -> bool {
    matches!(
        ext_lower(p).as_deref(),
        Some("png") | Some("jpg") | Some("jpeg") | Some("tga") | Some("bmp") | Some("webp") | Some("gif") | Some("tif") | Some("tiff") | Some("psd")
    )
}

/// Lazily built index of image files below the model folder and its parent folder, used to find
/// textures whose recorded path no longer exists (moved asset, other machine, Unity layout).
#[derive(Default)]
struct TexIndex {
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
            Ok(t) if t.is_dir() => walk(&p, depth - 1, budget, out),
            Ok(_) if is_image(&p) => out.push(p),
            _ => {}
        }
    }
}

impl TexIndex {
    fn build(dir: &Path) -> TexIndex {
        let mut files = Vec::new();
        let mut budget = 30000u32;
        walk(dir, 5, &mut budget, &mut files);
        if let Some(parent) = dir.parent() {
            if parent.parent().is_some() {
                walk(parent, 4, &mut budget, &mut files);
            }
        }
        let mut idx = TexIndex { for_dir: dir.to_path_buf(), ..Default::default() };
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

/// Resolves a path requested by the page to a file (read-only).
/// 1. an absolute path written in the model, 2. relative to the model folder, 3. same file name
/// (or same name with another image extension) anywhere near the model.
fn resolve(dir: &Path, req: &str, index: &Mutex<TexIndex>, allow_any: bool) -> Option<PathBuf> {
    let norm = req.replace('\\', "/");
    let looks_abs = norm.starts_with('/') || norm.chars().nth(1) == Some(':');
    if looks_abs {
        let p = PathBuf::from(&norm);
        if p.is_file() && is_image(&p) {
            return Some(p);
        }
    } else {
        let p = dir.join(norm.replace('/', std::path::MAIN_SEPARATOR_STR));
        if p.is_file() && (allow_any || is_image(&p)) {
            return Some(p);
        }
    }
    let base = norm.rsplit('/').next().unwrap_or("");
    if base.is_empty() || !is_image(Path::new(base)) {
        return None;
    }
    let mut idx = index.lock().unwrap();
    if idx.for_dir != dir {
        *idx = TexIndex::build(dir);
    }
    idx.find(base)
}

/// Paint the window class background dark so no white shows while WebView2 starts up.
#[cfg(windows)]
fn dark_window_background(window: &tao::window::Window) {
    use tao::platform::windows::WindowExtWindows;
    use windows_sys::Win32::Graphics::Gdi::CreateSolidBrush;
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetClassLongPtrW, GCLP_HBRBACKGROUND};
    unsafe {
        let brush = CreateSolidBrush(BG.0 as u32 | (BG.1 as u32) << 8 | (BG.2 as u32) << 16);
        SetClassLongPtrW(window.hwnd() as _, GCLP_HBRBACKGROUND, brush as isize);
    }
}
#[cfg(not(windows))]
fn dark_window_background(_: &tao::window::Window) {}

fn window_icon() -> Option<Icon> {
    let dir = ico::IconDir::read(std::io::Cursor::new(&include_bytes!("../assets/orrery.ico")[..])).ok()?;
    let entry = dir.entries().iter().find(|e| e.width() == 32).or(dir.entries().first())?;
    let img = entry.decode().ok()?;
    Icon::from_rgba(img.rgba_data().to_vec(), img.width(), img.height()).ok()
}

fn file_response(full: &Path) -> Response<Cow<'static, [u8]>> {
    match std::fs::read(full) {
        Ok(bytes) => Response::builder()
            .header("Content-Type", mime_for(full))
            .header("Content-Length", bytes.len().to_string())
            .header("Access-Control-Allow-Origin", "*")
            .body(Cow::Owned(bytes))
            .unwrap(),
        Err(_) => not_found(),
    }
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Cow::Borrowed(&b"not found"[..]))
        .unwrap()
}

fn main() {
    let t0 = std::time::Instant::now();
    let mut file: Option<PathBuf> = None;
    let mut shot: Option<PathBuf> = None;
    let mut log: Option<PathBuf> = None;
    let mut lib: Option<PathBuf> = None;
    let mut wait_ms: u32 = 0;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--screenshot" => shot = args.next().map(PathBuf::from),
            "--log" => log = args.next().map(PathBuf::from),
            "--lib" => lib = args.next().map(PathBuf::from),
            "--wait" => wait_ms = args.next().and_then(|s| s.parse().ok()).unwrap_or(0),
            _ if file.is_none() => file = Some(PathBuf::from(a)),
            _ => {}
        }
    }
    let dir = Arc::new(Mutex::new(
        file.as_ref()
            .and_then(|f| f.parent().map(|p| p.to_path_buf()))
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| PathBuf::from(".")),
    ));
    let dropped: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(lib.clone()));
    let index = Arc::new(Mutex::new(TexIndex::default()));
    let initial = file
        .as_ref()
        .and_then(|f| f.file_name())
        .map(|n| n.to_string_lossy().into_owned());
    let lib_name = lib.as_ref().and_then(|f| f.file_name()).map(|n| n.to_string_lossy().into_owned());

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title(initial.as_deref().unwrap_or("Orrery"))
        .with_window_icon(window_icon())
        .with_inner_size(LogicalSize::new(1100.0, 760.0))
        .build(&event_loop)
        .expect("window");

    dark_window_background(&window);
    window.request_redraw();
    let data_dir = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Orrery")
        .join("WebView2");
    let mut ctx = WebContext::new(Some(data_dir));

    let init_script = format!(
        "window.__INITIAL = {}; window.__SHOT = {}; window.__LIB = {}; window.__SHOTWAIT = {};",
        serde_json::to_string(&initial).unwrap(),
        shot.is_some(),
        serde_json::to_string(&lib_name).unwrap(),
        wait_ms
    );

    let dir_proto = dir.clone();
    let dir_ipc = dir.clone();
    let dropped_proto = dropped.clone();
    let dropped_drop = dropped.clone();
    let dropped_ipc = dropped.clone();
    let index_proto = index.clone();
    let proxy_ipc = proxy.clone();
    let log_t = log.clone();
    let proxy_drop = proxy.clone();

    let webview = WebViewBuilder::new_with_web_context(&mut ctx)
        .with_background_color(BG)
        .with_initialization_script(&init_script)
        .with_custom_protocol("app".into(), move |_id, req| {
            let path = req.uri().path().to_string();
            if path == "/drop" {
                return match dropped_proto.lock().unwrap().clone() {
                    Some(p) => file_response(&p),
                    None => not_found(),
                };
            }
            let (rel, strict) = if let Some(r) = path.strip_prefix("/m/") {
                (Some(r), false)
            } else if let Some(r) = path.strip_prefix("/t/") {
                (Some(r), true)
            } else {
                (None, false)
            };
            if let Some(rel) = rel {
                let rel = percent_decode_str(rel).decode_utf8_lossy().into_owned();
                let base = dir_proto.lock().unwrap().clone();
                // "/m/" is the model folder itself: no "..", any file type. "/t/" is for texture
                // paths written inside models: images only.
                if !strict && rel.split(['/', '\\']).any(|c| c == "..") {
                    return not_found();
                }
                return match resolve(&base, &rel, &index_proto, !strict) {
                    Some(full) => file_response(&full),
                    None => not_found(),
                };
            }
            match embedded(&path) {
                Some((mime, bytes)) => Response::builder()
                    .header("Content-Type", mime)
                    .body(Cow::Borrowed(bytes))
                    .unwrap(),
                None => not_found(),
            }
        })
        .with_drag_drop_handler(move |ev| {
            if let DragDropEvent::Drop { paths, .. } = ev {
                if let Some(p) = paths.into_iter().find(|p| is_model(p)) {
                    *dropped_drop.lock().unwrap() = Some(p.clone());
                    let _ = proxy_drop.send_event(UserEvent::Dropped(p));
                }
            }
            true
        })
        .with_ipc_handler(move |req| {
            let body = req.body();
            if let Some(t) = body.strip_prefix("title:") {
                let _ = proxy_ipc.send_event(UserEvent::Title(t.to_string()));
            } else if body.starts_with("adopt:") {
                // plain drop: the dropped file becomes the model
                if let Some(p) = dropped_ipc.lock().unwrap().clone() {
                    if let Some(parent) = p.parent() {
                        *dir_ipc.lock().unwrap() = parent.to_path_buf();
                    }
                    let _ = proxy_ipc.send_event(UserEvent::Open(p));
                }
            } else if body == "ready" {
                let _ = proxy_ipc.send_event(UserEvent::Ready(t0.elapsed().as_millis()));
            } else if let Some(t) = body.strip_prefix("log:") {
                if let Some(path) = &log {
                    use std::io::Write;
                    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                        let _ = writeln!(f, "{}", t);
                    }
                }
            } else if let Some(d) = body.strip_prefix("shot:") {
                use base64::Engine;
                if let (Some(path), Some(b64)) = (&shot, d.split(',').nth(1)) {
                    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) {
                        let _ = std::fs::write(path, bytes);
                    }
                    let _ = proxy_ipc.send_event(UserEvent::Quit);
                }
            }
        })
        .with_url("http://app.localhost/index.html")
        .build(&window)
        .expect("webview");

    if let Some(path) = &log_t {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "TIME webview built at {} ms", t0.elapsed().as_millis());
        }
    }
    // Safety net: never stay invisible if the page fails before it can say "ready".
    let proxy_timer = proxy.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(4000));
        let _ = proxy_timer.send_event(UserEvent::Ready(u128::MAX));
    });
    let mut shown = false;
    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(UserEvent::Dropped(p)) => {
                if let Some(n) = p.file_name() {
                    let _ = webview.evaluate_script(&format!(
                        "window.onDrop && window.onDrop({}, false)",
                        serde_json::to_string(&*n.to_string_lossy()).unwrap()
                    ));
                }
            }
            Event::UserEvent(UserEvent::Open(p)) => {
                if let Some(n) = p.file_name() {
                    let _ = webview.evaluate_script(&format!(
                        "window.loadFile && window.loadFile({})",
                        serde_json::to_string(&*n.to_string_lossy()).unwrap()
                    ));
                }
            }
            Event::UserEvent(UserEvent::Title(t)) => window.set_title(&t),
            Event::UserEvent(UserEvent::Ready(ms)) => {
                if !shown {
                    shown = true;
                    window.set_visible(true);
                    if let Some(path) = &log_t {
                        use std::io::Write;
                        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
                            let _ = writeln!(f, "TIME shown ({}) at {} ms", if ms == u128::MAX { "timeout".to_string() } else { format!("page ready {} ms", ms) }, t0.elapsed().as_millis());
                        }
                    }
                }
            }
            Event::UserEvent(UserEvent::Quit) => *flow = ControlFlow::Exit,
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => *flow = ControlFlow::Exit,
            _ => {}
        }
    });
}
