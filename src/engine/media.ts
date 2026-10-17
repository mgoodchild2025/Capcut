import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Asset, AssetKind } from '../model/types';
import { decodeAudio } from './audioDecode';
import { uid } from '../utils';

/** Waveform peaks per second of source audio. */
export const WAVEFORM_RATE = 40;
const FILMSTRIP_HEIGHT = 56;
const MAX_FILMSTRIP_FRAMES = 48;

export function kindOf(file: File): AssetKind | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'mov', 'webm', 'mkv', 'm4v', 'ogv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
  return null;
}

function once<T extends Event>(target: EventTarget, ok: string, fail = 'error', timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(new Error(`Timed out waiting for ${ok}`)), timeoutMs);
    const onOk = (e: Event) => cleanup(null, e as T);
    const onFail = () => cleanup(new Error(`Failed while waiting for ${ok}`));
    function cleanup(err: Error | null, e?: T) {
      clearTimeout(timer);
      target.removeEventListener(ok, onOk);
      target.removeEventListener(fail, onFail);
      if (err) reject(err);
      else resolve(e!);
    }
    target.addEventListener(ok, onOk);
    target.addEventListener(fail, onFail);
  });
}

function drawThumb(src: CanvasImageSource, w: number, h: number, height: number, quality = 0.72): string {
  const scale = height / h;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = height;
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

/**
 * Opens a video far enough to know its size and length. Waits for metadata only: iOS Safari doesn't
 * load frames until playback starts, so waiting for `loadeddata` there would never finish.
 * Resolves to null when this browser can't play the file (an unsupported codec such as HEVC).
 */
async function openVideo(url: string, timeoutMs = 15000): Promise<HTMLVideoElement | null> {
  const v = document.createElement('video');
  v.preload = 'auto';
  v.muted = true;
  v.playsInline = true;
  v.src = url;
  try {
    await once(v, 'loadedmetadata', 'error', timeoutMs);
  } catch {
    release(v);
    return null;
  }
  // Some browsers play the sound of a video whose picture they can't decode and report 0x0.
  if (!v.videoWidth || !v.videoHeight || v.error) {
    release(v);
    return null;
  }
  return v;
}

function release(v: HTMLVideoElement) {
  v.removeAttribute('src');
  v.load();
}

/** Get a frame onto the element. Mobile browsers show nothing until the video has played once. */
async function primeFrames(v: HTMLVideoElement) {
  if (v.readyState >= 2) return;
  const ready = once(v, 'loadeddata', 'error', 4000).catch(() => null);
  await v.play().catch(() => null);
  v.pause();
  await ready;
}

async function seekTo(v: HTMLVideoElement, t: number) {
  if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return;
  const p = once(v, 'seeked', 'error', 5000);
  v.currentTime = t;
  await p;
}

async function readDuration(v: HTMLVideoElement): Promise<number> {
  if (isFinite(v.duration)) return v.duration;
  // Some WebM files report Infinity until you seek far past the end.
  v.currentTime = 1e7;
  await once(v, 'durationchange', 'error', 5000).catch(() => null);
  return isFinite(v.duration) ? v.duration : 0;
}

type Decodable = { input: Input; sink: CanvasSink; first: number };

/** A frame reader that decodes with WebCodecs, or null when the browser can't decode this file that way. */
async function openDecoder(blob: Blob, height: number): Promise<Decodable | null> {
  if (typeof VideoDecoder === 'undefined') return null;
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error('not decodable');
    const w = await track.getDisplayWidth();
    const h = await track.getDisplayHeight();
    const sink = new CanvasSink(track, { height, width: Math.max(1, Math.round((w / h) * height)), fit: 'fill' });
    return { input, sink, first: await track.getFirstTimestamp() };
  } catch {
    input.dispose();
    return null;
  }
}

const canvasToJpeg = (c: HTMLCanvasElement | OffscreenCanvas, quality: number) => {
  if (c instanceof HTMLCanvasElement) return c.toDataURL('image/jpeg', quality);
  const out = document.createElement('canvas');
  out.width = c.width;
  out.height = c.height;
  out.getContext('2d')!.drawImage(c, 0, 0);
  return out.toDataURL('image/jpeg', quality);
};

async function decodedThumb(blob: Blob, t: number, height: number): Promise<string | undefined> {
  const d = await openDecoder(blob, height);
  if (!d) return undefined;
  try {
    const frame = (await d.sink.getCanvas(d.first + t)) ?? (await d.sink.getCanvas(d.first));
    return frame ? canvasToJpeg(frame.canvas, 0.72) : undefined;
  } catch {
    return undefined;
  } finally {
    d.input.dispose();
  }
}

/** Thrown when the browser can't play a video and no converter was offered. */
export class UnplayableVideoError extends Error {
  constructor(name: string) {
    super(`${name} uses a format this browser can't play.`);
    this.name = 'UnplayableVideoError';
  }
}

export type ImportOptions = {
  /** Called when the browser can't play a video; returns a playable copy. */
  convert?: (file: Blob, name: string) => Promise<Blob>;
};

export type Imported = { asset: Asset; blob: Blob };

/** Read basic metadata and a poster frame. Slower extras (filmstrip, waveform) come from `enrichAsset`. */
export async function importFile(file: Blob & { name?: string }, id = uid('a_'), opts: ImportOptions = {}): Promise<Imported> {
  const name = file.name ?? 'media';
  const kind = kindOf(file as File);
  if (!kind) throw new Error(`Unsupported file type: ${name}`);
  let blob: Blob = file;
  let url = URL.createObjectURL(file);
  const base = { id, name, kind, size: file.size, hasAudio: kind !== 'image' };

  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      blob,
      asset: {
        ...base,
        url,
        duration: Infinity,
        width: img.naturalWidth,
        height: img.naturalHeight,
        thumbnail: drawThumb(img, img.naturalWidth, img.naturalHeight, 160),
      },
    };
  }

  if (kind === 'audio') {
    const a = new Audio();
    a.preload = 'metadata';
    a.src = url;
    await once(a, 'loadedmetadata');
    return { blob, asset: { ...base, url, duration: a.duration, width: 0, height: 0 } };
  }

  let v = await openVideo(url);
  if (!v) {
    URL.revokeObjectURL(url);
    if (!opts.convert) throw new UnplayableVideoError(name);
    blob = await opts.convert(file, name);
    url = URL.createObjectURL(blob);
    v = await openVideo(url);
    if (!v) {
      URL.revokeObjectURL(url);
      throw new UnplayableVideoError(name);
    }
  }
  try {
    const duration = await readDuration(v);
    const width = v.videoWidth;
    const height = v.videoHeight;
    const at = Math.min(duration * 0.1, 1);
    let thumbnail = await decodedThumb(blob, at, 160);
    if (!thumbnail) {
      try {
        await primeFrames(v);
        await seekTo(v, at);
        thumbnail = drawThumb(v, width, height, 160);
      } catch {
        // A missing poster frame is cosmetic; the clip itself is fine.
      }
    }
    return { blob, asset: { ...base, url, size: blob.size, duration, width, height, thumbnail } };
  } finally {
    release(v);
  }
}

export async function buildFilmstrip(asset: Asset): Promise<string[]> {
  if (asset.kind === 'image') return asset.thumbnail ? [asset.thumbnail] : [];
  if (asset.kind !== 'video') return [];
  const count = Math.max(1, Math.min(MAX_FILMSTRIP_FRAMES, Math.ceil(asset.duration)));
  const times = Array.from({ length: count }, (_, i) => Math.max(0, Math.min(asset.duration - 0.05, ((i + 0.5) / count) * asset.duration)));

  const blob = await (await fetch(asset.url)).blob();
  const d = await openDecoder(blob, FILMSTRIP_HEIGHT);
  if (d) {
    try {
      const frames: string[] = [];
      for await (const frame of d.sink.canvasesAtTimestamps(times.map((t) => d.first + t))) {
        if (frame) frames.push(canvasToJpeg(frame.canvas, 0.6));
      }
      if (frames.length) return frames;
    } catch (e) {
      console.warn('Decoder filmstrip failed, using the video element', e);
    } finally {
      d.input.dispose();
    }
  }

  const v = await openVideo(asset.url);
  if (!v) return [];
  try {
    await primeFrames(v);
    const frames: string[] = [];
    for (const t of times) {
      await seekTo(v, t);
      frames.push(drawThumb(v, v.videoWidth, v.videoHeight, FILMSTRIP_HEIGHT, 0.6));
    }
    return frames;
  } finally {
    release(v);
  }
}

/** Decode the audio track and reduce it to peaks. Returns null when there is no audio. */
export async function buildWaveform(blob: Blob): Promise<number[] | null> {
  const audio = await decodeAudio(blob, { sampleRate: 8000, mono: true, maxFallbackBytes: 300 * 1024 * 1024 }).catch(() => null);
  if (!audio) return null;
  const data = audio.channels[0];
  const bucket = Math.max(1, Math.floor(audio.sampleRate / WAVEFORM_RATE));
  const peaks: number[] = [];
  let max = 0;
  for (let i = 0; i < data.length; i += bucket) {
    let peak = 0;
    const end = Math.min(data.length, i + bucket);
    for (let j = i; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  if (max < 1e-4) return [];
  return peaks.map((p) => Math.round((p / max) * 100) / 100);
}
