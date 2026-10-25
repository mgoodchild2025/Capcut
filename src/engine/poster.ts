/** Draws a graphic's finished frame to an image file (posters, "Save as image"). */
import type { Clip, GraphicSpec } from '../model/types';
import { POSTER_AT, POSTER_DURATION } from '../templates/posters';
import { drawGraphic } from './graphics';

/** Waits for the graphics' typefaces, so a still never goes out in a fallback font. */
export async function graphicsFonts() {
  if (!document.fonts) return;
  await Promise.all(
    ['900 80px "Big Shoulders Display"', '800 40px Inter', '700 40px Inter', '600 40px Inter'].map((f) => document.fonts.load(f).catch(() => [])),
  );
}

/** Loads an image from a URL (null if it can't be). */
export function loadImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Draws the finished graphic into `ctx` at W x H. */
export function drawPoster(ctx: CanvasRenderingContext2D, spec: GraphicSpec, W: number, H: number, images: Record<string, CanvasImageSource | null>, media: CanvasImageSource | null) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  drawGraphic(ctx, { id: 'poster', graphic: spec, duration: POSTER_DURATION } as Clip, POSTER_AT, W, H, (id) => images[id] ?? null, media);
}

/** Renders the finished graphic as a PNG. */
export async function renderPoster(spec: GraphicSpec, size: [number, number], images: Record<string, CanvasImageSource | null>, media: CanvasImageSource | null): Promise<Blob> {
  await graphicsFonts();
  const [W, H] = size;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  drawPoster(c.getContext('2d')!, spec, W, H, images, media);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image"))), 'image/png'));
}

/** Hands images to the share sheet (phones: Save Image, Instagram...) or downloads them. */
export async function shareImages(files: File[]): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return 'downloaded';
}
