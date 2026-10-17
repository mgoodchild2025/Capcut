import { describe, expect, it } from 'vitest';
import { buildLayers, cameraFor, guessDepth, pushPull } from './livePhotoCore';

describe('living photos', () => {
  it('fills holes from their surroundings', () => {
    // A 4x1 row: red, hole, hole, blue.
    const rgb = new Float32Array([255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255]);
    const valid = new Float32Array([1, 0, 0, 1]);
    pushPull(rgb, valid, 4, 1);
    expect(Array.from(valid)).toEqual([1, 1, 1, 1]);
    // Untouched pixels stay; filled ones take colour from their side.
    expect([rgb[0], rgb[2]]).toEqual([255, 0]);
    expect(rgb[3]).toBeGreaterThan(rgb[5]);
    expect(rgb[11]).toBe(255);
  });

  it('splits by depth, keeps nearer pixels in every farther layer, and inpaints behind them', () => {
    const w = 16;
    const h = 8;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const depth = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const subject = x >= 6 && x < 10;
        depth[i] = subject ? 250 : 20;
        rgba.set(subject ? [255, 255, 255, 255] : [0, 0, 200, 255], i * 4);
      }
    const layers = buildLayers(rgba, depth, w, h, 3);
    expect(layers.map((l) => l.near)).toEqual([0, 0.5, 1]);
    const at = (l: number, x: number, y = 4) => Array.from(layers[l].rgba.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
    // Background layer covers everything; behind the subject it shows background blue, not white.
    expect(at(0, 2)[3]).toBe(255);
    expect(at(0, 8)[3]).toBe(255);
    expect(at(0, 8)[2]).toBeGreaterThan(150);
    expect(at(0, 8)[0]).toBeLessThan(60);
    // The nearest layer holds just the subject, in its real colour.
    expect(at(2, 8)).toEqual([255, 255, 255, 255]);
    expect(at(2, 2)[3]).toBe(0);
  });

  it('guesses depth: subject in the middle nearer than the edges, alpha used when present', () => {
    const w = 20;
    const h = 20;
    const opaque = new Uint8ClampedArray(w * h * 4).fill(255);
    const d = guessDepth(opaque, w, h);
    expect(d[11 * w + 10]).toBeGreaterThan(d[2 * w + 1]);
    const cut = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) cut[i * 4 + 3] = i % w > 10 ? 255 : 0;
    const d2 = guessDepth(cut, w, h);
    expect(d2[5 * w + 15]).toBe(255);
    expect(d2[5 * w + 3]).toBe(0);
  });

  it('moves near layers more than far ones', () => {
    const far = cameraFor(0, 1);
    const near = cameraFor(1, 1);
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(Math.abs(near.dx)).toBeGreaterThan(Math.abs(far.dx));
    expect(cameraFor(1, 0).scale).toBeCloseTo(1.04);
  });
});
