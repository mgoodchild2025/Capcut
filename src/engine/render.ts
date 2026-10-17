import { activeWordIndex } from '../captions/captions';
import { drawGraphic } from './graphics';
import { activeLayers, type Layer } from '../model/ops';
import { transformAt } from '../model/timing';
import { applyChroma } from './chroma';
import { FILTERS } from '../model/presets';
import type { AnimKind, Clip, Project, TransitionKind } from '../model/types';
import { easeInOutCubic, easeOutBack, easeOutCubic } from '../utils';

/** Anything the compositor can draw a media frame from: live elements in preview, decoded canvases in export. */
export type Source = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

/** A drawn clip's on-canvas box in project coordinates, used for hit-testing and handles. */
export interface DrawBox {
  clipId: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

interface Motion {
  alpha: number;
  dx: number; // fraction of canvas width
  dy: number; // fraction of canvas height
  scale: number;
  rot: number; // degrees
  blur: number; // px at project scale
  wipe: number | null; // visible fraction from the left, 0..1
}

const IDENTITY: Motion = { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, wipe: null };

/** Applies an in/out animation at eased progress `p` (0 = hidden, 1 = settled). */
function animate(m: Motion, kind: AnimKind, p: number, dir: 'in' | 'out'): void {
  const e = kind === 'pop' && dir === 'in' ? easeOutBack(p) : easeOutCubic(p);
  const away = 1 - easeOutCubic(p);
  const sign = dir === 'in' ? 1 : -1;
  switch (kind) {
    case 'fade':
      m.alpha *= p;
      break;
    case 'slide-left':
      m.dx += sign * away * 0.6;
      m.alpha *= p;
      break;
    case 'slide-right':
      m.dx -= sign * away * 0.6;
      m.alpha *= p;
      break;
    case 'slide-up':
      m.dy += sign * away * 0.6;
      m.alpha *= p;
      break;
    case 'slide-down':
      m.dy -= sign * away * 0.6;
      m.alpha *= p;
      break;
    case 'zoom-in':
      m.scale *= 0.4 + 0.6 * e;
      m.alpha *= p;
      break;
    case 'zoom-out':
      m.scale *= 1.6 - 0.6 * e;
      m.alpha *= p;
      break;
    case 'spin':
      m.rot += away * 270 * sign;
      m.scale *= Math.max(0.01, e);
      m.alpha *= p;
      break;
    case 'pop':
      m.scale *= Math.max(0.01, e);
      m.alpha *= Math.min(1, p * 2);
      break;
  }
}

function applyTransition(m: Motion, kind: TransitionKind, progress: number, role: 'in' | 'out'): void {
  const p = easeInOutCubic(progress);
  switch (kind) {
    case 'dissolve':
      if (role === 'in') m.alpha *= p;
      break;
    case 'fade-black':
      m.alpha *= role === 'out' ? Math.max(0, 1 - p * 2) : Math.max(0, p * 2 - 1);
      break;
    case 'slide-left':
      m.dx += role === 'in' ? 1 - p : -p;
      break;
    case 'slide-up':
      m.dy += role === 'in' ? 1 - p : -p;
      break;
    case 'wipe-right':
      if (role === 'in') m.wipe = p;
      break;
    case 'zoom':
      if (role === 'in') {
        m.scale *= 1.5 - 0.5 * p;
        m.alpha *= p;
      } else {
        m.scale *= 1 + 0.3 * p;
      }
      break;
    case 'flash':
      // Hard cut hidden under a white flash (drawn by renderFrame).
      m.alpha *= role === 'in' ? (progress >= 0.5 ? 1 : 0) : progress < 0.5 ? 1 : 0;
      break;
    case 'blur':
      if (role === 'in') {
        m.blur += (1 - p) * 24;
        m.alpha *= p;
      } else {
        m.blur += p * 24;
      }
      break;
  }
}

export function motionFor(layer: Layer): Motion {
  const m = { ...IDENTITY };
  const { clip } = layer;
  if (!layer.held) {
    if (clip.animIn !== 'none' && clip.animInDur > 0 && layer.local < clip.animInDur) {
      animate(m, clip.animIn, Math.max(0, layer.local / clip.animInDur), 'in');
    }
    const remaining = clip.duration - layer.local;
    if (clip.animOut !== 'none' && clip.animOutDur > 0 && remaining < clip.animOutDur) {
      animate(m, clip.animOut, Math.max(0, remaining / clip.animOutDur), 'out');
    }
  }
  if (layer.transition) applyTransition(m, layer.transition.kind, layer.transition.progress, layer.transition.role);
  return m;
}

export function cssFilterFor(clip: Clip, extraBlur = 0, pxScale = 1): string {
  const parts: string[] = [];
  const preset = FILTERS.find((f) => f.id === clip.filter);
  if (preset?.css) parts.push(preset.css);
  const a = clip.adjust;
  if (a.brightness) parts.push(`brightness(${1 + a.brightness / 100})`);
  if (a.contrast) parts.push(`contrast(${1 + a.contrast / 100})`);
  if (a.saturation) parts.push(`saturate(${1 + a.saturation / 100})`);
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
  const blur = (a.blur + extraBlur) * pxScale;
  if (blur > 0.05) parts.push(`blur(${blur.toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

function sourceSize(el: Source): [number, number] {
  if (el instanceof HTMLVideoElement) return [el.videoWidth, el.videoHeight];
  if (el instanceof HTMLImageElement) return [el.naturalWidth, el.naturalHeight];
  return [el.width, el.height];
}

/** Font for a text clip. Sizes are relative to a 1080px short side, so text fits portrait canvases too. */
export function textFont(clip: Clip, shortSide: number): { font: string; size: number } {
  const t = clip.text!;
  const size = (t.fontSize * shortSide) / 1080;
  return { font: `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${size}px ${t.fontFamily}`, size };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Where a directly displayed video sits, in project pixels. See `RenderOptions.direct`. */
export interface DirectPlacement {
  clip: Clip;
  cx: number;
  cy: number;
  /** Size of the visible (cropped) frame. */
  w: number;
  h: number;
  rotation: number;
  alpha: number;
  /** Blur from animations, added to the clip's own filter. */
  extraBlur: number;
}

export interface RenderOptions {
  getSource: (clip: Clip) => Source | null;
  /** Images by asset id, for graphics (logos, roster photos). */
  getImage?: (assetId: string) => CanvasImageSource | null;
  /**
   * The bottom video, shown by the page itself (a `<video>` under a transparent canvas) instead of
   * being copied onto the canvas, which is slow on phones. Its placement is reported, not drawn,
   * and the background is left transparent.
   */
  direct?: { clipId: string; place: (p: DirectPlacement) => void };
}

/**
 * Composites the project at time `t` onto `ctx`. The context's canvas may be any size;
 * drawing happens in project coordinates scaled to fit.
 */
export function renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: number, opts: RenderOptions): DrawBox[] {
  const { width: W, height: H, background } = project.settings;
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const pxScale = cw / W;
  ctx.save();
  ctx.setTransform(pxScale, 0, 0, ch / H, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  if (opts.direct) {
    ctx.clearRect(0, 0, W, H);
  } else {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, W, H);
  }

  const boxes: DrawBox[] = [];
  for (const layer of activeLayers(project, t)) {
    const { clip, track } = layer;
    if (track.hidden || track.kind === 'audio' || clip.kind === 'audio') continue;
    const m = motionFor(layer);
    const tr = transformAt(clip, layer.local);
    const alpha = tr.opacity * m.alpha;
    const flash = () => {
      if (layer.transition?.kind !== 'flash' || layer.transition.role !== 'in') return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - Math.abs(layer.transition.progress * 2 - 1));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    };
    if (alpha <= 0.001) {
      flash();
      continue;
    }

    let w = 0;
    let h = 0;
    const scale = tr.scale * m.scale;
    const cx = W / 2 + (tr.x + m.dx) * W;
    const cy = H / 2 + (tr.y + m.dy) * H;
    const rotation = tr.rotation + m.rot;

    ctx.save();
    if (m.wipe !== null) {
      ctx.beginPath();
      ctx.rect(0, 0, W * m.wipe, H);
      ctx.clip();
    }
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate((rotation * Math.PI) / 180);

    if (clip.kind === 'video' || clip.kind === 'image') {
      let el: Source | null = opts.getSource(clip);
      const [fw, fh] = el ? sourceSize(el) : [0, 0];
      if (el && fw > 0 && fh > 0) {
        if (clip.chroma) el = applyChroma(el, fw, fh, clip.chroma) ?? el;
        const [ew, eh] = sourceSize(el);
        const c = clip.crop;
        const sx = c ? c.left * ew : 0;
        const sy = c ? c.top * eh : 0;
        const sw = c ? Math.max(1, ew * (1 - c.left - c.right)) : ew;
        const sh = c ? Math.max(1, eh * (1 - c.top - c.bottom)) : eh;
        // Fit uses the cropped frame in source pixels, so keying at a reduced size doesn't change layout.
        const iw = fw * (sw / ew);
        const ih = fh * (sh / eh);
        const fit = clip.fit === 'cover' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
        w = iw * fit * scale;
        h = ih * fit * scale;
        const spot = clip.spotlight && clip.hold ? spotlightState(clip, layer.local) : null;
        if (opts.direct?.clipId === clip.id) {
          opts.direct.place({ clip, cx, cy, w, h, rotation, alpha, extraBlur: m.blur });
          ctx.restore();
          boxes.push({ clipId: clip.id, cx, cy, w, h, rotation });
          continue;
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(-w / 2, -h / 2, w, h);
        ctx.clip();
        if (spot && spot.zoom > 1) {
          const px = -w / 2 + clip.spotlight!.x * w;
          const py = -h / 2 + clip.spotlight!.y * h;
          ctx.translate(px, py);
          ctx.scale(spot.zoom, spot.zoom);
          ctx.translate(-px, -py);
        }
        if (clip.flipH || clip.flipV) ctx.scale(clip.flipH ? -1 : 1, clip.flipV ? -1 : 1);
        ctx.filter = cssFilterFor(clip, m.blur, pxScale);
        ctx.drawImage(el, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
        ctx.filter = 'none';
        if (clip.flipH || clip.flipV) ctx.scale(clip.flipH ? -1 : 1, clip.flipV ? -1 : 1);
        if (spot) drawSpotlight(ctx, clip, spot, w, h, Math.min(W, H));
        ctx.restore();
        if (clip.adjust.vignette > 0) {
          const r = Math.hypot(w, h) / 2;
          const g = ctx.createRadialGradient(0, 0, r * 0.35, 0, 0, r);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(1, `rgba(0,0,0,${(clip.adjust.vignette / 100) * 0.9})`);
          ctx.fillStyle = g;
          ctx.fillRect(-w / 2, -h / 2, w, h);
        }
      }
    } else if (clip.kind === 'graphic' && clip.graphic) {
      // Graphics draw in project coordinates; the clip's transform moves and scales the whole thing.
      ctx.scale(scale, scale);
      ctx.translate(-W / 2, -H / 2);
      drawGraphic(ctx, clip, layer.local, W, H, (id) => opts.getImage?.(id) ?? null, opts.getSource(clip));
      w = W * scale;
      h = H * scale;
    } else if (clip.kind === 'text' && clip.text) {
      [w, h] = drawText(ctx, clip, Math.min(W, H), scale, m.blur * pxScale, layer.sourceTime);
    } else if (clip.kind === 'sticker' && clip.sticker) {
      const size = (220 * Math.min(W, H)) / 1080;
      ctx.scale(scale, scale);
      ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (m.blur > 0.05) ctx.filter = `blur(${(m.blur * pxScale).toFixed(2)}px)`;
      ctx.fillText(clip.sticker, 0, size * 0.05);
      w = size * 1.15 * scale;
      h = size * 1.15 * scale;
    }
    ctx.restore();
    flash();
    if (w > 0) boxes.push({ clipId: clip.id, cx, cy, w, h, rotation });
  }
  ctx.restore();
  return boxes;
}

interface SpotState {
  /** 0..1 strength of the dimmed surround and ring. */
  amount: number;
  zoom: number;
  /** Ring pop-in progress 0..1. */
  ring: number;
  /** Seconds into the hold, for the pulse. */
  t: number;
}

/** Spotlight runs during the clip's hold and fades out over the following quarter second. */
function spotlightState(clip: Clip, local: number): SpotState | null {
  const hold = clip.hold ?? 0;
  const fadeOut = 0.3;
  if (local > hold + fadeOut) return null;
  const amount = local <= hold ? 1 : 1 - (local - hold) / fadeOut;
  const zoomIn = Math.min(1, local / Math.max(0.3, hold * 0.5));
  const zoomTarget = clip.spotlight!.zoom ? 1.5 : 1;
  const zoom = 1 + (zoomTarget - 1) * easeInOutCubic(zoomIn) * amount;
  return { amount, zoom, ring: Math.min(1, local / 0.35), t: local };
}

function drawSpotlight(ctx: CanvasRenderingContext2D, clip: Clip, s: SpotState, w: number, h: number, shortSide: number) {
  const sp = clip.spotlight!;
  const px = -w / 2 + sp.x * w;
  const py = -h / 2 + sp.y * h;
  // The frame is already zoomed around the player, so draw the ring in unzoomed space.
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(1 / s.zoom, 1 / s.zoom);
  ctx.translate(-px, -py);
  const pulse = 1 + 0.04 * Math.sin(s.t * 6);
  const r = sp.r * h * s.zoom * easeOutBack(s.ring) * pulse;
  ctx.globalAlpha *= s.amount;
  // Dim everything outside the ring.
  ctx.beginPath();
  ctx.rect(-w / 2 - w, -h / 2 - h, w * 3, h * 3);
  ctx.arc(px, py, Math.max(1, r), 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill('evenodd');
  // Ring.
  const lw = Math.max(3, shortSide * 0.008);
  ctx.beginPath();
  ctx.arc(px, py, Math.max(1, r), 0, Math.PI * 2);
  ctx.lineWidth = lw;
  ctx.strokeStyle = sp.color;
  ctx.shadowColor = sp.color;
  ctx.shadowBlur = lw * 3;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Pointer arrow and label above the ring.
  if (s.ring > 0.6) {
    const top = py - r - lw * 2;
    const size = shortSide * 0.035;
    ctx.fillStyle = sp.color;
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px - size * 0.6, top - size);
    ctx.lineTo(px + size * 0.6, top - size);
    ctx.closePath();
    ctx.fill();
    if (sp.label) {
      ctx.font = `800 ${size * 1.1}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(sp.label).width + size * 1.2;
      const ly = top - size * 2.1;
      ctx.beginPath();
      ctx.roundRect(px - tw / 2, ly - size * 0.85, tw, size * 1.7, size * 0.85);
      ctx.fill();
      ctx.fillStyle = contrastInk(sp.color);
      ctx.fillText(sp.label, px, ly + size * 0.05);
    }
  }
  ctx.restore();
}

/** Black or white, whichever reads better on `hex`. */
export function contrastInk(hex: string): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return '#111';
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}

function drawText(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  shortSide: number,
  scale: number,
  blurPx: number,
  src: number,
): [number, number] {
  const t = clip.text!;
  const { font, size } = textFont(clip, shortSide);
  ctx.scale(scale, scale);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  const lines = t.content.split('\n');
  const lineH = size * 1.2;
  const widths = lines.map((l) => ctx.measureText(l || ' ').width);
  const maxW = Math.max(...widths, size * 0.5);
  const pad = t.background ? size * 0.35 : size * 0.1;
  const bw = maxW + pad * 2;
  const bh = lineH * lines.length + pad * 2 - (lineH - size);
  if (blurPx > 0.05) ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
  if (t.background) {
    ctx.fillStyle = t.background;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, size * 0.2);
    ctx.fill();
  }
  const top = -((lines.length - 1) * lineH) / 2;
  ctx.lineJoin = 'round';

  const paint = (text: string, x: number, y: number, color: string) => {
    if (t.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = size * 0.18;
      ctx.shadowOffsetY = size * 0.05;
    }
    if (t.strokeWidth > 0) {
      ctx.strokeStyle = t.strokeColor;
      ctx.lineWidth = (t.strokeWidth * size) / 50;
      ctx.strokeText(text, x, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowColor = 'transparent';
  };

  // Word-by-word highlight for captions, as long as the text still matches the recognised words.
  const cap = clip.caption;
  const lineWords = lines.map((l) => l.split(/\s+/).filter(Boolean));
  if (cap?.highlight && lineWords.flat().length === cap.words.length) {
    const active = activeWordIndex(cap.words, src);
    const space = ctx.measureText(' ').width;
    ctx.textAlign = 'left';
    let index = 0;
    lineWords.forEach((ws, i) => {
      const y = top + i * lineH;
      const lw = widths[i];
      let x = t.align === 'left' ? -maxW / 2 : t.align === 'right' ? maxW / 2 - lw : -lw / 2;
      for (const word of ws) {
        paint(word, x, y, index === active ? cap.highlight! : t.color);
        x += ctx.measureText(word).width + space;
        index++;
      }
    });
    return [bw * scale, bh * scale];
  }

  ctx.textAlign = t.align;
  const anchorX = t.align === 'left' ? -maxW / 2 : t.align === 'right' ? maxW / 2 : 0;
  lines.forEach((line, i) => paint(line, anchorX, top + i * lineH, t.color));
  return [bw * scale, bh * scale];
}

/** Topmost box containing the point (project coordinates). */
export function hitTest(boxes: DrawBox[], x: number, y: number): DrawBox | undefined {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    const a = (-b.rotation * Math.PI) / 180;
    const dx = x - b.cx;
    const dy = y - b.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return b;
  }
  return undefined;
}
