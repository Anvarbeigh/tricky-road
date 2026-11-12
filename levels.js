// Level data + the scripted entities that make traps move. No rendering here: main.js reads `items`
// and the colliders this module produces, so the same code runs in node for solvability tests.
import { seg, circle, polyline, inZone, carCenter, carSpeed } from './physics.js';

// ---------------------------------------------------------------------------------------------------------------
// Item constructors (short names keep the level tables readable)
// ---------------------------------------------------------------------------------------------------------------
export const G = (...pts) => ({ k: 'ground', pts });                               // solid ground ribbon
export const P = (...pts) => ({ k: 'platform', pts });                             // thin floating plank
export const ICE = (...pts) => ({ k: 'ground', pts, friction: 0.08, ice: true });
export const SPIKES = (x0, x1, y) => ({ k: 'spikes', x0, x1, y });
export const WALL = (x, y0, y1) => ({ k: 'wall', x, y0, y1 });
export const SIGN = (x, y, text, o = {}) => ({ k: 'sign', x, y, text, ...o });    // text = i18n key or literal
export const COIN = (x, y) => ({ k: 'coin', x, y });
export const COINS = (x, y, n = 3, dx = 1.2) => Array.from({ length: n }, (_, i) => COIN(x + i * dx, y));
export const ROCK = (x, y, r) => ({ k: 'boulder', x, y, r });
export const TREE = (x, y, s = 1) => ({ k: 'tree', x, y, s });
export const BRIDGE = (x0, x1, y, o = {}) => ({ k: 'bridge', x0, x1, y, delay: 0.35, when: 'touch', ...o });  // when: touch | brake | slow | fast
export const TRAPDOOR = (x0, x1, y, o = {}) => ({ k: 'trapdoor', x0, x1, y, when: 'fast', v: 8, delay: 0, ...o });
export const FAKEFLAG = (x, y, jumps) => ({ k: 'fakeflag', x, y, jumps });
export const CRUSHER = (x, w, top, bottom, period, o = {}) => ({ k: 'crusher', x, w, top, bottom, period, phase: 0, ...o });
export const BOOST = (x0, x1, y, v = 15) => ({ k: 'boost', x0, x1, y, v });
export const WIND = (x0, x1, ax) => ({ k: 'wind', x0, x1, ax });
export const MOVER = (pts, dx, dy, period, o = {}) => ({ k: 'mover', pts, dx, dy, period, ...o });
export const FALLROCK = (x, y, r, triggerX, floorY) => ({ k: 'fallrock', x, y, r, triggerX, floorY });
export const DOOR = (x, y0, y1, o = {}) => ({ k: 'door', x, y0, y1, when: 'stop', zone: [x - 7, x - 1], ...o });  // when: stop | fast | never
export const SEESAW = (x, y, half, o = {}) => ({ k: 'seesaw', x, y, half, max: 0.35, ...o });
export const LOWG = (x0, x1) => ({ k: 'lowg', x0, x1 });                            // moon zone: gravity /3

// ---------------------------------------------------------------------------------------------------------------
// Runtime: turns items into colliders and per-attempt entity state
// ---------------------------------------------------------------------------------------------------------------
const lerp = (a, b, t) => a + (b - a) * t;

export function buildLevel(level) {
  const colliders = [], ents = [], coins = [], decor = [];
  let finishX = level.finish;
  const run = { level, colliders, ents, coins, decor, time: 0, finishX, events: [], won: false, gravityScale: 1 };
  const ev = (name, data) => run.events.push({ name, ...data });

  for (const it of level.items) {
    switch (it.k) {
      case 'ground': case 'platform': {
        const extra = { friction: it.friction ?? 1, item: it, oneWay: it.k === 'platform' ? 'up' : undefined };
        it.cols = polyline(it.pts, extra);
        // the ribbon has a thickness: end faces stop a car from sliding under a ledge
        const T = it.k === 'platform' ? 0.5 : 3, a = it.pts[0], b = it.pts[it.pts.length - 1];
        it.cols.push(seg(a[0], a[1], a[0], a[1] - T, { item: it, face: true }), seg(b[0], b[1], b[0], b[1] - T, { item: it, face: true }));
        colliders.push(...it.cols); break;
      }
      case 'spikes': colliders.push(seg(it.x0, it.y0 ?? it.y, it.x1, it.y1 ?? it.y, { hazard: true, item: it })); break;
      case 'wall': colliders.push(seg(it.x, it.y0, it.x, it.y1, { item: it })); break;
      case 'boulder': colliders.push(circle(it.x, it.y, it.r, { item: it })); break;
      case 'coin': coins.push({ x: it.x, y: it.y, got: false, item: it }); break;
      case 'sign': case 'tree': decor.push(it); break;

      case 'bridge': {
        const cols = polyline([[it.x0, it.y], [it.x1, it.y]], { item: it });
        colliders.push(...cols);
        const e = { it, cols, state: 'idle', t: 0, y: it.y, vy: 0 };
        e.update = (car, dt, touched) => {
          if (e.state === 'idle') {
            const on = touched.some((c) => cols.includes(c));
            if (!on) return;
            const v = Math.abs(carSpeed(car));
            let hit;
            if (it.when === 'slow' || it.when === 'fast') { if (e.judged) return; e.judged = true; hit = it.when === 'slow' ? v < (it.v ?? 7) : v > (it.v ?? 9); }
            else hit = it.when === 'touch' || (it.when === 'brake' && !car.hold);
            if (hit) { e.state = 'armed'; e.t = 0; ev('crack', { x: it.x0 }); }
          } else if (e.state === 'armed') {
            e.t += dt;
            if (e.t >= it.delay) { e.state = 'falling'; ev('fall', { x: it.x0 }); }
          } else if (e.state === 'falling') {
            e.vy -= 18 * dt; e.y += e.vy * dt;
            for (const c of cols) { c.y0 = c.y1 = e.y; c.soft = true; }
            if (e.y < it.y - 2.5) for (const c of cols) c.off = true;
          }
        };
        ents.push(e); break;
      }
      case 'trapdoor': {
        const cols = polyline([[it.x0, it.y], [it.x1, it.y]], { item: it });
        cols.push(seg(it.x0, it.y, it.x0, it.y - 0.5, { item: it, face: true }), seg(it.x1, it.y, it.x1, it.y - 0.5, { item: it, face: true }));
        colliders.push(...cols);
        // a pressure plate: 'fast'/'slow' are judged once, the moment the car rolls onto it; 'brake'/'gas' any time on it
        const e = { it, cols, open: 0, t: -1, judged: false };
        e.update = (car, dt) => {
          if (e.t < 0) {
            const z = { x0: it.x0 - (it.lead ?? 0), x1: it.x1, y0: it.y - 1, y1: it.y + 3 };
            if (!inZone(car, z)) return;
            const v = Math.abs(carSpeed(car));
            let hit = false;
            if (it.when === 'fast' || it.when === 'slow') { if (!e.judged) { e.judged = true; hit = it.when === 'fast' ? v > it.v : v < it.v; } }
            else hit = it.when === 'touch' || (it.when === 'brake' && !car.hold) || (it.when === 'gas' && car.hold);
            if (hit) { e.t = 0; ev('click', { x: it.x0 }); }
          } else {
            e.t += dt;
            if (e.t >= it.delay) { e.open = Math.min(1, e.open + dt * 6); for (const c of cols) c.off = true; }
          }
        };
        ents.push(e); break;
      }
      case 'fakeflag': {
        const e = { it, x: it.x, left: [...it.jumps], hop: 0 };
        run.finishX = it.x;
        e.update = (car, dt) => {
          e.hop = Math.max(0, e.hop - dt * 3);
          if (!e.left.length) return;
          if (carCenter(car).x > e.x - 3.2) { e.x += e.left.shift(); run.finishX = e.x; e.hop = 1; ev('flagrun', { x: e.x }); }
        };
        ents.push(e); break;
      }
      case 'crusher': {
        const half = it.w / 2;
        const bottom = seg(it.x - half, it.bottom, it.x + half, it.bottom, { hazard: true, item: it });
        const left = seg(it.x - half, it.bottom, it.x - half, it.bottom + 3, { item: it });
        const right = seg(it.x + half, it.bottom, it.x + half, it.bottom + 3, { item: it });
        colliders.push(bottom, left, right);
        const e = { it, y: it.top, phase: it.phase };
        e.update = (car, dt) => {
          e.phase += dt / it.period;
          // waits at the top, slams down fast, rises slowly
          const f = e.phase % 1;
          let y;
          if (f < 0.45) y = it.top;
          else if (f < 0.55) y = lerp(it.top, it.bottom, (f - 0.45) / 0.1);
          else if (f < 0.7) y = it.bottom;
          else y = lerp(it.bottom, it.top, (f - 0.7) / 0.3);
          e.y = y;
          bottom.y0 = bottom.y1 = y; left.y0 = right.y0 = y; left.y1 = right.y1 = y + 3;
          bottom.hazard = f >= 0.45 && f < 0.7;   // only the slam kills, resting on it when up is fine
        };
        ents.push(e); break;
      }
      case 'boost': {
        const e = { it, t: 0 };
        e.update = (car, dt) => {
          e.t += dt;
          if (!car.onGround || !inZone(car, { x0: it.x0, x1: it.x1, y0: it.y - 1, y1: it.y + 2 })) return;
          for (const q of car.p) if (q.vx < it.v) q.vx = it.v;
          if (e.t > 0.5) { e.t = 0; ev('boost', { x: it.x0 }); }
        };
        ents.push(e); break;
      }
      case 'wind': {
        const e = { it };
        e.update = (car, dt) => { if (inZone(car, { x0: it.x0, x1: it.x1 })) for (const q of car.p) q.vx += it.ax * dt; };
        ents.push(e); break;
      }
      case 'lowg': {
        const e = { it };
        e.update = (car) => { run.gravityScale = inZone(car, { x0: it.x0, x1: it.x1 }) ? 1 / 3 : 1; };
        ents.push(e); break;
      }
      case 'mover': {
        const base = it.pts.map(([x, y]) => [x, y]);
        const cols = polyline(base, { item: it, oneWay: 'up' });
        colliders.push(...cols);
        const e = { it, cols, phase: it.phase ?? 0, ox: 0, oy: 0 };
        e.update = (car, dt) => {
          e.phase += dt / it.period;
          const s = (1 - Math.cos(e.phase * Math.PI * 2)) / 2;  // smooth 0..1..0
          const nx = it.dx * s, ny = it.dy * s;
          const mx = nx - e.ox, my = ny - e.oy;
          e.ox = nx; e.oy = ny;
          cols.forEach((c, i) => { c.x0 = base[i][0] + nx; c.y0 = base[i][1] + ny; c.x1 = base[i + 1][0] + nx; c.y1 = base[i + 1][1] + ny; });
          // carry the car along when its wheels stand on the mover
          if (car.contacts.some((ct) => cols.includes(ct.c) && car.p[ct.i].wheel)) for (const q of car.p) { q.x += mx; q.y += my; }
        };
        ents.push(e); break;
      }
      case 'fallrock': {
        const c = circle(it.x, it.y, it.r, { item: it });
        colliders.push(c);
        const e = { it, col: c, state: 'wait', vy: 0, vx: 0 };
        e.update = (car, dt) => {
          if (e.state === 'wait') { if (carCenter(car).x > it.triggerX) { e.state = 'fall'; ev('rumble', { x: it.x }); } return; }
          if (e.state === 'fall') {
            e.vy -= 18 * dt; c.y += e.vy * dt;
            if (c.y - it.r <= it.floorY) { c.y = it.floorY + it.r; e.state = 'rest'; ev('thud', { x: it.x }); }
          }
        };
        ents.push(e); break;
      }
      case 'door': {
        const col = seg(it.x, it.y0, it.x, it.y1, { item: it });
        colliders.push(col);
        const e = { it, col, open: 0, opened: false, still: 0 };
        e.update = (car, dt) => {
          if (!e.opened) {
            const inside = inZone(car, { x0: it.zone[0], x1: it.zone[1] });
            const v = Math.abs(carSpeed(car));
            if (inside && it.when === 'stop') { e.still = v < 0.6 ? e.still + dt : 0; if (e.still > 0.4) e.opened = true; }
            if (inside && it.when === 'fast' && v > (it.v ?? 11)) e.opened = true;
            if (e.opened) ev('door', { x: it.x });
          } else if (e.open < 1) {
            e.open = Math.min(1, e.open + dt * 1.6);
            col.y0 = it.y0 + (it.y1 - it.y0) * e.open;
            if (e.open >= 1) col.off = true;
          }
        };
        ents.push(e); break;
      }
      case 'seesaw': {
        const a = seg(it.x - it.half, it.y, it.x, it.y, { item: it }), b = seg(it.x, it.y, it.x + it.half, it.y, { item: it });
        colliders.push(a, b);
        const e = { it, ang: 0, vel: 0 };
        e.update = (car, dt) => {
          const on = car.contacts.some((ct) => (ct.c === a || ct.c === b) && car.p[ct.i].wheel);
          const d = carCenter(car).x - it.x;
          const target = on ? Math.max(-it.max, Math.min(it.max, d / it.half * it.max * 1.4)) : 0;
          e.vel += (target - e.ang) * 14 * dt; e.vel *= 0.85; e.ang += e.vel * dt * 6;
          const cs = Math.cos(e.ang), sn = Math.sin(e.ang);
          a.x0 = it.x - it.half * cs; a.y0 = it.y + it.half * sn; b.x1 = it.x + it.half * cs; b.y1 = it.y - it.half * sn;
          // lift the car with the plank so it does not sink through when the plank rises under it
          if (on) { const lift = -d * e.vel * dt * 6; if (lift > 0) for (const q of car.p) q.y += lift; }
        };
        ents.push(e); break;
      }
      default: throw new Error('unknown item ' + it.k);
    }
  }
  return run;
}

// Per-step update: entities, coins, finish. `touched` is what stepCar returned.
export function updateLevel(run, car, dt, touched) {
  run.time += dt;
  for (const e of run.ents) e.update(car, dt, touched);
  const c = carCenter(car);
  for (const coin of run.coins) {
    if (!coin.got && Math.hypot(coin.x - c.x, coin.y - (c.y + 0.4)) < 1.1) { coin.got = true; run.events.push({ name: 'coin', x: coin.x, y: coin.y }); }
  }
  if (!run.won && car.p[1].x >= run.finishX) { run.won = true; run.events.push({ name: 'win' }); }
}

// ---------------------------------------------------------------------------------------------------------------
// Levels. y is metres; the car starts on the ground at `start`. Every level lists its solution as hold intervals
// [[from, to], ...] in seconds; tools/test_levels.mjs replays them and fails the build if a level became unbeatable.
// ---------------------------------------------------------------------------------------------------------------
const flat = (x0, x1, y = 0) => G([x0, y], [x1, y]);
const ramp = (x0, y0, len, h) => [[x0, y0], [x0 + len, y0 + h]];
const gap = (x0, x1, y) => P([x0, y], [x1, y]);

export const WORLDS = [
  { id: 'meadow', vehicle: 'jeep', sky: 0x8fd6ff, ground: 0x74cf4e, dirt: 0x9a6233, fog: 0xc8ecff, hill: 0x4fa86a, track: 0xd8c08a, car: {} },
  { id: 'farm', vehicle: 'tractor', sky: 0xffd49a, ground: 0xe3b65a, dirt: 0xa65a2c, fog: 0xffe6c0, hill: 0xc9743e, track: 0xc99a58, car: { maxSpeed: 13, accel: 28, brake: 14 } },
  { id: 'mall', vehicle: 'cart', sky: 0xcfe0ff, ground: 0xdfe4f4, dirt: 0x5f6a90, fog: 0xe6ecff, hill: 0x7f8fc0, track: 0xc4cbe0, car: { maxSpeed: 16, accel: 20, brake: 10 } },
  { id: 'moon', vehicle: 'buggy', sky: 0x12184a, ground: 0xb4c0e4, dirt: 0x4a4f86, fog: 0x232a66, hill: 0x3c3f8c, track: 0x96a4d4, car: { gravity: 11, maxSpeed: 14, airTorque: 4 } },
];

export const LEVELS = [
  // ---------------- World 1: Meadow (learn the button, meet the first lies) ----------------
  // level 1 teaches the button and gives a quick win (gate: a first-timer must clear it on the 1st or 2nd try)
  { w: 0, name: 'l_hold', start: [2, 0], finish: 52, killY: -8, solve: [[0, 25]],
    items: [flat(-6, 22), G([22, 0], [26, 0.7], [30, 0]), flat(30, 58), SIGN(7, 0, 's_hold'), COIN(12, 0.2), COIN(26, 1.2), COIN(40, 0.2), TREE(-3, 0), TREE(36, 0, 1.2), TREE(56, 0)] },

  // the first lie; retries start just before the trap (from the 3rd try with a run-up so short that full gas stays under
  // the limit: the game helps a stuck first-timer through), and the bridge forgives up to 13 m/s (was 11)
  { w: 0, name: 'l_safe', hint: 'h_brake', start: [2, 0], retry: [14, 0], retry2: [27, 0], finish: 70, killY: -8, solve: [[0, 1.5], [3, 25]],
    items: [flat(-6, 30), BRIDGE(30, 42, 0, { when: 'fast', v: 13, delay: 0 }), flat(42, 76), SIGN(19, 0, 's_safebridge', { lie: true }), ...COINS(34, 0.3), TREE(-3, 0), TREE(52, 0, 1.3), TREE(74, 0)] },

  { w: 0, name: 'l_gap', start: [2, 0], finish: 70, killY: -8, solve: [[0, 25]],
    items: [G([-6, 0], [26, 0], [30, 0.6]), flat(35, 75), SIGN(18, 0, 's_slow', { lie: true }), ...COINS(31, 1.6), TREE(-3, 0), TREE(50, 0)] },

  { w: 0, name: 'l_bridge', start: [2, 0], finish: 72, killY: -8, solve: [[0, 25]],
    items: [flat(-6, 28), BRIDGE(28, 40, 0, { when: 'brake', delay: 0.1 }), flat(40, 78), SIGN(22, 0, 's_bridge'), ...COINS(31, 1.2), TREE(-3, 0), TREE(60, 0, 1.2)] },

  { w: 0, name: 'l_fakeflag', start: [2, 0], finish: 40, killY: -8, solve: [[0, 25]],
    items: [flat(-6, 75), FAKEFLAG(40, 0, [22]), SIGN(30, 0, 's_almost'), ...COINS(50, 1.2), TREE(-3, 0), TREE(70, 0)] },

  { w: 0, name: 'l_trapdoor', start: [2, 0], finish: 70, killY: -8, solve: [[0, 1.5], [3, 25]],
    items: [flat(-6, 30), TRAPDOOR(30, 36, 0, { when: 'fast', v: 9, lead: 1 }), flat(36, 76), SIGN(22, 0, 's_fast', { lie: true }), ...COINS(31, 1.1), TREE(-3, 0), TREE(55, 0)] },

  { w: 0, name: 'l_spikes', start: [2, 0], finish: 80, killY: -8, solve: [[0, 25]],
    items: [G([-6, 0], [24, 0], [28, 0.7]), SPIKES(29, 33, -0.2), flat(34, 86), G([34, 0], [40, 0.8], [52, 0.8], [56, 0]), ...COINS(42, 2), SIGN(16, 0, 's_jump'), TREE(-3, 0), TREE(70, 0)] },

  { w: 0, name: 'l_crusher', start: [2, 0], finish: 70, killY: -8, solve: [[0, 0.5], [1, 25]],
    items: [flat(-6, 76), CRUSHER(34, 4, 4.5, 0.9, 2.0, { phase: 0.3 }), SIGN(24, 0, 's_timing'), ...COINS(40, 1.2), TREE(-3, 0), TREE(60, 0)] },

  { w: 0, name: 'l_rock', start: [2, 0], finish: 80, killY: -8, solve: [[0, 25]],
    items: [flat(-6, 86), FALLROCK(44, 9, 1.6, 36, 0), SIGN(26, 0, 's_rock', { lie: true }), ...COINS(55, 1.2), TREE(-3, 0), TREE(70, 0, 1.3)] },

  { w: 0, name: 'l_stop', start: [2, 0], finish: 70, killY: -8, solve: [[0, 0.5], [1, 25]],
    items: [flat(-6, 76), DOOR(40, 0, 3.2, { when: 'stop' }), SIGN(30, 0, 's_stop'), ...COINS(50, 1.2), TREE(-3, 0), TREE(66, 0)] },

  { w: 0, name: 'l_combo', start: [2, 0], finish: 100, killY: -8, solve: [[0, 0.5], [1, 25]],
    items: [flat(-6, 26), BRIDGE(26, 36, 0, { when: 'brake', delay: 0.1 }), flat(36, 60), CRUSHER(52, 4, 4.5, 0.9, 2.0, { phase: 0.75 }), flat(60, 72), TRAPDOOR(72, 78, 0, { when: 'slow', v: 10, lead: 1 }), flat(78, 106),
      SIGN(20, 0, 's_slow', { lie: true }), SIGN(44, 0, 's_timing'), SIGN(66, 0, 's_fast'), ...COINS(62, 1.5), TREE(-3, 0), TREE(95, 0)] },

  // ---------------- World 2: Farm (tractor: slow top speed, strong pull; traps start to combine) ----------------
  { w: 1, name: 'f_bridge2', start: [2, 0], finish: 76, killY: -8, solve: [[0, 1], [5, 25]],
    items: [flat(-6, 26), BRIDGE(26, 38, 0, { when: 'slow', v: 11, delay: 0.1 }), G([38, 0], [48, 0], [52, 0.6]), flat(57, 82), SIGN(18, 0, 's_slow', { lie: true }), SIGN(44, 0, 's_jump'), ...COINS(53, 1.3), TREE(-3, 0), TREE(70, 0)] },

  { w: 1, name: 'f_twodoors', start: [2, 0], finish: 90, killY: -8, solve: [[0, 2], [3, 25]],
    items: [flat(-6, 30), TRAPDOOR(30, 36, 0, { when: 'fast', v: 9, lead: 1 }), flat(36, 60), TRAPDOOR(60, 66, 0, { when: 'slow', v: 9, lead: 1 }), flat(66, 96),
      SIGN(22, 0, 's_fast', { lie: true }), SIGN(52, 0, 's_slow', { lie: true }), ...COINS(44, 1.3), TREE(-3, 0), TREE(86, 0)] },

  { w: 1, name: 'f_plate', start: [2, 0], finish: 84, killY: -8, solve: [[0, 2.5], [3.5, 25]],
    items: [flat(-6, 40), TRAPDOOR(40, 46, 0, { when: 'fast', v: 9, lead: 1 }), G([46, 0], [52, 0], [56, 0.7]), flat(60, 90), SIGN(32, 0, 's_slow'), SIGN(48, 0, 's_jump'), ...COINS(61, 1.3), TREE(-3, 0), TREE(84, 0)] },

  { w: 1, name: 'f_crushers', start: [2, 0], finish: 86, killY: -8, solve: [[0, 0.5], [1, 25]],
    items: [flat(-6, 92), CRUSHER(34, 3.5, 4.5, 0.9, 1.8, { phase: 0.2 }), CRUSHER(50, 3.5, 4.5, 0.9, 1.8, { phase: 0.7 }), SIGN(24, 0, 's_timing'), ...COINS(62, 1.3), TREE(-3, 0), TREE(80, 0)] },

  { w: 1, name: 'f_fastdoor', start: [2, 0], finish: 76, killY: -8, solve: [[0, 25]],
    items: [flat(-6, 82), DOOR(44, 0, 3.2, { when: 'fast', v: 12, zone: [36, 43] }), SIGN(30, 0, 's_stop', { lie: true }), ...COINS(56, 1.3), TREE(-3, 0), TREE(72, 0)] },

  { w: 1, name: 'f_wind', start: [2, 0], finish: 86, killY: -8, solve: [[0, 25]],
    items: [G([-6, 0], [30, 0], [34, 0.6]), flat(38, 92), WIND(16, 30, -4), SIGN(10, 0, 's_wind'), ...COINS(44, 1.3), TREE(-3, 0), TREE(80, 0)] },

  { w: 1, name: 'f_flag2', start: [2, 0], finish: 44, killY: -8, solve: [[0, 3.5], [4.5, 25]],
    items: [flat(-6, 46), FAKEFLAG(44, 0, [14, 14]), TRAPDOOR(46, 51, 0, { when: 'gas', delay: 0.05 }), flat(51, 84), SIGN(34, 0, 's_almost'), ...COINS(66, 1.3), TREE(-3, 0), TREE(80, 0)] },

  { w: 1, name: 'f_rockwait', start: [2, 0], finish: 90, killY: -8, solve: [[0, 1], [2, 25]],
    items: [flat(-6, 60.4), FALLROCK(40, 9, 1.6, 30, 0), FALLROCK(62, 10, 1.6, 50, -3.2), flat(63.6, 96), SIGN(20, 0, 's_hurry'), SIGN(46, 0, 's_timing'), ...COINS(76, 1.3), TREE(-3, 0), TREE(90, 0)] },

  { w: 1, name: 'f_bridgecrush', start: [2, 0], finish: 90, killY: -8, solve: [[0, 25]],
    items: [flat(-6, 28), BRIDGE(28, 50, 0, { when: 'brake', delay: 0.1 }), CRUSHER(40, 3.5, 4.5, 0.9, 2.0, { phase: 0.5 }), flat(50, 96), SIGN(20, 0, 's_bridge'), SIGN(32, 0, 's_timing'), ...COINS(60, 1.3), TREE(-3, 0), TREE(90, 0)] },

  { w: 1, name: 'f_combo', start: [2, 0], finish: 116, killY: -8, solve: [[0, 4], [5, 25]],
    items: [flat(-6, 24), BRIDGE(24, 38, 0, { when: 'slow', v: 11, delay: 0.1 }), flat(38, 56), TRAPDOOR(56, 62, 0, { when: 'fast', v: 9, lead: 1 }), flat(62, 80), DOOR(88, 0, 3.2, { when: 'stop', zone: [80, 87] }), flat(80, 122),
      SIGN(16, 0, 's_slow', { lie: true }), SIGN(48, 0, 's_fast', { lie: true }), SIGN(72, 0, 's_stop'), ...COINS(100, 1.3), TREE(-3, 0), TREE(116, 0)] },

  // ---------------- World 3: Mall (shopping cart: fast, weak brakes, ice floors) ----------------
  { w: 2, name: 'm_ice', start: [2, 0], finish: 80, killY: -8, solve: [[0, 2], [5, 25]],
    items: [flat(-6, 26), ICE([26, 0], [50, 0]), flat(50, 60), DOOR(66, 0, 3.2, { when: 'stop', zone: [58, 65] }), flat(60, 86), SIGN(18, 0, 's_ice'), SIGN(52, 0, 's_stop'), ...COINS(36, 1.3), TREE(-3, 0), TREE(80, 0)] },

  { w: 2, name: 'm_mover', start: [2, 0], finish: 84, killY: -8, solve: [[0, 1], [5.5, 7.5]],
    items: [flat(-6, 30), MOVER([[30, 0], [38, 0]], 12, 0, 6, { phase: 0.57 }), flat(50, 90), SIGN(20, 0, 's_timing'), ...COINS(62, 1.3), TREE(-3, 0), TREE(84, 0)] },

  { w: 2, name: 'm_boost', start: [2, 0], finish: 96, killY: -8, solve: [[0, 3], [5, 25]],
    items: [G([-6, 0], [36, 0], [40, 1.0]), BOOST(24, 30, 0, 24), flat(52, 72), TRAPDOOR(72, 78, 0, { when: 'fast', v: 14, lead: 1 }), flat(78, 102), SIGN(16, 0, 's_free'), SIGN(62, 0, 's_slow'), ...COINS(58, 1.3), TREE(-3, 0), TREE(96, 0)] },

  { w: 2, name: 'm_icegap', start: [2, 0], finish: 84, killY: -8, solve: [[0, 0.5], [2.5, 25]],
    items: [flat(-6, 20), ICE([20, 0], [36, 0], [40, 0.6]), flat(46, 56), DOOR(62, 0, 3.2, { when: 'stop', zone: [54, 61] }), flat(56, 90), SIGN(12, 0, 's_ice'), SIGN(48, 0, 's_stop'), ...COINS(60, 1.3), TREE(-3, 0), TREE(84, 0)] },

  { w: 2, name: 'm_triple', start: [2, 0], finish: 90, killY: -8, solve: [[0, 0.5], [10.5, 25]],
    items: [flat(-6, 96), CRUSHER(34, 3, 4.5, 0.9, 1.6, { phase: 0 }), CRUSHER(42, 3, 4.5, 0.9, 1.6, { phase: 0.33 }), CRUSHER(50, 3, 4.5, 0.9, 1.6, { phase: 0.66 }), SIGN(24, 0, 's_timing'), ...COINS(66, 1.3), TREE(-3, 0), TREE(90, 0)] },

  { w: 2, name: 'm_icebrake', start: [2, 0], finish: 84, killY: -8, solve: [[0, 25]],
    items: [flat(-6, 26), ICE([26, 0], [40, 0]), TRAPDOOR(40, 48, 0, { when: 'brake', delay: 0.1 }), flat(48, 90), SIGN(18, 0, 's_slow', { lie: true }), ...COINS(60, 1.3), TREE(-3, 0), TREE(84, 0)] },

  { w: 2, name: 'm_fastice', start: [2, 0], finish: 90, killY: -8, solve: [[0, 25]],
    items: [flat(-6, 30), ICE([30, 0], [50, 0]), DOOR(58, 0, 3.2, { when: 'fast', v: 13, zone: [50, 57] }), flat(50, 96), SIGN(22, 0, 's_stop', { lie: true }), ...COINS(70, 1.3), TREE(-3, 0), TREE(90, 0)] },

  { w: 2, name: 'm_lift', start: [2, 0], finish: 84, killY: -8, solve: [[0, 0.5], [3, 25]],
    items: [flat(-6, 30), MOVER([[30, 0], [38, 0]], 0, 5, 6), flat(42, 90, 5), G([42, 5], [42, 0]), SIGN(20, 0, 's_timing'), ...COINS(60, 5.2), TREE(-3, 0), TREE(84, 5)] },

  { w: 2, name: 'm_windboost', start: [2, 0], finish: 96, killY: -8, solve: [[0, 25]],
    items: [G([-6, 0], [40, 0], [44, 0.7]), BOOST(30, 36, 0, 22), WIND(20, 44, -5), flat(50, 102), SIGN(12, 0, 's_wind'), ...COINS(60, 1.3), TREE(-3, 0), TREE(96, 0)] },

  { w: 2, name: 'm_combo', start: [2, 0], finish: 124, killY: -8, solve: [[0, 1], [2.5, 25]],
    items: [flat(-6, 20), ICE([20, 0], [30, 0]), TRAPDOOR(30, 36, 0, { when: 'fast', v: 11, lead: 1 }), G([36, 0], [66, 0], [70, 1.0]), BOOST(56, 62, 0, 24), flat(82, 100), CRUSHER(94, 3, 4.5, 0.9, 1.8, { phase: 0.4 }), flat(100, 130),
      SIGN(12, 0, 's_ice'), SIGN(48, 0, 's_free'), SIGN(86, 0, 's_timing'), ...COINS(110, 1.3), TREE(-3, 0), TREE(124, 0)] },

  // ---------------- World 4: Moon (buggy: low gravity zones, long floaty jumps) ----------------
  { w: 3, name: 'o_float', start: [2, 0], finish: 90, killY: -8, solve: [[0, 25]],
    items: [G([-6, 0], [30, 0], [34, 0.8]), LOWG(20, 70), flat(50, 96), SIGN(12, 0, 's_moon'), ...COINS(42, 2.5), TREE(-3, 0), TREE(90, 0)] },

  { w: 3, name: 'o_ceiling', start: [2, 0], finish: 90, killY: -8, solve: [[0, 25]],
    items: [G([-6, 0], [30, 0], [34, 0.8]), LOWG(20, 70), SPIKES(38, 48, 4.0), flat(50, 96), SIGN(12, 0, 's_jump'), ...COINS(42, 1.5), TREE(-3, 0), TREE(90, 0)] },

  { w: 3, name: 'o_crush', start: [2, 0], finish: 86, killY: -8, solve: [[0, 0.5], [1.5, 25]],
    items: [flat(-6, 92), LOWG(20, 60), CRUSHER(40, 4, 4.5, 0.9, 2.4, { phase: 0.1 }), SIGN(24, 0, 's_timing'), ...COINS(60, 1.3), TREE(-3, 0), TREE(86, 0)] },

  { w: 3, name: 'o_flag3', start: [2, 0], finish: 40, killY: -8, solve: [[0, 25]],
    items: [flat(-6, 100), FAKEFLAG(40, 0, [16, 16, 16]), SIGN(30, 0, 's_flag'), ...COINS(70, 1.3), TREE(-3, 0), TREE(96, 0)] },

  { w: 3, name: 'o_wind', start: [2, 0], finish: 96, killY: -8, solve: [[0, 3]],
    items: [G([-6, 0], [36, 0], [40, 0.8]), LOWG(20, 80), WIND(40, 60, 5), SPIKES(66, 72, -0.2), flat(58, 66), flat(72, 102), SIGN(14, 0, 's_wind'), ...COINS(76, 1.3), TREE(-3, 0), TREE(96, 0)] },

  { w: 3, name: 'o_crush2', start: [2, 0], finish: 86, killY: -8, solve: [[0, 0.5], [1.5, 25]],
    items: [flat(-6, 92), LOWG(20, 70), CRUSHER(36, 3.5, 4.5, 0.9, 2.2, { phase: 0.1 }), CRUSHER(52, 3.5, 4.5, 0.9, 2.2, { phase: 0.6 }), SIGN(24, 0, 's_timing'), ...COINS(64, 1.3), TREE(-3, 0), TREE(86, 0)] },

  { w: 3, name: 'o_bridge', start: [2, 0], finish: 90, killY: -8, solve: [[0, 1.5], [2.5, 25]],
    items: [flat(-6, 26), BRIDGE(26, 40, 0, { when: 'fast', v: 10, delay: 0.1 }), G([40, 0], [50, 0], [54, 0.8]), LOWG(50, 90), flat(68, 96), SIGN(18, 0, 's_fast', { lie: true }), SIGN(44, 0, 's_jump'), ...COINS(58, 2), TREE(-3, 0), TREE(90, 0)] },

  { w: 3, name: 'o_doors', start: [2, 0], finish: 100, killY: -8, solve: [[0, 3.5], [5, 25]],
    items: [flat(-6, 30), TRAPDOOR(30, 36, 0, { when: 'slow', v: 9, lead: 1 }), flat(36, 56), TRAPDOOR(56, 62, 0, { when: 'fast', v: 9, lead: 1 }), flat(62, 80), TRAPDOOR(80, 86, 0, { when: 'gas', delay: 0.1 }), flat(86, 106),
      SIGN(22, 0, 's_fast'), SIGN(48, 0, 's_slow'), SIGN(72, 0, 's_trust', { lie: true }), ...COINS(66, 1.3), TREE(-3, 0), TREE(100, 0)] },

  { w: 3, name: 'o_rocks', start: [2, 0], finish: 96, killY: -8, solve: [[0, 25]],
    items: [flat(-6, 102), LOWG(10, 100), FALLROCK(40, 10, 1.6, 30, 0), FALLROCK(62, 10, 1.6, 52, 0), SIGN(20, 0, 's_rock', { lie: true }), ...COINS(76, 1.3), TREE(-3, 0), TREE(96, 0)] },

  { w: 3, name: 'o_final', start: [2, 0], finish: 126, killY: -8, solve: [[0, 7], [9, 25]],
    items: [flat(-6, 26), BRIDGE(26, 36, 0, { when: 'brake', delay: 0.1 }), G([36, 0], [50, 0], [54, 0.8]), LOWG(50, 80), flat(66, 104), TRAPDOOR(104, 110, 0, { when: 'fast', v: 9, lead: 1 }), flat(110, 132),
      SIGN(18, 0, 's_slow', { lie: true }), SIGN(44, 0, 's_jump'), SIGN(80, 0, 's_trust', { lie: true }), SIGN(98, 0, 's_fast', { lie: true }), ...COINS(114, 1.3), TREE(-3, 0), TREE(126, 0)] },
];

// quick helpers for other modules
export function carOf(level) { return { ...(WORLDS[level.w]?.car || {}), ...(level.car || {}) }; }
export function levelsOfWorld(w) { return LEVELS.map((l, i) => ({ ...l, i })).filter((l) => l.w === w); }
export function holdAt(solve, t) { return solve.some(([a, b]) => t >= a && t < b); }
