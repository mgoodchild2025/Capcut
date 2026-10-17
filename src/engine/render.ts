import { activeLayers, type Layer } from '../model/ops';
import { FILTERS } from '../model/presets';
import type { AnimKind, Clip, Project, TransitionKind } from '../model/types';
import { easeInOutCubic, easeOutBack, easeOutCubic } from '../utils';

export type Source = HTMLVideoElement | HTMLImageElement;

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
  return [el.naturalWidth, el.naturalHeight];
}

export function textFont(clip: Clip, H: number): { font: string; size: number } {
  const t = clip.text!;
  const size = (t.fontSize * H) / 1080;
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

export interface RenderOptions {
  getSource: (clip: Clip) => Source | null;
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
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  const boxes: DrawBox[] = [];
  for (const layer of activeLayers(project, t)) {
    const { clip, track } = layer;
    if (track.hidden || track.kind === 'audio' || clip.kind === 'audio') continue;
    const m = motionFor(layer);
    const alpha = clip.transform.opacity * m.alpha;
    if (alpha <= 0.001) continue;

    let w = 0;
    let h = 0;
    const scale = clip.transform.scale * m.scale;
    const cx = W / 2 + (clip.transform.x + m.dx) * W;
    const cy = H / 2 + (clip.transform.y + m.dy) * H;
    const rotation = clip.transform.rotation + m.rot;

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
      const el = opts.getSource(clip);
      const [iw, ih] = el ? sourceSize(el) : [0, 0];
      if (el && iw > 0 && ih > 0) {
        const fit = clip.fit === 'cover' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
        w = iw * fit * scale;
        h = ih * fit * scale;
        ctx.filter = cssFilterFor(clip, m.blur, pxScale);
        ctx.drawImage(el, -w / 2, -h / 2, w, h);
        ctx.filter = 'none';
        if (clip.adjust.vignette > 0) {
          const r = Math.hypot(w, h) / 2;
          const g = ctx.createRadialGradient(0, 0, r * 0.35, 0, 0, r);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(1, `rgba(0,0,0,${(clip.adjust.vignette / 100) * 0.9})`);
          ctx.fillStyle = g;
          ctx.fillRect(-w / 2, -h / 2, w, h);
        }
      }
    } else if (clip.kind === 'text' && clip.text) {
      [w, h] = drawText(ctx, clip, H, scale, m.blur * pxScale);
    } else if (clip.kind === 'sticker' && clip.sticker) {
      const size = (220 * H) / 1080;
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
    if (w > 0) boxes.push({ clipId: clip.id, cx, cy, w, h, rotation });
  }
  ctx.restore();
  return boxes;
}

function drawText(ctx: CanvasRenderingContext2D, clip: Clip, H: number, scale: number, blurPx: number): [number, number] {
  const t = clip.text!;
  const { font, size } = textFont(clip, H);
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
  ctx.textAlign = t.align;
  const anchorX = t.align === 'left' ? -maxW / 2 : t.align === 'right' ? maxW / 2 : 0;
  ctx.lineJoin = 'round';
  lines.forEach((line, i) => {
    const y = top + i * lineH;
    if (t.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = size * 0.18;
      ctx.shadowOffsetY = size * 0.05;
    }
    if (t.strokeWidth > 0) {
      ctx.strokeStyle = t.strokeColor;
      ctx.lineWidth = (t.strokeWidth * size) / 50;
      ctx.strokeText(line, anchorX, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = t.color;
    ctx.fillText(line, anchorX, y);
    ctx.shadowColor = 'transparent';
  });
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
