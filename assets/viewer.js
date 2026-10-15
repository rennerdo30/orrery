import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const post = (m) => { try { window.ipc.postMessage(m); } catch (e) { /* not hosted */ } };
const $ = (id) => document.getElementById(id);
const ROOT_URL = '/m/';

// ---------------------------------------------------------------- scene

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

let model = null, grid = null, wire = false, loadId = 0;
const home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const showError = (msg) => { const e = $('err'); e.textContent = msg; e.style.display = msg ? 'block' : 'none'; };
const showNote = (msg, warn) => { if (msg) post('log:NOTE ' + msg.split('\n').join(' | ')); const e = $('note'); e.textContent = msg; e.className = 'panel' + (warn ? ' warn' : ''); e.style.display = msg ? 'block' : 'none'; };

function dispose(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    for (const m of materialsOf(o)) {
      for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
      m.dispose();
    }
  });
}
const materialsOf = (o) => (o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []);

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
  model.traverse((o) => { for (const m of materialsOf(o)) m.wireframe = wire; });
}

// ---------------------------------------------------------------- loading screen

const loadingUi = {
  show(name) {
    document.documentElement.classList.add('loading');
    $('lname').textContent = name;
    this.set(0, 'Reading...');
  },
  set(_progress, text) { $('lstat').textContent = text; },
  hide() { document.documentElement.classList.remove('loading'); },
};
// Let the browser paint the loading screen before a long synchronous parse starts.
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));

async function readFile(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not read the file (' + res.status + ')');
  const total = parseInt(res.headers.get('content-length') || '0', 10);
  if (!res.body || !total) { onProgress(-1, 0); return await res.arrayBuffer(); }
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) throw new Error('Unexpected file size');
    out.set(value, got);
    got += value.length;
    onProgress(got / total, got);
  }
  return out.buffer;
}

// ---------------------------------------------------------------- textures

// TGA / PSD / TIFF requests from FBX files: sniff the bytes, decode PNG/JPEG natively, TGA with TGALoader.
class SmartTextureLoader extends THREE.Loader {
  load(url, onLoad, onProgress, onError) {
    const tex = new THREE.Texture();
    const full = this.manager.resolveURL(url);
    this.manager.itemStart(url);
    const fail = (e) => { this.manager.itemError(url); this.manager.itemEnd(url); if (onError) onError(e); };
    fetch(full).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); }).then(async (buf) => {
      const b = new Uint8Array(buf);
      const isImg = (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x47 && b[1] === 0x49) || (b[0] === 0x42 && b[1] === 0x4d) || (b[0] === 0x52 && b[1] === 0x49);
      if (isImg) {
        const img = new Image();
        const u = URL.createObjectURL(new Blob([buf]));
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('undecodable image')); img.src = u; });
        tex.image = img;
      } else if (b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53) {
        throw new Error('PSD files are not supported (export a PNG/TGA)');
      } else {
        const d = new TGALoader().parse(buf);
        const c = document.createElement('canvas');
        c.width = d.width; c.height = d.height;
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.data.buffer), d.width, d.height), 0, 0);
        tex.image = c;
      }
      tex.needsUpdate = true;
      if (onLoad) onLoad(tex);
      this.manager.itemEnd(url);
    }).catch(fail);
    return tex;
  }
}

// Remote resources are never fetched: any URL with a scheme other than data:/blob: (or scheme-relative
// "//host") is replaced by a local 404 and reported. (index.html also carries a CSP.)
const blockedUrls = new Set();
const isRemote = (u) => {
  if (u.startsWith(location.origin + '/')) return false;
  return /^(?!data:|blob:)(?:[a-z][a-z0-9+.-]+:|\/\/)/i.test(u.trim());
};
const blockedLines = () => [...blockedUrls].slice(0, 6).map((u) => 'remote resource blocked: ' + u.slice(0, 200));

const NON_MODEL = /\.(png|jpe?g|gif|bmp|webp|tga|psd|tiff?|dds|ktx2?)$/i;

function makeManager(failed) {
  const m = new THREE.LoadingManager();
  m.__waiters = [];
  m.onStart = () => { m.__started = true; m.__done = false; };
  m.onLoad = () => { m.__done = true; m.__waiters.splice(0).forEach((f) => f()); };
  m.onError = (url) => { if (url !== '/blocked') failed.add(prettyName(url)); };
  // Kept on the manager so later modifiers can wrap it instead of replacing the remote block.
  m.__baseModifier = (url) => {
    if (isRemote(url)) { blockedUrls.add(url); return '/blocked'; }
    // Texture paths written by DCC tools (backslashes, drive letters, "..") go to the host's resolver.
    if (url.startsWith(ROOT_URL)) {
      const rest = safeDecode(url.slice(ROOT_URL.length));
      if (/[\\:]|\.\.\//.test(rest)) return '/t/' + encodeURIComponent(rest);
    }
    return url;
  };
  m.setURLModifier(m.__baseModifier);
  m.addHandler(/\.(tga|psd|tiff?|dds)$/i, new SmartTextureLoader(m));
  return m;
}
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
const prettyName = (url) => safeDecode(url.replace(/^\/(m|t)\//, '')).split(/[\\/]/).pop();

function textureReport(root, failed) {
  const texs = new Set();
  root.traverse((o) => {
    for (const m of materialsOf(o)) for (const k in m) if (m[k] && m[k].isTexture) texs.add(m[k]);
  });
  let ok = 0;
  for (const t of texs) if (t.image && (t.image.width > 0 || t.image.data || t.image.videoWidth)) ok++;
  return { total: texs.size, ok, missing: [...failed] };
}

// ---------------------------------------------------------------- stats

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
const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(3));

// ---------------------------------------------------------------- parsing

// glTF with a missing external image rejects the whole parse. Check them first and stub missing ones
// so the mesh is still shown; the missing names are reported.
function gltfExternalImages(buf, ext) {
  try {
    let json;
    if (ext === 'glb') {
      const dv = new DataView(buf);
      const len = dv.getUint32(12, true);
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)));
    } else json = JSON.parse(new TextDecoder().decode(buf));
    return (json.images || []).map((i) => i.uri).filter((u) => u && !u.startsWith('data:'));
  } catch (e) { return []; }
}
const STUB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8c+fOfwAIpAN+3o9bjQAAAABJRU5ErkJggg==';

async function parseModel(buf, ext, failed) {
  const manager = makeManager(failed);
  if (ext === 'fbx') {
    return { root: new FBXLoader(manager).parse(buf, ROOT_URL), clips: null, manager };
  }
  if (ext === 'glb' || ext === 'gltf') {
    const missing = new Set();
    await Promise.all(gltfExternalImages(buf, ext).map(async (u) => {
      if (isRemote(u)) { blockedUrls.add(u); return; }
      try { const r = await fetch(ROOT_URL + u.split('/').map(encodeURIComponent).join('/')); if (!r.ok) throw 0; } catch (e) { missing.add(u); }
    }));
    if (missing.size) {
      for (const u of missing) failed.add(u.split('/').pop());
      manager.setURLModifier((url) => (NON_MODEL.test(safeDecode(url)) && [...missing].some((u) => safeDecode(url).endsWith(u)) ? STUB : manager.__baseModifier(url)));
    }
    const g = await new Promise((res, rej) => new GLTFLoader(manager).parse(buf, ROOT_URL, res, rej));
    return { root: g.scene, clips: g.animations || [], manager };
  }
  throw new Error('Unsupported file type: .' + ext);
}

// ---------------------------------------------------------------- animation

const entries = [];            // { name, group, clip, locked }
let mixer = null, action = null, current = -1, playing = true, speed = 1, loop = true, lockRoot = false, scrubbing = false;
const clock = new THREE.Clock();
let restPose = new Map();

function resetAnimation() {
  if (mixer) mixer.stopAllAction();
  mixer = null; action = null; current = -1; entries.length = 0;
  $('ctl').style.display = 'none';
}

function rootLocked(entry) {
  if (entry.locked) return entry.locked;
  const c = entry.clip.clone();
  for (const t of c.tracks) {
    if (!t.name.endsWith('.position')) continue;
    const node = model.getObjectByName(THREE.PropertyBinding.parseTrackName(t.name).nodeName);
    if (!node || (node.parent && node.parent.isBone)) continue;
    const v = t.values;
    for (let i = 3; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
  }
  entry.locked = c;
  return c;
}

function buildClipSelect() {
  const sel = $('clips');
  sel.innerHTML = '';
  const groups = new Map();
  entries.forEach((e, i) => {
    if (!groups.has(e.group)) { const g = document.createElement('optgroup'); g.label = e.group; sel.appendChild(g); groups.set(e.group, g); }
    const o = document.createElement('option');
    o.value = i; o.textContent = e.name;
    groups.get(e.group).appendChild(o);
  });
  sel.value = current;
}

function selectClip(i) {
  if (!model || !entries[i]) return;
  if (!mixer) mixer = new THREE.AnimationMixer(model);
  mixer.stopAllAction();
  const e = entries[i];
  current = i;
  action = mixer.clipAction(lockRoot ? rootLocked(e) : e.clip);
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  action.clampWhenFinished = true;
  action.reset().play();
  mixer.timeScale = speed;
  playing = true;
  $('clips').value = i;
  $('scrub').max = e.clip.duration;
  $('play').innerHTML = '&#10074;&#10074;';
  updateTime();
}

function togglePlay() {
  if (!action) return;
  if (!playing && !action.isRunning() && action.time >= action.getClip().duration - 1e-3) action.reset().play();
  playing = !playing;
  $('play').innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
}

function updateTime() {
  if (!action) return;
  const d = action.getClip().duration;
  const t = Math.min(action.time, d);
  if (!scrubbing) $('scrub').value = t;
  $('time').textContent = `${t.toFixed(2)} / ${d.toFixed(2)} s`;
  $('clips').title = `${entries[current].name} (${d.toFixed(2)} s)`;
}

function refreshControls() {
  $('ctl').style.display = entries.length ? 'flex' : 'none';
  buildClipSelect();
}

$('play').onclick = togglePlay;
$('clips').onchange = () => selectClip(parseInt($('clips').value, 10));
$('speed').onchange = () => { speed = parseFloat($('speed').value); if (mixer) mixer.timeScale = speed; };
$('loop').onchange = () => { loop = $('loop').checked; if (action) { action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); } };
$('lock').onchange = () => { lockRoot = $('lock').checked; if (current >= 0) { const t = action ? action.time : 0; selectClip(current); action.time = t; mixer.update(0); } };
const scrub = $('scrub');
scrub.oninput = () => {
  if (!action) return;
  scrubbing = true;
  if (playing) { playing = false; $('play').innerHTML = '&#9654;'; }
  action.time = parseFloat(scrub.value);
  mixer.update(0);
  updateTime();
};
scrub.onchange = () => { scrubbing = false; };
$('addanim').onclick = () => $('file').click();
$('file').onchange = async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (f) await addLibrary(f.name, await f.arrayBuffer());
};

// --- animation library binding

const sanitize = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
const PREFIXES = ['mixamorig', 'armature', 'bip001', 'bip01', 'skeleton'];
function keyOf(name) {
  let k = name.toLowerCase();
  k = k.replace(/^.*[|:]/, '');            // namespace / "Armature|Bone"
  k = k.replace(/[^a-z0-9]/g, '');         // spaces, underscores, dots...
  return k;
}
function keyVariants(name) {
  const k = keyOf(name), out = [k];
  for (const p of PREFIXES) if (k.startsWith(p) && k.length > p.length) out.push(k.slice(p.length));
  return out;
}
const trackNode = (t) => { const i = t.name.indexOf('.'); return i < 0 ? t.name : t.name.slice(0, i); };

function median(a) { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 1; }

async function addLibrary(fileName, buf) {
  if (!model) { showError('Open a model first, then add animations to it.'); return; }
  showError('');
  blockedUrls.clear();
  const ext = fileName.split('.').pop().toLowerCase();
  const group = fileName;
  const lib = loadingUi;
  lib.show(fileName); lib.set(-1, 'Parsing animations...');
  await nextFrame();
  let parsed;
  const failed = new Set();
  try { parsed = await parseModel(buf, ext, failed); } catch (e) { lib.hide(); showError('Failed to read animations from ' + fileName + '\n' + (e.message || e)); return; }
  const clips = parsed.clips || parsed.root.animations || [];
  if (!clips.length) { lib.hide(); dispose(parsed.root); showNote(`${fileName}: no animation clips found.`, true); return; }

  // model nodes by exact sanitized name and by normalised key
  const exact = new Map(), byKey = new Map();
  model.traverse((o) => {
    if (!o.name) return;
    if (!exact.has(o.name)) exact.set(o.name, o);
    for (const k of keyVariants(o.name)) if (!byKey.has(k)) byKey.set(k, o);
  });
  const libNodes = new Map();
  parsed.root.traverse((o) => { if (o.name && !libNodes.has(o.name)) libNodes.set(o.name, o); });

  const animated = new Set();
  for (const c of clips) for (const t of c.tracks) animated.add(trackNode(t));
  const map = new Map();   // library node name -> model node name
  let viaNorm = 0;
  for (const n of animated) {
    if (exact.has(n)) { map.set(n, n); continue; }
    for (const k of keyVariants(n)) {
      const hit = byKey.get(k);
      if (hit) { map.set(n, hit.name); viaNorm++; break; }
    }
  }

  // unit scale: median ratio of local bone offsets (model / library), and rest-pose difference
  const ratios = [];
  let restDiff = 0, restN = 0;
  for (const [ln, mn] of map) {
    const a = libNodes.get(ln), b = exact.get(mn), rp = restPose.get(mn);
    if (!a || !b) continue;
    const la = a.position.length(), lb = rp ? rp.p.length() : b.position.length();
    if (la > 1e-6 && lb > 1e-6) ratios.push(lb / la);
    if (rp && a.isBone) { restN++; if (2 * Math.acos(Math.min(1, Math.abs(rp.q.dot(a.quaternion)))) > 0.1) restDiff++; }
  }
  const ratio = ratios.length >= 3 ? median(ratios) : 1;
  const scaled = Math.abs(ratio - 1) > 0.05;

  const matched = map.size, total = animated.size;
  if (matched === 0) {
    lib.hide(); dispose(parsed.root);
    showNote(`${fileName}: no bone names match the current model (0/${total}). This library uses a different rig; nothing was added.
Library bones: ${[...animated].slice(0, 4).join(', ')}...
Model nodes: ${[...exact.keys()].slice(0, 4).join(', ')}...`, true);
    return;
  }
  const q = new THREE.Quaternion();
  const compensate = restN >= 5 && restDiff / restN > 0.3;
  let added = 0;
  for (const c of clips) {
    const tracks = [];
    for (const t of c.tracks) {
      const mn = map.get(trackNode(t));
      if (!mn) continue;
      const nt = t.clone();
      nt.name = mn + t.name.slice(trackNode(t).length);
      const rp = restPose.get(mn), lp = libNodes.get(trackNode(t));
      const v = nt.values;
      if (rp && lp && t.name.endsWith('.position')) {
        // offset from the library's rest position, scaled to this model, added to the model's own rest position
        const k = scaled ? ratio : 1;
        for (let i = 0; i < v.length; i += 3) {
          v[i] = rp.p.x + (v[i] - lp.position.x) * k;
          v[i + 1] = rp.p.y + (v[i + 1] - lp.position.y) * k;
          v[i + 2] = rp.p.z + (v[i + 2] - lp.position.z) * k;
        }
      } else if (rp && lp && t.name.endsWith('.quaternion') && compensate) {
        // local delta from the library's rest rotation, applied on the model's rest rotation
        const pre = rp.q.clone().multiply(lp.quaternion.clone().invert());
        for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i); q.premultiply(pre); q.toArray(v, i); }
      }
      tracks.push(nt);
    }
    if (!tracks.length) continue;
    entries.push({ name: c.name || 'clip', group, clip: new THREE.AnimationClip(c.name || 'clip', c.duration, tracks) });
    added++;
  }
  dispose(parsed.root);
  const warnLow = matched / total < 0.3 || matched < 5;
  const warnRest = compensate;
  let msg = `${fileName}: matched ${matched}/${total} bones (${viaNorm ? viaNorm + ' by normalised name' : 'exact names'}), ${added} clips added`;
  msg += scaled ? `, position scale x${ratio.toPrecision(3)}.` : '.';
  msg += ' Name binding' + (compensate ? ' with rest-pose delta' : '') + ', positions relative to rest (retargetClip not used).';
  if (warnLow) msg += '\nWarning: very few bones match; this is probably a different rig.';
  if (warnRest) msg += `\nWarning: rest poses differ on ${restDiff}/${restN} bones; rotations were corrected with a local rest delta, not a full retarget, so check the motion.`;
  showNote(msg, warnLow || warnRest);
  post('log:LIB ' + msg.replace(/\n/g, ' | '));
  const firstNew = entries.findIndex((e) => e.group === group);
  refreshControls();
  if (firstNew >= 0) selectClip(firstNew);
  await nextFrame();
  lib.hide();
}
window.addLibrary = addLibrary;

// ---------------------------------------------------------------- load

window.loadFile = async function (name) {
  const id = ++loadId;
  const failed = new Set();
  blockedUrls.clear();
  loadingUi.show(name);
  showError(''); showNote('');
  document.title = name;
  post('title:' + name);
  $('hint').style.display = 'none';
  if (model) { scene.remove(model); dispose(model); model = null; }
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid = null; }
  resetAnimation();
  $('info').style.display = 'none';

  const ext = name.split('.').pop().toLowerCase();
  try {
    const buf = await readFile(ROOT_URL + encodeURIComponent(name), (p, got) =>
      loadingUi.set(p, p < 0 ? 'Reading...' : `Reading... ${(got / 1048576).toFixed(1)} / ${(buf0(p, got) / 1048576).toFixed(1)} MB`));
    if (id !== loadId) return;
    loadingUi.set(-1, 'Parsing...');
    await nextFrame();
    const { root, clips, manager } = await parseModel(buf, ext, failed);
    if (id !== loadId) { dispose(root); return; }
    loadingUi.set(-1, 'Loading textures...');
    await settle(manager, 6000);
    model = root;
    scene.add(model);
    applyWire();
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) throw new Error('The file loaded but contains no visible geometry.');
    const size = box.getSize(new THREE.Vector3());
    const boxSize = Math.max(size.x, size.y, size.z);
    grid = new THREE.GridHelper(Math.max(boxSize * 2, 1e-3), 20, 0x888888, 0x555555);
    grid.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    scene.add(grid);
    frame(box);

    restPose = new Map();
    model.traverse((o) => { if (o.name && !restPose.has(o.name)) restPose.set(o.name, { p: o.position.clone(), q: o.quaternion.clone() }); });
    const own = clips || root.animations || [];
    own.forEach((c, i) => entries.push({ name: c.name || ('clip ' + (i + 1)), group: 'Model', clip: c }));
    if (entries.length) { refreshControls(); selectClip(0); }

    const s = stats(model);
    const tr = textureReport(model, failed);
    const info = $('info');
    info.style.display = 'block';
    info.textContent = '';
    const b = document.createElement('b'); b.textContent = name; info.appendChild(b);
    info.appendChild(document.createTextNode(
      `\nTriangles: ${s.tris.toLocaleString()}\nMeshes: ${s.meshes}  Materials: ${s.mats}` +
      `\nTextures: ${tr.ok} loaded` + (tr.missing.length ? `, ${tr.missing.length} missing` : '') +
      `\nSize: ${fmt(size.x)} x ${fmt(size.y)} x ${fmt(size.z)}` +
      `\nAnimations: ${own.length ? own.map((c) => `${c.name || 'clip'} (${c.duration.toFixed(2)}s)`).slice(0, 6).join(', ') + (own.length > 6 ? ` ...(${own.length})` : '') : 'none'}`));
    if (tr.missing.length || blockedUrls.size) {
      const lines = [];
      if (tr.missing.length) lines.push('Missing textures (the mesh is still shown):', ...tr.missing.slice(0, 8), ...(tr.missing.length > 8 ? [`...and ${tr.missing.length - 8} more`] : []));
      lines.push(...blockedLines());
      showError(lines.join('\n'));
    }
    post(`log:${(tr.missing.length || blockedUrls.size) ? 'WARN' : 'OK'} ${name} tris=${s.tris} meshes=${s.meshes} mats=${s.mats} texs_ok=${tr.ok}/${tr.total} missing=[${tr.missing.join(',')}] clips=${own.length}${blockedUrls.size ? " " + blockedLines().join("; ") : ""}`);
    await nextFrame();   // hide the loader only after the first rendered frame of the model
    loadingUi.hide();
    if (window.__LIB) await window.onDrop(window.__LIB, true);
    if (window.__SHOT) afterShot();
  } catch (e) {
    loadingUi.hide();
    const msg = (e && e.message) ? e.message : String(e);
    showError('Failed to load ' + name + '\n' + msg + (blockedUrls.size ? '\n' + blockedLines().join('\n') : ''));
    post(`log:ERROR ${name} ${msg}${blockedUrls.size ? " | " + blockedLines().join("; ") : ""}`);
    if (window.__SHOT) afterShot();
  }
};
const buf0 = (p, got) => got / Math.max(p, 1e-9);

function settle(manager, ms) {
  return new Promise((res) => {
    if (!manager.__started || manager.__done) return res();
    manager.__waiters.push(res);
    setTimeout(res, ms);
  });
}

// Screenshot hook (--screenshot): let animations advance a little, then capture.
function afterShot() {
  const wait = window.__SHOTWAIT || 0;
  setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => post('shot:' + renderer.domElement.toDataURL('image/png')))), wait + 300);
}

// A drop is announced by the host: plain drop replaces the model, Shift+drop adds its animations.
let shiftDown = false;
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftDown = true; });
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; });
window.addEventListener('blur', () => { shiftDown = false; });
window.onDrop = async function (name, shift) {
  if (shift || shiftDown) {
    try { await addLibrary(name, await readFile('/drop', () => {})); } catch (e) { showError('Could not read ' + name + ': ' + e.message); }
  } else post('adopt:' + name);
};

window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') && e.key !== ' ') return;
  const k = e.key.toLowerCase();
  if (k === 'r') resetView();
  else if (k === 'g' && grid) grid.visible = !grid.visible;
  else if (k === 'w') { wire = !wire; applyWire(); }
  else if (k === 'b') {
    bgMode = bgMode === 'dark' ? 'light' : 'dark';
    scene.background = new THREE.Color(BG[bgMode]);
    document.body.style.background = '#' + BG[bgMode].toString(16);
  } else if (e.key === ' ') { e.preventDefault(); if (document.activeElement) document.activeElement.blur(); togglePlay(); }
});

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (mixer && playing) { mixer.update(dt); if (action && !action.isRunning() && !loop) { playing = false; $('play').innerHTML = '&#9654;'; } }
  if (action) updateTime();
  controls.update();
  renderer.render(scene, camera);
});

if (window.__INITIAL) window.loadFile(window.__INITIAL);
