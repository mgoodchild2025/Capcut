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
} from 'mediabunny';
import type { Asset } from '../model/types';
import { decodeAudio, toAudioBuffer } from './audioDecode';

async function openVideo(asset: Asset) {
  const blob = await (await fetch(asset.url)).blob();
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) {
    input.dispose();
    throw new Error(`Can't decode "${asset.name}" in this browser.`);
  }
  return { blob, input, track, first: await track.getFirstTimestamp() };
}

/** Exact frame at `sourceTime` as a PNG, at the video's display size. */
export async function captureFrame(asset: Asset, sourceTime: number): Promise<Blob> {
  const { input, track, first } = await openVideo(asset);
  try {
    const sink = new CanvasSink(track);
    const t = Math.min(Math.max(0, sourceTime), asset.duration - 0.001);
    const frame = (await sink.getCanvas(first + t)) ?? (await sink.getCanvas(first));
    if (!frame) throw new Error('No frame at that time.');
    const c = frame.canvas;
    if (c instanceof HTMLCanvasElement) {
      return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'));
    }
    return await c.convertToBlob({ type: 'image/png' });
  } finally {
    input.dispose();
  }
}

const SEGMENT = 0.5;

/**
 * Re-encodes a section of a video backwards (picture and sound) so it can play in reverse
 * like any other clip. Works through the range in short segments from the end.
 */
export async function reverseVideo(
  asset: Asset,
  from: number,
  to: number,
  opts: { onProgress: (p: number) => void; signal: AbortSignal },
): Promise<Blob> {
  const { blob, input, track, first } = await openVideo(asset);
  try {
    const iw = await track.getDisplayWidth();
    const ih = await track.getDisplayHeight();
    const k = Math.min(1, 1920 / Math.max(iw, ih));
    const width = Math.round((iw * k) / 2) * 2;
    const height = Math.round((ih * k) / 2) * 2;
    const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
    const bitrate = Math.round(width * height * 30 * 0.15);
    const codec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width, height, bitrate });
    if (!codec) throw new Error('This browser has no suitable video encoder.');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const output = new Output({ format, target: new BufferTarget() });
    const video = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 1 });
    output.addVideoTrack(video);

    // Sound: decode, cut the range and flip it.
    let audio: AudioBuffer | null = null;
    try {
      const part = await decodeAudio(blob, { start: from, end: to, signal: opts.signal });
      if (part) {
        for (const ch of part.channels) ch.reverse();
        audio = toAudioBuffer(part);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      audio = null;
    }
    let audioSource: AudioBufferSource | null = null;
    if (audio) {
      const ac = await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), {
        numberOfChannels: audio.numberOfChannels,
        sampleRate: audio.sampleRate,
        bitrate: 192_000,
      });
      if (ac) {
        audioSource = new AudioBufferSource({ codec: ac, bitrate: 192_000 });
        output.addAudioTrack(audioSource);
      }
    }
    await output.start();
    if (audio && audioSource) {
      await audioSource.add(audio);
      audioSource.close();
    }

    const sink = new CanvasSink(track, { width, height, fit: 'fill' });
    let outT = 0;
    let segEnd = to;
    const total = to - from;
    while (segEnd > from + 1e-3) {
      if (opts.signal.aborted) {
        await output.cancel();
        throw new DOMException('Cancelled', 'AbortError');
      }
      const segStart = Math.max(from, segEnd - SEGMENT);
      const frames: { canvas: HTMLCanvasElement | OffscreenCanvas; duration: number }[] = [];
      for await (const f of sink.canvases(first + segStart, first + segEnd)) frames.push({ canvas: f.canvas, duration: f.duration });
      for (let i = frames.length - 1; i >= 0; i--) {
        const d = frames[i].duration > 0 ? frames[i].duration : 1 / 30;
        ctx.drawImage(frames[i].canvas, 0, 0, width, height);
        await video.add(outT, d);
        outT += d;
      }
      segEnd = segStart;
      opts.onProgress(Math.min(1, (to - segEnd) / total));
    }
    video.close();
    await output.finalize();
    return new Blob([output.target.buffer!], { type: 'video/mp4' });
  } finally {
    input.dispose();
  }
}
