import type { Adjust, AnimKind, Clip, TextStyle, TransitionKind } from './types';

export const ASPECT_PRESETS = [
  { id: '16:9', label: '16:9', hint: 'YouTube', width: 1920, height: 1080 },
  { id: '9:16', label: '9:16', hint: 'TikTok, Reels', width: 1080, height: 1920 },
  { id: '1:1', label: '1:1', hint: 'Instagram', width: 1080, height: 1080 },
  { id: '4:5', label: '4:5', hint: 'Feed post', width: 1080, height: 1350 },
  { id: '4:3', label: '4:3', hint: 'Classic', width: 1440, height: 1080 },
  { id: '21:9', label: '21:9', hint: 'Cinema', width: 2520, height: 1080 },
] as const;

export function aspectIdFor(width: number, height: number): string {
  const match = ASPECT_PRESETS.find((a) => Math.abs(a.width / a.height - width / height) < 0.01);
  return match?.id ?? 'custom';
}

export interface FilterPreset {
  id: string;
  label: string;
  css: string;
  /** Swatch gradient for the filter picker. */
  swatch: string;
}

export const FILTERS: FilterPreset[] = [
  { id: 'none', label: 'None', css: '', swatch: 'linear-gradient(135deg,#5b8def,#f2a65a)' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.45) contrast(1.08)', swatch: 'linear-gradient(135deg,#1f7bff,#ff5a36)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.25) saturate(1.25) hue-rotate(-8deg)', swatch: 'linear-gradient(135deg,#ffb347,#ff7043)' },
  { id: 'cool', label: 'Cool', css: 'saturate(1.1) hue-rotate(12deg) brightness(1.03)', swatch: 'linear-gradient(135deg,#4facfe,#00f2fe)' },
  { id: 'mono', label: 'Mono', css: 'grayscale(1)', swatch: 'linear-gradient(135deg,#222,#ddd)' },
  { id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.45) brightness(0.9)', swatch: 'linear-gradient(135deg,#000,#888)' },
  { id: 'sepia', label: 'Sepia', css: 'sepia(0.85)', swatch: 'linear-gradient(135deg,#704214,#e3c08d)' },
  { id: 'vintage', label: 'Vintage', css: 'sepia(0.4) contrast(0.9) brightness(1.06) saturate(0.85)', swatch: 'linear-gradient(135deg,#b08d57,#e9d8a6)' },
  { id: 'faded', label: 'Faded', css: 'contrast(0.78) brightness(1.12) saturate(0.7)', swatch: 'linear-gradient(135deg,#9aa5b1,#e6e1d6)' },
  { id: 'cinema', label: 'Cinema', css: 'contrast(1.22) saturate(0.85) sepia(0.12)', swatch: 'linear-gradient(135deg,#0f3443,#e07a3f)' },
  { id: 'dream', label: 'Dream', css: 'brightness(1.1) saturate(1.25) contrast(0.92) blur(0.6px)', swatch: 'linear-gradient(135deg,#f6d5f7,#fbe9d7)' },
  { id: 'punch', label: 'Punch', css: 'contrast(1.35) saturate(1.3)', swatch: 'linear-gradient(135deg,#ff0844,#ffb199)' },
  { id: 'chrome', label: 'Chrome', css: 'contrast(1.15) saturate(1.2) brightness(1.05) hue-rotate(-4deg)', swatch: 'linear-gradient(135deg,#8e9eab,#eef2f3)' },
  { id: 'invert', label: 'Invert', css: 'invert(1)', swatch: 'linear-gradient(135deg,#f0f,#0ff)' },
];

export const DEFAULT_ADJUST: Adjust = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  blur: 0,
  vignette: 0,
};

export const ANIMATIONS: { id: AnimKind; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'slide-left', label: 'Slide left' },
  { id: 'slide-right', label: 'Slide right' },
  { id: 'slide-up', label: 'Slide up' },
  { id: 'slide-down', label: 'Slide down' },
  { id: 'zoom-in', label: 'Zoom in' },
  { id: 'zoom-out', label: 'Zoom out' },
  { id: 'spin', label: 'Spin' },
  { id: 'pop', label: 'Pop' },
];

export const TRANSITIONS: { id: TransitionKind; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'fade-black', label: 'Dip to black' },
  { id: 'slide-left', label: 'Push left' },
  { id: 'slide-up', label: 'Push up' },
  { id: 'wipe-right', label: 'Wipe' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'blur', label: 'Blur' },
  { id: 'flash', label: 'Flash' },
];

export const FONTS = [
  'Inter, system-ui, sans-serif',
  '"Big Shoulders Display", Impact, sans-serif',
  'Georgia, serif',
  '"Courier New", monospace',
  'Impact, "Arial Black", sans-serif',
  '"Trebuchet MS", sans-serif',
  '"Comic Sans MS", "Comic Neue", cursive',
  '"Times New Roman", serif',
  'Verdana, sans-serif',
];

export const fontLabel = (f: string) => f.split(',')[0].replace(/"/g, '');

export const DEFAULT_TEXT: TextStyle = {
  content: 'Your text',
  fontFamily: FONTS[0],
  fontSize: 96,
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 0,
  background: null,
  align: 'center',
  bold: true,
  italic: false,
  shadow: true,
};

export const TEXT_TEMPLATES: { id: string; label: string; style: Partial<TextStyle> }[] = [
  { id: 'plain', label: 'Default', style: {} },
  { id: 'title', label: 'Big Title', style: { content: 'BIG TITLE', fontSize: 160, fontFamily: FONTS[4], bold: false } },
  { id: 'outline', label: 'Outline', style: { content: 'Outline', color: '#ffffff', strokeColor: '#000000', strokeWidth: 10, shadow: false } },
  { id: 'caption', label: 'Caption', style: { content: 'Add a caption', fontSize: 64, background: 'rgba(0,0,0,0.65)', shadow: false } },
  { id: 'neon', label: 'Neon', style: { content: 'NEON', color: '#39ff14', fontSize: 130, shadow: true, strokeColor: '#0a3d0a', strokeWidth: 4 } },
  { id: 'label', label: 'Label', style: { content: 'LABEL', color: '#111111', background: '#ffd400', fontSize: 72 } },
  { id: 'serif', label: 'Elegant', style: { content: 'Elegant', fontFamily: FONTS[2], italic: true, bold: false, fontSize: 110 } },
  { id: 'mono', label: 'Typewriter', style: { content: 'typewriter_', fontFamily: FONTS[3], bold: false, fontSize: 80, color: '#e8e8e8' } },
];

export const STICKERS = [
  '\u{1F3D0}', '\u{1F3C6}', '\u{1F947}', '\u{1F4A5}',
  '\u{1F525}', '\u{2728}', '\u{1F389}', '\u{1F60D}', '\u{1F602}', '\u{1F60E}', '\u{1F914}', '\u{1F631}',
  '\u{1F44D}', '\u{1F44F}', '\u{1F64C}', '\u{1F4AF}', '\u{2764}\u{FE0F}', '\u{1F49C}', '\u{1F499}', '\u{2B50}',
  '\u{1F31F}', '\u{26A1}', '\u{1F308}', '\u{2600}\u{FE0F}', '\u{1F319}', '\u{1F30A}', '\u{1F338}', '\u{1F340}',
  '\u{1F680}', '\u{1F3AC}', '\u{1F3B5}', '\u{1F4F8}', '\u{1F381}', '\u{1F388}', '\u{1F451}', '\u{1F48E}',
  '\u{1F436}', '\u{1F431}', '\u{1F98B}', '\u{1F355}', '\u{2615}', '\u{1F37F}', '\u{27A1}\u{FE0F}', '\u{2705}',
];

export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5];

export type NewClipFields = Omit<Clip, 'id' | 'trackId' | 'kind' | 'name' | 'start' | 'duration'>;

export function clipDefaults(): NewClipFields {
  return {
    inPoint: 0,
    speed: 1,
    volume: 1,
    audioFadeIn: 0,
    audioFadeOut: 0,
    fit: 'contain',
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    filter: 'none',
    adjust: { ...DEFAULT_ADJUST },
    animIn: 'none',
    animInDur: 0.5,
    animOut: 'none',
    animOutDur: 0.5,
    transition: 'none',
    transitionDur: 0.5,
  };
}
