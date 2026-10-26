import { describe, expect, it } from 'vitest';
import { cameraShift, followAt, smoothPath, trackPoint, type TrackFrame, findLookalike } from './trackCore';

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
function makeFrames(bodies: Body[], seconds = 4, fps = 10, pan: (t: number) => number = () => 0): TrackFrame[] {
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
    // The camera pans: the court slides by, the players are given in screen positions.
    const shift = Math.round(pan(t));
    const f = shift ? new Uint8ClampedArray(court.length) : court.slice();
    if (shift)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) f.set(court.subarray((y * W + (((x + shift) % W) + W) % W) * 4, (y * W + (((x + shift) % W) + W) % W) * 4 + 4), (y * W + x) * 4);
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

describe('teammates in the same kit', () => {
  const red: [number, number, number] = [210, 30, 40];
  const cases: [string, Body, Body][] = [
    ['cross paths', { x: (t) => 0.25 + 0.12 * t, y: () => 0.5, color: red }, { x: (t) => 0.75 - 0.12 * t, y: () => 0.53, color: red }],
    ['cross at an angle', { x: (t) => 0.3 + 0.1 * t, y: (t) => 0.35 + 0.08 * t, color: red }, { x: (t) => 0.7 - 0.1 * t, y: (t) => 0.4 + 0.06 * t, color: red }],
    ['run past one standing still', { x: (t) => 0.2 + 0.14 * t, y: () => 0.5, color: red }, { x: () => 0.5, y: () => 0.52, color: red }],
    ['pass one standing still, slowly', { x: (t) => 0.38 + 0.06 * t, y: () => 0.5, color: red }, { x: () => 0.5, y: () => 0.49, color: red }],
  ];
  for (const [name, me, mate] of cases)
    it(`stays on the tapped player when they ${name}`, () => {
      const frames = makeFrames([me, mate], 4);
      const path = trackPoint(frames, W, H, { t: 0, x: me.x(0), y: me.y(0) });
      const worst = Math.max(...path.map((p) => err(p, { x: me.x(p.t), y: me.y(p.t) })));
      expect(worst).toBeLessThan(6);
    });
});

describe('harder footage', () => {
  const red: [number, number, number] = [210, 30, 40];
  const worstOf = (path: { t: number; x: number; y: number }[], me: Body) => Math.max(...path.map((p) => err(p, { x: me.x(p.t), y: me.y(p.t) })));

  it('stays on a player standing still while a teammate runs past', () => {
    const me: Body = { x: () => 0.5, y: () => 0.5, color: red };
    const mate: Body = { x: (t) => 0.2 + 0.15 * t, y: () => 0.51, color: red };
    const frames = makeFrames([me, mate]);
    expect(worstOf(trackPoint(frames, W, H, { t: 0, x: 0.5, y: 0.5 }), me)).toBeLessThan(6);
  });

  it('keeps the player through a crowd of teammates, one crossing', () => {
    const me: Body = { x: (t) => 0.3 + 0.1 * t, y: () => 0.5, color: red };
    const bodies: Body[] = [
      me,
      { x: (t) => 0.7 - 0.1 * t, y: () => 0.52, color: red },
      { x: () => 0.2, y: () => 0.3, color: red },
      { x: (t) => 0.6 + 0.02 * t, y: () => 0.75, color: red },
      { x: () => 0.45, y: () => 0.25, color: red },
    ];
    const frames = makeFrames(bodies);
    expect(worstOf(trackPoint(frames, W, H, { t: 0, x: me.x(0), y: me.y(0) }), me)).toBeLessThan(6);
  });

  it('follows through a camera pan', () => {
    // The camera speeds up panning right, so everyone drifts left on screen as they play.
    const pan = (t: number) => 6 * t * t;
    const me: Body = { x: (t) => 0.5 + 0.05 * t - pan(t) / W, y: (t) => 0.5 + 0.05 * Math.sin(t * 3), color: red };
    const mate: Body = { x: (t) => 0.7 - 0.04 * t - pan(t) / W, y: () => 0.53, color: red };
    const frames = makeFrames([me, mate], 4, 10, pan);
    expect(worstOf(trackPoint(frames, W, H, { t: 0, x: me.x(0), y: me.y(0) }), me)).toBeLessThan(6);
  });

  it('measures the camera panning', () => {
    const pan = (t: number) => 30 * t;
    const frames = makeFrames([{ x: () => 0.5, y: () => 0.5, color: red }], 0.2, 10, pan);
    // The court slides 3 px left; the player (fixed on screen here) is too small to throw it.
    expect(cameraShift(frames[0].rgba, frames[1].rgba, W, H)).toEqual({ dx: -3, dy: 0 });
  });

  it('a correction settles a swap no tracker could', () => {
    // Two lookalikes meet, stand together, and each walks back the way they came: from the
    // pixels alone either could be the player. A second tap after they part says which.
    const me: Body = { x: (t) => (t < 2 ? 0.35 + 0.07 * t : 0.49 - 0.07 * (t - 2)), y: () => 0.5, color: red };
    const mate: Body = { x: (t) => (t < 2 ? 0.65 - 0.07 * t : 0.51 + 0.07 * (t - 2)), y: () => 0.5, color: red };
    const frames = makeFrames([me, mate]);
    const fixed = trackPoint(frames, W, H, [
      { t: 0, x: me.x(0), y: 0.5 },
      { t: 3.5, x: me.x(3.5), y: 0.5 },
    ]);
    expect(worstOf(fixed, me)).toBeLessThan(6);
  });

  it('is quick enough for a long play with a full team on court', () => {
    const team: Body[] = Array.from({ length: 6 }, (_, k) => ({ x: (t: number) => 0.15 + k * 0.13 + 0.03 * Math.sin(t + k), y: (t: number) => 0.35 + (k % 2) * 0.3 + 0.02 * Math.cos(t * 2 + k), color: red }));
    const frames = makeFrames(team, 15);
    const t0 = performance.now();
    trackPoint(frames, W, H, { t: 0, x: team[2].x(0), y: team[2].y(0) });
    expect(performance.now() - t0).toBeLessThan(4000);
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
