import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIBRARY_MUSIC, LIBRARY_SFX } from './library';
import { REEL_STYLES } from '../templates/reel';

describe('bundled sound library', () => {
  it('has a recorded file for every track and sound', () => {
    for (const t of LIBRARY_MUSIC) expect(existsSync(`public/audio/music/${t.id}.mp3`), t.id).toBe(true);
    for (const s of LIBRARY_SFX) expect(existsSync(`public/audio/sfx/${s.id}.mp3`), s.id).toBe(true);
  });

  it('has steady beat maps that match each tempo and span the track', () => {
    for (const t of LIBRARY_MUSIC) {
      const gaps = t.beats.slice(1).map((b, i) => b - t.beats[i]);
      expect(Math.min(...gaps), t.id).toBeGreaterThan(0);
      const median = gaps.sort((a, b) => a - b)[gaps.length >> 1];
      expect(60 / median, t.id).toBeCloseTo(t.bpm, 0);
      expect(t.beats[t.beats.length - 1], t.id).toBeGreaterThan(t.seconds - 2);
    }
  });

  it('recommends a recorded track for every reel style', () => {
    for (const s of REEL_STYLES) expect(LIBRARY_MUSIC.some((t) => t.id === s.music), s.id).toBe(true);
  });
});
