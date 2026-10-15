#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use percent_encoding::percent_decode_str;
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Icon, WindowBuilder};
use wry::http::{Response, StatusCode};
use wry::{DragDropEvent, WebContext, WebViewBuilder};

enum UserEvent {
    Open(PathBuf),
    Title(String),
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
        "/vendor/three.module.js" => (JS, v!("three.module.js")),
        "/vendor/three.core.js" => (JS, v!("three.core.js")),
        p if p.starts_with(j) => match &p[j.len()..] {
            "loaders/GLTFLoader.js" => (JS, v!("examples/jsm/loaders/GLTFLoader.js")),
            "loaders/FBXLoader.js" => (JS, v!("examples/jsm/loaders/FBXLoader.js")),
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

fn ext_lower(p: &std::path::Path) -> Option<String> {
    p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase())
}

fn mime_for(p: &std::path::Path) -> &'static str {
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

fn is_model(p: &std::path::Path) -> bool {
    matches!(ext_lower(p).as_deref(), Some("fbx") | Some("glb") | Some("gltf"))
}

fn window_icon() -> Option<Icon> {
    let dir = ico::IconDir::read(std::io::Cursor::new(&include_bytes!("../assets/orrery.ico")[..])).ok()?;
    let entry = dir.entries().iter().find(|e| e.width() == 32).or(dir.entries().first())?;
    let img = entry.decode().ok()?;
    Icon::from_rgba(img.rgba_data().to_vec(), img.width(), img.height()).ok()
}

fn main() {
    let mut file: Option<PathBuf> = None;
    let mut shot: Option<PathBuf> = None;
    let mut log: Option<PathBuf> = None;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--screenshot" => shot = args.next().map(PathBuf::from),
            "--log" => log = args.next().map(PathBuf::from),
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
    let initial = file
        .as_ref()
        .and_then(|f| f.file_name())
        .map(|n| n.to_string_lossy().into_owned());

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title(initial.as_deref().unwrap_or("Orrery"))
        .with_window_icon(window_icon())
        .with_inner_size(LogicalSize::new(1100.0, 760.0))
        .build(&event_loop)
        .expect("window");

    let data_dir = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Orrery")
        .join("WebView2");
    let mut ctx = WebContext::new(Some(data_dir));

    let init_script = format!(
        "window.__INITIAL = {}; window.__SHOT = {};",
        serde_json::to_string(&initial).unwrap(),
        shot.is_some()
    );

    let dir_proto = dir.clone();
    let dir_drop = dir.clone();
    let proxy_ipc = proxy.clone();
    let proxy_drop = proxy.clone();

    let webview = WebViewBuilder::new_with_web_context(&mut ctx)
        .with_initialization_script(&init_script)
        .with_custom_protocol("app".into(), move |_id, req| {
            let path = req.uri().path().to_string();
            let not_found = || {
                Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Cow::Borrowed(&b"not found"[..]))
                    .unwrap()
            };
            if let Some(rel) = path.strip_prefix("/m/") {
                let rel = percent_decode_str(rel).decode_utf8_lossy().into_owned();
                let base = dir_proto.lock().unwrap().clone();
                let full = base.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
                let ok = !full.components().any(|c| matches!(c, std::path::Component::ParentDir));
                return match (ok, std::fs::read(&full)) {
                    (true, Ok(bytes)) => Response::builder()
                        .header("Content-Type", mime_for(&full))
                        .header("Access-Control-Allow-Origin", "*")
                        .body(Cow::Owned(bytes))
                        .unwrap(),
                    _ => not_found(),
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
                    if let Some(parent) = p.parent() {
                        *dir_drop.lock().unwrap() = parent.to_path_buf();
                    }
                    let _ = proxy_drop.send_event(UserEvent::Open(p));
                }
            }
            true
        })
        .with_ipc_handler(move |req| {
            let body = req.body();
            if let Some(t) = body.strip_prefix("title:") {
                let _ = proxy_ipc.send_event(UserEvent::Title(t.to_string()));
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

    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(UserEvent::Open(p)) => {
                if let Some(n) = p.file_name() {
                    let name = n.to_string_lossy();
                    let _ = webview.evaluate_script(&format!(
                        "window.loadFile && window.loadFile({})",
                        serde_json::to_string(&*name).unwrap()
                    ));
                }
            }
            Event::UserEvent(UserEvent::Title(t)) => window.set_title(&t),
            Event::UserEvent(UserEvent::Quit) => *flow = ControlFlow::Exit,
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => *flow = ControlFlow::Exit,
            _ => {}
        }
    });
}
