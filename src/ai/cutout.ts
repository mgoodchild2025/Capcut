/** Removes the background from an image on-device (MODNet portrait matting via Transformers.js). */
let worker: Worker | null = null;
let seq = 0;

export async function removeBackground(
  image: Blob,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  // The model works at modest resolution; cap the input to keep memory sensible.
  const k = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * k);
  const h = Math.round(bitmap.height * k);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, w, h).data;

  worker ??= new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module' });
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
      reject(new Error(e.message || 'Background removal failed to start.'));
    };
    worker!.postMessage({ id, data: pixels, width: w, height: h }, [pixels.buffer]);
  });

  const out = new OffscreenCanvas(result.width, result.height);
  out.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(result.data), result.width, result.height), 0, 0);
  return out.convertToBlob({ type: 'image/png' });
}
