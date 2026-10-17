/** Background artwork for reel title, info, stats and outro cards, painted in the team's colours. */

export type CardVariant = 'intro' | 'info' | 'stats' | 'outro';

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [30, 30, 30];
}

function shade(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

/** A volleyball outline with its curved panel seams. */
function volleyball(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, width: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.35);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  for (let k = 0; k < 3; k++) {
    ctx.save();
    ctx.rotate((k * Math.PI * 2) / 3);
    for (const off of [0.18, 0.5]) {
      ctx.beginPath();
      ctx.arc(-r * 0.25, r * (1.2 + off), r * (1.15 + off), Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

export function paintCard(ctx: CanvasRenderingContext2D, W: number, H: number, colors: [string, string], variant: CardVariant) {
  const [c1, c2] = colors;
  const S = Math.min(W, H);
  // Base: deep diagonal gradient between darkened team colours.
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, shade(c1, -0.72));
  g.addColorStop(0.55, shade(c1, -0.45));
  g.addColorStop(1, shade(c2, -0.55));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Glow behind the subject side.
  const glowX = variant === 'stats' ? W * 0.2 : variant === 'outro' ? W * 0.5 : W * 0.78;
  const glow = ctx.createRadialGradient(glowX, H * 0.45, 0, glowX, H * 0.45, S * 0.9);
  glow.addColorStop(0, rgba(c2, 0.45));
  glow.addColorStop(1, rgba(c2, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Diagonal speed stripes.
  ctx.save();
  ctx.translate(W * 0.5, H * 0.5);
  ctx.rotate(-0.42);
  for (let i = -12; i <= 12; i++) {
    ctx.fillStyle = i % 3 === 0 ? rgba(c2, 0.13) : 'rgba(255,255,255,0.035)';
    ctx.fillRect(i * S * 0.09, -S * 2, S * (i % 3 === 0 ? 0.03 : 0.012), S * 4);
  }
  ctx.restore();

  if (variant === 'info') {
    // Court lines, seen from above.
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = S * 0.006;
    const cw = W * 0.5;
    const ch = cw / 2;
    const x = W * 0.46;
    const y = (H - ch) / 2;
    ctx.strokeRect(x, y, cw, ch);
    ctx.beginPath();
    ctx.moveTo(x + cw / 2, y - ch * 0.08);
    ctx.lineTo(x + cw / 2, y + ch * 1.08);
    ctx.moveTo(x + cw / 2 - cw / 6, y);
    ctx.lineTo(x + cw / 2 - cw / 6, y + ch);
    ctx.moveTo(x + cw / 2 + cw / 6, y);
    ctx.lineTo(x + cw / 2 + cw / 6, y + ch);
    ctx.stroke();
  } else {
    const r = variant === 'outro' ? S * 0.32 : S * 0.42;
    const bx = variant === 'stats' ? W * 0.14 : variant === 'outro' ? W * 0.5 : W * 0.8;
    volleyball(ctx, bx, H * 0.5, r, `rgba(255,255,255,${variant === 'outro' ? 0.06 : 0.1})`, S * 0.012);
  }

  // Accent bar.
  ctx.fillStyle = c2;
  if (variant !== 'outro') ctx.fillRect(W * 0.06, H * 0.2, S * 0.012, H * 0.6);

  // Film grain and vignette so flat colours don't band after compression.
  const grain = ctx.createImageData(256, 256);
  let seed = 7;
  for (let i = 0; i < grain.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const v = (seed / 2147483647) * 255;
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = v;
    grain.data[i + 3] = 10;
  }
  const tile = document.createElement('canvas');
  tile.width = tile.height = 256;
  tile.getContext('2d')!.putImageData(grain, 0, 0);
  ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
  ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H / 2, S * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

export async function cardImage(W: number, H: number, colors: [string, string], variant: CardVariant): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  paintCard(canvas.getContext('2d')!, W, H, colors, variant);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Card render failed'))), 'image/png'));
}

/** Popular team colour pairs. */
export const TEAM_COLORS: { label: string; colors: [string, string] }[] = [
  { label: 'Royal & gold', colors: ['#1d4ed8', '#fbbf24'] },
  { label: 'Crimson & white', colors: ['#b91c1c', '#f8fafc'] },
  { label: 'Navy & teal', colors: ['#1e3a8a', '#14b8a6'] },
  { label: 'Black & orange', colors: ['#18181b', '#f97316'] },
  { label: 'Purple & gold', colors: ['#6d28d9', '#facc15'] },
  { label: 'Green & white', colors: ['#15803d', '#f0fdf4'] },
  { label: 'Maroon & silver', colors: ['#7f1d1d', '#cbd5e1'] },
  { label: 'Pink & black', colors: ['#db2777', '#111827'] },
];
