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
  /** Hypotheses kept each frame. */
  beam?: number;
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

/** `score` on every other pixel of the patch: a quarter of the work, for the coarse search. */
function scoreCoarse(f: Uint8ClampedArray, w: number, h: number, tpl: Patch, wts: Float32Array, wsum: number, cx: number, cy: number, best: number): number {
  const { pw, ph, px } = tpl;
  const x0 = cx - (pw >> 1);
  const y0 = cy - (ph >> 1);
  let sum = 0;
  const limit = best * wsum;
  for (let y = 0; y < ph; y += 2) {
    const sy = Math.min(h - 1, Math.max(0, y0 + y));
    const row = sy * w;
    for (let x = 0; x < pw; x += 2) {
      const k = y * pw + x;
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

/** Sum of the weights `scoreCoarse` uses. */
function coarseSum(wts: Float32Array, pw: number, ph: number): number {
  let s = 0;
  for (let y = 0; y < ph; y += 2) for (let x = 0; x < pw; x += 2) s += wts[y * pw + x];
  return s;
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

/** A point the player is known to be at: the first tap, and any corrections. */
export interface Anchor {
  t: number;
  x: number;
  y: number;
}

/** One hypothesis of where the player is, carried from frame to frame. */
interface Hyp {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Frames in a row without a convincing match (hidden, out of shot). */
  lost: number;
  /** Total cost of the path to here: how unlike the player, and how unlike how people move. */
  cost: number;
  /** Their look, adapting slowly to pose and light. */
  tpl: Float32Array;
  /** Index of the previous frame's hypothesis, for reading the path back. */
  from: number;
  ok: boolean;
}

/** How many hypotheses survive each frame, and how many places each tries next. */
const BEAM = 8;
const BRANCH = 4;
/** Cost of a frame where the player can't be seen (a good match costs well under this). */
const HIDDEN = 0.9;
/** Weight of moving unlike the player has been moving (per frame, against the search reach). */
const MOTION = 5;
/** How much of their speed carries over each frame (people don't stop or turn on a sixpence). */
const INERTIA = 0.8;
/** Cost of a frame seen right where a lookalike teammate is. */
const CROWD = 0.3;

/**
 * Tracks the player tapped at `anchors` (one tap, plus any corrections) through `frames` (in time
 * order, all `w` x `h`). Returns a smoothed path with one point per frame.
 *
 * Rather than committing to the best match frame by frame (and jumping to a teammate in the same
 * kit as they cross), it keeps several hypotheses of where the player is and scores each whole
 * path on looking like them and moving like a person does, so a crossing is settled by who carries
 * on the way they were going. A path must pass through every anchor. When the player is lost
 * (blocked by others, out of shot), the path coasts on their last movement and then holds.
 */
export function trackPoint(frames: TrackFrame[], w: number, h: number, anchors: Anchor | Anchor[], opts: TrackOptions = {}): FollowPoint[] {
  if (!frames.length) return [];
  const list = Array.isArray(anchors) ? anchors : [anchors];
  if (!list.length) return [];
  // Players move about the court, not the screen: take out the camera's panning.
  const cam = cameraPath(frames, w, h);
  // Teammates who look like the player, followed too: the player can't be where one of them is.
  const others = lookalikesOf(frames, w, h, list[0], opts).map((at) => trackRaw(frames, w, h, [at], { ...opts, beam: 5 }, [], cam));
  const raw = trackRaw(frames, w, h, list, opts, others, cam);
  return smoothPath(
    frames.map((f, i) => ({ t: f.t, x: raw[i].x / w, y: raw[i].y / h, ok: raw[i].ok })),
    0.2,
  );
}

type RawPath = { x: number; y: number; ok: boolean }[];

/** A frame at half size in brightness only: quick to compare, and blurred enough to line up. */
function half(f: Uint8ClampedArray, w: number, h: number): { px: Float32Array; w: number; h: number } {
  const hw = w >> 1;
  const hh = h >> 1;
  const px = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < hw; x++) {
      let v = 0;
      for (let k = 0; k < 4; k++) {
        const i = ((y * 2 + (k >> 1)) * w + x * 2 + (k & 1)) * 4;
        v += f[i] + f[i + 1] + f[i + 2];
      }
      px[y * hw + x] = v / 12;
    }
  return { px, w: hw, h: hh };
}

type Small = ReturnType<typeof half>;

/** Mean capped difference between `a` and `b` shifted by (dx, dy), on every `step`th pixel; stillness wins a near tie. */
function misfit(a: Float32Array, b: Float32Array, w: number, h: number, dx: number, dy: number, m: number, step: number) {
  let c = 0;
  let n = 0;
  for (let y = m; y < h - m; y += step)
    for (let x = m; x < w - m; x += step) {
      c += Math.min(25, Math.abs(a[y * w + x] - b[(y + dy) * w + x + dx]));
      n++;
    }
  return (c / n) * (1 + 0.004 * (dx * dx + dy * dy));
}

/** The shift between two half-size frames, in full-size pixels: searched at half size, then refined. */
function shiftBetween(a: Small, b: Small, fa: Uint8ClampedArray, fb: Uint8ClampedArray, w: number, h: number, max: number) {
  const hm = Math.ceil(max / 2);
  let best = { dx: 0, dy: 0, c: Infinity };
  for (let dy = -hm; dy <= hm; dy++)
    for (let dx = -hm; dx <= hm; dx++) {
      const c = misfit(a.px, b.px, a.w, a.h, dx, dy, hm + 1, 2);
      if (c < best.c) best = { dx, dy, c };
    }
  // Full size, around twice the half-size shift.
  const ga = luma(fa, w, h);
  const gb = luma(fb, w, h);
  const cx = best.dx * 2;
  const cy = best.dy * 2;
  let fine = { dx: cx, dy: cy, c: Infinity };
  for (let dy = cy - 1; dy <= cy + 1; dy++)
    for (let dx = cx - 1; dx <= cx + 1; dx++) {
      if (Math.abs(dx) > max + 1 || Math.abs(dy) > max + 1) continue;
      const c = misfit(ga, gb, w, h, dx, dy, max + 2, 3);
      if (c < fine.c) fine = { dx, dy, c };
    }
  return { dx: fine.dx, dy: fine.dy };
}

const lumaCache = new WeakMap<Uint8ClampedArray, Float32Array>();
function luma(f: Uint8ClampedArray, w: number, h: number): Float32Array {
  let g = lumaCache.get(f);
  if (!g) {
    g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = (f[i * 4] + f[i * 4 + 1] + f[i * 4 + 2]) / 3;
    lumaCache.set(f, g);
  }
  return g;
}

/**
 * How far the picture moved from one frame to the next (the camera panning or shaking), in
 * pixels: the shift that best lines up the two frames, each difference capped so the players
 * moving about don't count for much.
 */
export function cameraShift(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, max = Math.round(w * 0.04)): { dx: number; dy: number } {
  return shiftBetween(half(a, w, h), half(b, w, h), a, b, w, h, max);
}

/** The camera's movement into each frame from the one before (none into the first). */
function cameraPath(frames: TrackFrame[], w: number, h: number): { dx: number; dy: number }[] {
  const max = Math.round(w * 0.04);
  const small = frames.map((f) => half(f.rgba, w, h));
  return frames.map((f, i) => (i ? shiftBetween(small[i - 1], small[i], frames[i - 1].rgba, f.rgba, w, h, max) : { dx: 0, dy: 0 }));
}

/** Others in the frame of the first anchor who look like the player (same kit), nearest first. */
function lookalikesOf(frames: TrackFrame[], w: number, h: number, at: Anchor, opts: TrackOptions): Anchor[] {
  const pw = Math.max(5, Math.round(w * (opts.patchW ?? 0.045)) | 1);
  const ph = Math.max(7, Math.round(h * (opts.patchH ?? 0.12)) | 1);
  const [wts, wsum] = weights(pw, ph);
  let s = 0;
  for (let i = 1; i < frames.length; i++) if (Math.abs(frames[i].t - at.t) < Math.abs(frames[s].t - at.t)) s = i;
  const f = frames[s].rgba;
  const ax = at.x * w;
  const ay = at.y * h;
  const tpl = cut(f, w, h, ax, ay, pw, ph);
  const base = Math.max(200, contrastOf(tpl));
  const spots: { x: number; y: number; c: number }[] = [];
  const near = w * 0.35;
  for (let y = ph >> 1; y < h - (ph >> 1); y += 2)
    for (let x = pw >> 1; x < w - (pw >> 1); x += 2) {
      if (Math.hypot(x - ax, y - ay) > near || (Math.abs(x - ax) < pw && Math.abs(y - ay) < ph * 0.8)) continue;
      const c = score(f, w, h, tpl, wts, wsum, x, y, base * 0.6) / base;
      if (c < 0.6) spots.push({ x, y, c });
    }
  spots.sort((a, b) => a.c - b.c);
  const out: { x: number; y: number }[] = [];
  for (const sp of spots) {
    if (out.length >= 4) break;
    if (out.some((q) => Math.abs(q.x - sp.x) < pw * 1.2 && Math.abs(q.y - sp.y) < ph * 0.8)) continue;
    out.push(sp);
  }
  return out.sort((a, b) => Math.hypot(a.x - ax, a.y - ay) - Math.hypot(b.x - ax, b.y - ay)).map((p) => ({ t: frames[s].t, x: p.x / w, y: p.y / h }));
}

/** The beam search behind `trackPoint`, in pixels; `others` are lookalikes' paths the player keeps clear of. */
function trackRaw(frames: TrackFrame[], w: number, h: number, anchors: Anchor[], opts: TrackOptions, others: RawPath[], cam: { dx: number; dy: number }[]): RawPath {
  const pw = Math.max(5, Math.round(w * (opts.patchW ?? 0.045)) | 1);
  const ph = Math.max(7, Math.round(h * (opts.patchH ?? 0.12)) | 1);
  const reach = Math.max(3, Math.round(w * (opts.reach ?? 0.05)));
  const [wts, wsum] = weights(pw, ph);
  const nearest = (t: number) => {
    let s = 0;
    for (let i = 1; i < frames.length; i++) if (Math.abs(frames[i].t - t) < Math.abs(frames[s].t - t)) s = i;
    return s;
  };
  // One anchor per frame, in time order.
  const byFrame = new Map<number, { x: number; y: number }>();
  for (const a of anchors) byFrame.set(nearest(a.t), { x: a.x * w, y: a.y * h });
  const marks = [...byFrame.keys()].sort((a, b) => a - b);
  // The player's look at each anchor; any of them counts as looking like the player.
  const looks = marks.map((i) => {
    const tpl = cut(frames[i].rgba, w, h, byFrame.get(i)!.x, byFrame.get(i)!.y, pw, ph);
    return { tpl, base: Math.max(200, contrastOf(tpl)) };
  });
  const unlike = (f: Uint8ClampedArray, tpl: Patch, base: number, x: number, y: number, cap = Infinity) => score(f, w, h, tpl, wts, wsum, x, y, cap * base) / base;
  const csum = coarseSum(wts, pw, ph);
  const roughly = (f: Uint8ClampedArray, tpl: Patch, base: number, x: number, y: number, cap: number) => scoreCoarse(f, w, h, tpl, wts, csum, x, y, cap * base) / base;
  const beam = opts.beam ?? BEAM;
  const unlikeAny = (f: Uint8ClampedArray, own: Patch, ownBase: number, x: number, y: number) => {
    let best = unlike(f, own, ownBase, x, y);
    for (const l of looks) best = Math.min(best, unlike(f, l.tpl, l.base, x, y, best));
    return best;
  };

  const raw: RawPath = new Array(frames.length);
  // Seen right where a lookalike is: possible (they cross), but the less likely story the longer it lasts.
  const crowded = (i: number, x: number, y: number) => others.some((o) => o[i]?.ok && Math.abs(o[i].x - x) < pw * 0.6 && Math.abs(o[i].y - y) < ph * 0.5);
  for (const i of marks) raw[i] = { ...byFrame.get(i)!, ok: true };

  /** Tracks from anchor frame `s` through `steps` (frame indices, in the direction of travel); `goal` pins the last one. */
  const chain = (s: number, steps: number[], goal?: { x: number; y: number }) => {
    if (!steps.length) return;
    const look = looks[marks.indexOf(s)];
    const at = byFrame.get(s)!;
    let layer: Hyp[] = [{ x: at.x, y: at.y, vx: 0, vy: 0, lost: 0, cost: 0, tpl: look.tpl.px.slice(), from: -1, ok: true }];
    const layers: Hyp[][] = [];
    for (let n = 0; n < steps.length; n++) {
      const f = frames[steps[n]].rgba;
      const kids: Hyp[] = [];
      // The camera's move between the previous frame and this one (either direction of travel).
      const prev = n ? steps[n - 1] : s;
      const move = steps[n] > prev ? cam[steps[n]] : { dx: -cam[prev].dx, dy: -cam[prev].dy };
      layer.forEach((hyp, from) => {
        const own: Patch = { pw, ph, px: hyp.tpl };
        const px = hyp.x + hyp.vx + move.dx;
        const py = hyp.y + hyp.vy + move.dy;
        const r = reach * (1 + Math.min(2, hyp.lost * 0.5));
        const moveCost = (x: number, y: number) => (MOTION * ((x - px) ** 2 + (y - py) ** 2)) / (r * r);
        const kid = (x: number, y: number, look: number, ok: boolean, covered = false): Hyp => {
          // Behind someone in the same kit they carry on as they were going; out of sight they coast, then stop.
          const keep = covered && hyp.lost < 12 ? 1 : hyp.lost < 3 ? 0.7 : 0;
          // Their own movement, on the court.
          const vx = ok ? hyp.vx * INERTIA + (x - hyp.x - move.dx) * (1 - INERTIA) : hyp.vx * keep;
          const vy = ok ? hyp.vy * INERTIA + (y - hyp.y - move.dy) * (1 - INERTIA) : hyp.vy * keep;
          const crowd = ok && crowded(steps[n], x, y) ? CROWD : 0;
          return { x, y, vx, vy, lost: ok ? 0 : hyp.lost + 1, cost: hyp.cost + look + crowd + moveCost(x, y), tpl: hyp.tpl, from, ok };
        };
        if (goal && n === steps.length - 1) {
          kids.push(kid(goal.x, goal.y, 0, true));
          return;
        }
        // Coarse grid around where they should be now; the best few distinct spots go on.
        const spots: { x: number; y: number; c: number }[] = [];
        const step = 2;
        for (let dy = -r; dy <= r; dy += step)
          for (let dx = -r; dx <= r; dx += step) {
            const x = Math.round(px + dx);
            const y = Math.round(py + dy);
            if (x < 0 || y < 0 || x >= w || y >= h || dx * dx + dy * dy > r * r * 1.1) continue;
            const c = roughly(f, own, look.base, x, y, HIDDEN * 1.4);
            if (c < HIDDEN * 1.4) spots.push({ x, y, c: c + moveCost(x, y) });
          }
        spots.sort((a, b) => a.c - b.c);
        const picked: { x: number; y: number }[] = [];
        for (const sp of spots) {
          if (picked.length >= BRANCH) break;
          if (picked.some((q) => Math.abs(q.x - sp.x) <= 2 && Math.abs(q.y - sp.y) <= 2)) continue;
          picked.push(sp);
        }
        for (const sp of picked) {
          // Refine to the pixel.
          let bx = sp.x;
          let by = sp.y;
          let bc = Infinity;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const x = sp.x + dx;
              const y = sp.y + dy;
              if (x < 0 || y < 0 || x >= w || y >= h) continue;
              const c = unlikeAny(f, own, look.base, x, y);
              if (c + moveCost(x, y) < bc) {
                bc = c + moveCost(x, y);
                bx = x;
                by = y;
              }
            }
          const c = unlikeAny(f, own, look.base, bx, by);
          if (c < HIDDEN) kids.push(kid(bx, by, c, true));
        }
        // Or they're hidden: coast on their last movement, then hold. Hidden behind a lookalike (where
        // the player could well be) costs no more than being seen there.
        const cx = Math.min(w - 1, Math.max(0, px));
        const cy = Math.min(h - 1, Math.max(0, py));
        const behind = unlikeAny(f, own, look.base, Math.round(cx), Math.round(cy)) + 0.1;
        kids.push(kid(cx, cy, Math.min(HIDDEN, behind), false, behind < HIDDEN));
      });
      // Keep the cheapest; two hypotheses in the same place moving the same way are one.
      kids.sort((a, b) => a.cost - b.cost);
      const next: Hyp[] = [];
      for (const k of kids) {
        if (next.length >= beam) break;
        if (next.some((q) => Math.abs(q.x - k.x) < 2 && Math.abs(q.y - k.y) < 2 && Math.abs(q.vx - k.vx) < 1.5 && Math.abs(q.vy - k.vy) < 1.5)) continue;
        next.push(k);
      }
      // The survivors learn how the player looks now (when it's clearly them).
      for (const k of next) {
        if (!k.ok || (goal && n === steps.length - 1)) continue;
        const now = cut(f, w, h, k.x, k.y, pw, ph);
        if (unlike(f, { pw, ph, px: k.tpl }, look.base, k.x, k.y) > 0.7) continue;
        const tpl = new Float32Array(k.tpl.length);
        for (let i = 0; i < tpl.length; i++) tpl[i] = (k.tpl[i] * 0.85 + now.px[i] * 0.15) * 0.97 + look.tpl.px[i] * 0.03;
        k.tpl = tpl;
      }
      layers.push(next);
      layer = next;
    }
    // Read the cheapest path back.
    let k = 0;
    for (let n = layers.length - 1; n >= 0; n--) {
      const hyp = layers[n][k];
      if (!(goal && n === layers.length - 1)) raw[steps[n]] = { x: hyp.x, y: hyp.y, ok: hyp.ok };
      k = hyp.from;
    }
  };

  const range = (a: number, b: number) => {
    const out: number[] = [];
    for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) out.push(i);
    return out;
  };
  if (marks[0] > 0) chain(marks[0], range(marks[0] - 1, 0));
  for (let m = 0; m + 1 < marks.length; m++) chain(marks[m], range(marks[m] + 1, marks[m + 1]), byFrame.get(marks[m + 1]));
  const last = marks[marks.length - 1];
  if (last < frames.length - 1) chain(last, range(last + 1, frames.length - 1));
  return raw;
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

/**
 * Best guess at where the player tapped in `src` (at `at`, fractions) is in another frame `dst`
 * (another play of the same game): the whole frame is searched for their look, nudged towards
 * where they were (players keep to their side and their position). `sure` is 0..1: how clearly
 * the best spot beats a lookalike elsewhere (teammates share a kit, so it's often modest).
 */
export function findLookalike(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, at: { x: number; y: number }, opts: TrackOptions = {}): { x: number; y: number; sure: number } {
  const pw = Math.max(5, Math.round(w * (opts.patchW ?? 0.045)) | 1);
  const ph = Math.max(7, Math.round(h * (opts.patchH ?? 0.12)) | 1);
  const [wts, wsum] = weights(pw, ph);
  const tpl = cut(src, w, h, at.x * w, at.y * h, pw, ph);
  const base = Math.max(200, contrastOf(tpl));
  const step = 2;
  let best = { x: at.x * w, y: at.y * h, s: Infinity };
  // Second best well away from the best, to judge how sure the guess is.
  const found: { x: number; y: number; s: number }[] = [];
  for (let y = ph >> 1; y < h - (ph >> 1); y += step) {
    for (let x = pw >> 1; x < w - (pw >> 1); x += step) {
      const raw = score(dst, w, h, tpl, wts, wsum, x, y, Infinity);
      const dx = x / w - at.x;
      const dy = y / h - at.y;
      const s = raw * (1 + 1.5 * Math.hypot(dx, dy * 1.5));
      found.push({ x, y, s });
      if (s < best.s) best = { x, y, s };
    }
  }
  // Refine around the best at full resolution.
  for (let y = best.y - step; y <= best.y + step; y++) {
    for (let x = best.x - step; x <= best.x + step; x++) {
      const raw = score(dst, w, h, tpl, wts, wsum, x, y, Infinity);
      const s = raw * (1 + 1.5 * Math.hypot(x / w - at.x, (y / h - at.y) * 1.5));
      if (s < best.s) best = { x, y, s };
    }
  }
  let second = Infinity;
  for (const f of found) if (Math.abs(f.x - best.x) > pw * 1.5 || Math.abs(f.y - best.y) > ph * 1.2) second = Math.min(second, f.s);
  const match = Math.max(0, 1 - best.s / (base * 2));
  const unique = second === Infinity ? 1 : Math.max(0, Math.min(1, (second - best.s) / Math.max(1, second)));
  return { x: best.x / w, y: best.y / h, sure: Math.round(match * Math.min(1, unique * 3) * 100) / 100 };
}
