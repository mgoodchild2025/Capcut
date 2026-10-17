import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  type WrappedCanvas,
} from 'mediabunny';
import { projectDuration } from '../model/ops';
import type { Asset, Clip, Project } from '../model/types';
import { fastExportAvailable, frameCount, planVideoFrames, videoLayers } from './exportPlan';
import { mixAudio } from './mix';
import { renderFrame, type Source } from './render';

export interface FastExportOptions {
  /** Output size of the shorter side, e.g. 1080. */
  shortSide: number;
  fps: number;
  bitrate: number;
  onProgress: (p: number) => void;
  signal: AbortSignal;
}

/** Thrown when this browser or this project's media can't take the fast path; callers fall back to real-time export. */
export class FastExportUnsupported extends Error {
  name = 'FastExportUnsupported';
}

const SAMPLE_RATE = 48000;

/** Yields to the event loop without timer throttling, so export keeps pace in a background tab. */
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

async function blobOf(asset: Asset): Promise<Blob> {
  return (await fetch(asset.url)).blob();
}

/**
 * Decodes each video clip's frames in order. One `CanvasSink` iterator per clip, fed the exact
 * timestamps the plan says that clip needs, so every pull returns the frame for the current output frame.
 */
class FrameFeed {
  private iterators = new Map<string, AsyncGenerator<WrappedCanvas | null, void, unknown>>();
  private last = new Map<string, Source>();
  private inputs: Input[] = [];

  static async create(
    project: Project,
    assets: Record<string, Asset>,
    fps: number,
    outW: number,
    outH: number,
  ): Promise<FrameFeed> {
    const feed = new FrameFeed();
    const plan = planVideoFrames(project, fps);
    const byAsset = new Map<string, { input: Input; track: Awaited<ReturnType<Input['getPrimaryVideoTrack']>>; offset: number }>();
    for (const [clipId, times] of plan) {
      const clip = project.clips.find((c) => c.id === clipId)!;
      const asset = assets[clip.assetId!];
      if (!asset) continue;
      let entry = byAsset.get(asset.id);
      if (!entry) {
        const input = new Input({ source: new BlobSource(await blobOf(asset)), formats: ALL_FORMATS });
        feed.inputs.push(input);
        let track = null;
        try {
          track = await input.getPrimaryVideoTrack();
        } catch {
          track = null;
        }
        if (!track || !(await track.canDecode())) {
          throw new FastExportUnsupported(`Can't decode "${asset.name}" for fast export.`);
        }
        entry = { input, track, offset: await track.getFirstTimestamp() };
        byAsset.set(asset.id, entry);
      }
      const end = asset.duration - 0.001;
      const track = entry.track!;
      // Decode no larger than the clip can appear in the output; 4K sources exported at 1080p
      // otherwise spend most of their time copying pixels that get thrown away.
      const iw = await track.getDisplayWidth();
      const ih = await track.getDisplayHeight();
      const boxW = outW * Math.max(1, clip.transform.scale);
      const boxH = outH * Math.max(1, clip.transform.scale);
      const fit = clip.fit === 'cover' ? Math.max(boxW / iw, boxH / ih) : Math.min(boxW / iw, boxH / ih);
      const k = Math.min(1, fit);
      // Two canvases suffice: each frame is converted when handed out, and only the latest is held.
      const sink = new CanvasSink(track, {
        width: Math.max(2, Math.round(iw * k)),
        height: Math.max(2, Math.round(ih * k)),
        fit: 'fill',
        poolSize: 2,
      });
      const offset = entry.offset;
      feed.iterators.set(clipId, sink.canvasesAtTimestamps(times.map((t) => offset + Math.min(t, end))));
    }
    return feed;
  }

  /** Advances every video clip visible in this frame by one decoded frame. */
  async advance(project: Project, t: number): Promise<void> {
    for (const layer of videoLayers(project, t)) {
      const it = this.iterators.get(layer.clip.id);
      if (!it) continue;
      const res = await it.next();
      if (!res.done && res.value) this.last.set(layer.clip.id, res.value.canvas);
    }
  }

  frameFor(clip: Clip): Source | null {
    return this.last.get(clip.id) ?? null;
  }

  async dispose() {
    for (const it of this.iterators.values()) await it.return(undefined).catch(() => {});
    for (const input of this.inputs) input.dispose();
  }
}

async function loadImages(project: Project, assets: Record<string, Asset>): Promise<Map<string, HTMLImageElement>> {
  const images = new Map<string, HTMLImageElement>();
  for (const clip of project.clips) {
    if (clip.kind !== 'image' || !clip.assetId || images.has(clip.assetId)) continue;
    const asset = assets[clip.assetId];
    if (!asset) continue;
    const img = new Image();
    img.src = asset.url;
    await img.decode();
    images.set(asset.id, img);
  }
  return images;
}

/**
 * Frame-accurate export: decodes sources with WebCodecs, composites each frame with the same
 * renderer as the preview, and encodes straight to MP4. Runs as fast as the machine allows.
 */
export async function exportFast(
  project: Project,
  assets: Record<string, Asset>,
  opts: FastExportOptions,
): Promise<{ blob: Blob; mime: string }> {
  if (!fastExportAvailable()) throw new FastExportUnsupported('WebCodecs is not available in this browser.');
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('The timeline is empty.');

  const { width: W, height: H } = project.settings;
  const s = opts.shortSide / Math.min(W, H);
  const width = Math.round((W * s) / 2) * 2;
  const height = Math.round((H * s) / 2) * 2;

  const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
  const videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), {
    width,
    height,
    bitrate: opts.bitrate,
  });
  if (!videoCodec) throw new FastExportUnsupported('No supported video encoder for this resolution.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Text must render in its final font from the first frame.
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 3000))]);
  let feed: FrameFeed | null = null;
  let output: Output | null = null;
  try {
    // Decoders are set up first so an undecodable clip falls back before any work is done.
    feed = await FrameFeed.create(project, assets, opts.fps, width, height);
    const images = await loadImages(project, assets);
    checkAbort(opts.signal);

    const audio = await mixAudio(project, assets, { sampleRate: SAMPLE_RATE, channels: 2, signal: opts.signal });
    const audioCodec = audio
      ? await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), {
          numberOfChannels: 2,
          sampleRate: SAMPLE_RATE,
          bitrate: 192_000,
        })
      : null;

    output = new Output({ format, target: new BufferTarget() });
    const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate: opts.bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(videoSource, { frameRate: opts.fps });
    let audioSource: AudioBufferSource | null = null;
    if (audio && audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 });
      output.addAudioTrack(audioSource);
    }
    await output.start();
    if (audio && audioSource) {
      await audioSource.add(audio);
      audioSource.close();
    }

    const frames = frameCount(project, opts.fps);
    const getSource = (clip: Clip): Source | null => {
      if (clip.kind === 'image') return (clip.assetId && images.get(clip.assetId)) || null;
      if (clip.kind === 'video') return feed!.frameFor(clip);
      return null;
    };
    let lastYield = performance.now();
    for (let i = 0; i < frames; i++) {
      checkAbort(opts.signal);
      const t = i / opts.fps;
      await feed.advance(project, t);
      renderFrame(ctx, project, t, { getSource });
      await videoSource.add(t, 1 / opts.fps);
      if (performance.now() - lastYield > 32) {
        opts.onProgress((i + 1) / frames);
        await yieldToLoop();
        lastYield = performance.now();
      }
    }
    videoSource.close();
    await output.finalize();
    opts.onProgress(1);
    const buffer = (output.target as BufferTarget).buffer!;
    return { blob: new Blob([buffer], { type: 'video/mp4' }), mime: 'video/mp4' };
  } catch (err) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    throw err;
  } finally {
    await feed?.dispose();
  }
}
