import { projectDuration } from '../model/ops';
import type { Asset, Project } from '../model/types';
import { planAudio } from './exportPlan';

/** Renders the whole audio mix offline, much faster than real time. Returns null when nothing is audible. */
export async function mixAudio(
  project: Project,
  assets: Record<string, Asset>,
  { sampleRate, channels, signal }: { sampleRate: number; channels: number; signal?: AbortSignal },
): Promise<AudioBuffer | null> {
  const cues = planAudio(project, assets);
  if (!cues.length) return null;
  const duration = projectDuration(project);
  const ctx = new OfflineAudioContext(channels, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
  const decoded = new Map<string, AudioBuffer | null>();
  let scheduled = 0;
  for (const cue of cues) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!decoded.has(cue.assetId)) {
      try {
        const data = await (await fetch(assets[cue.assetId].url)).arrayBuffer();
        decoded.set(cue.assetId, await ctx.decodeAudioData(data));
      } catch {
        decoded.set(cue.assetId, null); // no audio track, or a codec the browser can't decode
      }
    }
    const buffer = decoded.get(cue.assetId);
    if (!buffer || cue.offset >= buffer.duration) continue;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = cue.rate;
    const gain = ctx.createGain();
    const g = gain.gain;
    const end = cue.when + cue.duration;
    g.setValueAtTime(cue.fadeIn > 0 ? 0 : cue.volume, cue.when);
    if (cue.fadeIn > 0) g.linearRampToValueAtTime(cue.volume, cue.when + cue.fadeIn);
    if (cue.fadeOut > 0) {
      g.setValueAtTime(cue.volume, Math.max(cue.when + cue.fadeIn, end - cue.fadeOut));
      g.linearRampToValueAtTime(0, end);
    }
    src.connect(gain).connect(ctx.destination);
    src.start(cue.when, cue.offset, Math.min(cue.sourceDuration, buffer.duration - cue.offset));
    scheduled++;
  }
  if (!scheduled) return null;
  return ctx.startRendering();
}
