import { describe, expect, it } from 'vitest';
import { createMediaClip, createProject, createTextClip } from './factory';
import {
  activeLayers,
  appendToMain,
  getMainTrack,
  moveClip,
  normalize,
  placeClip,
  projectDuration,
  rippleDelete,
  setClipSpeed,
  snapOffset,
  splitClip,
  trimClip,
} from './ops';
import type { Asset } from './types';

const video = (id: string, duration = 10): Asset => ({
  id,
  name: `${id}.mp4`,
  kind: 'video',
  url: '',
  duration,
  width: 1920,
  height: 1080,
  size: 0,
  hasAudio: true,
});

function twoClipProject() {
  let p = createProject();
  const a = createMediaClip(video('a', 10));
  const b = createMediaClip(video('b', 6));
  p = appendToMain(p, a);
  p = appendToMain(p, b);
  return { p, a: p.clips[0], b: p.clips[1] };
}

describe('timeline ops', () => {
  it('appends clips end to end on the main track', () => {
    const { p, a, b } = twoClipProject();
    const main = getMainTrack(p);
    expect(a.trackId).toBe(main.id);
    expect(b.trackId).toBe(main.id);
    expect(b.start).toBe(10);
    expect(projectDuration(p)).toBe(16);
  });

  it('splits a clip and offsets the in-point of the right half', () => {
    const { p, a } = twoClipProject();
    const s = splitClip(p, a.id, 4, 'right')!;
    const left = s.clips.find((c) => c.id === a.id)!;
    const right = s.clips.find((c) => c.id === 'right')!;
    expect(left.duration).toBe(4);
    expect(right.start).toBe(4);
    expect(right.duration).toBe(6);
    expect(right.inPoint).toBe(4);
  });

  it('refuses to split at a clip edge', () => {
    const { p, a } = twoClipProject();
    expect(splitClip(p, a.id, 0)).toBeNull();
    expect(splitClip(p, a.id, 10)).toBeNull();
  });

  it('accounts for speed when splitting', () => {
    let { p, a } = twoClipProject();
    p = setClipSpeed(p, a.id, 2);
    const sped = p.clips.find((c) => c.id === a.id)!;
    expect(sped.duration).toBe(5);
    // later clip rippled back
    expect(p.clips.find((c) => c.id !== a.id)!.start).toBe(5);
    const s = splitClip(p, a.id, 2, 'r')!;
    expect(s.clips.find((c) => c.id === 'r')!.inPoint).toBe(4);
  });

  it('trims within source bounds and neighbours', () => {
    const { p, a, b } = twoClipProject();
    const assetA = video('a', 10);
    // cannot extend past the source length or into the next clip
    let t = trimClip(p, a.id, 'end', 14, assetA);
    expect(t.clips.find((c) => c.id === a.id)!.duration).toBe(10);
    t = trimClip(p, a.id, 'end', 7, assetA);
    expect(t.clips.find((c) => c.id === a.id)!.duration).toBe(7);
    // trimming the start of b moves its in-point
    t = trimClip(t, b.id, 'start', 12, video('b', 6));
    const nb = t.clips.find((c) => c.id === b.id)!;
    expect(nb.start).toBe(12);
    expect(nb.inPoint).toBe(2);
    expect(nb.duration).toBe(4);
    // and can be pulled back to the previous clip's end, not before the source start
    t = trimClip(t, b.id, 'start', 0, video('b', 6));
    expect(t.clips.find((c) => c.id === b.id)!.start).toBe(10);
  });

  it('creates a new track when a move would overlap', () => {
    const { p, a, b } = twoClipProject();
    const main = getMainTrack(p);
    const moved = moveClip(p, b.id, 3, main.id);
    const nb = moved.clips.find((c) => c.id === b.id)!;
    expect(nb.trackId).not.toBe(main.id);
    expect(moved.tracks.length).toBe(2);
    // the overlay sits above the main track in the visual stack
    expect(moved.tracks.findIndex((t) => t.id === nb.trackId)).toBeLessThan(moved.tracks.findIndex((t) => t.main));
    expect(moved.clips.find((c) => c.id === a.id)!.trackId).toBe(main.id);
  });

  it('ripple delete closes the gap', () => {
    const { p, a, b } = twoClipProject();
    const r = rippleDelete(p, a.id);
    expect(r.clips.find((c) => c.id === b.id)!.start).toBe(0);
  });

  it('removes empty tracks but keeps the main track', () => {
    let p = createProject();
    p = placeClip(p, createTextClip({}, 1));
    expect(p.tracks.length).toBe(2);
    p = normalize({ ...p, clips: [] });
    expect(p.tracks.length).toBe(1);
    expect(p.tracks[0].main).toBe(true);
  });

  it('builds transition layers across a cut', () => {
    let { p, b } = twoClipProject();
    p = { ...p, clips: p.clips.map((c) => (c.id === b.id ? { ...c, transition: 'dissolve', transitionDur: 1 } : c)) };
    const layers = activeLayers(p, 10.5);
    expect(layers).toHaveLength(2);
    expect(layers[0].held).toBe(true);
    expect(layers[0].transition?.role).toBe('out');
    expect(layers[1].transition?.progress).toBeCloseTo(0.5);
    expect(activeLayers(p, 12)).toHaveLength(1);
  });

  it('draws upper tracks after lower ones', () => {
    let p = createProject();
    p = appendToMain(p, createMediaClip(video('a', 10)));
    p = placeClip(p, createTextClip({}, 1));
    const layers = activeLayers(p, 2);
    expect(layers.map((l) => l.clip.kind)).toEqual(['video', 'text']);
  });

  it('snaps to the closest point within the threshold', () => {
    expect(snapOffset([4.95, 7.95], [0, 5, 10], 0.1).offset).toBeCloseTo(0.05);
    expect(snapOffset([4.5], [0, 5, 10], 0.1).at).toBeNull();
  });
});
