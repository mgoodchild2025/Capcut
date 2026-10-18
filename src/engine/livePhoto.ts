/**
 * Living-photo layers for the browser: built once per photo and depth map, cached as canvases,
 * and drawn with a moving camera. Building is deferred off the drawing path; the preview asks
 * for a redraw when layers are ready, and export waits for them up front.
 */
import { buildLayers, cameraFor } from './livePhotoCore';

interface Built {
  layers: { canvas: HTMLCanvasElement; near: number }[];
  w: number;
  h: number;
}

const MAX = 720; // working resolution: plenty for a card window, quick to build
const cache = new Map<string, Built | Promise<Built>>();
let onReady: () => void = () => {};

/** Called when deferred layers finish, so the preview redraws. */
export function setLivePhotoReady(fn: () => void) {
  onReady = fn;
}

const loaded = (src: CanvasImageSource) => {
  if (src instanceof HTMLImageElement && !(src.complete && src.naturalWidth)) return false;
  const [w, h] = sizeOf(src);
  return w > 0 && h > 0;
};

function sizeOf(src: CanvasImageSource): [number, number] {
  if (src instanceof HTMLImageElement) return [src.naturalWidth, src.naturalHeight];
  const s = src as { width: number; height: number };
  return [s.width, s.height];
}

async function build(photo: CanvasImageSource, depth: CanvasImageSource): Promise<Built> {
  const [iw, ih] = sizeOf(photo);
  const k = Math.min(1, MAX / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k));
  const h = Math.max(1, Math.round(ih * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(photo, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(depth, 0, 0, w, h);
  const dpx = ctx.getImageData(0, 0, w, h).data;
  const d = new Uint8Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = dpx[i * 4];
  // Let the current frame finish before the heavy work.
  await new Promise((r) => setTimeout(r, 0));
  const layers = buildLayers(rgba, d, w, h, 4).map((l) => {
    const lc = document.createElement('canvas');
    lc.width = w;
    lc.height = h;
    lc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(l.rgba), w, h), 0, 0);
    return { canvas: lc, near: l.near };
  });
  return { layers, w, h };
}

/** Layers for a photo and its depth map, building them (in the background) if needed. Null until ready. */
export function livePhotoLayers(key: string, photo: CanvasImageSource, depth: CanvasImageSource): Built | null {
  const hit = cache.get(key);
  if (hit && !(hit instanceof Promise)) return hit;
  // A photo still loading has no pixels yet: building now would cache empty layers for good.
  if (!hit && loaded(photo) && loaded(depth)) {
    const p = build(photo, depth).then((b) => {
      cache.set(key, b);
      onReady();
      return b;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return null;
}

/** Waits for layers to be built (export needs every frame right). */
export async function ensureLivePhoto(key: string, photo: CanvasImageSource, depth: CanvasImageSource): Promise<void> {
  livePhotoLayers(key, photo, depth);
  const hit = cache.get(key);
  if (hit instanceof Promise) await hit;
}

/**
 * Draws the layers into (x, y, w, h), filling it like `object-fit: cover`, with the camera at
 * progress `p` (0..1) through the shot.
 */
export function drawLivePhoto(ctx: CanvasRenderingContext2D, b: Built, x: number, y: number, w: number, h: number, p: number) {
  const base = Math.max(w / b.w, h / b.h);
  for (const l of b.layers) {
    const cam = cameraFor(l.near, p);
    const k = base * cam.scale;
    const dw = b.w * k;
    const dh = b.h * k;
    ctx.drawImage(l.canvas, x + (w - dw) / 2 + cam.dx * w, y + (h - dh) * 0.4 + cam.dy * h, dw, dh);
  }
}
