/**
 * Depth maps for living photos: Depth Anything V2 (small) on-device via Transformers.js, with a
 * simple guess when the model can't be loaded. Returns a greyscale PNG, white = near.
 */
import { guessDepth } from '../engine/livePhotoCore';

let worker: Worker | null = null;
let seq = 0;

async function pixelsOf(image: Blob, max: number) {
  const bitmap = await createImageBitmap(image);
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

async function toPng(grey: Uint8Array | Uint8ClampedArray, w: number, h: number): Promise<Blob> {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = grey[i];
    rgba[i * 4 + 3] = 255;
  }
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.putImageData(new ImageData(rgba, w, h), 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

/** Runs the depth model. Throws if it can't be loaded or run. */
export async function estimateDepth(image: Blob, onProgress?: (loaded: number, total: number) => void): Promise<Blob> {
  const { data, w, h } = await pixelsOf(image, 1024);
  worker ??= new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const files = new Map<string, [number, number]>();
  const result = await new Promise<{ data: Uint8ClampedArray; width: number; height: number }>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        const d = msg.data as { status?: string; file?: string; loaded?: number; total?: number };
        if (d.status === 'progress' && d.file) {
          files.set(d.file, [d.loaded ?? 0, d.total ?? 0]);
          let l = 0;
          let t = 0;
          for (const [a, b] of files.values()) {
            l += a;
            t += b;
          }
          onProgress?.(l, t);
        }
        return;
      }
      if (msg.id !== id) return;
      worker!.removeEventListener('message', onMessage);
      if (msg.type === 'error') reject(new Error(msg.message));
      else resolve(msg);
    };
    worker!.addEventListener('message', onMessage);
    worker!.onerror = (e) => {
      worker = null;
      reject(new Error(e.message || 'Depth estimation failed to start.'));
    };
    worker!.postMessage({ id, data, width: w, height: h }, [data.buffer]);
  });
  return toPng(result.data, result.width, result.height);
}

/** A depth map from the model, or a guess if the model isn't available. `guessed` says which. */
export async function depthFor(image: Blob, onProgress?: (loaded: number, total: number) => void): Promise<{ png: Blob; guessed: boolean }> {
  try {
    return { png: await estimateDepth(image, onProgress), guessed: false };
  } catch (e) {
    console.warn('Depth model unavailable, guessing depth', e);
    const { data, w, h } = await pixelsOf(image, 512);
    return { png: await toPng(guessDepth(data, w, h), w, h), guessed: true };
  }
}
