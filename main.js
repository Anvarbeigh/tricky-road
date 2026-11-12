import * as THREE from './vendor/three.module.js';
import { platform } from './platform.js';
import { t, setLang, applyTexts } from './i18n.js';
import { audio } from './audio.js';
import { initFx, fx } from './fx.js';
import { makeCar, stepCar, carCenter, carAngle, carSpeed, DT, WHEEL_R } from './physics.js';
import { LEVELS, WORLDS, buildLevel, updateLevel, holdAt, carOf } from './levels.js';

// ---------------------------------------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------------------------------------
const SKINS = [
  { price: 0, body: 0xff6b3d, roof: 0xfff1e0 },
  { price: 150, body: 0x3fd6a8, roof: 0xe8fff7 },
  { price: 300, body: 0xffb13d, roof: 0x5a2a7a },
  { price: 500, body: 0x2a3a7a, roof: 0x9fd0ff },
  { price: 800, body: 0xff5fa2, roof: 0xffffff },
  { price: 1500, body: 0xffd23d, roof: 0xfff6c8 },
];
const GIFT = [100, 50, 25];
const AD_GAP_MS = 3 * 60 * 1000;
const state = {
  coins: 0, stars: {}, skins: [0], skin: 0, cur: 0, best: 0, giftDay: '', giftStreak: 0, sound: true, music: true, lastSeen: Date.now(), tut: 0, adsSeen: 0,
};
function load(raw) {
  try {
    if (new URLSearchParams(location.search).has('reset')) return;
    if (!raw) return;
    Object.assign(state, JSON.parse(raw));
    if (!state.stars || typeof state.stars !== 'object') state.stars = {};
    if (!Array.isArray(state.skins)) state.skins = [0];
  } catch (e) { /* fresh start */ }
}
let saveTimer = 0;
function save(now = false) {
  state.lastSeen = Date.now();
  const s = JSON.stringify(state);
  platform.writeLocal(s);
  if (now) { platform.writeSave(s); return; }
  if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = 0; platform.writeSave(JSON.stringify(state)); }, 5000);
}
const starsOf = (i) => state.stars[i] || 0;
const unlockedUpTo = () => { let n = 0; while (n < LEVELS.length && starsOf(n) > 0) n++; return n; };  // first unfinished level index

// ---------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touch');
let panelOpen = null;
let panelPaused = false;
function openPanel(id) {
  closePanels(true);
  if (started && !panelPaused) { pause(); panelPaused = true; }   // before panelOpen is set, so the portal gets gameplayStop
  panelOpen = id; $(id).classList.add('open');
  audio.play('open', { vol: 0.6 });
}
// silent = no sound; the pause taken by openPanel is always given back
function closePanels(silent) {
  if (!panelOpen) return;
  $(panelOpen).classList.remove('open'); panelOpen = null;
  if (!silent) audio.play('close', { vol: 0.6 });
  if (panelPaused) { panelPaused = false; resume(); }
}
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closePanels()));
function toast(text, ms = 1600) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = text;
  el.style.animationDuration = ms + 'ms';
  $('toasts').appendChild(el); setTimeout(() => el.remove(), ms);
}
function setCoinsUI() { $('coins').textContent = state.coins; $('coinChip').classList.remove('bump'); void $('coinChip').offsetWidth; $('coinChip').classList.add('bump'); }

// ---------------------------------------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-20, 40, 30); scene.add(sun);
const hemi = new THREE.HemisphereLight(0xdfefff, 0x6a7a5a, 1.1); scene.add(hemi);
initFx(scene);
const world = new THREE.Group(); scene.add(world);          // everything that belongs to the current level
const bg = new THREE.Group(); scene.add(bg);                 // hills and clouds, parallax

const MAT = {};
const mat = (color, extra = {}) => { const k = color + JSON.stringify(extra); return MAT[k] || (MAT[k] = new THREE.MeshLambertMaterial({ color, ...extra })); };
const GEO = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 14), cone: new THREE.ConeGeometry(1, 1, 8), sph: new THREE.IcosahedronGeometry(1, 1), coin: new THREE.CylinderGeometry(0.42, 0.42, 0.12, 18), spike: new THREE.ConeGeometry(1, 1, 4), wheel: new THREE.CylinderGeometry(1, 1, 1, 12) };
const box = (w, h, d, color, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(GEO.box, mat(color)); m.scale.set(w, h, d); m.position.set(x, y, z); return m; };

const ROAD_D = 3.2;     // depth of the road ribbon
const shade = (hex, f) => { const c = new THREE.Color(hex); c.multiplyScalar(f); return c.getHex(); };
const mix = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();
const flatVC = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

// Triangle soup with per-vertex colours; every face gets its own normal, so edges stay crisp.
function soup() {
  const pos = [], col = [], tmp = new THREE.Color();
  const v = (p, c) => { pos.push(p[0], p[1], p[2]); tmp.setHex(c); col.push(tmp.r, tmp.g, tmp.b); };
  const quad = (a, b, c, d, ca, cb = ca, cc = cb, cd = ca) => { v(a, ca); v(b, cb); v(c, cc); v(a, ca); v(c, cc); v(d, cd); };
  const mesh = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, flatVC);
  };
  return { quad, mesh };
}
// The road: bright top with a worn driving track, a bevelled lip, a jagged topsoil band, then a side that
// fades into the dark, with rock strata on it. Thin pieces (planks, lifts) skip the soil.
function ribbon(pts, top, side, { depth = ROAD_D, thick = 16, track = null, z = 0 } = {}) {
  const S = soup(), F = z + depth / 2, B = z - depth / 2, soil = thick > 2;
  let seed = Math.floor(Math.abs(pts[0][0]) * 31 + pts.length * 7) | 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const deep = shade(side, 0.3), lip = mix(top, 0xffffff, 0.1), band = shade(top, 0.74);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    S.quad([x0, y0, F], [x1, y1, F], [x1, y1, B], [x0, y0, B], top);
    if (track) S.quad([x0, y0 + 0.012, 0.62], [x1, y1 + 0.012, 0.62], [x1, y1 + 0.012, -0.62], [x0, y0 + 0.012, -0.62], mix(top, track, 0.42));
    S.quad([x0, y0, F], [x1, y1, F], [x1, y1 - 0.14, F + 0.14], [x0, y0 - 0.14, F + 0.14], lip);
    const FF = F + 0.14;
    if (!soil) { S.quad([x0, y0 - 0.14, FF], [x1, y1 - 0.14, FF], [x1, y1 - thick, FF], [x0, y0 - thick, FF], side); continue; }
    // jagged topsoil band over the side face
    const n = Math.max(1, Math.round((x1 - x0) / 2.6));
    let dPrev = 0.3;
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n, d1 = k + 1 === n ? 0.3 : 0.14 + rnd() * rnd() * 0.5;
      const xa = x0 + (x1 - x0) * t0, xb = x0 + (x1 - x0) * t1, ya = y0 + (y1 - y0) * t0, yb = y0 + (y1 - y0) * t1;
      S.quad([xa, ya - 0.14, FF], [xb, yb - 0.14, FF], [xb, yb - 0.14 - d1, FF], [xa, ya - 0.14 - dPrev, FF], band);
      S.quad([xa, ya - 0.14 - dPrev, FF], [xb, yb - 0.14 - d1, FF], [xb, yb - thick, FF], [xa, ya - thick, FF], side, side, deep, deep);
      dPrev = d1;
    }
    // rock strata: low angular slabs
    for (let x = x0 + rnd() * 4; x < x1 - 1.2; x += 3 + rnd() * 6) {
      const w = 0.7 + rnd() * 1.5, dy = 1.1 + rnd() * 2.6, h = 0.22 + rnd() * 0.3;
      const y = y0 + (y1 - y0) * ((x - x0) / (x1 - x0)) - dy, c = shade(side, rnd() < 0.6 ? 0.84 : 1.12), zz = FF + 0.02;
      S.quad([x, y, zz], [x + w, y + 0.06, zz], [x + w * 0.82, y + h, zz], [x + w * 0.16, y + h * 0.84, zz], c);
    }
  }
  const cap = (x, y) => S.quad([x, y, F + 0.14], [x, y, B], [x, y - thick, B], [x, y - thick, F + 0.14], shade(side, 0.45), shade(side, 0.45), deep, deep);
  cap(pts[0][0], pts[0][1]); cap(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  return S.mesh();
}
// Bevelled prism from a side profile (x forward, y up), the base shape of vehicles and heavy traps.
function prism(points, depth, color, x = 0, y = 0, z = 0, opts = {}) {
  const sh = new THREE.Shape();
  points.forEach(([a, b], i) => (i ? sh.lineTo(a, b) : sh.moveTo(a, b)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: opts.bevel !== 0, bevelSize: opts.bevel ?? 0.05, bevelThickness: opts.bevel ?? 0.05, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(g, mat(color, { flatShading: true }));
  m.position.set(x, y, z);
  return m;
}
function stripes() {
  if (stripes.tx) return stripes.tx;
  const c = document.createElement('canvas'); c.width = 128; c.height = 32; const g = c.getContext('2d');
  g.fillStyle = '#ffc531'; g.fillRect(0, 0, 128, 32); g.fillStyle = '#20222c';
  for (let x = -32; x < 128; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 48, 0); g.lineTo(x + 32, 0); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return (stripes.tx = t);
}
const stripePlane = (w, h, x, y, z) => { const t = stripes().clone(); t.repeat.set(w / 2, 1); t.needsUpdate = true; const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t })); m.position.set(x, y, z); return m; };

function textTexture(text, { w = 512, h = 160, bg = '#f7e9c8', fg = '#3a2a1a', size = 56 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let fs = size; g.font = `900 ${fs}px Rubik, sans-serif`;
  while (g.measureText(text).width > w - 50 && fs > 18) { fs -= 3; g.font = `900 ${fs}px Rubik, sans-serif`; }
  g.fillText(text, w / 2, h / 2 + 2);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
  return tx;
}
function signMesh(x, y, text) {
  const g = new THREE.Group();
  g.add(box(0.16, 2.8, 0.16, 0x6a4420, -1.2, 1.4, 0)); g.add(box(0.16, 2.8, 0.16, 0x6a4420, 1.2, 1.4, 0));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 1.3), new THREE.MeshBasicMaterial({ map: textTexture(text, { bg: '#ffe066', fg: '#2a1a0a', size: 66 }) }));
  board.position.set(0, 2.6, 0.08); g.add(board);
  g.add(box(4.2, 1.5, 0.1, 0x3a2a1a, 0, 2.6, 0));
  g.position.set(x, y, -1.6);
  return g;
}
function treeMesh(x, y, s, w) {
  const g = new THREE.Group();
  if (w.id === 'moon') { const r = new THREE.Mesh(GEO.sph, mat(0x7a8097, { flatShading: true })); r.scale.set(0.9 * s, 0.6 * s, 0.9 * s); r.position.y = 0.3 * s; g.add(r); }
  else if (w.id === 'farm') { g.add(box(1.4 * s, 1 * s, 1.2 * s, 0xe0b25a, 0, 0.5 * s, 0)); g.add(box(1.4 * s, 0.1, 1.2 * s, 0xc98f3a, 0, 1.02 * s, 0)); }
  else if (w.id === 'mall') { g.add(box(0.2, 3.2 * s, 0.2, 0x9aa3b8, 0, 1.6 * s, 0)); const l = box(0.9, 0.3, 0.5, 0xfff3b0, 0, 3.2 * s, 0); g.add(l); }
  else {
    const kind = Math.floor(Math.abs(x * 3.7)) % 3;
    if (kind === 0) {        // pine
      g.add(box(0.3, 1 * s, 0.3, 0x6a4420, 0, 0.5 * s, 0));
      const c1 = new THREE.Mesh(GEO.cone, mat(0x2f8a4a, { flatShading: true })); c1.scale.set(1.2 * s, 1.8 * s, 1.2 * s); c1.position.y = 1.7 * s; g.add(c1);
      const c2 = new THREE.Mesh(GEO.cone, mat(0x3fa45a, { flatShading: true })); c2.scale.set(0.85 * s, 1.5 * s, 0.85 * s); c2.position.y = 2.6 * s; g.add(c2);
    } else if (kind === 1) { // round canopy on a real trunk
      g.add(box(0.34, 1.7 * s, 0.34, 0x7a5230, 0, 0.85 * s, 0));
      const c = new THREE.Mesh(GEO.sph, mat(0x5cc05a, { flatShading: true })); c.scale.set(1.35 * s, 1.15 * s, 1.2 * s); c.position.y = 2.5 * s; g.add(c);
    } else {                 // tall poplar
      g.add(box(0.24, 1.1 * s, 0.24, 0x7a5230, 0, 0.55 * s, 0));
      const c = new THREE.Mesh(GEO.sph, mat(0x46ab62, { flatShading: true })); c.scale.set(0.62 * s, 2.0 * s, 0.62 * s); c.position.y = 2.7 * s; g.add(c);
    }
  }
  g.position.set(x, y, -2.6 - Math.random() * 1.5);
  return g;
}
// bushes, flowers, rocks and the odd tree behind (and sometimes in front of) the road, seeded by position
function scatterDecor(pts, w) {
  let seed = Math.floor(pts[0][0] * 7 + pts[0][1] * 13 + pts.length) | 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const len = x1 - x0;
    if (len < 4) continue;
    for (let x = x0 + 2 + rnd() * 3; x < x1 - 1.5; x += 3 + rnd() * 4) {
      const y = y0 + (y1 - y0) * ((x - x0) / len);
      const r = rnd();
      const z = -2.3 - rnd() * 1.4;      // always behind the road: nothing may hide the car or a trap
      let m;
      if (w.id === 'moon') { m = new THREE.Mesh(GEO.sph, mat(r < 0.5 ? 0x7a8097 : 0x5d6478, { flatShading: true })); const s = 0.25 + rnd() * 0.5; m.scale.set(s * 1.4, s * 0.7, s); m.position.set(x, y + s * 0.3, z); }
      else if (w.id === 'mall') { if (r < 0.5) { m = box(0.8 + rnd() * 0.6, 0.6 + rnd() * 0.8, 0.8, [0xffb13d, 0x4dabf7, 0xff6b6b, 0x51cf66][Math.floor(rnd() * 4)]); m.position.set(x, y + m.scale.y / 2, z); } else { m = new THREE.Mesh(GEO.sph, mat(0x3fbf5a)); m.scale.set(0.5, 0.6, 0.5); m.position.set(x, y + 0.5, z); const pot = box(0.6, 0.5, 0.6, 0xc96b3a); pot.position.y = -0.4; m.add(pot); } }
      else if (w.id === 'farm') { if (r < 0.4) { m = box(1.2, 0.9, 1.0, 0xe0b25a); m.position.set(x, y + 0.45, z); } else { m = new THREE.Mesh(GEO.cone, mat(0xd9c26a)); m.scale.set(0.5, 1.2 + rnd() * 0.6, 0.5); m.position.set(x, y + m.scale.y / 2, z); } }
      else {
        if (r < 0.45) { m = new THREE.Mesh(GEO.sph, mat(rnd() < 0.5 ? 0x4aa84f : 0x5fbf5a, { flatShading: true })); const s = 0.35 + rnd() * 0.5; m.scale.set(s * 1.3, s, s); m.position.set(x, y + s * 0.6, z); }
        else if (r < 0.8) { m = box(0.16, 0.16, 0.16, [0xff6b8a, 0xffd43b, 0xffffff, 0xb197fc][Math.floor(rnd() * 4)]); m.position.set(x, y + 0.25, z); const stem = box(0.05, 0.3, 0.05, 0x3f9f4a); stem.position.y = -0.2; m.add(stem); }
        else { m = treeMesh(x, y, 0.7 + rnd() * 0.6, w); m.position.z = z - 0.5; }
      }
      world.add(m);
    }
  }
}
function flagMesh() {
  const g = new THREE.Group();
  g.add(box(0.14, 3.4, 0.14, 0xf0f0f0, 0, 1.7, 0));
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#222' : '#fff'; x.fillRect(i * 16, j * 16, 16, 16); }
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  const f = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0, 8, 1), new THREE.MeshBasicMaterial({ map: tx, side: THREE.DoubleSide }));
  f.position.set(0.85, 2.9, 0); g.add(f); g.flag = f;
  return g;
}

// Vehicles: wheels sit on the physics axle line (group origin = centre between the axles, y up from it).
// The body lives in its own group, so it can pitch and squash on the suspension while the wheels stay on the road.
function vehicleMesh(kind, skin) {
  const g = new THREE.Group(), b = new THREE.Group(); g.add(b); g.body = b;
  const main = SKINS[skin].body, accent = SKINS[skin].roof, GLASS = 0x7fe3ff, DARK = 0x2a2c38, LIGHT = 0xfff2b0;
  const wheels = [];
  const wheel = (x, r, w, y = 0, zs = [-0.62, 0.62]) => {
    for (const z of zs) {
      const p = new THREE.Group(); p.position.set(x, y, z);
      const t = new THREE.Mesh(GEO.wheel, mat(0x23242e, { flatShading: true })); t.rotation.x = Math.PI / 2; t.scale.set(r, w, r); p.add(t);
      const hub = new THREE.Mesh(GEO.wheel, mat(0xe6e8f0, { flatShading: true })); hub.rotation.x = Math.PI / 2; hub.scale.set(r * 0.55, w * 1.08, r * 0.55); p.add(hub);
      p.add(box(r * 1.0, r * 0.16, w * 1.14, 0x6a6e80));   // a bar across the hub: you can see the wheel turn
      g.add(p); wheels.push(p);
    }
  };
  const arc = (cx, r) => Array.from({ length: 7 }, (_, i) => { const a = Math.PI - i / 6 * Math.PI; return [cx + Math.cos(a) * r, Math.sin(a) * r]; });
  const arch = (x0, x1, top, r) => [[x0, 0.04], [-0.95 - r, 0.04], ...arc(-0.95, r), [0.95 - r, 0.04], ...arc(0.95, r), [x1, 0.04], ...top];
  if (kind === 'tractor') {
    b.add(prism([[-0.62, 0.3], [1.45, 0.2], [1.6, 0.42], [1.5, 0.86], [-0.62, 0.92]], 1.0, main));          // hood
    b.add(prism([[-1.3, 0.24], [-0.1, 0.24], [-0.14, 1.24], [-1.1, 1.24]], 1.14, main));                     // closed cab
    b.add(prism([[-1.0, 0.8], [-0.26, 0.8], [-0.28, 1.14], [-0.92, 1.14]], 1.24, GLASS, 0, 0, 0, { bevel: 0 }));
    b.add(box(1.4, 0.12, 1.34, accent, -0.68, 1.32, 0));
    b.add(box(0.16, 0.56, 0.16, DARK, 0.9, 1.12, 0.2)); b.add(box(0.14, 0.24, 0.9, LIGHT, 1.58, 0.56, 0));
    b.add(box(0.26, 0.22, 1.1, DARK, 1.66, 0.28, 0));
    wheel(-0.95, 0.62, 0.42, 0.18); wheel(0.95, 0.46, 0.34, 0.02);
  } else if (kind === 'cart') {
    b.add(prism([[-1.3, 0.4], [1.35, 0.4], [1.55, 1.2], [-1.45, 1.2]], 1.2, 0xc4ccdf, 0, 0, 0, { bevel: 0.03 }));
    for (let x = -1.0; x <= 1.2; x += 0.42) b.add(box(0.05, 0.86, 1.3, 0x7b839a, x, 0.8, 0));
    b.add(box(3.1, 0.1, 1.34, main, 0.05, 1.23, 0)); b.add(box(2.7, 0.1, 1.28, main, -0.05, 0.42, 0));
    b.add(box(0.1, 0.9, 0.1, DARK, -1.55, 1.5, 0.55)); b.add(box(0.1, 0.9, 0.1, DARK, -1.55, 1.5, -0.55)); b.add(box(0.12, 0.14, 1.3, main, -1.6, 1.92, 0));
    wheel(-0.95, 0.38, 0.2, 0, [-0.5, 0.5]); wheel(0.95, 0.38, 0.2, 0, [-0.5, 0.5]);
  } else if (kind === 'buggy') {
    b.add(prism(arch(-1.5, 1.5, [[1.66, 0.3], [1.34, 0.62], [-1.42, 0.62]], 0.6), 1.24, main));
    b.add(prism([[-0.92, 0.6], [0.72, 0.6], [0.4, 1.22], [-0.7, 1.22]], 1.14, 0xeef4ff, 0, 0, 0, { bevel: 0.05 }));
    b.add(prism([[-0.74, 0.7], [0.56, 0.7], [0.32, 1.12], [-0.6, 1.12]], 1.26, GLASS, 0, 0, 0, { bevel: 0 }));
    b.add(box(1.3, 0.08, 1.3, 0xffc531, -0.15, 1.3, 0));
    b.add(box(0.26, 0.2, 1.36, DARK, 1.62, 0.2, 0)); b.add(box(0.1, 0.18, 0.3, LIGHT, 1.62, 0.44, 0.42)); b.add(box(0.1, 0.18, 0.3, LIGHT, 1.62, 0.44, -0.42));
    wheel(-0.95, 0.5, 0.42, 0.04, [-0.68, 0.68]); wheel(0.95, 0.5, 0.42, 0.04, [-0.68, 0.68]);
  } else {  // chunky toy pickup
    b.add(prism(arch(-1.55, 1.5, [[1.62, 0.34], [1.42, 0.68], [0.5, 0.74], [-1.55, 0.74]], 0.56), 1.2, main));
    b.add(prism([[-0.78, 0.7], [0.62, 0.7], [0.3, 1.24], [-0.62, 1.24]], 1.1, accent, 0, 0, 0, { bevel: 0.04 }));
    b.add(prism([[-0.66, 0.78], [-0.14, 0.78], [-0.14, 1.14], [-0.56, 1.14]], 1.2, GLASS, 0, 0, 0, { bevel: 0 }));
    b.add(prism([[-0.04, 0.78], [0.5, 0.78], [0.25, 1.14], [-0.04, 1.14]], 1.2, GLASS, 0, 0, 0, { bevel: 0 }));
    b.add(box(0.26, 0.24, 1.36, DARK, 1.66, 0.2, 0)); b.add(box(0.2, 0.24, 1.36, DARK, -1.62, 0.2, 0));
    b.add(box(0.1, 0.2, 0.3, LIGHT, 1.64, 0.48, 0.42)); b.add(box(0.1, 0.2, 0.3, LIGHT, 1.64, 0.48, -0.42));
    b.add(box(0.1, 0.16, 0.26, 0xff4a4a, -1.62, 0.54, 0.44)); b.add(box(0.1, 0.16, 0.26, 0xff4a4a, -1.62, 0.54, -0.44));
    b.add(box(0.5, 0.1, 0.34, 0xffc531, -0.16, 1.32, 0));   // roof light
    wheel(-0.95, 0.46, 0.36); wheel(0.95, 0.46, 0.36);
  }
  g.wheels = wheels;
  return g;
}

// ---------------------------------------------------------------------------------------------------------
// Level instance (physics run + meshes)
// ---------------------------------------------------------------------------------------------------------
let run = null, car = null, level = null, levelIndex = 0, carMesh = null, ghost = null, ghostRun = null, ghostCar = null, ghostT = 0;
let dyn = [];          // [{e, mesh, kind}] meshes that follow entity state
let coinMeshes = [], flag = null, started = false, paused = 0, hold = false, fails = 0, levelTime = 0, finished = false, failing = false;
let camX = 0, camY = 0, camW = 0, wheelSpin = 0, dustT = 0, landed = true, lastVy = 0, pitch = 0, pitchV = 0, bounce = 0, bounceV = 0, prevSpeed = 0, lastAd = 0, levelsSinceAd = 0, endless = false, endlessDist = 0;

function clearGroup(g) {
  while (g.children.length) { const c = g.children.pop(); c.traverse((o) => { if (o.geometry && !Object.values(GEO).includes(o.geometry)) o.geometry.dispose(); }); }
}
function ridge(w, layer, z, base) {
  // one silhouette, flat colour, reaching far below the road so nothing floats
  const sh = new THREE.Shape(), X0 = -120, X1 = 230;
  sh.moveTo(X0, -60);
  let seed = 11 + layer * 37 + w.id.length * 5;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let x = X0; x <= X1;) {
    if (w.id === 'mall') { const bw = 6 + rnd() * 9, h = base + rnd() * (8 + layer * 5); sh.lineTo(x, h); sh.lineTo(x + bw, h); x += bw; }
    else if (w.id === 'farm') { const bw = 9 + rnd() * 16, h = base + rnd() * 8; sh.lineTo(x + 2.5, h); sh.lineTo(x + bw - 2.5, h); sh.lineTo(x + bw, base - 1); x += bw; }
    else if (w.id === 'moon') { const bw = 5 + rnd() * 9; sh.lineTo(x + bw * 0.5, base + rnd() * 9); sh.lineTo(x + bw, base + rnd() * 2); x += bw; }
    else { const h = base + (Math.sin(x * 0.045 + layer * 2) + 1) * 4 + rnd() * 1.6; sh.lineTo(x, h); x += 6 + rnd() * 5; }
  }
  sh.lineTo(X1, -60);
  const col = mix(w.hill, w.fog, layer === 0 ? 0.68 : 0.32);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: col, fog: false }));
  m.position.z = z;
  return m;
}
function buildBackground(w) {
  clearGroup(bg);
  scene.background = new THREE.Color(w.sky);
  scene.fog = new THREE.Fog(w.fog, 70, 190);
  hemi.groundColor.set(mix(w.ground, 0x888888, 0.4)); hemi.color.set(w.id === 'moon' ? 0xb0bcff : 0xeef6ff);
  bg.add(ridge(w, 0, -95, 4), ridge(w, 1, -60, -1));
  const disc = new THREE.Mesh(GEO.sph, new THREE.MeshBasicMaterial({ color: w.id === 'moon' ? 0xdfe6ff : 0xfff6c8, fog: false })); disc.scale.setScalar(w.id === 'moon' ? 6 : 7); disc.position.set(52, 34, -120); bg.add(disc);
  if (w.id !== 'moon') for (let i = 0; i < 12; i++) {
    const c = new THREE.Group(), white = new THREE.MeshBasicMaterial({ color: 0xfffdf6, fog: false });
    for (let j = 0; j < 4; j++) { const p = new THREE.Mesh(GEO.sph, white); p.scale.set(1.7 + Math.random() * 1.6, 0.9 + Math.random() * 0.5, 1); p.position.set(j * 1.9 - 3, j % 2 * 0.4, 0); c.add(p); }
    c.position.set(-40 + i * 22 + Math.random() * 10, 12 + Math.random() * 22, -55 - Math.random() * 15); bg.add(c);
  } else for (let i = 0; i < 90; i++) { const st = new THREE.Mesh(GEO.sph, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })); st.scale.setScalar(0.1 + Math.random() * 0.14); st.position.set(-80 + Math.random() * 300, 5 + Math.random() * 60, -110 - Math.random() * 20); bg.add(st); }
}

function spawnLevel(idx, lvl = LEVELS[idx]) {
  level = lvl; levelIndex = idx;
  const w = WORLDS[level.w];
  clearGroup(world); dyn = []; coinMeshes = []; ghost = null; ghostRun = null;
  run = buildLevel(level);
  car = makeCar(level.start[0], level.start[1], carOf(level));
  finished = false; failing = false; levelTime = 0; hold = false;
  const top = w.ground, side = w.dirt;
  for (const it of level.items) {
    switch (it.k) {
      case 'ground': {
        world.add(ribbon(it.pts, it.ice ? 0xd4f3ff : top, it.ice ? 0x7fb6d6 : side, { track: it.ice ? null : w.track }));
        if (it.ice) world.add(signMesh(it.pts[0][0] + 1, it.pts[0][1], t('s_ice')));
        scatterDecor(it.pts, w);
        break;
      }
      case 'platform': world.add(ribbon(it.pts, 0xd9a05a, 0x8a5a2b, { depth: 2.6, thick: 0.35 })); break;
      case 'spikes': {
        const yy = it.y;
        let n = 0;
        for (let x = it.x0 + 0.35; x < it.x1; x += 0.7) { const c = new THREE.Mesh(GEO.spike, mat(n++ % 2 ? 0xc3cad8 : 0xf2f5fb, { flatShading: true })); c.scale.set(0.42, 1.1, 0.42); c.rotation.y = Math.PI / 4; c.position.set(x, yy + 0.5, 0.5); world.add(c); const d = c.clone(); d.position.z = -0.6; world.add(d); }
        const high = yy > 0.5;
        world.add(ribbon([[it.x0, yy], [it.x1, yy]], 0x565c70, 0x3c4050, { thick: high ? 0.5 : 16 }));
        if (high) for (const x of [it.x0 + 0.3, it.x1 - 0.3]) world.add(box(0.12, 40, 0.12, 0x3c4050, x, yy + 20, -0.5));
        break;
      }
      case 'wall': world.add(box(0.5, it.y1 - it.y0, ROAD_D, 0x8a6a4a, it.x, (it.y0 + it.y1) / 2, 0)); break;
      case 'boulder': { const m = new THREE.Mesh(GEO.sph, mat(0x8a8f9a, { flatShading: true })); m.scale.setScalar(it.r); m.position.set(it.x, it.y, 0); world.add(m); break; }
      case 'coin': { const m = new THREE.Mesh(GEO.coin, mat(0xffc531)); m.rotation.x = Math.PI / 2; m.position.set(it.x, it.y + 1.0, 0); world.add(m); coinMeshes.push(m); break; }
      case 'sign': world.add(signMesh(it.x, it.y, t(it.text))); break;
      case 'tree': world.add(treeMesh(it.x, it.y, it.s, w)); break;
      case 'bridge': {
        // loose planks on two rails: they fall one by one when the bridge lets go
        const g = new THREE.Group(), planks = [], n = Math.round((it.x1 - it.x0) / 1.1), pw = (it.x1 - it.x0) / n;
        for (let i = 0; i < n; i++) {
          const p = box(pw - 0.1, 0.22, 2.7, i % 2 ? 0xd9a05a : 0xc8904c, it.x0 + pw * (i + 0.5), it.y - 0.11, 0);
          g.add(p); planks.push(p);
          if (i % 3 === 1) g.add(box(0.05, 0.02, 1.3, 0x4a2f18, it.x0 + pw * (i + 0.5) + 0.12, it.y + 0.01, 0.5));
        }
        world.add(g);
        world.add(box(it.x1 - it.x0 + 0.4, 0.12, 0.14, 0x5a3a20, (it.x0 + it.x1) / 2, it.y - 0.34, 1.2), box(it.x1 - it.x0 + 0.4, 0.12, 0.14, 0x5a3a20, (it.x0 + it.x1) / 2, it.y - 0.34, -1.2));
        dyn.push({ kind: 'bridge', it, planks }); break;
      }
      case 'trapdoor': {
        const half = (it.x1 - it.x0) / 2, g = new THREE.Group();
        const a = ribbon([[0, 0], [half, 0]], mix(top, 0x000000, 0.1), side, { thick: 0.32, depth: 3.2, track: w.track }); a.position.x = it.x0; g.add(a);
        const b = ribbon([[-half, 0], [0, 0]], mix(top, 0x000000, 0.1), side, { thick: 0.32, depth: 3.2, track: w.track }); b.position.x = it.x1; g.add(b);
        g.position.y = it.y; world.add(g); dyn.push({ kind: 'trapdoor', it, a, b }); break;
      }
      case 'fakeflag': break;
      case 'crusher': {
        const g = new THREE.Group(), hw = it.w / 2;
        g.add(prism([[-hw, 0], [hw, 0], [hw, 2.6], [hw * 0.82, 3], [-hw * 0.82, 3], [-hw, 2.6]], ROAD_D - 0.5, 0xc23a3a, 0, 0, 0, { bevel: 0.1 }));
        g.add(stripePlane(it.w, 0.5, 0, 0.3, (ROAD_D - 0.5) / 2 + 0.12));
        g.add(box(it.w + 0.12, 0.3, ROAD_D - 0.3, 0x2a2c38, 0, -0.1, 0));
        const nT = Math.max(3, Math.round(it.w / 0.8));
        for (let i = 0; i < nT; i++) { const c = new THREE.Mesh(GEO.spike, mat(i % 2 ? 0xc3cad8 : 0xf2f5fb, { flatShading: true })); c.scale.set(0.34, 0.7, 0.34); c.rotation.x = Math.PI; c.rotation.y = Math.PI / 4; c.position.set(-hw + (i + 0.5) * it.w / nT, -0.5, 0.6); g.add(c); }
        g.position.set(it.x, it.top, 0); world.add(g);
        for (const sx of [-1, 1]) world.add(box(0.34, it.top + 5, 0.34, 0x3c4050, it.x + sx * (hw + 0.34), (it.top + 5) / 2, -1.5));
        world.add(box(it.w + 1.5, 0.5, 0.8, 0x3c4050, it.x, it.top + 4.7, -1.5));
        dyn.push({ kind: 'crusher', it, mesh: g }); break;
      }
      case 'boost': { const m = new THREE.Mesh(new THREE.PlaneGeometry(it.x1 - it.x0, 2.4), new THREE.MeshBasicMaterial({ map: textTexture('>>>>', { bg: '#ffb13d', fg: '#7a3a00', size: 90 }) })); m.rotation.x = -Math.PI / 2; m.position.set((it.x0 + it.x1) / 2, it.y + 0.03, 0); world.add(m); break; }
      case 'wind': { const m = new THREE.Mesh(GEO.box, mat(0xffffff, { transparent: true, opacity: 0.12 })); m.scale.set(it.x1 - it.x0, 8, ROAD_D); m.position.set((it.x0 + it.x1) / 2, 4, 0); world.add(m); world.add(signMesh(it.x0 - 1, 0, t('s_wind') + (it.ax < 0 ? ' ←' : ' →'))); break; }
      case 'lowg': break;
      case 'mover': { const m = ribbon(it.pts, 0x8fa0c8, 0x4a5578, { depth: 2.8, thick: 0.4 }); world.add(m); const st = stripePlane(it.pts[it.pts.length - 1][0] - it.pts[0][0], 0.26, (it.pts[0][0] + it.pts[it.pts.length - 1][0]) / 2, it.pts[0][1] - 0.2, 1.56); world.add(st); dyn.push({ kind: 'mover', it, mesh: m, st }); break; }
      case 'fallrock': { const m = new THREE.Mesh(GEO.sph, mat(0x8a8f9a, { flatShading: true })); m.scale.setScalar(it.r); m.position.set(it.x, it.y, 0); world.add(m); dyn.push({ kind: 'fallrock', it, mesh: m }); break; }
      case 'door': { const h = it.y1 - it.y0, m = box(0.5, h, ROAD_D, 0x4a5068, it.x, (it.y0 + it.y1) / 2, 0); world.add(m); const st = stripePlane(h, 0.5, it.x, it.y0 + h * 0.5, ROAD_D / 2 + 0.03); st.rotation.z = Math.PI / 2; world.add(st); world.add(box(1.2, 0.5, ROAD_D + 0.4, 0x2a2c38, it.x, it.y1 + 0.25, 0)); dyn.push({ kind: 'door', it, mesh: m, st, h }); break; }
    }
  }
  // bind dyn meshes to entity state objects
  for (const d of dyn) d.e = run.ents.find((e) => e.it === d.it);
  // the dark behind and below the road: gaps look deep, and no sky shows under the world
  const gxs = level.items.filter((i) => i.k === 'ground').flatMap((i) => i.pts);
  if (gxs.length) {
    const minY = Math.min(...gxs.map((p) => p[1])), x0 = Math.min(...gxs.map((p) => p[0])) - 40, x1 = Math.max(...gxs.map((p) => p[0])) + 40;
    world.add(box(x1 - x0, 80, 0.2, shade(side, 0.24), (x0 + x1) / 2, minY - 0.5 - 40, -1.75));
  }
  flag = flagMesh(); flag.position.set(run.finishX, groundYAt(run.finishX), 0); world.add(flag);
  landed = true; lastVy = 0; pitchV = 0; pitch = 0; bounce = 0; bounceV = 0; prevSpeed = 0; camW = 0;
  if (carMesh) world.remove(carMesh);
  carMesh = vehicleMesh(w.vehicle, state.skin); world.add(carMesh); world.add(blob); debris.length = 0;
  buildBackground(w);
  camX = 0; camY = 0;
  $('lvlText').textContent = endless ? t('endless') : t('levelShort', { n: idx + 1 });
  $('prog').classList.toggle('hidden', endless);
  $('failText').textContent = fails;
  updateCar();
}
function groundYAt(x) {
  let best = -1e9;
  for (const c of run.colliders) if (c.kind === 'seg' && !c.face && !c.off && Math.min(c.x0, c.x1) <= x && Math.max(c.x0, c.x1) >= x && !c.hazard) {
    const tt = c.x1 === c.x0 ? 0 : (x - c.x0) / (c.x1 - c.x0); const y = c.y0 + (c.y1 - c.y0) * tt; if (y > best && y < 20) best = y;
  }
  return best === -1e9 ? 0 : best;
}

// a soft blot under the car ties it to the road
const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
blob.rotation.x = -Math.PI / 2;
const debris = [];
function spawnDebris(x, y, colors, n = 10) {
  for (let i = 0; i < n; i++) {
    const s0 = 0.18 + Math.random() * 0.38;
    const d = box(s0 * (1 + Math.random()), s0, s0, colors[i % colors.length], x, y + 0.4, (Math.random() - 0.5) * 2);
    d.v = [(Math.random() - 0.35) * 11, 4 + Math.random() * 8, (Math.random() - 0.5) * 3]; d.w = [Math.random() * 10, Math.random() * 10]; d.life = 1.3;
    world.add(d); debris.push(d);
  }
}
function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= dt; d.v[1] -= 22 * dt;
    d.position.x += d.v[0] * dt; d.position.y += d.v[1] * dt; d.position.z += d.v[2] * dt;
    d.rotation.x += d.w[0] * dt; d.rotation.z += d.w[1] * dt;
    if (d.life <= 0) { world.remove(d); debris.splice(i, 1); }
  }
}
function updateCar(dt = 0) {
  const c = carCenter(car), a = carAngle(car);
  const gy = groundYAt(c.x), hgt = c.y - gy;
  blob.visible = hgt > 0 && hgt < 7;
  if (blob.visible) { const k = Math.max(0.35, 1 - hgt / 7); blob.position.set(c.x, gy + 0.03, 0); blob.scale.set(1.9 * k, 0.95 * k, 1); blob.material.opacity = 0.34 * k; }
  carMesh.position.set(c.x, c.y, 0); carMesh.rotation.z = a;
  carMesh.wheels.forEach((wm) => { wm.rotation.z = -wheelSpin; });
  if (!dt) return;
  // suspension: the body noses up on gas, dives on brake, squashes when it lands
  const sp = carSpeed(car), ac = (sp - prevSpeed) / Math.max(dt, 1e-3); prevSpeed = sp;
  const grounded = car.onGround > 0;
  const target = grounded ? Math.max(-0.14, Math.min(0.14, ac * 0.009)) : 0;
  pitchV += (target - pitch) * 90 * dt; pitchV *= Math.exp(-11 * dt); pitch += pitchV * dt;
  if (grounded && !landed && lastVy < -4) {
    bounceV = Math.max(-5, lastVy * 0.5);
    audio.play('land', { vol: Math.min(1, -lastVy / 14) });
    for (const dx of [-0.8, 0, 0.8]) fx.dust({ x: c.x + dx, y: c.y - WHEEL_R, z: 0.8 });
  }
  if (!grounded) lastVy = car.p[0].vy;
  landed = grounded;
  bounceV += -bounce * 170 * dt; bounceV *= Math.exp(-9 * dt); bounce += bounceV * dt;
  const b = carMesh.body;
  b.rotation.z = pitch; b.position.y = Math.max(-0.2, bounce * 0.3);
  const q = Math.max(-0.16, Math.min(0.12, bounce * 0.5)); b.scale.set(1 - q * 0.5, 1 + q, 1);
}

// ---------------------------------------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------------------------------------
function startLevel(idx) {
  endless = false; fails = 0; $('helpers').innerHTML = '';
  spawnLevel(idx);
  $('hud').classList.remove('hidden');
  if (state.tut < 1) { $('tut').textContent = t('tapHint'); $('tut').classList.remove('hidden'); } else $('tut').classList.add('hidden');
  started = true; platform.gameplayStart();
}
function restart() {
  if (endless) { startEndless(); return; }
  spawnLevel(levelIndex);
}
function fail(reason) {
  if (failing || finished) return;
  failing = true; fails++; $('failText').textContent = fails;
  platform.gameplayStop();
  audio.play(reason === 'fell' ? 'whoosh' : 'crash', { vol: 0.9 });
  audio.engine(0, 0, false);
  const c = carCenter(car);
  fx.burst({ x: c.x, y: c.y + 0.5, z: 0 }, 0xff6b3d, 26, 6); fx.burst({ x: c.x, y: c.y + 0.5, z: 0 }, 0x333333, 12, 4);
  fx.shake(reason === 'fell' ? 0.4 : 0.8);
  if (reason !== 'fell') { spawnDebris(c.x, c.y, [SKINS[state.skin].body, 0x23242e, 0xe6e8f0, 0x7fe3ff], 12); camW *= 0.84; }
  $('flash').style.opacity = 0.45; setTimeout(() => { $('flash').style.opacity = 0; }, 120);
  toast(t(reason === 'fell' ? 'fell' : reason), 900);
  // the crash itself is the joke: the car gets thrown, spinning, and stays in frame
  if (reason !== 'fell') for (const q of car.p) { const sgn = q.x > c.x ? 1 : -1; q.vx = q.vx * 0.3 - 3; q.vy = 7 + sgn * 4; }
  if (level.hint) { toast(t('gotcha'), 900); $('tut').textContent = t(level.hint); $('tut').classList.remove('hidden'); }
  if (endless) { setTimeout(endlessOver, 700); return; }
  if (fails >= 3 && platform.hasRewarded) showHelpers();
  setTimeout(() => { restart(); started = true; platform.gameplayStart(); }, 750);
}
function showHelpers() {
  const h = $('helpers'); h.innerHTML = '';
  const b1 = document.createElement('button'); b1.className = 'btn ' + platform.adColor; b1.textContent = t('showTrap');
  b1.onclick = () => rewarded(() => startGhost());
  const b2 = document.createElement('button'); b2.className = 'btn ' + platform.adColor; b2.textContent = t('skipLevel');
  b2.onclick = () => rewarded(() => { state.stars[levelIndex] = Math.max(starsOf(levelIndex), 1); save(true); goNext(); });
  h.append(b1, b2);
}
function win() {
  finished = true; started = false; platform.gameplayStop(); audio.engine(0, 0, false);
  audio.play('win', { vol: 0.9 });
  const c = carCenter(car);
  fx.confetti({ x: c.x, y: c.y + 2, z: 0 }, 60); bounceV = 7;
  platform.happytime();
  if (endless) return;
  const got = run.coins.filter((k) => k.got).length;
  const stars = 1 + (fails <= 3 ? 1 : 0) + (got === 3 ? 1 : 0);
  const prev = starsOf(levelIndex);
  state.stars[levelIndex] = Math.max(prev, stars);
  const earned = 5 + got * 2 + (stars === 3 && prev < 3 ? 10 : 0);
  state.coins += earned; setCoinsUI();
  if (state.tut < 1) state.tut = 1;
  state.cur = Math.min(LEVELS.length - 1, levelIndex + 1);
  save(true);
  $('winTitle').textContent = stars === 3 ? t('perfect') : t('done');
  $('winStars').innerHTML = [1, 2, 3].map((i) => `<span class="${i <= stars ? '' : 'off'}">★</span>`).join('');
  $('winCoins').textContent = t('earned', { n: earned });
  const btns = $('winBtns'); btns.innerHTML = '';
  if (platform.hasRewarded) {
    const b = document.createElement('button'); b.className = 'btn ' + platform.adColor; b.textContent = t('doubleCoins');
    b.onclick = () => rewarded(() => { state.coins += earned; setCoinsUI(); save(true); b.disabled = true; $('winCoins').textContent = t('earned', { n: earned * 2 }); });
    btns.appendChild(b);
  }
  const n = document.createElement('button'); n.className = 'btn green'; n.textContent = t('next') + ' ▶';
  n.onclick = () => { closePanels(true); goNext(); };
  btns.appendChild(n);
  setTimeout(() => openPanel('winPanel'), 650);
}
async function goNext() {
  const nextIdx = levelIndex + 1;
  closePanels(true);
  if (nextIdx >= LEVELS.length) { $('hud').classList.add('hidden'); started = false; showEnd(); return; }
  const worldChange = LEVELS[nextIdx].w !== LEVELS[levelIndex].w;
  levelsSinceAd++;
  if (worldChange || levelsSinceAd >= 3) await maybeInterstitial();
  if (worldChange) toast(t('worldDone', { w: t('world')[LEVELS[levelIndex].w], v: t('vehicle')[LEVELS[nextIdx].w] }), 2600);
  startLevel(nextIdx);
}
function showEnd() {
  $('endTitle').textContent = '🏆';
  $('endBody').textContent = t('allDone');
  const b = $('endBtns'); b.innerHTML = '';
  const e = document.createElement('button'); e.className = 'btn orange'; e.textContent = '🏃 ' + t('endless'); e.onclick = () => { closePanels(true); startEndless(); }; b.appendChild(e);
  const l = document.createElement('button'); l.className = 'btn'; l.textContent = t('levels'); l.onclick = () => { closePanels(true); openLevels(); }; b.appendChild(l);
  openPanel('endPanel');
}
async function maybeInterstitial() {
  if (Date.now() - lastAd < AD_GAP_MS) return;
  lastAd = Date.now(); levelsSinceAd = 0;
  pause(); audio.suspend();
  await platform.interstitial(() => {});
  audio.resume(); resume();
}
async function rewarded(onReward) {
  if (!platform.hasRewarded) { toast(t('noAd')); return; }
  pause(); audio.suspend();
  let ok = false;
  try { ok = await platform.rewarded(() => {}); } catch (e) { ok = false; }
  audio.resume(); resume();
  if (ok) { audio.play('unlock', { vol: 0.8 }); onReward(); } else toast(t('noAd'));
}

// ghost: the level's own solution replayed as a see-through car while the player waits
function startGhost() {
  closePanels(true);
  spawnLevel(levelIndex);
  ghostRun = buildLevel(level); ghostCar = makeCar(level.start[0], level.start[1], carOf(level)); ghostT = 0;
  ghost = vehicleMesh(WORLDS[level.w].vehicle, state.skin);
  ghost.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.45; } });
  world.add(ghost);
  toast(t('ghost'), 1500);
  started = true; platform.gameplayStart();
}

// ---------------------------------------------------------------------------------------------------------
// Endless "Trap Run": chunks stitched on the fly with a daily seed
// ---------------------------------------------------------------------------------------------------------
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function endlessLevel() {
  const day = Math.floor(Date.now() / 864e5), R = rng(day * 7919 + 17);
  const items = [], pts = [[-6, 0]];
  let x = 0, y = 0;
  const { G, BRIDGE, TRAPDOOR, SPIKES, CRUSHER, COINS, TREE, SIGN, FALLROCK, DOOR } = ENDLESS_API;
  const flush = () => { if (pts.length > 1) items.push(G(...pts)); pts.length = 0; };
  for (let i = 0; i < 80; i++) {
    const r = R(), len = 12 + Math.floor(R() * 10);
    pts.push([x + len, y]); x += len;
    if (i < 1) continue;
    if (r < 0.2) { pts.push([x + 4, y + 0.6]); x += 4; flush(); x += 4 + Math.min(i, 8) * 0.25; pts.push([x, y]); items.push(SIGN(x - 12, y, R() < 0.5 ? 's_slow' : 's_jump')); }
    else if (r < 0.35) { flush(); items.push(BRIDGE(x, x + 10, y, { when: R() < 0.5 ? 'brake' : 'slow', delay: 0.1 })); x += 10; pts.push([x, y]); items.push(SIGN(x - 16, y, 's_bridge')); }
    else if (r < 0.5) { flush(); items.push(TRAPDOOR(x, x + 6, y, { when: R() < 0.5 ? 'fast' : 'slow', v: 9, lead: 1 })); x += 6; pts.push([x, y]); items.push(SIGN(x - 12, y, R() < 0.5 ? 's_fast' : 's_slow')); }
    else if (r < 0.62) { pts.push([x + 3, y + 0.7]); x += 3; flush(); items.push(SPIKES(x + 1, x + 4, y - 0.2)); x += 5; pts.push([x, y]); }
    else if (r < 0.75) { items.push(CRUSHER(x + 6, 4, 4.5, 0.9, 1.6 + R() * 0.8, { phase: R() })); items.push(SIGN(x - 4, y, 's_timing')); pts.push([x + 12, y]); x += 12; }
    else if (r < 0.85) { items.push(FALLROCK(x + 14, 9, 1.6, x + 6, y)); items.push(SIGN(x - 2, y, 's_rock', { lie: true })); pts.push([x + 20, y]); x += 20; }
    else { items.push(DOOR(x + 10, y, y + 3.2, { when: 'stop' })); items.push(SIGN(x, y, 's_stop')); pts.push([x + 14, y]); x += 14; }
    if (R() < 0.5) items.push(...COINS(x - 6, y + 0.2));
    if (R() < 0.6) items.push(TREE(x - 2, y, 0.8 + R() * 0.6));
  }
  pts.push([x + 30, y]); flush();
  return { w: Math.floor(R() * WORLDS.length), name: 'endless', start: [2, 0], finish: x + 25, killY: -8, items, solve: [[0, 999]] };
}
let ENDLESS_API = null;
function startEndless() {
  endless = true; fails = 0; endlessDist = 0; $('helpers').innerHTML = '';
  spawnLevel(0, endlessLevel());
  $('hud').classList.remove('hidden'); $('tut').classList.add('hidden');
  started = true; platform.gameplayStart();
}
function endlessOver() {
  started = false; platform.gameplayStop();
  const d = Math.floor(endlessDist), best = d > state.best;
  if (best) state.best = d;
  const earned = Math.floor(d / 20); state.coins += earned; setCoinsUI(); save(true);
  $('endTitle').textContent = best ? t('newBest') : t('runOver');
  $('endBody').textContent = t('distance', { n: d }) + ' · ' + t('best', { n: state.best }) + (earned ? ' · ' + t('earned', { n: earned }) : '');
  const b = $('endBtns'); b.innerHTML = '';
  const r = document.createElement('button'); r.className = 'btn green'; r.textContent = '↻ ' + t('retry'); r.onclick = async () => { closePanels(true); levelsSinceAd++; if (levelsSinceAd >= 2) await maybeInterstitial(); startEndless(); }; b.appendChild(r);
  const l = document.createElement('button'); l.className = 'btn'; l.textContent = t('levels'); l.onclick = () => { closePanels(true); endless = false; openLevels(); }; b.appendChild(l);
  openPanel('endPanel');
}

// ---------------------------------------------------------------------------------------------------------
// Panels: levels, garage, gift, settings
// ---------------------------------------------------------------------------------------------------------
let tabWorld = 0;
function openLevels() {
  tabWorld = LEVELS[endless ? state.cur : levelIndex]?.w ?? 0;
  renderLevels(); openPanel('levelsPanel');
}
function renderLevels() {
  const tabs = $('worldTabs'); tabs.innerHTML = '';
  const firstOpen = unlockedUpTo();
  WORLDS.forEach((w, wi) => {
    const b = document.createElement('button'); b.className = 'btn' + (wi === tabWorld ? ' on' : '');
    const first = LEVELS.findIndex((l) => l.w === wi);
    const locked = first > firstOpen;
    b.textContent = (locked ? '🔒 ' : '') + t('world')[wi];
    b.onclick = () => { if (locked) { toast(t('lockedWorld', { w: t('world')[wi - 1] })); return; } tabWorld = wi; renderLevels(); audio.play('click', { vol: 0.5 }); };
    tabs.appendChild(b);
  });
  const grid = $('levelGrid'); grid.innerHTML = '';
  LEVELS.forEach((l, i) => {
    if (l.w !== tabWorld) return;
    const n = LEVELS.filter((x, j) => x.w === tabWorld && j < i).length + 1;
    const locked = i > firstOpen;
    const c = document.createElement('div'); c.className = 'cell' + (locked ? ' locked' : '') + (i === levelIndex && !endless ? ' cur' : '');
    c.innerHTML = `${locked ? '🔒' : n}<span class="st">${'★'.repeat(starsOf(i))}</span>`;
    c.onclick = () => { if (locked) { toast(t('locked')); return; } closePanels(true); audio.play('click', { vol: 0.6 }); startLevel(i); };
    grid.appendChild(c);
  });
  const extra = $('extraRows'); extra.innerHTML = '';
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = `<div class="ico">🏃</div><div class="txt"><b>${t('endless')}</b><span>${t('endlessDesc')} · ${t('best', { n: state.best })}</span></div>`;
  const pb = document.createElement('button'); pb.className = 'btn orange'; pb.textContent = t('play'); pb.onclick = () => { closePanels(true); startEndless(); };
  row.appendChild(pb); extra.appendChild(row);
  const g = document.createElement('div'); g.className = 'row';
  g.innerHTML = `<div class="ico">🚗</div><div class="txt"><b>${t('garage')}</b><span>${t('skins')[state.skin]}</span></div>`;
  const gb = document.createElement('button'); gb.className = 'btn purple'; gb.textContent = t('garage'); gb.onclick = () => renderGarage();
  g.appendChild(gb); extra.appendChild(g);
  const gift = document.createElement('div'); gift.className = 'row';
  gift.innerHTML = `<div class="ico">🎁</div><div class="txt"><b>${t('gift')}</b><span>${giftAvailable() ? t('giftDay', { n: nextGiftDay() + 1 }) : t('giftTaken')}</span></div>`;
  const gbtn = document.createElement('button'); gbtn.className = 'btn pink'; gbtn.textContent = t('gift'); gbtn.disabled = !giftAvailable(); gbtn.onclick = () => renderGift();
  gift.appendChild(gbtn); extra.appendChild(gift);
}
function renderGarage() {
  const list = $('garageList'); list.innerHTML = '';
  SKINS.forEach((s, i) => {
    const owned = state.skins.includes(i), on = state.skin === i;
    const row = document.createElement('div'); row.className = 'row' + (on ? ' on' : '');
    row.innerHTML = `<div class="ico"><div class="skin" style="background:#${s.body.toString(16).padStart(6, '0')};border-color:#${s.roof.toString(16).padStart(6, '0')}"></div></div><div class="txt"><b>${t('skins')[i]}</b><span>${owned ? (on ? t('equipped') : t('owned')) : t('price', { n: s.price })}</span></div>`;
    const b = document.createElement('button');
    if (owned) { b.className = 'btn green'; b.textContent = on ? '✓' : t('equip'); b.disabled = on; b.onclick = () => { state.skin = i; save(); audio.play('click', { vol: 0.6 }); renderGarage(); }; }
    else if (state.coins >= s.price) { b.className = 'btn orange'; b.textContent = t('buy'); b.onclick = () => { state.coins -= s.price; state.skins.push(i); state.skin = i; setCoinsUI(); save(true); audio.play('buy'); renderGarage(); }; }
    else if (platform.hasRewarded && i === 1) { b.className = 'btn ' + platform.adColor; b.textContent = t('watchToUnlock'); b.onclick = () => rewarded(() => { state.skins.push(i); state.skin = i; save(true); renderGarage(); }); }
    else { b.className = 'btn grey'; b.textContent = t('price', { n: s.price }); b.disabled = true; }
    row.appendChild(b); list.appendChild(row);
  });
  openPanel('garagePanel');
}
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const giftAvailable = () => state.giftDay !== today();
const nextGiftDay = () => (state.giftDay === yesterday() ? Math.min(state.giftStreak, GIFT.length - 1) : 0);
function renderGift() {
  const d = nextGiftDay(), amount = GIFT[d];
  const b = $('giftBody');
  b.innerHTML = `<div class="stars">🎁</div><div class="note">${t('giftText', { a: GIFT[0], b: GIFT[1], c: GIFT[2] })}</div><div class="note"><b>${t('giftDay', { n: d + 1 })}: +${amount}</b></div>`;
  const take = document.createElement('button'); take.className = 'btn green big'; take.textContent = t('take') + ` +${amount}`;
  take.onclick = () => { state.coins += amount; state.giftDay = today(); state.giftStreak = d + 1; setCoinsUI(); save(true); audio.play('coin'); closePanels(); };
  b.appendChild(take);
  const c = document.createElement('button'); c.className = 'btn grey big'; c.textContent = t('close'); c.onclick = () => closePanels(); b.appendChild(c);
  openPanel('giftPanel');
}
function renderSettings(asPause) {
  $('settingsTitle').textContent = asPause ? t('paused') : t('settings');
  const b = $('settingsBody'); b.innerHTML = '';
  if (!platform.ownAudioControl) {
    for (const [key, get, set] of [['sound', () => state.sound, (v) => { state.sound = v; audio.setSound(v); }], ['music', () => state.music, (v) => { state.music = v; audio.setMusic(v); }]]) {
      const row = document.createElement('div'); row.className = 'row toggle';
      row.innerHTML = `<div class="txt"><b>${t(key)}</b></div>`;
      const btn = document.createElement('button'); btn.className = 'btn ' + (get() ? 'green' : 'grey'); btn.textContent = get() ? 'ON' : 'OFF';
      btn.onclick = () => { set(!get()); save(); btn.className = 'btn ' + (get() ? 'green' : 'grey'); btn.textContent = get() ? 'ON' : 'OFF'; audio.play('click', { vol: 0.5 }); };
      row.appendChild(btn); b.appendChild(row);
    }
  }
  if (asPause) {
    const r = document.createElement('button'); r.className = 'btn green big'; r.textContent = '▶ ' + t('continue'); r.onclick = () => closePanels(); b.appendChild(r);
    const rs = document.createElement('button'); rs.className = 'btn orange big'; rs.textContent = '↻ ' + t('retry'); rs.onclick = () => { closePanels(); fails++; $('failText').textContent = fails; restart(); }; b.appendChild(rs);
    const l = document.createElement('button'); l.className = 'btn big'; l.textContent = '☰ ' + t('levels'); l.onclick = () => { closePanels(true); openLevels(); }; b.appendChild(l);
  }
  openPanel('settingsPanel');
}

// ---------------------------------------------------------------------------------------------------------
// Pause / input
// ---------------------------------------------------------------------------------------------------------
function pause(mute = true) { if (paused++ === 0) { if (started && !panelOpen) platform.gameplayStop(); } if (mute) audio.suspend(); }
function resume() { if (paused > 0 && --paused === 0) { last = performance.now(); if (started && !panelOpen && !finished) platform.gameplayStart(); } audio.resume(); }
platform.onPause = () => pause();
platform.onResume = () => resume();
platform.onAudio = (on) => { if (on) audio.resume(); else audio.suspend(); };
if (!platform.ownPauseEvents) document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else resume(); });

const press = (e) => { if (e && e.target && e.target.closest && e.target.closest('button, .cell, .panel')) return; audio.unlock(); hold = true; if (!failing && fails === 0) setTimeout(() => $('tut').classList.add('hidden'), 1400); };
const release = () => { hold = false; };
$('gas').addEventListener('pointerdown', (e) => { e.preventDefault(); press(e); });
window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
window.addEventListener('blur', release);
const KEYS = ['Space', 'ArrowUp', 'KeyW', 'ArrowRight', 'KeyD', 'Enter'];
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Escape') { if (platform.ownAudioControl) return; if (panelOpen) closePanels(); else if (started) renderSettings(true); return; }
  if (KEYS.includes(e.code)) { if (panelOpen && panelOpen === 'winPanel') return; press(); }
});
window.addEventListener('keyup', (e) => { if (KEYS.includes(e.code)) release(); });
window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
$('btnPause').addEventListener('click', () => renderSettings(true));
$('btnLevels').addEventListener('click', () => openLevels());

// ---------------------------------------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------------------------------------
let last = performance.now(), acc = 0, simT = 0;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

function step() {
  if (!started || paused || !run) return;
  const touched = stepCar(car, hold, run.colliders);
  car.hold = hold; car.gravityScale = run.gravityScale;
  updateLevel(run, car, DT, touched);
  levelTime += DT;
  if (ghostRun && ghost) {
    ghostT += DT;
    const gh = holdAt(level.solve, ghostT);
    ghostCar.gravityScale = ghostRun.gravityScale; const gt = stepCar(ghostCar, gh, ghostRun.colliders); ghostCar.hold = gh; updateLevel(ghostRun, ghostCar, DT, gt);
    if (ghostT > 14 || ghostRun.won || ghostCar.crashed) { world.remove(ghost); ghost = null; ghostRun = null; }
  }
  const sp = Math.abs(carSpeed(car));
  wheelSpin += sp * DT / WHEEL_R;
  // dust behind the rear wheel while driving, a puff when braking hard
  if (car.onGround && sp > 3 && !finished && !failing) {
    dustT += DT;
    const every = hold ? 0.09 : 0.04;
    if (dustT > every) { dustT = 0; fx.dust({ x: car.p[0].x, y: car.p[0].y - WHEEL_R, z: 0.6 }, WORLDS[level.w].id === 'moon' ? 0xc0c4d4 : hold ? 0xe8dcc0 : 0xb8b0a0); }
  }
  if (endless) endlessDist = Math.max(endlessDist, carCenter(car).x);
  for (const ev of run.events) {
    if (ev.name === 'coin') { audio.play('coin', { vol: 0.7 }); fx.sparkle({ x: ev.x, y: ev.y + 1, z: 0 }, 0xffe27a, 10); state.coins += 1; setCoinsUI(); }
    else if (ev.name === 'win') win();
    else if (ev.name === 'crack') audio.play('crack');
    else if (ev.name === 'fall' || ev.name === 'thud') { audio.play('thud'); fx.shake(0.3); }
    else if (ev.name === 'click') audio.play('click');
    else if (ev.name === 'flagrun') { audio.play('jump', { vol: 0.8 }); toast('😜', 700); }
    else if (ev.name === 'boost') audio.play('whoosh');
    else if (ev.name === 'door') audio.play('unlock', { vol: 0.6 });
    else if (ev.name === 'rumble') audio.play('crack', { rate: 0.6 });
  }
  run.events.length = 0;
  if (!finished) {
    if (car.crashed) fail(car.crashReason);
    else if (carCenter(car).y < level.killY) fail('fell');
  }
}
function syncDyn() {
  for (const d of dyn) {
    const e = d.e; if (!e) continue;
    if (d.kind === 'bridge') { const drop = d.it.y - e.y; d.planks.forEach((p, i) => { const k = 0.55 + ((i * 37) % 10) / 10; p.position.y = d.it.y - 0.11 - drop * k * 1.4 + (e.state === 'armed' ? Math.sin(simT * 70 + i) * 0.035 : 0); p.rotation.z = drop > 0 ? drop * (i % 2 ? 0.5 : -0.4) : 0; }); }
    else if (d.kind === 'trapdoor') { d.a.rotation.z = -e.open * 1.4; d.b.rotation.z = e.open * 1.4; }
    else if (d.kind === 'crusher') { const f = e.phase % 1, warn = f > 0.36 && f < 0.45; d.mesh.position.set(d.it.x + (warn ? Math.sin(simT * 80) * 0.07 : 0), e.y, 0); }
    else if (d.kind === 'mover') { d.mesh.position.set(e.ox, e.oy, 0); d.st.position.x = (d.it.pts[0][0] + d.it.pts[d.it.pts.length - 1][0]) / 2 + e.ox; d.st.position.y = d.it.pts[0][1] - 0.2 + e.oy; }
    else if (d.kind === 'fallrock') { d.mesh.position.y = e.col.y; if (e.state === 'wait') d.mesh.position.y += Math.sin(simT * 3) * 0.05; }
    else if (d.kind === 'door') { d.mesh.position.y = (d.it.y0 + d.it.y1) / 2 + d.h * e.open; d.st.position.y = d.it.y0 + d.h * 0.5 + d.h * e.open; }
  }
  for (const [i, m] of coinMeshes.entries()) { const c = run.coins[i]; m.visible = !c.got; m.rotation.z = simT * 3; }
  if (flag) { flag.position.x += (run.finishX - flag.position.x) * 0.2; const ff = run.ents.find((e) => e.it.k === 'fakeflag'); flag.position.y = groundYAt(flag.position.x) + (ff ? ff.hop * 1.2 : 0); const p = flag.flag.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(simT * 8 + p.getX(i) * 4) * 0.08 * (p.getX(i) + 0.8)); p.needsUpdate = true; }
  if (ghost && ghostCar) { const c = carCenter(ghostCar); ghost.position.set(c.x, c.y, 0.02); ghost.rotation.z = carAngle(ghostCar); }
}
function updateCamera(dt) {
  // while the ghost shows the trap, the camera rides with the ghost
  const follow = ghost && ghostCar ? ghostCar : car;
  const c = carCenter(follow);
  const sp = carSpeed(follow), s01 = Math.min(1, Math.abs(sp) / 15);
  const aspect = camera.aspect, vfov = camera.fov * Math.PI / 180;
  // framing: big car near the left, road about 2/3 down; pulling back with speed keeps the next trap in view
  const wantW = aspect > 1 ? 17 + s01 * 6 : 11 + s01 * 3;
  camW = camW ? camW + (wantW - camW) * Math.min(1, dt * 2.2) : wantW;
  const H = camW / aspect;
  const dist = Math.max(8, (camW / 2) / Math.tan(vfov / 2) / aspect);
  const targetX = c.x + camW * 0.23 + Math.max(0, sp) * 0.06, targetY = Math.max(c.y, level.killY + 2) + H * (aspect > 1 ? 0.15 : 0.01);
  if (!camX && !camY) { camX = targetX; camY = targetY; }
  camX += (targetX - camX) * Math.min(1, dt * 6);
  camY += (targetY - camY) * Math.min(1, dt * 4);
  const sh = fx.shakeOffset();
  camera.position.set(camX + (Math.random() - 0.5) * sh, camY + dist * 0.14 + (Math.random() - 0.5) * sh, dist);
  camera.lookAt(camX, camY, 0);
  bg.position.x = camX * 0.72; bg.position.y = camY * 0.5 + (aspect > 1 ? 0 : H * 0.24);
  // how far along the road
  if (run && !endless) { const k = Math.max(0, Math.min(1, (c.x - level.start[0]) / (run.finishX - level.start[0]))); $('progCar').style.left = (k * 100) + '%'; }
}
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (started && !paused && run) {
    acc += dt;
    while (acc >= DT) { step(); acc -= DT; simT += DT; }
    audio.engine(hold ? 1 : 0, Math.min(1, Math.abs(carSpeed(car)) / 15), !finished && !failing);
  }
  if (run) { updateCar(dt); syncDyn(); updateCamera(dt); updateDebris(dt); }
  fx.update(dt);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------------------
async function boot() {
  const bar = $('bar').firstElementChild;
  bar.style.width = '30%';
  await platform.init();
  setLang(platform.lang());
  applyTexts();
  document.title = t('docTitle');
  $('logo').innerHTML = t('title').replace(' ', '<br>') + '<small>3D</small>';
  $('controlsText').textContent = isTouch ? t('controlsTouch') : t('controlsPc');
  load(await platform.loadSave());
  audio.setSound(state.sound); audio.setMusic(state.music);
  setCoinsUI();
  bar.style.width = '70%';
  // import the item constructors for the endless generator
  ENDLESS_API = await import('./levels.js');
  // show the current level behind the title screen
  endless = false; spawnLevel(Math.min(state.cur, LEVELS.length - 1));
  requestAnimationFrame(frame);
  bar.style.width = '100%';
  $('loader').classList.add('hidden'); $('start').classList.remove('hidden');
  const row = $('startRow');
  const lb = document.createElement('button'); lb.className = 'btn'; lb.textContent = '☰ ' + t('levels'); lb.onclick = () => { audio.unlock(); openLevels(); }; row.appendChild(lb);
  if (!platform.ownAudioControl) { const sb = document.createElement('button'); sb.className = 'btn grey'; sb.textContent = '⚙️'; sb.onclick = () => { audio.unlock(); renderSettings(false); }; row.appendChild(sb); }
  requestAnimationFrame(() => platform.loadingDone());
  const go = () => { audio.unlock(); $('start').classList.add('hidden'); startLevel(Math.min(state.cur, LEVELS.length - 1)); };
  $('btnPlay').addEventListener('click', go);
}
boot();

if (platform.name === 'local' || (new URLSearchParams(location.search).has('debug') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) window.__game = {
  get state() { return state; }, get car() { return car; }, get run() { return run; }, startLevel, startEndless, fail, win, platform, get paused() { return paused; }, get panel() { return panelOpen; }, audio, get started() { return started; },
  setHold(v) { hold = v; }, step(n) { for (let i = 0; i < n; i++) step(); }, adDue() { lastAd = 0; levelsSinceAd = 9; }, openPanel, closePanels, get level() { return levelIndex; },
};
