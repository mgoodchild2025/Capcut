import { describe, expect, it } from 'vitest';
import { findRallies, type Features } from './highlightCore';

/** A synthetic match: motion bursts for rallies, whistles at serves and ends, cheers after some points. */
function match(duration: number, plays: { from: number; to: number; whistles?: boolean; motion?: number; cheer?: number }[], extraWhistles: number[] = []): Features {
  const audioHop = 0.05;
  const motionHop = 0.2;
  const na = Math.ceil(duration / audioHop);
  const nm = Math.ceil(duration / motionHop);
  const loudness = new Float32Array(na).fill(-40);
  const whistle = new Float32Array(na);
  const motion = new Float32Array(nm);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < nm; i++) motion[i] = 2 + rand() * 1.5;
  for (let i = 0; i < na; i++) loudness[i] = -40 + rand() * 2;
  const blow = (t: number) => {
    for (let k = Math.round(t / audioHop); k < Math.round((t + 0.4) / audioHop) && k < na; k++) {
      whistle[k] = 0.8;
      loudness[k] = -20;
    }
  };
  for (const p of plays) {
    for (let i = Math.round(p.from / motionHop); i < Math.round(p.to / motionHop) && i < nm; i++) motion[i] = (p.motion ?? 9) + rand() * 2;
    if (p.whistles !== false) {
      blow(p.from - 0.8);
      blow(p.to + 0.3);
    }
    if (p.cheer) for (let k = Math.round((p.to + 0.8) / audioHop); k < Math.round((p.to + 3.5) / audioHop) && k < na; k++) loudness[k] = -40 + p.cheer;
  }
  for (const w of extraWhistles) blow(w);
  return { audioHop, loudness, whistle, motionHop, motion, duration };
}

describe('rallies of a whole match', () => {
  it('finds every rally, in order, framed by its whistles', () => {
    const f = match(150, [
      { from: 10, to: 18 },
      { from: 30, to: 46, cheer: 16 },
      { from: 60, to: 64 },
      { from: 80, to: 92 },
      { from: 120, to: 131, cheer: 8 },
    ]);
    const r = findRallies(f);
    expect(r.length).toBe(5);
    const expected = [10, 30, 60, 80, 120];
    r.forEach((x, i) => {
      // Starts at the serve whistle, ends just after the closing whistle.
      expect(x.serve).toBeCloseTo(expected[i] - 0.8, 0);
      expect(x.start).toBeLessThanOrEqual(expected[i]);
      expect(x.start).toBeGreaterThan(expected[i] - 1.5);
      expect(x.whistleEnd).toBeDefined();
      expect(x.end).toBeGreaterThan(x.whistleEnd!);
      expect(x.end - x.whistleEnd!).toBeLessThan(2);
    });
    // The point the crowd went wild for is the best; long rallies are named.
    const best = r.reduce((a, b) => (b.score > a.score ? b : a));
    expect(best.serve).toBeCloseTo(29.2, 0);
    expect(best.score).toBe(100);
    expect(best.reasons).toContain('Crowd erupts');
    expect(best.reasons).toContain('Long rally');
    expect(r.every((x) => x.peak >= x.start && x.peak <= x.end)).toBe(true);
  });

  it('finds rallies without whistles from motion alone', () => {
    const r = findRallies(match(80, [{ from: 10, to: 20, whistles: false }, { from: 40, to: 52, whistles: false }]));
    expect(r.length).toBe(2);
    for (const [x, [a, b]] of r.map((x, i) => [x, [[10, 20], [40, 52]][i]] as const)) {
      expect(Math.abs(x.start - (a - 1))).toBeLessThan(1.5);
      expect(Math.abs(x.end - (b + 1))).toBeLessThan(1.5);
    }
    expect(r.every((x) => x.serve === undefined)).toBe(true);
  });

  it('keeps a whistle-to-whistle point the camera barely saw move', () => {
    const f = match(60, [{ from: 10, to: 18 }], []);
    // A second point: whistles at 30 and 38 with only slight motion between.
    const g = match(60, [{ from: 10, to: 18 }, { from: 30.8, to: 37.7, motion: 4.6 }]);
    expect(findRallies(f).length).toBe(1);
    const r = findRallies(g);
    expect(r.length).toBe(2);
    expect(r[1].serve).toBeCloseTo(30, 0);
  });

  it('ignores short twitches and splits overlong stretches', () => {
    const short = findRallies(match(40, [{ from: 10, to: 11, whistles: false }]));
    expect(short.length).toBe(0);
    const long = findRallies(match(150, [{ from: 10, to: 110, whistles: false }]), { maxLength: 40 });
    expect(long.length).toBeGreaterThanOrEqual(3);
    expect(long.every((x) => x.end - x.start <= 43)).toBe(true);
  });
});
