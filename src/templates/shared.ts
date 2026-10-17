import { followKeyframes, type PathPoint } from '../ai/reframeCore';
import type { Asset, Clip } from '../model/types';

export const upper = (s: string) => s.trim().toUpperCase();

export const jersey = (n: string) => (n.trim() ? `#${n.trim().replace('#', '')}` : '');


/**
 * Snaps section lengths to whole bars of the music so cuts land on the beat.
 * Without a tempo (or when `on` is false) lengths pass through, capped at `max`.
 */
export function barFitter(bar: number, on: boolean) {
  return (d: number, max = Infinity) => {
    if (!on || !bar) return Math.min(d, max);
    let n = Math.max(1, Math.round(d / bar));
    while (n > 1 && n * bar > max + 1e-6) n--;
    return n * bar > max ? max : n * bar;
  };
}

/** Fills the frame with wide footage and pans along a tracked path (auto-follow). Call once the clip's timing is final. */
export function follow(clip: Clip, a: Asset, W: number, H: number, path: PathPoint[] | undefined): Clip {
  if (!path?.length || a.kind !== 'video' || !a.width || a.width / a.height <= W / H + 0.01) return clip;
  const keys = followKeyframes(clip, a, W, H, path);
  if (!keys.length) return clip;
  return { ...clip, fit: 'cover', transform: { ...clip.transform, x: keys[0].v }, keyframes: { ...clip.keyframes, x: keys } };
}
