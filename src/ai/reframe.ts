import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Asset } from '../model/types';
import { actionPath, columnMotion, type MotionSample, type PathPoint } from './reframeCore';

const COLS = 96;
const RATE = 8; // samples per second

/**
 * Finds where the action is across `from`..`to` (source seconds) of a video, by watching where
 * the picture changes on tiny greyscale frames. On-device, no download, a few seconds per clip.
 */
export async function trackAction(asset: Asset, from: number, to: number, signal?: AbortSignal): Promise<PathPoint[]> {
  const blob = await (await fetch(asset.url)).blob();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error(`Can't decode "${asset.name}" in this browser.`);
    const first = await track.getFirstTimestamp();
    const rows = Math.max(8, Math.round((COLS * (asset.height || 9)) / (asset.width || 16)));
    const sink = new CanvasSink(track, { width: COLS, height: rows, fit: 'fill', poolSize: 2 });
    const end = Math.min(to, asset.duration);
    const times: number[] = [];
    for (let t = Math.max(0, from); t <= end + 1e-6; t += 1 / RATE) times.push(t);
    const samples: MotionSample[] = [];
    let prev: Uint8ClampedArray | null = null;
    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(times.map((t) => first + t))) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const t = times[i++];
      if (!frame) continue;
      const ctx = (frame.canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      const rgba = ctx.getImageData(0, 0, COLS, rows).data;
      const grey = new Uint8ClampedArray(COLS * rows);
      for (let p = 0; p < grey.length; p++) grey[p] = (rgba[p * 4] * 3 + rgba[p * 4 + 1] * 6 + rgba[p * 4 + 2]) / 10;
      if (prev) samples.push({ t, cols: columnMotion(prev, grey, COLS) });
      prev = grey;
    }
    return actionPath(samples);
  } finally {
    input.dispose();
  }
}

/** True when cutting a W x H frame from this footage needs panning (it's noticeably wider). */
export const needsReframe = (a: Pick<Asset, 'kind' | 'width' | 'height'>, W: number, H: number) =>
  a.kind === 'video' && !!a.width && !!a.height && a.width / a.height > (W / H) * 1.1;
