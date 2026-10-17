/**
 * Follows one player through a clip from a single tap: template matching on small colour frames,
 * run forwards and backwards from the tapped frame. Pure pixel code, so it can be tested anywhere.
 */

/** A small RGB frame and its source time. */
export interface TrackFrame {
  t: number;
  /** RGBA pixels, `w` x `h`. */
  rgba: Uint8ClampedArray;
}

/** Where the player is at source time `t`, as fractions of the frame. */
export interface FollowPoint {
  t: number;
  x: number;
  y: number;
}

export interface TrackOptions {
  /** Template size as fractions of the frame (a player in wide game footage). */
  patchW?: number;
  patchH?: number;
  /** How far the player can move between frames, as a fraction of the frame width. */
  reach?: number;
}

interface Patch {
  pw: number;
  ph: number;
  /** RGB values, row by row. */
  px: Float32Array;
}

function cut(f: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, pw: number, ph: number): Patch {
  const px = new Float32Array(pw * ph * 3);
  const x0 = Math.round(cx - pw / 2);
  const y0 = Math.round(cy - ph / 2);
  let k = 0;
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(h - 1, Math.max(0, y0 + y));
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(w - 1, Math.max(0, x0 + x));
      const i = (sy * w + sx) * 4;
      px[k++] = f[i];
      px[k++] = f[i + 1];
      px[k++] = f[i + 2];
    }
  }
  return { pw, ph, px };
}

/**
 * Mean squared difference between the template and the frame around (cx, cy), with the centre
 * weighted more than the edges (the edges are often background that changes as the player moves).
 * Stops early once it can't beat `best`.
 */
function score(f: Uint8ClampedArray, w: number, h: number, tpl: Patch, wts: Float32Array, wsum: number, cx: number, cy: number, best: number): number {
  const { pw, ph, px } = tpl;
  const x0 = cx - (pw >> 1);
  const y0 = cy - (ph >> 1);
  let sum = 0;
  let k = 0;
  const limit = best * wsum;
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(h - 1, Math.max(0, y0 + y));
    const row = sy * w;
    for (let x = 0; x < pw; x++, k++) {
      const sx = Math.min(w - 1, Math.max(0, x0 + x));
      const i = (row + sx) * 4;
      const dr = f[i] - px[k * 3];
      const dg = f[i + 1] - px[k * 3 + 1];
      const db = f[i + 2] - px[k * 3 + 2];
      sum += (dr * dr + dg * dg + db * db) * wts[k];
    }
    if (sum > limit) return Infinity;
  }
  return sum / wsum;
}

function weights(pw: number, ph: number): [Float32Array, number] {
  const wts = new Float32Array(pw * ph);
  let sum = 0;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const dx = (x + 0.5) / pw - 0.5;
      const dy = (y + 0.5) / ph - 0.5;
      const v = Math.exp(-(dx * dx + dy * dy) / (2 * 0.3 * 0.3));
      wts[y * pw + x] = v;
      sum += v;
    }
  }
  return [wts, sum];
}

/** How different the patch's own neighbourhood is, so match scores can be judged against it. */
function contrastOf(tpl: Patch): number {
  const n = tpl.pw * tpl.ph;
  const mean = [0, 0, 0];
  for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) mean[c] += tpl.px[k * 3 + c] / n;
  let v = 0;
  for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) v += (tpl.px[k * 3 + c] - mean[c]) ** 2;
  return v / n;
}

/**
 * Tracks the point tapped at `start` through `frames` (in time order, all `w` x `h`). Returns a
 * smoothed path with one point per frame. When the player is lost (blocked by others, out of
 * shot), the path coasts on their last movement and then holds, rather than jumping to a lookalike.
 */
export function trackPoint(frames: TrackFrame[], w: number, h: number, start: { t: number; x: number; y: number }, opts: TrackOptions = {}): FollowPoint[] {
  if (!frames.length) return [];
  const pw = Math.max(5, Math.round(w * (opts.patchW ?? 0.045)) | 1);
  const ph = Math.max(7, Math.round(h * (opts.patchH ?? 0.12)) | 1);
  const reach = Math.max(3, Math.round(w * (opts.reach ?? 0.05)));
  const [wts, wsum] = weights(pw, ph);
  // The frame nearest the tap.
  let s = 0;
  for (let i = 1; i < frames.length; i++) if (Math.abs(frames[i].t - start.t) < Math.abs(frames[s].t - start.t)) s = i;
  const sx = start.x * w;
  const sy = start.y * h;
  const first = cut(frames[s].rgba, w, h, sx, sy, pw, ph);
  const base = Math.max(200, contrastOf(first));

  const raw: { x: number; y: number; ok: boolean }[] = new Array(frames.length);
  raw[s] = { x: sx, y: sy, ok: true };
  const run = (dir: 1 | -1) => {
    const tpl: Patch = { pw, ph, px: first.px.slice() };
    let x = sx;
    let y = sy;
    let vx = 0;
    let vy = 0;
    let lost = 0;
    for (let i = s + dir; i >= 0 && i < frames.length; i += dir) {
      const f = frames[i].rgba;
      // Search around where they should be now, on a coarse grid and then finely.
      const px = x + vx;
      const py = y + vy;
      const r = reach * (1 + Math.min(2, lost * 0.5));
      let best = Infinity;
      let bx = px;
      let by = py;
      const tryAt = (cx: number, cy: number) => {
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;
        // Prefer the predicted spot a little, so a lookalike further away doesn't win a tie.
        const d = ((cx - px) ** 2 + (cy - py) ** 2) / (r * r);
        const sc = score(f, w, h, tpl, wts, wsum, cx, cy, best / (1 + 0.15 * d)) * (1 + 0.15 * d);
        if (sc < best) {
          best = sc;
          bx = cx;
          by = cy;
        }
      };
      for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) tryAt(Math.round(px + dx), Math.round(py + dy));
      const gx = bx;
      const gy = by;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) tryAt(gx + dx, gy + dy);
      // A good match is far closer to the template than the template's own spread of colours.
      const ok = best < base * 0.9;
      if (ok) {
        vx = (vx + (bx - x)) / 2;
        vy = (vy + (by - y)) / 2;
        x = bx;
        y = by;
        lost = 0;
        // Let the template follow slow changes in pose and lighting.
        const now = cut(f, w, h, x, y, pw, ph);
        for (let k = 0; k < tpl.px.length; k++) tpl.px[k] = tpl.px[k] * 0.85 + now.px[k] * 0.15;
        // Keep it anchored to the tapped player.
        for (let k = 0; k < tpl.px.length; k++) tpl.px[k] = tpl.px[k] * 0.97 + first.px[k] * 0.03;
      } else {
        lost++;
        // Coast briefly on the last movement, then hold.
        const k = lost < 4 ? 0.7 : 0;
        vx *= k;
        vy *= k;
        x = Math.min(w - 1, Math.max(0, x + vx));
        y = Math.min(h - 1, Math.max(0, y + vy));
      }
      raw[i] = { x, y, ok };
    }
  };
  run(1);
  run(-1);
  return smoothPath(
    frames.map((f, i) => ({ t: f.t, x: raw[i].x / w, y: raw[i].y / h, ok: raw[i].ok })),
    0.2,
  );
}

/**
 * Smooths a path with a local straight-line fit around each point (Gaussian-weighted, `seconds`
 * wide). Unlike an average it doesn't lag a moving player, even at the ends. Lost points count less.
 */
export function smoothPath(points: (FollowPoint & { ok?: boolean })[], seconds: number): FollowPoint[] {
  const out: FollowPoint[] = [];
  for (const p of points) {
    let sw = 0;
    let st = 0;
    let stt = 0;
    let sx = 0;
    let sy = 0;
    let stx = 0;
    let sty = 0;
    for (const q of points) {
      const dt = q.t - p.t;
      if (Math.abs(dt) > seconds * 2.5) continue;
      const wt = Math.exp(-(dt * dt) / (2 * seconds * seconds)) * (q.ok === false ? 0.3 : 1);
      sw += wt;
      st += wt * dt;
      stt += wt * dt * dt;
      sx += wt * q.x;
      sy += wt * q.y;
      stx += wt * dt * q.x;
      sty += wt * dt * q.y;
    }
    // Value of the fitted line at dt = 0.
    const det = sw * stt - st * st;
    const at = (s: number, sd: number) => (det > 1e-9 ? (s * stt - st * sd) / det : s / sw);
    out.push({ t: +p.t.toFixed(3), x: +at(sx, stx).toFixed(4), y: +at(sy, sty).toFixed(4) });
  }
  return out;
}

/** The player's position at source time `t`, interpolated along the path. */
export function followAt(path: FollowPoint[], t: number): { x: number; y: number } {
  if (t <= path[0].t) return path[0];
  for (let i = 1; i < path.length; i++) {
    if (t <= path[i].t) {
      const a = path[i - 1];
      const b = path[i];
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return path[path.length - 1];
}
