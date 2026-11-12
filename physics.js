// 2D car physics for Tricky Road. No rendering here, so the game logic can run in node tests.
// The car is four particles held rigid by distance constraints (position based dynamics). Fixed step,
// so every refresh rate plays the same level the same way.

export const DT = 1 / 120;
const ITER = 6;
export const WHEEL_R = 0.42, ROOF_R = 0.28;

// particle layout in car space: 0 rear wheel, 1 front wheel, 2 rear roof, 3 front roof
const LAYOUT = [[-0.95, 0], [0.95, 0], [-0.75, 1.0], [0.75, 1.0]];

export const DEFAULT_CAR = {
  accel: 22,        // m/s² at the wheels while holding
  brake: 12,        // m/s² against the rolling direction while released (gentle, so speed can be dosed)
  maxSpeed: 15,
  airTorque: 5.5,   // rad/s² while holding (nose up) or released (nose down)
  gravity: 18,
  grip: 1.0,
  crashSpeed: 9,    // hitting a wall (sideways normal) faster than this crashes even on the wheels
};

export function makeCar(x, y, opts = {}) {
  const o = { ...DEFAULT_CAR, ...opts };
  const p = LAYOUT.map(([lx, ly], i) => ({ x: x + lx, y: y + ly + WHEEL_R, vx: 0, vy: 0, r: i < 2 ? WHEEL_R : ROOF_R, wheel: i < 2 }));
  const cons = [];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) cons.push({ i, j, d: Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y) });
  return { p, cons, o, onGround: 0, crashed: false, crashReason: '', hitHazard: false, gravityDir: 1, gravityScale: 1, contacts: [], spin: 0 };
}

export function carCenter(car) {
  const p = car.p;
  return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
}
export function carAngle(car) { return Math.atan2(car.p[1].y - car.p[0].y, car.p[1].x - car.p[0].x); }
export function carSpeed(car) {
  const vx = (car.p[0].vx + car.p[1].vx) / 2, vy = (car.p[0].vy + car.p[1].vy) / 2;
  return Math.hypot(vx, vy) * Math.sign(vx || 1);
}

// --- colliders -----------------------------------------------------------------------------------------
// segment: { kind:'seg', x0,y0,x1,y1, hazard?, friction?(1), oneWay?('up') , id }
// circle:  { kind:'circle', x,y,r, hazard?, id }
export function seg(x0, y0, x1, y1, extra = {}) { return { kind: 'seg', x0, y0, x1, y1, friction: 1, ...extra }; }
export function circle(x, y, r, extra = {}) { return { kind: 'circle', x, y, r, ...extra }; }
export function polyline(pts, extra = {}) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push(seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], extra));
  return out;
}

function closestOnSeg(s, px, py) {
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - s.x0) * dx + (py - s.y0) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: s.x0 + t * dx, y: s.y0 + t * dy, t };
}

// Push particle q out of collider c. Returns contact info or null.
function collide(q, c, oldx, oldy) {
  if (c.kind === 'seg') {
    const k = closestOnSeg(c, q.x, q.y);
    const tol = c.hazard ? 0.08 : 0;
    if (k.t > 0 && k.t < 1) {
      // inside the segment: the particle stays on the side it came from, so a thin line can never pass
      // through the car between a wheel and the roof
      const dx = c.x1 - c.x0, dy = c.y1 - c.y0, l = Math.hypot(dx, dy) || 1;
      const lx = -dy / l, ly = dx / l;                               // left normal
      const sOld = (oldx - c.x0) * lx + (oldy - c.y0) * ly;
      const side = sOld >= 0 ? 1 : -1;
      const nx = lx * side, ny = ly * side;
      if (c.oneWay === 'up' && ny < 0.3) return null;
      const sd = (q.x - c.x0) * nx + (q.y - c.y0) * ny;
      if (sd >= q.r + tol) return null;
      const pen = Math.max(0, q.r - sd);
      q.x += nx * pen; q.y += ny * pen;
      return { nx, ny, c, pen };
    }
    // segment ends: round, two-sided
    let nx = q.x - k.x, ny = q.y - k.y;
    const d = Math.hypot(nx, ny);
    if (d >= q.r + tol) return null;
    // a wheel meeting a low step corner rolls up over it instead of slamming into it
    if (q.wheel && !c.hazard && ny > 0.45 * q.r && ny < q.r) {
      const lift = q.r - ny;
      q.y += lift;
      return { nx: 0, ny: 1, c, pen: lift };
    }
    if (d < 1e-6) { nx = 0; ny = 1; } else { nx /= d; ny /= d; }
    if (c.oneWay === 'up' && ny < 0.3) return null;
    const pen = Math.max(0, q.r - d);
    q.x += nx * pen; q.y += ny * pen;
    return { nx, ny, c, pen };
  }
  const dx = q.x - c.x, dy = q.y - c.y, d = Math.hypot(dx, dy), R = q.r + c.r;
  if (d >= R || d < 1e-6) return null;
  const nx = dx / d, ny = dy / d, pen = R - d;
  q.x += nx * pen; q.y += ny * pen;
  return { nx, ny, c, pen };
}

// Advance the car one fixed step. `hold` is the single button. `colliders` is the live list for this step.
// Returns the list of colliders touched (for triggers and sounds).
export function stepCar(car, hold, colliders, dt = DT) {
  const { p, cons, o } = car;
  const gs = car.gravityScale ?? 1;              // low-gravity zones: lighter car, calmer air control
  const g = o.gravity * gs * car.gravityDir;
  const n = p.length;
  const old = p.map((q) => ({ x: q.x, y: q.y }));

  // --- velocities: gravity, drive on grounded wheels, air pitch control
  for (const q of p) q.vy -= g * dt;
  const grounded = car.contacts.length > 0;
  if (!grounded) {
    // torque around the centre: opposite tangential impulses on the two ends
    const c = carCenter(car);
    const w = (hold ? 1 : -0.6) * o.airTorque * gs * gs * dt;
    for (const q of p) {
      const rx = q.x - c.x, ry = q.y - c.y;
      q.vx += -ry * w; q.vy += rx * w;
    }
  } else {
    for (const ct of car.contacts) {
      const q = p[ct.i];
      if (!q.wheel) continue;
      const s = ct.c;
      // tangent along the surface pointing +x-ish
      let tx = ct.ny, ty = -ct.nx;
      if (tx < 0) { tx = -tx; ty = -ty; }
      const fr = s.friction ?? 1;
      const along = q.vx * tx + q.vy * ty;
      let a = 0;
      if (hold) a = o.accel * fr * o.grip;
      else if (Math.abs(along) > 0.05) a = -Math.sign(along) * Math.min(o.brake * fr, Math.abs(along) / dt);
      // the engine stops pushing above max speed but never brakes there: a booster pad can send the car faster
      const na = along + a * dt;
      const cap = o.maxSpeed * (s.boost || 1);
      const capped = hold ? (along >= cap ? along : Math.min(cap, na)) : Math.max(-cap, na);
      // most of the push goes through the whole body, so gas and brake do not flip the car over
      const dv = capped - along;
      q.vx += dv * 0.4 * tx; q.vy += dv * 0.4 * ty;
      for (const r of p) { r.vx += dv * 0.15 * tx; r.vy += dv * 0.15 * ty; }
    }
  }
  // damping: keeps the constraint solver calm at high speed
  for (const q of p) { q.vx *= 0.999; q.vy *= 0.999; }

  // --- predict
  for (const q of p) { q.x += q.vx * dt; q.y += q.vy * dt; }

  // --- constraints + collisions
  const contacts = [];
  for (let it = 0; it < ITER; it++) {
    for (const k of cons) {
      const a = p[k.i], b = p[k.j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
      const corr = (d - k.d) / d * 0.5;
      a.x += dx * corr; a.y += dy * corr; b.x -= dx * corr; b.y -= dy * corr;
    }
    for (let i = 0; i < n; i++) {
      const q = p[i];
      for (const c of colliders) {
        if (c.off) continue;
        const ct = collide(q, c, old[i].x, old[i].y);
        if (!ct) continue;
        if (it === ITER - 1) contacts.push({ i, ...ct });
      }
    }
  }

  // --- velocities from positions, then contact response (no bounce, friction on roof points)
  for (let i = 0; i < n; i++) { const q = p[i]; q.vx = (q.x - old[i].x) / dt; q.vy = (q.y - old[i].y) / dt; }
  let roofHit = 0, wallHit = 0, hazard = false;
  for (const ct of contacts) {
    const q = p[ct.i];
    const vn = q.vx * ct.nx + q.vy * ct.ny;
    if (ct.c.hazard) hazard = true;
    if (!q.wheel && !ct.c.soft) roofHit = Math.max(roofHit, -vn);
    if (q.wheel && Math.abs(ct.nx) > 0.7) wallHit = Math.max(wallHit, -vn);
    if (vn < 0) { q.vx -= vn * ct.nx; q.vy -= vn * ct.ny; }
    if (!q.wheel) { q.vx *= 0.7; q.vy *= 0.7; }
  }
  car.contacts = contacts;

  // --- outcomes
  const touched = [];
  for (const ct of contacts) if (!touched.includes(ct.c)) touched.push(ct.c);
  if (!car.crashed) {
    // chassis "up" = from the wheel axle to the roof; below 0.35 the car is on its side or upside down
    const ax = (p[0].x + p[1].x) / 2, ay = (p[0].y + p[1].y) / 2, rx = (p[2].x + p[3].x) / 2, ry = (p[2].y + p[3].y) / 2;
    const upY = (ry - ay) / (Math.hypot(rx - ax, ry - ay) || 1) * car.gravityDir;
    const roofTouch = contacts.some((ct) => !p[ct.i].wheel && !ct.c.soft);
    if (hazard) { car.crashed = true; car.crashReason = 'hazard'; car.hitHazard = true; }
    else if (roofTouch && (upY < 0.35 || roofHit > (upY > 0.8 ? 7 : 4))) { car.crashed = true; car.crashReason = 'roof'; }
    else if (wallHit > o.crashSpeed) { car.crashed = true; car.crashReason = 'wall'; }
  }
  car.onGround = contacts.some((ct) => p[ct.i].wheel) ? 1 : 0;
  return touched;
}

// Axis-aligned trigger test against the car's centre
export function inZone(car, z) {
  const c = carCenter(car);
  return c.x >= z.x0 && c.x <= z.x1 && c.y >= (z.y0 ?? -1e9) && c.y <= (z.y1 ?? 1e9);
}
