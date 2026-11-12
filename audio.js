// Sound effects (small mp3 files), a procedural engine hum and a light procedural music loop, all through one
// AudioContext. Browsers only allow audio after a user gesture: call audio.unlock() from input handlers.

const SFX = ['buy', 'click', 'close', 'coin', 'crack', 'crash', 'error', 'jump', 'land', 'open', 'thud', 'unlock', 'whoosh', 'win'];

let ctx = null, master = null, sfxGain = null, musicGain = null, engGain = null, engOsc = null, engOsc2 = null;
const buffers = {};
let soundOn = true, musicOn = true, suspended = 0, musicTimer = null;

function makeCtx() {
  if (ctx) return;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  master = ctx.createGain(); master.connect(ctx.destination);
  sfxGain = ctx.createGain(); sfxGain.connect(master);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.0; musicGain.connect(master);
  // engine: two detuned saws through a low-pass, volume and pitch follow the car
  engGain = ctx.createGain(); engGain.gain.value = 0;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
  engOsc = ctx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 60;
  engOsc2 = ctx.createOscillator(); engOsc2.type = 'square'; engOsc2.frequency.value = 61;
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
  musicGain.gain.setTargetAtTime(musicOn ? 0.14 : 0, ctx.currentTime, 0.3);
}

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
  f.type = 'highpass'; f.frequency.value = 7000;
  s.buffer = noiseBuf; g.gain.value = 0.1;
  s.connect(f).connect(g).connect(musicGain); s.start(t);
}
function scheduleMusic() {
  if (!ctx || ctx.state !== 'running') return;
  if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
  while (nextTime < ctx.currentTime + 0.4) {
    const bar = Math.floor(stepIdx / 16) % 4, s = stepIdx % 16;
    const chord = CHORDS[bar];
    if (s % 4 === 0) note(hz(chord[0] - 24), nextTime, STEP * 3.5, 'triangle', 0.32, musicGain);
    if (s % 4 === 2) note(hz(chord[0] - 12), nextTime, STEP * 1.5, 'triangle', 0.16, musicGain);
    if (s % 8 === 4) chord.forEach((m) => note(hz(m), nextTime, STEP * 2, 'sine', 0.05, musicGain));
    const l = LEAD[bar][s];
    if (l > 0) note(hz(l), nextTime, STEP * 1.8, 'square', 0.03, musicGain);
    if (s % 2 === 1) hat(nextTime);
    nextTime += STEP; stepIdx++;
  }
}

for (const ev of ['touchend', 'pointerup', 'keydown']) {
  document.addEventListener(ev, () => { if (ctx && suspended === 0 && ctx.state !== 'running') ctx.resume().catch(() => {}); }, true);
}

export const audio = {
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
    const target = on ? 0.05 + throttle * 0.07 : 0;
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
