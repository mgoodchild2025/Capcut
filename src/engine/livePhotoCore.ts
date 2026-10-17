/**
 * Living photos: a still photo split into depth layers that a virtual camera can move through.
 * Pure pixel code (no DOM), so it can be tested and run anywhere.
 */

export interface DepthLayer {
  /** RGBA pixels; transparent where the layer has nothing. */
  rgba: Uint8ClampedArray;
  /** 0 for the farthest layer, 1 for the nearest. */
  near: number;
}

/**
 * Fills the pixels where `valid` is 0 from their valid surroundings (push-pull: average down a
 * pyramid of valid pixels, then pull the averages back up into the holes). Works in place.
 */
export function pushPull(rgb: Float32Array, valid: Float32Array, w: number, h: number) {
  if (w <= 1 && h <= 1) return;
  const w2 = Math.max(1, Math.ceil(w / 2));
  const h2 = Math.max(1, Math.ceil(h / 2));
  const rgb2 = new Float32Array(w2 * h2 * 3);
  const val2 = new Float32Array(w2 * h2);
  // Push: weighted average of each 2x2 block's valid pixels.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = valid[i];
      if (!v) continue;
      const j = (y >> 1) * w2 + (x >> 1);
      val2[j] += v;
      rgb2[j * 3] += rgb[i * 3] * v;
      rgb2[j * 3 + 1] += rgb[i * 3 + 1] * v;
      rgb2[j * 3 + 2] += rgb[i * 3 + 2] * v;
    }
  }
  for (let j = 0; j < w2 * h2; j++) {
    if (val2[j] > 0) {
      rgb2[j * 3] /= val2[j];
      rgb2[j * 3 + 1] /= val2[j];
      rgb2[j * 3 + 2] /= val2[j];
      val2[j] = Math.min(1, val2[j]);
    }
  }
  if (w2 < w || h2 < h) pushPull(rgb2, val2, w2, h2);
  // Pull: blend the coarse estimate into pixels that aren't fully valid.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = valid[i];
      if (v >= 1) continue;
      const j = (y >> 1) * w2 + (x >> 1);
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rgb[i * 3 + c] * v + rgb2[j * 3 + c] * (1 - v);
      valid[i] = 1;
    }
  }
}

/**
 * Splits an image into `count` layers by depth (0 = far, 255 = near). Each layer keeps its own
 * band plus everything nearer, and those nearer pixels are replaced by an inpainted guess of
 * what's behind them, so a layer moving out from behind another shows plausible background
 * instead of a hole. Band edges are feathered.
 */
export function buildLayers(rgba: Uint8ClampedArray, rawDepth: Uint8Array | Uint8ClampedArray, w: number, h: number, count = 4): DepthLayer[] {
  const n = w * h;
  // Grow near regions a little so a subject's soft edge travels with it (and stays out of the
  // background that gets inpainted behind it), instead of trailing as a ghost.
  const depth = dilate(rawDepth, w, h, Math.max(1, Math.round(Math.min(w, h) / 160)));
  // Band limits from the depth range actually used, so flat-ish depth maps still separate.
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    if (depth[i] < lo) lo = depth[i];
    if (depth[i] > hi) hi = depth[i];
  }
  const span = Math.max(1, hi - lo);
  const edge = (k: number) => lo + (span * k) / count;
  // A narrow feather: wide ones leave edge pixels in two layers moving at different speeds (ghosting).
  const feather = Math.max(1, span / count / 10);
  const layers: DepthLayer[] = [];
  for (let k = 0; k < count; k++) {
    const from = edge(k);
    const to = edge(k + 1);
    const rgb = new Float32Array(n * 3);
    const valid = new Float32Array(n);
    const alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = depth[i];
      // Inside this layer at all: its own band and anything nearer (feathered at the far edge).
      alpha[i] = k === 0 ? 1 : Math.max(0, Math.min(1, (d - from + feather) / (2 * feather)));
      // Real pixels only from this band; nearer ones get inpainted.
      const own = k === count - 1 ? 1 : Math.max(0, Math.min(1, (to - d + feather) / (2 * feather)));
      valid[i] = alpha[i] * own;
      rgb[i * 3] = rgba[i * 4];
      rgb[i * 3 + 1] = rgba[i * 4 + 1];
      rgb[i * 3 + 2] = rgba[i * 4 + 2];
    }
    if (k < count - 1) pushPull(rgb, valid, w, h);
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      out[i * 4] = rgb[i * 3];
      out[i * 4 + 1] = rgb[i * 3 + 1];
      out[i * 4 + 2] = rgb[i * 3 + 2];
      out[i * 4 + 3] = alpha[i] * 255;
    }
    layers.push({ rgba: out, near: count === 1 ? 1 : k / (count - 1) });
  }
  return layers;
}

/** Maximum filter with a square of radius `r` (separable: rows, then columns). */
export function dilate(src: ArrayLike<number>, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, src[y * w + k]);
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

/**
 * A rough depth map when the depth model isn't available: transparent areas far, the middle of
 * the frame (where the subject usually is) near, the floor nearer than the back wall.
 */
export function guessDepth(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  let transparent = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 128) transparent++;
  const useAlpha = transparent > w * h * 0.05;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (useAlpha) {
        out[i] = rgba[i * 4 + 3];
        continue;
      }
      const fy = y / h;
      const dx = (x / w - 0.5) / 0.32;
      const dy = (fy - 0.55) / 0.42;
      const subject = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      const ground = Math.max(0, (fy - 0.6) / 0.4);
      out[i] = Math.round(255 * Math.min(1, 0.15 + 0.25 * ground + 0.75 * Math.pow(subject, 0.7)));
    }
  }
  return out;
}

/** Camera move at progress `p` (0..1) through the shot: per-layer scale and horizontal shift (fraction of the frame). */
export function cameraFor(near: number, p: number): { scale: number; dx: number; dy: number } {
  const e = p * p * (3 - 2 * p);
  return {
    // A dolly push-in: near things grow faster than far ones.
    scale: 1.04 + e * (0.04 + 0.1 * near),
    // A slow drift sideways; near layers cross the frame faster.
    dx: (e - 0.5) * 0.05 * (near - 0.35),
    dy: (e - 0.5) * -0.012 * near,
  };
}
