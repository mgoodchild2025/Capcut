import { projectDuration } from '../model/ops';
import type { Asset, Project } from '../model/types';
import { decodeAudio, toAudioBuffer } from './audioDecode';
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
  // Decode only the part of each source the cues use: game footage can be far longer than the edit.
  const ranges = new Map<string, [number, number]>();
  for (const cue of cues) {
    const maxRate = typeof cue.rate === 'number' ? cue.rate : Math.max(...cue.rate);
    const lo = cue.offset;
    const hi = cue.offset + cue.duration * maxRate + 0.25;
    const r = ranges.get(cue.assetId);
    ranges.set(cue.assetId, r ? [Math.min(r[0], lo), Math.max(r[1], hi)] : [lo, hi]);
  }
  const decoded = new Map<string, { buffer: AudioBuffer; start: number } | null>();
  let scheduled = 0;
  for (const cue of cues) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!decoded.has(cue.assetId)) {
      const [start, end] = ranges.get(cue.assetId)!;
      const blob = await (await fetch(assets[cue.assetId].url)).blob();
      const audio = await decodeAudio(blob, { start, end, signal });
      decoded.set(cue.assetId, audio ? { buffer: toAudioBuffer(audio), start: audio.start } : null);
    }
    const source = decoded.get(cue.assetId);
    if (!source) continue;
    const { buffer } = source;
    const offset = cue.offset - source.start;
    if (offset < 0 || offset >= buffer.duration) continue;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const curveDur = (cue.gain.length - 1) / AUTOMATION_RATE;
    if (typeof cue.rate === 'number') src.playbackRate.value = cue.rate;
    else src.playbackRate.setValueCurveAtTime(Float32Array.from(cue.rate), cue.when, curveDur);
    const gain = ctx.createGain();
    gain.gain.setValueCurveAtTime(Float32Array.from(cue.gain), cue.when, curveDur);
    src.connect(gain).connect(ctx.destination);
    src.start(cue.when, offset);
    src.stop(cue.when + cue.duration);
    scheduled++;
  }
  if (!scheduled) return null;
  return ctx.startRendering();
}
