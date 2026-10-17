import { createMediaClip, createTextClip } from '../model/factory';
import { FONTS } from '../model/presets';
import { followKeyframes, type PathPoint } from '../ai/reframeCore';
import type { Asset, Clip, TextStyle } from '../model/types';

export const IMPACT = FONTS[1];
export const SANS = FONTS[0];

/** A text overlay at (x, y), offsets from the frame centre as fractions of its size. */
export function text(content: string, start: number, duration: number, style: Partial<TextStyle>, x: number, y: number, extra: Partial<Clip> = {}): Clip {
  const c = createTextClip({ shadow: true, ...style, content }, start);
  return { ...c, duration, transform: { ...c.transform, x, y }, ...extra };
}

export const upper = (s: string) => s.trim().toUpperCase();

export const jersey = (n: string) => (n.trim() ? `#${n.trim().replace('#', '')}` : '');

/** Full-frame still (title cards and the like). */
export function card(asset: Asset, duration: number): Clip {
  return { ...createMediaClip(asset), duration, fit: 'cover' };
}

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

/** Fills a narrower frame with wide footage, panned to keep `focusX` (0..1 across the source) in view. */
export function reframe(clip: Clip, a: Asset, W: number, H: number, focusX = 0.5): Clip {
  if (a.kind === 'audio' || !a.width || !a.height || a.width / a.height <= W / H + 0.01) return clip;
  const frameW = (a.width / a.height) * (H / W);
  const slack = (frameW - 1) / 2;
  return { ...clip, fit: 'cover', transform: { ...clip.transform, x: Math.max(-slack, Math.min(slack, (0.5 - focusX) * frameW)) } };
}

/** Fills the frame with wide footage and pans along a tracked path (auto-follow). Call once the clip's timing is final. */
export function follow(clip: Clip, a: Asset, W: number, H: number, path: PathPoint[] | undefined): Clip {
  if (!path?.length || a.kind !== 'video' || !a.width || a.width / a.height <= W / H + 0.01) return clip;
  const keys = followKeyframes(clip, a, W, H, path);
  if (!keys.length) return clip;
  return { ...clip, fit: 'cover', transform: { ...clip.transform, x: keys[0].v }, keyframes: { ...clip.keyframes, x: keys } };
}
