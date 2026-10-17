import { describe, expect, it } from 'vitest';
import { createMediaClip, createProject, createTextClip } from '../model/factory';
import { appendToMain, placeClip, setClipSpeed } from '../model/ops';
import type { Asset, Project } from '../model/types';
import { frameCount, planAudio, planVideoFrames } from './exportPlan';

const asset = (id: string, duration: number, kind: Asset['kind'] = 'video'): Asset => ({
  id,
  name: id,
  kind,
  url: '',
  duration,
  width: 1280,
  height: 720,
  size: 0,
  hasAudio: true,
});

function project(): { p: Project; assets: Record<string, Asset> } {
  const assets = { a: asset('a', 2), b: asset('b', 1) };
  let p = createProject();
  p = appendToMain(p, createMediaClip(assets.a));
  p = appendToMain(p, createMediaClip(assets.b));
  return { p, assets };
}

describe('export planning', () => {
  it('counts frames from the project length', () => {
    const { p } = project();
    expect(frameCount(p, 30)).toBe(90);
    expect(frameCount(p, 24)).toBe(72);
  });

  it('asks each clip for one frame per output frame, in order', () => {
    const { p } = project();
    const plan = planVideoFrames(p, 10);
    const [a, b] = p.clips;
    expect(plan.get(a.id)).toHaveLength(20);
    expect(plan.get(b.id)).toHaveLength(10);
    expect(plan.get(b.id)![0]).toBe(0);
    expect(plan.get(a.id)![5]).toBeCloseTo(0.5);
    const times = plan.get(a.id)!;
    expect(times.every((t, i) => i === 0 || t >= times[i - 1])).toBe(true);
  });

  it('includes the held outgoing frames of a transition', () => {
    let { p } = project();
    const [a, b] = p.clips;
    p = { ...p, clips: p.clips.map((c) => (c.id === b.id ? { ...c, transition: 'dissolve', transitionDur: 0.5 } : c)) };
    const plan = planVideoFrames(p, 10);
    // 20 frames of its own plus 5 held frames during the dissolve
    expect(plan.get(a.id)).toHaveLength(25);
    expect(plan.get(a.id)!.slice(20).every((t) => t > 1.9)).toBe(true);
  });

  it('scales source time by speed', () => {
    let { p } = project();
    const [a] = p.clips;
    p = setClipSpeed(p, a.id, 2);
    const plan = planVideoFrames(p, 10);
    expect(plan.get(a.id)).toHaveLength(10);
    expect(plan.get(a.id)![3]).toBeCloseTo(0.6);
  });

  it('skips hidden tracks and non-video clips', () => {
    let { p } = project();
    p = placeClip(p, createTextClip({}, 0));
    p = { ...p, tracks: p.tracks.map((t) => (t.main ? { ...t, hidden: true } : t)) };
    expect(planVideoFrames(p, 10).size).toBe(0);
  });

  it('plans audio for audible clips only', () => {
    const { p, assets } = project();
    const [a, b] = p.clips;
    let cues = planAudio(p, assets);
    expect(cues.map((c) => c.when)).toEqual([0, 2]);
    const quiet = { ...p, clips: p.clips.map((c) => (c.id === a.id ? { ...c, volume: 0 } : c)) };
    cues = planAudio(quiet, assets);
    expect(cues).toHaveLength(1);
    expect(cues[0].assetId).toBe(b.assetId);
    const muted = { ...p, tracks: p.tracks.map((t) => ({ ...t, muted: true })) };
    expect(planAudio(muted, assets)).toHaveLength(0);
  });
});
