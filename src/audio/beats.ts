import { getMainTrack, MIN_CLIP, trackClips } from '../model/ops';
import { durationForSpan } from '../model/timing';
import type { Asset, Project } from '../model/types';

/**
 * Onset strength envelope from mono samples: positive spectral-energy change per hop, using a
 * cheap filter-bank (no FFT) of band energies, which is plenty for finding drum hits.
 */
export function onsetEnvelope(samples: Float32Array, sampleRate: number, hop = 256): { env: Float32Array; rate: number } {
  const frames = Math.floor(samples.length / hop);
  const env = new Float32Array(frames);
  // Low band (kick) via a one-pole low-pass, high band as the residual.
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * 150) / sampleRate);
  let prevLow = 0;
  let prevHigh = 0;
  for (let f = 0; f < frames; f++) {
    let low = 0;
    let high = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      lp = (1 - a) * samples[i] + a * lp;
      low += lp * lp;
      const h = samples[i] - lp;
      high += h * h;
    }
    low = Math.log1p(low * 10);
    high = Math.log1p(high * 10);
    env[f] = Math.max(0, low - prevLow) * 1.5 + Math.max(0, high - prevHigh);
    prevLow = low;
    prevHigh = high;
  }
  // Remove the slowly varying baseline so only transients remain.
  const out = new Float32Array(frames);
  const w = 16;
  for (let f = 0; f < frames; f++) {
    let m = 0;
    let n = 0;
    for (let k = Math.max(0, f - w); k <= Math.min(frames - 1, f + w); k++) {
      m += env[k];
      n++;
    }
    out[f] = Math.max(0, env[f] - m / n);
  }
  return { env: out, rate: sampleRate / hop };
}

/** Mean onset strength on a beat grid, taking the best of the neighbouring frames at each beat. */
function gridScore(env: Float32Array, rate: number, period: number, phase: number): number {
  let sum = 0;
  let n = 0;
  for (let t = phase; t * rate < env.length - 1; t += period) {
    const i = Math.round(t * rate);
    sum += Math.max(env[i], env[i - 1] ?? 0, env[i + 1] ?? 0);
    n++;
  }
  return n ? sum / n : 0;
}

/** Gentle preference for tempi near 120 BPM; resolves half/double-time ties. */
const tempoPrior = (bpm: number) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.7, 2));

/**
 * Finds tempo and phase together: the beat grid (70–180 BPM) whose beats carry the strongest
 * average onset. Averaging (rather than summing) means half-time grids don't win by default.
 */
export function findBeatGrid(env: Float32Array, rate: number): { bpm: number; phase: number } {
  let best = { bpm: 120, phase: 0, score: -1 };
  const search = (from: number, to: number, step: number, phaseStep: number) => {
    for (let bpm = from; bpm <= to + 1e-9; bpm += step) {
      const period = 60 / bpm;
      for (let ph = 0; ph < period; ph += phaseStep) {
        const score = gridScore(env, rate, period, ph) * tempoPrior(bpm);
        if (score > best.score) best = { bpm, phase: ph, score };
      }
    }
  };
  search(70, 180, 1, 0.01);
  const coarse = best.bpm;
  search(Math.max(70, coarse - 1), Math.min(180, coarse + 1), 0.05, 0.004);
  return { bpm: Math.round(best.bpm * 10) / 10, phase: best.phase };
}

export function detectBeats(samples: Float32Array, sampleRate: number): { bpm: number; beats: number[] } {
  const { env, rate } = onsetEnvelope(samples, sampleRate);
  const { bpm, phase } = findBeatGrid(env, rate);
  const duration = samples.length / sampleRate;
  const beats: number[] = [];
  for (let t = phase; t < duration; t += 60 / bpm) beats.push(t);
  return { bpm, beats };
}

/** Decodes an asset's audio and finds its beats. */
export async function analyzeBeats(asset: Asset): Promise<{ bpm: number; beats: number[] }> {
  const data = await (await fetch(asset.url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 22050);
  const buf = await ctx.decodeAudioData(data);
  const mono = buf.getChannelData(0);
  if (buf.numberOfChannels > 1) {
    const r = buf.getChannelData(1);
    for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] + r[i]) / 2;
  }
  return detectBeats(mono, buf.sampleRate);
}

/**
 * Re-times the main track so every cut lands on a beat: each clip keeps its start in the source
 * and becomes the longest whole number of `beatsPerCut` groups that its footage allows (at least one group).
 * `beats` are timeline seconds.
 */
export function cutToBeats(p: Project, beats: number[], beatsPerCut: number, assets: Record<string, Asset>): Project {
  if (beats.length < 2) return p;
  const main = getMainTrack(p);
  const clips = trackClips(p, main.id);
  if (!clips.length) return p;
  const period = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
  const beatAtOrAfter = (t: number) => {
    const b = beats.find((x) => x >= t - 1e-3);
    if (b !== undefined) return b;
    return beats[beats.length - 1] + Math.ceil((t - beats[beats.length - 1]) / period) * period;
  };
  let cursor = beatAtOrAfter(clips[0].start);
  const updated = new Map<string, { start: number; duration: number }>();
  for (const c of clips) {
    const asset = c.assetId ? assets[c.assetId] : undefined;
    const available = c.kind === 'image' || !asset ? Infinity : durationForSpan(c, Math.max(0, asset.duration - c.inPoint));
    const unit = period * beatsPerCut;
    const want = Math.min(c.duration, available);
    let groups = Math.max(1, Math.round(want / unit));
    while (groups > 1 && groups * unit > available + 1e-6) groups--;
    let duration = groups * unit;
    // Footage shorter than one group: keep what there is.
    if (duration > available) duration = Math.max(MIN_CLIP, available);
    updated.set(c.id, { start: cursor, duration });
    cursor += duration;
  }
  return {
    ...p,
    clips: p.clips.map((c) => {
      const u = updated.get(c.id);
      if (!u) return c;
      // Keep the source range consistent with the new length.
      return { ...c, start: u.start, duration: u.duration };
    }),
  };
}
