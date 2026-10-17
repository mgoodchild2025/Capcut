import { describe, expect, it } from 'vitest';
import { audioFeatures, detectWhistles, findHighlights, frameDiff, type Features } from './highlightCore';

/** A two-minute game: four rallies framed by whistles, with crowd reactions of different sizes. */
function game(): { f: Features; rallies: { start: number; end: number; cheer: number }[] } {
  const duration = 120;
  const rallies = [
    { start: 10, end: 18, cheer: 8 },
    { start: 35, end: 47, cheer: 25 },
    { start: 70, end: 76, cheer: 0 },
    { start: 95, end: 108, cheer: 15 },
  ];
  const audioHop = 0.05;
  const na = duration / audioHop;
  const loudness = new Float32Array(na).fill(-40);
  const whistle = new Float32Array(na);
  for (const r of rallies) {
    for (const w of [r.start, r.end]) for (let t = w; t < w + 0.5; t += audioHop) whistle[Math.round(t / audioHop)] = 0.7;
    for (let t = r.end + 0.5; t < r.end + 3.5 && r.cheer; t += audioHop) loudness[Math.round(t / audioHop)] = -40 + r.cheer;
    for (let t = r.start; t < r.end; t += audioHop) loudness[Math.round(t / audioHop)] = -36;
  }
  const motionHop = 0.2;
  const motion = new Float32Array(duration / motionHop).fill(2);
  for (const r of rallies) for (let t = r.start; t < r.end; t += motionHop) motion[Math.round(t / motionHop)] = 14 + (t > r.end - 3 ? 8 : 0);
  return { f: { audioHop, loudness, whistle, motionHop, motion, duration }, rallies };
}

describe('highlight detection', () => {
  it('finds referee whistles', () => {
    const { f, rallies } = game();
    const ws = detectWhistles(f);
    expect(ws.length).toBe(8);
    rallies.forEach((r, i) => {
      expect(Math.abs(ws[i * 2] - r.start)).toBeLessThan(0.2);
      expect(Math.abs(ws[i * 2 + 1] - r.end)).toBeLessThan(0.2);
    });
  });

  it('ranks rallies by crowd reaction and frames them by whistles', () => {
    const { f, rallies } = game();
    const hs = findHighlights(f);
    expect(hs.length).toBeGreaterThanOrEqual(4);
    const order = hs.slice(0, 3).map((h) => rallies.findIndex((r) => h.peak >= r.start - 1 && h.peak <= r.end + 4));
    expect(order).toEqual([1, 3, 0]);
    const best = hs[0];
    // Ends just after the end whistle, starts at or after the serve, within the length cap.
    expect(best.end).toBeGreaterThan(47);
    expect(best.end).toBeLessThan(50);
    expect(best.end - best.start).toBeLessThanOrEqual(10.01);
    expect(best.score).toBe(100);
    expect(best.reasons.join(' ')).toMatch(/Crowd/);
    // No highlight starts in dead time between rallies.
    for (const h of hs) expect(rallies.some((r) => h.peak >= r.start - 0.5 && h.peak <= r.end + 0.5)).toBe(true);
  });

  it('does not mistake a loud whistle for the crowd', () => {
    const { f, rallies } = game();
    // Make every whistle much louder than any cheer.
    for (let i = 0; i < f.whistle.length; i++) if (f.whistle[i] > 0) f.loudness[i] = -5;
    const hs = findHighlights(f);
    const first = rallies.findIndex((r) => hs[0].peak >= r.start - 1 && hs[0].peak <= r.end + 4);
    expect(first).toBe(1);
    const quiet = hs.find((h) => h.peak >= 69 && h.peak <= 80);
    expect(quiet?.reasons.join(' ') ?? '').not.toMatch(/Crowd/);
  });

  it('returns nothing exciting for flat footage', () => {
    const f: Features = {
      audioHop: 0.05,
      loudness: new Float32Array(1200).fill(-40),
      whistle: new Float32Array(1200),
      motionHop: 0.2,
      motion: new Float32Array(300).fill(3),
      duration: 60,
    };
    expect(findHighlights(f)).toEqual([]);
  });
});

describe('audio features', () => {
  it('separates a whistle tone from noise', () => {
    const sr = 16000;
    const s = new Float32Array(sr * 2);
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < s.length; i++) {
      const t = i / sr;
      s[i] = rand() * 0.05 + (t >= 1 && t < 1.5 ? Math.sin(2 * Math.PI * 3150 * t) * 0.3 : 0);
    }
    const a = audioFeatures(s, sr);
    const at = (t: number) => a.whistle[Math.round(t / a.audioHop)];
    expect(at(1.2)).toBeGreaterThan(0.5);
    expect(at(0.5)).toBeLessThan(0.1);
    expect(a.loudness[Math.round(1.2 / a.audioHop)]).toBeGreaterThan(a.loudness[Math.round(0.5 / a.audioHop)]);
  });

  it('measures frame differences', () => {
    expect(frameDiff(new Uint8Array([0, 10, 20]), new Uint8Array([0, 10, 20]))).toBe(0);
    expect(frameDiff(new Uint8Array([0, 0]), new Uint8Array([10, 30]))).toBe(20);
  });
});
