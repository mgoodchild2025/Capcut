import { describe, expect, it } from 'vitest';
import { createMediaClip, createProject } from './factory';
import {
  addMarker,
  appendToMain,
  copyStyle,
  detachAudio,
  insertRipple,
  pasteStyle,
  setCurve,
  setHold,
  snapPoints,
  splitClip,
  trimClip,
} from './ops';
import {
  CURVE_PRESETS,
  curveAt,
  curveIntegral,
  keyframeTimes,
  rateAt,
  removeKeyframe,
  setKeyframe,
  sourceSpan,
  sourceTimeAt,
  transformAt,
  valueAt,
} from './timing';
import type { Asset, Clip } from './types';

const asset = (duration = 10): Asset => ({
  id: 'a',
  name: 'a.mp4',
  kind: 'video',
  url: '',
  duration,
  width: 1920,
  height: 1080,
  size: 0,
  hasAudio: true,
});

const clipOf = (patch: Partial<Clip> = {}): Clip => ({ ...createMediaClip(asset()), start: 0, duration: 4, ...patch });

describe('speed curves', () => {
  const pts = [
    { p: 0, s: 1 },
    { p: 0.5, s: 3 },
    { p: 1, s: 1 },
  ];
  it('interpolates the multiplier', () => {
    expect(curveAt(pts, 0.25)).toBeCloseTo(2);
    expect(curveAt(pts, 2)).toBe(1);
  });
  it('integrates the multiplier exactly for piecewise-linear curves', () => {
    expect(curveIntegral(pts, 0.5)).toBeCloseTo(1);
    expect(curveIntegral(pts, 1)).toBeCloseTo(2);
    expect(curveIntegral(pts, 1.5)).toBeCloseTo(2.5);
  });
  it('maps timeline to source time across a curve', () => {
    const c = clipOf({ curve: { id: 't', points: pts } });
    expect(sourceTimeAt(c, 0)).toBe(0);
    expect(sourceTimeAt(c, 2)).toBeCloseTo(4); // half the clip covers half the area * duration
    expect(sourceTimeAt(c, 4)).toBeCloseTo(8);
    expect(sourceSpan(c)).toBeCloseTo(8);
    expect(rateAt(c, 2)).toBeCloseTo(3);
  });
  it('keeps the source range when a curve is applied, changing duration', () => {
    let p = appendToMain(createProject(), createMediaClip(asset(10)));
    const id = p.clips[0].id;
    const hero = CURVE_PRESETS.find((c) => c.id === 'hero')!;
    p = setCurve(p, id, { id: 'hero', points: hero.points }, asset(10));
    const c = p.clips[0];
    expect(sourceSpan(c)).toBeCloseTo(10, 5);
  });
  it('splits a curved clip into two constant-speed halves covering the same source', () => {
    const p0 = { ...createProject(), clips: [] as Clip[] };
    let p = appendToMain(p0, createMediaClip(asset(10)));
    const id = p.clips[0].id;
    p = setCurve(p, id, { id: 't', points: pts }, asset(10));
    const mid = p.clips[0].duration / 2;
    const s = splitClip(p, id, mid, 'r')!;
    const [l, r] = s.clips;
    expect(l.curve).toBeUndefined();
    expect(l.inPoint + sourceSpan(l)).toBeCloseTo(r.inPoint);
    expect(r.inPoint + sourceSpan(r)).toBeCloseTo(10);
  });
});

describe('holds', () => {
  it('freezes the first frame, then plays', () => {
    const c = clipOf({ hold: 1, duration: 5, inPoint: 2 });
    expect(sourceTimeAt(c, 0.5)).toBe(2);
    expect(sourceTimeAt(c, 2)).toBeCloseTo(3);
    expect(rateAt(c, 0.5)).toBe(0);
  });
  it('setHold lengthens the clip and ripples the track', () => {
    let p = appendToMain(createProject(), createMediaClip(asset(4)));
    p = appendToMain(p, createMediaClip(asset(4)));
    const [a, b] = p.clips;
    p = setHold(p, a.id, 1.5);
    expect(p.clips.find((c) => c.id === a.id)!.duration).toBeCloseTo(5.5);
    expect(p.clips.find((c) => c.id === b.id)!.start).toBeCloseTo(5.5);
  });
  it('does not split inside a hold', () => {
    let p = appendToMain(createProject(), createMediaClip(asset(4)));
    p = setHold(p, p.clips[0].id, 1);
    expect(splitClip(p, p.clips[0].id, 0.5)).toBeNull();
    expect(splitClip(p, p.clips[0].id, 2)).not.toBeNull();
  });
});

describe('keyframes', () => {
  it('eases between keyframes and holds outside them', () => {
    let c = clipOf();
    c = { ...c, keyframes: setKeyframe(c, 'scale', 1, 1) };
    c = { ...c, keyframes: setKeyframe(c, 'scale', 3, 2) };
    expect(transformAt(c, 0).scale).toBe(1);
    expect(transformAt(c, 2).scale).toBeCloseTo(1.5);
    expect(transformAt(c, 4).scale).toBe(2);
    expect(valueAt(c, 'x', 2)).toBe(0);
    expect(keyframeTimes(c)).toEqual([1, 3]);
    c = { ...c, keyframes: removeKeyframe(c, 'scale', 1) };
    expect(keyframeTimes(c)).toEqual([3]);
  });
  it('keeps the animation intact when splitting', () => {
    let p = appendToMain(createProject(), createMediaClip(asset(4)));
    const id = p.clips[0].id;
    let c = p.clips[0];
    c = { ...c, keyframes: setKeyframe(c, 'opacity', 0, 0) };
    c = { ...c, keyframes: setKeyframe(c, 'opacity', 4, 1) };
    p = { ...p, clips: [c] };
    const s = splitClip(p, id, 2, 'r')!;
    const r = s.clips.find((x) => x.id === 'r')!;
    expect(valueAt(s.clips[0], 'opacity', 2)).toBeCloseTo(valueAt(c, 'opacity', 2));
    expect(valueAt(r, 'opacity', 0)).toBeCloseTo(valueAt(c, 'opacity', 2));
    expect(valueAt(r, 'opacity', 2)).toBeCloseTo(1);
  });
  it('shifts keyframes when trimming the start', () => {
    let p = appendToMain(createProject(), createMediaClip(asset(4)));
    let c = p.clips[0];
    c = { ...c, keyframes: setKeyframe(c, 'x', 3, 0.5) };
    p = { ...p, clips: [c] };
    p = trimClip(p, c.id, 'start', 1, asset(4));
    expect(keyframeTimes(p.clips[0])).toContain(2);
  });
});

describe('quick edits', () => {
  it('detaches audio onto an audio track and mutes the video', () => {
    let p = appendToMain(createProject(), createMediaClip(asset(4)));
    p = detachAudio(p, p.clips[0].id, 'aud')!;
    const v = p.clips.find((c) => c.kind === 'video')!;
    const a = p.clips.find((c) => c.id === 'aud')!;
    expect(v.volume).toBe(0);
    expect(a.kind).toBe('audio');
    expect(a.start).toBe(v.start);
    expect(p.tracks.find((t) => t.id === a.trackId)!.kind).toBe('audio');
  });
  it('inserts with ripple, splitting the clip underneath', () => {
    let p = appendToMain(createProject(), createMediaClip(asset(4)));
    const main = p.tracks[0].id;
    const still: Clip = { ...createMediaClip({ ...asset(), id: 'img', kind: 'image' }), id: 'freeze', duration: 2 };
    p = insertRipple(p, main, 1, still);
    const sorted = [...p.clips].sort((a, b) => a.start - b.start);
    expect(sorted.map((c) => [c.start, c.duration])).toEqual([
      [0, 1],
      [1, 2],
      [3, 3],
    ]);
  });
  it('snaps to markers', () => {
    const p = addMarker(createProject(), 2.5);
    expect(snapPoints(p, null, 0)).toContain(2.5);
  });
  it('pastes visual style but keeps text content', () => {
    let p = appendToMain(createProject(), createMediaClip(asset(4)));
    p = appendToMain(p, createMediaClip(asset(4)));
    const [a, b] = p.clips;
    const style = copyStyle({ ...a, filter: 'noir', transform: { ...a.transform, scale: 2 } });
    p = pasteStyle(p, b.id, style);
    const nb = p.clips.find((c) => c.id === b.id)!;
    expect(nb.filter).toBe('noir');
    expect(nb.transform.scale).toBe(2);
  });
});
