import { uid } from '../utils';
import { createTrack } from './ops';
import { clipDefaults, DEFAULT_TEXT } from './presets';
import type { Asset, Clip, Project, TextStyle } from './types';

export const DEFAULT_IMAGE_DURATION = 5;
export const DEFAULT_TEXT_DURATION = 3;

export function createProject(width = 1920, height = 1080, name?: string): Project {
  const now = Date.now();
  return {
    id: uid('p_'),
    name: name ?? `Project ${new Date(now).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    createdAt: now,
    updatedAt: now,
    settings: { width, height, fps: 30, background: '#000000' },
    tracks: [createTrack('video', true)],
    clips: [],
  };
}

export function createMediaClip(asset: Asset, start = 0): Clip {
  const kind = asset.kind === 'audio' ? 'audio' : asset.kind === 'image' ? 'image' : 'video';
  return {
    ...clipDefaults(),
    id: uid('c_'),
    trackId: '',
    kind,
    name: asset.name,
    assetId: asset.id,
    start,
    duration: asset.kind === 'image' ? DEFAULT_IMAGE_DURATION : Math.max(0.1, asset.duration),
  };
}

export function createTextClip(style: Partial<TextStyle> = {}, start = 0): Clip {
  const text = { ...DEFAULT_TEXT, ...style };
  return {
    ...clipDefaults(),
    id: uid('c_'),
    trackId: '',
    kind: 'text',
    name: text.content.split('\n')[0].slice(0, 40) || 'Text',
    start,
    duration: DEFAULT_TEXT_DURATION,
    text,
  };
}

export function createStickerClip(sticker: string, start = 0): Clip {
  return {
    ...clipDefaults(),
    id: uid('c_'),
    trackId: '',
    kind: 'sticker',
    name: 'Sticker',
    start,
    duration: DEFAULT_TEXT_DURATION,
    sticker,
    transform: { x: 0.25, y: -0.2, scale: 1, rotation: 0, opacity: 1 },
  };
}
