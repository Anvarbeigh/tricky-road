// Sound effects (small mp3 files), a procedural engine hum and a light procedural music loop, all through one
// AudioContext. Browsers only allow audio after a user gesture: call audio.unlock() from input handlers.

const SFX = ['buy', 'click', 'close', 'coin', 'crack', 'crash', 'error', 'jump', 'land', 'lose', 'open', 'thud', 'unlock', 'whoosh', 'win'];

let ctx = null, master = null, sfxGain = null, musicGain = null, engGain = null, engOsc = null, engOsc2 = null;
const buffers = {};
let soundOn = true, musicOn = true, suspended = 0, musicTimer = null;

function makeCtx() {
  if (ctx) return;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  // master bus: gentle compressor + brick-wall-ish limiter, so stacked effects never clip (gate: true peak <= -1 dBFS)
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.0005; lim.release.value = 0.08;
  const out = ctx.createGain(); out.gain.value = 0.7;
  master = ctx.createGain(); master.connect(comp); comp.connect(lim); lim.connect(out); out.connect(ctx.destination);
  sfxGain = ctx.createGain(); sfxGain.connect(master);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.0; musicGain.connect(master);
  // engine: a soft toy-motor hum (triangle + sine, low-passed), volume and pitch follow the car
  engGain = ctx.createGain(); engGain.gain.value = 0;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4;
  engOsc = ctx.createOscillator(); engOsc.type = 'triangle'; engOsc.frequency.value = 60;
  engOsc2 = ctx.createOscillator(); engOsc2.type = 'sine'; engOsc2.frequency.value = 61;
  engOsc.connect(lp); engOsc2.connect(lp); lp.connect(engGain); engGain.connect(sfxGain);
  engOsc.start(); engOsc2.start();
  for (const name of SFX) {
    fetch(`./assets/sfx/${name}.mp3`).then((r) => r.arrayBuffer())
      .then((b) => new Promise((ok, bad) => ctx.decodeAudioData(b, ok, bad)))
      .then((buf) => { buffers[name] = buf; }).catch(() => { /* missing sound: stay silent */ });
  }
}

function apply() {
  if (!ctx) return;
  const audible = suspended === 0;
  if (audible && ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (!audible && ctx.state === 'running') ctx.suspend().catch(() => {});
  sfxGain.gain.value = soundOn ? 1 : 0;
  musicGain.gain.setTargetAtTime(musicOn ? MUSIC_LEVEL : 0, ctx.currentTime, 0.3);
}

const MUSIC_LEVEL = 0.62;   // set so the music sits ~7 dB under the effects (tools/test_audio.mjs)
// --- procedural music: bouncy I–vi–IV–V loop, plucky lead + bass + hats --------------------------------
const BPM = 126, STEP = 60 / BPM / 2;
const CHORDS = [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]]; // D Bm G A
const LEAD = [
  [74, -1, 78, -1, 81, 78, -1, 74, 76, -1, 78, -1, 74, -1, -1, -1],
  [74, -1, 78, -1, 81, 78, -1, 74, 73, -1, 74, -1, 71, -1, -1, -1],
  [71, -1, 74, -1, 79, 74, -1, 71, 73, -1, 74, -1, 76, -1, -1, -1],
  [73, -1, 76, -1, 81, 76, -1, 73, 74, -1, 76, -1, 78, -1, 81, -1],
];
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
let nextTime = 0, stepIdx = 0;

function note(freq, t, dur, type, vol, out) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}
let noiseBuf = null;
function hat(t) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  }
  const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 6000; f.Q.value = 0.7;
  s.buffer = noiseBuf; g.gain.value = 0.035;
  s.connect(f).connect(g).connect(musicGain); s.start(t);
}
function scheduleMusic() {
  if (!ctx || ctx.state !== 'running') return;
  if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
  while (nextTime < ctx.currentTime + 0.4) scheduleAt();
}
function scheduleAt() {
  {
    const bar = Math.floor(stepIdx / 16) % 4, s = stepIdx % 16;
    const chord = CHORDS[bar];
    if (s % 4 === 0) note(hz(chord[0] - 24), nextTime, STEP * 3.5, 'triangle', 0.32, musicGain);
    if (s % 4 === 2) note(hz(chord[0] - 12), nextTime, STEP * 1.5, 'triangle', 0.16, musicGain);
    if (s % 8 === 4) chord.forEach((m) => note(hz(m), nextTime, STEP * 2, 'sine', 0.05, musicGain));
    const l = LEAD[bar][s];
    if (l > 0) note(hz(l), nextTime, STEP * 1.6, 'triangle', 0.07, musicGain);
    if (s % 2 === 1) hat(nextTime);
    nextTime += STEP; stepIdx++;
  }
}

for (const ev of ['touchend', 'pointerup', 'keydown']) {
  document.addEventListener(ev, () => { if (ctx && suspended === 0 && ctx.state !== 'running') ctx.resume().catch(() => {}); }, true);
}

// test hook: render `sec` seconds of the music offline and measure it against the effects (RMS of the loud part)
async function measureMix(sec = 8) {
  makeCtx();
  for (let i = 0; i < 50 && Object.keys(buffers).length < SFX.length; i++) await new Promise((r) => setTimeout(r, 100));
  const off = new OfflineAudioContext(1, 44100 * sec, 44100), saved = [ctx, musicGain, nextTime, stepIdx, noiseBuf];
  ctx = off; musicGain = off.createGain(); musicGain.gain.value = MUSIC_LEVEL; musicGain.connect(off.destination); nextTime = 0; stepIdx = 0; noiseBuf = null;
  while (nextTime < sec - 0.5) { const bar = Math.floor(stepIdx / 16) % 4; scheduleAt(bar); }
  const buf = await off.startRendering();
  [ctx, musicGain, nextTime, stepIdx, noiseBuf] = saved;
  const rms = (d) => { let s = 0, n = 0, pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v)); for (const v of d) if (Math.abs(v) > pk * 0.05) { s += v * v; n++; } return { rms: 10 * Math.log10(s / Math.max(1, n) + 1e-12), peak: 20 * Math.log10(pk + 1e-12) }; };
  const out = { music: rms(buf.getChannelData(0)), sfx: {} };
  for (const k of SFX) if (buffers[k]) out.sfx[k] = rms(buffers[k].getChannelData(0));
  return out;
}
export const audio = {
  measureMix,
  unlock() {
    makeCtx();
    apply();
    if (!musicTimer && ctx) musicTimer = setInterval(scheduleMusic, 120);
  },
  play(name, { vol = 1, rate = 1 } = {}) {
    if (!ctx || !soundOn || suspended || !buffers[name]) return;
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buffers[name]; s.playbackRate.value = rate; g.gain.value = vol;
    s.connect(g).connect(sfxGain); s.start();
  },
  blip(freqs, dur = 0.08, vol = 0.05) {
    if (!ctx || !soundOn || suspended) return;
    const t = ctx.currentTime;
    freqs.forEach((f, i) => note(f, t + i * dur, dur * 1.2, 'triangle', vol, sfxGain));
  },
  // engine: throttle 0..1, speed 0..1 (fraction of max), on = driving at all
  engine(throttle, speed, on) {
    if (!ctx || !engGain) return;
    const t = ctx.currentTime;
    const target = on ? 0.035 + throttle * 0.045 : 0;
    engGain.gain.setTargetAtTime(target, t, 0.08);
    const f = 50 + speed * 130 + throttle * 25;
    engOsc.frequency.setTargetAtTime(f, t, 0.1);
    engOsc2.frequency.setTargetAtTime(f * 1.01 + 1, t, 0.1);
  },
  suspend() { suspended++; apply(); },
  resume() { if (suspended > 0) suspended--; apply(); },
  setSound(on) { soundOn = on; apply(); },
  setMusic(on) { musicOn = on; apply(); },
  get soundOn() { return soundOn; },
  get muted() { return suspended > 0 || (ctx ? ctx.state !== 'running' : false); },
  get musicOn() { return musicOn; },
};
