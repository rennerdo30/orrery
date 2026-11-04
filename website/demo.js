// Orrery homepage: the live viewer in the hero.
// It uses the same three.js build, lighting, framing, overlay format and keys as the app
// (assets/viewer.js in the repository). The demo model is a brass orrery built in code below.
// Visitors can open their own GLB, glTF or FBX: files are read locally and never uploaded,
// and the page's Content-Security-Policy blocks every remote URL a model might reference.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const view = document.getElementById('viewport');
const q = (name) => document.querySelector('[data-demo-' + name + ']');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- renderer (as in the app)

// Without the viewer element (for example when tools/export-demo imports this module to write
// the demo model as a GLB) only buildOrrery is used.
let renderer;
if (view) {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  } catch (e) {
    view.classList.add('no-webgl');
  }
}

if (renderer) start();

function start() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  view.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(3, 6, 4);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const BG = { dark: 0x1e1f24, light: 0xd9dce1 };
  let bgMode = 'dark';
  scene.background = new THREE.Color(BG.dark);

  let model = null, grid = null, wire = false, isDemo = true;
  const home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(view);
  resize();

  // ---------------------------------------------------------------- framing (as in the app)

  function frame(box) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1e-4);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    const dir = new THREE.Vector3(0.7, 0.5, 1).normalize();
    home.target.copy(center);
    home.pos.copy(center).addScaledVector(dir, dist * 0.95);
    camera.near = dist / 1000;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    resetView();
  }
  function resetView() {
    camera.position.copy(home.pos);
    controls.target.copy(home.target);
    controls.update();
  }
  const materialsOf = (o) => (o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []);
  function applyWire() {
    if (model) model.traverse((o) => { for (const m of materialsOf(o)) m.wireframe = wire; });
  }
  function toggleGrid() {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; return; }
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const s = Math.max(size.x, size.z) * 2 || 1;
    grid = new THREE.GridHelper(s, 20, 0x888888, 0x444444);
    grid.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    scene.add(grid);
  }
  function dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      for (const m of materialsOf(o)) {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      }
    });
  }

  // ---------------------------------------------------------------- overlay (same format as the app)

  function stats(root) {
    let tris = 0, meshes = 0;
    const mats = new Set();
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      meshes++;
      const g = o.geometry;
      if (g) tris += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
      for (const m of materialsOf(o)) mats.add(m);
    });
    return { tris: Math.round(tris), meshes, mats: mats.size };
  }
  function textureCount(root) {
    const texs = new Set();
    root.traverse((o) => { for (const m of materialsOf(o)) for (const k in m) if (m[k] && m[k].isTexture) texs.add(m[k]); });
    let ok = 0;
    for (const t of texs) if (t.image && (t.image.width > 0 || t.image.data)) ok++;
    return ok;
  }
  const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(3));

  function showInfo(name, clips, missing) {
    const s = stats(model);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const info = q('info');
    info.hidden = false;
    info.textContent = '';
    const b = document.createElement('b'); b.textContent = name; info.appendChild(b);
    info.appendChild(document.createTextNode(
      `\nTriangles: ${s.tris.toLocaleString('en-US')}\nMeshes: ${s.meshes}  Materials: ${s.mats}` +
      `\nTextures: ${textureCount(model)} loaded` + (missing.length ? `, ${missing.length} missing` : '') +
      `\nSize: ${fmt(size.x)} x ${fmt(size.y)} x ${fmt(size.z)}` +
      `\nAnimations: ${clips.length ? clips.map((c) => `${c.name || 'clip'} (${c.duration.toFixed(2)}s)`).slice(0, 6).join(', ') + (clips.length > 6 ? ` ...(${clips.length})` : '') : 'none'}`));
  }
  function showError(msg) { const e = q('err'); e.textContent = msg || ''; e.hidden = !msg; }

  // ---------------------------------------------------------------- animation controls

  let mixer = null, action = null, clips = [], playing = !reduceMotion, loop = true, speed = 1;
  const playBtn = q('play'), scrub = q('scrub'), timeEl = q('time'), clipSel = q('clips');
  const setPlayIcon = () => {
    playBtn.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  };

  function setClips(list) {
    clips = list;
    clipSel.textContent = '';
    list.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = `${c.name || 'clip ' + (i + 1)} (${c.duration.toFixed(1)}s)`;
      clipSel.appendChild(o);
    });
    q('ctl').hidden = !list.length;
    if (list.length) selectClip(0);
  }
  function selectClip(i) {
    if (!mixer) return;
    mixer.stopAllAction();
    action = mixer.clipAction(clips[i]);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.reset().play();
    mixer.timeScale = speed;
    mixer.update(0);
    setPlayIcon();
  }
  playBtn.addEventListener('click', () => togglePlay());
  function togglePlay() {
    if (!action) return;
    if (!playing && !loop && action.time >= action.getClip().duration - 1e-3) { action.reset().play(); }
    playing = !playing;
    setPlayIcon();
  }
  clipSel.addEventListener('change', () => selectClip(+clipSel.value));
  q('speed').addEventListener('change', (e) => { speed = +e.target.value; if (mixer) mixer.timeScale = speed; });
  q('loop').addEventListener('change', (e) => {
    loop = e.target.checked;
    if (action) action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  });
  scrub.addEventListener('input', () => {
    if (!action) return;
    if (playing) { playing = false; setPlayIcon(); }
    action.paused = false;
    action.time = +scrub.value * action.getClip().duration;
    action.enabled = true;
    mixer.update(0);
  });

  // ---------------------------------------------------------------- keys (only while the viewer has focus)

  view.addEventListener('pointerdown', () => view.focus({ preventScroll: true }));
  view.addEventListener('keydown', (e) => {
    if (e.target !== view || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'r') resetView();
    else if (k === 'g') toggleGrid();
    else if (k === 'w') { wire = !wire; applyWire(); }
    else if (k === 'b') { bgMode = bgMode === 'dark' ? 'light' : 'dark'; scene.background = new THREE.Color(BG[bgMode]); }
    else if (k === ' ') togglePlay();
    else return;
    e.preventDefault();
  });

  // ---------------------------------------------------------------- show a model

  function show(root, name, list, missing) {
    if (model) { scene.remove(model); dispose(model); }
    if (grid) toggleGrid();
    model = root;
    scene.add(model);
    if (wire) applyWire();
    mixer = list.length ? new THREE.AnimationMixer(model) : null;
    action = null;
    setClips(list);
    model.updateMatrixWorld(true);
    frame(new THREE.Box3().setFromObject(model));
    showInfo(name, list, missing);
    q('title').textContent = name + ' - Orrery';
  }

  const demo = buildOrrery();
  show(demo.root, 'Brass orrery (built in code)', demo.clips, []);

  q('reset').addEventListener('click', () => {
    const d = buildOrrery();
    isDemo = true;
    showError('');
    show(d.root, 'Brass orrery (built in code)', d.clips, []);
    q('reset').hidden = true;
  });

  // ---------------------------------------------------------------- your own model (local only)

  const isRemote = (u) => /^(?!data:|blob:)(?:[a-z][a-z0-9+.-]+:|\/\/)/i.test(u.trim()) && !u.startsWith(location.origin + '/');
  const baseName = (u) => { let s = u; try { s = decodeURIComponent(u); } catch (e) { /* keep */ } return s.split(/[\\/]/).pop().split('?')[0].toLowerCase(); };

  async function openFiles(fileList) {
    const files = [...fileList];
    const main = files.find((f) => /\.(glb|gltf|fbx)$/i.test(f.name));
    if (!main) { showError('Choose a .glb, .gltf or .fbx file (with its textures and .bin files, if any).'); return; }
    const ext = main.name.split('.').pop().toLowerCase();
    const loading = q('loading');
    q('lname').textContent = main.name;
    loading.hidden = false;
    showError('');
    await new Promise((r) => setTimeout(r, 50));   // let the loading screen paint before a long parse

    const urls = new Map();
    for (const f of files) if (f !== main) urls.set(f.name.toLowerCase(), URL.createObjectURL(f));
    const missing = new Set(), blocked = new Set();
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (url.startsWith('blob:') || url.startsWith('data:')) return url;
      if (isRemote(url)) { blocked.add(url); return 'data:,'; }
      const hit = urls.get(baseName(url));
      if (hit) return hit;
      missing.add(baseName(url));
      return 'data:,';
    });

    try {
      const buf = await main.arrayBuffer();
      let root, list;
      if (ext === 'fbx') {
        const [{ FBXLoader }, { TGALoader }] = await Promise.all([
          import('three/addons/loaders/FBXLoader.js'), import('three/addons/loaders/TGALoader.js')]);
        manager.addHandler(/\.tga$/i, new TGALoader(manager));
        root = new FBXLoader(manager).parse(buf, '');
        list = root.animations || [];
      } else {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader(manager).parseAsync(buf, '');
        root = gltf.scene || gltf.scenes[0];
        list = gltf.animations || [];
      }
      // let texture requests settle so the overlay can count them
      await new Promise((r) => setTimeout(r, 400));
      isDemo = false;
      show(root, main.name, list, [...missing]);
      const lines = [];
      if (missing.size) lines.push('Missing textures (the mesh is still shown):', ...[...missing].slice(0, 8), 'Choose or drop them together with the model.');
      for (const u of [...blocked].slice(0, 6)) lines.push('remote resource blocked: ' + u.slice(0, 200));
      showError(lines.join('\n'));
      q('reset').hidden = false;
    } catch (e) {
      showError('Could not open ' + main.name + ': ' + (e && e.message ? e.message : String(e)));
    } finally {
      loading.hidden = true;
    }
  }

  const fileInput = q('file');
  fileInput.addEventListener('change', () => { if (fileInput.files.length) openFiles(fileInput.files); fileInput.value = ''; });
  let dragDepth = 0;
  view.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; q('drop').hidden = false; });
  view.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  view.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; q('drop').hidden = true; } });
  view.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; q('drop').hidden = true;
    if (e.dataTransfer.files.length) openFiles(e.dataTransfer.files);
  });

  // ---------------------------------------------------------------- loop, paused while off screen

  let visible = true;
  new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; if (visible) tick(); }).observe(view);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  const timer = new THREE.Timer();
  let raf = 0;
  function tick() {
    if (raf) return;
    raf = requestAnimationFrame(loopFrame);
  }
  function loopFrame(t) {
    raf = 0;
    if (!visible || document.hidden) return;
    timer.update(t);
    const dt = Math.min(timer.getDelta(), 0.1);
    if (mixer && playing && action) {
      mixer.update(dt);
      if (!action.isRunning() && !loop) { playing = false; setPlayIcon(); }
    }
    if (action) {
      const d = action.getClip().duration || 1;
      const tt = Math.min(action.time, d);
      if (document.activeElement !== scrub) scrub.value = String(tt / d);
      timeEl.textContent = `${tt.toFixed(2)} / ${d.toFixed(2)} s`;
    }
    controls.update();
    renderer.render(scene, camera);
    tick();
  }
  setPlayIcon();
  tick();
}

// ================================================================ the demo model

export function buildOrrery() {
  const root = new THREE.Group();
  root.name = 'Orrery';

  const brass = new THREE.MeshStandardMaterial({ name: 'Brass', color: 0xd4a94e, metalness: 1, roughness: 0.28 });
  const bronze = new THREE.MeshStandardMaterial({ name: 'Bronze', color: 0x9a7134, metalness: 1, roughness: 0.42 });
  const walnut = new THREE.MeshStandardMaterial({ name: 'Walnut', color: 0x3a2214, metalness: 0, roughness: 0.5 });
  const enamel = new THREE.MeshStandardMaterial({ name: 'Enamel', color: 0x1b1f4a, metalness: 0.2, roughness: 0.35 });

  // --- plinth and column (lathe profiles)
  const lathe = (pts, mat, seg = 96) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat);
  const plinth = lathe([[0, 0], [0.96, 0], [0.98, 0.03], [0.96, 0.08], [0.9, 0.1], [0.9, 0.16], [0.86, 0.2], [0, 0.2]], walnut);
  plinth.name = 'Plinth';
  root.add(plinth);

  const dial = new THREE.Mesh(new THREE.RingGeometry(0.64, 0.84, 128), enamel);
  dial.rotation.x = -Math.PI / 2; dial.position.y = 0.201; dial.name = 'Calendar_dial';
  root.add(dial);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.016, 12, 160), brass);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.205; rim.name = 'Dial_rim';
  root.add(rim);
  const rimIn = new THREE.Mesh(new THREE.TorusGeometry(0.635, 0.01, 10, 160), brass);
  rimIn.rotation.x = Math.PI / 2; rimIn.position.y = 0.205; rimIn.name = 'Dial_rim_inner';
  root.add(rimIn);

  // 72 ticks around the dial, every sixth one long (one instanced mesh)
  const tickGeo = new THREE.BoxGeometry(0.008, 0.006, 1);
  const ticks = new THREE.InstancedMesh(tickGeo, brass, 72);
  ticks.name = 'Dial_ticks';
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2, long = i % 6 === 0, len = long ? 0.11 : 0.05, r = 0.83 - len / 2;
    qt.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    sc.set(long ? 1.6 : 1, 1, len);
    m4.compose(new THREE.Vector3(Math.sin(a) * r, 0.206, Math.cos(a) * r), qt, sc);
    ticks.setMatrixAt(i, m4);
  }
  root.add(ticks);

  const column = lathe([[0, 0.2], [0.2, 0.2], [0.2, 0.23], [0.12, 0.27], [0.075, 0.33], [0.06, 0.7], [0.09, 0.74], [0.06, 0.78], [0.05, 1.42], [0, 1.42]], brass, 64);
  column.name = 'Column';
  root.add(column);

  // --- the gear train on the column: each wheel turns, so the clip has something mechanical to drive
  function gear(radius, teeth, depth, mat, name) {
    const shape = new THREE.Shape();
    const inner = radius * 0.9, step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i++) {
      const a = i * step;
      const pts = [[a, inner], [a + step * 0.18, radius], [a + step * 0.5, radius], [a + step * 0.68, inner]];
      pts.forEach(([ang, r], j) => {
        const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
        if (i === 0 && j === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
      });
    }
    shape.closePath();
    const spokes = 5, hubR = radius * 0.24, winR = radius * 0.72;
    for (let s = 0; s < spokes; s++) {
      const a0 = (s / spokes) * Math.PI * 2 + 0.16, a1 = ((s + 1) / spokes) * Math.PI * 2 - 0.16;
      const hole = new THREE.Path();
      hole.absarc(0, 0, winR, a0, a1, false);
      hole.absarc(0, 0, hubR + radius * 0.08, a1 - 0.05, a0 + 0.05, true);
      hole.closePath();
      shape.holes.push(hole);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1, curveSegments: 10 });
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    return mesh;
  }

  const arms = [];   // { pivot, name, turns }
  function pivot(name, y) {
    const p = new THREE.Group();
    p.name = name; p.position.y = y;
    root.add(p);
    return p;
  }
  const gearA = pivot('Gear_drive', 0.5); gearA.add(gear(0.3, 48, 0.022, bronze, 'Gear_drive_wheel'));
  const gearB = pivot('Gear_mid', 0.95); gearB.add(gear(0.22, 36, 0.02, brass, 'Gear_mid_wheel'));
  const gearC = pivot('Gear_top', 1.22); gearC.add(gear(0.16, 28, 0.018, bronze, 'Gear_top_wheel'));

  // --- the sun
  const sunMat = new THREE.MeshStandardMaterial({ name: 'Sun', color: 0xffc75f, emissive: 0xffa21f, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.4 });
  const sunMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 5), sunMat);
  sunMesh.position.y = 1.72; sunMesh.name = 'Sun';
  root.add(sunMesh);
  const sunPost = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.24, 20), brass);
  sunPost.position.y = 1.6; sunPost.name = 'Sun_post';
  root.add(sunPost);
  const glow = new THREE.PointLight(0xffc27a, 2.2, 0, 1.4);
  glow.position.y = 1.72;
  root.add(glow);

  // --- banded textures for the gas giants, drawn on a canvas
  function bands(colors, name) {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 128;
    const g = c.getContext('2d');
    let y = 0;
    while (y < 128) {
      const h = 4 + ((y * 7919) % 11);
      g.fillStyle = colors[(y / 4 | 0) % colors.length];
      g.fillRect(0, y, 16, h);
      y += h;
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.name = name;
    return t;
  }

  // --- planets: each on an arm from a coaxial sleeve, raised on a post to the plane of the sun
  const PLANE = 1.72;
  const planets = [
    { name: 'Mercury', r: 0.3, size: 0.035, color: 0xa8a29a, turns: 9 },
    { name: 'Venus', r: 0.44, size: 0.055, color: 0xe9d6a6, turns: 6 },
    { name: 'Earth', r: 0.62, size: 0.06, color: 0x3f7fe0, turns: 4, moon: true },
    { name: 'Mars', r: 0.79, size: 0.045, color: 0xc65a33, turns: 3 },
    { name: 'Jupiter', r: 1.0, size: 0.11, tex: ['#d9b48a', '#b9875e', '#efe0c4', '#a5714f', '#e6cfa6'], turns: 2 },
    { name: 'Saturn', r: 1.24, size: 0.09, tex: ['#e8d6a2', '#cdb27a', '#f2e6c2', '#bfa36c'], turns: 1, ring: true },
  ];
  const spinners = [];
  planets.forEach((p, i) => {
    const armY = 1.36 + i * 0.03;
    const arm = pivot(p.name + '_arm', armY);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.062 + i * 0.004, 0.062 + i * 0.004, 0.022, 32), i % 2 ? bronze : brass);
    sleeve.name = p.name + '_sleeve';
    arm.add(sleeve);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, p.r, 12), brass);
    rod.rotation.z = Math.PI / 2; rod.position.x = p.r / 2; rod.name = p.name + '_rod';
    arm.add(rod);
    const postH = PLANE - armY;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, postH, 10), brass);
    post.position.set(p.r, postH / 2, 0); post.name = p.name + '_post';
    arm.add(post);

    const mat = p.tex
      ? new THREE.MeshStandardMaterial({ name: p.name, map: bands(p.tex, p.name + '_bands'), roughness: 0.6, metalness: 0 })
      : new THREE.MeshStandardMaterial({ name: p.name, color: p.color, roughness: 0.55, metalness: 0.05 });
    const body = new THREE.Group();
    body.name = p.name + '_spin';
    body.position.set(p.r, postH, 0);
    body.rotation.z = 0.2;
    arm.add(body);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(p.size, 40, 24), mat);
    ball.name = p.name;
    body.add(ball);
    spinners.push({ node: body, turns: p.turns * 6 });

    if (p.ring) {
      const ringMat = new THREE.MeshStandardMaterial({ name: 'Saturn_ring', color: 0xcbb37e, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
      const ring = new THREE.Mesh(new THREE.RingGeometry(p.size * 1.35, p.size * 2.2, 96), ringMat);
      ring.rotation.x = -Math.PI / 2 + 0.45; ring.name = 'Saturn_ring';
      body.add(ring);
    }
    if (p.moon) {
      const moonArm = new THREE.Group();
      moonArm.name = 'Moon_arm';
      moonArm.position.set(p.r, postH, 0);
      arm.add(moonArm);
      const moonRod = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.11, 8), brass);
      moonRod.rotation.z = Math.PI / 2; moonRod.position.x = 0.055; moonRod.name = 'Moon_rod';
      moonArm.add(moonRod);
      const moon = new THREE.Mesh(new THREE.SphereGeometry(0.018, 24, 16), new THREE.MeshStandardMaterial({ name: 'Moon', color: 0xd8d6d0, roughness: 0.8 }));
      moon.position.x = 0.11; moon.name = 'Moon';
      moonArm.add(moon);
      arms.push({ node: moonArm, turns: 16 });
    }
    // start the planets spread out, not in a line
    arm.rotation.y = i * 2.1;
    arms.push({ node: arm, turns: p.turns, phase: i * 2.1 });
  });

  // --- clips: "Orbit" turns everything a whole number of times so it loops seamlessly,
  //     "Alignment" swings the planets into a line and back
  const Y = new THREE.Vector3(0, 1, 0);
  // The node's rest rotation (an arm's starting angle, a planet's axial tilt) is kept: the turn is
  // applied about the node's own Y axis on top of it.
  function spinTrack(node, turns, duration) {
    const keys = Math.max(8, Math.abs(turns) * 8), times = [], values = [];
    const spin = new THREE.Quaternion(), out = new THREE.Quaternion();
    const base = node.quaternion.clone();
    for (let k = 0; k <= keys; k++) {
      spin.setFromAxisAngle(Y, (k / keys) * turns * Math.PI * 2);
      out.copy(base).multiply(spin);
      times.push((k / keys) * duration);
      values.push(out.x, out.y, out.z, out.w);
    }
    return new THREE.QuaternionKeyframeTrack(node.name + '.quaternion', times, values);
  }
  const ORBIT = 36;
  const orbitTracks = [];
  for (const a of arms) orbitTracks.push(spinTrack(a.node, a.turns, ORBIT));
  for (const s of spinners) orbitTracks.push(spinTrack(s.node, s.turns, ORBIT));
  orbitTracks.push(spinTrack(gearA, 1, ORBIT), spinTrack(gearB, -2, ORBIT), spinTrack(gearC, 3, ORBIT));
  const orbit = new THREE.AnimationClip('Orbit', ORBIT, orbitTracks);

  const ALIGN = 8, alignTracks = [];
  for (const a of arms) {
    if (a.phase === undefined) continue;
    const from = a.phase % (Math.PI * 2), to = -Math.PI / 4;
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const times = [], values = [], qq = new THREE.Quaternion();
    const steps = 16;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      // out to the line by the middle, hold, and back
      const e = u < 0.4 ? smooth(u / 0.4) : u < 0.6 ? 1 : smooth(1 - (u - 0.6) / 0.4);
      qq.setFromAxisAngle(Y, from + delta * e);
      times.push(u * ALIGN);
      values.push(qq.x, qq.y, qq.z, qq.w);
    }
    alignTracks.push(new THREE.QuaternionKeyframeTrack(a.node.name + '.quaternion', times, values));
  }
  const align = new THREE.AnimationClip('Alignment', ALIGN, alignTracks);

  return { root, clips: [orbit, align] };
}

function smooth(x) { return x * x * (3 - 2 * x); }
