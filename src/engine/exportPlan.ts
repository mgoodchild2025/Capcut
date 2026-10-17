import { activeLayers, projectDuration, type Layer } from '../model/ops';
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

export interface AudioCue {
  assetId: string;
  /** Timeline second at which the cue starts. */
  when: number;
  /** Seconds into the source. */
  offset: number;
  /** Seconds of source to play. */
  sourceDuration: number;
  /** Timeline length in seconds. */
  duration: number;
  rate: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

/** Everything audible in the project, ready to schedule on an OfflineAudioContext. */
export function planAudio(project: Project, assets: Record<string, Asset>): AudioCue[] {
  const cues: AudioCue[] = [];
  for (const clip of project.clips) {
    if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
    const track = project.tracks.find((t) => t.id === clip.trackId);
    const asset = clip.assetId ? assets[clip.assetId] : undefined;
    if (!track || track.muted || !asset || clip.volume <= 0) continue;
    if (asset.waveform && !asset.hasAudio) continue;
    const sourceDuration = Math.min(clip.duration * clip.speed, Math.max(0, asset.duration - clip.inPoint));
    if (sourceDuration <= 0) continue;
    cues.push({
      assetId: asset.id,
      when: clip.start,
      offset: clip.inPoint,
      sourceDuration,
      duration: clip.duration,
      rate: clip.speed,
      volume: clip.volume,
      fadeIn: Math.min(clip.audioFadeIn, clip.duration),
      fadeOut: Math.min(clip.audioFadeOut, clip.duration),
    });
  }
  return cues;
}
