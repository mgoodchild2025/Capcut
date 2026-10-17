import { projectDuration } from '../model/ops';
import type { Asset, Project } from '../model/types';
import { AUTOMATION_RATE, planAudio } from './exportPlan';

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
    const curveDur = (cue.gain.length - 1) / AUTOMATION_RATE;
    if (typeof cue.rate === 'number') src.playbackRate.value = cue.rate;
    else src.playbackRate.setValueCurveAtTime(Float32Array.from(cue.rate), cue.when, curveDur);
    const gain = ctx.createGain();
    gain.gain.setValueCurveAtTime(Float32Array.from(cue.gain), cue.when, curveDur);
    src.connect(gain).connect(ctx.destination);
    src.start(cue.when, cue.offset);
    src.stop(cue.when + cue.duration);
    scheduled++;
  }
  if (!scheduled) return null;
  return ctx.startRendering();
}
