import { describe, expect, it } from 'vitest';
import { createMediaClip } from '../model/factory';
import { CURVE_PRESETS } from '../model/timing';
import { actionPath, columnMotion, followKeyframes, type MotionSample } from './reframeCore';

const W = 96;
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Motion samples of a subject at `pos(t)` (0..1) moving among background noise. */
function samples(duration: number, pos: (t: number) => number | null, hz = 8): MotionSample[] {
  const out: MotionSample[] = [];
  for (let t = 0; t <= duration + 1e-9; t += 1 / hz) {
    const cols = new Float32Array(W);
    for (let i = 0; i < W; i++) cols[i] = 20 + rand() * 15;
    const p = pos(t);
    if (p !== null) for (let i = 0; i < W; i++) cols[i] += 400 * Math.exp(-(((i + 0.5) / W - p) ** 2) / (2 * 0.03 ** 2));
    out.push({ t, cols });
  }
  return out;
}

describe('action tracking', () => {
  it('measures motion per column', () => {
    const a = [0, 0, 0, 0, 0, 0];
    const b = [0, 9, 0, 0, 3, 0];
    expect(Array.from(columnMotion(a, b, 3))).toEqual([0, 12, 0]);
  });

  it('follows a subject moving across the court, smoothly and without lag', () => {
    const pos = (t: number) => 0.15 + (0.7 * t) / 6;
    const path = actionPath(samples(6, pos));
    for (const p of path.filter((q) => q.t > 1 && q.t < 5)) expect(Math.abs(p.x - pos(p.t))).toBeLessThan(0.06);
    // Speed stays within the limit.
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i].x - path[i - 1].x) / (path[i].t - path[i - 1].t)).toBeLessThanOrEqual(0.45 + 1e-9);
  });

  it('holds its place through quiet moments and ignores frame-wide motion', () => {
    const path = actionPath(samples(4, (t) => (t < 1.5 ? 0.8 : null)));
    expect(path[path.length - 1].x).toBeGreaterThan(0.7);
    // A camera pan moves every column equally: nothing to follow, stay central.
    const pan = Array.from({ length: 30 }, (_, i) => ({ t: i / 8, cols: new Float32Array(W).fill(300) }));
    for (const p of actionPath(pan)) expect(p.x).toBeCloseTo(0.5, 5);
  });

  it('turns the path into keyframes that keep the frame inside the footage', () => {
    const clip = { ...createMediaClip({ id: 'a', name: 'a', kind: 'video', url: '', duration: 20, width: 1920, height: 1080, size: 0, hasAudio: true }), inPoint: 4, duration: 6 };
    const path = actionPath(samples(12, (t) => (t < 7 ? 0.02 : 0.98)));
    const keys = followKeyframes(clip, { width: 1920, height: 1080 }, 1080, 1920, path);
    const slack = ((1920 / 1080) * (1920 / 1080) - 1) / 2;
    expect(keys[0].t).toBe(0);
    expect(keys[keys.length - 1].t).toBeCloseTo(6);
    for (const k of keys) {
      expect(Math.abs(k.v)).toBeLessThanOrEqual(slack + 1e-6);
      expect(k.ease).toBe('linear');
    }
    // Starts panned to the left edge (positive x shows the left side), ends at the right.
    expect(keys[0].v).toBeCloseTo(slack, 3);
    expect(keys[keys.length - 1].v).toBeCloseTo(-slack, 3);
  });

  it('maps through slow-motion curves to the right moment in the source', () => {
    const base = createMediaClip({ id: 'a', name: 'a', kind: 'video', url: '', duration: 20, width: 1920, height: 1080, size: 0, hasAudio: true });
    const hero = CURVE_PRESETS.find((c) => c.id === 'hero')!;
    const clip = { ...base, inPoint: 0, duration: 8, curve: { id: 'hero', points: hero.points } };
    const path = [
      { t: 0, x: 0.2 },
      { t: 20, x: 0.8 },
    ];
    const plain = followKeyframes({ ...base, inPoint: 0, duration: 8 }, { width: 1920, height: 1080 }, 1080, 1920, path, 0.5);
    const slow = followKeyframes(clip, { width: 1920, height: 1080 }, 1080, 1920, path, 0.5);
    // Different source timing gives a different path over the same timeline span.
    expect(slow.map((k) => k.v)).not.toEqual(plain.map((k) => k.v));
  });
});
