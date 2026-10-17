/**
 * A small offline synthesiser that renders royalty-free music beds and sound effects in the
 * browser. Everything is generated with Web Audio on an OfflineAudioContext, so nothing is
 * downloaded and every render is identical.
 */

const SR = 44100;

// ---------- helpers ----------

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Deterministic pseudo-random numbers so a track sounds the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed = 1): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(seed);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return buf;
}

/** A decaying stereo noise impulse used as a cheap, pleasant reverb. */
function reverbImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.ceil(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = rng(7 + ch);
    for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

interface Bus {
  ctx: OfflineAudioContext;
  out: AudioNode;
  verb: AudioNode;
  noise: AudioBuffer;
  /** Pre-rendered one-shots, so each hit is a single buffer source instead of a node graph. */
  bank: Map<string, AudioBuffer>;
}

function makeBus(ctx: OfflineAudioContext, reverb = 0.25): Bus {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  comp.connect(master).connect(ctx.destination);
  const conv = ctx.createConvolver();
  conv.buffer = reverbImpulse(ctx, 2.2, 3);
  const wet = ctx.createGain();
  wet.gain.value = reverb;
  conv.connect(wet).connect(comp);
  return { ctx, out: comp, verb: conv, noise: noiseBuffer(ctx, 2), bank: new Map() };
}

function env(g: AudioParam, t: number, peak: number, attack: number, decay: number, sustain = 0, release = 0, hold = 0) {
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak, t + attack);
  if (sustain > 0) {
    g.setTargetAtTime(peak * sustain, t + attack, decay / 3);
    g.setValueAtTime(peak * sustain, t + attack + hold);
    g.setTargetAtTime(0.0001, t + attack + hold, release / 4);
  } else {
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
}

function connect(b: Bus, node: AudioNode, send = 0) {
  node.connect(b.out);
  if (send > 0) {
    const s = b.ctx.createGain();
    s.gain.value = send;
    node.connect(s).connect(b.verb);
  }
}

// ---------- sampled one-shots ----------

/** Builds (once per render) a mono one-shot from a per-sample generator. */
function sample(b: Bus, key: string, seconds: number, gen: (t: number, i: number, rand: () => number) => number): AudioBuffer {
  let buf = b.bank.get(key);
  if (buf) return buf;
  const sr = b.ctx.sampleRate;
  buf = b.ctx.createBuffer(1, Math.ceil(seconds * sr), sr);
  const d = buf.getChannelData(0);
  const r = rng(key.length * 97 + 13);
  for (let i = 0; i < d.length; i++) d[i] = gen(i / sr, i, r);
  b.bank.set(key, buf);
  return buf;
}

/** Plays a one-shot at `t` with gain, optional pitch ratio and reverb send. */
function shot(b: Bus, buf: AudioBuffer, t: number, level: number, rate = 1, send = 0) {
  const src = b.ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = b.ctx.createGain();
  g.gain.value = level;
  src.connect(g);
  connect(b, g, send);
  src.start(t);
}

/** One-pole low-pass state helper for sample generators. */
function lowpass(cutoff: number, sr: number) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sr);
  let y = 0;
  return (x: number) => (y = (1 - a) * x + a * y);
}

// ---------- instruments ----------

function kick(b: Bus, t: number, level = 1) {
  const buf = sample(b, 'kick', 0.5, (x) => {
    // Pitch sweeps 160 -> 42 Hz; integrate frequency for the phase.
    const k = 0.12 / Math.log(160 / 42);
    const phase = 2 * Math.PI * (x < 0.12 ? 160 * k * (1 - Math.exp(-x / k)) : 160 * k * (1 - 42 / 160) + 42 * (x - 0.12));
    const click = x < 0.004 ? (1 - x / 0.004) * 0.5 : 0;
    return (Math.sin(phase) * Math.exp(-x / 0.14) + click) * 0.9;
  });
  shot(b, buf, t, level);
}

function noiseHit(b: Bus, t: number, type: BiquadFilterType, freq: number, q: number, level: number, decay: number, send = 0) {
  const src = b.ctx.createBufferSource();
  src.buffer = b.noise;
  const f = b.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = b.ctx.createGain();
  env(g.gain, t, level, 0.001, decay);
  src.connect(f).connect(g);
  connect(b, g, send);
  src.start(t, (t * 7.31) % 1.5);
  src.stop(t + decay + 0.05);
}

function snare(b: Bus, t: number, level = 1) {
  const sr = b.ctx.sampleRate;
  const lp = lowpass(1500, sr);
  const buf = sample(b, 'snare', 0.3, (x, _i, r) => {
    const n = r() * 2 - 1;
    const hp = n - lp(n);
    const tone = Math.sin(2 * Math.PI * (200 - 300 * x) * x) * Math.exp(-x / 0.05);
    return hp * 0.55 * Math.exp(-x / 0.07) + tone * 0.35;
  });
  shot(b, buf, t, level, 1, 0.25);
}

function clap(b: Bus, t: number, level = 1) {
  const sr = b.ctx.sampleRate;
  const lo = lowpass(2600, sr);
  const hi = lowpass(700, sr);
  const buf = sample(b, 'clap', 0.35, (x, _i, r) => {
    const n = r() * 2 - 1;
    const band = lo(n) - hi(n);
    // Three quick bursts then a short tail, like hands in a room.
    let e = 0;
    for (const k of [0, 0.011, 0.022]) if (x >= k) e = Math.max(e, Math.exp(-(x - k) / (k === 0.022 ? 0.06 : 0.01)));
    return band * e * 1.4;
  });
  shot(b, buf, t, level, 1, 0.3);
}

function hat(b: Bus, t: number, open = false, level = 1) {
  const sr = b.ctx.sampleRate;
  const lp = lowpass(7500, sr);
  const buf = sample(b, open ? 'hat-open' : 'hat', open ? 0.32 : 0.08, (x, _i, r) => {
    const n = r() * 2 - 1;
    return (n - lp(n)) * Math.exp(-x / (open ? 0.09 : 0.014)) * 0.9;
  });
  shot(b, buf, t, (open ? 0.22 : 0.16) * level * 1.6);
}

function tom(b: Bus, t: number, freq: number, level = 1) {
  const buf = sample(b, 'tom', 0.8, (x) => {
    const f0 = 100;
    const k = 0.05;
    const phase = 2 * Math.PI * (f0 * x + f0 * 0.6 * k * (1 - Math.exp(-x / k)));
    return Math.sin(phase) * Math.exp(-x / 0.18) * 0.8;
  });
  shot(b, buf, t, level, freq / 100, 0.35);
}

function bass(b: Bus, t: number, note: number, dur: number, level = 1, sub = false) {
  if (!sub) {
    // Short plucked saw bass from one sample, pitched per note.
    const sr = b.ctx.sampleRate;
    const base = 55;
    const buf = sample(b, 'bass', 0.6, (x) => {
      const lp = bassFilter ??= lowpass(700, sr);
      const saw = 2 * ((base * x) % 1) - 1;
      return lp(saw) * Math.exp(-x / 0.18) * 0.75;
    });
    const g = b.ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.setTargetAtTime(0.0001, t + Math.max(0.05, dur), 0.03);
    const src = b.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = mtof(note) / base;
    src.connect(g);
    connect(b, g);
    src.start(t);
    src.stop(t + dur + 0.2);
    return;
  }
  const o = b.ctx.createOscillator();
  o.type = sub ? 'sine' : 'sawtooth';
  o.frequency.setValueAtTime(mtof(note), t);
  if (sub) o.frequency.exponentialRampToValueAtTime(mtof(note) * 0.97, t + dur);
  const f = b.ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(sub ? 300 : 900, t);
  f.frequency.exponentialRampToValueAtTime(sub ? 200 : 260, t + Math.min(dur, 0.3));
  const g = b.ctx.createGain();
  env(g.gain, t, (sub ? 0.8 : 0.45) * level, 0.005, dur * 0.6, 0.6, 0.08, dur);
  let node: AudioNode = o.connect(f).connect(g);
  if (sub) {
    const ws = b.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    ws.curve = curve;
    node = g.connect(ws);
  }
  connect(b, node);
  o.start(t);
  o.stop(t + dur + 0.3);
}

function pad(b: Bus, t: number, notes: number[], dur: number, level = 1, cutoff = 1400) {
  const f = b.ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = b.ctx.createGain();
  env(g.gain, t, 0.07 * level, Math.min(0.6, dur / 3), 0.4, 0.85, 0.8, dur);
  f.connect(g);
  connect(b, g, 0.5);
  for (const n of notes) {
    for (const detune of [-7, 7]) {
      const o = b.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(n);
      o.detune.value = detune;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 1);
    }
  }
}

function pluck(b: Bus, t: number, note: number, level = 1, bright = 3200, type: OscillatorType = 'square') {
  // One sample per timbre at A4, re-pitched per note; brightness is quantised to keep the bank small.
  const sr = b.ctx.sampleRate;
  const tone = Math.round(bright / 600) * 600;
  const buf = sample(b, `pluck-${type}-${tone}`, 0.45, (x) => {
    const lp = (pluckFilters[`${type}-${tone}`] ??= { f: lowpass(tone, sr) }).f;
    const ph = (440 * x) % 1;
    const w = type === 'square' ? (ph < 0.5 ? 1 : -1) : type === 'triangle' ? 1 - 4 * Math.abs(ph - 0.5) : 2 * ph - 1;
    return lp(w) * Math.exp(-x / 0.11) * 0.9;
  });
  shot(b, buf, t, 0.15 * level, mtof(note) / 440, 0.3);
}

let bassFilter: ((x: number) => number) | undefined;
const pluckFilters: Record<string, { f: (x: number) => number }> = {};

function keys(b: Bus, t: number, notes: number[], dur: number, level = 1) {
  const f = b.ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 2200;
  const trem = b.ctx.createGain();
  const lfo = b.ctx.createOscillator();
  lfo.frequency.value = 4.5;
  const depth = b.ctx.createGain();
  depth.gain.value = 0.25;
  lfo.connect(depth).connect(trem.gain);
  trem.gain.value = 0.75;
  const g = b.ctx.createGain();
  env(g.gain, t, 0.12 * level, 0.01, 0.6, 0.4, 0.5, dur);
  f.connect(trem).connect(g);
  connect(b, g, 0.35);
  lfo.start(t);
  lfo.stop(t + dur + 1);
  for (const n of notes) {
    for (const [mult, amp] of [
      [1, 1],
      [2, 0.25],
    ] as const) {
      const o = b.ctx.createOscillator();
      o.frequency.value = mtof(n) * mult;
      const og = b.ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(f);
      o.start(t);
      o.stop(t + dur + 1);
    }
  }
}

function bell(b: Bus, t: number, note: number, level = 1) {
  const buf = sample(b, 'bell', 1.4, (x) => {
    let v = 0;
    for (const [mult, amp, dec] of [
      [1, 1, 0.45],
      [2.76, 0.35, 0.18],
      [5.4, 0.15, 0.09],
    ] as const) v += Math.sin(2 * Math.PI * 440 * mult * x) * amp * Math.exp(-x / dec);
    return v * 0.5;
  });
  shot(b, buf, t, 0.16 * level, mtof(note) / 440, 0.45);
}

// ---------- music ----------

type ChordQ = 'min' | 'maj' | 'maj7' | 'min7' | 'dom7';
const CHORD: Record<ChordQ, number[]> = {
  min: [0, 3, 7],
  maj: [0, 4, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
};
const chord = (root: number, q: ChordQ) => CHORD[q].map((i) => root + i);

type Section = 'intro' | 'main' | 'break' | 'outro';

export interface MusicTrack {
  id: string;
  title: string;
  mood: string;
  bpm: number;
  /** Accent colours for the library card. */
  colors: [string, string];
  /** Bars per section in order. */
  form: [Section, number][];
  progression: [number, ChordQ][];
  play: (b: Bus, ctx: PlayCtx) => void;
}

interface PlayCtx {
  t: number; // bar start
  bar: number; // index within the whole song
  beat: number; // seconds per beat
  section: Section;
  chord: number[];
  root: number;
  progress: number; // 0..1 through the song
  r: () => number;
}

const STEPS = 16;
const at = (c: PlayCtx, step: number) => c.t + (step * c.beat) / 4;
const pattern = (p: string) => [...p].map((ch, i) => (ch !== '.' && ch !== ' ' ? i : -1)).filter((i) => i >= 0);

export const MUSIC: MusicTrack[] = [
  {
    id: 'game-day',
    title: 'Game Day',
    mood: 'Hype house',
    bpm: 124,
    colors: ['#ff5f6d', '#ffc371'],
    form: [['intro', 4], ['main', 8], ['break', 4], ['main', 8], ['outro', 4]],
    progression: [[57, 'min'], [53, 'maj'], [48, 'maj'], [55, 'maj']],
    play(b, c) {
      const full = c.section === 'main';
      if (c.section !== 'break') for (const s of [0, 4, 8, 12]) kick(b, at(c, s));
      if (full || c.section === 'outro') for (const s of [4, 12]) clap(b, at(c, s));
      for (const s of pattern('..x...x...x...x.')) hat(b, at(c, s), true, full ? 1 : 0.6);
      if (full) for (const s of pattern('x.x.x.x.x.x.x.x.')) hat(b, at(c, s), false, 0.7);
      for (const s of pattern('..x...x...x...x.')) bass(b, at(c, s), c.root - 12, c.beat * 0.45);
      pad(b, c.t, c.chord.map((n) => n + 12), c.beat * 4, c.section === 'break' ? 1.4 : 0.9, c.section === 'break' ? 900 + c.progress * 3000 : 2400);
      if (full) {
        const arp = [...c.chord, c.chord[0] + 12].map((n) => n + 12);
        for (let s = 0; s < STEPS; s++) if (s % 2 === 0 || c.r() > 0.6) pluck(b, at(c, s), arp[s % arp.length], 0.8);
      }
    },
  },
  {
    id: 'spike-anthem',
    title: 'Spike Anthem',
    mood: 'Trap, heavy 808',
    bpm: 140,
    colors: ['#7f00ff', '#e100ff'],
    form: [['intro', 4], ['main', 8], ['break', 2], ['main', 8], ['outro', 2]],
    progression: [[48, 'min'], [44, 'maj'], [51, 'maj'], [46, 'maj']],
    play(b, c) {
      const full = c.section === 'main';
      pad(b, c.t, c.chord.map((n) => n + 12), c.beat * 4, 0.8, 1100);
      if (c.section === 'intro' || c.section === 'break') {
        bell(b, c.t, c.chord[0] + 24);
        bell(b, at(c, 6), c.chord[2] + 24, 0.8);
        bell(b, at(c, 10), c.chord[1] + 24, 0.8);
        if (c.section === 'break') for (let s = 0; s < STEPS; s++) hat(b, at(c, s), false, 0.3 + (s / STEPS) * 0.7);
        return;
      }
      for (const s of pattern('x.....x...x.....')) kick(b, at(c, s));
      for (const s of pattern('x.....x...x.....')) bass(b, at(c, s), c.root - 12, c.beat * 1.4, 1, true);
      snare(b, at(c, 8));
      for (let s = 0; s < STEPS; s++) {
        hat(b, at(c, s), false, s % 4 === 0 ? 1 : 0.6);
        // Triplet rolls now and then, the trap signature.
        if (s === 14 && c.r() > 0.4) for (let k = 1; k < 3; k++) hat(b, at(c, s) + (k * c.beat) / 6, false, 0.5);
      }
      if (full) for (const [s, i] of [[0, 0], [3, 2], [6, 1], [10, 0], [12, 2]] as const) bell(b, at(c, s), c.chord[i] + 24, 0.7);
    },
  },
  {
    id: 'warm-up',
    title: 'Warm Up',
    mood: 'Lo-fi, relaxed',
    bpm: 84,
    colors: ['#43cea2', '#185a9d'],
    form: [['intro', 2], ['main', 8], ['break', 2], ['main', 8], ['outro', 2]],
    progression: [[62, 'maj7'], [59, 'min7'], [55, 'maj7'], [57, 'dom7']],
    play(b, c) {
      const swing = c.beat * 0.08;
      keys(b, c.t, c.chord, c.beat * 3.8, 1);
      if (c.section === 'intro' || c.section === 'outro') return;
      for (const s of pattern('x......x..x.....')) kick(b, at(c, s), 0.7);
      for (const s of [4, 12]) snare(b, at(c, s), 0.45);
      for (let s = 0; s < STEPS; s += 2) hat(b, at(c, s) + (s % 4 === 2 ? swing : 0), false, 0.5);
      for (const s of pattern('x.......x.......')) bass(b, at(c, s), c.root - 24, c.beat * 1.8, 0.9);
      if (c.section === 'main' && c.bar % 2 === 1) pluck(b, at(c, 10), c.chord[3] + 12, 0.6, 1800, 'triangle');
    },
  },
  {
    id: 'victory-lap',
    title: 'Victory Lap',
    mood: 'Upbeat pop',
    bpm: 116,
    colors: ['#f7971e', '#ffd200'],
    form: [['intro', 4], ['main', 8], ['break', 4], ['main', 8], ['outro', 4]],
    progression: [[55, 'maj'], [50, 'maj'], [52, 'min'], [48, 'maj']],
    play(b, c) {
      const full = c.section === 'main';
      if (c.section !== 'break') for (const s of pattern('x......x..x.....')) kick(b, at(c, s));
      if (c.section !== 'intro') for (const s of [4, 12]) {
        snare(b, at(c, s), 0.8);
        clap(b, at(c, s), 0.6);
      }
      for (let s = 0; s < STEPS; s += 2) hat(b, at(c, s), false, 0.7);
      for (let s = 0; s < STEPS; s += 2) bass(b, at(c, s), c.root - 12, c.beat * 0.4, 0.8);
      pad(b, c.t, c.chord.map((n) => n + 12), c.beat * 4, 0.6, 2600);
      if (full || c.section === 'break') {
        const melody = [0, 2, 1, 2, 0, 1, 2, 1];
        for (let i = 0; i < 8; i++) pluck(b, at(c, i * 2), c.chord[melody[(i + c.bar) % 8]] + 24, 0.9, 4200, 'sawtooth');
      }
    },
  },
  {
    id: 'showcase',
    title: 'Showcase',
    mood: 'Cinematic build',
    bpm: 100,
    colors: ['#141e30', '#4b79a1'],
    form: [['intro', 4], ['main', 8], ['break', 2], ['main', 8], ['outro', 2]],
    progression: [[50, 'min'], [46, 'maj'], [53, 'maj'], [48, 'maj']],
    play(b, c) {
      const full = c.section === 'main';
      pad(b, c.t, [...c.chord, c.chord[0] + 12].map((n) => n + 12), c.beat * 4, 1.1, 600 + c.progress * 3400);
      for (let s = 0; s < STEPS; s += 2) pluck(b, at(c, s), c.root + 12 + (s % 4 === 2 ? 12 : 0), 0.5 + c.progress * 0.5, 1200 + c.progress * 3000, 'sawtooth');
      if (c.section !== 'intro') {
        tom(b, c.t, 70);
        tom(b, at(c, 10), 90, 0.7);
        bass(b, c.t, c.root - 12, c.beat * 3.5, 0.9, true);
      }
      if (full && c.bar % 2 === 1) {
        kick(b, at(c, 8));
        snare(b, at(c, 8), 1.2);
      }
      if (full) for (const s of [4, 12]) kick(b, at(c, s), 0.6);
    },
  },
];

export function trackLength(track: MusicTrack): { bars: number; seconds: number } {
  const bars = track.form.reduce((n, [, b]) => n + b, 0);
  return { bars, seconds: (bars * 4 * 60) / track.bpm };
}

/** Renders a music track. Returns the audio and the time of every beat. */
export async function renderMusic(track: MusicTrack, maxBars = Infinity): Promise<{ buffer: AudioBuffer; beats: number[] }> {
  const beat = 60 / track.bpm;
  const full = trackLength(track);
  const bars = Math.min(full.bars, maxBars);
  const seconds = (bars * 4 * 60) / track.bpm;
  const tail = 2;
  const ctx = new OfflineAudioContext(2, Math.ceil((seconds + tail) * SR), SR);
  const bus = makeBus(ctx, 0.22);
  const r = rng(track.bpm * 31);
  let bar = 0;
  // Previews skip the intro so they get to the main groove quickly.
  const form = maxBars < full.bars ? track.form.filter(([s]) => s === 'main') : track.form;
  for (const [section, count] of form) {
    for (let i = 0; i < count && bar < bars; i++, bar++) {
      const [root, q] = track.progression[bar % track.progression.length];
      track.play(bus, { t: bar * 4 * beat, bar, beat, section, chord: chord(root, q), root, progress: bar / bars, r });
    }
  }
  // Final chord ring-out.
  const [root, q] = track.progression[0];
  pad(bus, seconds, chord(root, q).map((n) => n + 12), 1.5, 1, 1600);
  bassFilter = undefined;
  for (const k of Object.keys(pluckFilters)) delete pluckFilters[k];
  const buffer = await ctx.startRendering();
  fadeTail(buffer, 1.2);
  normalize(buffer, -1);
  const beats = Array.from({ length: bars * 4 }, (_, i) => i * beat);
  return { buffer, beats };
}

/** Scales so the loudest sample sits at `db` dBFS. */
function normalize(buf: AudioBuffer, db: number) {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-6) return;
  const k = Math.pow(10, db / 20) / peak;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}

function fadeTail(buf: AudioBuffer, seconds: number) {
  const n = Math.floor(seconds * buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[d.length - 1 - i] *= i / n;
  }
}

// ---------- sound effects ----------

export interface Sfx {
  id: string;
  title: string;
  seconds: number;
  render: (b: Bus) => void;
}

function sweep(b: Bus, t: number, dur: number, from: number, to: number, level: number, q = 2, send = 0.3) {
  const src = b.ctx.createBufferSource();
  src.buffer = b.noise;
  src.loop = true;
  const f = b.ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = b.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(level, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g);
  connect(b, g, send);
  src.start(t);
  src.stop(t + dur + 0.1);
}

export const SFX: Sfx[] = [
  { id: 'whoosh', title: 'Whoosh', seconds: 0.9, render: (b) => sweep(b, 0, 0.8, 300, 3500, 1.4, 1.5) },
  { id: 'swoosh-down', title: 'Swoosh down', seconds: 0.8, render: (b) => sweep(b, 0, 0.7, 5000, 250, 1.2, 1.5) },
  {
    id: 'impact',
    title: 'Impact',
    seconds: 2,
    render: (b) => {
      kick(b, 0, 1.4);
      noiseHit(b, 0, 'lowpass', 900, 0.7, 0.9, 0.6, 0.8);
      tom(b, 0.01, 50, 1);
    },
  },
  {
    id: 'spike-hit',
    title: 'Ball spike',
    seconds: 0.7,
    render: (b) => {
      noiseHit(b, 0, 'bandpass', 2200, 1.4, 1.4, 0.12, 0.3);
      noiseHit(b, 0, 'lowpass', 600, 0.8, 0.8, 0.08);
      tom(b, 0, 140, 0.5);
    },
  },
  {
    id: 'riser',
    title: 'Riser',
    seconds: 4,
    render: (b) => {
      sweep(b, 0, 3.8, 200, 9000, 0.8, 1, 0.5);
      const o = b.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, 0);
      o.frequency.exponentialRampToValueAtTime(880, 3.8);
      const g = b.ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.linearRampToValueAtTime(0.12, 3.6);
      g.gain.linearRampToValueAtTime(0.0001, 3.85);
      o.connect(g);
      connect(b, g, 0.4);
      o.start(0);
      o.stop(4);
    },
  },
  {
    id: 'bass-drop',
    title: 'Bass drop',
    seconds: 2.5,
    render: (b) => {
      const o = b.ctx.createOscillator();
      o.frequency.setValueAtTime(120, 0);
      o.frequency.exponentialRampToValueAtTime(30, 2.2);
      const g = b.ctx.createGain();
      env(g.gain, 0, 1, 0.01, 2.3);
      o.connect(g);
      connect(b, g);
      o.start(0);
      o.stop(2.5);
    },
  },
  {
    id: 'whistle',
    title: 'Referee whistle',
    seconds: 1.2,
    render: (b) => {
      const o = b.ctx.createOscillator();
      o.frequency.value = 3150;
      const trill = b.ctx.createOscillator();
      trill.frequency.value = 38;
      const depth = b.ctx.createGain();
      depth.gain.value = 120;
      trill.connect(depth).connect(o.frequency);
      const g = b.ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.linearRampToValueAtTime(0.25, 0.03);
      g.gain.setValueAtTime(0.25, 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, 1.0);
      o.connect(g);
      connect(b, g, 0.2);
      noiseHit(b, 0, 'bandpass', 3100, 4, 0.15, 0.9);
      for (const n of [o, trill]) {
        n.start(0);
        n.stop(1.1);
      }
    },
  },
  {
    id: 'crowd',
    title: 'Crowd cheer',
    seconds: 4,
    render: (b) => {
      for (let i = 0; i < 6; i++) {
        const src = b.ctx.createBufferSource();
        src.buffer = b.noise;
        src.loop = true;
        const f = b.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 500 + i * 260;
        f.Q.value = 0.9;
        const g = b.ctx.createGain();
        g.gain.setValueAtTime(0.0001, 0);
        g.gain.linearRampToValueAtTime(0.35, 0.5 + i * 0.05);
        g.gain.setTargetAtTime(0.0001, 2.6, 0.5);
        const lfo = b.ctx.createOscillator();
        lfo.frequency.value = 3 + i * 1.7;
        const lg = b.ctx.createGain();
        lg.gain.value = 0.12;
        lfo.connect(lg).connect(g.gain);
        src.connect(f).connect(g);
        connect(b, g, 0.6);
        src.start(0, i * 0.2);
        src.stop(4);
        lfo.start(0);
        lfo.stop(4);
      }
    },
  },
  {
    id: 'buzzer',
    title: 'Scoreboard buzzer',
    seconds: 1.4,
    render: (b) => {
      for (const f of [196, 247]) {
        const o = b.ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        const lp = b.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1800;
        const g = b.ctx.createGain();
        g.gain.setValueAtTime(0.0001, 0);
        g.gain.linearRampToValueAtTime(0.12, 0.02);
        g.gain.setValueAtTime(0.12, 1.1);
        g.gain.exponentialRampToValueAtTime(0.0001, 1.25);
        o.connect(lp).connect(g);
        connect(b, g);
        o.start(0);
        o.stop(1.3);
      }
    },
  },
  {
    id: 'ding',
    title: 'Ding',
    seconds: 1.6,
    render: (b) => bell(b, 0, 84, 3),
  },
  {
    id: 'shutter',
    title: 'Camera shutter',
    seconds: 0.4,
    render: (b) => {
      noiseHit(b, 0, 'highpass', 2500, 0.8, 0.9, 0.04);
      noiseHit(b, 0.09, 'bandpass', 1800, 1.5, 0.7, 0.06);
    },
  },
  {
    id: 'glitch',
    title: 'Glitch',
    seconds: 0.6,
    render: (b) => {
      for (let i = 0; i < 8; i++) {
        const t = i * 0.06;
        const o = b.ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = 200 + ((i * 337) % 1400);
        const g = b.ctx.createGain();
        env(g.gain, t, 0.15, 0.001, 0.04);
        o.connect(g);
        connect(b, g);
        o.start(t);
        o.stop(t + 0.06);
      }
    },
  },
];

export async function renderSfx(sfx: Sfx): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil((sfx.seconds + 0.6) * SR), SR);
  const bus = makeBus(ctx, 0.3);
  sfx.render(bus);
  const buf = await ctx.startRendering();
  fadeTail(buf, 0.3);
  normalize(buf, -3);
  return buf;
}
