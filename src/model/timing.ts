import type { Clip, Keyframe, KeyProp, SpeedPoint, Transform } from './types';

/** Speed-curve presets in the spirit of CapCut's curve speeds. Multipliers apply on top of the clip speed. */
export const CURVE_PRESETS: { id: string; label: string; hint: string; points: SpeedPoint[] }[] = [
  { id: 'montage', label: 'Montage', hint: 'Fast, slow, fast', points: [{ p: 0, s: 2 }, { p: 0.35, s: 2 }, { p: 0.45, s: 0.5 }, { p: 0.6, s: 0.5 }, { p: 0.7, s: 2 }, { p: 1, s: 2 }] },
  // Real speed either side, so the action never looks sped up; just the moment slows right down.
  { id: 'hero', label: 'Hero', hint: 'Slow-mo in the middle', points: [{ p: 0, s: 1 }, { p: 0.4, s: 1 }, { p: 0.5, s: 0.3 }, { p: 0.62, s: 0.3 }, { p: 0.75, s: 1 }, { p: 1, s: 1 }] },
  { id: 'bullet', label: 'Bullet', hint: 'Ramp down, hold, ramp up', points: [{ p: 0, s: 2.5 }, { p: 0.3, s: 0.25 }, { p: 0.7, s: 0.25 }, { p: 1, s: 2.5 }] },
  { id: 'flash-in', label: 'Flash in', hint: 'Starts fast, settles', points: [{ p: 0, s: 4 }, { p: 0.25, s: 1 }, { p: 1, s: 1 }] },
  { id: 'flash-out', label: 'Flash out', hint: 'Settles, then rushes out', points: [{ p: 0, s: 1 }, { p: 0.75, s: 1 }, { p: 1, s: 4 }] },
  { id: 'jump', label: 'Jump cut', hint: 'Slow, fast, slow', points: [{ p: 0, s: 0.6 }, { p: 0.4, s: 0.6 }, { p: 0.5, s: 3 }, { p: 0.6, s: 0.6 }, { p: 1, s: 0.6 }] },
];

/** Multiplier at normalised position `x`, piecewise linear, flat beyond the ends. */
export function curveAt(points: SpeedPoint[], x: number): number {
  if (!points.length) return 1;
  if (x <= points[0].p) return points[0].s;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (x <= b.p) return b.p === a.p ? b.s : a.s + ((b.s - a.s) * (x - a.p)) / (b.p - a.p);
  }
  return points[points.length - 1].s;
}

/** ∫₀ˣ m(u) du for the piecewise-linear multiplier (x may exceed 1; the last value extends). */
export function curveIntegral(points: SpeedPoint[], x: number): number {
  if (!points.length) return x;
  let area = 0;
  let prevP = 0;
  let prevS = curveAt(points, 0);
  for (const pt of points) {
    if (pt.p <= 0) continue;
    const end = Math.min(pt.p, x);
    if (end > prevP) {
      const sEnd = curveAt(points, end);
      area += ((prevS + sEnd) / 2) * (end - prevP);
      prevP = end;
      prevS = sEnd;
    }
    if (x <= pt.p) return area;
  }
  if (x > prevP) area += prevS * (x - prevP);
  return area;
}

/** Average multiplier across the clip (1 without a curve). */
export const curveAverage = (clip: Pick<Clip, 'curve'>) => (clip.curve ? curveIntegral(clip.curve.points, 1) : 1);

const holdOf = (clip: Pick<Clip, 'hold'>) => clip.hold ?? 0;

/** Seconds of source consumed by the clip. */
export function sourceSpan(clip: Clip): number {
  return clip.speed * Math.max(0, clip.duration - holdOf(clip)) * curveAverage(clip);
}

/** Timeline duration that plays `span` seconds of source with the clip's speed, curve and hold. */
export function durationForSpan(clip: Clip, span: number): number {
  return holdOf(clip) + span / (clip.speed * curveAverage(clip));
}

/** Source time shown at timeline time `t`. Extrapolates past the clip end (used for transition handles). */
export function sourceTimeAt(clip: Clip, t: number): number {
  const local = t - clip.start;
  const hold = holdOf(clip);
  if (local <= hold) return clip.inPoint;
  const l = local - hold;
  if (!clip.curve) return clip.inPoint + l * clip.speed;
  const D = Math.max(1e-6, clip.duration - hold);
  return clip.inPoint + clip.speed * D * curveIntegral(clip.curve.points, l / D);
}

/** Instantaneous playback rate at clip-local time (0 while holding). */
export function rateAt(clip: Clip, local: number): number {
  const hold = holdOf(clip);
  if (local < hold) return 0;
  if (!clip.curve) return clip.speed;
  const D = Math.max(1e-6, clip.duration - hold);
  return clip.speed * curveAt(clip.curve.points, (local - hold) / D);
}

// ---------- keyframes ----------

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

/** Value of an animated property at clip-local time, eased between keyframes. */
export function keyframeValue(kfs: Keyframe[] | undefined, local: number, base: number): number {
  if (!kfs || !kfs.length) return base;
  if (local <= kfs[0].t) return kfs[0].v;
  for (let i = 1; i < kfs.length; i++) {
    const a = kfs[i - 1];
    const b = kfs[i];
    if (local <= b.t) {
      const k = (local - a.t) / Math.max(1e-6, b.t - a.t);
      return a.v + (b.v - a.v) * (a.ease === 'linear' ? k : ease(k));
    }
  }
  return kfs[kfs.length - 1].v;
}

export function transformAt(clip: Clip, local: number): Transform {
  const k = clip.keyframes;
  const tr = clip.transform;
  if (!k) return tr;
  return {
    x: keyframeValue(k.x, local, tr.x),
    y: keyframeValue(k.y, local, tr.y),
    scale: keyframeValue(k.scale, local, tr.scale),
    rotation: keyframeValue(k.rotation, local, tr.rotation),
    opacity: keyframeValue(k.opacity, local, tr.opacity),
  };
}

export function baseValue(clip: Clip, prop: KeyProp): number {
  return prop === 'volume' ? clip.volume : clip.transform[prop];
}

export const valueAt = (clip: Clip, prop: KeyProp, local: number) =>
  keyframeValue(clip.keyframes?.[prop], local, baseValue(clip, prop));

const KEY_EPS = 1 / 60;

/** Adds or replaces the keyframe at `local`. */
export function setKeyframe(clip: Clip, prop: KeyProp, local: number, v: number): Clip['keyframes'] {
  const list = (clip.keyframes?.[prop] ?? []).filter((k) => Math.abs(k.t - local) > KEY_EPS);
  list.push({ t: local, v });
  list.sort((a, b) => a.t - b.t);
  return { ...clip.keyframes, [prop]: list };
}

export function removeKeyframe(clip: Clip, prop: KeyProp, local: number): Clip['keyframes'] {
  const list = (clip.keyframes?.[prop] ?? []).filter((k) => Math.abs(k.t - local) > KEY_EPS);
  const next = { ...clip.keyframes, [prop]: list };
  if (!list.length) delete next[prop];
  return Object.keys(next).length ? next : undefined;
}

export const hasKeyframeAt = (clip: Clip, prop: KeyProp, local: number) =>
  !!clip.keyframes?.[prop]?.some((k) => Math.abs(k.t - local) <= KEY_EPS);

/** Every keyframe time on the clip, deduplicated and sorted. */
export function keyframeTimes(clip: Clip): number[] {
  const times: number[] = [];
  for (const list of Object.values(clip.keyframes ?? {})) {
    for (const k of list ?? []) if (!times.some((t) => Math.abs(t - k.t) <= KEY_EPS)) times.push(k.t);
  }
  return times.sort((a, b) => a - b);
}

/** Shifts keyframes by `dt` and keeps those inside [0, duration], adding boundary keys so values don't jump. */
export function sliceKeyframes(clip: Clip, from: number, duration: number): Clip['keyframes'] {
  if (!clip.keyframes) return undefined;
  const out: Clip['keyframes'] = {};
  for (const [prop, list] of Object.entries(clip.keyframes) as [KeyProp, Keyframe[]][]) {
    if (!list?.length) continue;
    const inside = list.filter((k) => k.t >= from - KEY_EPS && k.t <= from + duration + KEY_EPS).map((k) => ({ t: k.t - from, v: k.v }));
    const startV = keyframeValue(list, from, 0);
    const endV = keyframeValue(list, from + duration, 0);
    if (!inside.length || inside[0].t > KEY_EPS) inside.unshift({ t: 0, v: startV });
    if (inside[inside.length - 1].t < duration - KEY_EPS) inside.push({ t: duration, v: endV });
    out[prop] = inside;
  }
  return out;
}

/** Clip loudness at clip-local time: volume (or its keyframes) shaped by fade in/out. */
export function clipGain(clip: Clip, local: number): number {
  let g = valueAt(clip, 'volume', local);
  if (clip.audioFadeIn > 0 && local < clip.audioFadeIn) g *= Math.max(0, local / clip.audioFadeIn);
  const remaining = clip.duration - local;
  if (clip.audioFadeOut > 0 && remaining < clip.audioFadeOut) g *= Math.max(0, remaining / clip.audioFadeOut);
  return Math.max(0, g);
}
