/**
 * Broadcast motion graphics, drawn procedurally for each frame: title opens, stingers, lower thirds,
 * player cards, score bug, stat/roster/final boards and a closer. Everything is a pure function of
 * the clip's local time, so the preview and the export draw exactly the same frames.
 */
import qrcode from 'qrcode-generator';
import type { Clip, GraphicLook, GraphicSpec, TeleMark } from '../model/types';
import { drawLivePhoto, livePhotoLayers } from './livePhoto';

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
  look: GraphicLook;
  /** Brushed-gold fill for the championship look. */
  metal: CanvasGradient | null;
  img: ImageLookup;
  /** The clip's own media (player photo or clip), and its asset id. */
  media: CanvasImageSource | null;
  mediaId?: string;
  clipId: string;
}

/** The telestrator being drawn on: shown with every mark complete, so new strokes appear at once. */
let editingTele: string | null = null;
export function setTelestratorEditing(id: string | null) {
  editingTele = id;
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

/**
 * Settings of the look being drawn. Graphics draw synchronously, one at a time, so these are set
 * at the start of drawGraphic and every helper picks them up.
 */
let LOOK: GraphicLook = 'broadcast';
/** Headline family: condensed sports lettering, or clean sans for the classic look. */
let HEAD = DISPLAY;
/** How much plates lean (classic is square). */
let SKEW = 1;
/** Lighter drawing for smooth playback on phones: no soft shadows or light sweeps. Exports never use it. */
let LITE = false;
const soft = (blur: number) => (LITE ? 0 : blur);

function font(ctx: CanvasRenderingContext2D, size: number, weight = 900, family = HEAD) {
  // The classic look's sans is set a notch lighter than the display face.
  const w = family === SANS && weight === 900 && LOOK === 'classic' ? 800 : weight;
  ctx.font = `${w} ${Math.max(1, size)}px ${family}`;
}

/** Fill for accent plates and highlights: the team accent, or brushed gold. */
const accent = (g: G) => (g.metal ?? g.c2);

/** Largest size (up to `max`) at which `text` fits in `maxW`, allowing for letter spacing of `track` em. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, max: number, weight = 900, family = HEAD, track = 0) {
  font(ctx, max, weight, family);
  const w = ctx.measureText(text).width + text.length * max * track;
  return w <= maxW ? max : Math.max(8, (max * maxW) / w);
}

function tracking(ctx: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Parallelogram leaning right by `skew` px over its height. */
function para(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, skew: number) {
  skew *= SKEW;
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
  const family = opts.family ?? HEAD;
  font(ctx, size, opts.weight ?? 900, family);
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
  const color = opts.color ?? '#fff';
  if (opts.shadow !== false) {
    if (LOOK === 'neon') {
      // Neon tubes: a coloured glow around bright lettering.
      ctx.shadowColor = rgba(g.c2, 0.95);
      ctx.shadowBlur = soft(size * 0.28);
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = soft(size * 0.12);
      ctx.shadowOffsetY = size * 0.04;
    }
  }
  const stroke = opts.stroke ?? (LOOK === 'championship' && size > g.S * 0.09 && color === '#fff' ? '#e8c35a' : undefined);
  if (stroke) {
    ctx.lineWidth = Math.max(1, size * 0.035);
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, left, y + rise);
  }
  if (g.metal && color === g.c2) {
    // Gold lettering: a vertical sheen across this line of text.
    const gr = ctx.createLinearGradient(0, y + rise - size * 0.8, 0, y + rise + size * 0.1);
    gr.addColorStop(0, '#fff6d1');
    gr.addColorStop(0.45, '#e9bf4f');
    gr.addColorStop(0.55, '#b8861c');
    gr.addColorStop(1, '#f5d77a');
    ctx.fillStyle = gr;
  } else {
    ctx.fillStyle = color;
  }
  ctx.fillText(text, left, y + rise);
  if (LOOK === 'neon' && opts.shadow !== false) {
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, size * 0.018);
    ctx.strokeStyle = rgba(g.c2, 0.9);
    ctx.strokeText(text, left, y + rise);
  }
  ctx.restore();
  const sheen = opts.sheen;
  if (sheen !== undefined && sheen > 0 && sheen < 1 && !LITE) {
    // Light only where the letters are: draw them into a scratch canvas, sweep a band through.
    const pad = size * 0.3;
    const sw = w + pad * 2;
    const sh = h + pad * 2;
    const { canvas, c } = scratchCanvas(sw, sh);
    font(c, size, opts.weight ?? 900, family);
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

/** The moving backdrop of full-screen graphics, in the style of the look. */
function backdrop(g: G, strength = 1) {
  if (g.look === 'neon') return neonBackdrop(g);
  if (g.look === 'classic') return classicBackdrop(g);
  if (g.look === 'championship') return championshipBackdrop(g);
  broadcastBackdrop(g, strength);
}

/** Classic: a quiet studio gradient with a single accent rule. */
function classicBackdrop(g: G) {
  const { ctx, W, H, S, c1 } = g;
  const gr = ctx.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, shade(c1, -0.55));
  gr.addColorStop(1, shade(c1, -0.8));
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
  const rg = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, S);
  rg.addColorStop(0, 'rgba(255,255,255,0.07)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = g.c2;
  ctx.fillRect(0, H - S * 0.012, W, S * 0.012);
}

/** Neon: black with a perspective grid racing toward the viewer and a glowing horizon. */
function neonBackdrop(g: G) {
  const { ctx, W, H, S, t, c1, c2 } = g;
  ctx.fillStyle = '#04050a';
  ctx.fillRect(0, 0, W, H);
  const horizon = H * 0.62;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, rgba(c1, 0.25));
  sky.addColorStop(1, rgba(c2, 0.18));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);
  ctx.save();
  ctx.strokeStyle = rgba(c2, 0.55);
  ctx.shadowColor = rgba(c2, 0.9);
  ctx.shadowBlur = soft(S * 0.012);
  ctx.lineWidth = Math.max(1, S * 0.0025);
  // Floor lines fanning out from the vanishing point.
  for (let i = -12; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * W * 0.012, horizon);
    ctx.lineTo(W / 2 + i * W * 0.22, H);
    ctx.stroke();
  }
  // Cross lines moving toward the viewer.
  for (let i = 0; i < 12; i++) {
    const k = (i + ((t * 0.9) % 1)) / 12;
    const y = horizon + (H - horizon) * k * k;
    ctx.globalAlpha = k;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = c2;
  ctx.shadowColor = c2;
  ctx.shadowBlur = soft(S * 0.04);
  ctx.fillRect(0, horizon - 1, W, Math.max(2, S * 0.003));
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 0; y < H; y += Math.max(3, S * 0.005)) ctx.fillRect(0, y, W, 1);
}

/** Championship: dark arena, a gold spotlight from above, slow rays and twinkling sparks. */
function championshipBackdrop(g: G) {
  const { ctx, W, H, S, t, c1 } = g;
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, shade(c1, -0.7));
  base.addColorStop(1, '#07060a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const spot = ctx.createRadialGradient(W / 2, -H * 0.1, 0, W / 2, -H * 0.1, Math.hypot(W, H) * 0.75);
  spot.addColorStop(0, 'rgba(255,214,120,0.38)');
  spot.addColorStop(0.5, 'rgba(255,190,80,0.08)');
  spot.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, -H * 0.1);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const a = -0.5 + i * 0.17 + Math.sin(t * 0.4 + i) * 0.03;
    ctx.save();
    ctx.rotate(Math.PI / 2 + a);
    const gr = ctx.createLinearGradient(0, 0, Math.hypot(W, H), 0);
    gr.addColorStop(0, 'rgba(255,220,140,0.12)');
    gr.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.hypot(W, H), -S * 0.08);
    ctx.lineTo(Math.hypot(W, H), S * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // Sparks drifting up and twinkling.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i++) {
    const x = hash(i) * W;
    const y = H - ((hash(i + 50) * H + t * S * (0.03 + hash(i + 7) * 0.05)) % H);
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (2 + hash(i + 3) * 3) + i));
    const r = S * (0.002 + hash(i + 9) * 0.004);
    ctx.fillStyle = `rgba(255,224,150,${0.75 * tw})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  const v = ctx.createRadialGradient(W / 2, H / 2, S * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

/** Broadcast: team gradient, drifting light bands, halftone, scan lines. */
function broadcastBackdrop(g: G, strength = 1) {
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
  if (g.look === 'classic') return;
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
    ctx.shadowBlur = soft(size * 0.25 * glow);
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
  if (g.look === 'classic') {
    // Understated: a gentle rise into place.
    const k = eOut(seg(g.t, start, start + 0.8));
    return logoAt(g, id, cx, cy + (1 - k) * size * 0.08, size * lerp(0.94, 1, k), k, 0);
  }
  if (g.look === 'championship') {
    // Anamorphic flare as the logo lands.
    const f = seg(g.t, start + 0.2, start + 1.4);
    if (f > 0 && f < 1) {
      const a = Math.sin(f * Math.PI);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createLinearGradient(cx - g.W * 0.6, 0, cx + g.W * 0.6, 0);
      gr.addColorStop(0, 'rgba(255,210,120,0)');
      gr.addColorStop(0.5, `rgba(255,236,190,${0.8 * a})`);
      gr.addColorStop(1, 'rgba(255,210,120,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(cx - g.W * 0.6, cy - g.S * 0.006, g.W * 1.2, g.S * 0.012);
      for (const [k, r] of [
        [0.35, 0.05],
        [-0.25, 0.03],
        [0.6, 0.02],
      ]) {
        ctx.fillStyle = `rgba(255,220,150,${0.25 * a})`;
        ctx.beginPath();
        ctx.arc(cx + g.W * k * (f - 0.5) * 2, cy + g.S * k * 0.1, g.S * r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
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
  const { ctx, W, H, c1 } = g;
  if (g.look === 'classic') {
    ctx.fillStyle = shade(c1, -0.85, eInOut(p));
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const sk = H * 0.35;
  const span = W + sk * 2;
  const a = eInOut(p);
  for (const [i, col] of [
    [0, accent(g)],
    [1, g.look === 'neon' ? '#04050a' : shade(c1, -0.2)],
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
    ctx.fillStyle = accent(g);
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
    ctx.fillStyle = accent(g);
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
  const sk = H * 0.4 * SKEW;
  const bars: [string | CanvasGradient, number][] =
    g.look === 'classic'
      ? [[shade(c1, -0.45), 0]]
      : g.look === 'neon'
        ? [
            [c2, 0],
            ['#04050a', 0.07],
            [shade(c1, -0.6), 0.14],
          ]
        : [
            [accent(g), 0],
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
    ctx.fillStyle = accent(g);
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
  ctx.shadowBlur = soft(rowH * 0.5);
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
    ctx.fillStyle = lead ? accent(g) : 'rgba(255,255,255,0.08)';
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
  label(g, tx.periodLabel || 'SET', x + w - setW / 2, y + h * 0.3, rowH * 0.36, rgba(g.c2, 1), 'center', 800, 0.2);
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
    ctx.shadowBlur = soft(S * 0.05);
    ctx.drawImage(media, cx - dw / 2, bottom - dh + rise, dw, dh);
    ctx.restore();
  } else if (open > 0) {
    // Angled window that wipes open with a bright leading edge.
    ctx.save();
    const ww = win.w * open;
    para(ctx, win.x + (portrait ? 0 : win.w - ww), win.y, ww + win.sk, win.h, win.sk);
    ctx.clip();
    if (media) {
      // A living photo moves through its depth layers; otherwise a slow push on the flat photo.
      const depth = spec.depth && !spec.still && !(media instanceof HTMLVideoElement) ? g.img(spec.depth) : null;
      const live = depth && g.mediaId ? livePhotoLayers(`${g.mediaId}|${spec.depth}`, media, depth) : null;
      if (live) drawLivePhoto(ctx, live, win.x, win.y, win.w + win.sk, win.h, clamp01(t / g.d));
      else cover(ctx, media, win.x, win.y, win.w + win.sk, win.h, lerp(1.12, 1.0, eOut(seg(t, 0, g.d))));
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
      ctx.fillStyle = accent(g);
      const ex = portrait ? win.x + ww : win.x + win.w - ww;
      para(ctx, ex - S * 0.008, win.y, S * 0.016, win.h, win.sk);
      ctx.fill();
    } else {
      ctx.fillStyle = accent(g);
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
    ctx.fillStyle = accent(g);
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
  // An occasion ("PLAYER OF THE GAME") on a plate: over the foot of the photo on a tall card, above the name on a wide one.
  const kick = (tx.kicker || '').toUpperCase();
  if (kick) {
    const kp = eExpo(seg(t, 0.9, 1.35));
    const ks = fit(ctx, kick, W * (portrait ? 0.62 : 0.36), S * (portrait ? 0.05 : 0.045), 900, SANS, 0.16);
    font(ctx, ks, 900, SANS);
    tracking(ctx, ks * 0.16);
    const kw = ctx.measureText(kick).width + ks * 2.2;
    tracking(ctx, 0);
    const kx = portrait ? W / 2 - kw / 2 : W * 0.07;
    // Tall: a banner across the foot of the photo, clear of the logo in the corner.
    const ky = portrait ? H * 0.6 - ks * 1.7 : H * 0.13;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = soft(ks);
    ctx.fillStyle = accent(g);
    para(ctx, kx, ky - ks, kw * kp, ks * 2, ks * 0.45);
    ctx.fill();
    ctx.restore();
    if (kp > 0.7) label(g, kick, kx + ks * 1.1, ky + ks * 0.05, ks, g.ink, 'left', 900, 0.16);
  }
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
  ctx.fillStyle = accent(g);
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
    ctx.fillStyle = accent(g);
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
    ctx.fillStyle = accent(g);
    ctx.fillRect(0, th * 0.78, tw, Math.max(2, th * 0.015));
    const nm = (pl.name || '').toUpperCase();
    const last = nm.split(/\s+/).slice(-1)[0] || nm;
    headline(g, last, tw / 2, th * 0.95, fit(ctx, last, tw * 0.86, th * 0.13), { color: '#fff', shadow: false });
    if (pl.number) {
      const bs = tw * 0.26;
      ctx.fillStyle = accent(g);
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
  // Sets won, or total points (goals, runs) over the periods.
  const [won, lost] =
    spec.scoring === 'points'
      ? sets.reduce<[number, number]>(([x, y], [a, b]) => [x + a, y + b], [0, 0])
      : [sets.filter(([a, b]) => a > b).length, sets.filter(([a, b]) => b > a).length];
  const prefix = spec.text.periodPrefix ?? 'S';
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
          ctx.fillStyle = accent(g);
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
        ctx.fillStyle = win ? accent(g) : 'rgba(255,255,255,0.1)';
        ctx.fillRect(x0 + bw - bh * 0.95, y, bh * 0.95, bh);
        const cp = eBack(seg(t, 1.1, 1.5));
        ctx.save();
        ctx.translate(x0 + bw - bh * 0.475, y + bh * 0.78);
        ctx.scale(Math.max(0.01, cp), Math.max(0.01, cp));
        headline(g, String(totals[i]), 0, 0, fit(ctx, String(totals[i]), bh * 0.8, bh * 0.75), { color: win ? g.ink : '#fff', shadow: false });
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
      label(g, spec.text.periodLabel || (prefix === 'S' ? 'SET' : prefix || 'INN'), x0 + cw / 2, y + rh / 2, S * 0.03, 'rgba(255,255,255,0.6)', 'center', 800, 0.18);
      for (let i = 0; i < 2; i++) {
        if (!logoAt(g, logos[i], x0 + cw / 2, y + rh * (1.5 + i), rh * 0.62)) label(g, names[i].slice(0, 3).toUpperCase(), x0 + cw / 2, y + rh * (1.5 + i), S * 0.03, '#fff', 'center', 800, 0.1);
      }
      sets.forEach((s2, k) => {
        const cx = x0 + cw * (k + 1.5);
        label(g, String(k + 1), cx, y + rh / 2, S * 0.03, 'rgba(255,255,255,0.6)', 'center', 800, 0);
        for (let i = 0; i < 2; i++) {
          const mine = s2[i];
          const theirs = s2[1 - i];
          headline(g, String(mine), cx, y + rh * (1.5 + i) + rh * 0.24, Math.min(rh * 0.62, cw * 0.8), { color: mine > theirs ? g.c2 : 'rgba(255,255,255,0.55)', shadow: false });
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
  // Many periods (innings) get narrower columns so the names keep their room.
  const setCol = Math.min(rowH * 0.85, (bw * 0.5) / Math.max(1, sets.length));
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
      ctx.fillStyle = accent(g);
      ctx.fillRect(x0, y, S * 0.012, rowH);
    }
    if (!logoAt(g, logos[i], x0 + rowH * 0.62, y + rowH / 2, rowH * 0.72)) {
      ctx.fillStyle = i ? '#3a3d48' : g.c1;
      ctx.fillRect(x0 + rowH * 0.2, y + rowH * 0.15, rowH * 0.84, rowH * 0.7);
    }
    const setsW = sets.length * setCol;
    const nameMax = bw - rowH * 1.3 - setsW - rowH * 1.3 - rowH * 0.35;
    headline(g, names[i].toUpperCase(), x0 + rowH * 1.3, y + rowH * 0.68, fit(ctx, names[i].toUpperCase(), nameMax, rowH * 0.5), { align: 'left', shadow: false });
    sets.forEach((s2, k) => {
      const mine = s2[i];
      const theirs = s2[1 - i];
      const sx = x0 + bw - rowH * 1.3 - setsW + k * setCol + setCol / 2;
      const sp = seg(t, 0.8 + k * 0.1, 1.1 + k * 0.1);
      ctx.save();
      ctx.globalAlpha *= sp;
      headline(g, String(mine), sx, y + rowH * 0.66, Math.min(rowH * 0.42, setCol * 0.75), { color: mine > theirs ? '#ffffff' : 'rgba(255,255,255,0.45)', shadow: false });
      ctx.restore();
    });
    ctx.fillStyle = win ? accent(g) : 'rgba(255,255,255,0.1)';
    ctx.fillRect(x0 + bw - rowH * 1.2, y, rowH * 1.2, rowH);
    const cp = eBack(seg(t, 1.2, 1.6));
    ctx.save();
    ctx.translate(x0 + bw - rowH * 0.6, y + rowH * 0.78);
    ctx.scale(Math.max(0.01, cp), Math.max(0.01, cp));
    headline(g, String(totals[i]), 0, 0, fit(ctx, String(totals[i]), rowH * 1.05, rowH * 0.8), { color: win ? g.ink : '#fff', shadow: false });
    ctx.restore();
    ctx.restore();
  }
  sets.forEach((_, k) => {
    const sx = x0 + bw - rowH * 1.3 - sets.length * setCol + k * setCol + setCol / 2;
    label(g, `${prefix}${k + 1}`, sx, y0 - S * 0.022, S * 0.022, 'rgba(255,255,255,0.6)', 'center', 800, 0.1);
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
  // Rotating light rays behind the logo (not in the understated classic look).
  const cy = portrait ? H * 0.38 : H * 0.33;
  ctx.save();
  if (g.look === 'classic') ctx.globalAlpha = 0;
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

/**
 * Instant replay: a wipe in team colours with REPLAY across it covers the cut back into the
 * action, then a REPLAY bug with a blinking dot sits in the corner until a quick wipe out.
 */
function drawReplay(g: G) {
  const { ctx, W, H, S, t, d, c1 } = g;
  const sk = H * 0.4 * SKEW;
  // In: fully covered at 0.35s (where the cut is), clear by 0.75s.
  const bars: [string | CanvasGradient, number][] =
    g.look === 'classic'
      ? [[shade(c1, -0.45), 0]]
      : [
          [accent(g), 0],
          ['#ffffff', 0.05],
          [shade(c1, -0.35), 0.1],
        ];
  for (const [col, lag] of bars) {
    const inK = eInOut(clamp01((t - lag) / 0.33));
    const outK = eInOut(clamp01((t - 0.4 - lag * 0.6) / 0.33));
    const lead = lerp(W + sk, -sk, inK);
    const tail = lerp(W + sk * 2, -sk, outK);
    if (tail <= lead) continue;
    ctx.fillStyle = col;
    para(ctx, lead - sk, 0, tail - lead + sk, H, sk);
    ctx.fill();
  }
  const peak = 1 - Math.abs(t - 0.36) / 0.2;
  if (peak > 0) {
    ctx.save();
    ctx.globalAlpha = clamp01(peak * 2);
    const size = fit(ctx, 'REPLAY', W * 0.8, S * (g.portrait ? 0.2 : 0.22));
    headline(g, 'REPLAY', W / 2, H / 2 + size * 0.33, size, { color: '#fff' });
    ctx.restore();
  }
  // Corner bug.
  const bin = eExpo(seg(t, 0.75, 1.15));
  const bout = eInOut(seg(t, d - 0.45, d - 0.15));
  const k = bin * (1 - bout);
  if (k > 0) {
    const fs = S * 0.034;
    const x = S * 0.05;
    const y = g.portrait ? H * 0.06 : S * 0.06;
    font(ctx, fs, 900);
    tracking(ctx, fs * 0.16);
    const tw = ctx.measureText('REPLAY').width;
    tracking(ctx, 0);
    const bw = tw + fs * 3.1;
    const bh = fs * 1.7;
    ctx.save();
    ctx.globalAlpha *= k;
    ctx.fillStyle = shade(c1, -0.25, 0.92);
    para(ctx, x - (1 - k) * bw * 0.4, y, bw, bh, bh * 0.35 * SKEW);
    ctx.fill();
    ctx.fillStyle = accent(g);
    para(ctx, x - (1 - k) * bw * 0.4, y + bh - Math.max(2, fs * 0.12), bw, Math.max(2, fs * 0.12), 0);
    ctx.fill();
    // Blinking dot, as on a broadcast.
    const blink = Math.sin(t * Math.PI * 2.2) > -0.3 ? 1 : 0.25;
    ctx.fillStyle = `rgba(239, 68, 68, ${blink})`;
    ctx.beginPath();
    ctx.arc(x + fs * 0.95, y + bh / 2, fs * 0.28, 0, Math.PI * 2);
    ctx.fill();
    label(g, 'REPLAY', x + fs * 1.6, y + bh / 2 + fs * 0.36, fs, '#fff', 'left', 900, 0.16);
    const tag = (g.spec.text.tag || '').toUpperCase();
    if (tag) {
      const ts = fs * 0.62;
      label(g, tag, x + fs * 0.35, y + bh + ts * 1.5, ts, '#fff', 'left', 800, 0.18);
    }
    ctx.restore();
  }
}

/** Where a mark has got to after `p` (0..1) of drawing it, as a list of points in pixels. */
function partialPolyline(pts: [number, number][], p: number): [number, number][] {
  if (pts.length < 2 || p >= 1) return pts;
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(l);
    total += l;
  }
  let left = total * p;
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (left >= lens[i - 1]) {
      out.push(pts[i]);
      left -= lens[i - 1];
      continue;
    }
    const k = lens[i - 1] ? left / lens[i - 1] : 0;
    out.push([lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]);
    break;
  }
  return out;
}

/** The pixel path a mark traces (circles as a slightly overshooting hand-drawn loop). */
export function markPath(kind: TeleMark['kind'], pts: [number, number][], W: number, H: number): [number, number][] {
  const px = pts.map(([x, y]) => [x * W, y * H] as [number, number]);
  if (kind === 'circle' && px.length >= 2) {
    const [[cx, cy], [ex, ey]] = px;
    const r = Math.max(4, Math.hypot(ex - cx, ey - cy));
    const out: [number, number][] = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2.12;
      // A touch flatter than round, and the loop spirals in slightly, like a pen stroke.
      const rr = r * (1 - 0.06 * (i / n));
      out.push([cx + Math.cos(a) * rr * 1.08, cy + Math.sin(a) * rr * 0.92]);
    }
    return out;
  }
  if ((kind === 'arrow' || kind === 'line') && px.length >= 2) return [px[0], px[px.length - 1]];
  return px;
}

/**
 * Telestrator: the analyst's pen. Each mark draws itself in turn with a glowing stroke, arrows
 * finish with a head, and everything fades at the end.
 */
function drawTelestrator(g: G) {
  const { ctx, W, H, S, t, d } = g;
  const marks = g.spec.marks ?? [];
  const editing = editingTele === g.clipId;
  const fade = editing ? 1 : 1 - eInOut(seg(t, d - 0.35, d));
  if (fade <= 0) return;
  const lw = S * 0.009;
  ctx.save();
  ctx.globalAlpha *= fade;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  marks.forEach((m, i) => {
    const p = editing ? 1 : eOut(seg(t, 0.2 + i * 0.5, 0.2 + i * 0.5 + (m.kind === 'pen' ? 0.6 : 0.4)));
    if (p <= 0) return;
    const path = partialPolyline(markPath(m.kind, m.pts, W, H), p);
    if (path.length < 2) return;
    const stroke = (width: number, color: string, blur: number) => {
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.shadowColor = m.color;
      ctx.shadowBlur = soft(blur);
      ctx.beginPath();
      ctx.moveTo(path[0][0], path[0][1]);
      for (let k = 1; k < path.length; k++) ctx.lineTo(path[k][0], path[k][1]);
      ctx.stroke();
    };
    stroke(lw * 1.6, rgba(m.color, 0.35), lw * 3);
    stroke(lw, m.color, lw * 1.5);
    stroke(lw * 0.35, 'rgba(255,255,255,0.85)', 0);
    if (m.kind === 'arrow' && p > 0.85) {
      const [ax, ay] = path[path.length - 2];
      const [bx, by] = path[path.length - 1];
      const ang = Math.atan2(by - ay, bx - ax);
      const hs = lw * 4.2 * eBack(seg(p, 0.85, 1));
      ctx.shadowBlur = soft(lw * 1.5);
      ctx.shadowColor = m.color;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(ang) * hs * 0.4, by + Math.sin(ang) * hs * 0.4);
      ctx.lineTo(bx + Math.cos(ang + 2.55) * hs, by + Math.sin(ang + 2.55) * hs);
      ctx.lineTo(bx + Math.cos(ang - 2.55) * hs, by + Math.sin(ang - 2.55) * hs);
      ctx.closePath();
      ctx.fill();
    }
  });
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Matchups, wins and awards

/** A five-pointed star centred at (cx, cy). */
function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot = 0, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** Text set around a circle, reading clockwise from `start` radians; `p` (0..1) draws it in. */
function arcText(g: G, text: string, cx: number, cy: number, r: number, size: number, start: number, p = 1, color = '#fff') {
  const { ctx } = g;
  font(ctx, size, 800, SANS);
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width + size * 0.12);
  const total = widths.reduce((a, b) => a + b, 0);
  // Spread evenly round the whole circle.
  const k = (Math.PI * 2 * r) / total;
  let a = start;
  const shown = Math.floor(chars.length * clamp01(p));
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < shown; i++) {
    const da = (widths[i] * k) / r;
    const mid = a + da / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(mid) * r, cy + Math.sin(mid) * r);
    ctx.rotate(mid + Math.PI / 2);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    a += da;
  }
  ctx.restore();
}

/** The same graphic state, drawn in another team's colours. */
function inColors(g: G, colors: [string, string]): G {
  const c2 = g.look === 'championship' ? g.c2 : colors[1];
  return { ...g, c1: colors[0], c2, ink: g.look === 'championship' ? g.ink : inkFor(c2) };
}

/** Initials of a team name, for a crest when there's no logo: "Westside Storm" -> "WS". */
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || name.trim().slice(0, 2).toUpperCase();

/** A team's logo slamming in, or a monogram crest in its colours when there isn't one. */
function crest(g: G, id: string | undefined, name: string, cx: number, cy: number, size: number, start: number) {
  if (id && g.img(id)) return logoSlam(g, id, cx, cy, size, start);
  const p = seg(g.t, start, start + 0.55);
  if (p <= 0) return false;
  const { ctx } = g;
  const s = g.look === 'classic' ? lerp(0.94, 1, eOut(p)) : lerp(1.7, 1, eBack(p));
  const r = size * 0.42 * s;
  ctx.save();
  ctx.globalAlpha *= clamp01(p * 3);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = soft(size * 0.12);
  const gr = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  gr.addColorStop(0, shade(g.c1, 0.15));
  gr.addColorStop(1, shade(g.c1, -0.45));
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = r * 0.09;
  ctx.strokeStyle = accent(g);
  ctx.stroke();
  ctx.lineWidth = r * 0.025;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.83, 0, Math.PI * 2);
  ctx.stroke();
  const ini = initials(name);
  headline(g, ini, cx, cy + r * 0.3, fit(ctx, ini, r * 1.3, r * 0.85), { color: '#fff', shadow: false });
  ctx.restore();
  return true;
}

/**
 * Versus title: the frame split on a diagonal, each team's half in its own colours with its logo
 * (or a crest), name and record, and VS slamming in where they meet.
 */
function drawVersus(g: G) {
  const { ctx, W, H, S, t, portrait, spec } = g;
  const tx = spec.text;
  const them = inColors(g, spec.oppColors ?? ['#3a3d48', '#e5e7eb']);
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, W, H);
  // The dividing line: across the middle, leaning.
  const lean = S * 0.17;
  const A: [number, number] = portrait ? [0, H / 2 + lean] : [W / 2 + lean, 0];
  const B: [number, number] = portrait ? [W, H / 2 - lean] : [W / 2 - lean, H];
  const halves: { gg: G; poly: [number, number][]; from: number; name: string; sub: string; logo?: string; at: [number, number]; start: number }[] = [
    {
      gg: g,
      poly: portrait ? [[0, 0], [W, 0], B, A] : [[0, 0], A, B, [0, H]],
      from: -1,
      name: tx.usName || 'HOME',
      sub: tx.usSub || '',
      logo: spec.logo,
      at: portrait ? [W / 2, H * 0.17] : [W * 0.25, H * 0.4],
      start: 0.45,
    },
    {
      gg: them,
      poly: portrait ? [A, B, [W, H], [0, H]] : [A, [W, 0], [W, H], B],
      from: 1,
      name: tx.themName || 'AWAY',
      sub: tx.themSub || '',
      logo: spec.oppLogo,
      at: portrait ? [W / 2, H * 0.83] : [W * 0.75, H * 0.4],
      start: 0.62,
    },
  ];
  const push = lerp(1.0, 1.04, clamp01(t / g.d));
  halves.forEach(({ gg, poly, from }, i) => {
    const p = eExpo(seg(t, 0.05 + i * 0.1, 0.65 + i * 0.1));
    if (p <= 0) return;
    ctx.save();
    ctx.translate((1 - p) * from * W, 0);
    ctx.beginPath();
    poly.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    ctx.clip();
    // Team colour field, lit from the crest.
    const [lx, ly] = halves[i].at;
    const rg = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.hypot(W, H) * 0.6 * push);
    rg.addColorStop(0, shade(gg.c1, 0.12));
    rg.addColorStop(0.55, shade(gg.c1, -0.35));
    rg.addColorStop(1, shade(gg.c1, -0.8));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
    // Fine diagonal stripes drifting along.
    if (g.look !== 'classic') {
      ctx.strokeStyle = rgba(gg.c2, 0.07);
      ctx.lineWidth = S * 0.012;
      const step = S * 0.05;
      const drift = (t * S * 0.03 * (i ? -1 : 1)) % step;
      for (let x = -H; x < W + H; x += step) {
        ctx.beginPath();
        ctx.moveTo(x + drift, 0);
        ctx.lineTo(x + drift - H * 0.6, H);
        ctx.stroke();
      }
    }
    // Giant initials watermark.
    const ini = initials(halves[i].name);
    ctx.globalAlpha = 0.08;
    font(ctx, S * 0.62, 900);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(ini, lx + (i ? 1 : -1) * S * 0.12 * (1 - push + 1), ly + S * 0.05);
    ctx.restore();
  });
  if (g.look !== 'classic') streaks(g, H * 0.1, H * 0.9, 5, 0.35);
  // Crests, names and records.
  halves.forEach(({ gg, name, sub, logo, at: [cx, cy], start }, i) => {
    const size = S * (portrait ? 0.32 : 0.3);
    crest(gg, logo, name, cx, cy, size, start);
    const nm = name.toUpperCase();
    const ns = fit(ctx, nm, portrait ? W * 0.84 : W * 0.4, S * (portrait ? 0.12 : 0.1));
    const ny = portrait ? (i ? cy - size * 0.62 - S * 0.03 : cy + size * 0.62 + ns * 0.95) : cy + size * 0.62 + ns * 0.95;
    headline(gg, nm, cx, ny, ns, { reveal: seg(t, start + 0.35, start + 0.85), sheen: seg(t, 1.6 + i * 0.2, 2.4 + i * 0.2) });
    if (sub) {
      ctx.save();
      ctx.globalAlpha = eOut(seg(t, start + 0.6, start + 1.1));
      const ss = fit(ctx, sub.toUpperCase(), portrait ? W * 0.8 : W * 0.38, S * 0.036, 700, SANS, 0.14);
      label(gg, sub.toUpperCase(), cx, portrait && i ? ny - ns * 1.05 : ny + ss * 1.6, ss, rgba('#ffffff', 0.85), 'center', 700, 0.14);
      ctx.restore();
    }
  });
  // The seam: a bright line drawn along the split.
  const lp = eExpo(seg(t, 0.55, 1.0));
  if (lp > 0) {
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, S * 0.008);
    ctx.shadowColor = rgba(g.c2, 0.9);
    ctx.shadowBlur = soft(S * 0.03);
    const mx = (A[0] + B[0]) / 2;
    const my = (A[1] + B[1]) / 2;
    ctx.beginPath();
    ctx.moveTo(lerp(mx, A[0], lp), lerp(my, A[1], lp));
    ctx.lineTo(lerp(mx, B[0], lp), lerp(my, B[1], lp));
    ctx.stroke();
    ctx.restore();
  }
  // VS badge.
  const vp = seg(t, 0.85, 1.25);
  if (vp > 0) {
    const r = S * (portrait ? 0.11 : 0.1) * (g.look === 'classic' ? lerp(0.9, 1, eOut(vp)) : lerp(1.8, 1, eBack(vp)));
    const ring = seg(t, 1.0, 1.7);
    ctx.save();
    if (ring > 0 && ring < 1 && g.look !== 'classic') {
      ctx.strokeStyle = rgba('#ffffff', 0.8 * (1 - ring));
      ctx.lineWidth = S * 0.01 * (1 - ring);
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r * (1 + ring * 2.2), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha *= clamp01(vp * 3);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = soft(r * 0.4);
    ctx.fillStyle = '#0b0c12';
    ctx.fillRect(-r * 0.78, -r * 0.78, r * 1.56, r * 1.56);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = accent(g);
    ctx.lineWidth = r * 0.1;
    ctx.strokeRect(-r * 0.78, -r * 0.78, r * 1.56, r * 1.56);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= clamp01(vp * 3);
    headline(g, 'VS', W / 2, H / 2 + r * 0.3, r * 0.85, { color: '#fff', shadow: false, sheen: seg(t, 1.3, 2.0) });
    ctx.restore();
  }
  // Kicker on top, details along the bottom.
  const kick = (tx.kicker || '').toUpperCase();
  if (kick) {
    const kp = eExpo(seg(t, 1.1, 1.5));
    const ks = S * 0.04;
    font(ctx, ks, 800, SANS);
    tracking(ctx, ks * 0.2);
    const kw = ctx.measureText(kick).width + ks * 2.4;
    tracking(ctx, 0);
    const ky = portrait ? H * 0.05 : H * 0.08;
    ctx.fillStyle = accent(g);
    para(ctx, W / 2 - (kw * kp) / 2 - ks * 0.2, ky - ks * 0.95, kw * kp, ks * 1.9, ks * 0.4);
    ctx.fill();
    if (kp > 0.6) label(g, kick, W / 2, ky, ks, g.ink, 'center', 800, 0.2);
  }
  const sub = (tx.sub || '').toUpperCase();
  if (sub) {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 1.4, 1.9));
    const ss = fit(ctx, sub, W * 0.86, S * 0.034, 700, SANS, 0.16);
    const sy = portrait ? H * 0.955 : H * 0.92;
    ctx.fillStyle = 'rgba(5,6,10,0.65)';
    ctx.fillRect(0, sy - ss * 1.3, W, ss * 2.6);
    label(g, sub, W / 2, sy, ss, '#fff', 'center', 700, 0.16);
    ctx.restore();
  }
  panelWipe(g, seg(t, g.d - 0.5, g.d + 0.15));
}

/** Confetti falling through the frame from `start`: deterministic, so every frame matches the export. */
function confetti(g: G, start: number, count: number) {
  const { ctx, W, H, S, t, c1, c2 } = g;
  const tt = t - start;
  if (tt <= 0) return;
  const colors = [c2, '#ffffff', shade(c1, 0.4), g.look === 'neon' ? c2 : '#f5d77a'];
  ctx.save();
  for (let i = 0; i < count; i++) {
    const delay = hash(i + 3) * 1.6;
    const life = tt - delay;
    if (life <= 0) continue;
    const speed = H * (0.16 + hash(i + 9) * 0.18);
    const y = -S * 0.05 + life * speed;
    if (y > H + S * 0.05) continue;
    const x = hash(i) * W + Math.sin(life * (1.5 + hash(i + 4) * 2) + i) * S * 0.04;
    const spin = life * (4 + hash(i + 6) * 6) + i;
    const w = S * (0.008 + hash(i + 8) * 0.008);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin * 0.4);
    ctx.scale(1, Math.cos(spin));
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-w, -w * 0.5, w * 2, w);
    ctx.restore();
  }
  ctx.restore();
}

/** The win: VICTORY slams in over light rays, the final score lands between the logos, confetti falls. */
function drawVictory(g: G) {
  const { ctx, W, H, S, t, portrait, spec } = g;
  const tx = spec.text;
  backdrop(g);
  const cy = portrait ? H * 0.47 : H * 0.5;
  // Light rays from behind the title.
  if (g.look !== 'classic') {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 0.35, 0.9));
    ctx.translate(W / 2, cy);
    ctx.rotate(t * 0.12);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 18; i++) {
      ctx.rotate((Math.PI * 2) / 18);
      const gr = ctx.createLinearGradient(0, 0, S * 1.3, 0);
      gr.addColorStop(0, rgba(g.c2, 0.3));
      gr.addColorStop(1, rgba(g.c2, 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(S * 1.4, -S * 0.06);
      ctx.lineTo(S * 1.4, S * 0.06);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // A jolt as the title lands.
  const shake = 1 - seg(t, 0.5, 0.85);
  ctx.save();
  if (shake < 1 && shake > 0 && g.look !== 'classic') ctx.translate((hash(Math.floor(t * 60)) - 0.5) * S * 0.025 * shake, (hash(Math.floor(t * 60) + 1) - 0.5) * S * 0.025 * shake);
  const logoY = portrait ? H * 0.2 : H * 0.14;
  logoSlam(g, spec.logo, W / 2, logoY, S * (portrait ? 0.28 : 0.17), 0.1);
  const title = (tx.title || 'VICTORY').toUpperCase();
  const ts = fit(ctx, title, W * 0.9, S * (portrait ? 0.26 : 0.2));
  const tp = seg(t, 0.35, 0.7);
  if (tp > 0) {
    const s = g.look === 'classic' ? lerp(0.92, 1, eOut(tp)) : lerp(2.2, 1, eOut(tp));
    ctx.save();
    ctx.globalAlpha *= clamp01(tp * 2.5);
    ctx.translate(W / 2, cy + ts * 0.35);
    ctx.scale(s, s);
    headline(g, title, 0, 0, ts, { color: g.metal ? g.c2 : '#fff', sheen: seg(t, 1.3, 2.2), stroke: g.look === 'broadcast' ? g.c2 : undefined });
    ctx.restore();
  }
  // Kicker above the title.
  const kick = (tx.kicker || '').toUpperCase();
  if (kick) {
    const kp = eExpo(seg(t, 0.75, 1.1));
    const ks = S * 0.042;
    font(ctx, ks, 800, SANS);
    tracking(ctx, ks * 0.2);
    const kw = ctx.measureText(kick).width + ks * 2.4;
    tracking(ctx, 0);
    const ky = cy - ts * 0.75 - ks * 0.6;
    ctx.fillStyle = accent(g);
    para(ctx, W / 2 - kw / 2 - ks * 0.2, ky - ks * 0.95, kw * kp, ks * 1.9, ks * 0.4);
    ctx.fill();
    if (kp > 0.6) label(g, kick, W / 2, ky, ks, g.ink, 'center', 800, 0.2);
  }
  ctx.restore();
  // Final score between the two logos.
  const score = tx.score || '';
  let y = cy + ts * 0.35 + S * (portrait ? 0.2 : 0.15);
  if (score) {
    const sp = eBack(seg(t, 1.0, 1.4));
    const ss = S * (portrait ? 0.16 : 0.13);
    if (sp > 0) {
      ctx.save();
      ctx.translate(W / 2, y);
      ctx.scale(Math.max(0.01, sp), Math.max(0.01, sp));
      headline(g, score.replace('-', ' – '), 0, ss * 0.35, ss, { color: g.c2, shadow: true });
      ctx.restore();
      font(ctx, ss, 900);
      const sw = ctx.measureText(score.replace('-', ' – ')).width;
      const off = sw / 2 + ss * 0.75;
      const lk = eOut(seg(t, 1.2, 1.6));
      logoAt(g, spec.logo, W / 2 - off - (1 - lk) * S * 0.1, y, ss * 0.95, lk);
      logoAt(g, spec.oppLogo, W / 2 + off + (1 - lk) * S * 0.1, y, ss * 0.95, lk * 0.85);
    }
    y += ss * 0.95;
  }
  const sub = (tx.sub || '').toUpperCase();
  if (sub) {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 1.3, 1.8));
    const ss = fit(ctx, sub, W * 0.86, S * (portrait ? 0.045 : 0.04), 700, SANS, 0.16);
    label(g, sub, W / 2, y + ss * (score ? 0.4 : 1.2), ss, '#e5e7eb', 'center', 700, 0.16);
    ctx.restore();
  }
  // White flash on impact, then confetti.
  const flash = seg(t, 0.5, 0.85);
  if (flash > 0 && flash < 1 && g.look !== 'classic') {
    ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - flash)})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (g.look !== 'classic') confetti(g, 0.55, LITE ? 50 : 110);
  panelWipe(g, seg(t, g.d - 0.5, g.d + 0.15));
}

/** An award emblem: a ring of lettering, ticks turning, a star landing in the middle. */
function emblem(g: G, cx: number, cy: number, R: number, ring: string, start: number) {
  const { ctx, t } = g;
  const p = eExpo(seg(t, start, start + 0.6));
  if (p <= 0) return;
  ctx.save();
  ctx.globalAlpha *= clamp01(p * 2);
  // Disc.
  ctx.shadowColor = rgba(g.c2, 0.6);
  ctx.shadowBlur = soft(R * 0.4);
  const gr = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R);
  gr.addColorStop(0, shade(g.c1, 0.2));
  gr.addColorStop(1, shade(g.c1, -0.6));
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.arc(cx, cy, R * p, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Rings.
  ctx.strokeStyle = accent(g);
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.98, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
  ctx.stroke();
  ctx.lineWidth = R * 0.018;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.66, -Math.PI / 2, -Math.PI / 2 - Math.PI * 2 * p, true);
  ctx.stroke();
  // Ticks turning the other way.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-t * 0.3);
  ctx.strokeStyle = rgba('#ffffff', 0.5);
  ctx.lineWidth = R * 0.012;
  for (let i = 0; i < 60; i++) {
    ctx.rotate((Math.PI * 2) / 60);
    ctx.beginPath();
    ctx.moveTo(R * 0.6, 0);
    ctx.lineTo(R * (i % 5 ? 0.57 : 0.53), 0);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
  // Lettering round the ring, turning slowly.
  if (ring) arcText(g, ring, cx, cy, R * 0.82, R * 0.13, -Math.PI / 2 + t * 0.12, seg(t, start + 0.2, start + 1.0), '#fff');
  // The star lands.
  const sp = seg(t, start + 0.45, start + 0.85);
  if (sp > 0) {
    const s = g.look === 'classic' ? lerp(0.9, 1, eOut(sp)) : lerp(2, 1, eBack(sp));
    ctx.save();
    ctx.globalAlpha *= clamp01(sp * 3);
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = soft(R * 0.1);
    star(ctx, cx, cy, R * 0.42 * s, (1 - eOut(sp)) * 1.2);
    if (g.metal) ctx.fillStyle = g.metal;
    else ctx.fillStyle = g.c2;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = R * 0.02;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.stroke();
    ctx.restore();
  }
  // A glint across the disc.
  const gl = seg(t, start + 1.2, start + 1.9);
  if (gl > 0 && gl < 1 && !LITE) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const x = lerp(cx - R * 1.6, cx + R * 1.6, eInOut(gl));
    const lg = ctx.createLinearGradient(x - R * 0.3, cy - R, x + R * 0.3, cy + R);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
  }
}

/** Splits "Play of the Week" into its lead-in and the word that goes big. */
function awardWords(award: string): [string, string] {
  const words = award.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length < 2) return ['', words[0] ?? 'PLAY'];
  return [words.slice(0, -1).join(' '), words[words.length - 1]];
}

/** Play of the Week title package: emblem, the award word huge, the week and the player. */
function drawPotw(g: G) {
  const { ctx, W, H, S, t, portrait, spec } = g;
  const tx = spec.text;
  backdrop(g);
  // Two spotlights sweeping down.
  if (g.look !== 'classic') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      const a = Math.sin(t * 0.9 + (side > 0 ? 1.4 : 0)) * 0.25 + side * 0.3;
      const ox = W / 2 + side * W * 0.45;
      ctx.save();
      ctx.translate(ox, -S * 0.05);
      ctx.rotate(a);
      const gr = ctx.createLinearGradient(0, 0, 0, H * 1.1);
      gr.addColorStop(0, rgba('#ffffff', 0.22));
      gr.addColorStop(1, rgba(g.c2, 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(-S * 0.02, 0);
      ctx.lineTo(S * 0.02, 0);
      ctx.lineTo(S * 0.3, H * 1.1);
      ctx.lineTo(-S * 0.3, H * 1.1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
  const award = tx.award || 'Play of the Week';
  const [lead, big] = awardWords(award);
  const ringText = `${award.toUpperCase()}  ★  ${award.toUpperCase()}  ★  `;
  const R = S * (portrait ? 0.3 : 0.3);
  const ex = portrait ? W / 2 : W * 0.28;
  const ey = portrait ? H * 0.28 : H * 0.48;
  emblem(g, ex, ey, R, ringText, 0.1);
  // Words.
  const left = portrait ? W / 2 : W * 0.53;
  const align: CanvasTextAlign = portrait ? 'center' : 'left';
  const maxW = portrait ? W * 0.9 : W * 0.43;
  let y = portrait ? ey + R + S * 0.14 : H * 0.3;
  if (lead) {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 0.6, 1.0));
    const ls = fit(ctx, lead, maxW, S * 0.06, 800, SANS, 0.3);
    label(g, lead, left, y, ls, '#e5e7eb', align, 800, lerp(0.6, 0.3, eOut(seg(t, 0.6, 1.2))));
    ctx.restore();
    y += S * 0.03;
  }
  const bs = fit(ctx, big, maxW, S * (portrait ? 0.3 : 0.24));
  headline(g, big, left, y + bs * 0.86, bs, { align, color: g.metal ? g.c2 : '#fff', reveal: seg(t, 0.75, 1.2), sheen: seg(t, 1.5, 2.4) });
  y += bs * 0.98;
  const week = (tx.week || '').toUpperCase();
  if (week) {
    const ws = S * 0.045;
    const wp = eExpo(seg(t, 1.05, 1.45));
    font(ctx, ws, 900, SANS);
    tracking(ctx, ws * 0.2);
    const ww = ctx.measureText(week).width + ws * 2.2;
    tracking(ctx, 0);
    const wx = portrait ? left - ww / 2 : left;
    ctx.fillStyle = accent(g);
    para(ctx, wx, y, ww * wp, ws * 1.9, ws * 0.4);
    ctx.fill();
    if (wp > 0.6) label(g, week, wx + ws * 1.1, y + ws * 0.98, ws, g.ink, 'left', 900, 0.2);
    y += ws * 2.6;
  }
  const name = (tx.name || '').toUpperCase();
  if (name) {
    const ns = fit(ctx, name, maxW, S * (portrait ? 0.1 : 0.085));
    headline(g, name, left, y + ns * 0.9, ns, { align, reveal: seg(t, 1.25, 1.7) });
    y += ns * 1.05;
  }
  const sub = tx.sub || '';
  if (sub) {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 1.5, 2.0));
    const ss = fit(ctx, sub, maxW, S * 0.036, 600, SANS);
    label(g, sub, left, y + ss * 1.1, ss, '#cbd5e1', align, 600, 0.06);
    ctx.restore();
  }
  logoAt(g, spec.logo, portrait ? W - S * 0.11 : W - S * 0.1, S * 0.1, S * 0.12, eOut(seg(t, 1.2, 1.6)));
  panelWipe(g, seg(t, g.d - 0.5, g.d + 0.15));
}

/** Corner badge over the action: a small emblem and the award on a plate, top right. */
function drawBadge(g: G) {
  const { ctx, W, H, S, t, d, portrait, spec } = g;
  const title = (spec.text.title || '').toUpperCase();
  const sub = (spec.text.sub || '').toUpperCase();
  const k = eExpo(seg(t, 0.1, 0.6)) * (1 - eInOut(seg(t, d - 0.45, d - 0.1)));
  if (k <= 0) return;
  const r = S * 0.052;
  const cx = W - S * 0.05 - r;
  const cy = (portrait ? H * 0.06 : S * 0.06) + r;
  const fs = S * 0.03;
  font(ctx, fs, 900, SANS);
  tracking(ctx, fs * 0.12);
  const tw = Math.max(ctx.measureText(title).width, sub ? ctx.measureText(sub).width * 0.75 : 0);
  tracking(ctx, 0);
  const pw = (tw + fs * 2.2) * k;
  const ph = r * 1.5;
  ctx.save();
  ctx.globalAlpha *= clamp01(k * 2);
  // Plate grows out to the left of the emblem.
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = soft(fs);
  ctx.fillStyle = shade(g.c1, -0.3, 0.92);
  para(ctx, cx - r * 0.2 - pw, cy - ph / 2, pw + r * 0.2, ph, ph * 0.35);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = accent(g);
  ctx.fillRect(cx - r * 0.2 - pw, cy + ph / 2 - Math.max(2, fs * 0.12), pw, Math.max(2, fs * 0.12));
  if (k > 0.85) {
    label(g, title, cx - r * 1.25, cy - (sub ? fs * 0.35 : -fs * 0.05), fs, '#fff', 'right', 900, 0.12);
    if (sub) label(g, sub, cx - r * 1.25, cy + fs * 0.75, fs * 0.72, g.metal ? '#f5d77a' : g.c2, 'right', 800, 0.18);
  }
  // Emblem.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = shade(g.c1, -0.45);
  ctx.fill();
  ctx.lineWidth = r * 0.12;
  ctx.strokeStyle = accent(g);
  ctx.stroke();
  star(ctx, cx, cy, r * 0.55, Math.sin(t * 1.4) * 0.15);
  ctx.fillStyle = g.metal ?? g.c2;
  ctx.fill();
  ctx.restore();
}

/**
 * College commitment announcement: the player's photo (or cut-out), COMMITTED across it, their
 * name and details, and the college's logo and name landing at the end.
 */
function drawCommit(g: G) {
  const { ctx, W, H, S, t, portrait, spec, media } = g;
  const tx = spec.text;
  backdrop(g);
  const cutout = !!spec.cutout && !!media && !(media instanceof HTMLVideoElement);
  // Photo area: the top of a tall frame, the right of a wide one.
  const box = portrait ? { x: 0, y: 0, w: W, h: H * 0.6 } : { x: W * 0.46, y: 0, w: W * 0.54, h: H };
  const open = eExpo(seg(t, 0.05, 0.7));
  if (media && open > 0) {
    ctx.save();
    if (cutout) {
      const [iw, ih] = sizeOf(media);
      const k = Math.min((box.w * 0.92) / iw, (box.h * 0.98) / ih) * lerp(1.05, 1, eOut(seg(t, 0, 2)));
      const dw = iw * k;
      const dh = ih * k;
      ctx.globalAlpha = open;
      ctx.shadowColor = rgba(g.c2, 0.85);
      ctx.shadowBlur = soft(S * 0.05);
      ctx.drawImage(media, box.x + (box.w - dw) / 2, box.y + box.h - dh + (1 - open) * H * 0.05, dw, dh);
    } else {
      ctx.beginPath();
      ctx.rect(box.x + (portrait ? 0 : box.w * (1 - open)), box.y, box.w * (portrait ? 1 : open), box.h * (portrait ? open : 1));
      ctx.clip();
      cover(ctx, media, box.x, box.y, box.w, box.h, lerp(1.1, 1, eOut(seg(t, 0, 3))));
      // Fade the photo into the backdrop where the words sit.
      const gr = portrait ? ctx.createLinearGradient(0, box.h * 0.5, 0, box.h) : ctx.createLinearGradient(box.x, 0, box.x + box.w * 0.45, 0);
      gr.addColorStop(portrait ? 0 : 1, 'rgba(0,0,0,0)');
      gr.addColorStop(portrait ? 1 : 0, shade(g.c1, -0.8, 0.95));
      ctx.fillStyle = gr;
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.restore();
  } else if (!media) {
    // No photo: the college crest takes the space.
    crest(g, spec.oppLogo, tx.college || 'College', box.x + box.w / 2, box.y + box.h * 0.45, S * (portrait ? 0.5 : 0.45), 0.15);
  }
  streaks(g, box.y + box.h * 0.2, box.y + box.h * 0.9, 4, 0.3);

  const left = portrait ? W / 2 : W * 0.06;
  const align: CanvasTextAlign = portrait ? 'center' : 'left';
  const maxW = portrait ? W * 0.9 : W * 0.4;
  let y = portrait ? H * 0.6 : H * 0.2;
  // COMMITTED, big.
  const word = (tx.title || 'COMMITTED').toUpperCase();
  const ws = fit(ctx, word, maxW, S * (portrait ? 0.2 : 0.15));
  headline(g, word, left, y + ws * 0.85, ws, { align, color: g.c2, reveal: seg(t, 0.45, 0.95), sheen: seg(t, 1.6, 2.5) });
  y += ws * 1.02;
  const name = [tx.first, tx.last].filter(Boolean).join(' ').toUpperCase();
  if (name) {
    const ns = fit(ctx, name, maxW, S * (portrait ? 0.1 : 0.085));
    headline(g, name, left, y + ns * 0.88, ns, { align, reveal: seg(t, 0.7, 1.15) });
    y += ns * 1.08;
  }
  const detail = tx.detail || '';
  if (detail) {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 1.0, 1.4));
    const ds = fit(ctx, detail, maxW, S * 0.036, 700, SANS, 0.08);
    label(g, detail, left, y + ds * 0.9, ds, '#e5e7eb', align, 700, 0.08);
    ctx.restore();
    y += ds * 2.2;
  }
  // The college: its logo lands, then its name (beside the logo in a wide frame, under it in a tall one).
  const college = (tx.college || '').toUpperCase();
  const hasLogo = !!spec.oppLogo && !!g.img(spec.oppLogo);
  if (college || hasLogo) {
    const ls = S * (portrait ? 0.17 : 0.16);
    const cx = portrait ? W / 2 : left + ls / 2;
    const cy = y + ls * 0.55;
    if (hasLogo) logoSlam(g, spec.oppLogo, cx, cy, ls, 1.2);
    if (college) {
      ctx.save();
      ctx.globalAlpha = eOut(seg(t, 1.4, 1.9));
      if (portrait) {
        const cs = fit(ctx, college, maxW, S * 0.06);
        headline(g, college, W / 2, (hasLogo ? cy + ls * 0.55 : y) + cs * 1.05, cs, { color: '#fff' });
      } else {
        const room = maxW - (hasLogo ? ls * 1.25 : 0);
        const cs = fit(ctx, college, room, S * 0.055);
        headline(g, college, hasLogo ? left + ls * 1.25 : left, cy + cs * 0.35, cs, { align: 'left', color: '#fff' });
      }
      ctx.restore();
    }
  }
  if (spec.logo) logoAt(g, spec.logo, portrait ? S * 0.11 : W - S * 0.11, S * 0.11, S * 0.13, eOut(seg(t, 1.2, 1.6)));
  panelWipe(g, seg(t, g.d - 0.5, g.d + 0.15));
}

/** Game summary for families: the final score, set by set, and who led the team. */
function drawSummary(g: G) {
  const { ctx, W, H, S, t, portrait, spec } = g;
  backdrop(g);
  const names = [spec.text.usName || 'HOME', spec.text.themName || 'AWAY'];
  const totals = [spec.text.usScore ?? '', spec.text.themScore ?? ''];
  const logos = [spec.logo, spec.oppLogo];
  const rows = (spec.rows ?? []).slice(0, 5);
  const players = spec.players ?? [];
  const setLine = (spec.sets ?? []).map(([a, b]) => `${a}-${b}`).join('   ');
  const win = +totals[0] > +totals[1] ? 0 : +totals[1] > +totals[0] ? 1 : -1;

  // The score: logos and names either side of the big numbers.
  const scoreBlock = (cx: number, y: number, w: number) => {
    const ks = S * 0.075;
    headline(g, (spec.text.kicker || 'FINAL').toUpperCase(), cx, y + ks, ks, { color: g.c2, reveal: seg(t, 0.05, 0.45) });
    if (spec.text.sub) label(g, spec.text.sub.toUpperCase(), cx, y + ks * 1.55, S * 0.026, '#cbd5e1', 'center', 700, 0.18);
    y += ks * 2.1;
    const ls = S * 0.17;
    for (let i = 0; i < 2; i++) {
      const p = eExpo(seg(t, 0.3 + i * 0.15, 0.8 + i * 0.15));
      if (p <= 0) continue;
      const x = cx + (i ? 1 : -1) * w * 0.33;
      ctx.save();
      ctx.globalAlpha = p;
      ctx.translate((1 - p) * (i ? 1 : -1) * W * 0.3, 0);
      if (!logoAt(g, logos[i], x, y + ls / 2, ls)) {
        ctx.fillStyle = i ? '#3a3d48' : g.c1;
        ctx.beginPath();
        ctx.arc(x, y + ls / 2, ls * 0.42, 0, Math.PI * 2);
        ctx.fill();
        headline(g, names[i].slice(0, 1).toUpperCase(), x, y + ls * 0.5 + ls * 0.2, ls * 0.5, { shadow: false });
      }
      const nm = names[i].toUpperCase();
      headline(g, nm, x, y + ls + S * 0.065, fit(ctx, nm, w * 0.36, S * 0.05), { color: i === win || win < 0 ? '#fff' : 'rgba(255,255,255,0.7)', shadow: false });
      ctx.restore();
    }
    const cp = eBack(seg(t, 0.9, 1.3));
    if (cp > 0) {
      const ns = S * 0.17;
      ctx.save();
      ctx.translate(cx, y + ls * 0.5 + ns * 0.36);
      ctx.scale(Math.max(0.01, cp), Math.max(0.01, cp));
      const off = Math.max(w * 0.09, ns * 0.52);
      headline(g, String(totals[0]), -off, 0, ns, { color: win === 0 ? g.c2 : '#fff' });
      headline(g, '-', 0, -ns * 0.06, ns * 0.6, { color: 'rgba(255,255,255,0.5)', shadow: false });
      headline(g, String(totals[1]), off, 0, ns, { color: win === 1 ? g.c2 : '#fff' });
      ctx.restore();
    }
    y += ls + S * 0.1;
    if (setLine) {
      ctx.save();
      ctx.globalAlpha = eOut(seg(t, 1.2, 1.6));
      label(g, setLine, cx, y + S * 0.02, Math.min(S * 0.034, (w * 0.9) / Math.max(1, setLine.length * 0.62)), '#e5e7eb', 'center', 800, 0.08);
      ctx.restore();
      y += S * 0.06;
    }
    const result = (spec.text.result || '').toUpperCase();
    if (result) {
      const rs = fit(ctx, result, w * 0.85, S * 0.055);
      font(ctx, rs, 900);
      const rw = ctx.measureText(result).width + rs * 1.2;
      const rp = eExpo(seg(t, 1.4, 1.9));
      ctx.save();
      ctx.fillStyle = accent(g);
      para(ctx, cx - rw / 2, y, rw * rp, rs * 1.35, rs * 0.3);
      ctx.fill();
      ctx.restore();
      if (rp > 0.6) headline(g, result, cx, y + rs * 1.08, rs, { color: g.ink, shadow: false });
      y += rs * 1.35 + S * 0.04;
    }
    return y;
  };

  // The leaders: one plate each, value, stat, then who.
  const leaders = (x: number, y: number, w: number, bottom: number) => {
    if (!rows.length) return;
    const hs = S * 0.032;
    label(g, (spec.text.leadersTitle || 'TEAM LEADERS').toUpperCase(), x, y + hs, hs, g.c2, 'left', 900, 0.2);
    y += hs * 2.2;
    const rh = Math.min(S * 0.13, (bottom - y) / rows.length);
    rows.forEach(([k, v], i) => {
      const start = 1.5 + i * 0.15;
      const p = eExpo(seg(t, start, start + 0.45));
      if (p <= 0) return;
      const ry = y + i * rh;
      ctx.save();
      ctx.globalAlpha = p;
      ctx.translate((1 - p) * W * 0.3, 0);
      const gr = ctx.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.12)');
      gr.addColorStop(1, 'rgba(255,255,255,0.03)');
      ctx.fillStyle = gr;
      para(ctx, x, ry + rh * 0.08, w, rh * 0.84, rh * 0.15);
      ctx.fill();
      ctx.fillStyle = accent(g);
      para(ctx, x, ry + rh * 0.08, rh * 0.08, rh * 0.84, rh * 0.15);
      ctx.fill();
      const vs = rh * 0.6;
      headline(g, String(v), x + rh * 0.35, ry + rh * 0.72, vs, { align: 'left', color: '#fff' });
      font(ctx, vs, 900);
      const vw = Math.max(rh * 1.1, ctx.measureText(String(v)).width + rh * 0.3);
      label(g, String(k).toUpperCase(), x + rh * 0.35 + vw, ry + rh * 0.5, rh * 0.2, '#cbd5e1', 'left', 800, 0.16);
      const who = players[i];
      if (who) {
        const nm = `${who.number ? `#${who.number} ` : ''}${who.name}`.toUpperCase();
        font(ctx, rh * 0.2, 800, SANS);
        const kw = ctx.measureText(String(k).toUpperCase()).width + String(k).length * rh * 0.2 * 0.16;
        const room = w - (rh * 0.35 + vw + kw + rh * 0.5) - rh * 0.3;
        headline(g, nm, x + w - rh * 0.3, ry + rh * 0.66, fit(ctx, nm, room, rh * 0.36), { align: 'right', color: '#fff', shadow: false });
      }
      ctx.restore();
    });
  };

  if (portrait) {
    const w = Math.min(W * 0.9, S * 1.0);
    const n = Math.max(1, rows.length);
    const estimate = S * (0.075 * 2.1 + 0.17 + 0.1 + (setLine ? 0.06 : 0) + 0.12 + 0.07) + n * S * 0.13;
    let y = Math.max(H * 0.06, (H - estimate) * 0.42);
    y = scoreBlock(W / 2, y, w);
    leaders((W - w) / 2, y + S * 0.02, w, Math.min(H - S * (spec.text.footer ? 0.1 : 0.05), y + S * 0.09 + n * S * 0.13));
  } else {
    const lw = W * 0.44;
    const left = W * 0.05;
    const blockH = S * (0.075 * 2.1 + 0.17 + 0.1 + (setLine ? 0.06 : 0) + 0.12);
    scoreBlock(left + lw / 2, Math.max(S * 0.06, (H - blockH) / 2), lw);
    const rx = W * 0.54;
    const n = Math.max(1, rows.length);
    const lh = S * 0.07 + n * S * 0.13;
    const ly = Math.max(S * 0.08, (H - lh) / 2);
    leaders(rx, ly, W * 0.41, Math.min(H - S * (spec.text.footer ? 0.1 : 0.05), ly + lh));
  }
  if (spec.text.footer) {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 2.2, 2.7));
    label(g, spec.text.footer, W / 2, H - S * 0.045, S * 0.024, 'rgba(255,255,255,0.7)', 'center', 700, 0.1);
    ctx.restore();
  }
  panelWipe(g, seg(t, g.d - 0.45, g.d + 0.15));
}

// ---------- league promos ----------

/** A team's tile badge: its logo, or its initials on its colours. */
function teamBadge(g: G, t: { name: string; colors: [string, string]; logo?: string }, cx: number, cy: number, size: number) {
  if (logoAt(g, t.logo, cx, cy, size)) return;
  const { ctx } = g;
  ctx.save();
  ctx.fillStyle = t.colors[0];
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = size * 0.05;
  ctx.strokeStyle = t.colors[1];
  ctx.stroke();
  ctx.restore();
  headline(g, initials(t.name) || '?', cx, cy + size * 0.17, size * 0.42, { color: t.colors[1], shadow: false });
}

/**
 * Kinetic type: the promo's words slamming in. `lines` are separated by "|". "slam" puts one line
 * up at a time, huge, each landing with a flash; "stack" builds them into a block, alternating
 * solid and outlined. Over footage it darkens the picture behind; `bg` gives it its own backdrop.
 */
function drawKinetic(g: G) {
  const { ctx, W, H, S, t, d, spec } = g;
  const lines = (spec.text.lines || '').split('|').map((l) => l.trim().toUpperCase()).filter(Boolean);
  if (!lines.length) return;
  const bg = spec.text.bg === '1';
  const out = exitOf(g, 0.25);
  if (bg) backdrop(g);
  else if (spec.text.dim !== '0') {
    ctx.save();
    ctx.globalAlpha = 0.45 * eOut(seg(t, 0, 0.25)) * (1 - out);
    const v = ctx.createRadialGradient(W / 2, H / 2, S * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0.55)');
    v.addColorStop(1, 'rgba(0,0,0,0.95)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  const n = lines.length;
  const step = Math.max(0.22, Math.min(0.7, (d - 0.5) / n));
  const at = (i: number) => 0.06 + i * step;
  if (spec.text.mode === 'stack') {
    const size = Math.min(S * (g.portrait ? 0.17 : 0.16), (H * 0.7) / n / 1.08, ...lines.map((l) => fit(ctx, l, W * 0.86, S * 0.2)));
    const gap = size * 1.08;
    // The block centred: baselines sit a little below each line's middle.
    const top = H / 2 - ((n - 1) * gap) / 2 + size * 0.36;
    lines.forEach((line, i) => {
      const p = eExpo(seg(t, at(i), at(i) + 0.3));
      if (p <= 0) return;
      const dir = i % 2 ? 1 : -1;
      const y = top + i * gap;
      ctx.save();
      ctx.globalAlpha = 1 - out;
      ctx.translate(dir * (1 - p) * W * 0.6 + dir * out * W * 0.3, 0);
      // Motion streak behind a line still flying in.
      if (p < 0.95) {
        ctx.fillStyle = rgba(g.c2, 0.5 * (1 - p));
        ctx.fillRect(dir > 0 ? W / 2 : 0, y - size * 0.5, W / 2, size * 0.18);
      }
      const solid = i % 2 === 0;
      headline(g, line, W / 2, y, size, solid ? { color: '#fff' } : { color: 'rgba(0,0,0,0)', stroke: g.c2, shadow: false });
      ctx.restore();
    });
  } else {
    // One line at a time: the newest, landing big.
    let i = 0;
    while (i + 1 < n && t >= at(i + 1)) i++;
    const line = lines[i];
    const local = t - at(i);
    if (local < 0) return;
    const p = eExpo(seg(local, 0, 0.2));
    const size = fit(ctx, line, W * 0.88, S * (g.portrait ? 0.24 : 0.3));
    const scale = lerp(1.7, 1, p) * (1 + 0.02 * Math.max(0, 1 - local / 1.2));
    // A small shake as it lands.
    const shake = local < 0.2 ? Math.sin(local * 90) * S * 0.006 * (1 - local / 0.2) : 0;
    ctx.save();
    ctx.globalAlpha = Math.min(1, p * 1.4) * (1 - out);
    ctx.translate(W / 2 + shake, H / 2 + size * 0.32);
    ctx.scale(scale, scale);
    // A colour split as it lands, the broadcast punch.
    const split = (1 - seg(local, 0.04, 0.3)) * S * 0.012;
    if (split > 0.5) {
      headline(g, line, -split, 0, size, { color: 'rgba(0,229,255,0.7)', shadow: false });
      headline(g, line, split, 0, size, { color: 'rgba(255,43,214,0.7)', shadow: false });
    }
    headline(g, line, 0, 0, size, { color: '#fff', sheen: seg(local, 0.15, 0.75) });
    ctx.restore();
    // The accent bar underlines it.
    const bw = Math.min(W * 0.86, ctx.measureText(line).width) * eOut(seg(local, 0.1, 0.4));
    ctx.save();
    ctx.globalAlpha = 1 - out;
    ctx.fillStyle = accent(g);
    para(ctx, W / 2 - bw / 2, H / 2 + size * 0.5, bw, size * 0.08, size * 0.05);
    ctx.fill();
    // Impact flash.
    const f = 1 - seg(local, 0.02, 0.16);
    if (f > 0 && f < 1) {
      ctx.globalAlpha = 0.35 * f;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    if (spec.text.kicker && i === 0) label(g, spec.text.kicker.toUpperCase(), W / 2, H / 2 - size * 0.75, S * 0.03, g.c2, 'center', 800, 0.3);
  }
  if (bg) panelWipe(g, seg(t, d - 0.45, d + 0.15));
}

/** Cinematic bars: the frame closes to 2.39:1 (a band in tall frames), with an optional caption. */
function drawLetterbox(g: G) {
  const { ctx, W, H, S, t, d, portrait, spec } = g;
  const target = portrait ? H * 0.12 : Math.max(0, (H - W / 2.39) / 2);
  const p = eInOut(seg(t, 0, 0.5)) * (1 - eInOut(seg(t, d - 0.5, d)));
  const bar = target * p;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, bar);
  ctx.fillRect(0, H - bar, W, bar);
  const cap = spec.text.caption;
  if (cap && p > 0.9) {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 0.6, 1.2)) * (1 - seg(t, d - 0.6, d - 0.2));
    label(g, cap.toUpperCase(), W / 2, H - bar / 2, Math.min(bar * 0.32, S * 0.026), '#e5e7eb', 'center', 700, 0.45);
    ctx.restore();
  }
}

/** A glitch hit on a cut: slices of the team colours and broken scanlines, a few frames long. */
function drawGlitch(g: G) {
  const { ctx, W, H, t, d } = g;
  const frame = Math.floor(t * 30);
  const life = Math.sin(Math.PI * seg(t, 0, d));
  const colors = [g.c1, g.c2, '#00e5ff', '#ff2bd6', '#ffffff'];
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const r = hash(frame * 31 + i * 7.3 + g.clipId.length);
    if (r > 0.55 + 0.4 * (1 - life)) continue;
    const y = hash(frame * 13 + i) * H;
    const h = H * (0.01 + hash(frame + i * 3.1) * 0.07);
    const x = (hash(frame * 7 + i) - 0.5) * W * 0.3;
    ctx.globalAlpha = 0.35 + 0.5 * hash(i + frame);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, y, W * (0.4 + hash(i * 9 + frame) * 0.8), h);
  }
  // Scanlines.
  ctx.globalAlpha = 0.18 * life;
  ctx.fillStyle = '#000';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
  ctx.restore();
}

/** Every team in the league: tiles flip in, then the league's logo lands over them. */
function drawLogoWall(g: G) {
  const { ctx, W, H, S, t, d, portrait, spec } = g;
  backdrop(g);
  const teams = (spec.teams ?? []).slice(0, 24);
  const title = (spec.text.title || '').toUpperCase();
  const top = title ? H * (portrait ? 0.16 : 0.15) : H * 0.08;
  if (title) headline(g, title, W / 2, top, fit(ctx, title, W * 0.86, S * 0.085), { color: '#fff', reveal: seg(t, 0.05, 0.45) });
  const n = Math.max(1, teams.length);
  const areaTop = top + S * 0.06;
  const areaH = H * 0.9 - areaTop;
  const cols = Math.max(1, Math.round(Math.sqrt((n * W) / areaH)));
  const rows = Math.ceil(n / cols);
  const cell = Math.min((W * 0.9) / cols, areaH / rows);
  const x0 = (W - cell * cols) / 2;
  const y0 = areaTop + (areaH - cell * rows) / 2;
  const land = d * 0.62;
  teams.forEach((tm, i) => {
    const start = 0.25 + hash(i * 3.7) * Math.min(1.2, 0.12 * n);
    const p = eBack(seg(t, start, start + 0.45));
    if (p <= 0) return;
    const r = Math.floor(i / cols);
    // Centre a short last row.
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const c = i - r * cols;
    const cx = x0 + (cols - inRow) * cell * 0.5 + (c + 0.5) * cell;
    const cy = y0 + (r + 0.5) * cell;
    const sz = cell * 0.86;
    const dimmed = 1 - 0.55 * eOut(seg(t, land, land + 0.4));
    ctx.save();
    ctx.globalAlpha = dimmed;
    ctx.translate(cx, cy);
    ctx.scale(1, Math.max(0.01, p));
    const gr = ctx.createLinearGradient(-sz / 2, -sz / 2, sz / 2, sz / 2);
    gr.addColorStop(0, shade(tm.colors[0], 0.05));
    gr.addColorStop(1, shade(tm.colors[0], -0.45));
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.roundRect(-sz / 2, -sz / 2, sz, sz, sz * 0.08);
    ctx.fill();
    ctx.fillStyle = tm.colors[1];
    ctx.fillRect(-sz / 2, sz / 2 - sz * 0.05, sz, sz * 0.05);
    teamBadge(g, tm, 0, -sz * 0.08, sz * 0.56);
    const nm = tm.name.toUpperCase();
    label(g, nm, 0, sz * 0.33, Math.min(sz * 0.09, (sz * 0.9) / Math.max(1, nm.length * 0.62)), '#fff', 'center', 800, 0.08);
    ctx.restore();
  });
  // The league lands over its teams.
  if (spec.logo) {
    const k = seg(t, land, land + 0.6);
    if (k > 0) logoSlam(g, spec.logo, W / 2, y0 + (cell * rows) / 2, Math.min(S * 0.42, cell * 2.2), land);
  }
  panelWipe(g, seg(t, d - 0.45, d + 0.15));
}

/** When: a kicker, the date huge, and where to be or watch. */
function drawDateSlate(g: G) {
  const { ctx, W, H, S, t, d, portrait, spec } = g;
  backdrop(g);
  // Racing diagonal stripes in the accent.
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = accent(g);
  const sw = S * 0.05;
  const off = ((t * S * 0.4) % (sw * 4)) - sw * 4;
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-Math.PI / 5);
  for (let x = -Math.max(W, H) + off; x < Math.max(W, H); x += sw * 4) ctx.fillRect(x, -Math.max(W, H), sw, Math.max(W, H) * 2);
  ctx.restore();
  const kicker = (spec.text.kicker || '').toUpperCase();
  const title = (spec.text.title || '').toUpperCase();
  const cy = H * (portrait ? 0.46 : 0.5);
  const ts = fit(ctx, title, W * 0.88, S * (portrait ? 0.2 : 0.24));
  if (kicker) {
    const ks = S * 0.042;
    font(ctx, ks, 900);
    const kw = ctx.measureText(kicker).width + ks * 1.4;
    const kp = eExpo(seg(t, 0.05, 0.45));
    ctx.save();
    ctx.fillStyle = accent(g);
    para(ctx, W / 2 - kw / 2, cy - ts * 0.95 - ks * 1.2, kw * kp, ks * 1.35, ks * 0.3);
    ctx.fill();
    ctx.restore();
    if (kp > 0.6) headline(g, kicker, W / 2, cy - ts * 0.95 - ks * 0.2, ks, { color: g.ink, shadow: false });
  }
  const tp = eBack(seg(t, 0.35, 0.8));
  if (tp > 0) {
    ctx.save();
    ctx.translate(W / 2, cy);
    ctx.scale(Math.max(0.01, tp), Math.max(0.01, tp));
    headline(g, title, 0, ts * 0.36, ts, { color: '#fff', sheen: seg(t, 1, 1.8) });
    ctx.restore();
  }
  const sub = spec.text.sub || '';
  const where = spec.text.where || '';
  ctx.save();
  ctx.globalAlpha = eOut(seg(t, 0.9, 1.4));
  if (sub) label(g, sub.toUpperCase(), W / 2, cy + ts * 0.62, Math.min(S * 0.045, (W * 0.9) / Math.max(1, sub.length * 0.6)), '#fff', 'center', 800, 0.12);
  if (where) label(g, where.toUpperCase(), W / 2, cy + ts * 0.62 + S * 0.07, Math.min(S * 0.032, (W * 0.9) / Math.max(1, where.length * 0.62)), g.c2, 'center', 800, 0.18);
  ctx.restore();
  logoAt(g, spec.logo, W - S * 0.1, S * 0.1, S * 0.12, eOut(seg(t, 0.3, 0.8)));
  panelWipe(g, seg(t, d - 0.45, d + 0.15));
}

/** The league's sign-off: logo, name, slogan, where to find it, and who presents it. */
function drawEndSlate(g: G) {
  const { ctx, W, H, S, t, d, portrait, spec } = g;
  backdrop(g);
  const name = (spec.text.title || '').toUpperCase();
  const cy = H * (portrait ? 0.4 : 0.38);
  const ls = S * (portrait ? 0.42 : 0.36);
  // Light rays behind the logo.
  ctx.save();
  ctx.globalAlpha = 0.22 * eOut(seg(t, 0.2, 1));
  ctx.translate(W / 2, cy);
  ctx.rotate(t * 0.15);
  ctx.fillStyle = rgba(g.c2, 0.5);
  for (let i = 0; i < 12; i++) {
    ctx.rotate((Math.PI * 2) / 12);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.max(W, H), -S * 0.06);
    ctx.lineTo(Math.max(W, H), S * 0.06);
    ctx.fill();
  }
  ctx.restore();
  if (!logoSlam(g, spec.logo, W / 2, cy, ls, 0.25) && name) {
    const k = eBack(seg(t, 0.25, 0.75));
    if (k > 0) {
      ctx.save();
      ctx.translate(W / 2, cy);
      ctx.scale(k, k);
      ctx.fillStyle = g.c1;
      ctx.beginPath();
      ctx.arc(0, 0, ls * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = ls * 0.04;
      ctx.strokeStyle = g.c2;
      ctx.stroke();
      ctx.restore();
      headline(g, initials(name), W / 2, cy + ls * 0.15, ls * 0.4, { color: g.c2, shadow: false, reveal: k });
    }
  }
  let y = cy + ls * 0.62;
  if (name) {
    const ns = fit(ctx, name, W * 0.88, S * 0.1);
    headline(g, name, W / 2, y + ns * 0.8, ns, { color: '#fff', reveal: seg(t, 0.7, 1.1), sheen: seg(t, 1.4, 2.2) });
    y += ns * 1.1;
  }
  const tag = spec.text.tagline || '';
  if (tag) {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 1, 1.5));
    label(g, tag.toUpperCase(), W / 2, y + S * 0.03, Math.min(S * 0.036, (W * 0.9) / Math.max(1, tag.length * 0.62)), g.c2, 'center', 800, 0.22);
    ctx.restore();
    y += S * 0.07;
  }
  const url = spec.text.url || '';
  if (url) {
    const us = Math.min(S * 0.036, (W * 0.8) / Math.max(1, url.length * 0.6));
    font(ctx, us, 800, SANS);
    const uw = ctx.measureText(url).width + us * 1.6;
    const up = eExpo(seg(t, 1.2, 1.6));
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.roundRect(W / 2 - (uw * up) / 2, y + S * 0.02, uw * up, us * 1.8, us * 0.9);
    ctx.fill();
    ctx.restore();
    if (up > 0.8) label(g, url, W / 2, y + S * 0.02 + us * 0.9, us, '#fff', 'center', 800, 0.04);
  }
  const sponsor = spec.text.sponsor || '';
  if (sponsor) {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 1.6, 2.1));
    label(g, 'PRESENTED BY', W / 2, H - S * 0.11, S * 0.02, 'rgba(255,255,255,0.6)', 'center', 700, 0.4);
    label(g, sponsor.toUpperCase(), W / 2, H - S * 0.07, Math.min(S * 0.034, (W * 0.8) / Math.max(1, sponsor.length * 0.62)), '#fff', 'center', 900, 0.14);
    ctx.restore();
  }
  // Holds to the end: a promo's last frame is its sign-off.
  void d;
}

/** The playoff bracket: seeds slide in, the lines draw towards the final, the champion's slot waits. */
function drawBracket(g: G) {
  const { ctx, W, H, S, t, d, portrait, spec } = g;
  backdrop(g);
  const title = (spec.text.title || 'PLAYOFFS').toUpperCase();
  const top = H * (portrait ? 0.13 : 0.14);
  headline(g, title, W / 2, top, fit(ctx, title, W * 0.8, S * 0.1), { color: '#fff', reveal: seg(t, 0.05, 0.45), sheen: seg(t, 2.2, 3) });
  const all = (spec.teams ?? []).slice(0, 8);
  const size = all.length > 4 ? 8 : 4;
  const seeds = Array.from({ length: size }, (_, i) => all[i]);
  // First-round pairs: 1 v 8, 4 v 5, 2 v 7, 3 v 6 (or 1 v 4, 2 v 3).
  const order = size === 8 ? [0, 7, 3, 4, 1, 6, 2, 5] : [0, 3, 1, 2];
  const rounds = Math.log2(size) + 1;
  const areaTop = top + S * 0.08;
  const areaH = H * 0.92 - areaTop;
  // Tall frames give round one (the names) half the width; the later rounds share the rest.
  const firstW = portrait ? W * 0.5 : (W * 0.92) / rounds;
  const laterW = portrait ? (W * 0.42) / (rounds - 1) : firstW;
  const x0 = W * 0.04;
  const colX = (r: number) => x0 + (r ? firstW + (r - 1) * laterW : 0);
  const slotH = Math.min(areaH / size, S * 0.11);
  const slotOf = (r: number) => (r ? laterW : firstW) * 0.82;
  const slotW = slotOf(0);
  const yOf = (round: number, k: number) => areaTop + (areaH / (size >> round)) * (k + 0.5);
  const lineP = eInOut(seg(t, 1.2, 2.6));
  ctx.save();
  ctx.strokeStyle = rgba(g.c2, 0.9);
  ctx.lineWidth = Math.max(2, S * 0.004);
  for (let r = 0; r < rounds - 1; r++) {
    const pr = Math.max(0, Math.min(1, lineP * (rounds - 1) - r));
    if (pr <= 0) continue;
    for (let k = 0; k < size >> (r + 1); k++) {
      const xa = colX(r) + slotOf(r);
      const xb = colX(r + 1);
      const ya = yOf(r, k * 2);
      const yb = yOf(r, k * 2 + 1);
      const ym = yOf(r + 1, k);
      const xm = (xa + xb) / 2;
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(lerp(xa, xm, Math.min(1, pr * 2)), ya);
      ctx.moveTo(xa, yb);
      ctx.lineTo(lerp(xa, xm, Math.min(1, pr * 2)), yb);
      if (pr > 0.5) {
        const q = (pr - 0.5) * 2;
        ctx.moveTo(xm, ya);
        ctx.lineTo(xm, yb);
        ctx.moveTo(xm, ym);
        ctx.lineTo(lerp(xm, xb, q), ym);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
  // Round one: the seeds.
  order.forEach((s, k) => {
    const tm = seeds[s];
    const start = 0.35 + k * 0.08;
    const p = eExpo(seg(t, start, start + 0.4));
    if (p <= 0) return;
    const y = yOf(0, k);
    ctx.save();
    ctx.translate(-(1 - p) * W * 0.4, 0);
    ctx.globalAlpha = p;
    ctx.fillStyle = tm ? shade(tm.colors[0], -0.25) : 'rgba(255,255,255,0.06)';
    para(ctx, x0, y - slotH * 0.42, slotW, slotH * 0.84, slotH * 0.15);
    ctx.fill();
    if (tm) {
      ctx.fillStyle = tm.colors[1];
      para(ctx, x0, y - slotH * 0.42, slotH * 0.07, slotH * 0.84, slotH * 0.15);
      ctx.fill();
      label(g, String(s + 1), x0 + slotH * 0.35, y, slotH * 0.3, 'rgba(255,255,255,0.65)', 'center', 900, 0);
      teamBadge(g, tm, x0 + slotH * 0.95, y, slotH * 0.7);
      const nm = tm.name.toUpperCase();
      headline(g, nm, x0 + slotH * 1.45, y + slotH * 0.15, fit(ctx, nm, slotW - slotH * 1.65, slotH * 0.42), { align: 'left', shadow: false });
    } else label(g, 'BYE', x0 + slotW / 2, y, slotH * 0.28, 'rgba(255,255,255,0.4)', 'center', 800, 0.3);
    ctx.restore();
  });
  // Later rounds: empty slots waiting, the final one glowing.
  for (let r = 1; r < rounds; r++) {
    const p = eOut(seg(t, 1.4 + r * 0.35, 1.9 + r * 0.35));
    if (p <= 0) continue;
    for (let k = 0; k < size >> r; k++) {
      const y = yOf(r, k);
      const x = colX(r);
      const w = slotOf(r);
      const last = r === rounds - 1;
      ctx.save();
      ctx.globalAlpha = p;
      ctx.fillStyle = last ? accent(g) : 'rgba(255,255,255,0.08)';
      para(ctx, x, y - slotH * 0.42, w, slotH * 0.84, slotH * 0.15);
      ctx.fill();
      if (last) headline(g, spec.text.final || 'CHAMPION', x + w / 2, y + slotH * 0.16, fit(ctx, spec.text.final || 'CHAMPION', w * 0.85, slotH * 0.46), { color: g.ink, shadow: false, sheen: seg(t, 2.6, 3.4) });
      ctx.restore();
    }
  }
  panelWipe(g, seg(t, d - 0.45, d + 0.15));
}

const qrCache = new Map<string, boolean[][]>();
/** The QR code for `text` (cached): rows of dark modules. */
function qrFor(text: string): boolean[][] {
  let m = qrCache.get(text);
  if (!m) {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    m = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
    qrCache.set(text, m);
  }
  return m;
}

/** Sign up: what, when and how much, with a QR code to the registration page. */
function drawSignup(g: G) {
  const { ctx, W, H, S, t, d, portrait, spec } = g;
  backdrop(g);
  const title = (spec.text.title || 'REGISTRATION OPEN').toUpperCase();
  const top = H * (portrait ? 0.12 : 0.15);
  headline(g, title, W / 2, top, fit(ctx, title, W * 0.88, S * 0.1), { color: '#fff', reveal: seg(t, 0.05, 0.45), sheen: seg(t, 1.8, 2.6) });
  const rows = (spec.rows ?? []).filter(([k, v]) => k && v);
  const url = spec.text.url || '';
  const qrSize = url ? S * (portrait ? 0.42 : 0.42) : 0;
  // Rows on the left (above, in tall frames), the code on the right (below).
  const listX = portrait ? W * 0.08 : W * 0.07;
  const listW = portrait ? W * 0.84 : W * 0.5;
  const listTop = top + S * 0.09;
  const rh = Math.min(S * 0.12, ((portrait ? H * 0.38 : H * 0.7) - S * 0.05) / Math.max(1, rows.length));
  rows.forEach(([k, v], i) => {
    const start = 0.45 + i * 0.15;
    const p = eExpo(seg(t, start, start + 0.4));
    if (p <= 0) return;
    const y = listTop + i * rh;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate(-(1 - p) * W * 0.3, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    para(ctx, listX, y + rh * 0.08, listW, rh * 0.84, rh * 0.12);
    ctx.fill();
    ctx.fillStyle = accent(g);
    para(ctx, listX, y + rh * 0.08, rh * 0.07, rh * 0.84, rh * 0.12);
    ctx.fill();
    label(g, k.toUpperCase(), listX + rh * 0.3, y + rh * 0.34, rh * 0.17, g.c2, 'left', 800, 0.2);
    const vs = Math.min(rh * 0.3, (listW - rh * 0.5) / Math.max(1, v.length * 0.55));
    label(g, v, listX + rh * 0.3, y + rh * 0.64, vs, '#fff', 'left', 800, 0.02);
    ctx.restore();
  });
  if (url) {
    const m = qrFor(url);
    const qx = portrait ? W / 2 - qrSize / 2 : W * 0.93 - qrSize;
    const qy = portrait ? listTop + rows.length * rh + S * 0.04 : listTop + S * 0.02;
    const p = eBack(seg(t, 0.8, 1.3));
    if (p > 0) {
      ctx.save();
      ctx.translate(qx + qrSize / 2, qy + qrSize / 2);
      ctx.scale(p, p);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(-qrSize / 2, -qrSize / 2, qrSize, qrSize, qrSize * 0.06);
      ctx.fill();
      const n = m.length;
      const cell = (qrSize * 0.84) / n;
      const o = -cell * n * 0.5;
      ctx.fillStyle = '#0b0b10';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) ctx.fillRect(o + c * cell, o + r * cell, cell + 0.5, cell + 0.5);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = eOut(seg(t, 1.2, 1.6));
      label(g, 'SCAN TO SIGN UP', qx + qrSize / 2, qy + qrSize + S * 0.035, S * 0.024, g.c2, 'center', 800, 0.3);
      label(g, url, qx + qrSize / 2, qy + qrSize + S * 0.075, Math.min(S * 0.03, (qrSize * 1.4) / Math.max(1, url.length * 0.58)), '#fff', 'center', 800, 0.02);
      ctx.restore();
    }
  }
  logoAt(g, spec.logo, portrait ? W - S * 0.1 : S * 0.1, portrait ? H - S * 0.1 : H - S * 0.1, S * 0.12, eOut(seg(t, 0.3, 0.8)));
  panelWipe(g, seg(t, d - 0.45, d + 0.15));
}

/** A trophy: cup, handles, stem and base, in gold (or the accent). */
function trophy(g: G, cx: number, cy: number, size: number, color: string | CanvasGradient = accent(g)) {
  const { ctx } = g;
  const w = size * 0.6;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.06;
  // Handles.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * w * 0.5, cy - size * 0.2, w * 0.22, size * 0.16, 0, side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5, side < 0 ? Math.PI * 1.5 : Math.PI * 0.5);
    ctx.stroke();
  }
  // Cup.
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy - size * 0.42);
  ctx.lineTo(cx + w / 2, cy - size * 0.42);
  ctx.quadraticCurveTo(cx + w * 0.48, cy + size * 0.05, cx, cy + size * 0.1);
  ctx.quadraticCurveTo(cx - w * 0.48, cy + size * 0.05, cx - w / 2, cy - size * 0.42);
  ctx.fill();
  // Stem and base.
  ctx.fillRect(cx - size * 0.05, cy + size * 0.08, size * 0.1, size * 0.18);
  ctx.fillRect(cx - w * 0.38, cy + size * 0.26, w * 0.76, size * 0.08);
  ctx.fillRect(cx - w * 0.48, cy + size * 0.34, w * 0.96, size * 0.08);
  // Shine.
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.18, cy - size * 0.22, w * 0.06, size * 0.14, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** This week's games: rows of matchups (teams in pairs), with when and where. */
function drawFixtures(g: G) {
  const { ctx, W, H, S, t, d, portrait, spec } = g;
  backdrop(g);
  const title = (spec.text.title || 'THIS WEEK').toUpperCase();
  const top = H * (portrait ? 0.12 : 0.14);
  headline(g, title, W / 2, top, fit(ctx, title, W * 0.8, S * 0.1), { color: '#fff', reveal: seg(t, 0.05, 0.45), sheen: seg(t, 1.6, 2.4) });
  if (spec.text.sub) label(g, spec.text.sub.toUpperCase(), W / 2, top + S * 0.045, S * 0.026, g.c2, 'center', 800, 0.3);
  const teams = spec.teams ?? [];
  const games = Math.min(6, Math.floor(teams.length / 2));
  const rows = spec.rows ?? [];
  const areaTop0 = top + S * 0.1;
  const rh = Math.min(S * (portrait ? 0.2 : 0.15), (H * 0.92 - areaTop0) / Math.max(1, games));
  // The games centred in the space below the title.
  const areaTop = areaTop0 + (H * 0.92 - areaTop0 - rh * games) * 0.4;
  const rw = Math.min(W * 0.92, S * (portrait ? 1 : 1.6));
  const x0 = (W - rw) / 2;
  for (let i = 0; i < games; i++) {
    const a = teams[i * 2];
    const h = teams[i * 2 + 1];
    const [when, where] = rows[i] ?? ['', ''];
    const start = 0.4 + i * 0.18;
    const p = eExpo(seg(t, start, start + 0.45));
    if (p <= 0) continue;
    const y = areaTop + i * rh;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate((i % 2 ? 1 : -1) * (1 - p) * W * 0.4, 0);
    const plate = (x: number, w: number, c: string) => {
      ctx.fillStyle = c;
      para(ctx, x, y + rh * 0.08, w, rh * 0.84, rh * 0.15);
      ctx.fill();
    };
    // Two team plates either side of an "at", details on the right (below, in tall frames).
    const teamW = portrait ? rw * 0.44 : rw * 0.33;
    const midW = portrait ? rw * 0.12 : rw * 0.06;
    const ty = portrait ? y : y;
    plate(x0, teamW, shade(a.colors[0], -0.2));
    plate(x0 + teamW + midW, teamW, shade(h.colors[0], -0.2));
    const badge = Math.min(rh * 0.6, teamW * 0.3);
    const side = (tm: typeof a, x: number) => {
      teamBadge(g, tm, x + badge * 0.75, ty + rh * (portrait ? 0.35 : 0.5), badge);
      const nm = tm.name.toUpperCase();
      headline(g, nm, x + badge * 1.4, ty + rh * (portrait ? 0.45 : 0.64), fit(ctx, nm, teamW - badge * 1.6, rh * 0.36), { align: 'left', shadow: false });
    };
    side(a, x0);
    side(h, x0 + teamW + midW);
    label(g, 'AT', x0 + teamW + midW / 2, ty + rh * 0.5, rh * 0.18, g.c2, 'center', 900, 0.2);
    const detail = [when, where].filter(Boolean).join('  ·  ');
    if (detail) {
      if (portrait) label(g, detail.toUpperCase(), W / 2, y + rh * 0.78, Math.min(rh * 0.13, (rw * 0.95) / Math.max(1, detail.length * 0.6)), '#e5e7eb', 'center', 800, 0.08);
      else {
        const dx = x0 + teamW * 2 + midW + rw * 0.02;
        const dw = rw - (dx - x0);
        plate(dx, dw, 'rgba(255,255,255,0.08)');
        label(g, (when || '').toUpperCase(), dx + rh * 0.3, y + rh * (where ? 0.38 : 0.5), Math.min(rh * 0.2, (dw * 0.9) / Math.max(1, when.length * 0.6)), '#fff', 'left', 900, 0.06);
        if (where) label(g, where.toUpperCase(), dx + rh * 0.3, y + rh * 0.64, Math.min(rh * 0.14, (dw * 0.9) / Math.max(1, where.length * 0.62)), g.c2, 'left', 800, 0.1);
      }
    }
    ctx.restore();
  }
  logoAt(g, spec.logo, W - S * 0.1, S * 0.1, S * 0.12, eOut(seg(t, 0.3, 0.8)));
  panelWipe(g, seg(t, d - 0.45, d + 0.15));
}

/** The table: rank, team, record (and points), building in from the bottom, the leader in the accent. */
function drawStandings(g: G) {
  const { ctx, W, H, S, t, d, portrait, spec } = g;
  backdrop(g);
  const title = (spec.text.title || 'STANDINGS').toUpperCase();
  const top = H * (portrait ? 0.12 : 0.13);
  headline(g, title, W / 2, top, fit(ctx, title, W * 0.8, S * 0.1), { color: '#fff', reveal: seg(t, 0.05, 0.45), sheen: seg(t, 2, 2.8) });
  const teams = (spec.teams ?? []).slice(0, 10);
  const rows = spec.rows ?? [];
  const areaTop = top + S * 0.07;
  const rh = Math.min(S * 0.11, (H * 0.93 - areaTop) / Math.max(1, teams.length));
  const rw = Math.min(W * 0.9, S * (portrait ? 0.95 : 1.35));
  const x0 = (W - rw) / 2;
  const n = teams.length;
  teams.forEach((tm, i) => {
    // Bottom of the table first, building up to the leader.
    const start = 0.4 + (n - 1 - i) * 0.12;
    const p = eExpo(seg(t, start, start + 0.4));
    if (p <= 0) return;
    const y = areaTop + i * rh;
    const lead = i === 0;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate(0, (1 - p) * rh * 1.5);
    ctx.fillStyle = lead ? accent(g) : i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)';
    para(ctx, x0, y + rh * 0.07, rw, rh * 0.86, rh * 0.12);
    ctx.fill();
    ctx.fillStyle = tm.colors[0];
    para(ctx, x0 + rh * 0.95, y + rh * 0.07, rh * 0.07, rh * 0.86, rh * 0.12);
    ctx.fill();
    const ink = lead ? g.ink : '#fff';
    headline(g, String(i + 1), x0 + rh * 0.5, y + rh * 0.68, rh * 0.5, { color: ink, shadow: false });
    teamBadge(g, tm, x0 + rh * 1.6, y + rh * 0.5, rh * 0.66);
    const [rec, pts] = rows[i] ?? ['', ''];
    const nm = tm.name.toUpperCase();
    const right = rw * (pts ? 0.32 : 0.2);
    headline(g, nm, x0 + rh * 2.1, y + rh * 0.66, fit(ctx, nm, rw - rh * 2.2 - right, rh * 0.42), { align: 'left', color: ink, shadow: false });
    if (rec) headline(g, rec, x0 + rw - (pts ? rw * 0.16 : rh * 0.4), y + rh * 0.66, rh * 0.42, { align: 'right', color: ink, shadow: false });
    if (pts) headline(g, pts, x0 + rw - rh * 0.4, y + rh * 0.66, rh * 0.42, { align: 'right', color: lead ? ink : g.c2, shadow: false });
    ctx.restore();
  });
  if (n && (rows[0]?.[0] || rows[0]?.[1])) {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 0.4, 0.8));
    if (rows.some((r) => r[1])) {
      label(g, 'W-L', x0 + rw - rw * 0.16, areaTop - S * 0.015, S * 0.02, 'rgba(255,255,255,0.6)', 'right', 800, 0.2);
      label(g, 'PTS', x0 + rw - rh * 0.4, areaTop - S * 0.015, S * 0.02, 'rgba(255,255,255,0.6)', 'right', 800, 0.2);
    } else label(g, 'W-L', x0 + rw - rh * 0.4, areaTop - S * 0.015, S * 0.02, 'rgba(255,255,255,0.6)', 'right', 800, 0.2);
    ctx.restore();
  }
  logoAt(g, spec.logo, W - S * 0.1, S * 0.1, S * 0.12, eOut(seg(t, 0.3, 0.8)));
  panelWipe(g, seg(t, d - 0.45, d + 0.15));
}

/** A tournament announced: its name with the trophy, when and where, the divisions, the prize. */
function drawEventCard(g: G) {
  const { ctx, W, H, S, t, d, portrait, spec } = g;
  backdrop(g);
  const name = (spec.text.title || 'TOURNAMENT').toUpperCase();
  const kicker = (spec.text.kicker || '').toUpperCase();
  const cy = H * (portrait ? 0.3 : 0.27);
  const tp = eBack(seg(t, 0.15, 0.7));
  if (tp > 0) trophy(g, W / 2, cy - S * 0.02 - (1 - tp) * S * 0.1, S * (portrait ? 0.26 : 0.22));
  if (kicker) label(g, kicker, W / 2, cy + S * 0.15, S * 0.03, g.c2, 'center', 800, 0.35);
  const ns = fit(ctx, name, W * 0.88, S * (portrait ? 0.13 : 0.12));
  let y = cy + S * 0.18 + ns * 0.85;
  headline(g, name, W / 2, y, ns, { color: '#fff', reveal: seg(t, 0.45, 0.85), sheen: seg(t, 1.6, 2.4) });
  y += ns * 0.5;
  const lines = [spec.text.when, spec.text.where].filter((x): x is string => !!x?.trim());
  lines.forEach((ln, i) => {
    ctx.save();
    ctx.globalAlpha = eOut(seg(t, 0.9 + i * 0.15, 1.3 + i * 0.15));
    label(g, ln.toUpperCase(), W / 2, y + S * 0.045 + i * S * 0.06, Math.min(S * (i ? 0.032 : 0.042), (W * 0.9) / Math.max(1, ln.length * 0.6)), i ? '#e5e7eb' : '#fff', 'center', 800, 0.12);
    ctx.restore();
  });
  y += S * 0.06 * lines.length + S * 0.06;
  // Divisions as chips.
  const chips = (spec.text.divisions || '')
    .split(/·|,|\|/)
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (chips.length) {
    const cs = S * 0.03;
    font(ctx, cs, 800, SANS);
    const widths = chips.map((c) => ctx.measureText(c.toUpperCase()).width + cs * 1.6);
    const gap = cs * 0.5;
    // Wrap into rows that fit.
    const rowsOf: number[][] = [[]];
    let rowW = 0;
    widths.forEach((w, i) => {
      if (rowW + w > W * 0.88 && rowsOf[rowsOf.length - 1].length) {
        rowsOf.push([]);
        rowW = 0;
      }
      rowsOf[rowsOf.length - 1].push(i);
      rowW += w + gap;
    });
    rowsOf.forEach((row, r) => {
      const total = row.reduce((s2, i) => s2 + widths[i] + gap, -gap);
      let x = W / 2 - total / 2;
      row.forEach((i) => {
        const p = eBack(seg(t, 1.3 + i * 0.08, 1.7 + i * 0.08));
        if (p > 0) {
          ctx.save();
          ctx.translate(x + widths[i] / 2, y + r * cs * 2.2);
          ctx.scale(p, p);
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.strokeStyle = rgba(g.c2, 0.8);
          ctx.lineWidth = Math.max(1.5, cs * 0.08);
          ctx.beginPath();
          ctx.roundRect(-widths[i] / 2, -cs * 0.85, widths[i], cs * 1.7, cs * 0.85);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          if (p > 0.6) label(g, chips[i].toUpperCase(), x + widths[i] / 2, y + r * cs * 2.2, cs, '#fff', 'center', 800, 0.08);
        }
        x += widths[i] + gap;
      });
    });
    y += rowsOf.length * cs * 2.2 + S * 0.02;
  }
  const prize = spec.text.prize || '';
  if (prize) {
    const ps = Math.min(S * 0.05, (W * 0.8) / Math.max(1, prize.length * 0.5));
    font(ctx, ps, 900);
    const pw = ctx.measureText(prize.toUpperCase()).width + ps * 1.6;
    const pp = eExpo(seg(t, 1.8, 2.2));
    ctx.save();
    ctx.fillStyle = accent(g);
    para(ctx, W / 2 - (pw * pp) / 2, y + S * 0.02, pw * pp, ps * 1.35, ps * 0.3);
    ctx.fill();
    ctx.restore();
    if (pp > 0.7) headline(g, prize.toUpperCase(), W / 2, y + S * 0.02 + ps * 1.08, ps, { color: g.ink, shadow: false });
  }
  logoAt(g, spec.logo, W - S * 0.1, S * 0.1, S * 0.12, eOut(seg(t, 0.3, 0.8)));
  panelWipe(g, seg(t, d - 0.45, d + 0.15));
}

/** The podium: second, first and third rise in their colours, the trophy over the winners. */
function drawPodium(g: G) {
  const { ctx, W, H, S, t, d, portrait, spec } = g;
  backdrop(g);
  const title = (spec.text.title || 'THE PODIUM').toUpperCase();
  const top = H * (portrait ? 0.12 : 0.13);
  headline(g, title, W / 2, top, fit(ctx, title, W * 0.8, S * 0.1), { color: '#fff', reveal: seg(t, 0.05, 0.45) });
  const teams = (spec.teams ?? []).slice(0, 3);
  // Left to right: 2nd, 1st, 3rd.
  const order = [1, 0, 2].filter((i) => teams[i]);
  const base = H * 0.9;
  const colW = Math.min(W * 0.28, S * 0.3);
  const heights = [S * 0.34, S * 0.24, S * 0.17];
  order.forEach((place, k) => {
    const tm = teams[place];
    const cx = W / 2 + (k - (order.length - 1) / 2) * colW * 1.06;
    const start = place === 0 ? 1.2 : place === 1 ? 0.7 : 0.4;
    const p = eOut(seg(t, start, start + 0.6));
    if (p <= 0) return;
    const h = heights[place] * p;
    ctx.save();
    const gr = ctx.createLinearGradient(0, base - h, 0, base);
    gr.addColorStop(0, shade(tm.colors[0], 0.05));
    gr.addColorStop(1, shade(tm.colors[0], -0.5));
    ctx.fillStyle = gr;
    ctx.fillRect(cx - colW / 2, base - h, colW, h);
    ctx.fillStyle = tm.colors[1];
    ctx.fillRect(cx - colW / 2, base - h, colW, S * 0.012);
    ctx.restore();
    headline(g, String(place + 1), cx, base - h + Math.min(h, heights[place]) * 0.62, Math.min(heights[place] * 0.5, colW * 0.5), { color: 'rgba(255,255,255,0.85)', shadow: false });
    const bp = eBack(seg(t, start + 0.4, start + 0.8));
    if (bp > 0) {
      const bs = colW * (place === 0 ? 0.62 : 0.5);
      ctx.save();
      ctx.translate(cx, base - h - bs * 0.62);
      ctx.scale(bp, bp);
      teamBadge(g, tm, 0, 0, bs);
      ctx.restore();
      const nm = tm.name.toUpperCase();
      label(g, nm, cx, base - h - bs * 1.3, Math.min(S * 0.04, (colW * 1.05) / Math.max(1, nm.length * 0.62)), '#fff', 'center', 900, 0.06);
    }
    // The trophy over the winners' name.
    if (place === 0) {
      const tp = eBack(seg(t, 2, 2.5));
      if (tp > 0) trophy(g, cx, base - heights[0] - colW * 0.62 * 1.3 - S * 0.1, S * 0.12 * tp);
    }
  });
  if (g.look !== 'classic' && teams.length) confetti(g, 1.9, LITE ? 40 : 90);
  panelWipe(g, seg(t, d - 0.45, d + 0.15));
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
  replay: drawReplay,
  telestrator: drawTelestrator,
  versus: drawVersus,
  victory: drawVictory,
  potw: drawPotw,
  badge: drawBadge,
  commit: drawCommit,
  summary: drawSummary,
  kinetic: drawKinetic,
  letterbox: drawLetterbox,
  glitch: drawGlitch,
  logoWall: drawLogoWall,
  dateSlate: drawDateSlate,
  endSlate: drawEndSlate,
  bracket: drawBracket,
  signup: drawSignup,
  fixtures: drawFixtures,
  standings: drawStandings,
  eventCard: drawEventCard,
  podium: drawPodium,
};

/** Graphics that fill the whole frame (the rest are overlays). */
export const FULL_FRAME: GraphicSpec['type'][] = ['open', 'playerCard', 'stats', 'roster', 'final', 'closer', 'versus', 'victory', 'potw', 'commit', 'summary', 'logoWall', 'dateSlate', 'endSlate', 'bracket', 'signup', 'fixtures', 'standings', 'eventCard', 'podium'];

/** Draws `clip`'s graphic at clip-local time `local` into a W x H frame. */
export function drawGraphic(ctx: CanvasRenderingContext2D, clip: Clip, local: number, W: number, H: number, img: ImageLookup, media: CanvasImageSource | null, lite = false) {
  const spec = clip.graphic;
  if (!spec) return;
  const look = spec.look ?? 'broadcast';
  const [c1, team2] = spec.colors;
  // The championship look trades the team accent for gold.
  const c2 = look === 'championship' ? '#e2b13c' : team2;
  let metal: CanvasGradient | null = null;
  if (look === 'championship') {
    // Brushed gold: light and dark bands repeating down the frame, so any plate catches them.
    metal = ctx.createLinearGradient(0, 0, W * 0.15, H);
    const bands = 14;
    for (let i = 0; i <= bands; i++) metal.addColorStop(i / bands, ['#f6dc8a', '#d9a93a', '#b47f1e', '#ecc45c'][i % 4]);
  }
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
    ink: look === 'championship' ? '#20160a' : inkFor(c2),
    spec,
    look,
    metal,
    img,
    media,
    mediaId: clip.assetId,
    clipId: clip.id,
  };
  LOOK = look;
  HEAD = look === 'classic' ? SANS : DISPLAY;
  SKEW = look === 'classic' ? 0 : 1;
  LITE = lite;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  try {
    DRAW[spec.type](g);
  } finally {
    ctx.restore();
    LOOK = 'broadcast';
    HEAD = DISPLAY;
    SKEW = 1;
    LITE = false;
  }
}
