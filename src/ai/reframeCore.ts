import type { Asset, Clip, Keyframe } from '../model/types';
import { sourceTimeAt } from '../model/timing';

/** One analysed moment: source time and how much changed in each column of a tiny greyscale frame. */
export interface MotionSample {
  t: number;
  cols: Float32Array;
}

/** A point on the camera path: source time and where the action is, 0..1 across the frame. */
export interface PathPoint {
  t: number;
  x: number;
}

/** Absolute brightness change per column between two greyscale frames of `w` columns. */
export function columnMotion(prev: ArrayLike<number>, cur: ArrayLike<number>, w: number): Float32Array {
  const cols = new Float32Array(w);
  for (let i = 0; i < cur.length; i++) cols[i % w] += Math.abs(cur[i] - prev[i]);
  return cols;
}

/**
 * Turns per-column motion into a smooth camera path that follows the action.
 * Each moment's focus is the centre of the strongest motion, after removing the frame-wide
 * level (lighting flicker, a panning camera). Quiet moments keep the last focus. The path is
 * then smoothed both ways (no lag) and its speed limited, so the virtual camera glides.
 */
export function actionPath(samples: MotionSample[], opts: { smooth?: number; maxSpeed?: number } = {}): PathPoint[] {
  if (!samples.length) return [];
  const smooth = opts.smooth ?? 0.6; // seconds
  const maxSpeed = opts.maxSpeed ?? 0.45; // frame widths per second
  const raw: number[] = [];
  const weight: number[] = [];
  let last = 0.5;
  for (const s of samples) {
    const n = s.cols.length;
    const sorted = Array.from(s.cols).sort((a, b) => a - b);
    const base = sorted[Math.floor(n / 2)];
    let sum = 0;
    let at = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, s.cols[i] - base);
      const w = v * v; // favour the strongest movement over scattered noise
      sum += w;
      at += w * ((i + 0.5) / n);
      if (v > peak) peak = v;
    }
    // Ignore moments where nothing stands out from the background.
    const strong = sum > 0 && peak > base * 0.5 + 1;
    const x = strong ? at / sum : last;
    raw.push(x);
    weight.push(strong ? 1 : 0.15);
    last = x;
  }
  // Zero-lag smoothing: an exponential average forwards, then backwards. Quiet moments pull weakly.
  const ema = (xs: number[], order: number[]) => {
    const out = xs.slice();
    let acc = xs[order[0]];
    let prevT = samples[order[0]].t;
    for (const i of order) {
      const a = (1 - Math.exp(-Math.abs(samples[i].t - prevT) / smooth)) * weight[i];
      acc += (xs[i] - acc) * a;
      out[i] = acc;
      prevT = samples[i].t;
    }
    return out;
  };
  const idx = samples.map((_, i) => i);
  const both = ema(ema(raw, idx), idx.slice().reverse());
  // Limit how fast the camera can pan.
  const path: PathPoint[] = [{ t: samples[0].t, x: both[0] }];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    const prev = path[i - 1].x;
    const step = Math.max(-maxSpeed * dt, Math.min(maxSpeed * dt, both[i] - prev));
    path.push({ t: samples[i].t, x: prev + step });
  }
  return path;
}

function focusAt(path: PathPoint[], t: number): number {
  if (t <= path[0].t) return path[0].x;
  for (let i = 1; i < path.length; i++) {
    if (t <= path[i].t) {
      const a = path[i - 1];
      const b = path[i];
      return a.x + (b.x - a.x) * ((t - a.t) / Math.max(1e-6, b.t - a.t));
    }
  }
  return path[path.length - 1].x;
}

/**
 * Keyframes for the clip's horizontal position so a W x H frame cut from wider footage keeps
 * the action in view. Positions are clamped so the frame never shows past the footage's edge.
 */
export function followKeyframes(clip: Clip, asset: Pick<Asset, 'width' | 'height'>, W: number, H: number, path: PathPoint[], step = 0.4): Keyframe[] {
  if (!path.length || !asset.width || !asset.height) return [];
  const frameW = (asset.width / asset.height) * (H / W);
  const slack = Math.max(0, (frameW - 1) / 2);
  const keys: Keyframe[] = [];
  const at = (local: number) => {
    const src = sourceTimeAt({ ...clip, start: 0 }, local);
    return Math.max(-slack, Math.min(slack, (0.5 - focusAt(path, src)) * frameW));
  };
  for (let local = 0; local < clip.duration; local += step) keys.push({ t: +local.toFixed(3), v: +at(local).toFixed(4), ease: 'linear' });
  keys.push({ t: +clip.duration.toFixed(3), v: +at(clip.duration).toFixed(4), ease: 'linear' });
  // Drop keyframes that a straight line from the last kept one to the next already gives.
  const kept: Keyframe[] = [keys[0]];
  for (let i = 1; i < keys.length - 1; i++) {
    const a = kept[kept.length - 1];
    const b = keys[i + 1];
    const k = keys[i];
    const mid = a.v + (b.v - a.v) * ((k.t - a.t) / (b.t - a.t));
    if (Math.abs(mid - k.v) > 0.002) kept.push(k);
  }
  kept.push(keys[keys.length - 1]);
  return kept;
}
