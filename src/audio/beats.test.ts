import { describe, expect, it } from 'vitest';
import { createMediaClip, createProject } from '../model/factory';
import { appendToMain } from '../model/ops';
import type { Asset } from '../model/types';
import { cutToBeats, detectBeats } from './beats';

/** A drum-machine-like click track: a decaying 60 Hz thump on every beat plus noise. */
function clickTrack(bpm: number, seconds: number, offset: number, sr = 22050): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sr));
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) out[i] = rand() * 0.01;
  for (let t = offset; t < seconds; t += 60 / bpm) {
    const start = Math.floor(t * sr);
    for (let k = 0; k < sr * 0.15 && start + k < out.length; k++) {
      out[start + k] += Math.sin((2 * Math.PI * 60 * k) / sr) * Math.exp(-k / (sr * 0.04)) * 0.9 + rand() * 0.2 * Math.exp(-k / (sr * 0.01));
    }
  }
  return out;
}

const video = (id: string, duration: number): Asset => ({ id, name: id, kind: 'video', url: '', duration, width: 1, height: 1, size: 0, hasAudio: true });

describe('beat detection', () => {
  it('finds tempo and phase of a steady beat', () => {
    const { bpm, beats } = detectBeats(clickTrack(124, 20, 0.3), 22050);
    expect(Math.abs(bpm - 124)).toBeLessThan(1);
    expect(Math.abs(beats[0] - 0.3)).toBeLessThan(0.03);
  });
  it('handles slower and faster grooves without halving or doubling', () => {
    expect(Math.abs(detectBeats(clickTrack(90, 20, 0.2), 22050).bpm - 90)).toBeLessThan(1);
    expect(Math.abs(detectBeats(clickTrack(140, 20, 0.05), 22050).bpm - 140)).toBeLessThan(1);
  });
});

describe('cut to beats', () => {
  it('snaps every cut on the main track to the beat grid', () => {
    const assets = { a: video('a', 3.3), b: video('b', 5.1), c: video('c', 1.2) };
    let p = createProject();
    for (const a of Object.values(assets)) p = appendToMain(p, createMediaClip(a));
    const beats = Array.from({ length: 40 }, (_, i) => i * 0.5);
    p = cutToBeats(p, beats, 2, assets);
    const sorted = [...p.clips].sort((x, y) => x.start - y.start);
    for (const c of sorted) {
      expect(Math.abs((c.start / 0.5) - Math.round(c.start / 0.5))).toBeLessThan(1e-6);
    }
    // 3.3s -> 3 beats of 1s groups; 5.1s -> 5; 1.2s -> 1
    expect(sorted.map((c) => c.duration)).toEqual([3, 5, 1]);
    expect(sorted.map((c) => c.start)).toEqual([0, 3, 8]);
  });
});
