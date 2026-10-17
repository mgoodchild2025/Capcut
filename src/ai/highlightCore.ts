/**
 * Highlight detection for volleyball footage, from cheap per-frame features:
 * loudness and whistle tone (audio) and motion energy (video). Pure functions, unit tested.
 *
 * Volleyball has a helpful rhythm: the referee whistles to start each serve and to end each point,
 * the ball is in play in between, and the crowd reacts right after a good point.
 */

export interface Features {
  /** Seconds between audio feature frames. */
  audioHop: number;
  /** Loudness per audio frame, in dB (roughly -90..0). */
  loudness: Float32Array;
  /** Whistle likelihood per audio frame, 0..1 (tonal energy in the 2.5–4.5 kHz band). */
  whistle: Float32Array;
  /** Seconds between motion samples. */
  motionHop: number;
  /** Mean absolute frame difference per motion sample (0..255). */
  motion: Float32Array;
  duration: number;
}

export interface Highlight {
  start: number;
  end: number;
  /** Moment of peak action inside the highlight. */
  peak: number;
  /** 0..100, relative to the rest of this footage. */
  score: number;
  reasons: string[];
}

/** Times (seconds) where a whistle starts: sustained tonal frames, at least 2 s apart. */
export function detectWhistles(f: Features, threshold = 0.3, minLength = 0.15): number[] {
  const out: number[] = [];
  const need = Math.max(1, Math.round(minLength / f.audioHop));
  let run = 0;
  for (let i = 0; i < f.whistle.length; i++) {
    if (f.whistle[i] >= threshold && f.loudness[i] > -50) {
      run++;
      if (run === need) {
        const t = (i - need + 1) * f.audioHop;
        if (!out.length || t - out[out.length - 1] > 2) out.push(t);
      }
    } else {
      run = 0;
    }
  }
  return out;
}

function resample(src: Float32Array, srcHop: number, hop: number, duration: number, mode: 'max' | 'mean' = 'mean'): Float32Array {
  const n = Math.max(1, Math.ceil(duration / hop));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * hop) / srcHop);
    const b = Math.max(a + 1, Math.floor(((i + 1) * hop) / srcHop));
    let v = mode === 'max' ? -Infinity : 0;
    let c = 0;
    for (let k = a; k < b && k < src.length; k++) {
      v = mode === 'max' ? Math.max(v, src[k]) : v + src[k];
      c++;
    }
    out[i] = c ? (mode === 'max' ? v : v / c) : 0;
  }
  return out;
}

function median(values: Float32Array | number[]): number {
  const s = Array.from(values).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/** Robust z-score: distance from the median in units of median absolute deviation. */
function robustZ(values: Float32Array): Float32Array {
  const m = median(values);
  const mad = median(Array.from(values, (v) => Math.abs(v - m))) || 1e-6;
  return values.map((v) => (v - m) / (1.4826 * mad));
}

function smooth(values: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(values.length - 1, i + radius); k++) {
      s += values[k];
      n++;
    }
    out[i] = s / n;
  }
  return out;
}

export interface FindOptions {
  /** Longest highlight, seconds. */
  maxLength?: number;
  /** Lead-in before the peak when no serve whistle is found. */
  preRoll?: number;
  /** Time kept after the end of the point. */
  postRoll?: number;
  /** Most highlights to return. */
  limit?: number;
}

/**
 * Finds the most exciting moments. Excitement combines bursts of motion with the crowd getting
 * louder than its recent baseline; whistles frame each moment into a full point where possible.
 */
export function findHighlights(f: Features, opts: FindOptions = {}): Highlight[] {
  const maxLength = opts.maxLength ?? 10;
  const preRoll = opts.preRoll ?? 6;
  const postRoll = opts.postRoll ?? 1.5;
  const limit = opts.limit ?? 12;
  const hop = 0.25;
  const n = Math.max(1, Math.ceil(f.duration / hop));

  // Whistles are loud but aren't the crowd: hold the previous level through whistle frames.
  // The mask is widened so a whistle's attack and decay don't leak through as a cheer.
  const pad = Math.ceil(0.15 / f.audioHop);
  const masked = new Uint8Array(f.loudness.length);
  for (let i = 0; i < masked.length; i++) {
    if (f.whistle[i] >= 0.12) for (let k = Math.max(0, i - pad); k <= Math.min(masked.length - 1, i + pad); k++) masked[k] = 1;
  }
  const noWhistle = new Float32Array(f.loudness.length);
  for (let i = 0; i < noWhistle.length; i++) noWhistle[i] = masked[i] ? (i ? noWhistle[i - 1] : -90) : f.loudness[i];
  const loud = resample(noWhistle, f.audioHop, hop, f.duration, 'max');
  const motion = f.motion.length ? resample(f.motion, f.motionHop, hop, f.duration, 'mean') : new Float32Array(n);
  // Crowd: loudness relative to the preceding 15 s.
  const crowd = new Float32Array(n);
  const window = Math.round(15 / hop);
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - window);
    const base = median(loud.subarray(from, Math.max(from + 1, i)));
    crowd[i] = Math.max(0, loud[i] - base);
  }
  const motionZ = robustZ(smooth(motion, 2));
  // Crowd in absolute terms: decibels above the recent baseline, 6 dB per unit, capped.
  const crowdDb = smooth(crowd, 2);
  const crowdZ = crowdDb.map((d) => Math.min(4, d / 6));
  const whistles = detectWhistles(f);

  // Action peaks come from motion; the crowd after a point confirms how good it was.
  const excitement = new Float32Array(n);
  const reactionWin = Math.round(4 / hop);
  for (let i = 0; i < n; i++) {
    let reaction = 0;
    for (let k = i; k < Math.min(n, i + reactionWin); k++) reaction = Math.max(reaction, crowdZ[k]);
    excitement[i] = Math.max(0, motionZ[i]) * 0.5 + Math.max(0, reaction) * 0.5;
  }

  // Greedy peak picking with a minimum gap.
  const minGap = Math.round(8 / hop);
  const order = Array.from(excitement.keys()).sort((a, b) => excitement[b] - excitement[a]);
  const picked: number[] = [];
  for (const i of order) {
    if (excitement[i] <= 0.5) break;
    // Every highlight needs some action on court.
    if (motionZ[i] < 0.5) continue;
    if (picked.some((p) => Math.abs(p - i) < minGap)) continue;
    picked.push(i);
    if (picked.length >= limit * 2) break;
  }

  const at = (t: number) => Math.min(n - 1, Math.max(0, Math.round(t / hop)));
  const meanLoud = (a: number, b: number) => {
    let sum = 0;
    let c = 0;
    for (let k = at(a); k <= at(b); k++) {
      sum += loud[k];
      c++;
    }
    return c ? sum / c : -90;
  };
  const medianLoud = (a: number, b: number) => median(loud.subarray(at(a), at(b) + 1));

  const raw = picked.map((i) => {
    const peak = i * hop;
    // The point ends at the next whistle shortly after the action, if there is one.
    // A whistle ends a point only if there was play just before it (otherwise it's the next serve).
    const playBefore = (w: number) => {
      let sum = 0;
      let c = 0;
      for (let k = at(w - 3); k < at(w); k++) {
        sum += motionZ[k];
        c++;
      }
      return c > 0 && sum / c > 0.5;
    };
    const endWhistle = whistles.find((w) => w > peak - 0.5 && w < peak + 15 && playBefore(w));
    let end = Math.min(f.duration, (endWhistle ?? peak + 1) + postRoll);
    // Start at the serve whistle when the rally fits; otherwise a fixed lead-in.
    const serve = [...whistles].reverse().find((w) => w < peak - 1 && w > end - maxLength - 1);
    let start = Math.max(0, serve !== undefined ? serve + 0.3 : peak - preRoll);
    if (end - start > maxLength) start = end - maxLength;
    if (end - start < 2) end = Math.min(f.duration, start + 2);

    // The crowd's reaction: how much louder the seconds after the point are than the rally itself.
    const pointEnd = endWhistle ?? peak + 1;
    const reaction = Math.max(0, meanLoud(pointEnd + 0.4, pointEnd + 3.4) - medianLoud(pointEnd - 4, pointEnd - 0.3));
    // Fixed scales so one very busy clip can't flatten the rest: motion saturates at 4 deviations,
    // the crowd at 18 dB over the rally.
    const value = Math.min(1, Math.max(0, motionZ[i]) / 4) * 0.35 + Math.min(1, reaction / 18) * 0.65;
    const reasons: string[] = [];
    if (reaction >= 12) reasons.push('Crowd erupts');
    else if (reaction >= 6) reasons.push('Crowd reacts');
    if (motionZ[i] > 2) reasons.push('Big play');
    if (serve !== undefined && endWhistle !== undefined) reasons.push(`Full rally ${Math.round(endWhistle - serve)}s`);
    return { start, end, peak, value, reasons };
  });

  // Merge overlaps, keeping the stronger moment.
  raw.sort((a, b) => b.value - a.value);
  const kept: typeof raw = [];
  for (const h of raw) if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
  const top = kept.slice(0, limit);
  const best = Math.max(...top.map((h) => h.value), 1e-6);
  return top
    .map((h) => ({ start: h.start, end: h.end, peak: h.peak, score: Math.round((h.value / best) * 100), reasons: h.reasons }))
    .sort((a, b) => b.score - a.score);
}

// ---------- audio features ----------

/** In-place radix-2 FFT (re, im of length power of two). */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/**
 * Loudness and whistle-tone features from mono samples. The whistle score is the share of the
 * frame's spectral energy held by the strongest narrow peak in the 2.5–4.5 kHz band: near 1 for
 * a referee's whistle, near 0 for crowd noise or speech.
 */
export function audioFeatures(samples: Float32Array, sr: number, hop = 0.05): Pick<Features, 'audioHop' | 'loudness' | 'whistle'> {
  const len = Math.floor(hop * sr);
  let size = 1;
  while (size < len) size <<= 1;
  const frames = Math.floor(samples.length / len);
  const loudness = new Float32Array(frames);
  const whistle = new Float32Array(frames);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const window = new Float32Array(len).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)));
  const lo = Math.floor((2500 * size) / sr);
  const hi = Math.ceil((4500 * size) / sr);
  for (let k = 0; k < frames; k++) {
    const from = k * len;
    let e = 0;
    for (let i = 0; i < len; i++) {
      const v = samples[from + i];
      e += v * v;
      re[i] = v * window[i];
      im[i] = 0;
    }
    re.fill(0, len);
    im.fill(0, len);
    loudness[k] = 10 * Math.log10(e / len + 1e-18);
    if (e < 1e-8) continue;
    fft(re, im);
    let total = 0;
    const power = new Float32Array(size / 2);
    for (let i = 1; i < size / 2; i++) {
      power[i] = re[i] * re[i] + im[i] * im[i];
      total += power[i];
    }
    let best = 0;
    for (let i = lo; i <= hi && i + 1 < size / 2; i++) best = Math.max(best, power[i - 1] + power[i] + power[i + 1]);
    whistle[k] = total > 0 ? best / total : 0;
  }
  return { audioHop: hop, loudness, whistle };
}

/** Mean absolute difference between two greyscale frames. */
export function frameDiff(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}
