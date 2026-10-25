import { describe, expect, it } from 'vitest';
import { followAt, smoothPath, trackPoint, type TrackFrame, findLookalike } from './trackCore';

const W = 256;
const H = 144;

/** Deterministic noise. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Body {
  x: (t: number) => number;
  y: (t: number) => number;
  color: [number, number, number];
}

/** A court with a fixed texture, players drawn as jersey-coloured blocks with shorts and a head, and sensor noise. */
function makeFrames(bodies: Body[], seconds = 4, fps = 10): TrackFrame[] {
  const r = rng(7);
  const court = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = 120 + r() * 50;
    court[i * 4] = v * 0.8;
    court[i * 4 + 1] = v * 0.6;
    court[i * 4 + 2] = v * 0.4;
    court[i * 4 + 3] = 255;
  }
  const noise = rng(99);
  const frames: TrackFrame[] = [];
  for (let n = 0; n <= seconds * fps; n++) {
    const t = n / fps;
    const f = court.slice();
    for (const b of bodies) {
      const cx = b.x(t) * W;
      const cy = b.y(t) * H;
      const paint = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
        for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++)
          for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++) {
            const i = (y * W + x) * 4;
            f[i] = c[0];
            f[i + 1] = c[1];
            f[i + 2] = c[2];
          }
      };
      paint(cx - 4, cy - 9, cx + 4, cy + 3, b.color); // jersey
      paint(cx - 4, cy + 3, cx + 4, cy + 9, [20, 20, 30]); // shorts
      paint(cx - 2, cy - 14, cx + 2, cy - 9, [200, 160, 130]); // head
    }
    for (let i = 0; i < f.length; i += 4) {
      const d = (noise() - 0.5) * 16;
      f[i] += d;
      f[i + 1] += d;
      f[i + 2] += d;
    }
    frames.push({ t, rgba: f });
  }
  return frames;
}

const err = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);

describe('trackPoint', () => {
  it('follows a moving player', () => {
    const red: Body = { x: (t) => 0.2 + 0.12 * t, y: (t) => 0.5 + 0.08 * Math.sin(t * 2), color: [210, 30, 40] };
    const frames = makeFrames([red]);
    const path = trackPoint(frames, W, H, { t: 0, x: red.x(0), y: red.y(0) });
    expect(path).toHaveLength(frames.length);
    for (const p of path) expect(err(p, { x: red.x(p.t), y: red.y(p.t) })).toBeLessThan(3);
  });

  it('stays on the tapped player when another crosses in front', () => {
    const red: Body = { x: (t) => 0.25 + 0.1 * t, y: () => 0.5, color: [210, 30, 40] };
    const blue: Body = { x: (t) => 0.75 - 0.12 * t, y: () => 0.52, color: [30, 60, 200] };
    const frames = makeFrames([red, blue]);
    const path = trackPoint(frames, W, H, { t: 0, x: red.x(0), y: red.y(0) });
    const end = path[path.length - 1];
    expect(err(end, { x: red.x(end.t), y: red.y(end.t) })).toBeLessThan(6);
  });

  it('tracks backwards from a tap in the middle of the clip', () => {
    const red: Body = { x: (t) => 0.7 - 0.1 * t, y: () => 0.45, color: [210, 30, 40] };
    const frames = makeFrames([red]);
    const path = trackPoint(frames, W, H, { t: 2, x: red.x(2), y: red.y(2) });
    expect(err(path[0], { x: red.x(0), y: red.y(0) })).toBeLessThan(3);
    expect(err(path[path.length - 1], { x: red.x(4), y: red.y(4) })).toBeLessThan(3);
  });

  it('holds still instead of jumping when the player leaves the shot', () => {
    // Runs off the right edge at t = 2.5; a lookalike stands far away on the left.
    const red: Body = { x: (t) => 0.6 + 0.2 * t, y: () => 0.5, color: [210, 30, 40] };
    const twin: Body = { x: () => 0.1, y: () => 0.5, color: [210, 30, 40] };
    const frames = makeFrames([red, twin]);
    const path = trackPoint(frames, W, H, { t: 0, x: red.x(0), y: red.y(0) });
    expect(path[path.length - 1].x).toBeGreaterThan(0.7);
  });
});

describe('path helpers', () => {
  it('interpolates and smooths', () => {
    const p = smoothPath(
      [0, 1, 2, 3].map((t) => ({ t, x: t % 2 ? 0.6 : 0.4, y: 0.5 })),
      0.5,
    );
    expect(Math.max(...p.map((q) => q.x)) - Math.min(...p.map((q) => q.x))).toBeLessThan(0.2);
    expect(followAt([{ t: 0, x: 0, y: 0 }, { t: 2, x: 1, y: 0.5 }], 1)).toEqual({ x: 0.5, y: 0.25 });
  });
});

describe('finding a player again in another play', () => {
  const W = 128;
  const H = 72;
  /** A court with a red player at (px, py) and a blue one elsewhere. */
  const scene = (px: number, py: number, bx: number, by: number) => {
    const f = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      f[i * 4] = 176;
      f[i * 4 + 1] = 120;
      f[i * 4 + 2] = 64;
      f[i * 4 + 3] = 255;
    }
    const box = (cx: number, cy: number, c: [number, number, number]) => {
      for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 3; x <= cx + 3; x++) if (x >= 0 && y >= 0 && x < W && y < H) f.set([...c, 255], (y * W + x) * 4);
    };
    box(px, py, [220, 30, 30]);
    box(bx, by, [30, 40, 220]);
    return f;
  };
  it('finds the same kit in a new spot', () => {
    const a = scene(30, 50, 90, 20);
    const b = scene(52, 46, 70, 22);
    const g = findLookalike(a, b, W, H, { x: 30 / W, y: 50 / H });
    expect(Math.abs(g.x * W - 52)).toBeLessThanOrEqual(2);
    expect(Math.abs(g.y * H - 46)).toBeLessThanOrEqual(2);
    expect(g.sure).toBeGreaterThan(0.3);
  });
  it('is unsure when the player is nowhere to be seen', () => {
    const a = scene(30, 50, 90, 20);
    const b = scene(-50, -50, 70, 22);
    expect(findLookalike(a, b, W, H, { x: 30 / W, y: 50 / H }).sure).toBeLessThan(0.3);
  });
});
