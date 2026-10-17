import { describe, expect, it } from 'vitest';
import { isSilent, MAX_WINDOW, splitWindows } from './windows';

const SR = 1000;

function tone(seconds: number, silences: [number, number][] = []): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] = silences.some(([a, b]) => t >= a && t < b) ? 0 : Math.sin(i * 0.3) * 0.5;
  }
  return out;
}

describe('audio windows', () => {
  it('keeps short audio in one window', () => {
    expect(splitWindows(tone(10), SR)).toEqual([[0, 10 * SR]]);
  });

  it('covers long audio contiguously with windows under the limit', () => {
    const w = splitWindows(tone(95), SR);
    expect(w[0][0]).toBe(0);
    expect(w[w.length - 1][1]).toBe(95 * SR);
    for (let i = 0; i < w.length; i++) {
      expect(w[i][1] - w[i][0]).toBeLessThanOrEqual(MAX_WINDOW * SR);
      if (i > 0) expect(w[i][0]).toBe(w[i - 1][1]);
    }
  });

  it('cuts inside a pause when there is one', () => {
    const [first] = splitWindows(tone(40, [[24, 24.5]]), SR);
    expect(first[1] / SR).toBeGreaterThanOrEqual(24);
    expect(first[1] / SR).toBeLessThan(24.5);
  });

  it('detects silence', () => {
    expect(isSilent(new Float32Array(1000))).toBe(true);
    expect(isSilent(tone(1))).toBe(false);
  });
});
