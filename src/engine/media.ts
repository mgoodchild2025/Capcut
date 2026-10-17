import type { Asset, AssetKind } from '../model/types';
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

async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.preload = 'auto';
  v.muted = true;
  v.playsInline = true;
  v.src = url;
  await once(v, 'loadeddata');
  return v;
}

async function seekTo(v: HTMLVideoElement, t: number) {
  if (Math.abs(v.currentTime - t) < 0.001) return;
  const p = once(v, 'seeked', 'error', 5000);
  v.currentTime = t;
  await p;
}

/** Read basic metadata and a poster frame. Slower extras (filmstrip, waveform) come from `enrichAsset`. */
export async function importFile(file: Blob & { name?: string }, id = uid('a_')): Promise<Asset> {
  const name = file.name ?? 'media';
  const kind = kindOf(file as File);
  if (!kind) throw new Error(`Unsupported file type: ${name}`);
  const url = URL.createObjectURL(file);
  const base = { id, name, kind, url, size: file.size, hasAudio: kind !== 'image' };

  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      ...base,
      duration: Infinity,
      width: img.naturalWidth,
      height: img.naturalHeight,
      thumbnail: drawThumb(img, img.naturalWidth, img.naturalHeight, 160),
    };
  }

  if (kind === 'audio') {
    const a = new Audio();
    a.preload = 'metadata';
    a.src = url;
    await once(a, 'loadedmetadata');
    return { ...base, duration: a.duration, width: 0, height: 0 };
  }

  const v = await loadVideo(url);
  let duration = v.duration;
  if (!isFinite(duration)) {
    // Some WebM files report Infinity until you seek far past the end.
    v.currentTime = 1e7;
    await once(v, 'durationchange', 'error', 5000).catch(() => null);
    duration = isFinite(v.duration) ? v.duration : 0;
  }
  await seekTo(v, Math.min(duration * 0.1, 1));
  const asset: Asset = {
    ...base,
    duration,
    width: v.videoWidth,
    height: v.videoHeight,
    thumbnail: drawThumb(v, v.videoWidth, v.videoHeight, 160),
  };
  v.removeAttribute('src');
  v.load();
  return asset;
}

export async function buildFilmstrip(asset: Asset): Promise<string[]> {
  if (asset.kind === 'image') return asset.thumbnail ? [asset.thumbnail] : [];
  if (asset.kind !== 'video') return [];
  const v = await loadVideo(asset.url);
  const count = Math.max(1, Math.min(MAX_FILMSTRIP_FRAMES, Math.ceil(asset.duration)));
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = Math.min(asset.duration - 0.05, ((i + 0.5) / count) * asset.duration);
    await seekTo(v, Math.max(0, t));
    frames.push(drawThumb(v, v.videoWidth, v.videoHeight, FILMSTRIP_HEIGHT, 0.6));
  }
  v.removeAttribute('src');
  v.load();
  return frames;
}

/** Decode the audio track and reduce it to peaks. Returns null when there is no audio. */
export async function buildWaveform(blob: Blob): Promise<number[] | null> {
  if (blob.size > 600 * 1024 * 1024) return null;
  const ctx = new OfflineAudioContext(1, 1, 44100);
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    return null;
  }
  const data = buffer.getChannelData(0);
  const extra = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const bucket = Math.max(1, Math.floor(buffer.sampleRate / WAVEFORM_RATE));
  const peaks: number[] = [];
  let max = 0;
  for (let i = 0; i < data.length; i += bucket) {
    let peak = 0;
    const end = Math.min(data.length, i + bucket);
    for (let j = i; j < end; j += 4) {
      const v = Math.abs(extra ? (data[j] + extra[j]) / 2 : data[j]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  if (max < 1e-4) return [];
  return peaks.map((p) => Math.round((p / max) * 100) / 100);
}
