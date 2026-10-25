import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { decodeAudio } from '../engine/audioDecode';
import type { Asset, MatchData } from '../model/types';
import { uid } from '../utils';
import { audioFeatures, findHighlights, findRallies, frameDiff, type Features, type Highlight } from './highlightCore';

export interface FoundHighlight extends Highlight {
  assetId: string;
  thumb?: string;
}

const MOTION_HOP = 0.2;
const MOTION_W = 64;
const MOTION_H = 36;

async function audioPart(asset: Asset, signal: AbortSignal): Promise<Pick<Features, 'audioHop' | 'loudness' | 'whistle'>> {
  const blob = await (await fetch(asset.url)).blob();
  try {
    const audio = await decodeAudio(blob, { sampleRate: 16000, mono: true, signal });
    if (!audio) throw new Error('no audio');
    return audioFeatures(audio.channels[0], audio.sampleRate);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    // Silent footage: motion alone still finds the action.
    const frames = Math.ceil(asset.duration / 0.05);
    return { audioHop: 0.05, loudness: new Float32Array(frames).fill(-90), whistle: new Float32Array(frames) };
  }
}

/** Audio and motion features of a whole video. Progress runs 0..1 (`span` of the caller's bar). */
async function footageFeatures(asset: Asset, signal: AbortSignal, onProgress: (p: number) => void, hop: number): Promise<{ features: Features; input: Input; track: Awaited<ReturnType<Input['getPrimaryVideoTrack']>> & object; first: number }> {
  onProgress(0.02);
  const audio = await audioPart(asset, signal);
  onProgress(0.15);
  const blob = await (await fetch(asset.url)).blob();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error(`Can't decode "${asset.name}" in this browser.`);
    const first = await track.getFirstTimestamp();
    const sink = new CanvasSink(track, { width: MOTION_W, height: MOTION_H, fit: 'fill', poolSize: 2 });
    const times: number[] = [];
    for (let t = 0; t < asset.duration; t += hop) times.push(first + t);
    const motion = new Float32Array(times.length);
    let prev: Uint8ClampedArray | null = null;
    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (frame) {
        const ctx = (frame.canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        const rgba = ctx.getImageData(0, 0, MOTION_W, MOTION_H).data;
        const grey = new Uint8ClampedArray(MOTION_W * MOTION_H);
        for (let p = 0; p < grey.length; p++) grey[p] = (rgba[p * 4] * 3 + rgba[p * 4 + 1] * 6 + rgba[p * 4 + 2]) / 10;
        motion[i] = prev ? frameDiff(prev, grey) : 0;
        prev = grey;
      }
      i++;
      if (i % 25 === 0) onProgress(0.15 + 0.75 * (i / times.length));
    }
    return { features: { ...audio, motionHop: hop, motion, duration: asset.duration }, input, track, first };
  } catch (e) {
    input.dispose();
    throw e;
  }
}

/** Small frames at the given source times, as JPEG data URLs. */
async function thumbsAt(track: NonNullable<Awaited<ReturnType<Input['getPrimaryVideoTrack']>>>, first: number, duration: number, times: number[], w = 192, h = 108): Promise<(string | undefined)[]> {
  const sink = new CanvasSink(track, { width: w, height: h, fit: 'cover' });
  const out: (string | undefined)[] = [];
  for (const t of times) {
    const frame = await sink.getCanvas(first + Math.min(t, duration - 0.05));
    out.push(frame ? (frame.canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.65) : undefined);
  }
  return out;
}

/**
 * Scans game footage for its best moments. Audio is analysed in one pass; motion is measured on
 * tiny frames five times a second. Progress runs 0..1.
 */
export async function analyzeFootage(
  asset: Asset,
  opts: { onProgress: (p: number) => void; signal: AbortSignal; limit?: number },
): Promise<FoundHighlight[]> {
  const { features, input, track, first } = await footageFeatures(asset, opts.signal, opts.onProgress, MOTION_HOP);
  try {
    const highlights = findHighlights(features, { limit: opts.limit ?? 12 });
    const thumbs = await thumbsAt(track, first, asset.duration, highlights.map((h) => h.peak));
    opts.onProgress(1);
    return highlights.map((h, i) => ({ ...h, assetId: asset.id, thumb: thumbs[i] }));
  } finally {
    input.dispose();
  }
}

/**
 * Splits a whole game into its rallies, each with a small frame at its peak. Long games are
 * sampled a little less often (play lasts seconds, so nothing is missed). Progress runs 0..1.
 */
export async function analyzeMatch(asset: Asset, opts: { onProgress: (p: number) => void; signal: AbortSignal }): Promise<MatchData> {
  const hop = asset.duration > 15 * 60 ? 0.4 : MOTION_HOP;
  const { features, input, track, first } = await footageFeatures(asset, opts.signal, (p) => opts.onProgress(p * 0.92), hop);
  try {
    const rallies = findRallies(features);
    const thumbs = await thumbsAt(track, first, asset.duration, rallies.map((r) => r.peak), 160, 90);
    opts.onProgress(1);
    return { assetId: asset.id, analyzedAt: Date.now(), rallies: rallies.map((r, i) => ({ ...r, id: uid('r_'), thumb: thumbs[i] })) };
  } finally {
    input.dispose();
  }
}
