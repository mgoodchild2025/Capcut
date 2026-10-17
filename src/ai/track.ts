import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Asset } from '../model/types';
import { trackPoint, type FollowPoint, type TrackFrame } from './trackCore';

const WIDTH = 256;
const RATE = 10; // frames per second

/**
 * Follows the player tapped at (x, y) at source time `at` through `from`..`to` of a video.
 * On-device, no download: small colour frames and template matching, a second or two per play.
 */
export async function trackPlayer(asset: Asset, from: number, to: number, at: { t: number; x: number; y: number }, signal?: AbortSignal): Promise<FollowPoint[]> {
  const blob = await (await fetch(asset.url)).blob();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error(`Can't decode "${asset.name}" in this browser.`);
    const first = await track.getFirstTimestamp();
    const h = Math.max(16, Math.round((WIDTH * (asset.height || 9)) / (asset.width || 16)));
    const sink = new CanvasSink(track, { width: WIDTH, height: h, fit: 'fill', poolSize: 2 });
    const end = Math.min(to, asset.duration);
    const times: number[] = [];
    for (let t = Math.max(0, from); t <= end + 1e-6; t += 1 / RATE) times.push(t);
    const frames: TrackFrame[] = [];
    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(times.map((t) => first + t))) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const t = times[i++];
      if (!frame) continue;
      const ctx = (frame.canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      frames.push({ t, rgba: ctx.getImageData(0, 0, WIDTH, h).data });
    }
    return trackPoint(frames, WIDTH, h, at);
  } finally {
    input.dispose();
  }
}
