import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const post = (m) => { try { window.ipc.postMessage(m); } catch (e) {} };
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!window.__SHOT });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
document.body.prepend(renderer.domElement);

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

let model = null, grid = null, mixer = null, wire = false, loadId = 0, boxSize = 1;
const clock = new THREE.Clock();
const home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function showError(msg) { const e = $('err'); e.textContent = msg; e.style.display = msg ? 'block' : 'none'; }

function dispose(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
      m.dispose();
    }
  });
}

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

function applyWire() {
  if (!model) return;
  model.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) m.wireframe = wire;
  });
}

function stats(root) {
  let tris = 0, meshes = 0;
  const mats = new Set(), texs = new Set();
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    meshes++;
    const g = o.geometry;
    if (g) tris += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (!m) continue;
      mats.add(m);
      for (const k in m) if (m[k] && m[k].isTexture) texs.add(m[k]);
    }
  });
  return { tris: Math.round(tris), meshes, mats: mats.size, texs: texs.size };
}

function playClip(clips, i) {
  if (!mixer) return;
  mixer.stopAllAction();
  if (i >= 0 && clips[i]) mixer.clipAction(clips[i]).reset().play();
}

function setupClips(clips) {
  const sel = $('clips'), bar = $('bar');
  sel.innerHTML = '';
  if (!clips.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const none = document.createElement('option'); none.value = -1; none.textContent = '(none)'; sel.appendChild(none);
  clips.forEach((c, i) => { const o = document.createElement('option'); o.value = i; o.textContent = c.name || ('clip ' + i); sel.appendChild(o); });
  sel.value = 0;
  sel.onchange = () => playClip(clips, parseInt(sel.value, 10));
  mixer = new THREE.AnimationMixer(model);
  playClip(clips, 0);
}

const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(3));

window.loadFile = async function (name) {
  const id = ++loadId;
  const failed = [];
  $('hint').style.display = 'none';
  showError('');
  document.title = name;
  post('title:' + name);
  if (model) { scene.remove(model); dispose(model); model = null; }
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid = null; }
  mixer = null;
  $('bar').style.display = 'none';

  const manager = new THREE.LoadingManager();
  manager.onError = (url) => failed.push(decodeURIComponent(url.replace(/^.*\/m\//, '')));
  const url = '/m/' + encodeURIComponent(name);
  const ext = name.split('.').pop().toLowerCase();
  try {
    let root, clips;
    if (ext === 'fbx') {
      root = await new FBXLoader(manager).loadAsync(url);
      clips = root.animations || [];
    } else if (ext === 'glb' || ext === 'gltf') {
      const g = await new GLTFLoader(manager).loadAsync(url);
      root = g.scene; clips = g.animations || [];
    } else throw new Error('Unsupported file type: .' + ext);
    if (id !== loadId) { dispose(root); return; }
    model = root;
    scene.add(model);
    applyWire();
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) throw new Error('The file loaded but contains no visible geometry.');
    const size = box.getSize(new THREE.Vector3());
    boxSize = Math.max(size.x, size.y, size.z);
    grid = new THREE.GridHelper(Math.max(boxSize * 2, 1e-3), 20, 0x888888, 0x555555);
    grid.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    scene.add(grid);
    frame(box);
    setupClips(clips);
    const s = stats(model);
    const info = $('info');
    info.style.display = 'block';
    info.textContent = '';
    const b = document.createElement('b'); b.textContent = name; info.appendChild(b);
    info.appendChild(document.createTextNode(
      `\nTriangles: ${s.tris.toLocaleString()}\nMeshes: ${s.meshes}  Materials: ${s.mats}  Textures: ${s.texs}` +
      `\nSize: ${fmt(size.x)} x ${fmt(size.y)} x ${fmt(size.z)}` +
      `\nAnimations: ${clips.length ? clips.map((c) => `${c.name || 'clip'} (${c.duration.toFixed(2)}s)`).join(', ') : 'none'}`));
    // Let pending texture loads settle before judging failures.
    setTimeout(() => {
      if (id !== loadId) return;
      if (failed.length) {
        const list = [...new Set(failed)];
        showError('Some files could not be loaded (the mesh is still shown):\n' + list.slice(0, 8).join('\n') + (list.length > 8 ? `\n...and ${list.length - 8} more` : ''));
        post(`log:WARN ${name} missing=${list.length} tris=${s.tris} meshes=${s.meshes} mats=${s.mats} texs=${s.texs} clips=${clips.length}`);
      } else {
        post(`log:OK ${name} tris=${s.tris} meshes=${s.meshes} mats=${s.mats} texs=${s.texs} clips=${clips.length}`);
      }
      if (window.__SHOT) requestAnimationFrame(() => requestAnimationFrame(() => post('shot:' + renderer.domElement.toDataURL('image/png'))));
    }, 400);
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    showError('Failed to load ' + name + '\n' + msg);
    post(`log:ERROR ${name} ${msg}`);
    if (window.__SHOT) post('shot:' + renderer.domElement.toDataURL('image/png'));
  }
};

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'r') resetView();
  else if (k === 'g' && grid) grid.visible = !grid.visible;
  else if (k === 'w') { wire = !wire; applyWire(); }
  else if (k === 'b') {
    bgMode = bgMode === 'dark' ? 'light' : 'dark';
    scene.background = new THREE.Color(BG[bgMode]);
    document.body.style.background = '#' + BG[bgMode].toString(16);
  }
});

renderer.setAnimationLoop(() => {
  if (mixer) mixer.update(clock.getDelta()); else clock.getDelta();
  controls.update();
  renderer.render(scene, camera);
});

if (window.__INITIAL) window.loadFile(window.__INITIAL);
