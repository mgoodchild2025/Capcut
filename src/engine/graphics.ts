/**
 * Broadcast motion graphics, drawn procedurally for each frame: title opens, stingers, lower thirds,
 * player cards, score bug, stat/roster/final boards and a closer. Everything is a pure function of
 * the clip's local time, so the preview and the export draw exactly the same frames.
 */
import type { Clip, GraphicSpec } from '../model/types';

export type ImageLookup = (assetId: string) => CanvasImageSource | null;

interface G {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** Short side, the unit for sizes. */
  S: number;
  portrait: boolean;
  t: number;
  d: number;
  c1: string;
  c2: string;
  /** Text colour that reads on c2. */
  ink: string;
  spec: GraphicSpec;
  img: ImageLookup;
  /** The clip's own media (player photo or clip). */
  media: CanvasImageSource | null;
}

// ---------------------------------------------------------------------------
// Easing and timing

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Progress through [a, b] seconds. */
const seg = (t: number, a: number, b: number) => clamp01((t - a) / Math.max(1e-6, b - a));
const eOut = (x: number) => 1 - Math.pow(1 - x, 3);
const eExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const eInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eBack = (x: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** 0 -> 1 over the last `len` seconds: drives every graphic's exit. */
const exitOf = (g: G, len = 0.4) => eInOut(seg(g.t, g.d - len, g.d));

// ---------------------------------------------------------------------------
// Colour

function rgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [40, 40, 48];
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
/** Darken (k < 0) or lighten (k > 0). */
function shade(hex: string, k: number, a = 1) {
  const [r, g, b] = rgb(hex);
  const f = (v: number) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  return `rgba(${f(r)},${f(g)},${f(b)},${a})`;
}
function inkFor(hex: string) {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0b0b10' : '#ffffff';
}

// ---------------------------------------------------------------------------
// Drawing primitives

const DISPLAY = '"Big Shoulders Display", Impact, "Arial Narrow", sans-serif';
const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

function font(ctx: CanvasRenderingContext2D, size: number, weight = 900, family = DISPLAY) {
  ctx.font = `${weight} ${Math.max(1, size)}px ${family}`;
}

/** Largest size (up to `max`) at which `text` fits in `maxW`, allowing for letter spacing of `track` em. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, max: number, weight = 900, family = DISPLAY, track = 0) {
  font(ctx, max, weight, family);
  const w = ctx.measureText(text).width + text.length * max * track;
  return w <= maxW ? max : Math.max(8, (max * maxW) / w);
}

function tracking(ctx: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Parallelogram leaning right by `skew` px over its height. */
function para(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, skew: number) {
  ctx.beginPath();
  ctx.moveTo(x + skew, y);
  ctx.lineTo(x + w + skew, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

let scratch: HTMLCanvasElement | null = null;
function scratchCanvas(w: number, h: number) {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, Math.ceil(w));
    scratch.height = Math.max(scratch.height, Math.ceil(h));
  }
  const c = scratch.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, scratch.width, scratch.height);
  return { canvas: scratch, c };
}

/**
 * Text with an optional moving glint. `reveal` wipes the text in from below (a masked rise),
 * `sheen` (0..1) sweeps a band of light across it.
 */
function headline(
  g: G,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { color?: string; align?: CanvasTextAlign; reveal?: number; sheen?: number; weight?: number; family?: string; stroke?: string; shadow?: boolean; track?: number } = {},
) {
  const { ctx } = g;
  const reveal = opts.reveal ?? 1;
  if (reveal <= 0 || !text) return;
  font(ctx, size, opts.weight ?? 900, opts.family ?? DISPLAY);
  tracking(ctx, opts.track ?? 0);
  const w = ctx.measureText(text).width;
  const align = opts.align ?? 'center';
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const top = y - size * 0.82;
  const h = size * 1.05;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left - size, top - size * 0.1, w + size * 2, h + size * 0.2);
  ctx.clip();
  const rise = (1 - eOut(reveal)) * h * 1.1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (opts.shadow !== false) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = size * 0.12;
    ctx.shadowOffsetY = size * 0.04;
  }
  if (opts.stroke) {
    ctx.lineWidth = Math.max(1, size * 0.035);
    ctx.strokeStyle = opts.stroke;
    ctx.strokeText(text, left, y + rise);
  }
  ctx.fillStyle = opts.color ?? '#fff';
  ctx.fillText(text, left, y + rise);
  ctx.restore();
  const sheen = opts.sheen;
  if (sheen !== undefined && sheen > 0 && sheen < 1) {
    // Light only where the letters are: draw them into a scratch canvas, sweep a band through.
    const pad = size * 0.3;
    const sw = w + pad * 2;
    const sh = h + pad * 2;
    const { canvas, c } = scratchCanvas(sw, sh);
    font(c, size, opts.weight ?? 900, opts.family ?? DISPLAY);
    tracking(c, opts.track ?? 0);
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#fff';
    c.fillText(text, pad, pad + size * 0.82);
    c.globalCompositeOperation = 'source-in';
    const bx = lerp(-sw * 0.4, sw * 1.4, eInOut(sheen));
    const grad = c.createLinearGradient(bx - size, 0, bx + size, sh);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, sw, sh);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= 0.85;
    ctx.drawImage(canvas, 0, 0, sw, sh, left - pad, top - pad + size * 0.0, sw, sh);
    ctx.restore();
  }
  tracking(ctx, 0);
}

function label(g: G, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 800, track = 0.12) {
  const { ctx } = g;
  font(ctx, size, weight, SANS);
  tracking(ctx, size * track);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  tracking(ctx, 0);
}

/** Deterministic pseudo-random in [0, 1). */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** The moving backdrop of full-screen graphics: team gradient, light bands, halftone, rays. */
function backdrop(g: G, strength = 1) {
  const { ctx, W, H, S, t, c1, c2 } = g;
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, shade(c1, -0.82));
  base.addColorStop(0.5, shade(c1, -0.55));
  base.addColorStop(1, shade(c1, -0.78));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Slow light pools.
  const pool = (cx: number, cy: number, r: number, col: string, a: number) => {
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, rgba(col, a));
    rg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  };
  pool(W * (0.25 + 0.08 * Math.sin(t * 0.6)), H * 0.3, S * 1.1, c1, 0.55 * strength);
  pool(W * (0.8 - 0.06 * Math.cos(t * 0.5)), H * 0.75, S * 0.9, c2, 0.28 * strength);

  // Diagonal light bands drifting across.
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.5);
  const span = Math.hypot(W, H);
  for (let i = 0; i < 9; i++) {
    const speed = 0.04 + hash(i) * 0.05;
    const x = (((hash(i + 9) + t * speed) % 1) - 0.5) * span * 1.4;
    const w = S * (0.02 + hash(i + 3) * 0.12);
    const gr = ctx.createLinearGradient(x - w, 0, x + w, 0);
    const col = i % 3 === 0 ? c2 : '#ffffff';
    const a = (i % 3 === 0 ? 0.14 : 0.05) * strength;
    gr.addColorStop(0, rgba(col, 0));
    gr.addColorStop(0.5, rgba(col, a));
    gr.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(x - w, -span, w * 2, span * 2);
  }
  ctx.restore();

  // Halftone dots fading toward one corner.
  ctx.save();
  const step = S * 0.028;
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 0; y < H * 0.45; y += step) {
    for (let x = W * 0.55; x < W; x += step) {
      const k = clamp01(((x - W * 0.55) / (W * 0.45)) * (1 - y / (H * 0.45)));
      if (k < 0.08) continue;
      ctx.beginPath();
      ctx.arc(x, y, step * 0.32 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Fine scan lines and a vignette.
  ctx.fillStyle = 'rgba(255,255,255,0.018)';
  for (let y = 0; y < H; y += Math.max(3, S * 0.004)) ctx.fillRect(0, y, W, 1);
  const v = ctx.createRadialGradient(W / 2, H / 2, S * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

/** Streaks of light racing across, used on opens and cards. */
function streaks(g: G, y0: number, y1: number, count = 5, alpha = 0.5) {
  const { ctx, W, S, t, c2 } = g;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const p = (t * (0.35 + hash(i) * 0.4) + hash(i + 5)) % 1.4;
    const x = lerp(-W * 0.4, W * 1.2, p / 1.4);
    const y = lerp(y0, y1, hash(i + 11));
    const len = W * (0.18 + hash(i + 2) * 0.25);
    const th = S * (0.002 + hash(i + 7) * 0.004);
    const gr = ctx.createLinearGradient(x, 0, x + len, 0);
    gr.addColorStop(0, rgba(c2, 0));
    gr.addColorStop(0.8, rgba(i % 2 ? '#ffffff' : c2, alpha));
    gr.addColorStop(1, rgba('#ffffff', 0));
    ctx.fillStyle = gr;
    ctx.fillRect(x, y, len, th);
  }
  ctx.restore();
}

/** Draws an image to cover (fill) a box, centred on (fx, fy) of the source. */
function cover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, x: number, y: number, w: number, h: number, zoom = 1, fx = 0.5, fy = 0.4) {
  const [iw, ih] = sizeOf(src);
  if (!iw || !ih) return;
  const k = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * k;
  const dh = ih * k;
  ctx.drawImage(src, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh);
}

function sizeOf(src: CanvasImageSource): [number, number] {
  if (src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  if (src instanceof HTMLImageElement) return [src.naturalWidth, src.naturalHeight];
  if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) return [src.displayWidth, src.displayHeight];
  const s = src as { width: number; height: number };
  return [s.width, s.height];
}

/** A logo fitted inside a square of `size`, centred at (cx, cy). */
function logoAt(g: G, id: string | undefined, cx: number, cy: number, size: number, alpha = 1, glow = 0) {
  if (!id) return false;
  const src = g.img(id);
  if (!src) return false;
  const [iw, ih] = sizeOf(src);
  if (!iw || !ih) return false;
  const k = Math.min(size / iw, size / ih);
  const { ctx } = g;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (glow > 0) {
    ctx.shadowColor = rgba(g.c2, 0.8 * glow);
    ctx.shadowBlur = size * 0.25 * glow;
  }
  ctx.drawImage(src, cx - (iw * k) / 2, cy - (ih * k) / 2, iw * k, ih * k);
  ctx.restore();
  return true;
}

/** A logo landing: overshoot scale, white flash and an expanding shockwave ring. */
function logoSlam(g: G, id: string | undefined, cx: number, cy: number, size: number, start: number) {
  const p = seg(g.t, start, start + 0.55);
  if (p <= 0) return false;
  const { ctx } = g;
  const s = lerp(1.9, 1, eBack(p));
  const ring = seg(g.t, start + 0.18, start + 1.0);
  if (ring > 0 && ring < 1) {
    ctx.save();
    ctx.strokeStyle = rgba(g.c2, 0.9 * (1 - ring));
    ctx.lineWidth = g.S * 0.012 * (1 - ring);
    ctx.beginPath();
    ctx.arc(cx, cy, size * (0.45 + ring * 1.1), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba('#ffffff', 0.6 * (1 - ring));
    ctx.lineWidth = g.S * 0.004;
    ctx.beginPath();
    ctx.arc(cx, cy, size * (0.4 + ring * 0.8), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  const ok = logoAt(g, id, cx, cy, size * s, clamp01(p * 3), 1);
  const flash = seg(g.t, start + 0.15, start + 0.5);
  if (flash > 0 && flash < 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.2);
    rg.addColorStop(0, `rgba(255,255,255,${0.75 * (1 - flash)})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(cx - size * 1.3, cy - size * 1.3, size * 2.6, size * 2.6);
    ctx.restore();
  }
  return ok;
}

/** Two angled panels racing across: used to wipe full-screen graphics in and out. */
function panelWipe(g: G, p: number, reverse = false) {
  if (p <= 0 || p >= 1) return;
  const { ctx, W, H, c1, c2 } = g;
  const sk = H * 0.35;
  const span = W + sk * 2;
  const a = eInOut(p);
  for (const [i, col] of [
    [0, c2],
    [1, shade(c1, -0.2)],
  ] as const) {
    const lag = i * 0.12;
    const k = clamp01((a - lag) / (1 - lag));
    const lead = lerp(-sk, span, k);
    const tail = lerp(-sk, span, clamp01(k * 1.6 - 0.6));
    ctx.fillStyle = col;
    const x0 = reverse ? W - lead : tail - sk;
    const x1 = reverse ? W - tail + sk : lead;
    if (x1 > x0) para(ctx, Math.min(x0, x1) - sk, 0, Math.abs(x1 - x0) + sk, H, sk), ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Graphics

/** Title open: logo slam, masked title, kicker plate, sweep. A versus layout when both logos are set. */
function drawOpen(g: G) {
  const { ctx, W, H, S, t, portrait, spec } = g;
  const tx = spec.text;
  backdrop(g);
  streaks(g, H * 0.15, H * 0.85, 6, 0.45);
  const vs = !!(spec.logo && spec.oppLogo);
  const logoY = portrait ? H * 0.35 : H * 0.3;
  const logoSize = S * (portrait ? 0.44 : 0.3);
  if (vs) {
    const gap = Math.min(W * 0.27, S * 0.42) * (portrait ? 0.95 : 1);
    const vsSize = portrait ? Math.min(logoSize * 0.6, W * 0.3) : logoSize * 0.85;
    logoSlam(g, spec.logo, W / 2 - gap, logoY, vsSize, 0.2);
    logoSlam(g, spec.oppLogo, W / 2 + gap, logoY, vsSize, 0.42);
    const vp = eBack(seg(t, 0.6, 1.0));
    if (vp > 0) headline(g, 'VS', W / 2, logoY + S * 0.06, S * 0.13 * vp, { color: g.c2, shadow: true });
  } else if (spec.logo) {
    logoSlam(g, spec.logo, W / 2, logoY, logoSize, 0.25);
  }
  const hasLogo = vs || !!spec.logo;
  const titleY = hasLogo ? (portrait ? H * 0.62 : H * 0.69) : portrait ? H * 0.52 : H * 0.57;
  const lines = (tx.title || '').toUpperCase().split('\n');
  const size = Math.min(...lines.map((l) => fit(ctx, l, W * 0.88, S * (portrait ? 0.23 : 0.19))));
  // Kicker plate.
  const kick = (tx.kicker || '').toUpperCase();
  if (kick) {
    const kp = eExpo(seg(t, 0.75, 1.2));
    const ks = S * 0.042;
    font(ctx, ks, 800, SANS);
    tracking(ctx, ks * 0.18);
    const kw = ctx.measureText(kick).width + ks * 2.2;
    tracking(ctx, 0);
    const ky = titleY - size * lines.length * 0.95 - ks * 1.6;
    ctx.save();
    ctx.fillStyle = g.c2;
    para(ctx, W / 2 - kw / 2 - ks * 0.4, ky - ks * 0.95, kw * kp, ks * 1.9, ks * 0.4);
    ctx.fill();
    ctx.restore();
    if (kp > 0.6) label(g, kick, W / 2, ky, ks, g.ink, 'center', 800, 0.18);
  }
  lines.forEach((l, i) => {
    const y = titleY - (lines.length - 1 - i) * size * 0.95;
    headline(g, l, W / 2, y, size, { reveal: seg(t, 0.55 + i * 0.12, 1.15 + i * 0.12), sheen: seg(t, 1.5, 2.5) });
  });
  // Underline bar grows from the centre.
  const bar = eExpo(seg(t, 0.9, 1.5));
  if (bar > 0) {
    ctx.fillStyle = g.c2;
    ctx.fillRect(W / 2 - (W * 0.32 * bar) / 2, titleY + size * 0.22, W * 0.32 * bar, Math.max(3, S * 0.008));
  }
  const sub = (tx.sub || '').toUpperCase();
  if (sub) {
    const sp = seg(t, 1.15, 1.8);
    ctx.save();
    ctx.globalAlpha = eOut(sp);
    const ss = fit(ctx, sub, W * 0.88, S * (portrait ? 0.045 : 0.04), 700, SANS, 0.16);
    label(g, sub, W / 2, titleY + size * 0.22 + S * 0.07, ss, '#e5e7eb', 'center', 700, lerp(0.6, 0.16, eOut(sp)));
    ctx.restore();
  }
  // Exit: panels sweep across.
  panelWipe(g, seg(t, g.d - 0.5, g.d + 0.15));
}

/** Full-screen wipe in team colours with the logo at its peak: covers a cut at its midpoint. */
function drawStinger(g: G) {
  const { ctx, W, H, S, t, d, c1, c2 } = g;
  const p = t / d; // 0..1, fully covered at 0.5
  const sk = H * 0.4;
  const bars: [string, number][] = [
    [c2, 0],
    ['#ffffff', 0.07],
    [shade(c1, -0.35), 0.14],
  ];
  for (const [col, lag] of bars) {
    // In: leading edge crosses left to right by p = 0.45; out: trailing edge follows from 0.55.
    const inK = eInOut(clamp01((p - lag) / 0.45));
    const outK = eInOut(clamp01((p - 0.55 - lag * 0.6) / 0.42));
    const lead = lerp(-sk, W + sk, inK);
    const tail = lerp(-sk * 2, W + sk, outK);
    if (lead <= tail) continue;
    ctx.fillStyle = col;
    para(ctx, tail - sk, 0, lead - tail + sk, H, sk);
    ctx.fill();
  }
  // Logo and a glint at the peak.
  const peak = 1 - Math.abs(p - 0.5) / 0.22;
  if (peak > 0) {
    const s = S * 0.28 * lerp(0.85, 1, eOut(clamp01(peak)));
    if (!logoAt(g, g.spec.logo, W / 2, H / 2, s, clamp01(peak * 1.6), 0.6)) {
      headline(g, (g.spec.text.title || '').toUpperCase(), W / 2, H / 2 + S * 0.05, fit(ctx, (g.spec.text.title || '').toUpperCase(), W * 0.7, S * 0.12), { color: '#fff' });
    }
  }
  if (p > 0.3 && p < 0.7) streaks(g, H * 0.2, H * 0.8, 4, 0.7);
}

/** Lower third: number block, name bar, detail bar, built out left to right. */
function drawLowerThird(g: G) {
  const { ctx, W, H, S, t, portrait, spec } = g;
  const tx = spec.text;
  const out = exitOf(g, 0.35);
  const x0 = W * 0.05;
  const h = S * (portrait ? 0.105 : 0.088);
  const y0 = H * (portrait ? 0.74 : 0.76);
  const num = (tx.number || '').replace('#', '');
  const nb = num ? h * 1.15 : 0;
  const name = (tx.name || '').toUpperCase();
  const detail = (tx.detail || '').toUpperCase();
  const tag = (tx.tag || '').toUpperCase();
  font(ctx, h * 0.68, 900);
  const nameW = Math.max(W * 0.25, Math.min(W * (portrait ? 0.72 : 0.5), ctx.measureText(name).width + h * 1.1));
  const sk = h * 0.32;
  const retract = 1 - out;

  // Number block pops in.
  const pn = eBack(seg(t, 0, 0.35)) * retract;
  if (nb && pn > 0) {
    ctx.save();
    ctx.translate(x0 + nb / 2, y0 + h / 2);
    ctx.scale(pn, pn);
    ctx.fillStyle = g.c2;
    para(ctx, -nb / 2, -h / 2, nb, h, sk * 0.6);
    ctx.fill();
    if (!logoAt(g, spec.logo && !num ? spec.logo : undefined, 0, 0, h * 0.8)) {
      headline(g, num, sk * 0.3, h * 0.28, fit(ctx, num, nb * 0.8, h * 0.8), { color: g.ink, shadow: false });
    }
    ctx.restore();
  }
  // Name bar extends.
  const pb = eExpo(seg(t, 0.15, 0.6)) * retract;
  const bx = x0 + nb + h * 0.08;
  if (pb > 0) {
    ctx.save();
    const gr = ctx.createLinearGradient(bx, y0, bx, y0 + h);
    gr.addColorStop(0, shade(g.c1, -0.15));
    gr.addColorStop(1, shade(g.c1, -0.55));
    ctx.fillStyle = gr;
    para(ctx, bx, y0, nameW * pb, h, sk * 0.6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(bx + sk * 0.6, y0, nameW * pb, Math.max(1, h * 0.04));
    ctx.beginPath();
    ctx.rect(bx, y0 - h, nameW * pb + sk, h * 3);
    ctx.clip();
    headline(g, name, bx + h * 0.45, y0 + h * 0.76, Math.min(h * 0.68, fit(ctx, name, nameW - h * 0.8, h * 0.68)), {
      align: 'left',
      reveal: seg(t, 0.3, 0.7),
      sheen: seg(t, 0.9, 1.7),
      shadow: false,
    });
    ctx.restore();
  }
  // Detail bar slides under; the play (Kill, Ace...) ends it in the team colour.
  const pd = eExpo(seg(t, 0.4, 0.8)) * retract;
  if ((detail || tag) && pd > 0) {
    const dh = h * 0.52;
    const ds = dh * 0.5;
    const lead = detail && tag ? `${detail}   ·   ` : detail;
    font(ctx, ds, 800, SANS);
    tracking(ctx, ds * 0.14);
    const leadW = lead ? ctx.measureText(lead).width : 0;
    font(ctx, ds, 900, SANS);
    const tagW = tag ? ctx.measureText(tag).width : 0;
    tracking(ctx, 0);
    const dw = Math.min(W * 0.85, leadW + tagW + dh * 1.4);
    const dy = y0 + h + h * 0.06;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    para(ctx, bx - sk * 0.25, dy, dw * pd, dh, sk * 0.3);
    ctx.fill();
    ctx.beginPath();
    ctx.rect(bx, y0 + h, dw * pd, dh * 1.3);
    ctx.clip();
    if (lead) label(g, lead, bx + dh * 0.5, dy + dh / 2, ds, '#111318', 'left', 800, 0.14);
    if (tag) label(g, tag, bx + dh * 0.5 + leadW, dy + dh / 2, ds, shade(g.c2, -0.4), 'left', 900, 0.14);
    ctx.restore();
  }
  // Small logo after the name bar.
  if (spec.logo && num && pb > 0.9) logoAt(g, spec.logo, bx + nameW + sk + h * 0.55, y0 + h / 2, h * 0.85, clamp01((pb - 0.9) * 10));
}

/** Score bug: both teams with logos, scores and the set. */
function drawScoreBug(g: G) {
  const { ctx, W, H, S, t, portrait, spec } = g;
  const tx = spec.text;
  const inP = eExpo(seg(t, 0, 0.45));
  const out = exitOf(g, 0.3);
  const rowH = S * (portrait ? 0.064 : 0.056);
  const nameW = rowH * 3.6;
  const scoreW = rowH * 1.35;
  const logoW = rowH * 1.1;
  const setW = rowH * 1.6;
  const w = logoW + nameW + scoreW + setW;
  const h = rowH * 2;
  const x = W * 0.04;
  const y = H * (portrait ? 0.05 : 0.055) - (1 - inP + out) * (h + H * 0.06);
  const us = parseInt(tx.us ?? '', 10);
  const them = parseInt(tx.them ?? '', 10);
  ctx.save();
  ctx.globalAlpha *= 1 - out;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = rowH * 0.5;
  ctx.fillStyle = 'rgba(10,11,16,0.9)';
  ctx.fillRect(x, y, w, h);
  ctx.shadowBlur = 0;
  const rows: [string, string | undefined, number, string][] = [
    [tx.usName || 'HOME', spec.logo, us, g.c1],
    [tx.themName || 'AWAY', spec.oppLogo, them, '#3a3d48'],
  ];
  rows.forEach(([name, logo, score, col], i) => {
    const ry = y + i * rowH;
    const lead = Number.isFinite(us) && Number.isFinite(them) && ((i === 0 && us > them) || (i === 1 && them > us));
    // Team colour edge and logo cell.
    ctx.fillStyle = col === g.c1 ? g.c1 : col;
    ctx.fillRect(x, ry, logoW, rowH);
    if (!logoAt(g, logo, x + logoW / 2, ry + rowH / 2, rowH * 0.78)) {
      label(g, name.slice(0, 1), x + logoW / 2, ry + rowH / 2, rowH * 0.5, '#fff', 'center', 900, 0);
    }
    label(g, name.toUpperCase().slice(0, 9), x + logoW + rowH * 0.3, ry + rowH / 2 + 1, rowH * 0.46, '#ffffff', 'left', 800, 0.06);
    // Score cell, highlighted for the team ahead.
    ctx.fillStyle = lead ? g.c2 : 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + logoW + nameW, ry, scoreW, rowH);
    const pop = lead ? eBack(seg(t, 0.35, 0.7)) : 1;
    ctx.save();
    ctx.translate(x + logoW + nameW + scoreW / 2, ry + rowH * 0.8);
    ctx.scale(pop, pop);
    headline(g, Number.isFinite(score) ? String(score) : '–', 0, 0, rowH * 0.82, { color: lead ? g.ink : '#ffffff', shadow: false });
    ctx.restore();
    if (i === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, ry + rowH - 1, logoW + nameW + scoreW, 1);
    }
  });
  // Set column.
  ctx.fillStyle = shade(g.c1, -0.45);
  ctx.fillRect(x + w - setW, y, setW, h);
  label(g, 'SET', x + w - setW / 2, y + h * 0.3, rowH * 0.36, rgba(g.c2, 1), 'center', 800, 0.2);
  headline(g, tx.set || '–', x + w - setW / 2, y + h * 0.82, rowH * 0.95, { color: '#fff', shadow: false });
  ctx.restore();
}

/** Full-screen player card: photo, cut-out or clip in an angled window, giant number, stacked name. */
function drawPlayerCard(g: G) {
  const { ctx, W, H, S, t, portrait, spec, media } = g;
  const tx = spec.text;
  backdrop(g, 0.9);
  const num = (tx.number || '').replace('#', '');
  const cutout = !!spec.cutout && !!media && !(media instanceof HTMLVideoElement);
  // Window geometry.
  const win = portrait
    ? { x: 0, y: H * 0.04, w: W, h: H * 0.56, sk: 0 }
    : { x: W * 0.44, y: 0, w: W * 0.56, h: H, sk: W * 0.08 };
  const open = eExpo(seg(t, 0.05, 0.6));

  // Giant number behind everything (the window shows it already when there's no photo).
  if (num && (media || portrait)) {
    const ns = Math.min(S * (portrait ? 0.95 : 1.05), (W * (portrait ? 0.95 : 0.6)) / Math.max(1, num.length * 0.55));
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 0.2, 0.8));
    // Behind the player when cut out; otherwise behind the name, since the window covers the right.
    const nx = portrait ? W / 2 : cutout ? W * 0.7 : W * 0.24;
    const ny = portrait ? H * 0.38 : H * 0.55;
    const s = lerp(1.25, 1, eOut(seg(t, 0.2, 1.2)));
    ctx.translate(nx, ny);
    ctx.scale(s, s);
    font(ctx, ns, 900);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(g.c2, cutout ? 0.22 : 0.1);
    ctx.fillText(num, 0, 0);
    ctx.lineWidth = S * 0.006;
    ctx.strokeStyle = rgba(g.c2, cutout ? 0.7 : 0.45);
    ctx.strokeText(num, 0, 0);
    ctx.restore();
  }

  if (media && cutout) {
    // Cut-out player with a rim glow, rising into place.
    const [iw, ih] = sizeOf(media);
    const boxW = portrait ? W * 0.9 : W * 0.5;
    const boxH = portrait ? H * 0.58 : H * 0.95;
    const k = Math.min(boxW / iw, boxH / ih) * lerp(1.06, 1, eOut(seg(t, 0, g.d)));
    const dw = iw * k;
    const dh = ih * k;
    const cx = portrait ? W / 2 : W * 0.7;
    const bottom = portrait ? H * 0.62 : H;
    const rise = (1 - eOut(seg(t, 0.1, 0.7))) * H * 0.08;
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 0.1, 0.5));
    ctx.shadowColor = rgba(g.c2, 0.9);
    ctx.shadowBlur = S * 0.05;
    ctx.drawImage(media, cx - dw / 2, bottom - dh + rise, dw, dh);
    ctx.restore();
  } else if (open > 0) {
    // Angled window that wipes open with a bright leading edge.
    ctx.save();
    const ww = win.w * open;
    para(ctx, win.x + (portrait ? 0 : win.w - ww), win.y, ww + win.sk, win.h, win.sk);
    ctx.clip();
    if (media) {
      cover(ctx, media, win.x, win.y, win.w + win.sk, win.h, lerp(1.12, 1.0, eOut(seg(t, 0, g.d))));
      // Grade towards team colours and darken the edge text sits on.
      const gr = portrait ? ctx.createLinearGradient(0, win.y + win.h * 0.55, 0, win.y + win.h) : ctx.createLinearGradient(win.x, 0, win.x + win.w * 0.35, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, shade(g.c1, -0.75, 0.85));
      if (!portrait) {
        gr.addColorStop(0, shade(g.c1, -0.75, 0.75));
        gr.addColorStop(1, 'rgba(0,0,0,0)');
      }
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    } else {
      // No media: team panel with the number.
      const gr = ctx.createLinearGradient(win.x, win.y, win.x + win.w, win.y + win.h);
      gr.addColorStop(0, shade(g.c1, -0.25));
      gr.addColorStop(1, shade(g.c1, -0.65));
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
      if (num) headline(g, num, portrait ? W / 2 : win.x + win.w * 0.55, win.y + win.h * 0.7, Math.min(win.h * 0.7, (win.w * 0.8) / Math.max(1, num.length * 0.55)), { color: rgba('#ffffff', 0.9), shadow: true });
      logoAt(g, spec.logo, portrait ? W * 0.82 : win.x + win.w * 0.8, win.y + S * 0.12, S * 0.14, 0.9);
    }
    streaks(g, win.y + win.h * 0.1, win.y + win.h * 0.9, 3, 0.35);
    ctx.restore();
    // Leading edge.
    if (open < 1) {
      ctx.fillStyle = g.c2;
      const ex = portrait ? win.x + ww : win.x + win.w - ww;
      para(ctx, ex - S * 0.008, win.y, S * 0.016, win.h, win.sk);
      ctx.fill();
    } else {
      ctx.fillStyle = g.c2;
      if (portrait) ctx.fillRect(0, win.y + win.h - S * 0.008, W, S * 0.008);
      else para(ctx, win.x - S * 0.006, 0, S * 0.012, H, win.sk), ctx.fill();
    }
  }

  // Text block.
  const first = (tx.first || '').toUpperCase();
  const last = (tx.last || tx.name || '').toUpperCase();
  const left = portrait ? W / 2 : W * 0.07;
  const align: CanvasTextAlign = portrait ? 'center' : 'left';
  const maxW = portrait ? W * 0.9 : W * 0.42;
  let y = portrait ? H * 0.68 : H * 0.3;
  if (num) {
    const ns = S * (portrait ? 0.14 : 0.13);
    const np = eBack(seg(t, 0.35, 0.7));
    if (np > 0) {
      ctx.save();
      ctx.translate(left, y);
      ctx.scale(np, np);
      headline(g, `#${num}`, 0, 0, ns, { color: g.c2, align });
      ctx.restore();
    }
    y += S * 0.03;
  }
  if (first) {
    const fs = fit(ctx, first, maxW, S * (portrait ? 0.095 : 0.085));
    const fp = eExpo(seg(t, 0.45, 0.85));
    ctx.save();
    ctx.globalAlpha = fp;
    headline(g, first, left - (1 - fp) * S * 0.2 * (portrait ? 0 : 1), y + fs, fs, { align, color: '#e5e7eb', shadow: true });
    ctx.restore();
    y += fs * 1.02;
  }
  const ls = fit(ctx, last, maxW, S * (portrait ? 0.22 : 0.2));
  headline(g, last, left, y + ls * 0.92, ls, { align, reveal: seg(t, 0.55, 1.05), sheen: seg(t, 1.3, 2.2) });
  y += ls * 1.05;
  const pos = (tx.position || '').toUpperCase();
  if (pos) {
    const ps = S * (portrait ? 0.044 : 0.04);
    const pp = eExpo(seg(t, 0.8, 1.2));
    font(ctx, ps, 800, SANS);
    tracking(ctx, ps * 0.16);
    const pw = ctx.measureText(pos).width + ps * 2;
    tracking(ctx, 0);
    const px = portrait ? left - pw / 2 : left;
    ctx.fillStyle = g.c2;
    para(ctx, px, y + ps * 0.2, pw * pp, ps * 1.8, ps * 0.4);
    ctx.fill();
    if (pp > 0.7) label(g, pos, px + ps, y + ps * 1.1, ps, g.ink, 'left', 800, 0.16);
    y += ps * 2.6;
  }
  const detail = tx.detail || '';
  if (detail) {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 1.0, 1.5));
    const ds = fit(ctx, detail, maxW, S * (portrait ? 0.036 : 0.034), 600, SANS);
    label(g, detail, left, y + ds, ds, '#cbd5e1', align, 600, 0.04);
    ctx.restore();
  }
  if (tx.count) label(g, tx.count, W - S * 0.05, S * 0.05, S * 0.026, 'rgba(255,255,255,0.7)', 'right', 700, 0.2);
  if (spec.logo && media) logoAt(g, spec.logo, S * 0.1, S * 0.1, S * 0.12, eOut(seg(t, 0.6, 1.0)));
  panelWipe(g, seg(t, g.d - 0.45, g.d + 0.15));
}

/** Stats board: rows slide in one after another, numbers count up. */
function drawStats(g: G) {
  const { ctx, W, H, S, t, portrait, spec } = g;
  backdrop(g);
  const rows = (spec.rows ?? []).filter(([k, v]) => k || v).slice(0, 6);
  const title = (spec.text.title || 'STATS').toUpperCase();
  const top = portrait ? H * 0.2 : H * 0.17;
  const tp = eExpo(seg(t, 0.05, 0.5));
  const ts = fit(ctx, title, W * 0.8, S * 0.11);
  // Title plate.
  ctx.save();
  ctx.fillStyle = g.c2;
  font(ctx, ts, 900);
  const tw = ctx.measureText(title).width + ts * 0.8;
  para(ctx, W / 2 - tw / 2, top - ts * 0.85, tw * tp, ts * 1.05, ts * 0.25);
  ctx.fill();
  ctx.restore();
  if (tp > 0.5) headline(g, title, W / 2, top, ts, { color: g.ink, shadow: false, reveal: seg(t, 0.2, 0.55) });
  if (spec.text.sub) label(g, spec.text.sub.toUpperCase(), W / 2, top + ts * 0.55, S * 0.03, '#cbd5e1', 'center', 700, 0.2);
  logoAt(g, spec.logo, W - S * 0.1, S * 0.1, S * 0.12, eOut(seg(t, 0.3, 0.8)));

  const areaTop0 = top + ts * 0.9 + S * 0.05;
  const areaH = H * (portrait ? 0.9 : 0.92) - areaTop0;
  const rh = Math.min(S * (portrait ? 0.21 : 0.17), areaH / Math.max(1, rows.length));
  const areaTop = areaTop0 + (areaH - rh * rows.length) * (portrait ? 0.4 : 0.35);
  const rw = Math.min(W * 0.88, S * (portrait ? 0.95 : 1.3));
  const rx = (W - rw) / 2;
  rows.forEach(([k, v], i) => {
    const start = 0.45 + i * 0.16;
    const p = eExpo(seg(t, start, start + 0.45));
    if (p <= 0) return;
    const y = areaTop + i * rh;
    const slide = (1 - p) * W * 0.4;
    ctx.save();
    ctx.translate(slide, 0);
    ctx.globalAlpha = p;
    // Row plate.
    const gr = ctx.createLinearGradient(rx, 0, rx + rw, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.1)');
    gr.addColorStop(1, 'rgba(255,255,255,0.02)');
    ctx.fillStyle = gr;
    para(ctx, rx, y + rh * 0.1, rw, rh * 0.8, rh * 0.18);
    ctx.fill();
    ctx.fillStyle = g.c2;
    para(ctx, rx, y + rh * 0.1, rh * 0.09, rh * 0.8, rh * 0.18);
    ctx.fill();
    // Value counts up.
    const m = String(v).match(/^(\D*)(\d+(?:\.\d+)?)(.*)$/);
    const cp = eOut(seg(t, start + 0.1, start + 0.9));
    let shown = String(v);
    if (m) {
      const n = parseFloat(m[2]);
      const dec = m[2].includes('.') ? m[2].split('.')[1].length : 0;
      shown = `${m[1]}${(n * cp).toFixed(dec)}${m[3]}`;
    }
    const vs = rh * 0.62;
    headline(g, shown, rx + rh * 0.45, y + rh * 0.72, vs, { align: 'left', color: '#fff' });
    font(ctx, vs, 900);
    const vw = Math.max(rh * 1.6, ctx.measureText(String(v)).width + rh * 0.35);
    label(g, String(k).toUpperCase(), rx + rh * 0.45 + vw + rh * 0.2, y + rh * 0.5, rh * 0.24, '#e5e7eb', 'left', 800, 0.16);
    ctx.restore();
  });
  panelWipe(g, seg(t, g.d - 0.45, g.d + 0.15));
}

/** Roster wall: player tiles with photos (or numbers) flipping in. */
function drawRoster(g: G) {
  const { ctx, W, H, S, t, portrait, spec } = g;
  backdrop(g);
  const players = (spec.players ?? []).slice(0, 18);
  const title = (spec.text.title || 'THE SQUAD').toUpperCase();
  const ts = fit(ctx, title, W * 0.8, S * 0.11);
  const top = portrait ? H * 0.11 : H * 0.13;
  headline(g, title, W / 2, top, ts, { reveal: seg(t, 0.05, 0.5), sheen: seg(t, 0.9, 1.8) });
  if (spec.text.sub) label(g, spec.text.sub.toUpperCase(), W / 2, top + ts * 0.42, S * 0.03, g.c2, 'center', 800, 0.22);
  logoAt(g, spec.logo, S * 0.1, S * 0.1, S * 0.12, eOut(seg(t, 0.2, 0.6)));
  const n = players.length;
  if (!n) return;
  const cols = portrait ? (n <= 4 ? 2 : n <= 12 ? 3 : 4) : n <= 6 ? 3 : n <= 10 ? 5 : 6;
  const rowsN = Math.ceil(n / cols);
  const gx = S * 0.02;
  const areaTop = top + ts * 0.7 + S * 0.04;
  const areaH = H - areaTop - S * 0.06;
  const areaW = W * 0.92;
  const tw = Math.min((areaW - gx * (cols - 1)) / cols, ((areaH - gx * (rowsN - 1)) / rowsN) * 0.78);
  const th = tw / 0.78;
  const gridW = cols * tw + (cols - 1) * gx;
  const gridH = rowsN * th + (rowsN - 1) * gx;
  const x0 = (W - gridW) / 2;
  const y0 = areaTop + Math.max(0, (areaH - gridH) * 0.4);
  players.forEach((pl, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const lastRow = r === rowsN - 1 ? n - r * cols : cols;
    const off = r === rowsN - 1 ? ((cols - lastRow) * (tw + gx)) / 2 : 0;
    const x = x0 + off + c * (tw + gx);
    const y = y0 + r * (th + gx);
    const start = 0.35 + i * 0.07;
    const p = eBack(seg(t, start, start + 0.45));
    if (p <= 0) return;
    ctx.save();
    ctx.translate(x + tw / 2, y + th / 2);
    ctx.scale(1, Math.max(0.001, p));
    ctx.translate(-tw / 2, -th / 2);
    ctx.fillStyle = shade(g.c1, -0.45);
    ctx.fillRect(0, 0, tw, th);
    const src = pl.photo ? g.img(pl.photo) : null;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, tw, th);
    ctx.clip();
    if (src) {
      cover(ctx, src, 0, 0, tw, th * 0.82, 1, 0.5, 0.25);
    } else {
      const gr = ctx.createLinearGradient(0, 0, 0, th);
      gr.addColorStop(0, shade(g.c1, -0.1));
      gr.addColorStop(1, shade(g.c1, -0.6));
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, tw, th * 0.82);
      if (pl.number) headline(g, pl.number.replace('#', ''), tw / 2, th * 0.6, Math.min(th * 0.5, tw * 0.7 / Math.max(1, pl.number.length * 0.55)), { color: rgba(g.c2, 0.9) });
    }
    ctx.restore();
    // Name bar.
    ctx.fillStyle = 'rgba(8,9,14,0.92)';
    ctx.fillRect(0, th * 0.78, tw, th * 0.22);
    ctx.fillStyle = g.c2;
    ctx.fillRect(0, th * 0.78, tw, Math.max(2, th * 0.015));
    const nm = (pl.name || '').toUpperCase();
    const last = nm.split(/\s+/).slice(-1)[0] || nm;
    headline(g, last, tw / 2, th * 0.95, fit(ctx, last, tw * 0.86, th * 0.13), { color: '#fff', shadow: false });
    if (pl.number) {
      const bs = tw * 0.26;
      ctx.fillStyle = g.c2;
      ctx.fillRect(0, 0, bs, bs * 0.8);
      headline(g, pl.number.replace('#', ''), bs / 2, bs * 0.66, fit(ctx, pl.number.replace('#', ''), bs * 0.85, bs * 0.62), { color: g.ink, shadow: false });
    }
    ctx.restore();
  });
  panelWipe(g, seg(t, g.d - 0.45, g.d + 0.15));
}

/** Final scoreboard: both teams with logos, sets won and the score of every set. */
function drawFinal(g: G) {
  const { ctx, W, H, S, t, portrait, spec } = g;
  backdrop(g);
  const sets = spec.sets ?? [];
  const won = sets.filter(([a, b]) => a > b).length;
  const lost = sets.length - won;
  const names = [spec.text.usName || 'HOME', spec.text.themName || 'AWAY'];
  const logos = [spec.logo, spec.oppLogo];
  const totals = [won, lost];
  const top = portrait ? H * 0.2 : H * 0.17;
  headline(g, 'FINAL', W / 2, top, S * (portrait ? 0.15 : 0.12), { color: g.c2, reveal: seg(t, 0.05, 0.45), sheen: seg(t, 1.6, 2.4) });

  if (portrait) {
    // Two big team blocks, then a set-by-set table.
    const bw = W * 0.9;
    const x0 = (W - bw) / 2;
    const bh = S * 0.24;
    let y = top + S * 0.1;
    for (let i = 0; i < 2; i++) {
      const p = eExpo(seg(t, 0.3 + i * 0.15, 0.8 + i * 0.15));
      const win = totals[i] > totals[1 - i];
      if (p > 0) {
        ctx.save();
        ctx.translate((1 - p) * (i ? W : -W) * 0.6, 0);
        ctx.fillStyle = win ? shade(g.c1, -0.2) : 'rgba(20,22,30,0.92)';
        ctx.fillRect(x0, y, bw, bh);
        if (win) {
          ctx.fillStyle = g.c2;
          ctx.fillRect(x0, y, S * 0.014, bh);
        }
        if (!logoAt(g, logos[i], x0 + bh * 0.55, y + bh / 2, bh * 0.7)) {
          ctx.fillStyle = i ? '#3a3d48' : g.c1;
          ctx.fillRect(x0 + bh * 0.2, y + bh * 0.2, bh * 0.7, bh * 0.6);
        }
        const nm = names[i].toUpperCase();
        const words = nm.split(/\s+/);
        const lineA = words.length > 2 ? words.slice(0, Math.ceil(words.length / 2)).join(' ') : nm;
        const lineB = words.length > 2 ? words.slice(Math.ceil(words.length / 2)).join(' ') : '';
        const maxW = bw - bh * 1.2 - bh * 1.0;
        const ns = Math.min(fit(ctx, lineA, maxW, bh * 0.36), lineB ? fit(ctx, lineB, maxW, bh * 0.36) : Infinity);
        headline(g, lineA, x0 + bh * 1.1, y + bh * (lineB ? 0.47 : 0.62), ns, { align: 'left', shadow: false });
        if (lineB) headline(g, lineB, x0 + bh * 1.1, y + bh * 0.47 + ns * 0.98, ns, { align: 'left', shadow: false });
        ctx.fillStyle = win ? g.c2 : 'rgba(255,255,255,0.1)';
        ctx.fillRect(x0 + bw - bh * 0.95, y, bh * 0.95, bh);
        const cp = eBack(seg(t, 1.1, 1.5));
        ctx.save();
        ctx.translate(x0 + bw - bh * 0.475, y + bh * 0.78);
        ctx.scale(Math.max(0.01, cp), Math.max(0.01, cp));
        headline(g, String(totals[i]), 0, 0, bh * 0.75, { color: win ? g.ink : '#fff', shadow: false });
        ctx.restore();
        ctx.restore();
      }
      y += bh + S * 0.025;
    }
    // Set table.
    if (sets.length) {
      const tp = eOut(seg(t, 1.2, 1.7));
      y += S * 0.05;
      const cw = bw / (sets.length + 1);
      const rh = S * 0.1;
      ctx.save();
      ctx.globalAlpha *= tp;
      ctx.fillStyle = 'rgba(10,11,16,0.75)';
      ctx.fillRect(x0, y, bw, rh * 3);
      label(g, 'SET', x0 + cw / 2, y + rh / 2, S * 0.03, 'rgba(255,255,255,0.6)', 'center', 800, 0.18);
      for (let i = 0; i < 2; i++) {
        if (!logoAt(g, logos[i], x0 + cw / 2, y + rh * (1.5 + i), rh * 0.62)) label(g, names[i].slice(0, 3).toUpperCase(), x0 + cw / 2, y + rh * (1.5 + i), S * 0.03, '#fff', 'center', 800, 0.1);
      }
      sets.forEach((s2, k) => {
        const cx = x0 + cw * (k + 1.5);
        label(g, String(k + 1), cx, y + rh / 2, S * 0.03, 'rgba(255,255,255,0.6)', 'center', 800, 0);
        for (let i = 0; i < 2; i++) {
          const mine = s2[i];
          const theirs = s2[1 - i];
          headline(g, String(mine), cx, y + rh * (1.5 + i) + rh * 0.24, rh * 0.62, { color: mine > theirs ? g.c2 : 'rgba(255,255,255,0.55)', shadow: false });
        }
      });
      ctx.restore();
      y += rh * 3;
    }
    const result = spec.text.result || '';
    if (result) {
      const rp = eExpo(seg(t, 1.5, 2.0));
      ctx.save();
      ctx.globalAlpha = rp;
      headline(g, result.toUpperCase(), W / 2, y + S * 0.16, fit(ctx, result.toUpperCase(), W * 0.88, S * 0.1), { color: '#fff', sheen: seg(t, 2.0, 2.9) });
      ctx.restore();
    }
    panelWipe(g, seg(t, g.d - 0.45, g.d + 0.15));
    return;
  }

  const bw = Math.min(W * 0.9, S * 1.45);
  const rowH = S * 0.13;
  const x0 = (W - bw) / 2;
  const y0 = top + S * 0.09;
  const setCol = rowH * 0.85;
  for (let i = 0; i < 2; i++) {
    const p = eExpo(seg(t, 0.3 + i * 0.15, 0.8 + i * 0.15));
    if (p <= 0) continue;
    const y = y0 + i * (rowH + S * 0.012);
    const win = totals[i] > totals[1 - i];
    ctx.save();
    ctx.translate((1 - p) * (i ? W : -W) * 0.5, 0);
    ctx.fillStyle = win ? shade(g.c1, -0.25) : 'rgba(20,22,30,0.92)';
    ctx.fillRect(x0, y, bw, rowH);
    if (win) {
      ctx.fillStyle = g.c2;
      ctx.fillRect(x0, y, S * 0.012, rowH);
    }
    if (!logoAt(g, logos[i], x0 + rowH * 0.62, y + rowH / 2, rowH * 0.72)) {
      ctx.fillStyle = i ? '#3a3d48' : g.c1;
      ctx.fillRect(x0 + rowH * 0.2, y + rowH * 0.15, rowH * 0.84, rowH * 0.7);
    }
    const setsW = sets.length * setCol;
    const nameMax = bw - rowH * 1.3 - setsW - rowH * 1.3;
    headline(g, names[i].toUpperCase(), x0 + rowH * 1.3, y + rowH * 0.68, fit(ctx, names[i].toUpperCase(), nameMax, rowH * 0.5), { align: 'left', shadow: false });
    sets.forEach((s2, k) => {
      const mine = s2[i];
      const theirs = s2[1 - i];
      const sx = x0 + bw - rowH * 1.3 - setsW + k * setCol + setCol / 2;
      const sp = seg(t, 0.8 + k * 0.1, 1.1 + k * 0.1);
      ctx.save();
      ctx.globalAlpha *= sp;
      headline(g, String(mine), sx, y + rowH * 0.66, rowH * 0.42, { color: mine > theirs ? '#ffffff' : 'rgba(255,255,255,0.45)', shadow: false });
      ctx.restore();
    });
    ctx.fillStyle = win ? g.c2 : 'rgba(255,255,255,0.1)';
    ctx.fillRect(x0 + bw - rowH * 1.2, y, rowH * 1.2, rowH);
    const cp = eBack(seg(t, 1.2, 1.6));
    ctx.save();
    ctx.translate(x0 + bw - rowH * 0.6, y + rowH * 0.78);
    ctx.scale(Math.max(0.01, cp), Math.max(0.01, cp));
    headline(g, String(totals[i]), 0, 0, rowH * 0.8, { color: win ? g.ink : '#fff', shadow: false });
    ctx.restore();
    ctx.restore();
  }
  sets.forEach((_, k) => {
    const sx = x0 + bw - rowH * 1.3 - sets.length * setCol + k * setCol + setCol / 2;
    label(g, `S${k + 1}`, sx, y0 - S * 0.022, S * 0.022, 'rgba(255,255,255,0.6)', 'center', 800, 0.1);
  });
  const result = spec.text.result || '';
  if (result) {
    const rp = eExpo(seg(t, 1.5, 2.0));
    const y = y0 + 2 * rowH + S * 0.13;
    const rs = fit(ctx, result.toUpperCase(), W * 0.86, S * 0.075);
    ctx.save();
    ctx.globalAlpha = rp;
    headline(g, result.toUpperCase(), W / 2, y, rs, { color: '#fff', sheen: seg(t, 2.0, 2.9) });
    ctx.restore();
  }
  panelWipe(g, seg(t, g.d - 0.45, g.d + 0.15));
}

/** Closer: logo lockup in a light burst, big line, details, then a fade to black. */
function drawCloser(g: G) {
  const { ctx, W, H, S, t, portrait, spec } = g;
  const tx = spec.text;
  backdrop(g);
  // Rotating light rays behind the logo.
  const cy = portrait ? H * 0.38 : H * 0.33;
  ctx.save();
  ctx.translate(W / 2, cy);
  ctx.rotate(t * 0.15);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    ctx.rotate((Math.PI * 2) / 14);
    const gr = ctx.createLinearGradient(0, 0, S, 0);
    gr.addColorStop(0, rgba(g.c2, 0.22));
    gr.addColorStop(1, rgba(g.c2, 0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(S * 1.2, -S * 0.07);
    ctx.lineTo(S * 1.2, S * 0.07);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const hasLogo = logoSlam(g, spec.logo, W / 2, cy, S * 0.32, 0.15);
  const top = (tx.kicker || '').toUpperCase();
  const big = (tx.title || '').toUpperCase();
  let y = hasLogo ? cy + S * 0.3 : H * 0.42;
  if (top) {
    headline(g, top, W / 2, y, S * 0.065, { color: g.c2, reveal: seg(t, 0.5, 0.9) });
    y += S * 0.12;
  }
  const bs = fit(ctx, big, W * 0.88, S * (portrait ? 0.16 : 0.14));
  headline(g, big, W / 2, y + bs * 0.4, bs, { reveal: seg(t, 0.65, 1.15), sheen: seg(t, 1.4, 2.3) });
  y += bs * 0.4 + S * 0.08;
  const lines = (tx.sub || '').split('\n').filter(Boolean);
  lines.forEach((l, i) => {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 1.0 + i * 0.12, 1.5 + i * 0.12));
    const ls = fit(ctx, l, W * 0.86, S * 0.036, 600, SANS);
    label(g, l, W / 2, y + i * ls * 1.6, ls, '#e5e7eb', 'center', 600, 0.04);
    ctx.restore();
  });
  // Fade to black at the very end.
  const fade = seg(t, g.d - 0.6, g.d);
  if (fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${eInOut(fade)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

const DRAW: Record<GraphicSpec['type'], (g: G) => void> = {
  open: drawOpen,
  stinger: drawStinger,
  lowerThird: drawLowerThird,
  scoreBug: drawScoreBug,
  playerCard: drawPlayerCard,
  stats: drawStats,
  roster: drawRoster,
  final: drawFinal,
  closer: drawCloser,
};

/** Graphics that fill the whole frame (the rest are overlays). */
export const FULL_FRAME: GraphicSpec['type'][] = ['open', 'playerCard', 'stats', 'roster', 'final', 'closer'];

/** Draws `clip`'s graphic at clip-local time `local` into a W x H frame. */
export function drawGraphic(ctx: CanvasRenderingContext2D, clip: Clip, local: number, W: number, H: number, img: ImageLookup, media: CanvasImageSource | null) {
  const spec = clip.graphic;
  if (!spec) return;
  const [c1, c2] = spec.colors;
  const g: G = {
    ctx,
    W,
    H,
    S: Math.min(W, H),
    portrait: H > W * 1.05,
    t: Math.max(0, local),
    d: Math.max(0.1, clip.duration),
    c1,
    c2,
    ink: inkFor(c2),
    spec,
    img,
    media,
  };
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  DRAW[spec.type](g);
  ctx.restore();
}
