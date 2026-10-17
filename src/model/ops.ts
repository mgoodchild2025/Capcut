import { uid } from '../utils';
import type { Asset, Clip, ClipKind, Project, Track, TrackKind, TransitionKind } from './types';

/** Shortest clip the timeline allows, in seconds. */
export const MIN_CLIP = 0.1;
/** Tolerance used when deciding whether two clips touch. */
export const EPS = 1e-3;

export const clipEnd = (c: Pick<Clip, 'start' | 'duration'>) => c.start + c.duration;

export function trackKindFor(kind: ClipKind): TrackKind {
  if (kind === 'audio') return 'audio';
  if (kind === 'text' || kind === 'sticker') return 'text';
  return 'video';
}

export function projectDuration(p: Project): number {
  let d = 0;
  for (const c of p.clips) d = Math.max(d, clipEnd(c));
  return d;
}

export function trackClips(p: Project, trackId: string): Clip[] {
  return p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd - EPS && bStart < aEnd - EPS;
}

export function isFree(p: Project, trackId: string, start: number, duration: number, ignoreId?: string): boolean {
  return !p.clips.some(
    (c) => c.trackId === trackId && c.id !== ignoreId && rangesOverlap(start, start + duration, c.start, clipEnd(c)),
  );
}

/** Longest timeline duration the clip can have from its current in-point. */
export function maxTimelineDuration(clip: Clip, asset?: Asset): number {
  if (!asset || asset.kind === 'image' || clip.kind === 'image') return Infinity;
  return Math.max(MIN_CLIP, (asset.duration - clip.inPoint) / clip.speed);
}

export function sourceTimeAt(clip: Clip, t: number): number {
  return clip.inPoint + (t - clip.start) * clip.speed;
}

export function createTrack(kind: TrackKind, main = false): Track {
  return { id: uid('t_'), kind, main: main || undefined, muted: false, hidden: false, locked: false };
}

/**
 * Inserts a new track of the given kind. Text tracks go on top, audio at the bottom, and
 * video overlays directly above `aboveTrackId` (or above every existing video track).
 */
export function addTrack(p: Project, kind: TrackKind, aboveTrackId?: string): { project: Project; track: Track } {
  const track = createTrack(kind);
  const tracks = [...p.tracks];
  let index: number;
  const above = aboveTrackId ? tracks.findIndex((t) => t.id === aboveTrackId) : -1;
  if (above >= 0 && tracks[above].kind === kind) {
    index = kind === 'audio' ? above + 1 : above;
  } else if (kind === 'text') {
    index = 0;
  } else if (kind === 'video') {
    const firstVideo = tracks.findIndex((t) => t.kind === 'video');
    index = firstVideo >= 0 ? firstVideo : tracks.filter((t) => t.kind === 'text').length;
  } else {
    index = tracks.length;
  }
  tracks.splice(index, 0, track);
  return { project: { ...p, tracks }, track };
}

/** Find a track that can host a clip of `kind` over the given range. Overlays never land on the main track implicitly. */
export function findFreeTrack(
  p: Project,
  kind: TrackKind,
  start: number,
  duration: number,
  ignoreId?: string,
): Track | undefined {
  // Prefer the track nearest the bottom of the visual stack for video, top for text.
  const candidates = p.tracks.filter((t) => t.kind === kind && !t.main && !t.locked);
  const ordered = kind === 'video' ? [...candidates].reverse() : candidates;
  return ordered.find((t) => isFree(p, t.id, start, duration, ignoreId));
}

export function getMainTrack(p: Project): Track {
  return p.tracks.find((t) => t.main) ?? p.tracks.find((t) => t.kind === 'video')!;
}

/**
 * Places a clip (already carrying start/duration) onto a sensible track:
 * the preferred track when compatible and free, otherwise any free track of the right kind,
 * otherwise a brand new track.
 */
export function placeClip(p: Project, clip: Clip, preferTrackId?: string): Project {
  const kind = trackKindFor(clip.kind);
  const pref = preferTrackId ? p.tracks.find((t) => t.id === preferTrackId) : undefined;
  let trackId: string | undefined;
  let next = p;
  if (pref && pref.kind === kind && !pref.locked && isFree(p, pref.id, clip.start, clip.duration, clip.id)) {
    trackId = pref.id;
  } else {
    trackId = findFreeTrack(p, kind, clip.start, clip.duration, clip.id)?.id;
    if (!trackId) {
      const res = addTrack(p, kind, pref?.kind === kind ? pref.id : undefined);
      next = res.project;
      trackId = res.track.id;
    }
  }
  const placed = { ...clip, trackId };
  const exists = next.clips.some((c) => c.id === clip.id);
  return {
    ...next,
    clips: exists ? next.clips.map((c) => (c.id === clip.id ? placed : c)) : [...next.clips, placed],
  };
}

/** Appends to the end of the main track. */
export function appendToMain(p: Project, clip: Clip): Project {
  const main = getMainTrack(p);
  const end = trackClips(p, main.id).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  return placeClip(p, { ...clip, start: end }, main.id);
}

/** Removes empty non-main tracks and guarantees a main track exists. */
export function normalize(p: Project): Project {
  const used = new Set(p.clips.map((c) => c.trackId));
  let tracks = p.tracks.filter((t) => t.main || used.has(t.id));
  if (!tracks.some((t) => t.main)) {
    const main = createTrack('video', true);
    const firstAudio = tracks.findIndex((t) => t.kind === 'audio');
    tracks = [...tracks];
    tracks.splice(firstAudio >= 0 ? firstAudio : tracks.length, 0, main);
  }
  return tracks.length === p.tracks.length && tracks.every((t, i) => t === p.tracks[i]) ? p : { ...p, tracks };
}

export function updateClip(p: Project, id: string, patch: Partial<Clip> | ((c: Clip) => Partial<Clip>)): Project {
  return {
    ...p,
    clips: p.clips.map((c) => (c.id === id ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)),
  };
}

export function removeClip(p: Project, id: string): Project {
  return normalize({ ...p, clips: p.clips.filter((c) => c.id !== id) });
}

/** Deletes a clip and closes the gap it leaves on its track. */
export function rippleDelete(p: Project, id: string): Project {
  const clip = p.clips.find((c) => c.id === id);
  if (!clip) return p;
  const clips = p.clips
    .filter((c) => c.id !== id)
    .map((c) => (c.trackId === clip.trackId && c.start >= clipEnd(clip) - EPS ? { ...c, start: c.start - clip.duration } : c));
  return normalize({ ...p, clips });
}

export function splitClip(p: Project, id: string, t: number, newId = uid('c_')): Project | null {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return null;
  if (t <= c.start + MIN_CLIP / 2 || t >= clipEnd(c) - MIN_CLIP / 2) return null;
  const leftDur = t - c.start;
  const left: Clip = { ...c, duration: leftDur, animOut: 'none', audioFadeOut: 0 };
  const right: Clip = {
    ...c,
    id: newId,
    start: t,
    duration: c.duration - leftDur,
    inPoint: c.inPoint + leftDur * c.speed,
    animIn: 'none',
    audioFadeIn: 0,
    transition: 'none',
  };
  const idx = p.clips.findIndex((x) => x.id === id);
  const clips = [...p.clips];
  clips.splice(idx, 1, left, right);
  return { ...p, clips };
}

/** Neighbours of a clip on its own track. */
export function neighbours(p: Project, clip: Clip): { prev?: Clip; next?: Clip } {
  const list = trackClips(p, clip.trackId).filter((c) => c.id !== clip.id);
  let prev: Clip | undefined;
  let next: Clip | undefined;
  for (const c of list) {
    if (clipEnd(c) <= clip.start + EPS) prev = c;
    else if (c.start >= clipEnd(clip) - EPS && !next) next = c;
  }
  return { prev, next };
}

/**
 * Trims one edge of a clip to `time` (timeline seconds), constrained by neighbours,
 * the source media length and the minimum clip length.
 */
export function trimClip(p: Project, id: string, edge: 'start' | 'end', time: number, asset?: Asset): Project {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  const { prev, next } = neighbours(p, c);
  const end = clipEnd(c);
  if (edge === 'start') {
    let min = prev ? clipEnd(prev) : 0;
    if (asset && asset.kind !== 'image') min = Math.max(min, c.start - c.inPoint / c.speed);
    const s = Math.min(Math.max(time, min), end - MIN_CLIP);
    return updateClip(p, id, {
      start: s,
      duration: end - s,
      inPoint: Math.max(0, c.inPoint + (s - c.start) * c.speed),
    });
  }
  let max = c.start + maxTimelineDuration(c, asset);
  if (next) max = Math.min(max, next.start);
  const e = Math.max(Math.min(time, max), c.start + MIN_CLIP);
  return updateClip(p, id, { duration: e - c.start });
}

/**
 * Moves a clip. If the target track is incompatible or occupied, a new track is created
 * next to it (the CapCut behaviour for overlapping drops).
 */
export function moveClip(p: Project, id: string, start: number, targetTrackId: string | null): Project {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  const moved = { ...c, start: Math.max(0, start) };
  const target = targetTrackId ? p.tracks.find((t) => t.id === targetTrackId) : undefined;
  const kind = trackKindFor(c.kind);
  if (target && target.kind === kind && !target.locked && isFree(p, target.id, moved.start, moved.duration, id)) {
    return normalize(updateClip(p, id, { start: moved.start, trackId: target.id }));
  }
  if (!target) {
    // Dropped outside any track: give it a fresh track of its own.
    const res = addTrack(p, kind);
    return normalize(updateClip(res.project, id, { start: moved.start, trackId: res.track.id }));
  }
  const res = addTrack(p, kind, target.kind === kind ? target.id : undefined);
  return normalize(updateClip(res.project, id, { start: moved.start, trackId: res.track.id }));
}

/** Changes speed, keeping the same source range, and ripples later clips on the track. */
export function setClipSpeed(p: Project, id: string, speed: number): Project {
  const c = p.clips.find((x) => x.id === id);
  if (!c || speed <= 0) return p;
  const sourceSpan = c.duration * c.speed;
  const duration = Math.max(MIN_CLIP, sourceSpan / speed);
  const delta = duration - c.duration;
  const oldEnd = clipEnd(c);
  const clips = p.clips.map((x) => {
    if (x.id === id) return { ...x, speed, duration };
    if (x.trackId === c.trackId && x.start >= oldEnd - EPS) return { ...x, start: Math.max(0, x.start + delta) };
    return x;
  });
  return { ...p, clips };
}

export function duplicateClip(p: Project, id: string, newId = uid('c_')): Project {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return p;
  const copy: Clip = structuredCloneClip({ ...c, id: newId, start: clipEnd(c) });
  return placeClip(p, copy, c.trackId);
}

function structuredCloneClip(c: Clip): Clip {
  return {
    ...c,
    transform: { ...c.transform },
    adjust: { ...c.adjust },
    text: c.text ? { ...c.text } : undefined,
  };
}

/** Candidate positions for snapping, in timeline seconds. */
export function snapPoints(p: Project, excludeId: string | null, playhead: number): number[] {
  const pts = [0, playhead];
  for (const c of p.clips) {
    if (c.id === excludeId) continue;
    pts.push(c.start, clipEnd(c));
  }
  return pts;
}

/** Snaps any of `edges` to the nearest point within `threshold`. Returns the offset to apply. */
export function snapOffset(edges: number[], points: number[], threshold: number): { offset: number; at: number | null } {
  let best = threshold;
  let offset = 0;
  let at: number | null = null;
  for (const e of edges) {
    for (const pt of points) {
      const d = Math.abs(pt - e);
      if (d < best) {
        best = d;
        offset = pt - e;
        at = pt;
      }
    }
  }
  return { offset, at };
}

export interface Layer {
  clip: Clip;
  track: Track;
  /** Seconds into the source media. */
  sourceTime: number;
  /** Seconds since the clip started on the timeline. */
  local: number;
  /** Set while a clip is drawn past its end as the outgoing side of a transition. */
  held?: boolean;
  transition?: { kind: TransitionKind; progress: number; role: 'in' | 'out' };
}

/**
 * Everything that should be audible or visible at time `t`, in draw order
 * (bottom of the visual stack first).
 */
export function activeLayers(p: Project, t: number): Layer[] {
  const layers: Layer[] = [];
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const track = p.tracks[i];
    const clips = trackClips(p, track.id);
    const idx = clips.findIndex((c) => t >= c.start - EPS && t < clipEnd(c) - EPS / 2);
    if (idx < 0) continue;
    const clip = clips[idx];
    const local = t - clip.start;
    if (clip.transition !== 'none' && track.kind !== 'audio' && local < clip.transitionDur) {
      const prev = clips[idx - 1];
      if (prev && Math.abs(clipEnd(prev) - clip.start) < 0.05) {
        const progress = Math.min(1, Math.max(0, local / clip.transitionDur));
        layers.push({
          clip: prev,
          track,
          sourceTime: prev.inPoint + Math.max(0, prev.duration * prev.speed - 0.05),
          local: prev.duration,
          held: true,
          transition: { kind: clip.transition, progress, role: 'out' },
        });
        layers.push({
          clip,
          track,
          sourceTime: sourceTimeAt(clip, t),
          local,
          transition: { kind: clip.transition, progress, role: 'in' },
        });
        continue;
      }
    }
    layers.push({ clip, track, sourceTime: sourceTimeAt(clip, t), local });
  }
  return layers;
}

/** Clips that begin within `lookahead` seconds after `t`; used to pre-roll media elements. */
export function upcomingClips(p: Project, t: number, lookahead = 1.5): Clip[] {
  return p.clips.filter((c) => c.start > t && c.start <= t + lookahead);
}
