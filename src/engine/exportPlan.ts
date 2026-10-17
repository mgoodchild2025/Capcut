import { activeLayers, projectDuration, type Layer } from '../model/ops';
import { clipGain, rateAt } from '../model/timing';
import type { Asset, Project } from '../model/types';

/** Whether this browser has WebCodecs, the prerequisite for frame-by-frame export. */
export function fastExportAvailable(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
}

/** Layers whose pixels come from a decoded video, in the same order the compositor asks for them. */
export function videoLayers(project: Project, t: number): Layer[] {
  return activeLayers(project, t).filter((l) => l.clip.kind === 'video' && !l.track.hidden && l.track.kind !== 'audio');
}

export function frameCount(project: Project, fps: number): number {
  return Math.max(0, Math.ceil(projectDuration(project) * fps - 1e-6));
}

/**
 * For every video clip, the source timestamps (seconds) it needs, one per output frame it appears in,
 * in frame order. Feeding these to a decoder in order yields exactly one frame per request.
 */
export function planVideoFrames(project: Project, fps: number): Map<string, number[]> {
  const plan = new Map<string, number[]>();
  const n = frameCount(project, fps);
  for (let i = 0; i < n; i++) {
    for (const layer of videoLayers(project, i / fps)) {
      let list = plan.get(layer.clip.id);
      if (!list) plan.set(layer.clip.id, (list = []));
      list.push(Math.max(0, layer.sourceTime));
    }
  }
  return plan;
}

/** Resolution of sampled gain and rate automation, per second. */
export const AUTOMATION_RATE = 50;

export interface AudioCue {
  assetId: string;
  /** Timeline second at which sound starts (after any hold). */
  when: number;
  /** Seconds into the source at `when`. */
  offset: number;
  /** Seconds of timeline the cue lasts. */
  duration: number;
  /** Playback rate: a constant, or samples at AUTOMATION_RATE from `when`. */
  rate: number | number[];
  /** Gain samples at AUTOMATION_RATE from `when` (volume, keyframes, fades, crossfades). */
  gain: number[];
}

/** Everything audible in the project, ready to schedule on an OfflineAudioContext. */
export function planAudio(project: Project, assets: Record<string, Asset>): AudioCue[] {
  const cues: AudioCue[] = [];
  for (const clip of project.clips) {
    if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
    const track = project.tracks.find((t) => t.id === clip.trackId);
    const asset = clip.assetId ? assets[clip.assetId] : undefined;
    if (!track || track.muted || !asset) continue;
    if (asset.waveform && !asset.hasAudio) continue;
    const hold = clip.hold ?? 0;
    if (clip.inPoint >= asset.duration) continue;

    // Crossfades under visual transitions: fade in over our own transition, and keep playing
    // into the handle (fading out) when the next clip transitions in.
    const siblings = project.clips.filter((c) => c.trackId === clip.trackId).sort((a, b) => a.start - b.start);
    const next = siblings.find((c) => Math.abs(c.start - (clip.start + clip.duration)) < 0.05);
    const fadeInT = clip.transition !== 'none' && track.kind !== 'audio' && siblings.some((c) => Math.abs(c.start + c.duration - clip.start) < 0.05) ? clip.transitionDur : 0;
    const tail = next && next.transition !== 'none' && track.kind !== 'audio' ? Math.min(next.transitionDur, next.duration) : 0;

    const duration = clip.duration - hold + tail;
    if (duration <= 0) continue;
    const n = Math.max(2, Math.ceil(duration * AUTOMATION_RATE) + 1);
    const gain: number[] = new Array(n);
    let audible = false;
    for (let i = 0; i < n; i++) {
      const local = hold + Math.min(duration, i / AUTOMATION_RATE);
      let g = clipGain(clip, Math.min(local, clip.duration));
      if (fadeInT > 0 && local < fadeInT) g *= local / fadeInT;
      if (local > clip.duration) g *= Math.max(0, 1 - (local - clip.duration) / Math.max(1e-6, tail));
      gain[i] = g;
      if (g > 1e-4) audible = true;
    }
    if (!audible) continue;

    let rate: number | number[] = clip.speed;
    if (clip.curve) {
      rate = new Array(n);
      for (let i = 0; i < n; i++) rate[i] = rateAt(clip, hold + i / AUTOMATION_RATE);
    }
    cues.push({ assetId: asset.id, when: clip.start + hold, offset: clip.inPoint, duration, rate, gain });
  }
  return cues;
}
