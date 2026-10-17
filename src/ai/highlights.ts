import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Asset } from '../model/types';
import { audioFeatures, findHighlights, frameDiff, type Features, type Highlight } from './highlightCore';

export interface FoundHighlight extends Highlight {
  assetId: string;
  thumb?: string;
}

const MOTION_HOP = 0.2;
const MOTION_W = 64;
const MOTION_H = 36;

async function audioPart(asset: Asset, signal: AbortSignal): Promise<Pick<Features, 'audioHop' | 'loudness' | 'whistle'>> {
  const data = await (await fetch(asset.url)).arrayBuffer();
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  try {
    const ctx = new OfflineAudioContext(1, 1, 16000);
    const buf = await ctx.decodeAudioData(data);
    const mono = buf.getChannelData(0);
    if (buf.numberOfChannels > 1) {
      const r = buf.getChannelData(1);
      for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] + r[i]) / 2;
    }
    return audioFeatures(mono, buf.sampleRate);
  } catch {
    // Silent footage: motion alone still finds the action.
    const frames = Math.ceil(asset.duration / 0.05);
    return { audioHop: 0.05, loudness: new Float32Array(frames).fill(-90), whistle: new Float32Array(frames) };
  }
}

/**
 * Scans game footage for its best moments. Audio is analysed in one pass; motion is measured on
 * tiny frames five times a second. Progress runs 0..1.
 */
export async function analyzeFootage(
  asset: Asset,
  opts: { onProgress: (p: number) => void; signal: AbortSignal; limit?: number },
): Promise<FoundHighlight[]> {
  opts.onProgress(0.02);
  const audio = await audioPart(asset, opts.signal);
  opts.onProgress(0.15);

  const blob = await (await fetch(asset.url)).blob();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error(`Can't decode "${asset.name}" in this browser.`);
    const first = await track.getFirstTimestamp();
    const sink = new CanvasSink(track, { width: MOTION_W, height: MOTION_H, fit: 'fill', poolSize: 2 });
    const times: number[] = [];
    for (let t = 0; t < asset.duration; t += MOTION_HOP) times.push(first + t);
    const motion = new Float32Array(times.length);
    let prev: Uint8ClampedArray | null = null;
    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (opts.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (frame) {
        const ctx = (frame.canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        const rgba = ctx.getImageData(0, 0, MOTION_W, MOTION_H).data;
        const grey = new Uint8ClampedArray(MOTION_W * MOTION_H);
        for (let p = 0; p < grey.length; p++) grey[p] = (rgba[p * 4] * 3 + rgba[p * 4 + 1] * 6 + rgba[p * 4 + 2]) / 10;
        motion[i] = prev ? frameDiff(prev, grey) : 0;
        prev = grey;
      }
      i++;
      if (i % 25 === 0) opts.onProgress(0.15 + 0.75 * (i / times.length));
    }

    const highlights = findHighlights(
      { ...audio, motionHop: MOTION_HOP, motion, duration: asset.duration },
      { limit: opts.limit ?? 12 },
    );

    // Thumbnails at each peak.
    const thumbSink = new CanvasSink(track, { width: 192, height: 108, fit: 'cover' });
    const found: FoundHighlight[] = [];
    for (const h of highlights) {
      const frame = await thumbSink.getCanvas(first + Math.min(h.peak, asset.duration - 0.05));
      const thumb = frame ? (frame.canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.7) : undefined;
      found.push({ ...h, assetId: asset.id, thumb });
    }
    opts.onProgress(1);
    return found;
  } finally {
    input.dispose();
  }
}
