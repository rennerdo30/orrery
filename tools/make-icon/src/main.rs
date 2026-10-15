// One-off tool: renders assets/icon.svg (48 px and up) and assets/icon-small.svg
// (32 px and below) into a multi-size assets/orrery.ico, plus optional preview PNGs.
// Usage: cargo run --release --manifest-path tools/make-icon/Cargo.toml -- <repo-root> [preview-dir]
use resvg::{tiny_skia, usvg};
use std::path::PathBuf;

fn render(svg: &str, size: u32) -> Vec<u8> {
    let tree = usvg::Tree::from_str(svg, &usvg::Options::default()).expect("svg");
    let mut pm = tiny_skia::Pixmap::new(size, size).unwrap();
    let s = size as f32 / tree.size().width();
    resvg::render(&tree, tiny_skia::Transform::from_scale(s, s), &mut pm.as_mut());
    pm.encode_png().unwrap()
}

fn main() {
    let mut a = std::env::args().skip(1);
    let root = PathBuf::from(a.next().expect("repo root"));
    let preview = a.next().map(PathBuf::from);
    let big = std::fs::read_to_string(root.join("assets/icon.svg")).unwrap();
    let small = std::fs::read_to_string(root.join("assets/icon-small.svg")).unwrap();
    let mut dir = ico::IconDir::new(ico::ResourceType::Icon);
    for size in [16u32, 24, 32, 48, 64, 128, 256] {
        let png = render(if size <= 32 { &small } else { &big }, size);
        if let Some(p) = &preview {
            std::fs::create_dir_all(p).unwrap();
            std::fs::write(p.join(format!("icon-{size}.png")), &png).unwrap();
        }
        let img = ico::IconImage::read_png(&png[..]).unwrap();
        dir.add_entry(ico::IconDirEntry::encode(&img).unwrap());
    }
    let f = std::fs::File::create(root.join("assets/orrery.ico")).unwrap();
    dir.write(f).unwrap();
}
